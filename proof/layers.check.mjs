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
