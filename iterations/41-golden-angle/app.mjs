/* The Placement Law — the page. The mathematics lives in law.mjs, which reads
   every constant from ../../lib.mjs. This file loads (Grid Atlas grammar),
   draws on canvases and fills text; it computes nothing about the law itself. */
import * as L from './law.mjs';
import { parseKey, fmt } from '../../lib.mjs';
import { GOLDEN_ANGLE, SUBSTRATE, place as waferPlace } from '../../wafer.mjs';

const DATA = 'https://globalgrid2050.com/testcode/202609142202/data/';
/* Scenario input bound for the N slider: the numbering's maximum when this page
   was written. When the key list is loaded the measured maximum replaces it. */
let NMAX = 342795;
const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const f4 = x => Number.isFinite(x) ? x.toFixed(4) : '—';

/* ── loading, as Grid Atlas does it ─────────────────────────────────────── */
class FetchQueue {
  constructor(c) { this.c = c; this.active = 0; this.q = []; this.peak = 0; }
  async add(task) {
    if (this.active >= this.c) await new Promise(r => this.q.push(r));
    this.active++; this.peak = Math.max(this.peak, this.active);
    try { return await task(); } finally { this.active--; if (this.q.length) this.q.shift()(); }
  }
}
const queue = new FetchQueue(3);
const urlCache = new Map();
const fetchLog = [];
function fetchOnce(url, as) {
  if (urlCache.has(url)) return urlCache.get(url);
  const p = queue.add(async () => {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 15000);
    fetchLog.push(url);
    try {
      const res = await fetch(url, { signal: ctl.signal, cache: 'default' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      if (as === 'bin') return await res.arrayBuffer();
      if (as === 'text') return await res.text();
      return await res.json();
    } catch (e) {
      throw new Error(e && e.name === 'AbortError' ? 'timed out after 15 s' : (e && e.message) || String(e));
    } finally { clearTimeout(timer); }
  }).catch(e => { urlCache.delete(url); throw e; });
  urlCache.set(url, p);
  return p;
}

const RT = { keys: { loaded: false, loading: null, status: 'WAIT', detail: '' } };
function updateUIState(state, detail) {
  RT.keys.status = state; RT.keys.detail = detail || '';
  const t = detail ? `${state} · ${detail}` : state;
  $('st-s1').textContent = t; $('st-s4').textContent = t;
}
const D = { keys: null, meta: null, bytes: 0, gaps: null };

function ensureKeys() {
  const s = RT.keys;
  if (s.loaded || s.loading) return s.loading || Promise.resolve();
  updateUIState('LOAD', 'key list');
  s.loading = Promise.all([fetchOnce(DATA + 'all-lines.meta.json', 'json'), fetchOnce(DATA + 'all-lines.bin', 'bin')])
    .then(([meta, buf]) => {
      const keys = new Uint32Array(buf);
      if (!keys.length) { updateUIState('EMPTY', 'the key list holds no keys'); s.loading = null; return; }
      for (let i = 1; i < keys.length; i++) if (keys[i] <= keys[i - 1]) throw new Error('key list is not strictly ascending at index ' + i);
      D.keys = keys; D.meta = meta; D.bytes = buf.byteLength; D.gaps = L.gaps(keys);
      s.loaded = true; s.loading = null;
      updateUIState('OK', `${fmt(keys.length)} keys`);
      if (D.gaps.max > NMAX) NMAX = D.gaps.max;
      $('prov').textContent = `numbered database built ${String(meta.built_utc).slice(0, 16).replace('T', ' ')} UTC · pack ${String(meta.source && meta.source.sha256 || '').slice(0, 12)} · all-lines.bin ${fmt(D.bytes)} bytes read`;
      setN(S.n, false);
      schedule();
    })
    .catch(e => { s.loading = null; updateUIState('FAIL', e.message + ' (close and reopen to retry)'); schedule(); });
  return s.loading;
}

/* ── state ──────────────────────────────────────────────────────────────── */
const ANGLES = [
  { id: 'golden', label: 'golden angle (lib.mjs GOLDEN)', theta: L.GOLDEN },
  { id: '137.5', label: '137.5° (the golden angle rounded)', theta: 137.5 / 360 * L.TAU },
  { id: '137', label: '137°', theta: 137 / 360 * L.TAU },
  { id: '5/13', label: '2π·5/13 (rational)', theta: L.TAU * 5 / 13 },
  { id: '34/89', label: '2π·34/89 (Fibonacci ratio)', theta: L.TAU * 34 / 89 },
  { id: 'sqrt2', label: '2π·(1/√2)', theta: L.TAU / Math.SQRT2 },
  { id: 'pi', label: '2π·(1/π)', theta: L.TAU * (1 / Math.PI) }
];
const S = { n: 2000, angA: '5/13', angB: 'sqrt2', rings: 8, before: 2000, pending: false, timings: {} };

const sliderToN = v => Math.max(1, Math.round(Math.exp(v / 1000 * Math.log(NMAX))));
const nToSlider = n => Math.round(Math.log(Math.max(1, n)) / Math.log(NMAX) * 1000);

function setN(n, fromSlider) {
  S.n = Math.min(NMAX, Math.max(1, n));
  if (!fromSlider) $('nrange').value = nToSlider(S.n);
  if (document.activeElement !== $('nnum')) $('nnum').value = String(S.n);
  $('nmsg').textContent = `N = ${fmt(S.n)} · slider bound ${fmt(NMAX)}${RT.keys.loaded ? ' (measured maximum key)' : ' (scenario input; the measured maximum replaces it when the key list loads)'}`;
}

let raf = 0;
function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }

/* ── drawing: one image buffer per canvas, never one node per key ───────── */
const bufs = new WeakMap();
function prep(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');
  let img = bufs.get(canvas);
  if (!img || img.width !== w || img.height !== h) { img = ctx.createImageData(w, h); bufs.set(canvas, img); }
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) { d[i] = 3; d[i + 1] = 4; d[i + 2] = 7; d[i + 3] = 255; }
  return { ctx, img, w, h, dpr };
}
function frame(c, R) {
  const half = Math.min(c.w, c.h) / 2;
  const scale = (half - 6 * c.dpr) / Math.max(R, 1e-9);
  return { ...c, R, scale, cx: c.w / 2, cy: c.h / 2 };
}
/* Splat positions pos[0..2n) into the buffer with colour rgb and strength a.
   `pick(i)` may filter. Point radius follows pixels per wafer unit. */
function splat(f, pos, n, rgb, a, pick) {
  const { img, w, h, scale, cx, cy } = f, d = img.data;
  const rad = Math.min(5 * f.dpr, Math.max(0.5, 0.3 * scale));
  const offs = [];
  const ri = Math.max(0, Math.ceil(rad - 0.5));
  for (let oy = -ri; oy <= ri; oy++) for (let ox = -ri; ox <= ri; ox++) if (ox * ox + oy * oy <= rad * rad + 0.25) offs.push(ox, oy);
  /* dense discs would saturate to a flat fill: scale strength by coverage, the
     stamps per pixel of the disc, so structure stays readable at any N */
  const discPx = Math.PI * Math.pow(f.R * scale, 2) || 1;
  const coverage = n * (offs.length / 2) / discPx;
  const k = a * Math.max(0.18, Math.min(1, 0.35 / coverage));
  const r = rgb[0] * k, g = rgb[1] * k, b = rgb[2] * k;
  for (let i = 0; i < n; i++) {
    if (pick && !pick(i)) continue;
    const px = Math.round(cx + pos[i * 2] * scale), py = Math.round(cy - pos[i * 2 + 1] * scale);
    for (let o = 0; o < offs.length; o += 2) {
      const x = px + offs[o], y = py + offs[o + 1];
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const j = (y * w + x) * 4;
      d[j] += r; d[j + 1] += g; d[j + 2] += b;
    }
  }
}
const put = f => f.ctx.putImageData(f.img, 0, 0);

/* ── section 1 ──────────────────────────────────────────────────────────── */
function renderS1() {
  const t0 = performance.now();
  const n = S.n, m = S.rings, R = L.SPACING * Math.sqrt(n);
  const ints = L.integers(n), pos = L.placeAll(ints);
  const bounds = L.ringBounds(R, m);
  const cInt = L.countRings(pos, bounds);
  const cLin = L.countRings(L.placeLinear(ints, n), bounds);
  let iss = null, issPos = null, nIss = 0;
  if (RT.keys.loaded) {
    nIss = L.countAtMost(D.keys, n);
    issPos = L.placeAll(D.keys.subarray(0, nIss));
    iss = L.countRings(issPos, bounds);
  }
  const f = frame(prep($('c1')), R);
  splat(f, pos, n, [70, 82, 110], 1);
  if (issPos) splat(f, issPos, nIss, [220, 240, 255], 1);
  put(f);
  const ctx = f.ctx;
  ctx.strokeStyle = 'rgba(94,200,242,0.75)'; ctx.lineWidth = f.dpr;
  for (let i = 1; i <= m; i++) { ctx.beginPath(); ctx.arc(f.cx, f.cy, bounds[i] * f.scale, 0, L.TAU); ctx.stroke(); }
  $('c1lab').textContent = `${fmt(n)} integers${issPos ? ' · ' + fmt(nIss) + ' issued' : ''} · ${m} rings`;

  const tb = $('t1').tBodies[0];
  while (tb.rows.length > m) tb.deleteRow(-1);
  while (tb.rows.length < m) { const tr = tb.insertRow(); for (let c = 0; c < 6; c++) tr.insertCell(); }
  const area = Math.PI * R * R / m;
  let lo = Infinity, hi = -Infinity, llo = Infinity, lhi = -Infinity;
  for (let i = 0; i < m; i++) {
    const c = tb.rows[i].cells;
    c[0].textContent = i + 1;
    c[1].textContent = `${bounds[i].toFixed(2)}–${bounds[i + 1].toFixed(2)}`;
    c[2].textContent = area.toFixed(2);
    c[3].textContent = fmt(cInt.counts[i]);
    c[4].textContent = fmt(cLin.counts[i]);
    c[5].textContent = iss ? fmt(iss.counts[i]) : (RT.keys.status === 'FAIL' ? 'FAIL' : RT.keys.status === 'EMPTY' ? 'EMPTY' : 'WAIT');
    lo = Math.min(lo, cInt.counts[i]); hi = Math.max(hi, cInt.counts[i]);
    llo = Math.min(llo, cLin.counts[i]); lhi = Math.max(lhi, cLin.counts[i]);
  }
  let issLine = '';
  if (iss) {
    let a = Infinity, b = -Infinity;
    for (const v of iss.counts) { a = Math.min(a, v); b = Math.max(b, v); }
    issLine = ` Issued keys ≤ N: ${fmt(nIss)}, from ${fmt(a)} to ${fmt(b)} per ring; the rings with fewer are the ones holding more never-issued numbers (section 4), not an effect of the projection.`;
  } else if (RT.keys.status === 'FAIL') issLine = ` Issued keys: FAIL, ${RT.keys.detail}.`;
  $('s1sum').innerHTML = '';
  $('s1sum').append(
    `Each ring has area ${fmt(area.toFixed(2))} square units. Under r = SPACING·√key the integers per ring run from `, el('b', null, fmt(lo)), ' to ', el('b', null, fmt(hi)),
    ` (N/rings = ${(n / m).toFixed(2)}; ${fmt(cInt.outside)} outside). Under r ∝ key the same keys run from ${fmt(llo)} to ${fmt(lhi)}: crowded at the centre, thin at the rim.${issLine}`);
  S.timings.s1 = performance.now() - t0;
}

/* ── section 2 ──────────────────────────────────────────────────────────── */
const nnCache = new Map();
function measure(ang, n) {
  const key = ang.id + ':' + n;
  if (nnCache.has(key)) return nnCache.get(key);
  const keys = L.integers(n);
  const pos = ang.id === 'golden' ? L.placeAll(keys) : L.placeWith(keys, ang.theta);
  const nn = L.nearest(pos, keys);
  const res = { pos, nn, arms: L.arms(ang.theta, n, nn.modal), cf: L.continuedFraction(ang.theta / L.TAU) };
  if (nnCache.size > 6) nnCache.delete(nnCache.keys().next().value);
  nnCache.set(key, res);
  return res;
}
function panel(ang, cv, dl, cap) {
  const n = S.n, m = measure(ang, n);
  const f = frame(prep(cv), L.SPACING * Math.sqrt(n));
  splat(f, m.pos, n, [150, 215, 255], 1);
  put(f);
  $(cap).textContent = ang.label;
  const turn = ang.theta / L.TAU;
  const rows = [
    ['angle', `${(ang.theta * 180 / Math.PI).toFixed(6)}° · ${turn.toFixed(12)} turn`],
    ['continued fraction', `[${m.cf.terms[0]}; ${m.cf.terms.slice(1).join(', ')}${m.cf.exhausted ? ']  ends: rational to double precision' : ', …]  first ' + m.cf.terms.length + ' terms, double precision'}`],
    ['min nearest-neighbour', `${f4(m.nn.min)} units, keys ${fmt(m.nn.minA)} and ${fmt(m.nn.minB)}`],
    ['median nearest-neighbour', `${f4(m.nn.median)} units`],
    ['arms', m.nn.modal ? `d = ${fmt(m.nn.modal)} (${(m.nn.modalShare * 100).toFixed(0)}% of outer keys)` : 'too few keys'],
    ['arm turn over disc', m.nn.modal ? `${m.arms.totalDeg.toFixed(1)}° against half-gap ${(m.arms.gapDeg / 2).toFixed(2)}°` : '—'],
    ['reads as', m.nn.modal ? (m.arms.spokes ? `${fmt(m.nn.modal)} straight spokes` : `${fmt(m.nn.modal)} spiral arms`) : '—'],
    ['measured in', `${m.nn.ms.toFixed(0)} ms, ${fmt(m.nn.visits)} distance checks (all pairs would be ${fmt(n * (n - 1) / 2)})`]
  ];
  dl.replaceChildren();
  for (const [k, v] of rows) { dl.append(el('dt', null, k)); const dd = el('dd', null, v); if (k === 'reads as') dd.style.color = '#fff'; dl.append(dd); }
  return m;
}
function renderS2() {
  const t0 = performance.now();
  const g = L.goldenCheck();
  $('gold').replaceChildren(
    'lib.mjs GOLDEN = ', el('b', null, g.lib.toPrecision(15)), ' rad; 2π·(1 − 1/φ) with φ = (1+√5)/2 = ', el('b', null, g.formula.toPrecision(15)),
    ` rad. Equal to the ${15} digits printed; at 17 digits they share ${g.digits} and differ by ${g.diff.toExponential(1)}, one step of double-precision rounding between two ways of evaluating the same number. That is ${g.degrees.toFixed(6)}° or ${g.turn.toFixed(12)} of a turn. wafer.mjs GOLDEN_ANGLE is ${Object.is(GOLDEN_ANGLE, L.GOLDEN) ? 'bit-identical to' : 'NOT bit-identical to'} lib.mjs GOLDEN.`);
  const A = ANGLES.find(a => a.id === S.angA), B = ANGLES.find(a => a.id === S.angB);
  const mg = panel(ANGLES[0], $('cG'), $('mG'), 'capG');
  panel(A, $('cA'), $('mA'), 'capA');
  panel(B, $('cB'), $('mB'), 'capB');
  S.goldenFaithful = L.sameBits(L.placeWith(L.integers(Math.min(S.n, 5000)), L.GOLDEN), L.placeAll(L.integers(Math.min(S.n, 5000))));
  S.timings.s2 = performance.now() - t0;
  S.lastGolden = mg.nn;
}

/* ── section 3 ──────────────────────────────────────────────────────────── */
function readKeys() {
  return ['k1', 'k2', 'k3'].map(id => ({ id, raw: $(id).value, p: parseKey($(id).value) }));
}
function renderS3() {
  const t0 = performance.now();
  const nb = Math.min(S.before, NMAX), na = S.n;
  const posB = L.placeAll(L.integers(nb)), posA = L.placeAll(L.integers(na));
  const tb = $('t3').tBodies[0];
  const ks = readKeys();
  while (tb.rows.length < 3) { const tr = tb.insertRow(); for (let c = 0; c < 5; c++) tr.insertCell(); }
  let same = 0, valid = 0;
  const marks = [];
  ks.forEach((k, i) => {
    const c = tb.rows[i].cells;
    if (!k.p.ok) { c[0].textContent = k.raw || '(empty)'; c[1].textContent = 'refused: ' + k.p.why; c[2].textContent = ''; c[3].textContent = ''; c[4].textContent = ''; return; }
    const key = k.p.key; valid++;
    const exact = waferPlace(key);
    const f32 = new Float32Array(exact);
    const from = (pos, n) => key <= n ? [pos[(key - 1) * 2], pos[(key - 1) * 2 + 1]] : [f32[0], f32[1]];
    const b = from(posB, nb), a = from(posA, na);
    const bits = Object.is(b[0], a[0]) && Object.is(b[1], a[1]) && Object.is(a[0], f32[0]) && Object.is(a[1], f32[1]);
    if (bits) same++;
    c[0].textContent = fmt(key);
    c[1].textContent = `${key <= nb ? '' : 'not yet in set · '}${b[0].toFixed(5)}, ${b[1].toFixed(5)}`;
    c[2].textContent = `${key <= na ? '' : 'not yet in set · '}${a[0].toFixed(5)}, ${a[1].toFixed(5)}`;
    c[3].textContent = bits ? 'yes' : 'no';
    const rb = Math.sqrt(key / nb), ra = Math.sqrt(key / na), t = key * L.GOLDEN;
    const moved = Math.hypot(ra * Math.cos(t) - rb * Math.cos(t), ra * Math.sin(t) - rb * Math.sin(t));
    c[4].textContent = nb === na ? "moves 0 (N unchanged)" : `would move by ${(moved / rb * 100).toFixed(1)}% of its radius`;
    marks.push([a[0], a[1], key]);
  });
  $('s3sum').textContent = `N before ${fmt(nb)} → N after ${fmt(na)}: ${same} of ${valid} valid keys have bit-identical coordinates, and each equals place(key) from wafer.mjs stored as Float32. Under a law that normalised by N (last column) every key would slide whenever a key was added, and every layer, link and card pointing at it would break.`;

  const R = L.SPACING * Math.sqrt(Math.max(na, nb, ...marks.map(m => m[2])));
  const f = frame(prep($('c3')), R);
  const lo = Math.min(na, nb);
  splat(f, posA, lo, [80, 95, 125], 1);
  if (na > nb) splat(f, posA, na, [60, 170, 215], 1, i => i >= nb);
  put(f);
  const ctx = f.ctx;
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.setLineDash([4 * f.dpr, 4 * f.dpr]); ctx.lineWidth = f.dpr;
  ctx.beginPath(); ctx.arc(f.cx, f.cy, L.SPACING * Math.sqrt(nb) * f.scale, 0, L.TAU); ctx.stroke(); ctx.setLineDash([]);
  ctx.font = `${11 * f.dpr}px ui-monospace, monospace`; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6 * f.dpr;
  marks.forEach(([x, y, key], i) => {
    const px = f.cx + x * f.scale, py = f.cy - y * f.scale;
    ctx.beginPath(); ctx.arc(px, py, 7 * f.dpr, 0, L.TAU); ctx.stroke();
    ctx.fillText(fmt(key), px + 9 * f.dpr, py + (i - 1) * 13 * f.dpr - 2 * f.dpr);
  });
  $('c3lab').textContent = `dashed circle: extent of N before (${fmt(nb)})`;
  const k2 = ks[1].p.ok ? ks[1].p.key : 1;
  $('q-code').href = `../31-code-card-everywhere/?line=${k2}`;
  $('q-wafer').href = `../../?line=${k2}`;
  S.timings.s3 = performance.now() - t0;
  S.s3 = { nb, na, same, valid };
}

/* ── section 4 ──────────────────────────────────────────────────────────── */
function renderS4() {
  const t0 = performance.now();
  const sum = $('s4sum');
  if (!RT.keys.loaded) {
    sum.textContent = RT.keys.status === 'FAIL' ? `FAIL — ${RT.keys.detail}` : RT.keys.status === 'LOAD' ? 'LOAD — fetching the key list.' : 'WAIT — the key list loads when this section or section 1 is opened.';
    return;
  }
  const g = D.gaps, keys = D.keys;
  sum.replaceChildren(
    'Issued keys ', el('b', null, fmt(g.issued)), ' of the integers 1…', el('b', null, fmt(g.max)), ' (the largest issued key): ',
    el('b', null, (g.issued / g.max * 100).toFixed(2) + '%'), ` issued, ${fmt(g.absent)} never issued, in ${fmt(g.runs)} separate gaps; the longest gap is ${fmt(g.longest)} numbers starting at ${fmt(g.longestFrom)}. Meta file says ${fmt(D.meta.lines)} lines, max ${fmt(D.meta.max)}: ${D.meta.lines === g.issued && D.meta.max === g.max ? 'agrees with the count' : 'DOES NOT agree with the count'}.`);
  /* bands */
  const m = 32, bd = L.bands(keys, g.max, m);
  const cb = $('c4b'), dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(cb.clientWidth * dpr), h = Math.round(cb.clientHeight * dpr);
  if (cb.width !== w || cb.height !== h) { cb.width = w; cb.height = h; }
  const ctx = cb.getContext('2d');
  ctx.fillStyle = '#030407'; ctx.fillRect(0, 0, w, h);
  const bw = w / m;
  let lo = 1, hi = 0, loB = 0;
  for (let b = 0; b < m; b++) {
    const s = bd.issued[b] / bd.size[b];
    if (s < lo) { lo = s; loB = b; } hi = Math.max(hi, s);
    ctx.fillStyle = '#1b2030'; ctx.fillRect(b * bw + dpr, 4 * dpr, bw - 2 * dpr, h - 8 * dpr);
    ctx.fillStyle = '#d8dee9'; const bh = (h - 8 * dpr) * s; ctx.fillRect(b * bw + dpr, h - 4 * dpr - bh, bw - 2 * dpr, bh);
  }
  $('c4blab').textContent = `${m} equal bands of the numbering 1…${fmt(g.max)}; bar height = share issued in that band, from ${(lo * 100).toFixed(1)}% (band ${loB + 1}) to ${(hi * 100).toFixed(1)}%.`;
  /* wafer of holes */
  const n = Math.min(S.n, g.max);
  const ints = L.integers(n), pos = L.placeAll(ints);
  const nIss = L.countAtMost(keys, n);
  const isIssued = new Uint8Array(n);
  for (let i = 0; i < nIss; i++) isIssued[keys[i] - 1] = 1;
  const f = frame(prep($('c4')), L.SPACING * Math.sqrt(n));
  splat(f, pos, n, [26, 30, 42], 1, i => !isIssued[i]);
  splat(f, pos, n, [220, 240, 255], 1, i => isIssued[i] === 1);
  put(f);
  $('c4lab').textContent = `1…${fmt(n)}: ${fmt(nIss)} issued, ${fmt(n - nIss)} holes (${(nIss / n * 100).toFixed(1)}% issued)`;
  S.timings.s4 = performance.now() - t0;
}

/* ── questions: who imports place() ─────────────────────────────────────── */
const IMPORTERS = ['app.mjs', 'layers-panel.mjs', 'proof/checks.mjs',
  ...['01-route-alpha/app.mjs', '01-route-alpha/layers-panel.mjs', '02-tunnels/app.mjs', '02-tunnels/layers-panel.mjs', '03-code-particle/app.mjs',
    '04-400kv-engine/app.mjs', '04-400kv-engine/layers-panel.mjs', '05-periodic-table/app.mjs', '05-periodic-table/layers-panel.mjs',
    '06-stars-as-engines/app.mjs', '06-stars-as-engines/engines.mjs',
    '07-code-card/app.mjs', '07-code-card/code-card.mjs', '07-code-card/layers-panel.mjs', '08-space-and-time/app.mjs', '08-space-and-time/layers-panel.mjs',
    '09-deeplink-receiver/app.mjs', '09-deeplink-receiver/layers-panel.mjs', '10-ground-bridge/app.mjs', '10-ground-bridge/layers-panel.mjs',
    '11-the-bond/app.mjs', '12-visibility-lab/model.mjs', '21-dark-pixels/app.mjs', '21-dark-pixels/layers-panel.mjs', '22-fast-zoom/app.mjs',
    '26-apps-layers-substrate/app.mjs', '26-apps-layers-substrate/layers-panel.mjs', '30-journey/app.mjs', '31-code-card-everywhere/app.mjs',
    '31-code-card-everywhere/card.mjs', '31-code-card-everywhere/layers-panel.mjs', '32-spider-and-galaxy/wafer-pane.mjs', '33-engines-as-tools/demo.mjs',
    '36-elements-assembly/assembly.mjs', '36-elements-assembly/wafer.mjs'].map(p => 'iterations/' + p)];
const IMP = { started: false, rows: [], done: 0, found: 0, local: 0, missing: 0, failed: 0 };
const IMPORT_RE = /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
function verifyImporters() {
  if (IMP.started) return;
  IMP.started = true;
  const ul = $('q-imp');
  for (const p of IMPORTERS) { const li = el('li', 'dim', `${p} · WAIT`); ul.append(li); IMP.rows.push(li); }
  const sum = () => { $('q-imp-sum').textContent = `${IMP.done} of ${IMPORTERS.length} read · ${IMP.found} import place from lib.mjs or wafer.mjs at the repository root · ${IMP.local} from a copy inside their own directory · ${IMP.missing} no such import found · ${IMP.failed} FAIL`; };
  sum();
  IMPORTERS.forEach((p, i) => {
    fetchOnce('../../' + p, 'text').then(src => {
      let hit = null;
      for (const m of src.matchAll(IMPORT_RE)) {
        const names = m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]);
        if (names.includes('place') && /(lib|wafer)\.mjs$/.test(m[2])) { hit = m; break; }
      }
      const li = IMP.rows[i];
      if (hit) {
        const root = /^(\.\.\/)+(lib|wafer)\.mjs$|^\.\/(lib|wafer)\.mjs$/.test(hit[2]) && (p.startsWith('iterations/') ? hit[2].startsWith('../../') : true);
        if (root) IMP.found++; else IMP.local++;
        const line = src.slice(0, hit.index).split('\n').length;
        li.className = ''; li.textContent = `${p} line ${line}: place from ${hit[2]}${root ? '' : ' (a copy in its own directory)'}`;
      } else { IMP.missing++; li.textContent = `${p} · EMPTY: no import of place from lib.mjs or wafer.mjs found`; }
    }).catch(e => { IMP.failed++; IMP.rows[i].textContent = `${p} · FAIL: ${e.message}`; })
      .finally(() => { IMP.done++; sum(); if (IMP.done === IMPORTERS.length) schedule(); });
  });
}

/* ── render only what is open ───────────────────────────────────────────── */
function render() {
  if ($('s1').open) renderS1();
  if ($('s2').open) renderS2();
  if ($('s3').open) renderS3();
  if ($('s4').open) renderS4();
  const t = S.timings;
  $('machine').textContent = `Machine detail · inputs: key (positive integer, a permanent line number, dimensionless; refused by lib.mjs parseKey when not digits, not exact or below 1), N (count of keys 1…N, scenario input, now ${fmt(S.n)}), angle (radians; the golden one is lib.mjs GOLDEN = ${L.GOLDEN}). Outputs: x, y and r in wafer units (lib.mjs SPACING = ${L.SPACING} unit per √key); nearest-neighbour distances in the same units; counts per ring and per band (keys). Refusals: parseKey reasons shown in section 3; key list WAIT / LOAD / OK / EMPTY / FAIL, now ${RT.keys.status}. Substrate ${SUBSTRATE.id}, law "${SUBSTRATE.law}", frozen ${SUBSTRATE.frozen_utc}. Last render ms: ${['s1', 's2', 's3', 's4'].filter(k => t[k] != null).map(k => k + ' ' + t[k].toFixed(0)).join(', ') || '—'}. Fetches ${fetchLog.length}, queue peak ${queue.peak} of 3.`;
}

/* ── wiring ─────────────────────────────────────────────────────────────── */
function init() {
  $('law-sp').textContent = String(L.SPACING);
  $('law-g').textContent = String(L.GOLDEN);
  $('q-sub').textContent = SUBSTRATE.id;
  for (const id of ['angA', 'angB']) {
    const sel = $(id);
    for (const a of ANGLES.slice(1)) { const o = el('option', null, a.label); o.value = a.id; sel.append(o); }
    sel.value = S[id];
    sel.addEventListener('change', () => { S[id] = sel.value; schedule(); });
  }
  setN(S.n, false);
  $('nrange').addEventListener('input', () => { setN(sliderToN(+$('nrange').value), true); schedule(); });
  $('nnum').addEventListener('change', () => {
    const p = parseKey($('nnum').value);
    if (!p.ok) { $('nmsg').textContent = 'N refused: ' + p.why; return; }
    if (p.key > NMAX) { $('nmsg').textContent = `N refused: above the slider bound ${fmt(NMAX)}`; return; }
    setN(p.key, false); schedule();
  });
  $('rings').addEventListener('change', () => { S.rings = +$('rings').value; schedule(); });
  for (const id of ['k1', 'k2', 'k3']) $(id).addEventListener('input', schedule);
  $('snap').addEventListener('click', () => { S.before = S.n; schedule(); });
  for (const id of ['s1', 's4']) $(id).addEventListener('toggle', () => { if ($(id).open) ensureKeys(); schedule(); });
  for (const id of ['s2', 's3']) $(id).addEventListener('toggle', schedule);
  $('questions').addEventListener('toggle', () => { if ($('questions').open) verifyImporters(); });
  let lastW = 0;
  new ResizeObserver(() => { const w = document.body.clientWidth; if (w !== lastW) { lastW = w; schedule(); } }).observe(document.body);
  schedule();
}
init();

window.__law = { S, RT, D, IMP, queue, fetchLog, setN, schedule, render, nnCache, get NMAX() { return NMAX; } };
