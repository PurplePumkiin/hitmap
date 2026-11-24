import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
// @ts-expect-error plain JS module without declarations
import { startServer } from '../../tool/server.js';

const repo = path.resolve(__dirname, '../..');
type Srv = { url: string; token: string; close(): Promise<void> };
const open: Srv[] = [];

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hz-'));
  fs.copyFileSync(path.join(repo, 'test/fixtures/scene.svg'), path.join(dir, 'scene.svg'));
  fs.copyFileSync(path.join(repo, 'test/fixtures/zones.json'), path.join(dir, 'zones.json'));
  return dir;
}
async function start(opts: Record<string, unknown>): Promise<Srv> {
  const s = await startServer({ root: repo, port: 0, ...opts });
  open.push(s);
  return s;
}
afterEach(async () => {
  while (open.length) await open.pop()!.close();
});
const put = (s: Srv, body: string, token = s.token) =>
  fetch(new URL('/api/zones', s.url), { method: 'PUT', headers: { 'X-Hitzones-Token': token }, body });

describe('tool server', () => {
  it('listens on 127.0.0.1 only', async () => {
    const s = await start({});
    expect(new URL(s.url).hostname).toBe('127.0.0.1');
    expect(new URL(s.url).searchParams.get('t')).toBe(s.token);
  });

  it('session needs the token and returns the file', async () => {
    const dir = tmp();
    const s = await start({ image: path.join(dir, 'scene.svg'), json: path.join(dir, 'zones.json') });
    expect((await fetch(new URL('/api/session', s.url))).status).toBe(403);
    const r = await fetch(new URL(`/api/session?t=${s.token}`, s.url));
    expect(r.headers.get('cache-control')).toBe('no-store');
    const j = await r.json();
    expect(j.json).toBe(fs.readFileSync(path.join(dir, 'zones.json'), 'utf8'));
    expect(j).toMatchObject({ imageName: 'scene.svg', hasImage: true, writable: true });
  });

  it('session json is null when the file does not exist or no path given', async () => {
    const dir = tmp();
    const a = await start({ json: path.join(dir, 'new.json') });
    expect((await (await fetch(new URL(`/api/session?t=${a.token}`, a.url))).json()).json).toBeNull();
    const b = await start({});
    expect(await (await fetch(new URL(`/api/session?t=${b.token}`, b.url))).json()).toMatchObject({
      json: null, writable: false, hasImage: false,
    });
  });

  it('serves the image with a content type', async () => {
    const dir = tmp();
    const s = await start({ image: path.join(dir, 'scene.svg') });
    const r = await fetch(new URL(`/api/image?t=${s.token}`, s.url));
    expect(r.headers.get('content-type')).toBe('image/svg+xml');
    expect((await fetch(new URL('/api/image', s.url))).status).toBe(403);
  });

  it('PUT writes the file; bad token is 403 and leaves it unchanged', async () => {
    const dir = tmp();
    const json = path.join(dir, 'zones.json');
    const before = fs.readFileSync(json, 'utf8');
    const s = await start({ json });
    expect((await put(s, '{"hitzones":1}', 'nope')).status).toBe(403);
    expect(fs.readFileSync(json, 'utf8')).toBe(before);
    expect((await put(s, '{"hitzones":1}')).status).toBe(200);
    expect(fs.readFileSync(json, 'utf8')).toBe('{"hitzones":1}\n');
    expect(fs.readdirSync(dir).sort()).toEqual(['scene.svg', 'zones.json']);
  });

  it('creates the file when it does not exist yet', async () => {
    const dir = tmp();
    const json = path.join(dir, 'fresh.json');
    const s = await start({ json });
    expect((await put(s, '{"hitzones":1}\n')).status).toBe(200);
    expect(fs.readFileSync(json, 'utf8')).toBe('{"hitzones":1}\n');
  });

  it('rejects invalid bodies and leaves the file unchanged', async () => {
    const dir = tmp();
    const json = path.join(dir, 'zones.json');
    const before = fs.readFileSync(json, 'utf8');
    const s = await start({ json });
    for (const body of ['{"hitzones":2}', 'not json', '[]', 'null']) {
      expect((await put(s, body)).status).toBe(400);
    }
    expect(fs.readFileSync(json, 'utf8')).toBe(before);
  });

  it('rejects bodies over 5 MB', async () => {
    const dir = tmp();
    const s = await start({ json: path.join(dir, 'zones.json') });
    const big = '{"hitzones":1,"pad":"' + 'a'.repeat(5 * 1024 * 1024) + '"}';
    expect((await put(s, big)).status).toBe(413);
  });

  it('PUT without a json path is 409', async () => {
    const s = await start({});
    expect((await put(s, '{"hitzones":1}')).status).toBe(409);
  });

  it('static routes stay inside tool/ and dist/', async () => {
    const s = await start({});
    expect((await fetch(new URL('/tool/../package.json', s.url))).status).toBe(404);
    expect((await fetch(new URL('/tool/%2e%2e/package.json', s.url))).status).toBe(404);
    expect((await fetch(new URL('/dist/%2e%2e/package.json', s.url))).status).toBe(404);
    expect((await fetch(new URL('/tool/js/model.js', s.url))).status).toBe(200);
    // Requires a prior `npm run build`.
    const r = await fetch(new URL('/dist/hitzones.js', s.url));
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/javascript/);
  });

  it('GET / answers 200 even before the UI exists', async () => {
    const s = await start({});
    expect((await fetch(new URL('/', s.url))).status).toBe(200);
  });

  it('survives a malformed request line', async () => {
    const s = await start({});
    const port = Number(new URL(s.url).port);
    const reply = await new Promise<string>((resolve) => {
      const sock = net.connect(port, '127.0.0.1', () =>
        sock.write(`GET http://[ HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`),
      );
      let buf = '';
      sock.on('data', (d) => (buf += d));
      sock.on('close', () => resolve(buf));
      sock.on('error', () => resolve(buf));
      setTimeout(() => sock.destroy(), 500);
    });
    expect(reply).toMatch(/^HTTP\/1\.1 400 /);
    expect((await fetch(new URL('/', s.url))).status).toBe(200);
  });

  it('rejects a foreign Host header', async () => {
    const s = await start({});
    const port = Number(new URL(s.url).port);
    const status = await new Promise<number>((resolve) => {
      const req = http.request(
        { host: '127.0.0.1', port, path: '/', headers: { Host: `evil.example:${port}` } },
        (res) => { res.resume(); resolve(res.statusCode!); },
      );
      req.end();
    });
    expect(status).toBe(403);
    const ok = await fetch(`http://localhost:${port}/`);
    expect(ok.status).toBe(200);
  });

  it('hardens image and html responses', async () => {
    const dir = tmp();
    const s = await start({ image: path.join(dir, 'scene.svg') });
    const img = await fetch(new URL(`/api/image?t=${s.token}`, s.url));
    expect(img.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'");
    expect(img.headers.get('x-content-type-options')).toBe('nosniff');
    const html = await fetch(new URL('/tool/../x', s.url));
    expect(html.status).toBe(404);
    const t = await fetch(new URL('/', s.url));
    expect(t.headers.get('content-type')).toMatch(/^text\/html/);
    expect(t.headers.get('referrer-policy')).toBe('no-referrer');
  });
});
