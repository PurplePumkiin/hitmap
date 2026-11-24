import { describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repo = path.resolve(__dirname, '../..');
const bin = path.join(repo, 'bin/hitzones.js');
// PATH is emptied so the CLI can never launch a real browser opener.
const env = { ...process.env, PATH: '' };
const run = (...args: string[]) =>
  spawnSync(process.execPath, [bin, ...args], { cwd: repo, env, encoding: 'utf8', timeout: 10_000 });

describe('cli', () => {
  it('--help prints usage and exits 0', () => {
    const r = run('--help');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/hitzones edit \[image\] \[zones\.json\]/);
  });

  it.each([
    ['swapped arguments', ['zones.json', 'scene.png']],
    ['second argument is not .json', ['scene.png', 'other.png']],
    ['only a json file', ['zones.json']],
    ['first argument is .JSON (any case)', ['ZONES.JSON', 'b.json']],
  ])('edit refuses %s and exits 1 without touching anything', (_name, args) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hz-cli-'));
    fs.writeFileSync(path.join(dir, 'scene.png'), 'not really a png');
    const r = spawnSync(process.execPath, [bin, 'edit', ...args], { cwd: dir, env, encoding: 'utf8', timeout: 10_000 });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/give the image first, then the zones file/);
    expect(r.stdout).not.toMatch(/hitzones editor:/);
    expect(fs.readFileSync(path.join(dir, 'scene.png'), 'utf8')).toBe('not really a png');
  });

  it('edit warns on a missing image, still starts, and prints where Save writes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hz-cli-'));
    const child = spawn(process.execPath, [bin, 'edit', 'missing.png', 'zones.json'], { cwd: dir, env });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timed out: ${out} ${err}`)), 10_000);
      child.stdout.on('data', () => {
        if (/Press Ctrl\+C/.test(out)) {
          clearTimeout(t);
          resolve();
        }
      });
    });
    const exited = new Promise((r) => child.on('exit', r));
    child.kill('SIGINT');
    await exited;
    expect(err).toMatch(/warning: image not found: .*missing\.png/);
    expect(out).toContain(`Save writes to: ${path.join(fs.realpathSync(dir), 'zones.json')}`);
    expect(out).toMatch(/hitzones editor: http:\/\/127\.0\.0\.1:\d+\//);
  });
});
