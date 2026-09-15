/* clock.mjs — the third axis of the wafer, drawn in two dimensions.
 *
 * Keys were issued in time order, so a key IS a moment. This module holds one
 * number, t, and everything that draws asks it the same two questions:
 *   born(k)  is key k issued yet? (k <= t)
 *   glow(k)  how recently was it born? 1 at the instant of birth, 0 once it is
 *            older than GLOW_SHARE of t. Age is drawn as brightness and size,
 *            never as a projection: the wafer stays flat and frozen.
 * The page and the overlay import this one file, so both read the same clock.
 */
export const GLOW_SHARE = 0.02;     /* born within the last 2% of t glows */
export const GLOW_GROWTH = 0.5;     /* a newborn is drawn 1.5x its size */

const listeners = new Set();
export const clock = { t: 1, max: 1 };

export const born = k => k <= clock.t;
export function glow(k) {
  if (k > clock.t) return 0;
  const span = clock.t * GLOW_SHARE;
  return span > 0 ? Math.max(0, 1 - (clock.t - k) / span) : 0;
}
export function setT(t) {
  const n = Math.max(1, Math.min(clock.max, Math.round(t)));
  if (n === clock.t) return;
  clock.t = n;
  for (const f of listeners) { try { f(n); } catch (e) { console.warn('clock listener failed:', e); } }
}
export const onTick = f => listeners.add(f);

/* The last index of a key list in numbering order whose key is born, or -1. */
export function bornPrefix(keys) {
  let i = -1;
  while (i + 1 < keys.length && keys[i + 1] <= clock.t) i++;
  return i;
}

/* THE CLOCK IN DATES. A family is whole at t once every line it carries is
   born, that is once its largest key is at or below t. The clock prints the
   newest first_written among the families whole at t: sorted by that largest
   key with a running maximum of first_written, it is one binary search away,
   and it can only move forward as t does.
   Two readings were tried and dropped, and the data is why. Keyed by a family's
   SMALLEST line, the date saturates by key 1,000, because common lines (a lone
   brace) carry tiny keys into families written months later. Keyed by the
   single latest-born family without the running maximum, the date jumps back
   and forth, because keys are issued in database order and first_written is
   git history: the two agree in trend, not line by line. */
export function dateIndex(families, famLines) {
  const rows = [];
  for (const f of families) {
    if (!f.first_written || !f.lineCount) continue;
    let whole = 0;
    for (let i = f.lineOffset; i < f.lineOffset + f.lineCount; i++) whole = Math.max(whole, famLines[i]);
    const ms = Date.parse(f.first_written);
    if (whole > 0 && Number.isFinite(ms)) rows.push([whole, ms, f.first_written, f.name]);
  }
  rows.sort((a, b) => a[0] - b[0]);
  const keys = new Float64Array(rows.length), best = [];
  let top = null;
  rows.forEach((r, i) => { keys[i] = r[0]; if (!top || r[1] > top[1]) top = r; best.push(top); });
  return t => {
    let lo = 0, hi = keys.length - 1, at = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (keys[m] <= t) { at = m; lo = m + 1; } else hi = m - 1; }
    return at < 0 ? null : { iso: best[at][2], name: best[at][3], wholeAt: best[at][0] };
  };
}
