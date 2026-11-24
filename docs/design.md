# hitzones — design

Status: approved, 2026-11-23.

## Intent

Interactive images like hidden-object scenes ("Where's Waldo"), annotated diagrams and shoppable photos all need the same base: invisible click zones on a flat image that stay locked to the right part of the picture at every screen size. What each page *does* with a click varies every time (a popup, a counter, an analytics event, a sound).

hitzones is that base and nothing else. It has two parts:

1. **The package**: a tiny, dependency-free JavaScript library. It attaches to an `<img>`, lays invisible zones over it, and reports what happened (which zone, its status, and where that zone is on screen right now). It draws nothing visible.
2. **The tool**: a local editor you run with `npm run tool` (or `npx hitzones edit`). You open an image, draw zones, name them, attach data, and save a JSON file. It never ships to production.

The JSON format joins the two, and the format is the real product. It is documented and versioned so other tools can read or write it.

It will be open source under the author's GitHub account (`PurplePumkiin/hitzones`) and published to npm as `hitzones`.

## Goals

- Zones stay on the same part of the image at any rendered size, zoom level, device pixel ratio or CSS transform, with no drift.
- The package is headless. It emits events with enough position data for the page to place its own UI next to a zone.
- Simple to adopt: one function call, works with or without a bundler (ESM import or a plain `<script>` tag).
- Simple to author: draw zones over the real art and save. No hand-typed coordinates.
- Small: zero runtime dependencies, target under 4 KB min+gzip.

## Non-goals

- Rendering popups, tooltips, highlights, markers or any visible UI.
- Game logic: counters, "all found", scoring, timers. Pages build these from events and `state()`.
- Panning or zooming the image. The page owns its layout, and hitzones follows whatever happens to the image.
- Framework wrappers (React, Vue, etc.). Possible later, as separate thin packages.
- Hosting, storage, accounts or a production editor.

## Anti-goals (a failure even if it technically works)

- Anything specific to one project (brands, game rules, copy) in the package or the tool.
- Zones that visibly drift from their art at some screen size.
- The package changing how the image looks or lays out.
- Runtime dependencies.

## Approaches considered

1. **Write both the package and the tool ourselves.** *Chosen.* The runtime is small, and the gap in existing work is the pairing (a headless runtime plus an editor sharing one simple format). We own every line, it stays tiny, and licensing is simple.
2. **Our runtime plus a fork of an existing image-map editor** (e.g. summerstyle/summer, MIT). This saves some drawing code, but means inheriting another code base and output format and still adding labels, data and our export. Rejected.
3. **Build on an annotation framework** (Annotorious) or on existing responsive `<map>` libraries. Too heavy, or built on the HTML `<map>` element, which needs coordinate rewriting on every resize, is often jQuery-bound, and has no editor. Rejected.

## Decisions made with the author

- The package is a hook: it handles mapping and clicks and returns data. Pages trigger their own behaviour from it.
- The tool is local-only, started with `npm run tool`.
- The package attaches to an existing `<img>`. It does not render the image.
- Zones are stored in the source image's own pixel coordinates.
- Each zone carries free-form `data` that is passed through untouched.
- Clicks that hit no zone are reported (`miss`).
- No automatic minimum tap size. If a target should be bigger, draw it bigger.
- Name `hitzones`, published to npm as a 0.0.1 placeholder on 2026-11-24 to hold the name. (`hitmap` was refused by npm as too similar to the existing `hit-map`.) Public repo `PurplePumkiin/hitzones`.
- **Nothing is committed until the README and license are agreed with the author.** The license is undecided (MIT or Apache-2.0).

## The data format (`hitzones` v1)

```json
{
  "hitzones": 1,
  "image": { "width": 3840, "height": 2160, "src": "scene.jpg" },
  "zones": [
    {
      "label": "lighthouse",
      "shape": "rect",
      "x": 2500, "y": 380, "width": 640, "height": 420,
      "data": { "group": "buildings", "message": "Found the lighthouse!" }
    },
    {
      "label": "sailboat",
      "shape": "polygon",
      "points": [[1610, 1100], [2240, 1080], [2260, 1460], [1590, 1490]]
    },
    {
      "label": "snowman",
      "shape": "ellipse",
      "cx": 1890, "cy": 1650, "rx": 70, "ry": 110
    }
  ]
}
```

- `hitzones`: the format version (integer). Readers reject versions they don't know.
- `image.width` / `image.height`: the pixel size of the art the zones were drawn on. Required.
- `image.src`: informational only (the file name the tool saw). The package never loads it.
- `zones[].label`: required and unique within the file. It is the zone's identity in every event.
- `zones[].shape`: `rect`, `ellipse` or `polygon`. The numbers are in image pixels and may be fractional.
- `zones[].data`: optional, any JSON value, returned as-is.
- Zone order is z-order: later zones sit on top where zones overlap.
- Unknown top-level and zone keys are preserved by the tool and ignored by the package. This leaves room to extend the format.
- A JSON Schema file ships in the package (`schema/hitzones-v1.json`).

## The package

### Use

```js
import { createZones } from 'hitzones';
// or: <script src="hitzones.iife.js"></script> → window.Hitzones.createZones

const map = createZones(document.querySelector('#scene'), zonesJson, options);

const off = map.on('click', e => { … });   // on() returns an unsubscribe function
map.on('miss', e => { … });
map.on('layout', e => { … });

map.state();     // [{ label, status: 'idle' | 'clicked', clicks: 0 }]
map.zone(label); // one zone's state + current position
map.reset();     // every zone back to idle, clicks 0
map.destroy();   // remove the overlay and all listeners
```

### How it attaches

- It inserts one absolutely positioned `<svg>` as the image's next sibling and keeps it exactly over the image's **rendered content box**. The SVG `viewBox` is `0 0 image.width image.height`, so zones are drawn in source pixels and the browser scales them with the image. No JavaScript recalculates zone geometry.
- The content box accounts for `object-fit` (`fill`, `contain`, `cover`, `none`, `scale-down`) and `object-position`. Cropped art (`cover`) still maps correctly, and zones that fall outside the visible crop are simply clipped. It also accounts for padding and border on the `<img>`.
- If the image's parent is statically positioned, hitzones sets `position: relative` on it and restores it on `destroy()`. This is the only style it touches outside its own SVG. The SVG is `pointer-events: none` except on its zone shapes.
- A `ResizeObserver` (on the image), plus a listener for the image's `load`, keep the overlay aligned and trigger `layout`. CSS transforms on ancestors need nothing extra, because the SVG sits in the same transformed context as the image.
- If the image's natural aspect ratio differs from `image.width / image.height` by more than 1%, it warns once in the console (the art was probably swapped).

### Events

All positions come as boxes `{ x, y, width, height }` in four spaces:

- `image`: source pixels (as in the JSON).
- `percent`: 0–100 of the image's width and height.
- `element`: CSS pixels relative to the image element's top-left corner, as rendered.
- `viewport`: CSS pixels relative to the viewport (like `getBoundingClientRect`).

The box is the zone's bounding box. Polygons and ellipses also get `shape` (the zone's definition from the JSON).

| Event | Payload |
|---|---|
| `click` | `{ label, status: 'clicked' \| 'reclicked', clicks, data, position, point, originalEvent }`. `status` is `clicked` on the first click since load or `reset()`, then `reclicked`. `point` is where the click landed, in the same four spaces. |
| `miss` | `{ point, originalEvent }` for a click on the image that hit no zone. |
| `layout` | `{ zones: [{ label, position }] }`, fired after attach and on every size change (debounced to one per animation frame), so open popups can follow their zone. |

"Click" means a primary-button click or tap, and keyboard activation where enabled. A drag (pointer moved more than 5 px between down and up) is not a click, so swipe-panning the image doesn't fire zones.

### Options

| Option | Default | Meaning |
|---|---|---|
| `keyboard` | `false` | `true` makes zones focusable (`tabindex=0`, `role="button"`, `aria-label` from `data.ariaLabel` or else `label`), activated with Enter or Space. Off by default because tabbing through zones gives away a hidden-object game. Pages that need it opt in. |
| `cursor` | `'pointer'` | Cursor over zones. Use `'default'` to avoid giving zones away on hover. |
| `className` | `'hitzones'` | Class on the SVG. Zones get `hitzone` and `data-label`, so pages can style or debug them. |
| `debug` | `false` | Outlines the zones (for checking alignment during development). |

### Accessibility note (for the README)

hitzones reports clicks. It doesn't decide how a game is made accessible. The README will show the `keyboard` option, and how to offer a non-visual alternative such as a list of zones.

### Build and distribution

- Source in TypeScript, built with esbuild to ESM (`dist/hitzones.js`), an IIFE (`dist/hitzones.iife.js`, global `Hitzones`) and type declarations. Dev dependencies only.
- Supports current evergreen browsers (needs `ResizeObserver` and pointer events).

### Details settled during review (builder's calls, open to correction)

- **Where clicks are caught.** The SVG root is `pointer-events: none`, and zone shapes are `pointer-events: all` with a transparent fill. Zone clicks are caught on the SVG, and misses on the `<img>` (clicks in empty areas pass through the SVG to the image). Drag detection tracks pointerdown/up on both. Zone clicks don't reach the page's own `<img>` handlers (the SVG is a sibling), but they still bubble to shared ancestors such as a wrapping `<a>`. The README will say so.
- **Cropping.** The SVG covers only the visible part of the image (the content box intersected with the element box), with its `viewBox` set to the matching source-pixel rectangle. Zones cropped out by `object-fit: cover` aren't clickable, and zones never spill outside the image element.
- **Keyboard activation** gives `point` = the zone's centre and `originalEvent` = the `KeyboardEvent`. The keyboard never produces a `miss`.
- **Lifecycle.** `createZones` returns immediately. Layout waits until the image has loaded (`naturalWidth > 0`) and has a non-zero rendered box. Until then, positions are `null` and no `layout` event fires. The first `layout` fires when it becomes measurable. A `display:none` image pauses `layout` until it's visible again. A `src` change re-runs layout (on `load`) and the aspect-ratio check.
- **`state()` and `zone()`.** `state()` returns `[{ label, status, clicks }]` with no positions. `zone(label)` returns `{ label, status, clicks, data, position }` (`position` is `null` before layout), or `null` for an unknown label.
- **Validation.** `createZones` throws a `TypeError` with a clear message in these cases: an unknown `hitzones` version, missing or non-positive image size, a missing or duplicate label, an unknown shape, a polygon with fewer than 3 points, or non-finite numbers. The checks are hand-written. The JSON Schema file is for documentation and the tool, not used at runtime.
- **Size.** 4 KB min+gzip is a target. CI prints the size and fails above 6 KB.

## The tool

- `npm run tool` in the repo, or `npx hitzones edit [image] [zones.json]` once installed. It starts a tiny Node HTTP server (no dependencies) bound to `127.0.0.1` and opens the editor in the browser.
- **Open:** pick or drop an image (read locally, never uploaded anywhere), and optionally an existing zones JSON. When started with file paths, it loads those and **Save** writes straight back to the JSON file on disk. Otherwise **Save** downloads the file.
- **Draw:** rectangle, ellipse and polygon tools. Select, move, resize, delete, and edit polygon vertices (add, move, remove). The canvas zooms (wheel or pinch) and pans for precise work on large art.
- **Zone panel:** a list of zones. For each one, edit the label (uniqueness enforced), reorder it (z-order), and edit its `data` as JSON with validation.
- **Preview:** runs the real package against the image at an adjustable width (phone, tablet, desktop presets) and logs events, to prove alignment before shipping.
- Plain HTML, CSS and JS in `tool/`, no framework, served as-is.
- **Image size and name:** `image.width`/`height` come from the image's natural size, and `image.src` is the file's base name. If a loaded JSON's image size doesn't match the opened image, the tool warns and offers to rescale the zones proportionally.
- **Saving:** 2-space indented JSON, known keys in a fixed order, unknown keys preserved (their order isn't guaranteed).
- **Server safety:** binds `127.0.0.1` on a free port, prints the URL and tries to open the browser. It can write only to the JSON path given at startup. Save requests must carry a random per-run token from the page URL.

## Packaging

- One npm package containing `dist/`, `schema/`, `tool/` and `bin/`. Its `exports` map has `"."` (ESM + types, with the IIFE as a separate file path) and `"./schema"`.
- The tool needs Node 18+. The package supports the last two versions of Chrome, Edge, Firefox and Safari, plus iOS Safari 15+.
- The tool's preview loads `dist/`. In the repo, `npm run tool` builds first.

## Repo layout

```
hitzones/
  src/            package source
  dist/           build output (published, not committed)
  schema/         hitzones-v1.json (JSON Schema)
  tool/           editor (server.js + index.html + js/css)
  bin/hitzones.js   CLI entry (`hitzones edit`)
  test/           unit + browser tests
  examples/       a minimal page using the package
  docs/design.md  this document
  README.md, LICENSE   (to be agreed before the first commit)
```

## Testing

- Unit tests for the coordinate maths: content box under every `object-fit` and `object-position`, padding and border, conversion between the four spaces, and polygon and ellipse bounding boxes.
- Browser tests (Playwright) that render an image at several widths, with `object-fit: cover`, under a CSS transform and inside a scrolling container. They click known image pixels and assert the right zone, the right `status` and the right positions. They also check drag-versus-click and `reset()`.
- A tool smoke test: load an image and a JSON file, draw each shape, save, and reload the same JSON.

## Constraints

- No AI-tool attribution anywhere in the repo, commits, README or package metadata.
- Public repo: no client names, client art or internal URLs in the repo. Examples use neutral placeholder art made for the repo.
- First commit only after the README and license are approved.

## Left to the builder

- Internal module structure, test framework details, and the editor's look and interaction polish.
- Exact console warning text and the debounce mechanics.
- Whether polygon hit-testing relies on SVG native hit-testing (expected) or a fallback.
