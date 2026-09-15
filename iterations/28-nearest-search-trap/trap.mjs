/* The Nearest-Search Trap — the ring-search bug class from
   proofs/v9-engine.proof.mjs, made visible.
   Every distance and every nearest answer is returned by the engine's own
   modules at the pinned commit (v9-geodesy.js distanceKm, v9-nearest-search.js
   index().nearest). The page never measures a distance itself. The degree-box
   pre-filter in (b) is NOT engine code: it is the "optimisation" the proof
   warns about, built here by handing the module a box-filtered list. */

const COMMIT = 'd9cd18b0e2034325814924e6e4a0e958014f2748';
const ENGINE = `https://cdn.jsdelivr.net/gh/Ventusltd/ventus-grid-engine@${COMMIT}/`;
const MODULES = ['engine/v9-geodesy.js', 'engine/v9-nearest-search.js'];
const PROOF = 'proofs/v9-engine.proof.mjs';

/* ── The proof's fixture, as written in proofs/v9-engine.proof.mjs ─────────
   (the expressions are the proof's own; the nodes are fictional test nodes) */
const QUERY = [0, 55];
const DECOY_NORTH = { name: 'Decoy North Grid Substation', voltages_kv: [400],
                      location: { lon: 0, lat: 55 + 6.6 / 111.32 } };
const TRUE_EAST = { name: 'True East Substation', voltages_kv: [400],
                    location: { lon: 6.0 / (111.32 * Math.cos(55 * Math.PI / 180)), lat: 55 } };
const FAR = { name: 'Far Away Substation', voltages_kv: [400],
              location: { lon: 1.5, lat: 56.2 } };
const LOW_VOLTAGE = { name: 'Local 33kV Point', voltages_kv: [33],
                      location: { lon: 0.001, lat: 55.001 } };
const NODES = [DECOY_NORTH, TRUE_EAST, FAR, LOW_VOLTAGE];
const MIN_KV = 100;          // the proof's minimumKv
const BOX_DEG = 0.06;        // the proof's "naive square bounding box drawn in DEGREES (+/-0.06 deg)"
const near = (a, b, tol) => Math.abs(a - b) <= tol;   // the proof's helper

/* The deterministic grid of query positions the disagreement count runs over. */
const GRID = { lonMin: -0.2, lonMax: 0.2, latMin: 54.9, latMax: 55.1, n: 41 };

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const f = (v, d = 3) => Number(v).toFixed(d);
const SHORT = new Map([[DECOY_NORTH, 'Decoy North'], [TRUE_EAST, 'True East'], [FAR, 'Far Away'], [LOW_VOLTAGE, 'Local 33kV']]);

window.__trap = { commit: COMMIT, ready: false };

/* ── loading, Grid Atlas grammar ─────────────────────────────────────────── */
const modState = Object.fromEntries(MODULES.map(m => [m, 'WAIT']));
function paintMods() {
  const box = $('mods'); box.textContent = '';
  for (const m of MODULES) {
    const st = modState[m], sp = st.indexOf(' ');
    const s = el('span'); const b = el('b', null, sp < 0 ? st : st.slice(0, sp));
    s.append(b, ` ${m}` + (sp < 0 ? '' : ' — ' + st.slice(sp + 1)));
    box.append(s);
  }
  $('pin').textContent = `Modules imported from ventus-grid-engine at commit ${COMMIT.slice(0, 12)}; fixture, check names and box width from ${PROOF} at the same commit.`;
}
paintMods();
/* Questions: collapsed on phone, open on a wide screen */
if (window.matchMedia && window.matchMedia('(min-width: 900px)').matches) $('questions').open = true;

let geo = null, ns = null;
async function load() {
  const out = await Promise.all(MODULES.map(async m => {
    modState[m] = 'LOAD'; paintMods();
    try { const x = await import(ENGINE + m); modState[m] = 'OK'; paintMods(); return x; }
    catch (e) { modState[m] = 'FAIL ' + ((e && e.message) || 'import failed'); paintMods(); return null; }
  }));
  [geo, ns] = out;
  if (!geo || !ns) {
    for (const id of ['stepsA', 'stepsB', 'gate', 'grid', 'query']) {
      $(id).textContent = '';
      $(id).append(el('span', 'empty', 'EMPTY — an engine module did not load, so no distance can be shown; nothing is drawn in its place.'));
    }
    window.__trap.ready = 'failed';
    draw(); return;
  }
  start();
}

/* ── the two searches, both answered by the module ───────────────────────── */
let fullIdx;
function inBox(p, lon, lat) {
  return Math.abs(p.location.lon - lon) <= BOX_DEG && Math.abs(p.location.lat - lat) <= BOX_DEG;
}
function searchA(lon, lat) {
  return { best: fullIdx.nearest(lon, lat, { minimumKv: MIN_KV }),
           list: fullIdx.nearest(lon, lat, { minimumKv: MIN_KV, limit: NODES.length }) };
}
function searchB(lon, lat) {
  const kept = NODES.filter(p => inBox(p, lon, lat));
  const idx = ns.index(kept);
  return { kept, best: idx.nearest(lon, lat, { minimumKv: MIN_KV }),
           list: idx.nearest(lon, lat, { minimumKv: MIN_KV, limit: NODES.length }) };
}

/* ── state ───────────────────────────────────────────────────────────────── */
const S = { lon: QUERY[0], lat: QUERY[1], run: null, step: -1, timer: 0, showGrid: false };
let stepsA = [], stepsB = [], A = null, B = null, gridCells = [];

function buildSteps() {
  A = searchA(S.lon, S.lat); B = searchB(S.lon, S.lat);
  const kmOf = (list, p) => { const hit = (list || []).find(x => x.point === p); return hit ? hit.km : null; };
  stepsA = NODES.map(p => {
    const km = kmOf(A.list, p);
    return { node: p, kind: km == null ? 'floor' : 'scan',
      text: km == null
        ? [`${p.name} (${p.voltages_kv.join(', ')} kV): below minimumKv ${MIN_KV}, the module skips it`]
        : [`${p.name}: distanceKm = `, [f(km)], ' km'] };
  });
  stepsA.push({ kind: 'answer', text: A.best
    ? ['sorted by km; nearest() returns ', [A.best.point.name], ' at ', [f(A.best.km)], ' km']
    : ['nearest() returned null'] });

  stepsB = [{ kind: 'box', text: [`draw a square ±${BOX_DEG}° box in degrees around the query`] }];
  for (const p of NODES) {
    const inside = B.kept.includes(p);
    stepsB.push({ node: p, kind: inside ? 'keep' : 'drop',
      text: [`${p.name}: Δlon ${f(p.location.lon - S.lon, 4)}°, Δlat ${f(p.location.lat - S.lat, 4)}° → ${inside ? 'kept' : 'dropped before any distance is measured'}`] });
  }
  stepsB.push({ kind: 'scan', text: B.list.length
    ? ['module scans the kept list: ', ...B.list.flatMap((x, i) => [(i ? '; ' : '') + `${SHORT.get(x.point)} `, [f(x.km)], ' km'])]
    : [`module scans the kept list: no kept node at or above ${MIN_KV} kV`] });
  stepsB.push({ kind: 'answer', text: B.best
    ? ['nearest() returns ', [B.best.point.name], ' at ', [f(B.best.km)], ' km']
    : ['nearest() returned null'] });
}

function renderSteps(list, ol, active) {
  ol.textContent = '';
  list.forEach((s, i) => {
    const li = el('li');
    for (const part of s.text) li.append(Array.isArray(part) ? el('span', 'km', part[0]) : part);
    if (active == null || i <= active) li.classList.add('on');
    if (active === i) li.classList.add('now');
    ol.append(li);
  });
}

function ansNode(r, lead) {
  const d = el('div');
  if (!r.best) {
    d.append(lead, el('span', 'empty', `EMPTY — no mapped node at or above ${MIN_KV} kV inside the box; the module returns null`));
    return d;
  }
  d.append(lead, el('b', null, r.best.point.name), ' · ', el('b', null, f(r.best.km) + ' km'), ' to the nearest mapped node');
  return d;
}

function renderPanels() {
  const q = $('query'); q.textContent = '';
  const atFixture = S.lon === QUERY[0] && S.lat === QUERY[1];
  q.append(`query lon ${f(S.lon, 4)}°, lat ${f(S.lat, 4)}°`,
    atFixture ? ' — the proof\'s fixture query' : ' — moved from the proof\'s fixture query');
  const act = S.run;
  renderSteps(stepsA, $('stepsA'), act === 'a' ? S.step : act === 'b' ? -1 : null);
  renderSteps(stepsB, $('stepsB'), act === 'b' ? S.step : act === 'a' ? -1 : null);
  $('ansA').replaceChildren(ansNode(A, 'answer: '));
  $('ansB').replaceChildren(ansNode(B, 'answer: '));
  const c = $('compare'); c.textContent = '';
  if (!A.best) c.append(el('span', 'empty', 'EMPTY — the full scan found no node'));
  else if (!B.best) c.append('At this point the pre-filter returns ', el('span', 'empty', 'EMPTY'),
    ' where the full scan finds ', el('b', null, A.best.point.name), ' at ', el('b', null, f(A.best.km) + ' km'), '.');
  else if (B.best.point === A.best.point) c.append('At this point both searches return the same node, ',
    el('b', null, A.best.point.name), ', at ', el('b', null, f(A.best.km) + ' km'), '.');
  else c.append('At this point the pre-filter returns ', el('b', null, B.best.point.name), ' at ', el('b', null, f(B.best.km) + ' km'),
    '; the full scan returns ', el('b', null, A.best.point.name), ' at ', el('b', null, f(A.best.km) + ' km'),
    '. The pre-filter\'s distance is ', el('b', null, f(B.best.km - A.best.km) + ' km'), ' longer (',
    el('b', null, f(100 * (B.best.km / A.best.km - 1), 1) + '%'), '), with no error raised.');
}

/* ── the gate: the proof's trap checks, verbatim names, both searches ──────── */
function runGate(search, tag) {
  const failures = []; let passed = 0;
  const check = (name, condition) => { if (condition) passed += 1; else failures.push(name); };
  const best = search(QUERY[0], QUERY[1]).best;
  const dEast = geo.distanceKm(QUERY[0], QUERY[1], TRUE_EAST.location.lon, TRUE_EAST.location.lat);
  const dNorth = geo.distanceKm(QUERY[0], QUERY[1], DECOY_NORTH.location.lon, DECOY_NORTH.location.lat);
  check('the fixture is actually a trap: the true nearest node is closer than '
    + 'the decoy, but sits outside a naive degree-square box that still '
    + 'contains the decoy — if this fails the test has stopped testing anything',
    dEast < dNorth
    && Math.abs(TRUE_EAST.location.lon - QUERY[0]) > 0.06
    && Math.abs(DECOY_NORTH.location.lat - QUERY[1]) < 0.06);
  check('nearest() returns the TRUE nearest node, not the one a degree-box '
    + 'pre-filter would have left behind — this is the ring-search bug class, '
    + 'and it inflates a reported grid distance by kilometres when present',
    best && best.point.name === 'True East Substation');
  check('the reported distance is the true one, roughly 6 km and not the decoy 6.6',
    best && near(best.km, 6.0, 0.05));
  const report = failures.length
    ? 'v9-engine proof FAILED (' + failures.length + ' of ' + (failures.length + passed) + '):\n- ' + failures.join('\n- ')
    : 'v9-engine proof PASS — ' + passed + ' checks';
  return { tag, passed, failures, report, best, dEast, dNorth };
}

function renderGate() {
  const ga = runGate(searchA, 'a'), gb = runGate(searchB, 'b');
  const g = $('gate'); g.textContent = '';
  g.append(el('p', null, `At the fixture query (${QUERY[0]}, ${QUERY[1]}) the module measures True East at ${f(ga.dEast)} km and Decoy North at ${f(ga.dNorth)} km. True East's longitude offset is ${f(TRUE_EAST.location.lon - QUERY[0], 4)}°, outside the ±${BOX_DEG}° box; Decoy North's latitude offset is ${f(DECOY_NORTH.location.lat - QUERY[1], 4)}°, inside it.`));
  for (const r of [ga, gb]) {
    const p = el('p');
    p.append(r.tag === 'a' ? '(a) the scan the module ships: ' : '(b) the same module handed a degree-box pre-filtered list: ',
      el('span', 'v', r.failures.length ? 'the gate FAILS' : 'the gate HOLDS'),
      ` — ${r.passed} of ${r.passed + r.failures.length} checks pass`);
    g.append(p, el('pre', r.tag, r.report));
  }
  g.append(el('p', 'dim', 'The report lines are the proof\'s own check names and report format, evaluated here against each search. The proof in the engine runs only against (a); (b) is how the gate reads when someone adds the filter it was written to catch. Seeing it fail is what makes its pass worth trusting.'));
  window.__trap.gate = { a: { passed: ga.passed, failed: ga.failures.length }, b: { passed: gb.passed, failed: gb.failures.length } };
}

/* ── the grid count ──────────────────────────────────────────────────────── */
function runGrid() {
  gridCells = [];
  let same = 0, other = 0, empty = 0, worst = 0, worstAt = null;
  for (let j = 0; j < GRID.n; j++) for (let i = 0; i < GRID.n; i++) {
    const lon = GRID.lonMin + (GRID.lonMax - GRID.lonMin) * i / (GRID.n - 1);
    const lat = GRID.latMin + (GRID.latMax - GRID.latMin) * j / (GRID.n - 1);
    const a = searchA(lon, lat).best, b = searchB(lon, lat).best;
    let k;
    if (!b) { k = 'empty'; empty++; }
    else if (b.point === a.point) { k = 'same'; same++; }
    else { k = 'other'; other++; const d = b.km - a.km; if (d > worst) { worst = d; worstAt = [lon, lat, a, b]; } }
    gridCells.push({ lon, lat, k });
  }
  const total = gridCells.length;
  const g = $('grid'); g.textContent = '';
  const pct = v => f(100 * v / total, 1) + '%';
  g.append(el('p', null, `Query grid: ${GRID.n} × ${GRID.n} = ${total} positions, longitude ${GRID.lonMin}° to ${GRID.lonMax}°, latitude ${GRID.latMin}° to ${GRID.latMax}°, evenly spaced; both searches run at every position when this page loads. Tap "show the query grid" to see them on the plane.`));
  const ul = el('ul');
  const li = (...parts) => { const x = el('li'); x.append(...parts); ul.append(x); };
  li(el('b', null, String(same)), ` (${pct(same)}) — the pre-filter returns the same node as the full scan`);
  li(el('b', null, String(other)), ` (${pct(other)}) — the pre-filter returns a different, farther node, silently`);
  li(el('b', null, String(empty)), ` (${pct(empty)}) — the pre-filter returns `, el('span', 'empty', 'EMPTY'), ' (null) while the full scan finds a node');
  g.append(ul);
  const dis = other + empty;
  g.append(el('p', null, `The pre-filter disagrees with the full scan at ${dis} of ${total} grid positions (${pct(dis)}).`));
  if (same + other) g.append(el('p', null, `Counting only positions where the box kept at least one node at or above ${MIN_KV} kV, it returns a farther node at ${other} of ${same + other} (${f(100 * other / (same + other), 1)}%): the silent failures, where an answer arrives and looks fine.`));
  if (worstAt) g.append(el('p', null, `Largest silent inflation on the grid: ${f(worst)} km, at lon ${f(worstAt[0], 3)}°, lat ${f(worstAt[1], 3)}° — pre-filter ${worstAt[3].point.name} ${f(worstAt[3].km)} km, full scan ${worstAt[2].point.name} ${f(worstAt[2].km)} km.`));
  g.append(el('p', 'dim', 'Grid positions are a drawing of the question, not proposed sites. The count belongs to the proof\'s four fixture nodes and its box width; with a real node set it would differ, and it is not shown for one.'));
  window.__trap.grid = { total, same, other, empty, disagree: dis, worstKm: worst };
}

/* ── canvas ──────────────────────────────────────────────────────────────── */
const cv = $('plane'), ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1, scale = 1, cx = 0, cy = 0;
/* drawing scale only; before the module loads nothing is placed */
const KM_PER_DEG = () => (geo ? geo.EARTH_RADIUS_KM : 6378.137) * Math.PI / 180;
const COS0 = Math.cos(QUERY[1] * Math.PI / 180);
function resize() {
  const r = cv.getBoundingClientRect();
  DPR = Math.min(window.devicePixelRatio || 1, 3);
  W = r.width; H = r.height;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  const halfWkm = (GRID.lonMax - GRID.lonMin) / 2 * KM_PER_DEG() * COS0 + 0.8;
  const halfHkm = (GRID.latMax - GRID.latMin) / 2 * KM_PER_DEG() + 0.8;
  scale = Math.min(W / (2 * halfWkm), H / (2 * halfHkm));
  cx = W / 2; cy = H / 2;
  draw();
}
/* a local flat projection centred on the fixture query, for display */
const px = (lon, lat) => [cx + (lon - QUERY[0]) * KM_PER_DEG() * COS0 * scale, cy - (lat - QUERY[1]) * KM_PER_DEG() * scale];
const unpx = (x, y) => [QUERY[0] + (x - cx) / (KM_PER_DEG() * COS0 * scale), QUERY[1] - (y - cy) / (KM_PER_DEG() * scale)];

const MAG = '#ff2bd6', GREY = '#8b93a7';
function dot(x, y, r, fill, stroke) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
}
function label(text, x, y, color, align = 'left') {
  ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.lineWidth = 3; ctx.strokeStyle = '#05060a'; ctx.strokeText(text, x, y);
  ctx.fillStyle = color; ctx.fillText(text, x, y);
}
function edgePoint(x, y) {
  const dx = x - cx, dy = y - cy, m = 14;
  const t = Math.min((W / 2 - m) / Math.abs(dx || 1e-9), (H / 2 - m) / Math.abs(dy || 1e-9));
  return t < 1 ? [cx + dx * t, cy + dy * t, true] : [x, y, false];
}

function draw() {
  if (!W) return;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!geo || !ns) {
    label(window.__trap.ready === 'failed' ? 'EMPTY — engine modules did not load' : 'WAIT — loading engine modules', W / 2, H / 2, GREY, 'center');
    return;
  }
  // graticule every 0.02 degrees, so the reader can see degrees are not square here
  ctx.strokeStyle = '#161b28'; ctx.lineWidth = 1;
  const [lon0, lat1] = unpx(0, 0), [lon1, lat0] = unpx(W, H);
  for (let k = Math.ceil(lon0 / 0.02); k * 0.02 <= lon1; k++) { const [x] = px(k * 0.02, QUERY[1]); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let k = Math.ceil(lat0 / 0.02); k * 0.02 <= lat1; k++) { const [, y] = px(QUERY[0], k * 0.02); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  const barKm = 2, bx = 12, by = H - 14;
  ctx.strokeStyle = GREY; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + barKm * scale, by); ctx.stroke();
  label(`${barKm} km (drawing)`, bx + barKm * scale + 6, by, GREY);
  label('graticule 0.02°', W - 10, H - 14, GREY, 'right');

  if (S.showGrid) for (const c of gridCells) {
    const [x, y] = px(c.lon, c.lat);
    if (c.k === 'same') dot(x, y, 1.3, 'rgba(255,255,255,.55)');
    else if (c.k === 'other') dot(x, y, 2, MAG);
    else dot(x, y, 0.9, GREY);
  }

  const runA = S.run === 'a', runB = S.run === 'b';
  const stepA = runA ? stepsA[S.step] : null, stepB = runB ? stepsB[S.step] : null;
  const [qx, qy] = px(S.lon, S.lat);
  if (!S.run || runB) {
    const [x0, y0] = px(S.lon - BOX_DEG, S.lat + BOX_DEG), [x1, y1] = px(S.lon + BOX_DEG, S.lat - BOX_DEG);
    ctx.save(); ctx.setLineDash([6, 4]); ctx.strokeStyle = MAG; ctx.lineWidth = runB && S.step === 0 ? 2.2 : 1.4;
    ctx.globalAlpha = runB ? 1 : 0.6; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0); ctx.restore();
    label(`±${BOX_DEG}° box`, x1 - 4, y0 + 10, MAG, 'right');
  }
  const doneA = !S.run || (stepA && stepA.kind === 'answer');
  const doneB = !S.run || (stepB && stepB.kind === 'answer');
  const line = (best, color, dash, off) => {
    if (!best) return;
    const [x, y] = edgePoint(...px(best.point.location.lon, best.point.location.lat));
    ctx.save(); ctx.setLineDash(dash); ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(qx + off, qy + off); ctx.lineTo(x + off, y + off); ctx.stroke(); ctx.restore();
  };
  if (doneA) line(A.best, '#ffffff', [], 0);
  if (doneB) line(B.best, MAG, [7, 5], 1.5);
  const hl = (stepA && stepA.node) || (stepB && stepB.node) || null;
  if (hl) {
    const [x, y] = edgePoint(...px(hl.location.lon, hl.location.lat));
    ctx.save(); ctx.setLineDash([2, 4]); ctx.strokeStyle = runB ? MAG : '#ffffff'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(qx, qy); ctx.lineTo(x, y); ctx.stroke(); ctx.restore();
  }
  const listA = A.list || [];
  for (const p of NODES) {
    const [x, y, clipped] = edgePoint(...px(p.location.lon, p.location.lat));
    const floor = Math.max(...p.voltages_kv) < MIN_KV;
    const kmA = listA.find(e => e.point === p);
    if (hl === p) dot(x, y, 12, 'rgba(255,255,255,.14)');
    if (floor) dot(x, y, 3.5, null, GREY);
    else { dot(x, y, 7, 'rgba(0,0,0,.85)'); dot(x, y, clipped ? 3.5 : 5, '#ffffff'); }
    const droppedNow = runB && S.step > 0 && !B.kept.includes(p) && stepsB.indexOf(stepsB.find(s => s.node === p)) <= S.step;
    if (droppedNow && !floor) dot(x, y, 9.5, null, GREY);
    let t = SHORT.get(p) + (kmA ? ` ${f(kmA.km, 2)} km` : floor ? ' · below floor' : '');
    if (clipped) t = t + ' (off plane)';
    if (droppedNow && !floor) t += ' · dropped';
    ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
    const tw = ctx.measureText(t).width;
    /* place each label where it does not sit on the query: below for nodes
       level with it, above otherwise; always kept inside the plane */
    let ly = clipped ? y + 16 : floor ? y + 16 : Math.abs(y - qy) < 26 ? y + 20 : y - 13;
    if (floor && Math.abs(y - qy) < 26 && Math.abs(x - qx) < 30) ly = qy - 24;
    let lx = x - tw / 2;
    lx = Math.max(6, Math.min(W - 6 - tw, lx));
    ly = Math.max(10, Math.min(H - 30, ly));
    label(t, lx, ly, floor ? GREY : '#ffffff', 'left');
  }
  dot(qx, qy, 13, 'rgba(255,255,255,.08)');
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.beginPath();
  ctx.moveTo(qx - 16, qy); ctx.lineTo(qx - 7, qy); ctx.moveTo(qx + 7, qy); ctx.lineTo(qx + 16, qy);
  ctx.moveTo(qx, qy - 16); ctx.lineTo(qx, qy - 7); ctx.moveTo(qx, qy + 7); ctx.lineTo(qx, qy + 16); ctx.stroke();
  dot(qx, qy, 5, null, '#ffffff');
  label('query', qx - 12, qy + 24, '#ffffff', 'right');
}

function paintKey() {
  const k = $('key'); k.textContent = '';
  const item = (style, text) => { const s = el('span'); const i = el('i'); Object.assign(i.style, style); s.append(i, text); k.append(s); };
  item({ background: '#fff' }, `mapped node at or above ${MIN_KV} kV (substations white)`);
  item({ border: `1.5px solid ${GREY}`, boxSizing: 'border-box' }, 'below the floor, or dropped by the box');
  item({ background: GREY, width: '.4em', height: '.4em' }, 'grid position where (b) returns EMPTY');
  item({ background: '#fff', width: '.45em', height: '.45em' }, 'grid position where both agree');
  item({ background: '#fff', borderRadius: '0', height: '2px' }, '(a) full-scan answer');
  item({ background: MAG, borderRadius: '0', height: '2px' }, '(b) pre-filter answer and box');
  item({ background: MAG }, 'grid position where (b) returns another node');
}

function notes() {
  const n = $('notes'); n.textContent = '';
  const p = t => n.append(el('p', null, t));
  p(`Distances are measured by distanceKm in engine/v9-geodesy.js: haversine on a sphere of radius ${geo.EARTH_RADIUS_KM} km, as the module states. That is a sphere, not the WGS84 ellipsoid used in some cable-engine datasheets; the difference is stated, not hidden. The plane is drawn in a flat local projection for display only; no distance is read off the drawing.`);
  p(`The nearest answers are index(points).nearest(lon, lat, { minimumKv: ${MIN_KV} }) from engine/v9-nearest-search.js. That module is an exhaustive scan with no box or ring pre-filter, which is why (a) holds. Its own header records that it is not the copy the live Atlas loads, and that the production copy is also an exhaustive scan.`);
  p(`Search (b) is not in the engine. It is the pre-filter the proof describes, built on this page by passing the module only the nodes within ±${BOX_DEG}° of the query in both longitude and latitude. It exists here so the gate can be seen to fail.`);
  p('The four nodes are the proof\'s fictional test fixture, placed by the proof\'s own expressions. No real grid data is fetched or shown. A nearest mapped node is only the closest point in a list; it says nothing about capacity, permission, or whether anything could ever be joined to it.');
}

/* ── interaction ─────────────────────────────────────────────────────────── */
function stopRun() { clearTimeout(S.timer); S.timer = 0; }
function publish() {
  Object.assign(window.__trap, {
    query: [S.lon, S.lat], run: S.run, step: S.step,
    a: A.best ? { name: A.best.point.name, km: A.best.km } : null,
    b: B.best ? { name: B.best.point.name, km: B.best.km } : null,
    kept: B.kept.map(p => p.name)
  });
}
function refresh() { buildSteps(); renderPanels(); draw(); publish(); }
function play(which) {
  stopRun(); S.run = which; S.step = 0; renderPanels(); draw(); publish();
  const len = () => (which === 'a' ? stepsA : stepsB).length;
  const tick = () => {
    if (S.step < len() - 1) { S.step++; renderPanels(); draw(); publish(); S.timer = setTimeout(tick, 750); }
    else S.timer = 0;
  };
  S.timer = setTimeout(tick, 750);
}
function stepOnce() {
  stopRun();
  if (!S.run) { S.run = 'a'; S.step = 0; }
  else {
    const len = (S.run === 'a' ? stepsA : stepsB).length;
    if (S.step < len - 1) S.step++;
    else if (S.run === 'a') { S.run = 'b'; S.step = 0; }
    else { S.run = null; S.step = -1; }
  }
  renderPanels(); draw(); publish();
}

function start() {
  fullIdx = ns.index(NODES);
  window.__trap.located = fullIdx.located;
  paintKey(); notes();
  $('mdR').textContent = String(geo.EARTH_RADIUS_KM);
  buildSteps(); renderPanels(); renderGate(); runGrid(); resize(); publish();
  $('runA').onclick = () => play('a');
  $('runB').onclick = () => play('b');
  $('step').onclick = stepOnce;
  $('reset').onclick = () => { stopRun(); S.run = null; S.step = -1; S.lon = QUERY[0]; S.lat = QUERY[1]; refresh(); };
  $('gridBtn').onclick = () => { S.showGrid = !S.showGrid; $('gridBtn').setAttribute('aria-pressed', String(S.showGrid)); draw(); };

  let dragging = false, raf = 0, pending = null;
  window.__trap.moves = 0; window.__trap.drags = 0;
  const moveTo = e => {
    const r = cv.getBoundingClientRect();
    let [lon, lat] = unpx(e.clientX - r.left, e.clientY - r.top);
    pending = [Math.min(GRID.lonMax, Math.max(GRID.lonMin, lon)), Math.min(GRID.latMax, Math.max(GRID.latMin, lat))];
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; [S.lon, S.lat] = pending; window.__trap.moves++; refresh(); });
  };
  cv.addEventListener('pointerdown', e => {
    dragging = true; stopRun(); S.run = null; S.step = -1;
    try { cv.setPointerCapture(e.pointerId); } catch (_) { /* capture is a convenience */ }
    moveTo(e); e.preventDefault();
  });
  cv.addEventListener('pointermove', e => { if (dragging) { moveTo(e); e.preventDefault(); } });
  const end = () => { if (dragging) window.__trap.drags++; dragging = false; };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  window.__trap.ready = true;
}

window.addEventListener('resize', resize);
resize();
load();
