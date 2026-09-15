/* queue.mjs — one FetchQueue for every request this page makes after the
 * substrate: layer files, the block register and page titles. Learned from Grid
 * Atlas (repd_grid_atlasv8 ventus-corev8engine.js, its FetchQueue and urlCache):
 *
 *   CONCURRENCY 4. Never more than four requests in flight.
 *   TIMEOUT 15 s. Every request carries an AbortController; one that takes longer
 *     fails with that reason instead of holding a slot for ever.
 *   ONE PROMISE PER URL. Two layers backed by the same file, or a tap repeated
 *     while the file is on its way, share one request. A failed request is
 *     removed from the cache so a retry is possible; an evicted layer's file is
 *     removed too (forget), so eviction really frees the memory.
 *   WANTED AT THE DOOR. A job that waited carries a wanted() test asked when its
 *     slot opens: if the reader has moved to another app by then, it is dropped
 *     without touching the network.
 */
export const CONCURRENCY = 4;
export const TIMEOUT_MS = 15000;
let inFlight = 0;
const waiting = [];
const urlCache = new Map();   /* url -> Promise of parsed JSON */

export class Unwanted extends Error { constructor() { super('no longer wanted'); this.unwanted = true; } }

export async function run(job, wanted = () => true) {
  if (inFlight >= CONCURRENCY) await new Promise(res => waiting.push(res));
  inFlight++;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    if (!wanted()) throw new Unwanted();
    return await job(ctl.signal);
  } catch (e) {
    if (ctl.signal.aborted && !e.unwanted) throw new Error(`no answer within ${TIMEOUT_MS / 1000} s`);
    throw e;
  } finally {
    clearTimeout(timer);
    inFlight--;
    waiting.shift()?.();
  }
}

/* JSON through the queue and the cache. failPrefix names an HTTP failure. */
export function fetchJSON(url, failPrefix = 'HTTP ', wanted = () => true) {
  if (urlCache.has(url)) return urlCache.get(url);
  const p = run(async signal => {
    const r = await fetch(url, { cache: 'default', signal });
    if (!r.ok) throw new Error(failPrefix + r.status);
    return r.json();
  }, wanted);
  urlCache.set(url, p);
  p.catch(() => { if (urlCache.get(url) === p) urlCache.delete(url); });
  return p;
}

export const forget = url => urlCache.delete(url);
export const queueDepth = () => ({ inFlight, waiting: waiting.length, cached: urlCache.size });
