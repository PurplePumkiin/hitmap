// Editor model: pure functions over a zones document. No imports, no Node APIs.
// Every operation returns a new doc and never mutates its input.

/** @typedef {{label:string, shape:string, data?:unknown, [k:string]:unknown}} Zone */
/** @typedef {{hitzones:1, image:{width:number,height:number,src?:string}, zones:Zone[], [k:string]:unknown}} Doc */

const GEOMETRY = {
  rect: ['x', 'y', 'width', 'height'],
  ellipse: ['cx', 'cy', 'rx', 'ry'],
  polygon: ['points'],
};

const clone = (v) => JSON.parse(JSON.stringify(v));
const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/** @param {{width:number,height:number,src?:string}} image @returns {Doc} */
export function createDoc(image) {
  return { hitzones: 1, image: { ...image }, zones: [] };
}

/** Adds a zone on top. A missing label gets the next free `zone-N`. */
export function addZone(doc, zone) {
  const used = new Set(doc.zones.map((z) => z.label));
  let label = zone.label;
  if (label && used.has(label)) throw new Error(`label "${label}" is already used`);
  if (!label) {
    let n = 1;
    while (used.has('zone-' + n)) n++;
    label = 'zone-' + n;
  }
  return { ...doc, zones: [...doc.zones, { ...clone(zone), label }] };
}

export function updateZone(doc, label, patch) {
  if (patch && 'label' in patch) throw new TypeError('updateZone cannot change the label; use renameZone');
  return { ...doc, zones: doc.zones.map((z) => (z.label === label ? { ...z, ...clone(patch) } : z)) };
}

export function removeZone(doc, label) {
  return { ...doc, zones: doc.zones.filter((z) => z.label !== label) };
}

export function moveZone(doc, label, toIndex) {
  const from = doc.zones.findIndex((z) => z.label === label);
  if (from < 0) return doc;
  const zones = doc.zones.slice();
  const [z] = zones.splice(from, 1);
  zones.splice(Math.max(0, Math.min(zones.length, toIndex)), 0, z);
  return { ...doc, zones };
}

export function renameZone(doc, from, to) {
  if (!doc.zones.some((z) => z.label === from)) throw new Error(`unknown label "${from}"`);
  if (!to) throw new Error('label must not be empty');
  if (to !== from && doc.zones.some((z) => z.label === to)) throw new Error(`label "${to}" is already used`);
  return { ...doc, zones: doc.zones.map((z) => (z.label === from ? { ...z, label: to } : z)) };
}

/** Scales geometry (not data) to a new image size and sets `image`. */
export function rescale(doc, width, height) {
  const fx = width / doc.image.width;
  const fy = height / doc.image.height;
  const zones = doc.zones.map((z) => {
    const o = { ...z };
    if (z.shape === 'rect') {
      o.x = z.x * fx; o.width = z.width * fx;
      o.y = z.y * fy; o.height = z.height * fy;
    } else if (z.shape === 'ellipse') {
      o.cx = z.cx * fx; o.rx = z.rx * fx;
      o.cy = z.cy * fy; o.ry = z.ry * fy;
    } else if (z.shape === 'polygon') {
      o.points = z.points.map(([x, y]) => [x * fx, y * fy]);
    }
    return o;
  });
  return { ...doc, image: { ...doc.image, width, height }, zones };
}

/**
 * Returns error messages; [] means valid.
 * @param {Doc} doc @param {(input:unknown)=>unknown} parse
 * @returns {string[]}
 */
export function validate(doc, parse) {
  const errors = [];
  const seen = new Set();
  const dups = new Set();
  const zones = Array.isArray(doc && doc.zones) ? doc.zones : [];
  zones.forEach((z, i) => {
    const label = z && z.label;
    if (typeof label !== 'string' || !label) errors.push(`zones[${i}] has an empty label`);
    else if (seen.has(label)) {
      if (!dups.has(label)) errors.push(`duplicate label "${label}"`);
      dups.add(label);
    } else seen.add(label);
  });
  try {
    parse(doc);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    // Depends on parseZones wording in src/parse.ts: 'zones[i] needs a non-empty label'
    // and 'duplicate label "x" (zones[i])'. The validate test with the real parseZones
    // fails if either message changes.
    const labelIssue = /non-empty label|duplicate label/.test(msg);
    if (!(labelIssue && errors.length)) errors.push(msg);
  }
  return errors;
}

function orderedZone(z) {
  const o = { label: z.label, shape: z.shape };
  const keys = GEOMETRY[z.shape] || [];
  for (const k of keys) {
    if (!(k in z)) continue;
    const v = z[k];
    o[k] = k === 'points' ? v.map(([x, y]) => [round(x), round(y)]) : round(v);
  }
  if ('data' in z) o.data = z.data;
  const known = new Set(['label', 'shape', 'data', ...keys]);
  for (const k of Object.keys(z)) if (!known.has(k)) o[k] = z[k];
  return o;
}

/** Canonical JSON: 2-space indent, stable key order, trailing newline. */
export function serialize(doc) {
  const out = { hitzones: doc.hitzones };
  const img = doc.image;
  const image = {};
  for (const k of ['width', 'height', 'src']) if (k in img) image[k] = img[k];
  for (const k of Object.keys(img)) if (!(k in image)) image[k] = img[k];
  out.image = image;
  out.zones = doc.zones.map(orderedZone);
  for (const k of Object.keys(doc)) if (!(k in out)) out[k] = doc[k];
  return JSON.stringify(out, null, 2) + '\n';
}
