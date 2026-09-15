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
import { buildLayerChecks, manifestChecks } from './layers.checks.mjs';

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

/* negative regression: the exact stale entry Codex reproduced at 3ac640e must FAIL these checks */
const crypto = await import('node:crypto');
const readBytes = f => fs.readFileSync(new URL(f, REPO));
const sha256hex = async x => crypto.createHash('sha256').update(x).digest('hex');
{
  const stale = JSON.parse(JSON.stringify(manifest));
  const learned = stale.layers.find(l => l.id === 'learned');
  Object.assign(learned, { features: 0, bytes: 1514, sha256: 'b3878271c152c1df84bdfb3bbd447890a75d370d2eda3ef9b87892c6d36413a1' });
  const sc = await manifestChecks(stale, readBytes, sha256hex);
  const failed = [];
  for (const [name, fn] of sc) { if ((await fn()) !== true) failed.push(name); }
  const expect = ["manifest learned: features equals the file's feature count", "manifest learned: bytes equals the file's byte length", "manifest learned: sha256 equals the file's digest"];
  if (failed.length !== 3 || !expect.every(e => failed.includes(e))) {
    console.error('stale fixture did not fail as expected: ' + JSON.stringify(failed));
    process.exit(1);
  }
  console.log('stale-manifest fixture FAILS as required (3 of ' + sc.length + '): ' + failed.join('; '));
}

/* manifest integrity, run after the per-layer checks */
{
  const mc = await manifestChecks(manifest, readBytes, sha256hex);
  let mp = 0; const mf = [];
  for (const [name, fn] of mc) {
    let ok = false;
    try { ok = (await fn()) === true; } catch (e) { mf.push(name + ' - threw: ' + e.message); continue; }
    ok ? mp++ : mf.push(name);
  }
  if (mf.length) {
    console.error('manifest proof FAILED (' + mf.length + ' of ' + mc.length + '):\n- ' + mf.join('\n- '));
    process.exit(1);
  }
  console.log('manifest proof PASS — ' + mp + ' checks');
}

/* EVERY LAYER FILE IS LISTED OR OWNED. A file in layers/ that the manifest does not
   list is checked by nothing above (found by iteration 42's count audit: tunnels.json).
   Each such file must be named here with its owner and reason, or this proof fails.
   A negative case runs first: an unlisted, unowned name must be reported. */
{
  const OWNED_OUTSIDE_MANIFEST = {
    'tunnels.json': 'written by iteration 02 (commit 4cc78de) for its own manifest copy; not a root layer',
  };
  const listed = new Set(manifest.layers.map(l => l.file.split('/').pop()).filter((_, i) => manifest.layers[i].file.split('/').length === 2));
  const unaccounted = names => names.filter(n => n.endsWith('.json') && n !== 'manifest.json' && !listed.has(n) && !(n in OWNED_OUTSIDE_MANIFEST));
  if (unaccounted(['definitely-unlisted.json']).length !== 1) { console.error('orphan-file fixture did not fail as required'); process.exit(1); }
  const present = fs.readdirSync(new URL('layers/', REPO)).filter(n => fs.statSync(new URL('layers/' + n, REPO)).isFile());
  const orphans = unaccounted(present);
  const staleOwned = Object.keys(OWNED_OUTSIDE_MANIFEST).filter(n => !present.includes(n));
  if (orphans.length || staleOwned.length) {
    console.error('layer files proof FAILED: unlisted and unowned ' + JSON.stringify(orphans) + '; owned but absent ' + JSON.stringify(staleOwned));
    process.exit(1);
  }
  console.log(`layer files proof PASS — ${present.length} files: ${listed.size} listed in the manifest, ${Object.keys(OWNED_OUTSIDE_MANIFEST).length} owned outside it with a stated reason`);
}
