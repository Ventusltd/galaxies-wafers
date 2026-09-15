/* Negative and positive fixtures for judge(). Run: node proof/browser/judge.check.mjs
 * The first fixture is the exact false pass from run 35007615561: iteration 09's
 * three requested layers left in WAIT while the job reported pass. */
import { judge } from './judge.mjs';

const cases = [
  ['09 false pass: three layers left WAIT', { layers: { 'module-Ps': 'WAIT', 'module-Gn': 'WAIT', 'module-x126': 'WAIT' } }, false],
  ['a layer still LOAD at the deadline', { layers: { a: 'OK', b: 'LOAD 2/5' } }, false],
  ['a layer FAIL', { layers: { a: 'FAIL' } }, false],
  ['a requested layer with no row', { layers: { ghost: 'absent' } }, false],
  ['a page error', { errors: ['TypeError: x'], layers: { a: 'OK' } }, false],
  ['a failed same-site request', { failedRequests: ['404 https://example/layers/a.json'], layers: {} }, false],
  ['all requested layers OK or EMPTY', { layers: { a: 'OK', spider: 'EMPTY' } }, true],
  ['no layers requested, no errors', { layers: {} }, true],
];
let bad = 0;
for (const [name, input, want] of cases) {
  const got = judge(input).pass;
  if (got !== want) { bad++; console.error(`FAIL ${name}: pass=${got}, expected ${want}`); }
}
if (bad) { console.error(`judge proof FAILED (${bad} of ${cases.length})`); process.exit(1); }
console.log(`judge proof PASS — ${cases.length} fixtures (6 must fail, 2 must pass)`);
