/* questions.mjs — iteration 02, Tunnels: the owner's three questions and the
 * machine detail line. Counts are read at run time (this directory's
 * manifest.json, the root layers/manifest.json, the layers panel's own rows, the
 * page's count and provenance lines); functions are cited to file and line.
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

const COMMIT = '4cc78de';   /* the commit that made this page; the Questions panel is added later */
let tunnels = null;         /* this page's manifest entry for the tunnels layer, once read */

mount(dl => {
  const q1 = answer(dl, '1 · How does this help draw a system or a single-line diagram?', 'reading manifest.json…');
  const q2 = answer(dl, '2 · What is this code used for?', 'reading manifest.json…');
  answer(dl, '3 · Where does it lead next?',
    `Not established: no page outside this directory reads layers/tunnels.json (${SEARCH}), so a tunnel joins no next element or page.`);
  const body2 = 'Drawing where one line of text joins far regions of the numbering. layers-panel.mjs here reads this directory\'s manifest.json (line 438) and resolves layer files from the repository root; ' +
    'a layer declared draws: arcs is drawn as a quadratic arc bowing toward the centre (ARC_PULL and arcControl() lines 34–36, drawn in drawOverlay() line 304, picked at 351), and a tap names the shared line and both families (inspect() line 392). ' +
    'layers/tunnels.json is written by build/build_tunnels.py (manifest entry at line 77). app.mjs is the root page copied with only its import path changed (tier1() line 86, tier2() line 104, render() line 256). ' +
    `Both import lib.mjs, which 42 files in this repository import (${SEARCH}, import statements).`;
  Promise.all([readJSON('manifest.json'), readJSON('../../layers/manifest.json').catch(e => ({ error: e.message }))]).then(([m, root]) => {
    tunnels = m.layers.find(l => l.id === 'tunnels') || null;
    q1('It draws no electrical element; it maps code. A tunnel is one line carried by two families whose first lines lie far apart in the numbering, ' +
      (tunnels ? `${fmt(tunnels.features)} of them in the tunnels layer (${tunnels.evidence}). ` : 'but this manifest names no tunnels layer. ') +
      'What that enables: the same text written in two places can be found, so a change to one can be checked against its copy. ' + sldSentence(m, 'this page\'s manifest.json'));
    const inRoot = root.error ? `the root layers/manifest.json could not be read (${root.error})`
      : (root.layers.some(l => l.id === 'tunnels') ? 'the root layers/manifest.json also lists a tunnels layer (measured now)' : `the root layers/manifest.json (${fmt(root.layers.length)} layers) lists no tunnels layer (measured now)`);
    q2(body2 + ` Who else: ${inRoot}.`);
  }).catch(e => {
    q1(`Not established: manifest.json could not be read (${e.message}). The page draws no electrical element.`);
    q2(body2);
  });
}, () => `inputs: ?line= and ?to= (permanent line keys, positive integers, readURL() app.mjs line 496), ?layers= (ids from this directory's manifest.json, e.g. tunnels; layers-panel.mjs line 258); ` +
  `data: all-lines.meta.json, all-lines.bin, all-lines.len.bin, all-lines.family.bin, families.json and lines.bin from ${DATA_PIN} (app.mjs line 48), ${text('prov') || 'provenance not loaded yet'}; ` +
  (tunnels ? `layers/tunnels.json ${fmt(tunnels.bytes)} bytes, sha256 ${String(tunnels.sha256).slice(0, 12)} (from manifest.json) · ` : 'layers/tunnels.json as listed in manifest.json · ') +
  `outputs: ${text('count') || 'count not loaded yet'}; layer rows now ${layerTags()}; each arc 0.5 px at alpha 0.35 (line 35); a tapped arc's shared line key and its two families · ` +
  'refusals: refuse() app.mjs line 514 names why a linked or typed number cannot be used; a layer reads FAIL with its reason or EMPTY with its reason; unknown ?layers= ids are dropped without a warning and the URL rewritten (lines 260–262) · ' +
  `source: page commit ${COMMIT}; layers/ and lib.mjs from this repository`);
