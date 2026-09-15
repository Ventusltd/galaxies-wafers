/* layers-panel.mjs — iteration 22, FAST ZOOM. Layers over the wafer, loaded
 * the way Grid Atlas loads them, and drawn so that zooming stays cheap.
 *
 * Copied from the root layers-panel.mjs, then changed:
 *
 * LOADING, AS GRID ATLAS DOES IT (repd_grid_atlasv8/ventus-corev8engine.js,
 * handleLayerToggle, hydrateLayer, FetchQueue, fetchAndParseGeoJSON, updateUIState):
 *  1. Every layer has a row from the start and nothing is fetched until it is
 *     ticked; only a manifest entry with preload: true loads at start.
 *  2. Per-layer runtime state {loaded, loading}: a hydrate returns at once when
 *     either is set, so repeated taps never fetch twice.
 *  3. One FetchQueue (MAX_FETCH at once) for all network work; every fetch has a
 *     FETCH_TIMEOUT_MS abort; one promise per URL is shared, and a failed fetch
 *     is removed from that cache so a retry can happen.
 *  4. A state change writes only that row's tag and note (textContent). The
 *     list is built once and never re-rendered.
 *  5. Unticking hides a layer; its data stays in memory and is not fetched
 *     again when ticked, unless the memory ceiling had to release it.
 *  6. Features are drawn on one canvas, never as DOM nodes.
 *  7. A tiled layer has a minimum zoom: below it the layer is neither drawn nor
 *     fetched, so density is decided by zoom.
 *
 * INFINITE, BUT NOT AT ONCE. A layer with more features than the tile set's
 * threshold is served from tiles/ in radius bands (build_tiles.py: band =
 * isqrt(key) // S). Only bands that intersect the screen are fetched and drawn.
 * Everything in memory is counted against FEATURE_CAP; when a fetch would cross
 * it, hidden layers are released first (least recently used), then bands of a
 * tiled layer farthest from the view. A whole layer that cannot fit even then is
 * REFUSED on its row with the arithmetic.
 *
 * DRAWING. World positions are placed once per layer or band into Float32Arrays;
 * a frame does only x * zoom + offset, with a bounding box per route. While the
 * wafer reports a gesture the last raster is carried by a CSS transform; when it
 * can no longer cover the screen it is redrawn with every THIN_STEP-th vertex, and
 * full detail returns on the wafer's settle frame.
 */
import { placeAll } from '../../lib.mjs';

const ROOT = '../../';
export const MAX_FETCH = 3;
export const FETCH_TIMEOUT_MS = 15000;
export const THIN_STEP = 4;
/* The ceiling, chosen from measurement (numbers in the iteration 22 commit
   message): the largest layer, 41,286 point features, measured 2.3 ms median
   script per full-detail overlay draw and held the root page to 360 ms frames on
   Chrome at 390x844. Scaling that linearly, 20,000 features is about 1 ms of
   script, leaving a phone several times slower inside a 16.7 ms frame. */
export const FEATURE_CAP = 20000;
/* A tiled layer is drawn and fetched only from the zoom at which the screen's
   longer side spans at most this many band widths. */
export const TILE_SPAN_BANDS = 3;

const $ = id => document.getElementById(id);
const fmt = n => Number(n).toLocaleString('en-GB');

const state = new Map();   /* id -> runtime state, see freshState() */
let manifest = null;
let tileSet = null;        /* tiles/index.json: {S, tile_over, layers: {id: index path}} */
let picked = null;         /* {layer, feature} currently inspected */
let clock = 0;             /* use order, for least-recently-used release */
export const LOADER = { evictions: 0, keysDrawn: 0, fetches: 0, rasters: 0, carried: 0 };

const TAP_SLOP = 7;
const PICK_REACH = 14;

const freshState = () => ({ on: false, loaded: false, loading: false, status: 'WAIT', why: '', doc: null, cache: null, used: 0, tiles: null });

/* ── the panel ───────────────────────────────────────────────────────────── */

const panel = document.createElement('section');
panel.id = 'layers';
panel.innerHTML = `<button id="layersToggle" type="button">LAYERS</button><div id="layersBody" hidden><div id="layersInspect" hidden></div><div id="layersMeter" class="lnote lmeter"></div><div id="layersRule" class="lnote lmeter"></div><div id="layersWarn" class="lnote lwarn" hidden></div><div id="layersList"></div></div>`;
document.body.appendChild(panel);

const style = document.createElement('style');
style.textContent = `
#layers{position:fixed;z-index:5;right:.5rem;top:calc(env(safe-area-inset-top,0px) + 2.2rem);
  max-width:min(22rem,calc(100% - 1rem));font:12px/1.4 ui-monospace,Menlo,Consolas,monospace}
#layersToggle{float:right;background:#11151f;color:#5ec8f2;border:1px solid #5ec8f2;border-radius:6px;
  padding:.35rem .7rem;font:inherit;letter-spacing:.1em;cursor:pointer}
#layersBody{clear:both;margin-top:.4rem;max-height:60vh;overflow:auto;background:#0e121bf4;
  border:1px solid #1b2030;border-radius:8px;padding:.5rem .6rem}
#layersBody[hidden],#layersInspect[hidden],#layersWarn[hidden]{display:none!important}
#layersInspect{border-bottom:1px solid #1b2030;padding-bottom:.45rem;margin-bottom:.3rem;position:relative}
#layersInspect h3{margin:.1rem 1.6rem .25rem 0;font-size:12.5px;font-weight:600}
#layersInspect dl{display:grid;grid-template-columns:auto 1fr;gap:.1rem .5rem;margin:.3rem 0}
#layersInspect dt{color:#8b93a7}
#layersInspect dd{margin:0;overflow-wrap:anywhere}
#layersInspect .lmeaning{color:#8b93a7;font-size:10.5px;margin-top:.1rem}
#layersInspect .lnote{margin-left:0}
#layersInspectClose{position:absolute;top:0;right:0;background:none;border:0;color:#8b93a7;font:inherit;cursor:pointer}
.lgroup{color:#8b93a7;font-size:10.5px;letter-spacing:.08em;margin:.55rem 0 .15rem}
.lrow{display:flex;gap:.45rem;align-items:flex-start;margin:.2rem 0}
.lrow input{margin-top:.15rem}
.lname{flex:1}
.ltag{font-size:10.5px}
.ltag.WAIT,.ltag.QUEUE{color:#8b93a7}.ltag.LOAD{color:#ffd54a}.ltag.OK{color:#7fd6a2}
.ltag.EMPTY{color:#b39ddb}.ltag.FAIL{color:#ff8a80}.ltag.REFUSED{color:#ffd54a}
.lnote{color:#8b93a7;font-size:10.5px;margin:.1rem 0 .35rem 1.5rem}
.lmeter,.lwarn{margin-left:0}.lwarn{color:#ffd54a}
.ecard{border:1px solid #1b2030;border-radius:6px;padding:.35rem .45rem;margin:.3rem 0;background:#11151f}
.ehead .esym{font-weight:700}.ename{color:#e7ebf3}
.efns{color:#8b93a7;font-size:10.5px;margin:.1rem 0 .2rem}
.emod{border-top:1px dashed #1b2030;padding-top:.2rem;margin-top:.2rem}
.ekv{font-size:10.5px;word-break:break-word}.ek{color:#8b93a7}.ev{color:#e7ebf3}
.eschema{color:#7fd6a2}.enone{color:#b39ddb}
.elinks{font-size:10.5px;margin-top:.15rem}.elink{color:#5ec8f2}
#overlay{position:fixed;left:0;top:0;pointer-events:none;z-index:1;transform-origin:50% 50%;will-change:transform}
`;
document.head.appendChild(style);

const overlay = document.createElement('canvas');
overlay.id = 'overlay';
document.body.appendChild(overlay);
const ctx = overlay.getContext('2d');

$('layersToggle').addEventListener('click', () => { $('layersBody').hidden = !$('layersBody').hidden; });

const node = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text != null) n.textContent = String(text);
  if (cls) n.className = cls;
  return n;
};

/* The one line that says what moving frames do, written from the constants. */
{
  const thin = $('thin');
  if (thin) {
    const settle = window.__wafer?.settleMs;
    thin.textContent = `while moving: the wafer is a cached image and layers keep every ${THIN_STEP}th route vertex and point; ` +
      (settle ? `full detail ${settle} ms after the gesture stops` : 'full detail when the gesture stops');
  }
}

/* Why a layer is EMPTY, in the layer's own words (unchanged from the root file). */
function emptyReason(st) {
  if (!st) return 'loaded; the layer holds no features and records no reason';
  const parts = [];
  if (typeof st.why === 'string') parts.push(st.why);
  else if (typeof st.reason === 'string') parts.push(st.reason);
  if (Array.isArray(st.unanchored) && st.unanchored.length) {
    const r = st.unanchored[0].from_reason || st.unanchored[0].reason || 'no anchor established';
    parts.push(`${st.unanchored.length} found in source, none anchored to a numbered line (${r.replace(/-/g, ' ')})`);
  }
  if (typeof st.scope === 'string') parts.push('scope: ' + st.scope);
  if (typeof st.index_limit === 'string') parts.push('limit: ' + st.index_limit);
  return parts.length ? parts.join(' · ') : 'loaded; the layer holds no features and records no reason';
}

/* ── rows: built once, then only their tag and note change ────────────────── */

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
  const word = s.status.split(' ')[0];
  if (r.tag.textContent !== `[${s.status}]`) { r.tag.textContent = `[${s.status}]`; r.tag.className = 'ltag ' + word; }
  let note = l.evidence ?? '';
  if (s.why) note += ' · ' + s.why;
  if (s.status === 'OK' && s.doc?.stats) note += ' · ' + JSON.stringify(s.doc.stats).slice(0, 80);
  if (!s.on && s.loaded) note += ' · hidden; kept in memory';
  if (r.note.textContent !== note) r.note.textContent = note;
  if (r.input.checked !== !!s.on) r.input.checked = !!s.on;
}

function paintMeter() {
  if (!manifest) return;
  $('layersMeter').textContent = `features in memory ${fmt(heldFeatures())} of a ${fmt(FEATURE_CAP)} ceiling · ` +
    `${queue.active} of ${MAX_FETCH} fetches busy · ${queue.waiting.length} queued · ${fmt(LOADER.evictions)} released at the ceiling`;
}

/* ── the fetch queue and the shared URL cache ────────────────────────────── */

class FetchQueue {
  constructor(n) { this.n = n; this.active = 0; this.waiting = []; }
  async add(task) {
    if (this.active >= this.n) { await new Promise(res => this.waiting.push(res)); paintMeter(); }
    this.active++; paintMeter();
    try { return await task(); }
    finally { this.active--; if (this.waiting.length) this.waiting.shift()(); paintMeter(); }
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
  for (const l of manifest.layers) {
    const s = state.get(l.id);
    if (s.tiles) {
      for (const b of s.tiles.bands) if (b.loaded || b.loading) n += b.m.features;
    } else if (s.loaded && s.doc) n += s.doc.features.length;
    else if (s.loading) n += Number(l.features) || 0;
  }
  return n;
}

/* Frees memory until `need` more features fit, or says it cannot. Hidden layers
   go first, least recently used; then bands of tiled layers outside `keep`,
   farthest from their view first. Nothing in `keep` and nothing visible and
   whole is ever released. */
function makeRoom(need, keep) {
  while (heldFeatures() + need > FEATURE_CAP) {
    let victim = null, score = -Infinity;
    for (const l of manifest.layers) {
      const s = state.get(l.id);
      if (s.tiles) {
        for (const b of s.tiles.bands) {
          if (!b.loaded || b.m.features === 0 || keep?.has(b)) continue;
          const far = s.on && s.tiles.view ? Math.min(Math.abs(b.m.band - s.tiles.view[0]), Math.abs(b.m.band - s.tiles.view[1])) : 1e6;
          const sc = (s.on ? 0 : 1e9 - s.used) + far;
          if (sc > score) { score = sc; victim = () => releaseBand(l, s, b); }
        }
      } else if (!s.on && s.loaded && s.doc && s.doc.features.length) {
        const sc = 2e9 - s.used;
        if (sc > score) { score = sc; victim = () => releaseWhole(l, s); }
      }
    }
    if (!victim) return false;
    victim();
    LOADER.evictions++;
  }
  return true;
}

function releaseWhole(l, s) {
  urlCache.delete(ROOT + l.file);
  s.doc = null; s.cache = null; s.loaded = false; s.status = 'WAIT';
  s.why = 'released from memory at the ceiling; fetched again if ticked';
  paintRow(l);
}

function releaseBand(l, s, b) {
  urlCache.delete(b.url);
  b.doc = null; b.cache = null; b.loaded = false;
}

/* ── hydrating a whole layer ─────────────────────────────────────────────── */

async function hydrateWhole(l, s) {
  if (s.loaded || s.loading) return;
  const want = Number(l.features) || 0;
  if (!makeRoom(want)) return refuse(l, s, want);
  s.loading = true; s.status = 'LOAD'; s.why = ''; paintRow(l); paintMeter();
  try {
    const doc = await fetchJSON(ROOT + l.file);
    s.loading = false;
    const n = doc.features.length;
    if (n > want && !makeRoom(n - want)) { urlCache.delete(ROOT + l.file); return refuse(l, s, n); }
    s.doc = doc; s.loaded = true;
    s.cache = n ? buildCache(doc) : null;
    s.status = n ? 'OK' : 'EMPTY';
    s.why = n ? '' : emptyReason(doc.stats);
  } catch (e) {
    s.loading = false; s.status = 'FAIL'; s.why = e.message;
  }
  paintRow(l); paintMeter();
  if (s.status === 'OK') renderElements();
  drawOverlay();
}

function refuse(l, s, want) {
  const held = heldFeatures();
  s.on = false; s.loading = false; s.status = 'REFUSED';
  s.why = `not loaded: its ${fmt(want)} features and the ${fmt(held)} already in memory that cannot be released would come to ${fmt(held + want)}, ` +
    `above the ${fmt(FEATURE_CAP)} ceiling; untick another layer first`;
  paintRow(l); paintMeter(); writeLayersToURL();
}

/* ── hydrating a tiled layer: the index, then only bands in view ─────────── */

async function hydrateTiled(l, s) {
  if (s.loaded || s.loading) return;
  s.loading = true; s.status = 'LOAD'; s.why = 'reading the band index'; paintRow(l);
  try {
    const index = await fetchJSON(tileSet.layers[l.id]);
    s.tiles = { S: index.scheme.S, view: null, stats: index.stats, bands: index.bands.map(m => ({ m, url: m.file, loaded: false, loading: false, doc: null, cache: null })) };
    s.loaded = true; s.loading = false; s.status = 'OK'; s.why = '';
  } catch (e) {
    s.loading = false; s.status = 'FAIL'; s.why = e.message;
  }
  paintRow(l);
  updateTiles();
}

const minZoomOf = (s, v) => Math.max(v.w, v.h) / (TILE_SPAN_BANDS * s.tiles.S);

/* The bands a screen can show: r = sqrt(key), so the rectangle's nearest and
   farthest distance from the origin bound the band range. */
function bandsInView(s, v) {
  const z = v.zoom, hw = v.w / 2 / z, hh = v.h / 2 / z;
  const ax = Math.abs(v.x), ay = Math.abs(v.y);
  const r0 = Math.hypot(Math.max(ax - hw, 0), Math.max(ay - hh, 0)), r1 = Math.hypot(ax + hw, ay + hh);
  const n = s.tiles.bands.length;
  return [Math.min(n, Math.floor(r0 / s.tiles.S)), Math.min(n - 1, Math.floor(r1 / s.tiles.S))];
}

function updateTiles() {
  const v = liveView();
  if (!v || !v.w || !manifest) return;
  for (const l of manifest.layers) {
    const s = state.get(l.id);
    if (!s.on || !s.tiles) continue;
    const mz = minZoomOf(s, v);
    let why;
    if (v.zoom < mz) {
      s.tiles.view = null;
      why = `drawn by radius band from zoom ${mz.toFixed(1)}; now ${v.zoom.toFixed(2)}, zoom in`;
    } else {
      const [b0, b1] = bandsInView(s, v);
      s.tiles.view = [b0, b1];
      const keep = new Set(s.tiles.bands.slice(b0, b1 + 1));
      let blocked = 0;
      for (const b of keep) {
        if (b.loaded || b.loading) continue;
        if (b.m.features === 0) { b.loaded = true; continue; }
        if (!makeRoom(b.m.features, keep)) { blocked++; continue; }
        loadBand(l, s, b);
      }
      const inMem = s.tiles.bands.filter(b => b.loaded && b.m.features).length;
      why = `bands ${b0}–${b1} in view · ${inMem} of ${s.tiles.bands.length} bands in memory` +
        (blocked ? ` · ${blocked} band(s) in view not loaded: they would cross the ${fmt(FEATURE_CAP)} ceiling` : '');
    }
    if (s.why !== why) { s.why = why; paintRow(l); }
  }
  paintMeter();
}

async function loadBand(l, s, b) {
  b.loading = true;
  try {
    const doc = await fetchJSON(b.url);
    if (doc.features.length !== b.m.features) throw new Error(`band ${b.m.band} holds ${doc.features.length} features, index says ${b.m.features}`);
    b.doc = doc; b.cache = buildCache(doc); b.loaded = true;
  } catch (e) {
    s.status = 'FAIL'; s.why = `band ${b.m.band}: ${e.message}`; paintRow(l);
  }
  b.loading = false;
  paintMeter();
  drawOverlay();
  updateTiles();
}

/* ── ticking ─────────────────────────────────────────────────────────────── */

function toggle(l, on) {
  const s = state.get(l.id);
  s.on = on;
  if (on) {
    s.used = ++clock;
    if (s.status === 'REFUSED') { s.status = 'WAIT'; s.why = ''; }
    if (tileSet?.layers?.[l.id]) hydrateTiled(l, s); else hydrateWhole(l, s);
  } else if (picked?.layer.id === l.id) inspect(null);
  paintRow(l); paintMeter(); writeLayersToURL();
  if (!on || s.loaded) { renderElements(); drawOverlay(); if (on) updateTiles(); }
}

/* ── world positions, once per layer or band ─────────────────────────────── */

function buildCache(doc) {
  const ptKeys = [], ptFeat = [], rtKeys = [], rtStart = [0], rtFeat = [];
  doc.features.forEach((f, i) => {
    const g = f.geometry;
    if (g?.type === 'Point') { ptKeys.push(g.key); ptFeat.push(i); }
    else if (g?.type === 'LineString' && g.keys?.length) {
      for (const k of g.keys) rtKeys.push(k);
      rtStart.push(rtKeys.length); rtFeat.push(i);
    }
  });
  const pts = placeAll(ptKeys), verts = placeAll(rtKeys);
  const nR = rtFeat.length, box = new Float32Array(nR * 4);
  for (let r = 0; r < nR; r++) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let j = rtStart[r]; j < rtStart[r + 1]; j++) {
      const x = verts[j * 2], y = verts[j * 2 + 1];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    box[r * 4] = x0; box[r * 4 + 1] = y0; box[r * 4 + 2] = x1; box[r * 4 + 3] = y1;
  }
  return { pts, ptFeat: Int32Array.from(ptFeat), verts, rtStart: Uint32Array.from(rtStart), rtFeat: Int32Array.from(rtFeat), box };
}

/* ── ELEMENT cards: a short section, rebuilt only when a layer turns OK or off ── */
const ENGINE_LIVE = 'https://ventusltd.github.io/ventus-grid-engine/';

function renderElements() {
  const body = $('layersBody');
  if (!body || !manifest) return;
  $('layersElements')?.remove();
  const link = (href, text) => {
    const a = node('a', text, 'elink');
    a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
    return a;
  };
  const cards = new Map();
  for (const l of manifest.layers) {
    const s = state.get(l.id);
    if (!s?.on || s.status !== 'OK' || !s.doc) continue;
    for (const f of s.doc.features) {
      const p = f.properties;
      if (!p || !('schema' in p || 'export_subpath' in p)) continue;
      if (!p.module_path || !p.block) continue;
      if (!cards.has(p.block)) cards.set(p.block, { title: p.title, colour: l.colour, modules: new Map(), functions: new Set() });
      const c = cards.get(p.block);
      c.functions.add(p.function);
      if (!c.modules.has(p.module_path)) c.modules.set(p.module_path, p);
    }
  }
  if (!cards.size) return;
  const sec = node('div'); sec.id = 'layersElements';
  sec.appendChild(node('div', 'ELEMENT', 'lgroup'));
  for (const [sym, c] of [...cards].sort((a, b) => a[0].localeCompare(b[0]))) {
    const card = node('div', null, 'ecard');
    const head = node('div', null, 'ehead');
    const symEl = node('span', sym, 'esym'); symEl.style.color = c.colour;
    head.append(symEl, node('span', ' ' + (c.title || ''), 'ename'));
    card.appendChild(head);
    card.appendChild(node('div', [...c.functions].join(', '), 'efns'));
    for (const [path, p] of c.modules) {
      const m = node('div', null, 'emod');
      const kv = (k, v, cls) => { const r = node('div', null, 'ekv'); r.append(node('span', k + ' ', 'ek'), node('span', v, cls || 'ev')); m.appendChild(r); };
      kv('module', path);
      kv('export', p.export_subpath ?? ('none — ' + (p.export_reason || 'no subpath')), p.export_subpath ? 'ev' : 'ev enone');
      kv('schema', p.schema ?? ('none — ' + (p.schema_reason || 'no schema')), p.schema ? 'ev eschema' : 'ev enone');
      kv('refuses', (p.refuses && p.refuses.length) ? p.refuses.join(', ')
        : (p.not_computed_form ? `NOT_COMPUTED is a ${p.not_computed_form}, no keys` : 'nothing declared'));
      const links = node('div', null, 'elinks');
      links.append(link(ENGINE_LIVE, 'live engine'), node('span', ' · '),
        link(p.github || `https://github.com/Ventusltd/ventus-grid-engine/blob/main/${path}`, 'GitHub ' + path));
      m.appendChild(links);
      card.appendChild(m);
    }
    sec.appendChild(card);
  }
  body.appendChild(sec);
}

/* ── the URL: ?layers=engine,declared ─────────────────────────────────────── */

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
  const raw = new URL(location.href).searchParams.get('layers') || '';
  const known = new Map(manifest.layers.map(l => [l.id, l]));
  const asked = [...new Set(raw.split(',').map(x => x.trim()).filter(Boolean))];
  const dropped = asked.filter(id => !known.has(id));
  if (dropped.length) {
    $('layersWarn').textContent = `dropped from the URL, not in layers/manifest.json: ${dropped.join(', ')}`;
    $('layersWarn').hidden = false;
  }
  for (const id of asked) if (known.has(id)) toggle(known.get(id), true);
  if (raw) writeLayersToURL();
}

/* ── drawing ─────────────────────────────────────────────────────────────── */

const liveView = () => window.__wafer?.view ?? null;

/* Every drawable unit: a whole ticked layer, or a loaded band of a ticked tiled
   layer that is in view at or above its minimum zoom. */
function* drawUnits(v) {
  for (const l of (manifest?.layers || [])) {
    const s = state.get(l.id);
    if (!s?.on) continue;
    if (s.tiles) {
      if (!v || v.zoom < minZoomOf(s, v)) continue;
      const [b0, b1] = bandsInView(s, v);
      for (let b = b0; b <= b1; b++) { const t = s.tiles.bands[b]; if (t?.cache) yield [l, t.cache, t.doc]; }
    } else if (s.status === 'OK' && s.cache) yield [l, s.cache, s.doc];
  }
}

/* MOVING FRAMES WITHOUT RE-STROKING. The overlay canvas is OVERLAY_SPAN times the
   screen each way, centred on it. A settled frame rasterises every unit into it
   around the current camera (the anchor). While the wafer reports a gesture, a
   frame only sets a CSS transform that carries the anchor raster to where the
   camera now puts it, which costs no drawing at all; only when that raster no
   longer covers the screen, or is magnified past OVERLAY_MAGNIFY, is it drawn
   again, thinned to every THIN_STEP-th vertex, around the moving camera.
   Measured reason: in WebKit at iPhone 13 size, stroking ten module layers took
   most of each moving frame even thinned (numbers in the commit message). */
const OVERLAY_SPAN = 1.5;
const OVERLAY_MAGNIFY = 2;
let overlayDirty = false, lastTileView = '', anchor = null;

function placeOverlay(v) {
  const dpr = v.dpr || 1;
  const cw = Math.round(v.w * OVERLAY_SPAN), ch = Math.round(v.h * OVERLAY_SPAN);
  const W = Math.round(cw * dpr), H = Math.round(ch * dpr);
  if (overlay.width !== W || overlay.height !== H) {
    overlay.width = W; overlay.height = H;
    overlay.style.width = cw + 'px'; overlay.style.height = ch + 'px';
    overlay.style.left = Math.round((v.w - cw) / 2) + 'px'; overlay.style.top = Math.round((v.h - ch) / 2) + 'px';
    overlayDirty = true; anchor = null;
  }
  return { cw, ch, dpr };
}

/* The CSS transform that carries the anchor raster to the camera v, or null when
   the result would leave part of the screen uncovered or be too magnified. */
function carry(v, cw, ch) {
  if (!anchor || anchor.w !== v.w || anchor.h !== v.h) return null;
  const s = v.zoom / anchor.zoom;
  if (s > OVERLAY_MAGNIFY) return null;
  const dx = (anchor.x - v.x) * v.zoom, dy = -(anchor.y - v.y) * v.zoom;   /* where the anchor centre lands, from screen centre */
  if (Math.abs(dx) + v.w / 2 > s * cw / 2 || Math.abs(dy) + v.h / 2 > s * ch / 2) return null;
  return `translate(${dx.toFixed(2)}px,${dy.toFixed(2)}px) scale(${s.toFixed(5)})`;
}

function drawOverlay(snap) {
  const v = snap && typeof snap.zoom === 'number' ? snap : liveView();
  if (!v || !v.w || !v.h) return;
  const { cw, ch, dpr } = placeOverlay(v);

  /* A settled view that differs from the last one asks for the bands it shows. */
  if (!v.moving) {
    const key = `${v.x.toFixed(2)},${v.y.toFixed(2)},${v.zoom.toFixed(4)},${v.w},${v.h}`;
    if (key !== lastTileView) { lastTileView = key; setTimeout(updateTiles, 0); }
  }

  if (v.moving && snap) {
    const t = carry(v, cw, ch);
    if (t) { overlay.style.transform = t; LOADER.carried++; return; }
  }

  const units = [...drawUnits(v)];
  overlay.style.transform = '';
  if (!units.length && !picked && !overlayDirty) { LOADER.keysDrawn = 0; anchor = null; return; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  overlayDirty = units.length > 0 || !!picked;
  anchor = { x: v.x, y: v.y, zoom: v.zoom, w: v.w, h: v.h };

  /* The wafer's own mapping, shifted into the larger canvas:
     X = (x - v.x) * zoom + cw/2, Y = ch/2 - (y - v.y) * zoom. */
  const z = v.zoom, ox = cw / 2 - v.x * z, oy = ch / 2 + v.y * z;
  const step = v.moving ? THIN_STEP : 1;
  const wx0 = (-2 - ox) / z, wx1 = (cw + 2 - ox) / z, wy0 = (oy - ch - 2) / z, wy1 = (oy + 2) / z;
  let keys = 0;

  for (const [l, c] of units) {
    ctx.globalAlpha = l.draws === 'lines' ? 0.55 : 0.8;
    if (c.ptFeat.length) {
      ctx.fillStyle = l.colour;
      ctx.beginPath();
      const P = c.pts;
      for (let i = 0; i < c.ptFeat.length; i += step) {
        const X = P[i * 2] * z + ox, Y = oy - P[i * 2 + 1] * z;
        if (X < -2 || Y < -2 || X > cw + 2 || Y > ch + 2) continue;
        ctx.rect(X - 1, Y - 1, 2, 2);
        keys++;
      }
      ctx.fill();
    }
    if (c.rtFeat.length) {
      ctx.strokeStyle = l.colour; ctx.lineWidth = 1;
      ctx.beginPath();
      const V = c.verts, B = c.box, S = c.rtStart;
      for (let r = 0; r < c.rtFeat.length; r++) {
        if (B[r * 4 + 2] < wx0 || B[r * 4] > wx1 || B[r * 4 + 3] < wy0 || B[r * 4 + 1] > wy1) continue;
        const a = S[r], e = S[r + 1] - 1;
        ctx.moveTo(V[a * 2] * z + ox, oy - V[a * 2 + 1] * z);
        keys++;
        for (let j = a + step; j < e; j += step) { ctx.lineTo(V[j * 2] * z + ox, oy - V[j * 2 + 1] * z); keys++; }
        if (e > a) { ctx.lineTo(V[e * 2] * z + ox, oy - V[e * 2 + 1] * z); keys++; }
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  LOADER.keysDrawn = keys;
  LOADER.rasters++;

  if (picked) {
    const g = picked.feature.geometry;
    ctx.strokeStyle = picked.layer.colour; ctx.lineWidth = 1.4;
    const pk = g.type === 'Point' ? [g.key] : g.keys;
    const P = placeAll(pk);
    for (let i = 0; i < pk.length; i++) {
      ctx.beginPath(); ctx.arc(P[i * 2] * z + ox, oy - P[i * 2 + 1] * z, 7, 0, 6.2832); ctx.stroke();
    }
  }
}

window.__wafer?.onDraw.add(drawOverlay);

/* ── tap to inspect ──────────────────────────────────────────────────────── */

function segDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
  const qx = ax + t * dx - px, qy = ay + t * dy - py;
  return qx * qx + qy * qy;
}

function pickAt(cx, cy) {
  const v = liveView();
  if (!v || !v.zoom) return null;
  const z = v.zoom, ox = v.w / 2 - v.x * z, oy = v.h / 2 + v.y * z;
  let best = null, bestD = PICK_REACH * PICK_REACH;
  for (const [l, c, doc] of drawUnits(v)) {
    for (let i = 0; i < c.ptFeat.length; i++) {
      const X = c.pts[i * 2] * z + ox, Y = oy - c.pts[i * 2 + 1] * z;
      const d = (X - cx) ** 2 + (Y - cy) ** 2;
      if (d < bestD) { bestD = d; best = { layer: l, feature: doc.features[c.ptFeat[i]] }; }
    }
    const V = c.verts, S = c.rtStart;
    for (let r = 0; r < c.rtFeat.length; r++) {
      const a = S[r], e = S[r + 1];
      let px = V[a * 2] * z + ox, py = oy - V[a * 2 + 1] * z;
      let d = (px - cx) ** 2 + (py - cy) ** 2;
      for (let j = a + 1; j < e; j++) {
        const qx = V[j * 2] * z + ox, qy = oy - V[j * 2 + 1] * z;
        d = Math.min(d, segDist2(cx, cy, px, py, qx, qy));
        px = qx; py = qy;
      }
      if (d < bestD) { bestD = d; best = { layer: l, feature: doc.features[c.rtFeat[r]] }; }
    }
  }
  return best;
}

function valueNode(val) {
  const dd = node('dd');
  if (val !== null && typeof val === 'object' && !Array.isArray(val) && typeof val.meaning === 'string') {
    const rest = Object.entries(val).filter(([k]) => k !== 'meaning')
      .map(([k, x]) => (Array.isArray(x) ? x.join(', ') : (x !== null && typeof x === 'object' ? JSON.stringify(x) : String(x))));
    dd.append(node('div', rest.join(' · ')), node('div', val.meaning, 'lmeaning'));
    return dd;
  }
  dd.textContent = val !== null && typeof val === 'object' ? JSON.stringify(val) : String(val);
  return dd;
}

function inspect(hit) {
  picked = hit;
  const box = $('layersInspect');
  box.replaceChildren();
  if (!hit) { box.hidden = true; drawOverlay(); return; }
  const { layer: l, feature: f } = hit;
  const close = node('button', '✕');
  close.id = 'layersInspectClose'; close.type = 'button'; close.setAttribute('aria-label', 'close');
  close.addEventListener('click', () => inspect(null));
  const h = node('h3', l.label); h.style.color = l.colour;
  const g = f.geometry;
  const where = node('div', g.type === 'Point' ? `line ${g.key}` : `lines ${g.keys.join(' → ')}`, 'lnote');
  const dl = node('dl');
  for (const [k, val] of Object.entries(f.properties || {})) dl.append(node('dt', k), valueNode(val));
  const ev = node('div', 'evidence: ' + (l.evidence ?? 'none recorded'), 'lnote');
  box.append(close, h, where, dl, ev);
  box.hidden = false;
  $('layersBody').hidden = false;
  drawOverlay();
}

/* Non-capturing, and never prevents or stops the event. */
{
  const pts = new Map();
  let moved = 0, wasPinch = false;   /* the last finger of a pinch lifting is not a tap */
  const onStage = e => e.target instanceof Element && e.target.id === 'stage';
  document.addEventListener('pointerdown', e => {
    if (!onStage(e)) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 1) { moved = 0; wasPinch = false; }
    if (pts.size >= 2) wasPinch = true;
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
    if (e.type !== 'pointerup' || !single || moved >= TAP_SLOP || wasPinch) return;
    const hit = pickAt(e.clientX, e.clientY);
    if (hit) inspect(hit);
  };
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
}

/* Read-only numbers for the Questions panel and for tests. */
window.__waferLayers = Object.freeze({
  get stats() {
    let bands = 0;
    if (manifest) for (const s of state.values()) if (s.tiles) bands += s.tiles.bands.filter(b => b.loaded && b.m.features).length;
    return Object.freeze({ held: manifest ? heldFeatures() : 0, cap: FEATURE_CAP, bandsInMemory: bands, evictions: LOADER.evictions,
      keysDrawn: LOADER.keysDrawn, fetches: LOADER.fetches, overlayRasters: LOADER.rasters, overlayCarried: LOADER.carried, active: queue.active, queued: queue.waiting.length });
  }
});

(async () => {
  try {
    const [m, t] = await Promise.all([
      fetchJSON(ROOT + 'layers/manifest.json'),
      fetchJSON('tiles/index.json').catch(() => null)
    ]);
    urlCache.delete(ROOT + 'layers/manifest.json');
    manifest = m; tileSet = t;
    for (const l of manifest.layers) state.set(l.id, freshState());
    buildRows();
    $('layersRule').textContent = tileSet
      ? `tiles: a layer over ${fmt(tileSet.tile_over)} features loads by radius band (band = isqrt(key) ÷ ${tileSet.S}), ` +
        `only bands on screen, from the zoom where the screen spans ${TILE_SPAN_BANDS} bands; at the ceiling hidden layers, then bands off screen, are released`
      : 'tiles: the band index could not be read, so large layers load whole and the ceiling refuses them';
    paintMeter();
    for (const l of manifest.layers) if (l.preload) toggle(l, true);
    readLayersFromURL();
  } catch (e) {
    $('layersList').replaceChildren(node('div', `Layers unavailable: ${e.message}. The wafer itself is unaffected.`, 'lnote'));
  }
})();
