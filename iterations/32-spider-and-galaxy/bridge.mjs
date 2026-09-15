/* bridge.mjs — one universe, two views: how a spider node is read as a place
 * in the numbered universe, and back. No DOM and no fetch, so the page and the
 * tests import the same code.
 *
 * A spider node can name the numbered universe in three ways, tried in this
 * order, and the method used is always reported with the answer:
 *   1. a numbered function family: id "family:N" or a link carrying ?family=N
 *   2. a register block: id "block:X", a label carrying "block:X", or ?block=X
 *   3. a repository and path: id "Ventusltd/repo" or "repo:Ventusltd/repo", the
 *      contents cartridge's own path field (repository globalgrid2050), or a
 *      github.com/Ventusltd/<repo>/(blob|tree)/<ref>/<path> link
 * Anything else names nothing the numbered universe can hold.
 */

/* The spider's own normalisation (index.html normaliseGenericGraph and
   reshapeNodes), reproduced for reading, plus the one thing the spider does
   not report: edges whose ends name no node, which it drops without saying so. */
export function readGraph(raw, edgesRaw) {
  const rawNodes = Array.isArray(raw) ? raw
    : Array.isArray(raw?.nodes) ? raw.nodes
    : Array.isArray(raw?.features) ? raw.features.map(f => ({ id: f.id, ...(f.properties || {}) })) : [];
  const ids = new Map();
  const nodes = rawNodes.map((n, i) => {
    const id = n.id !== undefined ? n.id : i;
    ids.set(id, i);
    return {
      id, label: String(n.label || n.title || id),
      type: n.type || n.nodeKind || n.repo_type || 'unknown',
      rag: n.rag || n.status || 'grey',
      reason: String(n.reason || n.status_reason || n.path || ''),
      gh: n.gh || null, ext: n.ext || n.public_url || null,
      path: typeof n.path === 'string' ? n.path : null
    };
  });
  let src = edgesRaw ?? raw;
  const rawEdges = Array.isArray(src) && edgesRaw ? src
    : Array.isArray(src?.edges) ? src.edges : Array.isArray(src?.links) ? src.links : [];
  const edges = []; let dangling = 0;
  const end = (x, arr) => (arr && typeof x === 'number') ? (x >= 0 && x < nodes.length ? x : -1) : (ids.has(x) ? ids.get(x) : -1);
  for (const e of rawEdges) {
    const arr = Array.isArray(e);
    const a = arr ? e[0] : (e.from ?? e.source), b = arr ? e[1] : (e.to ?? e.target);
    const ia = end(a, arr), ib = end(b, arr);
    if (ia < 0 || ib < 0) { dangling++; continue; }
    edges.push([ia, ib, (arr ? e[2] : e.type) || 'repo']);
  }
  return { nodes, edges, rawEdges: rawEdges.length, dangling };
}

const GH = /^https:\/\/github\.com\/(Ventusltd\/[^/?#]+)(?:\/(?:blob|tree)\/[^/]+\/([^?#]*))?/;

/* What a node names. graphId matters only for the contents cartridge, whose
   path field is relative to the globalgrid2050 repository (its manifest says so). */
export function nodeRefs(graphId, n) {
  const hay = [String(n.id), n.label, n.gh || '', n.ext || ''].join(' ');
  let m = /(?:^|[^a-z])family[:=](\d+)/.exec(hay);
  if (m) return { kind: 'family', family: Number(m[1]), method: 'family number in the node id or link' };
  m = /block[:=]([A-Za-z][A-Za-z0-9]{0,5})\b/.exec(hay);
  if (m) return { kind: 'block', block: m[1], method: 'block symbol in the node id, label or link' };
  const id = String(n.id);
  m = /^(?:repo:)?(Ventusltd\/[A-Za-z0-9._-]+)$/.exec(id);
  if (m) return { kind: 'path', repo: m[1], path: '', method: 'repository named by the node id' };
  if (graphId === 'globalgrid2050-contents' && n.path !== null)
    return { kind: 'path', repo: 'Ventusltd/globalgrid2050', path: n.path, method: 'contents cartridge path (repository globalgrid2050)' };
  m = GH.exec(n.gh || '');
  if (m) return { kind: 'path', repo: m[1], path: decodeURIComponent(m[2] || ''), method: 'GitHub link on the node' };
  return { kind: 'none', method: 'names no family, block, repository or path' };
}

/* Index the live block register: repository -> [{path, symbol}], symbol -> block. */
export function indexRegister(register) {
  const byRepo = new Map(), bySymbol = new Map();
  for (const b of register.blocks || []) {
    bySymbol.set(b.symbol, b);
    for (const f of b.files || []) {
      if (!byRepo.has(f.repo)) byRepo.set(f.repo, []);
      byRepo.get(f.repo).push({ path: f.path, symbol: b.symbol });
    }
  }
  return { byRepo, bySymbol, generated: register.generated_utc, blocks: (register.blocks || []).length };
}

/* A register file lies under a node's path: the node names the whole repo, the
   exact file, or a folder the file is inside. */
export function pathCovers(nodePath, filePath) {
  const p = String(nodePath || '').replace(/^\/+/, '');
  if (!p) return true;
  if (filePath === p) return true;
  return filePath.startsWith(p.endsWith('/') ? p : p + '/');
}

/* The galaxy's answer for one node. families: Map n -> family, or null while
   the family index has not been asked for. */
export function counterpart(refs, reg, families) {
  if (refs.kind === 'family') {
    if (!families) return { state: 'pending', why: 'family ' + refs.family + ' needs the family index, which loads only when asked' };
    const f = families.get(refs.family);
    if (!f) return { state: 'unknown', why: 'family ' + refs.family + ' is not in the numbered database' };
    return { state: 'known', family: f, blocks: f.block ? [f.block] : [], why: 'numbered family ' + f.n + ' ' + f.name + (f.block ? ', block ' + f.block : '') };
  }
  if (refs.kind === 'block') {
    const b = reg.bySymbol.get(refs.block);
    if (!b) return { state: 'unknown', why: 'block ' + refs.block + ' is not in the live register' };
    return { state: 'known', blocks: [b.symbol], why: 'register block ' + b.symbol + ' #' + b.number + ' ' + b.title };
  }
  if (refs.kind === 'path') {
    const files = reg.byRepo.get(refs.repo);
    if (!files) return { state: 'unknown', why: 'the live register records no file in ' + refs.repo };
    const hit = files.filter(f => pathCovers(refs.path, f.path));
    if (!hit.length) return { state: 'unknown', why: 'the live register records ' + files.length + ' file(s) in ' + refs.repo + ', none at or under "' + refs.path + '"' };
    const blocks = [...new Set(hit.map(h => h.symbol))];
    return { state: 'known', blocks, files: hit, why: hit.length + ' register file(s) in ' + refs.repo + (refs.path ? ' under "' + refs.path + '"' : '') + ', blocks ' + blocks.join(', ') };
  }
  return { state: 'none', why: 'the node ' + refs.method };
}

/* The reverse: which nodes of a graph name a block (by symbol, by a register
   file of that block, or by a family the block carries). */
export function nodesForBlock(symbol, family, graphId, nodes, reg) {
  const b = reg.bySymbol.get(symbol);
  const files = b ? (b.files || []) : [];
  const out = [];
  nodes.forEach((n, i) => {
    const r = nodeRefs(graphId, n);
    if (r.kind === 'block' && r.block === symbol) out.push([i, 'names block ' + symbol]);
    else if (r.kind === 'family' && family != null && r.family === family) out.push([i, 'names family ' + family]);
    else if (r.kind === 'path' && files.some(f => f.repo === r.repo && pathCovers(r.path, f.path)))
      out.push([i, 'names ' + r.repo + (r.path ? '/' + r.path : '') + ', where block ' + symbol + ' has a file']);
  });
  return out;
}
