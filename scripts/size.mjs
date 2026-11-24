// Prints the gzipped size of dist/hitzones.js and fails above the 6 KB limit.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const TARGET = 4096;
const LIMIT = 6144;
const bytes = gzipSync(readFileSync(new URL('../dist/hitzones.js', import.meta.url)), { level: 9 }).length;
console.log(`hitzones.js: ${bytes} bytes min+gzip (target ${TARGET}, limit ${LIMIT})${bytes > TARGET ? ' (over target)' : ''}`);
if (bytes > LIMIT) {
  console.error(`hitzones.js is over the ${LIMIT} byte limit`);
  process.exit(1);
}
