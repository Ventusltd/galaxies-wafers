/* demo.mjs — Engines as Tools, the picker.
 *
 * The ground is iteration 21's dark wafer (its app.mjs, imported unchanged by
 * index.html). This file adds one transparent canvas and one panel: pick a
 * layer, pick a tool, and that layer is drawn by that tool. Every drawing and
 * every loading decision is made by tools.mjs; this file only turns layer files
 * into world positions and hands them over.
 *
 * LOADING, as Grid Atlas loads (tools.mjs FetchQueue, fetchWithTimeout,
 * createUrlCache, createHydrator, updateLabel, createBandTiles):
 *   nothing is fetched until a layer is picked; every fetch goes through one
 *   queue of MAX_FETCH with a 15 s timeout and one shared promise per URL; a
 *   picked layer hydrates once and stays in memory when another is picked; a
 *   label changes by its own span only; the tiled layer fetches only the radius
 *   bands the view touches and holds at most TILE_CAP of them; every tool is
 *   given a draw budget of MARK_BUDGET marks per frame.
 */
import { place } from '../../lib.mjs';
import {
  TOOLS, atlasZoom, parseAtlasTopology, voltageBands, strokeLikeTransmission, substationDot,
  circleLikeAtlas, projectPixel, wake, ATLAS_11KV, ATLAS_SOLAR, FetchQueue, fetchWithTimeout,
  createUrlCache, createHydrator, updateLabel, bandsInView, createBandTiles,
} from './tools.mjs';

const ROOT = '../../';
const MAX_FETCH = 3;          /* the builder rules' bound; the Atlas itself uses 4 */
const TIMEOUT_MS = 15000;     /* the Atlas's own */
const TILE_CAP = 6;           /* radius bands of a tiled layer held in memory at once */
const MARK_BUDGET = 4000;     /* marks (points or routes) any one tool may draw per frame */
const SOURCE_COMMIT = '34f7a16c6677';

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; };

/* ── loading ─────────────────────────────────────────────────────────────── */

const queue = new FetchQueue(MAX_FETCH);
const cache = createUrlCache(url => queue.add(async () => {
  const r = await fetchWithTimeout(url, TIMEOUT_MS, fetch, { cache: 'default' });
  return url.endsWith('.html') ? r.text() : r.json();
}));

let atlas = null, atlasWhy = 'reading the Atlas topology…';
let manifest = null;

/* ── the layers a reader can pick ─────────────────────────────────────────
   Each names how its items, routes and value are read from the file. The value
   is what voltageBands bands and what projectPixel sizes; its name is printed. */
const LAYERS = [
  { id: 'modules', label: 'Module routes (the named module groups)', kind: 'modules',
    value: 'distinct numbered lines in the module (as the 400kV engine counts)' },
  { id: 'declared', label: null, kind: 'routes', value: 'via.length (interfaces the declared pair passes through)',
    read: f => Array.isArray(f.properties?.via) ? f.properties.via.length : NaN },
  { id: 'crossname', label: null, kind: 'routes', value: 'shared (usable lines the two families share)',
    read: f => Number(f.properties?.shared) },
  { id: 'copying', label: null, kind: 'tiles', value: 'families (function families carrying the line)',
    read: f => Number(f.properties?.families) },
  { id: 'sld-sandbox', label: null, kind: 'points', value: 'features at the same key in this layer (counted here)' },
  { id: 'learned', label: null, kind: 'points', value: 'failures (recorded failure count)',
    read: f => Number(f.properties?.failures) },
];
const byId = new Map(LAYERS.map(l => [l.id, l]));

/* One module's own layer, module-<Symbol>, pickable when a link names its block
   (?key=block:<Symbol>, as iteration 36's TOOLS button sends) or its id
   (?layer=module-<Symbol>). Its value is the feature's properties.lines. */
function addModuleLayer(id) {
  if (byId.has(id)) return byId.get(id);
  const L = { id, label: null, kind: 'routes', value: 'lines (numbered lines in the function, read from properties.lines)',
    read: f => Number(f.properties?.lines), module: id.slice('module-'.length) };
  LAYERS.push(L); byId.set(id, L);
  return L;
}

/* One model per loaded layer: world positions as tools.mjs wants them. */
const models = new Map();   /* id -> {routes, routeItem, anchors, values, points, items} */

function modelFromFeatures(features, L) {
  const routes = [], routeItem = [], anchors = [], values = [], pts = [];
  const mult = new Map();
  if (L.kind === 'points' && !L.read) for (const f of features) if (f.geometry?.type === 'Point') mult.set(f.geometry.key, (mult.get(f.geometry.key) || 0) + 1);
  for (const f of features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'Point') {
      const [x, y] = place(g.key);
      anchors.push(x, y); pts.push(x, y);
      values.push(L.read ? L.read(f) : mult.get(g.key));
    } else if (g.type === 'LineString' && Array.isArray(g.keys) && g.keys.length) {
      const r = new Float32Array(g.keys.length * 2);
      g.keys.forEach((k, i) => { const [x, y] = place(k); r[i * 2] = x; r[i * 2 + 1] = y; pts.push(x, y); });
      routeItem.push(values.length); routes.push(r);
      const [ax, ay] = place(g.keys[0]); anchors.push(ax, ay);
      values.push(L.read ? L.read(f) : g.keys.length);
    }
  }
  return { routes, routeItem, anchors: new Float32Array(anchors), values, points: new Float32Array(pts), items: values.length };
}

/* Module layers: one item per module, as iterations/04 moduleStats() reads it
   (distinct keys over its LineStrings; its smallest key is its anchor). */
function modelFromModules(docs) {
  const routes = [], routeItem = [], anchors = [], values = [], pts = [];
  for (const doc of docs) {
    const keys = new Set();
    for (const f of doc.features) {
      const g = f.geometry;
      if (g?.type !== 'LineString' || !g.keys?.length) continue;
      const r = new Float32Array(g.keys.length * 2);
      g.keys.forEach((k, i) => { keys.add(k); const [x, y] = place(k); r[i * 2] = x; r[i * 2 + 1] = y; });
      routes.push(r); routeItem.push(values.length);
    }
    if (!keys.size) continue;
    let first = Infinity; for (const k of keys) { if (k < first) first = k; const [x, y] = place(k); pts.push(x, y); }
    const [ax, ay] = place(first); anchors.push(ax, ay);
    values.push(keys.size);
  }
  return { routes, routeItem, anchors: new Float32Array(anchors), values, points: new Float32Array(pts), items: values.length };
}

/* The tiled layer: bands held by createBandTiles; the model is rebuilt only
   when the held set changes. */
let tiles = null, tileIndex = null, tileSig = '', tileInfo = { inView: 0, kept: 0, dropped: 0 };
function tiledModel(L) {
  const held = [...tiles.held().entries()].sort((a, b) => a[0] - b[0]);
  const sig = held.map(([b]) => b).join(',');
  if (sig !== tileSig || !models.has(L.id)) {
    models.set(L.id, modelFromFeatures(held.flatMap(([, f]) => f), L));
    tileSig = sig;
  }
  return models.get(L.id);
}

const hydrator = createHydrator(async id => {
  const L = byId.get(id);
  if (L.kind === 'modules') {
    const mods = manifest.layers.filter(l => l.id.startsWith('module-') && l.group?.startsWith('MODULES · ') && l.group !== 'MODULES · OTHER');
    let n = 0;
    const docs = await Promise.all(mods.map(m => cache.get(ROOT + m.file).then(d => { n++; label(id, `LOAD ${n}/${mods.length}`); return d; })));
    const model = modelFromModules(docs);
    models.set(id, model);
    L.note = `${mods.length} modules from ${new Set(mods.map(m => m.group)).size} named groups; the ${manifest.layers.filter(l => l.group === 'MODULES · OTHER').length} in MODULES · OTHER are not loaded`;
    return model.items;
  }
  if (L.kind === 'tiles') {
    tileIndex = await cache.get(ROOT + 'layers/tiles/' + id + '/index.json');
    const S = tileIndex.scheme.S, B = tileIndex.scheme.bands;
    tiles = createBandTiles({
      cap: TILE_CAP,
      /* not through the URL cache: the cache keeps every promise, and an evicted band must be freed */
      load: b => queue.add(() => fetchWithTimeout(ROOT + tileIndex.bands[b].file, TIMEOUT_MS, fetch, { cache: 'default' }).then(r => r.json())).then(doc => {
        if (doc.features.length !== tileIndex.bands[b].features) throw new Error(`band ${b} holds ${doc.features.length}, index says ${tileIndex.bands[b].features}`);
        return doc.features;
      }),
      onChange: () => { requestDraw(); },
    });
    L.S = S; L.B = B;
    return tileIndex.source.features;
  }
  const m = manifest.layers.find(l => l.id === id);
  const doc = await cache.get(ROOT + m.file);
  const model = modelFromFeatures(doc.features, L);
  models.set(id, model);
  return model.items;
}, (id, status, why) => {
  const L = byId.get(id), m = models.get(id);
  label(id, status === 'OK' ? `OK · ${(L.kind === 'tiles' ? tileIndex.source.features : m.items).toLocaleString('en-GB')} ${L.kind === 'tiles' ? `features in ${tileIndex.scheme.bands} bands` : 'items'}` : status + (why ? ' · ' + why : ''));
  if (id === picked.layer) { refreshStatic(); requestDraw(); }
});
const label = (id, text) => updateLabel(document, 'st-' + id, `[${text}]`);

/* ── the tools a reader can pick ───────────────────────────────────────── */

const TOOL_CHOICES = [
  { id: 'transmission', label: '400kV engine', uses: ['voltageBands', 'strokeLikeTransmission'] },
  { id: 'substation', label: 'substation dot', uses: ['substationDot'] },
  { id: 'gate11', label: '11kV zoom gate', uses: ['zoomGate', 'circleLikeAtlas'] },
  { id: 'pixel', label: 'solar-farm pixel', uses: ['projectPixel'] },
  { id: 'wake', label: 'wake', uses: ['wake'] },
];
const toolById = new Map(TOOL_CHOICES.map(t => [t.id, t]));
const picked = { layer: null, tool: 'transmission' };

/* ── the panel, built once ─────────────────────────────────────────────── */

function buildPanel() {
  const rows = $('layerRows');
  for (const L of LAYERS) {
    const m = manifest.layers.find(x => x.id === L.id);
    if (L.kind !== 'modules' && !m) continue;
    L.label = L.label || m.label;
    L.colour = m?.colour || '#00cc00';
    const row = el('label', 'trow');
    const input = el('input'); input.type = 'radio'; input.name = 'layer'; input.value = L.id; input.id = 'L-' + L.id;
    const name = el('span', 'tname'); name.style.color = L.colour;
    name.append(el('span', null, L.label + ' '), Object.assign(el('span', 'tstate', '[WAIT]'), { id: 'st-' + L.id }));
    row.append(input, name);
    input.addEventListener('change', () => pickLayer(L.id));
    rows.append(row);
  }
  for (const t of TOOL_CHOICES) {
    const b = el('button', null, t.label); b.type = 'button'; b.dataset.tool = t.id; b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => pickTool(t.id));
    $('toolRows').append(b);
  }
  $('toolsToggle').addEventListener('click', () => {
    const body = $('toolsBody'); body.hidden = !body.hidden; $('toolsToggle').setAttribute('aria-expanded', String(!body.hidden));
  });
}

function pickLayer(id) {
  picked.layer = id; writeURL();
  const input = $('L-' + id); if (input && !input.checked) input.checked = true;
  hydrator.hydrate(id);
  refreshStatic(); requestDraw();
}
function pickTool(id) {
  if (!toolById.has(id)) return;
  picked.tool = id; writeURL();
  for (const b of $('toolRows').children) b.setAttribute('aria-pressed', String(b.dataset.tool === id));
  refreshStatic(); requestDraw();
}

/* This page owns layer, tool and key (key=block:<Symbol> only while that
   module's layer is picked). Every other parameter is kept as it is. */
function ownParams() {
  const out = [];
  if (picked.layer) out.push(['layer', picked.layer]);
  out.push(['tool', picked.tool]);
  const L = byId.get(picked.layer);
  if (L?.module) out.push(['key', 'block:' + L.module]);
  return out;
}
let started = false;   /* the link's own parameters are left as given until the reader picks */
function writeURL() {
  if (!started) return;
  const u = new URL(location.href);
  picked.layer ? u.searchParams.set('layer', picked.layer) : u.searchParams.delete('layer');
  u.searchParams.set('tool', picked.tool);
  const key = ownParams().find(([k]) => k === 'key');
  key ? u.searchParams.set('key', key[1]) : u.searchParams.delete('key');
  const next = u.pathname + u.search.replace(/%2C/gi, ',') + u.hash;
  if (next !== location.pathname + location.search + location.hash) history.replaceState(history.state, '', next);
}
/* Iteration 21's app.mjs (imported unchanged) rewrites the query to line, to and
   layers when a line is flown to, which would drop this page's parameters. Its
   writes pass through here and get this page's own parameters back. */
{
  const nativeReplace = history.replaceState.bind(history);
  history.replaceState = function (state, title, url) {
    if (url != null && manifest) {
      const u = new URL(url, location.href);
      for (const [k, v] of ownParams()) if (!u.searchParams.has(k)) u.searchParams.set(k, v);
      url = u.pathname + u.search.replace(/%2C/gi, ',') + u.hash;
    }
    return nativeReplace(state, title, url);
  };
}

/* ── what a link asks for: ?layer= ?tool= ?key= (and iteration 21's ?line= ?to= ?layers=) ── */
const READS = ['layer', 'tool', 'key', 'line', 'to', 'layers'];
function readLink() {
  const q = new URL(location.href).searchParams;
  const warn = [], out = { warn };
  for (const k of new Set(q.keys())) {
    if (!READS.includes(k)) warn.push(`?${k}=${q.get(k)} is not a parameter this page reads (it reads ${READS.join(', ')}); it was not used`);
    else if (q.getAll(k).length > 1) warn.push(`?${k}= was given ${q.getAll(k).length} times; only the first, "${q.get(k)}", was used`);
  }
  const key = q.get('key');
  if (key !== null) {
    const m = /^block:([A-Za-z][A-Za-z0-9]{0,5})$/.exec(key.trim());
    if (m) out.block = m[1];
    else warn.push(`key=${key} is malformed or not one this page reads: it reads key=block:<Symbol> (a module's layer); it was not used`);
  }
  const layer = q.get('layer');
  if (layer !== null) {
    if (/^module-[A-Za-z][A-Za-z0-9]{0,5}$/.test(layer) && manifest.layers.some(l => l.id === layer)) out.layer = addModuleLayer(layer).id;
    else if (byId.has(layer) && (byId.get(layer).kind === 'modules' || manifest.layers.some(l => l.id === layer))) out.layer = layer;
    else warn.push(`layer=${layer} is not a layer this page can pick (it picks ${LAYERS.filter(L => L.kind === 'modules' || manifest.layers.some(l => l.id === L.id)).map(L => L.id).join(', ')}, or module-<Symbol> when layers/manifest.json lists it); it was not used`);
  }
  const tool = q.get('tool');
  if (tool !== null) {
    if (toolById.has(tool)) out.tool = tool;
    else warn.push(`tool=${tool} is not a tool of this page (it has ${TOOL_CHOICES.map(t => t.id).join(', ')}); the 400kV engine is used instead`);
  }
  return out;
}
function showLink(link, outcome) {
  const box = $('linkWarn');
  box.replaceChildren();
  if (outcome) box.append(el('div', outcome.cls, outcome.text));
  if (link.warn.length) {
    box.append(el('div', 'refuse', `Link warning${link.warn.length > 1 ? 's' : ''}:`));
    for (const w of link.warn) box.append(el('div', 'refuse', '· ' + w));
  }
  box.hidden = !box.childNodes.length;
}

/* ── Questions and machine detail, per tool (re-filled, never rebuilt per frame) ── */

const src = name => TOOLS.find(t => t.name === name).source;
const code = s => `<code>${s}</code>`;
function questions(tool) {
  const L = byId.get(picked.layer);
  const valueName = L ? L.value : 'the picked layer\'s value';
  switch (tool) {
    case 'transmission': return [
      `It draws a <b>cable route</b> styled by voltage level: ${code('voltageBands(values, groups).bands[i].color')} and ${code('.width')} come from the Atlas Topology rows (${atlas ? atlas.lines.map(l => l.label).join(', ') : 'not read yet'}), and ${code('strokeLikeTransmission')} strokes each route cased in black. On this wafer the "voltage" is the quantile of <i>${valueName}</i>, not an electrical voltage.`,
      `${code('voltageBands')} and ${code('strokeLikeTransmission')} in iterations/33-engines-as-tools/tools.mjs, lifted from ${src('voltageBands')} and ${src('strokeLikeTransmission')}. Called by: iterations/04-400kv-engine/layers-panel.mjs ${code('drawOverlay')} lines 441-456 (its own inline copy, read from source) and this page's ${code('drawTool')}. The Atlas itself applies the same colour and width in ventus-corev8engine.js line 1242.`,
      `To the <b>substation</b> each route starts from: the 400kV engine drew each module's first line as a white substation (04 lines 457-465), which is the ${code('substationDot')} tool here.`,
    ];
    case 'substation': return [
      `It draws the <b>busbar / substation node</b> as the Atlas does: white, radius ${code('evalExpr(atlas.subs.radius, 8 + log2(zoom))')} from ${code('["interpolate",["linear"],["zoom"],5,3,10,5,14,10,18,22]')}. Here it marks each item's anchor: a module's smallest key, or a feature's first key.`,
      `${code('substationDot')} in tools.mjs, from ${src('substationDot')}. Called by: iterations/04-400kv-engine/layers-panel.mjs lines 457-465 (inline) and this page. Note: 04 evaluated the radius at log2(zoom) with no +8; this tool uses iteration 21's mapping and says so in its header.`,
      `To the <b>transformer</b>: not established. The Atlas Topology group read here has no transformer style, so no tool draws one.`,
    ];
    case 'gate11': return [
      `It decides <b>feeder-level density</b>: whether 11kV distribution points are drawn at this zoom. ${code('zoomGate(ATLAS_11KV, zoom)')} returns ${code('visible')} (false below ${code('minzoom 13.5')}) and ${code('radius')} (stops 13.5→4, 15→8, 18→18); ${code('circleLikeAtlas')} draws what passes, magenta with a 1 px black stroke.`,
      `${code('zoomGate')} and ${code('circleLikeAtlas')} in tools.mjs, from ${src('zoomGate')} and ${src('circleLikeAtlas')}. Called by: the Atlas engine copies ${code('layer.minzoom')} onto every map layer (ventus-corev8engine.js lines 1244, 1287); iteration 21 reuses the 11kV radius stops (21 line 361); this page.`,
      `To the 11kV <b>feeder</b> lines between those points: not established. The Atlas 11kV row is points only; no feeder geometry is in the file.`,
    ];
    case 'pixel': return [
      `It draws a <b>generation connection point</b> sized by capacity, as the Atlas draws a solar farm: ${code('ATLAS_SOLAR.circle.radius')} and ${code('.color')} keyed on ${code('capacity')}, a glow tier from ${code('capacity >= 4')}. Here the magnitude is <i>${valueName}</i>, not MW.`,
      `${code('projectPixel')} in tools.mjs, from ${src('projectPixel')}. Called by: the Atlas's REPD 'solar' layer (ventus-corev8engine.js line 1319 builds the paint, line 1330 adds the layer) and this page.`,
      `To the <b>nearest mapped substation</b> the project would connect towards: not established here. ventus-grid-engine engine/v9-nearest-search.js answers that question; this page does not call it.`,
    ];
    default: return [
      `None yet. ${code('wake')} marks which numbered lines a layer charts, lit on a dark ground; it draws no busbar, feeder, transformer, cable route, protection or earthing.`,
      `${code('wake')} in tools.mjs, from ${src('wake')}. Called by: iterations/21-dark-pixels/layers-panel.mjs ${code('drawOverlay')} lines 427-445 (inline) and this page.`,
      `To any other tool: every tool takes the same world positions, so a woken layer can be re-drawn by the 400kV engine or the substation dot without reloading.`,
    ];
  }
}
const MACHINE = {
  transmission: 'in: values (the named layer value, unitless count), groups (Atlas Topology rows: label, color hex, width px); routes (world units), view {x, y, zoom px per unit, w, h px} · out: bands [{label, color, width px, q quantile, min lower bound}], items (band index per value), strokes {drawn, offscreen, skipped} · refuses: no finite values; a points-only layer has no routes and none is invented',
  substation: 'in: points (world units), view, radiusExpr (Atlas interpolate over zoom) · out: circles of radius px at atlas zoom 8 + log2(zoom), {drawn, offscreen, skipped, radius px} · refuses: no radius expression',
  gate11: 'in: layer style {color, radius expression, minzoom}, atlas zoom · out: {visible, radius px, why}; circles {drawn, offscreen, skipped} · refuses: zoom below minzoom (drawn nothing, reason printed)',
  pixel: 'in: points (world units), magnitudes (read as capacity; unit of the layer value), view · out: glow (radius 22-80 px, opacity 0.12-0.35, from magnitude 4) and circle (radius 8-28 px, stroke 1.5 px), {drawn, glowing, offscreen, skipped} · refuses: magnitude count not one per point',
  wake: 'in: points (world units), colour, view · out: glow 2.4 x radius from atlas zoom 13.5, casing 1-2 px, fill radius 2.5-18 px, {drawn, offscreen, skipped, radius px} · refuses: nothing; an empty layer draws nothing',
};

let staticSig = '';
function refreshStatic() {
  const sig = picked.tool + '|' + picked.layer + '|' + !!atlas + '|' + hydrator.state(picked.layer || '_').status;
  if (sig === staticSig) return;
  staticSig = sig;
  const [a, b, c] = questions(picked.tool);
  $('q1').innerHTML = a; $('q2').innerHTML = b; $('q3').innerHTML = c;
  const t = toolById.get(picked.tool);
  const L = byId.get(picked.layer);
  $('machine').innerHTML = `<b>Machine detail</b> · ${t.uses.map(code).join(' + ')} · ${MACHINE[picked.tool]} · value on this layer: ${L ? L.value : 'no layer picked'} · source: galaxies-wafers ${SOURCE_COMMIT}, globalgrid2050 7135d8cc6b14 · atlas topology: ${atlas ? 'read at run time from atlas/index.html' : atlasWhy}`;
  $('disclaimer').hidden = !(picked.tool === 'transmission' || picked.tool === 'pixel' || picked.tool === 'gate11' || picked.tool === 'substation');
  $('loading').textContent = `loading: at most ${MAX_FETCH} fetches at once, ${TIMEOUT_MS / 1000} s timeout, one fetch per URL; the tiled layer holds at most ${TILE_CAP} radius bands and fetches only bands in view; each tool draws at most ${MARK_BUDGET.toLocaleString('en-GB')} marks per frame.${L?.note ? ' ' + L.note + '.' : ''}`;
}

/* ── drawing ───────────────────────────────────────────────────────────── */

const overlay = el('canvas'); overlay.id = 'overlay33'; document.body.appendChild(overlay);
const ctx = overlay.getContext('2d');
let legendSig = '', lastFrame = { ms: 0, drawn: 0 };

function drawOverlay() {
  const v = window.__wafer?.view;
  if (!v || !v.w || !v.h) return;
  const t0 = performance.now();
  const dpr = v.dpr || 1, W = Math.round(v.w * dpr), H = Math.round(v.h * dpr);
  if (overlay.width !== W || overlay.height !== H) { overlay.width = W; overlay.height = H; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, v.w, v.h);
  const L = byId.get(picked.layer);
  const st = picked.layer ? hydrator.state(picked.layer) : null;
  let text;
  if (!L) text = 'pick a layer';
  else if (st.status !== 'OK') text = `${L.label}: ${st.status}${st.why ? ' · ' + st.why : ''}`;
  else {
    let model;
    if (L.kind === 'tiles') {
      const want = bandsInView(v, L.S, L.B);
      const r = tiles.want(want);
      tileInfo = { inView: want.length, kept: r.kept.length, dropped: r.dropped };
      model = tiledModel(L);
    } else model = models.get(L.id);
    const res = drawTool(picked.tool, model, v, L);
    lastFrame = { ms: performance.now() - t0, drawn: res.drawn };
    text = `${res.why ? res.why + ' · ' : ''}drawn ${res.drawn.toLocaleString('en-GB')} · off screen ${res.offscreen.toLocaleString('en-GB')} · over budget ${res.skipped.toLocaleString('en-GB')} · atlas zoom ${atlasZoom(v.zoom).toFixed(1)}`
      + (L.kind === 'tiles' ? ` · bands in view ${tileInfo.inView}, held ${tiles.size}/${TILE_CAP}${tileInfo.dropped ? `, ${tileInfo.dropped} beyond the cap not drawn` : ''}${tiles.pending() ? `, ${tiles.pending()} loading` : ''}` : '');
  }
  updateLabel(document, 'status', text);
}

function drawTool(tool, model, v, L) {
  const sum = { drawn: 0, offscreen: 0, skipped: 0, why: '' };
  const add = r => { sum.drawn += r.drawn; sum.offscreen += r.offscreen; sum.skipped += r.skipped; if (r.why) sum.why = r.why; };
  if (tool === 'transmission') {
    if (!atlas) { sum.why = atlasWhy; return sum; }
    if (!model.routes.length) { sum.why = 'EMPTY: this layer holds points, no routes; a transmission stroke needs a route in the file and none is invented'; setLegend(null); return sum; }
    const vb = voltageBands(model.values, atlas.lines);
    if (!vb.bands.length) { sum.why = 'EMPTY: ' + vb.why; setLegend(null); return sum; }
    setLegend(vb, model);
    const per = vb.bands.map(() => []);
    model.routes.forEach((r, i) => { const b = vb.items[model.routeItem[i]]; if (b >= 0) per[b].push(r); });
    for (let b = per.length - 1; b >= 0; b--) {       /* lowest band first, 400kV on top */
      add(strokeLikeTransmission(ctx, per[b], v, { band: vb.bands[b], budget: Math.max(0, MARK_BUDGET - sum.drawn) }));
    }
    return sum;
  }
  setLegend(null);
  if (tool === 'substation') {
    if (!atlas) { sum.why = atlasWhy; return sum; }
    add(substationDot(ctx, model.anchors, v, { radiusExpr: atlas.subs.radius, budget: MARK_BUDGET }));
  } else if (tool === 'gate11') {
    add(circleLikeAtlas(ctx, model.points, v, { style: ATLAS_11KV, budget: MARK_BUDGET }));
    if (sum.why) { sum.why = `hidden by the 11kV gate: ${sum.why}; ${sum.skipped.toLocaleString('en-GB')} points not drawn (focus in to draw)`; sum.skipped = 0; }
  } else if (tool === 'pixel') {
    const finite = model.values.every(Number.isFinite);
    if (!finite) { sum.why = 'EMPTY: some items have no value for ' + L.value; return sum; }
    add(projectPixel(ctx, model.anchors, v, { magnitudes: model.values, style: ATLAS_SOLAR, budget: MARK_BUDGET }));
  } else {
    add(wake(ctx, model.points, v, { colour: L.colour, budget: MARK_BUDGET }));
  }
  return sum;
}

/* The band legend is one small box, re-filled only when the bands change. */
function setLegend(vb, model) {
  const sig = vb ? vb.bands.map(b => b.min).join(',') + '|' + model.items : '';
  if (sig === legendSig) return;
  legendSig = sig;
  const box = $('legend'); box.replaceChildren();
  if (!vb) return;
  const counts = vb.bands.map(() => 0); for (const i of vb.items) if (i >= 0) counts[i]++;
  vb.bands.forEach((b, i) => {
    const row = el('div', 'lb');
    const sw = el('span', 'sw'); sw.style.background = b.color; sw.style.height = b.width + 'px';
    const name = el('b', null, b.label); name.style.color = b.color;
    row.append(sw, name, el('span', null, `≥ ${b.min} · ${counts[i]} items`), el('span', 'tstate', `from q${Math.round(b.q * 100)}`));
    box.append(row);
  });
  const allEqual = vb.bands.every(b => b.min === vb.bands[0].min);
  box.append(el('div', 'tnote', `bands by quantile of ${byId.get(picked.layer).value}, over ${model.items} items${allEqual ? '; every lower bound is equal, so every item takes the first band (the lifted rule, shown as it behaves)' : ''}`));
}

let pending = false;
function requestDraw() { if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; drawOverlay(); }); } }
window.__wafer?.onDraw.add(drawOverlay);

/* A hook for the tests: the last frame's cost and counts, read-only. */
Object.defineProperty(window, '__tools33', { value: Object.freeze({
  get frame() { return { ...lastFrame }; },
  get tiles() { return tiles ? { held: tiles.size, pending: tiles.pending(), cap: TILE_CAP } : null; },
  get queuePeak() { return queue.peak; },
}) });

/* ── start ─────────────────────────────────────────────────────────────── */

(async () => {
  try {
    manifest = await cache.get(ROOT + 'layers/manifest.json');
  } catch (e) {
    $('layerRows').textContent = 'Layers unavailable: ' + e.message + '. The wafer itself is unaffected.';
    return;
  }
  const link = readLink();
  let outcome = null, startLayer = link.layer || null;
  if (link.block) {
    const id = 'module-' + link.block;
    if (manifest.layers.some(l => l.id === id)) {
      addModuleLayer(id);
      outcome = { cls: 'known', text: `Opened by the link at key=block:${link.block}: layer ${id} is picked${link.layer && link.layer !== id ? ` (in place of layer=${link.layer}, which the key narrows)` : ''}.` };
      startLayer = id;
    } else {
      outcome = { cls: 'refuse', text: `key=block:${link.block}: layers/manifest.json lists no ${id} layer (${manifest.layers.length} layers read), so there is no module layer to draw for it${startLayer ? `; layer=${startLayer} is drawn as the link also asked` : ''}.` };
    }
  }
  buildPanel();
  showLink(link, outcome);
  window.__link33 = Object.freeze({ warnings: link.warn.slice(), outcome: outcome && outcome.text, layer: startLayer });
  pickTool(link.tool || 'transmission');
  cache.get(ROOT + 'atlas/index.html')
    .then(html => { atlas = parseAtlasTopology(html); atlasWhy = ''; })
    .catch(e => { atlasWhy = 'Atlas topology unavailable: ' + e.message; })
    .finally(() => { staticSig = ''; refreshStatic(); requestDraw(); });
  if (startLayer && $('L-' + startLayer)) pickLayer(startLayer);
  started = true;
  refreshStatic();
})();
