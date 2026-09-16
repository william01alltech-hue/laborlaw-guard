const http = require('http');
const fs = require('fs');
const path = require('path');
const aiService = require('../server/ai_service.js');

const PORT = 3000;
const ROOT = path.join(__dirname, '..');

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const server = http.createServer(async (req, res) => {
  const urlParts = req.url.split('?');
  const reqPath = urlParts[0];

  // API 1: AI 勞法諮詢接口
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
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // API 2: 官方令函庫查詢接口
  if (reqPath === '/api/interpretations' && req.method === 'GET') {
    const rawData = fs.readFileSync(path.join(ROOT, 'data/mol_interpretations.json'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
    res.end(rawData);
    return;
  }

  // 靜態檔案路由
  let filePath = reqPath;
  if (filePath === '/' || filePath === '') {
    filePath = '/public/index.html';
  } else if (!filePath.startsWith('/public') && !filePath.startsWith('/constants') && !filePath.startsWith('/engine') && !filePath.startsWith('/data')) {
    filePath = '/public' + filePath;
  }

  const fullPath = path.join(ROOT, filePath);
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

server.listen(PORT, () => {
  console.log(`📡 勞工守護神 PWA 伺服器 (含 Qwen 3.8-27B API) 已於 http://localhost:${PORT} 啟動！`);
});
