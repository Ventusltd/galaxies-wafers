/* questions.mjs — iteration 01, Route Alpha: the owner's three questions and the
 * machine detail line. Counts are read at run time (layers/manifest.json, the
 * layers panel's own rows, the page's own count and provenance lines); every
 * function is cited to its file and line in this directory. Where an answer is
 * not established it says so and why.
 */

const $ = id => document.getElementById(id);
const fmt = n => Number(n).toLocaleString('en-GB');
const DATA_PIN = 'https://globalgrid2050.com/testcode/202609142202/data/';
const SEARCH = 'repository search at ee082ea';   /* the commit the "who else" searches were run on */

/* One question and its answer. Parts are strings or [text, href] links; text only, never HTML. */
function answer(dl, q, parts) {
  const dt = document.createElement('dt'); dt.textContent = q;
  const dd = document.createElement('dd');
  const fill = ps => {
    dd.replaceChildren();
    for (const p of [].concat(ps)) {
      if (Array.isArray(p)) { const a = document.createElement('a'); a.textContent = p[0]; a.href = p[1]; dd.append(a); }
      else dd.append(String(p));
    }
  };
  fill(parts);
  dl.append(dt, dd);
  return fill;
}

/* One fetch, 15 s timeout, only when the reader opens the panel. */
async function readJSON(url) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 15000);
  try {
    const r = await fetch(url, { cache: 'default', signal: c.signal });
    if (!r.ok) throw new Error(url + ' returned HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

/* The layer rows' tags as the layers panel shows them now, counted from its own DOM. */
function layerTags() {
  const c = new Map();
  for (const t of document.querySelectorAll('#layersList .ltag')) {
    const s = (t.textContent.match(/[A-Z]+/) || ['?'])[0];
    c.set(s, (c.get(s) || 0) + 1);
  }
  return c.size ? [...c].map(([s, n]) => `${fmt(n)} ${s}`).join(', ') : 'layer rows not built yet';
}

/* Layers whose id names an SLD, read from a manifest at run time (name-match inference). */
function sldSentence(m, file) {
  const hits = m.layers.filter(l => /sld/i.test(l.id));
  if (!hits.length) return `None of the ${fmt(m.layers.length)} layers in ${file} carries "sld" in its id.`;
  return `Of ${fmt(m.layers.length)} layers in ${file}, ${hits.length} carry "sld" in their id (name-match inference): ` +
    hits.map(l => `${l.id} (${fmt(l.features)} features, draws ${l.draws})`).join(', ') + '.';
}

const text = id => ($(id)?.textContent || '').trim();

/* Collapsed by default. Nothing is read or fetched until the reader opens it; the
   machine line repaints every 500 ms only while it is open. */
function mount(build, machine) {
  const box = $('questions'), dl = $('qlist'), out = $('machine');
  if (!box || !dl || !out) return;
  let built = false, timer = 0;
  /* Opened, the panel stops above whatever is drawn at the bottom (line panel, clock, strip, beam form), never over it. */
  const fit = () => {
    const top = box.getBoundingClientRect().top;
    let floor = innerHeight;
    for (const id of ['panel', 'clock', 'ptable', 'beam']) {
      const el = $(id);
      const r = el && !el.hidden ? el.getBoundingClientRect() : null;
      if (r && r.height > 0 && r.top > top) floor = Math.min(floor, r.top);
    }
    box.style.maxHeight = Math.max(96, Math.min(innerHeight * 0.45, floor - top - 8)) + 'px';
  };
  const paint = () => {
    fit();
    try { out.textContent = 'Machine detail · ' + machine(); }
    catch (e) { out.textContent = 'Machine detail · not established: ' + e.message; }
  };
  /* A bottom element that grows while the panel is open refits it at once, not at the next repaint. */
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(() => { if (box.open) fit(); });
    for (const id of ['panel', 'clock', 'ptable', 'beam']) if ($(id)) ro.observe($(id));
  }
  addEventListener('resize', () => { if (box.open) fit(); });
  box.addEventListener('toggle', () => {
    clearInterval(timer);
    if (!box.open) return;
    if (!built) { built = true; build(dl); }
    paint();
    timer = setInterval(paint, 500);
  });
}

const COMMIT = '29c0fb4';   /* the commit that made this page; the Questions panel is added later */

mount(dl => {
  const q1 = answer(dl, '1 · How does this help draw a system or a single-line diagram?', 'reading layers/manifest.json…');
  answer(dl, '2 · What is this code used for?',
    'Stroking layer routes over the numbered wafer so dense modules go translucent. layers-panel.mjs (copied from the root, changes listed at its line 28): ' +
    'routeAlpha(n) = min(1, ?alpha ÷ √n) at line 42, ROUTE_WIDTH 0.6 px at line 35, densityLegend() at 114, toggle() at 198 loads a ticked layer, drawOverlay() at 296 strokes it (alpha applied at 309), pickAt() at 349 and inspect() at 379 answer a tap. ' +
    'app.mjs is the root page copied with only its import path changed: tier1() at 86 and tier2() at 104 load the numbered database, render() at 256 draws the points, flyTo() at 295, connect() at 378. ' +
    `Both import lib.mjs (place, placeAll, parseKey, indexOfKey, ownersOf, fanoutCount, connectAnswer, esc, fmt, SPACING), which 42 files in this repository import (${SEARCH}, import statements). ` +
    `Nothing outside this directory imports or names routeAlpha() (${SEARCH}).`);
  answer(dl, '3 · Where does it lead next?', [
    `Not established: no later page carries the √features rule (${SEARCH}); the root layers-panel.mjs strokes routes with its own casing and opacity (lines 715–716 at ee082ea). ` +
    'The same module routes are restyled as transmission-line voltages in ', ['iteration 04, 400kV Engine Mode', '../04-400kv-engine/'],
    ' (04-400kv-engine/layers-panel.mjs line 63 at ee082ea): a sibling restyle, not a derivation of this rule.']);
  readJSON('../../layers/manifest.json').then(m => {
    q1('It draws no electrical element; it maps code. It changes only how a layer’s LineString routes are stroked (drawOverlay() lines 309–312), so a sparse layer stays bright beside dense modules; Point marks keep their alpha. ' +
      sldSentence(m, 'layers/manifest.json') + ' The draws field is the manifest’s declaration, not a count of feature types.');
  }).catch(e => q1(`Not established: layers/manifest.json could not be read (${e.message}), so no SLD layer can be named. The page draws no electrical element.`));
}, () => {
  const u = new URL(location.href).searchParams;
  return `inputs: ?line= and ?to= (permanent line keys, positive integers, read by readURL() app.mjs line 496), ?layers= (layer ids from layers/manifest.json, layers-panel.mjs line 270), ?alpha= (route alpha scale, clamped to 0.05–1, default 1, line 37; in the URL now: ${u.get('alpha') ?? 'absent'}); ` +
    `data: all-lines.meta.json, all-lines.bin, all-lines.len.bin, all-lines.family.bin, families.json and lines.bin from ${DATA_PIN} (app.mjs line 48), ${text('prov') || 'provenance not loaded yet'} · ` +
    `outputs: ${text('count') || 'count not loaded yet'}; layer rows now ${layerTags()}; route alpha per layer in the LAYERS density legend · ` +
    'refusals: refuse() app.mjs line 514 names why a linked or typed number cannot be used, a number never issued or a line no family carries; a layer reads FAIL with its reason or EMPTY with its reason; unknown ?layers= ids are dropped without a warning and the URL rewritten (lines 272–274) · ' +
    `source: page commit ${COMMIT}; lib.mjs and layers/ from this repository`;
});
