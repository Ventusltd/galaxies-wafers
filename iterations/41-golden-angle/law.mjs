/* law.mjs — the mathematics of The Placement Law, with no DOM and no fetch.
 *
 * Every constant here is read from ../../lib.mjs, the file every wafer page
 * imports. Nothing is retyped: the golden angle, the spacing and the law itself
 * come from lib.mjs, and the golden panel is drawn with lib.mjs placeAll()
 * itself. The only variant is placeWith(), the same law with the angle
 * replaced so the reader can see what another angle would do; it is checked
 * bit for bit against placeAll() when the angle is lib.mjs GOLDEN.
 */
import { GOLDEN, SPACING, place, placeAll } from '../../lib.mjs';

export { GOLDEN, SPACING, place, placeAll };

export const TAU = 2 * Math.PI;
export const PHI = (1 + Math.sqrt(5)) / 2;

/* 1, 2, 3 … n as a Uint32Array: the integers, issued or not. One buffer, grown
   only when a larger n is asked for, and handed out as a view. */
let ints = new Uint32Array(0);
export function integers(n) {
  if (n > ints.length) {
    const next = new Uint32Array(Math.max(n, ints.length * 2));
    for (let i = 0; i < next.length; i++) next[i] = i + 1;
    ints = next;
  }
  return ints.subarray(0, n);
}

/* The law with the angle swapped. r = SPACING·sqrt(key) exactly as lib.mjs. */
export function placeWith(keys, theta) {
  const n = keys.length, p = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const k = keys[i], r = SPACING * Math.sqrt(k), t = k * theta;
    p[i * 2] = r * Math.cos(t);
    p[i * 2 + 1] = r * Math.sin(t);
  }
  return p;
}

export function sameBits(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

/* How many leading significant digits two numbers share when both are printed
   to 17 significant figures (the precision that round-trips a double). */
export function digitsAgree(a, b) {
  const s = x => x.toPrecision(17).replace('.', '').replace(/^-?0+/, '');
  const A = s(a), B = s(b);
  let d = 0;
  while (d < A.length && A[d] === B[d]) d++;
  return d;
}

export function goldenCheck() {
  const formula = TAU * (1 - 1 / PHI);
  const alt = Math.PI * (3 - Math.sqrt(5));
  return {
    lib: GOLDEN, formula, alt, phi: PHI,
    diff: GOLDEN - formula,
    digits: digitsAgree(GOLDEN, formula),
    degrees: GOLDEN * 180 / Math.PI,
    turn: GOLDEN / TAU
  };
}

/* Continued fraction of x, computed in double precision. Stops when the
   remainder is below tol (x was, to this precision, rational) or after max
   terms. Double precision loses roughly one digit every term or two, so terms
   beyond the first dozen or so are not to be trusted; the caller says so. */
export function continuedFraction(x, max = 14, tol = 1e-9) {
  const terms = [];
  let v = x;
  for (let i = 0; i < max; i++) {
    const a = Math.floor(v);
    terms.push(a);
    const f = v - a;
    if (f < tol) return { terms, exhausted: true };
    v = 1 / f;
    if (v > 1e9) return { terms, exhausted: true };
  }
  return { terms, exhausted: false };
}

/* Signed distance of x from the nearest integer, in (-0.5, 0.5]. */
export const signedFrac = x => x - Math.round(x);

/* ── nearest neighbours through a grid bucket, not all pairs ────────────────
   Points go into square cells of side `cell`. For each point its own cell and
   then successive square rings of cells are searched; the search stops once
   the best distance found is no more than ring·cell, because every point in a
   further ring is at least that far away. Returns the minimum nearest-
   neighbour distance over all points, the pair that attains it, the median,
   and for the outer half of the keys (key > n/2) the histogram of the key
   difference to the nearest neighbour. */
export function nearest(pos, keys, cell = SPACING) {
  const n = keys.length;
  const out = { n, min: Infinity, minA: 0, minB: 0, median: NaN, modal: 0, modalShare: 0, visits: 0, ms: 0 };
  if (n < 2) return out;
  const t0 = performance.now();
  let R = 0;
  for (let i = 0; i < n * 2; i++) R = Math.max(R, Math.abs(pos[i]));
  const G = Math.max(1, Math.ceil((2 * R) / cell) + 1);
  const cx = x => Math.min(G - 1, Math.max(0, Math.floor((x + R) / cell)));
  const cellOf = new Int32Array(n), count = new Int32Array(G * G + 1);
  for (let i = 0; i < n; i++) { const c = cy_cx(i); cellOf[i] = c; count[c + 1]++; }
  function cy_cx(i) { return cx(pos[i * 2 + 1]) * G + cx(pos[i * 2]); }
  for (let c = 0; c < G * G; c++) count[c + 1] += count[c];
  const fill = count.slice(0, G * G), order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[fill[cellOf[i]]++] = i;

  const nn = new Float32Array(n), hist = new Map();
  const half = n / 2;
  let visits = 0, outer = 0;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 2], y = pos[i * 2 + 1];
    const gx = cx(x), gy = cx(y);
    let best = Infinity, bj = -1;
    for (let ring = 0; ring < G; ring++) {
      const x0 = gx - ring, x1 = gx + ring, y0 = gy - ring, y1 = gy + ring;
      for (let yy = y0; yy <= y1; yy++) {
        if (yy < 0 || yy >= G) continue;
        const edgeRow = yy === y0 || yy === y1;
        for (let xx = x0; xx <= x1; xx += edgeRow ? 1 : (x1 - x0 || 1)) {
          if (xx >= 0 && xx < G) {
            const c = yy * G + xx;
            for (let s = count[c], e = count[c + 1]; s < e; s++) {
              const j = order[s];
              if (j === i) continue;
              const dx = pos[j * 2] - x, dy = pos[j * 2 + 1] - y, d = dx * dx + dy * dy;
              visits++;
              if (d < best) { best = d; bj = j; }
            }
          }
          if (x1 === x0) break;
        }
      }
      if (bj >= 0 && Math.sqrt(best) <= ring * cell) break;
    }
    const d = Math.sqrt(best);
    nn[i] = d;
    if (d < out.min) { out.min = d; out.minA = keys[i]; out.minB = keys[bj]; }
    if (keys[i] > half) {
      const dk = Math.abs(keys[bj] - keys[i]);
      hist.set(dk, (hist.get(dk) || 0) + 1);
      outer++;
    }
  }
  const sorted = nn.slice().sort();
  out.median = sorted[n >> 1];
  let mk = 0, mv = -1;
  for (const [k, v] of hist) if (v > mv || (v === mv && k < mk)) { mk = k; mv = v; }
  out.modal = mk; out.modalShare = outer ? mv / outer : 0;
  out.visits = visits;
  out.ms = performance.now() - t0;
  return out;
}

/* Arms from the modal key difference d: keys k, k+d, k+2d … lie along one arm.
   Each step turns the arm by the signed fractional part of d·(angle/2π) of a
   turn. Across the drawn disc an arm takes about n/d steps, so its total turn is
   (n/d)·that. The page calls the arms straight spokes when that total turn is
   less than half the angular gap between neighbouring arms (half of 1/d of a
   turn); otherwise they are spiral arms. The rule is stated on the page. */
export function arms(theta, n, d) {
  if (!d) return { d: 0, stepTurn: 0, totalDeg: 0, spokes: false };
  const stepTurn = signedFrac(d * (theta / TAU));
  const totalDeg = Math.abs((n / d) * stepTurn * 360);
  return { d, stepTurn, totalDeg, gapDeg: 360 / d, spokes: totalDeg < 360 / d / 2 };
}

/* ── equal-area rings ───────────────────────────────────────────────────────
   m rings between radius 0 and Rout, boundaries Rout·sqrt(i/m), so every ring
   has area π·Rout²/m. Points are assigned by their measured radius, hypot(x,y)
   of the placed point, against those boundaries: the counting is geometric,
   done on positions, not on the key. */
export function ringBounds(Rout, m) {
  const b = new Float64Array(m + 1);
  for (let i = 0; i <= m; i++) b[i] = Rout * Math.sqrt(i / m);
  return b;
}

export function countRings(pos, bounds, limit = Infinity) {
  const m = bounds.length - 1, counts = new Uint32Array(m);
  const Rout = bounds[m], tol = Rout * 1e-6;
  const n = Math.min(pos.length / 2, limit);
  let outside = 0;
  for (let i = 0; i < n; i++) {
    const r = Math.hypot(pos[i * 2], pos[i * 2 + 1]);
    if (r > Rout + tol) { outside++; continue; }
    let lo = 0, hi = m - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (r < bounds[mid + 1]) hi = mid; else lo = mid + 1; }
    counts[lo]++;
  }
  return { counts, outside };
}

/* Contrast: the same keys under r ∝ key instead of r ∝ sqrt(key), scaled so key
   n lands on the same outer radius. Returns a position array. */
export function placeLinear(keys, n) {
  const Rout = SPACING * Math.sqrt(n), p = new Float32Array(keys.length * 2);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i], r = Rout * (k / n), t = k * GOLDEN;
    p[i * 2] = r * Math.cos(t); p[i * 2 + 1] = r * Math.sin(t);
  }
  return p;
}

/* Number of issued keys ≤ n in a sorted key list (binary search). */
export function countAtMost(keys, n) {
  let lo = 0, hi = keys.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (keys[m] <= n) lo = m + 1; else hi = m; }
  return lo;
}

/* Gaps in a sorted key list starting from 1: numbers never issued. */
export function gaps(keys) {
  let absent = 0, longest = 0, longestFrom = 0, runs = 0, prev = 0;
  for (let i = 0; i < keys.length; i++) {
    const g = keys[i] - prev - 1;
    if (g > 0) { absent += g; runs++; if (g > longest) { longest = g; longestFrom = prev + 1; } }
    prev = keys[i];
  }
  return { issued: keys.length, max: prev, absent, runs, longest, longestFrom };
}

export function bands(keys, max, m) {
  const issued = new Uint32Array(m), size = new Uint32Array(m);
  const w = max / m;
  for (let b = 0; b < m; b++) {
    const lo = Math.floor(b * w) + 1, hi = b === m - 1 ? max : Math.floor((b + 1) * w);
    size[b] = hi - lo + 1;
    issued[b] = countAtMost(keys, hi) - countAtMost(keys, lo - 1);
  }
  return { issued, size };
}
