import { describe, it, expect } from 'vitest';
import { parseZones } from '../../src/parse';
// @ts-ignore plain JS module
import * as m from '../../tool/js/model.js';

const img = { width: 3840, height: 2160, src: 'a.png' };
const rect = { shape: 'rect', x: 100, y: 200, width: 400, height: 600 };

describe('model', () => {
  it('createDoc builds an empty doc', () => {
    expect(m.createDoc(img)).toEqual({ hitzones: 1, image: img, zones: [] });
  });
  it('addZone labels zone-1, zone-2 and does not mutate', () => {
    const d0 = m.createDoc(img);
    const d1 = m.addZone(d0, rect);
    const d2 = m.addZone(d1, rect);
    expect(d2.zones.map((z: any) => z.label)).toEqual(['zone-1', 'zone-2']);
    expect(d0.zones).toHaveLength(0);
    expect(d1.zones).toHaveLength(1);
  });
  it('updateZone patches, removeZone removes', () => {
    let d = m.addZone(m.addZone(m.createDoc(img), rect), rect);
    d = m.updateZone(d, 'zone-1', { x: 5 });
    expect(d.zones[0].x).toBe(5);
    d = m.removeZone(d, 'zone-1');
    expect(d.zones.map((z: any) => z.label)).toEqual(['zone-2']);
  });
  it('renameZone throws on duplicate or empty', () => {
    const d = m.addZone(m.addZone(m.createDoc(img), rect), rect);
    expect(() => m.renameZone(d, 'zone-1', 'zone-2')).toThrow(/already used/);
    expect(() => m.renameZone(d, 'zone-1', '')).toThrow();
    expect(m.renameZone(d, 'zone-1', 'door').zones[0].label).toBe('door');
  });
  it('moveZone changes z-order', () => {
    const d = m.addZone(m.addZone(m.createDoc(img), rect), rect);
    expect(m.moveZone(d, 'zone-2', 0).zones.map((z: any) => z.label)).toEqual(['zone-2', 'zone-1']);
  });
  it('rescale scales all geometry', () => {
    let d = m.createDoc(img);
    d = m.addZone(d, rect);
    d = m.addZone(d, { shape: 'ellipse', cx: 100, cy: 200, rx: 40, ry: 60 });
    d = m.addZone(d, { shape: 'polygon', points: [[0, 0], [200, 0], [200, 100]] });
    const r = m.rescale(d, 1920, 1080);
    expect(r.image).toEqual({ width: 1920, height: 1080, src: 'a.png' });
    expect(r.zones[0]).toMatchObject({ x: 50, y: 100, width: 200, height: 300 });
    expect(r.zones[1]).toMatchObject({ cx: 50, cy: 100, rx: 20, ry: 30 });
    expect(r.zones[2].points).toEqual([[0, 0], [100, 0], [100, 50]]);
    expect(d.zones[0].x).toBe(100);
  });
  it('validate reports empty, duplicate and bad shape without double reports', () => {
    expect(m.validate(m.addZone(m.createDoc(img), rect), parseZones)).toEqual([]);
    const base = m.addZone(m.addZone(m.createDoc(img), rect), rect);
    const empty = { ...base, zones: [{ ...base.zones[0], label: '' }, base.zones[1]] };
    expect(m.validate(empty, parseZones)).toHaveLength(1);
    const dup = { ...base, zones: [base.zones[0], { ...base.zones[1], label: 'zone-1' }] };
    const e = m.validate(dup, parseZones);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatch(/duplicate/i);
    const bad = { ...base, zones: [{ label: 'a', shape: 'blob' }] };
    const be = m.validate(bad, parseZones);
    expect(be).toHaveLength(1);
    expect(be[0]).toMatch(/unknown shape/);
  });
  it('serialize orders keys, rounds, indents', () => {
    const doc: any = {
      extra: 1,
      zones: [{ foo: 1, data: { a: 1.23456 }, height: 4.5678, width: 3, y: 2, x: 1.005, shape: 'rect', label: 'a' }],
      image: { src: 's', zzz: 2, height: 2, width: 1 },
      hitzones: 1,
    };
    const s = m.serialize(doc);
    expect(s.endsWith('}\n')).toBe(true);
    const o = JSON.parse(s);
    expect(Object.keys(o)).toEqual(['hitzones', 'image', 'zones', 'extra']);
    expect(Object.keys(o.image)).toEqual(['width', 'height', 'src', 'zzz']);
    expect(Object.keys(o.zones[0])).toEqual(['label', 'shape', 'x', 'y', 'width', 'height', 'data', 'foo']);
    expect(o.zones[0].height).toBe(4.57);
    expect(o.zones[0].data.a).toBe(1.23456);
    expect(s).toContain('\n  "image": {\n    "width": 1');
  });
  it('round trips with unknown keys', () => {
    const doc: any = m.addZone(m.createDoc(img), { ...rect, data: { n: 1 }, custom: 'x' });
    doc.note = 'hi';
    const s = m.serialize(doc);
    expect(m.serialize(parseZones(JSON.parse(s)))).toBe(s);
    expect(s).toContain('"custom"');
    expect(s).toContain('"note"');
  });
});
