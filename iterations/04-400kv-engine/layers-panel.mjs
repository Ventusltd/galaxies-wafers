/* layers-panel.mjs — layers over the inherited wafer, in Grid Atlas's grammar.
 *
 * The wafer page (app.mjs, lib.mjs) is inherited unchanged but for its hooks.
 * This file adds a transparent canvas above it and a panel of layers, and
 * touches nothing the wafer draws. Remove this script tag and the wafer is
 * exactly what it was.
 *
 * Layers are files in layers/, listed by layers/manifest.json. Each is a
 * CodeFeatureCollection whose geometry is permanent keys, never coordinates, so
 * every mark is placed by the wafer's own frozen law and cannot disagree with
 * the ground. States follow the Atlas: WAIT until ticked, LOAD while fetching,
 * OK when drawn, EMPTY when loaded with nothing in it, FAIL with its reason.
 *
 * LOADING, AS GRID ATLAS DOES IT (repd_grid_atlasv8/ventus-corev8engine.js:
 * handleLayerToggle, hydrateLayer, FetchQueue, fetchAndParseGeoJSON,
 * updateUIState). The first version of this page rebuilt every row, every
 * element card and the engine panel after every single file, and redrew every
 * loaded module each time; loading all the module routes that way froze a
 * phone. Now:
 *  1. Rows are built once. A state change writes only that row's tag and note.
 *  2. The engine panel, the element cards, the quantile bands, the URL and the
 *     overlay are marked dirty and brought up to date at most once per
 *     animation frame, however many files land in that frame. The element
 *     cards are only built while the LAYERS list is open.
 *  3. One FetchQueue(MAX_FETCH) carries all network work; every fetch aborts
 *     after FETCH_TIMEOUT_MS; one promise per URL is shared, and a failed fetch
 *     leaves the cache so a retry can happen.
 *  4. Unticking hides a layer; its data stays in memory unless the feature
 *     ceiling has to release it (hidden layers only, least recently used).
 *  5. Each layer's positions are placed once into a Float32Array when it
 *     loads; a frame only multiplies and adds, and skips routes whose box is
 *     off screen.
 *
 * INFINITE, BUT NOT AT ONCE. There is no "load everything" button. The engine
 * button loads the module routes with a line in the visible radius band: the
 * ring of radii the screen covers, because r = sqrt(key). A second press loads
 * the next ring of the same width outward. Which modules have a line in a ring
 * is read before fetching from the block register (layers/blocks.json: the
 * families each block names) and the wafer's family line ranges; a module file
 * can name more families than that register snapshot, so once a file is loaded
 * its own keys replace the estimate.
 *
 * MOVING FRAMES WITHOUT RE-STROKING. Measured in WebKit at iPhone 13 size with
 * all 187 module files loaded, stroking their 1,418 routes once takes about a
 * second, so the first version spent a second on every zoom frame. Now the
 * overlay is drawn in full only when the view settles or something drawn has
 * changed, into a hidden canvas a little larger than the screen, a slice of a
 * few milliseconds per animation frame, and shown only when complete. While the
 * wafer reports a gesture, a frame only sets a CSS transform that carries the
 * last complete raster to where the camera now puts it: no stroke at all. When
 * the camera stops moving, the full raster for the settled view is started;
 * while idle, nothing is drawn unless the view, a layer or the inspected
 * feature has changed. Routes are still stroked one path per route, in the same
 * order, so the finished image is the first version's: one path per band was
 * measured several times slower in the same WebKit (its rasteriser grows faster
 * than linearly with one path's length), and changes pixels where routes cross.
 *
 * TAP TO INSPECT. A tap on the wafer that lands within 14 px of a drawn layer
 * feature shows that feature's properties and its layer's evidence. The wafer
 * still receives the same tap and does whatever it does with it; nothing here
 * captures, prevents or stops the event.
 */
import { placeAll, SPACING } from '../../lib.mjs';

const ROOT = '../../';
export const MAX_FETCH = 4;
export const FETCH_TIMEOUT_MS = 15000;
/* The ceiling on features held in memory, across all layers. Measured in Chrome
   at 390x844 (software GL), overlay script per frame at the whole-wafer zoom:
   every module route in engine mode, 2,836 features, 1.4 ms median; the same
   plus the largest layer, 44,122 features, 5.9 ms median (0.4 ms zoomed in,
   where off-screen routes are skipped). Roughly linear, so 20,000 features is
   about 3 ms of script, leaving a phone several times slower inside a frame. */
export const FEATURE_CAP = 20000;
/* drawMs: script time of the last complete overlay raster, summed over its slices;
   rasterWallMs: from its start to its display; carried: frames that only moved
   the last raster; rasters: complete rasters shown. */
export const LOADER = { fetches: 0, flushes: 0, evictions: 0, rowPaints: 0, drawn: 0, drawMs: 0, rasterWallMs: 0, carried: 0, rasters: 0, slices: 0 };

/* ── 400kV ENGINE MODE ──────────────────────────────────────────────────────
 * Every module route is restyled as if it were a transmission line, by a
 * "voltage" computed from the module's size: the number of distinct numbered
 * lines its routes pass through. The styles are not typed here. They are read
 * at run time from Grid Atlas's own GROUPS (atlas/index.html, the Topology
 * group), so the colours, widths and the substation radius expression are the
 * Atlas's exactly. Bands are quantiles over the modules currently loaded: the
 * top fifth of modules by line count is 400kV, then 275, 220, 132, 66. Each
 * band's lower bound is printed. Each module's first line (its smallest key)
 * is a white substation, its radius the Atlas's interpolate-by-zoom expression
 * evaluated here, with the wafer's zoom level taken as log2 of pixels per unit
 * (one level per doubling, as a web map's zoom is). */
const engine = { on: true, lines: [], subs: null, why: 'reading the Atlas topology…', bands: [], modules: 0, queue: null,
                 ring: null, index: null, indexWhy: '', message: '' };

function evalExpr(e, z) {
  if (!Array.isArray(e)) return e;
  if (e[0] === 'zoom') return z;
  if (e[0] === 'interpolate' && e[1]?.[0] === 'linear') {
    const x = evalExpr(e[2], z), stops = e.slice(3);
    if (x <= stops[0]) return stops[1];
    for (let i = 2; i < stops.length; i += 2) {
      if (x <= stops[i]) {
        const [x0, y0, x1, y1] = [stops[i - 2], stops[i - 1], stops[i], stops[i + 1]];
        return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
      }
    }
    return stops[stops.length - 1];
  }
  throw new Error('unsupported expression ' + e[0]);
}

async function readAtlasTopology() {
  const r = await fetch(ROOT + 'atlas/index.html', { cache: 'default' });
  if (!r.ok) throw new Error('atlas/index.html HTTP ' + r.status);
  const html = await r.text();
  const start = html.indexOf('group: "Topology');
  if (start < 0) throw new Error('no Topology group in the Atlas');
  const block = html.slice(start, html.indexOf('] },', start));
  const rows = block.split('\n').filter(t => /\{\s*id:/.test(t));
  const get = (t, k) => (t.match(new RegExp(k + ':\\s*"([^"]*)"')) || [])[1];
  const lines = [], subs = [];
  for (const t of rows) {
    const o = { id: get(t, 'id'), label: get(t, 'label'), color: get(t, 'color'), type: get(t, 'type') };
    if (o.type === 'line') { o.width = Number(t.match(/width:\s*([0-9.]+)/)[1]); lines.push(o); }
    else if (o.type === 'point') { o.radius = JSON.parse(t.match(/radius:\s*(\[.*\])\s*,\s*url/)[1].replace(/'/g, '"')); subs.push(o); }
  }
  if (!lines.length || subs.length !== 1) throw new Error(`Atlas topology read ${lines.length} lines, ${subs.length} substation layers`);
  engine.lines = lines; engine.subs = subs[0]; engine.why = '';
}

const isModule = l => l.id.startsWith('module-');

function moduleStats(doc) {
  const keys = new Set();
  for (const f of doc.features) if (f.geometry.type === 'LineString') for (const k of f.geometry.keys) keys.add(k);
  let first = Infinity;
  for (const k of keys) if (k < first) first = k;
  return { count: keys.size, first };
}

/* Quantile bands, highest voltage first. Band i (of B) starts at the value at
   quantile (B - 1 - i) / B of the ascending line counts. The arithmetic is the
   first version's, unchanged; it now runs once per animation frame, not per file. */
function computeBands() {
  const counts = [];
  for (const l of (manifest?.layers || [])) {
    const s = state.get(l.id);
    if (isModule(l) && s?.status === 'OK') { s.eng ??= moduleStats(s.doc); counts.push(s.eng.count); }
  }
  counts.sort((a, b) => a - b);
  const B = engine.lines.length;
  engine.modules = counts.length;
  engine.bands = !counts.length ? [] : engine.lines.map((g, i) => {
    const q = (B - 1 - i) / B;
    return { ...g, q, min: counts[Math.min(counts.length - 1, Math.floor(q * counts.length))] };
  });
}

const bandOf = count => engine.bands.find(b => count >= b.min) || engine.bands[engine.bands.length - 1];

const $ = id => document.getElementById(id);
const fmt = n => Number(n).toLocaleString('en-GB');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const node = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text != null) n.textContent = String(text);
  if (cls) n.className = cls;
  return n;
};

const state = new Map();   /* id -> {on, status, why, doc, loaded, loading, cache, eng, used, keys} */
let manifest = null;
let picked = null;         /* {layer, feature} currently inspected */
let clock = 0;             /* use order, for least-recently-used release */

const TAP_SLOP = 7;        /* px of movement under which a pointer-up is a tap */
const PICK_REACH = 14;     /* px within which a tap picks a layer feature */

const style = document.createElement('style');
style.textContent = `
#layers{position:fixed;z-index:5;right:.5rem;top:calc(env(safe-area-inset-top,0px) + 2.2rem);
  max-width:min(22rem,calc(100% - 1rem));font:12px/1.4 ui-monospace,Menlo,Consolas,monospace}
#layersToggle{float:right;background:#11151f;color:#5ec8f2;border:1px solid #5ec8f2;border-radius:6px;
  padding:.35rem .7rem;font:inherit;letter-spacing:.1em;cursor:pointer}
#layersBody{clear:both;margin-top:.4rem;max-height:60vh;overflow:auto;background:#0e121bf4;
  border:1px solid #1b2030;border-radius:8px;padding:.5rem .6rem}
#layersBody[hidden],#layersInspect[hidden]{display:none!important}
#layersInspect{border-bottom:1px solid #1b2030;padding-bottom:.45rem;margin-bottom:.3rem;position:relative}
#layersInspect h3{margin:.1rem 1.6rem .25rem 0;font-size:12.5px;font-weight:600}
#layersInspect dl{display:grid;grid-template-columns:auto 1fr;gap:.1rem .5rem;margin:.3rem 0}
#layersInspect dt{color:#8b93a7}
#layersInspect dd{margin:0;overflow-wrap:anywhere}
#layersInspect .lnote{margin-left:0}
#layersInspectClose{position:absolute;top:0;right:0;background:none;border:0;color:#8b93a7;font:inherit;cursor:pointer}
.lgroup{color:#8b93a7;font-size:10.5px;letter-spacing:.08em;margin:.55rem 0 .15rem}
.lrow{display:flex;gap:.45rem;align-items:flex-start;margin:.2rem 0}
.lrow input{margin-top:.15rem}
.lname{flex:1}
.ltag{font-size:10.5px}
.ltag.WAIT{color:#8b93a7}.ltag.LOAD{color:#ffd54a}.ltag.OK{color:#7fd6a2}
.ltag.EMPTY{color:#b39ddb}.ltag.FAIL{color:#ff8a80}
.lnote{color:#8b93a7;font-size:10.5px;margin:.1rem 0 .35rem 1.5rem}
.ecard{border:1px solid #1b2030;border-radius:6px;padding:.35rem .45rem;margin:.3rem 0;background:#11151f}
.ehead .esym{font-weight:700}.ename{color:#e7ebf3}
.efns{color:#8b93a7;font-size:10.5px;margin:.1rem 0 .2rem}
.emod{border-top:1px dashed #1b2030;padding-top:.2rem;margin-top:.2rem}
.ekv{font-size:10.5px;word-break:break-word}.ek{color:#8b93a7}.ev{color:#e7ebf3}
.eschema{color:#7fd6a2}.enone{color:#b39ddb}
.elinks{font-size:10.5px;margin-top:.15rem}.elink{color:#5ec8f2}
#engine{position:fixed;z-index:6;left:.5rem;top:calc(env(safe-area-inset-top,0px) + 2.2rem);max-width:min(17rem,calc(100% - 1rem));
  background:#0e121bf4;border:1px solid #1b2030;border-radius:8px;padding:.45rem .6rem;font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;color:#e7ebf3}
#engine .ehd{color:#8b93a7;font-size:10.5px;letter-spacing:.1em}
#engine .emodes{display:flex;gap:.3rem;margin:.3rem 0}
#engine button{background:#11151f;color:#8b93a7;border:1px solid #1b2030;border-radius:5px;padding:.25rem .5rem;font:inherit;cursor:pointer}
#engine button.on{color:#e7ebf3;border-color:#e7ebf3}
#engine #loadAll{margin-top:.35rem;color:#5ec8f2;border-color:#5ec8f2;width:100%}
#engine .eband{display:flex;align-items:center;gap:.4rem;margin:.1rem 0}
#engine .esw{display:inline-block;width:1.6rem}
#engine .edot{display:inline-block;width:.6rem;height:.6rem;border-radius:50%;background:#fff}
#engine .dimq{color:#8b93a7;font-size:10.5px}
#engine [hidden]{display:none!important}
#engine #engineView,#engine #engineMsg{margin-top:.2rem}
canvas.overlay{position:fixed;left:0;top:0;pointer-events:none;z-index:1;transform-origin:50% 50%}
`;
document.head.appendChild(style);


/* ── batching: everything slower than one row is done once per frame ─────── */

const dirty = { engine: false, cards: false, draw: false, url: false };
let flushRaf = 0, cardsStale = true;
function schedule(what) {
  for (const k of what) dirty[k] = true;
  if (!flushRaf) flushRaf = requestAnimationFrame(flush);
}
function flush() {
  flushRaf = 0;
  LOADER.flushes++;
  const d = { ...dirty };
  dirty.engine = dirty.cards = dirty.draw = dirty.url = false;
  if (d.engine) { computeBands(); paintEngine(); }
  if (d.cards) { if ($('layersBody').hidden) cardsStale = true; else { renderElements(); cardsStale = false; } }
  if (d.url) writeLayersToURL();
  /* A raster in progress is never restarted by a change: it finishes, is shown,
     and the next raster picks the change up, so loading cannot starve painting. */
  if (d.draw || d.engine) { gen++; drawOverlay(); }
}

/* ── the engine panel: built once, its parts re-filled ───────────────────── */

const enginePanel = document.createElement('section');
enginePanel.id = 'engine';
enginePanel.innerHTML = `<div class="ehd">ENGINE MODE</div>
  <div class="emodes"><button type="button" data-m="0">layer colours</button><button type="button" data-m="1">400kV engine</button></div>
  <div class="dimq" id="engineWhy" hidden></div>
  <div id="engineThresholds"></div>
  <div class="dimq" id="engineCount"></div>
  <div class="eband" id="engineSubs" hidden><span class="edot"></span> <span id="engineSubsLabel"></span></div>
  <button type="button" id="loadAll">load the module routes in view</button>
  <div class="dimq" id="engineView"></div>
  <div class="dimq" id="engineMsg" hidden></div>`;
document.body.appendChild(enginePanel);
enginePanel.querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => {
  engine.on = b.dataset.m === '1'; schedule(['engine', 'draw']);
}));

const setText = (el, t) => { if (el.textContent !== t) el.textContent = t; };
let lastThresholds = null;

function paintEngine() {
  const all = (manifest?.layers || []).filter(isModule);
  const [m0, m1] = enginePanel.querySelectorAll('[data-m]');
  m0.className = engine.on ? '' : 'on'; m1.className = engine.on ? 'on' : '';
  setText($('engineWhy'), engine.why); $('engineWhy').hidden = !engine.why;
  const bands = engine.bands.map(b =>
    `<div class="eband ethreshold"><span class="esw" style="background:${esc(b.color)};height:${b.width}px"></span>
     <b style="color:${esc(b.color)}">${esc(b.label)}</b> <span>&ge; ${b.min} lines</span>
     <span class="dimq">from q${Math.round(b.q * 100)}</span></div>`).join('') || '<div class="dimq">no module routes loaded yet</div>';
  if (bands !== lastThresholds) { $('engineThresholds').innerHTML = bands; lastThresholds = bands; }
  setText($('engineCount'), `${engine.modules} of ${all.length} modules loaded · bands by quantile of distinct lines`);
  if (engine.subs) { setText($('engineSubsLabel'), `${engine.subs.label}: each module's first line`); $('engineSubs').hidden = false; }
  paintLoadState();
}

/* The button, the in-view count, the rule and the ceiling, from the live state. */
function paintLoadState() {
  const btn = $('loadAll'), q = engine.queue;
  const ring = viewRing();
  let label;
  if (q) label = `LOAD ${q.n}/${q.N}`;
  else if (engine.ring && ring && engine.ring.sig === ring.sig && engine.ring.k > 0) {
    const [a, b] = ringBand(ring, engine.ring.k);
    label = a > ring.rmax ? 'every band is loaded'
      : `load the next band outward (radius ${Math.round(a)}–${Math.round(Math.min(b, ring.rmax))})`;
  } else label = 'load the module routes in view';
  setText(btn, label);
  btn.disabled = !!q;
  let viewLine;
  if (!engine.index) viewLine = engine.indexWhy || 'which modules are in view is read from the block register on the first press';
  else if (!ring) viewLine = 'the wafer has not framed itself yet';
  else {
    let M = 0, N = 0;
    for (const l of manifest.layers) {
      if (!isModule(l) || !anyKeyIn(moduleKeys(l), ring.k0, ring.k1)) continue;
      M++;
      if (state.get(l.id).loaded) N++;
    }
    viewLine = `${N} of ${M} modules in view loaded · radius ${Math.round(ring.r0)}–${Math.round(Math.min(ring.r1, ring.rmax))} on screen`;
  }
  setText($('engineView'), `${viewLine} · ${fmt(heldFeatures())} of ${fmt(FEATURE_CAP)} features held`);
  setText($('layersRule'), `LOADING RULE: the engine button loads the module routes with a line in the ring of radii on screen ` +
    `(r = sqrt(key)); a second press loads the next ring of the same width outward. ${MAX_FETCH} fetches at a time, ` +
    `each abandoned after ${FETCH_TIMEOUT_MS / 1000} s. Features held in memory are capped at ${fmt(FEATURE_CAP)}; ` +
    `beyond it hidden layers are released, least recently used first, and a module that still does not fit is not loaded, with the reason on its row.`);
  setText($('engineMsg'), engine.message); $('engineMsg').hidden = !engine.message;
  unCover();
}

/* ── the panel of layers: rows built once ────────────────────────────────── */

const panel = document.createElement('section');
panel.id = 'layers';
panel.innerHTML = `<button id="layersToggle" type="button">LAYERS</button><div id="layersBody" hidden><div id="layersInspect" hidden></div><div id="layersRule" class="lnote" style="margin-left:0"></div><div id="layersList"></div></div>`;
document.body.appendChild(panel);

/* Two canvases: the one on show, and the one a raster is being drawn into. */
const makeOverlay = () => {
  const c = document.createElement('canvas');
  c.className = 'overlay'; c.style.visibility = 'hidden';
  document.body.appendChild(c);
  return { canvas: c, ctx: c.getContext('2d'), anchor: null };
};
let front = makeOverlay(), back = makeOverlay();
front.canvas.id = 'overlay'; front.canvas.style.visibility = '';

$('layersToggle').addEventListener('click', () => { $('layersBody').hidden = !$('layersBody').hidden; bodyOpened(); });
$('loadAll').addEventListener('click', loadInView);

function bodyOpened() {
  if ($('layersBody').hidden) return;
  if (cardsStale) { renderElements(); cardsStale = false; }
  unCover();
}

/* The LAYERS list must never sit over the engine panel and its load button: on
   a narrow screen both panels share the top of the page, so the list is pushed
   below the engine panel and its height is kept inside the window. */
function unCover() {
  const body = $('layersBody');
  if (body.hidden) return;
  body.style.position = 'relative'; body.style.top = ''; body.style.maxHeight = '';
  const e = enginePanel.getBoundingClientRect(), b = body.getBoundingClientRect();
  let shift = 0;
  if (b.left < e.right && b.right > e.left && b.top < e.bottom + 4) shift = Math.ceil(e.bottom - b.top + 8);
  body.style.top = shift + 'px';
  const top = b.top + shift;
  body.style.maxHeight = Math.max(140, Math.min(innerHeight * 0.6, innerHeight - top - 150)) + 'px';
}
if (typeof ResizeObserver === 'function') new ResizeObserver(() => unCover()).observe(enginePanel);
window.addEventListener('resize', unCover);

const rows = new Map();    /* id -> {input, tag, note} */

function buildRows() {
  const frag = document.createDocumentFragment();
  let group = null;
  for (const l of manifest.layers) {
    if (l.group !== group) { group = l.group; frag.appendChild(node('div', group, 'lgroup')); }
    const r = node('div', null, 'lrow');
    const input = node('input'); input.type = 'checkbox'; input.id = 'L-' + l.id;
    const label = node('label', l.label + ' ', 'lname'); label.htmlFor = input.id; label.style.color = l.colour;
    const tag = node('span', '[WAIT]', 'ltag WAIT');
    label.appendChild(tag);
    r.append(input, label);
    const note = node('div', l.evidence, 'lnote');
    frag.append(r, note);
    input.addEventListener('change', () => toggle(l, input.checked));
    rows.set(l.id, { input, tag, note });
  }
  frag.appendChild(node('div', `substrate ${manifest.substrate} · frozen · layers built ${manifest.built_utc}`, 'lnote'));
  $('layersList').replaceChildren(frag);
}

function paintRow(l) {
  const s = state.get(l.id), r = rows.get(l.id);
  if (!r) return;
  LOADER.rowPaints++;
  const word = s.status.split(' ')[0];
  if (r.tag.textContent !== `[${s.status}]`) { r.tag.textContent = `[${s.status}]`; r.tag.className = 'ltag ' + word; }
  let note = l.evidence ?? '';
  if (s.why) note += ' · ' + s.why;
  if (s.status === 'OK' && s.doc?.stats) note += ' · ' + JSON.stringify(s.doc.stats).slice(0, 80);
  if (r.note.textContent !== note) r.note.textContent = note;
  if (r.input.checked !== !!s.on) r.input.checked = !!s.on;
}

/* ── ELEMENT: what a consumer of a module meets ─────────────────────────────
   Shown when a layer that carries properties.schema or properties.export_subpath
   is OK. One card per block symbol, one entry per module that block's functions
   resolve to: its export subpath (or why there is none), the schema it stamps,
   what its NOT_COMPUTED refuses, and where it lives. Built from DOM nodes with
   textContent only; nothing from a dataset is ever parsed as HTML. */
const ENGINE_LIVE = 'https://ventusltd.github.io/ventus-grid-engine/';

function renderElements() {
  const body = $('layersBody');
  if (!body || !manifest) return;
  $('layersElements')?.remove();
  const el = (tag, cls, text) => node(tag, text, cls);
  const link = (href, text) => {
    const a = el('a', 'elink', text);
    a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
    return a;
  };
  const cards = new Map();   /* symbol -> {title, colour, modules: Map(path -> props), functions: Set} */
  for (const l of manifest.layers) {
    const s = state.get(l.id);
    if (!s?.on || s.status !== 'OK') continue;
    const feats = s.doc.features.filter(f => f.properties && ('schema' in f.properties || 'export_subpath' in f.properties));
    for (const f of feats) {
      const p = f.properties;
      if (!p.module_path || !p.block) continue;
      if (!cards.has(p.block)) cards.set(p.block, { title: p.title, colour: l.colour, modules: new Map(), functions: new Set() });
      const c = cards.get(p.block);
      c.functions.add(p.function);
      if (!c.modules.has(p.module_path)) c.modules.set(p.module_path, p);
    }
  }
  if (!cards.size) return;
  const sec = el('div'); sec.id = 'layersElements';
  sec.appendChild(el('div', 'lgroup', 'ELEMENT'));
  for (const [sym, c] of [...cards].sort((a, b) => a[0].localeCompare(b[0]))) {
    const card = el('div', 'ecard');
    const head = el('div', 'ehead');
    const symEl = el('span', 'esym', sym); symEl.style.color = c.colour;
    head.append(symEl, el('span', 'ename', ' ' + (c.title || '')));
    card.appendChild(head);
    card.appendChild(el('div', 'efns', [...c.functions].join(', ')));
    for (const [path, p] of c.modules) {
      const m = el('div', 'emod');
      const kv = (k, v, cls) => { const r = el('div', 'ekv'); r.append(el('span', 'ek', k + ' '), el('span', cls || 'ev', v)); m.appendChild(r); };
      kv('module', path);
      kv('export', p.export_subpath ?? ('none — ' + (p.export_reason || 'no subpath')), p.export_subpath ? 'ev' : 'ev enone');
      kv('schema', p.schema ?? ('none — ' + (p.schema_reason || 'no schema')), p.schema ? 'ev eschema' : 'ev enone');
      kv('refuses', (p.refuses && p.refuses.length) ? p.refuses.join(', ')
        : (p.not_computed_form ? `NOT_COMPUTED is a ${p.not_computed_form}, no keys` : 'nothing declared'));
      const links = el('div', 'elinks');
      links.append(link(ENGINE_LIVE, 'live engine'), el('span', null, ' · '),
        link(p.github || `https://github.com/Ventusltd/ventus-grid-engine/blob/main/${path}`, 'GitHub ' + path));
      m.appendChild(links);
      card.appendChild(m);
    }
    sec.appendChild(card);
  }
  body.appendChild(sec);
}

/* ── the fetch queue and the shared URL cache ────────────────────────────── */

class FetchQueue {
  constructor(n) { this.n = n; this.active = 0; this.waiting = []; }
  async add(task) {
    if (this.active >= this.n) await new Promise(res => this.waiting.push(res));
    this.active++;
    try { return await task(); }
    finally { this.active--; if (this.waiting.length) this.waiting.shift()(); }
  }
}
const queue = new FetchQueue(MAX_FETCH);
const urlCache = new Map();   /* url -> promise of parsed JSON */

function fetchJSON(url) {
  if (urlCache.has(url)) return urlCache.get(url);
  const p = queue.add(async () => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    LOADER.fetches++;
    try {
      const r = await fetch(url, { signal: ctl.signal, cache: 'default' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      throw e.name === 'AbortError' ? new Error(`no answer within ${FETCH_TIMEOUT_MS / 1000} s`) : e;
    } finally { clearTimeout(timer); }
  });
  urlCache.set(url, p);
  p.catch(() => urlCache.delete(url));
  return p;
}

/* ── the ceiling, and what is released to stay under it ──────────────────── */

function heldFeatures() {
  let n = 0;
  if (!manifest) return n;
  for (const l of manifest.layers) {
    const s = state.get(l.id);
    if (!s) continue;                          /* the rows are not built yet */
    if (s.loaded && s.doc) n += s.doc.features.length;
    else if (s.loading) n += Number(l.features) || 0;
  }
  return n;
}

/* Frees hidden layers, least recently used first, until `need` more features
   fit. Nothing ticked is ever released. Returns false when that is not enough. */
function makeRoom(need) {
  while (heldFeatures() + need > FEATURE_CAP) {
    let victim = null, oldest = Infinity;
    for (const l of manifest.layers) {
      const s = state.get(l.id);
      if (!s.on && s.loaded && s.doc?.features.length && s.used < oldest) { oldest = s.used; victim = l; }
    }
    if (!victim) return false;
    const s = state.get(victim.id);
    urlCache.delete(ROOT + victim.file);
    s.doc = null; s.cache = null; s.eng = null; s.keys = null; s.loaded = false; s.status = 'WAIT';
    s.why = 'released from memory at the feature ceiling; fetched again if ticked';
    LOADER.evictions++;
    paintRow(victim);
    schedule(['engine', 'cards', 'draw']);
  }
  return true;
}

/* ── positions placed once per layer ─────────────────────────────────────── */

/* Every key of every feature, in feature order, placed once. A feature is a
   run [start, start + len) of that array with its world bounding box. */
function buildCache(doc) {
  const F = doc.features.length;
  let n = 0;
  for (const f of doc.features) {
    const g = f.geometry;
    if (g.type === 'Point') n += 1; else if (g.type === 'LineString') n += g.keys.length;
  }
  const keys = new Uint32Array(n), start = new Int32Array(F), len = new Int32Array(F), type = new Uint8Array(F);
  let j = 0;
  doc.features.forEach((f, i) => {
    const g = f.geometry;
    start[i] = j;
    if (g.type === 'Point') { keys[j++] = g.key; len[i] = 1; type[i] = 1; }
    else if (g.type === 'LineString') { for (const k of g.keys) keys[j++] = k; len[i] = g.keys.length; type[i] = 2; }
  });
  const pos = placeAll(keys);
  const box = new Float32Array(F * 4);
  for (let i = 0; i < F; i++) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let v = start[i]; v < start[i] + len[i]; v++) {
      const x = pos[v * 2], y = pos[v * 2 + 1];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    box[i * 4] = x0; box[i * 4 + 1] = y0; box[i * 4 + 2] = x1; box[i * 4 + 3] = y1;
  }
  return { pos, start, len, type, box, F };
}

/* ── hydrating one layer ─────────────────────────────────────────────────── */

async function hydrate(l, s) {
  if (s.loaded || s.loading) return;
  makeRoom(Number(l.features) || 0);          /* a reader's own tick is never refused */
  s.loading = true; s.why = ''; s.status = 'LOAD'; paintRow(l);
  try {
    const doc = await fetchJSON(ROOT + l.file);
    s.doc = doc; s.loaded = true; s.keys = null;
    s.cache = buildCache(doc);
    if (isModule(l)) s.eng = moduleStats(doc);
    s.status = doc.features.length ? 'OK' : 'EMPTY';
    if (!doc.features.length) s.why = 'loaded; the layer holds no features';
  } catch (e) { s.status = 'FAIL'; s.why = e.message; }
  s.loading = false;
  paintRow(l);
  schedule(['engine', 'cards', 'draw']);
}

function toggle(l, on) {
  const s = state.get(l.id);
  s.on = on;
  if (on) { s.used = ++clock; hydrate(l, s); }
  else if (picked?.layer.id === l.id) inspect(null);
  paintRow(l);
  schedule(['url', 'cards', 'draw', 'engine']);
}

/* ── which module routes are in view ─────────────────────────────────────── */

/* The ring of radii the screen covers: the rectangle's nearest and farthest
   distance from the wafer's centre. Its keys are [(r0/S)^2, (r1/S)^2]. */
function viewRing() {
  const v = liveView();
  if (!v || !v.w || !v.zoom || !engine.index) return null;
  const hw = v.w / 2 / v.zoom, hh = v.h / 2 / v.zoom, ax = Math.abs(v.x), ay = Math.abs(v.y);
  const r0 = Math.hypot(Math.max(ax - hw, 0), Math.max(ay - hh, 0)), r1 = Math.hypot(ax + hw, ay + hh);
  return { r0, r1, rmax: engine.index.rmax, k0: (r0 / SPACING) ** 2, k1: (r1 / SPACING) ** 2, sig: `${Math.round(r0)}:${Math.round(r1)}` };
}
const ringBand = (ring, k) => { const w = Math.max(ring.r1 - ring.r0, 1); return [ring.r0 + k * w, ring.r0 + (k + 1) * w]; };

const EMPTY_KEYS = new Uint32Array(0);
/* A module's keys, sorted: its own file's once loaded, else the register estimate. */
function moduleKeys(l) {
  const s = state.get(l.id);
  if (s.loaded && s.doc) {
    if (!s.keys) {
      const set = new Set();
      for (const f of s.doc.features) { const g = f.geometry; if (g.type === 'Point') set.add(g.key); else if (g.type === 'LineString') for (const k of g.keys) set.add(k); }
      s.keys = Uint32Array.from(set).sort();
    }
    return s.keys;
  }
  return engine.index.keys.get(l.id.slice('module-'.length)) || EMPTY_KEYS;
}

function anyKeyIn(a, lo, hi) {
  let i = 0, j = a.length;
  while (i < j) { const m = (i + j) >> 1; if (a[m] < lo) i = m + 1; else j = m; }
  return i < a.length && a[i] <= hi;
}

/* The register estimate: layers/blocks.json names each block's families; the
   wafer's family index gives each family's numbered lines. */
async function readRegisterIndex() {
  if (engine.index) return true;
  engine.indexWhy = 'reading the block register and waiting for the family index…'; paintLoadState();
  try {
    const famP = window.__wafer?.families ? Promise.resolve(window.__wafer.families) : new Promise((res, rej) => {
      addEventListener('wafer:families', e => e.detail?.error ? rej(new Error(e.detail.error)) : res(window.__wafer.families), { once: true });
    });
    const [blocks, fam] = await Promise.all([fetchJSON(ROOT + 'layers/blocks.json'), famP]);
    const byN = new Map();
    for (const f of fam.families) byN.set(f.n, f);
    const famsOf = new Map();
    for (const f of blocks.features) {
      const b = f.properties?.block, n = f.properties?.family;
      if (b == null || n == null) continue;
      (famsOf.get(b) || famsOf.set(b, new Set()).get(b)).add(n);
    }
    const keys = new Map();
    let kmax = 0;
    for (const [b, ns] of famsOf) {
      const set = new Set();
      for (const n of ns) {
        const f = byN.get(n);
        if (!f) continue;
        for (let j = f.lineOffset; j < f.lineOffset + f.lineCount; j++) set.add(fam.famLines[j]);
      }
      const arr = Uint32Array.from(set).sort();
      if (arr.length && arr[arr.length - 1] > kmax) kmax = arr[arr.length - 1];
      keys.set(b, arr);
    }
    engine.index = { keys, rmax: SPACING * Math.sqrt(kmax) };
    engine.indexWhy = '';
    return true;
  } catch (e) {
    engine.indexWhy = 'which modules are in view could not be established: ' + e.message;
    paintLoadState();
    return false;
  }
}

async function loadInView() {
  if (engine.queue || !manifest) return;
  engine.message = '';
  if (!await readRegisterIndex()) return;
  const ring = viewRing();
  if (!ring) return;
  if (!engine.ring || engine.ring.sig !== ring.sig) engine.ring = { sig: ring.sig, k: 0 };
  const mods = manifest.layers.filter(isModule);
  let todo = [];
  for (;;) {
    const band = ringBand(ring, engine.ring.k);
    if (band[0] > ring.rmax) break;
    const lo = (band[0] / SPACING) ** 2, hi = (band[1] / SPACING) ** 2;
    todo = mods.filter(l => { const s = state.get(l.id); return !s.loaded && !s.loading && anyKeyIn(moduleKeys(l), lo, hi); });
    if (todo.length) break;
    engine.ring.k++;
  }
  if (!todo.length) {
    engine.message = 'every module with a line from this view outward is loaded';
    schedule(['engine']); return;
  }
  const q = engine.queue = { n: 0, N: todo.length };
  let refused = 0;
  const jobs = [];
  for (const l of todo) {
    const s = state.get(l.id), want = Number(l.features) || 0;
    if (!makeRoom(want)) {
      refused++;
      s.why = `in view, not loaded: its ${fmt(want)} features would take memory above the ${fmt(FEATURE_CAP)}-feature ceiling; untick a layer or zoom in`;
      paintRow(l); continue;
    }
    s.on = true; s.used = ++clock;
    jobs.push(hydrate(l, s).then(() => { q.n++; schedule(['engine']); }));
  }
  schedule(['engine', 'url']);
  await Promise.all(jobs);
  engine.ring.k++;
  engine.queue = null;
  engine.message = refused ? `${refused} module(s) in this band were not loaded: the feature ceiling was reached` : '';
  schedule(['engine', 'cards', 'draw', 'url']);
}

/* ── the URL: ?layers=engine,declared ─────────────────────────────────────── */

/* The wafer's URL grammar: only permanent identifiers travel. A layer id is used
   only if the manifest names it; anything else in the URL is dropped, and the
   next write puts the URL back into canonical, manifest-ordered form. */
function writeLayersToURL() {
  if (!manifest) return;
  const on = manifest.layers.filter(l => state.get(l.id)?.on).map(l => l.id);
  const u = new URL(location.href);
  if (on.length) u.searchParams.set('layers', on.join(','));
  else u.searchParams.delete('layers');
  const next = u.pathname + u.search.replace(/%2C/gi, ',') + u.hash;
  if (next !== location.pathname + location.search + location.hash)
    history.replaceState(history.state, '', next);
}

function readLayersFromURL() {
  if (!manifest) return;
  const raw = new URL(location.href).searchParams.get('layers') || '';
  const known = new Map(manifest.layers.map(l => [l.id, l]));
  const wanted = [...new Set(raw.split(',').map(x => x.trim()))].filter(id => known.has(id));
  for (const id of wanted) state.get(id).on = true;     /* mark all first, so each write keeps the rest */
  if (raw) writeLayersToURL();
  for (const id of wanted) toggle(known.get(id), true);
}

/* ── the camera: the wafer's own, read live ──────────────────────────────── */

const liveView = () => window.__wafer?.view ?? null;

function* visibleLayers() {
  for (const l of (manifest?.layers || [])) {
    const s = state.get(l.id);
    if (s?.on && s.status === 'OK' && s.cache) yield [l, s];
  }
}

/* ── drawing: the wafer's formula, x * zoom + offset, from placed positions ── */

/* The raster canvas can be the screen plus SPAN_MARGIN of its size on every
   side, so a short pan or zoom-out is carried without an empty edge. It is 0,
   the screen exactly, for two measured reasons: WebKit's stroke cost grows with
   the canvas area (iPhone 13 size, zoom 2.1: margin 0, 0.1, 0.25 -> 291, 336,
   1,030 ms), and a canvas offset from the screen's origin is resampled onto a
   DPR-3 screen differently, changing pixels at rest. A gesture that uncovers an
   edge starts a fresh raster at once, a slice per frame. */
const SPAN_MARGIN = 0;
const SLICE_MS = { moving: 8, idle: 20 };   /* script time per animation frame for a raster in progress */
let gen = 0;                  /* bumped whenever anything drawn changes other than the camera */
let job = null;               /* the raster in progress */
let jobRaf = 0;

const viewKey = v => `${v.x},${v.y},${v.zoom},${v.w},${v.h},${v.dpr}`;

function sizeFor(v) {
  const mx = Math.round(v.w * SPAN_MARGIN), my = Math.round(v.h * SPAN_MARGIN);
  const cw = v.w + 2 * mx, ch = v.h + 2 * my, dpr = v.dpr || 1;
  return { mx, my, cw, ch, dpr, W: Math.round(cw * dpr), H: Math.round(ch * dpr) };
}

/* One feature's route. Skipped when its box is more than `pad` px outside the
   raster; otherwise drawn exactly as the first version drew it, one path per feature. */
function strokeRoute(g, c, i, W, H, z, ox, oy, pad) {
  const b = c.box, bi = i * 4;
  if (b[bi + 2] * z + ox < -pad || b[bi] * z + ox > W + pad || oy - b[bi + 3] * z < -pad || oy - b[bi + 1] * z > H + pad) return;
  const p = c.pos, s0 = c.start[i], n = c.len[i];
  g.beginPath();
  for (let k = 0; k < n; k++) {
    const x = p[(s0 + k) * 2] * z + ox, y = oy - p[(s0 + k) * 2 + 1] * z;
    k ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.stroke();
  LOADER.drawn++;
}

/* Everything one raster draws, fixed when it starts: later loads, releases and
   band changes wait for the next raster, so a raster is never a mixture. The
   order is the first version's: layer colours, then bands 66kV up to 400kV,
   then substations, then the inspected feature. */
function planRaster(v) {
  const steps = [];
  const engineOn = engine.on && engine.bands.length;
  for (const [l, s] of visibleLayers()) {
    if (engineOn && isModule(l)) continue;
    steps.push({ kind: 'layer', l, c: s.cache });
  }
  if (engineOn) {
    const mods = [];
    for (const [l, s] of visibleLayers()) if (isModule(l)) { s.eng ??= moduleStats(s.doc); mods.push(s); }
    for (const band of [...engine.bands].reverse()) {      /* 66kV first, 400kV on top */
      for (const s of mods) if (bandOf(s.eng.count) === band) steps.push({ kind: 'band', band, c: s.cache });
    }
    if (engine.subs) {
      const dots = [];
      for (const s of mods) {
        if (!Number.isFinite(s.eng.first)) continue;
        s.eng.xy ??= placeAll([s.eng.first]);
        dots.push(s.eng.xy);
      }
      steps.push({ kind: 'subs', dots, r: evalExpr(engine.subs.radius, Math.log2(v.zoom)) });
    }
  }
  if (picked) steps.push({ kind: 'picked', picked });
  return steps;
}

function startRaster(v) {
  const sz = sizeFor(v);
  const cv = back.canvas;
  if (cv.width !== sz.W || cv.height !== sz.H) {
    cv.width = sz.W; cv.height = sz.H;
    cv.style.width = sz.cw + 'px'; cv.style.height = sz.ch + 'px';
    cv.style.left = -sz.mx + 'px'; cv.style.top = -sz.my + 'px';
  }
  const g = back.ctx;
  g.setTransform(sz.dpr, 0, 0, sz.dpr, 0, 0);
  g.globalAlpha = 1;
  g.clearRect(0, 0, sz.cw, sz.ch);
  const z = v.zoom;
  job = { v: { x: v.x, y: v.y, zoom: v.zoom, w: v.w, h: v.h, dpr: v.dpr }, key: viewKey(v), gen, sz,
          z, ox: sz.cw / 2 - v.x * z, oy: sz.ch / 2 + v.y * z,
          steps: planRaster(v), si: 0, fi: 0, cpu: 0, t0: performance.now() };
}

/* Draws the raster in progress until it is done (true) or `budget` ms have passed. */
function runRaster(budget) {
  const t0 = performance.now();
  const J = job, g = back.ctx, { cw, ch } = J.sz, { z, ox, oy } = J;
  const out = () => { J.cpu += performance.now() - t0; return false; };
  LOADER.slices++;
  while (J.si < J.steps.length) {
    const st = J.steps[J.si];
    if (st.kind === 'layer') {
      const { l, c } = st;
      g.strokeStyle = l.colour; g.fillStyle = l.colour;
      g.globalAlpha = l.draws === 'lines' ? 0.55 : 0.8;
      g.lineWidth = 1;
      for (; J.fi < c.F; J.fi++) {
        const i = J.fi;
        if (c.type[i] === 1) {
          const j = c.start[i], x = c.pos[j * 2] * z + ox, y = oy - c.pos[j * 2 + 1] * z;
          if (x < -2 || y < -2 || x > cw + 2 || y > ch + 2) continue;
          g.fillRect(x - 1, y - 1, 2, 2);
        } else if (c.type[i] === 2) {
          strokeRoute(g, c, i, cw, ch, z, ox, oy, 2);
          if (performance.now() - t0 > budget) { J.fi++; return out(); }
        }
      }
    } else if (st.kind === 'band') {
      const { band, c } = st;
      g.globalAlpha = 0.9; g.lineCap = 'round'; g.lineJoin = 'round';
      g.strokeStyle = band.color; g.lineWidth = band.width;
      for (; J.fi < c.F; J.fi++) {
        if (c.type[J.fi] !== 2) continue;
        strokeRoute(g, c, J.fi, cw, ch, z, ox, oy, band.width + 2);
        if (performance.now() - t0 > budget) { J.fi++; return out(); }
      }
    } else if (st.kind === 'subs') {
      const r = st.r;
      g.globalAlpha = 0.85; g.fillStyle = engine.subs.color; g.strokeStyle = '#0b0d12'; g.lineWidth = 0.6;
      g.lineCap = 'round'; g.lineJoin = 'round';
      for (const xy of st.dots) {
        const x = xy[0] * z + ox, y = oy - xy[1] * z;
        if (x < -r || y < -r || x > cw + r || y > ch + r) continue;
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.stroke();
      }
    } else if (st.kind === 'picked') {
      const pk = st.picked, geo = pk.feature.geometry;
      g.globalAlpha = 1; g.strokeStyle = pk.layer.colour; g.lineWidth = 1.4;
      const ks = geo.type === 'Point' ? [geo.key] : geo.keys;
      const p = placeAll(ks);
      for (let i = 0; i < ks.length; i++) {
        g.beginPath(); g.arc(p[i * 2] * z + ox, oy - p[i * 2 + 1] * z, 7, 0, 6.2832); g.stroke();
      }
    }
    g.globalAlpha = 1;
    J.si++; J.fi = 0;
  }
  J.cpu += performance.now() - t0;
  return true;
}

/* Shows the finished raster: the two canvases change places. */
function commitRaster() {
  const J = job;
  job = null;
  [front, back] = [back, front];
  front.anchor = { ...J.v, key: J.key, gen: J.gen };
  front.canvas.id = 'overlay'; back.canvas.removeAttribute('id');
  front.canvas.style.transform = '';
  front.canvas.style.visibility = '';
  back.canvas.style.visibility = 'hidden';
  back.canvas.style.transform = '';
  LOADER.drawMs = J.cpu; LOADER.rasterWallMs = performance.now() - J.t0; LOADER.rasters++;
}

/* The CSS transform that carries the shown raster to the camera v: translation
   and scale about the screen centre, which is the raster's centre. */
function carry(v) {
  const a = front.anchor;
  const s = v.zoom / a.zoom;
  const dx = (a.x - v.x) * v.zoom, dy = -(a.y - v.y) * v.zoom;
  return `translate(${dx}px,${dy}px) scale(${s})`;
}
/* True when the carried raster still covers the whole screen at no more than
   twice its drawn scale; otherwise a fresh raster is started while moving. */
function carryCovers(v) {
  const a = front.anchor;
  if (!a || a.w !== v.w || a.h !== v.h || a.dpr !== v.dpr) return false;
  const s = v.zoom / a.zoom, { cw, ch } = sizeFor(a);
  const dx = (a.x - v.x) * v.zoom, dy = -(a.y - v.y) * v.zoom;
  return s <= 2 && Math.abs(dx) + v.w / 2 <= s * cw / 2 && Math.abs(dy) + v.h / 2 <= s * ch / 2;
}

function tick() {
  jobRaf = 0;
  const v = liveView();
  pump(v, !!v?.moving);
}

/* The one entry point for every wafer frame and every change. Idle and up to
   date: nothing is drawn. Moving: the shown raster is carried, and a fresh one is
   started only when the carried one no longer covers the screen. Settled or
   changed: a full raster is started. A raster in progress runs one slice per
   frame and is shown when complete. */
function pump(v, moving) {
  if (!v || !v.w || !v.h) return;          /* the wafer has not framed itself yet */
  const key = viewKey(v);
  if (!job) {
    const a = front.anchor;
    if (a && a.key === key && a.gen === gen) { front.canvas.style.transform = ''; return; }
    if (!moving || !carryCovers(v)) startRaster(v);
  }
  if (job && !jobRaf && runRaster(moving ? SLICE_MS.moving : SLICE_MS.idle)) {     /* one slice per frame: a pending tick runs the next */
    commitRaster();
    const a = front.anchor;
    if (!moving && (a.key !== key || a.gen !== gen)) startRaster(v);   /* the view or the data moved on meanwhile */
  }
  if (front.anchor) {
    const same = front.anchor.key === key;
    if (!same) LOADER.carried++;
    front.canvas.style.transform = same ? '' : carry(v);
  }
  if (job && !jobRaf) jobRaf = requestAnimationFrame(tick);
}

function drawOverlay(snap) {
  const v = snap && typeof snap.zoom === 'number' ? snap : liveView();
  pump(v, !!v?.moving);
}

/* The in-view count follows the camera, and costs nothing while the ring is unchanged. */
let lastRingSig = '';
window.__wafer?.onDraw.add(snap => {
  drawOverlay(snap);
  if (!engine.index) return;
  const r = viewRing(), sig = r ? r.sig : '';
  if (sig !== lastRingSig) { lastRingSig = sig; paintLoadState(); }
});

/* ── tap to inspect ──────────────────────────────────────────────────────── */

function segDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
  const qx = ax + t * dx - px, qy = ay + t * dy - py;
  return qx * qx + qy * qy;
}

/* The nearest drawn feature to a screen point, or null when none is within reach. */
function pickAt(cx, cy) {
  const v = liveView();
  if (!v || !v.zoom) return null;
  const z = v.zoom, ox = v.w / 2 - v.x * z, oy = v.h / 2 + v.y * z;
  let best = null, bestD = PICK_REACH * PICK_REACH;
  for (const [l, s] of visibleLayers()) {
    const c = s.cache;
    for (let i = 0; i < c.F; i++) {
      if (!c.len[i]) continue;
      const j0 = c.start[i];
      let px = c.pos[j0 * 2] * z + ox, py = oy - c.pos[j0 * 2 + 1] * z;
      let d = (px - cx) ** 2 + (py - cy) ** 2;
      if (c.type[i] === 2) {
        for (let k = 1; k < c.len[i]; k++) {
          const x = c.pos[(j0 + k) * 2] * z + ox, y = oy - c.pos[(j0 + k) * 2 + 1] * z;
          d = Math.min(d, segDist2(cx, cy, px, py, x, y));
          px = x; py = y;
        }
      }
      if (d < bestD) { bestD = d; best = { layer: l, feature: s.doc.features[i] }; }
    }
  }
  return best;
}

/* Dataset text only ever reaches the page through textContent. */
function inspect(hit) {
  picked = hit;
  const box = $('layersInspect');
  box.replaceChildren();
  if (!hit) { box.hidden = true; gen++; drawOverlay(); return; }
  const { layer: l, feature: f } = hit;
  const close = node('button', '✕');
  close.id = 'layersInspectClose'; close.type = 'button'; close.setAttribute('aria-label', 'close');
  close.addEventListener('click', () => inspect(null));
  const h = node('h3', l.label); h.style.color = l.colour;
  const g = f.geometry;
  const where = node('div', g.type === 'Point' ? `line ${g.key}` : `lines ${g.keys.join(' → ')}`, 'lnote');
  const dl = node('dl');
  for (const [k, val] of Object.entries(f.properties || {})) {
    dl.append(node('dt', k), node('dd', val !== null && typeof val === 'object' ? JSON.stringify(val) : val));
  }
  const ev = node('div', 'evidence: ' + (l.evidence ?? 'none recorded'), 'lnote');
  box.append(close, h, where, dl, ev);
  box.hidden = false;
  $('layersBody').hidden = false;
  bodyOpened();
  gen++; drawOverlay();
}

/* Non-capturing, and never prevents or stops the event: the wafer's own tap
   (which opens its line panel) still happens exactly as before. */
{
  const pts = new Map();
  let moved = 0;
  const onStage = e => e.target instanceof Element && e.target.id === 'stage';
  document.addEventListener('pointerdown', e => {
    if (!onStage(e)) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 1) moved = 0;
  });
  document.addEventListener('pointermove', e => {
    const prev = pts.get(e.pointerId);
    if (!prev) return;
    moved += Math.abs(e.clientX - prev[0]) + Math.abs(e.clientY - prev[1]);
    pts.set(e.pointerId, [e.clientX, e.clientY]);
  });
  const end = e => {
    if (!pts.has(e.pointerId)) return;
    const single = pts.size === 1;
    pts.delete(e.pointerId);
    if (e.type !== 'pointerup' || !single || moved >= TAP_SLOP) return;
    const hit = pickAt(e.clientX, e.clientY);
    if (hit) inspect(hit);
  };
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
}

/* Read-only counters for tests. */
window.__layers04 = Object.freeze({ LOADER, FEATURE_CAP, MAX_FETCH, held: () => heldFeatures(), busy: () => !!engine.queue,
  rastering: () => !!job, redraw: () => { gen++; drawOverlay(); } });

(async () => {
  schedule(['engine']);
  try {
    const r = await fetch(ROOT + 'layers/manifest.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('layers/manifest.json returned HTTP ' + r.status);
    manifest = await r.json();
    try { await readAtlasTopology(); } catch (e) { engine.why = 'Atlas topology unavailable: ' + e.message; engine.on = false; }
    for (const l of manifest.layers) state.set(l.id, { status: 'WAIT', on: false, why: '', loaded: false, loading: false, doc: null, cache: null, eng: null, used: 0, keys: null });
    buildRows();
    schedule(['engine', 'cards']);
    readLayersFromURL();
  } catch (e) {
    $('layersList').replaceChildren(node('div', `Layers unavailable: ${e.message}. The wafer itself is unaffected.`, 'lnote'));
  }
})();
