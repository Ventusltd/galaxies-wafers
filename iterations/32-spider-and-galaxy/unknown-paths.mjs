/* unknown-paths.mjs — why a spider repository or path is unknown to the
 * numbered universe, measured, never guessed. No DOM and no fetch, so the page
 * and the tests import the same code.
 *
 * A path is "unknown" when the bridge (bridge.mjs counterpart) finds no file of
 * the live block register at or under it. Each unknown is put in the first
 * class that measures true, in this order:
 *   1 not code by file type: its extension is not one the numbered database
 *     reads. The extensions it reads are measured from the pack's own source
 *     (every place path of every family in the code-index buckets the pack's
 *     provenance.json lists), not typed here.
 *   2 in a repository the pack does not scan: no place of any family lies in
 *     that repository.
 *   3 in a scanned repository, absent from the pack: no place at that path
 *     (or, for a folder or a path with no extension, under it).
 *   4 held by the pack: a family has a place there; only the live register
 *     records no block file for it.
 */

export function extOf(path) {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(path || '').split('/').pop() || '');
  return m ? m[1].toLowerCase() : null;
}

/* The shape of what a node names: a whole repository, a folder, or a file. */
export function shapeOf(n, ref) {
  if (!ref.path) return 'repository';
  if (ref.path.endsWith('/') || /\/tree\//.test(n.gh || '')) return 'folder';
  return extOf(ref.path) ? 'file' : 'path with no extension';
}

/* An index of the places of a code-index generation. */
export function newIndex() { return { repos: new Map(), paths: new Set(), exts: new Map(), sorted: null, families: 0, places: 0, short: 0, maxPlaces: 0 }; }

/* Add one code-index bucket ({ "<n>": { places: [{repo, path}] } }). */
export function addBucket(ix, bucket) {
  for (const f of Object.values(bucket || {})) {
    ix.families++;
    const pl = Array.isArray(f?.places) ? f.places.length : 0;
    ix.maxPlaces = Math.max(ix.maxPlaces, pl);
    if (Number.isFinite(f?.files) && f.files > pl) ix.short++;   /* a family listing fewer places than files it is in */
    for (const p of f?.places || []) {
      if (!p?.repo || typeof p.path !== 'string') continue;
      const r = p.repo.toLowerCase();
      ix.places++;
      ix.repos.set(r, (ix.repos.get(r) || 0) + 1);
      ix.paths.add(r + '\t' + p.path);
      const e = extOf(p.path);
      if (e) ix.exts.set(e, (ix.exts.get(e) || 0) + 1);
    }
  }
  ix.sorted = null;
}

/* Is there a place at this path, or (folder) under it? */
export function holds(ix, repo, path, shape) {
  const r = repo.toLowerCase();
  if (!ix.repos.has(r)) return false;
  if (shape === 'repository') return true;
  const p = path.replace(/\/+$/, '');
  if (shape !== 'folder' && ix.paths.has(r + '\t' + p)) return true;
  if (shape === 'file') return false;
  if (!ix.sorted) ix.sorted = [...ix.paths].sort();
  const pre = r + '\t' + p + '/';
  let lo = 0, hi = ix.sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (ix.sorted[mid] < pre) lo = mid + 1; else hi = mid; }
  return lo < ix.sorted.length && ix.sorted[lo].startsWith(pre);
}

export const CLASS_TEXT = {
  1: 'The numbered database numbers the lines of source files it reads, and this extension is not one of them, so the path can never be numbered by design.',
  2: 'Code or a folder in a repository the numbered database does not scan: no function family in the pack has a place anywhere in that repository.',
  3: 'In a repository the pack scans, but no function family in the pack has a place at this path (or under it, for a folder).',
  4: 'Held by the pack: a function family has a place at this path, or the repository is scanned. Only the live block register records no block file here, which is what made the bridge call it unknown.'
};

/* Put one unknown in its class. item: {repo, path, shape}. */
export function classify(item, pack) {
  const e = item.shape === 'file' ? extOf(item.path) : null;
  if (e && !pack.exts.has(e)) return { cls: 1, why: `.${e} is not an extension the pack reads (it reads ${[...pack.exts.keys()].map(x => '.' + x).join(', ')})` };
  if (!pack.repos.has(item.repo.toLowerCase())) return { cls: 2, why: `no family in the pack has a place in ${item.repo}` };
  if (!holds(pack, item.repo, item.path, item.shape)) return { cls: 3, why: `${item.repo} is scanned (${pack.repos.get(item.repo.toLowerCase())} places), none ${item.shape === 'file' ? 'at' : 'at or under'} this ${item.shape}` };
  return { cls: 4, why: item.shape === 'repository' ? `the pack scans ${item.repo}` : `the pack has a place ${item.shape === 'file' ? 'at' : 'under'} this ${item.shape}` };
}
