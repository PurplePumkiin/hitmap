import { computeLayout, positionOf, zoneBounds, type Layout } from './geometry';
import { createEmitter } from './emitter';
import { measure } from './measure';
import { createOverlay } from './overlay';
import { parseZones } from './parse';
import type { ClickEvent, LayoutEvent, MissEvent, Options, Position, Status, Zone } from './types';

export { parseZones } from './parse';
export type * from './types';

export type HitzonesEvents = { click: ClickEvent; miss: MissEvent; layout: LayoutEvent };
export type ZoneState = { label: string; status: Status; clicks: number };
export type ZoneInfo = ZoneState & { data: unknown; position: Position | null };
export type Hitzones = {
  on<K extends keyof HitzonesEvents>(type: K, fn: (e: HitzonesEvents[K]) => void): () => void;
  state(): ZoneState[];
  zone(label: string): ZoneInfo | null;
  reset(): void;
  destroy(): void;
};

function zonePosition(z: Zone, L: Layout): Position {
  const p = positionOf(zoneBounds(z), L);
  if (z.shape !== 'rect') p.shape = z;
  return p;
}

export function createZones(img: HTMLImageElement, json: unknown, options: Options = {}): Hitzones {
  const data = parseZones(json);
  const opts: Required<Options> = { keyboard: false, cursor: 'pointer', className: 'hitzones', debug: false, ...options };
  const emitter = createEmitter<HitzonesEvents>();
  const overlay = createOverlay(img, data, opts);
  const zones = new Map(data.zones.map((z) => [z.label, z] as const));
  // Status map: Task 4's click handling updates it.
  const status = new Map<string, { status: Status; clicks: number }>();
  const reset = () => data.zones.forEach((z) => status.set(z.label, { status: 'idle', clicks: 0 }));
  reset();

  const parent = img.parentElement;
  const oldPosition = parent && getComputedStyle(parent).position === 'static' ? parent.style.position : null;
  if (parent && oldPosition !== null) parent.style.position = 'relative';

  const current = (): Layout | null => {
    const m = measure(img);
    return m && computeLayout(m.metrics, data.image, m.origin, m.scale);
  };

  const warned = new Set<string>();
  const checkAspect = () => {
    const src = img.currentSrc || img.src;
    if (!img.naturalWidth || !img.naturalHeight || warned.has(src)) return;
    const want = data.image.width / data.image.height;
    if (Math.abs(img.naturalWidth / img.naturalHeight - want) / want > 0.01) {
      warned.add(src);
      console.warn(
        `hitzones: image ${img.naturalWidth}×${img.naturalHeight} doesn't match the zones' ${data.image.width}×${data.image.height} aspect ratio (${src})`,
      );
    }
  };

  const layout = () => {
    frame = 0;
    const L = current();
    if (!L) return overlay.hide();
    overlay.apply(L);
    emitter.emit('layout', { zones: data.zones.map((z) => ({ label: z.label, position: zonePosition(z, L) })) });
  };
  let frame = 0;
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(layout);
  };
  const onLoad = () => {
    checkAspect();
    schedule();
  };

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
  ro?.observe(img);
  img.addEventListener('load', onLoad);
  window.addEventListener('resize', schedule);
  if (img.complete && img.naturalWidth) onLoad();

  let destroyed = false;
  return {
    on: (type, fn) => emitter.on(type, fn),
    state: () => data.zones.map((z) => ({ label: z.label, ...status.get(z.label)! })),
    zone(label) {
      const z = zones.get(label);
      if (!z) return null;
      const L = current();
      return { label, ...status.get(label)!, data: z.data, position: L && zonePosition(z, L) };
    },
    reset,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      ro?.disconnect();
      img.removeEventListener('load', onLoad);
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
      overlay.remove();
      if (parent && oldPosition !== null) parent.style.position = oldPosition;
      emitter.clear();
    },
  };
}
