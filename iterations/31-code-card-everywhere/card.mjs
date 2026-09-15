/* card.mjs — iteration 31, Code Card Everywhere.
 *
 * Any tap on the wafer opens a card:
 *   on a line   — its key, the exact text of that line inside the function that
 *                 contains it, read from the file at the commit the numbered
 *                 database pins, with its family, block and app;
 *   on a route  — the module the route draws, its first and last line, its stops;
 *   on nothing  — the nearest issued line and the radius band the point sits in,
 *                 both computed from the placement law r = sqrt(key).
 *
 * Reused, not reinvented:
 *   iteration 03 (code-particle.mjs): the block register, a fetch queue, reading
 *     a file from raw.githubusercontent at its pinned commit, one writer for the
 *     WAIT / LOAD / OK / EMPTY / FAIL tag, and fetched text reaching the page only
 *     through textContent.
 *   iteration 07 (code-card.mjs): the Grid Atlas popup look — black ground, #444
 *     edge, monospace, an amber title, grey detail, the bordered cyan button.
 *
 * Where a line sits in its file. The modular star publishes one record per
 * function family (stars/code/f/<n div 500>.json). Each record lists the family's
 * permanent line keys in file order and every place the family lives
 * (repository, commit, path, first and last line). A key at position j of the
 * record is file line first + j. The page then checks the text it finds there
 * against the character count the numbered database holds for that key, and says
 * whether they agree.
 *
 * Changing a digit. Tap a line in the code window and each digit run on it is
 * an input. Edits exist
 * only in this page's memory: nothing is written to any repository, nothing is
 * stored in the browser. For a ventus-grid-engine module the page can run the
 * module twice in a Web Worker built from a Blob — once as published at the
 * commit the estate imports, once with the edit — calling one documented
 * function with the input its own proof uses first, and shows both answers.
 *
 * Loading, as Grid Atlas loads: nothing is fetched until a card opens; one
 * queue runs at most two fetches at once, each aborted after 15 s; one promise
 * per URL is shared, and a failed fetch leaves the cache so a retry can happen;
 * at most eight source files and four family buckets are held, the least
 * recently used evicted first. The card is one element, re-filled on every tap:
 * the code window is one text node however long the function, and only the one
 * selected line becomes editable fields.
 */

import { place, indexOfKey, fmt, SPACING } from '../../lib.mjs';

const STARS = 'https://ventusltd.github.io/stars/';
const REGISTER = STARS + 'blocks/blocks.json';
const RAW = 'https://raw.githubusercontent.com/';
const ENGINE_REPO = 'Ventusltd/ventus-grid-engine';
const PIN = 'd9cd18b0e2034325814924e6e4a0e958014f2748';   /* the engine commit the estate imports */
const ROOT = '../../';
const BUCKET = 500;            /* stars/code/index.json bucket_size; checked when the index is read */
const WINDOW_MAX = 160;        /* lines shown when a function is longer than this */
const RUN_MS = 2000;
const FETCH_MS = 15000;        /* Grid Atlas: every fetch has a 15 s AbortController timeout */
const MAX_FIELDS = 40;         /* digit fields on one selected line */
const REACH = 22;              /* px: the wafer's own tap reach (app.mjs nearestKeyAt) */
const DISCLAIMER = 'Illustrative physics drawn by a computer from published data. Not an engineering design or certified calculation. Any real design above 100 kW needs study and approval by a qualified chartered electrical engineer under the applicable standards.';

/* The first input each engine module's own proof calls it with. `evidence` must
   appear, whitespace collapsed, in the proof file at PIN or the run is refused. */
const FIXTURES = {
  'engine/voltage-drop.js': {
    fn: 'voltageDropVolts',
    input: { currentA: 200, lengthM: 250, resistanceOhmPerKm: 0.1, reactanceOhmPerKm: 0.08, powerFactor: 0.9, phases: 'three' },
    proof: 'proofs/voltage-drop.proof.mjs',
    evidence: "currentA: 200, lengthM: 250, resistanceOhmPerKm: 0.1, reactanceOhmPerKm: 0.08, powerFactor: 0.9, phases: 'three'"
  },
  'engine/current-from-power.js': {
    fn: 'currentFromMvaAtKv',
    input: { mva: 1200, kv: 400 },
    proof: 'proofs/current-from-power.proof.mjs',
    evidence: 'currentFromMvaAtKv({ mva: 1200, kv: 400 })'
  }
};

/* Which single-line-diagram element an engine module feeds, and through which
   function. The function must exist in the fetched source or the answer is
   withheld; the field it returns (quantity, unit) is read from that source. */
const SLD = {
  'engine/voltage-drop.js': { element: 'cable route (the feeder cable between two busbars)', fn: 'voltageDropVolts' },
  'engine/current-from-power.js': { element: 'feeder (the current a circuit rating implies)', fn: 'currentFromMvaAtKv' },
  'engine/firm-capacity.js': { element: 'transformer (firm capacity of a substation\'s units)', fn: 'firmCapacityMva' },
  'engine/power-factor.js': { element: 'feeder (reactive power and its correction)', fn: 'correctionKvar' },
  'engine/route-obstacles.js': { element: 'cable route (length with crossings)', fn: 'routeEstimate' },
  'engine/published-fault-level.js': { element: 'protection (a published fault level at a busbar)', fn: 'quote' }
};

/* ── fetching: one queue of two, bounded caches ─────────────────────────────── */

class Queue {
  constructor(n) { this.n = n; this.active = 0; this.waiting = []; }
  async add(task, onWait) {
    if (this.active >= this.n) { onWait?.(); await new Promise(r => this.waiting.push(r)); }
    this.active++;
    try { return await task(); }
    finally { this.active--; this.waiting.shift()?.(); }
  }
}
class LRU {
  constructor(n) { this.n = n; this.m = new Map(); }
  get(k) { const v = this.m.get(k); if (v !== undefined) { this.m.delete(k); this.m.set(k, v); } return v; }
  set(k, v) { this.m.delete(k); this.m.set(k, v); while (this.m.size > this.n) this.m.delete(this.m.keys().next().value); }
  delete(k) { this.m.delete(k); }
  get size() { return this.m.size; }
}
const queue = new Queue(2);
const sources = new LRU(8);
const buckets = new LRU(4);
const once = new Map();
let fetchCount = 0;

function cached(cache, url, parse, onWait) {
  let p = cache.get(url);
  if (!p) {
    p = queue.add(async () => {
      fetchCount++;
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), FETCH_MS);
      try {
        const r = await fetch(url, { signal: ac.signal });
        if (!r.ok) throw new Error(url + ' returned HTTP ' + r.status);
        return await (parse === 'json' ? r.json() : r.text());
      } catch (e) {
        throw e.name === 'AbortError' ? new Error(url + ` gave no answer within ${FETCH_MS / 1000} s`) : e;
      } finally { clearTimeout(t); }
    }, onWait);
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}
const onceMap = { get: k => once.get(k), set: (k, v) => once.set(k, v), delete: k => once.delete(k) };
const rawURL = (repo, commit, path) => `${RAW}${repo}/${commit}/${path}`;
const ghURL = (repo, commit, path, a, b) => `https://github.com/${repo}/blob/${commit}/${path}` + (a ? `#L${a}` + (b && b !== a ? `-L${b}` : '') : '');

function register() {
  return cached(onceMap, REGISTER, 'json').then(j => {
    if (!j._bySymbol) {
      const m = new Map();
      for (const b of j.blocks || []) if (!m.has(b.symbol)) m.set(b.symbol, b);
      Object.defineProperty(j, '_bySymbol', { value: m });
    }
    return j._bySymbol;
  });
}
async function familyRecord(n, onWait) {
  const idx = await cached(onceMap, STARS + 'code/index.json', 'json', onWait);
  const size = idx.bucket_size ?? BUCKET;
  const b = Math.floor(n / size);
  if (Array.isArray(idx.buckets) && !idx.buckets.includes(b)) return { missing: `bucket ${b} is not listed in stars/code/index.json` };
  const j = await cached(buckets, `${STARS}code/f/${b}.json`, 'json', onWait);
  const rec = j[String(n)];
  return rec ? { rec, bucket: b } : { missing: `family #${n} is not in bucket ${b}` };
}
const readSource = (repo, commit, path, onWait) => cached(sources, rawURL(repo, commit, path), 'text', onWait)
  .then(t => t.split('\n').map(l => l.replace(/\r$/, '')));

/* ── DOM helpers: fetched text only ever meets textContent ─────────────────── */

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = String(text);
  return e;
};
const link = (href, text) => { const a = el('a', 'cc-link', text); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; };
const row = (dl, k, ...v) => { dl.append(el('dt', null, k)); const dd = el('dd'); dd.append(...v.map(x => typeof x === 'string' ? document.createTextNode(x) : x)); dl.append(dd); return dd; };
const btn = (text, cls, on) => { const b = el('button', cls || 'popup-btn', text); b.type = 'button'; b.addEventListener('click', on); return b; };

const $ = id => document.getElementById(id);
let W = null;          /* { U, redraw } from app.mjs */
let token = 0;         /* the card belongs to the latest open only */
let mark = null;       /* {kind:'key', key} | {kind:'point', x, y, key} | {kind:'route', keys} */
let waitingKey = -1;

export function bindWafer(w) { W = w; window.__wafer?.onDraw.add(drawMark); }

window.addEventListener('wafer:families', () => { if (waitingKey > 0) openLine(waitingKey); });

/* ── the sheet ─────────────────────────────────────────────────────────────── */

function sheet(title, sub) {
  const mine = ++token;
  const card = $('card');
  card.replaceChildren();
  card.hidden = false;
  card.scrollTop = 0;
  const x = btn('×', 'cc-x', closeCard); x.setAttribute('aria-label', 'close');
  const t = el('span', 'cc-title', title);
  card.append(x, t);
  if (sub) card.append(el('span', 'cc-grey', sub));
  const tagLine = el('div', 'cc-tagline');
  const tag = el('span', 'cc-tag'), msg = el('span', 'cc-grey');
  tagLine.append(tag, msg);
  card.append(tagLine);
  const body = el('div', 'cc-body');
  card.append(body);
  const setTag = (s, text) => {                 /* the single writer of the state */
    if (mine !== token) return false;
    tag.dataset.s = s; tag.textContent = s;
    if (text != null) msg.textContent = text;
    return true;
  };
  return { mine, card, body, setTag, live: () => mine === token };
}

function closeCard() { token++; $('card').hidden = true; $('card').replaceChildren(); mark = null; waitingKey = -1; W?.redraw(); }
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('card').hidden) closeCard(); });

/* A card opening under a finger must not take that same tap's click. */
let swallowUntil = 0;
document.addEventListener('click', e => {
  if (performance.now() < swallowUntil && e.target instanceof Element && e.target.closest('#card')) { e.preventDefault(); e.stopPropagation(); }
}, true);

/* ── the tap ───────────────────────────────────────────────────────────────── */

export function cardTap(cx, cy) {
  if (!W?.U?.pos) return;
  swallowUntil = performance.now() + 450;
  const hit = window.__layers?.pickAt?.(cx, cy);
  if (hit?.feature?.geometry?.type === 'LineString') {
    /* on one of the route's own stops: that line's card; on the stroke between stops: the route's */
    const v = window.__wafer.view, fam = hit.feature.properties?.family;
    let stop = -1, bestD = 14 * 14;
    for (const k of hit.feature.geometry.keys) {
      const [x, y] = place(k), dx = (x - v.x) * v.zoom + v.w / 2 - cx, dy = v.h / 2 - (y - v.y) * v.zoom - cy, d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; stop = k; }
    }
    if (stop > 0) return openLine(stop, { layer: hit.layer, family: fam });
    return openRoute(hit.layer, hit.feature);
  }
  if (hit?.feature?.geometry?.type === 'Point') return openLine(hit.feature.geometry.key, { layer: hit.layer, props: hit.feature.properties });
  const v = window.__wafer.view;
  const wx = (cx - v.w / 2) / v.zoom + v.x, wy = (v.h / 2 - cy) / v.zoom + v.y;
  const near = nearestIssued(wx, wy);
  if (near && near.d * v.zoom <= REACH) return openLine(near.key);
  return openArea(wx, wy, near, v.zoom);
}

function nearestIssued(wx, wy) {
  const { pos, keys, n } = W.U;
  let best = -1, bestD = Infinity;
  for (let i = 0; i < n; i++) {
    const dx = pos[i * 2] - wx, dy = pos[i * 2 + 1] - wy, d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best < 0 ? null : { key: keys[best], d: Math.sqrt(bestD) };
}
const lowerBound = (arr, x) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < x) lo = m + 1; else hi = m; } return lo; };
const issuedIn = (a, b) => lowerBound(W.U.keys, b) - lowerBound(W.U.keys, a);   /* keys in [a, b) */

/* ── marks on the wafer ─────────────────────────────────────────────────────── */

const markCanvas = document.createElement('canvas');
markCanvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2';
document.body.appendChild(markCanvas);
const mctx = markCanvas.getContext('2d');
let drawnMark = false;

function drawMark(v) {
  if (!mark && !drawnMark) return;
  const dpr = v.dpr || 1, Wd = Math.round(v.w * dpr), H = Math.round(v.h * dpr);
  if (markCanvas.width !== Wd || markCanvas.height !== H) { markCanvas.width = Wd; markCanvas.height = H; }
  mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  mctx.clearRect(0, 0, v.w, v.h);
  drawnMark = !!mark;
  if (!mark) return;
  const S = ([x, y]) => [(x - v.x) * v.zoom + v.w / 2, v.h / 2 - (y - v.y) * v.zoom];
  mctx.lineWidth = 1.6; mctx.strokeStyle = '#00ffff';
  if (mark.kind === 'route') {
    mctx.beginPath();
    mark.keys.forEach((k, i) => { const [x, y] = S(place(k)); i ? mctx.lineTo(x, y) : mctx.moveTo(x, y); });
    mctx.setLineDash([6, 4]); mctx.stroke(); mctx.setLineDash([]);
    for (const k of [mark.keys[0], mark.keys[mark.keys.length - 1]]) { const [x, y] = S(place(k)); mctx.beginPath(); mctx.arc(x, y, 10, 0, 6.2832); mctx.stroke(); }
    return;
  }
  if (mark.kind === 'point') {
    const [px, py] = S([mark.x, mark.y]);
    mctx.beginPath(); mctx.moveTo(px - 8, py); mctx.lineTo(px + 8, py); mctx.moveTo(px, py - 8); mctx.lineTo(px, py + 8); mctx.stroke();
    if (mark.key > 0) {
      const [kx, ky] = S(place(mark.key));
      mctx.setLineDash([3, 3]); mctx.beginPath(); mctx.moveTo(px, py); mctx.lineTo(kx, ky); mctx.stroke(); mctx.setLineDash([]);
      mctx.beginPath(); mctx.arc(kx, ky, 9, 0, 6.2832); mctx.stroke();
    }
    return;
  }
  const [x, y] = S(place(mark.key));
  mctx.strokeStyle = '#ffd54a';
  mctx.beginPath(); mctx.arc(x, y, 11, 0, 6.2832); mctx.stroke();
}

/* ── a line ────────────────────────────────────────────────────────────────── */

export async function openLine(key, opts = {}) {
  const U = W.U;
  mark = { kind: 'key', key }; W.redraw();
  const i = indexOfKey(U.keys, key);
  const chars = i >= 0 ? U.lens[i] : null;
  const { body, setTag, live } = sheet('Line ' + fmt(key),
    i < 0 ? ' number never issued' : ' ' + (chars === 65535 ? 'at least 65,535 characters' : fmt(chars) + (chars === 1 ? ' character' : ' characters')));
  if (opts.layer) { const s = el('div', 'cc-small', 'tapped on the layer ' + opts.layer.label); body.append(s); }
  const q = { sld: null, use: null, next: null, machine: null };

  if (i < 0) {
    setTag('EMPTY', `This number was never issued (the numbering runs 1 to ${fmt(U.meta.max)}), so no file holds a line with this key.`);
    return questions(body, { sld: 'none yet: no line has this key.', use: 'nothing: the key was never issued.', next: 'not established: there is no line to follow.', machine: `input: key ${key} · output: none · source: numbered database ${U.meta.built_utc}` });
  }
  if (!U.ownerOf) {
    waitingKey = key;
    setTag('WAIT', 'the family index is still loading; this card fills in when it lands');
    return;
  }
  waitingKey = -1;
  const famIdx = U.ownerOf.get(key) || [];
  if (!famIdx.length) {
    setTag('EMPTY', 'No function family carries this line, so the numbered database records no file and commit for it and its text cannot be read from a pinned place.');
    return questions(body, {
      sld: 'none yet: the line belongs to no function family.',
      use: 'not established: no family, block or file is recorded for this line.',
      next: 'not established: with no family there is no recorded use or dependency.',
      machine: `input: key ${key} · output: none · ${fmt(chars)} characters in the numbered database (built ${U.meta.built_utc})`
    });
  }
  const fams = famIdx.map(f => U.families[f]);
  let chosen = opts.family != null ? fams.find(f => f.n === opts.family) : null;
  chosen ||= fams.find(f => f.block) || fams[0];

  /* family chooser */
  const famRow = el('div', 'cc-row');
  famRow.append(el('span', 'cc-grey', `${fmt(fams.length)} ${fams.length === 1 ? 'family carries' : 'families carry'} it · `));
  if (fams.length > 1) {
    const sel = el('select', 'cc-select'); sel.setAttribute('aria-label', 'family');
    for (const f of fams.slice(0, 60)) { const o = el('option', null, `#${f.n} ${f.name}${f.block ? ' · ' + f.block : ''}`); o.value = f.n; if (f === chosen) o.selected = true; sel.append(o); }
    sel.addEventListener('change', () => openLine(key, { ...opts, family: Number(sel.value), place: 0 }));
    famRow.append(sel);
    if (fams.length > 60) famRow.append(el('span', 'cc-small', ` first 60 of ${fmt(fams.length)}`));
  } else famRow.append(el('span', 'cc-amber', `#${chosen.n} ${chosen.name}`));
  body.append(famRow);

  const onWait = () => setTag('WAIT', 'queued behind other fetches (two at a time)…');
  setTag('LOAD', `reading family #${chosen.n}'s record from the modular star…`);
  let fr, reg = null;
  try { [fr, reg] = await Promise.all([familyRecord(chosen.n, onWait), register().catch(() => null)]); }
  catch (e) { setTag('FAIL', 'Could not read the family record: ' + e.message); return; }
  if (!live()) return;
  if (fr.missing) { setTag('EMPTY', 'No place is recorded: ' + fr.missing + '.'); return; }
  const rec = fr.rec;
  const block = chosen.block && reg ? reg.get(chosen.block) : null;
  const places = rec.places || [];
  if (!places.length) { setTag('EMPTY', `Family #${chosen.n} records no place in any file.`); return; }
  const pi = Math.min(opts.place ?? 0, places.length - 1);
  const pl = places[pi];
  const at = [];
  rec.lines.forEach((k, j) => { if (k === key) at.push(j); });

  const meta = el('dl', 'cc-dl');
  row(meta, 'family', `#${chosen.n} ${(rec.names || [chosen.name]).join(', ')} · ${chosen.kind}${chosen.category ? ' · ' + chosen.category : ''}`);
  row(meta, 'block', chosen.block ? `${chosen.block}${block ? ' · ' + block.title : ' · not found in the live register'}` : 'none: no block in the register names this family');
  const app = row(meta, 'app', pl.repo);
  if (pl.live) { app.append(' · '); app.append(link(pl.live, 'live page')); }
  if (places.length > 1) {
    const sel = el('select', 'cc-select'); sel.setAttribute('aria-label', 'place');
    places.slice(0, 40).forEach((p, j) => { const o = el('option', null, `${j + 1}. ${p.repo.split('/')[1]} · ${p.path}`); o.value = j; if (j === pi) o.selected = true; sel.append(o); });
    sel.addEventListener('change', () => openLine(key, { ...opts, family: chosen.n, place: Number(sel.value) }));
    row(meta, 'place', sel, places.length > 40 ? ` first 40 of ${places.length}` : ` ${places.length} places`);
  }
  body.append(meta);

  if (!at.length) {
    setTag('EMPTY', `Family #${chosen.n}'s record does not list line ${key} among its ${rec.lines.length} lines, although the family pack says it carries it. That disagreement is shown, not smoothed over.`);
    return;
  }
  const fileLine = pl.first + at[0];
  setTag('LOAD', `fetching ${pl.path} at ${pl.commit.slice(0, 7)}…`);
  let lines;
  try { lines = await readSource(pl.repo, pl.commit, pl.path, onWait); }
  catch (e) { setTag('FAIL', 'Could not read the source: ' + e.message); return; }
  if (!live()) return;
  if (pl.last > lines.length) { setTag('FAIL', `The place record says lines ${pl.first}–${pl.last}, but the file at ${pl.commit.slice(0, 7)} has ${lines.length} lines.`); return; }

  const text = lines[fileLine - 1];
  const agree = chars === 65535 ? null : text.length === chars;
  let a = pl.first, b = pl.last;
  if (b - a + 1 > WINDOW_MAX) { a = Math.max(pl.first, fileLine - WINDOW_MAX / 2); b = Math.min(pl.last, a + WINDOW_MAX - 1); }

  const head = el('div', 'cc-codehead');
  head.append(`${pl.path} · ${pl.repo} @ ${pl.commit.slice(0, 7)} · line ${fileLine}` +
    (at.length > 1 ? ` (also at ${at.slice(1, 6).map(j => pl.first + j).join(', ')})` : '') +
    ` · function lines ${pl.first}–${pl.last}${a !== pl.first || b !== pl.last ? `, showing ${a}–${b}` : ''} · `);
  head.append(link(ghURL(pl.repo, pl.commit, pl.path, pl.first, pl.last), 'file at this commit on GitHub'));
  body.append(head);
  body.append(el('div', 'cc-check', agree === null
    ? `This line reaches the database's 16-bit length ceiling, so its length cannot confirm the match.`
    : agree ? `The text at line ${fileLine} is ${fmt(text.length)} characters, the length the numbered database holds for key ${key}.`
            : `Not confirmed: line ${fileLine} is ${fmt(text.length)} characters but the numbered database holds ${fmt(chars)} for key ${key}. Shown as read.`));

  const editor = codeWindow(lines, a, b, fileLine);
  body.append(editor.node);
  setTag('OK', `family #${chosen.n}, place ${pi + 1} of ${places.length}, at the commit the modular star pins`);
  requestAnimationFrame(() => editor.scrollToTarget());

  const engineModule = pl.repo === ENGINE_REPO && /^engine\/[A-Za-z0-9._-]+\.js$/.test(pl.path) ? pl.path : null;
  if (engineModule) body.append(runPanel(engineModule, pl, lines, editor, rec.names || []));

  /* the three questions and the machine detail, from the record and the source */
  const fnText = lines.slice(pl.first - 1, pl.last).join('\n');
  const who = (xs, verb) => xs?.length
    ? `${verb} ${xs.slice(0, 8).map(u => `#${u.family} ${u.name}`).join(', ')}${xs.length > 8 ? ` and ${xs.length - 8} more` : ''} (name-match inference by the modular star build: a needed name linked to the families defining it, ${[...new Set(xs.map(u => u.via || 'by name'))].join(' / ')})`
    : null;
  const sld = SLD[engineModule];
  let sldText;
  if (sld) {
    const src = lines.join('\n');
    const has = new RegExp(`export\\s+function\\s+${sld.fn}\\b`).test(src);
    const out = has ? outputsOf(functionBody(lines, sld.fn)) : [];
    sldText = has ? `${sld.element}: ${pl.path} → ${sld.fn}()${out.length ? ' returns ' + out.join('; ') : ''}. The page's module-to-element table, with the function checked present in this file at ${pl.commit.slice(0, 7)}.`
                  : `not established: ${sld.fn} is not exported by ${pl.path} at ${pl.commit.slice(0, 7)}.`;
  } else sldText = engineModule
    ? `none yet: ${pl.path} is an engine module this page does not map to a diagram element.`
    : `none yet: ${pl.path} in ${pl.repo} is not an engine module, and no diagram element is recorded for family #${chosen.n}.`;
  const dep = block?.depends_on?.length ? `the register's depends_on for block ${block.symbol}: ${block.depends_on.join(', ')}` : null;
  q.sld = sldText;
  q.use = `${block ? `block ${block.symbol} (${block.title})` : 'no block'} · function ${(rec.names || []).join(', ')} · ${pl.path} @ ${pl.commit.slice(0, 7)} in ${pl.repo}${rec.places.length > 1 ? `, and ${rec.places.length - 1} other places` : ''}. Called by: ${who(rec.used_by, '') || 'no caller is recorded in the family record'}.`;
  q.next = [who(rec.uses, 'It uses'), dep].filter(Boolean).join(' · ') || `not established: family #${chosen.n} records no uses and ${block ? `block ${block.symbol} declares no depends_on` : 'no block declares a dependency'}.`;
  q.machine = machineDetail(fnText, lines, pl);
  questions(body, q);
}

/* The code window. One <pre> holding one text node for the whole window, one
   highlight bar for the tapped line and one for the selected line. Tapping a
   row selects it; only the selected line is split into digit fields, in one
   strip below that is re-filled on every selection. Edits live in a Map for as
   long as this card is open. */
const DIGITS = /(?<![A-Za-z_$])\d+/g;
function codeWindow(lines, a, b, target) {
  const edits = new Map();              /* line -> string[] of digit-run values */
  const runs = n => [...lines[n - 1].matchAll(DIGITS)];
  const changedOn = n => { const v = edits.get(n); return !!v && runs(n).some((m, i) => v[i] !== m[0]); };
  const lineText = n => {
    const vals = edits.get(n);
    if (!vals) return lines[n - 1];
    let i = 0;
    return lines[n - 1].replace(DIGITS, m => { const v = vals[i++]; return v ?? m; });
  };
  let total = 0;
  for (let n = a; n <= b; n++) total += runs(n).length;

  const wrap = el('div', 'cc-codewrap');
  const pre = el('pre', 'cc-code');
  pre.setAttribute('aria-label', 'source code; tap a line to edit its digits');
  const text = document.createTextNode('');
  const hiTarget = el('div', 'cc-hi cc-hi-target'), hiSel = el('div', 'cc-hi cc-hi-sel');
  pre.append(hiTarget, hiSel, text);
  const paint = () => {
    const out = [];
    for (let n = a; n <= b; n++) out.push(String(n).padStart(4) + (changedOn(n) ? '*' : ' ') + ' ' + lineText(n));
    text.nodeValue = out.join('\n');
  };
  const lh = () => parseFloat(getComputedStyle(pre).lineHeight) || 16;
  const padTop = () => parseFloat(getComputedStyle(pre).paddingTop) || 0;
  const placeBar = (bar, n) => { bar.style.top = (padTop() + (n - a) * lh()) + 'px'; bar.style.height = lh() + 'px'; };

  const strip = el('div', 'cc-strip');
  const stripHead = el('div', 'cc-grey');
  const stripLine = el('div', 'cc-stripline');
  const note = el('div', 'cc-local');
  const nav = el('div', 'cc-nav');
  let sel = target;
  const refresh = () => {
    let changed = 0;
    for (const [n, v] of edits) runs(n).forEach((m, i) => { if (v[i] !== m[0]) changed++; });
    note.textContent = `${total} digit ${total === 1 ? 'run' : 'runs'} in this window · ${changed} changed · local edit, not saved, not published`;
  };
  function select(n) {
    sel = Math.max(a, Math.min(b, n));
    placeBar(hiSel, sel);
    const ms = runs(sel);
    stripHead.textContent = `line ${sel}` + (ms.length ? ` · ${ms.length} digit ${ms.length === 1 ? 'run' : 'runs'}` : ' · no digits on this line; tap another line or step to the next with digits');
    stripLine.replaceChildren();
    if (!edits.has(sel) && ms.length) edits.set(sel, ms.map(m => m[0]));
    const vals = edits.get(sel);
    let last = 0;
    const src = lines[sel - 1];
    ms.slice(0, MAX_FIELDS).forEach((m, i) => {
      if (m.index > last) stripLine.append(document.createTextNode(src.slice(last, m.index)));
      const inp = el('input', 'cc-digit');
      inp.value = vals[i]; inp.size = Math.max(1, vals[i].length);
      inp.setAttribute('inputmode', 'numeric'); inp.setAttribute('pattern', '[0-9]*'); inp.setAttribute('autocomplete', 'off');
      inp.setAttribute('aria-label', `digits ${m[0]} on line ${sel}`);
      inp.dataset.line = String(sel);
      inp.classList.toggle('cc-changed', vals[i] !== m[0]);
      inp.addEventListener('input', () => {
        const clean = inp.value.replace(/\D/g, '');
        if (clean !== inp.value) inp.value = clean;
        inp.size = Math.max(1, clean.length);
        vals[i] = clean;
        inp.classList.toggle('cc-changed', clean !== m[0]);
        inp.classList.toggle('cc-blank', clean === '');
        paint(); refresh();
      });
      stripLine.append(inp);
      last = m.index + m[0].length;
    });
    if (ms.length > MAX_FIELDS) stripLine.append(document.createTextNode(` … ${ms.length - MAX_FIELDS} more digit runs on this line are not offered`));
    else if (last < src.length) stripLine.append(document.createTextNode(src.slice(last)));
  }
  const step = dir => { for (let n = sel + dir; n >= a && n <= b; n += dir) if (runs(n).length) return select(n); };
  nav.append(btn('◀ digits', 'cc-mini', () => step(-1)), btn('digits ▶', 'cc-mini', () => step(1)),
    btn('reset digits', 'cc-mini', () => { edits.clear(); paint(); select(sel); refresh(); }));
  pre.addEventListener('click', e => {
    const y = e.clientY - pre.getBoundingClientRect().top + pre.scrollTop - padTop();
    select(a + Math.floor(y / lh()));
  });
  strip.append(stripHead, stripLine, nav, note);
  wrap.append(pre, strip);
  paint(); refresh();
  return {
    node: wrap,
    edits() {
      const out = [];
      for (const [n, v] of edits) {
        if (!changedOn(n)) continue;
        out.push({ line: n, before: lines[n - 1], after: lineText(n), blank: v.some(x => x === '') });
      }
      return out;
    },
    select,
    scrollToTarget() {
      placeBar(hiTarget, target); select(sel);
      pre.scrollTop = Math.max(0, (target - a) * lh() - pre.clientHeight / 3);
    }
  };
}

/* ── run with my edit ──────────────────────────────────────────────────────── */

function runPanel(path, pl, lines, editor, names) {
  const box = el('div', 'cc-run');
  const fx = FIXTURES[path];
  box.append(el('div', 'cc-sub', 'RUN THE MODULE'));
  if (!fx) {
    const t = el('span', 'cc-tag', 'EMPTY'); t.dataset.s = 'EMPTY';
    box.append(t, el('span', 'cc-grey', ` No proof fixture is wired to this page for ${path}. Runs are offered for ${Object.keys(FIXTURES).join(' and ')}, each with the first input its own proof uses.`));
    return box;
  }
  box.append(el('div', 'cc-grey', `Calls ${fx.fn}(${JSON.stringify(fx.input)}) — scenario input, the first fixture in ${fx.proof} — on ${path} at ${PIN.slice(0, 7)}, the commit the estate imports, in a worker with no network and a 2 s limit.`));
  if (!names.includes(fx.fn)) box.append(el('div', 'cc-local', `This window is ${names.join(', ')}; the run calls ${fx.fn}. An edit here changes the answer only if ${fx.fn} reaches it.`));
  const go = btn('RUN WITH MY EDIT', 'popup-btn popup-btn-images', () => run());
  const out = el('div', 'cc-results');
  box.append(go, out);

  async function run() {
    const mine = token;
    go.disabled = true;
    out.replaceChildren(el('div', 'cc-grey', 'reading the module, its imports and its proof at ' + PIN.slice(0, 7) + '…'));
    const urls = [];
    try {
      const edits = editor.edits();
      if (edits.some(e => e.blank)) throw refusal('A digit field is empty; an empty field is not a number, so nothing was run.');
      const [pinned, proof] = await Promise.all([
        readSource(ENGINE_REPO, PIN, path),
        cached(onceMap, rawURL(ENGINE_REPO, PIN, fx.proof), 'text')
      ]);
      if (!proof.replace(/\s+/g, ' ').includes(fx.evidence)) throw refusal(`The fixture was not found in ${fx.proof} at ${PIN.slice(0, 7)}, so this page will not claim it is the proof's input.`);
      /* carry each edited line onto the module as imported */
      const edited = pinned.slice();
      const placed = [];
      for (const e of edits) {
        let at = -1;
        if (pl.commit === PIN || pinned[e.line - 1] === e.before) at = e.line - 1;
        else {
          const hits = []; pinned.forEach((l, j) => { if (l === e.before) hits.push(j); });
          if (hits.length !== 1) throw refusal(`Line ${e.line} as shown (${pl.commit.slice(0, 7)}) appears ${hits.length} times in ${path} at ${PIN.slice(0, 7)}, so the edit cannot be placed without guessing.`);
          at = hits[0];
        }
        if (pinned[at] !== e.before) throw refusal(`Line ${e.line} differs at ${PIN.slice(0, 7)}; the edit was not applied.`);
        edited[at] = e.after; placed.push(`line ${e.line} → ${PIN.slice(0, 7)} line ${at + 1}`);
      }
      const deps = new Map();
      const origURL = await moduleURL(path, pinned.join('\n'), deps, urls, 0);
      const editURL = edits.length ? await moduleURL(path, edited.join('\n'), deps, urls, 0) : origURL;
      const [A, B] = await Promise.all([runIn(origURL, fx), edits.length ? runIn(editURL, fx) : null]);
      if (mine !== token) return;
      out.replaceChildren();
      out.append(el('div', 'cc-grey', edits.length ? `${edits.length} edited ${edits.length === 1 ? 'line' : 'lines'} applied: ${placed.join('; ')}.` : 'No digit changed: both columns are the same published text, so the one run is shown twice.'));
      const grid = el('div', 'cc-cols');
      grid.append(result('as published @ ' + PIN.slice(0, 7), A), result(edits.length ? 'with your edit (local)' : 'with your edit (none made)', B ?? A));
      out.append(grid, el('div', 'cc-disclaimer', DISCLAIMER));
    } catch (e) {
      if (mine !== token) return;
      out.replaceChildren(el('div', 'cc-refuse', e.refusal ? e.message : 'Could not run: ' + e.message));
    } finally {
      for (const u of urls) URL.revokeObjectURL(u);
      go.disabled = false;
    }
  }
  return box;
}
const refusal = m => Object.assign(new Error(m), { refusal: true });

/* A module's text as a Blob URL, its relative imports read at PIN and rewritten
   to Blob URLs of their own. Anything that would reach the network is refused. */
async function moduleURL(path, text, deps, urls, depth) {
  if (depth > 6) throw refusal('The import chain is deeper than six modules; not run.');
  if (/\bimport\s*\(/.test(text)) throw refusal(`${path} uses a dynamic import(), which could reach the network; not run.`);
  const specRe = /(\b(?:import|export)\b[^'";]*?\bfrom\s*|\bimport\s*)(['"])([^'"]+)\2/g;
  const specs = [...text.matchAll(specRe)].map(m => m[3]);
  const map = new Map();
  for (const s of new Set(specs)) {
    if (!s.startsWith('./') && !s.startsWith('../')) throw refusal(`${path} imports "${s}", which is not a file of this repository; not run.`);
    const target = new URL(s, 'https://x/' + path).pathname.slice(1);
    if (!deps.has(target)) {
      const t = (await readSource(ENGINE_REPO, PIN, target)).join('\n');
      deps.set(target, await moduleURL(target, t, deps, urls, depth + 1));
    }
    map.set(s, deps.get(target));
  }
  const rewritten = text.replace(specRe, (all, pre, q, s) => pre + q + map.get(s) + q);
  const u = URL.createObjectURL(new Blob([rewritten], { type: 'text/javascript' }));
  urls.push(u);
  return u;
}

const WORKER_SRC = `
const refuse = () => { throw new Error('network access is refused inside this run'); };
for (const k of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'Request', 'navigator']) {
  try { Object.defineProperty(self, k, { value: refuse, configurable: false, writable: false }); } catch (e) { try { self[k] = refuse; } catch (e2) {} }
}
self.onmessage = async ({ data }) => {
  try {
    const m = await import(data.url);
    if (typeof m[data.fn] !== 'function') { postMessage({ ok: false, kind: 'NotExported', message: 'the module exports no function named ' + data.fn }); return; }
    const r = m[data.fn](data.input);
    postMessage({ ok: true, result: JSON.parse(JSON.stringify(r)) });
  } catch (e) {
    postMessage({ ok: false, kind: (e && e.name) || 'Error', message: String(e && e.message !== undefined ? e.message : e) });
  }
};`;

function runIn(url, fx) {
  return new Promise(resolve => {
    const wurl = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
    let w;
    const done = r => { clearTimeout(timer); try { w?.terminate(); } catch (e) {} URL.revokeObjectURL(wurl); resolve(r); };
    const timer = setTimeout(() => done({ ok: false, kind: 'Stopped', message: `stopped after ${RUN_MS / 1000} s without an answer` }), RUN_MS);
    try { w = new Worker(wurl, { type: 'module' }); }
    catch (e) { done({ ok: false, kind: 'NoWorker', message: 'this browser would not start a module worker: ' + e.message }); return; }
    w.onmessage = e => done(e.data);
    w.onerror = e => { e.preventDefault?.(); done({ ok: false, kind: 'SyntaxOrLoadError', message: e.message || 'the edited module could not be loaded (a syntax error, or an import that failed)' }); };
    w.postMessage({ url, fn: fx.fn, input: fx.input });
  });
}

function result(label, r) {
  const col = el('div', 'cc-col');
  col.append(el('div', 'cc-sub', label));
  if (!r.ok) {
    col.append(el('div', 'cc-refuse', `${r.kind}: ${r.message}`));
    col.dataset.value = 'refused';
    return col;
  }
  const v = r.result;
  const head = v && typeof v === 'object' && 'value' in v ? `${v.value} ${v.unit ?? ''}`.trim() : JSON.stringify(v);
  col.dataset.value = v && typeof v === 'object' && 'value' in v ? String(v.value) : head;
  col.append(el('div', 'cc-value', head));
  if (v?.quantity) col.append(el('div', 'cc-grey', v.quantity));
  const pre = el('pre', 'cc-json', JSON.stringify(v, null, 1));
  col.append(pre);
  return col;
}

/* ── the machine detail: read from the source text ─────────────────────────── */

const UNIT_SUFFIX = [
  ['OhmPerKm', 'ohm per kilometre'], ['Kwh', 'kilowatt-hours'], ['Mwh', 'megawatt-hours'], ['Gwh', 'gigawatt-hours'], ['Twh', 'terawatt-hours'],
  ['Kvar', 'kilovolt-amperes reactive'], ['Mva', 'megavolt-amperes'], ['Kva', 'kilovolt-amperes'], ['Va', 'volt-amperes'],
  ['Kw', 'kilowatts'], ['Mw', 'megawatts'], ['Gw', 'gigawatts'], ['Kv', 'kilovolts'], ['Km2', 'square kilometres'], ['Km', 'kilometres'],
  ['Gbp', 'pounds sterling'], ['Percent', 'percent'], ['Hz', 'hertz'], ['Deg', 'degrees'], ['M', 'metres'], ['A', 'amperes'], ['V', 'volts'], ['W', 'watts']
];
const WHOLE_NAME = { mva: 'megavolt-amperes', kv: 'kilovolts', kw: 'kilowatts', mw: 'megawatts', kva: 'kilovolt-amperes', hours: 'hours', lat: 'degrees', lon: 'degrees' };
function unitOf(name) {
  if (WHOLE_NAME[name]) return WHOLE_NAME[name];
  for (const [s, u] of UNIT_SUFFIX) if (name.length > s.length && name.endsWith(s) && /[a-z0-9]/.test(name[name.length - s.length - 1])) return u;
  return null;
}
function functionBody(lines, fn) {
  const start = lines.findIndex(l => new RegExp(`function\\s+${fn}\\b`).test(l));
  if (start < 0) return '';
  let depth = 0, seen = false;
  for (let j = start; j < lines.length; j++) {
    for (const c of lines[j].replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '')) { if (c === '{') { depth++; seen = true; } else if (c === '}') depth--; }
    if (seen && depth <= 0) return lines.slice(start, j + 1).join('\n');
  }
  return lines.slice(start).join('\n');
}
function outputsOf(text) {
  const out = [];
  for (const m of text.matchAll(/quantity:\s*'([^']+)'[\s\S]{0,120}?unit:\s*'([^']*)'/g)) out.push(`${m[1]} in ${m[2]}`);
  return [...new Set(out)];
}
function machineDetail(fnText, lines, pl) {
  const sig = fnText.match(/function\s*\*?\s*[\w$]*\s*\(([\s\S]*?)\)\s*\{/) || fnText.match(/\(([^()]*)\)\s*=>/);
  let inputs = 'no parameter list read from this window';
  if (sig) {
    const names = sig[1].replace(/[{}\[\]]/g, '').split(',').map(p => p.split('=')[0].split(':').pop().trim()).filter(p => /^[A-Za-z_$][\w$]*$/.test(p));
    inputs = names.length ? names.map(n => { const u = unitOf(n); return u ? `${n} (${u})` : `${n} (no unit in the name)`; }).join(', ') : 'none';
  }
  const outs = outputsOf(fnText);
  const throws = [...new Set([...fnText.matchAll(/throw\s+new\s+(\w+)/g)].map(m => m[1]))];
  const src = lines.join('\n');
  const nc = src.match(/export\s+const\s+NOT_COMPUTED\s*=\s*Object\.freeze\(\{([\s\S]*?)\n\}\);/);
  const ncKeys = nc ? [...nc[1].matchAll(/^\s{2,8}([A-Za-z_$][\w$]*)\s*:/gm)].map(m => m[1]) : [];
  const other = [...src.matchAll(/export\s+const\s+(NOT_[A-Z_]+|NO_[A-Z_]+|NEVER_[A-Z_]+)\s*=/g)].map(m => m[1]).filter(n => n !== 'NOT_COMPUTED' || !nc);
  return `inputs: ${inputs} (units read from parameter name suffixes, name-match inference) · outputs: ${outs.length ? outs.join('; ') : 'no quantity/unit fields in this function'} · refusals: ${throws.length ? 'throws ' + throws.join(', ') : 'no throw in this function'}${ncKeys.length ? ' · NOT_COMPUTED: ' + ncKeys.join(', ') : ''}${other.length ? ' · also ' + other.join(', ') : ''} · source ${pl.repo} ${pl.path} @ ${pl.commit}`;
}

function questions(body, q) {
  const d = el('details', 'cc-q');
  if (window.matchMedia('(min-width: 760px)').matches) d.open = true;
  d.append(el('summary', null, 'Questions'));
  const dl = el('dl', 'cc-dl');
  row(dl, 'draws', q.sld);
  row(dl, 'used for', q.use);
  row(dl, 'leads to', q.next);
  d.append(el('div', 'cc-small', '1 how does this help draw a system or single-line diagram · 2 what is this code used for, and who calls it · 3 where does it lead next'), dl);
  const m = el('div', 'cc-machine'); m.append(el('span', 'cc-sub', 'Machine detail '), document.createTextNode(q.machine));
  d.append(m);
  body.append(d);
}

/* ── a route ───────────────────────────────────────────────────────────────── */

async function openRoute(layer, f) {
  const keys = f.geometry.keys || [];
  mark = { kind: 'route', keys }; W.redraw();
  const p = f.properties || {};
  const { body, setTag, live } = sheet(layer.label, ` route · ${fmt(keys.length)} stops`);
  const dl = el('dl', 'cc-dl');
  const module = [p.block && `block ${p.block}`, p.function && `function ${p.function}`, p.family != null && `family #${p.family}`, p.module_path].filter(Boolean).join(' · ');
  row(dl, 'module', module || 'the route names no module');
  const first = keys[0], last = keys[keys.length - 1];
  row(dl, 'first line', btn(fmt(first), 'cc-key', () => openLine(first, { family: p.family })));
  row(dl, 'last line', btn(fmt(last), 'cc-key', () => openLine(last, { family: p.family })));
  for (const [k, v] of Object.entries(p)) if (!['block', 'function', 'family'].includes(k)) row(dl, k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  body.append(dl);
  const stops = el('div', 'cc-stops');
  stops.append(el('div', 'cc-sub', 'STOPS, IN ROUTE ORDER'));
  const shownStops = keys.slice(0, 400);
  stops.append(el('div', 'cc-stoplist', shownStops.map((k, j) => `${j + 1}:${k}`).join('  ') + (keys.length > 400 ? `  … and ${fmt(keys.length - 400)} more` : '')));
  const pick = el('input', 'cc-pick'); pick.setAttribute('inputmode', 'numeric'); pick.setAttribute('aria-label', 'stop number'); pick.value = '1';
  const openStop = btn('OPEN STOP', 'cc-mini', () => {
    const j = Number(pick.value.replace(/\D/g, '')) - 1;
    if (j >= 0 && j < keys.length) openLine(keys[j], { family: p.family });
    else pick.value = '1';
  });
  const pr = el('div', 'cc-row'); pr.append(el('span', 'cc-grey', `stop 1 to ${keys.length}: `), pick, openStop);
  stops.append(pr);
  body.append(stops, el('div', 'cc-small', 'evidence: ' + (layer.evidence ?? 'none recorded') + ' · tap a stop to open its code card'));

  if (p.family == null) {
    setTag('OK', 'the route as the layer draws it');
    return questions(body, { sld: 'none yet: this route names no family.', use: `drawn by the layer ${layer.id}; it names no module.`, next: 'not established: the route names no family to follow.', machine: `input: ${fmt(keys.length)} keys · output: a polyline through their placements · source: layers/${layer.id}` });
  }
  setTag('LOAD', `reading family #${p.family}'s record…`);
  let fr, reg;
  try { [fr, reg] = await Promise.all([familyRecord(p.family, () => setTag('WAIT', 'queued behind other fetches…')), register().catch(() => null)]); }
  catch (e) { setTag('FAIL', 'Could not read the family record: ' + e.message); return; }
  if (!live()) return;
  if (fr.missing) { setTag('EMPTY', fr.missing); return; }
  const rec = fr.rec, pl = rec.places?.[0], block = p.block && reg ? reg.get(p.block) : null;
  if (pl) {
    const h = el('div', 'cc-codehead');
    h.append(`${pl.path} · ${pl.repo} @ ${pl.commit.slice(0, 7)} · lines ${pl.first}–${pl.last} · `, link(ghURL(pl.repo, pl.commit, pl.path, pl.first, pl.last), 'on GitHub'));
    body.insertBefore(h, stops);
  }
  const sld = pl ? SLD[pl.path] : null;
  setTag('OK', `family #${p.family}: ${(rec.names || []).join(', ')}`);
  questions(body, {
    sld: sld && pl.repo === ENGINE_REPO ? `${sld.element}: ${pl.path} → ${sld.fn}(). The page's module-to-element table; open a stop to see the function checked in its source.` : `none yet: ${pl ? pl.path : 'this family'} is not mapped to a diagram element.`,
    use: `${block ? `block ${block.symbol} (${block.title})` : 'no block in the register'} · function ${(rec.names || []).join(', ')}${pl ? ` · ${pl.path} @ ${pl.commit.slice(0, 7)}` : ''} · called by: ${rec.used_by?.length ? rec.used_by.slice(0, 8).map(u => `#${u.family} ${u.name}`).join(', ') + ' (name-match inference)' : 'no caller recorded'}.`,
    next: rec.uses?.length ? `uses ${rec.uses.slice(0, 8).map(u => `#${u.family} ${u.name} (${u.via})`).join(', ')} (name-match inference)` : `not established: family #${p.family} records no uses${block?.depends_on?.length ? '' : ' and its block declares no depends_on'}.`,
    machine: `route: ${fmt(keys.length)} keys from ${fmt(first)} to ${fmt(last)}, ${p.route ?? 'order as stored in the layer'} · family lines in the record: ${rec.lines.length}${pl ? ` · source ${pl.repo} ${pl.path} @ ${pl.commit}` : ''}`
  });
}

/* ── empty ground ──────────────────────────────────────────────────────────── */

let bandS = null;
async function tileBandWidth() {
  if (bandS) return bandS;
  const m = await cached(onceMap, ROOT + 'layers/manifest.json', 'json');
  const t = (m.layers || []).find(l => l.tiles);
  if (!t) return null;
  const idx = await cached(onceMap, ROOT + t.tiles, 'json');
  bandS = idx.scheme?.S ? { S: idx.scheme.S, law: idx.scheme.law, layer: t.id } : null;
  return bandS;
}

async function openArea(wx, wy, near, zoom) {
  const U = W.U;
  mark = { kind: 'point', x: wx, y: wy, key: near?.key ?? -1 }; W.redraw();
  const r = Math.hypot(wx, wy) / SPACING;
  const b = Math.floor(r);
  const k0 = b * b, k1 = (b + 1) * (b + 1);
  const { body, setTag, live } = sheet('Empty ground', ` radius ${r.toFixed(2)} · no line within ${REACH} px`);
  const dl = el('dl', 'cc-dl');
  row(dl, 'point', `x ${wx.toFixed(2)}, y ${wy.toFixed(2)} in wafer units`);
  row(dl, 'ring', `r = sqrt(key) puts radius ${b} to ${b + 1} at keys ${fmt(k0)} to ${fmt(k1 - 1)} · ${fmt(issuedIn(k0, k1))} of those ${fmt(k1 - k0)} numbers were issued`);
  const bandDD = row(dl, 'tile band', 'reading the tile scheme…');
  if (near) {
    const dd = row(dl, 'nearest line', btn(fmt(near.key), 'cc-key', () => openLine(near.key)));
    dd.append(` · ${near.d.toFixed(2)} units away, ${(near.d * zoom).toFixed(0)} px at this zoom · ${(U.ownerOf?.get(near.key) || []).length} ${(U.ownerOf?.get(near.key) || []).length === 1 ? 'family' : 'families'}`);
  }
  body.append(dl);
  setTag('OK', 'computed from the placement law and the issued keys');
  questions(body, {
    sld: 'none yet: empty ground draws nothing.',
    use: `nothing: no issued line sits within ${REACH} px of this point.`,
    next: near ? `the nearest issued line, ${fmt(near.key)}; tap its number for its code card.` : 'not established: no issued line was found.',
    machine: `input: a tap at wafer x ${wx.toFixed(2)}, y ${wy.toFixed(2)} · output: radius ${r.toFixed(3)} and key range [${k0}, ${k1}) from r = sqrt(key) · source: numbered database built ${U.meta.built_utc}`
  });
  try {
    const t = await tileBandWidth();
    if (!live()) return;
    if (!t) { bandDD.textContent = 'EMPTY: no layer in the manifest is tiled, so no tile band scheme is published'; return; }
    const tb = Math.floor(Math.floor(Math.sqrt(Math.max(0, Math.floor(r * r)))) / t.S);
    const a = (tb * t.S) ** 2, z = ((tb + 1) * t.S) ** 2;
    bandDD.textContent = `band ${tb} of the layer tiles (${t.law}, S = ${t.S}, read from layers/tiles/${t.layer}): keys ${fmt(a)} to ${fmt(z - 1)} · ${fmt(issuedIn(a, z))} issued`;
  } catch (e) { if (live()) bandDD.textContent = 'FAIL: could not read the tile scheme: ' + e.message; }
}

window.__codecard = Object.freeze({
  get fetches() { return fetchCount; },
  get cachedSources() { return sources.size; },
  get cachedBuckets() { return buckets.size; },
  openLine: (k, o) => openLine(k, o)
});
