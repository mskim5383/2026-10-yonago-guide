// 인쇄·스크린샷용 정적 서버. file:// 에서는 웹폰트가 CORS 로 막혀서 http 로 띄운다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { MIME } from './util.mjs';

export function serve(dir) {
  const root = path.resolve(dir);
  const server = http.createServer((req, res) => {
    try {
      const u = new URL(req.url, 'http://localhost');
      let rel = decodeURIComponent(u.pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      const file = path.resolve(root, '.' + rel);
      if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403).end(); return; }
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}/`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}
