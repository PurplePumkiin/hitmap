import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

// Requires a prior `npm run build`.
describe('dist', () => {
  it('ships ESM, IIFE and declarations with no runtime dependencies', async () => {
    const esm = await import('../../dist/hitzones.js');
    expect(typeof esm.createZones).toBe('function');
    expect(typeof esm.parseZones).toBe('function');
    expect(fs.readFileSync('dist/hitzones.iife.js', 'utf8')).toMatch(/var Hitzones=/);
    expect(fs.existsSync('dist/index.d.ts')).toBe(true);
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    expect(pkg.dependencies ?? {}).toEqual({});
  });
});
