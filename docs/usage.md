# Using hitzones

hitzones attaches to an existing `<img>`, lays invisible zones over it and reports clicks. It draws nothing and has no game logic. For the file format see [format.md](format.md). A working page is in [`examples/`](../examples/).

Using the package and the editor needs Node 24+. Developing hitzones itself needs Node 26 (see `.nvmrc`).

## API

```js
import { createZones, parseZones } from 'hitzones';
// or: <script src="hitzones.iife.js"></script> -> window.Hitzones.createZones

const map = createZones(document.querySelector('#scene'), zonesJson, options);
```

`createZones(img, json, options?)` returns at once. It throws a `TypeError` if the JSON isn't a valid v1 file (see [format.md](format.md)). Layout waits until the image has loaded and has a visible, non-zero size. An image that is already loaded is laid out straight away.

| Method | Does |
|---|---|
| `map.on(type, fn)` | Listens for `click`, `miss` or `layout`. Returns a function that unsubscribes. |
| `map.state()` | `[{ label, status, clicks }]` for every zone. `status` is `'idle'` or `'clicked'`. No positions. |
| `map.zone(label)` | `{ label, status, clicks, data, position }` for one zone, or `null` for an unknown label. `position` is `null` while the image can't be measured. |
| `map.reset()` | Every zone back to `idle`, clicks 0. |
| `map.destroy()` | Removes the overlay and every listener, and restores the parent's `position`. |

`parseZones(json)` runs the same validation on its own and returns the parsed file.

`zone(label).position` is available as soon as the image is measurable, which can be before the first `layout` event. `layout` fires when the position changes.

## Events

| Event | Payload |
|---|---|
| `click` | `{ label, status, clicks, data, position, point, originalEvent }`. `status` is `'clicked'` for the first click since load or `reset()`, then `'reclicked'`. `point` is where the click landed. |
| `miss` | `{ point, originalEvent }`: a click on the image that hit no zone. A click on letterbox bars (`object-fit: contain`), padding or border emits nothing. Keyboard activation never produces a miss. |
| `layout` | `{ zones: [{ label, position }] }`. Fired once the image is measurable and whenever its placement changes, at most once per animation frame. Use it to keep open popups next to their zone. |

A click is a primary-button click or a tap, or keyboard activation when `keyboard` is on. A pointer that moves more than 5 px between down and up is a drag, not a click, so swiping the image doesn't fire zones. A cancelled touch (a scroll) produces nothing.

Where zones overlap, the later zone in the file wins and only one `click` fires.

Keyboard activation gives `point` as the zone's centre and `originalEvent` as the `KeyboardEvent`.

## Options

| Option | Default | Meaning |
|---|---|---|
| `keyboard` | `false` | Makes zones focusable buttons (`tabindex="0"`, `role="button"`, `aria-label` from `data.ariaLabel`, else `label`), activated with Enter or Space. |
| `cursor` | `'pointer'` | Cursor over zones. Use `'default'` so hovering doesn't give zones away. |
| `className` | `'hitzones'` | Class on the SVG. Zones get class `hitzone` and a `data-label` attribute. |
| `debug` | `false` | Outlines the zones, to check alignment while developing. |

## The four spaces

`position` is the zone's bounding box and `point` is the click location. Both come in four coordinate spaces. Polygon and ellipse positions also carry `shape`, the zone's definition from the file.

| Space | Unit and origin | Use it for |
|---|---|---|
| `image` | Source pixels, the same as in the file. | Logic and analytics that shouldn't depend on screen size. |
| `percent` | 0 to 100 of the image's width and height. | Storing or sending a place that survives a different image size. |
| `element` | CSS pixels from the `<img>`'s top-left corner, as rendered. | Placing a popup inside the same positioned parent as the image. |
| `viewport` | CSS pixels from the viewport's top-left, like `getBoundingClientRect()`. | Placing a popup with `position: fixed`, or measuring against other elements. |

To place a popup next to a zone, use `viewport` or `element`. Update it on `layout`.

```js
map.on('click', (e) => {
  const { x, y, width } = e.position.viewport;
  popup.style.cssText = `position:fixed; left:${x + width}px; top:${y}px`;
});
```

## Things to know

- **Bubbling.** Zone clicks bubble to shared ancestors, such as an `<a>` that wraps the image. They don't reach the `<img>`'s own handlers, because the overlay is a sibling. Keyboard activation (Enter or Space) emits `click` but doesn't trigger a wrapping link's navigation. If a page wants that, it handles it in its `click` listener.
- **Transforms.** CSS transforms on ancestors are fine, because the overlay sits in the same transformed context as the image. A transform on the `<img>` itself isn't mirrored. Under a rotation, `viewport` positions are approximate, because they are axis-aligned boxes.
- **Disabling a map.** `pointer-events: none` on a wrapper doesn't stop zones, because the zones set their own `pointer-events`. Call `destroy()` instead.
- **Cropping.** With `object-fit: cover` the zones outside the visible crop are clipped and not clickable. `object-position`, padding and border on the `<img>` are accounted for.
- **Changed art.** If the image's natural aspect ratio differs from the file's `image` size by more than 1%, hitzones warns once in the console. The art was probably swapped.
- **Parent position.** If the image's parent is statically positioned, hitzones sets `position: relative` on it and restores it on `destroy()`. It touches no other outside style.

## Accessibility

hitzones reports clicks. It doesn't decide how a game is made accessible.

By default zones are invisible to keyboards and screen readers, so tabbing through them doesn't give a hidden-object game away. With `keyboard: true`, zones become focusable buttons and the SVG is no longer `aria-hidden`. Enter or Space activates a zone, and Space does it on keydown. Set `data.ariaLabel` in the editor for a better spoken name than the label.

A non-visual alternative is often better than tabbing through the picture. For example, offer a plain list built from `state()`:

```js
const list = document.querySelector('#zone-list');
function renderList() {
  list.replaceChildren(
    ...map.state().map((z) => {
      const li = document.createElement('li');
      li.textContent = z.status === 'clicked' ? `${z.label} (found)` : z.label;
      return li;
    }),
  );
}
map.on('click', renderList);
renderList();
```

Making the list items buttons that act on the zone is up to the page.
