# The hitzones format (v1)

A hitzones file is JSON. It describes invisible click zones laid over one image, in that image's own pixel coordinates. A JSON Schema is in `schema/hitzones-v1.json`; `parseZones()` in the package does the same checks (plus label uniqueness) at runtime.

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

## Fields

- `hitzones`: the format version, the integer `1`. Readers reject versions they don't know.
- `image.width` / `image.height`: the pixel size of the art the zones were drawn on. Required, greater than 0.
- `image.src`: informational only (the file name the editor saw). The package never loads it.
- `zones`: an array. Order is z-order: later zones sit on top where zones overlap.
- `zones[].label`: required, a non-empty string, unique within the file. It is the zone's identity in every event.
- `zones[].shape`: `rect`, `ellipse` or `polygon`. All numbers are in image pixels, must be finite, and may be fractional.
- `zones[].data`: optional, any JSON value, returned as-is.

## Shapes

| Shape | Fields | Rules |
|---|---|---|
| `rect` | `x`, `y`, `width`, `height` | `x`, `y` is the top-left corner. `width` and `height` are greater than 0. |
| `ellipse` | `cx`, `cy`, `rx`, `ry` | Centre and radii. `rx` and `ry` are greater than 0. |
| `polygon` | `points` | At least 3 points, each `[x, y]`. The shape is closed automatically. |

## Extending

Unknown top-level and zone keys are preserved by the editor and ignored by the package. This leaves room to add fields without a version bump; anything that changes the meaning of existing fields needs a new `hitzones` version.

## Validation errors

Invalid files make `parseZones()` (and `createZones()`) throw a `TypeError` whose message starts with `hitzones: ` and names the zone index and label where there is one. Rejected: an unknown version, a missing or non-positive image size, a missing or duplicate label, an unknown shape, a polygon with fewer than 3 points, and non-finite numbers.
