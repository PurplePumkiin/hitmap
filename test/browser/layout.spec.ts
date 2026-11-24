import { expect, test, type Page } from '@playwright/test';

type Setup = {
  wrap?: string; // inline style for the image's parent
  img?: string; // inline style for the <img>
  src?: string | null; // null = no src at all
  wait?: boolean; // wait for the image to load before createZones
  create?: boolean;
};

const SCENE = '/test/fixtures/scene.svg';
const SQUARE =
  'data:image/svg+xml,' +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#888"/></svg>');

async function setup(page: Page, s: Setup = {}) {
  await page.goto('/test/fixtures/harness.html');
  await page.evaluate(async (s) => {
    const w = window as any;
    const root = document.getElementById('root')!;
    root.innerHTML = `<div id="wrap" style="${s.wrap ?? ''}"><img id="img" alt="" style="${s.img ?? ''}"></div>`;
    const img = document.getElementById('img') as HTMLImageElement;
    w.json = await (await fetch('/test/fixtures/zones.json')).json();
    w.frame = 0;
    const tick = () => {
      w.frame++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    if (s.src !== null) {
      const loaded = new Promise((r) => img.addEventListener('load', r, { once: true }));
      img.src = s.src ?? '/test/fixtures/scene.svg';
      if (s.wait) await loaded;
    }
    if (s.create !== false) {
      w.hz = w.Hitzones.createZones(img, w.json);
      w.hz.on('layout', (e: any) => w.events.push({ type: 'layout', frame: w.frame, e }));
    }
  }, s);
}

const layouts = (page: Page) => page.evaluate(() => (window as any).events.filter((e: any) => e.type === 'layout').length);
const frames = (page: Page, n = 3) =>
  page.evaluate(
    (n) =>
      new Promise<void>((r) => {
        let i = 0;
        const f = () => (++i >= n ? r() : requestAnimationFrame(f));
        requestAnimationFrame(f);
      }),
    n,
  );
async function nextLayout(page: Page, before: number) {
  await expect.poll(() => layouts(page)).toBeGreaterThan(before);
}

function rects(page: Page) {
  return page.evaluate(() => {
    const img = document.getElementById('img')!;
    const svg = document.querySelector('svg.hitzones') as SVGSVGElement;
    const r = (el: Element) => {
      const b = el.getBoundingClientRect();
      return { x: b.left, y: b.top, width: b.width, height: b.height };
    };
    return { img: r(img), svg: r(svg), viewBox: svg.getAttribute('viewBox') };
  });
}

function near(a: Record<string, number>, b: Record<string, number>, tol = 1) {
  for (const k of Object.keys(b)) expect(Math.abs(a[k] - b[k]), `${k}: ${a[k]} vs ${b[k]}`).toBeLessThanOrEqual(tol);
}

test('svg sits exactly over the content box at 320, 800 and 1600 px', async ({ page }) => {
  await page.setViewportSize({ width: 1700, height: 1000 });
  await setup(page, { wrap: 'width:320px', img: 'display:block;width:100%;height:auto' });
  await nextLayout(page, 0);
  for (const width of [320, 800, 1600]) {
    const before = await layouts(page);
    await page.evaluate((w) => (document.getElementById('wrap')!.style.width = `${w}px`), width);
    if (width !== 320) await nextLayout(page, before);
    await frames(page);
    const r = await rects(page);
    expect(r.img.width).toBeCloseTo(width, 0);
    near(r.svg, r.img);
    expect(r.viewBox).toBe('0 0 400 200');
  }
});

test('object-fit: cover crops; viewBox matches the visible source rect', async ({ page }) => {
  await setup(page, { img: 'display:block;width:200px;height:200px;object-fit:cover' });
  await nextLayout(page, 0);
  const r = await rects(page);
  near(r.svg, r.img);
  expect(r.viewBox).toBe('100 0 200 200');
});

test('object-position right 10px bottom 10px (computed as calc) aligns under cover', async ({ page }) => {
  await setup(page, { img: 'display:block;width:200px;height:200px;object-fit:cover;object-position:right 10px bottom 10px' });
  await nextLayout(page, 0);
  const r = await rects(page);
  // Content is 400×200 at (-210, -10); the visible 190×190 starts at source (210, 10).
  near(r.svg, { x: r.img.x, y: r.img.y, width: 190, height: 190 });
  expect(r.viewBox).toBe('210 10 190 190');
});

test('contain letterboxes; svg excludes the bars', async ({ page }) => {
  await setup(page, { img: 'display:block;width:400px;height:400px;object-fit:contain' });
  await nextLayout(page, 0);
  const r = await rects(page);
  near(r.svg, { x: r.img.x, y: r.img.y + 100, width: 400, height: 200 });
  expect(r.viewBox).toBe('0 0 400 200');
});

test('padding and border are excluded', async ({ page }) => {
  await setup(page, { img: 'display:block;width:400px;height:200px;padding:10px;border:5px solid #000' });
  await nextLayout(page, 0);
  const r = await rects(page);
  expect(r.img.width).toBe(430);
  near(r.svg, { x: r.img.x + 15, y: r.img.y + 15, width: 400, height: 200 });
  const box = await page.evaluate(() => (window as any).hz.zone('box').position.element);
  near(box, { x: 35, y: 35, width: 80, height: 60 });
});

test('static parent becomes relative and is restored by destroy()', async ({ page }) => {
  await setup(page, { wrap: 'position:static;width:400px', img: 'display:block;width:100%' });
  await nextLayout(page, 0);
  expect(await page.evaluate(() => document.getElementById('wrap')!.style.position)).toBe('relative');
  await page.evaluate(() => (window as any).hz.destroy());
  expect(await page.evaluate(() => document.getElementById('wrap')!.style.position)).toBe('static');
  expect(await page.evaluate(() => document.querySelectorAll('svg').length)).toBe(0);
  const before = await layouts(page);
  await page.evaluate(() => {
    document.getElementById('wrap')!.style.width = '300px';
    window.dispatchEvent(new Event('resize'));
  });
  await frames(page, 5);
  expect(await layouts(page)).toBe(before);
});

test('an already positioned parent is left alone', async ({ page }) => {
  await setup(page, { wrap: 'position:absolute;left:30px;top:40px', img: 'display:block;width:400px' });
  await nextLayout(page, 0);
  expect(await page.evaluate(() => document.getElementById('wrap')!.style.position)).toBe('absolute');
  near((await rects(page)).svg, (await rects(page)).img);
  await page.evaluate(() => (window as any).hz.destroy());
  expect(await page.evaluate(() => document.getElementById('wrap')!.style.position)).toBe('absolute');
});

test('layout fires once per frame on resize with every zone position', async ({ page }) => {
  await setup(page, { wrap: 'width:400px', img: 'display:block;width:100%' });
  await nextLayout(page, 0);
  await frames(page);
  const before = await layouts(page);
  await page.evaluate(() => {
    const wrap = document.getElementById('wrap')!;
    for (const w of [300, 250, 200]) {
      wrap.style.width = `${w}px`;
      window.dispatchEvent(new Event('resize'));
    }
  });
  await nextLayout(page, before);
  await frames(page, 5);
  const evs = await page.evaluate(() => (window as any).events.filter((e: any) => e.type === 'layout'));
  const fresh = evs.slice(before);
  const perFrame = new Set(fresh.map((e: any) => e.frame));
  expect(perFrame.size).toBe(fresh.length);
  const last = fresh[fresh.length - 1].e;
  expect(last.zones.map((z: any) => z.label)).toEqual(['box', 'overlap', 'ring', 'tri']);
  const box = last.zones[0].position;
  near(box.element, { x: 10, y: 10, width: 40, height: 30 }, 0.01);
  near(box.percent, { x: 5, y: 10, width: 20, height: 30 }, 0.01);
  expect(box.image).toEqual({ x: 20, y: 20, width: 80, height: 60 });
  expect(box.shape).toBeUndefined();
  expect(last.zones[2].position.shape).toMatchObject({ shape: 'ellipse', cx: 200 });
  expect(last.zones[3].position.shape).toMatchObject({ shape: 'polygon' });
});

test('layout fires for an image that was already loaded', async ({ page }) => {
  await setup(page, { img: 'display:block;width:400px', wait: true, create: false });
  expect(await page.evaluate(() => (document.getElementById('img') as HTMLImageElement).complete)).toBe(true);
  await page.evaluate(() => {
    const w = window as any;
    w.hz = w.Hitzones.createZones(document.getElementById('img'), w.json);
    w.hz.on('layout', (e: any) => w.events.push({ type: 'layout', frame: w.frame, e }));
  });
  await nextLayout(page, 0);
  near((await rects(page)).svg, (await rects(page)).img);
});

test('display:none pauses layout; showing it fires layout', async ({ page }) => {
  await setup(page, { img: 'display:none;width:400px', wait: true });
  await frames(page, 5);
  expect(await layouts(page)).toBe(0);
  expect(await page.evaluate(() => (window as any).hz.zone('box').position)).toBeNull();
  await page.evaluate(() => (document.getElementById('img')!.style.display = 'block'));
  await nextLayout(page, 0);
  near((await rects(page)).svg, (await rects(page)).img);
  await page.evaluate(() => (document.getElementById('img')!.style.display = 'none'));
  await frames(page);
  expect(await page.evaluate(() => (window as any).hz.zone('box').position)).toBeNull();
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('svg.hitzones')!).display)).toBe('none');
});

test('src change re-runs layout and warns once on aspect mismatch >1%', async ({ page }) => {
  const warns: string[] = [];
  page.on('console', (m) => m.type() === 'warning' && warns.push(m.text()));
  await setup(page, { img: 'display:block;width:400px', wait: true });
  await nextLayout(page, 0);
  expect(warns).toHaveLength(0);
  const swap = async (src: string) => {
    const before = await layouts(page);
    await page.evaluate((src) => {
      const img = document.getElementById('img') as HTMLImageElement;
      return new Promise((r) => {
        img.addEventListener('load', r, { once: true });
        img.src = src;
      });
    }, src);
    await nextLayout(page, before);
  };
  await swap(SQUARE);
  // 400px wide square: the zones now map onto a 400×400 content box
  const h = await page.evaluate(() => (window as any).hz.zone('box').position.element.height);
  expect(h).toBeCloseTo(120, 1);
  expect(warns).toHaveLength(1);
  expect(warns[0]).toContain('hitzones');
  await swap(SCENE);
  await swap(SQUARE);
  expect(warns).toHaveLength(1);
});

test('zone() returns null position before load and for unknown labels', async ({ page }) => {
  await setup(page, { src: null, img: 'display:block;width:400px' });
  const before = await page.evaluate(() => {
    const hz = (window as any).hz;
    return { box: hz.zone('box'), nope: hz.zone('nope'), state: hz.state() };
  });
  expect(before.box).toEqual({ label: 'box', status: 'idle', clicks: 0, data: { name: 'Box' }, position: null });
  expect(before.nope).toBeNull();
  expect(before.state).toEqual(
    ['box', 'overlap', 'ring', 'tri'].map((label) => ({ label, status: 'idle', clicks: 0 })),
  );
  await frames(page);
  expect(await layouts(page)).toBe(0);
  await page.evaluate((src) => ((document.getElementById('img') as HTMLImageElement).src = src), SCENE);
  await nextLayout(page, 0);
  const ring = await page.evaluate(() => (window as any).hz.zone('ring'));
  expect(ring.position.image).toEqual({ x: 170, y: 80, width: 60, height: 40 });
  expect(ring.position.shape.shape).toBe('ellipse');
  await page.evaluate(() => (window as any).hz.reset());
  expect(await page.evaluate(() => (window as any).hz.zone('ring').status)).toBe('idle');
});

test('on() returns an unsubscribe function', async ({ page }) => {
  await setup(page, { wrap: 'width:400px', img: 'display:block;width:100%', wait: true, create: false });
  await page.evaluate(() => {
    const w = window as any;
    w.count = 0;
    w.hz = w.Hitzones.createZones(document.getElementById('img'), w.json);
    w.off = w.hz.on('layout', () => w.count++);
    w.hz.on('layout', (e: any) => w.events.push({ type: 'layout', frame: w.frame, e }));
  });
  await nextLayout(page, 0);
  await page.evaluate(() => (window as any).off());
  const count = await page.evaluate(() => (window as any).count);
  const before = await layouts(page);
  await page.evaluate(() => (document.getElementById('wrap')!.style.width = '200px'));
  await nextLayout(page, before);
  expect(await page.evaluate(() => (window as any).count)).toBe(count);
});

test('destroy then create again works; two maps are independent', async ({ page }) => {
  await setup(page, { wrap: 'width:400px', img: 'display:block;width:100%', wait: true });
  await nextLayout(page, 0);
  const result = await page.evaluate(async () => {
    const w = window as any;
    const img = document.getElementById('img') as HTMLImageElement;
    const wrap = document.getElementById('wrap')!;
    const seen = { old: 0, again: 0, other: 0 };
    w.hz.on('layout', () => seen.old++);
    w.hz.destroy();
    w.hz.destroy(); // idempotent
    const again = w.Hitzones.createZones(img, w.json);
    again.on('layout', () => seen.again++);

    const img2 = img.cloneNode() as HTMLImageElement;
    img2.id = 'img2';
    const wrap2 = document.createElement('div');
    wrap2.style.width = '300px';
    wrap2.append(img2);
    document.getElementById('root')!.append(wrap2);
    await new Promise((r) => (img2.complete ? r(0) : img2.addEventListener('load', r, { once: true })));
    const other = w.Hitzones.createZones(img2, { ...w.json, zones: w.json.zones.slice(0, 1) });
    other.on('layout', () => seen.other++);

    const frames = (n: number) =>
      new Promise((r) => {
        let i = 0;
        const f = () => (++i >= n ? r(0) : requestAnimationFrame(f));
        requestAnimationFrame(f);
      });
    await frames(3);
    const mid = { ...seen };
    wrap.style.width = '250px';
    await frames(3);
    const svgs = wrap.querySelectorAll('svg').length;
    const after = { ...seen };
    const states = [again.state().length, other.state().length];
    other.destroy();
    const svgsAfterOther = document.querySelectorAll('svg').length;
    return { mid, after, svgs, states, svgsAfterOther, otherBox: other.zone('box') };
  });
  expect(result.svgs).toBe(1);
  expect(result.mid.old).toBe(0);
  expect(result.after.old).toBe(0);
  expect(result.mid.again).toBeGreaterThanOrEqual(1);
  expect(result.mid.other).toBeGreaterThanOrEqual(1);
  expect(result.after.again).toBeGreaterThan(result.mid.again);
  expect(result.after.other).toBe(result.mid.other); // resizing map 1 doesn't touch map 2
  expect(result.states).toEqual([4, 1]);
  expect(result.svgsAfterOther).toBe(1);
});

test('works under transform: scale(.5) and inside a scrolled container', async ({ page }) => {
  await setup(page, {
    wrap: 'transform:scale(.5);transform-origin:0 0;width:400px;margin-top:300px',
    img: 'display:block;width:100%',
    wait: true,
  });
  await page.evaluate(() => {
    const root = document.getElementById('root')!;
    root.style.cssText = 'height:300px;overflow:auto';
    const tall = document.createElement('div');
    tall.style.height = '2000px';
    root.append(tall);
  });
  await nextLayout(page, 0);
  await page.evaluate(() => (document.getElementById('root')!.scrollTop = 150));
  await frames(page);
  const r = await page.evaluate(() => {
    const b = document.querySelector('[data-label="box"]')!.getBoundingClientRect();
    return {
      drawn: { x: b.left, y: b.top, width: b.width, height: b.height },
      reported: (window as any).hz.zone('box').position.viewport,
    };
  });
  near(r.reported, r.drawn);
  expect(r.drawn.width).toBeCloseTo(40, 0);
});

test('zones are drawn in file order with the documented attributes', async ({ page }) => {
  await setup(page, { img: 'display:block;width:400px', wait: true });
  await nextLayout(page, 0);
  const info = await page.evaluate(() => {
    const svg = document.querySelector('svg.hitzones') as SVGSVGElement;
    const s = getComputedStyle(svg);
    return {
      sibling: document.getElementById('img')!.nextElementSibling === svg,
      par: svg.getAttribute('preserveAspectRatio'),
      pe: s.pointerEvents,
      pos: s.position,
      shapes: [...svg.children].map((c) => ({
        tag: c.tagName.toLowerCase(),
        label: c.getAttribute('data-label'),
        cls: c.getAttribute('class'),
        pe: getComputedStyle(c).pointerEvents,
        cursor: getComputedStyle(c).cursor,
      })),
    };
  });
  expect(info.sibling).toBe(true);
  expect(info.par).toBe('none');
  expect(info.pe).toBe('none');
  expect(info.pos).toBe('absolute');
  expect(info.shapes).toEqual([
    { tag: 'rect', label: 'box', cls: 'hitzone', pe: 'all', cursor: 'pointer' },
    { tag: 'rect', label: 'overlap', cls: 'hitzone', pe: 'all', cursor: 'pointer' },
    { tag: 'ellipse', label: 'ring', cls: 'hitzone', pe: 'all', cursor: 'pointer' },
    { tag: 'polygon', label: 'tri', cls: 'hitzone', pe: 'all', cursor: 'pointer' },
  ]);
});

test('createZones throws TypeError on invalid JSON', async ({ page }) => {
  await setup(page, { create: false });
  const msg = await page.evaluate(() => {
    try {
      (window as any).Hitzones.createZones(document.getElementById('img'), { hitzones: 2 });
      return 'no throw';
    } catch (e) {
      return e instanceof TypeError && /^hitzones: /.test((e as Error).message) ? 'TypeError' : String(e);
    }
  });
  expect(msg).toBe('TypeError');
  expect(await page.evaluate(() => document.querySelectorAll('svg').length)).toBe(0);
});

// The rect of the img's content box (border-box minus border and padding), in viewport px.
function contentRect(page: Page) {
  return page.evaluate(() => {
    const img = document.getElementById('img')!;
    const svg = document.querySelector('svg.hitzones')!;
    const b = img.getBoundingClientRect();
    const cs = getComputedStyle(img);
    const n = (p: string) => parseFloat(cs.getPropertyValue(p)) || 0;
    const l = n('border-left-width') + n('padding-left');
    const t = n('border-top-width') + n('padding-top');
    const r = n('border-right-width') + n('padding-right');
    const bt = n('border-bottom-width') + n('padding-bottom');
    const s = svg.getBoundingClientRect();
    return {
      content: { x: b.left + l, y: b.top + t, width: b.width - l - r, height: b.height - t - bt },
      svg: { x: s.left, y: s.top, width: s.width, height: s.height },
    };
  });
}

test('svg follows when content above the image grows', async ({ page }) => {
  await setup(page, { wrap: 'width:400px', img: 'display:block;width:100%', wait: true });
  await nextLayout(page, 0);
  await page.evaluate(() => {
    const block = document.createElement('div');
    block.style.height = '50px';
    document.getElementById('wrap')!.prepend(block);
  });
  await frames(page);
  const r = await contentRect(page);
  near(r.svg, r.content, 0.5);
});

test('svg follows a margin change on the img', async ({ page }) => {
  await setup(page, { wrap: 'width:600px', img: 'display:block;width:400px', wait: true });
  await nextLayout(page, 0);
  await page.evaluate(() => (document.getElementById('img')!.style.margin = '23px 0 0 41px'));
  await frames(page);
  const r = await contentRect(page);
  near(r.svg, r.content, 0.5);
});

test('fractional width (33.3%) stays aligned within 0.5px', async ({ page }) => {
  await setup(page, {
    wrap: 'width:1000px;padding-left:7.3px',
    img: 'display:block;width:33.3%;margin-left:10.4px;padding:3.3px;border:1.7px solid #000',
    wait: true,
  });
  await nextLayout(page, 0);
  const r = await contentRect(page);
  near(r.svg, r.content, 0.5);
});

test('no layout event when nothing changed', async ({ page }) => {
  await setup(page, { wrap: 'width:400px', img: 'display:block;width:100%', wait: true });
  await nextLayout(page, 0);
  await frames(page);
  const before = await layouts(page);
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await frames(page, 4);
  expect(await layouts(page)).toBe(before);
});
