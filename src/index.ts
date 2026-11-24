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

  const measured = () => {
    const m = measure(img, parent);
    const L = m && computeLayout(m.metrics, data.image, m.origin, m.scale);
    return L && { L, offset: m.offset };
  };
  const current = (): Layout | null => measured()?.L ?? null;

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

  // Places the SVG from a fresh measurement. Emits `layout` only when the placement changed.
  let last = '';
  const realign = () => {
    const r = measured();
    if (!r) {
      last = '';
      return overlay.hide();
    }
    const { L, offset } = r;
    const key = [L.visible, L.source, offset].map((b) => Object.values(b).join()).join('|');
    if (key === last) return;
    last = key;
    overlay.apply(L, offset);
    emitter.emit('layout', { zones: data.zones.map((z) => ({ label: z.label, position: zonePosition(z, L) })) });
  };
  const layout = () => {
    frame = 0;
    realign();
  };
  let frame = 0;
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(layout);
  };
  const onLoad = () => {
    checkAspect();
    schedule();
  };

  // Size changes (img border box, parent), moves within the parent (siblings, img style), font reflow.
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
  ro?.observe(img, { box: 'border-box' });
  if (parent) ro?.observe(parent);
  const mo = typeof MutationObserver === 'function' ? new MutationObserver(schedule) : null;
  mo?.observe(img, { attributes: true, attributeFilter: ['style', 'class'] });
  if (parent) mo?.observe(parent, { childList: true });
  const fonts = (document as Document & { fonts?: EventTarget }).fonts;
  fonts?.addEventListener?.('loadingdone', schedule);
  // Cheap re-check before any interaction, so a move nothing reported corrects itself.
  // Capture phase: runs before Task 4's hit resolution.
  const onDown = () => realign();
  img.addEventListener('pointerdown', onDown, true);
  overlay.svg.addEventListener('pointerdown', onDown, true);
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
      mo?.disconnect();
      fonts?.removeEventListener?.('loadingdone', schedule);
      img.removeEventListener('pointerdown', onDown, true);
      overlay.svg.removeEventListener('pointerdown', onDown, true);
      img.removeEventListener('load', onLoad);
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
      overlay.remove();
      if (parent && oldPosition !== null) parent.style.position = oldPosition;
      emitter.clear();
    },
  };
}
