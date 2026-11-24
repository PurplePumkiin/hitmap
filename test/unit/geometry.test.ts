import { describe, expect, it } from 'vitest';
import {
  computeLayout, contentBox, pointFromClient, pointFromImage, positionOf, resolvePosition,
  splitPosition, zoneBounds, type ElementMetrics,
} from '../../src/geometry';

const z = { top: 0, right: 0, bottom: 0, left: 0 };
const el = (o: Partial<ElementMetrics> = {}): ElementMetrics => ({
  width: 200, height: 200, border: z, padding: z, natural: { width: 400, height: 200 },
  fit: 'fill', position: ['50%', '50%'], ...o,
});

describe('contentBox', () => {
  it.each([
    ['fill', { x: 0, y: 0, width: 200, height: 200 }],
    ['contain', { x: 0, y: 50, width: 200, height: 100 }],
    ['cover', { x: -100, y: 0, width: 400, height: 200 }],
    ['none', { x: -100, y: 0, width: 400, height: 200 }],
    ['scale-down', { x: 0, y: 50, width: 200, height: 100 }],
  ] as const)('%s', (fit, box) => {
    expect(contentBox(el({ fit }))).toEqual(box);
  });
  it('honours object-position', () => {
    expect(contentBox(el({ fit: 'cover', position: ['0%', '50%'] })).x).toBe(0);
    expect(contentBox(el({ fit: 'cover', position: ['100%', '50%'] })).x).toBe(-200);
    const b = contentBox(el({ fit: 'cover', position: ['10px', '0px'] }));
    expect([b.x, b.y]).toEqual([10, 0]);
  });
  it('accounts for border and padding', () => {
    const s = { top: 5, right: 5, bottom: 5, left: 5 };
    const p = { top: 10, right: 10, bottom: 10, left: 10 };
    expect(contentBox(el({ width: 230, height: 230, border: s, padding: p }))).toEqual({
      x: 15, y: 15, width: 200, height: 200,
    });
  });
});

describe('resolvePosition', () => {
  it('resolves percent, px and unknown', () => {
    expect(resolvePosition('50%', 100)).toBe(50);
    expect(resolvePosition('20px', 100)).toBe(20);
    expect(resolvePosition('calc(10px)', 100)).toBe(50);
  });
  it('resolves calc(% ± px) in either term order', () => {
    expect(resolvePosition('calc(100% - 10px)', 200)).toBe(190);
    expect(resolvePosition('calc(50% + 4px)', 200)).toBe(104);
    expect(resolvePosition('calc(-10px + 100%)', 200)).toBe(190);
    expect(resolvePosition('calc(4px + 50%)', 200)).toBe(104);
    expect(resolvePosition('calc(10px - 100%)', 200)).toBe(-190);
    expect(resolvePosition('calc(100%-10px)', 200)).toBe(100); // not valid CSS: falls back to centre
    expect(resolvePosition('calc(100% - 10px)', -100)).toBe(-110); // negative free space (cover)
  });
});

describe('splitPosition', () => {
  it('splits on top-level whitespace only', () => {
    expect(splitPosition('50% 50%')).toEqual(['50%', '50%']);
    expect(splitPosition('calc(100% - 10px) calc(100% - 10px)')).toEqual(['calc(100% - 10px)', 'calc(100% - 10px)']);
    expect(splitPosition('10px calc(50% + 2px)')).toEqual(['10px', 'calc(50% + 2px)']);
    expect(splitPosition('  0%   100%  ')).toEqual(['0%', '100%']);
  });
  it('falls back to centre for missing tokens', () => {
    expect(splitPosition('')).toEqual(['50%', '50%']);
    expect(splitPosition('25%')).toEqual(['25%', '50%']);
  });
  it('feeds contentBox for right 10px bottom 10px', () => {
    const b = contentBox(el({ fit: 'cover', position: splitPosition('calc(100% - 10px) calc(100% - 10px)') }));
    expect([b.x, b.y]).toEqual([-210, -10]);
  });
});

describe('computeLayout', () => {
  it('maps the visible crop to source pixels', () => {
    const L = computeLayout(el({ fit: 'cover' }), { width: 3840, height: 1920 }, { x: 0, y: 0 }, 1)!;
    expect(L.visible).toEqual({ x: 0, y: 0, width: 200, height: 200 });
    expect(L.source.x).toBeCloseTo(960);
    expect(L.source.y).toBeCloseTo(0);
    expect(L.source.width).toBeCloseTo(1920);
    expect(L.source.height).toBeCloseTo(1920);
  });
  it('returns null for zero area', () => {
    expect(computeLayout(el({ width: 0 }), { width: 400, height: 200 }, { x: 0, y: 0 }, 1)).toBeNull();
  });
  const img = { width: 400, height: 200 };
  const o = { x: 0, y: 0 };
  it('returns null for an unloaded image (natural 0x0)', () => {
    const natural = { width: 0, height: 0 };
    expect(computeLayout(el({ natural, fit: 'cover' }), img, o, 1)).toBeNull();
    expect(computeLayout(el({ natural, fit: 'contain' }), img, o, 1)).toBeNull();
  });
  it('returns null for a zero-sized JSON image', () => {
    expect(computeLayout(el(), { width: 0, height: 100 }, o, 1)).toBeNull();
  });
  it('returns null for a zero scale', () => {
    expect(computeLayout(el(), img, o, 0)).toBeNull();
  });
});

describe('zoneBounds', () => {
  it('handles each shape', () => {
    expect(zoneBounds({ label: 'a', shape: 'rect', x: 1, y: 2, width: 3, height: 4 })).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    expect(zoneBounds({ label: 'a', shape: 'ellipse', cx: 10, cy: 20, rx: 5, ry: 4 })).toEqual({ x: 5, y: 16, width: 10, height: 8 });
    expect(zoneBounds({ label: 'a', shape: 'polygon', points: [[0, 5], [10, 0], [4, 12]] })).toEqual({ x: 0, y: 0, width: 10, height: 12 });
  });
});

describe('spaces', () => {
  const L = computeLayout(el(), { width: 400, height: 200 }, { x: 100, y: 50 }, 2)!;
  it('positionOf', () => {
    const p = positionOf({ x: 200, y: 100, width: 40, height: 20 }, L);
    expect(p.image).toEqual({ x: 200, y: 100, width: 40, height: 20 });
    expect(p.percent).toEqual({ x: 50, y: 50, width: 10, height: 10 });
    expect(p.element).toEqual({ x: 100, y: 100, width: 20, height: 20 });
    expect(p.viewport).toEqual({ x: 300, y: 250, width: 40, height: 40 });
  });
  it('pointFromImage and pointFromClient invert', () => {
    expect(pointFromClient(300, 250, L).image).toEqual({ x: 200, y: 100 });
    const p = pointFromImage({ x: 200, y: 100 }, L);
    expect(p.viewport).toEqual({ x: 300, y: 250 });
    expect(p.element).toEqual({ x: 100, y: 100 });
    expect(p.percent).toEqual({ x: 50, y: 50 });
  });
});
