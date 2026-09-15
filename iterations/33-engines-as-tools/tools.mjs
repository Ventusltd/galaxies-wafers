/* tools.mjs — Engines as Tools.
 *
 * The owner, on the engines he likes: "If I like an idea like the 400kV engine,
 * or 132kV engine then the same logic should inspire new applications and so
 * these functions become our tools in the layers".
 *
 * This file is that extraction. Every drawing rule an engine page used inline is
 * lifted here as one small function with one contract, and every function names
 * the file and line range it was lifted from (in its comment and in TOOLS). The
 * pages it came from are not edited; they keep their own copies.
 *
 * THE CONTRACT. A drawing tool is  tool(ctx, positions, view, options)  where
 *   ctx        a CanvasRenderingContext2D already transformed to CSS pixels,
 *   positions  WORLD coordinates on the wafer (never screen), as a flat
 *              Float32Array / number[] [x0, y0, x1, y1, ...], or for routes an
 *              array of such arrays, one per route,
 *   view       the wafer's frozen camera snapshot {x, y, zoom, w, h}
 *              (window.__wafer.view; zoom is screen pixels per world unit),
 *   options    the style being applied and a draw budget.
 * It draws only inside that call, restores globalAlpha to 1, and returns what it
 * drew: {drawn, offscreen, skipped}. It fetches nothing and touches no DOM.
 * Pure tools (no ctx) take plain values and return plain values.
 *
 * ZOOM. A web map's zoom doubles its scale per level; the wafer's zoom is pixels
 * per unit. Iteration 21 maps them as  atlas zoom = 8 + log2(wafer zoom)
 * (21-dark-pixels/layers-panel.mjs line 352), which puts the Atlas 11kV minzoom
 * 13.5 where neighbouring lines separate. Iteration 04 evaluated the substation
 * radius at log2(wafer zoom) with no offset (04-400kv-engine/layers-panel.mjs
 * line 458). The two pages disagree; these tools use 21's mapping everywhere and
 * say so, so the disagreement is stated rather than hidden.
 *
 * SOURCE COMMITS. galaxies-wafers files are read at 34f7a16c6677 (iterations/04,
 * iterations/21, atlas/index.html). Grid Atlas v8 files are read from
 * globalgrid2050 at 7135d8cc6b14 (repd_grid_atlasv8/index.html and
 * repd_grid_atlasv8/ventus-corev8engine.js).
 */

const GW = 'galaxies-wafers@34f7a16c6677';
const GG = 'globalgrid2050@7135d8cc6b14';

/* ── zoom and expressions ─────────────────────────────────────────────────── */

/* atlasZoom — lifted from iterations/21-dark-pixels/layers-panel.mjs line 352. */
export const atlasZoom = waferZoom => 8 + Math.log2(waferZoom);

/* evalExpr — lifted from iterations/04-400kv-engine/layers-panel.mjs lines 43-58,
   unchanged in behaviour for ['zoom'] and ['interpolate', ['linear'], input, ...stops].
   Extended in two stated ways so the Atlas's project paint can be read too:
   ['get', k] and ['coalesce', a, b] read from `props`, and stop outputs that are
   '#rrggbb' strings interpolate per channel. Anything else throws, naming it. */
export function evalExpr(e, z, props = {}) {
  if (!Array.isArray(e)) return e;
  if (e[0] === 'zoom') return z;
  if (e[0] === 'get') return props[e[1]];
  if (e[0] === 'coalesce') {
    for (const a of e.slice(1)) { const v = evalExpr(a, z, props); if (v !== undefined && v !== null) return v; }
    return null;
  }
  if (e[0] === 'interpolate' && e[1]?.[0] === 'linear') {
    const x = Number(evalExpr(e[2], z, props)), stops = e.slice(3);
    if (x <= stops[0]) return stops[1];
    for (let i = 2; i < stops.length; i += 2) {
      if (x <= stops[i]) {
        const [x0, y0, x1, y1] = [stops[i - 2], stops[i - 1], stops[i], stops[i + 1]];
        return mix(y0, y1, (x - x0) / (x1 - x0));
      }
    }
    return stops[stops.length - 1];
  }
  throw new Error('unsupported expression ' + e[0]);
}

function mix(a, b, t) {
  if (typeof a === 'number') return a + (b - a) * t;
  const pa = hex(a), pb = hex(b);
  return '#' + pa.map((c, i) => Math.round(c + (pb[i] - c) * t).toString(16).padStart(2, '0')).join('');
}
const hex = s => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16));

/* ── the Atlas styles, as data ────────────────────────────────────────────── */

/* parseAtlasTopology — lifted from iterations/04-400kv-engine/layers-panel.mjs
   lines 60-77 (readAtlasTopology), with the fetch taken out so it is pure: give
   it the text of atlas/index.html, get back the Topology group's line styles and
   its one substation style. Throws, naming what it read, when the group is not
   the shape 04 relied on. */
export function parseAtlasTopology(html) {
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
  return { lines, subs: subs[0] };
}

/* ATLAS_11KV — the 11kV row of Grid Atlas v8, values verbatim:
   repd_grid_atlasv8/index.html line 147. The galaxies-wafers copy of the Atlas
   (atlas/index.html) omits this row because its data file is not served there,
   so the style is carried here as data with its line cited. */
export const ATLAS_11KV = Object.freeze({
  id: '11kv', label: '11kV (UKPN)', color: '#ff00ff', type: 'point',
  radius: ['interpolate', ['linear'], ['zoom'], 13.5, 4, 15, 8, 18, 18], minzoom: 13.5,
});

/* ATLAS_SOLAR — the Atlas's 'solar' project paint, values verbatim:
   repd_grid_atlasv8/ventus-corev8engine.js line 1302 (the glow layer, drawn only
   for capacity >= 4) and line 1319 (the circle). 'capacity' is in MW there. */
export const ATLAS_SOLAR = Object.freeze({
  glowMin: 4.0,
  glow: {
    color: ['interpolate', ['linear'], ['coalesce', ['get', 'capacity'], 0], 4.0, '#ffff00', 20.0, '#ffaa00', 50.0, '#ff4400', 200.0, '#ff0000'],
    radius: ['interpolate', ['linear'], ['coalesce', ['get', 'capacity'], 0], 4.0, 22, 20.0, 32, 50.0, 44, 200.0, 60, 500.0, 80],
    opacity: ['interpolate', ['linear'], ['coalesce', ['get', 'capacity'], 0], 4.0, 0.12, 20.0, 0.18, 50.0, 0.25, 200.0, 0.35],
    blur: 1.0,
  },
  circle: {
    color: ['interpolate', ['linear'], ['coalesce', ['get', 'capacity'], 0], 0, '#ffff00', 20.0, '#ffcc00', 50.0, '#ffaa00', 200.0, '#ff6600', 500.0, '#ff2200'],
    radius: ['interpolate', ['linear'], ['coalesce', ['get', 'capacity'], 0], 0, 8, 10, 10, 50, 13, 200, 17, 500, 22, 1000, 28],
    strokeWidth: 1.5, strokeColor: '#000', opacity: 0.85,
  },
});

/* ── pure tools ───────────────────────────────────────────────────────────── */

/* voltageBands — lifted from iterations/04-400kv-engine/layers-panel.mjs lines
   89-106 (computeBands, bandOf). Bands by quantile, highest first: band i of B
   starts at the ascending value at quantile (B - 1 - i) / B, index
   min(n - 1, floor(q * n)). An item takes the first band whose lower bound it
   meets, else the last. `groups` is the Atlas Topology line styles in order
   (400, 275, 220, 132, 66), so the labels, colours and widths are the Atlas's.
   Returns {bands: [{...group, q, min}], items: Int32Array band index per value}.
   Refuses with {bands: [], items: all -1, why} when there are no finite values. */
export function voltageBands(values, groups) {
  const finite = [];
  for (const v of values) if (Number.isFinite(v)) finite.push(v);
  const items = new Int32Array(values.length).fill(-1);
  if (!groups?.length) return { bands: [], items, why: 'no Atlas topology groups given' };
  if (!finite.length) return { bands: [], items, why: 'no finite values to band' };
  finite.sort((a, b) => a - b);
  const B = groups.length, n = finite.length;
  const bands = groups.map((g, i) => {
    const q = (B - 1 - i) / B;
    return { ...g, q, min: finite[Math.min(n - 1, Math.floor(q * n))] };
  });
  values.forEach((v, j) => {
    if (!Number.isFinite(v)) return;
    const k = bands.findIndex(b => v >= b.min);
    items[j] = k < 0 ? B - 1 : k;
  });
  return { bands, items, why: '' };
}

/* zoomGate — the Atlas's per-layer zoom rule, as MapLibre applies it to a layer
   object: repd_grid_atlasv8/ventus-corev8engine.js line 1244 (layer.minzoom is
   copied to the map layer, which is not drawn below it) and the radius
   expression from the layer row, evaluated by evalExpr (04 lines 43-58).
   Returns {visible, radius, why}. radius is null when hidden or not a point. */
export function zoomGate(layerStyle, zoom) {
  if (!Number.isFinite(zoom)) return { visible: false, radius: null, why: 'zoom is not a number' };
  if (layerStyle.minzoom != null && zoom < layerStyle.minzoom)
    return { visible: false, radius: null, why: `atlas zoom ${zoom.toFixed(2)} is below minzoom ${layerStyle.minzoom}` };
  if (layerStyle.maxzoom != null && zoom >= layerStyle.maxzoom)
    return { visible: false, radius: null, why: `atlas zoom ${zoom.toFixed(2)} is at or above maxzoom ${layerStyle.maxzoom}` };
  const radius = layerStyle.radius == null ? null : evalExpr(layerStyle.radius, zoom);
  return { visible: true, radius, why: '' };
}

/* ── drawing tools ────────────────────────────────────────────────────────── */

/* The wafer's own world-to-screen law: app.mjs drawMarks(), and
   21-dark-pixels/layers-panel.mjs line 311. */
export const toScreen = (v, x, y) => [(x - v.x) * v.zoom + v.w / 2, v.h / 2 - (y - v.y) * v.zoom];

const TAU = Math.PI * 2;
const inView = (v, x, y, pad) => x >= -pad && y >= -pad && x <= v.w + pad && y <= v.h + pad;

/* strokeLikeTransmission — the Atlas line paint (atlas/index.html line 112:
   line-color = layer colour, line-width = layer width, line-opacity 0.9; the
   Topology rows at lines 62-66) drawn with the 400kV engine's round joins
   (04-400kv-engine/layers-panel.mjs lines 444-454), under the black casing that
   iteration 21 gives every route so it reads on the dark ground (21 lines
   424-425: casing 2.5 px wider, opacity 0.85). The Atlas width does not vary
   with zoom, so the stroke does not either.
   options: {band: {color, width}, budget = Infinity routes}. */
export function strokeLikeTransmission(ctx, routes, view, { band, budget = Infinity } = {}) {
  let drawn = 0, offscreen = 0, skipped = 0;
  if (!band) return { drawn, offscreen, skipped: routes.length, why: 'no band given' };
  ctx.beginPath();
  for (const r of routes) {
    const n = r.length >> 1;
    if (n < 2) { skipped++; continue; }
    let any = false;
    for (let i = 0; i < n && !any; i++) { const [x, y] = toScreen(view, r[i * 2], r[i * 2 + 1]); any = inView(view, x, y, band.width + 4); }
    if (!any) { offscreen++; continue; }       /* culled by its vertices: a segment crossing the screen with both ends off it is not drawn */
    if (drawn >= budget) { skipped++; continue; }
    for (let i = 0; i < n; i++) { const [x, y] = toScreen(view, r[i * 2], r[i * 2 + 1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    drawn++;
  }
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.globalAlpha = 0.85; ctx.strokeStyle = '#000'; ctx.lineWidth = band.width + 2.5; ctx.stroke();
  ctx.globalAlpha = 0.9; ctx.strokeStyle = band.color; ctx.lineWidth = band.width; ctx.stroke();
  ctx.globalAlpha = 1;
  return { drawn, offscreen, skipped };
}

/* substationDot — the Atlas substation: white, radius
   ['interpolate', ['linear'], ['zoom'], 5, 3, 10, 5, 14, 10, 18, 22]
   (atlas/index.html line 67), painted as the lifted page paints a point:
   circle-opacity 0.85, stroke #0b0d12 at 0.6 px (atlas/index.html line 113),
   evaluated and drawn as the 400kV engine did (04 lines 457-465), at the atlas
   zoom of this file's header.
   options: {radiusExpr (required: the Atlas subs radius), color = '#ffffff', budget}. */
export function substationDot(ctx, points, view, { radiusExpr, color = '#ffffff', budget = Infinity } = {}) {
  if (radiusExpr == null) return { drawn: 0, offscreen: 0, skipped: points.length >> 1, radius: null, why: 'no Atlas radius expression given' };
  const r = evalExpr(radiusExpr, atlasZoom(view.zoom));
  let drawn = 0, offscreen = 0, skipped = 0;
  ctx.beginPath();
  for (let i = 0; i < points.length; i += 2) {
    const [x, y] = toScreen(view, points[i], points[i + 1]);
    if (!inView(view, x, y, r)) { offscreen++; continue; }
    if (drawn >= budget) { skipped++; continue; }
    ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); drawn++;
  }
  ctx.globalAlpha = 0.85; ctx.fillStyle = color; ctx.fill();
  ctx.strokeStyle = '#0b0d12'; ctx.lineWidth = 0.6; ctx.stroke();
  ctx.globalAlpha = 1;
  return { drawn, offscreen, skipped, radius: r };
}

/* circleLikeAtlas — the Atlas's generic point paint for a topology point layer:
   circle-color = layer colour, circle-radius = layer radius, circle-stroke-width
   1, circle-stroke-color #000 (repd_grid_atlasv8/ventus-corev8engine.js line
   1242), gated first by zoomGate. Used to draw any keys as the 11kV layer.
   options: {style (a layer row with color, radius, minzoom), budget}. */
export function circleLikeAtlas(ctx, points, view, { style, budget = Infinity } = {}) {
  const gate = zoomGate(style, atlasZoom(view.zoom));
  if (!gate.visible) return { drawn: 0, offscreen: 0, skipped: points.length >> 1, radius: null, why: gate.why };
  const r = gate.radius;
  let drawn = 0, offscreen = 0, skipped = 0;
  ctx.beginPath();
  for (let i = 0; i < points.length; i += 2) {
    const [x, y] = toScreen(view, points[i], points[i + 1]);
    if (!inView(view, x, y, r + 1)) { offscreen++; continue; }
    if (drawn >= budget) { skipped++; continue; }
    ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); drawn++;
  }
  ctx.fillStyle = style.color; ctx.fill();
  ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
  return { drawn, offscreen, skipped, radius: r, why: '' };
}

/* projectPixel — the Atlas solar-farm pixel: a blurred glow for capacity >= 4
   (colour, radius and opacity interpolated by capacity), then a circle whose
   colour and radius are interpolated by capacity, stroke #000 1.5 px, opacity
   0.85 (repd_grid_atlasv8/ventus-corev8engine.js lines 1302 and 1319, carried
   verbatim in ATLAS_SOLAR). circle-blur 1.0 is drawn as a radial gradient from
   the glow colour at its opacity to transparent at the glow radius. The Atlas
   paint does not vary with zoom, so neither does this.
   options: {magnitudes (one per point, read as 'capacity'), style = ATLAS_SOLAR, budget}. */
export function projectPixel(ctx, points, view, { magnitudes, style = ATLAS_SOLAR, budget = Infinity } = {}) {
  let drawn = 0, offscreen = 0, skipped = 0, glowing = 0;
  const n = points.length >> 1;
  if (!magnitudes || magnitudes.length !== n)
    return { drawn, offscreen, skipped: n, glowing, why: 'one magnitude per point is required' };
  for (let i = 0; i < n; i++) {
    const props = { capacity: magnitudes[i] };
    const [x, y] = toScreen(view, points[i * 2], points[i * 2 + 1]);
    const cap = Number(magnitudes[i]) || 0;
    const reach = cap >= style.glowMin ? evalExpr(style.glow.radius, 0, props) : evalExpr(style.circle.radius, 0, props);
    if (!inView(view, x, y, reach)) { offscreen++; continue; }
    if (drawn >= budget) { skipped++; continue; }
    if (cap >= style.glowMin) {
      const gr = evalExpr(style.glow.radius, 0, props), gc = evalExpr(style.glow.color, 0, props);
      const g = ctx.createRadialGradient(x, y, 0, x, y, gr);
      g.addColorStop(0, gc); g.addColorStop(1, gc + '00');
      ctx.globalAlpha = evalExpr(style.glow.opacity, 0, props); ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, gr, 0, TAU); ctx.fill();
      glowing++;
    }
    const r = evalExpr(style.circle.radius, 0, props);
    ctx.globalAlpha = style.circle.opacity; ctx.fillStyle = evalExpr(style.circle.color, 0, props);
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = style.circle.strokeColor; ctx.lineWidth = style.circle.strokeWidth; ctx.stroke();
    drawn++;
  }
  ctx.globalAlpha = 1;
  return { drawn, offscreen, skipped, glowing, why: '' };
}

/* WAKE_STOPS — lifted from iterations/21-dark-pixels/layers-panel.mjs lines
   361-363: radius (the Atlas 11kV stops with two added below 13.5 so a woken
   line never vanishes), casing and opacity, all by atlas zoom. */
export const WAKE_STOPS = Object.freeze({
  RADIUS: [[6, 2.5], [10, 3], [13.5, 4], [15, 8], [18, 18]],
  CASING: [[13.5, 1], [15, 2]],
  OPACITY: [[6, 0.7], [13.5, 0.9]],
});
/* interp — lifted from 21-dark-pixels/layers-panel.mjs lines 353-360. */
export function interp(stops, x) {
  if (x <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [x1, y1] = stops[i];
    if (x <= x1) { const [x0, y0] = stops[i - 1]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  }
  return stops[stops.length - 1][1];
}

/* wake — the dark-pixels lit mark: a faint glow of the colour at 2.4 x radius
   and opacity 0.15 from atlas zoom 13.5, a black casing ring, then the fill at
   the zoom's opacity; one path per pass (21-dark-pixels/layers-panel.mjs lines
   427-445).
   options: {colour, budget}. */
export function wake(ctx, points, view, { colour, budget = Infinity } = {}) {
  const az = atlasZoom(view.zoom);
  const rad = interp(WAKE_STOPS.RADIUS, az), cas = interp(WAKE_STOPS.CASING, az), op = interp(WAKE_STOPS.OPACITY, az);
  const glow = az >= 13.5, pad = rad * 2.4 + 2;
  let drawn = 0, offscreen = 0, skipped = 0;
  const G = [];
  for (let i = 0; i < points.length; i += 2) {
    const [x, y] = toScreen(view, points[i], points[i + 1]);
    if (!inView(view, x, y, pad)) { offscreen++; continue; }
    if (drawn >= budget) { skipped++; continue; }
    G.push(x, y); drawn++;
  }
  const pass = (r, style, alpha) => {
    ctx.beginPath();
    for (let i = 0; i < G.length; i += 2) { ctx.moveTo(G[i] + r, G[i + 1]); ctx.arc(G[i], G[i + 1], r, 0, TAU); }
    ctx.globalAlpha = alpha; ctx.fillStyle = style; ctx.fill();
  };
  if (drawn) {
    if (glow) pass(rad * 2.4, colour, 0.15);
    pass(rad + cas, '#000', 1);
    pass(rad, colour, op);
  }
  ctx.globalAlpha = 1;
  return { drawn, offscreen, skipped, radius: rad, why: '' };
}

/* ── loading tools: Grid Atlas's loader, lifted ───────────────────────────── */

/* FetchQueue — lifted from repd_grid_atlasv8/ventus-corev8engine.js lines
   645-654. At most `concurrency` tasks run; the rest wait in arrival order.
   `peak` is added so a test can see the bound hold. */
export class FetchQueue {
  constructor(concurrency) { this.concurrency = concurrency; this.active = 0; this.queue = []; this.peak = 0; }
  async add(task) {
    if (this.active >= this.concurrency) await new Promise(resolve => this.queue.push(resolve));
    this.active++; if (this.active > this.peak) this.peak = this.active;
    try { return await task(); }
    finally { this.active--; if (this.queue.length > 0) this.queue.shift()(); }
  }
}

/* fetchWithTimeout — lifted from ventus-corev8engine.js lines 656-665: an
   AbortController aborts after `ms` (15 s there). fetchFn is injectable so it
   can be tested; the Atlas passes cache 'no-cache', kept as the default. */
export async function fetchWithTimeout(url, ms = 15000, fetchFn = globalThis.fetch, init = { cache: 'no-cache' }) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetchFn(url, { ...init, signal: controller.signal });
    clearTimeout(id);
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return response;
  } catch (err) { clearTimeout(id); throw err; }
}

/* createUrlCache — lifted from ventus-corev8engine.js lines 667-678
   (fetchAndParseGeoJSON's urlCache): one promise per URL, shared by every
   caller; a failure deletes the entry so a later call can retry. The Atlas
   returns [] for a body without features; here `parse` decides and may throw. */
export function createUrlCache(load) {
  const cache = new Map();
  return {
    get(url) {
      if (cache.has(url)) return cache.get(url);
      const p = Promise.resolve().then(() => load(url)).catch(err => { cache.delete(url); throw err; });
      cache.set(url, p);
      return p;
    },
    has: url => cache.has(url),
    get size() { return cache.size; },
  };
}

/* createHydrator — the guard of hydrateLayer, ventus-corev8engine.js lines
   1132-1134 and its state writes through 1196: per id {loaded, loading, status};
   a call returns at once when loaded or loading, so repeated taps never
   double-fetch. load(id) resolves to a feature count; 0 is EMPTY, a throw is
   FAIL with its message, anything else OK. onState(id, status, why) is the one
   writer of the label. Turning a layer off is not this tool's business: the data
   stays and the next call returns at once. */
export function createHydrator(load, onState = () => {}) {
  const state = new Map();
  const of = id => { if (!state.has(id)) state.set(id, { loaded: false, loading: false, status: 'WAIT', why: '' }); return state.get(id); };
  async function hydrate(id) {
    const s = of(id);
    if (s.loaded || s.loading) return s;
    s.loading = true; s.status = 'LOAD'; onState(id, 'LOAD', '');
    try {
      const n = await load(id);
      s.loaded = true; s.status = n > 0 ? 'OK' : 'EMPTY';
      s.why = n > 0 ? '' : 'loaded; it holds no features';
    } catch (e) { s.status = 'FAIL'; s.why = e.message; }
    s.loading = false;
    onState(id, s.status, s.why);
    return s;
  }
  return { hydrate, state: of };
}

/* updateLabel — ventus-corev8engine.js lines 622-640 (updateUIState): changes
   the text of ONE span, found by id, and nothing else; never re-renders a list.
   Writes only when the text differs. Returns true when it wrote. */
export function updateLabel(doc, id, text) {
  const span = doc.getElementById(id);
  if (!span || span.textContent === text) return false;
  span.textContent = text;
  return true;
}

/* bandOfKey / bandsInView / createBandTiles — the tile law of the wafer's own
   builder (build/tile_layer.py lines 4-10 and 46-47): because r = sqrt(key), a
   radius band b of width S is exactly the key range [(b*S)^2, ((b+1)*S)^2), and
   a key's band is isqrt(key) // S. */
export function bandOfKey(key, S) {
  let r = Math.floor(Math.sqrt(key));
  while (r * r > key) r--;
  while ((r + 1) * (r + 1) <= key) r++;
  return Math.floor(r / S);
}
export const bandKeyRange = (b, S) => [(b * S) ** 2, ((b + 1) * S) ** 2];

/* The bands a view's rectangle touches: from the rectangle's nearest distance to
   the wafer centre to its farthest corner, clamped to [0, bands). Ordered by
   distance from the view centre's own band, nearest first, so a cap keeps what
   is under the reader's eye. */
export function bandsInView(view, S, bands) {
  const hw = view.w / 2 / view.zoom, hh = view.h / 2 / view.zoom;
  const x0 = view.x - hw, x1 = view.x + hw, y0 = view.y - hh, y1 = view.y + hh;
  const nx = Math.max(x0, Math.min(0, x1)), ny = Math.max(y0, Math.min(0, y1));
  const rMin = Math.hypot(nx, ny);
  const rMax = Math.hypot(Math.max(Math.abs(x0), Math.abs(x1)), Math.max(Math.abs(y0), Math.abs(y1)));
  const lo = Math.max(0, Math.floor(rMin / S)), hi = Math.min(bands - 1, Math.floor(rMax / S));
  if (lo > bands - 1) return [];
  const c = Math.min(bands - 1, Math.floor(Math.hypot(view.x, view.y) / S));
  const out = [];
  for (let b = lo; b <= hi; b++) out.push(b);
  return out.sort((a, b) => Math.abs(a - c) - Math.abs(b - c) || a - b);
}

/* createBandTiles — fetch only the bands a view intersects, at most `cap` held in
   memory. want(bands) keeps the first `cap` of the ordered list, loads those not
   held (through load(b), which the caller routes through its FetchQueue and URL
   cache), and evicts held bands outside the kept set, farthest first, until the
   holding is within cap. Returns {kept, dropped (bands in view beyond the cap),
   evicted}. A band that fails to load is not held; its error is kept by band. */
export function createBandTiles({ cap, load, onChange = () => {} }) {
  const held = new Map();     /* band -> features */
  const pending = new Map();  /* band -> promise */
  const errors = new Map();
  let keep = new Set();
  function want(ordered) {
    const kept = ordered.slice(0, cap);
    keep = new Set(kept);
    const evicted = [];
    const centre = kept.length ? kept[0] : 0;
    const extra = [...held.keys()].filter(b => !keep.has(b)).sort((a, b) => Math.abs(b - centre) - Math.abs(a - centre));
    const coming = kept.filter(b => !held.has(b)).length;
    while (held.size + coming > cap && extra.length) { const b = extra.shift(); held.delete(b); evicted.push(b); }
    for (const b of kept) {
      if (held.has(b) || pending.has(b)) continue;
      const p = Promise.resolve().then(() => load(b)).then(features => {
        pending.delete(b);
        if (keep.has(b)) { held.set(b, features); errors.delete(b); onChange(b, 'OK'); }
        else onChange(b, 'DROPPED');   /* the view moved on while it loaded; not held */
      }, err => { pending.delete(b); errors.set(b, err.message); onChange(b, 'FAIL'); });
      pending.set(b, p);
    }
    return { kept, dropped: ordered.length - kept.length, evicted };
  }
  return {
    want,
    held: () => held,
    pending: () => pending.size,
    errors: () => errors,
    get size() { return held.size; },
    whenIdle: () => Promise.all([...pending.values()]).then(() => undefined),
  };
}

/* ── the registry ─────────────────────────────────────────────────────────── */

export const TOOLS = Object.freeze([
  { name: 'voltageBands', kind: 'pure', source: `${GW} iterations/04-400kv-engine/layers-panel.mjs lines 89-106`,
    description: 'Values to bands by quantile, highest first; labels, colours and widths from the Atlas Topology group.' },
  { name: 'strokeLikeTransmission', kind: 'draw', source: `${GW} atlas/index.html lines 62-66, 112; iterations/04-400kv-engine/layers-panel.mjs lines 444-454; iterations/21-dark-pixels/layers-panel.mjs lines 424-425`,
    description: 'A route as a cased line in its band\'s Atlas colour and width.' },
  { name: 'substationDot', kind: 'draw', source: `${GW} atlas/index.html lines 67, 113; iterations/04-400kv-engine/layers-panel.mjs lines 457-465`,
    description: 'A white dot at the Atlas substation radius, interpolated by zoom.' },
  { name: 'zoomGate', kind: 'pure', source: `${GG} repd_grid_atlasv8/ventus-corev8engine.js line 1244; repd_grid_atlasv8/index.html line 147; ${GW} iterations/04-400kv-engine/layers-panel.mjs lines 43-58`,
    description: 'Visible or not at a zoom, and the radius, from a layer\'s minzoom and interpolate stops.' },
  { name: 'circleLikeAtlas', kind: 'draw', source: `${GG} repd_grid_atlasv8/ventus-corev8engine.js line 1242`,
    description: 'A point in a layer\'s colour and gated radius with a 1 px black stroke.' },
  { name: 'projectPixel', kind: 'draw', source: `${GG} repd_grid_atlasv8/ventus-corev8engine.js lines 1302, 1319`,
    description: 'The solar-farm pixel: glow tier from 4 upward, colour and radius by magnitude, black outline.' },
  { name: 'wake', kind: 'draw', source: `${GW} iterations/21-dark-pixels/layers-panel.mjs lines 352-364, 427-445`,
    description: 'A charted key lit on the dark ground: glow, casing ring, fill, all by zoom.' },
  { name: 'evalExpr', kind: 'pure', source: `${GW} iterations/04-400kv-engine/layers-panel.mjs lines 43-58 (extended: get, coalesce, colour stops)`,
    description: 'Evaluates the Atlas interpolate expressions.' },
  { name: 'parseAtlasTopology', kind: 'pure', source: `${GW} iterations/04-400kv-engine/layers-panel.mjs lines 60-77`,
    description: 'Reads the Topology group styles out of atlas/index.html text.' },
  { name: 'FetchQueue', kind: 'load', source: `${GG} repd_grid_atlasv8/ventus-corev8engine.js lines 645-654`,
    description: 'Bounded concurrency for every network task.' },
  { name: 'fetchWithTimeout', kind: 'load', source: `${GG} repd_grid_atlasv8/ventus-corev8engine.js lines 656-665`,
    description: 'A fetch that aborts after 15 s.' },
  { name: 'createUrlCache', kind: 'load', source: `${GG} repd_grid_atlasv8/ventus-corev8engine.js lines 667-678`,
    description: 'One shared promise per URL; failures are dropped so a retry is possible.' },
  { name: 'createHydrator', kind: 'load', source: `${GG} repd_grid_atlasv8/ventus-corev8engine.js lines 1132-1134`,
    description: 'The {loaded, loading} guard: repeated taps never double-fetch.' },
  { name: 'updateLabel', kind: 'load', source: `${GG} repd_grid_atlasv8/ventus-corev8engine.js lines 622-640`,
    description: 'Changes the text of one span, never the list.' },
  { name: 'createBandTiles', kind: 'load', source: `${GW} build/tile_layer.py lines 4-10, 46-47`,
    description: 'Key range per radius band; fetch only bands in view; evict beyond a cap.' },
]);
