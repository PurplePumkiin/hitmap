import { computeLayout, pointFromClient, pointFromImage, positionOf, zoneBounds, type Layout } from './geometry.js';
import { createEmitter } from './emitter.js';
import { measure } from './measure.js';
import { createOverlay } from './overlay.js';
import { parseZones } from './parse.js';
import type { ClickEvent, LayoutEvent, MissEvent, Options, Point, Position, Status, Zone } from './types.js';

export { parseZones } from './parse.js';
export type * from './types.js';

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

// Maps per parent, so the parent's `position` is restored only when the last one goes.
const parents = new WeakMap<Element, { n: number; old: string }>();

export function createZones(img: HTMLImageElement, json: unknown, options: Options = {}): Hitzones {
  const parent = img.parentElement;
  if (!parent) throw new TypeError('hitzones: the img needs a parent element');
  const data = parseZones(json);
  const opts: Required<Options> = { keyboard: false, cursor: 'pointer', className: 'hitzones', debug: false };
  // Only defined keys override a default: `{ className: undefined }` keeps 'hitzones'.
  for (const [k, v] of Object.entries(options ?? {})) if (v !== undefined) (opts as Record<string, unknown>)[k] = v;
  const emitter = createEmitter<HitzonesEvents>();
  const overlay = createOverlay(img, data, opts);
  const zones = new Map(data.zones.map((z) => [z.label, z] as const));
  const status = new Map<string, { status: Status; clicks: number }>();
  const reset = () => data.zones.forEach((z) => status.set(z.label, { status: 'idle', clicks: 0 }));
  reset();

  let shared = parents.get(parent);
  if (shared) shared.n++;
  else if (getComputedStyle(parent).position === 'static') {
    parents.set(parent, (shared = { n: 1, old: parent.style.position }));
    parent.style.position = 'relative';
  }

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

  // Places the SVG from a fresh measurement, synchronously, and returns the layout.
  // Emits `layout` only when the placement changed.
  let last = '';
  const realign = (): Layout | null => {
    const r = measured();
    if (!r) {
      last = '';
      overlay.hide();
      return null;
    }
    const { L, offset } = r;
    const key = [L.visible, L.source, offset].map((b) => Object.values(b).join()).join('|');
    if (key !== last) {
      last = key;
      overlay.apply(L, offset);
      emitter.emit('layout', { zones: data.zones.map((z) => ({ label: z.label, position: zonePosition(z, L) })) });
    }
    return L;
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
  const ro = new ResizeObserver(schedule);
  ro.observe(img, { box: 'border-box' });
  ro.observe(parent);
  const mo = new MutationObserver(schedule);
  mo.observe(img, { attributes: true, attributeFilter: ['style', 'class'] });
  mo.observe(parent, { childList: true });
  document.fonts.addEventListener('loadingdone', schedule);
  const hit = (label: string, L: Layout, point: Point, originalEvent: Event) => {
    const z = zones.get(label)!;
    const s = { status: 'clicked' as const, clicks: status.get(label)!.clicks + 1 };
    status.set(label, s);
    emitter.emit('click', {
      label,
      status: s.clicks === 1 ? 'clicked' : 'reclicked',
      clicks: s.clicks,
      data: z.data,
      position: zonePosition(z, L),
      point,
      originalEvent,
    });
  };
  const zoneOf = (t: EventTarget | null) => {
    const s = t instanceof Element ? t.closest('.hitzone') : null;
    return s && overlay.svg.contains(s) ? s.getAttribute('data-label') : null;
  };

  // Pointer input. Down and up are paired per pointerId; a move over 5 px is a drag.
  // Capture phase on down: re-measures before hit resolution, so a move nothing reported corrects itself.
  const downs = new Map<number, { x: number; y: number }>();
  const onDown = (e: PointerEvent) => {
    realign();
    if (e.isPrimary && e.button === 0) downs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    else downs.delete(e.pointerId);
  };
  const onCancel = (e: PointerEvent) => {
    downs.delete(e.pointerId);
  };
  const onUp = (e: PointerEvent) => {
    const d = downs.get(e.pointerId);
    if (!d) return;
    downs.delete(e.pointerId);
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;
    const L = realign();
    if (!L) return;
    // The pointerup target can be stale (realign may have moved the SVG, touch has implicit capture),
    // so resolve what is under the point now.
    const el = (img.getRootNode() as Document | ShadowRoot).elementFromPoint(e.clientX, e.clientY);
    const point = pointFromClient(e.clientX, e.clientY, L);
    const label = zoneOf(el);
    if (label) return hit(label, L, point, e);
    if (el !== img) return;
    // On the img but outside the visible content (letterbox bar, padding, border): nothing.
    const { x, y } = point.element;
    const v = L.visible;
    if (x >= v.x && x <= v.x + v.width && y >= v.y && y <= v.y + v.height) emitter.emit('miss', { point, originalEvent: e });
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const label = zoneOf(e.target);
    const L = label && !e.repeat ? realign() : null;
    if (!label || !L) return;
    if (e.key === ' ') e.preventDefault(); // no page scroll
    const b = zoneBounds(zones.get(label)!);
    hit(label, L, pointFromImage({ x: b.x + b.width / 2, y: b.y + b.height / 2 }, L), e);
  };
  const pointer: [string, (e: any) => void, boolean][] = [
    ['pointerdown', onDown, true],
    ['pointerup', onUp, false],
    ['pointercancel', onCancel, false],
  ];
  for (const t of [img, overlay.svg]) for (const [type, fn, capture] of pointer) t.addEventListener(type, fn, capture);
  if (opts.keyboard) overlay.svg.addEventListener('keydown', onKey);
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
      ro.disconnect();
      mo.disconnect();
      document.fonts.removeEventListener('loadingdone', schedule);
      for (const t of [img, overlay.svg]) for (const [type, fn, capture] of pointer) t.removeEventListener(type, fn, capture);
      overlay.svg.removeEventListener('keydown', onKey);
      downs.clear();
      img.removeEventListener('load', onLoad);
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
      overlay.remove();
      if (shared && !--shared.n) {
        parent.style.position = shared.old;
        parents.delete(parent);
      }
      emitter.clear();
    },
  };
}
