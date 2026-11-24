#!/usr/bin/env node
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer } from '../tool/server.js';

const USAGE = `Usage:
  hitzones edit [image] [zones.json]   open the editor in your browser
  hitzones --help                      show this help

If zones.json is given, Save writes straight back to it (created on first save).`;

const [cmd, ...args] = process.argv.slice(2);

if (cmd === '--help' || cmd === '-h' || cmd === 'help') {
  console.log(USAGE);
} else if (cmd === 'edit') {
  const [image, json] = args.map((a) => path.resolve(process.cwd(), a));
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { url, close } = await startServer({ image, json, root });
  console.log(`hitzones editor: ${url}`);
  console.log('Press Ctrl+C to stop.');
  try {
    const [bin, ...pre] =
      process.platform === 'darwin' ? ['open'] : process.platform === 'win32' ? ['cmd', '/c', 'start', '""'] : ['xdg-open'];
    const child = spawn(bin, [...pre, url], { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch {}
  process.on('SIGINT', () => close().then(() => process.exit(0)));
} else {
  console.error(USAGE);
  process.exit(1);
}
