/* How the Estate Grew: the page. Loading in Grid Atlas grammar: every section
   exists from the start, nothing is fetched until the reader opens it, one
   queue of 4 carries every request with a 15 s timeout, one promise per URL
   (removed on failure so a retry is possible), and only the changed row or
   label is touched. The counting rules live in registry.mjs. */
import * as G from './registry.mjs';

const OWNER = 'Ventusltd';
const REPO = 'registry_of_all_content_in_repos_and_dependencies';
/* origin/main of the registry repository when this page was built (git fetch) */
const PIN = '4088117acd2c2d1ea3596779e13373fbb709c696';
const RAW = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${PIN}/`;
const API = `https://api.github.com/repos/${OWNER}/${REPO}/`;
const TIMEOUT = 15000, CONCURRENCY = 4, PAGE = 12;

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const fmt = n => (n == null ? 'not yet known' : Number(n).toLocaleString('en-GB'));
const when = s => (s ? s.replace('T', ' ').replace(/:\d\dZ$/, 'Z') : null);
$('sha').textContent = PIN.slice(0, 12);
$('sha').title = PIN;

/* ── loading, as Grid Atlas does it ─────────────────────────────────────── */
class FetchQueue {
  constructor(n) { this.n = n; this.active = 0; this.wait = []; this.peak = 0; }
  async add(task) {
    if (this.active >= this.n) await new Promise(r => this.wait.push(r));
    this.active++; this.peak = Math.max(this.peak, this.active);
    try { return await task(); } finally { this.active--; if (this.wait.length) this.wait.shift()(); }
  }
}
const queue = new FetchQueue(CONCURRENCY);
const urlCache = new Map();
const M = { fetches: 0, failed: 0, bytes: 0, timeouts: 0 };

function fetchOnce(url, onBytes) {
  if (urlCache.has(url)) return urlCache.get(url);
  const p = queue.add(async () => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT);
    M.fetches++; paintMachine();
    try {
      const res = await fetch(url, { signal: ctl.signal, headers: url.startsWith(API) ? { Accept: 'application/vnd.github+json' } : undefined });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let t;
      if (res.body && res.body.getReader && onBytes) {
        const reader = res.body.getReader(); const dec = new TextDecoder(); const parts = []; let got = 0;
        for (;;) { const { done, value } = await reader.read(); if (done) break; got += value.length; M.bytes += value.length; parts.push(dec.decode(value, { stream: true })); onBytes(got); }
        parts.push(dec.decode()); t = parts.join('');
      } else { t = await res.text(); M.bytes += t.length; }
      try { return JSON.parse(t); } catch (_) { throw new Error('not valid JSON'); }
    } catch (err) {
      M.failed++;
      if (err && err.name === 'AbortError') { M.timeouts++; throw new Error('timed out after 15 s'); }
      throw new Error((err && err.message) || String(err));
    } finally { clearTimeout(timer); paintMachine(); }
  }).catch(err => { urlCache.delete(url); throw err; });
  urlCache.set(url, p);
  return p;
}

/* the label of one section: only its text changes */
function label(sec, state, stats) {
  const s = $('lbl-' + sec);
  s.textContent = `${s.dataset.baseLabel} [${state}${stats ? ': ' + stats : ''}]`;
}
function paintMachine() {
  const newest = listing.value ? listing.value.versions[listing.value.versions.length - 1] : null;
  const s = newest != null && SNAP.get(newest) && SNAP.get(newest).sum;
  $('machine').textContent = 'Machine detail · inputs: registry/registry_vNNNN.json (repos[].files[] entries, integers counted), registry/latest.json (pointer: authoritative_version integer, json_path, updated_at UTC), registry/graph_latest.json (nodes with x, y in its own drawing units, edges from/to/type), the registry/ directory listing from the GitHub contents API; all at commit ' + PIN +
    ' · outputs: per snapshot repos and files counted (entries), repos and files added and removed between two snapshots (entries), file-count growth per repo (entries), MATCH / DIFFERS / NOT YET KNOWN per check · refusals: edges EMPTY for a snapshot with no edges field; NOT YET KNOWN when a file cannot be read; withheld entries counted, not displayed' +
    ` · this visit: ${M.fetches} requests, ${M.failed} failed, ${M.timeouts} timed out, ${fmt(M.bytes)} characters read, peak concurrency ${queue.peak} of ${CONCURRENCY}, snapshots held ${[...SNAP.values()].filter(x => x.sum).length}` +
    (s ? ` · newest read: v${G.pad4(newest)} with ${fmt(s.repoCount)} repos and ${fmt(s.fileCount)} files` : '');
}

/* ── the numbered files: listing, then one snapshot at a time ─────────────── */
const listing = { value: null, loading: null };
function hydrateListing() {
  if (listing.value) return Promise.resolve(listing.value);
  if (listing.loading) return listing.loading;
  listing.loading = (async () => {
    try {
      const dir = await fetchOnce(`${API}contents/registry?ref=${PIN}`);
      if (!Array.isArray(dir)) throw new Error('listing is not an array');
      const versions = dir.map(f => G.versionOfName(f.name)).filter(v => v != null).sort((a, b) => a - b);
      const sizes = new Map(dir.filter(f => G.versionOfName(f.name) != null).map(f => [G.versionOfName(f.name), f.size]));
      listing.value = { versions, sizes, method: 'the GitHub contents API listing of registry/ at the pinned commit', fromListing: true };
    } catch (e) {
      /* declared fallback: the pointer's authoritative_version, stated as such */
      const latest = await fetchOnce(RAW + 'registry/latest.json');
      const n = latest && Number.isInteger(latest.authoritative_version) ? latest.authoritative_version : null;
      if (n == null) throw new Error(`directory listing failed (${e.message}) and latest.json has no authoritative_version`);
      listing.value = { versions: Array.from({ length: n }, (_, i) => i + 1), sizes: new Map(), method: `v0001 to the authoritative_version in latest.json, because the directory listing failed (${e.message})`, fromListing: false };
    } finally { listing.loading = null; }
    return listing.value;
  })();
  return listing.loading;
}

const SNAP = new Map();   // version -> { sum, loading, err }
function hydrateSnapshot(v, onBytes) {
  let s = SNAP.get(v);
  if (!s) { s = { sum: null, loading: null, err: null }; SNAP.set(v, s); }
  if (s.sum) return Promise.resolve(s.sum);
  if (s.loading) return s.loading;
  s.err = null;
  s.loading = fetchOnce(RAW + 'registry/' + G.snapshotName(v), onBytes)
    .then(json => {
      s.sum = G.summarise(json, v);
      urlCache.delete(RAW + 'registry/' + G.snapshotName(v));   // the parsed file is dropped; the summary stays
      return s.sum;
    })
    .catch(e => { s.err = e.message; throw e; })
    .finally(() => { s.loading = null; paintMachine(); });
  return s.loading;
}
const SCHEMA_TOP = ['boot_sequence', 'generated_at', 'registry_version', 'repos', 'schema_version', 'totals'];
const missingTop = sum => SCHEMA_TOP.filter(k => !sum.topKeys.includes(k));

/* ── 1. timeline ─────────────────────────────────────────────────────────── */
const TL = new Map();  // version -> { li, head, nums, bar }
let tlMax = 0;
async function openTimeline() {
  if (TL.size) return;
  label('timeline', 'LOAD', 'listing registry/');
  let L;
  try { L = await hydrateListing(); }
  catch (e) { label('timeline', 'FAIL', e.message); return; }
  if (!L.versions.length) { label('timeline', 'EMPTY', 'no numbered snapshot files in registry/'); return; }
  const ol = $('rows-timeline');
  const frag = document.createDocumentFragment();
  for (const v of L.versions) {
    const li = el('li', 'row wait');
    const head = el('p', 'rhead'); const nums = el('p', 'nums small'); const bar = el('div', 'bar'); const i = el('i');
    bar.appendChild(i); li.append(head, nums, bar);
    head.append(el('span', 'st', 'WAIT'), el('b', null, `v${G.pad4(v)}`));
    nums.textContent = L.sizes.get(v) ? `${fmt(L.sizes.get(v))} bytes, queued` : 'queued';
    li.addEventListener('click', () => { if (li.classList.contains('fail')) loadRow(v); });
    TL.set(v, { li, head, nums, bar: i });
    frag.appendChild(li);
  }
  ol.appendChild(frag);
  ol.insertBefore(el('li', 'small dim', `${L.versions.length} numbered snapshots, found from ${L.method}.`), ol.firstChild);
  fillSummary();
  await Promise.all(L.versions.map(v => loadRow(v)));
}
function tlState(v, cls, st) {
  const r = TL.get(v); if (!r) return;
  r.li.className = 'row ' + cls;
  r.head.firstChild.textContent = st;
}
async function loadRow(v) {
  const r = TL.get(v);
  tlState(v, 'wait', 'WAIT');
  const size = listing.value && listing.value.sizes.get(v);
  let lastPaint = 0;
  try {
    const sum = await hydrateSnapshot(v, got => {
      const now = performance.now(); if (now - lastPaint < 150) return; lastPaint = now;
      if (r) { tlState(v, 'load', 'LOAD'); r.nums.textContent = size ? `${Math.round(100 * got / size)}% of ${fmt(size)} bytes` : `${fmt(got)} bytes`; }
    });
    fillRow(v, sum);
  } catch (e) {
    if (r) { tlState(v, 'fail', 'FAIL'); r.nums.textContent = `${e.message}. Tap to try again.`; }
  }
  countTimeline();
}
function fillRow(v, sum) {
  const r = TL.get(v); if (!r) return;
  tlState(v, 'ok', 'OK');
  const h = r.head;
  while (h.childNodes.length > 1) h.removeChild(h.lastChild);
  h.append(el('b', null, sum.generated_at ? when(sum.generated_at) : `v${G.pad4(v)}`), el('span', 'dim', sum.generated_at ? `v${G.pad4(v)} · generated_at` : 'no generated_at: version number'));
  const n = r.nums; n.textContent = '';
  const part = (b, t) => { n.append(el('b', null, b), document.createTextNode(' ' + t + '  ')); };
  part(fmt(sum.repoCount), 'repos');
  part(fmt(sum.fileCount), 'files');
  const types = Object.keys(sum.types).length;
  n.append(document.createTextNode(`· ${types} file types · states ${Object.entries(sum.states).map(([k, c]) => `${k} ${fmt(c)}`).join(', ') || 'none'} · edges ${sum.edges == null ? 'EMPTY (no edges field)' : fmt(sum.edges)}`));
  const d = sum.declared;
  if (d) {
    const agree = d.repo_count === sum.repoCount && d.file_count === sum.fileCount;
    n.append(document.createTextNode(` · totals written in the file ${agree ? 'equal these counts' : `say ${fmt(d.repo_count)} repos, ${fmt(d.file_count)} files`}; reachable ${fmt(d.reachable_count)}, unreachable ${fmt(d.unreachable_count)}`));
  } else n.append(document.createTextNode(' · no totals field'));
  if (sum.registry_version !== v) n.append(document.createTextNode(` · registry_version inside says ${sum.registry_version == null ? 'nothing' : sum.registry_version}`));
  const miss = missingTop(sum);
  if (miss.length) n.append(document.createTextNode(` · fields named above but absent: ${miss.join(', ')}`));
  if (sum.withheldRepos || sum.withheldFiles) n.append(document.createTextNode(` · ${sum.withheldRepos} repos and ${sum.withheldFiles} files withheld, ${G.WITHHELD_REASON}`));
  if (sum.fileCount > tlMax) { tlMax = sum.fileCount; for (const [vv, rr] of TL) { const s = SNAP.get(vv); if (s && s.sum) rr.bar.style.width = (100 * s.sum.fileCount / tlMax).toFixed(1) + '%'; } }
  else r.bar.style.width = (100 * sum.fileCount / tlMax).toFixed(1) + '%';
}
function countTimeline() {
  const vs = listing.value ? listing.value.versions : [];
  let ok = 0, fail = 0;
  for (const v of vs) { const s = SNAP.get(v); if (s && s.sum) ok++; else if (s && s.err) fail++; }
  if (ok + fail < vs.length) label('timeline', 'LOAD', `${ok} of ${vs.length} read`);
  else if (fail) label('timeline', 'FAIL', `${ok} of ${vs.length} read, ${fail} failed: tap a failed row`);
  else label('timeline', 'OK', `${ok} snapshots read`);
  fillSummary(); fillQuestions();
}

/* ── 2. diff ─────────────────────────────────────────────────────────────── */
const LISTS = [
  ['added', 'Repositories added', x => [el('b', null, x.name), document.createTextNode(` · ${fmt(x.files)} files`)]],
  ['removed', 'Repositories removed', x => [el('b', null, x.name), document.createTextNode(` · had ${fmt(x.files)} files`)]],
  ['growth', 'Largest growth in files counted (largest first; shrinkage at the end)', x => [el('b', null, `${x.delta > 0 ? '+' : ''}${fmt(x.delta)}`), document.createTextNode(` ${x.name} · ${x.from == null ? 'absent' : fmt(x.from)} to ${x.to == null ? 'absent' : fmt(x.to)}`)]],
  ['filesAdded', 'Files added', x => [el('b', null, x.name), document.createTextNode(' / ' + x.path)]],
  ['filesRemoved', 'Files removed', x => [el('b', null, x.name), document.createTextNode(' / ' + x.path)]],
  ['edgesAdded', 'Edges added', x => [document.createTextNode(x)]],
  ['edgesRemoved', 'Edges removed', x => [document.createTextNode(x)]],
];
const DL = new Map();   // key -> { h, ol, info, prev, next, items, page, render }
function buildDiffLists() {
  const box = $('d-lists');
  for (const [key, title, render] of LISTS) {
    const wrap = el('div', 'list'); const h = el('h3', null, title); const info = el('p', 'small dim', 'not yet known');
    const ol = el('ol'); const pager = el('div', 'pager');
    const prev = el('button', null, 'previous'); const next = el('button', null, 'next'); prev.type = next.type = 'button';
    const where = el('span', 'small dim');
    pager.append(prev, next, where); wrap.append(h, info, ol, pager); box.appendChild(wrap);
    const L = { h, ol, info, prev, next, where, items: [], page: 0, render, empty: null };
    prev.addEventListener('click', () => { if (L.page > 0) { L.page--; paintList(L); } });
    next.addEventListener('click', () => { if ((L.page + 1) * PAGE < L.items.length) { L.page++; paintList(L); } });
    DL.set(key, L); paintList(L);
  }
}
function paintList(L) {
  L.ol.textContent = '';
  const start = L.page * PAGE, slice = L.items.slice(start, start + PAGE);
  for (const x of slice) { const li = el('li'); li.append(...L.render(x)); L.ol.appendChild(li); }
  const pages = Math.max(1, Math.ceil(L.items.length / PAGE));
  L.where.textContent = L.items.length ? `${start + 1} to ${start + slice.length} of ${fmt(L.items.length)} · page ${L.page + 1} of ${pages}` : '';
  L.prev.disabled = L.page === 0; L.next.disabled = (L.page + 1) * PAGE >= L.items.length;
}
async function openDiff() {
  if (DL.size) return;
  buildDiffLists();
  label('diff', 'LOAD', 'listing registry/');
  let L;
  try { L = await hydrateListing(); } catch (e) { label('diff', 'FAIL', e.message); $('d-status').textContent = 'FAIL: ' + e.message; return; }
  if (L.versions.length < 2) { label('diff', 'EMPTY', 'fewer than two numbered snapshots'); return; }
  for (const id of ['d-from', 'd-to']) {
    const s = $(id); s.textContent = '';
    for (const v of L.versions) { const o = el('option', null, `v${G.pad4(v)}`); o.value = v; s.appendChild(o); }
  }
  $('d-from').value = L.versions[L.versions.length - 2];
  $('d-to').value = L.versions[L.versions.length - 1];
  $('d-go').disabled = false;
  label('diff', 'OK', `${L.versions.length} snapshots to choose from`);
  $('d-status').textContent = 'WAIT: choose two snapshots and tap compare.';
}
let diffToken = 0;
async function runDiff() {
  const a = Number($('d-from').value), b = Number($('d-to').value);
  const token = ++diffToken;
  $('d-status').textContent = `LOAD: reading v${G.pad4(a)} and v${G.pad4(b)}`;
  label('diff', 'LOAD', `v${G.pad4(a)} to v${G.pad4(b)}`);
  let sa, sb;
  try { [sa, sb] = await Promise.all([hydrateSnapshot(a), hydrateSnapshot(b)]); if (TL.size) { fillRow(a, sa); fillRow(b, sb); countTimeline(); } }
  catch (e) { if (token === diffToken) { $('d-status').textContent = 'FAIL: ' + e.message + '. Tap compare to try again.'; label('diff', 'FAIL', e.message); } return; }
  if (token !== diffToken) return;
  const d = G.diff(sa, sb);
  const put = (key, items, empty) => { const L = DL.get(key); L.items = items; L.page = 0; L.info.textContent = items.length ? `${fmt(items.length)} entries` : `EMPTY: ${empty}`; paintList(L); };
  put('added', d.added, `no repository in v${G.pad4(b)} is absent from v${G.pad4(a)}`);
  put('removed', d.removed, `no repository in v${G.pad4(a)} is absent from v${G.pad4(b)}`);
  put('growth', d.growth, 'no repositories in either snapshot');
  put('filesAdded', d.filesAdded, `no file path in v${G.pad4(b)} is absent from v${G.pad4(a)}`);
  put('filesRemoved', d.filesRemoved, `no file path in v${G.pad4(a)} is absent from v${G.pad4(b)}`);
  if (d.edges.empty) { put('edgesAdded', [], d.edges.empty); put('edgesRemoved', [], d.edges.empty); }
  else { put('edgesAdded', d.edges.added, 'no edge added'); put('edgesRemoved', d.edges.removed, 'no edge removed'); }
  const direction = a === b ? ' (the same snapshot on both sides)' : a > b ? ' (from a newer to an older snapshot)' : '';
  $('d-status').textContent = `OK: v${G.pad4(a)} (${fmt(sa.repoCount)} repos, ${fmt(sa.fileCount)} files) to v${G.pad4(b)} (${fmt(sb.repoCount)} repos, ${fmt(sb.fileCount)} files)${direction}. Withheld, ${G.WITHHELD_REASON}: ${d.withheldRepos} repos, ${d.withheldFiles} file changes.`;
  label('diff', 'OK', `v${G.pad4(a)} to v${G.pad4(b)}: ${d.added.length} repos added, ${d.removed.length} removed, ${fmt(d.filesAdded.length)} files added, ${fmt(d.filesRemoved.length)} removed`);
}

/* ── 3. graph ────────────────────────────────────────────────────────────── */
const graph = { value: null, loading: null, facts: null, view: null, sel: null, showFiles: true, drawn: { nodes: 0, edges: 0 }, frames: 0 };
function hydrateGraph() {
  if (graph.value) return Promise.resolve(graph.value);
  if (graph.loading) return graph.loading;
  graph.loading = fetchOnce(RAW + 'registry/graph_latest.json').then(g => {
    graph.value = g; graph.facts = G.graphFacts(g);
    const nodes = (g.nodes || []).filter(n => Number.isFinite(n.x) && Number.isFinite(n.y));
    graph.withheld = nodes.filter(n => { const p = G.parseNodeId(n.id); return G.isWithheld(p.repo, p.path); }).length;
    graph.nodes = nodes.filter(n => { const p = G.parseNodeId(n.id); return !G.isWithheld(p.repo, p.path); });
    graph.byId = new Map(graph.nodes.map(n => [n.id, n]));
    graph.noXY = (g.nodes || []).length - nodes.length;
    return g;
  }).finally(() => { graph.loading = null; paintMachine(); });
  return graph.loading;
}
const cv = $('g-canvas'); const ctx = cv.getContext('2d');
function bounds() {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of graph.nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); }
  return { x0, y0, x1, y1 };
}
function fit() {
  if (!graph.nodes || !graph.nodes.length) return;
  const r = cv.getBoundingClientRect(); const b = bounds(); const padPx = 36;
  const s = Math.min((r.width - 2 * padPx) / Math.max(1, b.x1 - b.x0), (r.height - 2 * padPx) / Math.max(1, b.y1 - b.y0));
  graph.view = { s, cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2 };
  requestDraw();
}
let drawQueued = false;
function requestDraw() { if (!drawQueued) { drawQueued = true; requestAnimationFrame(() => { drawQueued = false; drawGraph(); }); } }
function drawGraph() {
  if (!graph.nodes || !graph.view) return;
  const t0 = performance.now();
  const r = cv.getBoundingClientRect(); const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, r.width, r.height);
  const { s, cx, cy } = graph.view;
  const X = x => (x - cx) * s + r.width / 2, Y = y => (y - cy) * s + r.height / 2;
  const on = n => graph.showFiles || !String(n.id).startsWith('file::');
  const inView = (x, y, m) => x > -m && y > -m && x < r.width + m && y < r.height + m;
  const types = graph.value.edgeTypes || {};
  let ne = 0, nn = 0;
  const edges = graph.value.edges || [];
  for (const pass of [0, 1]) {
    for (const e of edges) {
      const a = graph.byId.get(e.from), b = graph.byId.get(e.to);
      if (!a || !b || !on(a) || !on(b)) continue;               // both ends must exist and be shown
      const ax = X(a.x), ay = Y(a.y), bx = X(b.x), by = Y(b.y);
      if (Math.max(ax, bx) < 0 || Math.min(ax, bx) > r.width || Math.max(ay, by) < 0 || Math.min(ay, by) > r.height) continue;
      const t = types[e.type] || {};
      const dash = String(t.dash || '').trim().split(/\s+/).filter(Boolean).map(Number).filter(Number.isFinite);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
      if (pass === 0) { ctx.setLineDash([]); ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.lineWidth = 4.5; ctx.stroke(); }
      else { ctx.setLineDash(dash.map(d => Math.max(2, d * Math.min(1, s * 4)))); ctx.strokeStyle = /^#[0-9a-f]{6}$/i.test(t.colour || '') ? t.colour : '#8b93a7'; ctx.lineWidth = 1.6; ctx.stroke(); ne++; }
    }
  }
  ctx.setLineDash([]);
  const zoomR = Math.max(0.6, Math.min(2.2, s * 12));
  for (const n of graph.nodes) {
    if (!on(n)) continue;
    const x = X(n.x), y = Y(n.y); if (!inView(x, y, 20)) continue;
    const repo = String(n.id).startsWith('repo::');
    const rad = (repo ? 5.5 : 2.6) * zoomR;
    ctx.beginPath(); ctx.arc(x, y, rad + 2.5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,.9)'; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fillStyle = repo ? '#ffffff' : '#9aa6bd'; ctx.fill();
    if (repo) { ctx.beginPath(); ctx.arc(x, y, rad + 4, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(94,200,242,.55)'; ctx.lineWidth = 1.5; ctx.stroke(); }
    if (graph.sel === n) { ctx.beginPath(); ctx.arc(x, y, rad + 7, 0, Math.PI * 2); ctx.strokeStyle = '#ffd54a'; ctx.lineWidth = 2; ctx.stroke(); }
    nn++;
  }
  /* labels only where there is room: repository spacing on screen decides */
  const gap = 420 * s;
  ctx.font = '11px ui-monospace, Menlo, Consolas, monospace'; ctx.textBaseline = 'middle';
  for (const n of graph.nodes) {
    const repo = String(n.id).startsWith('repo::');
    if (!on(n) || !(repo ? gap > 70 : s > 0.5) && graph.sel !== n) continue;
    const x = X(n.x), y = Y(n.y); if (!inView(x, y, 0)) continue;
    const text = String(n.label || n.id); const max = repo ? Math.max(8, Math.floor(gap / 7.5)) : 28;
    const t = text.length > max ? text.slice(0, max - 1) + '…' : text;
    const tx = x + 9, ty = repo ? y - 14 : y;
    ctx.lineWidth = 3; ctx.strokeStyle = '#05060a'; ctx.strokeText(t, tx, ty);
    ctx.fillStyle = graph.sel === n ? '#ffd54a' : repo ? '#ffffff' : '#c5cddc'; ctx.fillText(t, tx, ty);
  }
  graph.drawn = { nodes: nn, edges: ne }; graph.frames++; graph.lastMs = performance.now() - t0;
  graph.maxMs = Math.max(graph.maxMs || 0, graph.lastMs);
  $('g-stats').textContent = graphStats();
}
function graphStats() {
  const f = graph.facts; if (!f) return 'WAIT';
  const edges = graph.value.edges || [];
  const bothEnds = edges.filter(e => graph.byId.has(e.from) && graph.byId.has(e.to)).length;
  return `OK: ${fmt(f.nodes)} nodes (${f.repoNodes.length} repositories, ${f.fileNodes.length} files), ${fmt(f.edges)} edges (${Object.entries(f.byType).map(([k, c]) => `${k} ${c}`).join(', ')}); ${bothEnds} have both ends in the file, ${f.edges - bothEnds} do not and are never drawn. In view now: ${graph.drawn.nodes} nodes, ${graph.drawn.edges} edges. ${graph.withheld} nodes withheld, ${G.WITHHELD_REASON}. ${graph.noXY ? graph.noXY + ' nodes without x, y are not drawn.' : ''}`;
}
async function openGraph() {
  if (graph.opened) { fit(); return; }
  label('graph', 'LOAD', 'graph_latest.json');
  try { await hydrateGraph(); }
  catch (e) { label('graph', 'FAIL', e.message + ': close and reopen to try again'); $('g-stats').textContent = 'FAIL: ' + e.message; return; }
  if (!graph.nodes.length) { label('graph', 'EMPTY', 'graph_latest.json has no nodes with x, y'); return; }
  const legend = el('div', 'legend');
  for (const [k, c] of Object.entries(graph.facts.byType)) {
    const t = (graph.value.edgeTypes || {})[k] || {};
    const sp = el('span'); const i = el('i'); i.style.borderTopColor = /^#[0-9a-f]{6}$/i.test(t.colour || '') ? t.colour : '#8b93a7';
    if (String(t.dash || '').trim()) i.style.borderTopStyle = 'dashed';
    sp.append(i, document.createTextNode(`${t.label || k} (${c})`)); legend.appendChild(sp);
  }
  $('g-stats').before(legend);
  graph.opened = true;
  fit();
  label('graph', 'OK', `${fmt(graph.facts.nodes)} nodes, ${fmt(graph.facts.edges)} edges`);
  fillQuestions();
}
/* pan, pinch, wheel, tap */
const ptrs = new Map(); let gesture = null;
cv.addEventListener('pointerdown', e => {
  if (!graph.view) return;
  cv.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  gesture = { moved: 0, t: performance.now(), start: { ...graph.view }, pts: new Map([...ptrs].map(([k, v]) => [k, { ...v }])) };
});
cv.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId) || !gesture) return;
  const prev = ptrs.get(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  gesture.moved += Math.hypot(e.clientX - prev.x, e.clientY - prev.y);
  const v = graph.view;
  if (ptrs.size === 1) { v.cx -= (e.clientX - prev.x) / v.s; v.cy -= (e.clientY - prev.y) / v.s; }
  else if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()]; const [a0, b0] = [...gesture.pts.values()];
    if (a0 && b0) {
      const d0 = Math.hypot(a0.x - b0.x, a0.y - b0.y) || 1, d1 = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, gesture.start.s * d1 / d0 / v.s);
    }
  }
  requestDraw();
});
const endPtr = e => {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.delete(e.pointerId);
  if (gesture && ptrs.size === 0 && gesture.moved < 10 && e.type === 'pointerup') pick(e.clientX, e.clientY);
  if (ptrs.size === 0) gesture = null;
  else gesture = { moved: 99, t: performance.now(), start: { ...graph.view }, pts: new Map([...ptrs].map(([k, v]) => [k, { ...v }])) };
};
cv.addEventListener('pointerup', endPtr); cv.addEventListener('pointercancel', endPtr);
cv.addEventListener('wheel', e => { if (!graph.view) return; e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); requestDraw(); }, { passive: false });
function zoomAt(px, py, k) {
  const v = graph.view; const r = cv.getBoundingClientRect();
  const wx = (px - r.left - r.width / 2) / v.s + v.cx, wy = (py - r.top - r.height / 2) / v.s + v.cy;
  v.s = Math.max(0.01, Math.min(4, v.s * k));
  v.cx = wx - (px - r.left - r.width / 2) / v.s; v.cy = wy - (py - r.top - r.height / 2) / v.s;
}
function pick(px, py) {
  const r = cv.getBoundingClientRect(); const v = graph.view;
  let best = null, bd = 24;
  for (const n of graph.nodes) {
    if (!graph.showFiles && String(n.id).startsWith('file::')) continue;
    const d = Math.hypot((n.x - v.cx) * v.s + r.width / 2 - (px - r.left), (n.y - v.cy) * v.s + r.height / 2 - (py - r.top));
    if (d < bd) { bd = d; best = n; }
  }
  graph.sel = best; showCard(best); requestDraw();
}
function showCard(n) {
  const card = $('g-card');
  if (!n) { card.hidden = true; return; }
  card.hidden = false;
  const p = G.parseNodeId(n.id);
  $('g-kind').textContent = p.kind === 'repo' ? 'REPOSITORY' : p.kind === 'file' ? 'FILE' : 'NODE';
  $('g-label').textContent = n.label || n.id;
  const kv = $('g-kv'); kv.textContent = '';
  const row = (k, v) => { if (v == null || v === '') return; kv.append(el('dt', null, k), el('dd', null, String(v))); };
  row('id', n.id); row('kind', n.kind); row('layer', n.layer); row('subtitle', n.subtitle); row('x, y', `${n.x}, ${n.y}`);
  const edges = graph.value.edges || [];
  row('edges out', edges.filter(e => e.from === n.id).length); row('edges in', edges.filter(e => e.to === n.id).length);
  const L = listing.value; const newest = L && L.versions[L.versions.length - 1]; const s = newest != null && SNAP.get(newest) && SNAP.get(newest).sum;
  if (s && p.repo) {
    const e = s.repos.get(p.repo);
    if (p.kind === 'repo') row(`v${G.pad4(newest)} entry`, e ? `${e.role} · ${fmt(e.counted)} files counted · branch ${e.default_branch}` : 'no entry with this name');
    else row(`in v${G.pad4(newest)}`, e && e.paths.has(p.path) ? 'this path is listed' : 'this path is not listed');
  } else row('snapshot entry', 'not yet known: open section 1 or 4 to read the newest snapshot');
  const gh = `https://github.com/${OWNER}/`;
  const isOurs = p.repo && typeof n.source === 'string' && n.source.startsWith(gh + p.repo);
  const open = $('g-open');
  if (isOurs) { open.hidden = false; open.href = gh + encodeURIComponent(p.repo); open.textContent = `Open ${p.repo} on GitHub`; } else open.hidden = true;
  const src = $('g-source');
  if (p.kind === 'file' && typeof n.source === 'string' && n.source.startsWith(gh)) { src.hidden = false; src.href = n.source; } else src.hidden = true;
}
$('g-files').addEventListener('change', e => { graph.showFiles = e.target.checked; if (!graph.showFiles && graph.sel && String(graph.sel.id).startsWith('file::')) { graph.sel = null; showCard(null); } requestDraw(); });
$('g-fit').addEventListener('click', fit);
window.addEventListener('resize', () => { if ($('sec-graph').open) requestDraw(); });

/* ── 4. consistency ──────────────────────────────────────────────────────── */
let checked = false;
async function openCheck() {
  if (checked) return; checked = true;
  const ul = $('rows-check');
  label('check', 'LOAD', 'listing, latest.json, graph_latest.json, newest snapshot');
  const [L, latest, g, head] = await Promise.all([
    hydrateListing().catch(e => ({ err: e.message })),
    fetchOnce(RAW + 'registry/latest.json').catch(e => ({ err: e.message })),
    hydrateGraph().catch(e => ({ err: e.message })),
    fetchOnce(`${API}commits/main`).catch(e => ({ err: e.message })),
  ]);
  const listed = L && !L.err && L.fromListing ? L.versions[L.versions.length - 1] : null;
  const newest = L && !L.err ? L.versions[L.versions.length - 1] : null;
  let s = null, sErr = null;
  if (newest != null) { try { s = await hydrateSnapshot(newest); if (TL.size) { fillRow(newest, s); countTimeline(); } } catch (e) { sErr = e.message; } }
  const lt = latest && !latest.err ? latest : null; const gr = g && !g.err ? g : null;
  const why = [L && L.err && `listing: ${L.err}`, L && !L.err && !L.fromListing && `listing: ${L.method}`, latest && latest.err && `latest.json: ${latest.err}`, g && g.err && `graph_latest.json: ${g.err}`, sErr && `snapshot: ${sErr}`, head && head.err && `main head: ${head.err}`].filter(Boolean);
  const f = gr ? graph.facts : null;
  const nv = newest != null ? `v${G.pad4(newest)}` : 'the newest snapshot';
  let subtitleMatch = null, pathsFound = null, inside = null;
  if (gr && s) {
    subtitleMatch = f.repoNodes.filter(n => { const p = G.parseRepoSubtitle(n.subtitle); const e = s.repos.get(G.parseNodeId(n.id).repo); return p && e && p.files === e.counted && p.branch === e.default_branch; }).length;
    pathsFound = f.fileNodes.filter(n => { const p = G.parseNodeId(n.id); const e = s.repos.get(p.repo); return e && e.paths.has(p.path); }).length;
  }
  if (gr && gr.canvas && Number.isFinite(gr.canvas.width) && Number.isFinite(gr.canvas.height)) inside = (gr.nodes || []).filter(n => n.x >= 0 && n.y >= 0 && n.x <= gr.canvas.width && n.y <= gr.canvas.height).length;
  const rows = [
    G.check('Newest numbered file in registry/ and latest.json authoritative_version', listed, lt ? lt.authoritative_version : null, 'largest NNNN among registry_vNNNN.json in the directory listing, against the pointer'),
    G.check('latest.json json_path and the newest numbered file', lt ? lt.json_path : null, newest != null && listed != null ? 'registry/' + G.snapshotName(newest) : null, 'the pointer names a file; it is not a copy of it'),
    G.check(`${nv} registry_version and its file number`, s ? s.registry_version : null, s ? newest : null, 'the number inside against the number in the name'),
    G.check(`latest.json updated_at and ${nv} generated_at`, lt ? lt.updated_at : null, s ? s.generated_at : null, 'two timestamps as written'),
    G.check(`${nv} totals.repo_count and repos[] counted`, s && s.declared ? s.declared.repo_count : null, s ? s.repoCount : null, 'written total against length of repos[]'),
    G.check(`${nv} totals.file_count and files[] counted`, s && s.declared ? s.declared.file_count : null, s ? s.fileCount : null, 'written total against the sum of files[] lengths'),
    G.check(`Field names described above, present in ${nv}`, s ? SCHEMA_TOP.length - missingTop(s).length : null, s ? SCHEMA_TOP.length : null, s && missingTop(s).length ? `absent: ${missingTop(s).join(', ')}` : `top-level fields: ${SCHEMA_TOP.join(', ')}`),
    G.check('graph_latest.json dataSource.registryVersion and latest.json authoritative_version', gr && gr.dataSource ? gr.dataSource.registryVersion : null, lt ? lt.authoritative_version : null, 'which snapshot the graph says it was drawn from'),
    G.check('graph_latest.json dataSource.jsonPath and latest.json json_path', gr && gr.dataSource ? gr.dataSource.jsonPath : null, lt ? lt.json_path : null, 'the same, by path'),
    G.check(`graph_latest.json dataSource.generatedAt and ${nv} generated_at`, gr && gr.dataSource ? gr.dataSource.generatedAt : null, s ? s.generated_at : null, 'timestamps as written'),
    G.check(`Repository nodes in the graph and repos[] in ${nv}`, f ? f.repoNodes.length : null, s ? s.repoCount : null, 'nodes whose id starts repo:: against repos counted'),
    G.check(`Repository nodes whose "N files · branch" equals ${nv}`, subtitleMatch, f && s ? f.repoNodes.length : null, 'subtitle parsed, against files counted and default_branch'),
    G.check(`File nodes whose path is listed in ${nv}`, pathsFound, f && s ? f.fileNodes.length : null, 'file::repo::path looked up in that repo\'s files[]'),
    G.check('Graph edges with both ends present as nodes', f ? f.edges - f.dangling : null, f ? f.edges : null, 'every edge.from and edge.to looked up in nodes[]'),
    G.check('Graph nodes inside the canvas the graph declares', inside, gr && inside != null ? (gr.nodes || []).length : null, gr && gr.canvas ? `canvas.width ${gr.canvas.width}, canvas.height ${gr.canvas.height}, nodes at 0 to that size` : 'no canvas field'),
    G.check('Pinned commit and the head of main now', PIN, head && !head.err ? head.sha : null, 'if these differ, the registry has moved since this page was built and the counts here are of the pinned commit'),
  ];
  const frag = document.createDocumentFragment();
  let nm = 0, nd = 0, nu = 0;
  for (const c of rows) {
    const li = el('li', 'row ' + (c.status === 'MATCH' ? 'match' : c.status === 'DIFFERS' ? 'differs' : 'unknown'));
    const h = el('p', 'rhead'); h.append(el('span', 'st', c.status), el('b', null, c.label));
    const n = el('p', 'nums small');
    const show = v => (v == null ? 'not yet known' : typeof v === 'string' && /^[0-9a-f]{40}$/.test(v) ? v.slice(0, 12) : typeof v === 'number' ? fmt(v) : String(v));
    n.textContent = `${show(c.a)} · ${show(c.b)} · ${c.how}`;
    li.append(h, n); frag.appendChild(li);
    if (c.status === 'MATCH') nm++; else if (c.status === 'DIFFERS') nd++; else nu++;
  }
  if (why.length) { const li = el('li', 'row unknown'); li.append(el('p', 'small', 'Reasons for NOT YET KNOWN: ' + why.join('; ') + '. Close and reopen the page to try again.')); frag.appendChild(li); }
  ul.appendChild(frag);
  label('check', 'OK', `${nm} MATCH, ${nd} DIFFERS, ${nu} NOT YET KNOWN`);
  fillSummary(); fillQuestions();
}

/* ── summary and questions: filled from what has been read ─────────────────── */
function fillSummary() {
  const L = listing.value; if (!L) return;
  const done = L.versions.map(v => SNAP.get(v)).filter(x => x && x.sum).map(x => x.sum);
  if (!done.length) { $('summary').textContent = `LOAD: ${L.versions.length} numbered snapshots found; reading.`; return; }
  const first = done[0], last = done[done.length - 1];
  $('summary').textContent = `${done.length} of ${L.versions.length} snapshots read. v${G.pad4(first.fileVersion)}${first.generated_at ? ' (' + when(first.generated_at) + ')' : ''}: ${fmt(first.repoCount)} repos, ${fmt(first.fileCount)} files. v${G.pad4(last.fileVersion)}${last.generated_at ? ' (' + when(last.generated_at) + ')' : ''}: ${fmt(last.repoCount)} repos, ${fmt(last.fileCount)} files. Numbered snapshots carry no edges.`;
}
function fillQuestions() {
  if (graph.value) {
    $('q-maptype').textContent = `"${graph.value.mapType ?? 'absent'}"`;
    const f = graph.facts;
    $('q-next').textContent = `graph_latest.json declares ${f.declaredTypes.length} edge types (${f.declaredTypes.join(', ')}) and holds edges of ${Object.keys(f.byType).length}: ${Object.entries(f.byType).map(([k, c]) => `${k} ${c}`).join(', ')}. Declared with no edge at all: ${f.unusedTypes.join(', ') || 'none'}. So every repository is a node, but no dependency, API, schema or data-flow edge between repositories is recorded yet: the next element is that dependency evidence, which the federation map's DATA_CONTRACT.md defines (kernel.json boot_sequence lists it as the "node and edge contract").`;
  }
  const L = listing.value; const newest = L && L.versions[L.versions.length - 1]; const s = newest != null && SNAP.get(newest) && SNAP.get(newest).sum;
  if (s) {
    $('q-geo').textContent = `In v${G.pad4(newest)}: ${fmt(s.types.geojson || 0)} files of type geojson, ${fmt(s.roles['geospatial layer'] || 0)} with role "geospatial layer", ${fmt(s.roles['data contract or schema'] || 0)} with role "data contract or schema", ${fmt(s.types.tabular || 0)} of type tabular. A path is where a layer is, not what it draws.`;
  }
}

/* ── sections open on demand ───────────────────────────────────────────────── */
$('d-go').addEventListener('click', runDiff);
const OPEN = { timeline: openTimeline, diff: openDiff, graph: openGraph, check: openCheck };
for (const d of document.querySelectorAll('details.sec')) {
  d.addEventListener('toggle', () => { if (d.open) OPEN[d.dataset.sec]().catch(e => label(d.dataset.sec, 'FAIL', e.message)); });
}
paintMachine();
window.__growth = { M, queue, SNAP, graph, listing, PIN };
