import { splitPosition, type ElementMetrics, type Sides } from './geometry.js';
import type { XY } from './types.js';

/** `offset`: the img's border-box corner in its containing block's padding-box coordinates (CSS px, untransformed). */
export type Measured = { metrics: ElementMetrics; origin: XY; scale: number; offset: XY };

const FITS = ['fill', 'contain', 'cover', 'none', 'scale-down'];

function sides(cs: CSSStyleDeclaration, prefix: string, suffix = ''): Sides {
  const v = (s: string) => parseFloat(cs.getPropertyValue(`${prefix}-${s}${suffix}`)) || 0;
  return { top: v('top'), right: v('right'), bottom: v('bottom'), left: v('left') };
}

/**
 * Reads the image's rendered box. Null until it has loaded and is rendered.
 * Sizes come from computed styles (sub-pixel exact), not the rounded offsetWidth/Height.
 */
export function measure(img: HTMLImageElement, cb: Element | null = img.parentElement): Measured | null {
  if (!img.naturalWidth || !img.offsetWidth) return null;
  const cs = getComputedStyle(img);
  const fit = cs.objectFit;
  const border = sides(cs, 'border', '-width');
  const padding = sides(cs, 'padding');
  const extra = cs.boxSizing === 'border-box' ? [0, 0] : [
    border.left + border.right + padding.left + padding.right,
    border.top + border.bottom + padding.top + padding.bottom,
  ];
  const width = (parseFloat(cs.width) || img.offsetWidth - extra[0]) + extra[0];
  const height = (parseFloat(cs.height) || img.offsetHeight - extra[1]) + extra[1];
  const rect = img.getBoundingClientRect();
  const scale = rect.width / width;
  const c = cb ? cb.getBoundingClientRect() : { left: 0, top: 0 };
  return {
    offset: {
      x: (rect.left - c.left) / scale - (cb ? cb.clientLeft - cb.scrollLeft : 0),
      y: (rect.top - c.top) / scale - (cb ? cb.clientTop - cb.scrollTop : 0),
    },
    metrics: {
      width,
      height,
      border,
      padding,
      natural: { width: img.naturalWidth, height: img.naturalHeight },
      fit: (FITS.indexOf(fit) >= 0 ? fit : 'fill') as ElementMetrics['fit'],
      position: splitPosition(cs.objectPosition || ''),
    },
    origin: { x: rect.left, y: rect.top },
    scale,
  };
}
