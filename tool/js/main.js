// Editor entry point. Owns the doc; every change goes through a model call and then render().
import { parseZones } from '/dist/hitzones.js';
import { addZone, createDoc, moveZone, removeZone, renameZoneAt, rescale, serialize, updateZone, validate } from './model.js';
import { createCanvas } from './canvas.js';
import { createPanel } from './panel.js';
import { createPreview } from './preview.js';

const $ = (s) => document.querySelector(s);
const token = new URLSearchParams(location.search).get('t') || '';
const statusEl = $('#status');
const bar = $('#rescale-bar');

let doc = null;
let selected = null;
/** @type {{url:string, name:string, width:number, height:number, revoke:boolean}|null} */
let image = null;
let session = { imageName: '', hasImage: false, json: null, jsonName: null };

const status = (msg, kind = '') => {
  statusEl.textContent = msg;
  statusEl.className = kind;
};
const errText = (e) => (e && e.message ? e.message : String(e));
const baseName = (name) => String(name || '').split(/[\\/]/).pop();

function render() {
  canvas.render(doc, image, selected);
  panel.render(doc, selected);
  $('#empty').hidden = Boolean(doc);
}

/**
 * Applies a model call; returns an error message instead of throwing. `nextSelected` is a
 * label, or a function of the new doc that returns one.
 */
function apply(fn, nextSelected = selected) {
  let next;
  try {
    next = fn(doc);
  } catch (e) {
    return errText(e);
  }
  doc = next;
  selected = typeof nextSelected === 'function' ? nextSelected(next) : nextSelected;
  render();
  return null;
}
/** Shows an apply() error, if any, in the status line. */
const report = (err) => err && status(err, 'error');
const isUnique = (i) => doc.zones.filter((z) => z.label === doc.zones[i].label).length === 1;
// Label-keyed model ops would hit every namesake, so a duplicated label is read-only on the
// canvas (and can't be selected or reordered) until it is renamed in the panel.
const isDuplicate = (label) => doc.zones.filter((z) => z.label === label).length > 1;
const refuse = (label) => status(`Rename duplicate label "${label}" to edit it`, 'error');
// Index-based edits, for zones whose label is not unique (only possible in a loaded file).
const patchAt = (i, fn) => (d) => ({ ...d, zones: d.zones.map((z, j) => (j === i ? fn(z) : z)) });

const canvas = createCanvas($('#canvas'), {
  onAdd: (zone) => report(apply((d) => addZone(d, zone), (d) => d.zones[d.zones.length - 1].label)),
  onUpdate(label, patch) {
    if (isDuplicate(label)) return refuse(label);
    report(apply((d) => updateZone(d, label, patch)));
  },
  onSelect(label) {
    if (label !== null && isDuplicate(label)) {
      refuse(label);
      label = null;
    }
    apply((d) => d, label);
  },
  onRemove(label) {
    if (isDuplicate(label)) return refuse(label);
    report(apply((d) => removeZone(d, label), null));
  },
});

const panel = createPanel($('#zones'), {
  onRename(i, to) {
    const from = doc.zones[i].label;
    return apply((d) => renameZoneAt(d, i, to), selected === from && !isDuplicate(from) ? to : selected);
  },
  onData(i, text) {
    if (!text.trim()) {
      return apply(patchAt(i, (z) => {
        const { data: _data, ...rest } = z;
        return rest;
      }));
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return 'data is not valid JSON: ' + errText(e);
    }
    if (isUnique(i)) return apply((d) => updateZone(d, d.zones[i].label, { data }));
    return apply(patchAt(i, (z) => ({ ...z, data })));
  },
  onMove(i, delta) {
    const label = doc.zones[i].label;
    if (isDuplicate(label)) return refuse(label);
    report(apply((d) => moveZone(d, label, i + delta)));
  },
  onRemove(i) {
    const label = doc.zones[i].label;
    const next = selected === label ? null : selected;
    if (isUnique(i)) return apply((d) => removeZone(d, label), next);
    apply((d) => ({ ...d, zones: d.zones.filter((_, j) => j !== i) }), next);
  },
  // Focusing a duplicate's row (to rename it) leaves the selection alone.
  onSelect: (label) => label !== selected && !isDuplicate(label) && apply((d) => d, label),
});

const preview = createPreview($('#preview'));

function offerRescale() {
  const off = image && doc && (doc.image.width !== image.width || doc.image.height !== image.height);
  bar.hidden = !off;
  if (off) {
    bar.querySelector('.msg').textContent =
      `The zones were drawn for a ${doc.image.width}×${doc.image.height} image, but this image is ${image.width}×${image.height}.`;
  }
}
bar.addEventListener('click', (e) => {
  const action = e.target instanceof HTMLElement && e.target.dataset.action;
  if (action === 'rescale') {
    const err = apply((d) => rescale(d, image.width, image.height));
    if (err) return status('Could not rescale: ' + err, 'error');
  }
  if (action === 'rescale' || action === 'keep') bar.hidden = true;
});

function loadImage(url, name, revoke) {
  return new Promise((resolve) => {
    const probe = new Image();
    probe.onload = () => {
      if (image && image.revoke) URL.revokeObjectURL(image.url);
      image = { url, name: baseName(name), width: probe.naturalWidth, height: probe.naturalHeight, revoke };
      if (!doc) doc = createDoc({ width: image.width, height: image.height, src: image.name });
      else if (session.json == null) doc = { ...doc, image: { ...doc.image, src: image.name } };
      offerRescale();
      render();
      resolve(true);
    };
    probe.onerror = () => {
      if (revoke) URL.revokeObjectURL(url);
      status(`Could not open ${baseName(name) || 'the image'}`, 'error');
      resolve(false);
    };
    probe.src = url;
  });
}

function loadJson(text, name) {
  let next;
  try {
    next = JSON.parse(text);
  } catch (e) {
    return status(`${name} is not valid JSON: ${errText(e)}`, 'error');
  }
  const ok = next && typeof next === 'object' && Array.isArray(next.zones) && next.image && typeof next.image === 'object';
  if (!ok) return status(`${name} is not a hitzones file`, 'error');
  doc = next;
  selected = null;
  offerRescale();
  render();
  const problems = validate(doc, parseZones);
  if (problems.length) status(`Loaded ${name} with problems: ${problems.join('; ')}`, 'error');
  else status(`Loaded ${name}`);
}

async function openFiles(files) {
  const list = [...files];
  const isJson = (f) => /\.json$/i.test(f.name) || f.type === 'application/json';
  for (const f of list.filter((f) => !isJson(f) && f.type.startsWith('image/'))) {
    await loadImage(URL.createObjectURL(f), f.name, true);
  }
  for (const f of list.filter(isJson)) loadJson(await f.text(), f.name);
}

function save() {
  // Commit a label or data field still being edited (Ctrl+S): blur fires its change/blur handler.
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.closest('#zones') && /^(INPUT|TEXTAREA)$/.test(active.tagName)) active.blur();
  if (!doc) return status('Nothing to save yet', 'error');
  const errors = [...panel.errors(), ...validate(doc, parseZones)];
  if (errors.length) return status('Not saved: ' + errors.join('; '), 'error');
  const name = session.jsonName
    ? baseName(session.jsonName)
    : `${baseName(image ? image.name : doc.image.src).replace(/\.[^.]+$/, '') || 'zones'}.zones.json`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([serialize(doc)], { type: 'application/json' }));
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  status(`Downloaded ${name}`, 'ok');
}

function setTool(t) {
  canvas.setTool(t);
  for (const b of document.querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === t));
}

document.querySelector('header').addEventListener('click', (e) => {
  const b = e.target instanceof HTMLElement && e.target.closest('button');
  if (!b) return;
  if (b.dataset.tool) setTool(b.dataset.tool);
  const action = b.dataset.action;
  if (action === 'save') save();
  else if (action === 'open-image') $('#file-image').click();
  else if (action === 'open-json') $('#file-json').click();
  else if (action === 'fit') canvas.fit();
  else if (action === 'preview') doc ? preview.open(doc, image && image.url) : status('Open an image first', 'error');
});
for (const id of ['#file-image', '#file-json']) {
  $(id).addEventListener('change', async (e) => {
    await openFiles(e.target.files);
    e.target.value = '';
  });
}

const stage = $('#stage');
window.addEventListener('dragover', (e) => {
  e.preventDefault();
  stage.classList.add('drop');
});
window.addEventListener('dragleave', (e) => e.relatedTarget === null && stage.classList.remove('drop'));
window.addEventListener('drop', (e) => {
  e.preventDefault();
  stage.classList.remove('drop');
  if (e.dataTransfer && e.dataTransfer.files.length) openFiles(e.dataTransfer.files);
});

window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    return save();
  }
  const free = e.target === document.body || e.target === $('#canvas');
  const tools = { v: 'select', r: 'rect', e: 'ellipse', p: 'polygon' };
  if (free && !e.ctrlKey && !e.metaKey && !e.altKey && tools[e.key]) setTool(tools[e.key]);
});

async function start() {
  try {
    const r = await fetch(`/api/session?t=${encodeURIComponent(token)}`);
    if (r.ok) session = await r.json();
    else status('Not connected to the editor server', 'error');
  } catch {
    status('Not connected to the editor server', 'error');
  }
  if (session.json != null) loadJson(session.json, 'the zones file');
  if (session.hasImage) await loadImage(`/api/image?t=${encodeURIComponent(token)}`, session.imageName, false);
  render();
}
start();
