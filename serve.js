const http = require('http');
const fs = require('fs');
const path = require('path');
const root = __dirname;
const saveFile = path.join(root, 'local-save.json');
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml' };

http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/save') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (req.method === 'GET') {
      fs.readFile(saveFile, 'utf8', (err, data) => {
        if (err) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'empty' })); }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(data);
      });
      return;
    }
    if (req.method === 'DELETE') {
      try { fs.unlinkSync(saveFile); } catch (e) {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    }
    if (req.method === 'PUT') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        fs.writeFile(saveFile, raw, (err) => {
          if (err) { res.writeHead(500); return res.end(JSON.stringify({ error: String(err) })); }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        });
      });
      return;
    }
    res.writeHead(405);
    return res.end('method');
  }
  let filePath = urlPath === '/' ? '/index.html' : urlPath;
  const file = path.normalize(path.join(root, filePath.replace(/^[\/\\]+/, '')));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(8767, '127.0.0.1', () => console.log('Gym RPG v4 at http://127.0.0.1:8767/'));
