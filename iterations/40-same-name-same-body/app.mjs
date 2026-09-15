/* Same Name, Same Body? — the page.
 *
 * Loading in Grid Atlas grammar (WAIT, LOAD, OK, EMPTY, FAIL; one queue of at
 * most 3 fetches, 15 s timeout, one promise per URL, retry by ticking again).
 * The comparison of every family runs in worker.js. The wafer is the dark
 * ground of iteration 21 (one GPU draw of every numbered line, near-black) with
 * the selected name's bodies lit on a 2D canvas above it, culled to the view.
 */
import { place, esc, fmt, SPACING } from '../../lib.mjs';

const DATA = 'https://globalgrid2050.com/testcode/202609142202/data/';
const STARS_F = 'https://ventusltd.github.io/stars/code/f/';
const PAGE = 10;              /* ranked rows per page */
const PALETTE = ['#5ec8f2', '#ffd54a', '#ff7ad9', '#b39dff', '#ff9f43', '#7fe3c4', '#f4f4f4', '#6b8cff', '#e3b27f', '#c7e36b', '#ff6b8b', '#9ad0ff'];
const GREY = '#59606f';

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const plural = (n, w) => `${fmt(n)} ${n === 1 ? w : w + 's'}`;
const pct = x => (100 * x).toFixed(1) + '%';

/* ── loading, as Grid Atlas does it ─────────────────────────────────────── */
class FetchQueue {
  constructor(c) { this.c = c; this.active = 0; this.q = []; this.peak = 0; }
  async add(task) {
    if (this.active >= this.c) await new Promise(r => this.q.push(r));
    this.active++; this.peak = Math.max(this.peak, this.active);
    try { return await task(); } finally { this.active--; if (this.q.length) this.q.shift()(); }
  }
}
const queue = new FetchQueue(3);
const urlCache = new Map();
const fetchLog = [];
function fetchOnce(url, as) {
  if (urlCache.has(url)) return urlCache.get(url);
  const p = queue.add(async () => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15000);
    fetchLog.push(url);
    try {
      const res = await fetch(url, { signal: ctl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.split('/').pop()}`);
      return as === 'bin' ? await res.arrayBuffer() : as === 'text' ? await res.text() : await res.json();
    } catch (err) {
      throw new Error(err && err.name === 'AbortError' ? 'timed out after 15 s' : (err && err.message) || String(err));
    } finally { clearTimeout(timer); }
  }).catch(err => { urlCache.delete(url); throw err; });
  urlCache.set(url, p);
  return p;
}

const RT = { compute: { loaded: false, loading: null, visible: false }, ground: { loaded: false, loading: null, visible: false } };
function updateUIState(id, state, detail) {
  const span = $('lbl-' + id);
  span.textContent = `${span.getAttribute('data-base-label')} [${detail ? state + ' · ' + detail : state}]`;
}
function progress(frac, text) {
  $('bar').style.width = Math.max(0, Math.min(1, frac)) * 100 + '%';
  if (text != null) $('phase').textContent = text;
}

const D = { r: null, lines: null, maxKey: 0, prov: null, ground: null, timing: null, nameIndex: null };
window.__same = { D, RT, fetchLog, queue, get sel() { return S; }, frames: [] };

function hydrate(id) {
  const rt = RT[id];
  if (rt.loaded) return Promise.resolve(true);
  if (rt.loading) return rt.loading;
  updateUIState(id, 'LOAD');
  rt.loading = (async () => {
    try {
      if (id === 'compute') await loadCompute();
      else await loadGround();
      rt.loaded = true; rt.loading = null;
      schedule();
      return true;
    } catch (err) {
      rt.loading = null; rt.visible = false;
      document.querySelector(`input[data-layer="${id}"]`).checked = false;
      updateUIState(id, 'FAIL', err.message + ' · tick again to retry');
      if (id === 'compute') progress(0, `FAIL — ${err.message}. Nothing is counted in its place.`);
      schedule();
      return false;
    }
  })();
  return rt.loading;
}

async function loadCompute() {
  const tWall = performance.now();
  progress(0.02, 'LOAD — fetching families.json and lines.bin through the queue…');
  const provP = fetchOnce(DATA + 'provenance.json', 'json').catch(e => ({ error: e.message }));
  const [text, buf] = await Promise.all([fetchOnce(DATA + 'families.json', 'text'), fetchOnce(DATA + 'lines.bin', 'bin')]);
  const tFetched = performance.now();
  if (buf.byteLength % 4) throw new Error('lines.bin is not a whole number of 32-bit keys');
  D.lines = new Uint32Array(buf);
  let mx = 0; for (let i = 0; i < D.lines.length; i++) if (D.lines[i] > mx) mx = D.lines[i];
  D.maxKey = mx;
  const r = await new Promise((resolve, reject) => {
    const w = new Worker(new URL('./worker.js', import.meta.url));
    const tPost = performance.now();
    w.onmessage = e => {
      const m = e.data;
      if (m.type === 'progress') {
        updateUIState('compute', 'LOAD', `${m.phase} ${m.total > 1 ? Math.round(100 * m.done / m.total) + '%' : ''}`.trim());
        progress(0.1 + 0.85 * (m.total ? m.done / m.total : 0), `COMPUTE — ${m.phase}${m.total > 1 ? ': ' + fmt(m.done) + ' of ' + fmt(m.total) + ' families' : ''}`);
      } else if (m.type === 'error') { w.terminate(); reject(new Error(m.message)); }
      else { m.wallWorker = performance.now() - tPost; w.terminate(); resolve(m); }
    };
    w.onerror = e => { w.terminate(); reject(new Error('the worker failed: ' + (e.message || 'no message'))); };
    /* the page keeps its own copy of the keys for drawing; the worker gets the transfer */
    w.postMessage({ text, buffer: buf.slice(0) });
  });
  D.r = r;
  D.timing = { fetch: tFetched - tWall, worker: r.ms.total, workerWall: r.wallWorker, total: performance.now() - tWall };
  D.nameIndex = new Map(); D.nameLower = new Map();
  r.names.forEach((s, g) => { if (s !== null) { D.nameIndex.set(s, g); const l = s.toLowerCase(); if (!D.nameLower.has(l)) D.nameLower.set(l, g); } });
  D.prov = await provP;
  progress(1, `OK — ${fmt(r.F)} families compared in a worker in ${Math.round(r.ms.total)} ms (fetch ${Math.round(D.timing.fetch)} ms, whole run ${Math.round(D.timing.total)} ms).`);
  updateUIState('compute', r.F ? 'OK' : 'EMPTY', r.F ? `${fmt(r.F)} families · ${fmt(r.B)} distinct bodies · ${fmt(r.N)} names` : 'no families');
  paintCases(); paintFinding(); paintRanks(); paintQuestions(); paintMachine(); fitWafer();
}

async function loadGround() {
  const buf = await fetchOnce(DATA + 'all-lines.bin', 'bin');
  const keys = new Uint32Array(buf);
  if (!keys.length) { updateUIState('ground', 'EMPTY', 'all-lines.bin holds no keys'); return; }
  const pos = new Float32Array(keys.length * 2);
  let mx = 0;
  for (let i = 0; i < keys.length; i++) { const [x, y] = place(keys[i]); pos[2 * i] = x; pos[2 * i + 1] = y; if (keys[i] > mx) mx = keys[i]; }
  D.ground = { keys, pos, n: keys.length, max: mx };
  initGround();
  updateUIState('ground', 'OK', `${fmt(keys.length)} numbered lines, drawn dark${glMode ? ' on the GPU' : ' without the GPU, one in seven at low zoom'}`);
  if (!D.r) fitWafer();
}

document.querySelectorAll('input[data-layer]').forEach(box => {
  box.checked = false;
  box.addEventListener('change', () => {
    const id = box.dataset.layer;
    RT[id].visible = box.checked;
    if (box.checked) hydrate(id);
    schedule();
  });
});

/* ── the four cases and the finding ─────────────────────────────────────── */
function paintCases() {
  const r = D.r, total = r.F;
  const max = Math.max(1, ...r.counts);
  r.counts.forEach((c, i) => {
    $('cv' + i).textContent = `${fmt(c)} · ${pct(c / total)}`;
    $('cf' + i).style.width = (100 * c / max) + '%';
  });
  const shared = r.finding.sharedBodies;
  $('bodyline').innerHTML = shared
    ? `<b>${fmt(shared)}</b> bodies are carried by more than one family: ${fmt(r.counts[0])} families are true copies under one name and ${fmt(r.counts[1])} are renamed copies. ${fmt(r.B)} distinct bodies across ${fmt(r.F)} families.`
    : `<b>No two families carry the same body.</b> ${fmt(r.F)} families hold ${fmt(r.B)} distinct key sequences: the pack is already one family per body. ${fmt(r.stats.buckets)} hash buckets, ${fmt(r.stats.compares)} exact comparisons needed, ${fmt(r.stats.collisions)} hash collisions. So a copy is not a second family here: it is the same family found in several files, which the pack records per family as <code>files</code> and <code>repos</code>. The ranking of copies below reads that field and says so.`;
}

function paintFinding() {
  const r = D.r, f = r.finding, nm = g => g >= 0 ? `<code>${esc(r.names[g])}</code>` : 'none';
  const famOf = g => r.nameStart[g + 1] - r.nameStart[g];
  const parts = [];
  parts.push(`Most distinct bodies under one name: ${nm(f.mostBodies)}, ${fmt(r.nameBodies[f.mostBodies])} bodies across ${fmt(r.nameFiles[f.mostBodies])} files; its most copied body sits in ${plural(r.nameMaxFiles[f.mostBodies], 'file')}.`);
  parts.push(`Most copied single body: ${nm(f.mostCopied)}, one body in ${fmt(r.nameMaxFiles[f.mostCopied])} files, and that name has only ${fmt(r.nameBodies[f.mostCopied])} ${r.nameBodies[f.mostCopied] === 1 ? 'body' : 'bodies'} in all (${fmt(r.nameFiles[f.mostCopied])} files).`);
  if (f.densest >= 0) parts.push(`Most files per body among names with more than one body: ${nm(f.densest)}, ${fmt(r.nameBodies[f.densest])} bodies over ${fmt(r.nameFiles[f.densest])} files.`);
  parts.push(`Of the top ${f.top} names ranked by how many families carry them, <b>${fmt(f.overlap)}</b> are also in the top ${f.top} ranked by their most copied body.`);
  if (f.rho !== null) parts.push(`Across the ${fmt(f.multiNames)} named groups with more than one family, the rank correlation between distinct bodies and largest copy count is ${f.rho.toFixed(2)} (1 would mean the two rankings agree; 0, no relation).`);
  parts.push(f.famEqBodies
    ? `In this pack families per name equals distinct bodies per name for every name, so "name count" and "bodies behind a name" are the same number: counting a name counts different code, not copies.`
    : `Families per name and distinct bodies per name differ for some names, so a name count mixes copies with different code.`);
  const verdict = f.overlap < f.top / 2
    ? `Measured: ranking names by count mostly finds names that hide different code, not the most copied code. The note's direction holds; whether its exact figures hold is for the reader to compare with the names above.`
    : `Measured: ranking by name count and ranking by copies largely agree here, which does not support the note.`;
  $('finding').innerHTML = parts.join(' ') + ' ' + verdict;
}

/* ── ranked lists: rows created once, re-filled per page ────────────────── */
const R = { tab: 'copied', page: 0 };
const rowEls = [];
for (let i = 0; i < PAGE; i++) {
  const li = el('li'); li.hidden = true;
  const b = el('button'); b.type = 'button';
  const rank = el('span', 'r'), t = el('span', 't'), s = el('span', 's');
  b.append(rank, t, s); li.append(b); $('rows').append(li);
  rowEls.push({ li, b, rank, t, s });
  b.addEventListener('click', () => {
    const v = b.dataset;
    if (v.body) { selectName(D.r.nameOf[D.r.rep[+v.body]], +v.body); $('plane').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    else if (v.name) { selectName(+v.name, -1); $('plane').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  });
}
$('tabs').addEventListener('click', e => {
  const b = e.target.closest('button[data-t]'); if (!b) return;
  R.tab = b.dataset.t; R.page = 0;
  $('tabs').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  paintRanks();
});
$('prev').addEventListener('click', () => { if (R.page > 0) { R.page--; paintRanks(); } });
$('next').addEventListener('click', () => { const n = listNow().length; if ((R.page + 1) * PAGE < n) { R.page++; paintRanks(); } });
const listNow = () => !D.r ? [] : R.tab === 'copied' ? D.r.topBodies : D.r.topNames;

function paintRanks() {
  const r = D.r;
  if (!r) return;
  const list = listNow(), pages = Math.max(1, Math.ceil(list.length / PAGE));
  $('topn').textContent = String(r.finding.top);
  $('rankhow').textContent = R.tab === 'copied'
    ? (r.finding.sharedBodies
      ? `Bodies ranked by the number of families that share the identical key sequence, ties broken by files.`
      : `Bodies ranked by the number of families sharing one body, then by files. Every body here is shared by exactly one family, so the order comes from the tie-break: the pack's files field, the number of files carrying that exact family. That field is read from the pack, not recounted from lines.`)
    : `Names ranked by distinct bodies behind them (each an identical-sequence group), ties broken by files. "(anonymous)" is not ranked: it is a placeholder for ${fmt(r.anonNames.reduce((s, g) => s + r.nameStart[g + 1] - r.nameStart[g], 0))} families with no name.`;
  for (let i = 0; i < PAGE; i++) {
    const row = rowEls[i], idx = R.page * PAGE + i;
    if (idx >= list.length) { row.li.hidden = true; continue; }
    row.li.hidden = false;
    row.rank.textContent = String(idx + 1);
    delete row.b.dataset.body; delete row.b.dataset.name;
    if (R.tab === 'copied') {
      const b = list[idx], f = r.rep[b];
      row.b.dataset.body = String(b);
      row.t.textContent = `${r.names[r.nameOf[f]] ?? '(no name)'} · family #${fmt(r.n[f])}`;
      row.s.textContent = `${fmt(r.bodyFamilies[b])} ${r.bodyFamilies[b] === 1 ? 'family' : 'families'} · ${plural(r.bodyNames[b], 'name')} · ${plural(r.bodyFiles[b], 'file')} · ${plural(r.cnt[f], 'line')} · block ${r.blocks[r.block[f]] ?? 'none recorded'}`;
    } else {
      const g = list[idx];
      row.b.dataset.name = String(g);
      row.t.textContent = r.names[g];
      row.s.textContent = `${fmt(r.nameBodies[g])} distinct bodies · ${fmt(r.nameStart[g + 1] - r.nameStart[g])} families · ${fmt(r.nameFiles[g])} files · most copied body in ${fmt(r.nameMaxFiles[g])}`;
    }
  }
  $('page').textContent = `page ${R.page + 1} of ${pages}`;
}

/* ── selection: a name group, its bodies in palette colours ─────────────── */
const S = { name: -1, bodies: [], lpage: 0, body: -1, pts: null, bbox: null, shared: 0, pair: null };

$('pick').addEventListener('submit', e => {
  e.preventDefault();
  document.activeElement?.blur();
  const raw = $('name').value.trim();
  if (!D.r) { cardText('WAIT', 'Tick Compare every family first; the name groups are counted from the database.'); return; }
  let g = D.nameIndex.get(raw);
  if (g === undefined) g = D.nameLower.get(raw.toLowerCase());
  if (g === undefined) { cardText('EMPTY', `No family in this pack is named "${raw}". Names are matched exactly, ignoring case only when no exact match exists.`); return; }
  selectName(g, -1);
});

function cardText(head, text) {
  const c = $('card'); c.replaceChildren();
  c.append(el('h3', null, head), el('p', 'dim', text));
}

function selectName(g, body) {
  const r = D.r;
  S.name = g; S.lpage = 0;
  const seen = new Set(); S.bodies = [];
  const fams = Array.from(r.nameList.subarray(r.nameStart[g], r.nameStart[g + 1])).sort((a, b) => r.n[a] - r.n[b]);
  for (const f of fams) { const b = r.bodyOf[f]; if (!seen.has(b)) { seen.add(b); S.bodies.push(b); } }
  /* where each body's keys sit; keys shared by two or more bodies of this name */
  const count = new Map();
  S.pts = S.bodies.map(b => {
    const f = r.rep[b], o = r.off[f], c = r.cnt[f];
    const p = new Float32Array(c * 2);
    const uniq = new Set();
    for (let i = 0; i < c; i++) { const [x, y] = place(D.lines[o + i]); p[2 * i] = x; p[2 * i + 1] = y; uniq.add(D.lines[o + i]); }
    for (const k of uniq) count.set(k, (count.get(k) || 0) + 1);
    return p;
  });
  S.shared = 0; for (const v of count.values()) if (v > 1) S.shared++;
  S.distinctKeys = count.size;
  /* the closest pair of bodies by shared keys (Jaccard), bounded to the first 60 bodies */
  S.pair = null;
  const sets = S.bodies.slice(0, 60).map(b => { const f = r.rep[b]; return new Set(D.lines.subarray(r.off[f], r.off[f] + r.cnt[f])); });
  for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) {
    let inter = 0; const [a, bb] = sets[i].size < sets[j].size ? [sets[i], sets[j]] : [sets[j], sets[i]];
    for (const k of a) if (bb.has(k)) inter++;
    const jac = inter / (sets[i].size + sets[j].size - inter || 1);
    if (!S.pair || jac > S.pair.jac) S.pair = { i, j, jac, inter };
  }
  const idx = body >= 0 ? S.bodies.indexOf(body) : -1;
  if (idx >= 0) S.lpage = Math.floor(idx / PALETTE.length);
  $('name').value = r.names[g] ?? '';
  fitGroup();
  paintLegend();
  if (idx >= 0) selectBody(body); else paintGroupCard();
  paintQuestions(); paintMachine();
}

function colourOf(i) {
  const p = Math.floor(i / PALETTE.length);
  return p === S.lpage ? PALETTE[i % PALETTE.length] : GREY;
}

const legendUl = el('ul');
const legendBtns = [];
for (let i = 0; i < PALETTE.length; i++) {
  const li = el('li'); const b = el('button'); b.type = 'button';
  const dot = el('span', 'dot'); dot.style.background = PALETTE[i];
  const t = el('span'); b.append(dot, t); li.append(b); legendUl.append(li);
  legendBtns.push({ li, b, t });
  b.addEventListener('click', () => { const k = S.lpage * PALETTE.length + i; if (k < S.bodies.length) selectBody(S.bodies[k]); });
}
$('lprev').addEventListener('click', () => { if (S.lpage > 0) { S.lpage--; paintLegend(); schedule(); } });
$('lnext').addEventListener('click', () => { if ((S.lpage + 1) * PALETTE.length < S.bodies.length) { S.lpage++; paintLegend(); schedule(); } });

function paintLegend() {
  const r = D.r, L = $('legend');
  if (!L.contains(legendUl)) { L.replaceChildren(el('p', 'dim small'), legendUl); }
  const head = L.firstChild, pages = Math.ceil(S.bodies.length / PALETTE.length);
  head.textContent = `${r.names[S.name]}: ${fmt(S.bodies.length)} distinct ${S.bodies.length === 1 ? 'body' : 'bodies'} under this name` +
    (pages > 1 ? `; coloured bodies ${fmt(S.lpage * PALETTE.length + 1)}–${fmt(Math.min(S.bodies.length, (S.lpage + 1) * PALETTE.length))}, the rest grey.` : '.');
  for (let i = 0; i < PALETTE.length; i++) {
    const k = S.lpage * PALETTE.length + i, row = legendBtns[i];
    if (k >= S.bodies.length) { row.li.hidden = true; continue; }
    row.li.hidden = false;
    const b = S.bodies[k], f = r.rep[b];
    row.t.textContent = `body ${k + 1} · #${fmt(r.n[f])} · ${plural(r.cnt[f], 'line')} · ${plural(r.bodyFiles[b], 'file')}`;
    row.b.classList.toggle('on', b === S.body);
  }
  $('legendpager').hidden = pages <= 1;
  $('lpage').textContent = `page ${S.lpage + 1} of ${pages}`;
}

function paintGroupCard() {
  const r = D.r, g = S.name, c = $('card');
  S.body = -1;
  c.replaceChildren();
  const cases = [0, 1, 2, 3, 4].map(i => r.nameCase[g * 5 + i]);
  const labels = ['true copies', 'renamed copies', 'same name, different bodies', 'unique', 'no name recorded'];
  c.append(el('h3', null, r.names[g]));
  const dl = el('dl');
  const add = (k, v) => dl.append(el('dt', null, k), el('dd', null, v));
  add('families', fmt(r.nameStart[g + 1] - r.nameStart[g]));
  add('distinct bodies', fmt(S.bodies.length));
  add('files, summed', fmt(r.nameFiles[g]));
  add('cases', cases.map((v, i) => v ? `${labels[i]} ${fmt(v)}` : null).filter(Boolean).join(' · '));
  add('line keys', `${fmt(S.distinctKeys)} distinct, ${fmt(S.shared)} of them in two or more of these bodies`);
  if (S.pair) add('closest pair', `bodies ${S.pair.i + 1} and ${S.pair.j + 1} share ${fmt(S.pair.inter)} line keys (overlap ${(S.pair.jac * 100).toFixed(0)}% of their union)${S.bodies.length > 60 ? ', searched among the first 60 bodies' : ''}`);
  c.append(dl, el('p', 'dim small', 'Tap a body in the legend or a lit line to read one body.'));
}

function selectBody(b) {
  const r = D.r, f = r.rep[b], c = $('card');
  S.body = b;
  const k = S.bodies.indexOf(b);
  if (k >= 0 && Math.floor(k / PALETTE.length) !== S.lpage) S.lpage = Math.floor(k / PALETTE.length);
  paintLegend(); schedule();
  const fams = Array.from(r.bodyList.subarray(r.bodyStart[b], r.bodyStart[b + 1]));
  const first = D.lines[r.off[f]], last = D.lines[r.off[f] + r.cnt[f] - 1];
  c.replaceChildren();
  const h = el('h3'); const dot = el('span', 'dot'); dot.style.cssText = `display:inline-block;width:11px;height:11px;border-radius:50%;margin-right:.4rem;background:${k >= 0 ? colourOf(k) : GREY}`;
  h.append(dot, document.createTextNode(`${r.names[r.nameOf[f]] ?? '(no name)'} · body ${k + 1} of ${fmt(S.bodies.length)}`));
  const dl = el('dl');
  const add = (key, v) => dl.append(el('dt', null, key), el('dd', null, v));
  add('families', fams.map(x => `#${fmt(r.n[x])} ${r.names[r.nameOf[x]] ?? '(no name)'}`).join(' · '));
  add('blocks', [...new Set(fams.map(x => r.blocks[r.block[x]] ?? 'none recorded'))].join(' · '));
  add('kind', [...new Set(fams.map(x => r.kinds[r.kind[x]] ?? 'not recorded'))].join(' · '));
  add('category', [...new Set(fams.map(x => r.cats[r.cat[x]] ?? 'none recorded'))].join(' · '));
  add('length', `${fmt(r.cnt[f])} line keys in order`);
  add('first key', r.cnt[f] ? fmt(first) : 'EMPTY: the sequence has no keys');
  add('last key', r.cnt[f] ? fmt(last) : 'EMPTY: the sequence has no keys');
  add('files · repos', `${fmt(r.bodyFiles[b])} · ${fmt(fams.reduce((s, x) => s + Math.max(0, r.repos[x]), 0))} (read from the pack)`);
  const sites = el('dd', null, 'not fetched: tap SITES to read the family record');
  dl.append(el('dt', null, 'recorded names'), sites);
  c.append(h, dl, el('p', 'dim small', 'First and last key are the two ends of the sequence, not a range: the keys between are the body\'s own lines in order, and need not be consecutive numbers.'));
  const acts = el('div', 'acts');
  if (r.cnt[f]) {
    const a = el('a', 'code', 'CODE'); a.href = `../31-code-card-everywhere/?line=${first}`; acts.append(a);
  }
  const sb = el('button', null, 'SITES'); sb.type = 'button';
  sb.addEventListener('click', async () => {
    const url = `${STARS_F}${Math.floor(r.n[f] / 500)}.json`;
    sites.textContent = 'LOAD…';
    try {
      const bucket = await fetchOnce(url, 'json');
      if (S.body !== b) return;
      const rec = bucket[String(r.n[f])];
      if (!rec) { sites.textContent = `EMPTY: the published bucket holds no record for family #${fmt(r.n[f])}`; return; }
      const names = Array.isArray(rec.names) ? rec.names : [];
      const places = Array.isArray(rec.places) ? rec.places.length : null;
      sites.textContent = `${names.length ? names.join(' · ') : 'none recorded'}` +
        `${names.length > 1 ? ' — one body carried under several names' : ''}` +
        ` · ${places === null ? 'places not recorded' : plural(places, 'recorded place')}` +
        ` · ${typeof rec.versions === 'number' ? plural(rec.versions, 'version') : 'versions not recorded'}`;
    } catch (err) { if (S.body === b) sites.textContent = `FAIL: ${err.message} · tap SITES again to retry`; }
  });
  acts.append(sb);
  c.append(acts);
}

/* ── the wafer: dark ground on the GPU, lit bodies on 2D ────────────────── */
const canvas = $('plane'), gcanvas = $('ground');
const ctx = canvas.getContext('2d');
let W = 1, H = 1, DPR = 1;
const V = { x: 0, y: 0, k: 1 };
let glMode = false, gl = null, prog = null, uloc = {}, g2d = null;

function resize() {
  const rc = canvas.getBoundingClientRect();
  W = Math.max(1, rc.width); H = Math.max(1, rc.height);
  DPR = Math.min(2, window.devicePixelRatio || 1);
  for (const c of [canvas, gcanvasRef.c]) { c.width = Math.round(W * DPR); c.height = Math.round(H * DPR); }
  if (gl) gl.viewport(0, 0, gcanvas.width, gcanvas.height);
  schedule();
}
new ResizeObserver(resize).observe(canvas);

function fitWafer() {
  const max = Math.max(D.ground ? D.ground.max : 0, D.maxKey, 1);
  const R = SPACING * Math.sqrt(max);
  V.x = 0; V.y = 0; V.k = Math.min(W, H) / (2.1 * R);
  schedule();
}
function fitGroup() {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of S.pts) for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); }
  if (!isFinite(x0)) return fitWafer();
  V.x = (x0 + x1) / 2; V.y = (y0 + y1) / 2;
  V.k = Math.min(W / Math.max(x1 - x0, 8), H / Math.max(y1 - y0, 8)) * 0.85;
  schedule();
}
$('fit').addEventListener('click', () => (S.name >= 0 ? fitGroup() : fitWafer()));

const VS = `#version 300 es
precision highp float;
in vec2 a_pos;
uniform vec2 u_res; uniform vec2 u_cam; uniform float u_zoom; uniform float u_dpr;
void main(){
  vec2 p = (a_pos - u_cam) * u_zoom;
  gl_Position = vec4(p / (u_res * 0.5), 0.0, 1.0);
  gl_PointSize = clamp(1.2 * sqrt(u_zoom / u_dpr) * u_dpr, 1.0, 14.0 * u_dpr);
}`;
const FS = `#version 300 es
precision highp float;
out vec4 o;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  if (length(d) > 0.5) discard;
  o = vec4(0.13, 0.15, 0.20, 0.55);
}`;

function initGround() {
  try {
    gl = gcanvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) throw new Error('no WebGL2');
    const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    for (const u of ['u_res', 'u_cam', 'u_zoom', 'u_dpr']) uloc[u] = gl.getUniformLocation(prog, u);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, D.ground.pos, gl.STATIC_DRAW);
    const l = gl.getAttribLocation(prog, 'a_pos'); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.viewport(0, 0, gcanvas.width, gcanvas.height);
    glMode = true;
  } catch (e) {
    /* a canvas that handed out a WebGL context cannot give a 2D one: replace it */
    gl = null; glMode = false;
    const fresh = gcanvas.cloneNode(false); gcanvas.replaceWith(fresh);
    g2d = fresh.getContext('2d');
    gcanvasRef.c = fresh;
  }
}
const gcanvasRef = { c: gcanvas };

function drawGround() {
  const gc = gcanvasRef.c;
  if (!RT.ground.visible || !D.ground) {
    if (gl) { gl.clearColor(0.012, 0.016, 0.024, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
    else if (g2d) { g2d.setTransform(1, 0, 0, 1, 0, 0); g2d.clearRect(0, 0, gc.width, gc.height); }
    return 0;
  }
  if (gl) {
    gl.clearColor(0.012, 0.016, 0.024, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(uloc.u_res, gc.width, gc.height);
    gl.uniform2f(uloc.u_cam, V.x, V.y);
    gl.uniform1f(uloc.u_zoom, V.k * DPR);
    gl.uniform1f(uloc.u_dpr, DPR);
    gl.drawArrays(gl.POINTS, 0, D.ground.n);
    return D.ground.n;
  }
  const c = g2d; if (!c) return 0;
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, gc.width, gc.height);
  c.fillStyle = '#20242e';
  const step = V.k < 0.5 ? 7 : 1, P = D.ground.pos; let n = 0;
  for (let i = 0; i < D.ground.n; i += step) {
    const x = (P[2 * i] - V.x) * V.k * DPR + gc.width / 2, y = gc.height / 2 - (P[2 * i + 1] - V.y) * V.k * DPR;
    if (x < 0 || y < 0 || x > gc.width || y > gc.height) continue;
    c.fillRect(x, y, DPR, DPR); n++;
  }
  return n;
}

let pending = false;
function schedule() { if (!pending) { pending = true; requestAnimationFrame(frame); } }
const sx = x => W / 2 + (x - V.x) * V.k;
const sy = y => H / 2 - (y - V.y) * V.k;

function frame() {
  pending = false;
  const t0 = performance.now();
  const groundN = drawGround();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);
  let lit = 0;
  if (!D.r && !D.ground) {
    ctx.fillStyle = '#8b93a7'; ctx.font = '12px ui-monospace,Menlo,Consolas,monospace'; ctx.textAlign = 'center';
    ctx.fillText('WAIT — tick a layer', W / 2, H / 2);
  } else if (S.name >= 0) {
    const rad = Math.max(1.6, Math.min(6, 1.2 * Math.sqrt(V.k)));
    /* grey bodies first, then coloured, then the selected body on top */
    const order = S.bodies.map((_, i) => i).sort((a, b) => (colourOf(a) === GREY ? 0 : 1) - (colourOf(b) === GREY ? 0 : 1));
    const sel = S.bodies.indexOf(S.body);
    if (sel >= 0) { order.splice(order.indexOf(sel), 1); order.push(sel); }
    for (const i of order) {
      const p = S.pts[i], col = colourOf(i), on = i === sel;
      if (on && p.length >= 4) {
        ctx.strokeStyle = col; ctx.globalAlpha = 0.45; ctx.lineWidth = 1; ctx.beginPath();
        for (let j = 0; j < p.length; j += 2) { const X = sx(p[j]), Y = sy(p[j + 1]); j ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
        ctx.stroke(); ctx.globalAlpha = 1;
      }
      for (let j = 0; j < p.length; j += 2) {
        const X = sx(p[j]), Y = sy(p[j + 1]);
        if (X < -8 || Y < -8 || X > W + 8 || Y > H + 8) continue;
        if (col === GREY) { ctx.fillStyle = col; ctx.fillRect(X - 0.8, Y - 0.8, 1.6, 1.6); lit++; continue; }
        ctx.beginPath(); ctx.arc(X, Y, rad + (on ? 1.5 : 0) + 1.4, 0, 6.2832); ctx.fillStyle = '#000'; ctx.fill();
        ctx.beginPath(); ctx.arc(X, Y, rad + (on ? 1.5 : 0), 0, 6.2832); ctx.fillStyle = col; ctx.fill();
        lit++;
      }
    }
  }
  const ms = performance.now() - t0;
  window.__same.frames.push(ms); if (window.__same.frames.length > 240) window.__same.frames.shift();
  window.__same.lastLit = lit;
  $('drawn').textContent = `${RT.ground.visible && D.ground ? fmt(groundN) + ' ground lines' + (glMode ? ' (GPU)' : ' (2D)') + ' · ' : ''}${fmt(lit)} lit keys in view · ${ms.toFixed(1)} ms`;
}

/* gestures: drag, pinch, wheel, tap */
(function gestures() {
  const pts = new Map(); let pinch = null, down = null, moved = 0;
  canvas.addEventListener('pointerdown', e => {
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* a pointer the browser no longer tracks */ }
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 1) { down = [e.clientX, e.clientY]; moved = 0; }
    if (pts.size === 2) { const [p, q] = [...pts.values()]; pinch = { d: Math.hypot(p[0] - q[0], p[1] - q[1]), k: V.k }; }
  });
  canvas.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2 && pinch) { const [p, q] = [...pts.values()]; const d = Math.hypot(p[0] - q[0], p[1] - q[1]); if (pinch.d > 0) V.k = Math.max(0.001, Math.min(4000, pinch.k * d / pinch.d)); moved += 99; schedule(); return; }
    if (pts.size === 1) { const dx = e.clientX - prev[0], dy = e.clientY - prev[1]; moved += Math.abs(dx) + Math.abs(dy); V.x -= dx / V.k; V.y += dy / V.k; schedule(); }
  });
  const up = e => {
    if (pts.size === 1 && down && moved < 8) tap(e.clientX, e.clientY);
    pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) down = null;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', e => { pts.delete(e.pointerId); pinch = null; down = null; });
  canvas.addEventListener('wheel', e => { e.preventDefault(); V.k = Math.max(0.001, Math.min(4000, V.k * Math.exp(-e.deltaY * 0.0016))); schedule(); }, { passive: false });
})();

function tap(cx, cy) {
  if (S.name < 0) return;
  const rc = canvas.getBoundingClientRect();
  const px = cx - rc.left, py = cy - rc.top;
  let best = -1, bd = 22 * 22;
  S.pts.forEach((p, i) => {
    for (let j = 0; j < p.length; j += 2) { const dx = sx(p[j]) - px, dy = sy(p[j + 1]) - py, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }
  });
  if (best >= 0) selectBody(S.bodies[best]);
}

/* ── Questions and machine detail, computed ─────────────────────────────── */
function paintQuestions() {
  const r = D.r; if (!r) return;
  const re = /haversine|distance|volt|drop|cable|feeder|busbar|transformer|earth|impedance|ampacity|rating/i;
  const hits = [];
  r.names.forEach((s, g) => { if (s && !r.noName[g] && re.test(s) && r.nameBodies[g] > 1) hits.push(g); });
  hits.sort((a, b) => r.nameBodies[b] - r.nameBodies[a] || (r.names[a] < r.names[b] ? -1 : 1));
  $('q1names').textContent = hits.length
    ? hits.slice(0, 8).map(g => `${r.names[g]} (${fmt(r.nameBodies[g])} bodies)`).join(' · ') + (hits.length > 8 ? ` · and ${fmt(hits.length - 8)} more` : '')
    : 'EMPTY: no such name has more than one body in this pack';
  const p = D.prov;
  $('q2prov').textContent = p && !p.error
    ? `built ${String(p.built_utc).slice(0, 16).replace('T', ' ')} UTC from the published stars export, star-maker commit ${String(p.star_maker_commit).slice(0, 12)}`
    : `whose provenance.json did not load (${p && p.error ? p.error : 'not fetched'})`;
  if (S.name >= 0) {
    const bl = new Map();
    for (let i = r.nameStart[S.name]; i < r.nameStart[S.name + 1]; i++) { const s = r.blocks[r.block[r.nameList[i]]] ?? 'none recorded'; bl.set(s, (bl.get(s) || 0) + 1); }
    $('q2blocks').textContent = [...bl].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([s, c]) => `${s} (${fmt(c)})`).join(' · ') + (bl.size > 12 ? ` · and ${fmt(bl.size - 12)} more` : '') + ` for ${r.names[S.name]}`;
    $('q3now').textContent = S.pair
      ? `For ${r.names[S.name]}: bodies ${S.pair.i + 1} and ${S.pair.j + 1} share ${fmt(S.pair.inter)} line keys, the closest pair, so they are the first two to read together.`
      : `For ${r.names[S.name]}: one body only, so there is nothing under this name to consolidate.`;
  } else {
    $('q3now').textContent = r.finding.sharedBodies
      ? `${fmt(r.finding.sharedBodies)} bodies are carried by more than one family; the most copied are listed first.`
      : `In this pack no two families share a body, so exact copies are not separate families; a family's files field says in how many files its one body appears. Pick a name to see its closest pair of bodies.`;
  }
}

function paintMachine() {
  const r = D.r; if (!r) return;
  const t = D.timing;
  $('machine').textContent =
    `Machine detail · inputs: families.json (${fmt(r.F)} records; name, lineOffset and lineCount as indexes into lines.bin, files and repos as counts) and lines.bin (${fmt(r.L)} little-endian uint32 permanent line keys). ` +
    `Outputs: ${fmt(r.B)} distinct bodies (exact key-sequence groups), ${fmt(r.N)} names, case counts [${r.counts.map(fmt).join(', ')}] in the order listed above. ` +
    `Method: FNV-1a over each key sequence to bucket (${fmt(r.stats.buckets)} buckets), then exact array comparison (${fmt(r.stats.compares)} comparisons, ${fmt(r.stats.collisions)} collisions kept apart). ` +
    `Refusals: a family pointing past the end of lines.bin stops the run; a name not in the pack is EMPTY. ` +
    `Compute time in this browser: worker ${Math.round(r.ms.total)} ms (parse ${Math.round(r.ms.parse)}, sequences ${Math.round(r.ms.bodies)}, groups and ranks ${Math.round(r.ms.rest)}); fetch ${Math.round(t.fetch)} ms; tick to answer ${Math.round(t.total)} ms. ` +
    `Queue peak ${queue.peak} of 3; files fetched ${fetchLog.length}.` +
    (S.name >= 0 ? ` Selected: ${r.names[S.name]}, ${fmt(S.bodies.length)} bodies, ${fmt(S.distinctKeys)} distinct keys.` : '');
  $('prov').textContent = `Data: ${DATA}families.json, lines.bin, provenance.json, all-lines.bin; family records on SITES from ${STARS_F}<bucket>.json.`;
}
