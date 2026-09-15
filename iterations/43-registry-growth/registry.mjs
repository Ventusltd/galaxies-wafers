/* How the Estate Grew: the rules. Pure functions over the registry JSON as
   published; no DOM, no network. Every number the page prints comes from here. */

/* Entries that could carry company or customer names are never displayed:
   a repository name or a path segment naming a companies, crm, Companies House
   or customers folder or file. They are counted, and the count is shown with
   the reason. */
const WITHHELD = /(^|[\/_-])(companies|company|crm|companieshouse|companies_house|customers?)([\/_.-]|$)/i;
export const WITHHELD_REASON = 'not displayed: may carry company or customer names';
export function isWithheld(repoName, path) {
  return WITHHELD.test(String(repoName || '')) || (path != null && WITHHELD.test(String(path)));
}

export const pad4 = n => String(n).padStart(4, '0');
export const snapshotName = n => `registry_v${pad4(n)}.json`;
export function versionOfName(name) {
  const m = /^registry_v(\d{4})\.json$/.exec(name || '');
  return m ? Number(m[1]) : null;
}

function bump(o, k) { const key = k == null ? '(none)' : String(k); o[key] = (o[key] || 0) + 1; }
export const edgeKey = e => `${e && e.from} → ${e && e.to} · ${e && e.type}`;

/* One numbered snapshot reduced to what the page keeps: counts, per-repo file
   paths, and whatever the schema actually carries. The parsed JSON is dropped. */
export function summarise(json, fileVersion) {
  const out = {
    fileVersion,
    registry_version: Number.isInteger(json && json.registry_version) ? json.registry_version : null,
    generated_at: typeof (json && json.generated_at) === 'string' ? json.generated_at : null,
    schema_version: (json && json.schema_version) || null,
    topKeys: json && typeof json === 'object' ? Object.keys(json).sort() : [],
    declared: (json && json.totals && typeof json.totals === 'object') ? { ...json.totals } : null,
    repos: new Map(),
    repoCount: 0, fileCount: 0, withheldRepos: 0, withheldFiles: 0,
    states: {}, types: {}, roles: {},
    bootCount: Array.isArray(json && json.boot_sequence) ? json.boot_sequence.length : null,
    edges: Array.isArray(json && json.edges) ? json.edges.length : null,   // null: the schema has no edges field
    edgeKeys: Array.isArray(json && json.edges) ? new Set(json.edges.map(edgeKey)) : null,
  };
  const repos = Array.isArray(json && json.repos) ? json.repos : [];
  for (const r of repos) {
    const name = String(r && r.name);
    const files = Array.isArray(r && r.files) ? r.files : [];
    out.repoCount++;
    out.fileCount += files.length;
    const repoHidden = isWithheld(name, null);
    if (repoHidden) { out.withheldRepos++; out.withheldFiles += files.length; }
    const paths = new Set(); let wf = 0;
    for (const f of files) {
      const p = f && typeof f === 'object' ? f.path : f;
      if (!repoHidden && isWithheld(null, p)) { wf++; out.withheldFiles++; }
      paths.add(String(p));
      if (f && typeof f === 'object') { bump(out.states, f.state); bump(out.types, f.type); bump(out.roles, f.role); }
    }
    out.repos.set(name, {
      role: r.role ?? null, default_branch: r.default_branch ?? null,
      file_count: Number.isInteger(r.file_count) ? r.file_count : null,
      counted: files.length, paths, withheld: repoHidden, withheldFiles: wf,
    });
  }
  return out;
}

/* The difference between two summaries, as sorted lists. */
export function diff(a, b) {
  const added = [], removed = [], growth = [], filesAdded = [], filesRemoved = [];
  let withheldRepos = 0, withheldFiles = 0;
  const names = new Set([...a.repos.keys(), ...b.repos.keys()]);
  for (const n of [...names].sort((x, y) => x.localeCompare(y))) {
    const ra = a.repos.get(n), rb = b.repos.get(n);
    const hidden = isWithheld(n, null);
    if (ra && !rb) { if (hidden) withheldRepos++; else removed.push({ name: n, files: ra.counted }); }
    if (!ra && rb) { if (hidden) withheldRepos++; else added.push({ name: n, files: rb.counted }); }
    const ca = ra ? ra.counted : 0, cb = rb ? rb.counted : 0;
    if (!hidden) growth.push({ name: n, from: ra ? ca : null, to: rb ? cb : null, delta: cb - ca });
    const pa = ra ? ra.paths : new Set(), pb = rb ? rb.paths : new Set();
    for (const p of pb) if (!pa.has(p)) { if (hidden || isWithheld(null, p)) withheldFiles++; else filesAdded.push({ name: n, path: p }); }
    for (const p of pa) if (!pb.has(p)) { if (hidden || isWithheld(null, p)) withheldFiles++; else filesRemoved.push({ name: n, path: p }); }
  }
  growth.sort((x, y) => (y.delta - x.delta) || x.name.localeCompare(y.name));
  let edges;
  if (a.edgeKeys && b.edgeKeys) {
    edges = {
      added: [...b.edgeKeys].filter(k => !a.edgeKeys.has(k)).sort(),
      removed: [...a.edgeKeys].filter(k => !b.edgeKeys.has(k)).sort(),
    };
  } else {
    const missing = [a, b].filter(s => !s.edgeKeys).map(s => `v${pad4(s.fileVersion)}`);
    edges = { empty: `${missing.join(' and ')} ${missing.length > 1 ? 'have' : 'has'} no edges field: a numbered snapshot records repositories and files only` };
  }
  return { added, removed, growth, filesAdded, filesRemoved, edges, withheldRepos, withheldFiles };
}

/* "152 files · main", as scripts/build_graph_latest.py writes a repo node's subtitle */
export function parseRepoSubtitle(s) {
  const m = /^(\d+) files · (.+)$/.exec(String(s || ''));
  return m ? { files: Number(m[1]), branch: m[2] } : null;
}

/* Graph facts counted from graph_latest.json */
export function graphFacts(g) {
  const nodes = Array.isArray(g && g.nodes) ? g.nodes : [];
  const edges = Array.isArray(g && g.edges) ? g.edges : [];
  const ids = new Set(nodes.map(n => n.id));
  const byType = {};
  let dangling = 0;
  for (const e of edges) { bump(byType, e.type); if (!ids.has(e.from) || !ids.has(e.to)) dangling++; }
  const declaredTypes = g && g.edgeTypes && typeof g.edgeTypes === 'object' ? Object.keys(g.edgeTypes) : [];
  const unusedTypes = declaredTypes.filter(t => !byType[t]);
  const repoNodes = nodes.filter(n => String(n.id).startsWith('repo::'));
  const fileNodes = nodes.filter(n => String(n.id).startsWith('file::'));
  return { nodes: nodes.length, edges: edges.length, byType, dangling, declaredTypes, unusedTypes, repoNodes, fileNodes };
}

/* repo and path named by a graph node id: "repo::<name>" or "file::<name>::<path>" */
export function parseNodeId(id) {
  const s = String(id || '');
  if (s.startsWith('repo::')) return { kind: 'repo', repo: s.slice(6), path: null };
  if (s.startsWith('file::')) { const rest = s.slice(6); const i = rest.indexOf('::'); return i < 0 ? { kind: 'file', repo: rest, path: null } : { kind: 'file', repo: rest.slice(0, i), path: rest.slice(i + 2) }; }
  return { kind: 'other', repo: null, path: null };
}

/* A check: MATCH, DIFFERS, or NOT YET KNOWN when either side could not be read */
export function check(label, a, b, how) {
  if (a === undefined || b === undefined || a === null || b === null) return { label, status: 'NOT YET KNOWN', a, b, how };
  return { label, status: a === b ? 'MATCH' : 'DIFFERS', a, b, how };
}
