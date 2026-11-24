import type { Layout } from './geometry';
import type { Options, XY, ZonesJSON } from './types';

const NS = 'http://www.w3.org/2000/svg';

export type Overlay = {
  svg: SVGSVGElement;
  shapes: Map<string, SVGElement>;
  /** Places the SVG; `offset` is the img's border-box corner in the containing block. */
  apply(L: Layout, offset: XY): void;
  hide(): void;
  remove(): void;
};

export function createOverlay(img: HTMLImageElement, json: ZonesJSON, opts: Required<Options>): Overlay {
  const el = <T extends SVGElement>(tag: string, attrs: Record<string, string | number>) => {
    const e = document.createElementNS(NS, tag) as T;
    for (const k in attrs) e.setAttribute(k, String(attrs[k]));
    return e;
  };
  const svg = el<SVGSVGElement>('svg', {
    class: opts.className,
    preserveAspectRatio: 'none',
    // Focusable buttons must not sit inside an aria-hidden subtree.
    ...(opts.keyboard ? {} : { 'aria-hidden': 'true' }),
    style: 'position:absolute;pointer-events:none;overflow:hidden;margin:0;max-width:none;display:none',
  });
  const shapes = new Map<string, SVGElement>();
  const stroke = opts.debug ? 'stroke:magenta;stroke-width:2;vector-effect:non-scaling-stroke;' : '';
  for (const z of json.zones) {
    const attrs: Record<string, string | number> =
      z.shape === 'rect' ? { x: z.x, y: z.y, width: z.width, height: z.height }
      : z.shape === 'ellipse' ? { cx: z.cx, cy: z.cy, rx: z.rx, ry: z.ry }
      : { points: z.points.map((p) => p.join(',')).join(' ') };
    const s = el<SVGElement>(z.shape, {
      ...attrs,
      class: 'hitzone',
      'data-label': z.label,
      style: `fill:transparent;pointer-events:all;cursor:${opts.cursor};${stroke}`,
    });
    if (opts.keyboard) {
      const aria = (z.data as { ariaLabel?: unknown } | null | undefined)?.ariaLabel;
      s.setAttribute('tabindex', '0');
      s.setAttribute('role', 'button');
      s.setAttribute('aria-label', typeof aria === 'string' && aria ? aria : z.label);
    }
    shapes.set(z.label, s);
    svg.appendChild(s);
  }
  img.after(svg);

  return {
    svg,
    shapes,
    apply(L, offset) {
      const { style } = svg;
      style.left = `${offset.x + L.visible.x}px`;
      style.top = `${offset.y + L.visible.y}px`;
      style.width = `${L.visible.width}px`;
      style.height = `${L.visible.height}px`;
      style.display = '';
      const s = L.source;
      const r = (n: number) => Math.round(n * 1e4) / 1e4;
      svg.setAttribute('viewBox', `${r(s.x)} ${r(s.y)} ${r(s.width)} ${r(s.height)}`);
    },
    hide() {
      svg.style.display = 'none';
    },
    remove() {
      svg.remove();
    },
  };
}
