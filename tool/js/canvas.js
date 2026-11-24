// Editor canvas: an SVG stage that draws the image and zones in image pixels inside a
// zoom/pan <g transform>. It owns only view and gesture state; zone changes go out
// through the handlers and come back in through render().

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};
const isTyping = (t) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
const boxOf = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) });
const MIN = 2; // smallest shape, in image pixels

/** Geometry of a zone as a box (rect and ellipse only). */
function zoneBox(z) {
  if (z.shape === 'rect') return { x: z.x, y: z.y, width: z.width, height: z.height };
  return { x: z.cx - z.rx, y: z.cy - z.ry, width: z.rx * 2, height: z.ry * 2 };
}
function boxPatch(shape, b) {
  if (shape === 'rect') return { x: b.x, y: b.y, width: b.width, height: b.height };
  return { cx: b.x + b.width / 2, cy: b.y + b.height / 2, rx: b.width / 2, ry: b.height / 2 };
}
function shapeEl(z) {
  if (z.shape === 'rect') return el('rect', { x: z.x, y: z.y, width: z.width, height: z.height });
  if (z.shape === 'ellipse') return el('ellipse', { cx: z.cx, cy: z.cy, rx: z.rx, ry: z.ry });
  if (z.shape === 'polygon' && Array.isArray(z.points)) return el('polygon', { points: z.points.map((p) => p.join(',')).join(' ') });
  return null;
}

/**
 * @param {SVGSVGElement} svg
 * @param {{onAdd(zone:object):void, onUpdate(label:string, patch:object):void,
 *          onSelect(label:string|null):void, onRemove(label:string):void}} on
 */
export function createCanvas(svg, on) {
  const view = svg.querySelector('#view');
  const v = { s: 1, tx: 0, ty: 0 };
  let doc = null;
  let selected = null;
  let vertex = -1; // selected polygon vertex
  let tool = 'select';
  let pic = null; // {url, width, height} at the image's natural size
  let fitKey = '';
  let fitted = false;
  let drag = null; // current gesture
  let draft = null; // polygon in progress: {points}
  let space = false;
  const touches = new Map();
  let pinch = null;
  let lastDown = { t: 0, x: 0, y: 0 };

  const local = (e) => {
    const r = svg.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const toImage = (e) => {
    const p = local(e);
    return { x: (p.x - v.tx) / v.s, y: (p.y - v.ty) / v.s };
  };
  const zoneOf = (label) => (doc ? doc.zones.find((z) => z.label === label) : null);
  const applyView = () => view.setAttribute('transform', `translate(${v.tx} ${v.ty}) scale(${v.s})`);

  function fit() {
    if (!doc) return;
    const r = svg.getBoundingClientRect();
    const { width: w, height: h } = pic || doc.image;
    if (!r.width || !r.height || !w || !h) return draw();
    fitted = true;
    v.s = Math.min(r.width / w, r.height / h) * 0.95;
    v.tx = (r.width - w * v.s) / 2;
    v.ty = (r.height - h * v.s) / 2;
    draw();
  }
  function zoomAt(p, factor) {
    const s = Math.min(40, Math.max(0.05, v.s * factor));
    v.tx = p.x - ((p.x - v.tx) * s) / v.s;
    v.ty = p.y - ((p.y - v.ty) * s) / v.s;
    v.s = s;
    draw();
  }

  function draw() {
    applyView();
    view.replaceChildren();
    svg.classList.toggle('draw', tool !== 'select');
    svg.classList.toggle('pan-ready', space);
    if (!doc) return;
    if (pic) view.append(el('image', { href: pic.url, width: pic.width, height: pic.height, preserveAspectRatio: 'none' }));
    const r = 6 / v.s;
    for (const z of doc.zones) {
      const n = shapeEl(z);
      if (!n) continue;
      n.setAttribute('class', 'zone' + (z.label === selected ? ' selected' : ''));
      n.dataset.label = z.label;
      view.append(n);
    }
    const z = zoneOf(selected);
    if (z && tool === 'select') {
      if (z.shape === 'polygon' && Array.isArray(z.points)) {
        z.points.forEach((p, i) => {
          const q = z.points[(i + 1) % z.points.length];
          const edge = el('line', { x1: p[0], y1: p[1], x2: q[0], y2: q[1], class: 'edge' });
          edge.dataset.edge = String(i);
          view.append(edge);
        });
        z.points.forEach((p, i) => {
          const h = el('circle', { cx: p[0], cy: p[1], r, class: 'handle' + (i === vertex ? ' active' : '') });
          h.dataset.vertex = String(i);
          view.append(h);
        });
      } else if (z.shape === 'rect' || z.shape === 'ellipse') {
        const b = zoneBox(z);
        [[b.x, b.y], [b.x + b.width, b.y], [b.x + b.width, b.y + b.height], [b.x, b.y + b.height]].forEach(([x, y], i) => {
          const h = el('rect', { x: x - r, y: y - r, width: r * 2, height: r * 2, class: 'handle' });
          h.dataset.corner = String(i);
          view.append(h);
        });
      }
    }
    if (drag && drag.kind === 'draw') {
      const b = boxOf(drag.start, drag.cur);
      const n = drag.shape === 'rect' ? el('rect', b) : el('ellipse', { cx: b.x + b.width / 2, cy: b.y + b.height / 2, rx: b.width / 2, ry: b.height / 2 });
      n.setAttribute('class', 'draft');
      view.append(n);
    }
    if (draft) {
      const pts = draft.hover ? [...draft.points, draft.hover] : draft.points;
      view.append(el('polyline', { points: pts.map((p) => p.join(',')).join(' '), class: 'draft' }));
      const [x, y] = draft.points[0];
      view.append(el('circle', { cx: x, cy: y, r, class: 'handle active' }));
    }
  }

  function closeDraft() {
    if (draft && draft.points.length >= 3) on.onAdd({ shape: 'polygon', points: draft.points });
    draft = null;
    draw();
  }

  function startPan(e) {
    drag = { kind: 'pan', from: local(e), tx: v.tx, ty: v.ty };
    svg.classList.add('panning');
  }

  function down(e) {
    svg.focus({ preventScroll: true });
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, local(e));
      if (touches.size === 2) {
        const [a, b] = [...touches.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, ...v };
        drag = null;
        draw();
        return;
      }
    }
    if (!doc) return;
    svg.setPointerCapture(e.pointerId);
    if (e.button === 1 || (e.button === 0 && space)) {
      e.preventDefault();
      return startPan(e);
    }
    if (e.button !== 0) return;
    const p = toImage(e);
    if (tool === 'rect' || tool === 'ellipse') {
      drag = { kind: 'draw', shape: tool, start: p, cur: p };
      return;
    }
    if (tool === 'polygon') {
      const pt = [p.x, p.y];
      if (draft && draft.points.length >= 3) {
        const [x0, y0] = draft.points[0];
        if (Math.hypot(pt[0] - x0, pt[1] - y0) <= 8 / v.s) return closeDraft();
      }
      draft = draft ? { points: [...draft.points, pt] } : { points: [pt] };
      return draw();
    }
    // Double-click is detected here: every redraw replaces the shapes, so the browser's own
    // click/dblclick never fire after a pointerdown on a shape.
    const c = local(e);
    const again = e.timeStamp - lastDown.t < 400 && Math.hypot(c.x - lastDown.x, c.y - lastDown.y) < 5;
    lastDown = again ? { t: 0, x: 0, y: 0 } : { t: e.timeStamp, ...c };
    if (again && insertVertex(p)) return;
    const t = e.target;
    const z = zoneOf(selected);
    if (t.dataset.corner && z) {
      const b = zoneBox(z);
      const c = Number(t.dataset.corner);
      const fixed = { x: c === 1 || c === 2 ? b.x : b.x + b.width, y: c >= 2 ? b.y : b.y + b.height };
      drag = { kind: 'resize', label: z.label, shape: z.shape, fixed };
      return;
    }
    if (t.dataset.vertex && z) {
      const i = Number(t.dataset.vertex);
      if (e.altKey) return removeVertex(z, i);
      vertex = i;
      drag = { kind: 'vertex', label: z.label, index: i, start: p, orig: z.points };
      return draw();
    }
    const label = t.dataset.label || (t.dataset.edge && z ? z.label : null);
    if (label) {
      if (label !== selected) {
        vertex = -1;
        on.onSelect(label);
      }
      drag = { kind: 'move', label, start: p, orig: zoneOf(label), moved: false };
      return;
    }
    vertex = -1;
    on.onSelect(null);
  }

  function move(e) {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, local(e));
    if (pinch && touches.size >= 2) {
      const [a, b] = [...touches.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const s = Math.min(40, Math.max(0.05, (pinch.s * d) / pinch.d));
      v.tx = mid.x - ((pinch.mid.x - pinch.tx) * s) / pinch.s;
      v.ty = mid.y - ((pinch.mid.y - pinch.ty) * s) / pinch.s;
      v.s = s;
      return draw();
    }
    if (draft && tool === 'polygon') {
      const p = toImage(e);
      draft.hover = [p.x, p.y];
      return draw();
    }
    if (!drag) return;
    if (drag.kind === 'pan') {
      const p = local(e);
      v.tx = drag.tx + p.x - drag.from.x;
      v.ty = drag.ty + p.y - drag.from.y;
      return draw();
    }
    const p = toImage(e);
    if (drag.kind === 'draw') {
      drag.cur = p;
      return draw();
    }
    if (drag.kind === 'resize') {
      const b = boxOf(drag.fixed, p);
      if (b.width >= MIN && b.height >= MIN) on.onUpdate(drag.label, boxPatch(drag.shape, b));
      return;
    }
    const dx = p.x - drag.start.x;
    const dy = p.y - drag.start.y;
    if (drag.kind === 'vertex') {
      const points = drag.orig.map((q, i) => (i === drag.index ? [q[0] + dx, q[1] + dy] : q));
      return on.onUpdate(drag.label, { points });
    }
    if (drag.kind === 'move') {
      if (!drag.moved && Math.hypot(dx, dy) * v.s < 3) return;
      drag.moved = true;
      const o = drag.orig;
      if (o.shape === 'rect') on.onUpdate(drag.label, { x: o.x + dx, y: o.y + dy });
      else if (o.shape === 'ellipse') on.onUpdate(drag.label, { cx: o.cx + dx, cy: o.cy + dy });
      else if (o.shape === 'polygon') on.onUpdate(drag.label, { points: o.points.map(([x, y]) => [x + dx, y + dy]) });
    }
  }

  function up(e) {
    touches.delete(e.pointerId);
    if (pinch) {
      if (touches.size < 2) pinch = null;
      return;
    }
    const d = drag;
    drag = null;
    svg.classList.remove('panning');
    if (d && d.kind === 'draw' && e.type === 'pointerup') {
      const b = boxOf(d.start, d.cur);
      if (b.width >= MIN && b.height >= MIN) return on.onAdd({ shape: d.shape, ...boxPatch(d.shape, b) });
    }
    draw();
  }

  function removeVertex(z, i) {
    if (z.points.length <= 3) return;
    vertex = -1;
    on.onUpdate(z.label, { points: z.points.filter((_, j) => j !== i) });
  }

  /** Adds a vertex on the selected polygon's edge nearest to image point `p`, if close. */
  function insertVertex(p) {
    const z = zoneOf(selected);
    if (!z || z.shape !== 'polygon' || !Array.isArray(z.points)) return false;
    let i = -1;
    let best = 8 / v.s;
    z.points.forEach(([x1, y1], j) => {
      const [x2, y2] = z.points[(j + 1) % z.points.length];
      const len2 = (x2 - x1) ** 2 + (y2 - y1) ** 2 || 1;
      const t = Math.max(0, Math.min(1, ((p.x - x1) * (x2 - x1) + (p.y - y1) * (y2 - y1)) / len2));
      const d = Math.hypot(p.x - (x1 + t * (x2 - x1)), p.y - (y1 + t * (y2 - y1)));
      if (d <= best) [best, i] = [d, j];
    });
    if (i < 0) return false;
    const points = z.points.slice();
    points.splice(i + 1, 0, [p.x, p.y]);
    vertex = i + 1;
    on.onUpdate(z.label, { points });
    return true;
  }

  function key(e) {
    if (isTyping(e.target)) return;
    // Space, Enter and Delete keep their usual meaning on buttons and other controls.
    const free = e.target === svg || e.target === document.body || e.target === document.documentElement;
    if (e.type === 'keyup') {
      if (e.key === ' ') { space = false; draw(); }
      return;
    }
    if (!free && e.key !== 'Escape') return;
    if (e.key === ' ') {
      if (!space) { space = true; draw(); }
      e.preventDefault();
    } else if (e.key === 'Enter' && draft) {
      e.preventDefault();
      closeDraft();
    } else if (e.key === 'Escape') {
      draft = null;
      drag = null;
      vertex = -1;
      draw();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
      e.preventDefault();
      const z = zoneOf(selected);
      if (z && z.shape === 'polygon' && vertex >= 0) removeVertex(z, vertex);
      else on.onRemove(selected);
    }
  }

  svg.addEventListener('pointerdown', down);
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerup', up);
  svg.addEventListener('pointercancel', up);
  svg.addEventListener('wheel', (e) => {
    if (!doc) return;
    e.preventDefault();
    zoomAt(local(e), Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
  }, { passive: false });
  svg.addEventListener('auxclick', (e) => e.button === 1 && e.preventDefault());
  window.addEventListener('keydown', key);
  window.addEventListener('keyup', key);
  window.addEventListener('blur', () => { space = false; });
  new ResizeObserver(() => !drag && (fitted ? draw() : fit())).observe(svg);

  return {
    /**
     * Redraws from the given doc. `image` is {url, width, height} or null. Refits when the
     * image or the doc's image size changes.
     */
    render(nextDoc, image, sel) {
      if (sel !== selected) vertex = -1;
      doc = nextDoc;
      pic = image;
      selected = sel;
      const key = doc ? `${pic ? pic.url : ''}|${doc.image.width}x${doc.image.height}` : '';
      if (key !== fitKey) {
        fitKey = key;
        fitted = false;
        return fit();
      }
      draw();
    },
    setTool(t) {
      tool = t;
      draft = null;
      draw();
    },
    fit,
  };
}
