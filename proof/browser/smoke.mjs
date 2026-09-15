/* One browser job: load a served page, let its requested layers settle, zoom it
 * for three seconds, and record what happened. Fails on any page error, any
 * failed same-site request, or any requested layer that does not end OK or EMPTY
 * within 45 seconds (a layer left in WAIT is a failure, not a pass).
 * Environment: PAGE (path under BASE), SIZE (phone | desktop), BASE. */
import fs from 'node:fs';
import { judge } from './judge.mjs';

const { PAGE = '', SIZE = 'phone', BASE = 'https://ventusltd.github.io/galaxies-wafers/' } = process.env;
const url = BASE + PAGE;
const viewport = SIZE === 'phone'
  ? { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
  : { width: 1400, height: 900, deviceScaleFactor: 1 };

const out = { url, size: SIZE, started: new Date().toISOString(), errors: [], failedRequests: [] };
const { default: puppeteer } = await import('puppeteer');
const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  page.on('pageerror', e => out.errors.push(e.message.slice(0, 300)));
  page.on('response', r => {
    if (r.status() >= 400 && r.url().startsWith(BASE) && !r.url().endsWith('favicon.ico')) out.failedRequests.push(`${r.status()} ${r.url()}`);
  });
  const cdp = await page.createCDPSession();
  await cdp.send('Performance.enable');
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
  out.loadMs = Date.now() - t0;

  const wanted = new URL(url).searchParams.get('layers')?.split(',').filter(Boolean) ?? [];
  const deadline = Date.now() + 45000;
  let states = {};
  while (Date.now() < deadline) {
    states = await page.evaluate(ids => Object.fromEntries(ids.map(id => {
      const cb = document.getElementById('L-' + id);
      const tag = cb?.closest('.lrow')?.querySelector('.ltag')?.textContent ?? 'absent';
      return [id, tag.replace(/[\[\]]/g, '')];
    })), wanted);
    if (Object.values(states).every(s => /^(OK|EMPTY|FAIL|absent)$/.test(s))) break;
    await new Promise(r => setTimeout(r, 500));
  }
  out.layers = states;
  out.settleMs = Date.now() - t0;

  const stage = await page.$('canvas');
  if (stage) {
    const box = await stage.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.evaluate(() => {
      window.__frames = [];
      let last = performance.now();
      const f = t => { window.__frames.push(t - last); last = t; if (window.__frames.length < 2000) requestAnimationFrame(f); };
      requestAnimationFrame(f);
    });
    const zoomEnd = Date.now() + 3000;
    let dir = -1;
    while (Date.now() < zoomEnd) { await page.mouse.wheel({ deltaY: 120 * dir }); dir = -dir; await new Promise(r => setTimeout(r, 50)); }
    const frames = await page.evaluate(() => window.__frames.slice(1).sort((a, b) => a - b));
    const q = p => frames.length ? +frames[Math.min(frames.length - 1, Math.floor(p * frames.length))].toFixed(1) : null;
    out.zoomFrames = { count: frames.length, medianMs: q(0.5), p95Ms: q(0.95) };
  }
  const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
  out.heapMB = Math.round(m.JSHeapUsedSize / 1048576);
  out.domNodes = m.Nodes;
} catch (e) {
  out.errors.push('harness: ' + e.message.slice(0, 300));
} finally {
  await browser.close();
}
Object.assign(out, judge(out));
fs.writeFileSync('smoke-result.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
process.exit(out.pass ? 0 : 1);
