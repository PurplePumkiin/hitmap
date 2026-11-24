import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error plain JS module without declarations
import { startServer } from '../../tool/server.js';

type Srv = { url: string; token: string; close(): Promise<void> };
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixture = (name: string) => path.join(repo, 'test/fixtures', name);
const servers: Srv[] = [];

test.skip(({ browserName }) => browserName !== 'chromium', 'editor smoke test runs on Chromium only');
test.afterEach(async () => {
  while (servers.length) await servers.pop()!.close();
});

/** A tmp dir with copies of the fixtures; `zones` overrides the JSON contents. */
function tmp(zones?: unknown) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hz-tool-'));
  fs.copyFileSync(fixture('scene.svg'), path.join(dir, 'scene.svg'));
  const json = path.join(dir, 'zones.json');
  if (zones === undefined) fs.copyFileSync(fixture('zones.json'), json);
  else fs.writeFileSync(json, JSON.stringify(zones, null, 2));
  return { dir, image: path.join(dir, 'scene.svg'), json };
}
async function start(opts: Record<string, unknown>): Promise<Srv> {
  const s = await startServer({ root: repo, port: 0, ...opts });
  servers.push(s);
  return s;
}
const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
const fixtureJson = () => readJson(fixture('zones.json'));

/** Client coordinates of an image pixel on the editor canvas. */
async function at(page: Page, x: number, y: number) {
  return page.evaluate(
    ([x, y]) => {
      const m = (document.querySelector('#view') as SVGGraphicsElement).getScreenCTM()!;
      const p = new DOMPoint(x, y).matrixTransform(m);
      return { x: p.x, y: p.y };
    },
    [x, y],
  );
}
async function drag(page: Page, from: [number, number], to: [number, number]) {
  const a = await at(page, ...from);
  const b = await at(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 3 });
  await page.mouse.move(b.x, b.y, { steps: 3 });
  await page.mouse.up();
}
async function clickAt(page: Page, x: number, y: number) {
  const p = await at(page, x, y);
  await page.mouse.click(p.x, p.y);
}
async function ready(page: Page, rows: number) {
  await expect(page.locator('.zone-row')).toHaveCount(rows);
  await expect(page.locator('#canvas image')).toHaveAttribute('width', '400');
}

test('load image + json, draw each shape, save, reload', async ({ page }) => {
  const t = tmp();
  const s = await start({ image: t.image, json: t.json });
  await page.goto(s.url);
  await ready(page, 4);

  await page.click('[data-tool="rect"]');
  await drag(page, [10, 10], [60, 40]);
  await page.click('[data-tool="ellipse"]');
  await drag(page, [150, 120], [250, 180]);
  await page.click('[data-tool="polygon"]');
  await clickAt(page, 300, 20);
  await clickAt(page, 380, 20);
  await clickAt(page, 340, 60);
  await page.keyboard.press('Enter');
  await expect(page.locator('.zone-row')).toHaveCount(7);

  const label = page.locator('.zone-row[data-label="zone-1"] input[name=label]');
  await label.fill('door');
  await label.press('Enter');
  const data = page.locator('.zone-row[data-label="door"] textarea[name=data]');
  await data.fill('{"n":1}');
  await data.blur();

  await page.click('[data-action="save"]');
  await expect(page.locator('#status')).toContainText('Saved');
  const saved = readJson(t.json);
  expect(saved.zones).toHaveLength(7);
  const door = saved.zones.find((z: any) => z.label === 'door');
  expect(door).toMatchObject({ shape: 'rect', data: { n: 1 } });
  expect(door.x).toBeCloseTo(10, 0);
  expect(door.y).toBeCloseTo(10, 0);
  expect(door.width).toBeCloseTo(50, 0);
  expect(door.height).toBeCloseTo(30, 0);
  const ell = saved.zones.find((z: any) => z.label === 'zone-2');
  expect(ell).toMatchObject({ shape: 'ellipse' });
  expect(ell.cx).toBeCloseTo(200, 0);
  expect(ell.rx).toBeCloseTo(50, 0);
  const poly = saved.zones.find((z: any) => z.label === 'zone-3');
  expect(poly.shape).toBe('polygon');
  expect(poly.points).toHaveLength(3);
  expect(saved.image).toEqual(fixtureJson().image);

  await page.reload();
  await ready(page, 7);
});

test('save is blocked on duplicate label and file is untouched', async ({ page }) => {
  const j = fixtureJson();
  j.zones[1].label = 'box';
  const t = tmp(j);
  const before = fs.readFileSync(t.json, 'utf8');
  const s = await start({ image: t.image, json: t.json });
  let puts = 0;
  page.on('request', (r) => r.method() === 'PUT' && puts++);
  await page.goto(s.url);
  await ready(page, 4);
  await page.click('[data-action="save"]');
  await expect(page.locator('#status')).toContainText('duplicate label "box"');
  await expect(page.locator('#status')).not.toContainText('Saved');
  expect(puts).toBe(0);
  expect(fs.readFileSync(t.json, 'utf8')).toBe(before);
});

test('mismatched image size offers rescale and rescales on accept', async ({ page }) => {
  const j = fixtureJson();
  j.image = { width: 200, height: 100, src: 'scene.svg' };
  j.zones[0] = { ...j.zones[0], x: 10, y: 10, width: 40, height: 30 };
  const t = tmp(j);
  const s = await start({ image: t.image, json: t.json });
  await page.goto(s.url);
  await ready(page, 4);
  const bar = page.locator('#rescale-bar');
  await expect(bar).toBeVisible();
  await expect(bar).toContainText('200×100');
  await expect(bar).toContainText('400×200');
  await bar.locator('[data-action="rescale"]').click();
  await expect(bar).toBeHidden();
  await page.click('[data-action="save"]');
  await expect(page.locator('#status')).toContainText('Saved');
  const saved = readJson(t.json);
  expect(saved.image).toEqual({ width: 400, height: 200, src: 'scene.svg' });
  expect(saved.zones[0]).toMatchObject({ label: 'box', x: 20, y: 20, width: 80, height: 60 });
});

test('preview at 375px logs a click event for a zone', async ({ page }) => {
  const t = tmp();
  const s = await start({ image: t.image, json: t.json });
  await page.goto(s.url);
  await ready(page, 4);
  await page.click('[data-action="preview"]');
  const dialog = page.locator('#preview');
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-width="375"]').click();
  const img = dialog.locator('img');
  await expect.poll(async () => (await img.boundingBox())!.width).toBeCloseTo(375, 0);
  await expect(dialog.locator('.log')).toContainText('layout');
  // ring sits at image (200,100) of a 400×200 image.
  const b = (await img.boundingBox())!;
  await page.mouse.click(b.x + (200 * b.width) / 400, b.y + (100 * b.height) / 200);
  await expect(dialog.locator('.log')).toContainText('click ring');
  await page.mouse.click(b.x + 2, b.y + b.height - 2);
  await expect(dialog.locator('.log')).toContainText('miss');
  await expect(dialog.locator('svg.hitzones')).toHaveCount(1);
});

test('without paths: open image by file input, save downloads', async ({ page }) => {
  const s = await start({});
  await page.goto(s.url);
  await expect(page.locator('.zone-row')).toHaveCount(0);
  await page.setInputFiles('#file-image', fixture('scene.svg'));
  await expect(page.locator('#canvas image')).toHaveAttribute('width', '400');
  await page.click('[data-tool="rect"]');
  await drag(page, [10, 10], [60, 40]);
  await expect(page.locator('.zone-row')).toHaveCount(1);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="save"]')]);
  expect(download.suggestedFilename()).toBe('scene.zones.json');
  const file = await download.path();
  const saved = readJson(file!);
  expect(saved.image).toEqual({ width: 400, height: 200, src: 'scene.svg' });
  expect(saved.zones).toHaveLength(1);
  expect(saved.zones[0].label).toBe('zone-1');
});

test('opening a zones file by input loads its rows', async ({ page }) => {
  const s = await start({});
  await page.goto(s.url);
  await page.setInputFiles('#file-image', fixture('scene.svg'));
  await page.setInputFiles('#file-json', fixture('zones.json'));
  await ready(page, 4);
  await expect(page.locator('#rescale-bar')).toBeHidden();
});

test('select moves and resizes, edits polygon vertices, deletes; panel errors show inline', async ({ page }) => {
  const t = tmp();
  const s = await start({ image: t.image, json: t.json });
  await page.goto(s.url);
  await ready(page, 4);
  const zones = () =>
    // The canvas draws each zone from the doc, so its attributes show the doc's geometry.
    page.evaluate(() =>
      [...document.querySelectorAll('#canvas .zone')].map((n) => ({
        label: (n as SVGElement).dataset.label,
        attrs: Object.fromEntries([...n.attributes].map((a) => [a.name, a.value])),
      })),
    );
  const attrs = async (label: string) => (await zones()).find((z) => z.label === label)!.attrs;

  // Move "ring" (ellipse at 200,100) by +20,+10.
  await drag(page, [200, 100], [220, 110]);
  expect(Number((await attrs('ring')).cx)).toBeCloseTo(220, 0);
  expect(Number((await attrs('ring')).cy)).toBeCloseTo(110, 0);
  await expect(page.locator('.zone-row[data-label="ring"]')).toHaveClass(/selected/);

  // Resize "box" (20,20 80×60) from its bottom-right corner to 120,100. Overlap sits on top, so
  // select box from its panel row first.
  await page.locator('.zone-row[data-label="box"] .shape').click();
  await drag(page, [100, 80], [120, 100]);
  const box = await attrs('box');
  for (const [k, want] of Object.entries({ x: 20, y: 20, width: 100, height: 80 })) {
    expect(Number(box[k])).toBeCloseTo(want, 0);
  }

  // Polygon "tri": select, double-click the first edge to add a vertex, Alt-click to remove it,
  // then drag a vertex.
  await clickAt(page, 340, 130);
  const pts = async () => (await attrs('tri')).points.split(' ').length;
  expect(await pts()).toBe(3);
  const mid = await at(page, 340, 150);
  await page.mouse.dblclick(mid.x, mid.y);
  expect(await pts()).toBe(4);
  const added = await at(page, 340, 150);
  await page.keyboard.down('Alt');
  await page.mouse.click(added.x, added.y);
  await page.keyboard.up('Alt');
  expect(await pts()).toBe(3);
  await drag(page, [340, 80], [340, 60]);
  const top = (await attrs('tri')).points.split(' ')[2].split(',').map(Number);
  expect(top[0]).toBeCloseTo(340, 0);
  expect(top[1]).toBeCloseTo(60, 0);
  // A selected vertex on a triangle can't go (3 is the minimum); Escape drops the vertex
  // selection, and then Delete removes the zone.
  await page.keyboard.press('Delete');
  expect(await pts()).toBe(3);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Delete');
  await expect(page.locator('.zone-row')).toHaveCount(3);
  await expect(page.locator('.zone-row[data-label="tri"]')).toHaveCount(0);

  // Inline errors: duplicate rename and bad data JSON.
  const label = page.locator('.zone-row[data-label="ring"] input[name=label]');
  await label.fill('box');
  await label.press('Enter');
  await expect(page.locator('.zone-row[data-label="ring"] .err')).toContainText('already used');
  const data = page.locator('.zone-row[data-label="box"] textarea[name=data]');
  await data.fill('{nope');
  await data.blur();
  await expect(page.locator('.zone-row[data-label="box"] .err')).toContainText('not valid JSON');
});

test('wheel zooms around the cursor and middle-drag pans', async ({ page }) => {
  const t = tmp();
  const s = await start({ image: t.image, json: t.json });
  await page.goto(s.url);
  await ready(page, 4);
  const before = await at(page, 100, 50);
  const scale = () => page.evaluate(() => (document.querySelector('#view') as SVGGraphicsElement).getScreenCTM()!.a);
  const s0 = await scale();
  await page.mouse.move(before.x, before.y);
  await page.mouse.wheel(0, -300);
  await expect.poll(scale).toBeGreaterThan(s0 * 1.2);
  const after = await at(page, 100, 50);
  // Within a pixel: some browsers round mouse positions to whole pixels.
  expect(Math.abs(after.x - before.x)).toBeLessThan(1.5);
  expect(Math.abs(after.y - before.y)).toBeLessThan(1.5);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(before.x + 40, before.y + 25, { steps: 4 });
  await page.mouse.up({ button: 'middle' });
  const panned = await at(page, 100, 50);
  expect(Math.abs(panned.x - after.x - 40)).toBeLessThan(1.5);
  expect(Math.abs(panned.y - after.y - 25)).toBeLessThan(1.5);
  await expect(page.locator('.zone-row')).toHaveCount(4);
});
