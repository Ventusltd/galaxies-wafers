/* engines.mjs — STARS AS ENGINES. A second substrate beside the wafer, never
 * instead of it.
 *
 * "Existing stars are also engines of your universe." The Ten Laws page already
 * publishes ten placement laws, each a pure function of a key and published facts
 * about it. This module imports them live and lets any one of them drive the
 * wafer's points and every loaded layer's marks. Layers hold keys, not
 * coordinates, so re-placing a layer under another law is nothing more than
 * asking that law where each key goes. That is the whole point of keys.
 *
 * THE FROZEN SUBSTRATE IS UNTOUCHED. wafer.mjs is not imported, edited or
 * shadowed. The engine called "wafer (frozen)" is lib.mjs's own place(), the
 * page's default, and a link without ?engine= is exactly the inherited page.
 *
 * WHERE THE LAWS COME FROM. Fetched as an ES module from the live URL below. The
 * same file is in the globalgrid2050 repository at
 * testcode/202609151413/physics.mjs, the documented fallback: serve that
 * repository and point LAWS_FALLBACK at it if the live site is unreachable.
 *
 * ONE SCALE PER LAW, MEASURED. The laws speak in their own units (collapse fits
 * inside a few dozen, the wafer runs to the square root of the highest number
 * issued). So the camera can frame every law the same way, each law's output is
 * scaled so its farthest point lands on the wafer's own extent. The factor is
 * measured from the data each time a law is chosen, never typed.
 */
import { place as waferPlace, indexOfKey } from '../../lib.mjs';

const LAWS_LIVE = 'https://globalgrid2050.com/testcode/202609151413/physics.mjs';
const LAWS_FALLBACK = '../../../globalgrid2050/testcode/202609151413/physics.mjs';
const TWEEN_MS = 900;
const DAY_MS = 864e5;

const E = {
  laws: null, why: '', id: 'wafer',
  U: null, wafer: null,            /* the wafer's own positions, kept for ever */
  from: null, to: null,            /* tween endpoints; U.pos holds the current frame */
  t: 1, scale: 1, fromScale: 1, fromId: 'wafer',
  facts: null,                     /* per-index family facts, once tier 2 lands */
  scaleOf: new Map(),              /* measured scale per law, cleared when facts change */
  onFrame: () => {}
};

export const current = () => E.id;

async function loadLaws() {
  for (const url of [LAWS_LIVE, new URL(LAWS_FALLBACK, import.meta.url).href]) {
    try { const m = await import(url); if (m.LAWS) { E.laws = m; return; } }
    catch (e) { E.why = E.why || e.message; }
  }
}

/* Facts the laws read, built once from the numbered database. */
function buildFacts() {
  const U = E.U;
  if (!U.families || !U.ownerOf || E.facts) return;
  const n = U.n, fam = new Int32Array(n).fill(-1), inFam = new Int32Array(n);
  for (let f = 0; f < U.families.length; f++) {
    const o = U.families[f].lineOffset, c = U.families[f].lineCount;
    for (let j = 0; j < c; j++) {
      const i = indexOfKey(U.keys, U.famLines[o + j]);
      if (i >= 0 && fam[i] < 0) { fam[i] = f; inFam[i] = j; }
    }
  }
  const cats = [...new Set(U.families.map(f => f.category ?? ''))].sort();
  const catIx = new Map(cats.map((c, i) => [c, i]));
  const now = Date.parse(U.meta.built_utc);
  E.facts = { fam, inFam, cats, catIx, now };
  E.scaleOf.clear();
}

function entity(i) {
  const U = E.U, key = U.keys[i], F = E.facts;
  const e = { key, chars: U.lens[i] };
  if (!F) return e;
  const f = F.fam[i];
  e.fanout = (U.ownerOf.get(key) || []).length;
  if (f >= 0) {
    const fa = U.families[f];
    e.family = f; e.inFamily = F.inFam[i]; e.famCount = fa.lineCount;
    e.cat = F.catIx.get(fa.category ?? ''); e.catCount = F.cats.length;
    const w = Date.parse(fa.first_written);
    if (Number.isFinite(w)) e.ageDays = (F.now - w) / DAY_MS;
  }
  return e;
}

const lawOf = id => (id === 'wafer' || !E.laws) ? null : E.laws.byId[id];

/* Every issued key's place under a law, scaled onto the wafer's extent. */
function target(id) {
  const U = E.U, law = lawOf(id);
  if (!law) return { pos: E.wafer, scale: 1 };
  const raw = new Float32Array(U.n * 2);
  let far = 0;
  for (let i = 0; i < U.n; i++) {
    let [x, y] = law.place(entity(i));
    if (!Number.isFinite(x) || !Number.isFinite(y)) { x = 0; y = 0; }
    raw[i * 2] = x; raw[i * 2 + 1] = y;
    far = Math.max(far, Math.hypot(x, y));
  }
  const scale = far > 0 ? Math.sqrt(U.meta.max) / far : 1;
  for (let i = 0; i < raw.length; i++) raw[i] *= scale;
  E.scaleOf.set(id, scale);
  return { pos: raw, scale };
}

/* A key's full place under a law, issued or not: what the proofs evaluate. */
export function placeUnder(key, id) {
  const law = lawOf(id);
  if (!law) return waferPlace(key);
  const i = E.U ? indexOfKey(E.U.keys, key) : -1;
  if (i >= 0) {
    const s = E.scaleOf.get(id) ?? target(id).scale;
    const [x, y] = law.place(entity(i));
    return [x * s, y * s];
  }
  const [x, y] = law.place({ key });
  return [x * E.scale, y * E.scale];
}

const ease = u => u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;

/* Where a key is drawn this frame: the wafer, the chosen law, or between them. */
export function placeKey(key) {
  const U = E.U;
  const i = U ? indexOfKey(U.keys, key) : -1;
  if (i >= 0) return [U.pos[i * 2], U.pos[i * 2 + 1]];
  const at = (id, s) => { const l = lawOf(id); if (!l) return waferPlace(key); const [x, y] = l.place({ key }); return [x * s, y * s]; };
  const a = at(E.fromId, E.fromScale), b = at(E.id, E.scale), k = ease(E.t);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}

export function select(id, { tween = true } = {}) {
  if (!E.U) { E.id = id; return; }
  if (id !== 'wafer' && !lawOf(id)) id = 'wafer';
  const { pos, scale } = target(id);
  E.from = Float32Array.from(E.U.pos); E.to = pos;
  E.fromId = E.id; E.fromScale = E.scale;
  E.id = id; E.scale = scale;
  writeURL();
  const sel = document.getElementById('engine'); if (sel) sel.value = id;
  const t0 = performance.now(), P = E.U.pos;
  const step = now => {
    E.t = tween ? Math.min(1, (now - t0) / TWEEN_MS) : 1;
    const k = ease(E.t);
    for (let j = 0; j < P.length; j++) P[j] = E.from[j] + (E.to[j] - E.from[j]) * k;
    E.onFrame();
    if (E.t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function writeURL() {
  const u = new URL(location.href);
  if (E.id === 'wafer') u.searchParams.delete('engine'); else u.searchParams.set('engine', E.id);
  const next = u.pathname + u.search.replace(/%2C/gi, ',') + u.hash;
  if (next !== location.pathname + location.search + location.hash) history.replaceState(history.state, '', next);
}

function mountSelector() {
  const bar = document.getElementById('bar');
  const label = document.createElement('label');
  label.id = 'engineWrap';
  label.title = 'wafer.v1 is the frozen substrate and never changes. Every other engine re-places the same permanent keys by one of the Ten Laws; nothing is stored.';
  const sel = document.createElement('select');
  sel.id = 'engine'; sel.setAttribute('aria-label', 'placement engine');
  const opt = (v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); };
  opt('wafer', 'wafer (frozen)');
  for (const l of (E.laws?.LAWS || [])) if (l.id !== 'wafer') opt(l.id, l.title.toLowerCase());
  sel.value = E.id;
  sel.addEventListener('change', () => select(sel.value));
  const note = document.createElement('span');
  note.className = 'dim'; note.id = 'engineNote';
  note.textContent = E.laws ? ' engine · substrate wafer.v1 frozen' : ` engine · laws unavailable (${E.why}); wafer.v1 frozen`;
  label.append(sel, note);
  bar.appendChild(label);
}

const wanted = () => new URL(location.href).searchParams.get('engine') || 'wafer';
const lawsReady = loadLaws().then(mountSelector);

/* Called by app.mjs once tier 1 has placed every key by the wafer law. */
export async function attach(U, onFrame) {
  E.U = U; E.onFrame = onFrame; E.wafer = Float32Array.from(U.pos);
  await lawsReady;
  const id = wanted();
  if (id !== 'wafer') select(id);
}

/* Called when the family index lands: laws that read families re-place. */
export function familiesReady() {
  buildFacts();
  if (E.id !== 'wafer') select(E.id);
}

/* Read-only probe for the proofs: a key's screen position under any engine. */
window.__engines = Object.freeze({
  get current() { return E.id; },
  get settled() { return E.t >= 1; },
  get hasFacts() { return !!E.facts; },
  laws: () => ['wafer', ...(E.laws?.LAWS || []).filter(l => l.id !== 'wafer').map(l => l.id)],
  placeUnder, placeKey,
  screenOf(key, id) {
    const v = window.__wafer?.view; if (!v) return null;
    const [x, y] = id ? placeUnder(key, id) : placeKey(key);
    return [(x - v.x) * v.zoom + v.w / 2, v.h / 2 - (y - v.y) * v.zoom];
  }
});
