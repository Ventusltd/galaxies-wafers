/* The same checks proof/layers.html runs in a browser, run under Node with no
 * browser, reading the layers from this repository and the numbered database
 * from the globalgrid2050 checkout beside it.
 *
 * Run: node proof/layers.check.mjs   (from the repository root)
 * The database directory defaults to ../globalgrid2050/testcode/202609142202/data/
 * relative to the repository; set WAFER_DATA to point elsewhere.
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { buildLayerChecks } from './layers.checks.mjs';

const REPO = new URL('../', import.meta.url);
const D = process.env.WAFER_DATA
  ? pathToFileURL(process.env.WAFER_DATA.replace(/[\\/]?$/, '/'))
  : new URL('../globalgrid2050/testcode/202609142202/data/', REPO);

const json = u => JSON.parse(fs.readFileSync(u).toString('utf8'));
const b = fs.readFileSync(new URL('all-lines.bin', D));
const keys = new Uint32Array(b.buffer, b.byteOffset, b.byteLength / 4);

const manifest = json(new URL('layers/manifest.json', REPO));
const layers = new Map();
for (const l of manifest.layers) {
  try { layers.set(l.id, json(new URL(l.file, REPO))); } catch { /* the check names it */ }
}

const checks = buildLayerChecks({ manifest, layers, keys });
const failures = [];
let passed = 0;
for (const [name, fn] of checks) {
  let ok = false;
  try { ok = fn() === true; } catch (e) { failures.push(name + ' — threw: ' + e.message); continue; }
  if (ok) passed++; else failures.push(name);
}

if (failures.length) {
  console.error('layers proof FAILED (' + failures.length + ' of ' + checks.length + '):\n- '
    + failures.join('\n- '));
  process.exit(1);
}
console.log('layers proof PASS — ' + passed + ' checks');
export default { status: 'PASS', checks: passed };
