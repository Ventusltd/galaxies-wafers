/* One Feeder — the physics of one radial line, drawn from three engine modules.
   Formulas are never copied here: every electrical number is returned by
   ventus-grid-engine at the pinned commit. The page only scales and draws. */

const COMMIT = 'd9cd18b0e2034325814924e6e4a0e958014f2748';
const ENGINE = `https://cdn.jsdelivr.net/gh/Ventusltd/ventus-grid-engine@${COMMIT}/engine/`;
const MODULES = ['power-factor.js', 'current-from-power.js', 'voltage-drop.js'];

/* Lifted from the Grid Atlas topology config (ukConfig, "Topology (GeoJSON)"):
   the voltage levels the Atlas draws and the colour it draws each in.
   Substations are #ffffff. */
const ATLAS_VOLTAGES = [
  { kv: 400, label: '400kV', color: '#0054ff' },
  { kv: 275, label: '275kV', color: '#ff0000' },
  { kv: 220, label: '220kV', color: '#ff9900' },
  { kv: 132, label: '132kV', color: '#00cc00' },
  { kv: 66,  label: '66kV',  color: '#b200ff' },
  { kv: 11,  label: '11kV',  color: '#ff00ff' }
];
const SUBSTATION = '#ffffff';

const $ = id => document.getElementById(id);
const nf = (v, sig = 4) => Number(v).toLocaleString('en-GB', { maximumSignificantDigits: sig });

/* ── loading, Grid Atlas grammar ─────────────────────────────────────────── */
const mod = {};
const modState = Object.fromEntries(MODULES.map(m => [m, 'WAIT']));
function paintMods() {
  const box = $('mods');
  box.textContent = '';
  for (const m of MODULES) {
    const s = document.createElement('span');
    const st = modState[m];
    const sp = st.indexOf(' ');
    const b = document.createElement('b');
    b.textContent = sp < 0 ? st : st.slice(0, sp);
    s.append(b, ` engine/${m}` + (sp < 0 ? '' : ' — ' + st.slice(sp + 1)));
    box.append(s);
  }
  $('pin').textContent = `Modules imported from ventus-grid-engine at commit ${COMMIT.slice(0, 12)}.`;
}
paintMods();

/* ── scenario inputs ─────────────────────────────────────────────────────── */
const logMap = (lo, hi) => ({
  toValue: t => lo * Math.pow(hi / lo, t / 1000),
  toSlider: v => Math.round(1000 * Math.log(v / lo) / Math.log(hi / lo))
});
const round3 = v => Number(v.toPrecision(3));

const S = { kw: 3000, pf: 0.9, kvIdx: 5, phases: 'three', lengthM: 5000, r: 0.16, x: 0.1, llf: 0.3 };

const SLIDERS = [
  { key: 'kw', label: 'real power', unit: 'kW', ...logMap(10, 2e6), fmt: v => nf(v, 3), snap: round3 },
  { key: 'pf', label: 'power factor', unit: '', min: 0, max: 1.05, step: 0.01, fmt: v => v.toFixed(2),
    note: 'outside (0, 1] it is passed on as it is; the module refuses it' },
  { key: 'lengthM', label: 'length', unit: 'm', ...logMap(10, 1e5), fmt: v => nf(v, 3), snap: round3 },
  { key: 'r', label: 'resistance', unit: 'ohm/km', ...logMap(0.005, 5), fmt: v => nf(v, 3), snap: round3 },
  { key: 'x', label: 'reactance', unit: 'ohm/km', min: 0, max: 1, step: 0.01, fmt: v => v.toFixed(2) },
  { key: 'llf', label: 'loss load factor (annual loss)', unit: '', min: 0, max: 1, step: 0.01, fmt: v => v.toFixed(2) }
];

function buildInputs() {
  const box = $('inputs');
  const seg = (label, opts, isOn, onPick, colorOf) => {
    const d = document.createElement('div'); d.className = 'in';
    d.innerHTML = `<div class="row"><span></span><span class="tag">SCENARIO INPUT</span></div><div class="seg"></div>`;
    d.querySelector('.row span').textContent = label;
    const wrapEl = d.querySelector('.seg');
    opts.forEach((o, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = o.label;
      b.dataset.v = o.label;
      if (colorOf) b.style.setProperty('--c', colorOf(o));
      b.setAttribute('aria-pressed', String(isOn(o, i)));
      b.addEventListener('click', () => {
        onPick(o, i);
        wrapEl.querySelectorAll('button').forEach((bb, j) => bb.setAttribute('aria-pressed', String(isOn(opts[j], j))));
        compute();
      });
      wrapEl.append(b);
    });
    box.append(d);
  };
  const mk = s => {
    const d = document.createElement('div'); d.className = 'in';
    const id = 'in-' + s.key;
    d.innerHTML = `<div class="row"><label for="${id}"></label><span class="tag">SCENARIO INPUT</span></div>` +
      `<div class="row"><span class="dim small"></span><output></output></div>` +
      `<input type="range" id="${id}">`;
    d.querySelector('label').textContent = s.label;
    d.querySelector('.small').textContent = s.note || '';
    const inp = d.querySelector('input');
    if (s.toValue) { inp.min = 0; inp.max = 1000; inp.step = 1; inp.value = s.toSlider(S[s.key]); }
    else { inp.min = s.min; inp.max = s.max; inp.step = s.step; inp.value = S[s.key]; }
    const out = d.querySelector('output');
    const show = () => { out.textContent = s.fmt(S[s.key]) + (s.unit ? ' ' + s.unit : ''); };
    inp.addEventListener('input', () => {
      const t = Number(inp.value);
      S[s.key] = s.toValue ? s.snap(s.toValue(t)) : Number(t.toFixed(2));
      show(); compute();
    });
    show();
    box.append(d);
  };
  mk(SLIDERS[0]); mk(SLIDERS[1]);
  seg('nominal voltage (levels the Grid Atlas draws)', ATLAS_VOLTAGES, (o, i) => i === S.kvIdx, (o, i) => { S.kvIdx = i; }, o => o.color);
  seg('phases', [{ label: 'three', v: 'three' }, { label: 'single', v: 'single' }], o => o.v === S.phases, o => { S.phases = o.v; });
  SLIDERS.slice(2).forEach(mk);
}

/* ── compute: call the modules, keep what they return or the refusal ──────── */
let R = null;
function attempt(file, fn, args) {
  const f = mod[file]?.[fn];
  if (!f) return { refused: `EMPTY — engine/${file} did not load, so ${fn} could not be asked.`, empty: true };
  try { return { ok: f(args) }; }
  catch (e) { return { refused: `${file} ${fn} refused: ${e.message}` }; }
}
const waits = (what, on) => ({ refused: `EMPTY — ${what} waits on ${on}, which was not returned.`, empty: true });

function compute() {
  const V = ATLAS_VOLTAGES[S.kvIdx];
  const r = { V, input: { ...S } };
  r.q = attempt('power-factor.js', 'reactivePowerKvar', { kw: S.kw, powerFactor: S.pf });
  r.s = attempt('power-factor.js', 'apparentPowerKva', { kw: S.kw, powerFactor: S.pf });
  r.i = r.s.ok
    ? attempt('current-from-power.js', 'currentFromMvaAtKv', { mva: r.s.ok.value / 1000, kv: V.kv, phases: S.phases })
    : waits('current', 'apparent power from power-factor.js');
  const dropArgs = L => ({ currentA: r.i.ok.value, lengthM: L, resistanceOhmPerKm: S.r, reactanceOhmPerKm: S.x, powerFactor: S.pf, phases: S.phases });
  r.d = r.i.ok ? attempt('voltage-drop.js', 'voltageDropVolts', dropArgs(S.lengthM)) : waits('voltage drop', 'a current from current-from-power.js');
  r.p = r.d.ok ? attempt('voltage-drop.js', 'dropPercent', { dropVolts: r.d.ok.value, nominalVolts: V.kv * 1000 }) : waits('drop percent', 'a voltage drop');
  r.w = r.i.ok ? attempt('voltage-drop.js', 'lossesWatts', { currentA: r.i.ok.value, lengthM: S.lengthM, resistanceOhmPerKm: S.r, phases: S.phases }) : waits('losses', 'a current from current-from-power.js');
  r.a = r.w.ok ? attempt('voltage-drop.js', 'annualLossKwh', { peakLossWatts: r.w.ok.value, lossLoadFactor: S.llf }) : waits('annual loss', 'losses');
  /* The profile: the same module asked again at points along the run. */
  r.profile = null;
  if (r.d.ok) {
    const N = 32, pts = [[0, 0]];
    for (let k = 1; k <= N; k++) {
      const got = attempt('voltage-drop.js', 'voltageDropVolts', dropArgs(S.lengthM * k / N));
      if (!got.ok) { pts.length = 0; break; }
      pts.push([k / N, got.ok.value]);
    }
    if (pts.length) r.profile = pts;
  }
  R = r;
  window.__feeder = { state: { ...S }, result: summarise(r) };
  paintResults();
  drawTriangle();
}

function summarise(r) {
  const o = {};
  for (const k of ['q', 's', 'i', 'd', 'p', 'w', 'a']) o[k] = r[k].ok ? r[k].ok.value : { refused: r[k].refused };
  return o;
}

/* ── results list: rows built once, updated in place ─────────────────────── */
const ROWS = [
  ['q', 'reactive power Q', 'power-factor.js · reactivePowerKvar', v => nf(v) + ' kVAr'],
  ['s', 'apparent power S', 'power-factor.js · apparentPowerKva', v => nf(v) + ' kVA'],
  ['i', 'current', 'current-from-power.js · currentFromMvaAtKv', v => nf(v) + ' A'],
  ['d', 'voltage drop along the run', 'voltage-drop.js · voltageDropVolts', v => nf(v) + ' V'],
  ['p', 'drop as a percentage of nominal', 'voltage-drop.js · dropPercent', v => nf(v) + ' %'],
  ['w', 'losses (I squared R)', 'voltage-drop.js · lossesWatts', v => nf(v) + ' W'],
  ['a', 'annual energy lost', 'voltage-drop.js · annualLossKwh', v => nf(v) + ' kWh']
];
const rowEls = {};
function paintResults() {
  const ol = $('results');
  if (!ol.children.length) {
    for (const [k, label, fn] of ROWS) {
      const li = document.createElement('li'); li.dataset.k = k;
      li.innerHTML = `<div class="k"><span class="l"></span><span class="v"></span></div><div class="fn"></div><div class="basis"></div>`;
      li.querySelector('.l').textContent = label;
      li.querySelector('.fn').textContent = fn;
      ol.append(li); rowEls[k] = li;
    }
  }
  for (const [k, , , f] of ROWS) {
    const res = R[k], li = rowEls[k];
    li.classList.toggle('refused', !res.ok);
    li.querySelector('.v').textContent = res.ok ? f(res.ok.value) : (res.empty ? 'EMPTY' : 'REFUSED');
    let basis = res.ok ? res.ok.basis : res.refused;
    if (k === 'd' && res.ok) basis += ` Resistive ${nf(res.ok.resistiveVolts)} V, reactive ${nf(res.ok.reactiveVolts)} V.`;
    li.querySelector('.basis').textContent = basis;
  }
  const mh = mod['current-from-power.js'];
  $('headroom').textContent = mh ? 'Current is not a headroom or a rating. ' + mh.NOT_A_HEADROOM : '';
}

function paintRefusals() {
  const box = $('refuse'); box.textContent = '';
  for (const m of MODULES) {
    const nc = mod[m]?.NOT_COMPUTED;
    const det = document.createElement('details');
    const sum = document.createElement('summary');
    if (!nc) { sum.textContent = `engine/${m} — EMPTY, the module did not load`; det.append(sum); box.append(det); continue; }
    const entries = Object.entries(nc);
    sum.textContent = `engine/${m} · NOT_COMPUTED · ${entries.length} entries`;
    const dl = document.createElement('dl');
    for (const [key, words] of entries) {
      const dt = document.createElement('dt'); dt.textContent = key;
      const dd = document.createElement('dd'); dd.textContent = words;
      dl.append(dt, dd);
    }
    det.append(sum, dl); box.append(det);
  }
}

/* ── canvas helpers ───────────────────────────────────────────────────────── */
function fit(cv) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w, h };
}
/* Word-wrap into lines; the last allowed line is ellipsised if text remains. */
function lines(g, text, maxW, maxLines) {
  const words = String(text).split(/\s+/), out = [];
  let line = '';
  for (let i = 0; i < words.length; i++) {
    const t = line ? line + ' ' + words[i] : words[i];
    if (g.measureText(t).width > maxW && line) {
      out.push(line); line = words[i];
      if (out.length === maxLines) { line = ''; out[maxLines - 1] += ' …'; break; }
    } else line = t;
  }
  if (line) out.push(line);
  return out.slice(0, maxLines);
}
function refusalBox(g, text, x, y, w, maxLines = 6) {
  g.save();
  g.font = '11px ui-monospace,Menlo,Consolas,monospace';
  g.textBaseline = 'top'; g.textAlign = 'left';
  const lh = 14, ls = lines(g, text, w - 14, maxLines);
  const bh = ls.length * lh + 12;
  g.fillStyle = 'rgba(7,8,12,0.94)'; g.fillRect(x, y, w, bh);
  g.setLineDash([4, 3]); g.strokeStyle = '#d8dee9'; g.lineWidth = 1; g.strokeRect(x + .5, y + .5, w - 1, bh - 1);
  g.setLineDash([]); g.fillStyle = '#ffffff';
  ls.forEach((l, k) => g.fillText(l, x + 7, y + 6 + k * lh));
  g.restore();
  return bh;
}
const mix = (hex, t) => {
  const n = parseInt(hex.slice(1), 16), r = n >> 16, gg = (n >> 8) & 255, b = n & 255;
  const m = c => Math.round(c + (255 - c) * t);
  return `rgb(${m(r)},${m(gg)},${m(b)})`;
};
const font = (px, wgt = '') => `${wgt} ${px}px ui-monospace,Menlo,Consolas,monospace`;

/* Lit pixels: one pixel stands for a fixed number of amps from a 1-2-5 ladder,
   chosen so the line holds a readable count. Within that key the number of lit
   pixels on the line is proportional to the computed current, and the spacing
   between them follows from the current alone. Drift speed is drawn constant;
   the offset is a function of time only, so every frame is deterministic. */
const LADDER = []; for (let e = -3; e <= 6; e++) for (const m of [1, 2, 5]) LADDER.push(m * 10 ** e);
function ampsPerPixel(amps, lenPx) {
  const maxDots = Math.max(4, Math.floor(lenPx / 5));
  for (const a of LADDER) if (amps / a <= maxDots) return a;
  return LADDER[LADDER.length - 1];
}

/* ── the single-line diagram ─────────────────────────────────────────────── */
let lastKey = '';
function drawSld(tms) {
  if (!R) return;
  const { g, w, h } = fit($('sld'));
  const V = R.V;
  g.clearRect(0, 0, w, h);
  const busX = 30, lineY = 96, x0 = busX + 4, x1 = w - 58;
  const lenPx = x1 - x0;

  /* source busbar, Atlas substation white */
  g.shadowColor = SUBSTATION; g.shadowBlur = 10;
  g.fillStyle = SUBSTATION; g.fillRect(busX - 4, lineY - 40, 8, 80);
  g.shadowBlur = 0;
  g.font = font(11); g.textBaseline = 'top'; g.textAlign = 'left'; g.fillStyle = '#ffffff';
  g.fillText('source busbar', 12, 12);
  g.fillStyle = '#8b93a7'; g.fillText(`${V.label} · ${R.input.phases}-phase`, 12, 26);

  /* the line in its Atlas voltage colour, on a dark casing */
  g.lineCap = 'round';
  g.strokeStyle = '#000'; g.lineWidth = 9; g.beginPath(); g.moveTo(x0, lineY); g.lineTo(x1, lineY); g.stroke();
  g.strokeStyle = V.color; g.lineWidth = 4; g.shadowColor = V.color; g.shadowBlur = 8;
  g.beginPath(); g.moveTo(x0, lineY); g.lineTo(x1, lineY); g.stroke(); g.shadowBlur = 0;

  /* the load */
  g.strokeStyle = '#ffffff'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(x1, lineY); g.lineTo(x1 + 18, lineY); g.lineTo(x1 + 18, lineY + 16); g.stroke();
  g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(x1 + 10, lineY + 16); g.lineTo(x1 + 26, lineY + 16); g.lineTo(x1 + 18, lineY + 30); g.closePath(); g.fill();
  g.textAlign = 'right'; g.fillStyle = '#ffffff';
  g.fillText('load', w - 8, 12);
  g.fillStyle = '#8b93a7'; g.fillText(`${nf(R.input.kw, 3)} kW · pf ${R.input.pf.toFixed(2)}`, w - 8, 26);
  g.textAlign = 'left';

  /* current: lit pixels on the line, or the refusal drawn at the line */
  let key;
  if (R.i.ok) {
    const I = R.i.ok.value, per = ampsPerPixel(I, lenPx);
    const spacing = lenPx / (I / per);
    const off = ((tms / 1000) * 36) % spacing;
    g.fillStyle = mix(V.color, 0.7); g.shadowColor = mix(V.color, 0.4); g.shadowBlur = 6;
    for (let x = x0 + off; x <= x1; x += spacing) g.fillRect(Math.round(x) - 1, lineY - 1, 3, 3);
    g.shadowBlur = 0;
    g.font = font(12, 600); g.fillStyle = '#ffd54a'; g.textBaseline = 'bottom';
    g.fillText(`${nf(I)} A`, x0 + 8, lineY - 8);
    g.font = font(10.5); g.fillStyle = '#8b93a7';
    g.fillText(`1 lit pixel = ${nf(per)} A`, x0 + 8, lineY - 24);
    key = `Each lit pixel on the line stands for ${nf(per)} A. The number of pixels on the line, and so their spacing, is set by the current the module returned; they drift at a constant drawn speed.`;
  } else {
    key = 'No lit pixels: no current was returned.';
  }
  g.textBaseline = 'top'; g.font = font(10.5); g.fillStyle = '#8b93a7';
  g.fillText(`${nf(R.input.lengthM, 3)} m · R ${nf(R.input.r, 3)} · X ${R.input.x.toFixed(2)} ohm/km`, x0 + 8, lineY + 10);
  if (key !== lastKey) { $('flowkey').textContent = key; lastKey = key; }

  /* losses under the line */
  g.textAlign = 'left'; g.font = font(11);
  if (R.w.ok) {
    g.fillStyle = '#d8dee9'; g.fillText(`losses ${nf(R.w.ok.value)} W`, x0 + 8, lineY + 26);
    g.fillStyle = '#8b93a7';
    g.fillText(R.a.ok ? `${nf(R.a.ok.value)} kWh a year · loss load factor ${R.input.llf.toFixed(2)}` : 'annual loss: REFUSED (see results)', x0 + 8, lineY + 40);
  }

  /* voltage along the line */
  const top = 240, bot = h - 30, left = x0, right = x1;
  g.fillStyle = '#8b93a7'; g.font = font(11);
  g.fillText('voltage along the line', 12, top - 42);
  g.strokeStyle = '#1b2030'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(left, top); g.lineTo(left, bot); g.lineTo(right, bot); g.stroke();
  g.fillText('0 m', left, bot + 6);
  g.textAlign = 'right'; g.fillText(`${nf(R.input.lengthM, 3)} m`, right, bot + 6); g.textAlign = 'left';

  const Vn = V.kv * 1000;
  if (R.profile) {
    const dmax = R.profile[R.profile.length - 1][1];
    if (dmax >= Vn) {
      refusalBox(g, `EMPTY — the drop the module returns (${nf(dmax)} V) reaches the nominal ${nf(Vn)} V. A drop at constant current with the source held at nominal cannot describe this scenario, so no profile is drawn.`, left + 6, top, Math.min(right - left - 12, 400), 6);
    } else {
      const span = Math.max(dmax * 1.5, Vn * 0.01);
      const y = d => top + 6 + (d / span) * (bot - top - 12);
      const X = t => left + t * (right - left);
      g.fillStyle = 'rgba(255,255,255,0.04)';
      g.beginPath(); g.moveTo(X(0), bot);
      for (const [t, d] of R.profile) g.lineTo(X(t), y(d));
      g.lineTo(X(1), bot); g.closePath(); g.fill();
      const grad = g.createLinearGradient(left, 0, right, 0);
      grad.addColorStop(0, mix(V.color, 0.6)); grad.addColorStop(1, V.color);
      g.strokeStyle = grad; g.lineWidth = 3; g.shadowColor = V.color; g.shadowBlur = 10;
      g.beginPath(); R.profile.forEach(([t, d], k) => k ? g.lineTo(X(t), y(d)) : g.moveTo(X(t), y(d))); g.stroke();
      g.shadowBlur = 0;
      g.fillStyle = mix(V.color, 0.85);
      for (const [t, d] of R.profile) g.fillRect(Math.round(X(t)) - 1, Math.round(y(d)) - 1, 2, 2);
      g.fillStyle = '#d8dee9'; g.font = font(11);
      g.textBaseline = 'bottom'; g.fillText(`${nf(Vn)} V at the source`, left + 6, y(0) - 3);
      g.textAlign = 'right'; g.textBaseline = 'top';
      g.fillText(`${nf(Vn - dmax, 6)} V at the load`, right, y(dmax) + 8);
      g.fillStyle = '#ffd54a'; g.font = font(12, 600);
      g.fillText(R.p.ok ? `drop ${nf(R.p.ok.value)} %` : 'drop %: not returned', right, y(dmax) + 22);
      g.fillStyle = '#8b93a7'; g.font = font(10.5);
      g.textAlign = 'left'; g.fillText(`vertical axis ${nf(Vn)} V to ${nf(Vn - span, 6)} V`, 12, top - 28);
      g.textAlign = 'left';
    }
  } else {
    refusalBox(g, R.d.ok ? 'EMPTY — no profile was returned.' : R.d.refused, left + 6, top, Math.min(right - left - 12, 400), 4);
  }

  /* refusals drawn at the points they belong to, last so they sit on top */
  if (!R.i.ok && R.i.empty) {
    g.font = font(11); g.textAlign = 'left'; g.textBaseline = 'bottom'; g.fillStyle = '#d8dee9';
    g.fillText('EMPTY — no current returned', x0 + 8, lineY - 8);
  } else if (!R.i.ok) refusalBox(g, R.i.refused, x0 + 8, lineY + 8, Math.min(lenPx - 8, 400), 3);
  if (!R.s.ok) {
    const bw = Math.min(w - 16, 400);
    refusalBox(g, R.s.refused, w - 8 - bw, lineY + 36, bw, 4);
  }
}

/* ── the power triangle ───────────────────────────────────────────────────── */
function drawTriangle() {
  if (!R) return;
  const { g, w, h } = fit($('tri'));
  g.clearRect(0, 0, w, h);
  g.font = font(11); g.textAlign = 'left'; g.textBaseline = 'top';
  if (!R.s.ok || !R.q.ok) {
    g.fillStyle = '#8b93a7';
    g.fillText(`P ${nf(R.input.kw, 3)} kW (scenario input). Q and S not returned.`, 12, 12);
    refusalBox(g, (R.s.ok ? R.q : R.s).refused, 12, 34, w - 24, 8);
    return;
  }
  const P = R.input.kw, Q = R.q.ok.value, Sv = R.s.ok.value;
  const padL = 24, padR = 120, padT = 44, padB = 32;
  const aw = w - padL - padR, ah = h - padT - padB;
  const k = Math.min(aw / P, Q > 0 ? ah / Q : Infinity);
  const px = Math.max(1, P * k), qy = Q * k;
  const ox = padL, oy = h - padB;
  const col = R.V.color;
  g.lineCap = 'round';
  g.strokeStyle = '#ffffff'; g.lineWidth = 3; g.beginPath(); g.moveTo(ox, oy); g.lineTo(ox + px, oy); g.stroke();
  g.strokeStyle = mix(col, 0.35); g.beginPath(); g.moveTo(ox + px, oy); g.lineTo(ox + px, oy - qy); g.stroke();
  g.strokeStyle = '#ffd54a'; g.shadowColor = '#ffd54a'; g.shadowBlur = 8;
  g.beginPath(); g.moveTo(ox, oy); g.lineTo(ox + px, oy - qy); g.stroke(); g.shadowBlur = 0;
  const phi = Math.atan2(qy, px);
  g.strokeStyle = '#8b93a7'; g.lineWidth = 1; g.beginPath(); g.arc(ox, oy, 22, -phi, 0); g.stroke();
  g.fillStyle = '#8b93a7'; g.textBaseline = 'bottom'; g.fillText('φ', ox + 26, oy - 3);
  g.textBaseline = 'top'; g.fillStyle = '#ffffff';
  g.fillText(`P ${nf(P, 3)} kW (scenario input)`, ox, oy + 8);
  g.fillStyle = mix(col, 0.35);
  g.fillText(`Q ${nf(Q)} kVAr`, ox + px + 8, Math.max(padT, oy - qy / 2 - 6));
  g.fillStyle = '#ffd54a';
  g.fillText(`S ${nf(Sv)} kVA`, 12, 10);
  g.fillStyle = '#8b93a7';
  g.fillText(`power factor ${R.input.pf.toFixed(2)} = P / S`, 12, 24);
}

/* ── frame loop: only the diagram animates ───────────────────────────────── */
function frame(t) { drawSld(t); requestAnimationFrame(frame); }
addEventListener('resize', () => drawTriangle());

/* ── boot: import the three modules, three at most at once ───────────────── */
buildInputs();
for (const m of MODULES) modState[m] = 'LOAD';
paintMods();
await Promise.all(MODULES.map(async m => {
  try { mod[m] = await import(ENGINE + m); modState[m] = 'OK'; }
  catch (e) { modState[m] = 'FAIL ' + (e?.message || String(e)); }
}));
paintMods();
paintRefusals();
compute();
requestAnimationFrame(frame);
