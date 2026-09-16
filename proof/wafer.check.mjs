/* The same checks proof/index.html runs in a phone browser, run under Node with
 * no browser at all, so CI can gate on them.
 *
 * Run: node proof/wafer.check.mjs   (from anywhere)
 *
 * WHERE THE PACK IS, AND THE BUG THIS REPLACES. This file was written inside
 * testcode/202609151339 and copied here. It kept its origin's relative path to
 * the data — '../../202609142202/data/' — which is correct in testcode, where
 * the pack is a sibling directory, and points outside the repository here. The
 * same file therefore passed in the tree it was written in and could not open
 * the wafer in this one, from any directory: the path resolves against
 * import.meta.url, so no working directory could have saved it. A proof named
 * wafer.check had been reporting on a wafer it never opened.
 *
 * The fix is not a better guess. The pack is looked for in each place it is
 * known to live, in order, and then at the published URL the pages themselves
 * read; if none answer, the failure names every place it looked rather than
 * throwing ENOENT about one of them. A check must say which environment it
 * verifies, and fail loudly outside it.
 */
import fs from 'node:fs';
import { buildChecks } from './checks.mjs';

const PACK = '202609142202';
const FILES = ['all-lines.meta.json', 'all-lines.bin', 'all-lines.len.bin',
               'all-lines.family.bin', 'families.json', 'lines.bin'];

/* Local candidates, nearest first: the sibling layout inside testcode, a
   globalgrid2050 working copy beside or above this one, and an explicit
   override for CI. */
const candidates = [
  process.env.WAFER_DATA ? new URL('file:///' + process.env.WAFER_DATA.replace(/\\/g, '/').replace(/\/?$/, '/')) : null,
  new URL(`../../${PACK}/data/`, import.meta.url),
  new URL(`../../globalgrid2050/testcode/${PACK}/data/`, import.meta.url),
  new URL(`../../../globalgrid2050/testcode/${PACK}/data/`, import.meta.url)
].filter(Boolean);

const REMOTE = `https://globalgrid2050.com/testcode/${PACK}/data/`;
const looked = [];
let bytes = null, from = '';

for (const dir of candidates) {
  looked.push(decodeURIComponent(dir.pathname));
  try {
    const m = new Map();
    for (const n of FILES) m.set(n, fs.readFileSync(new URL(n, dir)));
    bytes = m; from = decodeURIComponent(dir.pathname);
    break;
  } catch { /* try the next place */ }
}

if (!bytes) {
  looked.push(REMOTE);
  try {
    const m = new Map();
    for (const n of FILES) {
      const r = await fetch(REMOTE + n);
      if (!r.ok) throw new Error(n + ' returned HTTP ' + r.status);
      m.set(n, Buffer.from(await r.arrayBuffer()));
    }
    bytes = m; from = REMOTE;
  } catch (e) {
    console.error('wafer proof CANNOT RUN — the ' + PACK + ' pack was not found.\nLooked in:\n- '
      + looked.join('\n- ') + '\nLast error: ' + (e.message || e));
    process.exit(2);
  }
}

const buf = n => bytes.get(n);
const arr = (n, K) => { const b = buf(n); return new K(b.buffer, b.byteOffset, b.byteLength / K.BYTES_PER_ELEMENT); };

const D0 = {
  meta: JSON.parse(buf('all-lines.meta.json').toString('utf8')),
  keys: arr('all-lines.bin', Uint32Array),
  lens: arr('all-lines.len.bin', Uint16Array),
  inFam: arr('all-lines.family.bin', Uint8Array),
  families: JSON.parse(buf('families.json').toString('utf8')),
  famLines: arr('lines.bin', Uint32Array)
};

const checks = buildChecks(D0);
const failures = [];
let passed = 0;
for (const [name, fn] of checks) {
  let ok = false;
  try { ok = fn() === true; } catch (e) { failures.push(name + ' — threw: ' + e.message); continue; }
  if (ok) passed++; else failures.push(name);
}

if (failures.length) {
  console.error('wafer proof FAILED (' + failures.length + ' of ' + checks.length + '):\n- '
    + failures.join('\n- '));
  process.exit(1);
}
console.log('wafer proof PASS — ' + passed + ' checks · pack read from ' + from);
export default { status: 'PASS', checks: passed };
