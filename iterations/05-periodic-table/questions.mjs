/* questions.mjs — iteration 05, the Periodic Table on the wafer: the owner's
 * three questions and the machine detail line. Block and category counts are
 * read at run time from the strip table.mjs built from the live register (no
 * second fetch of it); functions are cited to file and line.
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

const COMMIT = '5a6bb0d';   /* the commit that made this page; the Questions panel is added later */

/* The strip's cells as table.mjs drew them: symbol, category and tag state. */
function cells() {
  return [...document.querySelectorAll('#ptable .pcell')].map(n => ({ sym: n.dataset.symbol, cat: n.dataset.category, status: n.dataset.status || 'WAIT' }));
}

mount(dl => {
  const q1 = answer(dl, '1 · How does this help draw a system or a single-line diagram?', 'reading the strip…');
  answer(dl, '2 · What is this code used for?',
    'Finding a register block on the wafer. table.mjs: the live register is fetched at line 123 (REGISTER line 15) and drawn as one cell per block grouped by category; paint() line 55 writes a cell\'s WAIT/LOAD/OK/EMPTY/FAIL tag; ' +
    'choose() line 105 hydrates layers/modules/module-<Sym>.json through the layers panel (hydrate() line 74) and fly() line 95 sends the block\'s first line, firstLine() line 85, through the wafer\'s own beam form to flyTo() (app.mjs line 295); queue() line 114 hydrates a ?category= three at a time. ' +
    'layers-panel.mjs is the root copy with paths from the repository root and one hook, window.__layers, at line 422; app.mjs is the root copy with only its import path changed. ' +
    `Who else: nothing imports table.mjs but this page\'s index.html (${SEARCH}); module-<Sym> layers are written by build/build_layers_modules.py (id at line 89); the register is also read by the root app.mjs and iterations 03, 26, 31, 32 and 37 (${SEARCH}, text search); lib.mjs is imported by 42 files (${SEARCH}).`);
  answer(dl, '3 · Where does it lead next?', [
    'To the block\'s first line on the wafer (fly() line 95). Links between blocks are not drawn here; ',
    ['iteration 37, Hidden Wires', '../37-hidden-wires/'],
    ' draws the register\'s declared depends_on needs between blocks (37-hidden-wires/app.mjs line 554). The strip also links out to the periodic table page it mirrors (TABLE, table.mjs line 16).']);
  const fill = () => {
    const cs = cells();
    if (!cs.length) { q1(`Not established yet: the strip has no cells (${text('ptable') || 'register not read'}). The page draws no electrical element.`); return false; }
    const by = c => cs.filter(x => x.cat === c).map(x => x.sym);
    const net = by('network'), con = by('connections');
    const cats = new Set(cs.map(x => x.cat));
    q1('It draws no electrical element; it maps register blocks to their numbered lines, so the code of a block can be found on the wafer and read. ' +
      `Measured from the strip now: ${fmt(cs.length)} blocks in ${cats.size} categories; network holds ${net.length} (${net.join(', ') || 'none'}), connections holds ${con.length} (${con.join(', ') || 'none'}). ` +
      'That these concern grid elements is name-match inference from the register\'s category names.');
    return true;
  };
  if (!fill()) { const t = setInterval(() => { if (fill()) clearInterval(t); }, 1000); setTimeout(() => clearInterval(t), 30000); }
}, () => {
  const u = new URL(location.href).searchParams;
  const st = new Map();
  for (const c of cells()) st.set(c.status, (st.get(c.status) || 0) + 1);
  return `inputs: ?block=<symbol> (table.mjs line 40; in the URL now: ${u.get('block') ?? 'absent'}) and ?category=<name> (line 41; in the URL now: ${u.get('category') ?? 'absent'}), ?line= and ?to= (permanent line keys, readURL() app.mjs line 496), ?layers= (layers-panel.mjs line 254); ` +
    `data: all-lines.meta.json, all-lines.bin, all-lines.len.bin, all-lines.family.bin, families.json and lines.bin from ${DATA_PIN} (app.mjs line 48), ${text('prov') || 'provenance not loaded yet'}; ` +
    'the block register https://ventusltd.github.io/stars/blocks/blocks.json (live, not pinned to a commit); layer files from layers/ in this repository · ' +
    `outputs: ${text('count') || 'count not loaded yet'}; cells now ${st.size ? [...st].map(([s, n]) => `${fmt(n)} ${s}`).join(', ') : 'not drawn yet'}; layer rows now ${layerTags()} · ` +
    'refusals: a cell whose block has no module layer reads EMPTY "no numbered lines in this pack" (line 23); an unreadable register replaces the strip with its reason (line 127); a layer reads FAIL or EMPTY with its reason; unknown ?layers= ids are dropped without a warning (layers-panel.mjs line 256); refuse() app.mjs line 514 · ' +
    `source: page commit ${COMMIT}; lib.mjs and layers/ from this repository`;
});
