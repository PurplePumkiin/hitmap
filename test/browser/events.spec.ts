import { expect, test, type Page } from '@playwright/test';

type Setup = {
  wrapTag?: string;
  wrap?: string; // inline style for the image's parent
  img?: string; // inline style for the <img>
  options?: Record<string, unknown>;
};

// scene.svg is 400×200. Zones: box (20,20 80×60), overlap (60,40 60×40, later), ring (200,100 r30×20), tri.
async function setup(page: Page, s: Setup = {}) {
  await page.goto('/test/fixtures/harness.html');
  await page.evaluate(async (s) => {
    const w = window as any;
    const tag = s.wrapTag ?? 'div';
    const href = tag === 'a' ? ' href="#zone"' : '';
    document.getElementById('root')!.innerHTML =
      `<${tag} id="wrap"${href} style="display:block;${s.wrap ?? ''}"><img id="img" alt="" style="${s.img ?? 'display:block;width:800px;height:auto'}"></${tag}>`;
    const img = document.getElementById('img') as HTMLImageElement;
    w.json = await (await fetch('/test/fixtures/zones.json')).json();
    const loaded = new Promise((r) => img.addEventListener('load', r, { once: true }));
    img.src = '/test/fixtures/scene.svg';
    await loaded;
    w.hz = w.Hitzones.createZones(img, w.json, s.options ?? {});
    const orig = (e: Event) => ({ type: e.type, keyboard: e instanceof KeyboardEvent, prevented: e.defaultPrevented });
    w.hz.on('click', (e: any) =>
      w.events.push({
        type: 'click',
        label: e.label,
        status: e.status,
        clicks: e.clicks,
        data: e.data,
        dataSame: e.data === w.json.zones.find((z: any) => z.label === e.label).data,
        position: e.position,
        point: e.point,
        orig: orig(e.originalEvent),
        originalEvent: e.originalEvent,
      }),
    );
    w.hz.on('miss', (e: any) => w.events.push({ type: 'miss', point: e.point, orig: orig(e.originalEvent) }));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, s);
  await expect.poll(() => page.evaluate(() => (document.querySelector('svg') as SVGSVGElement).style.display)).toBe('');
}

const events = (page: Page) =>
  page.evaluate(() => (window as any).events.map(({ originalEvent: _o, ...e }: any) => e));

/** Client coordinates of an image pixel, for an <img> with no border, padding or object-fit (fill). */
async function client(page: Page, ix: number, iy: number) {
  const r = await page.evaluate(() => {
    const b = document.getElementById('img')!.getBoundingClientRect();
    return { x: b.left, y: b.top, w: b.width, h: b.height };
  });
  return { x: r.x + (ix * r.w) / 400, y: r.y + (iy * r.h) / 200 };
}

async function clickImage(page: Page, ix: number, iy: number, opts?: Parameters<Page['mouse']['click']>[2]) {
  const p = await client(page, ix, iy);
  await page.mouse.click(p.x, p.y, opts);
}

test('click on a zone emits clicked, then reclicked, with clicks count', async ({ page }) => {
  await setup(page);
  await clickImage(page, 200, 100);
  await clickImage(page, 200, 100);
  await clickImage(page, 30, 30);
  const ev = await events(page);
  expect(ev.map((e: any) => [e.type, e.label, e.status, e.clicks])).toEqual([
    ['click', 'ring', 'clicked', 1],
    ['click', 'ring', 'reclicked', 2],
    ['click', 'box', 'clicked', 1],
  ]);
  expect(ev[2].data).toEqual({ name: 'Box' });
  expect(ev[2].dataSame).toBe(true);
  expect(ev[0].data).toBeUndefined();
  expect(ev[0].orig.type).toBe('pointerup');
  const z = await page.evaluate(() => (window as any).hz.zone('ring'));
  expect([z.status, z.clicks]).toEqual(['clicked', 2]);
});

test('click position and point are in four spaces', async ({ page }) => {
  await setup(page);
  await clickImage(page, 205, 102);
  const [e] = await events(page);
  const img = await page.evaluate(() => {
    const b = document.getElementById('img')!.getBoundingClientRect();
    return { x: b.left, y: b.top };
  });
  for (const [k, v] of Object.entries({ x: 205, y: 102 })) expect(Math.abs(e.point.image[k] - v)).toBeLessThanOrEqual(1);
  expect(Math.abs(e.point.percent.x - 51.25)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(e.point.percent.y - 51)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(e.point.element.x - 410)).toBeLessThanOrEqual(2);
  expect(Math.abs(e.point.viewport.x - (img.x + 410))).toBeLessThanOrEqual(2);
  // ring bounds 170,80 60×40, at 2× scale
  expect(e.position.image).toEqual({ x: 170, y: 80, width: 60, height: 40 });
  for (const [k, v] of Object.entries({ x: 42.5, y: 40, width: 15, height: 20 })) expect(e.position.percent[k]).toBeCloseTo(v, 6);
  expect(e.position.element).toEqual({ x: 340, y: 160, width: 120, height: 80 });
  expect(e.position.viewport.x).toBeCloseTo(img.x + 340, 3);
  expect(e.position.shape).toMatchObject({ label: 'ring', shape: 'ellipse' });
});

test('click on empty image emits miss, not click', async ({ page }) => {
  await setup(page);
  await clickImage(page, 250, 30);
  const ev = await events(page);
  expect(ev.map((e: any) => e.type)).toEqual(['miss']);
  expect(Math.abs(ev[0].point.image.x - 250)).toBeLessThanOrEqual(1);
  expect(Math.abs(ev[0].point.image.y - 30)).toBeLessThanOrEqual(1);
});

test('click in letterbox bar (contain) emits nothing', async ({ page }) => {
  // 800×800 box, content 800×400 centred: bars 200 px tall above and below.
  await setup(page, { img: 'display:block;width:800px;height:800px;object-fit:contain' });
  const r = await page.evaluate(() => {
    const b = document.getElementById('img')!.getBoundingClientRect();
    return { x: b.left, y: b.top };
  });
  await page.mouse.click(r.x + 500, r.y + 100); // top bar
  await page.mouse.click(r.x + 500, r.y + 700); // bottom bar
  expect(await events(page)).toEqual([]);
  await page.mouse.click(r.x + 500, r.y + 260); // content (image 250,30): empty → miss
  await page.mouse.click(r.x + 400, r.y + 400); // ring centre
  expect((await events(page)).map((e: any) => e.label ?? e.type)).toEqual(['miss', 'ring']);
});

test('drag over 5px is not a click; 4px is', async ({ page }) => {
  await setup(page);
  const p = await client(page, 200, 100);
  const drag = async (dx: number) => {
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + dx, p.y, { steps: 2 });
    await page.mouse.up();
  };
  await drag(6);
  expect(await events(page)).toEqual([]);
  await drag(4);
  await drag(5);
  expect((await events(page)).map((e: any) => [e.label, e.clicks])).toEqual([
    ['ring', 1],
    ['ring', 2],
  ]);
  // A drag across empty image is not a miss either.
  const q = await client(page, 250, 30);
  await page.mouse.move(q.x, q.y);
  await page.mouse.down();
  await page.mouse.move(q.x, q.y + 20, { steps: 3 });
  await page.mouse.up();
  expect(await events(page)).toHaveLength(2);
});

test('pointercancel produces nothing', async ({ page }) => {
  await setup(page);
  const p = await client(page, 30, 30);
  const result = await page.evaluate(({ x, y }) => {
    const w = window as any;
    const shape = document.querySelector('[data-label="box"]')!;
    const fire = (type: string, id: number) =>
      shape.dispatchEvent(
        new PointerEvent(type, { pointerId: id, isPrimary: true, button: 0, clientX: x, clientY: y, bubbles: true, composed: true }),
      );
    fire('pointerdown', 7);
    fire('pointercancel', 7);
    fire('pointerup', 7);
    const afterCancel = w.events.length;
    // Control: the same synthetic sequence without the cancel is a click.
    fire('pointerdown', 8);
    fire('pointerup', 8);
    // An up with no recorded down is ignored.
    fire('pointerup', 9);
    return { afterCancel, labels: w.events.map((e: any) => e.label ?? e.type) };
  }, p);
  expect(result.afterCancel).toBe(0);
  expect(result.labels).toEqual(['box']);
});

test('overlap resolves to the later zone', async ({ page }) => {
  await setup(page);
  await clickImage(page, 80, 60); // inside both box and overlap
  const ev = await events(page);
  expect(ev.map((e: any) => e.label)).toEqual(['overlap']);
  expect(await page.evaluate(() => (window as any).hz.zone('box').clicks)).toBe(0);
});

test('only primary button counts', async ({ page }) => {
  await setup(page);
  await clickImage(page, 30, 30, { button: 'right' });
  await clickImage(page, 250, 30, { button: 'right' });
  await clickImage(page, 30, 30, { button: 'middle' });
  expect(await events(page)).toEqual([]);
});

test('reset() returns all zones to idle and zero', async ({ page }) => {
  await setup(page);
  await clickImage(page, 30, 30);
  await clickImage(page, 30, 30);
  await clickImage(page, 340, 130);
  const before = await page.evaluate(() => (window as any).hz.state());
  expect(before.filter((s: any) => s.status === 'clicked').map((s: any) => [s.label, s.clicks])).toEqual([
    ['box', 2],
    ['tri', 1],
  ]);
  await page.evaluate(() => (window as any).hz.reset());
  const after = await page.evaluate(() => (window as any).hz.state());
  expect(after.every((s: any) => s.status === 'idle' && s.clicks === 0)).toBe(true);
  await clickImage(page, 30, 30);
  const last = (await events(page)).at(-1);
  expect([last.label, last.status, last.clicks]).toEqual(['box', 'clicked', 1]);
});

test('state() has no positions', async ({ page }) => {
  await setup(page);
  await clickImage(page, 30, 30);
  const state = await page.evaluate(() => (window as any).hz.state());
  expect(state).toEqual([
    { label: 'box', status: 'clicked', clicks: 1 },
    { label: 'overlap', status: 'idle', clicks: 0 },
    { label: 'ring', status: 'idle', clicks: 0 },
    { label: 'tri', status: 'idle', clicks: 0 },
  ]);
  // Returned objects are copies.
  await page.evaluate(() => ((window as any).hz.state()[0].clicks = 99));
  expect(await page.evaluate(() => (window as any).hz.zone('box').clicks)).toBe(1);
});

test('keyboard:false → zones not focusable', async ({ page }) => {
  await setup(page);
  const attrs = await page.evaluate(() =>
    [...document.querySelectorAll('.hitzone')].map((s) => [s.getAttribute('tabindex'), s.getAttribute('role')]),
  );
  expect(attrs.every(([t, r]) => t === null && r === null)).toBe(true);
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.classList.contains('hitzone') ?? false)).toBe(false);
  // Pressing Enter on a programmatically focused shape does nothing either.
  await page.evaluate(() => (document.querySelector('[data-label="box"]') as SVGElement).focus());
  await page.keyboard.press('Enter');
  expect(await events(page)).toEqual([]);
});

test('keyboard:true → tabindex 0, role button, aria-label from data.ariaLabel else label; Enter and Space click at centre', async ({
  page,
}) => {
  await setup(page, { options: { keyboard: true } });
  // ariaLabel comes from data; re-create with a json that has one.
  await page.evaluate(async () => {
    const w = window as any;
    w.hz.destroy();
    w.json.zones[0].data = { name: 'Box', ariaLabel: 'The red box' };
    w.hz = w.Hitzones.createZones(document.getElementById('img'), w.json, { keyboard: true });
    w.hz.on('click', (e: any) =>
      w.events.push({
        label: e.label,
        status: e.status,
        image: e.point.image,
        keyboard: e.originalEvent instanceof KeyboardEvent,
        prevented: e.originalEvent.defaultPrevented,
        key: e.originalEvent.key,
      }),
    );
    w.hz.on('miss', () => w.events.push({ type: 'miss' }));
  });
  await expect.poll(() => page.evaluate(() => (document.querySelector('svg') as SVGSVGElement).style.display)).toBe('');
  const attrs = await page.evaluate(() => ({
    hidden: document.querySelector('svg.hitzones')!.getAttribute('aria-hidden'),
    shapes: [...document.querySelectorAll('.hitzone')].map((s) => [
      s.getAttribute('tabindex'),
      s.getAttribute('role'),
      s.getAttribute('aria-label'),
    ]),
  }));
  expect(attrs.hidden).toBeNull();
  expect(attrs.shapes).toEqual([
    ['0', 'button', 'The red box'],
    ['0', 'button', 'overlap'],
    ['0', 'button', 'ring'],
    ['0', 'button', 'tri'],
  ]);
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.getAttribute('data-label'))).toBe('box');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press(' ');
  await page.keyboard.press('a'); // other keys do nothing
  await page.evaluate(() => (document.querySelector('[data-label="tri"]') as SVGElement).focus());
  await page.keyboard.press('Enter');
  const ev = await page.evaluate(() => (window as any).events);
  expect(ev).toEqual([
    { label: 'box', status: 'clicked', image: { x: 60, y: 50 }, keyboard: true, prevented: false, key: 'Enter' },
    { label: 'ring', status: 'clicked', image: { x: 200, y: 100 }, keyboard: true, prevented: true, key: ' ' },
    { label: 'tri', status: 'clicked', image: { x: 340, y: 115 }, keyboard: true, prevented: false, key: 'Enter' },
  ]);
});

test('cursor option and className reach the DOM', async ({ page }) => {
  await setup(page, { options: { cursor: 'crosshair', className: 'my-map' } });
  const r = await page.evaluate(() => {
    const svg = document.querySelector('svg')!;
    const shape = svg.querySelector('.hitzone')!;
    return { cls: svg.getAttribute('class'), cursor: getComputedStyle(shape).cursor, label: shape.getAttribute('data-label') };
  });
  expect(r).toEqual({ cls: 'my-map', cursor: 'crosshair', label: 'box' });
  await clickImage(page, 30, 30);
  expect((await events(page)).map((e: any) => e.label)).toEqual(['box']);
});

test('explicit undefined options keep the defaults', async ({ page }) => {
  await setup(page);
  const r = await page.evaluate(() => {
    const w = window as any;
    w.hz.destroy();
    w.hz = w.Hitzones.createZones(document.getElementById('img'), w.json, {
      className: undefined, cursor: undefined, keyboard: undefined, debug: undefined,
    });
    const svg = document.querySelector('svg')!;
    return { cls: svg.getAttribute('class'), cursor: getComputedStyle(svg.querySelector('.hitzone')!).cursor };
  });
  expect(r).toEqual({ cls: 'hitzones', cursor: 'pointer' });
});

test('a zone click bubbles to a wrapping <a>, not to the img', async ({ page }) => {
  await setup(page, { wrapTag: 'a' });
  await page.evaluate(() => {
    const w = window as any;
    w.native = { a: 0, img: 0 };
    document.getElementById('wrap')!.addEventListener('click', (e) => {
      w.native.a++;
      e.preventDefault();
    });
    document.getElementById('img')!.addEventListener('click', () => w.native.img++);
  });
  await clickImage(page, 30, 30);
  expect(await page.evaluate(() => (window as any).native)).toEqual({ a: 1, img: 0 });
  expect((await events(page)).map((e: any) => e.label)).toEqual(['box']);
  await clickImage(page, 250, 30);
  expect(await page.evaluate(() => (window as any).native)).toEqual({ a: 2, img: 1 });
});

test('inside an inline <a href="#"> wrapper: zones align and clicks emit', async ({ page }) => {
  await setup(page, { wrapTag: 'a', wrap: 'display:inline', img: 'width:800px;height:auto' });
  const r = await page.evaluate(() => {
    const b = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    };
    document.getElementById('wrap')!.addEventListener('click', (e) => e.preventDefault());
    return { display: getComputedStyle(document.getElementById('wrap')!).display, img: b(document.getElementById('img')!), svg: b(document.querySelector('svg')!) };
  });
  expect(r.display).toBe('inline');
  for (const k of ['x', 'y', 'width', 'height'] as const)
    expect(Math.abs(r.svg[k] - r.img[k]), `${k}: ${r.svg[k]} vs ${r.img[k]}`).toBeLessThanOrEqual(1);
  await clickImage(page, 30, 30);
  await clickImage(page, 200, 100);
  await clickImage(page, 250, 30);
  expect((await events(page)).map((e: any) => e.type + ':' + (e.label ?? ''))).toEqual(['click:box', 'click:ring', 'miss:']);
});
