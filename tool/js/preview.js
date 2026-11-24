// Preview dialog: runs the real package over the image at a chosen width and logs events.
import { createZones } from '/dist/hitzones.js';

const MAX_LOG = 200;

/** @param {HTMLDialogElement} dialog */
export function createPreview(dialog) {
  const frame = dialog.querySelector('.frame');
  const log = dialog.querySelector('.log');
  const range = dialog.querySelector('input[name=width]');
  const px = dialog.querySelector('.px');
  let map = null;
  let img = null;
  let doc = null;

  const write = (text, cls = '') => {
    const li = document.createElement('li');
    li.textContent = text;
    if (cls) li.className = cls;
    log.prepend(li);
    while (log.children.length > MAX_LOG) log.lastChild.remove();
  };
  const round = (n) => Math.round(n * 10) / 10;

  function render() {
    px.textContent = range.value + 'px';
    if (img) img.style.width = range.value + 'px';
  }

  function start() {
    render();
    try {
      map = createZones(img, doc, { debug: true });
    } catch (e) {
      write('error: ' + (e && e.message ? e.message : e), 'error');
      return;
    }
    map.on('click', (e) => write(`click ${e.label} (${e.status}, ${e.clicks}) at ${round(e.point.image.x)},${round(e.point.image.y)}`));
    map.on('miss', (e) => write(`miss at ${round(e.point.image.x)},${round(e.point.image.y)}`));
    map.on('layout', (e) => write(`layout ${e.zones.length} zones at ${img.getBoundingClientRect().width.toFixed(0)}px`));
  }

  function setWidth(w) {
    range.value = String(w);
    render();
  }

  dialog.addEventListener('click', (e) => {
    const w = e.target instanceof HTMLElement && e.target.dataset.width;
    if (w) setWidth(Number(w));
  });
  range.addEventListener('input', render);
  dialog.addEventListener('close', () => {
    if (map) map.destroy();
    map = null;
  });

  return {
    /** Opens the dialog for the current doc and image URL. */
    open(currentDoc, imageUrl) {
      doc = currentDoc;
      log.replaceChildren();
      img = document.createElement('img');
      img.alt = 'Preview';
      frame.replaceChildren(img);
      dialog.showModal();
      if (!imageUrl) return write('open an image first', 'error');
      img.addEventListener('load', start, { once: true });
      img.addEventListener('error', () => write('image failed to load', 'error'), { once: true });
      img.src = imageUrl;
    },
  };
}
