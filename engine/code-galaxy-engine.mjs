/* code-galaxy-engine.mjs — the Ventus Grid Engine's deep-link contract, lifted
 * and applied to the code galaxy as a separate engine.
 *
 * WHAT WAS LIFTED, AND FROM WHERE. ventus-grid-engine/deeplink/contract.js:
 * one identity parameter, a frozen table of parameters with type, required and
 * a note, a list of receivers, and two pure functions that build and parse a
 * link. The Atlas centres on a project because a link carries `repd_ref`,
 * `technology`, `latitude`, `longitude`, `zoom` and the receiver reads exactly
 * those. That contract is why a link into the Atlas never dies silently.
 *
 * WHAT CHANGES. The identity is a permanent line number instead of a REPD
 * reference, because in the galaxy the line number is the address: its place
 * is a pure function of the number (wafer.mjs), so a link needs no latitude
 * and no longitude. `to` names a second line to connect; `layers` names which
 * layers the receiver should hydrate; `zoom` is the wafer's zoom.
 *
 * WHAT DOES NOT CHANGE. The contract lives here once, as data plus pure
 * functions; the emitter and the receiver both import it; a link to a retired
 * receiver throws rather than returning a dead link; no fetch, no DOM, no
 * socket, so the proof runs offline. Same shape as the engine's, on purpose.
 */

export const schema = 'galaxies-wafers.code-galaxy-engine.deeplink.v1';
export const LIFTED_FROM = 'Ventusltd/ventus-grid-engine deeplink/contract.js';

export const IDENTITY_PARAM = 'line';

export const PARAMS = Object.freeze({
  line:   { type: 'integer', required: true,  note: 'the permanent line number; the identity. Its place on the wafer is sqrt(line), line x golden angle' },
  to:     { type: 'integer', required: false, note: 'a second permanent line number to connect to the first' },
  layers: { type: 'list',    required: false, note: 'layer ids from layers/manifest.json to hydrate on arrival; unknown ids are dropped by the receiver' },
  zoom:   { type: 'number',  required: false, note: 'the wafer zoom, 0.02 to 4000' }
});

export const RECEIVERS = Object.freeze([
  Object.freeze({ id: 'galaxies-wafers', status: 'canonical', carries_layers: true,
    url: 'https://ventusltd.github.io/galaxies-wafers/',
    note: 'the wafer with layers; Pages must be enabled for this URL to answer' }),
  Object.freeze({ id: 'line-wafer-202609151339', status: 'canonical', carries_layers: false,
    url: 'https://globalgrid2050.com/testcode/202609151339/',
    note: 'the inherited wafer without layers; reads line and to, ignores layers and zoom' })
]);

export const NOT_COMPUTED = Object.freeze({
  place: 'This contract never computes where a line sits. That is wafer.mjs, and a link that carried a '
       + 'position could disagree with it.',
  existence: 'This contract does not check that a line number was ever issued. The receiver does, against '
           + 'the numbered database, and refuses visibly.'
});

const isKey = v => Number.isSafeInteger(v) && v >= 1;

/** A link into a receiver. Throws on a retired receiver or a bad identity, so
 *  a dead link is never handed out. */
export function buildDeepLink(receiverId, { line, to, layers, zoom } = {}) {
  const r = RECEIVERS.find(x => x.id === receiverId);
  if (!r) throw new Error(`unknown receiver ${JSON.stringify(receiverId)}`);
  if (r.status !== 'canonical') throw new Error(`receiver ${receiverId} is ${r.status}; a link to it would be dead on arrival`);
  if (!isKey(line)) throw new TypeError(`${IDENTITY_PARAM} must be a positive safe integer, received ${JSON.stringify(line)}`);
  const q = new URLSearchParams();
  q.set('line', String(line));
  if (to !== undefined) { if (!isKey(to)) throw new TypeError(`to must be a positive safe integer, received ${JSON.stringify(to)}`); q.set('to', String(to)); }
  if (layers !== undefined) {
    if (!r.carries_layers) throw new Error(`receiver ${receiverId} carries no layers; drop the layers field or choose galaxies-wafers`);
    const ids = [...new Set((Array.isArray(layers) ? layers : String(layers).split(',')).map(s => String(s).trim()).filter(Boolean))];
    if (ids.some(id => !/^[a-z0-9][a-z0-9-]*$/i.test(id))) throw new TypeError('layer ids are [a-z0-9-] only');
    if (ids.length) q.set('layers', ids.join(','));
  }
  if (zoom !== undefined) {
    if (typeof zoom !== 'number' || !(zoom >= 0.02 && zoom <= 4000)) throw new RangeError(`zoom must be a number in [0.02, 4000], received ${JSON.stringify(zoom)}`);
    q.set('zoom', String(zoom));
  }
  return r.url + '?' + q.toString().replace(/%2C/gi, ',');
}

/** Read a link back. Never throws: a bad link is returned with `ok: false`
 *  and the reason, so a receiver can refuse visibly instead of guessing. */
export function parseDeepLink(href) {
  let u;
  try { u = new URL(String(href)); } catch { return { ok: false, why: 'not a URL' }; }
  const q = u.searchParams;
  const raw = q.get('line');
  if (raw === null) return { ok: false, why: `missing ${IDENTITY_PARAM}` };
  if (!/^[0-9]+$/.test(raw.trim())) return { ok: false, why: `${IDENTITY_PARAM} is not digits` };
  const line = Number(raw);
  if (!isKey(line)) return { ok: false, why: `${IDENTITY_PARAM} is not a positive safe integer` };
  const out = { ok: true, line, receiver: RECEIVERS.find(r => href.startsWith(r.url))?.id ?? null };
  if (q.has('to')) {
    const t = q.get('to').trim();
    if (!/^[0-9]+$/.test(t) || !isKey(Number(t))) return { ok: false, why: 'to is not a positive safe integer', line };
    out.to = Number(t);
  }
  if (q.has('layers')) out.layers = [...new Set(q.get('layers').split(',').map(s => s.trim()).filter(Boolean))];
  if (q.has('zoom')) {
    const z = Number(q.get('zoom'));
    if (!(z >= 0.02 && z <= 4000)) return { ok: false, why: 'zoom out of range', line };
    out.zoom = z;
  }
  return out;
}
