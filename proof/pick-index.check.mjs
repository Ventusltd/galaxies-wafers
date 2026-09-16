/* Does the grid return the same line the full scan returned?
 *
 * Replacing a scan with an index is only worth doing if the answer is
 * identical, so this asks both for the same taps: every point in the estate
 * compared one by one, against the grid. A single disagreement is a failure —
 * "nearly the nearest" would mean the page sometimes opens the wrong line.
 */
import { placeAll, SPACING } from '../lib.mjs';
import { buildPickIndex, nearestAt } from '../iterations/49-read-the-line/pick.mjs';

const fail = [];
const say = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fail.push(msg); };

/* The real numbering: 283,231 keys over 1..385,223, with the gaps that the
   estate never issued, taken as every key that is not a multiple of 17. */
const keys = new Uint32Array(function* () { for (let k = 1; k <= 385223; k++) if (k % 17) yield k; }());
const n = keys.length;
const pos = placeAll(keys);
console.log(`${n.toLocaleString()} keys placed`);

const t0 = performance.now();
const ix = buildPickIndex(pos, n, SPACING);
const buildMs = performance.now() - t0;
const PER_CELL_TARGET = ix.occupancy.target;
say(ix.bytes < 4e6, `index built in ${buildMs.toFixed(0)} ms, ${(ix.bytes / 1e6).toFixed(2)} MB, ${ix.cols}x${ix.rows} cells of ${ix.size.toFixed(2)}`);

const scan = (wx, wy, reach) => {
  let best = -1, bestD = reach * reach;
  for (let i = 0; i < n; i++) {
    const dx = pos[i * 2] - wx, dy = pos[i * 2 + 1] - wy;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
};

/* Taps at points, between points, far outside, and exactly on the rim — the
   places an index goes wrong. */
const taps = [];
for (let i = 0; i < 300; i++) { const j = (i * 971) % n; taps.push([pos[j * 2], pos[j * 2 + 1], 22]); }
for (let i = 0; i < 300; i++) { const j = (i * 613) % n; taps.push([pos[j * 2] + 0.9, pos[j * 2 + 1] - 0.7, 22]); }
for (let i = 0; i < 100; i++) taps.push([(Math.random() - 0.5) * 1400, (Math.random() - 0.5) * 1400, 22]);
for (const reach of [0.1, 0.5, 1, 3, 40, 200]) for (let i = 0; i < 40; i++) {
  const j = (i * 7919) % n; taps.push([pos[j * 2] + reach * 0.9, pos[j * 2 + 1], reach]);
}
taps.push([2000, 2000, 22], [0, 0, 22], [-9999, 12345, 500]);

let worst = 0, mismatch = 0;
let gridMs = 0, scanMs = 0;
for (const [wx, wy, reach] of taps) {
  const a = performance.now(); const g = nearestAt(ix, wx, wy, reach); gridMs += performance.now() - a;
  const b = performance.now(); const s = scan(wx, wy, reach); scanMs += performance.now() - b;
  if (g !== s) {
    /* A tie at exactly equal distance may pick either; only a genuinely worse
       answer is a fault. */
    const d = i => i < 0 ? Infinity : Math.pow(pos[i * 2] - wx, 2) + Math.pow(pos[i * 2 + 1] - wy, 2);
    if (Math.abs(d(g) - d(s)) > 1e-9) { mismatch++; if (mismatch < 4) say(false, `tap (${wx.toFixed(2)}, ${wy.toFixed(2)}) reach ${reach}: grid gave ${g}, scan gave ${s}`); }
  }
  worst = Math.max(worst, reach);
}
say(mismatch === 0, `${taps.length} taps (reach up to ${worst}) agree with the full scan`);
say(gridMs < scanMs / 20, `grid ${(gridMs / taps.length * 1000).toFixed(1)} us per tap, scan ${(scanMs / taps.length * 1000).toFixed(1)} us — ${(scanMs / gridMs).toFixed(0)}x`);

/* THE INDEX MUST KNOW WHEN ITS OWN ASSUMPTION HAS FAILED.
   The cell size is derived from SPACING on the assumption of uniform density,
   which holds for the wafer law and for no other. The estate now has laws that
   cluster deliberately — a gravity law whose measured masses pull 453
   directories toward one well. Under those the index stays CORRECT and stops
   being fast, and the danger is that it says nothing. So it measures what it
   actually built and reports it. */
{
  say(ix.occupancy.uniform, 'the wafer law builds a uniform index: ' + ix.occupancy.why);
  say(ix.occupancy.worst <= PER_CELL_TARGET * 2,
    `occupancy median ${ix.occupancy.median}, p99 ${ix.occupancy.p99}, worst ${ix.occupancy.worst} of a target ${ix.occupancy.target}`);

  /* A deliberately clustered set, five wells, the shape of the gravity law. */
  const m = [453, 382, 176, 26, 12], R = [0, 38.3, 176.4, 356.2, 392.2];
  const tot = m.reduce((s2, v) => s2 + v, 0);
  const cp = new Float32Array(n * 2);
  let w = 0;
  for (let h = 0; h < m.length; h++) {
    const share = Math.round(n * m[h] / tot);
    for (let j = 0; j < share && w < n; j++, w++) {
      const t = Math.random() * Math.PI * 2, rr = Math.pow(Math.random(), 3) * 40;
      cp[w * 2] = Math.cos(t) * (R[h] + rr);
      cp[w * 2 + 1] = Math.sin(t) * (R[h] + rr);
    }
  }
  while (w < n) { cp[w * 2] = 0; cp[w * 2 + 1] = 0; w++; }
  const clustered = buildPickIndex(cp, n, SPACING);
  say(!clustered.occupancy.uniform,
    'a clustered law is REPORTED as unsuitable rather than silently slow: worst cell ' +
    clustered.occupancy.worst.toLocaleString() + ', ' +
    (clustered.occupancy.worst / clustered.occupancy.target).toFixed(0) + 'x the target');
  say(clustered.occupancy.median <= ix.occupancy.median,
    'and the MEDIAN improves while the structure collapses (' + clustered.occupancy.median +
    ' vs ' + ix.occupancy.median + ') — an average would have passed this');
}

console.log(fail.length ? `\n${fail.length} FAILED` : '\nall checks passed');
process.exit(fail.length ? 1 : 0);
