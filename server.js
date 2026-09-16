/**
 * 勞工守護神 - 標準正式服務啟動入口
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const aiService = require('./server/ai_service.js');

const PORT = process.env.PORT || 3000;
const ROOT = path.resolve(__dirname);

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json'
};

const server = http.createServer(async (req, res) => {
  // CORS 預檢請求處理
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    res.end();
    return;
  }

  const urlParts = req.url.split('?');
  const reqPath = decodeURIComponent(urlParts[0]);

  // 健康檢查端點 (供雲端平台如 Render / Railway / Zeabur / K8s 存活探針檢驗)
  if (reqPath === '/health' || reqPath === '/api/health') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=UTF-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({ status: 'ok', time: new Date().toISOString() }));
    return;
  }

  // 佇列與負載狀態查詢端點
  if (reqPath === '/api/queue/status' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=UTF-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({ success: true, ...aiService.getQueueStatus() }));
    return;
  }

  // API 1: AI 勞基法諮詢接口
  if (reqPath === '/api/chat' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const query = payload.query || '';
        const apiKey = payload.apiKey || '';

        const result = await aiService.consult(query, apiKey);
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=UTF-8',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ success: true, ...result }));
      } catch (err) {
        res.writeHead(500, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // API 2: 官方令函庫查詢接口
  if (reqPath === '/api/interpretations' && req.method === 'GET') {
    try {
      const rawData = fs.readFileSync(path.join(ROOT, 'data/mol_interpretations.json'), 'utf8');
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=UTF-8',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(rawData);
    } catch (e) {
      res.writeHead(500, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // 靜態檔案路由與安全防護
  let filePath = reqPath;
  if (filePath === '/' || filePath === '') {
    filePath = '/public/index.html';
  } else if (!filePath.startsWith('/public') && !filePath.startsWith('/constants') && !filePath.startsWith('/engine') && !filePath.startsWith('/data')) {
    filePath = '/public' + filePath;
  }

  const fullPath = path.resolve(ROOT, '.' + filePath);

  // 安全防護：禁止路徑遍歷逃逸
  if (!fullPath.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=UTF-8' });
    res.end('403 Forbidden');
    return;
  }

  const ext = path.extname(fullPath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=UTF-8' });
      res.end('404 Not Found: ' + filePath);
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ 錯誤：連接埠 ${PORT} 已被其他程式佔用！`);
    console.log(`💡 提示：您可以指定其他埠號啟動，例如：PORT=3001 npm start`);
    process.exit(1);
  } else {
    console.error('伺服器發生異常錯誤:', err);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`📡 勞工守護神系統已於 http://0.0.0.0:${PORT} 啟動！`);
});

module.exports = server;
