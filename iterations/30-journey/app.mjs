/* Journey: the Line Wafer read by level of detail, and by following one thread.
 *
 * Started from iteration 21 (dark pixels). What changed is the whole drawing
 * model: 21 hands every one of the numbered lines to the GPU every frame. This
 * page never does. It draws only what the current level of detail needs, the
 * way a map gates its 11 kV lines behind a zoom and a streaming game only
 * builds what is near the camera:
 *
 *   GALAXY   no individual lines. A density image of the substrate, built once
 *            at load into a small offscreen canvas, and each woken module route
 *            as one thick simplified trunk through its functions' first lines.
 *   SYSTEM   module routes as cased lines, the first line of each function as a
 *            white dot (tap for its card), labels for the largest routes, and
 *            shared lines as substation symbols with their count.
 *   PLANET   individual lines, but only those whose key lies in the radius band
 *            the screen can see. The band comes from the placement law itself:
 *            r = S * sqrt(key), so a screen whose nearest and farthest points
 *            from the centre are r0 and r1 can only show keys in
 *            [(r0/S)^2, (r1/S)^2]. Those keys are found by binary search.
 *   SURFACE  the same band, larger, and every line can be tapped for its card.
 *
 * The level, the band and the number of keys drawn are printed every frame,
 * counted, never typed.
 *
 * FOLLOW. Pick a thread (a module route, a function inside it, or a chain of
 * functions copied under other names) and the camera drives it stop by stop.
 * The strip at the bottom redraws the same thread as a single straight line
 * with its stops as busbars, the way a single-line diagram untangles a
 * network; a stop that other threads also pass through is drawn as a
 * substation symbol with its count, not as crossing lines.
 *
 * WHAT IS NOT CLAIMED. A route is a function's lines in numbering order and a
 * junction is one numbered line carried by more than one route. Neither is a
 * call graph or a dependency. The single-line-diagram drawing is a way of
 * reading code; it is not an electrical diagram and shows no electrical result.
 */

import { place, placeAll, indexOfKey, esc, fmt, SPACING } from '../../lib.mjs';

const DATA = 'https://globalgrid2050.com/testcode/202609142202/data/';
const MANIFEST = '../../layers/manifest.json';
const S = SPACING;

const LEVELS = [
  { id: 'GALAXY',  min: 0,  go: 0 },
  { id: 'SYSTEM',  min: 1,  go: 1.8 },
  { id: 'PLANET',  min: 5,  go: 9 },
  { id: 'SURFACE', min: 28, go: 48 }
];
const levelOf = z => z >= LEVELS[3].min ? 3 : z >= LEVELS[2].min ? 2 : z >= LEVELS[1].min ? 1 : 0;
const DRAW_CAP = 60000;   /* a hard ceiling on points per frame; reaching it is printed */
const BANDS = 10;         /* radius bands used by the pattern questions: tenths of the wafer radius */

const $ = id => document.getElementById(id);
const stage = $('stage');
const ctx = stage.getContext('2d', { alpha: false });

const U = { keys: null, lens: null, inFam: null, pos: null, n: 0, meta: null, maxR: 0,
            families: null, famLines: null, famCount: null, tier2: 'WAIT' };
const view = { x: 0, y: 0, zoom: 1, w: 0, h: 0, dpr: 1 };
const stats = { frames: [], last: null, stopsVisited: 0 };
const F = { thread: null, i: 0, keySet: null, cross: null };
window.__journey = { stats, get view() { return { ...view }; },
  get follow() { return F.thread ? { id: F.thread.id, stop: F.i, stops: F.thread.stops.length, key: F.thread.stops[F.i].key } : null; } };

/* ── modules: the manifest, a bounded queue, and what each key is part of ─── */

const MODS = [];                 /* manifest rows for module layers, in manifest order */
const MOD = new Map();           /* id -> row; row.state WAIT LOAD OK EMPTY FAIL; row.data when loaded */
const keyMods = new Map();       /* key -> Map(moduleId -> function name) */
let hubs = [];                   /* [key, count] where two or more woken routes share a line */

/* Loading, as Grid Atlas does it (repd_grid_atlasv8 ventus-corev8engine.js):
   one fetch queue for all network work, a timeout on every fetch, one shared
   promise per URL that is dropped again on failure so a retry is possible, and
   a hydrate that returns at once when a thing is loaded or loading. The Atlas
   queue runs four at a time; the wafer's builder rules cap it at three. */
const QUEUE_MAX = 3, FETCH_TIMEOUT_MS = 15000;
const Q = []; let active = 0;
function enqueue(task) {
  return new Promise((res, rej) => { Q.push({ task, res, rej }); pump(); });
}
function pump() {
  while (active < QUEUE_MAX && Q.length) {
    const j = Q.shift(); active++;
    j.task().then(j.res, j.rej).finally(() => { active--; pump(); });
  }
}
async function fetchWithTimeout(url) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url.replace(/^.*\/(layers|data)\//, '$1/')}`);
    return r;
  } catch (e) {
    throw e.name === 'AbortError' ? new Error(`timed out after ${FETCH_TIMEOUT_MS / 1000} s: ${url.replace(/^.*\//, '')}`) : e;
  } finally { clearTimeout(t); }
}
const urlCache = new Map();
function fetchJSON(url) {
  if (urlCache.has(url)) return urlCache.get(url);
  const p = enqueue(() => fetchWithTimeout(url).then(r => r.json()))
    .catch(e => { urlCache.delete(url); throw e; });
  urlCache.set(url, p);
  return p;
}
const fetchBin = (url, Kind) => enqueue(() => fetchWithTimeout(url).then(r => r.arrayBuffer())).then(b => new Kind(b));

/* ── copied lines, tiled by radius band: fetched only when the view reaches them ──
   layers/tiles/copying splits the copying layer by the law band = isqrt(key) // S,
   so band b holds keys [(b*S)^2, ((b+1)*S)^2). A band is fetched only when the
   view is at PLANET or closer AND the visible key band intersects it. Loaded
   bands are held up to TILE_FEATURE_CAP features; past that, the band whose
   centre is farthest from the view's radius is evicted and its URL forgotten,
   so it would be fetched again if the reader comes back. */
const TILE_INDEX = '../../layers/tiles/copying/index.json';
const TILE_FEATURE_CAP = 12000;
const TILES = { on: false, index: null, state: 'OFF', bands: new Map(), held: 0, fetched: 0, evicted: 0, withheld: 0, why: '' };

async function tilesToggle() {
  TILES.on = !TILES.on;
  $('copies').classList.toggle('on', TILES.on);
  if (TILES.on && !TILES.index) {
    TILES.state = 'LOAD'; paintTileRow();
    try {
      TILES.index = await fetchJSON(TILE_INDEX);
      TILES.state = 'OK';
    } catch (e) { TILES.state = 'FAIL'; TILES.why = e.message; TILES.on = false; $('copies').classList.remove('on'); }
  }
  paintTileRow(); draw();
}

function wantTiles(band) {
  if (!TILES.on || !TILES.index) return;
  const S2 = TILES.index.scheme.S, rMid = (band.r0 + band.r1) / 2;
  const want = TILES.index.bands.filter(b => b.key_max > band.k0 && b.key_min <= band.k1)
    .sort((a, b) => Math.abs((a.band + .5) * S2 - rMid) - Math.abs((b.band + .5) * S2 - rMid));
  const wantSet = new Set(want.map(b => b.band));
  TILES.withheld = 0;
  for (const b of want) {
    if (TILES.bands.has(b.band)) continue;             /* loaded or loading: never fetched twice */
    /* make room by evicting bands the view no longer needs, farthest first */
    while (TILES.held + b.features > TILE_FEATURE_CAP) {
      let far = null, farD = -1;
      for (const [id, x] of TILES.bands) {
        if (wantSet.has(id) || x.state !== 'OK') continue;
        const d = Math.abs((id + .5) * S2 - rMid);
        if (d > farD) { farD = d; far = id; }
      }
      if (far === null) break;
      const x = TILES.bands.get(far);
      TILES.held -= x.features; TILES.bands.delete(far); urlCache.delete('../../' + x.file); TILES.evicted++;
    }
    if (TILES.held + b.features > TILE_FEATURE_CAP) { TILES.withheld++; continue; }
    const rec = { state: 'LOAD', features: b.features, file: b.file, keys: null, xy: null };
    TILES.bands.set(b.band, rec); TILES.held += b.features;
    fetchJSON('../../' + b.file).then(doc => {
      urlCache.delete('../../' + b.file);             /* the typed copy is what is held, not the JSON */
      if (TILES.bands.get(b.band) !== rec) return;     /* evicted while in flight */
      if (doc.features.length !== b.features) throw new Error(`band ${b.band} holds ${doc.features.length} features, index says ${b.features}`);
      rec.keys = Uint32Array.from(doc.features, f => f.geometry.key);
      rec.xy = placeAll(rec.keys);
      rec.state = 'OK'; TILES.fetched++;
      paintTileRow(); draw();
    }).catch(e => {
      if (TILES.bands.get(b.band) === rec) { TILES.bands.delete(b.band); TILES.held -= b.features; }
      TILES.state = 'FAIL'; TILES.why = e.message; paintTileRow();
    });
  }
  paintTileRow();
}

let tileRowText = '';
function paintTileRow() {
  let t;
  if (TILES.state === 'OFF') t = '';
  else if (TILES.state === 'FAIL') t = `copied lines FAIL: ${TILES.why}`;
  else if (!TILES.on) t = `copied lines hidden · ${fmt(TILES.bands.size)} bands still held`;
  else if (!TILES.index) t = 'copied lines LOAD index';
  else {
    let loading = 0;
    for (const x of TILES.bands.values()) if (x.state === 'LOAD') loading++;
    t = `copied lines: ${fmt(TILES.bands.size - loading)} of ${fmt(TILES.index.bands.length)} bands held (${fmt(TILES.held)} of cap ${fmt(TILE_FEATURE_CAP)} features)`
      + (loading ? ` · LOAD ${fmt(loading)}` : '') + ` · fetched ${fmt(TILES.fetched)} · evicted ${fmt(TILES.evicted)}`
      + (TILES.withheld ? ` · ${fmt(TILES.withheld)} withheld by the cap` : '')
      + (levelOf(view.zoom) < 2 ? ' · drawn from PLANET inward' : '');
  }
  if (t !== tileRowText) { tileRowText = t; $('tilerow').textContent = t; }
}

let loadRowTimer = 0;
function loadModule(id) {
  const row = MOD.get(id);
  if (!row) return Promise.reject(new Error('EMPTY: no module layer is named ' + id));
  if (row.promise) return row.promise;
  row.state = 'LOAD'; paintLoadRow();
  row.promise = fetchJSON('../../' + row.file).then(fc => {
    const routes = [], firsts = [];
    let lines = 0;
    for (const f of fc.features || []) {
      const p = f.properties || {};
      if (f.geometry?.type === 'LineString') {
        const keys = Uint32Array.from(f.geometry.keys || []);
        routes.push({ fn: p.function, family: p.family, lines: p.lines, keys, xy: placeAll(keys) });
        lines += keys.length;
        for (const k of keys) {
          let m = keyMods.get(k);
          if (!m) keyMods.set(k, m = new Map());
          if (!m.has(id)) m.set(id, p.function);
        }
      } else if (f.geometry?.type === 'Point') {
        const [x, y] = place(f.geometry.key);
        firsts.push({ key: f.geometry.key, fn: p.function, family: p.family, lines: p.lines, x, y });
      }
    }
    firsts.sort((a, b) => a.key - b.key);
    const trunk = new Float32Array(firsts.length * 2);
    firsts.forEach((s, i) => { trunk[i * 2] = s.x; trunk[i * 2 + 1] = s.y; });
    row.data = { routes, firsts, lines, trunk, stats: fc.stats || {} };
    row.state = firsts.length ? 'OK' : 'EMPTY';
    if (!firsts.length) row.why = 'the layer file holds no first-line points';
    scheduleHubs(); paintLoadRow(); draw();
    return row;
  }, e => { row.state = 'FAIL'; row.why = e.message; row.promise = null; paintLoadRow(); throw e; });
  return row.promise;
}

let hubTimer = 0;
function scheduleHubs() {
  clearTimeout(hubTimer);
  hubTimer = setTimeout(() => {
    hubs = [];
    for (const [k, m] of keyMods) if (m.size >= 2) hubs.push([k, m.size]);
    hubs.sort((a, b) => b[1] - a[1]);
    if (F.thread) { paintStop(); paintStrip(); }
    draw();
  }, 80);
}
const woken = () => MODS.filter(r => r.state === 'OK' || r.state === 'EMPTY');

/* one row, updated in place, throttled so a burst of loads rewrites it once */
function paintLoadRow() {
  if (loadRowTimer) return;
  loadRowTimer = setTimeout(() => {
    loadRowTimer = 0;
    const c = { WAIT: 0, LOAD: 0, OK: 0, EMPTY: 0, FAIL: 0 };
    for (const r of MODS) c[r.state]++;
    const fails = MODS.filter(r => r.state === 'FAIL');
    let t = `module routes of ${fmt(MODS.length)}: OK ${fmt(c.OK)} · LOAD ${fmt(c.LOAD)} · WAIT ${fmt(c.WAIT)}`;
    if (c.EMPTY) t += ` · EMPTY ${fmt(c.EMPTY)}`;
    if (fails.length) t += ` · FAIL ${fmt(fails.length)} (${fails[0].id}: ${fails[0].why})`;
    t += ` · family index ${U.tier2}`;
    $('loadrow').textContent = t;
  }, 50);
}

/* ── the numbered database ───────────────────────────────────────────────── */

const bin = (name, Kind) => fetchBin(DATA + name, Kind);

async function tier1() {
  const [meta, keys, lens, inFam, manifest] = await Promise.all([
    enqueue(() => fetchWithTimeout(DATA + 'all-lines.meta.json').then(r => r.json())),
    bin('all-lines.bin', Uint32Array),
    bin('all-lines.len.bin', Uint16Array),
    bin('all-lines.family.bin', Uint8Array),
    fetchJSON(MANIFEST)
  ]);
  Object.assign(U, { meta, keys, lens, inFam, n: keys.length, pos: placeAll(keys) });
  U.maxR = S * Math.sqrt(meta.max);
  U.manifestBuilt = String(manifest.built_utc);
  let carried = 0;
  for (let i = 0; i < inFam.length; i++) carried += inFam[i];
  $('count').textContent = `${fmt(U.n)} numbered lines · 1 to ${fmt(meta.max)} · ${fmt(carried)} carried by a family`;
  $('prov').textContent = `numbered database built ${meta.built_utc.slice(0, 16).replace('T', ' ')} UTC · pack ${meta.source.sha256.slice(0, 12)} · layers built ${U.manifestBuilt.slice(0, 16).replace('T', ' ')} UTC`;
  for (const l of manifest.layers) {
    if (!/^module-/.test(l.id)) continue;
    const row = { ...l, state: 'WAIT' };
    MODS.push(row); MOD.set(l.id, row);
  }
  fillPicker();
  paintLoadRow();
  paintPageQuestions();
}

/* Tier 2, only when a thread is followed or a line card asks: how many families carry each line. */
let tier2Promise = null;
function tier2() {
  if (tier2Promise) return tier2Promise;
  U.tier2 = 'LOAD'; paintLoadRow();
  tier2Promise = Promise.all([
    enqueue(() => fetchWithTimeout(DATA + 'families.json').then(r => r.json())),
    bin('lines.bin', Uint32Array)
  ]).then(([families, famLines]) => {
    const count = new Uint16Array(U.n), seen = new Int32Array(U.n).fill(-1);
    for (let f = 0; f < families.length; f++) {
      const o = families[f].lineOffset, c = families[f].lineCount;
      for (let j = o; j < o + c; j++) {
        const i = indexOfKey(U.keys, famLines[j]);
        if (i < 0 || seen[i] === f) continue;
        seen[i] = f; if (count[i] < 65535) count[i]++;
      }
    }
    Object.assign(U, { families, famLines, famCount: count, tier2: 'OK' });
    paintLoadRow();
    if (F.thread) paintStop(); else if (cardKey >= 0) keyCard(cardKey);
  }, e => { U.tier2 = 'FAIL (' + e.message + ')'; tier2Promise = null; paintLoadRow(); });
  return tier2Promise;
}

/* ── the substrate density image: built once, never per frame ────────────── */

const DENS_N = 256;
let dens = null;
function buildDensity() {
  const N = DENS_N, R = U.maxR, cnt = new Uint32Array(N * N);
  let max = 0;
  for (let i = 0; i < U.n; i++) {
    const gx = Math.min(N - 1, Math.floor((U.pos[i * 2] + R) / (2 * R) * N));
    const gy = Math.min(N - 1, Math.floor((R - U.pos[i * 2 + 1]) / (2 * R) * N));
    cnt[gy * N + gx]++;
  }
  for (let i = 0; i < cnt.length; i++) if (cnt[i] > max) max = cnt[i];
  dens = document.createElement('canvas'); dens.width = dens.height = N;
  const dc = dens.getContext('2d'), img = dc.createImageData(N, N);
  for (let i = 0; i < cnt.length; i++) {
    const a = cnt[i] ? Math.sqrt(cnt[i] / max) : 0;
    img.data[i * 4] = 92; img.data[i * 4 + 1] = 108; img.data[i * 4 + 2] = 146;
    img.data[i * 4 + 3] = Math.round(a * 150);
  }
  dc.putImageData(img, 0, 0);
  U.densMax = max;
}

/* ── the camera ──────────────────────────────────────────────────────────── */

const sx = x => (x - view.x) * view.zoom + view.w / 2;
const sy = y => view.h / 2 - (y - view.y) * view.zoom;

function resize() {
  view.dpr = Math.min(window.devicePixelRatio || 1, 2);
  view.w = stage.clientWidth; view.h = stage.clientHeight;
  stage.width = Math.round(view.w * view.dpr); stage.height = Math.round(view.h * view.dpr);
  sizeStrip();
}

const homeZoom = () => Math.min(view.w, view.h) / (U.maxR * 2.15);
function home() { view.x = 0; view.y = 0; view.zoom = homeZoom(); draw(); }

let flight = 0;
function flyTo(x, y, z1, ms = 700) {
  const id = ++flight; window.__journey.flying = true;
  const z0 = view.zoom, x0 = view.x, y0 = view.y, t0 = performance.now();
  const hop = Math.hypot(x - x0, y - y0);
  /* a long drive rises out of the street and comes back down: zoom dips mid-flight when the hop leaves the screen */
  const lift = Math.min(1, hop * Math.min(z0, z1) / (3 * Math.min(view.w, view.h)));
  return new Promise(res => {
    (function step(t) {
      if (id !== flight) return res(false);
      const u = Math.min(1, (t - t0) / ms);
      const e = u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      const zl = Math.exp(Math.log(z0) + (Math.log(z1) - Math.log(z0)) * e);
      view.x = x0 + (x - x0) * e; view.y = y0 + (y - y0) * e;
      view.zoom = Math.max(0.02, zl * (1 - 0.8 * lift * Math.sin(Math.PI * e)));
      render();
      if (u < 1) requestAnimationFrame(step); else { window.__journey.flying = false; res(true); }
    })(t0);
  });
}

/* ── the visible radius band, from the placement law ─────────────────────── */

function lowerBound(a, v) { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m; } return lo; }

function visibleBand() {
  const hw = view.w / 2 / view.zoom, hh = view.h / 2 / view.zoom;
  const x0 = view.x - hw, x1 = view.x + hw, y0 = view.y - hh, y1 = view.y + hh;
  const nx = Math.max(x0, Math.min(0, x1)), ny = Math.max(y0, Math.min(0, y1));
  const r0 = Math.hypot(nx, ny);
  const r1 = Math.max(Math.hypot(x0, y0), Math.hypot(x0, y1), Math.hypot(x1, y0), Math.hypot(x1, y1));
  const k0 = Math.floor((r0 / S) ** 2), k1 = Math.ceil((r1 / S) ** 2);
  const i0 = lowerBound(U.keys, k0), i1 = lowerBound(U.keys, k1 + 1);
  return { r0, r1, k0, k1, i0, i1, x0, x1, y0, y1 };
}

/* ── drawing ─────────────────────────────────────────────────────────────── */

const drawnIdx = new Int32Array(DRAW_CAP);
let drawnN = 0;
let pending = false;
function draw() { if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; render(); }); } }

function strokeXY(c, xy) {
  c.beginPath();
  for (let i = 0; i < xy.length / 2; i++) {
    const X = sx(xy[i * 2]), Y = sy(xy[i * 2 + 1]);
    if (i === 0) c.moveTo(X, Y); else c.lineTo(X, Y);
  }
  c.stroke();
}

/* A route whose legs run into a heavily shared line is drawn as short stubs
   pointing at it, ending at the substation symbol, instead of spokes crossing
   the wafer. The followed thread is always drawn in full.

   STREAMED, NOT ALL AT ONCE. A software rasteriser (WebKit here) pays for a
   stroke by the pixels it covers, so a crowd of routes crossing the screen can
   stall a frame for a second. Routes other than the followed thread are drawn
   into their own layer canvas in chunks of at most INK_PER_FRAME screen pixels
   of length. While the camera moves only the first chunk exists; as soon as it
   holds still, each following frame adds the next chunk until every visible
   leg is drawn. The page prints how far the stream has got. */
const INK_PER_FRAME = 120000;
const RL = { canvas: document.createElement('canvas'), key: '', mi: 0, ri: 0, li: 0, legs: 0, done: true, chunks: 0 };

function legsInto(c, d, hubSet, full, budget, cur) {
  const W = view.w, H = view.h;
  let ink = 0, legs = 0;
  c.beginPath();
  for (; cur.ri < d.routes.length; cur.ri++, cur.li = 0) {
    const r = d.routes[cur.ri], xy = r.xy, n = r.keys.length;
    for (; cur.li + 1 < n; cur.li++) {
      if (!full && ink >= budget) { c.stroke(); return { ink, legs, more: true }; }
      const i = cur.li;
      const ha = !full && hubSet.has(r.keys[i]), hb = !full && hubSet.has(r.keys[i + 1]);
      if (ha && hb) continue;
      let ax = sx(xy[i * 2]), ay = sy(xy[i * 2 + 1]), bx = sx(xy[i * 2 + 2]), by = sy(xy[i * 2 + 3]);
      if (ha || hb) {
        if (ha) { const tx = ax, ty = ay; ax = bx; ay = by; bx = tx; by = ty; }
        const len = Math.hypot(bx - ax, by - ay) || 1, t = Math.min(1, 16 / len);
        bx = ax + (bx - ax) * t; by = ay + (by - ay) * t;
      }
      if ((ax < 0 && bx < 0) || (ay < 0 && by < 0) || (ax > W && bx > W) || (ay > H && by > H)) continue;
      c.moveTo(ax, ay); c.lineTo(bx, by);
      ink += Math.min(Math.abs(bx - ax) + Math.abs(by - ay), W + H); legs++;
    }
  }
  c.stroke();
  return { ink, legs, more: false };
}

function streamRoutes(order, style, hubSet) {
  const cv = RL.canvas;
  if (cv.width !== stage.width || cv.height !== stage.height) { cv.width = stage.width; cv.height = stage.height; RL.key = ''; }
  const key = [view.x, view.y, view.zoom, view.w, view.h, F.thread?.id, F.i, order.length, hubs.length].join('|');
  const rc = cv.getContext('2d');
  rc.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  if (key !== RL.key) {
    RL.key = key; RL.mi = 0; RL.ri = 0; RL.li = 0; RL.legs = 0; RL.done = false; RL.chunks = 0;
    rc.clearRect(0, 0, view.w, view.h);
  }
  if (RL.done) return;
  let budget = INK_PER_FRAME;
  rc.lineCap = 'butt';
  while (RL.mi < order.length && budget > 0) {
    const row = order[RL.mi], st = style(row);
    if (!st) { RL.mi++; RL.ri = 0; RL.li = 0; continue; }
    rc.globalAlpha = st.alpha; rc.strokeStyle = row.colour; rc.lineWidth = st.width;
    const cur = { ri: RL.ri, li: RL.li };
    const got = legsInto(rc, row.data, hubSet, false, budget, cur);
    budget -= got.ink; RL.legs += got.legs;
    if (got.more) { RL.ri = cur.ri; RL.li = cur.li; break; }
    RL.mi++; RL.ri = 0; RL.li = 0;
  }
  rc.globalAlpha = 1;
  RL.chunks++;
  RL.done = RL.mi >= order.length;
  if (!RL.done) draw();                       /* the next frame adds the next chunk */
}

function substation(c, X, Y, count, lit) {
  c.fillStyle = '#05070b'; c.strokeStyle = lit ? '#ffd54a' : '#ffffff'; c.lineWidth = 1.3;
  c.fillRect(X - 6, Y - 6, 12, 12); c.strokeRect(X - 6, Y - 6, 12, 12);
  c.beginPath(); c.moveTo(X - 4, Y); c.lineTo(X + 4, Y); c.stroke();
  c.font = '10px ui-monospace,Menlo,Consolas,monospace'; c.fillStyle = lit ? '#ffd54a' : '#e6e9ef';
  c.fillText(fmt(count), X + 9, Y - 6);
}

function render() {
  if (!U.keys) return;
  const t0 = performance.now();
  const c = ctx, z = view.zoom, L = levelOf(z);
  c.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  c.fillStyle = '#030406'; c.fillRect(0, 0, view.w, view.h);
  const following = !!F.thread;
  let band = null, capped = false, bandKeys = 0; drawnN = 0;

  /* GALAXY and SYSTEM: the precomputed substrate image, no individual lines */
  if (L <= 1 && dens) {
    c.globalAlpha = following ? 0.35 : (L === 0 ? 1 : 0.6);
    c.imageSmoothingEnabled = true;
    c.drawImage(dens, sx(-U.maxR), sy(U.maxR), 2 * U.maxR * z, 2 * U.maxR * z);
    c.globalAlpha = 1;
  }

  /* PLANET and SURFACE: only keys inside the visible radius band exist */
  if (L >= 2) {
    band = visibleBand();
    bandKeys = band.i1 - band.i0;
    const { x0, x1, y0, y1 } = band, P = U.pos, K = U.keys;
    const size = L === 3 ? Math.min(7, 1.2 + z * 0.06) : Math.max(1.2, z * 0.18);
    const lit = F.keySet;
    const groups = [[], [], []];   /* 0 no family, 1 carried, 2 on the followed thread */
    for (let i = band.i0; i < band.i1; i++) {
      const x = P[i * 2], y = P[i * 2 + 1];
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      if (drawnN >= DRAW_CAP) { capped = true; break; }
      drawnIdx[drawnN++] = i;
      groups[lit && lit.has(K[i]) ? 2 : U.inFam[i]].push(i);
    }
    const cols = following ? ['#0e1117', '#171b23', '#ffd54a'] : ['#1b1f28', '#3a4152', '#ffd54a'];
    for (let g = 0; g < 3; g++) {
      c.fillStyle = cols[g];
      const s = g === 2 ? size + 2 : size, h = s / 2, arr = groups[g];
      for (let j = 0; j < arr.length; j++) { const i = arr[j]; c.fillRect(sx(P[i * 2]) - h, sy(P[i * 2 + 1]) - h, s, s); }
    }
    if (L === 3 && drawnN <= 400) {
      c.font = '9px ui-monospace,Menlo,Consolas,monospace'; c.fillStyle = '#6f7890';
      for (let j = 0; j < drawnN; j++) { const i = drawnIdx[j]; c.fillText(String(K[i]), sx(P[i * 2]) + size, sy(P[i * 2 + 1]) - size); }
    }
  }

  /* copied lines from the band tiles the view has reached */
  let tileDrawn = 0;
  if (L >= 2 && TILES.on) {
    wantTiles(band);
    const { x0, x1, y0, y1 } = band;
    c.fillStyle = following ? '#5a1a55' : '#ff2bd6';
    const s2 = Math.max(1.6, Math.min(6, view.zoom * 0.14)), h2 = s2 / 2;
    for (const t of TILES.bands.values()) {
      if (t.state !== 'OK') continue;
      const K = t.keys, XY = t.xy;
      const a = lowerBound(K, band.k0), e = lowerBound(K, band.k1 + 1);
      for (let i = a; i < e; i++) {
        const x = XY[i * 2], y = XY[i * 2 + 1];
        if (x < x0 || x > x1 || y < y0 || y > y1) continue;
        c.fillRect(sx(x) - h2, sy(y) - h2, s2, s2); tileDrawn++;
      }
    }
  } else if (TILES.on) paintTileRow();

  /* module routes, by level */
  const W = woken();
  const hubSet = new Set();
  for (const [k, n] of hubs) if (n >= 3) hubSet.add(k);
  const crossing = F.cross || new Set();
  /* the followed thread's neighbours stream first, then the rest in manifest order */
  const order = following ? [...W].sort((a, b) => crossing.has(b.id) - crossing.has(a.id)) : W;
  const crowd = Math.min(1, 4 / Math.sqrt(Math.max(1, W.length)));
  const dots = [];
  if (L === 0) {
    for (const row of W) {
      const d = row.data; if (!d || d.firsts.length < 2) continue;
      const isThread = following && F.thread.module === row.id;
      c.globalAlpha = (!following ? crowd : isThread ? 1 : crossing.has(row.id) ? 0.3 : 0.05) * 0.7;
      c.strokeStyle = row.colour; c.lineWidth = isThread ? 5 : 3.2;
      strokeXY(c, d.trunk);
    }
  } else if (W.length) {
    streamRoutes(order, row => {
      if (following && F.thread.module === row.id) return null;
      const neighbour = following && crossing.has(row.id);
      return { alpha: !following ? crowd : neighbour ? 0.3 : 0.05, width: 1.3 };
    }, hubSet);
    c.drawImage(RL.canvas, 0, 0, view.w, view.h);
    const tm = following && F.thread.module ? MOD.get(F.thread.module) : null;
    if (tm && tm.data) {
      /* the whole block stays faint; only the current stop's own function is drawn bright (drawThreadOnWafer) */
      const cur = { ri: 0, li: 0 };
      c.globalAlpha = 0.28; c.strokeStyle = tm.colour; c.lineWidth = 1.2; legsInto(c, tm.data, hubSet, true, Infinity, cur);
      c.globalAlpha = 1;
    }
    for (const row of W) {
      const d = row.data; if (!d) continue;
      if (following && F.thread.module !== row.id && !crossing.has(row.id)) continue;
      for (const s of d.firsts) {
        const X = sx(s.x), Y = sy(s.y);
        if (X < -8 || Y < -8 || X > view.w + 8 || Y > view.h + 8) continue;
        dots.push(X, Y);
      }
    }
  }
  c.globalAlpha = 1;
  if (dots.length) {
    c.fillStyle = '#ffffff'; c.beginPath();
    for (let j = 0; j < dots.length; j += 2) { c.moveTo(dots[j] + 2.4, dots[j + 1]); c.arc(dots[j], dots[j + 1], 2.4, 0, 6.2832); }
    c.fill();
  }
  c.globalAlpha = 1;

  /* labels for the largest woken routes at SYSTEM */
  if (L === 1 && !following) {
    const big = W.filter(r => r.data && r.data.firsts.length).sort((a, b) => b.data.lines - a.data.lines).slice(0, 6);
    c.font = '11px ui-monospace,Menlo,Consolas,monospace';
    for (const r of big) {
      const s = r.data.firsts[r.data.firsts.length >> 1];
      const X = sx(s.x), Y = sy(s.y);
      if (X < 0 || Y < 0 || X > view.w || Y > view.h) continue;
      const tw = c.measureText(r.label).width;
      c.fillStyle = '#000000cc'; c.fillRect(X + 6, Y - 13, tw + 6, 15);
      c.fillStyle = r.colour; c.fillText(r.label, X + 9, Y - 2);
    }
  }

  /* junctions as substation symbols with their counts */
  if (L >= 1 && hubs.length) {
    const minCount = L === 1 ? 8 : 3;
    let shown = 0;
    for (const [k, n] of hubs) {
      if (n < minCount || shown >= 120) continue;
      if (following && !F.keySet.has(k)) continue;
      const [x, y] = place(k), X = sx(x), Y = sy(y);
      if (X < -10 || Y < -10 || X > view.w + 10 || Y > view.h + 10) continue;
      substation(c, X, Y, n, following); shown++;
    }
  }

  if (following) drawThreadOnWafer(c);

  const ms = performance.now() - t0;
  const rec = { level: LEVELS[L].id, zoom: z, drawn: drawnN, legs: RL.legs, streamDone: RL.done, chunks: RL.chunks, tileDrawn, tilesHeld: TILES.held, bandKeys, capped, ms, routes: W.length };
  stats.last = rec; stats.frames.push(rec); if (stats.frames.length > 4000) stats.frames.splice(0, 2000);
  paintHud(rec, band);
}

function drawThreadOnWafer(c) {
  const st = F.thread.stops, cur = st[F.i];
  c.setLineDash([6, 5]); c.strokeStyle = '#ffd54a'; c.lineWidth = 1.2; c.globalAlpha = 0.8;
  c.beginPath();
  st.forEach((s, j) => { const [x, y] = place(s.key); j ? c.lineTo(sx(x), sy(y)) : c.moveTo(sx(x), sy(y)); });
  c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
  if (cur.xy) { c.strokeStyle = '#000'; c.lineWidth = 5; strokeXY(c, cur.xy); c.strokeStyle = '#ffd54a'; c.lineWidth = 2.2; strokeXY(c, cur.xy); }
  for (const j of [F.i - 1, F.i + 1]) {
    if (j < 0 || j >= st.length) continue;
    const [x, y] = place(st[j].key);
    c.strokeStyle = '#ffffff'; c.lineWidth = 1.2; c.beginPath(); c.arc(sx(x), sy(y), 8, 0, 6.2832); c.stroke();
  }
  /* the next stop, when off screen, is an arrow on the edge pointing along the road */
  const [x, y] = place(cur.key), X = sx(x), Y = sy(y);
  const nx = st[F.i + 1];
  if (nx) {
    const [qx, qy] = place(nx.key), QX = sx(qx), QY = sy(qy), m = 22;
    if (QX < m || QY < m || QX > view.w - m || QY > view.h - m) {
      const cx = view.w / 2, cy = view.h / 2, dx = QX - cx, dy = QY - cy;
      const k = Math.min((view.w / 2 - m) / Math.abs(dx || 1e-9), (view.h / 2 - m) / Math.abs(dy || 1e-9));
      const ax = cx + dx * k, ay = cy + dy * k, ang = Math.atan2(dy, dx);
      c.fillStyle = '#ffd54a'; c.beginPath();
      c.moveTo(ax + Math.cos(ang) * 10, ay + Math.sin(ang) * 10);
      c.lineTo(ax + Math.cos(ang + 2.5) * 9, ay + Math.sin(ang + 2.5) * 9);
      c.lineTo(ax + Math.cos(ang - 2.5) * 9, ay + Math.sin(ang - 2.5) * 9); c.fill();
      c.font = '10px ui-monospace,Menlo,Consolas,monospace';
      const label = `next ${fmt(nx.key)} · ${fmt(Math.round(Math.hypot(qx - x, qy - y)))} units`;
      const tw = c.measureText(label).width;
      c.fillText(label, Math.max(4, Math.min(view.w - tw - 4, ax - tw / 2)), ay + (ay > cy ? -14 : 20));
    }
  }
  c.strokeStyle = '#ffd54a'; c.lineWidth = 1.6;
  c.beginPath(); c.arc(X, Y, 12, 0, 6.2832); c.stroke();
  c.beginPath(); c.moveTo(X - 20, Y); c.lineTo(X - 14, Y); c.moveTo(X + 14, Y); c.lineTo(X + 20, Y);
  c.moveTo(X, Y - 20); c.lineTo(X, Y - 14); c.moveTo(X, Y + 14); c.lineTo(X, Y + 20); c.stroke();
}

let hudLevel = -1;
function paintHud(rec, band) {
  const L = LEVELS.findIndex(l => l.id === rec.level);
  if (L !== hudLevel) {
    hudLevel = L;
    document.querySelectorAll('#levels button').forEach(b => b.classList.toggle('on', +b.dataset.level === L));
  }
  $('lvl').textContent = `LEVEL ${rec.level} · zoom ${rec.zoom < 10 ? rec.zoom.toFixed(2) : rec.zoom.toFixed(0)}`;
  let t;
  if (rec.level === 'GALAXY') t = `0 keys drawn · density image ${DENS_N}×${DENS_N} · ${fmt(rec.routes)} route trunks`;
  else if (rec.level === 'SYSTEM') t = `0 keys drawn · ${fmt(rec.routes)} routes, ${fmt(rec.legs)} legs streamed${rec.streamDone ? ' (all visible)' : ` (still streaming, chunk ${fmt(rec.chunks)})`} · symbols where 8 or more routes share a line`;
  else t = `${fmt(rec.drawn)} keys drawn this frame${rec.capped ? ' (ceiling reached)' : ''}${TILES.on ? `, ${fmt(rec.tileDrawn)} copied` : ''} · band ${fmt(band.k0)}–${fmt(band.k1)} holds ${fmt(rec.bandKeys)} · ${fmt(rec.legs)} route legs${rec.streamDone ? '' : ' so far'}`;
  $('drawn').textContent = t;
}

/* ── threads ─────────────────────────────────────────────────────────────── */

function fillPicker() {
  const sel = $('thread');
  const groups = new Map();
  for (const r of MODS) {
    if (!groups.has(r.group)) { const g = document.createElement('optgroup'); g.label = r.group; groups.set(r.group, g); sel.appendChild(g); }
    const o = document.createElement('option'); o.value = r.id; o.textContent = r.label;
    groups.get(r.group).appendChild(o);
  }
}

async function moduleThread(id) {
  const row = await loadModule(id);
  const d = row.data;
  if (!d.firsts.length) throw new Error(`EMPTY: ${row.label} has no first-line points to stop at`);
  const byFamily = new Map(d.routes.map(r => [r.family, r]));
  const stops = d.firsts.map(s => {
    const r = byFamily.get(s.family);
    return { key: s.key, fn: s.fn, title: s.fn, family: s.family, lines: s.lines, xy: r ? r.xy : null, routeKeys: r ? r.keys : null };
  });
  return { kind: 'module', id, module: id, label: row.label, colour: row.colour, stops,
           order: 'stops are the first lines of the block\'s functions, in numbering order' };
}

function familyThread(moduleId, family) {
  const row = MOD.get(moduleId), r = row.data.routes.find(x => x.family === family);
  const n = r.keys.length;
  const stops = Array.from(r.keys, (k, j) => ({ key: k, fn: r.fn, title: `${r.fn} · line ${j + 1} of ${n}`, family, lines: r.lines, xy: r.xy, routeKeys: r.keys }));
  return { kind: 'family', id: `${moduleId}~${family}`, module: moduleId, label: `${r.fn} in ${row.label}`, colour: row.colour, stops,
           order: 'stops are the function\'s own lines in the order the layer file routes them' };
}

let chainCache = null, chainPromise = null;
function copyChains() {
  if (chainPromise) return chainPromise;
  $('chains').textContent = 'LOAD…';
  chainPromise = fetchJSON('../../layers/crossname.json').then(fc => {
    const parent = new Map(), info = new Map(), edges = [];
    const find = a => { while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a))); a = parent.get(a); } return a; };
    for (const f of fc.features) {
      const p = f.properties, [ka, kb] = f.geometry.keys;
      for (const [fam, k] of [[p.a, ka], [p.b, kb]]) {
        if (!parent.has(fam.family)) { parent.set(fam.family, fam.family); info.set(fam.family, { key: k, name: fam.name, category: fam.category }); }
      }
      parent.set(find(p.a.family), find(p.b.family));
      edges.push([p.a.family, p.b.family, p.overlap, p.shared]);
    }
    const comps = new Map();
    for (const fam of parent.keys()) { const root = find(fam); if (!comps.has(root)) comps.set(root, []); comps.get(root).push(fam); }
    const edgeOf = new Map();
    for (const [a, b, ov, sh] of edges) { edgeOf.set(a + ':' + b, [ov, sh]); edgeOf.set(b + ':' + a, [ov, sh]); }
    chainCache = [...comps.values()].filter(cc => cc.length >= 3).sort((a, b) => b.length - a.length).map((fams, ci) => {
      const stops = fams.map(f => ({ key: info.get(f).key, fn: info.get(f).name, title: info.get(f).name, family: f, category: info.get(f).category }))
        .sort((a, b) => a.key - b.key);
      stops.forEach((s, j) => { if (j + 1 < stops.length) s.link = edgeOf.get(s.family + ':' + stops[j + 1].family) || null; });
      return { kind: 'copy', id: `copy~${ci}`, module: null, label: `copy chain ${ci + 1}: ${stops[0].title} and ${fmt(stops.length - 1)} more`, colour: '#ff00ff', stops,
               order: 'stops are the chain\'s functions, at their first lines, in numbering order' };
    });
    const sel = $('thread'), g = document.createElement('optgroup');
    g.label = `COPY CHAINS · ${fmt(chainCache.length)} of three or more functions, from ${fmt(fc.features.length)} copied pairs`;
    chainCache.forEach(t => { const o = document.createElement('option'); o.value = t.id; o.textContent = t.label; g.appendChild(o); });
    sel.insertBefore(g, sel.children[1]);
    $('chains').textContent = `${fmt(chainCache.length)} CHAINS`;
    return chainCache;
  }).catch(e => { $('chains').textContent = 'FAIL'; chainPromise = null; throw e; });
  return chainPromise;
}

/* The named module groups wake together; the long "OTHER" group only on its own request. */
const OTHER = 'MODULES · OTHER';
function wakeNamed() { for (const r of MODS) if (r.group !== OTHER) loadModule(r.id).catch(() => {}); }

async function follow(thread, i = 0) {
  F.thread = thread;
  F.keySet = new Set();
  for (const s of thread.stops) { F.keySet.add(s.key); if (s.routeKeys) for (const k of s.routeKeys) F.keySet.add(k); }
  $('follow').hidden = false; document.body.classList.add('following');
  sizeStrip();
  wakeNamed();
  tier2();
  await goStop(i);
}

function leave() {
  F.thread = null; F.keySet = null; F.cross = null; flight++;
  $('follow').hidden = true; $('card').hidden = true; document.body.classList.remove('following');
  $('thread').value = '';
  writeURL();
  draw();
}

function stopCross(key) {
  const m = keyMods.get(key);
  return m ? [...m.keys()].filter(id => id !== F.thread?.module) : [];
}

async function goStop(i) {
  const T = F.thread; if (!T) return;
  F.i = Math.max(0, Math.min(i, T.stops.length - 1));
  const s = T.stops[F.i], nx = T.stops[F.i + 1] || T.stops[F.i - 1] || s;
  F.cross = new Set(stopCross(s.key));
  paintStop(); paintStrip(); writeURL();
  const [x, y] = place(s.key), [x2, y2] = place(nx.key);
  /* arrive at PLANET so the stop's own lines exist; frame the next stop too when it is close enough */
  const span = Math.max(Math.hypot(x2 - x, y2 - y), 6);
  const z = Math.max(LEVELS[2].go, Math.min(120, Math.min(view.w, view.h * 0.45) / (span * 2.4)));
  stats.stopsVisited++;
  await flyTo(x, y, z);
}

/* ── the stop card ───────────────────────────────────────────────────────── */

function radiusBand(key) { return Math.min(BANDS - 1, Math.floor(S * Math.sqrt(key) / U.maxR * BANDS)); }

/* Q1 is answered by name match only: which drawing element, if any, the
   function's own name or its block's label names. It is marked as inference
   and the matched text is printed, so a false match can be seen. */
const ELEMENTS = [
  [/busbar/i, 'busbar'], [/feeder/i, 'feeder'], [/transformer/i, 'transformer'],
  [/cable|trench|conductor|overhead/i, 'cable route'], [/route/i, 'route (cable route or path)'],
  [/protect|fault|relay|breaker/i, 'protection'], [/earthing|earthed/i, 'earthing'],
  [/substation/i, 'substation'], [/voltage|rating|kv\b/i, 'rating or voltage annotation'],
  [/single.?line|\bsld\b/i, 'single-line diagram']
];
function elementMatch(...texts) {
  for (const t of texts) {
    if (!t) continue;
    for (const [re, el] of ELEMENTS) { const m = String(t).match(re); if (m) return { el, text: t, hit: m[0] }; }
  }
  return null;
}

function threadPatterns(T) {
  const st = T.stops, bands = new Set();
  let longest = 0, la = st[0].key, lb = st[0].key, dist = 0, junctions = 0, inner = 0, legs = 0;
  const innerR = U.maxR / BANDS;
  st.forEach((s, j) => {
    bands.add(radiusBand(s.key));
    if (stopCross(s.key).length) junctions++;
    if (j + 1 < st.length) {
      const hop = Math.abs(st[j + 1].key - s.key);
      if (hop > longest) { longest = hop; la = s.key; lb = st[j + 1].key; }
      const [ax, ay] = place(s.key), [bx, by] = place(st[j + 1].key);
      dist += Math.hypot(bx - ax, by - ay);
    }
  });
  const seenRoute = new Set();
  for (const s of st) {
    if (!s.xy || seenRoute.has(s.xy)) continue; seenRoute.add(s.xy);
    for (let j = 0; j + 1 < s.xy.length / 2; j++) {
      legs++;
      const ax = s.xy[j * 2], ay = s.xy[j * 2 + 1], dx = s.xy[j * 2 + 2] - ax, dy = s.xy[j * 2 + 3] - ay;
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
      if (Math.hypot(ax + dx * t, ay + dy * t) < innerR) inner++;
    }
  }
  let minB = BANDS, maxB = -1;
  for (const b of bands) { minB = Math.min(minB, b); maxB = Math.max(maxB, b); }
  return { bands: bands.size, minB, maxB, longest, la, lb, meanHop: st.length > 1 ? dist / (st.length - 1) : 0, junctions, inner, legs };
}

const questionsOpen = () => window.innerWidth >= 760;

function paintStop() {
  const T = F.thread; if (!T) return;
  const s = T.stops[F.i], next = T.stops[F.i + 1], prev = T.stops[F.i - 1];
  const idx = indexOfKey(U.keys, s.key);
  const cross = stopCross(s.key);
  const nW = woken().length;
  const P = threadPatterns(T);
  const fam = U.famCount && idx >= 0 ? U.famCount[idx] : null;
  const row = T.module ? MOD.get(T.module) : null;
  const st = row?.data?.stats || {};
  const keep = $('cardbody').querySelector('details.qs');
  const open = keep ? keep.open : questionsOpen();

  const match = elementMatch(s.fn, row?.label);
  const drawnAs = cross.length
    ? `a substation symbol carrying the count ${fmt(cross.length)} in the strip, because ${fmt(cross.length)} other woken ${cross.length === 1 ? 'route passes' : 'routes pass'} through line ${fmt(s.key)}`
    : `a busbar in the strip: no other woken route passes through line ${fmt(s.key)}`;
  const q1 = `On this page the stop is drawn as ${drawnAs} (paintStrip reads keyMods). In a power-system drawing: ` + (match
    ? `<b>${esc(match.el)}</b>, by name-match inference: "${esc(match.hit)}" in "${esc(match.text)}". The layer file carries the function name (properties.function) and the block label, not the element, so this is a reading of the name, not a record.`
    : `<b>none yet</b>: neither the function name "${esc(s.fn)}"${row ? ` nor the block label "${esc(row.label)}"` : ''} names a busbar, feeder, transformer, cable route, protection, earthing or substation.`);

  let q2;
  if (T.kind === 'copy') {
    q2 = `Function <span class="fam">${esc(s.fn)}</span>, family #${fmt(s.family)}, category ${esc(s.category ?? 'not recorded')}, from layers/crossname.json. It shares six or more usable lines with a differently named function in this chain. No block, file or commit is recorded for it in that layer. Callers: not established; this page holds line numbers and names, not call sites.`;
  } else {
    const files = (st.files || []).slice(0, 3);
    q2 = `Block <b>${esc(row.label)}</b> (${esc(row.group)}), function <span class="fam">${esc(s.fn)}</span>, family #${fmt(s.family)}, ${fmt(s.lines)} lines. `
      + `Register evidence: ${esc(row.evidence || 'none recorded')}. `
      + (files.length ? `Files named for the block: ${files.map(f => esc(f)).join(' · ')}${(st.files || []).length > 3 ? ` and ${fmt(st.files.length - 3)} more` : ''}. ` : 'No files are named in the layer file. ')
      + (st.commit ? `Commit ${esc(String(st.commit).slice(0, 12))}. ` : 'No commit recorded. ')
      + `Callers: not established; the layer holds line numbers, not call sites. Shared text is not a call.`;
  }

  let q3 = next
    ? `Next stop line ${fmt(next.key)}, <span class="fam">${esc(next.title)}</span>, ${fmt(Math.abs(next.key - s.key))} keys on${s.link ? `; a copied pair sharing ${fmt(s.link[1])} lines` : ''}.`
    : `No next stop: this is the last of ${fmt(T.stops.length)}.`;
  q3 += cross.length
    ? ` ${fmt(cross.length)} other ${cross.length === 1 ? 'route crosses' : 'routes cross'} here (counted over ${fmt(nW)} of ${fmt(MODS.length)} woken): ${cross.slice(0, 5).map(id => esc(MOD.get(id).label)).join(' · ')}${cross.length > 5 ? ' …' : ''}.`
    : ` No other route crosses here, counted over ${fmt(nW)} of ${fmt(MODS.length)} woken.`;
  q3 += ` Families carrying this line: ${fam == null ? 'not yet known, the family index is ' + esc(U.tier2) : fmt(fam)}.`;

  const machine = `inputs: key ${fmt(s.key)} (permanent line number, integer, 1 to ${fmt(U.meta.max)}), stop index ${fmt(F.i + 1)} of ${fmt(T.stops.length)}; `
    + `outputs: position r = ${(S * Math.sqrt(s.key)).toFixed(2)} wafer units, θ = key × golden angle (lib.mjs place), radius band ${fmt(radiusBand(s.key) + 1)} of ${BANDS}, `
    + `characters ${idx < 0 ? 'never issued' : U.lens[idx] === 65535 ? '≥ 65,535' : fmt(U.lens[idx])}, crossings ${fmt(cross.length)}; `
    + `refusals: EMPTY when a thread has no first-line points, "never issued" for a skipped number, FAIL with the HTTP status; `
    + `source: ${row ? `${esc(row.file)}${st.commit ? ' at commit ' + esc(String(st.commit).slice(0, 12)) : ''}` : 'layers/crossname.json'}, pack ${esc(U.meta.source.sha256.slice(0, 12))}.`;

  let h = `<h2>Stop <span class="n">${fmt(F.i + 1)}</span> of ${fmt(T.stops.length)} · line <span class="n">${fmt(s.key)}</span></h2>
    <p><span class="fam">${esc(s.title)}</span> <span class="dim">· ${esc(T.label)}</span></p>
    <p class="dim">${esc(T.order)}${prev ? ` · came from line ${fmt(prev.key)}` : ''}</p>
    <details class="qs"${open ? ' open' : ''}><summary>Questions</summary>
      <ol class="q3">
        <li><span class="dim">How does this help draw a system or a single-line diagram?</span> ${q1}</li>
        <li><span class="dim">What is this code used for?</span> ${q2}</li>
        <li><span class="dim">Where does it lead next?</span> ${q3}</li>
      </ol>
      <p class="machine"><b>Machine detail</b> · ${machine}</p>
    </details>`;
  if (T.kind === 'module' && s.xy) h += `<p><button type="button" class="act" data-walk="${esc(T.module)}~${s.family}">WALK THIS FUNCTION LINE BY LINE</button></p>`;
  if (T.kind === 'family') h += `<p><button type="button" class="act" data-back="${esc(T.module)}">BACK TO THE WHOLE BLOCK</button></p>`;
  h += `<h3>Pattern questions</h3><ul class="q">
    <li><span class="dim">What shape is this thread?</span> Its ${fmt(T.stops.length)} stops span ${fmt(P.bands)} of ${BANDS} radius bands (band ${fmt(P.minB + 1)} to ${fmt(P.maxB + 1)}).</li>
    <li><span class="dim">How far does one hop go?</span> The longest hop is ${fmt(P.longest)} keys, from line ${fmt(P.la)} to ${fmt(P.lb)}; a hop averages ${P.meanHop.toFixed(1)} units across the wafer.</li>
    <li><span class="dim">Where do threads meet?</span> ${fmt(P.junctions)} of ${fmt(T.stops.length)} stops are lines another woken route also passes through.</li>
    <li><span class="dim">Where would it tangle?</span> ${fmt(P.inner)} of ${fmt(P.legs)} route legs drawn for this thread cross the inner tenth of the wafer, where the most shared lines sit.</li>
  </ul>`;
  $('cardbody').innerHTML = h;
  $('card').hidden = false;
}

/* ── the strip: the same thread as one straight line ─────────────────────── */

const sld = $('sld'), sc = sld.getContext('2d');
const STEP = 58;
function sizeStrip() {
  const r = sld.getBoundingClientRect();
  sld.width = Math.max(1, Math.round(r.width * view.dpr)); sld.height = Math.max(1, Math.round(r.height * view.dpr));
  if (F.thread) paintStrip();
}
function paintStrip() {
  const T = F.thread; if (!T) return;
  const w = sld.width / view.dpr, h = sld.height / view.dpr, mid = h * 0.52;
  sc.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  sc.fillStyle = '#070a10'; sc.fillRect(0, 0, w, h);
  const cx = w / 2, reach = Math.ceil(cx / STEP) + 1;
  const first = Math.max(0, F.i - reach), last = Math.min(T.stops.length - 1, F.i + reach);
  const X = j => cx + (j - F.i) * STEP;
  sc.strokeStyle = T.colour; sc.lineWidth = 2.2;
  sc.beginPath(); sc.moveTo(Math.max(0, X(0)), mid); sc.lineTo(Math.min(w, X(T.stops.length - 1)), mid); sc.stroke();
  sc.font = '9px ui-monospace,Menlo,Consolas,monospace'; sc.textAlign = 'center';
  for (let j = first; j <= last; j++) {
    const s = T.stops[j], x = X(j), cur = j === F.i, near = Math.abs(j - F.i) === 1;
    const n = stopCross(s.key).length;
    if (j + 1 <= last) { sc.fillStyle = '#6f7890'; const d = T.stops[j + 1].key - s.key; sc.fillText((d >= 0 ? '+' : '−') + fmt(Math.abs(d)), x + STEP / 2, mid - 5); }
    if (n) {
      sc.fillStyle = '#05070b'; sc.strokeStyle = cur ? '#ffd54a' : '#ffffff'; sc.lineWidth = 1.4;
      sc.fillRect(x - 8, mid - 8, 16, 16); sc.strokeRect(x - 8, mid - 8, 16, 16);
      sc.beginPath(); sc.moveTo(x - 5, mid - 3); sc.lineTo(x + 5, mid - 3); sc.moveTo(x - 5, mid + 3); sc.lineTo(x + 5, mid + 3); sc.stroke();
      sc.fillStyle = cur ? '#ffd54a' : '#e6e9ef'; sc.fillText(fmt(n), x, mid - 12);
    } else {
      sc.strokeStyle = cur ? '#ffd54a' : near ? '#ffffff' : '#8b93a7'; sc.lineWidth = cur ? 4 : 3;
      sc.beginPath(); sc.moveTo(x, mid - 11); sc.lineTo(x, mid + 11); sc.stroke();
    }
    sc.fillStyle = cur ? '#ffd54a' : '#8b93a7';
    sc.fillText(fmt(s.key), x, mid + 22);
    if (cur) { sc.fillStyle = '#d8dee9'; const t = s.title.length > 24 ? s.title.slice(0, 23) + '…' : s.title; sc.fillText(t, x, 11); }
  }
  sc.textAlign = 'left';
}

/* ── cards without a thread: the SYSTEM dot and the SURFACE line ─────────── */

let cardKey = -1;
function keyCard(key) {
  cardKey = key;
  const i = indexOfKey(U.keys, key);
  const m = keyMods.get(key);
  let h = `<h2>Line <span class="n">${fmt(key)}</span></h2><dl>
    <dt>characters</dt><dd>${i < 0 ? 'never issued' : U.lens[i] === 65535 ? 'at least 65,535' : fmt(U.lens[i])}</dd>
    <dt>carried</dt><dd>${i >= 0 && U.inFam[i] ? 'by at least one function family' : 'by no function family'}</dd>
    <dt>families</dt><dd>${U.famCount && i >= 0 ? fmt(U.famCount[i]) : 'not yet known: family index ' + esc(U.tier2)}</dd>
    <dt>radius band</dt><dd>${fmt(radiusBand(key) + 1)} of ${BANDS}</dd></dl>`;
  if (m && m.size) {
    h += `<h3>Blocks through this line</h3><ul>` + [...m].slice(0, 10).map(([id, fn]) =>
      `<li><span class="fam">${esc(fn)}</span> <span class="dim">${esc(MOD.get(id).label)}</span> <button type="button" class="act small" data-follow="${esc(id)}" data-at="">FOLLOW</button></li>`).join('') +
      (m.size > 10 ? `<li class="dim">and ${fmt(m.size - 10)} more</li>` : '') + `</ul>`;
  } else {
    h += `<p class="dim">No woken module route passes through this line (${fmt(woken().length)} of ${fmt(MODS.length)} woken).</p>`;
  }
  if (U.famCount && U.families && i >= 0 && U.famCount[i] && U.famCount[i] <= 40) {
    const names = [];
    for (let f = 0; f < U.families.length && names.length < 8; f++) {
      const o = U.families[f].lineOffset, c = U.families[f].lineCount;
      for (let j = o; j < o + c; j++) if (U.famLines[j] === key) { names.push(U.families[f]); break; }
    }
    h += `<h3>Families carrying it</h3><ul>` + names.map(fa => `<li><span class="fam">${esc(fa.name)}</span> <span class="dim">#${fmt(fa.n)} · ${esc(fa.category ?? 'no category recorded')}</span></li>`).join('') + `</ul>`;
  }
  $('cardbody').innerHTML = h; $('card').hidden = false;
}

function dotCard(row, s) {
  cardKey = -1;
  const m = keyMods.get(s.key);
  $('cardbody').innerHTML = `<h2><span class="fam">${esc(s.fn)}</span></h2><dl>
    <dt>block</dt><dd>${esc(row.label)}</dd>
    <dt>family</dt><dd>#${fmt(s.family)}</dd>
    <dt>first line</dt><dd>${fmt(s.key)}</dd>
    <dt>lines</dt><dd>${fmt(s.lines)}</dd>
    <dt>shared</dt><dd>${fmt(m ? m.size - 1 : 0)} other woken routes pass through its first line</dd></dl>
    <p class="dim">${esc(row.note || '')}</p>
    <p><button type="button" class="act" data-follow="${esc(row.id)}" data-at="${s.key}">FOLLOW THIS BLOCK FROM HERE</button></p>`;
  $('card').hidden = false;
}

function tapAt(cx, cy) {
  const L = levelOf(view.zoom);
  let best = null, bd = 18 * 18;
  if (L >= 1) {
    for (const row of woken()) for (const s of row.data.firsts) {
      const dx = sx(s.x) - cx, dy = sy(s.y) - cy, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = [row, s]; }
    }
  }
  if (F.thread) return;
  if (L === 3) {
    let bi = -1, bdi = Math.min(bd, 16 * 16);
    for (let j = 0; j < drawnN; j++) {
      const i = drawnIdx[j], dx = sx(U.pos[i * 2]) - cx, dy = sy(U.pos[i * 2 + 1]) - cy, d = dx * dx + dy * dy;
      if (d < bdi) { bdi = d; bi = i; }
    }
    if (bi >= 0) { keyCard(U.keys[bi]); tier2(); return; }
  }
  if (best) dotCard(best[0], best[1]);
}

/* ── the page's own questions ────────────────────────────────────────────── */

function paintPageQuestions() {
  const named = MODS.filter(r => r.group !== OTHER).length;
  const el = $('pageq');
  el.open = questionsOpen();
  el.querySelector('.body').innerHTML = `<ol class="q3">
    <li><span class="dim">How does this help draw a system or a single-line diagram?</span> It draws one thread as a <b>single-line strip</b>: a straight line with each stop as a <b>busbar</b>, and a line shared by other routes as a <b>substation</b> symbol with its count (paintStrip, from the keys in layers/modules/*.json). On the wafer it draws module routes as cased <b>routes</b>. None of it is an electrical diagram.</li>
    <li><span class="dim">What is this code used for?</span> Reading the ${fmt(MODS.length)} module routes in layers/manifest.json (${fmt(named)} in named groups, ${fmt(MODS.length - named)} in ${OTHER}) one level of detail and one thread at a time. It places keys with place and placeAll from lib.mjs and counts families from families.json and lines.bin. Callers: none in the estate; it is a page.</li>
    <li><span class="dim">Where does it lead next?</span> Pick a thread: each stop names the next stop, the routes that cross there and, when a name says so, the drawing element it may feed.</li>
  </ol>
  <p class="machine"><b>Machine detail</b> · inputs: permanent keys (integers 1 to ${fmt(U.meta.max)}), zoom (screen px per wafer unit), thread id (layer id, layer~family, or copy~n); outputs: level (GALAXY below ${LEVELS[1].min}, SYSTEM below ${LEVELS[2].min}, PLANET below ${LEVELS[3].min}, SURFACE), visible key band [(r0/S)², (r1/S)²] with S = ${S}, keys drawn per frame (counted, ceiling ${fmt(DRAW_CAP)}), density image ${DENS_N}×${DENS_N} (densest cell ${fmt(U.densMax || 0)} keys); copied-line tiles: band b holds keys [(b×25)², ((b+1)×25)²), fetched only at PLANET or closer when the view's key band meets them, held up to ${fmt(TILE_FEATURE_CAP)} features, farthest band evicted first; routes other than the followed thread streamed ${fmt(INK_PER_FRAME)} screen px of length per frame into their own layer, restarted whenever the camera moves; fetches: ${QUEUE_MAX} at a time, ${FETCH_TIMEOUT_MS / 1000} s timeout, one promise per URL; refusals: EMPTY, never issued, FAIL with HTTP status; sources: layers built ${esc(U.manifestBuilt)}, pack ${esc(U.meta.source.sha256.slice(0, 12))}.</p>`;
}

/* ── gestures ────────────────────────────────────────────────────────────── */

function gestures() {
  let down = null, moved = 0, pinch = null;
  const pts = new Map();
  stage.addEventListener('pointerdown', e => {
    stage.setPointerCapture(e.pointerId); flight++;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 1) { down = [e.clientX, e.clientY]; moved = 0; }
    if (pts.size === 2) { const [p, q] = [...pts.values()]; pinch = { d: Math.hypot(p[0] - q[0], p[1] - q[1]), z: view.zoom }; }
  });
  stage.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId);
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2 && pinch) {
      const [p, q] = [...pts.values()], d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (pinch.d > 0) view.zoom = Math.max(0.02, Math.min(4000, pinch.z * (d / pinch.d)));
      draw(); return;
    }
    if (pts.size === 1) {
      const dx = e.clientX - prev[0], dy = e.clientY - prev[1];
      moved += Math.abs(dx) + Math.abs(dy);
      view.x -= dx / view.zoom; view.y += dy / view.zoom; draw();
    }
  });
  const up = e => {
    if (pts.size === 1 && down && moved < 7) tapAt(e.clientX, e.clientY);
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (pts.size === 0) down = null;
  };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', e => { pts.delete(e.pointerId); pinch = null; down = null; });
  stage.addEventListener('wheel', e => {
    e.preventDefault(); flight++;
    view.zoom = Math.max(0.02, Math.min(4000, view.zoom * Math.exp(-e.deltaY * 0.0016)));
    draw();
  }, { passive: false });

  /* the strip: swipe for the next stop, or tap a stop */
  let sdown = null;
  sld.addEventListener('pointerdown', e => { sdown = [e.clientX, e.clientY]; try { sld.setPointerCapture(e.pointerId); } catch (_) {} });
  sld.addEventListener('pointerup', e => {
    if (!sdown || !F.thread) return;
    const dx = e.clientX - sdown[0]; sdown = null;
    if (Math.abs(dx) > 36) { goStop(F.i + (dx < 0 ? 1 : -1)); return; }
    const r = sld.getBoundingClientRect(), j = F.i + Math.round((e.clientX - r.left - r.width / 2) / STEP);
    if (j !== F.i) goStop(j);
  });
}

/* ── URL: thread and stop ────────────────────────────────────────────────── */

function writeURL() {
  const q = new URLSearchParams();
  if (F.thread) { q.set('thread', F.thread.id); q.set('stop', String(F.i + 1)); }
  history.replaceState(null, '', q.toString() ? '?' + q.toString().replace(/%7E/gi, '~') : location.pathname);
}

async function openThread(id, at) {
  try {
    let T;
    if (id.startsWith('copy~')) {
      const chains = await copyChains(); T = chains[+id.slice(5)];
      if (!T) throw new Error(`EMPTY: there is no ${id}; ${fmt(chains.length)} chains exist`);
    } else if (id.includes('~')) {
      const [m, fam] = id.split('~'); await loadModule(m);
      if (!MOD.get(m).data.routes.some(x => x.family === +fam)) throw new Error(`EMPTY: ${m} routes no family #${fam}`);
      T = familyThread(m, +fam);
    } else T = await moduleThread(id);
    if ([...$('thread').options].some(o => o.value === T.id)) $('thread').value = T.id;
    let i = 0;
    if (at && at.key != null && at.key !== '') i = Math.max(0, T.stops.findIndex(s => s.key === +at.key));
    else if (at && at.index != null) i = at.index;
    await follow(T, i);
  } catch (e) {
    $('cardbody').innerHTML = `<h2>Refused</h2><p class="refuse"></p>`;
    $('cardbody').querySelector('.refuse').textContent = e.message;
    $('card').hidden = false;
  }
}

/* ── start ───────────────────────────────────────────────────────────────── */

(async function start() {
  try { await tier1(); }
  catch (e) { $('count').textContent = 'Could not load the numbered database: ' + e.message + '. Check the connection and reload.'; return; }
  resize();
  buildDensity();
  paintPageQuestions();
  home();
  gestures();
  window.addEventListener('resize', () => { resize(); draw(); });

  document.querySelectorAll('#levels button').forEach(b => b.addEventListener('click', () => {
    const L = +b.dataset.level;
    if (L === 0) flyTo(0, 0, homeZoom()); else flyTo(view.x, view.y, LEVELS[L].go);
  }));
  $('wake').addEventListener('click', () => {
    if ($('wake').dataset.stage === 'named') {
      for (const r of MODS) loadModule(r.id).catch(() => {});
      $('wake').textContent = 'ALL'; $('wake').disabled = true; return;
    }
    wakeNamed();
    $('wake').dataset.stage = 'named';
    $('wake').textContent = `+${fmt(MODS.filter(r => r.group === OTHER).length)}`;
  });
  $('copies').addEventListener('click', tilesToggle);
  $('chains').addEventListener('click', () => copyChains().catch(e => { $('loadrow').textContent = 'copy chains FAIL: ' + e.message; }));
  $('thread').addEventListener('change', e => { const v = e.target.value; if (v) openThread(v); else leave(); });
  $('prev').addEventListener('click', () => goStop(F.i - 1));
  $('next').addEventListener('click', () => goStop(F.i + 1));
  $('leave').addEventListener('click', leave);
  $('close').addEventListener('click', () => { $('card').hidden = true; cardKey = -1; });
  $('cardbody').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.walk) openThread(b.dataset.walk);
    else if (b.dataset.back) openThread(b.dataset.back, { key: F.thread.stops[0].key });
    else if (b.dataset.follow) openThread(b.dataset.follow, { key: b.dataset.at });
  });
  window.addEventListener('keydown', e => {
    if (!F.thread || e.target.tagName === 'SELECT') return;
    if (e.key === 'ArrowRight') goStop(F.i + 1);
    if (e.key === 'ArrowLeft') goStop(F.i - 1);
  });

  const q = new URLSearchParams(location.search);
  if (q.get('thread')) openThread(q.get('thread'), { index: Math.max(0, (parseInt(q.get('stop'), 10) || 1) - 1) });
  window.__journey.ready = true;
  window.__journey.goStop = i => goStop(i);
  window.__journey.openThread = (id, at) => openThread(id, at);
  window.__journey.copyChains = () => copyChains();
  window.__journey.tiles = () => ({ on: TILES.on, bands: TILES.bands.size, held: TILES.held, cap: TILE_FEATURE_CAP, fetched: TILES.fetched, evicted: TILES.evicted, withheld: TILES.withheld, state: TILES.state });
})();
