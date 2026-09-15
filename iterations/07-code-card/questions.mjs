/* questions.mjs — iteration 07, the Code Card: the owner's three questions and
 * the machine detail line. Particle and card state are read at run time from
 * window.__codecard (code-card.mjs line 268) and the open card's own data
 * attributes; layer counts from layers/manifest.json; functions cited to line.
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

const COMMIT = 'dd20a5c';   /* the commit that made this page; the Questions panel is added later */

mount(dl => {
  const q1 = answer(dl, '1 · How does this help draw a system or a single-line diagram?', 'reading layers/manifest.json…');
  answer(dl, '2 · What is this code used for?',
    'Showing how many function families carry a line, and what they are. code-card.mjs: an index (line 92) loads families.json, lines.bin, all-lines.bin and all-lines.len.bin from the pinned data (DATA line 21); ' +
    'when the copying layer is ticked the layers panel announces it with a wafer:layer event (layers-panel.mjs toggle() line 177) and draw() line 129 paints each carried line as a particle, one Path2D per shine level; ' +
    'pick() line 178 finds the nearest carried line within 16 px and openCard() line 210 opens the popup: line, association count, characters, first three families with their block symbols. It imports place, ownersOf, indexOfKey and fmt from lib.mjs (line 19). ' +
    `Who else: nothing imports code-card.mjs but this page (${SEARCH}); its popup look was copied, not imported, into the root app.mjs (comment at line 696) and iteration 31 card.mjs (line 16); lib.mjs is imported by 42 files (${SEARCH}).`);
  answer(dl, '3 · Where does it lead next?', [
    'A card\'s button opens the line in the Line Wafer at the repository root (code-card.mjs line 246). ',
    ['Iteration 31, Code Card Everywhere', '../31-code-card-everywhere/'],
    ' carries this card\'s look into a card for every tap (31-code-card-everywhere/card.mjs line 16).']);
  readJSON('../../layers/manifest.json').then(m => {
    const copying = m.layers.find(l => l.id === 'copying');
    q1('It draws no electrical element; it maps code. It borrows Grid Atlas\'s REPD capacity radius stops (ATLAS_STOPS, code-card.mjs line 27), which the Atlas uses for project capacity in MW; ' +
      'here the axis carries an association count scaled by the layer\'s own maximum (onAtlasAxis() line 121), so a particle\'s size has no MW meaning. ' +
      (copying ? `The copying layer lists ${fmt(copying.features)} features (layers/manifest.json, read now). ` : 'layers/manifest.json lists no copying layer now, so no particles can be drawn. ') +
      sldSentence(m, 'layers/manifest.json'));
  }).catch(e => q1(`Not established: layers/manifest.json could not be read (${e.message}). The page draws no electrical element.`));
}, () => {
  const card = document.querySelector('.codecard');
  const C = window.__codecard;
  return 'inputs: ?layers= (the particles need copying, LAYER code-card.mjs line 22; layers-panel.mjs line 251), ?line= and ?to= (permanent line keys, readURL() app.mjs line 496), a tap on the wafer (CSS px, reach 16 px, line 176); ' +
    `data: all-lines.meta.json, all-lines.bin, all-lines.len.bin, all-lines.family.bin, families.json and lines.bin from ${DATA_PIN} (app.mjs line 48, code-card.mjs line 21), ${text('prov') || 'provenance not loaded yet'} · ` +
    `outputs: ${text('count') || 'count not loaded yet'}; particles drawn from the copying layer now ${C ? fmt(C.particles) : 'not known'}; ` +
    `card now ${card ? `line ${fmt(card.dataset.key)}, ${fmt(card.dataset.families)} associations` : 'closed'}; radius R·k px with R 8–38 on the Atlas stops, k = min(1, √zoom ÷ 4), at least 0.6 px (lines 140 and 147); layer rows now ${layerTags()} · ` +
    'refusals: if the family index cannot load, the reason goes to the console and a tap opens no card (line 102); a tap farther than 16 px from any carried line closes the card; a layer reads FAIL or EMPTY with its reason; unknown ?layers= ids are dropped without a warning (layers-panel.mjs line 253); refuse() app.mjs line 514 · ' +
    `source: page commit ${COMMIT}; lib.mjs and layers/ from this repository`;
});
