# hitzones

Invisible click zones on an image that stay put at any screen size.

You draw the zones once, over your real artwork, in a small editor. hitzones lays them over the image on your page and tells you when someone clicks one. That's all it does. What happens next (a popup, a sound, a counter) is up to you.

It's handy for hidden-object games, clickable diagrams, and photos with things to discover.

## Draw your zones

```
npx hitzones edit scene.jpg zones.json
```

This opens the editor in your browser. Draw rectangles, ellipses or polygons around things, give each one a name, and save. The editor runs only on your machine and never goes to production.

## Use them

```
npm install hitzones
```

```js
import { createZones } from 'hitzones';

const map = createZones(document.querySelector('#scene'), zones);

map.on('click', (e) => {
  console.log(e.label, e.status); // "snowman" "clicked"
});
```

Every click tells you which zone it was, whether it's been clicked before, any data you attached in the editor, and where the zone sits on screen right now, so you can put your own popup next to it. If someone clicks the image but misses every zone, you hear about that too. When the image resizes, you get the new positions.

No bundler? hitzones also works from a plain `<script>` tag.

## Why it doesn't drift

Zones are stored in your image's own pixels and drawn in a layer that scales with the image. Resizing, zooming, cropping with `object-fit` and CSS transforms all leave them where you drew them.

## Good to know

- Zones are invisible and skipped by keyboard navigation by default, so they don't give a game away. If your use needs keyboard access, turn it on.
- There are no dependencies, and it adds only a few KB to your page.
- It works in current Chrome, Edge, Firefox and Safari, including iOS.

The full details (events, options and the file format) are in [docs](docs/).

## License

MIT © Dennis Friend
