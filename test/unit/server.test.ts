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
    expect(Object.keys(j).sort()).toEqual(['hasImage', 'imageName', 'json', 'jsonName']);
    expect(j).toMatchObject({ imageName: 'scene.svg', hasImage: true, jsonName: 'zones.json' });
  });

  it('session json is null when the file does not exist or no path given', async () => {
    const dir = tmp();
    const a = await start({ json: path.join(dir, 'new.json') });
    expect(await (await fetch(new URL(`/api/session?t=${a.token}`, a.url))).json()).toMatchObject({
      json: null, jsonName: 'new.json',
    });
    const b = await start({});
    expect(await (await fetch(new URL(`/api/session?t=${b.token}`, b.url))).json()).toEqual({
      imageName: '', hasImage: false, json: null, jsonName: null,
    });
  });

  it('serves the image with a content type', async () => {
    const dir = tmp();
    const s = await start({ image: path.join(dir, 'scene.svg') });
    const r = await fetch(new URL(`/api/image?t=${s.token}`, s.url));
    expect(r.headers.get('content-type')).toBe('image/svg+xml');
    expect((await fetch(new URL('/api/image', s.url))).status).toBe(403);
  });

  it('PUT /api/zones is 405 and the zones file on disk is untouched', async () => {
    const dir = tmp();
    const json = path.join(dir, 'zones.json');
    const before = fs.readFileSync(json, 'utf8');
    const s = await start({ json });
    expect((await put(s, '{"hitzones":1}')).status).toBe(405);
    expect((await put(s, '{"hitzones":1}', 'nope')).status).toBe(405);
    expect(fs.readFileSync(json, 'utf8')).toBe(before);
    expect(fs.readdirSync(dir).sort()).toEqual(['scene.svg', 'zones.json']);
  });

  it('every non-GET method is 405 and never creates the zones file', async () => {
    const dir = tmp();
    const json = path.join(dir, 'fresh.json');
    const s = await start({ json });
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const r = await fetch(new URL(`/api/zones?t=${s.token}`, s.url), {
        method,
        headers: { 'X-Hitzones-Token': s.token },
        body: '{"hitzones":1}',
      });
      expect(r.status).toBe(405);
    }
    expect(fs.existsSync(json)).toBe(false);
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

  it('answers 500 when the editor files are missing', async () => {
    const s = await start({ root: fs.mkdtempSync(path.join(os.tmpdir(), 'hz-empty-')) });
    const r = await fetch(new URL('/', s.url));
    expect(r.status).toBe(500);
    expect(await r.text()).toBe('editor files missing');
  });
});
