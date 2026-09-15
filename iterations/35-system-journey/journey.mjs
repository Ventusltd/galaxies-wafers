/* One System, Stop by Stop.
   Five published engine calculations chained into one illustrative system and
   drawn as a single-line diagram that grows stop by stop. Every electrical or
   geometric number is returned by ventus-grid-engine at the pinned commit,
   imported at run time. This file writes no engineering formula. It does three
   things of its own, each stated where it happens: it checks the unit and
   meaning on every wire between two calculations, it applies a named unit
   conversion (km to m, kVA to MVA, kV to V) only when the reader leaves
   "stated conversions" on, and it draws. */

const COMMIT = 'd9cd18b0e2034325814924e6e4a0e958014f2748';
const BASE = `https://cdn.jsdelivr.net/gh/Ventusltd/ventus-grid-engine@${COMMIT}/`;
const PIN = COMMIT.slice(0, 12);

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const nf = (v, sig = 4) => (typeof v === 'number' && Number.isFinite(v)) ? v.toLocaleString('en-GB', { maximumSignificantDigits: sig }) : String(v);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const attempt = fn => { try { return { ok: fn() }; } catch (e) { return { err: (e && e.message) || String(e) }; } };

const BOUNDARY = 'Illustrative physics drawn by a computer from published data. Not an engineering design or certified calculation. Any real design above 100 kW needs study and approval by a qualified chartered electrical engineer under the applicable standards.';
const FINAL = 'each stop is a separate published calculation; the chain is an illustration, not a connection study';

/* Grid Atlas v8 topology colours; substations white. A voltage the Atlas does
   not draw is grey. */
const ATLAS = [{ kv: 400, c: '#0054ff' }, { kv: 275, c: '#ff0000' }, { kv: 220, c: '#ff9900' }, { kv: 132, c: '#00cc00' }, { kv: 66, c: '#b200ff' }, { kv: 11, c: '#ff00ff' }];
const GREY = '#8a8f98';
const colourOf = kv => (ATLAS.find(a => a.kv === kv) || { c: GREY }).c;

/* ── sources, loaded the Grid Atlas way ─────────────────────────────────── */
const SRC = {
  em: { path: 'engine/electrification-model.js', kind: 'module' },
  geo9: { path: 'engine/v9-geodesy.js', kind: 'module' },
  ns: { path: 'engine/v9-nearest-search.js', kind: 'module' },
  pv9: { path: 'proofs/v9-engine.proof.mjs', kind: 'text' },
  gc: { path: 'engine/geo-core.js', kind: 'module' },
  ce: { path: 'engine/corridor-estimate.js', kind: 'module' },
  pf: { path: 'engine/power-factor.js', kind: 'module' },
  cfp: { path: 'engine/current-from-power.js', kind: 'module' },
  vd: { path: 'engine/voltage-drop.js', kind: 'module' },
  topo: { path: 'engine/network-topology.js', kind: 'module' },
  re: { path: 'engine/rating-envelope.js', kind: 'module' },
  pre: { path: 'proofs/rating-envelope.proof.mjs', kind: 'text' }
};
const STOP_SRC = [null, ['em'], ['geo9', 'ns', 'pv9'], ['gc', 'ce'], ['pf', 'cfp', 'vd'], ['topo', 're', 'pre']];
const RT = Object.fromEntries(Object.keys(SRC).map(k => [k, { status: 'WAIT', value: null, error: '', promise: null }]));
const TIMEOUT_MS = 15000;

const queue = { active: 0, max: 3, waiting: [], peak: 0 };
function enqueue(job) {
  return new Promise((res, rej) => { queue.waiting.push({ job, res, rej }); pump(); });
}
function pump() {
  while (queue.active < queue.max && queue.waiting.length) {
    const t = queue.waiting.shift();
    queue.active++; queue.peak = Math.max(queue.peak, queue.active);
    t.job().then(t.res, t.rej).finally(() => { queue.active--; pump(); });
  }
}
function timed(p, what) {
  let timer;
  return Promise.race([p, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`${what} timed out after ${TIMEOUT_MS / 1000} s`)), TIMEOUT_MS); })])
    .finally(() => clearTimeout(timer));
}
function hydrate(id) {
  const r = RT[id];
  if (r.status === 'OK' || r.promise) return r.promise || Promise.resolve(r.value);
  r.status = 'LOAD'; r.error = ''; paintRow(id);
  const s = SRC[id];
  r.promise = enqueue(async () => {
    if (s.kind === 'module') return timed(import(BASE + s.path), s.path);
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(BASE + s.path, { signal: ac.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.text();
    } catch (e) { throw new Error(e && e.name === 'AbortError' ? `${s.path} timed out after ${TIMEOUT_MS / 1000} s` : (e && e.message) || String(e)); }
    finally { clearTimeout(t); }
  }).then(v => { r.value = v; r.status = 'OK'; paintRow(id); update(); return v; },
    e => { r.status = 'FAIL'; r.error = (e && e.message) || String(e); r.promise = null; paintRow(id); update(); return null; });
  return r.promise;
}
const M = id => (RT[id].status === 'OK' ? RT[id].value : null);
const why = id => {
  const r = RT[id];
  if (r.status === 'FAIL') return `engine source ${SRC[id].path} did not load: ${r.error}`;
  return `waiting for ${SRC[id].path} (${r.status})`;
};

const rows = {};
function buildRows() {
  const ul = $('mods');
  for (const id of Object.keys(SRC)) {
    const li = el('li'); li.dataset.src = id;
    const b = el('b'); const t = el('span');
    li.append(b, ' ', t);
    li.addEventListener('click', () => { if (RT[id].status === 'FAIL') hydrate(id); });
    ul.append(li); rows[id] = { li, b, t };
  }
  for (const id of Object.keys(SRC)) paintRow(id);
}
function paintRow(id) {
  const r = RT[id], row = rows[id];
  if (!row) return;
  const stop = STOP_SRC.findIndex(a => a && a.includes(id));
  row.b.textContent = r.status;
  row.t.textContent = `${SRC[id].path} · stop ${stop}` + (r.status === 'FAIL' ? ` — ${r.error} (tap to retry)` : r.status === 'WAIT' ? ' — not fetched until that stop is opened' : '');
  row.li.classList.toggle('fail', r.status === 'FAIL');
  const counts = {};
  for (const k of Object.keys(RT)) counts[RT[k].status] = (counts[RT[k].status] || 0) + 1;
  $('srcsum').textContent = ['OK', 'LOAD', 'WAIT', 'FAIL'].filter(s => counts[s]).map(s => `${counts[s]} ${s}`).join(' · ');
}

/* ── fixtures, from the proofs' own served bytes ─────────────────────────── */
/* The nearest-search trap fixture, written with the proof's own expressions.
   It is only used after every declaration line below is found verbatim in the
   served proofs/v9-engine.proof.mjs at the pinned commit. */
const QUERY = [0, 55];
const DECOY_NORTH = { name: 'Decoy North Grid Substation', voltages_kv: [400], location: { lon: 0, lat: 55 + 6.6 / 111.32 } };
const TRUE_EAST = { name: 'True East Substation', voltages_kv: [400], location: { lon: 6.0 / (111.32 * Math.cos(55 * Math.PI / 180)), lat: 55 } };
const FAR = { name: 'Far Away Substation', voltages_kv: [400], location: { lon: 1.5, lat: 56.2 } };
const LOW_VOLTAGE = { name: 'Local 33kV Point', voltages_kv: [33], location: { lon: 0.001, lat: 55.001 } };
const NODES = [DECOY_NORTH, TRUE_EAST, FAR, LOW_VOLTAGE];
const V9_LINES = [
  'const QUERY = [0, 55];',
  "const DECOY_NORTH = { name: 'Decoy North Grid Substation', voltages_kv: [400],",
  'location: { lon: 0, lat: 55 + 6.6 / 111.32 } };',
  "const TRUE_EAST = { name: 'True East Substation', voltages_kv: [400],",
  'location: { lon: 6.0 / (111.32 * Math.cos(55 * Math.PI / 180)), lat: 55 } };',
  "const FAR = { name: 'Far Away Substation', voltages_kv: [400],",
  'location: { lon: 1.5, lat: 56.2 } };',
  "const LOW_VOLTAGE = { name: 'Local 33kV Point', voltages_kv: [33],",
  'location: { lon: 0.001, lat: 55.001 } };',
  'const best = idx.nearest(QUERY[0], QUERY[1], { minimumKv: 100 });'
];
let v9check = null;
function verifyV9(text) {
  if (v9check && v9check.text === text) return v9check;
  const lines = text.split('\n').map(s => s.trim());
  const at = [];
  let missing = null;
  for (const L of V9_LINES) { const i = lines.indexOf(L); if (i < 0) { missing = L; break; } at.push(i + 1); }
  v9check = missing ? { text, ok: false, missing } : { text, ok: true, first: Math.min(...at), last: Math.max(...at) };
  return v9check;
}

/* The rating-envelope proof declares its fixture as an object literal named
   PRODUCT. It is read as text and turned into JSON without evaluating code;
   ACCEPTS is the value network-topology.js exports under that name. */
let reFix = null;
function fixtureFrom(text, accepts) {
  if (reFix && reFix.text === text) return reFix;
  const lines = text.split('\n');
  const start = lines.findIndex(l => /^const PRODUCT = \{/.test(l));
  if (start < 0) throw new Error('no "const PRODUCT = {" line in the proof');
  let end = -1;
  for (let i = start + 1; i < lines.length; i++) if (/^\};/.test(lines[i])) { end = i; break; }
  if (end < 0) throw new Error('the PRODUCT literal has no closing line');
  let src = lines.slice(start, end + 1).join('\n').replace(/^const PRODUCT = /, '').replace(/;\s*$/, '').replace(/\/\/[^\n]*/g, '');
  src = src.replace(/\bACCEPTS\b/g, JSON.stringify(accepts))
    .replace(/'([^'\\\n]*)'/g, (_, s) => JSON.stringify(s))
    .replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":')
    .replace(/,(\s*[}\]])/g, '$1');
  reFix = { text, product: JSON.parse(src), firstLine: start + 1, lastLine: end + 1 };
  return reFix;
}

/* ── state: every value here is a scenario input ─────────────────────────── */
const S = {
  stop: 1,
  heat: 12.25, scop: 3.5, div: 1.7, units: 2000, carry: 'after_diversity', tryAdd: false,
  lon: QUERY[0], lat: QUERY[1], minKv: 100,
  kv: null, kvFollow: true, pf: 0.95, r: 0.16, x: 0.1, phases: 'three', convert: true,
  site: 'COWL', season: 'winter'
};
{
  const m = /stop=([1-5])/.exec(location.hash);
  if (m) S.stop = +m[1];
}

/* ── wires: the page's own check between two calculations ────────────────── */
const CONVERSIONS = {
  'km->m': { factor: 1000, text: '1 km = 1,000 m' },
  'kVA->MVA': { factor: 0.001, text: '1 kVA = 0.001 MVA' },
  'kV->V': { factor: 1000, text: '1 kV = 1,000 V' }
};
/* q: { value, unit, meaning } or null with emptyWhy. accepts: { unit, meanings, why } */
function connect({ id, from, to, q, emptyWhy, accepts }) {
  const w = { id, from, to, q, accepts, state: 'EMPTY', reason: '', direct: '', out: null };
  if (!q) { w.reason = emptyWhy || 'nothing was returned upstream'; return w; }
  if (accepts.meanings && !accepts.meanings.includes(q.meaning)) {
    w.state = 'REFUSED';
    w.reason = `meaning "${q.meaning}" is not one this input accepts (${accepts.meanings.map(m => `"${m}"`).join(', ')}). ${accepts.why || ''}`.trim();
    return w;
  }
  if (q.unit !== accepts.unit) {
    const conv = CONVERSIONS[`${q.unit}->${accepts.unit}`];
    w.direct = `direct connection REFUSED: ${nf(q.value, 6)} ${q.unit} into an input that takes ${accepts.unit}` + (conv ? ` would be read as ${nf(q.value, 6)} ${accepts.unit}, wrong by a factor of ${nf(conv.factor)}.` : '; no stated conversion exists.');
    if (conv && S.convert) {
      w.state = 'CONVERTED';
      w.out = { value: q.value * conv.factor, unit: accepts.unit, meaning: q.meaning };
      w.reason = `stated unit conversion by this page: ${conv.text}, so ${nf(q.value, 6)} ${q.unit} crosses as ${nf(w.out.value, 6)} ${accepts.unit}; the meaning is unchanged.`;
    } else {
      w.state = 'REFUSED';
      w.reason = conv ? 'stated conversions are switched off, so nothing crosses this wire.' : 'the units differ and this page states no conversion between them.';
    }
    return w;
  }
  w.state = 'ACCEPTED';
  w.out = { value: q.value, unit: q.unit, meaning: q.meaning };
  w.reason = accepts.okWhy || 'unit and meaning match what the input takes.';
  return w;
}

/* ── the chain: every call below is a module call ────────────────────────── */
function chain() {
  const R = { wires: {} };

  /* STOP 1 · DEMAND */
  const em = M('em');
  if (!em) R.s1 = { empty: why('em') };
  else {
    const q = em.MEANING;
    const thermal = attempt(() => em.quantity(S.heat, 'kW', q.THERMAL_OUTPUT));
    const elec = thermal.ok ? attempt(() => em.electricalInputFromHeat({ thermal: thermal.ok, scop: S.scop })) : thermal;
    const fleet = elec.ok ? attempt(() => em.fleetDemand({ units: S.units, perUnitNameplate: elec.ok, perUnitAfterDiversity: em.quantity(S.div, 'kW', q.AFTER_DIVERSITY) })) : elec;
    const plateOnly = elec.ok ? attempt(() => em.fleetDemand({ units: S.units, perUnitNameplate: elec.ok })) : elec;
    const thermalFleet = thermal.ok ? attempt(() => em.fleetDemand({ units: S.units, perUnitNameplate: thermal.ok })) : thermal;
    const added = (fleet.ok && plateOnly.ok) ? attempt(() => em.combinedPeak({ fleets: [plateOnly.ok, fleet.ok] })) : { err: 'upstream refused' };
    let carried = null, carryWhy = '';
    if (S.carry === 'after_diversity') {
      if (fleet.ok && fleet.ok.diversified) carried = { value: fleet.ok.diversified.value, unit: fleet.ok.diversified.unit, meaning: fleet.ok.diversified.meaning, label: fleet.ok.diversified.label };
      else carryWhy = `fleetDemand refused: ${fleet.err}`;
    } else if (S.carry === 'nameplate') {
      if (fleet.ok) carried = { value: fleet.ok.simultaneous.value, unit: fleet.ok.simultaneous.unit, meaning: fleet.ok.simultaneous.meaning, label: fleet.ok.simultaneous.label };
      else carryWhy = `fleetDemand refused: ${fleet.err}`;
    } else {
      if (thermal.ok) carried = { value: thermal.ok.value * S.units, unit: thermal.ok.unit, meaning: thermal.ok.meaning, label: 'heat delivered, units × per-unit thermal output' };
      else carryWhy = `quantity refused: ${thermal.err}`;
    }
    R.s1 = { thermal, elec, fleet, plateOnly, thermalFleet, added, carried, carryWhy, em };
  }

  /* STOP 2 · SITE POINT AND NEAREST MAPPED NODE */
  const ns = M('ns'), pv9 = M('pv9'), geo9 = M('geo9');
  if (!ns || !geo9 || pv9 == null) R.s2 = { empty: !ns ? why('ns') : !geo9 ? why('geo9') : why('pv9') };
  else {
    const chk = verifyV9(pv9);
    if (!chk.ok) R.s2 = { empty: `the fixture could not be verified against the served proof: the line "${chk.missing}" was not found in ${SRC.pv9.path}` };
    else {
      const idx = ns.index(NODES);
      const best = idx.nearest(S.lon, S.lat, { minimumKv: S.minKv });
      const list = idx.nearest(S.lon, S.lat, { minimumKv: S.minKv, limit: NODES.length });
      R.s2 = { idx, best, list, chk, radius: geo9.EARTH_RADIUS_KM };
    }
  }
  const node = R.s2 && R.s2.best ? R.s2.best.point : null;
  if (node && S.kvFollow) S.kv = Math.max(...node.voltages_kv);

  /* STOP 3 · ROUTE LENGTH */
  const gc = M('gc'), ce = M('ce');
  R.wires.loc = connect({
    id: 'loc', from: 'stop 2 · nearest().point.location', to: 'stop 3 · distanceKm(lon1, lat1, lon2, lat2)',
    q: node ? { value: node.location.lon, unit: 'degrees (lon, lat)', meaning: 'mapped node location, GeoJSON order' } : null,
    emptyWhy: R.s2 && R.s2.empty ? R.s2.empty : 'no mapped node was returned at stop 2',
    accepts: { unit: 'degrees (lon, lat)', meanings: ['mapped node location, GeoJSON order'], okWhy: `location.lon and location.lat are passed as lon2, lat2, in the (lon, lat) order distanceKm documents.` }
  });
  if (R.wires.loc.q) R.wires.loc.q.show = `lon ${nf(node.location.lon, 7)}°, lat ${nf(node.location.lat, 7)}°`;
  if (!node) R.s3 = { empty: R.wires.loc.reason };
  else if (!geo9 || !gc || !ce) R.s3 = { empty: !geo9 ? why('geo9') : !gc ? why('gc') : why('ce') };
  else {
    const straight = geo9.distanceKm(S.lon, S.lat, node.location.lon, node.location.lat);
    const atlas = gc.haversine(S.lon, S.lat, node.location.lon, node.location.lat);
    const uk = gc.haversineUK(S.lon, S.lat, node.location.lon, node.location.lat);
    const corridor = ce.forCable(straight);
    R.s3 = { straight, atlas, uk, corridor, ce, gc, geo9, agrees: straight === R.s2.best.km };
  }

  /* STOP 4 · FEEDER PHYSICS */
  const pf = M('pf'), cfp = M('cfp'), vd = M('vd');
  R.wires.load = connect({
    id: 'load', from: 'stop 1 · fleetDemand()', to: 'stop 4 · power-factor apparentPowerKva({ kw })',
    q: R.s1 && R.s1.carried, emptyWhy: R.s1 ? (R.s1.empty || R.s1.carryWhy) : 'stop 1 has not run',
    accepts: { unit: 'kW', meanings: ['after_diversity'], why: 'This wire asks what the load contributes to a network peak: electricity drawn, after diversity. A nameplate sum is the module\'s stress test and a thermal output is heat, not electricity; neither is fed to the feeder, and neither is ever added to the after-diversity figure.', okWhy: 'kW of electricity drawn after diversity becomes the real power kw of the feeder load; the meaning travels with it.' }
  });
  const declared = node ? node.voltages_kv.includes(S.kv) : false;
  R.wires.kv = connect({
    id: 'kv', from: 'stop 2 · nearest().point.voltages_kv', to: 'stop 4 · currentFromMvaAtKv({ kv })',
    q: node && S.kv != null ? { value: S.kv, unit: 'kV', meaning: declared ? 'voltage declared by the node' : 'voltage not declared by the node' } : null,
    emptyWhy: 'no mapped node was returned at stop 2',
    accepts: { unit: 'kV', meanings: ['voltage declared by the node'], why: node ? `The node declares ${node.voltages_kv.join(', ')} kV. No transformer is modelled in this chain, so a feeder at another voltage is not joined to that busbar.` : '', okWhy: 'the feeder is asked at a voltage the node declares.' }
  });
  const corrQ = R.s3 && !R.s3.empty && R.s3.corridor && R.s3.corridor.km != null ? { value: R.s3.corridor.km, unit: 'km', meaning: 'cable corridor estimate' } : null;
  R.wires.len = connect({
    id: 'len', from: 'stop 3 · forCable(km).km', to: 'stop 4 · voltageDropVolts({ lengthM })',
    q: corrQ,
    emptyWhy: R.s3 ? (R.s3.empty || (R.s3.corridor == null ? 'forCable returned null: no finite distance above zero' : `forCable withheld the estimate: "${R.s3.corridor.withheld}"`)) : 'stop 3 has not run',
    accepts: { unit: 'm', meanings: ['cable corridor estimate'], okWhy: '' }
  });
  if (!pf || !cfp || !vd) R.s4 = { empty: !pf ? why('pf') : !cfp ? why('cfp') : why('vd') };
  else {
    const s4 = { pf, cfp, vd };
    const kw = R.wires.load.out;
    s4.S = kw ? attempt(() => pf.apparentPowerKva({ kw: kw.value, powerFactor: S.pf })) : { empty: `the load wire is ${R.wires.load.state}: ${R.wires.load.reason}` };
    s4.Q = kw ? attempt(() => pf.reactivePowerKvar({ kw: kw.value, powerFactor: S.pf })) : { empty: s4.S.empty };
    R.wires.mva = connect({
      id: 'mva', from: 'stop 4 · apparentPowerKva().value', to: 'stop 4 · currentFromMvaAtKv({ mva })',
      q: s4.S.ok ? { value: s4.S.ok.value, unit: s4.S.ok.unit, meaning: 'apparent power' } : null,
      emptyWhy: s4.S.err ? `apparentPowerKva refused: ${s4.S.err}` : s4.S.empty,
      accepts: { unit: 'MVA', meanings: ['apparent power'] }
    });
    const kvIn = R.wires.kv.out;
    s4.I = R.wires.mva.out && kvIn ? attempt(() => cfp.currentFromMvaAtKv({ mva: R.wires.mva.out.value, kv: kvIn.value, phases: S.phases }))
      : { empty: !R.wires.mva.out ? `the apparent-power wire is ${R.wires.mva.state}: ${R.wires.mva.reason}` : `the voltage wire is ${R.wires.kv.state}: ${R.wires.kv.reason}` };
    R.wires.amps = connect({
      id: 'amps', from: 'stop 4 · currentFromMvaAtKv().value', to: 'stop 4 · voltageDropVolts({ currentA }) and lossesWatts({ currentA })',
      q: s4.I.ok ? { value: s4.I.ok.value, unit: s4.I.ok.unit, meaning: 'current implied by a stated power' } : null,
      emptyWhy: s4.I.err ? `currentFromMvaAtKv refused: ${s4.I.err}` : s4.I.empty,
      accepts: { unit: 'A', meanings: ['current implied by a stated power'], okWhy: 'amps into amps. The module states this is not what a circuit carries: ' + cfp.NOT_COMPUTED.actualCurrent }
    });
    const A = R.wires.amps.out, Lm = R.wires.len.out;
    s4.D = A && Lm ? attempt(() => vd.voltageDropVolts({ currentA: A.value, lengthM: Lm.value, resistanceOhmPerKm: S.r, reactanceOhmPerKm: S.x, powerFactor: S.pf, phases: S.phases }))
      : { empty: !A ? `the current wire is ${R.wires.amps.state}: ${R.wires.amps.reason}` : `the length wire is ${R.wires.len.state}: ${R.wires.len.reason}` };
    s4.W = A && Lm ? attempt(() => vd.lossesWatts({ currentA: A.value, lengthM: Lm.value, resistanceOhmPerKm: S.r, phases: S.phases })) : { empty: s4.D.empty };
    R.wires.nom = connect({
      id: 'nom', from: 'stop 4 · the kV that crossed the voltage wire', to: 'stop 4 · dropPercent({ nominalVolts })',
      q: kvIn ? { value: kvIn.value, unit: 'kV', meaning: 'nominal voltage' } : null,
      emptyWhy: `the voltage wire is ${R.wires.kv.state}: ${R.wires.kv.reason}`,
      accepts: { unit: 'V', meanings: ['nominal voltage'] }
    });
    s4.P = s4.D.ok && R.wires.nom.out ? attempt(() => vd.dropPercent({ dropVolts: s4.D.ok.value, nominalVolts: R.wires.nom.out.value }))
      : { empty: !s4.D.ok ? (s4.D.err ? `voltageDropVolts refused: ${s4.D.err}` : s4.D.empty) : `the nominal-voltage wire is ${R.wires.nom.state}: ${R.wires.nom.reason}` };
    R.s4 = s4;
  }

  /* STOP 5 · RATING LABELS */
  const topo = M('topo'), re = M('re'), pre = M('pre');
  if (!topo || !re || pre == null) R.s5 = { empty: !topo ? why('topo') : !re ? why('re') : why('pre') };
  else {
    const fx = attempt(() => fixtureFrom(pre, topo.ACCEPTS));
    if (fx.err) R.s5 = { empty: `the rating fixture could not be read from ${SRC.pre.path}: ${fx.err}` };
    else {
      const IDX = topo.index(fx.ok.product);
      if (!IDX) R.s5 = { empty: 'network-topology index() returned null for the proof fixture' };
      else {
        const byName = node ? re.at(IDX, node.name) : undefined;
        R.wires.name = {
          id: 'name', from: 'stop 2 · nearest().point.name', to: 'stop 5 · rating-envelope at(index, key)',
          q: node ? { value: node.name, unit: 'site key (text)', meaning: 'name of the nearest mapped node' } : null,
          state: !node ? 'EMPTY' : byName ? 'ACCEPTED' : 'REFUSED', direct: '',
          reason: !node ? 'no mapped node was returned at stop 2'
            : byName ? 'at() found a site of that name in the rating fixture.'
              : `at(index, ${JSON.stringify(node.name)}) returned ${String(byName)}. The node comes from the nearest-search proof fixture and the rating-envelope proof fixture has no site of that name or code, so the two are not joined. The labels below belong to a stand-in fixture site chosen by the reader, drawn on its own busbar.`
        };
        const kvW = R.wires.kv.out;
        const opts = kvW ? { voltageKv: kvW.value } : undefined;
        const result = re.at(IDX, S.site, opts);
        R.wires.rkv = {
          id: 'rkv', from: 'stop 4 · the kV that crossed the voltage wire', to: 'stop 5 · at(index, key, { voltageKv })',
          q: kvW ? { value: kvW.value, unit: 'kV', meaning: 'nominal voltage' } : null, direct: '',
          state: kvW ? 'ACCEPTED' : 'EMPTY',
          reason: kvW ? 'kV into voltageKv (kV): the module keeps only the stand-in site\'s nodes at that voltage.' : `the voltage wire is ${R.wires.kv.state}, so at() is called with no voltage and reads every voltage at the site; ${result ? result.scope : ''}`
        };
        const amps = R.wires.amps && R.wires.amps.out;
        R.wires.head = {
          id: 'head', from: 'stop 4 · current (A)', to: 'stop 5 · circuit ratings (MVA)',
          q: amps ? { value: amps.value, unit: 'A', meaning: 'current implied by a stated power' } : null, direct: '',
          state: 'REFUSED',
          reason: `No comparison is made and no headroom is drawn. current-from-power.js: "${cfp ? cfp.NOT_A_HEADROOM : '(not loaded)'}" rating-envelope.js: "${re.NOT_A_CAPACITY}"`
        };
        R.s5 = { re, topo, IDX, fx: fx.ok, result, opts, sites: fx.ok.product.sites.map(s => s.code) };
      }
    }
  }
  return R;
}

/* ── the single-line diagram ──────────────────────────────────────────────── */
function drawSld(R) {
  const n = S.stop, p = [];
  const T = (x, y, t, cls = '', anchor = 'start') => p.push(`<text x="${x}" y="${y}" class="${cls}" text-anchor="${anchor}">${esc(t)}</text>`);
  const L = (x1, y1, x2, y2, stroke, w = 2, dash = '') => p.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ''} stroke-linecap="round"/>`);
  const ghost = (x, y, t, anchor = 'start') => T(x, y, t, 'ph', anchor);
  const FX = 232, BUS = 104, LOADY = 212;
  const node = R.s2 && R.s2.best ? R.s2.best.point : null;
  const w = R.wires;

  /* stop 5: rating labels on a stand-in busbar of their own */
  if (n >= 5 && R.s5 && !R.s5.empty && R.s5.result) {
    const res = R.s5.result, cs = res.circuits;
    L(14, 48, 346, 48, '#ffffff', 4);
    T(14, 60, `${S.site} · ${R.s5.opts ? R.s5.opts.voltageKv + ' kV nodes' : 'every voltage'} · rating proof fixture · stand-in, not joined`, 'd');
    if (!cs.length) T(180, 30, `EMPTY · at() returned 0 circuits${R.s5.opts ? ' at ' + R.s5.opts.voltageKv + ' kV' : ''}`, 'rf', 'middle');
    const step = 332 / Math.max(cs.length, 1);
    cs.forEach((c, i) => {
      const x = 14 + step * (i + 0.5);
      const v = c.ratings_mva[S.season];
      const flagged = c.flags.some(f => f.season === S.season);
      const col = flagged || v == null ? GREY : colourOf(c.voltage_kv);
      L(x, 46, x, 24, col, 2.4, flagged || v == null ? '3 3' : '');
      T(x, 9, `→ ${c.to_node}`, 'w', 'middle');
      T(x, 19, v == null ? `${S.season}: not published` : flagged ? `${S.season} ${v} flagged` : `${S.season} ${v} MVA`, flagged || v == null ? 'd' : 'y', 'middle');
    });
    T(346, 71, 'per circuit · never summed · not a capacity', 'd', 'end');
    const nm = w.name;
    if (nm) { L(40, 76, 40, 98, GREY, 1.5, '3 3'); T(48, 90, nm.state === 'REFUSED' ? 'REFUSED · at(node name) → null · not joined' : nm.state, 'rf'); }
  } else if (n >= 5) {
    T(180, 36, `EMPTY · ${(R.s5 && R.s5.empty) || 'stop 5 has not run'}`.slice(0, 70), 'd', 'middle');
  } else {
    L(14, 48, 346, 48, '#1b2030', 3, '4 4'); ghost(180, 36, 'stop 5 · rating labels at a busbar', 'middle');
  }

  /* stop 2: the nearest mapped node, as a busbar */
  if (n >= 2 && node) {
    L(14, BUS, 346, BUS, '#ffffff', 4);
    T(14, BUS + 13, node.name, 'w b');
    T(14, BUS + 24, `${node.voltages_kv.join(', ')} kV · nearest mapped · fixture`, 'd');
    T(14, BUS + 35, `site lon ${nf(S.lon, 5)}°, lat ${nf(S.lat, 5)}°`, 'd');
  } else if (n >= 2) {
    L(14, BUS, 346, BUS, GREY, 2, '3 3');
    T(14, BUS + 13, `EMPTY · ${(R.s2 && R.s2.empty) || `no mapped node at or above ${S.minKv} kV`}`.slice(0, 64), 'd');
  } else {
    L(14, BUS, 346, BUS, '#1b2030', 3, '4 4'); ghost(14, BUS + 13, 'stop 2 · nearest mapped node (busbar)');
  }

  /* stop 3: the cable route */
  const kvCol = w.kv && w.kv.out ? colourOf(w.kv.out.value) : node ? colourOf(Math.max(...node.voltages_kv)) : GREY;
  if (n >= 3 && R.s3 && !R.s3.empty) {
    const c = R.s3.corridor, ok = c && c.km != null;
    L(FX, BUS + 2, FX, LOADY - 8, '#000', 7);
    L(FX, BUS + 2, FX, LOADY - 8, ok ? kvCol : GREY, 3, ok ? '' : '4 3');
    T(FX + 10, BUS + 16, ok ? `${nf(c.km, 4)} km corridor` : c ? 'corridor WITHHELD' : 'corridor: null', 'y b');
    T(FX + 10, BUS + 27, `forCable ×${R.s3.ce.CABLE_FACTOR}`, 'd');
    T(FX + 10, BUS + 38, `straight ${nf(R.s3.straight, 4)} km`, 'd');
    T(FX + 10, BUS + 49, `R ${R.s3.geo9.EARTH_RADIUS_KM} km sphere`, 'd');
  } else if (n >= 3) {
    L(FX, BUS + 2, FX, LOADY - 8, GREY, 2, '3 3');
    T(FX + 10, BUS + 16, 'route EMPTY', 'd');
  } else {
    L(FX, BUS + 2, FX, LOADY - 8, '#1b2030', 3, '4 4'); ghost(FX + 10, BUS + 30, 'stop 3 · cable route');
  }

  /* stop 4: the physics along it, and the wires that feed it */
  if (n >= 4 && R.s4 && !R.s4.empty) {
    const s = R.s4;
    const val = (r, f) => r.ok ? f(r.ok) : r.err ? 'REFUSED' : 'EMPTY';
    T(FX + 10, BUS + 64, `I ${val(s.I, o => nf(o.value, 4) + ' A')}`, 'y b');
    T(FX + 10, BUS + 75, `ΔV ${val(s.D, o => nf(o.value, 4) + ' V')}`, 'y');
    T(FX + 10, BUS + 86, `   ${val(s.P, o => nf(o.value, 3) + ' %')}`, 'y');
    T(FX + 10, BUS + 97, `loss ${val(s.W, o => nf(o.value, 4) + ' W')}`, 'y');
    const tag = (y, wire, text) => T(FX - 8, y, `${text} · ${wire.state}`, wire.state === 'REFUSED' || wire.state === 'EMPTY' ? 'rf' : 'd', 'end');
    tag(BUS + 50, w.kv, `${w.kv.q ? w.kv.q.value + ' kV' : 'kV'} → kv`);
    tag(BUS + 64, w.len, 'km → lengthM');
    tag(BUS + 78, w.mva, 'kVA → mva');
    tag(LOADY - 14, w.load, `${S.carry} → kw`);
  } else if (n >= 4) {
    T(FX + 10, BUS + 64, 'physics EMPTY', 'd');
  } else {
    ghost(FX + 10, BUS + 70, 'stop 4 · I, ΔV, losses');
  }

  /* stop 1: the load */
  const s1 = R.s1 && !R.s1.empty ? R.s1 : null;
  const loadRefused = n >= 4 && w.load && w.load.state !== 'ACCEPTED';
  if (s1) {
    if (loadRefused) { L(FX, LOADY - 8, FX, LOADY - 1, '#0b0d12', 4); }
    p.push(`<path d="M${FX - 8} ${LOADY} L${FX + 8} ${LOADY} L${FX} ${LOADY + 13} Z" fill="${loadRefused ? 'none' : '#ffffff'}" stroke="#ffffff" stroke-width="1.4"${loadRefused ? ' stroke-dasharray="2 2"' : ''}/>`);
    const d = s1.fleet.ok && s1.fleet.ok.diversified;
    T(FX + 14, LOADY + 7, d ? `${nf(d.value, 4)} ${d.unit}` : 'REFUSED', 'y b');
    T(FX + 14, LOADY + 18, d ? d.meaning : 'fleetDemand refused', 'd');
    T(FX - 12, LOADY + 29, `${nf(S.units)} units · scenario input`, 'd', 'end');
    if (n >= 4 && loadRefused) T(FX - 12, LOADY + 7, `load wire ${w.load.state}`, 'rf', 'end');
  } else {
    p.push(`<path d="M${FX - 8} ${LOADY} L${FX + 8} ${LOADY} L${FX} ${LOADY + 13} Z" fill="none" stroke="#3a4258" stroke-dasharray="2 2"/>`);
    T(FX + 14, LOADY + 7, R.s1 && R.s1.empty ? 'load EMPTY' : 'stop 1 · load', R.s1 && R.s1.empty ? 'd' : 'ph');
  }
  T(180, 258, 'illustration, not a connection study', 'd', 'middle');
  $('sld').innerHTML = p.join('');
}

/* ── the stop cards: skeleton built once per stop, results re-filled ─────── */
const STOPS = [null,
  { title: 'DEMAND', lead: 'A scenario load, computed by the electrification model with its meaning kept: electricity drawn after diversity. The model refuses to read one meaning as another, and never adds two meanings together.' },
  { title: 'SITE POINT · NEAREST MAPPED NODE', lead: 'A site point and the proof\'s own fixture nodes. The nearest-search module scans every node and returns the nearest one at or above a voltage floor. Fixture nodes only: no real grid data is read.' },
  { title: 'ROUTE LENGTH', lead: 'The straight-line distance from the site to that node on the engine\'s sphere, and the cable corridor estimate the corridor module makes from it.' },
  { title: 'FEEDER PHYSICS', lead: 'The load from stop 1, carried over the route length from stop 3, at a voltage the node from stop 2 declares: apparent power, current, voltage drop and losses, each from its own module.' },
  { title: 'RATING LABELS', lead: 'Per-circuit rating labels at a busbar, from the rating-envelope module and its proof fixture. Each circuit keeps its own label. The module has no code that sums them, and a rating is not spare capacity.' }
];

const QUESTIONS = [null,
  [
    'It draws the <b>load</b> at the far end of the feeder. <code>fleetDemand({ units, perUnitNameplate, perUnitAfterDiversity }).diversified</code> supplies it: <code>value</code> in kW, <code>meaning</code> "after_diversity", <code>label</code>. That object crosses the wire to stop 4 as <code>kw</code>. <code>simultaneous</code> (nameplate, a stress test) is shown but not drawn on the feeder.',
    `Module <code>engine/electrification-model.js</code>, ventus-grid-engine commit ${PIN}; functions <code>quantity</code>, <code>electricalInputFromHeat</code>, <code>fleetDemand</code> and <code>combinedPeak</code> are called here. Callers at that commit, read from import lines: <code>proofs/electrification-model.proof.mjs</code> only; it is not in <code>package.json</code> exports. In this galaxy <code>iterations/24-electrification-model</code> imports it (URL path search, name-match inference).`,
    'To the feeder: <code>power-factor.js apparentPowerKva({ kw, powerFactor })</code> at stop 4, through a wire that accepts only kW with meaning "after_diversity". Whether a network can carry it is not established: the module\'s own <code>NOT_COMPUTED.networkCapacity</code> says so.'
  ],
  [
    'It draws the <b>busbar at the network end</b>: the nearest mapped node. <code>index(points).nearest(lon, lat, { minimumKv })</code> returns <code>{ point, km }</code>; <code>point.name</code> labels the busbar, <code>point.voltages_kv</code> gives the voltages it declares (the voltage wire to stop 4), <code>point.location</code> is the far end of the route (the wire to stop 3).',
    `Module <code>engine/v9-nearest-search.js</code> at ${PIN}, exports <code>normalise</code>, <code>index</code>, <code>schema</code>; it imports <code>distanceKm</code> from <code>engine/v9-geodesy.js</code> (line 35). Callers at that commit, from import lines: <code>proofs/v9-engine.proof.mjs</code> (the fixture used here) and <code>proofs/compute-observer.proof.mjs</code>. Its own header records that the live Atlas runs an inline exhaustive duplicate instead. In this galaxy <code>iterations/28-nearest-search-trap</code> imports it.`,
    'To the <b>cable route</b> from the site to <code>point.location</code> (stop 3). A rating for that node is not established: the rating proof fixture has no site of that name, which stop 5 shows as a refused wire.'
  ],
  [
    'It draws the <b>cable route</b> length. <code>distanceKm(lon1, lat1, lon2, lat2)</code> gives the straight line on a sphere of <code>EARTH_RADIUS_KM</code>; <code>forCable(km)</code> returns <code>{ km, factor, straight_km, withheld }</code>, and <code>km</code> is the corridor length that crosses to stop 4. It draws no geometry of the route: a corridor estimate is a length, not a path.',
    `Modules at ${PIN}: <code>engine/v9-geodesy.js</code> <code>distanceKm</code> (imported by <code>v9-nearest-search.js</code> line 35 and <code>compute-observer.js</code> line 2); <code>engine/geo-core.js</code> <code>haversine</code>, <code>haversineUK</code> (imported by <code>geo-area.js</code> line 30); <code>engine/corridor-estimate.js</code> <code>forCable</code> (imported by <code>proofs/corridor-estimate.proof.mjs</code> and <code>proofs/route-obstacles.proof.mjs</code>). In the estate, globalgrid2050 <code>grid_engine/202609060237-corridor-estimate/index.html</code> loads corridor-estimate.js (path-match inference). In this galaxy <code>iterations/27-earth-radii-and-argument-order</code> imports all three.`,
    'To the feeder: <code>voltage-drop.js voltageDropVolts({ lengthM })</code> and <code>lossesWatts({ lengthM })</code> at stop 4, which take metres. The km does not cross directly; see the wire below.'
  ],
  [
    'It draws the <b>feeder annotations</b>: current on the line (<code>currentFromMvaAtKv().value</code>, A), voltage drop (<code>voltageDropVolts().value</code>, V, with <code>resistiveVolts</code> and <code>reactiveVolts</code>), drop as a percentage of nominal (<code>dropPercent().value</code>) and losses (<code>lossesWatts().value</code>, W). It draws no protection and no earthing: <code>voltage-drop.js NOT_COMPUTED.faultWithstand</code> is shown below.',
    `Modules at ${PIN}: <code>engine/power-factor.js</code> (<code>apparentPowerKva</code>, <code>reactivePowerKvar</code>), <code>engine/current-from-power.js</code> (<code>currentFromMvaAtKv</code>), <code>engine/voltage-drop.js</code> (<code>voltageDropVolts</code>, <code>dropPercent</code>, <code>lossesWatts</code>). Callers at that commit, from import lines: their proofs; <code>proofs/current-from-power.proof.mjs</code> also imports <code>PHASE_FACTOR</code> from voltage-drop.js. In the estate, globalgrid2050 <code>grid_engine/202609060309-power-factor</code>, <code>202609060313-voltage-drop</code> and <code>202609060318-solar-farm</code> load power-factor.js or voltage-drop.js (path-match inference). In this galaxy <code>iterations/25-one-feeder</code> imports all three.`,
    'To the <b>rating labels</b> at a busbar (stop 5). current-from-power.js lines 131 to 133 say <code>currentFromMvaAtKv</code> is "the call a rating-envelope result feeds"; no code at this commit wires the two, and this page draws no comparison between a current and a rating.'
  ],
  [
    'It draws the <b>per-circuit rating labels</b> on circuits leaving a busbar. <code>at(index, key, { voltageKv })</code> supplies <code>circuits[].ratings_mva</code> (MVA per season), <code>circuits[].flags</code> (placeholders) and <code>circuits[].seasons_not_published</code>. No busbar total is drawn, because the module has none: <code>NEVER_SUMMED</code>.',
    `Module <code>engine/rating-envelope.js</code> at ${PIN}, function <code>at</code>; it requires a <code>engine/network-topology.js</code> <code>index(product).graph()</code>. Callers at that commit, from import lines: <code>proofs/rating-envelope.proof.mjs</code> (the fixture used here). iterations/29-rating-envelope records, from gridatlas source, a caller in the SLD sandbox cartridge <code>atlas/cartridges/202609012345-sld-sandbox-v9-8.js</code>; that citation is carried, not re-read here.`,
    'Not established. The next elements a single-line diagram needs here, a transformer between two busbar voltages and the protection on each circuit, are not in any module used on this page. The fixture\'s transformer record is not read by <code>at()</code>, which reads circuits only.'
  ]
];

let built = 0;
function renderStop() {
  const n = S.stop, card = $('card');
  card.textContent = '';
  card.dataset.stop = n;
  const st = STOPS[n];
  card.append(el('div', 'tag', `STOP ${n} OF 5`), el('h2', null, st.title), el('p', 'dim small', st.lead));
  const inputs = el('div', 'inputs'); card.append(inputs);
  buildInputs(n, inputs);
  const bd = el('p', 'boundary', BOUNDARY);
  if (n === 2 || n === 3) bd.textContent = 'A distance is a distance: this reports the nearest mapped node to a point and how far away it is, never whether anything can be joined to it. ' + BOUNDARY;
  card.append(el('h3', null, 'Results, as the modules return them'), bd);
  const res = el('ol', 'results'); res.id = 'res'; card.append(res);
  card.append(el('h3', null, 'Wires into and out of this stop'));
  const wires = el('ol', 'wires'); wires.id = 'wires'; card.append(wires);
  const extra = el('div'); extra.id = 'extra'; card.append(extra);
  const det = el('details', 'questions'); det.id = 'questions';
  det.append(el('summary', null, 'Questions'));
  const dl = el('dl');
  const qs = ['1. How does this help draw a system or a single-line diagram?', '2. What is this code used for?', '3. Where does it lead next?'];
  QUESTIONS[n].forEach((a, i) => { const dd = el('dd'); dd.innerHTML = a; dl.append(el('dt', null, qs[i]), dd); });
  det.append(dl);
  try { if (matchMedia('(min-width: 900px)').matches) det.open = true; } catch (_) { /* stays collapsed */ }
  card.append(det);
  const mach = el('p', 'machine'); mach.id = 'machine'; card.append(mach);
  if (n === 5) card.append(el('p', 'final', FINAL));
  built = n;

  /* dots and nav */
  const dots = $('dots');
  if (!dots.childElementCount) for (let i = 1; i <= 5; i++) {
    const b = el('button', null, String(i)); b.type = 'button'; b.dataset.stop = i;
    b.setAttribute('aria-label', `stop ${i} · ${STOPS[i].title}`);
    b.addEventListener('click', () => go(i));
    dots.append(b);
  }
  for (const b of dots.children) {
    if (+b.dataset.stop === n) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
  }
  $('prev').disabled = n === 1; $('next').disabled = n === 5;
  $('where').textContent = `${n} / 5 · ${st.title.split(' ·')[0].toLowerCase()}`;
  for (let i = 1; i <= n; i++) for (const id of STOP_SRC[i]) hydrate(id);
  update();
}

function slider(box, { key, label, unit, min, max, step, log, fmt, note }) {
  const d = el('div', 'in');
  const r1 = el('div', 'row'); const lab = el('label', null, label); lab.htmlFor = 'in-' + key;
  r1.append(lab, el('span', 'tag', 'SCENARIO INPUT'));
  const r2 = el('div', 'row'); const out = el('output'); r2.append(el('span', 'dim small', note || ''), out);
  const inp = document.createElement('input'); inp.type = 'range'; inp.id = 'in-' + key;
  const toV = t => log ? Number((min * Math.pow(max / min, t / 1000)).toPrecision(2)) : t;
  const toT = v => log ? Math.round(1000 * Math.log(v / min) / Math.log(max / min)) : v;
  if (log) { inp.min = 0; inp.max = 1000; inp.step = 1; } else { inp.min = min; inp.max = max; inp.step = step; }
  inp.value = toT(S[key]);
  const show = () => { out.textContent = (fmt ? fmt(S[key]) : nf(S[key])) + (unit ? ' ' + unit : ''); };
  inp.addEventListener('input', () => { S[key] = log ? Math.round(toV(+inp.value)) : +inp.value; show(); update(); });
  show(); d.append(r1, r2, inp); box.append(d);
}
function seg(box, label, key, opts, after) {
  const d = el('div', 'in'); const r = el('div', 'row'); r.append(el('span', null, label), el('span', 'tag', 'SCENARIO INPUT'));
  const s = el('div', 'seg'); s.dataset.key = key;
  const paint = () => { for (const b of s.children) b.setAttribute('aria-pressed', String(String(S[key]) === b.dataset.v)); };
  for (const o of opts) {
    const b = el('button', null, o.label); b.type = 'button'; b.dataset.v = String(o.v);
    b.addEventListener('click', () => { S[key] = o.v; if (after) after(o); paint(); update(); });
    s.append(b);
  }
  paint(); d.append(r, s); box.append(d);
  return { paint, s };
}

let plane = null;
function buildInputs(n, box) {
  if (n === 1) {
    slider(box, { key: 'heat', label: 'heat delivered per home', unit: 'kW thermal', min: 1, max: 20, step: 0.25, note: 'meaning thermal_output' });
    slider(box, { key: 'scop', label: 'SCOP', unit: '', min: 0.5, max: 6, step: 0.05, note: 'the module carries none; 1 or less is refused' });
    slider(box, { key: 'div', label: 'after-diversity demand per home', unit: 'kW', min: 0.1, max: 8, step: 0.1, note: 'measured, never chosen by the module' });
    slider(box, { key: 'units', label: 'homes with a heat pump', unit: 'units', min: 1, max: 100000, log: true, note: 'log scale' });
    seg(box, 'which quantity is put on the wire to the feeder', 'carry', [
      { v: 'after_diversity', label: 'after diversity' }, { v: 'nameplate', label: 'nameplate' }, { v: 'thermal_output', label: 'thermal output' }]);
    const b = el('button', 'act', 'try to add the nameplate total to the after-diversity total'); b.type = 'button'; b.id = 'tryAdd';
    b.addEventListener('click', () => { S.tryAdd = true; update(); });
    box.append(b);
  } else if (n === 2) {
    const cv = el('canvas', 'plane'); cv.id = 'plane';
    cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Plane with the proof\'s fixture nodes and the site point; tap to move the site');
    box.append(cv, el('p', 'dim small', 'Tap or drag on the plane to move the site point. Drawn in a flat local projection for display only; no distance is read off the drawing.'));
    const reset = el('button', 'act', 'site back to the proof\'s query point'); reset.type = 'button'; reset.id = 'resetSite';
    reset.addEventListener('click', () => { S.lon = QUERY[0]; S.lat = QUERY[1]; S.kvFollow = true; update(); });
    box.append(reset);
    seg(box, 'minimumKv passed to nearest()', 'minKv', [{ v: 100, label: '100 kV (the proof\'s)' }, { v: 0, label: '0 kV' }], () => { S.kvFollow = true; });
    plane = setupPlane(cv);
  } else if (n === 3) {
    box.append(el('p', 'dim small', 'No input of its own: the two ends are the site and the node from stop 2.'));
  } else if (n === 4) {
    const kvs = () => {
      const node = lastR && lastR.s2 && lastR.s2.best ? lastR.s2.best.point : null;
      return [...new Set([...(node ? node.voltages_kv : []), ...ATLAS.map(a => a.kv)])].sort((a, b) => b - a);
    };
    const kvBox = el('div'); kvBox.id = 'kvBox'; box.append(kvBox);
    kvBox.rebuild = () => {
      const list = kvs().join(',');
      if (kvBox.dataset.list === list) { kvBox.seg && kvBox.seg.paint(); return; }
      kvBox.dataset.list = list; kvBox.textContent = '';
      kvBox.seg = seg(kvBox, 'nominal voltage of the feeder (the node\'s declared voltages and the levels the Grid Atlas draws)', 'kv', kvs().map(kv => ({ v: kv, label: kv + ' kV' })), () => { S.kvFollow = false; });
    };
    slider(box, { key: 'pf', label: 'power factor', unit: '', min: 0.5, max: 1, step: 0.01, fmt: v => v.toFixed(2) });
    slider(box, { key: 'r', label: 'conductor resistance', unit: 'ohm/km', min: 0.01, max: 1, step: 0.01, note: 'the module carries no R or X' });
    slider(box, { key: 'x', label: 'conductor reactance', unit: 'ohm/km', min: 0, max: 0.5, step: 0.01 });
    seg(box, 'phases', 'phases', [{ v: 'three', label: 'three' }, { v: 'single', label: 'single' }]);
    seg(box, 'stated unit conversions on the wires (km→m, kVA→MVA, kV→V)', 'convert', [{ v: true, label: 'on' }, { v: false, label: 'off: see the refusals' }]);
  } else if (n === 5) {
    const siteBox = el('div'); siteBox.id = 'siteBox'; box.append(siteBox);
    const seasonBox = el('div'); seasonBox.id = 'seasonBox'; box.append(seasonBox);
  }
}

/* ── stop 2 plane ─────────────────────────────────────────────────────────── */
const GRID = { lonMin: -0.2, lonMax: 0.2, latMin: 54.9, latMax: 55.1 };
function setupPlane(cv) {
  const P = { cv, W: 0, H: 0, dpr: 1, scale: 1, cx: 0, cy: 0 };
  const kmPerDeg = () => (M('geo9') ? M('geo9').EARTH_RADIUS_KM : NaN) * Math.PI / 180;
  const cos0 = Math.cos(QUERY[1] * Math.PI / 180);
  P.px = (lon, lat) => [P.cx + (lon - QUERY[0]) * kmPerDeg() * cos0 * P.scale, P.cy - (lat - QUERY[1]) * kmPerDeg() * P.scale];
  P.unpx = (x, y) => [QUERY[0] + (x - P.cx) / (kmPerDeg() * cos0 * P.scale), QUERY[1] - (y - P.cy) / (kmPerDeg() * P.scale)];
  P.fit = () => {
    const r = cv.getBoundingClientRect(); P.dpr = Math.min(devicePixelRatio || 1, 3); P.W = r.width; P.H = r.height;
    cv.width = Math.round(P.W * P.dpr); cv.height = Math.round(P.H * P.dpr);
    const hw = (GRID.lonMax - GRID.lonMin) / 2 * kmPerDeg() * cos0 + 0.6, hh = (GRID.latMax - GRID.latMin) / 2 * kmPerDeg() + 0.6;
    P.scale = Math.min(P.W / (2 * hw), P.H / (2 * hh)); P.cx = P.W / 2; P.cy = P.H / 2;
  };
  let drag = false, raf = 0, pend = null;
  const move = e => {
    if (!M('geo9')) return;
    const r = cv.getBoundingClientRect();
    const [lon, lat] = P.unpx(e.clientX - r.left, e.clientY - r.top);
    pend = [Math.min(GRID.lonMax, Math.max(GRID.lonMin, +lon.toFixed(5))), Math.min(GRID.latMax, Math.max(GRID.latMin, +lat.toFixed(5)))];
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; [S.lon, S.lat] = pend; S.kvFollow = true; update(); });
  };
  cv.addEventListener('pointerdown', e => { drag = true; try { cv.setPointerCapture(e.pointerId); } catch (_) { /* optional */ } move(e); e.preventDefault(); });
  cv.addEventListener('pointermove', e => { if (drag) { move(e); e.preventDefault(); } });
  cv.addEventListener('pointerup', () => { drag = false; });
  cv.addEventListener('pointercancel', () => { drag = false; });
  return P;
}
function drawPlane(R) {
  const P = plane; if (!P || !P.cv.isConnected) return;
  const g = P.cv.getContext('2d');
  if (!M('geo9')) { const r = P.cv.getBoundingClientRect(); P.cv.width = Math.round(r.width); P.cv.height = Math.round(r.height); g.fillStyle = '#8b93a7'; g.font = '12px ui-monospace,monospace'; g.fillText('WAIT — engine/v9-geodesy.js', 12, 24); return; }
  P.fit(); g.setTransform(P.dpr, 0, 0, P.dpr, 0, 0); g.clearRect(0, 0, P.W, P.H);
  const lab = (t, x, y, c, a = 'left') => { g.font = '11px ui-monospace,Menlo,Consolas,monospace'; g.textAlign = a; g.textBaseline = 'middle'; g.lineWidth = 3; g.strokeStyle = '#05060a'; g.strokeText(t, x, y); g.fillStyle = c; g.fillText(t, x, y); };
  const clip = (x, y) => { const m = 14; const cx = Math.max(m, Math.min(P.W - m, x)), cy = Math.max(m, Math.min(P.H - m, y)); return [cx, cy, cx !== x || cy !== y]; };
  g.strokeStyle = '#161b28'; g.lineWidth = 1;
  for (let k = -10; k <= 10; k++) { const [x] = P.px(k * 0.02, 55); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, P.H); g.stroke(); const [, y] = P.px(0, 55 + k * 0.02); g.beginPath(); g.moveTo(0, y); g.lineTo(P.W, y); g.stroke(); }
  lab('graticule 0.02° · display projection', P.W - 8, P.H - 10, '#5c6580', 'right');
  const [sx, sy] = P.px(S.lon, S.lat);
  const best = R.s2 && R.s2.best;
  if (best) { const [x, y] = clip(...P.px(best.point.location.lon, best.point.location.lat)); g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(sx, sy); g.lineTo(x, y); g.stroke(); }
  for (const nd of NODES) {
    const [x, y, off] = clip(...P.px(nd.location.lon, nd.location.lat));
    const below = Math.max(...nd.voltages_kv) < S.minKv;
    g.beginPath(); g.arc(x, y, below ? 3.5 : 5, 0, 7);
    if (below) { g.strokeStyle = GREY; g.lineWidth = 1.5; g.stroke(); } else { g.fillStyle = '#fff'; g.fill(); }
    const hit = R.s2 && R.s2.list ? R.s2.list.find(h => h.point === nd) : null;
    const t = `${nd.name.replace(' Grid Substation', '').replace(' Substation', '')}${hit ? ' ' + nf(hit.km, 4) + ' km' : below ? ' · below floor' : ''}${off ? ' (off plane)' : ''}`;
    g.font = '11px ui-monospace,Menlo,Consolas,monospace';
    const tw = g.measureText(t).width;
    const ly = nd === LOW_VOLTAGE ? y - 16 : nd === TRUE_EAST ? y + 16 : y + (y < P.H / 2 ? 16 : -14);
    lab(t, Math.max(6, Math.min(P.W - 6 - tw, x - tw / 2)), Math.max(10, Math.min(P.H - 26, ly)), below ? GREY : '#fff');
  }
  g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath();
  g.moveTo(sx - 14, sy); g.lineTo(sx - 6, sy); g.moveTo(sx + 6, sy); g.lineTo(sx + 14, sy); g.moveTo(sx, sy - 14); g.lineTo(sx, sy - 6); g.moveTo(sx, sy + 6); g.lineTo(sx, sy + 14); g.stroke();
  lab('site', sx - 10, sy + 20, '#fff', 'right');
}

/* ── re-fill the open card ────────────────────────────────────────────────── */
function fillList(ol, items) {
  /* one li per result row; rows are reused, only their text changes */
  while (ol.children.length > items.length) ol.lastChild.remove();
  items.forEach((it, i) => {
    let li = ol.children[i];
    if (!li) { li = el('li'); li.append(el('div', 'k'), el('div', 'fn'), el('div', 'basis')); li.firstChild.append(el('span'), el('span', 'v')); ol.append(li); }
    const [lab, v] = li.firstChild.children;
    if (lab.textContent !== it[0]) lab.textContent = it[0];
    if (v.textContent !== it[1]) v.textContent = it[1];
    if (li.children[1].textContent !== (it[2] || '')) li.children[1].textContent = it[2] || '';
    if (li.children[2].textContent !== (it[3] || '')) li.children[2].textContent = it[3] || '';
    li.classList.toggle('empty', !!it[4]);
  });
}
const rowOf = (label, r, fmt, fn, basisOf) => r.ok ? [label, fmt(r.ok), fn, basisOf ? basisOf(r.ok) : r.ok.basis || '']
  : r.err ? [label, 'REFUSED', fn, `the module refused: ${r.err}`, true] : [label, 'EMPTY', fn, r.empty || '', true];
function fillWires(ol, list) {
  ol.textContent = '';
  for (const w of list) {
    if (!w) continue;
    const li = el('li', 'wire ' + w.state.toLowerCase()); li.dataset.wire = w.id; li.dataset.state = w.state;
    li.append(el('div', 'ends', `${w.from}  →  ${w.to}`));
    if (w.q) li.append(el('div', 'q', `carries: ${w.q.show || (typeof w.q.value === 'number' ? nf(w.q.value, 6) : w.q.value)} ${w.q.show ? '' : w.q.unit} · meaning "${w.q.meaning}"`.replace(/\s+·/, ' ·')));
    if (w.accepts) li.append(el('div', 'q dim', `input takes: ${w.accepts.unit}${w.accepts.meanings ? ' · meaning ' + w.accepts.meanings.map(m => `"${m}"`).join(' or ') : ''}`));
    if (w.direct) li.append(el('div', 'why', w.direct));
    const st = el('div', 'why'); st.append(el('span', 'st', w.state), ' ', w.reason); li.append(st);
    ol.append(li);
  }
}

let lastR = null;
let upd = 0;
function update() {
  if (upd) return;
  upd = requestAnimationFrame(() => { upd = 0; paint(); });
}
function paint() {
  const R = chain(); lastR = R;
  drawSld(R);
  const n = S.stop;
  if (built !== n) return;
  const res = $('res'), wires = $('wires'), extra = $('extra'), mach = $('machine');
  const w = R.wires;
  if (n === 1) {
    const s = R.s1;
    if (s.empty) { fillList(res, [['electrification-model', 'EMPTY', '', s.empty, true]]); fillWires(wires, []); }
    else {
      fillList(res, [
        rowOf('thermal output per home', s.thermal, o => `${nf(o.value)} ${o.unit}`, "quantity(heat, 'kW', MEANING.THERMAL_OUTPUT)", o => `meaning ${o.meaning} · scenario input`),
        rowOf('electrical input per home', s.elec, o => `${nf(o.value, 5)} ${o.unit}`, 'electricalInputFromHeat({ thermal, scop })'),
        rowOf('fleet, flat out (nameplate)', s.fleet, o => `${nf(o.simultaneous.value, 5)} ${o.simultaneous.unit}`, 'fleetDemand(...).simultaneous', o => `meaning ${o.simultaneous.meaning} · label: ${o.simultaneous.label}`),
        rowOf('fleet, after diversity', s.fleet, o => o.diversified ? `${nf(o.diversified.value, 5)} ${o.diversified.unit}` : 'EMPTY', 'fleetDemand(...).diversified', o => `meaning ${o.diversified.meaning} · label: ${o.diversified.label} · ${o.basis}`),
        rowOf('never added', s.fleet, o => 'NEVER_ADDED', 'fleetDemand(...).never_added', o => o.never_added),
        ...(S.tryAdd ? [rowOf('nameplate total + after-diversity total', s.added, o => `${nf(o.value)} ${o.unit}`, 'combinedPeak({ fleets: [nameplate-only fleet, fleet] })')] : []),
        ...(S.carry === 'thermal_output' ? [rowOf('thermal output handed to fleetDemand as a nameplate', s.thermalFleet, o => `${nf(o.simultaneous.value)} kW`, 'fleetDemand({ units, perUnitNameplate: thermal })')] : []),
        ['not a forecast', 'NOT_A_FORECAST', 'electrification-model.js', s.em.NOT_A_FORECAST]
      ]);
      fillWires(wires, [w.load]);
      const lw = wires.querySelector('[data-wire=load]');
      if (lw && S.stop < 4) lw.append(el('div', 'why dim', 'The receiving calculation runs at stop 4; the check above is made now, from what stop 1 returns.'));
    }
    mach.textContent = `Machine detail · inputs: heat ${S.heat} kW (meaning thermal_output, scenario input), scop ${S.scop} (dimensionless, scenario input), perUnitAfterDiversity ${S.div} kW (meaning after_diversity, scenario input), units ${S.units} (count, scenario input) · outputs: electricalInputFromHeat → value kW, meaning electrical_input; fleetDemand → simultaneous {value kW, meaning nameplate, label}, diversified {value kW, meaning after_diversity, label, ratio}, never_added, not_computed, not_a_forecast; combinedPeak → value kW, meaning after_diversity, assumes · refusals: quantity refuses a value ≤ 0; electricalInputFromHeat refuses any meaning but thermal_output and scop ≤ 1; fleetDemand refuses a nameplate whose meaning is not nameplate or electrical_input, a unit mismatch, and after-diversity above nameplate; combinedPeak refuses any fleet without an after-diversity figure · source: ventus-grid-engine ${SRC.em.path} at ${COMMIT}.`;
  }
  if (n === 2) {
    const s = R.s2;
    if (s.empty) fillList(res, [['nearest mapped node', 'EMPTY', '', s.empty, true]]);
    else {
      const items = [[`fixture verified`, `lines ${s.chk.first}–${s.chk.last}`, SRC.pv9.path, `${V9_LINES.length} declaration lines of the proof's trap fixture found verbatim in the served proof. Fixture nodes, fictional, not real grid data.`]];
      items.push(['site point', `${nf(S.lon, 6)}°, ${nf(S.lat, 6)}°`, 'lon, lat (scenario input)', S.lon === QUERY[0] && S.lat === QUERY[1] ? 'the proof\'s own query point' : 'moved from the proof\'s query point']);
      items.push(s.best ? ['nearest mapped node', s.best.point.name, `index(nodes).nearest(${nf(S.lon, 6)}, ${nf(S.lat, 6)}, { minimumKv: ${S.minKv} })`, `${nf(s.best.km, 6)} km on a sphere of ${s.radius} km · declares ${s.best.point.voltages_kv.join(', ')} kV`]
        : ['nearest mapped node', 'EMPTY', `nearest(..., { minimumKv: ${S.minKv} })`, `the module returned null: no located node declares a voltage at or above ${S.minKv} kV`, true]);
      for (const nd of NODES) {
        const hit = s.list.find(h => h.point === nd);
        items.push([`  ${nd.name}`, hit ? `${nf(hit.km, 6)} km` : 'skipped', hit ? `rank ${s.list.indexOf(hit) + 1} of ${s.list.length}` : 'nearest() skips it', hit ? (hit === s.list[0] ? 'why chosen: the smallest km of every node the module scanned' : `why not chosen: ${nf(hit.km - s.list[0].km, 4)} km farther than the chosen node`) : `why not chosen: its highest declared voltage, ${Math.max(...nd.voltages_kv)} kV, is below minimumKv ${S.minKv}`, !hit]);
      }
      fillList(res, items);
    }
    fillWires(wires, [w.loc, w.kv, w.name]);
    mach.textContent = `Machine detail · inputs: points [{ name, voltages_kv [kV], location { lon °, lat ° } }] (the proof's fixture), lon ${S.lon}° and lat ${S.lat}° (decimal degrees, scenario input), minimumKv ${S.minKv} kV (floor on the highest declared voltage), limit (count) · outputs: { point, km } or null for limit 1, else an array sorted by km; km is haversine on EARTH_RADIUS_KM ${R.s2 && R.s2.radius || '(not loaded)'} km; point.voltages_kv in kV; point.location in degrees · refusals: none thrown; no eligible node returns null; a node with no voltages or below the floor is skipped; a point with no location is never searched · source: ventus-grid-engine ${SRC.ns.path} and ${SRC.geo9.path} at ${COMMIT}.`;
    drawPlane(R);
  }
  if (n === 3) {
    const s = R.s3;
    if (s.empty) fillList(res, [['route length', 'EMPTY', '', s.empty, true]]);
    else {
      const c = s.corridor;
      fillList(res, [
        ['straight line, site to node', `${nf(s.straight, 8)} km`, `v9-geodesy distanceKm(${nf(S.lon, 6)}, ${nf(S.lat, 6)}, ${nf(R.s2.best.point.location.lon, 7)}, ${nf(R.s2.best.point.location.lat, 7)})`, `radius used: EARTH_RADIUS_KM = ${s.geo9.EARTH_RADIUS_KM} km (v9-geodesy.js), a sphere. ${s.agrees ? 'Identical to the km nearest() returned at stop 2.' : `Differs from the km nearest() returned at stop 2 (${nf(R.s2.best.km, 8)}).`}`],
        ['same line, geo-core default', `${nf(s.atlas, 8)} km`, 'geo-core haversine(lon1, lat1, lon2, lat2)', `radius R_ATLAS = ${s.gc.R_ATLAS} km; difference from distanceKm ${nf(s.atlas - s.straight, 3)} km`],
        ['same line, UK radius', `${nf(s.uk, 8)} km`, 'geo-core haversineUK(...)', `radius R_UK = ${s.gc.R_UK} km; ${nf((s.uk - s.straight) * 1000, 4)} m longer. Not used on the wire: the chain stays on the radius nearest() used.`],
        c == null ? ['cable corridor estimate', 'EMPTY', 'corridor-estimate forCable(km)', 'forCable returned null: no finite distance above zero', true]
          : c.km == null ? ['cable corridor estimate', 'WITHHELD', `forCable(${nf(c.straight_km, 6)})`, `the module withheld it: ${c.withheld}`, true]
            : ['cable corridor estimate', `${nf(c.km, 8)} km`, `forCable(${nf(c.straight_km, 8)})`, `factor ${c.factor} (CABLE_FACTOR). ${s.ce.CAVEAT}`],
        ['not for overhead line', 'NOT_FOR_OVERHEAD', 'corridor-estimate.js', s.ce.NOT_FOR_OVERHEAD],
        ['not an assessment', 'not_an_assessment', 'corridor-estimate.js', s.ce.not_an_assessment]
      ]);
    }
    fillWires(wires, [w.loc, w.len]);
    mach.textContent = `Machine detail · inputs: lon1, lat1 (site, degrees, scenario input), lon2, lat2 (node location from stop 2, degrees), in (lon, lat) order; forCable takes km (straight line) · outputs: distanceKm, haversine, haversineUK → km on a sphere of 6378.137, ${R.s3 && R.s3.gc ? R.s3.gc.R_ATLAS : 'R_ATLAS'} and ${R.s3 && R.s3.gc ? R.s3.gc.R_UK : 'R_UK'} km respectively; forCable → { km (corridor estimate), factor (dimensionless), straight_km (km), withheld (text or null) } · refusals: the geodesy functions refuse nothing (a swapped argument order returns a plausible number); forCable returns null for a non-finite or non-positive km and withholds below MINIMUM_KM ${R.s3 && R.s3.ce ? R.s3.ce.MINIMUM_KM : ''} km · source: ventus-grid-engine ${SRC.geo9.path}, ${SRC.gc.path}, ${SRC.ce.path} at ${COMMIT}.`;
  }
  if (n === 4) {
    const kvBox = $('kvBox'); if (kvBox && kvBox.rebuild) kvBox.rebuild();
    const s = R.s4;
    if (s.empty) fillList(res, [['feeder physics', 'EMPTY', '', s.empty, true]]);
    else {
      fillList(res, [
        rowOf('apparent power S', s.S, o => `${nf(o.value, 5)} ${o.unit}`, 'power-factor apparentPowerKva({ kw, powerFactor })'),
        rowOf('reactive power Q', s.Q, o => `${nf(o.value, 5)} ${o.unit}`, 'power-factor reactivePowerKvar({ kw, powerFactor })'),
        rowOf('current', s.I, o => `${nf(o.value, 5)} ${o.unit}`, 'current-from-power currentFromMvaAtKv({ mva, kv, phases })', o => `${o.basis} ${o.not_computed}`),
        rowOf('voltage drop along the route', s.D, o => `${nf(o.value, 5)} ${o.unit}`, 'voltage-drop voltageDropVolts({ currentA, lengthM, R, X, powerFactor, phases })', o => `resistive ${nf(o.resistiveVolts, 4)} V, reactive ${nf(o.reactiveVolts, 4)} V. ${o.basis}`),
        rowOf('drop as a percentage of nominal', s.P, o => `${nf(o.value, 4)} ${o.unit}`, 'voltage-drop dropPercent({ dropVolts, nominalVolts })'),
        rowOf('losses', s.W, o => `${nf(o.value, 5)} ${o.unit}`, 'voltage-drop lossesWatts({ currentA, lengthM, R, phases })'),
        ['not a headroom', 'NOT_A_HEADROOM', 'current-from-power.js', s.cfp.NOT_A_HEADROOM],
        ['no cable is chosen', 'NOT_COMPUTED', 'voltage-drop.js', `${s.vd.NOT_COMPUTED.cableSelection} ${s.vd.NOT_COMPUTED.permittedDrop}`],
        ['no protection drawn', 'NOT_COMPUTED', 'voltage-drop.js faultWithstand', s.vd.NOT_COMPUTED.faultWithstand]
      ]);
    }
    fillWires(wires, [w.load, w.len, w.kv, w.mva, w.amps, w.nom]);
    mach.textContent = `Machine detail · inputs: kw (kW real power, from the stop 1 wire, meaning after_diversity), powerFactor ${S.pf} (0 to 1, scenario input), kv (kV, from the stop 2 wire), mva (MVA, from apparentPowerKva via kVA→MVA), phases "${S.phases}", currentA (A), lengthM (m, from the stop 3 wire via km→m), resistanceOhmPerKm ${S.r} and reactanceOhmPerKm ${S.x} (ohm/km, scenario input), nominalVolts (V, via kV→V) · outputs: apparentPowerKva → kVA; reactivePowerKvar → kVAr; currentFromMvaAtKv → A with not_computed and not_a_headroom; voltageDropVolts → V with resistiveVolts, reactiveVolts; dropPercent → %; lossesWatts → W with conductors · refusals: every function throws on a non-finite or non-positive input, on a power factor outside (0, 1], and on phases other than "three" or "single"; no module chooses a voltage, a conductor, a limit or a cable · source: ventus-grid-engine ${SRC.pf.path}, ${SRC.cfp.path}, ${SRC.vd.path} at ${COMMIT}.`;
  }
  if (n === 5) {
    const s = R.s5;
    const siteBox = $('siteBox'), seasonBox = $('seasonBox');
    if (!s.empty && siteBox && !siteBox.childElementCount) {
      seg(siteBox, `stand-in site from the rating proof fixture (lines ${s.fx.firstLine}–${s.fx.lastLine})`, 'site', s.sites.map(c => ({ v: c, label: c })));
      seg(seasonBox, 'season shown on the labels', 'season', s.re.SEASONS.map(x => ({ v: x, label: x })));
    }
    if (s.empty) fillList(res, [['rating labels', 'EMPTY', '', s.empty, true]]);
    else if (!s.result) fillList(res, [['rating labels', 'EMPTY', `at(index, ${JSON.stringify(S.site)})`, 'at() returned null', true]]);
    else {
      const r = s.result;
      const items = [['call', `${r.circuits.length} circuit${r.circuits.length === 1 ? '' : 's'}`, `at(index, ${JSON.stringify(S.site)}${s.opts ? ', ' + JSON.stringify(s.opts) : ''})`, `scope: ${r.scope}. Fixture: ${SRC.pre.path} lines ${s.fx.firstLine}–${s.fx.lastLine}; test records written for the proof, not real network data.`]];
      if (!r.circuits.length) items.push(['labels', 'EMPTY', 'circuits: []', `no circuit lands on ${S.site}'s ${s.opts ? s.opts.voltageKv + ' kV ' : ''}nodes; every season reads ${JSON.stringify(r.by_season[S.season])}`, true]);
      for (const c of r.circuits) {
        const v = c.ratings_mva[S.season];
        const fl = c.flags.find(f => f.season === S.season);
        items.push([`label ${c.from_node} → ${c.to_node}`, v == null ? 'not published' : fl ? `${v} · flagged` : `${v} MVA`, `circuits[].ratings_mva.${S.season} · ${c.circuit_type || 'type not given'} · ${c.voltage_kv} kV`,
          fl ? `module flag: ${fl.reason}` : `all seasons as published: ${JSON.stringify(c.ratings_mva)}`, v == null || !!fl]);
      }
      items.push(['range, not a total', r.by_season[S.season].published === false ? 'published: false' : `${r.by_season[S.season].lowest_circuit_mva} to ${r.by_season[S.season].highest_circuit_mva} MVA`, `by_season.${S.season}`, `two real per-circuit values, lowest and highest; ${r.by_season[S.season].excluded_as_implausible} excluded as implausible. No headroom is drawn.`]);
      items.push(['never summed', 'NEVER_SUMMED', 'rating-envelope.js', s.re.NEVER_SUMMED]);
      items.push(['not a capacity', 'NOT_A_CAPACITY', 'rating-envelope.js', s.re.NOT_A_CAPACITY]);
      fillList(res, items);
    }
    fillWires(wires, [w.name, w.rkv, w.head]);
    mach.textContent = `Machine detail · inputs: index (network-topology index(product) of the proof fixture; graph().schema must be "${s.re ? s.re.requires : 'gridatlas.module.network-topology.graph.v1'}"), key (site code or exact site name: first the node name from stop 2, then the stand-in "${S.site}"), options.voltageKv (kV, from the stop 4 wire) · outputs: circuits[] with ratings_mva (MVA per season), flags (season, value MVA, reason), seasons_not_published, voltage_kv (kV), ohl_km and cable_km (km); by_season lowest_circuit_mva and highest_circuit_mva (MVA, two real values, never a sum or mean); counts; never_summed and not_a_capacity (text) · refusals: returns null for an index with no graph(), a graph of another schema, or an unknown key; a value at or above IMPLAUSIBLE_MVA ${s.re ? s.re.IMPLAUSIBLE_MVA : ''} MVA is flagged and excluded from the range; a season with no qualifying circuit reads published: false · source: ventus-grid-engine ${SRC.re.path} and ${SRC.topo.path} at ${COMMIT}.`;
  }
  publish(R);
}

function publish(R) {
  const w = {};
  for (const [k, v] of Object.entries(R.wires)) if (v) w[k] = v.state;
  window.__journey = {
    stop: S.stop, queuePeak: queue.peak, status: Object.fromEntries(Object.entries(RT).map(([k, v]) => [k, v.status])), wires: w,
    s1: R.s1 && R.s1.fleet && R.s1.fleet.ok ? { diversifiedKw: R.s1.fleet.ok.diversified.value, meaning: R.s1.fleet.ok.diversified.meaning } : null,
    s2: R.s2 && R.s2.best ? { name: R.s2.best.point.name, km: R.s2.best.km } : null,
    s3: R.s3 && !R.s3.empty ? { straight: R.s3.straight, corridor: R.s3.corridor && R.s3.corridor.km } : null,
    s4: R.s4 && !R.s4.empty ? { I: R.s4.I.ok && R.s4.I.ok.value, D: R.s4.D.ok && R.s4.D.ok.value, P: R.s4.P.ok && R.s4.P.ok.value, W: R.s4.W.ok && R.s4.W.ok.value } : null,
    s5: R.s5 && R.s5.result ? { circuits: R.s5.result.circuits.length, byName: R.wires.name && R.wires.name.state } : null,
    dom: document.getElementsByTagName('*').length
  };
}

/* ── navigation: buttons, dots, keys, swipe ──────────────────────────────── */
function go(n) {
  n = Math.max(1, Math.min(5, n));
  if (n === S.stop && built === n) return;
  S.stop = n;
  try { history.replaceState(null, '', '#stop=' + n); } catch (_) { /* file or sandbox */ }
  renderStop();
  window.scrollTo({ top: 0 });
}
$('prev').addEventListener('click', () => go(S.stop - 1));
$('next').addEventListener('click', () => go(S.stop + 1));
addEventListener('keydown', e => {
  if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
  if (e.key === 'ArrowRight') go(S.stop + 1);
  if (e.key === 'ArrowLeft') go(S.stop - 1);
});
{
  let sw = null;
  const zone = $('card');
  const skip = t => t && t.closest && t.closest('input,canvas,button,summary,pre,.seg');
  const start = (x, y, t) => { sw = skip(t) ? null : { x, y }; };
  const end = (x, y) => {
    if (!sw) return;
    const dx = x - sw.x, dy = y - sw.y; sw = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 1.6 * Math.abs(dy)) { window.__journeySwipes = (window.__journeySwipes || 0) + 1; go(S.stop + (dx < 0 ? 1 : -1)); }
  };
  for (const z of [zone, $('sldwrap')]) {
    z.addEventListener('pointerdown', e => start(e.clientX, e.clientY, e.target));
    z.addEventListener('pointerup', e => end(e.clientX, e.clientY));
    z.addEventListener('pointercancel', () => { sw = null; });
  }
}
addEventListener('resize', update);

$('pin').textContent = PIN;
buildRows();
renderStop();
