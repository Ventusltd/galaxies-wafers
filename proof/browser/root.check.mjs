/* The root page, checked in a real browser against the root it replaced.
 *
 * Run from the repository root:
 *   PPTR_REQUIRE=<path to a package.json that can require puppeteer-core> \
 *   CHROME_PATH=<chrome executable> node proof/browser/root.check.mjs
 *   ENGINE=webkit PLAYWRIGHT_MODULE=<file URL of playwright's index.mjs> node proof/browser/root.check.mjs
 *
 * It serves two directories from this process: the repository (the root page as
 * it now is) and BASE_REF's root page (default: the commit before the root
 * promotion) extracted with git archive into a temporary directory outside the
 * repository. Both load the numbered database from the network, as the page does.
 *
 * Asserted, and each one printed with its measurement:
 *   1. zero page errors on every load;
 *   2. ?layers=module-Ps,module-Gn,module-x126 reaches OK on all three rows;
 *   3. ?layers=ghost shows the dropped-from-the-URL warning naming ghost;
 *   4. a pinch release opens neither the line panel nor a code card (Chrome: a
 *      real two-finger CDP touch; both engines: synthetic pointer events). The
 *      same gesture is run on the baseline and its result printed, so the gate
 *      is seen failing on the page that had the defect;
 *   5. a tap that opens a card ticks no layer checkbox;
 *   6. zoom p95 frame interval is lower than the baseline's, measured in the same
 *      run, same browser, same layers (180 frames, one wheel step per frame);
 *   7. panning across the whole wafer diameter in x and y with the tiled copying
 *      layer ticked keeps features in memory at or under the ceiling, element
 *      count growth under 150, and (Chrome) JS heap under 200 MB.
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const ENGINE = process.env.ENGINE || 'chrome';
const BASE_REF = process.env.BASE_REF || '16516e919120e05aff8e13a358026d0fd44bfe12';
const REPO = path.resolve(new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const OWNER = 'module-Ps,module-Gn,module-x126';
const results = [];
const failures = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); if (!ok) failures.push(name); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} :: ${JSON.stringify(detail)}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ── two static servers ───────────────────────────────────────────────────── */
const MIME = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
function serve(dir) {
  return new Promise(res => {
    const srv = http.createServer((q, r) => {
      let p = decodeURIComponent(new URL(q.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(dir, p);
      if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end('not found'); return; }
      r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(r);
    }).listen(0, '127.0.0.1', () => res(srv));
  });
}
const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wafer-baseline-'));
execSync(`git archive --format=tar ${BASE_REF} app.mjs layers-panel.mjs lib.mjs wafer.mjs style.css index.html layers | tar -x -C "${baseDir.replace(/\\/g, '/')}"`, { cwd: REPO, shell: true, stdio: ['ignore', 'ignore', 'inherit'] });
const [srvNew, srvOld] = await Promise.all([serve(REPO), serve(baseDir)]);
const NEW = `http://127.0.0.1:${srvNew.address().port}/`, OLD = `http://127.0.0.1:${srvOld.address().port}/`;
console.log(`engine ${ENGINE} · new ${NEW} · baseline ${BASE_REF.slice(0, 7)} at ${OLD}`);

/* ── the browser ──────────────────────────────────────────────────────────── */
/* __origRaf: the frame clock the zoom run reads. Pointer capture: a synthetic
   PointerEvent has no live pointer, so setPointerCapture would throw on it; the
   test (not the page) makes that call tolerant so synthetic gestures can run. */
const INSTR = `(() => {
  window.__origRaf = window.requestAnimationFrame.bind(window);
  const cap = Element.prototype.setPointerCapture;
  Element.prototype.setPointerCapture = function (id) { try { return cap.call(this, id); } catch (e) { return undefined; } };
})();`;
let browser;
async function newPage() {
  let page, cdp = null;
  if (ENGINE === 'webkit') {
    const { webkit, devices } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
    browser ||= await webkit.launch();
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    page = await ctx.newPage();
    await page.addInitScript(INSTR);
  } else {
    if (!process.env.PPTR_REQUIRE || !process.env.CHROME_PATH) throw new Error('set PPTR_REQUIRE and CHROME_PATH');
    const puppeteer = createRequire(process.env.PPTR_REQUIRE)('puppeteer-core');
    browser ||= await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: 'new',
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
    page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await page.evaluateOnNewDocument(INSTR);
    cdp = await page.createCDPSession();
    await cdp.send('Performance.enable');
  }
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  page.on('crash', () => errors.push('CRASH'));
  const goto = u => page.goto(u, { waitUntil: ENGINE === 'webkit' ? 'networkidle' : 'networkidle0', timeout: 90000 });
  const until = (fn, arg, ms = 60000) => ENGINE === 'webkit' ? page.waitForFunction(fn, arg, { timeout: ms }) : page.waitForFunction(fn, { timeout: ms }, arg);
  const close = () => ENGINE === 'webkit' ? page.context().close() : page.close();
  return { page, cdp, errors, goto, until, close };
}
const tagsOf = (page, ids) => page.evaluate(ids => ids.map(id => (document.getElementById('L-' + id)?.closest('.lrow')?.querySelector('.ltag')?.textContent || 'absent').replace(/[\[\]]/g, '')), ids);
const allOK = ids => ids.every(id => /\[OK\]/.test(document.getElementById('L-' + id)?.closest('.lrow')?.textContent || ''));

/* one wheel step per animation frame for 180 frames; intervals between frames */
const zoomRun = page => page.evaluate(async () => {
  const raf = window.__origRaf, stage = document.getElementById('stage'), r = stage.getBoundingClientRect();
  const iv = []; let last = 0;
  for (let i = 0; i < 180; i++) {
    await new Promise(res => raf(() => { const n = performance.now(); if (last) iv.push(n - last); last = n;
      stage.dispatchEvent(new WheelEvent('wheel', { deltaY: (i % 60) < 30 ? -40 : 40, clientX: r.width / 2, clientY: r.height / 2, bubbles: true, cancelable: true }));
      res(); }));
  }
  await new Promise(res => setTimeout(res, 400));
  const s = iv.sort((x, y) => x - y), q = p => +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1);
  return { median: q(0.5), p95: q(0.95) };
});

/* a pinch as pointer events on the stage: two fingers apart, then lifted one by one */
const syntheticPinch = page => page.evaluate(async () => {
  const st = document.getElementById('stage');
  const ev = (type, id, x, y) => st.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 11, clientX: x, clientY: y, bubbles: true, cancelable: true }));
  ev('pointerdown', 11, 185, 420); ev('pointerdown', 12, 205, 420);
  for (let i = 1; i <= 10; i++) { ev('pointermove', 11, 185 - i * 6, 420); ev('pointermove', 12, 205 + i * 6, 420); await new Promise(r => requestAnimationFrame(r)); }
  ev('pointerup', 12, 265, 420);
  ev('pointerup', 11, 125, 420);   /* the last finger lifts where it has not moved since the other lifted */
  await new Promise(r => setTimeout(r, 300));
});
const cdpPinch = async (cdp) => {
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1 })) });
  await touch('touchStart', [[175, 400], [215, 400]]);
  for (let i = 1; i <= 20; i++) { await touch('touchMove', [[175 - i * 5, 400], [215 + i * 5, 400]]); await sleep(16); }
  await touch('touchEnd', [[75, 400]]);
  await sleep(30);
  await touch('touchEnd', []);
  await sleep(400);
};
const opened = page => page.evaluate(() => ({ panel: !document.getElementById('panel').hidden, card: !!document.getElementById('card') && !document.getElementById('card').hidden, inspect: !!document.getElementById('layersInspect') && !document.getElementById('layersInspect').hidden }));

try {
  /* 2, 6 (new), 4, 5 */
  {
    const P = await newPage();
    await P.goto(NEW + '?layers=' + OWNER);
    await P.until(allOK, OWNER.split(',')).catch(() => {});
    const tags = await tagsOf(P.page, OWNER.split(','));
    check('owner layers reach OK', tags.every(t => t === 'OK'), { tags, url: await P.page.evaluate(() => location.search) });
    await sleep(1200);
    const zNew = [await zoomRun(P.page), await zoomRun(P.page)];

    await syntheticPinch(P.page);
    const synth = await opened(P.page);
    let real = null;
    if (P.cdp) { await cdpPinch(P.cdp); real = await opened(P.page); }
    check('pinch release opens no panel or card', !synth.panel && !synth.card && (!real || (!real.panel && !real.card)), { synthetic: synth, cdpTouch: real });

    const before = await P.page.evaluate(() => [...document.querySelectorAll('#layersList input')].filter(i => i.checked).map(i => i.id));
    await P.page.touchscreen.tap(195, 430);
    await sleep(2500);
    const afterTap = await opened(P.page);
    const after = await P.page.evaluate(() => [...document.querySelectorAll('#layersList input')].filter(i => i.checked).map(i => i.id));
    check('a tap opens a code card and ticks no checkbox', afterTap.card && JSON.stringify(before) === JSON.stringify(after), { card: afterTap.card, checkedBefore: before, checkedAfter: after });
    check('zero page errors (owner link, zoom, pinch, tap)', P.errors.length === 0, P.errors);
    await P.close();

    /* the same on the baseline */
    const B = await newPage();
    await B.goto(OLD + '?layers=' + OWNER);
    await B.until(allOK, OWNER.split(',')).catch(() => {});
    await sleep(1200);
    const zOld = [await zoomRun(B.page), await zoomRun(B.page)];
    await syntheticPinch(B.page);
    const bSynth = await opened(B.page);
    await B.page.click('#close').catch(() => {});
    await B.page.evaluate(() => { document.getElementById('panel').hidden = true; });
    let bReal = null;
    if (B.cdp) { await cdpPinch(B.cdp); bReal = await opened(B.page); }
    console.log(`baseline pinch release (the defect, expected open): ${JSON.stringify({ synthetic: bSynth, cdpTouch: bReal })}`);
    await B.close();

    const p95 = z => Math.min(...z.map(r => r.p95));
    check('zoom p95 frame interval lower than the baseline root', p95(zNew) < p95(zOld), { newRuns: zNew, baselineRuns: zOld, newBestP95: p95(zNew), baselineBestP95: p95(zOld) });
  }

  /* 3 */
  {
    const P = await newPage();
    await P.goto(NEW + '?layers=ghost');
    await P.until(() => /dropped from the URL[^]*ghost/.test(document.getElementById('layers')?.textContent || ''), null, 30000).catch(() => {});
    const warn = await P.page.evaluate(() => { const w = [...document.querySelectorAll('#layers .lwarn')].find(n => !n.hidden && /ghost/.test(n.textContent)); return w ? w.textContent : null; });
    check('?layers=ghost shows the dropped warning', !!warn, { warn, errors: P.errors });
    check('zero page errors (ghost link)', P.errors.length === 0, P.errors);
    await P.close();
  }

  /* 7 */
  {
    const P = await newPage();
    await P.goto(NEW + '?layers=copying,' + OWNER);
    await P.until(allOK, ['copying', ...OWNER.split(',')]).catch(() => {});
    const home = await P.page.evaluate(() => window.__waferLayers.stats);
    await P.page.evaluate(async () => {
      const stage = document.getElementById('stage');
      for (let i = 0; i < 60; i++) { stage.dispatchEvent(new WheelEvent('wheel', { deltaY: -40, clientX: 195, clientY: 422, bubbles: true, cancelable: true })); await new Promise(r => requestAnimationFrame(r)); }
    });
    await sleep(1200);
    const zoom = await P.page.evaluate(() => window.__wafer.view.zoom);
    const R = await P.page.evaluate(() => Math.sqrt(342795));
    const samples = [];
    const sample = async () => {
      const s = await P.page.evaluate(() => ({ ...window.__waferLayers.stats, dom: document.getElementsByTagName('*').length, heap: performance.memory ? performance.memory.usedJSHeapSize : null, x: window.__wafer.view.x, y: window.__wafer.view.y }));
      if (P.cdp) { const m = await P.cdp.send('Performance.getMetrics'); s.nodes = m.metrics.find(x => x.name === 'Nodes').value; }
      samples.push(s);
    };
    await sample();
    /* drags as pointer events on the stage: the same handler a finger reaches */
    const drag = (dx, dy) => P.page.evaluate(async ([dx, dy]) => {
      const st = document.getElementById('stage');
      const ev = (type, x, y) => st.dispatchEvent(new PointerEvent(type, { pointerId: 21, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true }));
      ev('pointerdown', 195, 422);
      for (let i = 1; i <= 6; i++) { ev('pointermove', 195 + dx * i / 6, 422 + dy * i / 6); await new Promise(r => requestAnimationFrame(r)); }
      ev('pointerup', 195 + dx, 422 + dy);
    }, [dx, dy]);
    const per = 300 / zoom, n = d => Math.ceil(d / per);
    for (let i = 0; i < n(R); i++) await drag(300, 0);
    await sleep(500); await sample();
    for (let i = 0; i < n(2 * R); i++) { await drag(-300, 0); await sleep(180); if (i % 4 === 0) await sample(); }
    for (let i = 0; i < n(R); i++) await drag(300, 0);
    for (let i = 0; i < n(R); i++) await drag(0, 300);
    await sleep(500);
    for (let i = 0; i < n(2 * R); i++) { await drag(0, -300); await sleep(180); if (i % 4 === 0) await sample(); }
    await sleep(1500); await sample();
    const max = k => Math.max(...samples.map(s => s[k] ?? 0)), min = k => Math.min(...samples.map(s => s[k] ?? 0));
    const detail = { zoom: +zoom.toFixed(2), samples: samples.length, atHomeHeld: home.held,
      xRange: [Math.round(min('x')), Math.round(max('x'))], yRange: [Math.round(min('y')), Math.round(max('y'))],
      maxHeld: max('held'), cap: samples[0].cap, maxBands: max('bandsInMemory'), maxKeysDrawn: max('keysDrawn'), evictions: samples.at(-1).evictions, fetches: samples.at(-1).fetches,
      domMin: min('dom'), domMax: max('dom'), cdpNodesMax: P.cdp ? max('nodes') : null,
      heapMaxMB: samples[0].heap ? +(max('heap') / 1e6).toFixed(1) : null, heapEndMB: samples[0].heap ? +(samples.at(-1).heap / 1e6).toFixed(1) : null };
    const crossed = detail.xRange[0] < -R * 0.8 && detail.xRange[1] > R * 0.8 && detail.yRange[0] < -R * 0.8 && detail.yRange[1] > R * 0.8;
    check('pan across the whole wafer keeps memory, DOM and heap bounded',
      crossed && detail.maxHeld <= detail.cap && detail.domMax - detail.domMin < 150 && (detail.heapMaxMB === null || detail.heapMaxMB < 200), detail);
    check('zero page errors (pan)', P.errors.length === 0, P.errors);
    await P.close();
  }
} catch (e) {
  check('the check ran to the end', false, String(e && e.stack || e).slice(0, 400));
} finally {
  await browser?.close();
  srvNew.close(); srvOld.close();
  fs.rmSync(baseDir, { recursive: true, force: true });
}
console.log(failures.length ? `root check FAILED (${failures.length} of ${results.length}): ${failures.join('; ')}` : `root check PASS — ${results.length} assertions, ${ENGINE}`);
process.exit(failures.length ? 1 : 0);
