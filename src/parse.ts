import type { ZonesJSON } from './types.js';

const fail = (msg: string): never => {
  throw new TypeError('hitzones: ' + msg);
};
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && isFinite(v);

/** Validates a zones file and returns the same object, untouched. Throws TypeError. */
export function parseZones(input: unknown): ZonesJSON {
  if (!isObj(input)) return fail('zones data must be an object');
  if (input.hitzones !== 1) return fail('unknown format version ' + JSON.stringify(input.hitzones) + ' (expected 1)');
  const img = input.image;
  if (!isObj(img) || !num(img.width) || !num(img.height) || img.width <= 0 || img.height <= 0)
    return fail('image.width and image.height must be positive numbers');
  if (!Array.isArray(input.zones)) return fail('zones must be an array');
  const seen = new Set<string>();
  input.zones.forEach((z: unknown, i: number) => {
    if (!isObj(z)) return fail(`zones[${i}] must be an object`);
    const label = z.label;
    if (typeof label !== 'string' || !label) return fail(`zones[${i}] needs a non-empty label`);
    const at = `zones[${i}] "${label}"`;
    if (seen.has(label)) return fail(`duplicate label "${label}" (zones[${i}])`);
    seen.add(label);
    const nums = (keys: string[], positive: string[] = []) => {
      for (const k of keys) {
        const v = z[k];
        if (!num(v)) return fail(`${at}: ${k} must be a finite number`);
        if (positive.indexOf(k) >= 0 && (v as number) <= 0) return fail(`${at}: ${k} must be greater than 0`);
      }
    };
    switch (z.shape) {
      case 'rect':
        return nums(['x', 'y', 'width', 'height'], ['width', 'height']);
      case 'ellipse':
        return nums(['cx', 'cy', 'rx', 'ry'], ['rx', 'ry']);
      case 'polygon': {
        const p = z.points;
        if (!Array.isArray(p) || p.length < 3) return fail(`${at}: polygon needs at least 3 points`);
        for (const pt of p)
          if (!Array.isArray(pt) || pt.length !== 2 || !num(pt[0]) || !num(pt[1]))
            return fail(`${at}: each point must be [x, y] with finite numbers`);
        return;
      }
      default:
        return fail(`${at}: unknown shape ${JSON.stringify(z.shape)}`);
    }
  });
  return input as unknown as ZonesJSON;
}
