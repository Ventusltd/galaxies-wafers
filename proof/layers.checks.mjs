/* The checks behind the layers, written once and run in two places:
 * proof/layers.html runs them in a browser, proof/layers.check.mjs runs them
 * under Node with no browser. Both read the same layer files the LAYERS panel
 * reads and the same all-lines.bin the wafer reads.
 *
 * A check takes no arguments and returns true or false. Its name is the claim.
 */

/* The page's own binary search, not a copy of it. */
import { indexOfKey } from '../lib.mjs';
export { indexOfKey };

export const SUBSTRATE = 'wafer.v1';

/* Every key a feature names, or null when the geometry is not one the format allows. */
function keysOf(g) {
  if (!g || typeof g !== 'object') return null;
  if (g.type === 'Point') return Number.isInteger(g.key) ? [g.key] : null;
  if (g.type === 'LineString') return Array.isArray(g.keys) && g.keys.length >= 2
    && g.keys.every(Number.isInteger) ? g.keys : null;
  return null;
}

/* manifest: layers/manifest.json. layers: Map id -> parsed layer file. keys: Uint32Array of all-lines.bin. */
export function buildLayerChecks({ manifest, layers, keys }) {
  const checks = [
    [`the manifest names substrate ${SUBSTRATE}, the frozen wafer, and lists at least one layer`,
      () => manifest.substrate === SUBSTRATE && Array.isArray(manifest.layers) && manifest.layers.length > 0]
  ];

  for (const entry of manifest.layers) {
    const id = entry.id;
    const doc = () => { const d = layers.get(id); if (!d) throw new Error('layer file not loaded'); return d; };

    checks.push(
      [`${id}: names substrate ${SUBSTRATE}, so its keys are placed by the frozen law and nothing else`,
        () => doc().substrate === SUBSTRATE],

      [`${id}: stats.features equals the number of features actually in the file`,
        () => doc().stats?.features === doc().features.length],

      [`${id}: every provenance source carries a sha256, a blob_sha1 or a url, so it can be traced`,
        () => { const s = doc().provenance?.sources;
                return Array.isArray(s) && s.length > 0 && s.every(x =>
                  (typeof x.sha256 === 'string' && /^[0-9a-f]{64}$/.test(x.sha256))
                  || (typeof x.blob_sha1 === 'string' && /^[0-9a-f]{40}$/.test(x.blob_sha1))
                  || (typeof x.url === 'string' && x.url.length > 0)); }],

      [`${id}: no feature geometry carries coordinates, which would breach the frozen-substrate rule`,
        () => doc().features.every(f => f.geometry && !Object.prototype.hasOwnProperty.call(f.geometry, 'coordinates'))],

      [`${id}: every key every feature names exists in the numbered database (binary search of all-lines.bin)`,
        () => { for (const f of doc().features) {
                  const ks = keysOf(f.geometry);
                  if (!ks) return false;
                  for (const k of ks) if (indexOfKey(keys, k) < 0) return false;
                } return true; }]
    );
  }
  return checks;
}
