/* questions.mjs — iteration 06, Stars as Engines: the owner's three questions
 * and the machine detail line. The law list and the chosen engine are read at
 * run time from window.__engines (engines.mjs line 197); layer counts from
 * layers/manifest.json; functions are cited to file and line.
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

const COMMIT = 'b9664ee';   /* the commit that made this page; the Questions panel is added later */

mount(dl => {
  const q1 = answer(dl, '1 · How does this help draw a system or a single-line diagram?', 'reading layers/manifest.json…');
  answer(dl, '2 · What is this code used for?',
    'Re-placing the same permanent keys by one of the Ten Laws, beside the frozen wafer. engines.mjs: loadLaws() line 45 imports physics.mjs from the live Ten Laws page (LAWS_LIVE line 28, documented fallback line 29); ' +
    'entity() line 71 gives a law its facts; target() line 90 places every issued key and scales the law onto the wafer\'s extent, measured each time; select() line 133 tweens to it and writes ?engine=; placeKey() line 124 is where a key is drawn this frame. ' +
    'layers-panel.mjs imports placeKey as place (line 28), so layer marks move with the law; app.mjs calls engines.attach() (line 552) and engines.familiesReady() (line 117). ' +
    `Who else: physics.mjs is also imported by the Ten Laws page itself, testcode/202609151413/app.mjs in the globalgrid2050 repository (text search of that repository); nothing in this repository imports engines.mjs but this page (${SEARCH}); lib.mjs is imported by 42 files (${SEARCH}).`);
  answer(dl, '3 · Where does it lead next?', [
    'Not established as a lineage: no later page imports engines.mjs or reads ?engine= (' + SEARCH + '). The default engine, wafer (frozen), is lib.mjs place(); ',
    ['iteration 41, The Placement Law', '../41-golden-angle/'],
    ' examines that law and lists this page\'s engines.mjs among the files importing it (41-golden-angle/app.mjs line 350).']);
  readJSON('../../layers/manifest.json').then(m => {
    const laws = window.__engines?.laws() || [];
    q1('It draws no electrical element; it maps code. Every law reads code facts only: key, characters, fanout, family, place in family, category and age in days (entity() engines.mjs lines 71–85); none reads an electrical quantity, and physics.mjs does no fetch (its header, line 6). ' +
      `What that enables: a layer keeps its keys and follows whichever law is chosen (placeKey() line 124), so any layer, an SLD one included, can be seen under ${laws.length ? `${laws.length} engines (${laws.join(', ')}, read now)` : 'each engine once the laws load'}. ` +
      sldSentence(m, 'layers/manifest.json'));
  }).catch(e => q1(`Not established: layers/manifest.json could not be read (${e.message}). The page draws no electrical element.`));
}, () => {
  const E = window.__engines;
  const u = new URL(location.href).searchParams;
  return `inputs: ?engine=<law id> (engines.mjs line 179; in the URL now: ${u.get('engine') ?? 'absent, wafer'}), ?line= and ?to= (permanent line keys, readURL() app.mjs line 500), ?layers= (layers-panel.mjs line 253); ` +
    `data: all-lines.meta.json, all-lines.bin, all-lines.len.bin, all-lines.family.bin, families.json and lines.bin from ${DATA_PIN} (app.mjs line 49), ${text('prov') || 'provenance not loaded yet'}; ` +
    'laws: https://globalgrid2050.com/testcode/202609151413/physics.mjs (live URL, dated folder, not pinned to a commit) · ' +
    `outputs: ${text('count') || 'count not loaded yet'}; engine now ${E ? `${E.current}${E.settled ? ', settled' : ', moving'}, family facts ${E.hasFacts ? 'built' : 'not yet built'}, ${E.laws().length} engines offered` : 'not attached yet'}; layer rows now ${layerTags()} · ` +
    'refusals: an unknown ?engine= falls back to wafer (select() line 135); if the laws cannot be imported the selector says "laws unavailable" with the reason and only the wafer is offered (line 174); a layer reads FAIL or EMPTY with its reason; unknown ?layers= ids are dropped without a warning (layers-panel.mjs line 255); refuse() app.mjs line 518 · ' +
    `source: page commit ${COMMIT}; lib.mjs and layers/ from this repository`;
});
