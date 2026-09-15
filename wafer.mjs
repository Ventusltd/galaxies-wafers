/* wafer.mjs — THE SUBSTRATE. FROZEN.
 *
 * This file is the ground the galaxy is drawn on, and it is the one file here
 * that must not change. Grid Atlas never redraws its Carto basemap to suit a
 * layer; neither does this. Every link ever shared, every layer ever built and
 * every screenshot ever taken depends on a number landing in the same place
 * for ever.
 *
 * THE LAW, in full, and it is the whole file:
 *
 *     r     = sqrt(key)
 *     theta = key x 2.39996322972865332...      (the golden angle)
 *     x     = r cos(theta)
 *     y     = r sin(theta)
 *
 * A point's place is a pure function of its own permanent number and of nothing
 * else. Not of what else exists, not of how many there are, not of the order
 * they were loaded, not of the viewport, not of a random seed. Give it 8,285
 * and you get the same two numbers on every device, in every browser, in every
 * year.
 *
 * WHY THIS ARRANGEMENT AND NOT ANOTHER. It is phyllotaxis, the spiral a
 * sunflower uses. The golden angle is the irrational that packs worst-case
 * best: no two points fall on a common ray, so nothing occludes anything, and
 * the square root of the key means equal area holds equal count, so density on
 * screen is density in the numbering rather than an artefact of the projection.
 *
 * WHY IT IS UNBOUNDED. The estate's line numbers run to 342,795 today. This
 * function is defined for every positive integer, so line 400,000 and line
 * 40,000,000 already have places, and issuing them moves nothing. That is what
 * lets layers accumulate for years over a ground that never shifts beneath
 * them.
 *
 * WHAT A GAP MEANS. Numbers that were never issued leave holes, and the holes
 * are drawn. They are not missing data; they are numbers the estate chose not
 * to give out, and on a frozen substrate a hole is as much a fact as a point.
 *
 * TO CHANGE THIS FILE is to invalidate every layer, link and record that has
 * ever pointed at the galaxy. If a different arrangement is wanted, it is a new
 * substrate with a new name beside this one, never an edit to this one.
 */

export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
export const SUBSTRATE = Object.freeze({
  id: 'wafer.v1',
  law: 'r = sqrt(key); theta = key * goldenAngle',
  frozen_utc: '2026-09-15T15:00:00Z',
  note: 'The basemap of the code galaxy. Never changes. New arrangements are new substrates.'
});

/** Where a permanent key sits. Defined for every positive integer, issued or not. */
export function place(key) {
  const r = Math.sqrt(key), t = key * GOLDEN_ANGLE;
  return [r * Math.cos(t), r * Math.sin(t)];
}

/** The same law over a whole column of keys, as a flat xy array for the GPU. */
export function placeAll(keys) {
  const n = keys.length, p = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const k = keys[i], r = Math.sqrt(k), t = k * GOLDEN_ANGLE;
    p[i * 2] = r * Math.cos(t);
    p[i * 2 + 1] = r * Math.sin(t);
  }
  return p;
}

/** The radius that contains every key up to max: what the camera must frame. */
export const extent = max => Math.sqrt(max);

/** A deterministic angle from a key, for layers that need to fan several marks
 *  off one point without ever calling a random number generator. */
export function phase(key) {
  let h = key >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
