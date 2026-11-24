// Type-check fixture: imports the built declarations the way a consumer does,
// through the package's own name (self-reference via "exports").
import { createZones, type ClickEvent, type Options } from 'hitzones';

const opts: Options = { keyboard: true, cursor: 'default' };
const map = createZones(document.createElement('img'), {}, opts);
map.on('click', (e: ClickEvent) => {
  const label: string = e.label;
  // Only an error while ClickEvent is a real type: if the import degrades to `any`, this directive is unused.
  // @ts-expect-error label is a string, not a number
  const wrong: number = e.label;
  void label;
  void wrong;
});
