/* layers-panel.mjs — Apps, Layers, Substrate (iteration 26).
 *
 * Iteration 21's dark-pixels layers panel, copied. What differs:
 *
 * TWO REASONS A LAYER IS AWAKE. A layer is woken either because the reader
 * ticked it by hand (state.on, written to ?layers=) or because the selected app
 * tab asked for it (state.app, never written to ?layers=; the app is ?app=).
 * It is drawn while either holds.
 *
 * HIDE, THEN EVICT (Grid Atlas: turning a layer off hides it). When neither
 * holds, the layer is hidden and its data kept, so going back to an app draws
 * at once with no new request. Hidden data is capped: while the hidden layers'
 * files add up to more than KEEP_HIDDEN_BYTES (read from the manifest's own
 * byte counts), the layer hidden longest ago is evicted: its positions, its
 * document and its cached request are dropped and its row returns to WAIT. The
 * cap is about one large app, so memory holds the app on screen, the layers
 * ticked by hand, and at most about one app's worth hidden.
 *
 * ONE ROW AT A TIME. The list of layers is built once. A change of state
 * updates only that layer's row; nothing rebuilds the list per event, which
 * matters when an app wakes dozens of module layers together.
 *
 * ONE QUEUE. Every file goes through queue.mjs (at most three in flight). A
 * layer still waiting for a slot when its app is switched away is dropped
 * without a request.
 *
 * The Grid Atlas point recipe, the ELEMENT cards and tap to inspect are
 * iteration 21's code unchanged, with their own comments in place.
 */
import { place } from '../../lib.mjs';
import { fetchJSON, forget } from './queue.mjs';
const ROOT = '../../';   /* this page lives two folders below the wafer's root */

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = new Map();   /* id -> {status, on, app, doc, geo, why, loading} */
let manifest = null;
let droppedIds = [];       /* layer ids asked for in the URL that the manifest does not name */
let picked = null;         /* {layer, feature} currently inspected */
const listeners = new Set();   /* called with the ids whose state changed, once per frame */

const TAP_SLOP = 7;        /* px of movement under which a pointer-up is a tap */
const PICK_REACH = 14;     /* px within which a tap picks a layer feature */
const wanted = s => !!(s && (s.on || s.app));
export const KEEP_HIDDEN_BYTES = 300 * 1024;
let hideSeq = 0;

/* ── the panel ───────────────────────────────────────────────────────────── */

const panel = document.createElement('section');
panel.id = 'layers';
panel.innerHTML = `<button id="layersToggle" type="button">LAYERS</button><div id="layersBody" hidden><div id="layersInspect" hidden></div><div id="layersList"></div></div>`;
document.body.appendChild(panel);

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
#layersInspect .lmeaning{color:#8b93a7;font-size:10.5px;margin-top:.1rem}
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
.lwarn{color:#ffd54a;margin-left:0}
.ecard{border:1px solid #1b2030;border-radius:6px;padding:.35rem .45rem;margin:.3rem 0;background:#11151f}
.ehead .esym{font-weight:700}.ename{color:#e7ebf3}
.efns{color:#8b93a7;font-size:10.5px;margin:.1rem 0 .2rem}
.emod{border-top:1px dashed #1b2030;padding-top:.2rem;margin-top:.2rem}
.ekv{font-size:10.5px;word-break:break-word}.ek{color:#8b93a7}.ev{color:#e7ebf3}
.eschema{color:#7fd6a2}.enone{color:#b39ddb}
.elinks{font-size:10.5px;margin-top:.15rem}.elink{color:#5ec8f2}
#overlay{position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:1}
`;
document.head.appendChild(style);

const overlay = document.createElement('canvas');
overlay.id = 'overlay';
document.body.appendChild(overlay);
const ctx = overlay.getContext('2d');

$('layersToggle').addEventListener('click', () => { $('layersBody').hidden = !$('layersBody').hidden; });

/* Why a layer is EMPTY, in the layer's own words. Builders record it under
   stats.why (the MSI builders) or stats.reason; a layer that found things in
   source it could not anchor lists them under stats.unanchored. Scope and index
   limits follow, because an empty result is only as wide as what was searched.
   With none of these the page says so rather than inventing a reason. */
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

const rowEls = new Map();   /* id -> {box, tag, note} */

function tagText(s) {
  const by = s.app && s.on ? ' · app + hand' : (s.app ? ' · app' : (s.doc ? ' · hidden, kept' : ''));
  return `[${s.status}${by}]`;
}
function noteText(l, s) {
  const why = s.why ? ` · ${s.why}` : '';
  const stat = s.status === 'OK' && s.doc?.stats ? ` · ${JSON.stringify(s.doc.stats).slice(0, 80)}` : '';
  return `${l.evidence ?? ''}${why}${stat}`;
}

/* Built once (and again only if the URL named unknown layers). Afterwards
   updateRow() touches one row. */
function renderPanel() {
  if (!manifest) return;
  const groups = [...new Set(manifest.layers.map(l => l.group))];
  const warn = droppedIds.length
    ? `<div class="lnote lwarn">dropped from the URL, not in layers/manifest.json: ${esc(droppedIds.join(', '))}</div>` : '';
  $('layersList').innerHTML = warn + groups.map(g =>
    `<div class="lgroup">${esc(g)}</div>` + manifest.layers.filter(l => l.group === g).map(l =>
      `<div class="lrow"><input type="checkbox" id="L-${esc(l.id)}">
       <label class="lname" for="L-${esc(l.id)}" style="color:${esc(l.colour)}">${esc(l.label)}
       <span class="ltag WAIT" id="T-${esc(l.id)}">[WAIT]</span></label></div>
       <div class="lnote" id="N-${esc(l.id)}"></div>`).join('')
  ).join('') + `<div class="lnote">substrate ${esc(manifest.substrate)} · frozen · layers built ${esc(manifest.built_utc)}</div>`
    + `<div class="lnote">memory: a layer turned off, or left by switching app, is hidden and kept; hidden layers are capped at ${Math.round(KEEP_HIDDEN_BYTES / 1024)} KB of layer files (the manifest's byte counts) and the one hidden longest ago is evicted first. Requests: one queue, four at a time, 15 s timeout, one request per file. Every feature is drawn on one canvas, never as a page element.</div>`
    + `<div class="lnote">dark pixels: every line is drawn dark; a ticked layer, or the selected app, wakes only the lines it charts. "app" in a tag marks a layer woken by the selected app rather than by hand.</div>`;
  rowEls.clear();
  for (const l of manifest.layers) {
    const box = $('L-' + l.id);
    box.addEventListener('change', e => toggle(l, e.target.checked));
    rowEls.set(l.id, { box, tag: $('T-' + l.id), note: $('N-' + l.id) });
    updateRow(l);
  }
}

function updateRow(l) {
  const s = state.get(l.id), r = rowEls.get(l.id);
  if (!s || !r) return;
  r.box.checked = !!s.on;
  r.tag.className = 'ltag ' + String(s.status).split(' ')[0];
  r.tag.textContent = tagText(s);
  r.note.textContent = noteText(l, s);
}

/* One frame per burst: overlay, element cards and listeners, however many
   layers changed in that burst. */
let framePending = false;
const changed = new Set();
function changedLayer(l) {
  updateRow(l);
  changed.add(l.id);
  if (framePending) return;
  framePending = true;
  requestAnimationFrame(() => {
    framePending = false;
    const ids = [...changed]; changed.clear();
    drawOverlay();
    renderElements(manifest, state);
    for (const f of listeners) { try { f(ids); } catch (e) { console.warn('layer listener failed:', e); } }
  });
}

/* ── ELEMENT: what a consumer of a module meets ─────────────────────────────
   Shown when a layer that carries properties.schema or properties.export_subpath
   is OK. One card per block symbol, one entry per module that block's functions
   resolve to: its export subpath (or why there is none), the schema it stamps,
   what its NOT_COMPUTED refuses, and where it lives. Built from DOM nodes with
   textContent only; nothing from a dataset is ever parsed as HTML. */
const ENGINE_LIVE = 'https://ventusltd.github.io/ventus-grid-engine/';

function renderElements(manifest, state) {
  const body = $('layersBody');
  if (!body || !manifest) return;
  $('layersElements')?.remove();
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  };
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

const getJSON = (url, failPrefix, stillWanted) => fetchJSON(url, failPrefix, stillWanted);

/* Evict hidden layers, longest hidden first, until their files fit the cap. */
function enforceCap() {
  const hidden = manifest.layers.filter(l => { const s = state.get(l.id); return s.doc && !wanted(s); })
    .sort((a, b) => state.get(a.id).hiddenAt - state.get(b.id).hiddenAt);
  let bytes = hidden.reduce((n, l) => n + (l.bytes || 0), 0);
  for (const l of hidden) {
    if (bytes <= KEEP_HIDDEN_BYTES) break;
    const s = state.get(l.id);
    s.doc = null; s.geo = null; s.status = 'WAIT';
    s.why = `evicted: hidden layers held more than ${Math.round(KEEP_HIDDEN_BYTES / 1024)} KB`;
    if (l.file) forget(ROOT + l.file);
    bytes -= l.bytes || 0;
    evictions++;
    changedLayer(l);
  }
}
let evictions = 0;
function keptBytes() {
  let hidden = 0, shown = 0;
  for (const l of manifest?.layers || []) {
    const s = state.get(l.id);
    if (!s.doc) continue;
    if (wanted(s)) shown += l.bytes || 0; else hidden += l.bytes || 0;
  }
  return { shown, hidden };
}

function toggle(l, on) {
  const s = state.get(l.id);
  s.on = on;
  writeLayersToURL();
  settle(l);
}

/* Make a layer's memory agree with whether it is wanted: load it, or drop it. */
async function settle(l) {
  const s = state.get(l.id);
  if (!wanted(s)) {
    s.hiddenAt = ++hideSeq;
    if (!s.doc && !s.loading) { s.status = 'WAIT'; s.why = ''; }   /* a FAIL can be retried */
    if (picked?.layer.id === l.id) inspect(null);
    changedLayer(l);
    enforceCap();
    return;
  }
  if (s.doc || s.loading || s.status === 'FAIL' || s.status === 'EMPTY') { changedLayer(l); return; }
  s.loading = true; s.why = ''; s.status = 'LOAD'; changedLayer(l);
  try {
    const doc = l.tiles ? await hydrateTiles(l, s) : await getJSON(ROOT + l.file, 'HTTP ', () => wanted(s));
    s.doc = doc; s.geo = precompute(doc);
    s.status = doc.features.length ? 'OK' : 'EMPTY';
    if (!doc.features.length) s.why = emptyReason(doc.stats);
  } catch (e) {
    if (e.unwanted) s.status = 'WAIT';
    else { s.status = 'FAIL'; s.why = e.message; }
  }
  s.loading = false;
  if (wanted(s) && !s.doc && s.status === 'WAIT') { settle(l); return; }   /* wanted again meanwhile */
  changedLayer(l);
  if (!wanted(s)) { s.hiddenAt = ++hideSeq; enforceCap(); }   /* arrived after its app was left */
}

async function hydrateTiles(l, s) {
  const stillWanted = () => wanted(s);
  const index = await getJSON(ROOT + l.tiles, 'tile index HTTP ', stillWanted);
  const bands = index.bands || [];
  const N = bands.length;
  let n = 0;
  s.status = `LOAD ${n}/${N}`; updateRow(l);
  const parts = await Promise.all(bands.map(async b => {
    const doc = await getJSON(ROOT + b.file, `band ${b.band} HTTP `, stillWanted);
    if (doc.features.length !== b.features)
      throw new Error(`band ${b.band} holds ${doc.features.length} features, index says ${b.features}`);
    n++; s.status = `LOAD ${n}/${N}`; updateRow(l);
    return doc.features;
  }));
  const features = parts.flat();
  if (index.source && features.length !== index.source.features)
    throw new Error(`tiles hold ${features.length} features, source had ${index.source.features}`);
  return {
    type: 'CodeFeatureCollection', substrate: index.substrate, layer: index.layer,
    provenance: index.provenance, stats: { features: features.length, bands: N }, features,
  };
}

/* ── the URL: ?layers= carries only what was ticked by hand ─────────────── */

function writeLayersToURL() {
  if (!manifest) return;
  const on = manifest.layers.filter(l => state.get(l.id)?.on).map(l => l.id);
  const u = new URL(location.href);
  if (on.length) u.searchParams.set('layers', on.join(','));
  else u.searchParams.delete('layers');
  const next = u.pathname + u.search.replace(/%2C/gi, ',').replace(/%7E/gi, '~') + u.hash;
  if (next !== location.pathname + location.search + location.hash)
    history.replaceState(history.state, '', next);
}

function readLayersFromURL() {
  if (!manifest) return;
  const raw = new URL(location.href).searchParams.get('layers') || '';
  const known = new Map(manifest.layers.map(l => [l.id, l]));
  const asked = [...new Set(raw.split(',').map(x => x.trim()).filter(Boolean))];
  const wantedIds = asked.filter(id => known.has(id));
  droppedIds = asked.filter(id => !known.has(id));
  if (droppedIds.length) renderPanel();
  for (const id of wantedIds) state.get(id).on = true;
  if (raw) writeLayersToURL();
  for (const id of wantedIds) settle(known.get(id));
}

/* ── the one hook the app tabs use ───────────────────────────────────────── */

/* Wake exactly these layers for the selected app. Every layer the previous app
   woke and nobody ticked by hand is dropped from memory. */
function setApp(ids) {
  if (!manifest) return;
  const want = new Set(ids);
  for (const l of manifest.layers) {
    const s = state.get(l.id);
    const next = want.has(l.id);
    if (!!s.app === next) continue;
    s.app = next;
    settle(l);
  }
}

/* ── the camera: the wafer's own, read live ──────────────────────────────── */

const liveView = () => window.__wafer?.view ?? null;

/* The wafer's formula, exactly: see drawMarks() and nearestKeyAt() in app.mjs. */
const toScreen = (v, [x, y]) => [(x - v.x) * v.zoom + v.w / 2, v.h / 2 - (y - v.y) * v.zoom];

function* visibleLayers() {
  for (const l of (manifest?.layers || [])) {
    const s = state.get(l.id);
    if (wanted(s) && s.status === 'OK' && s.geo) yield [l, s];
  }
}

/* ── dark pixels: waking the charted keys ────────────────────────────────────
 *
 * The ground (app.mjs) is drawn near-black. Only keys a ticked layer charts are
 * woken, with Grid Atlas's own point recipe.
 *
 * ZOOM MAPPING. The wafer's zoom is screen pixels per world unit; a map's zoom
 * doubles its scale per step. So
 *
 *     atlas zoom = 8 + log2(wafer zoom)
 *
 * which puts atlas zoom 13.5 (where Grid Atlas first shows 11kV points) at a
 * wafer zoom of 2^5.5, about 45 px per unit. Under r = sqrt(key) each key owns
 * an area of pi square units, so neighbouring lines sit roughly 1.8 units, or
 * about 80 px, apart there: the zoom at which single lines separate, as single
 * 11kV substations separate on the map.
 *
 * RADIUS. Grid Atlas's 11kV stops, unchanged: 13.5 -> 4 px, 15 -> 8, 18 -> 18,
 * linear between. The Atlas hides 11kV below 13.5 (minzoom); here a woken line
 * must stay visible at every zoom, so two stops are added below it, 6 -> 2.5
 * and 10 -> 3, and the radius holds at the end stops beyond.
 * CASING. A black ring round every point, 1 px, widening to 2 px from 15, as
 * the Atlas's circle-stroke-color #000 on its asset and project layers.
 * BRIGHTNESS. Opacity 0.7 at 6 rising to 0.9 at 13.5 (the Atlas's project
 * opacity), plus a faint glow of the layer colour, opacity 0.15 at 2.4 times
 * the radius, from 13.5 on, as the Atlas's solar and wind glow layers.
 * ROUTES. A LineString is drawn point to point: a black casing 2.5 px wider
 * than the line, then the line in the layer colour, 1 px at 6 rising to 2.5 px
 * at 18 (the Atlas's 400kV width).
 *
 * PERFORMANCE. Each layer's world positions are computed once, when it loads,
 * into Float32Arrays (s.geo). A frame only transforms, culls and fills.
 */
const atlasZoom = z => 8 + Math.log2(z);
function interp(stops, x) {
  if (x <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [x1, y1] = stops[i];
    if (x <= x1) { const [x0, y0] = stops[i - 1]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  }
  return stops[stops.length - 1][1];
}
const RADIUS = [[6, 2.5], [10, 3], [13.5, 4], [15, 8], [18, 18]];
const CASING = [[13.5, 1], [15, 2]];
const OPACITY = [[6, 0.7], [13.5, 0.9]];
const LINE_W = [[6, 1], [18, 2.5]];

/* Once per layer: every woken point and every route vertex, in world units. */
function precompute(doc) {
  let nPts = 0, nRouteV = 0, nRoutes = 0;
  for (const f of doc.features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'Point') nPts++;
    else if (g.type === 'LineString' && Array.isArray(g.keys)) { nPts += g.keys.length; nRouteV += g.keys.length; nRoutes++; }
  }
  const pts = new Float32Array(nPts * 2), ptFeat = new Int32Array(nPts);
  const rv = new Float32Array(nRouteV * 2), rStart = new Uint32Array(nRoutes), rLen = new Uint32Array(nRoutes), rFeat = new Int32Array(nRoutes);
  const woken = new Set();
  let p = 0, v = 0, r = 0;
  doc.features.forEach((f, fi) => {
    const g = f.geometry;
    if (!g) return;
    if (g.type === 'Point') {
      const [x, y] = place(g.key); pts[p * 2] = x; pts[p * 2 + 1] = y; ptFeat[p++] = fi; woken.add(g.key);
    } else if (g.type === 'LineString' && Array.isArray(g.keys)) {
      rStart[r] = v; rLen[r] = g.keys.length; rFeat[r++] = fi;
      for (const k of g.keys) {
        const [x, y] = place(k);
        rv[v * 2] = x; rv[v * 2 + 1] = y; v++;
        pts[p * 2] = x; pts[p * 2 + 1] = y; ptFeat[p++] = fi; woken.add(k);
      }
    }
  });
  return { pts, ptFeat, nPts, rv, rStart, rLen, rFeat, nRoutes, woken };
}

/* One sprite per colour, radius step, casing, opacity and glow; at most
   SPRITE_CAP kept, the oldest dropped first. */
const SPRITE_CAP = 64;
const sprites = new Map();
let lastDrawn = 0;
function sprite(colour, rad, cas, op, glow, dpr) {
  const r4 = Math.round(rad * 4) / 4, c4 = Math.round(cas * 4) / 4, o = Math.round(op * 50) / 50;
  const key = `${colour}|${r4}|${c4}|${o}|${glow ? 1 : 0}|${dpr}`;
  let S = sprites.get(key);
  if (S) return S;
  const half = Math.ceil((glow ? r4 * 2.4 : r4 + c4) + 1);
  const cv = document.createElement('canvas');
  cv.width = cv.height = Math.ceil(half * 2 * dpr);
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (glow) { g.globalAlpha = 0.15; g.fillStyle = colour; g.beginPath(); g.arc(half, half, r4 * 2.4, 0, 6.2832); g.fill(); }
  g.globalAlpha = 1; g.fillStyle = '#000'; g.beginPath(); g.arc(half, half, r4 + c4, 0, 6.2832); g.fill();
  g.globalAlpha = o; g.fillStyle = colour; g.beginPath(); g.arc(half, half, r4, 0, 6.2832); g.fill();
  S = { canvas: cv, half };
  sprites.set(key, S);
  if (sprites.size > SPRITE_CAP) sprites.delete(sprites.keys().next().value);
  return S;
}

function drawOverlay() {
  const v = liveView();
  if (!v || !v.w || !v.h) return;          /* the wafer has not framed itself yet */
  const dpr = v.dpr || 1;
  const W = Math.round(v.w * dpr), H = Math.round(v.h * dpr);
  if (overlay.width !== W || overlay.height !== H) { overlay.width = W; overlay.height = H; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, v.w, v.h);

  const az = atlasZoom(v.zoom);
  const rad = interp(RADIUS, az), cas = interp(CASING, az), op = interp(OPACITY, az), lw = interp(LINE_W, az);
  const z = v.zoom, ox = v.w / 2 - v.x * z, oy = v.h / 2 + v.y * z;   /* screen = world*z + o, y flipped */
  const pad = rad * 2.4 + 2, maxX = v.w + pad, maxY = v.h + pad;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';

  const layers = [...visibleLayers()];
  /* Iteration 26: the same recipe, drawn in fewer operations. An app wakes
     dozens of module layers at once, and filling thousands of arcs per frame
     cost hundreds of milliseconds on a software-rendered phone canvas. So:
     every route casing is one stroke and every route colour one stroke per
     colour; every point is a stamp of one small pre-drawn sprite (glow, black
     casing, colour fill at the recipe's radius, casing and opacity), made once
     per colour and zoom step and reused. The radius is rounded to a quarter
     pixel for the sprite cache; nothing else about the recipe changes. */
  const routeCase = new Path2D(), routeBy = new Map();
  let anyRoute = false;
  for (const [l, s] of layers) {
    const G = s.geo;
    if (!G.nRoutes) continue;
    if (!routeBy.has(l.colour)) routeBy.set(l.colour, new Path2D());
    const R = routeBy.get(l.colour);
    for (let r = 0; r < G.nRoutes; r++) {
      const a = G.rStart[r], n = G.rLen[r];
      for (let i = 0; i < n; i++) {
        const x = G.rv[(a + i) * 2] * z + ox, y = oy - G.rv[(a + i) * 2 + 1] * z;
        if (i) { routeCase.lineTo(x, y); R.lineTo(x, y); } else { routeCase.moveTo(x, y); R.moveTo(x, y); }
      }
      anyRoute = true;
    }
  }
  /* routes first, under the points: casing pass then colour pass */
  if (anyRoute) {
    ctx.globalAlpha = 0.85; ctx.strokeStyle = '#000'; ctx.lineWidth = lw + 2.5; ctx.stroke(routeCase);
    ctx.globalAlpha = op; ctx.lineWidth = lw;
    for (const [c, R] of routeBy) { ctx.strokeStyle = c; ctx.stroke(R); }
  }
  ctx.globalAlpha = 1;
  const glow = az >= 13.5;
  let drawn = 0;
  for (const [l, s] of layers) {
    const G = s.geo;
    const S = sprite(l.colour, rad, cas, op, glow, dpr);
    const half = S.half;
    for (let i = 0; i < G.nPts; i++) {
      const x = G.pts[i * 2] * z + ox, y = oy - G.pts[i * 2 + 1] * z;
      if (x < -pad || y < -pad || x > maxX || y > maxY) continue;
      ctx.drawImage(S.canvas, x - half, y - half, half * 2, half * 2);
      drawn++;
    }
  }
  lastDrawn = drawn;
  ctx.globalAlpha = 1;

  if (picked) {
    const g = picked.feature.geometry;
    ctx.strokeStyle = picked.layer.colour; ctx.lineWidth = 1.4;
    for (const k of (g.type === 'Point' ? [g.key] : g.keys)) {
      const [x, y] = toScreen(v, place(k));
      ctx.beginPath(); ctx.arc(x, y, rad + cas + 5, 0, 6.2832); ctx.stroke();
    }
  }
  wakeLine(az);
}

/* The one line under the wafer: the hint when nothing is ticked, otherwise how
   many distinct lines are woken, counted from the loaded layers. */
let lastWake = '', wokenCount = -1, wokenSig = '';
function wakeLine(az) {
  const el = $('wake');
  if (!el) return;
  const on = [...visibleLayers()];
  let text;
  if (!on.length) text = 'tick a layer to wake its lines';
  else {
    const sig = on.map(([l]) => l.id).join(',');
    if (sig !== wokenSig) {
      const all = new Set();
      for (const [, s] of on) for (const k of s.geo.woken) all.add(k);
      wokenCount = all.size; wokenSig = sig;
    }
    text = `${wokenCount.toLocaleString("en-GB")} lines woken · ${on.length} ${on.length === 1 ? "layer" : "layers"} · atlas zoom ${az.toFixed(1)}`;
  }
  if (text !== lastWake) { el.textContent = text; lastWake = text; }
}

/* ── tap to inspect ──────────────────────────────────────────────────────── */

/* The nearest drawn feature to a screen point, or null when none is within
   reach. Reads the precomputed positions, never the layer JSON. */
function pickAt(cx, cy) {
  const v = liveView();
  if (!v || !v.zoom) return null;
  const z = v.zoom, ox = v.w / 2 - v.x * z, oy = v.h / 2 + v.y * z;
  let best = null, bestD = PICK_REACH * PICK_REACH;
  for (const [l, s] of visibleLayers()) {
    const G = s.geo, feats = s.doc.features;
    for (let i = 0; i < G.nPts; i++) {
      const dx = G.pts[i * 2] * z + ox - cx, dy = oy - G.pts[i * 2 + 1] * z - cy;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = { layer: l, feature: feats[G.ptFeat[i]] }; }
    }
    for (let r = 0; r < G.nRoutes; r++) {
      const a = G.rStart[r], n = G.rLen[r];
      for (let i = 1; i < n; i++) {
        const ax = G.rv[(a + i - 1) * 2] * z + ox, ay = oy - G.rv[(a + i - 1) * 2 + 1] * z;
        const bx = G.rv[(a + i) * 2] * z + ox, by = oy - G.rv[(a + i) * 2 + 1] * z;
        const ex = bx - ax, ey = by - ay, L = ex * ex + ey * ey;
        const t = L ? Math.max(0, Math.min(1, ((cx - ax) * ex + (cy - ay) * ey) / L)) : 0;
        const qx = ax + t * ex - cx, qy = ay + t * ey - cy, d = qx * qx + qy * qy;
        if (d < bestD) { bestD = d; best = { layer: l, feature: feats[G.rFeat[r]] }; }
      }
    }
  }
  return best;
}

const node = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text != null) n.textContent = String(text);
  if (cls) n.className = cls;
  return n;
};

/* Dataset text only ever reaches the page through textContent. */
/* A property that carries its own "meaning" is shown as its value, then the
   meaning on a dim line beneath, so a reader on a phone sees what the value is
   and what it is not, without reading raw JSON. Anything else keeps its text. */
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
  for (const [k, val] of Object.entries(f.properties || {})) {
    dl.append(node('dt', k), valueNode(val));
  }
  const ev = node('div', 'evidence: ' + (l.evidence ?? 'none recorded'), 'lnote');
  box.append(close, h, where, dl, ev);
  box.hidden = false;
  $('layersBody').hidden = false;
  drawOverlay();
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
    if (hit) { swallowUntil = performance.now() + 500; inspect(hit); }
  };
  /* Opening the panel under a finger must not let that same tap's click land
     on a checkbox that has just appeared beneath it and tick a layer. */
  let swallowUntil = 0;
  document.addEventListener('click', e => {
    if (performance.now() < swallowUntil && e.target instanceof Element && e.target.closest('#layers')) {
      e.preventDefault(); e.stopPropagation();
    }
    swallowUntil = 0;
  }, true);
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
}

window.__wafer?.onDraw.add(drawOverlay);

let resolveReady;
const ready = new Promise(res => { resolveReady = res; });
window.__layers = Object.freeze({
  ready,
  get manifest() { return manifest; },
  setApp,
  /* a read-only view of one layer's state */
  status(id) {
    const s = state.get(id);
    return s ? { status: s.status, why: s.why, on: !!s.on, app: !!s.app,
                 features: s.doc ? s.doc.features : null, woken: s.geo ? s.geo.woken : null } : null;
  },
  get lastDrawn() { return lastDrawn; },
  memory() { return { ...keptBytes(), evictions, cap: KEEP_HIDDEN_BYTES }; },
  loadedCount() { let n = 0; for (const s of state.values()) if (s.doc) n++; return n; },
  onChange: listeners,
});

(async () => {
  try {
    const r = await fetch(ROOT + 'layers/manifest.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('layers/manifest.json returned HTTP ' + r.status);
    manifest = await r.json();
    for (const l of manifest.layers) state.set(l.id, { status: 'WAIT', on: false, app: false });
    renderPanel();
    readLayersFromURL();
    resolveReady(manifest);
  } catch (e) {
    $('layersList').innerHTML = `<div class="lnote">Layers unavailable: ${esc(e.message)}. The wafer itself is unaffected.</div>`;
    resolveReady(null);
  }
})();
