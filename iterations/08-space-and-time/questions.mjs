/* questions.mjs — iteration 08, Space and Time: the owner's three questions and
 * the machine detail line. The clock is read at run time from clock.mjs (the
 * same module instance app.mjs and layers-panel.mjs import); layer counts from
 * layers/manifest.json; functions are cited to file and line.
 */
import { clock, GLOW_SHARE, GLOW_GROWTH } from './clock.mjs';

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

const COMMIT = 'f5de7a8';   /* the last commit to this page before the Questions panel */

mount(dl => {
  const q1 = answer(dl, '1 · How does this help draw a system or a single-line diagram?', 'reading layers/manifest.json…');
  answer(dl, '2 · What is this code used for?',
    'Drawing the wafer in discovery order. clock.mjs holds one number, t: born() line 20 says whether a key is discovered yet, glow() line 21 how recently, setT() line 26 moves t and tells listeners, bornPrefix() line 35 cuts a route at its last discovered key, dateIndex() line 56 finds the newest recorded family date among families whole at t. ' +
    'app.mjs adds the shader\'s born and glow terms, startClock() line 572 (?t= and ?rate=) and paintClock() line 547; layers-panel.mjs draws points only once born and routes through their born prefix. ' +
    `Who else: clock.mjs is imported by this page\'s app.mjs (line 47) and layers-panel.mjs (line 27) and by no other file (${SEARCH}); lib.mjs is imported by 42 files (${SEARCH}).`);
  answer(dl, '3 · Where does it lead next?',
    `Not established: no other page imports clock.mjs or reads ?t= (${SEARCH}), so the discovery position joins no next element or page.`);
  readJSON('../../layers/manifest.json').then(m => {
    q1('It draws no electrical element; it maps code. A key is the order in which the numbered database met a line, not the time it was written (clock.mjs lines 3–5), so this page cannot show when any part of a network was designed or built. ' +
      `It shows which lines of a layer, an SLD layer included, had been discovered by position t (now ${fmt(clock.t)} of ${fmt(clock.max)}). ` + sldSentence(m, 'layers/manifest.json'));
  }).catch(e => q1(`Not established: layers/manifest.json could not be read (${e.message}). The page draws no electrical element.`));
}, () => {
  const u = new URL(location.href).searchParams;
  return `inputs: ?t= (discovery position, a key, clamped to 1…max; unreadable starts at max; app.mjs line 575; in the URL now: ${u.get('t') ?? 'absent'}), ?rate= (keys per second; default max ÷ SWEEP_SECONDS, 60 s at app.mjs line 543; read at line 576), the slider and PLAY, ?line= and ?to= (permanent line keys, readURL() line 509), ?layers= (layers-panel.mjs line 253); ` +
    `data: all-lines.meta.json, all-lines.bin, all-lines.len.bin, all-lines.family.bin, families.json and lines.bin from ${DATA_PIN} (app.mjs line 49), ${text('prov') || 'provenance not loaded yet'} · ` +
    `outputs: t ${fmt(clock.t)} of ${fmt(clock.max)} (clock.mjs, now); keys within the last ${GLOW_SHARE * 100}% of t glow and draw up to ${1 + GLOW_GROWTH}× size; date shown ${text('tdate') || 'not yet'}${text('tsince')}; ${text('count') || 'count not loaded yet'}; layer rows now ${layerTags()} · ` +
    'refusals: an unreadable ?t= or ?rate= is not used (the default applies); before the first whole family the date reads "before the first family" (line 552); a layer reads FAIL or EMPTY with its reason; unknown ?layers= ids are dropped without a warning (layers-panel.mjs line 255); refuse() app.mjs line 527 · ' +
    `source: page commit ${COMMIT}; lib.mjs and layers/ from this repository`;
});
