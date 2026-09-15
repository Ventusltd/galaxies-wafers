/* Chemistry Ledger — the page. Grid Atlas loading grammar; arithmetic in ledger.mjs. */
import * as L from './ledger.mjs';

const STAR_MAKER_COMMIT = 'c5bf5f6518feba594bb057988e8e99ca81044952';
const RAW = `https://raw.githubusercontent.com/Ventusltd/star-maker/${STAR_MAKER_COMMIT}/`;
const URL_COMPOUNDS = RAW + 'chemistry/compounds.json';
const URL_GRAPH = RAW + 'chemistry/graph.json';
const URL_LEGEND = RAW + 'CHEMISTRY.md';
const PAGE = 40; // compounds shown per "more" tap
const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const fmt = n => Number(n).toLocaleString('en-GB');

/* ── one queue of 4, 15 s timeouts, one promise per URL ─────────────────── */
class FetchQueue {
  constructor(n) { this.n = n; this.active = 0; this.wait = []; this.peak = 0; }
  async add(task) {
    if (this.active >= this.n) await new Promise(r => this.wait.push(r));
    this.active++; this.peak = Math.max(this.peak, this.active);
    try { return await task(); } finally { this.active--; if (this.wait.length) this.wait.shift()(); }
  }
}
const queue = new FetchQueue(4);
const cache = new Map();
const fetchLog = [];
function fetchOnce(url, as) {
  if (cache.has(url)) return cache.get(url);
  const p = queue.add(async () => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15000);
    fetchLog.push(url);
    try {
      const res = await fetch(url, { signal: ctl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return as === 'json' ? await res.json() : await res.text();
    } catch (err) {
      throw new Error(err && err.name === 'AbortError' ? 'timed out after 15 s' : (err && err.message) || String(err));
    } finally { clearTimeout(timer); }
  });
  cache.set(url, p);
  p.catch(() => cache.delete(url));
  return p;
}

const RT = { ledger: { loaded: false, loading: false }, graph: { loaded: false, loading: false } };
const S = { compounds: null, elements: null, rules: null, mode: 'all', sel: null, cells: new Map(), graph: null, pos: null, edges: null, gsel: null, matches: 0 };
const LBL_LEDGER = 'Ledger · compounds.json + CHEMISTRY.md';
const LBL_GRAPH = 'Graph · graph.json edges';
function setLabel(id, base, state) { $(id).textContent = `${base} [${state}]`; }

/* ── ledger ─────────────────────────────────────────────────────────────── */
async function hydrateLedger() {
  if (RT.ledger.loaded || RT.ledger.loading) return;
  RT.ledger.loading = true;
  setLabel('lbl-ledger', LBL_LEDGER, 'LOAD');
  try {
    const [chem, md] = await Promise.all([fetchOnce(URL_COMPOUNDS, 'json'), fetchOnce(URL_LEGEND, 'text')]);
    if (!chem || !Array.isArray(chem.compounds)) throw new Error('compounds.json has no compounds[] array');
    S.compounds = chem.compounds; S.generated = chem.generated_utc; S.starsDeclared = chem.stars;
    S.elements = L.countElements(chem.compounds);
    S.rules = L.readRules(md);
    RT.ledger.loaded = true;
    if (S.elements.size === 0) {
      setLabel('lbl-ledger', LBL_LEDGER, 'EMPTY: no elements in any formula');
      $('grid').textContent = 'EMPTY — no formula carried an element.';
      return;
    }
    setLabel('lbl-ledger', LBL_LEDGER, `OK · ${fmt(S.compounds.length)} compounds · ${fmt(S.elements.size)} elements`);
    buildGrid(); renderSummary(); renderQuestions();
  } catch (err) {
    setLabel('lbl-ledger', LBL_LEDGER, `FAIL: ${err.message}`);
    $('summary').textContent = `FAIL — ${err.message}. Untick and tick again to retry.`;
  } finally { RT.ledger.loading = false; }
}

function buildGrid() {
  const grid = $('grid'); grid.textContent = '';
  const bySym = new Map();
  for (const e of S.elements.values()) { if (!bySym.has(e.symbol)) bySym.set(e.symbol, []); bySym.get(e.symbol).push(e); }
  const syms = [...bySym.keys()].sort((a, b) => bySym.get(b).length - bySym.get(a).length || (a < b ? -1 : 1));
  for (const sym of syms) {
    const list = bySym.get(sym).sort((a, b) => (a.stamp === b.stamp ? 0 : a.stamp === null ? -1 : b.stamp === null ? 1 : a.stamp < b.stamp ? -1 : 1));
    const row = el('div', 'row');
    row.append(el('h3', null, `${sym} · ${list.length} element${list.length === 1 ? '' : 's'}`));
    const cells = el('div', 'cells');
    for (const e of list) {
      const b = el('button', 'cell'); b.type = 'button'; b.dataset.label = e.label;
      b.append(el('b', null, e.stamp === null ? e.symbol : e.stamp), el('span', 'n', `${fmt(e.compounds)} · ${fmt(e.greenCompounds)}/${fmt(e.redCompounds)}`));
      b.setAttribute('aria-label', `${e.label}: ${e.compounds} compositions, ${e.greenCompounds} all green, ${e.redCompounds} with a red star`);
      cells.append(b); S.cells.set(e.label, b);
    }
    row.append(cells); grid.append(row);
  }
  applyMode();
}

function applyMode() {
  if (!S.elements) return;
  $('grid').classList.toggle('filter', S.mode !== 'all');
  const rule = S.mode === 'noble' ? S.rules.noble : S.mode === 'radioactive' ? S.rules.radioactive : null;
  const test = S.mode === 'noble' ? L.isNoble : L.isRadioactive;
  let n = 0;
  for (const [label, b] of S.cells) { const m = S.mode !== 'all' && test(S.elements.get(label), rule); b.classList.toggle('match', m); if (m) n++; }
  S.matches = n; renderRule();
}

function renderRule() {
  const p = $('rule');
  if (!S.rules) return;
  const r = S.rules;
  if (S.mode === 'all') {
    p.textContent = `Toggle to outline elements by CHEMISTRY.md's own rules: line ${r.noble ? r.noble.line : 'not found'} (noble) and line ${r.radioactive ? r.radioactive.line : 'not found'} (radioactive). Neither is a field in the JSON files.`;
    return;
  }
  const rule = S.mode === 'noble' ? r.noble : r.radioactive;
  if (!rule) { p.textContent = `EMPTY — CHEMISTRY.md has no "${S.mode}" heading this page can read, so no element is outlined.`; return; }
  p.textContent = `CHEMISTRY.md line ${rule.line}: "${rule.text}". Applied to counts from compounds.json (red compound = a compound with red > 0): ${fmt(S.matches)} of ${fmt(S.elements.size)} elements match, outlined dashed.`;
}

function renderSummary() {
  let stars = 0, red = 0, green = 0, amber = 0;
  for (const c of S.compounds) { stars += c.stars; red += c.red; green += c.green; amber += c.amber; }
  const vals = [...S.elements.values()];
  const noble = vals.filter(e => L.isNoble(e, S.rules.noble)).length;
  const rad = vals.filter(e => L.isRadioactive(e, S.rules.radioactive)).length;
  const s = $('summary'); s.textContent = '';
  s.append('Counted: ', el('b', null, fmt(S.compounds.length)), ' compounds over ', el('b', null, fmt(stars)), ` stars (file header says ${S.starsDeclared}) · `,
    el('b', null, fmt(green)), ' green, ', el('b', null, fmt(amber)), ' amber, ', el('b', null, fmt(red)), ' red stars · ',
    el('b', null, fmt(S.elements.size)), ' elements · ',
    el('b', null, S.rules.noble ? fmt(noble) : 'not yet known'), ' noble, ', el('b', null, S.rules.radioactive ? fmt(rad) : 'not yet known'), ' radioactive by the CHEMISTRY.md rules.');
}

function renderCard(label) {
  const e = S.elements.get(label); const card = $('card'); card.textContent = '';
  if (S.sel && S.cells.get(S.sel)) S.cells.get(S.sel).classList.remove('on');
  S.sel = label; if (S.cells.get(label)) S.cells.get(label).classList.add('on');
  card.append(el('h3', null, label));
  const dl = el('dl');
  const add = (k, v) => { dl.append(el('dt', null, k), el('dd', null, v)); };
  add('compositions', `${fmt(e.compounds)} (${Object.entries(e.kinds).map(([k, v]) => `${fmt(v)} ${k}`).join(', ')})`);
  add('with a red star', fmt(e.redCompounds));
  add('all green', fmt(e.greenCompounds));
  add('stars', `${fmt(e.stars)}: ${fmt(e.green)} green, ${fmt(e.amber)} amber, ${fmt(e.red)} red`);
  const nr = S.rules.noble, rr = S.rules.radioactive;
  add(`noble${nr ? ' (line ' + nr.line + ')' : ''}`, nr ? (L.isNoble(e, nr) ? 'yes' : 'no') : 'not yet known: rule not found');
  add(`radioactive${rr ? ' (line ' + rr.line + ')' : ''}`, rr ? (L.isRadioactive(e, rr) ? 'yes' : 'no') : 'not yet known: rule not found');
  card.append(dl);
  card.append(el('p', 'dim small', 'Failure messages, grouped (compounds[].decays[].text):'));
  const groups = [...e.decays.values()].sort((a, b) => b.compounds - a.compounds);
  if (!groups.length) card.append(el('p', null, 'EMPTY — no compound carrying this element recorded a decay.'));
  else {
    const t = el('table'); const hr = el('tr'); hr.append(el('td', 'k', 'comp.'), el('td', 'k', 'stars'), el('td', null, 'message')); t.append(hr);
    for (const g of groups) { const tr = el('tr'); tr.append(el('td', 'k', fmt(g.compounds)), el('td', 'k', fmt(g.stars)), el('td', null, g.text)); t.append(tr); }
    card.append(t);
  }
  card.append(el('p', 'dim small', `Compounds (${fmt(e.idx.length)}), in file order, ${PAGE} at a time:`));
  const ul = el('ul', 'rows'); card.append(ul);
  let shown = 0;
  const more = el('button', 'more'); more.type = 'button';
  const page = () => {
    const end = Math.min(e.idx.length, shown + PAGE);
    for (; shown < end; shown++) {
      const c = S.compounds[e.idx[shown]];
      ul.append(el('li', 'plain', `${c.formula} · ${c.kind} · ${c.stars} star${c.stars === 1 ? '' : 's'}: ${c.green} green, ${c.amber} amber, ${c.red} red`));
    }
    more.textContent = `show ${Math.min(PAGE, e.idx.length - shown)} more (${fmt(shown)} of ${fmt(e.idx.length)} shown)`;
    more.hidden = shown >= e.idx.length;
  };
  more.addEventListener('click', page); card.append(more); page();
}

function renderQuestions() {
  $('q-pin').textContent = STAR_MAKER_COMMIT.slice(0, 12);
  if (!S.compounds) return;
  const s = L.decayTotals(S.compounds, 'requires the sld-styles module');
  const g = L.decayTotals(S.compounds, 'requires the geodesy module');
  $('q-styles').textContent = `${fmt(s.compositions)} compositions (${fmt(s.stars)} stars)`;
  $('q-geo').textContent = `${fmt(g.compositions)} compositions (${fmt(g.stars)} stars)`;
  $('q-verify').textContent = s.compositions === 702 ? 'the files agree, 702' : `the files give ${fmt(s.compositions)}, not 702`;
  const r = S.rules;
  $('q-rules').textContent = `noble: ${r.noble ? 'line ' + r.noble.line + ' "' + r.noble.text + '"' : 'not found'}; radioactive: ${r.radioactive ? 'line ' + r.radioactive.line + ' "' + r.radioactive.text + '"' : 'not found'}`;
  const rad = [...S.elements.values()].filter(e => L.isRadioactive(e, r.radioactive)).map(e => e.label);
  $('q-rad').textContent = rad.length ? rad.join(', ') : 'none by the stated rule';
  $('machine').textContent = `Machine detail · inputs: compounds.json compounds[] {formula (elements joined by "·"), kind, stars, green, amber, red (star counts, dimensionless), decays[] {text, n = stars}} generated ${S.generated}; CHEMISTRY.md headings (noble: red compounds = 0 and compounds ≥ N; radioactive: red compounds ÷ compounds ≥ P). graph.json nodes[] {label, type}, edges[] {from, to, kind}. Outputs: per element compositions, compositions with red > 0, all-green compositions, star sums, decay texts grouped with composition and star counts; graph edges drawn only where both ends are nodes. Refusals: missing compounds[] or nodes[]/edges[] → FAIL; rule heading not found → EMPTY, no outline. Fetch: one queue of 4 (peak ${queue.peak}), 15 s timeout, ${fetchLog.length} requests so far. Source: Ventusltd/star-maker @ ${STAR_MAKER_COMMIT}.`;
}

/* ── graph ──────────────────────────────────────────────────────────────── */
async function hydrateGraph() {
  if (RT.graph.loaded) { drawGraph(); return; }
  if (RT.graph.loading) return;
  RT.graph.loading = true;
  setLabel('lbl-graph', LBL_GRAPH, 'LOAD');
  try {
    const g = await fetchOnce(URL_GRAPH, 'json');
    if (!g || !Array.isArray(g.nodes) || !Array.isArray(g.edges)) throw new Error('graph.json lacks nodes[] or edges[]');
    S.graph = g; S.pos = L.layout(g.nodes); S.edges = L.drawableEdges(g);
    RT.graph.loaded = true;
    setLabel('lbl-graph', LBL_GRAPH, S.edges.kept.length ? `OK · ${fmt(g.nodes.length)} nodes · ${fmt(S.edges.kept.length)} edges` : 'EMPTY: no edge has both ends among the nodes');
    const kinds = {}; for (const e of S.edges.kept) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
    let inGraph = 'not yet known (tick Ledger)';
    if (S.elements) { const labels = new Set(g.nodes.map(n => n.label)); inGraph = `${fmt([...S.elements.keys()].filter(k => !labels.has(k)).length)} of the ledger's ${fmt(S.elements.size)} elements are not graph nodes`; }
    $('graphcount').textContent = `${fmt(S.edges.kept.length)} of ${fmt(g.edges.length)} edges drawn (${Object.entries(kinds).map(([k, v]) => `${fmt(v)} ${k}`).join(', ')}); ${fmt(S.edges.dropped.length)} skipped for a missing end; ${inGraph}`;
    drawGraph();
    renderQuestions();
  } catch (err) {
    setLabel('lbl-graph', LBL_GRAPH, `FAIL: ${err.message}`);
  } finally { RT.graph.loading = false; }
}

const canvas = $('plane'); const ctx = canvas.getContext('2d');
function geom() {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  return { dpr, w, h, R: Math.max(10, Math.min(w, h) / 2 - 18), cx: w / 2, cy: h / 2 };
}
function drawGraph() {
  const { dpr, w, h, R, cx, cy } = geom();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, w, h);
  if (!$('open-graph').checked || !S.graph) { $('drawn').textContent = S.graph ? 'hidden — tick Graph' : 'WAIT — tick Graph'; return; }
  const P = l => { const p = S.pos.get(l); return [cx + p.x * R, cy + p.y * R]; };
  let drawn = 0;
  for (const e of S.edges.kept) {
    const hot = S.gsel && (e.from === S.gsel || e.to === S.gsel);
    if (S.gsel && !hot) continue;
    const [x1, y1] = P(e.from), [x2, y2] = P(e.to);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    if (e.kind === 'DECAYS_TO') { ctx.setLineDash([3, 3]); ctx.strokeStyle = hot ? 'rgba(239,233,220,.9)' : 'rgba(239,233,220,.10)'; }
    else { ctx.setLineDash([]); ctx.strokeStyle = hot ? 'rgba(94,200,242,.9)' : 'rgba(94,200,242,.07)'; }
    ctx.lineWidth = hot ? 1.2 : 1; ctx.stroke(); drawn++;
  }
  ctx.setLineDash([]);
  for (const [label, p] of S.pos) {
    const x = cx + p.x * R, y = cy + p.y * R, on = label === S.gsel, isEl = p.n.type === 'element';
    ctx.beginPath(); ctx.arc(x, y, (on ? 4 : isEl ? 2 : 3.2) + 1.5, 0, Math.PI * 2); ctx.fillStyle = '#000'; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, on ? 4 : isEl ? 2 : 3.2, 0, Math.PI * 2); ctx.fillStyle = isEl ? '#ffd54a' : '#ffffff'; ctx.fill();
  }
  if (S.gsel) { ctx.font = '11px ui-monospace,monospace'; ctx.fillStyle = '#fff'; ctx.fillText(S.gsel.slice(0, 52), 8, 16); }
  $('drawn').textContent = `${fmt(drawn)} lines · ${fmt(S.pos.size)} nodes${S.gsel ? ' · tap empty space to clear' : ' · tap a node'}`;
}
canvas.addEventListener('click', ev => {
  if (!S.graph || !$('open-graph').checked) return;
  const r = canvas.getBoundingClientRect(); const { R, cx, cy } = geom();
  const mx = ev.clientX - r.left, my = ev.clientY - r.top;
  let best = null, bd = 22 * 22;
  for (const [label, p] of S.pos) { const dx = cx + p.x * R - mx, dy = cy + p.y * R - my, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = label; } }
  S.gsel = best; drawGraph();
  if (best && S.elements && S.elements.has(best)) renderCard(best);
});
window.addEventListener('resize', () => { if (S.graph) drawGraph(); });

/* ── wiring ─────────────────────────────────────────────────────────────── */
$('open-ledger').addEventListener('change', ev => { if (ev.target.checked) hydrateLedger(); });
$('open-graph').addEventListener('change', () => { if ($('open-graph').checked) hydrateGraph(); else drawGraph(); });
$('mode').addEventListener('click', ev => {
  const b = ev.target.closest('button'); if (!b) return;
  S.mode = b.dataset.m;
  for (const x of $('mode').querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
  if (!S.elements) { $('rule').textContent = 'WAIT — tick Ledger first; the rules and counts come from the files.'; return; }
  applyMode();
});
$('grid').addEventListener('click', ev => { const b = ev.target.closest('.cell'); if (b) renderCard(b.dataset.label); });
renderQuestions();
drawGraph();
window.__ledger = { RT, S, queue, fetchLog };
