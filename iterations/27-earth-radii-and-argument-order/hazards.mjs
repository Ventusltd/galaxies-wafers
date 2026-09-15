/* Two Hazards on One Map — Earth radii and argument order, charted from the
   engine's own geodesy. No distance formula is written in this file: every
   distance, bearing, arc point and corridor length is returned by
   ventus-grid-engine at the pinned commit. The page projects (plain
   equirectangular) and draws. */

const COMMIT = 'd9cd18b0e2034325814924e6e4a0e958014f2748';
const ENGINE = `https://cdn.jsdelivr.net/gh/Ventusltd/ventus-grid-engine@${COMMIT}/engine/`;
const MODULES = ['geo-core.js', 'v9-geodesy.js', 'corridor-estimate.js'];

const COL = { correct: '#5ec8f2', swapped: '#ff9f40', leg: '#ffffff', R_MEAN: '#b48cff', R_ATLAS: '#ffffff', R_UK: '#5ec8f2', EARTH_RADIUS_KM: '#ffffff' };

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const nf = (v, sig = 4) => Number(v).toLocaleString('en-GB', { maximumSignificantDigits: sig });

/* ── lengths: one formatter, SI steps ───────────────────────────────────── */
function fmtLen(km, sig = 6) {
  if (km == null) return String(km);
  if (!Number.isFinite(km)) return String(km);
  const m = Number((Math.abs(km) * 1000).toPrecision(Math.min(sig + 2, 17))), s = km < 0 ? '−' : ''; // round before choosing the unit
  if (m === 0) return '0 m';
  if (m >= 1000) return s + nf(m / 1000, sig) + ' km';
  if (m >= 1) return s + nf(m, sig) + ' m';
  if (m >= 1e-3) return s + nf(m * 1e3, sig) + ' mm';
  return s + nf(m * 1e6, sig) + ' µm';
}
const fmtLat = v => `${nf(Math.abs(v), 6)}°${v < 0 ? 'S' : 'N'}`;
const fmtLon = v => `${nf(Math.abs(v), 6)}°${v < 0 ? 'W' : v > 0 ? 'E' : ''}`;
const fmtPt = p => `${fmtLat(p.lat)} ${fmtLon(p.lon)}`;

/* ── modules, Grid Atlas grammar; three files at once, the queue cap ─────── */
const mod = {};
const modState = Object.fromEntries(MODULES.map(m => [m, 'WAIT']));
function paintMods() {
  const box = $('mods'); box.textContent = '';
  for (const m of MODULES) {
    const st = modState[m], sp = st.indexOf(' ');
    const s = el('span'); const b = el('b', null, sp < 0 ? st : st.slice(0, sp));
    s.append(b, ` engine/${m}` + (sp < 0 ? '' : ' — ' + st.slice(sp + 1)));
    box.append(s);
  }
  for (const p of document.querySelectorAll('.pin')) p.textContent = COMMIT.slice(0, 12);
}
paintMods();

/* ── state ───────────────────────────────────────────────────────────────── */
const logD = { lo: 1e-3, hi: 1e3 }; // km: the scenario range, 1 m to 1,000 km
const dFromT = t => logD.lo * Math.pow(logD.hi / logD.lo, t / 1000);
const PRESETS = [
  [{ lat: 56.05, lon: -2.35 }, { lat: 51.5, lon: -0.1 }],
  [{ lat: 60, lon: 0 }, { lat: 60, lon: 1 }],
  [{ lat: 0, lon: 0 }, { lat: 1, lon: 0 }],
  [{ lat: 58.5, lon: -3.1 }, { lat: 50.1, lon: -5.5 }],
  [{ lat: 40.7, lon: -74 }, { lat: 51.5, lon: -0.1 }],
  [{ lat: 51.5, lon: -0.1 }, { lat: 35.7, lon: 139.7 }]
];
const VIEWS = {
  world: { label: 'WORLD', lon: [-180, 180], lat: [-90, 90], major: 30, minor: 10, snap: 0.1 },
  gb: { label: 'GB BOX', lon: [-12, 5], lat: [49, 60.5], major: 5, minor: 1, snap: 0.01 }
};
const S = { t: +$('in-d').value, A: { ...PRESETS[0][0] }, B: { ...PRESETS[0][1] }, next: 'A', view: 'world', preset: 0 };

/* ── controls ────────────────────────────────────────────────────────────── */
function seg(box, items, isOn, onTap) {
  if (box.childElementCount !== items.length) {
    box.textContent = '';
    for (const it of items) {
      const b = el('button', null, it.label); b.type = 'button'; b.dataset.v = it.v;
      b.addEventListener('click', () => onTap(it.v));
      box.append(b);
    }
  }
  for (const b of box.children) b.setAttribute('aria-pressed', String(isOn(b.dataset.v)));
}
function paintControls() {
  seg($('views'), Object.entries(VIEWS).map(([v, o]) => ({ v, label: o.label })), v => S.view === v, v => { S.view = v; update(); });
  seg($('nexts'), [{ v: 'A', label: 'NEXT TAP SETS A' }, { v: 'B', label: 'NEXT TAP SETS B' }], v => S.next === v, v => { S.next = v; paintControls(); });
  seg($('presets'), PRESETS.map((p, i) => ({ v: String(i), label: `${fmtPt(p[0])} → ${fmtPt(p[1])}` })),
    v => S.preset === +v, v => { const p = PRESETS[+v]; S.A = { ...p[0] }; S.B = { ...p[1] }; S.preset = +v; update(); });
}
$('in-d').addEventListener('input', e => { S.t = +e.target.value; update(); });

/* ── canvas helpers ──────────────────────────────────────────────────────── */
function fit(cv, cssH) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  if (cssH != null) cv.style.height = cssH + 'px';
  const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  return { g, w, h };
}
function textHalo(g, s, x, y, color, align = 'left') {
  g.textAlign = align; g.lineWidth = 3; g.strokeStyle = '#07080c'; g.strokeText(s, x, y); g.fillStyle = color; g.fillText(s, x, y);
}
function emptyCanvas(g, text) {
  g.fillStyle = '#8b93a7'; g.font = '12px ui-monospace,Menlo,Consolas,monospace'; g.textAlign = 'left';
  g.fillText('EMPTY', 10, 22); g.fillText(text.slice(0, 52), 10, 40);
}

/* ── the map ─────────────────────────────────────────────────────────────── */
let proj = null;
function mapProjection(w) {
  const v = VIEWS[S.view];
  const midLat = (v.lat[0] + v.lat[1]) / 2;
  const k = S.view === 'world' ? 1 : Math.cos(midLat * Math.PI / 180); // stated in the key
  const lonSpan = v.lon[1] - v.lon[0], latSpan = v.lat[1] - v.lat[0];
  const h = Math.max(160, Math.min(Math.round(w * latSpan / (lonSpan * k)), Math.round(window.innerHeight * 0.7)));
  const ppd = Math.min(w / (lonSpan * k), h / latSpan); // px per degree of latitude
  const cLon = (v.lon[0] + v.lon[1]) / 2;
  return {
    v, k, h, w,
    x: lon => w / 2 + (lon - cLon) * ppd * k,
    y: lat => h / 2 - (lat - midLat) * ppd,
    lonAt: px => cLon + (px - w / 2) / (ppd * k),
    latAt: py => midLat - (py - h / 2) / ppd
  };
}
const wrapLon = l => ((l + 540) % 360 + 360) % 360 - 180;

/* Great-circle points from the module: bearing from initialBearingDeg, points
   from destinationPoint, total length from distanceKm. */
function gcPath(a, b, n = 96) {
  const g = mod['v9-geodesy.js'];
  const D = g.distanceKm(a.lon, a.lat, b.lon, b.lat);
  if (!Number.isFinite(D)) return null;
  const brg = g.initialBearingDeg(a.lon, a.lat, b.lon, b.lat);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const p = i === 0 ? [a.lon, a.lat] : g.destinationPoint(a.lon, a.lat, D * i / n, brg);
    pts.push([wrapLon(p[0]), p[1]]);
  }
  return pts;
}
function drawPoly(g, P, pts) {
  g.beginPath();
  let prev = null;
  for (const [lon, lat] of pts) {
    const X = P.x(lon), Y = P.y(lat);
    if (prev == null || Math.abs(lon - prev) > 180) g.moveTo(X, Y); else g.lineTo(X, Y);
    prev = lon;
  }
}
function strokePath(g, P, pts, color, dash) {
  g.save(); g.setLineDash(dash || []);
  g.lineWidth = 5; g.strokeStyle = 'rgba(0,0,0,0.6)'; drawPoly(g, P, pts); g.stroke();
  g.lineWidth = 2; g.strokeStyle = color; drawPoly(g, P, pts); g.stroke(); g.restore();
}
function marker(g, P, p, label, color, hollow) {
  const X = P.x(p.lon), Y = P.y(p.lat);
  g.beginPath(); g.arc(X, Y, 5, 0, 7); g.lineWidth = 3; g.strokeStyle = '#07080c'; g.stroke();
  g.lineWidth = 1.6; g.strokeStyle = color; g.stroke();
  if (!hollow) { g.fillStyle = color; g.fill(); }
  g.font = '600 11px ui-monospace,Menlo,Consolas,monospace';
  textHalo(g, label, X + 8, Y - 7, color);
}

function drawMap(model) {
  const cv = $('map');
  const w = cv.clientWidth;
  const P = proj = mapProjection(w);
  const { g, h } = fit(cv, P.h);
  const lon0 = P.lonAt(0), lon1 = P.lonAt(w), lat0 = P.latAt(h), lat1 = P.latAt(0);
  const L0 = Math.max(lon0, -180), L1 = Math.min(lon1, 180), B0 = Math.max(lat0, -90), B1 = Math.min(lat1, 90);
  g.lineWidth = 1;
  for (const step of [P.v.minor, P.v.major]) {
    g.strokeStyle = step === P.v.major ? '#2a3146' : '#151a26';
    for (let lon = Math.ceil(L0 / step) * step; lon <= L1; lon += step) { g.beginPath(); g.moveTo(P.x(lon), P.y(B1)); g.lineTo(P.x(lon), P.y(B0)); g.stroke(); }
    for (let lat = Math.ceil(B0 / step) * step; lat <= B1; lat += step) { g.beginPath(); g.moveTo(P.x(L0), P.y(lat)); g.lineTo(P.x(L1), P.y(lat)); g.stroke(); }
  }
  g.strokeStyle = '#3a4360';
  if (B0 <= 0 && B1 >= 0) { g.beginPath(); g.moveTo(P.x(L0), P.y(0)); g.lineTo(P.x(L1), P.y(0)); g.stroke(); }
  if (L0 <= 0 && L1 >= 0) { g.beginPath(); g.moveTo(P.x(0), P.y(B1)); g.lineTo(P.x(0), P.y(B0)); g.stroke(); }
  g.font = '10px ui-monospace,Menlo,Consolas,monospace'; g.fillStyle = '#5c6580';
  g.textAlign = 'center';
  for (let lon = Math.ceil(L0 / P.v.major) * P.v.major; lon <= L1; lon += P.v.major) if (lon > L0 && lon < L1) g.fillText(fmtLon(lon), P.x(lon), h - 4);
  g.textAlign = 'left';
  for (let lat = Math.ceil(B0 / P.v.major) * P.v.major; lat <= B1; lat += P.v.major) if (lat > B0 && lat < B1) g.fillText(fmtLat(lat), 3, P.y(lat) - 3);

  const notes = [];
  if (model.ok) {
    const o = model.order;
    if (o.swapPts) strokePath(g, P, o.swapPts, COL.swapped, [6, 4]);
    if (o.pts) strokePath(g, P, o.pts, COL.correct);
    if (model.radii.legPts) strokePath(g, P, model.radii.legPts, COL.leg);
    if (o.swapDrawable) { marker(g, P, o.Aswap, 'A′', COL.swapped, true); marker(g, P, o.Bswap, 'B′', COL.swapped, true); }
    const out = p => p.lon < lon0 || p.lon > lon1 || p.lat < lat0 || p.lat > lat1;
    const offView = o.swapDrawable ? [o.Aswap, o.Bswap].filter(out).length : 0;
    if (offView) notes.push(`${offView} of the swapped points A′, B′ lie outside this view; WORLD shows them.`);
    if (!o.swapDrawable) notes.push('Swapped arc EMPTY: a longitude beyond ±90° read as a latitude is not a point on the globe.');
  } else {
    notes.push('Arcs EMPTY: ' + emptyReason());
  }
  marker(g, P, S.A, 'A', '#ffffff'); marker(g, P, S.B, 'B', '#ffffff');

  const key = $('mapkey'); key.textContent = '';
  const k = (c, dash, t) => { const s = el('span'); const i = el('i', dash ? 'dash' : ''); i.style.borderColor = c; s.append(i, t); key.append(s); };
  k(COL.correct, false, 'documented call (lon, lat), A to B');
  k(COL.swapped, true, 'swapped call (lat, lon): the arc it measures, A′ to B′');
  k(COL.leg, false, 'radii scenario leg from A');
  key.append(el('span', null, S.view === 'world'
    ? 'equirectangular: 1° of longitude drawn as wide as 1° of latitude'
    : `equirectangular: longitude compressed by cos(${nf((P.v.lat[0] + P.v.lat[1]) / 2, 4)}°) = ${nf(P.k, 4)}`));
  for (const n of notes) key.append(el('span', null, n));
  $('coords').textContent = '';
  for (const [n, p] of [['A', S.A], ['B', S.B]]) { $('coords').append(el('b', null, n), el('span', null, `${fmtPt(p)}  ·  lon ${p.lon}, lat ${p.lat}`)); }
}
$('map').addEventListener('click', e => {
  if (!proj) return;
  const r = e.currentTarget.getBoundingClientRect();
  const snap = proj.v.snap;
  const rnd = v => Math.round(v / snap) * snap;
  const lon = Math.max(-180, Math.min(180, rnd(proj.lonAt(e.clientX - r.left))));
  const lat = Math.max(-90, Math.min(90, rnd(proj.latAt(e.clientY - r.top))));
  S[S.next] = { lat: +lat.toFixed(4), lon: +lon.toFixed(4) };
  S.next = S.next === 'A' ? 'B' : 'A';
  S.preset = -1;
  update();
});

/* ── compute: every number below is a module call ────────────────────────── */
function compute() {
  const gc = mod['geo-core.js'], v9 = mod['v9-geodesy.js'], ce = mod['corridor-estimate.js'];
  if (!gc || !v9) return { ok: false };
  const d = dFromT(S.t);
  const { A, B } = S;
  const same = A.lat === B.lat && A.lon === B.lon;
  const brg = same ? 0 : v9.initialBearingDeg(A.lon, A.lat, B.lon, B.lat);
  const E = v9.destinationPoint(A.lon, A.lat, d, brg);
  const end = { lon: E[0], lat: E[1] };

  /* The radius constants, as the modules name them. */
  const named = [
    { name: 'R_MEAN', file: 'geo-core.js', R: gc.R_MEAN },
    { name: 'R_ATLAS', file: 'geo-core.js', R: gc.R_ATLAS },
    { name: 'R_UK', file: 'geo-core.js', R: gc.R_UK },
    { name: 'EARTH_RADIUS_KM', file: 'geo-core.js', R: gc.EARTH_RADIUS_KM },
    { name: 'EARTH_RADIUS_KM', file: 'v9-geodesy.js', R: v9.EARTH_RADIUS_KM }
  ];
  const ref = gc.haversine(A.lon, A.lat, end.lon, end.lat); // haversine's default radius
  const rows = [
    { key: 'R_MEAN', label: 'R_MEAN · geo-core.js', fn: 'haversine(A, E, R_MEAN)', R: gc.R_MEAN, km: gc.haversine(A.lon, A.lat, end.lon, end.lat, gc.R_MEAN) },
    { key: 'R_ATLAS', label: 'R_ATLAS · geo-core.js · the default', fn: 'haversine(A, E)', R: gc.R_ATLAS, km: ref },
    { key: 'EARTH_RADIUS_KM', label: 'EARTH_RADIUS_KM · v9-geodesy.js', fn: 'distanceKm(A, E)', R: v9.EARTH_RADIUS_KM, km: v9.distanceKm(A.lon, A.lat, end.lon, end.lat) },
    { key: 'R_UK', label: 'R_UK · geo-core.js', fn: 'haversineUK(A, E)', R: gc.R_UK, km: gc.haversineUK(A.lon, A.lat, end.lon, end.lat) }
  ].map(r => ({ ...r, diffKm: r.km - ref, ppm: ref > 0 ? (r.km / ref - 1) * 1e6 : NaN }));
  const distinct = [...new Set(named.map(n => n.R))].sort((a, b) => a - b);

  /* Difference against leg length, sampled with the same module calls. */
  const probe = { lon: 0, lat: 54 };
  const curve = [];
  for (let i = 0; i <= 60; i++) {
    const dk = dFromT(i * 1000 / 60);
    const q = v9.destinationPoint(probe.lon, probe.lat, dk, 90);
    const base = gc.haversine(probe.lon, probe.lat, q[0], q[1]);
    curve.push({ d: dk, mean: gc.haversine(probe.lon, probe.lat, q[0], q[1], gc.R_MEAN) - base, uk: gc.haversineUK(probe.lon, probe.lat, q[0], q[1]) - base });
  }

  /* Argument order. */
  const correct = gc.haversine(A.lon, A.lat, B.lon, B.lat);
  const swapped = gc.haversine(A.lat, A.lon, B.lat, B.lon);
  const correct9 = v9.distanceKm(A.lon, A.lat, B.lon, B.lat);
  const swapped9 = v9.distanceKm(A.lat, A.lon, B.lat, B.lon);
  const Aswap = { lon: A.lat, lat: A.lon }, Bswap = { lon: B.lat, lat: B.lon };
  const swapDrawable = Math.abs(A.lon) <= 90 && Math.abs(B.lon) <= 90;
  const order = {
    correct, swapped, correct9, swapped9, Aswap, Bswap, swapDrawable,
    ratio: correct > 0 && Number.isFinite(swapped) ? swapped / correct : null,
    pts: same ? null : gcPath(A, B),
    swapPts: swapDrawable && !(Aswap.lat === Bswap.lat && Aswap.lon === Bswap.lon) ? gcPath(Aswap, Bswap) : null
  };

  /* Where a straight-line km goes next: the cable corridor estimate. */
  const corridor = ce ? {
    documented: ce.forCable(correct), swapped: ce.forCable(swapped),
    legAtlas: ce.forCable(ref), legUK: ce.forCable(rows[3].km), legMean: ce.forCable(rows[0].km)
  } : null;

  return {
    ok: true, d,
    radii: { A, bearing: brg, end, rows, named, distinct, curve, probe, legPts: gcPath(A, end, 48), same },
    order, corridor
  };
}

/* ── hazard 1 drawing ────────────────────────────────────────────────────── */
function drawRadii(m) {
  const cv = $('radii'); const { g, w, h } = fit(cv);
  const key = $('radiikey');
  if (w < 120 || h < 120) return; // not laid out yet; the next frame draws it
  if (!m.ok) { emptyCanvas(g, emptyReason()); key.textContent = ''; return; }
  const vals = m.radii.distinct;
  const rmin = vals[0], rmax = vals[vals.length - 1], span = rmax - rmin || 1;
  const lo = rmin - span * 0.45, hi = rmax + span * 0.3;
  const top = 26, bottom = h - 18, band = bottom - top;
  const yOf = r => bottom - (r - lo) / (hi - lo) * band;
  const Rpx = w * 2.2; // drawn curvature radius of the reference arc, px
  const ref = mod['geo-core.js'].R_ATLAS;
  const cx = w / 2, cy = yOf(ref) + Rpx;
  const half = Math.asin(Math.min(1, (w / 2 + 10) / Rpx));
  const wedge = 0.1; // drawn half-angle of the wedge, radians
  const mag = (band / (hi - lo)) / (Rpx / ref);

  g.fillStyle = 'rgba(94,200,242,0.07)';
  g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, cy - top + 4, -Math.PI / 2 - wedge, -Math.PI / 2 + wedge); g.closePath(); g.fill();
  g.font = '10.5px ui-monospace,Menlo,Consolas,monospace';
  const byR = new Map();
  for (const r of m.radii.rows) { if (!byR.has(r.R)) byR.set(r.R, []); byR.get(r.R).push(r); }
  for (const [R, rs] of byR) {
    const rad = cy - yOf(R), color = COL[rs[0].key];
    g.strokeStyle = color; g.lineWidth = 1.2; g.globalAlpha = 0.55;
    g.beginPath(); g.arc(cx, cy, rad, -Math.PI / 2 - half, -Math.PI / 2 + half); g.stroke();
    g.globalAlpha = 1; g.lineWidth = 4;
    g.beginPath(); g.arc(cx, cy, rad, -Math.PI / 2 - wedge, -Math.PI / 2 + wedge); g.stroke();
    const yl = cy - rad;
    textHalo(g, rs.map(r => r.key).join(' = ') + '  ' + nf(R, 8) + ' km', 6, yl - 6, color);
    textHalo(g, fmtLen(rs[0].km, 8), w - 6, yl + 15, color, 'right');
  }
  g.strokeStyle = '#8b93a7'; g.lineWidth = 1;
  for (const s of [-1, 1]) {
    const a = -Math.PI / 2 + s * wedge;
    g.beginPath(); g.moveTo(cx + Math.cos(a) * (cy - bottom), cy + Math.sin(a) * (cy - bottom)); g.lineTo(cx + Math.cos(a) * (cy - top), cy + Math.sin(a) * (cy - top)); g.stroke();
  }
  textHalo(g, `scenario leg ${fmtLen(m.d, 4)} · angle ${nf(m.d / ref, 4)} rad`, cx, 15, '#d8dee9', 'center');
  key.textContent = `Radial axis runs from ${nf(lo, 7)} km at the bottom to ${nf(hi, 7)} km at the top; the centre of the Earth is far below the frame. Gaps between arcs are magnified ${nf(mag, 3)} times against the drawn curvature. The wedge is drawn at a fixed width; the angle it stands for is printed at its top, and the length on each arc is printed at the right. ${m.radii.named.length} named radius constants across the two geodesy modules hold ${vals.length} distinct values.`;
}

function drawGap(m) {
  const cv = $('gap'); const { g, w, h } = fit(cv);
  const key = $('gapkey');
  if (w < 120 || h < 80) return;
  if (!m.ok) { emptyCanvas(g, emptyReason()); key.textContent = ''; return; }
  const c = m.radii.curve;
  const allM = c.flatMap(p => [Math.abs(p.mean), Math.abs(p.uk)]).filter(v => v > 0).map(v => v * 1000);
  const y0 = Math.floor(Math.log10(Math.min(...allM))), y1 = Math.ceil(Math.log10(Math.max(...allM)));
  const L = 48, R = w - 10, T = 10, B = h - 22;
  const X = dk => L + (Math.log10(dk) - Math.log10(logD.lo)) / (Math.log10(logD.hi) - Math.log10(logD.lo)) * (R - L);
  const Y = mtr => B - (Math.log10(mtr) - y0) / (y1 - y0) * (B - T);
  g.font = '10px ui-monospace,Menlo,Consolas,monospace'; g.lineWidth = 1;
  for (let e = y0; e <= y1; e++) {
    g.strokeStyle = '#1b2030'; g.beginPath(); g.moveTo(L, Y(10 ** e)); g.lineTo(R, Y(10 ** e)); g.stroke();
    g.fillStyle = '#5c6580'; g.textAlign = 'right'; g.fillText(fmtLen(10 ** e / 1000, 3), L - 4, Y(10 ** e) + 3);
  }
  for (let e = Math.round(Math.log10(logD.lo)); e <= Math.round(Math.log10(logD.hi)); e++) {
    g.strokeStyle = '#1b2030'; g.beginPath(); g.moveTo(X(10 ** e), T); g.lineTo(X(10 ** e), B); g.stroke();
    g.fillStyle = '#5c6580'; g.textAlign = e === Math.round(Math.log10(logD.hi)) ? 'right' : 'center'; g.fillText(fmtLen(10 ** e, 3), X(10 ** e), h - 7);
  }
  for (const [k, col] of [['mean', COL.R_MEAN], ['uk', COL.R_UK]]) {
    g.strokeStyle = col; g.lineWidth = 2; g.beginPath();
    c.forEach((p, i) => { const v = Math.abs(p[k]) * 1000; if (i) g.lineTo(X(p.d), Y(v)); else g.moveTo(X(p.d), Y(v)); });
    g.stroke();
  }
  const rows = m.radii.rows;
  for (const r of rows) {
    if (r.diffKm === 0 || !Number.isFinite(r.diffKm)) continue;
    const v = Math.max(10 ** y0, Math.min(10 ** y1, Math.abs(r.diffKm) * 1000));
    g.beginPath(); g.arc(X(m.d), Y(v), 4.5, 0, 7); g.fillStyle = COL[r.key]; g.fill(); g.strokeStyle = '#07080c'; g.lineWidth = 1.5; g.stroke();
  }
  const zeroRows = rows.filter(r => r.diffKm === 0).map(r => r.label.split(' · ').slice(0, 2).join(' in '));
  key.textContent = `Absolute difference from R_ATLAS against leg length, both axes log; ${c.length} legs sampled by calling the modules from ${fmtPt(m.radii.probe)} due east. R_MEAN (violet) returns the shorter distance, R_UK (blue) the longer. Zero difference cannot sit on a log axis, so ${zeroRows.join(' and ')} ${zeroRows.length === 1 ? 'is' : 'are'} not drawn. Dots mark the scenario leg.`;
}

/* ── result lists: rows built once, only their text is updated ───────────── */
const rowCache = new Map();
function row(list, id, color) {
  if (rowCache.has(id)) return rowCache.get(id);
  const li = el('li'); li.style.setProperty('--c', color || '#1b2030');
  const k = el('div', 'k'), lab = el('span'), v = el('span', 'v');
  const fn = el('div', 'fn'), basis = el('div', 'basis');
  k.append(lab, v); li.append(k, fn, basis); list.append(li);
  const r = { li, lab, v, fn, basis };
  rowCache.set(id, r); return r;
}
const setT = (node, t) => { if (node.textContent !== t) node.textContent = t; };
function fill(r, lab, v, fn, basis, empty) { setT(r.lab, lab); setT(r.v, v); setT(r.fn, fn); setT(r.basis, basis); r.li.classList.toggle('empty', !!empty); }

let loadError = '';
const emptyReason = () => loadError || 'the engine modules have not loaded yet';

function paintResults(m) {
  $('out-d').textContent = fmtLen(dFromT(S.t), 4);
  const rl = $('radiires'), ol = $('orderres');
  if (!m.ok) {
    $('leg').textContent = '';
    fill(row(rl, 'r-empty'), 'EMPTY', '', '', emptyReason(), true);
    fill(row(ol, 'o-empty'), 'EMPTY', '', '', emptyReason(), true);
    return;
  }
  for (const id of ['r-empty', 'o-empty']) if (rowCache.has(id)) { rowCache.get(id).li.remove(); rowCache.delete(id); }
  const rr = m.radii;
  setT($('leg'), `From A ${fmtPt(rr.A)}, bearing ${nf(rr.bearing, 5)}° ${rr.same ? '(A and B coincide, so due north)' : 'toward B'}, to E ${fmtPt({ lat: +rr.end.lat.toFixed(6), lon: +rr.end.lon.toFixed(6) })}: destinationPoint(A, leg, bearing) in v9-geodesy.js, which stands on EARTH_RADIUS_KM.`);
  for (const r of rr.rows) {
    fill(row(rl, 'r-' + r.key, COL[r.key]), r.label, fmtLen(r.km, 10), `${r.fn} · radius ${nf(r.R, 8)} km`,
      r.diffKm === 0 ? 'difference from R_ATLAS: 0 (the same radius value returns the same number)'
        : `difference from R_ATLAS: ${r.diffKm > 0 ? '+' : ''}${fmtLen(r.diffKm, 4)} · ${r.ppm > 0 ? '+' : '−'}${nf(Math.abs(r.ppm), 5)} ppm`);
  }

  const o = m.order;
  setT($('orderdoc'), `geo-core.js documents haversine(lon1, lat1, lon2, lat2) as taking “(lon, lat) pairs — GeoJSON order, not the (lat, lon) order most haversine implementations take”; v9-geodesy.js exports distanceKm(lon1, lat1, lon2, lat2). Both are called below with A ${fmtPt(S.A)} and B ${fmtPt(S.B)}, first as documented, then with each pair swapped.`);
  fill(row(ol, 'o-c', COL.correct), 'documented order · geo-core.js', fmtLen(o.correct, 8),
    `haversine(${S.A.lon}, ${S.A.lat}, ${S.B.lon}, ${S.B.lat})`, `v9-geodesy.js distanceKm in the same order: ${fmtLen(o.correct9, 8)}`);
  fill(row(ol, 'o-s', COL.swapped), 'swapped order · geo-core.js', fmtLen(o.swapped, 8),
    `haversine(${S.A.lat}, ${S.A.lon}, ${S.B.lat}, ${S.B.lon})`,
    `v9-geodesy.js distanceKm in the same order: ${fmtLen(o.swapped9, 8)}. ` + (o.swapDrawable
      ? `The swapped call measures from A′ ${fmtPt(o.Aswap)} to B′ ${fmtPt(o.Bswap)}: the dashed arc.`
      : 'Arc EMPTY: a longitude beyond ±90° read as a latitude is not a point on the globe, so no arc is drawn. The function returned the value above without refusing.'),
    !Number.isFinite(o.swapped));
  const ratioEmpty = o.ratio == null;
  fill(row(ol, 'o-r', '#ffffff'), 'ratio · swapped ÷ documented',
    ratioEmpty ? 'EMPTY' : '× ' + nf(o.ratio, 6),
    ratioEmpty ? '' : `difference ${o.swapped - o.correct > 0 ? '+' : ''}${fmtLen(o.swapped - o.correct, 6)}`,
    ratioEmpty
      ? (o.correct === 0 ? 'A and B coincide: the documented distance is zero and a ratio to zero is undefined.' : 'The swapped call did not return a finite number, so there is no ratio.')
      : (o.ratio === 1 ? 'The swapped call returned the same distance for this pair: the hazard is present and gives no sign of itself.' : 'Both are plausible distances; nothing in the returned number shows which order was used.'),
    ratioEmpty);
}

/* ── Questions and machine detail: cited from source, live where computable ─ */
function corridorText(r) {
  if (r == null) return 'null (forCable returns null: no finite distance above zero)';
  if (r.km == null) return `withheld: “${r.withheld}”`;
  return fmtLen(r.km, 6);
}
function paintQuestions(m) {
  const qa = $('qa');
  const ce = mod['corridor-estimate.js'];
  const items = [];
  const live = m.ok && m.corridor;
  items.push([
    'How does this help draw a system or a single-line diagram?',
    'It feeds the cable route: the straight-line km between two ends of a circuit. engine/corridor-estimate.js says its caller “is expected to have produced that km via v9-geodesy.js distanceKm or geo-core.js haversine” (lines 17–19) and forCable(km) multiplies it by CABLE_FACTOR' + (ce ? ` (${ce.CABLE_FACTOR}, read from the module)` : '') + ' into a corridor length. It also ranks substations (busbars): engine/v9-nearest-search.js imports distanceKm (line 35) for nearest(), “measured on the estate’s single radius”.',
    live ? `Live, A to B: forCable(documented) = ${corridorText(m.corridor.documented)}; forCable(swapped) = ${corridorText(m.corridor.swapped)}. Scenario leg: forCable on R_MEAN = ${corridorText(m.corridor.legMean)}, on R_ATLAS = ${corridorText(m.corridor.legAtlas)}, on R_UK = ${corridorText(m.corridor.legUK)}. When both corridor estimates are offered, a wrong radius or a swapped call moves the corridor length by the same ratio as the distance; the module withholds an estimate below 1 km.`
      : (m.ok ? 'Live corridor lengths EMPTY: engine/corridor-estimate.js has not loaded.' : 'Live corridor lengths EMPTY: ' + emptyReason())
  ]);
  items.push([
    'What is this code used for?',
    `engine/geo-core.js exports ${mod['geo-core.js'] ? Object.keys(mod['geo-core.js']).join(', ') : '(not loaded)'}; engine/v9-geodesy.js exports ${mod['v9-geodesy.js'] ? Object.keys(mod['v9-geodesy.js']).join(', ') : '(not loaded)'}; commit ${COMMIT.slice(0, 12)}. Callers read from import lines in the engine at that commit: geo-area.js imports EARTH_RADIUS_KM and haversine (line 30); geo-shapes.js imports EARTH_RADIUS_KM (line 18); v9-nearest-search.js (line 35) and compute-observer.js (line 2) import distanceKm. In the estate, a search for the module path in import URLs finds globalgrid2050 grid_engine/202609060238-site-geometry and grid_engine/202609060318-solar-farm loading v9-geodesy.js (path-match inference; the order of their arguments was not inspected).`,
    ''
  ]);
  items.push([
    'Where does it lead next?',
    'From the straight-line km to the corridor length (forCable), and from a corridor length to a cable length on a feeder drawing. Whether any estate page passes a forCable length into a feeder calculation such as engine/voltage-drop.js is not established: this page has not traced such a call.',
    ''
  ]);
  if (qa.childElementCount !== items.length) { qa.textContent = ''; for (let i = 0; i < items.length; i++) { const li = el('li'); li.append(el('b'), el('div'), el('div', 'live')); qa.append(li); } }
  items.forEach(([q, a, l], i) => { const li = qa.children[i]; setT(li.children[0], q); setT(li.children[1], a); setT(li.children[2], l); });

  const mc = $('machine');
  const b = el('b', null, 'Machine detail. ');
  const gc = mod['geo-core.js'];
  const txt = `Inputs: lon and lat in decimal degrees (east, north); radiusKm in km (haversine default R_ATLAS${gc ? ' = ' + gc.R_ATLAS : ''}); leg length in km; bearing in degrees clockwise from north. Outputs: haversine, haversineUK, distanceKm return great-circle km on a sphere; destinationPoint returns [lon, lat] degrees; initialBearingDeg returns degrees in [0, 360); forCable returns {km, factor, straight_km, withheld} or null. Refusals: the geodesy functions refuse nothing, so a swapped or out-of-range call returns a number (or NaN) without complaint; forCable returns null for a non-finite or non-positive km and withholds below MINIMUM_KM${ce ? ' = ' + ce.MINIMUM_KM + ' km' : ''}. Source: ventus-grid-engine ${COMMIT}.`;
  if (mc.textContent !== 'Machine detail. ' + txt) { mc.textContent = ''; mc.append(b, txt); }
}

/* ── one frame per change ────────────────────────────────────────────────── */
let pending = false;
function update() {
  paintControls();
  if (pending) return; pending = true;
  requestAnimationFrame(() => {
    pending = false;
    const m = compute();
    paintResults(m); drawMap(m); drawRadii(m); drawGap(m); paintQuestions(m);
    window.__hazards = {
      state: JSON.parse(JSON.stringify(S)), d: m.ok ? m.d : null, mods: { ...modState },
      radii: m.ok ? m.radii.rows.map(r => ({ key: r.key, R: r.R, km: r.km, diffKm: r.diffKm, ppm: r.ppm })) : null,
      order: m.ok ? { correct: m.order.correct, swapped: m.order.swapped, correct9: m.order.correct9, swapped9: m.order.swapped9, ratio: m.order.ratio, swapDrawable: m.order.swapDrawable } : null,
      corridor: m.ok ? m.corridor : null,
      mapH: proj ? proj.h : null
    };
  });
}
window.addEventListener('resize', update);
if (window.matchMedia('(min-width: 900px)').matches) $('questions').open = true;

update();
await Promise.all(MODULES.map(async m => {
  modState[m] = 'LOAD'; paintMods();
  try { mod[m] = await import(ENGINE + m); modState[m] = 'OK'; }
  catch (e) { const msg = (e && e.message) || String(e); modState[m] = 'FAIL ' + msg; if (m !== 'corridor-estimate.js') loadError = `engine/${m} did not load: ${msg}`; }
  paintMods();
}));
update();
