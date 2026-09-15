/* atlas-join.mjs — the shared keys between a spider node and Grid Atlas,
 * read from evidence only. No DOM and no fetch, so the page and the tests
 * import the same code.
 *
 * THE JOIN. A spider node joins Grid Atlas when one of its links names a Grid
 * Atlas cartridge, cartridge part, composition manifest or config file, and
 * that file, read as served, declares a layer id that the Grid Atlas v9
 * release config also declares. Declared means one of these written forms,
 * and nothing else:
 *   config entry     { id: "<id>", label: "...", type or url: ... } on one
 *                    line: the ukConfig / GROUPS shape
 *   layer constant   a constant whose name carries LAYER_ID, LAYER_IDS or
 *                    LAYERS, assigned string literals (for an object, its values)
 *   control attr     data-layer-id="<id>"
 *   engine name      an 'l-<id>' string literal: the engine names every config
 *                    layer `l-${id}` (repd_grid_atlasv8/ventus-corev8engine.js,
 *                    the visibility toggle), so 'l-subs' declares layer subs
 * A GitHub link carrying #La-Lb is read over those lines only. Comment lines
 * (starting with //, /* or *) are not read.
 */

export const ATLAS_URL = /gridatlas|grid_atlas|repd_grid_atlas|\/atlas\//i;

/* Every URL a node carries: its gh and ext links and any URL in its reason. */
export function nodeUrls(n) {
  const raw = [n.gh, n.ext, ...(String(n.reason || '').match(/https?:\/\/[^\s"'<>)]+/g) || [])];
  return [...new Set(raw.filter(Boolean).map(u => String(u).replace(/[.,;]+$/, '')))];
}
export const atlasUrls = n => nodeUrls(n).filter(u => ATLAS_URL.test(u));

/* What kind of Grid Atlas file a URL names, and where its bytes are served.
   null when it names no cartridge, part, manifest or config file. */
export function atlasFile(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!ATLAS_URL.test(url)) return null;
  let repo = null, ref = null, path = null, raw = null;
  const gh = u.hostname === 'github.com' ? /^\/(Ventusltd\/[^/]+)\/blob\/([^/]+)\/(.+)$/.exec(u.pathname) : null;
  if (gh) { [, repo, ref, path] = gh; path = decodeURIComponent(path); raw = `https://raw.githubusercontent.com/${repo}/${ref}/${path}`; }
  else if (u.hostname === 'ventusltd.github.io') { path = decodeURIComponent(u.pathname.replace(/^\//, '')); raw = u.origin + u.pathname; }
  else return null;
  let kind = null;
  if (/\/cartridges\/[^/]+\.m?js$/.test(path)) kind = 'cartridge';
  else if (/(^|\/)atlas\/parts\/[^/]+\.m?js$/.test(path)) kind = 'cartridge part';
  else if (/(^|\/)manifests\/[^/]+\.json$/.test(path)) kind = 'composition manifest';
  else if (/(^|\/)[^/]*config[^/]*\.(json|m?js)$/i.test(path) || /(^|\/)(atlas\/(releases\/[^/]+\/)?|repd_grid_atlasv\d+\/)(index\.html)?$/.test(path)) kind = 'config';
  if (!kind) return null;
  const L = /^#L(\d+)(?:-L(\d+))?$/.exec(u.hash);
  const lines = L ? [Number(L[1]), Number(L[2] || L[1])] : null;
  const pinned = ref ? /^[0-9a-f]{40}$/.test(ref) : false;
  return { kind, raw, repo, ref, path, lines, pinned };
}

const LIT = /(['"`])([^'"`\\\n]{1,80})\1/g;

/* id -> Set of declaration forms, from a file's text (optionally a line range). */
export function declaredLayerIds(text, lines) {
  let t = String(text);
  let rows = t.split('\n');
  if (lines) rows = rows.slice(lines[0] - 1, lines[1]);
  /* comment lines declare nothing: they are blanked before reading */
  t = rows.map(r => (/^\s*(\/\/|\/\*|\*)/.test(r) ? '' : r)).join('\n');
  const out = new Map();
  const add = (id, form) => {
    id = String(id).trim();
    if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,60}$/.test(id)) return;
    if (!out.has(id)) out.set(id, new Set());
    out.get(id).add(form);
  };
  for (const m of t.matchAll(/\{\s*id:\s*["']([^"']+)["']\s*,\s*label:\s*(?:"[^"\n]*"|'[^'\n]*')\s*,[^\n}]*\b(?:type|url)\s*:/g)) add(m[1], 'config entry');
  for (const m of t.matchAll(/\b([A-Z][A-Z0-9_]*(?:LAYER_IDS?|LAYERS)[A-Z0-9_]*)\s*=\s*([^;]{1,600})/g)) {
    const init = m[2];
    const head = init.trimStart();
    /* only literal initialisers declare: a string, an array, a Set or an object of literals */
    if (!/^(['"`]|\[|new Set\(\s*\[|Object\.freeze\(\s*[\[{]|\{)/.test(head)) continue;
    const obj = /^(?:Object\.freeze\(\s*)?\{([\s\S]*?)\}/.exec(head);
    const vals = obj ? [...obj[1].matchAll(/:\s*(['"`])([^'"`\\\n]{1,80})\1/g)].map(x => x[2])
      : /^['"`]/.test(head) ? [head.match(/^(['"`])([^'"`\\\n]{1,80})\1/)?.[2]].filter(Boolean)
      : [...(head.match(/^[^\]]*\]/)?.[0] || '').matchAll(LIT)].map(x => x[2]);
    for (const v of vals) add(/^l-/.test(v) ? v.slice(2) : v, 'layer constant ' + m[1]);
  }
  for (const m of t.matchAll(/data-layer-id\s*=\s*\\?["']([A-Za-z0-9_.-]+)\\?["']/g)) add(m[1], 'control attribute data-layer-id');
  for (const m of t.matchAll(/(['"])l-([A-Za-z0-9_]+)\1/g)) add(m[2], "engine layer name 'l-<id>'");
  return out;
}

/* The Grid Atlas v9 release config: its ukConfig entries' ids, in order. */
export function configLayerIds(html) {
  return [...declaredLayerIds(html)].filter(([, f]) => f.has('config entry')).map(([id]) => id);
}

/* The canonical receiver link a node's MAP button may open, built only from
   parameters the deep-link contract accepts. */
export function receiverLink(contract, receivers) {
  const route = receivers?.canonical?.route || contract.CANONICAL_RECEIVER;
  const params = Object.keys(contract.PARAMS);
  const layerParam = params.find(p => /layer/i.test(p)) || null;
  return {
    href: route, params, layerParam, identity: contract.IDENTITY_PARAM,
    agrees: route === contract.CANONICAL_RECEIVER,
    why: layerParam ? `the contract accepts ${layerParam}`
      : `the deep-link contract accepts ${params.join(', ')}; none is a layer id (technology is "${contract.PARAMS.technology?.note || 'a bucket'}"), and ${contract.IDENTITY_PARAM} is required, which no spider node carries, so the link opens the receiver with no parameters and the layer is ticked there by hand`
  };
}

/* For a layer id the contract knows, the buckets that resolve to it. */
export function bucketsForLayer(contract, id) {
  return contract.BUCKETS.filter(b => contract.layerIdForBucket(b) === id);
}
