// Local stand-in for Onshape so the extension can be clicked through without
// an Onshape account: port 8181 plays cad.onshape.com (serving the extension
// scripts plus a fake assembly page), port 8282 serves the panel from docs/.
//   node test/harness/server.js   then open
//   http://localhost:8181/documents/aaaaaaaaaaaaaaaaaaaaaaaa/w/bbbbbbbbbbbbbbbbbbbbbbbb/e/cccccccccccccccccccccccc
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };

function serve(res, file) {
  if (!file) {
    res.writeHead(404).end('not found');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'text/plain', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

const safe = (base, rel) => {
  const file = path.resolve(base, '.' + rel);
  return file.startsWith(base) ? file : null;
};

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/documents/')) return serve(res, path.join(__dirname, 'harness.html'));
    if (url.pathname.startsWith('/extension/')) {
      return serve(res, safe(path.join(ROOT, 'extension'), url.pathname.slice('/extension'.length)));
    }
    if (url.pathname.startsWith('/harness/')) return serve(res, safe(__dirname, url.pathname.slice('/harness'.length)));
    res.writeHead(404).end('not found');
  })
  .listen(8181, () => console.log('Fake Onshape on http://localhost:8181/documents/...'));

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    serve(res, safe(path.join(ROOT, 'docs'), url.pathname === '/' ? '/index.html' : url.pathname));
  })
  .listen(8282, () => console.log('Panel on http://localhost:8282/'));
