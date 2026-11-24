// Zone panel: one row per zone, topmost zone first. Rows are rebuilt when the zone list
// changes; otherwise values refresh in place so a field being edited keeps its text.

const h = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k in n) n[k] = v;
    else n.setAttribute(k, v);
  }
  n.append(...kids);
  return n;
};
const dataText = (z) => ('data' in z && z.data !== undefined ? JSON.stringify(z.data) : '');

/**
 * @param {HTMLOListElement} list
 * @param {{onRename(index:number, to:string):string|null, onData(index:number, text:string):string|null,
 *          onMove(index:number, delta:number):void, onRemove(index:number):void,
 *          onSelect(label:string):void}} on
 *   onRename and onData return an error message, or null on success.
 */
export function createPanel(list, on) {
  let key = '';
  let rows = [];

  function row(z, i, n) {
    const err = h('div', { class: 'err', role: 'alert' });
    const label = h('input', { name: 'label', value: z.label, spellcheck: false, autocomplete: 'off' });
    label.setAttribute('aria-label', 'Label');
    const data = h('textarea', { name: 'data', value: dataText(z), spellcheck: false, placeholder: 'data (JSON, optional)' });
    data.setAttribute('aria-label', 'Data JSON');
    const up = h('button', { type: 'button', title: 'Bring forward', disabled: i === n - 1 }, '↑');
    const down = h('button', { type: 'button', title: 'Send backward', disabled: i === 0 }, '↓');
    const del = h('button', { type: 'button', title: 'Delete zone' }, '×');
    const li = h('li', { class: 'zone-row' },
      h('div', { class: 'head' }, h('span', { class: 'shape' }, z.shape), label, up, down, del), data, err);
    li.dataset.label = z.label;
    const r = { li, label, data, z };

    const show = (field, msg) => {
      err.textContent = msg || '';
      label.setAttribute('aria-invalid', String(field === label && Boolean(msg)));
      data.setAttribute('aria-invalid', String(field === data && Boolean(msg)));
    };
    label.addEventListener('change', () => {
      const to = label.value.trim();
      show(label, to === r.z.label ? null : on.onRename(i, to));
    });
    label.addEventListener('keydown', (e) => e.key === 'Enter' && label.blur());
    data.addEventListener('blur', () => {
      if (data.value === dataText(r.z)) return show(data, null);
      show(data, on.onData(i, data.value));
    });
    up.addEventListener('click', () => on.onMove(i, 1));
    down.addEventListener('click', () => on.onMove(i, -1));
    del.addEventListener('click', () => on.onRemove(i));
    li.addEventListener('focusin', () => on.onSelect(r.z.label));
    li.addEventListener('pointerdown', () => on.onSelect(r.z.label));
    return r;
  }

  return {
    render(doc, selected) {
      const zones = doc ? doc.zones : [];
      const nextKey = JSON.stringify(zones.map((z) => [z.label, z.shape]));
      if (nextKey !== key) {
        key = nextKey;
        rows = zones.map((z, i) => row(z, i, zones.length));
        list.replaceChildren(...rows.slice().reverse().map((r) => r.li));
      } else {
        rows.forEach((r, i) => {
          r.z = zones[i];
          if (document.activeElement !== r.data && r.data.getAttribute('aria-invalid') !== 'true') r.data.value = dataText(r.z);
        });
      }
      for (const r of rows) {
        const sel = r.z.label === selected;
        r.li.classList.toggle('selected', sel);
        if (sel && r.li.scrollIntoView && !r.li.contains(document.activeElement)) r.li.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    },
  };
}
