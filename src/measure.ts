import type { ElementMetrics, Sides } from './geometry';
import type { XY } from './types';

export type Measured = { metrics: ElementMetrics; origin: XY; scale: number };

const FITS = ['fill', 'contain', 'cover', 'none', 'scale-down'];

function sides(cs: CSSStyleDeclaration, prefix: string, suffix = ''): Sides {
  const v = (s: string) => parseFloat(cs.getPropertyValue(`${prefix}-${s}${suffix}`)) || 0;
  return { top: v('top'), right: v('right'), bottom: v('bottom'), left: v('left') };
}

/** Reads the image's rendered box. Null until it has loaded and is rendered. */
export function measure(img: HTMLImageElement): Measured | null {
  if (!img.naturalWidth || !img.offsetWidth) return null;
  const cs = getComputedStyle(img);
  const fit = cs.objectFit;
  const pos = (cs.objectPosition || '50% 50%').split(/\s+/);
  const rect = img.getBoundingClientRect();
  return {
    metrics: {
      width: img.offsetWidth,
      height: img.offsetHeight,
      border: sides(cs, 'border', '-width'),
      padding: sides(cs, 'padding'),
      natural: { width: img.naturalWidth, height: img.naturalHeight },
      fit: (FITS.indexOf(fit) >= 0 ? fit : 'fill') as ElementMetrics['fit'],
      position: [pos[0] || '50%', pos[1] || '50%'],
    },
    origin: { x: rect.left, y: rect.top },
    scale: rect.width / img.offsetWidth,
  };
}
