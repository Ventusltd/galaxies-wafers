/* table.mjs — the periodic table, as a strip along the bottom of the wafer.
 *
 * One cell per block of the live register, grouped by category in the order the
 * register first uses each category, coloured by category. A cell's tag is the
 * Atlas's layer grammar for that block's module layer: WAIT until asked, LOAD
 * while fetching, OK when drawn, EMPTY with its reason, FAIL with its reason.
 *
 * Tapping a cell hydrates layers/modules/module-<Sym>.json through the layers
 * panel (so it draws on the wafer like any other layer) and flies the wafer to
 * the block's first line through the wafer's own beam form, whose handler calls
 * the wafer's own flyTo. The periodic table page's two parameters travel here:
 * ?block=Vd does the same on arrival; ?category=network lights every cell of
 * that category and hydrates their layers three at a time.
 */
const REGISTER = 'https://ventusltd.github.io/stars/blocks/blocks.json';
const TABLE = 'https://ventusltd.github.io/stars/table.html';
const CONCURRENCY = 3;
const COLOUR = {
  geodesy: '#00cc00', network: '#0054ff', connections: '#ff0000', constants: '#ff9900',
  cartridges: '#ffff00', layers: '#b200ff', arrival: '#ff00ff', news: '#ff4500',
  solar: '#ffd700', interface: '#00ffff', proofs: '#39ff14', other: '#8b93a7',
};
const NO_LAYER = 'no numbered lines in this pack';

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = String(text);
  return n;
};

const strip = el('section'); strip.id = 'ptable';
strip.setAttribute('aria-label', 'the periodic table of blocks');
strip.appendChild(el('span', 'pnote', 'loading the live block register…'));
document.body.appendChild(strip);

const cells = new Map();      /* symbol -> {block, node, tag} */
const params = new URLSearchParams(location.search);
const wantBlock = params.get('block');
const wantCategory = params.get('category');

const layers = () => new Promise(res => {
  if (window.__layers) return res(window.__layers);
  document.addEventListener('layers-ready', () => res(window.__layers), { once: true });
});

/* The wafer attaches its beam form's listener in the same task that first sizes its view. */
const waferReady = () => new Promise(res => {
  (function poll() { const v = window.__wafer?.view; v && v.w > 0 ? res() : setTimeout(poll, 120); })();
});

const layerId = sym => 'module-' + sym;

function paint(sym) {
  const c = cells.get(sym);
  const L = window.__layers;
  let status, why = '';
  if (!L) { status = 'WAIT'; why = 'layers loading'; }
  else if (!L.has(layerId(sym))) { status = 'EMPTY'; why = NO_LAYER; }
  else {
    const s = L.stateOf(layerId(sym));
    status = String(s.status).split(' ')[0];
    why = s.why || '';
  }
  c.tag.className = 'ltag ' + status;
  c.tag.textContent = status;
  c.node.dataset.status = status;
  c.node.title = `${c.block.symbol} · ${c.block.title} · ${c.block.category}${why ? ' · ' + why : ''}`;
}
const paintAll = () => { for (const s of cells.keys()) paint(s); };
document.addEventListener('layers-change', paintAll);

async function hydrate(sym) {
  const L = await layers();
  if (!L.has(layerId(sym))) { paint(sym); return null; }
  await L.hydrate(layerId(sym));
  paint(sym);
  return L.stateOf(layerId(sym));
}

/* The block's first line: the layer marks each function's first line with a
   Point; the first such mark is the first function's first line. (The lowest key
   is not it: that is usually a blank or a brace shared by thousands of families.) */
function firstLine(doc) {
  const feats = doc?.features || [];
  const mark = feats.find(f => f.geometry.type === 'Point' && f.properties?.mark === 'first line');
  if (mark) return mark.geometry.key;
  const route = feats.find(f => f.geometry.type === 'LineString' && f.geometry.keys?.length);
  return route ? route.geometry.keys[0] : null;
}

/* Fly with the wafer's own flyTo, reached through its own form; then put this
   page's parameters back, since the wafer's writeURL keeps only ?line and ?to. */
async function fly(key) {
  await waferReady();
  $('a').value = String(key); $('b').value = '';
  $('beam').requestSubmit();
  const u = new URL(location.href);
  for (const k of ['block', 'category']) { const v = params.get(k); if (v) u.searchParams.set(k, v); }
  history.replaceState(history.state, '', u.pathname + u.search + u.hash);
  window.__layers?.writeURL();
}

async function choose(sym) {
  for (const c of cells.values()) c.node.classList.toggle('sel', c.block.symbol === sym);
  params.set('block', sym);
  const s = await hydrate(sym);
  if (!s || s.status !== 'OK') return;
  const key = firstLine(s.doc);
  if (key !== null) await fly(key);
}

async function queue(symbols, n) {
  let i = 0;
  const worker = async () => { while (i < symbols.length) await hydrate(symbols[i++]); };
  await Promise.all(Array.from({ length: Math.min(n, symbols.length) }, worker));
}

(async () => {
  let reg;
  try {
    const r = await fetch(REGISTER, { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    reg = await r.json();
  } catch (e) {
    strip.replaceChildren(el('span', 'pnote', 'The live block register could not be read: ' + e.message));
    return;
  }
  const order = [];
  const byCat = new Map();
  for (const b of reg.blocks) {
    if (!byCat.has(b.category)) { byCat.set(b.category, []); order.push(b.category); }
    byCat.get(b.category).push(b);
  }
  strip.replaceChildren();
  for (const cat of order) {
    const colour = COLOUR[cat] || COLOUR.other;
    const g = el('div', 'pgroup'); g.style.setProperty('--c', colour);
    const head = el('div', 'phead', `${cat} · ${byCat.get(cat).length}`); head.style.color = colour;
    const grid = el('div', 'pcells');
    for (const b of byCat.get(cat)) {
      const node = el('button', 'pcell'); node.type = 'button';
      node.dataset.symbol = b.symbol; node.dataset.category = cat;
      const tag = el('span', 'ltag WAIT', 'WAIT');
      node.append(el('span', 'pnum', b.number), el('span', 'psym', b.symbol), tag);
      node.addEventListener('click', () => choose(b.symbol));
      cells.set(b.symbol, { block: b, node, tag });
      grid.appendChild(node);
    }
    g.append(head, grid);
    strip.appendChild(g);
  }
  const src = el('a', 'pnote', 'the periodic table ↗');
  src.href = TABLE + (wantBlock ? '?block=' + encodeURIComponent(wantBlock)
    : wantCategory ? '?category=' + encodeURIComponent(wantCategory) : '');
  src.target = '_blank'; src.rel = 'noopener noreferrer'; src.style.color = 'var(--beam)';
  strip.appendChild(src);
  await layers();
  paintAll();

  if (wantCategory && byCat.has(wantCategory)) {
    const syms = byCat.get(wantCategory).map(b => b.symbol);
    for (const s of syms) cells.get(s).node.classList.add('lit');
    cells.get(syms[0]).node.scrollIntoView({ inline: 'start', block: 'nearest' });
    queue(syms, CONCURRENCY);
  }
  if (wantBlock && cells.has(wantBlock)) {
    cells.get(wantBlock).node.scrollIntoView({ inline: 'center', block: 'nearest' });
    choose(wantBlock);
  }
})();
