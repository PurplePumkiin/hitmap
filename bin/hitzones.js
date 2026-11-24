#!/usr/bin/env node
import fs from 'node:fs';
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
  const isJson = (a) => a !== undefined && /\.json$/i.test(a);
  // Save overwrites the second argument, so a swapped pair would write JSON over the image.
  if (isJson(args[0]) || (args[1] !== undefined && !isJson(args[1]))) {
    console.error('hitzones: give the image first, then the zones file (.json):');
    console.error('  hitzones edit scene.jpg zones.json');
    process.exit(1);
  }
  const [image, json] = args.map((a) => path.resolve(process.cwd(), a));
  if (image && !fs.existsSync(image)) console.error(`hitzones: warning: image not found: ${image}`);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { url, close } = await startServer({ image, json, root });
  console.log(`hitzones editor: ${url}`);
  if (json) console.log(`Save writes to: ${json}`);
  console.log('Press Ctrl+C to stop.');
  try {
    const [bin, argv] =
      process.platform === 'darwin'
        ? ['open', [url]]
        : process.platform === 'win32'
          ? ['cmd', ['/c', 'start', '', url]]
          : ['xdg-open', [url]];
    const child = spawn(bin, argv, { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch {}
  process.on('SIGINT', () => close().then(() => process.exit(0)));
} else {
  console.error(USAGE);
  process.exit(1);
}
