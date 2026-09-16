const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3456;
const ROOT = path.join(__dirname, '..');

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8'
};

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/' || reqPath === '') {
    reqPath = '/public/index.html';
  } else if (!reqPath.startsWith('/public') && !reqPath.startsWith('/constants') && !reqPath.startsWith('/engine')) {
    reqPath = '/public' + reqPath;
  }

  const filePath = path.join(ROOT, reqPath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found: ' + reqPath);
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(PORT, async () => {
  console.log(`📡 測試伺服器啟動於 port ${PORT}，開始檢驗端點...`);

  function testEndpoint(urlPath) {
    return new Promise((resolve) => {
      http.get(`http://localhost:${PORT}${urlPath}`, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          resolve({ status: res.statusCode, contentType: res.headers['content-type'], length: body.length });
        });
      }).on('error', (err) => {
        resolve({ error: err.message });
      });
    });
  }

  const r1 = await testEndpoint('/');
  const r2 = await testEndpoint('/public/index.css');
  const r3 = await testEndpoint('/public/app.js');
  const r4 = await testEndpoint('/constants/labor_constants.json');
  const r5 = await testEndpoint('/engine/calculator.js');

  console.log('GET / -> Status:', r1.status, 'Type:', r1.contentType, 'Bytes:', r1.length);
  console.log('GET /public/index.css -> Status:', r2.status, 'Type:', r2.contentType);
  console.log('GET /public/app.js -> Status:', r3.status, 'Type:', r3.contentType);
  console.log('GET /constants/labor_constants.json -> Status:', r4.status, 'Type:', r4.contentType);
  console.log('GET /engine/calculator.js -> Status:', r5.status, 'Type:', r5.contentType);

  const all200 = [r1, r2, r3, r4, r5].every(r => r.status === 200);

  server.close(() => {
    if (all200) {
      console.log('\n🎉 所有 PWA 靜態檔案與法規常數端點測試通過 (200 OK)！');
      process.exit(0);
    } else {
      console.error('\n⚠️ 端點測試有失敗！');
      process.exit(1);
    }
  });
});
