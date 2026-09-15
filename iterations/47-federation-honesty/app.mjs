// Is Green Earned? Counts the federation map's statuses from its own files and
// checks every green against the evidence its rules ask for. No randomness, no verdict colours.
const REPO = 'Ventusltd/data-federation-map-for-globalgrid2050-all-repos';
const OWNER = 'Ventusltd';
// origin/main of REPO when this page was built (git fetch; git rev-parse origin/main).
const SHA = 'b759a7d2b5ec0dcc233c27db813ceadc5469157d';
const RAW = `https://raw.githubusercontent.com/${REPO}/${SHA}/`;
const HYPARQUET = 'https://cdn.jsdelivr.net/npm/hyparquet@1.30.1/+esm';
// ZSTD only: the contract says zstd Parquet. fzstd is the decoder hyparquet-compressors 1.1.1 uses.
const FZSTD = 'https://cdn.jsdelivr.net/npm/fzstd@0.1.1/+esm';

const P = {
  rules: 'config/status_rules.json',
  rootNodes: 'live_sandbox/federation_control_ledger/data/nodes.json',
  rootEdges: 'live_sandbox/federation_control_ledger/data/edges.json',
  scopeNodes: 'live_sandbox/federation_control_ledger/data/scopes/data-federation/nodes.json',
  scopeEdges: 'live_sandbox/federation_control_ledger/data/scopes/data-federation/edges.json',
  contNodes: 'data/federation_map/contents/provenance=declared/repo=Ventusltd__globalgrid2050/nodes.json',
  contEdges: 'data/federation_map/contents/provenance=declared/repo=Ventusltd__globalgrid2050/edges.json',
  pqNodes: 'data/federation_map/current/nodes.parquet',
  pqEdges: 'data/federation_map/current/edges.parquet',
  report: 'reports/json/FEDERATION_MAP_LATEST.json',
  reportMd: 'reports/FEDERATION_MAP_LATEST.md',
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---- one queue of 4, 15 s timeout, one promise per URL (Grid Atlas FetchQueue) ----
class FetchQueue {
  constructor(n) { this.n = n; this.active = 0; this.waiting = []; }
  run(task) {
    return new Promise((resolve, reject) => {
      this.waiting.push({ task, resolve, reject });
      this.pump();
    });
  }
  pump() {
    while (this.active < this.n && this.waiting.length) {
      const { task, resolve, reject } = this.waiting.shift();
      this.active++;
      task().then(resolve, reject).finally(() => { this.active--; this.pump(); });
    }
  }
}
const queue = new FetchQueue(4);
const urlCache = new Map();
export const fetchStats = { started: 0, maxActive: 0 };
function get(path, kind) {
  const key = kind + ':' + path;
  if (urlCache.has(key)) return urlCache.get(key);
  const p = queue.run(async () => {
    fetchStats.started++;
    fetchStats.maxActive = Math.max(fetchStats.maxActive, queue.active);
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15000);
    try {
      const r = await fetch(RAW + path, { signal: ctl.signal });
      if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
      if (kind === 'json') return await r.json();
      if (kind === 'bin') return await r.arrayBuffer();
      return await r.text();
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? `${path}: no answer in 15 s` : e.message);
    } finally { clearTimeout(t); }
  });
  urlCache.set(key, p);
  p.catch(() => urlCache.delete(key));
  return p;
}
let pqLib = null;
function parquetLib() {
  if (!pqLib) {
    pqLib = Promise.all([import(HYPARQUET), import(FZSTD)]);
    pqLib.catch(() => { pqLib = null; });
  }
  return pqLib;
}
const pqCache = new Map();
function getParquet(path) {
  if (pqCache.has(path)) return pqCache.get(path);
  const p = (async () => {
    const [buf, [hp, fz]] = await Promise.all([get(path, 'bin'), parquetLib()]);
    const compressors = { ZSTD: (input, outputLength) => fz.decompress(input, new Uint8Array(outputLength)) };
    return hp.parquetReadObjects({ file: buf, compressors });
  })();
  pqCache.set(path, p);
  p.catch(() => pqCache.delete(path));
  return p;
}

// ---- pure checks ----
const features = (fc) => (fc && Array.isArray(fc.features) ? fc.features : Array.isArray(fc) ? fc : []);
const nodeProps = (n) => (n && n.properties ? { id: n.id, ...n.properties } : n);
const statusOf = (p) => (p.status ?? p.rag ?? null);
const isExternal = (p) => {
  const id = String(p.id ?? p.nodeId ?? '');
  const kind = String(p.repo_type ?? p.nodeKind ?? p.scope_type ?? '');
  if (p.owner != null) return p.owner !== OWNER;
  if (/external/i.test(kind)) return true;
  if (id.includes('/')) return !id.startsWith(OWNER + '/');
  return false;
};
export function countStatuses(rows) {
  const m = new Map();
  for (const r of rows) { const s = statusOf(r); const k = s == null || s === '' ? '(no status field)' : String(s); m.set(k, (m.get(k) || 0) + 1); }
  return m;
}
const EVIDENCE_KEY = /^evidence/i;
export function greenWithoutEvidence(rows) {
  const green = rows.filter((r) => String(statusOf(r)).toLowerCase() === 'green');
  const without = green.filter((r) => {
    const keys = Object.keys(r).filter((k) => EVIDENCE_KEY.test(k));
    return keys.length === 0 || keys.every((k) => r[k] == null || String(r[k]).trim() === '');
  });
  return { green, without };
}
export function edgeEvidence(edges) {
  let noPath = 0, noText = 0;
  for (const e of edges) {
    const o = Array.isArray(e) ? {} : e;
    if (o.evidencePath == null || String(o.evidencePath).trim() === '') noPath++;
    if (o.evidenceText == null || String(o.evidenceText).trim() === '') noText++;
  }
  return { n: edges.length, noPath, noText };
}
const NODE_REQ = ['scanId', 'nodeId', 'nodeKind', 'repoFullName', 'repoName', 'owner', 'repoType', 'status', 'visibility', 'defaultBranch', 'archived', 'htmlUrl', 'description', 'canonicalFilesPresent', 'generatedUTC'];
const EDGE_REQ = ['scanId', 'edgeId', 'fromNode', 'toNode', 'edgeType', 'cardinality', 'evidencePath', 'evidenceText', 'generatedUTC'];
const blank = (v) => v == null || String(v) === '';
export function invariants(nodes, edges, report) {
  const v = report && report.verification ? report.verification : null;
  const out = [];
  const row = (name, measured, ok, claim, claimAgrees) => {
    let result = ok == null ? 'NOT YET KNOWN' : ok && claimAgrees !== false ? 'MATCH' : 'DIFFERS';
    out.push({ name, measured, claim: claim ?? 'not stated', result });
  };
  if (nodes) {
    const d = new Set(nodes.map((n) => n.scanId + '\u0000' + n.nodeId)).size;
    row('node rows equal distinct scanId + nodeId', `${nodes.length} rows, ${d} distinct`, nodes.length === d,
      v ? `${v.nodeRows} rows, ${v.nodeDistinctKeys} distinct` : null, v ? v.nodeRows === nodes.length && v.nodeDistinctKeys === d : undefined);
    const nk = nodes.filter((n) => blank(n.scanId) || blank(n.nodeId)).length;
    row('node null keys equal zero', `${nk}`, nk === 0, v ? `${v.nodeNullKeys}` : null, v ? v.nodeNullKeys === nk : undefined);
    const cols = new Set(nodes.flatMap((n) => Object.keys(n)));
    const miss = NODE_REQ.filter((f) => !cols.has(f));
    row('required node fields present', miss.length ? `missing: ${miss.join(', ')}` : `all ${NODE_REQ.length} present`, miss.length === 0, null);
  } else ['node rows equal distinct scanId + nodeId', 'node null keys equal zero', 'required node fields present'].forEach((n) => row(n, 'not yet known', null, null));
  if (edges) {
    const d = new Set(edges.map((e) => e.scanId + '\u0000' + e.edgeId)).size;
    row('edge rows equal distinct scanId + edgeId', `${edges.length} rows, ${d} distinct`, edges.length === d,
      v ? `${v.edgeRows} rows, ${v.edgeDistinctKeys} distinct` : null, v ? v.edgeRows === edges.length && v.edgeDistinctKeys === d : undefined);
    const ek = edges.filter((e) => blank(e.scanId) || blank(e.edgeId)).length;
    row('edge null keys equal zero', `${ek}`, ek === 0, v ? `${v.edgeNullKeys}` : null, v ? v.edgeNullKeys === ek : undefined);
    const dk = edges.length - new Set(edges.map((e) => [e.scanId, e.fromNode, e.toNode, e.edgeType, e.evidencePath].join('\u0000'))).size;
    row('edge key scanId + fromNode + toNode + edgeType + evidencePath is unique', `${dk} repeated`, dk === 0, null);
    const cols = new Set(edges.flatMap((e) => Object.keys(e)));
    const miss = EDGE_REQ.filter((f) => !cols.has(f));
    row('required edge fields present', miss.length ? `missing: ${miss.join(', ')}` : `all ${EDGE_REQ.length} present`, miss.length === 0, null);
    if (nodes) {
      const ids = new Set(nodes.map((n) => n.nodeId));
      const dang = edges.filter((e) => !ids.has(e.fromNode) || !ids.has(e.toNode)).length;
      row('edge endpoints exist as nodes (build report check)', `${dang} dangling`, dang === 0, v ? `${v.danglingEdgeEndpoints}` : null, v ? v.danglingEdgeEndpoints === dang : undefined);
    }
  } else ['edge rows equal distinct scanId + edgeId', 'edge null keys equal zero'].forEach((n) => row(n, 'not yet known', null, null));
  out.push({ name: 'Parquet files can be read back by DuckDB', measured: nodes && edges ? 'both read back in this browser by hyparquet; DuckDB is not run here' : 'not yet known', claim: v ? `verificationPassed ${v.verificationPassed}` : 'not stated', result: 'NOT YET KNOWN' });
  return out;
}

// ---- UI state, one label per section, never rebuild the page ----
const STATE = {};
function label(id, state, detail) {
  const el = $('lbl-' + id);
  el.textContent = `${el.dataset.base} [${state}${detail ? ' · ' + detail : ''}]`;
}
function cell(v) { return v == null ? '<span class="dim">not yet known</span>' : esc(v); }
function settle(results) {
  const failed = results.filter((r) => r.status === 'rejected').map((r) => r.reason.message);
  return failed;
}
const sectionFiles = {
  rules: [['json', P.rules]],
  counts: [['json', P.rules], ['json', P.rootNodes], ['json', P.scopeNodes], ['json', P.contNodes], ['pq', P.pqNodes]],
  green: [['json', P.rules], ['json', P.rootNodes], ['json', P.scopeNodes], ['json', P.contNodes], ['pq', P.pqNodes]],
  edges: [['json', P.rootEdges], ['json', P.scopeEdges], ['json', P.contEdges], ['pq', P.pqEdges]],
  inv: [['pq', P.pqNodes], ['pq', P.pqEdges], ['json', P.report], ['text', P.reportMd]],
};
const DATA = {};
async function hydrate(id) {
  const st = STATE[id] || (STATE[id] = {});
  if (st.loaded || st.loading) return;
  st.loading = true;
  label(id, 'LOAD');
  const files = sectionFiles[id];
  const results = await Promise.allSettled(files.map(([k, p]) => (k === 'pq' ? getParquet(p) : get(p, k)).then((d) => { DATA[p] = d; return d; })));
  const failed = settle(results);
  st.loading = false;
  try { render[id](); } catch (e) { failed.push('render: ' + e.message); }
  if (failed.length) { label(id, 'FAIL', failed.join('; ')); st.loaded = false; }
  else { label(id, 'OK'); st.loaded = true; }
  summary();
}

const NODE_FILES = [['root board', P.rootNodes], ['child scope', P.scopeNodes], ['contents', P.contNodes], ['nodes.parquet', P.pqNodes]];
const nodeRows = (p) => (DATA[p] == null ? null : p === P.pqNodes ? DATA[p] : features(DATA[p]).map(nodeProps));
const ruleWords = () => (DATA[P.rules] ? DATA[P.rules].statusOrderWorstFirst || Object.keys(DATA[P.rules].colours || {}) : []);

const render = {
  rules() {
    const r = DATA[P.rules];
    if (!r) return;
    const words = ruleWords();
    $('rules-body').innerHTML = words.map((w) => {
      const c = (r.colours || {})[w] || {};
      return `<tr><td class="word">${esc(w)}</td><td>${cell(c.label)}</td><td>${cell(c.meaning)}</td></tr>`;
    }).join('');
    const green = (r.colours || {}).green;
    const named = JSON.stringify(r).match(/"evidence[A-Za-z]*"\s*:/g);
    $('rules-evidence').textContent = green
      ? `Green is defined as "${green.meaning}". The rules file names no field that holds that evidence${named ? ' (keys found: ' + named.join(' ') + ')' : ''}; ${r.nodeRules ? r.nodeRules.length : 0} node rules set red, amber or blue, and none sets green. DATA_CONTRACT.md names evidence fields only for edges: evidencePath and evidenceText.`
      : 'The rules file defines no green.';
  },
  counts() {
    const words = ruleWords();
    const maps = NODE_FILES.map(([, p]) => { const rows = nodeRows(p); return rows ? countStatuses(rows) : null; });
    const all = [...words];
    maps.forEach((m) => m && [...m.keys()].forEach((k) => { if (!all.includes(k)) all.push(k); }));
    $('counts-body').innerHTML = all.map((w) => {
      const tag = words.length && !words.includes(w) ? ' <span class="dim">(not in status_rules.json)</span>' : '';
      return `<tr><td><span class="word">${esc(w)}</span>${tag}</td>${maps.map((m) => `<td>${m ? m.get(w) || 0 : cell(null)}</td>`).join('')}</tr>`;
    }).join('') + `<tr><th>rows</th>${maps.map((m) => `<td>${m ? [...m.values()].reduce((a, b) => a + b, 0) : cell(null)}</td>`).join('')}</tr>`;
    const ext = NODE_FILES.map(([name, p]) => { const rows = nodeRows(p); return rows ? `${name} ${rows.filter(isExternal).length}` : `${name} not yet known`; });
    $('counts-note').textContent = `Nodes outside the owner's repositories (external sources and services), counted, names not displayed: ${ext.join(' · ')}.`;
    const cont = nodeRows(P.contNodes);
    if (cont) {
      const hits = cont.filter((n) => /sld|cable|grid|atlas/i.test(String(n.id)));
      $('q-draw').textContent = hits.length ? hits.map((n) => `${n.id} (status ${statusOf(n)})`).join(', ') + '.' : 'none found.';
    }
  },
  green() {
    this.rules();
    const body = [], list = [];
    let hidden = 0;
    for (const [name, p] of NODE_FILES) {
      const rows = nodeRows(p);
      if (!rows) { body.push(`<tr><td>${esc(name)}</td><td colspan="3" class="dim">not yet known</td></tr>`); continue; }
      const { green, without } = greenWithoutEvidence(rows);
      const fields = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => k !== 'id');
      const ev = fields.filter((k) => EVIDENCE_KEY.test(k));
      body.push(`<tr><td>${esc(name)}</td><td>${green.length}</td><td>${without.length}</td><td>${ev.length ? 'evidence fields: ' + esc(ev.join(', ')) : 'no evidence field; fields: ' + esc(fields.join(', '))}</td></tr>`);
      for (const n of without) {
        if (isExternal(n)) { hidden++; continue; }
        const id = String(n.id ?? n.nodeId).replace(OWNER + '/', '');
        const why = n.status_reason ?? n.reason ?? null;
        list.push(`<li>green without evidence · ${esc(name)} · <code>${esc(id)}</code>${why ? ' · its stated reason: "' + esc(why) + '"' : ' · no reason given'}</li>`);
      }
    }
    if (hidden) list.push(`<li>green without evidence · ${hidden} node(s) outside the owner's repositories · not displayed</li>`);
    $('green-body').innerHTML = body.join('');
    $('green-list').innerHTML = list.join('');
    $('green-rule').textContent = 'Rule applied: status_rules.json says green means "evidence-complete". A green node earns it here only if it carries a field whose name begins with "evidence" and that field is not empty. A stated reason is not evidence. nodes.parquet uses its own status words, so it may have no green at all.';
  },
  edges() {
    const files = [['root board', P.rootEdges], ['child scope', P.scopeEdges], ['contents', P.contEdges], ['edges.parquet', P.pqEdges]];
    $('edges-body').innerHTML = files.map(([name, p]) => {
      const d = DATA[p];
      if (d == null) return `<tr><td>${esc(name)}</td><td colspan="4" class="dim">not yet known</td></tr>`;
      const edges = Array.isArray(d) ? d : Array.isArray(d.edges) ? d.edges : [];
      const shape = p === P.pqEdges ? 'table rows' : Array.isArray(edges[0]) ? `index array [from, to, type]${d.edge_format ? ' (' + d.edge_format + ')' : ''}` : 'object {' + Object.keys(edges[0] || {}).join(', ') + '}';
      const r = edgeEvidence(edges);
      return `<tr><td>${esc(name)}</td><td>${r.n}</td><td>${r.noPath}</td><td>${r.noText}</td><td>${esc(shape)}</td></tr>`;
    }).join('');
  },
  inv() {
    const rows = invariants(DATA[P.pqNodes] || null, DATA[P.pqEdges] || null, DATA[P.report] || null);
    const rep = DATA[P.report], md = DATA[P.reportMd];
    rows.push({ name: 'workflow writes JSON and Markdown reports', measured: `FEDERATION_MAP_LATEST.json ${rep ? 'present' : 'not yet known'}; FEDERATION_MAP_LATEST.md ${md != null ? 'present' : 'not yet known'} at the commit`, claim: rep ? `dataLawResult ${rep.dataLawResult}, scan ${rep.scanId}` : 'not stated', result: rep && md != null ? 'MATCH' : 'NOT YET KNOWN' });
    $('inv-body').innerHTML = rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.measured)}</td><td>${esc(r.claim)}</td><td class="word">${r.result}</td></tr>`).join('');
    window.__green = Object.assign(window.__green || {}, { invariants: rows });
  },
};

function summary() {
  const parts = [];
  let g = 0, w = 0, known = false;
  for (const [, p] of NODE_FILES) { const rows = nodeRows(p); if (rows) { known = true; const r = greenWithoutEvidence(rows); g += r.green.length; w += r.without.length; } }
  if (known) parts.push(`${g} green node(s) in the node files read so far, ${w} of them green without evidence`);
  let en = 0, ew = 0, ek = false;
  for (const p of [P.rootEdges, P.scopeEdges, P.contEdges, P.pqEdges]) { const d = DATA[p]; if (d != null) { ek = true; const r = edgeEvidence(Array.isArray(d) ? d : d.edges || []); en += r.n; ew += Math.max(r.noPath, r.noText); } }
  if (ek) parts.push(`${ew} of ${en} edges read without evidence`);
  const inv = window.__green && window.__green.invariants;
  if (inv) { const c = (s) => inv.filter((r) => r.result === s).length; parts.push(`invariants ${c('MATCH')} MATCH, ${c('DIFFERS')} DIFFERS, ${c('NOT YET KNOWN')} NOT YET KNOWN`); }
  $('summary').textContent = parts.length ? parts.join(' · ') + '.' : 'WAIT — nothing is fetched until you open a section.';
  window.__green = Object.assign(window.__green || {}, { green: g, greenWithout: w, edges: en, edgesWithout: ew, fetchStats: { ...fetchStats } });
}

$('pin').textContent = SHA;
$('pin2').textContent = SHA;
$('q-code').href = `https://github.com/${REPO}/blob/${SHA}/scripts/build_federation_map.py`;
$('q-app').href = 'https://ventusltd.github.io/data-federation-map-for-globalgrid2050-all-repos/live_sandbox/federation_control_ledger/';
for (const d of document.querySelectorAll('details[data-section]')) {
  d.addEventListener('toggle', () => { if (d.open) hydrate(d.dataset.section); });
}
