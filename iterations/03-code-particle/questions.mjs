/* questions.mjs — iteration 03, Code Particle: the owner's three questions and
 * the machine detail line. Register counts are read at run time from the live
 * block register when the reader opens the panel (the same URL and cache mode
 * code-particle.mjs uses); functions are cited to file and line.
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

const COMMIT = 'e38ba10';   /* the commit that made this page; the Questions panel is added later */
const REGISTER = 'https://ventusltd.github.io/stars/blocks/blocks.json';   /* code-particle.mjs line 9 */

mount(dl => {
  const q1 = answer(dl, '1 · How does this help draw a system or a single-line diagram?', 'reading the block register…');
  answer(dl, '2 · What is this code used for?',
    'Reading the real code behind a numbered line. app.mjs is the root page copied with two changes: the lib.mjs path and, at line 377, a dynamic import of code-particle.mjs after paintPanel() fills the line panel. ' +
    'code-particle.mjs: loadRegister() line 34 fetches stars/blocks/blocks.json once and maps each family to its block; readFile() line 46 reads raw.githubusercontent at the commit the register pins, through FetchQueue(2) at line 22, cached per repo@commit:path; ' +
    'openCode() line 62 finds the family\'s definition by pattern (line 95) and shows 200 lines around it, text only. ' +
    `Who else: nothing imports code-particle.mjs but this page (${SEARCH}). Its pattern was copied, not imported, into the root app.mjs (comment at line 692) and iteration 31 card.mjs (line 12). ` +
    `The register is also read by the root app.mjs, iterations 05, 26, 31, 32 and 37, and build/build_layers.py and build/build_layers_modules.py (${SEARCH}, text search). This page loads no layers panel (index.html has no layers-panel.mjs).`);
  answer(dl, '3 · Where does it lead next?', [
    ['Iteration 31, Code Card Everywhere', '../31-code-card-everywhere/'],
    ' carries this reading of a register block\'s pinned file into a card on every tap (31-code-card-everywhere/card.mjs line 12). The code shown here leads to the block\'s file on GitHub at its pinned commit (openCode() line 114).']);
  readJSON(REGISTER).then(reg => {
    const cat = c => reg.blocks.filter(b => b.category === c);
    const net = cat('network'), con = cat('connections');
    const list = bs => bs.map(b => `${b.symbol} ${b.title}`).join('; ');
    q1('It draws no electrical element; it maps code. A tapped line opens the pinned source of the register block that carries it, so where a block computes something about the grid its code can be read. ' +
      `Measured from the live register now: ${fmt(reg.blocks.length)} blocks; category network holds ${net.length} (${list(net) || 'none'}), category connections holds ${con.length} (${list(con) || 'none'}). ` +
      'That these concern grid elements is name-match inference from the register\'s category and title fields.');
  }).catch(e => q1(`Not established: the block register could not be read (${e.message}). The page draws no electrical element.`));
}, () => {
  const code = $('code');
  const tag = code?.querySelector('.tag')?.textContent;
  const where = code?.querySelector('p.dim')?.textContent;
  return 'inputs: ?line= and ?to= (permanent line keys, positive integers, readURL() app.mjs line 498), a tap on the wafer (CSS px); ' +
    `data: all-lines.meta.json, all-lines.bin, all-lines.len.bin, all-lines.family.bin, families.json and lines.bin from ${DATA_PIN} (app.mjs line 48), ${text('prov') || 'provenance not loaded yet'}; ` +
    `the block register ${REGISTER} (live, not pinned to a commit); source files from raw.githubusercontent pinned to each file's commit in the register · ` +
    `outputs: ${text('count') || 'count not loaded yet'}; code panel now ${tag ? `${tag}${where ? ' · ' + where : ''}` : 'not opened (tap a line carried by a family)'} · ` +
    'refusals: FAIL with the HTTP status when the register or a source file cannot be read; OK "Resolved no block" when no carrying family is inside a block; refuse() app.mjs line 516 names why a linked or typed number cannot be used · ' +
    `source: page commit ${COMMIT}; lib.mjs from this repository`;
});
