/* link.mjs — what a link into this page asks for, read strictly. No DOM, no
 * fetch, so the page and the tests import the same code.
 *
 * Parameters this page reads (iteration 36's SPIDER button sends graph, key,
 * repo and path; node is written back by this page on a manual tap):
 *   graph=<id>                 a graph id of the spider manifest
 *   node=<id>                  a node id of that graph (exact)
 *   key=block:<Symbol>         a register block
 *   key=family:<n>             a numbered function family
 *   key=line:<n>               a permanently numbered line
 *   repo=<owner>/<name>        a repository, optionally with
 *   path=<path>                a file or folder inside it
 * Anything else, or any of these in a shape the page cannot use, is returned
 * as a warning sentence naming the parameter, so it is shown, never dropped.
 */
export const PARAMS = Object.freeze(['graph', 'node', 'key', 'repo', 'path']);

export function parseKey(raw) {
  let m = /^block:([A-Za-z][A-Za-z0-9]{0,5})$/.exec(raw);
  if (m) return { kind: 'block', block: m[1], raw };
  m = /^family:(\d{1,9})$/.exec(raw);
  if (m) return { kind: 'family', family: Number(m[1]), raw };
  m = /^line:(\d{1,10})$/.exec(raw);
  if (m && Number(m[1]) <= 0xffffffff) return { kind: 'line', line: Number(m[1]), raw };
  return null;
}

export function readLink(search, graphIds) {
  const q = new URLSearchParams(search);
  const out = { warnings: [], asked: [] };
  const seen = new Set(q.keys());
  for (const k of seen) {
    if (!PARAMS.includes(k)) out.warnings.push(`?${k}=${q.get(k)} is not a parameter this page reads (it reads ${PARAMS.join(', ')}); it was not used`);
    else if (q.getAll(k).length > 1) out.warnings.push(`?${k}= was given ${q.getAll(k).length} times; only the first, "${q.get(k)}", was used`);
  }
  const val = k => { const v = q.get(k); if (v === null) return null; if (v.trim() === '') { out.warnings.push(`?${k}= is empty; it was not used`); return null; } return v.trim(); };
  const graph = val('graph');
  if (graph !== null) {
    if (graphIds.includes(graph)) out.graph = graph;
    else out.warnings.push(`graph=${graph} is not a graph of the spider manifest (${graphIds.length} graphs listed); the default graph is drawn instead`);
  }
  const node = val('node');
  if (node !== null) { out.node = node; out.asked.push('node=' + node); }
  const key = val('key');
  if (key !== null) {
    const k = parseKey(key);
    if (k) { out.key = k; out.asked.push('key=' + key); }
    else out.warnings.push(`key=${key} is malformed: this page reads key=block:<Symbol>, key=family:<number> or key=line:<number>; it was not used`);
  }
  const repo = val('repo');
  if (repo !== null) {
    if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) && !repo.split('/').includes('..')) out.repo = repo;
    else out.warnings.push(`repo=${repo} is malformed: this page reads repo=<owner>/<name>; it was not used`);
  }
  const path = val('path');
  if (path !== null) {
    const p = path.replace(/^\/+/, '');
    if (p.split('/').some(s => s === '..' || s === '.')) out.warnings.push(`path=${path} is malformed: a path may not contain "." or ".." segments; it was not used`);
    else if (!out.repo) out.warnings.push(`path=${path} needs a well-formed repo= beside it to name a file; it was not used`);
    else out.path = p;
  }
  if (out.repo) out.asked.push('repo=' + out.repo + (out.path ? ' path=' + out.path : ''));
  return out;
}
