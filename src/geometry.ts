import type { Box, Point, Position, XY, Zone } from './types.js';

export type Sides = { top: number; right: number; bottom: number; left: number };
export type ElementMetrics = {
  width: number;
  height: number;
  border: Sides;
  padding: Sides;
  natural: { width: number; height: number };
  fit: 'fill' | 'contain' | 'cover' | 'none' | 'scale-down';
  position: [string, string];
};
export type Layout = {
  content: Box;
  visible: Box;
  source: Box;
  image: { width: number; height: number };
  origin: XY;
  scale: number;
};

/** Splits a computed `object-position` into its two tokens, keeping `calc( … )` whole. */
export function splitPosition(value: string): [string, string] {
  const [a = '50%', b = '50%'] = value.match(/calc\([^)]*\)|\S+/g) || [];
  return [a, b];
}

const NUM = '-?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[+-]?\\d+)?';
const PCT = new RegExp(`^${NUM}%$`);
const PX = new RegExp(`^${NUM}px$`, 'i');
const CALC = new RegExp(`^calc\\(\\s*(${NUM})(%|px)\\s+([+-])\\s+(${NUM})(%|px)\\s*\\)$`, 'i');

/** Resolves one `object-position` token: `P%`, `Npx`, or `calc(P% ± Npx)` in either order. Anything else centres. */
export function resolvePosition(token: string, free: number): number {
  const t = token.trim();
  if (PCT.test(t)) return (free * parseFloat(t)) / 100;
  if (PX.test(t)) return parseFloat(t);
  const c = CALC.exec(t);
  if (c && c[2].toLowerCase() !== c[5].toLowerCase()) {
    const term = (v: string, unit: string) => (unit === '%' ? (free * parseFloat(v)) / 100 : parseFloat(v));
    const a = term(c[1], c[2]);
    const b = term(c[4], c[5]);
    return c[3] === '+' ? a + b : a - b;
  }
  return free / 2;
}

export function contentArea(m: ElementMetrics): Box {
  const x = m.border.left + m.padding.left;
  const y = m.border.top + m.padding.top;
  return {
    x,
    y,
    width: m.width - x - m.border.right - m.padding.right,
    height: m.height - y - m.border.bottom - m.padding.bottom,
  };
}

export function contentBox(m: ElementMetrics): Box {
  const a = contentArea(m);
  const { width: nw, height: nh } = m.natural;
  if (m.fit === 'fill') return a;
  const contain = Math.min(a.width / nw, a.height / nh);
  const s =
    m.fit === 'contain' ? contain
    : m.fit === 'cover' ? Math.max(a.width / nw, a.height / nh)
    : m.fit === 'none' ? 1
    : Math.min(1, contain);
  const width = nw * s;
  const height = nh * s;
  return {
    x: a.x + resolvePosition(m.position[0], a.width - width),
    y: a.y + resolvePosition(m.position[1], a.height - height),
    width,
    height,
  };
}

function intersect(a: Box, b: Box): Box {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y),
  };
}

export function computeLayout(
  m: ElementMetrics,
  image: { width: number; height: number },
  origin: XY,
  scale: number,
): Layout | null {
  const pos = (n: number) => Number.isFinite(n) && n > 0;
  if (!pos(m.natural.width) || !pos(m.natural.height) || !pos(image.width) || !pos(image.height) || !pos(scale)) return null;
  const content = contentBox(m);
  const visible = intersect(content, contentArea(m));
  if (visible.width <= 0 || visible.height <= 0 || content.width <= 0 || content.height <= 0) return null;
  const kx = content.width / image.width;
  const ky = content.height / image.height;
  const source = {
    x: (visible.x - content.x) / kx,
    y: (visible.y - content.y) / ky,
    width: visible.width / kx,
    height: visible.height / ky,
  };
  if (![content, visible, source].every((b) => Object.values(b).every(Number.isFinite))) return null;
  return { content, visible, source, image, origin, scale };
}

export function zoneBounds(z: Zone): Box {
  if (z.shape === 'rect') return { x: z.x, y: z.y, width: z.width, height: z.height };
  if (z.shape === 'ellipse') return { x: z.cx - z.rx, y: z.cy - z.ry, width: z.rx * 2, height: z.ry * 2 };
  const xs = z.points.map((p) => p[0]);
  const ys = z.points.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function positionOf(b: Box, L: Layout): Position {
  const kx = L.content.width / L.image.width;
  const ky = L.content.height / L.image.height;
  const element = {
    x: L.content.x + b.x * kx,
    y: L.content.y + b.y * ky,
    width: b.width * kx,
    height: b.height * ky,
  };
  return {
    image: { ...b },
    percent: {
      x: (b.x / L.image.width) * 100,
      y: (b.y / L.image.height) * 100,
      width: (b.width / L.image.width) * 100,
      height: (b.height / L.image.height) * 100,
    },
    element,
    viewport: {
      x: L.origin.x + element.x * L.scale,
      y: L.origin.y + element.y * L.scale,
      width: element.width * L.scale,
      height: element.height * L.scale,
    },
  };
}

export function pointFromImage(p: XY, L: Layout): Point {
  const q = positionOf({ x: p.x, y: p.y, width: 0, height: 0 }, L);
  return {
    image: { x: p.x, y: p.y },
    percent: { x: q.percent.x, y: q.percent.y },
    element: { x: q.element.x, y: q.element.y },
    viewport: { x: q.viewport.x, y: q.viewport.y },
  };
}

export function pointFromClient(clientX: number, clientY: number, L: Layout): Point {
  const ex = (clientX - L.origin.x) / L.scale;
  const ey = (clientY - L.origin.y) / L.scale;
  return pointFromImage(
    {
      x: ((ex - L.content.x) * L.image.width) / L.content.width,
      y: ((ey - L.content.y) * L.image.height) / L.content.height,
    },
    L,
  );
}
