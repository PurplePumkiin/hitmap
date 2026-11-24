// Local tool server: binds 127.0.0.1 and only reads. It never writes files; the editor's Save
// downloads the JSON through the browser.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};
const typeOf = (p) => TYPES[path.extname(p).toLowerCase()] || 'application/octet-stream';

export function startServer({ image, json, port = 0, root }) {
  const token = crypto.randomBytes(16).toString('hex');
  let boundPort = 0;
  const send = (res, status, body, type = 'text/plain; charset=utf-8', extra = {}) => {
    const headers = { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra };
    if (type.startsWith('text/html')) headers['Referrer-Policy'] = 'no-referrer';
    res.writeHead(status, headers);
    res.end(body);
  };
  const sendJson = (res, status, obj) => send(res, status, JSON.stringify(obj), 'application/json');

  function serveStatic(res, dirName, rest) {
    let rel;
    try {
      rel = decodeURIComponent(rest);
    } catch {
      return send(res, 404, 'Not found');
    }
    const base = path.resolve(root, dirName);
    const file = path.resolve(base, rel);
    if (rel.includes('\0') || !file.startsWith(base + path.sep)) return send(res, 404, 'Not found');
    fs.readFile(file, (err, data) =>
      err ? send(res, 404, 'Not found') : send(res, 200, data, typeOf(file)),
    );
  }

  const handle = (req, res) => {
    const host = req.headers.host;
    if (host !== `127.0.0.1:${boundPort}` && host !== `localhost:${boundPort}`) {
      return send(res, 403, 'Bad host');
    }
    let url;
    try {
      url = new URL(req.url, 'http://127.0.0.1');
    } catch {
      return send(res, 400, 'Bad request');
    }
    const p = url.pathname;
    const authed = url.searchParams.get('t') === token;

    if (req.method !== 'GET') return send(res, 405, 'Method not allowed');

    if (p === '/') {
      const index = path.join(root, 'tool', 'index.html');
      return fs.readFile(index, (err, data) =>
        err ? send(res, 500, 'editor files missing') : send(res, 200, data, 'text/html; charset=utf-8'),
      );
    }
    if (p === '/api/session') {
      if (!authed) return send(res, 403, 'Bad token');
      let text = null;
      if (json) {
        try {
          text = fs.readFileSync(json, 'utf8');
        } catch {
          text = null;
        }
      }
      return sendJson(res, 200, {
        imageName: image ? path.basename(image) : '',
        hasImage: Boolean(image),
        json: text,
        jsonName: json ? path.basename(json) : null,
      });
    }
    if (p === '/api/image') {
      if (!authed) return send(res, 403, 'Bad token');
      if (!image) return send(res, 404, 'No image');
      return fs.readFile(image, (err, data) =>
        err
          ? send(res, 404, 'Not found')
          : send(res, 200, data, typeOf(image), {
              'Content-Security-Policy': "sandbox; default-src 'none'",
              'X-Content-Type-Options': 'nosniff',
            }),
      );
    }
    if (p.startsWith('/tool/')) return serveStatic(res, 'tool', p.slice(6));
    if (p.startsWith('/dist/')) return serveStatic(res, 'dist', p.slice(6));
    send(res, 404, 'Not found');
  };
  const server = http.createServer((req, res) => {
    try {
      handle(req, res);
    } catch {
      if (!res.headersSent) send(res, 500, 'Internal error');
      else res.end();
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      boundPort = addr.port;
      resolve({
        url: `http://127.0.0.1:${addr.port}/?t=${token}`,
        token,
        close: () =>
          new Promise((r) => {
            server.close(() => r());
            server.closeAllConnections();
          }),
      });
    });
  });
}
