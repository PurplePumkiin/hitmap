import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseZones } from '../../src/parse';

const z0 = {
  label: 'lighthouse',
  shape: 'rect',
  x: 2500,
  y: 380,
  width: 640,
  height: 420,
  data: { group: 'buildings', message: 'Found the lighthouse!' },
};
const valid = {
  hitzones: 1,
  image: { width: 3840, height: 2160, src: 'scene.jpg' },
  zones: [
    z0,
    {
      label: 'sailboat',
      shape: 'polygon',
      points: [[1610, 1100], [2240, 1080], [2260, 1460], [1590, 1490]],
    },
    { label: 'snowman', shape: 'ellipse', cx: 1890, cy: 1650, rx: 70, ry: 110 },
  ],
};

describe('parseZones', () => {
  it('passes valid data through untouched', () => {
    expect(parseZones(valid)).toBe(valid);
    expect(parseZones(valid)).toEqual(valid);
  });

  it('keeps unknown keys', () => {
    const out: any = parseZones({ ...valid, extra: 1, zones: [{ ...z0, foo: 2 }] });
    expect(out.zones[0]).toHaveProperty('foo', 2);
    expect(out).toHaveProperty('extra', 1);
  });

  const bad: [string, unknown][] = [
    ['version', { ...valid, hitzones: 2 }],
    ['image size', { ...valid, image: { width: 0, height: 10 } }],
    ['missing label', { ...valid, zones: [{ ...z0, label: '' }] }],
    ['duplicate label', { ...valid, zones: [z0, z0] }],
    ['unknown shape', { ...valid, zones: [{ ...z0, shape: 'star' }] }],
    ['polygon < 3 points', { ...valid, zones: [{ label: 'p', shape: 'polygon', points: [[0, 0], [1, 1]] }] }],
    ['non-finite', { ...valid, zones: [{ ...z0, x: NaN }] }],
    ['not an object', 'nope'],
    ['zones not array', { ...valid, zones: {} }],
    ['ellipse radius <= 0', { ...valid, zones: [{ label: 'e', shape: 'ellipse', cx: 1, cy: 1, rx: 0, ry: 1 }] }],
    ['rect size <= 0', { ...valid, zones: [{ ...z0, width: -1 }] }],
    ['bad polygon point', { ...valid, zones: [{ label: 'p', shape: 'polygon', points: [[0, 0], [1, 1], [1]] }] }],
  ];
  for (const [name, input] of bad) {
    it(`rejects ${name}`, () => {
      expect(() => parseZones(input)).toThrow(TypeError);
      expect(() => parseZones(input)).toThrow(/^hitzones: /);
    });
  }

  it('accepts labels that match Object.prototype names', () => {
    const zones = ['constructor', '__proto__', 'toString'].map((label) => ({ ...z0, label }));
    expect(() => parseZones({ ...valid, zones })).not.toThrow();
  });

  it('names the duplicate label', () => {
    expect(() => parseZones({ ...valid, zones: [z0, z0] })).toThrow(/duplicate label "lighthouse"/);
  });

  it('names the zone index and label', () => {
    expect(() => parseZones({ ...valid, zones: [z0, { ...z0, label: 'b', x: Infinity }] })).toThrow(
      /zones\[1\] "b"/,
    );
  });
});

describe('schema', () => {
  it('is valid JSON with the expected $id', () => {
    const s = JSON.parse(readFileSync(new URL('../../schema/hitzones-v1.json', import.meta.url), 'utf8'));
    expect(s.$id.endsWith('hitzones-v1.json')).toBe(true);
  });
});
