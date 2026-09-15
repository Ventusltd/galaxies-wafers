/* grid.mjs — Which Element Meets Which Grid Question.
 * A lens over the elements catalogue. Grid Atlas loading grammar: every question row
 * exists from the start, nothing is fetched until a reader opens one; one queue of 4,
 * a 15 s AbortController timeout per fetch, one shared promise per URL (a failure leaves
 * the cache so a retry is possible); each question fills itself once and only its own
 * status span changes. No physics is computed here. */
const CAT_COMMIT = 'f7a92fb085c38dcbbd5cb469a66cd5ca61fb95bf';   /* Ventusltd/elements main when this page was built */
const CAT = `https://raw.githubusercontent.com/Ventusltd/elements/${CAT_COMMIT}/catalogue/`;
const ENGINE_COMMIT = 'd9cd18b0e2034325814924e6e4a0e958014f2748';
const CONCURRENCY = 4, FETCH_MS = 15000;
const LABEL = 'matched by words in the element’s own title or description — not a claim the element answers it';

/* The fixed list. galaxy = the iteration that demonstrates the question; modules are the
   engine modules that iteration imports (read from its source when this page was built). */
export const QUESTIONS = [
  { id: 'nearest', q: 'Where is the nearest mapped substation to a point?', terms: ['substation', 'substations', 'nearest'],
    galaxy: [{ dir: '28-nearest-search-trap', name: 'The Nearest-Search Trap', modules: ['v9-nearest-search.js', 'v9-geodesy.js'] }] },
  { id: 'route', q: 'How long is the cable route between two points?', terms: ['route', 'routes', 'distance', 'length', 'haversine'],
    galaxy: [{ dir: '27-earth-radii-and-argument-order', name: 'Earth radii and argument order', modules: ['geo-core.js', 'corridor-estimate.js'] }] },
  { id: 'current', q: 'What current flows at this power and voltage?', terms: ['current', 'amps', 'ampacity', 'power factor'],
    galaxy: [{ dir: '25-one-feeder', name: 'One Feeder', modules: ['current-from-power.js', 'power-factor.js'] }] },
  { id: 'vdrop', q: 'How much voltage is lost along a cable?', terms: ['voltage drop', 'volt drop', 'voltage'],
    galaxy: [{ dir: '25-one-feeder', name: 'One Feeder', modules: ['voltage-drop.js'] }] },
  { id: 'ratings', q: 'Which circuits and ratings exist at a site?', terms: ['rating', 'ratings', 'circuit', 'circuits'],
    galaxy: [{ dir: '29-rating-envelope', name: 'Ratings That Do Not Add', modules: ['rating-envelope.js', 'network-topology.js'] }] },
  { id: 'meanings', q: 'Which kilowatt is meant: connected load, peak demand or energy?', terms: ['electrification', 'kilowatt', 'kw'],
    galaxy: [{ dir: '24-electrification-model', name: 'Seven Meanings', modules: ['electrification-model.js'] }] },
  { id: 'diversity', q: 'What demand arrives after diversity?', terms: ['diversity', 'diversified', 'demand'],
    galaxy: [{ dir: '13-diversified-demand', name: 'Demand lab', modules: ['diversified-demand.js'] }] },
  { id: 'firm', q: 'What capacity remains when the largest unit is out?', terms: ['firm', 'largest unit', 'n-1', 'capacity'],
    galaxy: [{ dir: '16-firm-capacity', name: 'Firm arithmetic', modules: ['firm-capacity.js'] }] },
  { id: 'ic', q: 'What does an interconnector earn gross from a price spread?', terms: ['interconnector', 'interconnectors', 'price spread', 'spread'],
    galaxy: [{ dir: '15-price-spread', name: 'Spread lab', modules: ['interconnector-economics.js'] }] },
  { id: 'system', q: 'How does one system connect, stop by stop, from site to network?', terms: ['topology', 'network', 'connection'],
    galaxy: [{ dir: '35-system-journey', name: 'One System, Stop by Stop', modules: ['network-topology.js', 'rating-envelope.js', 'voltage-drop.js'] }] },
];

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

/* ── bounded queue + url cache ── */
let active = 0; const waiting = [];
function enqueue(job) { return new Promise((res, rej) => { waiting.push({ job, res, rej }); pump(); }); }
function pump() {
  while (active < CONCURRENCY && waiting.length) {
    const { job, res, rej } = waiting.shift(); active++;
    job().then(res, rej).finally(() => { active--; pump(); });
  }
}
const cache = new Map();
let fetchCount = 0;
function getJSON(url) {
  if (cache.has(url)) return cache.get(url);
  const p = enqueue(async () => {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), FETCH_MS);
    fetchCount++;
    try {
      const r = await fetch(url, { signal: ac.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      return await r.json();
    } catch (e) { throw new Error(e.name === 'AbortError' ? `timed out after ${FETCH_MS / 1000} s: ${url}` : e.message); }
    finally { clearTimeout(t); }
  });
  cache.set(url, p);
  p.catch(() => cache.delete(url));
  return p;
}

let CATALOGUE = null;
async function catalogue() {
  if (CATALOGUE) return CATALOGUE;
  $('catstate').textContent = 'LOAD · elements.json and functions.json';
  const [elements, functions] = await Promise.all([getJSON(CAT + 'elements.json'), getJSON(CAT + 'functions.json')]);
  const fn = new Map(functions.map(f => [f.key, f]));
  CATALOGUE = { elements, fn };
  $('catstate').textContent = `OK · ${elements.length.toLocaleString('en-GB')} elements, ${functions.length.toLocaleString('en-GB')} functions at commit ${CAT_COMMIT.slice(0, 7)}`;
  return CATALOGUE;
}

/* whole-word, case-insensitive; returns the distinct terms found */
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = terms => new RegExp(`(^|[^a-z0-9])(${terms.slice().sort((a, b) => b.length - a.length).map(esc).join('|')})(?=[^a-z0-9]|$)`, 'gi');
export function matchElement(e, terms) {
  const found = new Set();
  for (const text of [e.title || '', e.description || '']) {
    const re = wordRe(terms); let m;
    while ((m = re.exec(text))) { found.add(m[2].toLowerCase()); re.lastIndex = m.index + m[0].length; }
  }
  return [...found];
}
function highlighted(text, terms) {
  const frag = document.createDocumentFragment(), re = wordRe(terms);
  let last = 0, m;
  while ((m = re.exec(text))) {
    const start = m.index + m[1].length;
    frag.append(text.slice(last, start), el('mark', null, m[2]));
    last = start + m[2].length; re.lastIndex = last;
  }
  frag.append(text.slice(last));
  return frag;
}

function assemblyButton(e) {
  const a = el('a', 'btn', 'ASSEMBLY');
  a.href = `../36-elements-assembly/?key=${encodeURIComponent(e.key)}`;
  a.title = `open ${e.key} in the Assembly page (it accepts ?key=block:<symbol>)`;
  return a;
}
function appButton(e) {
  const live = e.live || [];
  const page = live.find(u => /\.html?$|\/$/.test(u));
  const href = page || live[0];
  if (!href) return el('span', 'why', `APP: ${e.key} records no live address in the catalogue, so there is no surface to open.`);
  const a = el('a', 'btn', 'APP'); a.href = href; a.target = '_blank'; a.rel = 'noopener';
  a.title = page ? `the live address the catalogue records for ${e.key}` : `the first live file the catalogue records for ${e.key} (${href})`;
  return a;
}

const counts = new Map();
function renderCounts() {
  const parts = QUESTIONS.filter(q => counts.has(q.id)).map(q => `${q.id} ${counts.get(q.id)}`);
  $('counts').textContent = parts.length ? `Match counts (counted in this browser): ${parts.join(' · ')}` : 'Match counts: not yet counted (open a question).';
}

const rows = new Map();
async function openQuestion(q) {
  const row = rows.get(q.id);
  if (row.state === 'loaded' || row.state === 'loading') return;
  row.state = 'loading'; row.st.textContent = 'LOAD · fetching the catalogue';
  try {
    const { elements, fn } = await catalogue();
    const hits = [];
    for (const e of elements) { const f = matchElement(e, q.terms); if (f.length) hits.push({ e, f }); }
    counts.set(q.id, hits.length); renderCounts();
    row.st.textContent = hits.length ? `OK · ${hits.length} of ${elements.length} elements matched` : `EMPTY · no element's own title or description contains any of these words`;
    const box = row.hits; box.replaceChildren();
    if (hits.length) box.append(el('p', 'label', LABEL));
    for (const { e, f } of hits) {
      const card = el('div', 'el');
      const h = el('h3'); h.append(highlighted(e.title || '', q.terms)); card.append(h);
      card.append(el('div', 'k', `${e.key} · ${e.kind} · ${e.category_title || e.category} · state ${e.state} · words matched: ${f.join(', ')}`));
      const d = el('p'); d.append(highlighted(e.description || '', q.terms)); card.append(d);
      const names = (e.function_keys || []).map(k => (fn.get(k) && fn.get(k).name) || `${k} (not in functions.json)`);
      if (names.length) card.append(el('div', 'k', `functions inside: ${names.slice(0, 8).join(', ')}${names.length > 8 ? ` and ${names.length - 8} more` : ''}`));
      const b = el('div', 'btns'); b.append(assemblyButton(e), appButton(e)); card.append(b);
      box.append(card);
    }
    row.state = 'loaded';
  } catch (err) {
    row.state = 'failed';
    row.st.textContent = `FAIL · ${err.message} · close and reopen to retry`;
    $('catstate').textContent = `FAIL · ${err.message}`;
  }
}

/* build the fixed rows once */
const list = $('list');
for (const q of QUESTIONS) {
  const d = el('details'); d.id = 'q-' + q.id;
  const s = el('summary'); s.append(el('b', null, q.q));
  const st = el('span', 'st', 'WAIT · opens on tap'); s.append(st); d.append(s);
  const body = el('div', 'body');
  const terms = el('p', 'terms'); terms.append('Search terms (whole word, any case): '); for (const t of q.terms) terms.append(el('span', null, t)); body.append(terms);
  for (const g of q.galaxy) {
    const p = el('p', 'galaxy'); p.append('Demonstrated with a real engine module in ');
    const a = el('a', 'btn', `${g.dir.slice(0, 2)} ${g.name}`); a.href = `../${g.dir}/`; p.append(a);
    p.append(el('span', 'why', ` imports ${g.modules.join(', ')} from ventus-grid-engine@${ENGINE_COMMIT.slice(0, 7)}`));
    body.append(p);
  }
  const hits = el('div'); body.append(hits); d.append(body);
  rows.set(q.id, { st, hits, state: 'idle' });
  d.addEventListener('toggle', () => { if (d.open) openQuestion(q); else if (rows.get(q.id).state === 'failed') rows.get(q.id).state = 'idle'; });
  list.append(d);
}
for (const c of document.querySelectorAll('.cc')) c.textContent = CAT_COMMIT.slice(0, 7);
if (window.matchMedia('(min-width:760px)').matches) { $('questions').open = true; $('machine').open = true; }
window.__grid = { QUESTIONS, counts, rows, get fetchCount() { return fetchCount; }, openQuestion };
