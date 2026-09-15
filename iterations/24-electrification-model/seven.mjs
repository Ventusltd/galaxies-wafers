/* Seven Meanings. Draws engine/electrification-model.js. Every value comes from
   the module; the page formats, scales and places. Nothing here re-derives a
   formula the module owns. */

const PIN = 'd9cd18b0e2034325814924e6e4a0e958014f2748';
const SRC = `https://cdn.jsdelivr.net/gh/Ventusltd/ventus-grid-engine@${PIN}/engine/electrification-model.js`;

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const fmt = (n, d = 3) => Number(n).toLocaleString('en-GB', { maximumFractionDigits: d });
$('pin').textContent = PIN.slice(0, 12);

let M; // the module
try {
  M = await import(SRC);
} catch (e) {
  $('status').textContent = `FAIL — the electrification model could not be loaded from the engine: ${e.message}`;
  throw e;
}

/* ── the seven lanes, keyed by the module's own MEANING names ──────────────── */
const LANES = [
  { key: 'THERMAL_OUTPUT',   top: 'THERMAL',  sub: 'output',    c: '#ff9f43', axis: 'home' },
  { key: 'ELECTRICAL_INPUT', top: 'ELECTRIC', sub: 'input',     c: '#3d7bff', axis: 'home' },
  { key: 'NAMEPLATE',        top: 'NAME',     sub: 'plate',     c: '#b48cff', axis: 'fleet' },
  { key: 'AFTER_DIVERSITY',  top: 'AFTER',    sub: 'diversity', c: '#62d8ff', axis: 'fleet' },
  { key: 'PRIMARY_ENERGY',   top: 'PRIMARY',  sub: 'energy',    c: '#ffd54a', axis: 'year' },
  { key: 'FINAL_ENERGY',     top: 'FINAL',    sub: 'energy',    c: '#e8e8e8', axis: 'year' },
  { key: 'USEFUL_WORK',      top: 'USEFUL',   sub: 'work',      c: '#f4f4f4', axis: 'year' }
];
const AXES = { home: 'kW / home', fleet: 'GW fleet', year: 'TWh / yr' };
const meaningKeys = Object.keys(M.MEANING);
const missing = LANES.filter(L => !(L.key in M.MEANING)).map(L => L.key);
$('status').textContent = missing.length
  ? `FAIL — the module does not declare: ${missing.join(', ')}`
  : `OK — ${M.schema} loaded; ${meaningKeys.length} meanings declared by the module, one lane each.`;
$('notForecast').textContent = M.NOT_A_FORECAST;

/* ── scenario inputs ──────────────────────────────────────────────────────── */
const SLIDERS = [
  { id: 'heat',  label: 'heat demand per home', unit: 'kW thermal', min: 1, max: 20, step: 0.25, value: 12.25,
    hint: 'THERMAL_OUTPUT: heat delivered to one home.' },
  { id: 'scop',  label: 'SCOP', unit: '', min: 1, max: 6, step: 0.05, value: 3.5,
    hint: 'Seasonal coefficient of performance. The module carries none, and refuses 1 or less.' },
  { id: 'units', label: 'number of heat pumps', unit: 'units', min: 0, max: 40000000, step: 100000, value: 28000000,
    hint: 'A whole number of units, one per home.' },
  { id: 'div',   label: 'after-diversity demand per home', unit: 'kW', min: 0.1, max: 6, step: 0.1, value: 1.7,
    hint: 'The module takes diversity as a measured after-diversity kW per unit, never as a factor it chooses, and reports its ratio to nameplate.' },
  { id: 'mwh',   label: 'useful heat per home per year', unit: 'MWh', min: 1, max: 30, step: 0.5, value: 12,
    hint: 'USEFUL_WORK: heat actually obtained in a year. Feeds the primary-energy lane.' },
  { id: 'boil',  label: 'incumbent gas boiler efficiency', unit: '', min: 0.5, max: 1, step: 0.01, value: 0.85,
    hint: 'The chain being replaced. The heat-pump chain uses the SCOP above as its efficiency.' }
];
const S = {};
for (const s of SLIDERS) {
  const wrap = el('div', 'slider');
  const lab = el('label');
  lab.htmlFor = 'in-' + s.id;
  const left = el('span');
  left.append(el('span', 'si', 'scenario input'), ' ', s.label);
  const out = el('output');
  lab.append(left, out);
  const inp = document.createElement('input');
  Object.assign(inp, { type: 'range', min: s.min, max: s.max, step: s.step, value: s.value, id: 'in-' + s.id });
  const show = () => { out.textContent = `${fmt(+inp.value)} ${s.unit}`.trim(); };
  inp.addEventListener('input', () => { show(); schedule(); });
  wrap.append(lab, inp, el('div', 'hint', s.hint));
  $('sliders').append(wrap);
  S[s.id] = { inp, show };
  show();
}
const read = id => +S[id].inp.value;

/* ── lane DOM, built once; updates touch only the changed nodes ─────────────── */
const laneEls = {};
for (const L of LANES) {
  const lane = el('div', 'lane');
  lane.dataset.meaning = L.key;
  const h = el('h3'); h.append(el('b', null, L.top), L.sub);
  const track = el('div', 'track');
  const val = el('div', 'val');
  lane.append(h, track, val);
  lane.style.setProperty('--c', L.c);
  $('lanes').append(lane);
  laneEls[L.key] = { lane, track, val, sig: '' };
  $('axes').append(el('div', null, AXES[L.axis]));
}

/* ── compute: call the module; each lane gets bars or a refusal ─────────────── */
function attempt(fn) { try { return { ok: fn() }; } catch (e) { return { err: e.message }; } }

function compute() {
  const q = M.MEANING, heat = read('heat'), scop = read('scop'), units = read('units'), div = read('div');
  const out = {};
  const thermal = attempt(() => M.quantity(heat, 'kW', q.THERMAL_OUTPUT));
  const elec = thermal.ok ? attempt(() => M.electricalInputFromHeat({ thermal: thermal.ok, scop })) : thermal;
  const back = elec.ok ? attempt(() => M.heatFromElectricalInput({ electrical: elec.ok, scop })) : elec;

  out.THERMAL_OUTPUT = thermal.ok
    ? { bars: [{ id: 'thermal', value: thermal.ok.value, show: fmt(thermal.ok.value), u: 'kW', obj: thermal.ok,
        call: `quantity(${heat}, 'kW', MEANING.THERMAL_OUTPUT)`,
        text: [back.ok ? `Round trip through heatFromElectricalInput at SCOP ${scop}: ${fmt(back.ok.value, 6)} kW, meaning ${back.ok.meaning}. ${back.ok.basis}` : ''] }] }
    : { refused: thermal.err, call: 'quantity' };

  out.ELECTRICAL_INPUT = elec.ok
    ? { bars: [{ id: 'elec', value: elec.ok.value, show: fmt(elec.ok.value), u: 'kW', obj: elec.ok,
        call: `electricalInputFromHeat({ thermal, scop: ${scop} })`, text: [elec.ok.basis, `not computed: ${elec.ok.not_computed}`] }] }
    : { refused: elec.err, call: 'electricalInputFromHeat' };

  let fleet = { err: elec.err }, plateOnly = { err: elec.err };
  if (elec.ok) {
    fleet = attempt(() => M.fleetDemand({ units, perUnitNameplate: elec.ok,
      perUnitAfterDiversity: M.quantity(div, 'kW', q.AFTER_DIVERSITY) }));
    plateOnly = attempt(() => M.fleetDemand({ units, perUnitNameplate: elec.ok }));
  }
  // The nameplate bar carries the module's nameplate-only fleet result, so
  // nothing dragged from it can smuggle an after-diversity figure along.
  if (plateOnly.ok) {
    const f = plateOnly.ok;
    out.NAMEPLATE = { bars: [{ id: 'plate', value: f.simultaneous.value, show: fmt(f.simultaneous.value / 1e6, 2), u: 'GW',
      obj: f, call: `fleetDemand({ units: ${units}, perUnitNameplate })`,
      text: [`label: ${f.simultaneous.label}`, f.basis, `never added: ${f.never_added}`] }] };
  } else out.NAMEPLATE = { refused: plateOnly.err, call: elec.ok ? 'fleetDemand' : 'electricalInputFromHeat, upstream' };
  if (fleet.ok) {
    const f = fleet.ok;
    out.AFTER_DIVERSITY = { bars: [{ id: 'div', value: f.diversified.value, show: fmt(f.diversified.value / 1e6, 2), u: 'GW',
      obj: f, call: `fleetDemand({ units: ${units}, perUnitNameplate, perUnitAfterDiversity: ${div} kW })`,
      text: [`label: ${f.diversified.label}`, f.basis, `ratio to nameplate reported by the module: ${fmt(f.diversified.ratio * 100, 1)}%`, `not computed: ${f.not_computed}`] }] };
  } else out.AFTER_DIVERSITY = { refused: fleet.err, call: elec.ok ? 'fleetDemand' : 'electricalInputFromHeat, upstream' };

  const useful = attempt(() => M.quantity(units * read('mwh'), 'MWh', q.USEFUL_WORK));
  out.USEFUL_WORK = useful.ok
    ? { bars: [{ id: 'useful', value: useful.ok.value, show: fmt(useful.ok.value / 1e6, 1), u: 'TWh', obj: useful.ok,
        call: `quantity(${units} × ${read('mwh')}, 'MWh', MEANING.USEFUL_WORK)`, text: ['The scenario inputs, typed by the module as useful work.'] }] }
    : { refused: useful.err, call: 'quantity' };

  const prim = useful.ok ? attempt(() => M.primaryEnergyForWork({ usefulWork: useful.ok, incumbentEfficiency: read('boil'), electrifiedEfficiency: scop })) : useful;
  out.PRIMARY_ENERGY = prim.ok
    ? { bars: ['before', 'after'].map(k => ({ id: 'prim-' + k, tag: k === 'before' ? 'boiler' : 'pump',
        value: prim.ok[k].value, show: fmt(prim.ok[k].value / 1e6, 1), u: 'TWh', obj: prim.ok[k],
        call: `primaryEnergyForWork({ usefulWork, incumbentEfficiency: ${read('boil')}, electrifiedEfficiency: ${scop} }).${k}`,
        text: [prim.ok.basis, `reduction ratio reported by the module: ${fmt(prim.ok.reductionRatio * 100, 1)}%`, `not computed: ${prim.ok.not_computed}`] })),
        valText: `${fmt(prim.ok.before.value / 1e6, 0)}→${fmt(prim.ok.after.value / 1e6, 0)}` }
    : { refused: prim.err, call: useful.ok ? 'primaryEnergyForWork' : 'quantity, upstream' };

  out.FINAL_ENERGY = { empty: `The module declares the meaning ${M.MEANING.FINAL_ENERGY}, but none of its exported functions returns a quantity carrying it, so there is nothing computed to draw in this lane.` };
  return out;
}

/* each bar is scaled against the largest value in its axis group */
let current = {};
let selected = null;
function draw() {
  current = compute();
  const maxBy = {};
  for (const L of LANES) for (const b of current[L.key].bars || []) maxBy[L.axis] = Math.max(maxBy[L.axis] || 0, b.value);
  const refusals = [];
  for (const L of LANES) {
    const r = current[L.key], E = laneEls[L.key];
    const sig = r.bars ? 'bars:' + r.bars.map(b => b.id).join(',') : r.refused ? 'refused' : 'empty';
    if (sig !== E.sig) {           // structure changed: rebuild this one lane's track only
      E.track.textContent = '';
      if (r.bars) {
        for (const b of r.bars) {
          const bar = el('div', 'bar');
          bar.dataset.meaning = L.key; bar.dataset.bar = b.id; bar.tabIndex = 0;
          bar.setAttribute('role', 'button');
          if (b.tag) bar.append(el('span', 'tag', b.tag));
          attachDrag(bar);
          E.track.append(bar);
        }
        E.lane.onclick = null;
      } else {
        const n = el('div', 'note');
        n.append(el('b', null, r.refused ? 'REFUSED' : 'EMPTY'), 'tap to read');
        E.track.append(n);
        E.lane.onclick = () => showLaneNote(L);
      }
      E.sig = sig;
    }
    if (r.bars) {
      [...E.track.querySelectorAll('.bar')].forEach((bar, i) => {
        const b = r.bars[i];
        bar.style.height = `${maxBy[L.axis] > 0 ? Math.max(0.6, 100 * b.value / (maxBy[L.axis] * 1.12)) : 0.6}%`;
        bar.setAttribute('aria-label', `${L.top} ${L.sub}${b.tag ? ' ' + b.tag : ''}: ${b.show} ${b.u}. Drag onto another lane to try adding.`);
      });
      setVal(E.val, r.valText || r.bars[0].show, r.bars[0].u);
    } else setVal(E.val, r.refused ? 'REFUSED' : 'EMPTY', 'reason ↓');
    if (r.refused) refusals.push(`${L.top} ${L.sub}: ${r.call} threw: ${r.refused}`);
  }
  const list = $('refusals');
  const joined = refusals.join('\n');
  if (list.dataset.sig !== joined) {
    list.textContent = '';
    for (const t of refusals) list.append(el('li', null, t));
    list.dataset.sig = joined;
    $('refusedList').hidden = refusals.length === 0;
  }
  if (selected) showBar(selected.meaning, selected.id, false);
}
function setVal(node, v, u) {
  const s = v + '|' + u;
  if (node.dataset.sig === s) return;
  node.textContent = v; node.append(el('span', 'u', u)); node.dataset.sig = s;
}

let raf = 0;
function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); }

/* ── detail panel ─────────────────────────────────────────────────────────── */
const laneOf = key => LANES.find(L => L.key === key);
function showBar(meaningKey, id, scroll = true) {
  const r = current[meaningKey]; const b = r && r.bars && r.bars.find(x => x.id === id);
  document.querySelectorAll('.bar.sel').forEach(n => n.classList.remove('sel'));
  if (!b) { selected = null; return; }
  selected = { meaning: meaningKey, id };
  document.querySelector(`.bar[data-bar="${id}"]`)?.classList.add('sel');
  const L = laneOf(meaningKey), d = $('detail');
  d.textContent = '';
  d.append(el('h2', null, `${L.top} ${L.sub}${b.tag ? ' · ' + b.tag : ''}`));
  const p = el('p'); p.append(el('b', null, `${b.show} ${b.u}`), `  meaning: ${M.MEANING[meaningKey]}`); d.append(p);
  d.append(el('p', 'k', b.call));
  for (const t of b.text) if (t) d.append(el('p', null, t));
  if (scroll && innerWidth < 760) d.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function showLaneNote(L) {
  const r = current[L.key], d = $('detail');
  if (r.bars) return;
  document.querySelectorAll('.bar.sel').forEach(n => n.classList.remove('sel'));
  selected = null;
  d.textContent = '';
  d.append(el('h2', null, `${L.top} ${L.sub} · ${r.refused ? 'REFUSED' : 'EMPTY'}`));
  d.append(el('p', null, r.refused ? `${r.call} threw: ${r.refused}` : r.empty));
  if (innerWidth < 760) d.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/* ── drag a bar onto another lane: the module's summing path is asked ────── */
const ghost = $('ghost'), pop = $('refusal');
let drag = null;
function attachDrag(bar) {
  bar.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    e.preventDefault();
    try { bar.setPointerCapture(e.pointerId); } catch { /* synthetic pointers have no capture */ }
    drag = { bar, x0: e.clientX, y0: e.clientY, moved: false };
  });
  bar.addEventListener('pointermove', e => {
    if (!drag || drag.bar !== bar) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 8) return;
    if (!drag.moved) {
      drag.moved = true; bar.classList.add('dragging');
      ghost.style.setProperty('--c', getComputedStyle(bar.closest('.lane')).getPropertyValue('--c'));
      ghost.style.height = Math.min(120, Math.max(24, bar.offsetHeight)) + 'px';
      ghost.hidden = false; hidePop();
    }
    ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px';
    const lane = laneAt(e.clientX, e.clientY);
    document.querySelectorAll('.lane.over').forEach(n => { if (n !== lane) n.classList.remove('over'); });
    if (lane && lane.dataset.meaning !== bar.dataset.meaning) lane.classList.add('over');
  });
  const end = e => {
    if (!drag || drag.bar !== bar) return;
    const d = drag; drag = null;
    bar.classList.remove('dragging'); ghost.hidden = true;
    document.querySelectorAll('.lane.over').forEach(n => n.classList.remove('over'));
    if (e.type === 'pointercancel') return;
    if (!d.moved) { showBar(bar.dataset.meaning, bar.dataset.bar); return; }
    const lane = laneAt(e.clientX, e.clientY);
    if (!lane || lane.dataset.meaning === bar.dataset.meaning) return;
    tryAdd(bar.dataset.meaning, bar.dataset.bar, lane.dataset.meaning, e.clientX, e.clientY);
  };
  bar.addEventListener('pointerup', end);
  bar.addEventListener('pointercancel', end);
  bar.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showBar(bar.dataset.meaning, bar.dataset.bar); } });
}
function laneAt(x, y) {
  for (const n of document.elementsFromPoint(x, y)) { const l = n.closest && n.closest('.lane'); if (l) return l; }
  return null;
}

/* The module's only summing path is combinedPeak({ fleets }). The page hands it
   the two things being dropped together, exactly as the module produced them,
   and shows whatever comes back. */
function tryAdd(fromKey, fromId, toKey, x, y) {
  const a = current[fromKey].bars.find(b => b.id === fromId);
  const target = current[toKey];
  const b = target.bars ? target.bars[0] : null;
  const A = laneOf(fromKey), B = laneOf(toKey);
  pop.textContent = '';
  pop.append(el('div', 'h', `ADD ${A.top} ${A.sub} + ${B.top} ${B.sub}?`));
  let outcome;
  if (!b) {
    outcome = 'nothing';
    pop.append(el('div', 'said', target.refused ? `Nothing to add to: ${target.call} threw: ${target.refused}` : target.empty));
  } else {
    const res = attempt(() => M.combinedPeak({ fleets: [a.obj, b.obj] }));
    if (res.err) {
      outcome = 'refused';
      pop.append(el('div', 'said', M.NEVER_ADDED));
      pop.append(el('div', 'thrown', `combinedPeak({ fleets: [${M.MEANING[fromKey]}, ${M.MEANING[toKey]}] }) threw: ${res.err}`));
    } else {
      outcome = 'summed';
      pop.append(el('div', 'said', `combinedPeak returned ${fmt(res.ok.value / 1e6, 2)} GW, meaning ${res.ok.meaning}. It assumes ${res.ok.assumes}`));
    }
  }
  const close = el('button', 'close', 'close'); close.type = 'button'; close.onclick = hidePop;
  pop.append(close);
  Object.assign(pop.dataset, { from: fromKey, to: toKey, outcome, x: Math.round(x), y: Math.round(y) });
  pop.hidden = false;
  const w = pop.offsetWidth, h = pop.offsetHeight;
  pop.style.left = Math.max(12, Math.min(innerWidth - w - 12, x - w / 2)) + 'px';
  pop.style.top = Math.max(12, Math.min(innerHeight - h - 12, y + 14)) + 'px';
}
function hidePop() { pop.hidden = true; }
document.addEventListener('pointerdown', e => { if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('.bar')) hidePop(); });

/* ── the worked example, computed by the module from its scenario inputs ──── */
const EXAMPLE = { heat: 12.25, scop: 3.5, units: 28000000, div: 1.7 };
function workedExample() {
  const box = $('exampleOut'); box.textContent = ''; box.classList.remove('dim');
  const q = M.MEANING;
  const r = attempt(() => {
    const thermal = M.quantity(EXAMPLE.heat, 'kW', q.THERMAL_OUTPUT);
    const elec = M.electricalInputFromHeat({ thermal, scop: EXAMPLE.scop });
    const fleet = M.fleetDemand({ units: EXAMPLE.units, perUnitNameplate: elec,
      perUnitAfterDiversity: M.quantity(EXAMPLE.div, 'kW', q.AFTER_DIVERSITY) });
    return { thermal, elec, fleet };
  });
  const dim = t => el('p', 'dim', t);
  box.append(dim(`scenario input: ${fmt(EXAMPLE.heat)} kW thermal per home · SCOP ${fmt(EXAMPLE.scop)} · ${fmt(EXAMPLE.units)} heat pumps · ${fmt(EXAMPLE.div)} kW after diversity per home`));
  if (r.err) { box.append(el('p', null, `The module refused the worked example: ${r.err}`)); return; }
  const { thermal, elec, fleet } = r.ok;
  box.append(el('p', null, `${fmt(thermal.value)} ${thermal.unit} thermal = ${fmt(elec.value, 6)} ${elec.unit} electrical at SCOP ${fmt(EXAMPLE.scop)}.`));
  box.append(el('p', null, `${fmt(fleet.units)} heat pumps: ${fmt(fleet.simultaneous.value / 1e6, 3)} GW flat out vs ${fmt(fleet.diversified.value / 1e6, 3)} GW after diversity.`));
  box.append(dim(`flat out, as the module labels it: ${fleet.simultaneous.label}.`));
  box.append(dim(`module basis: ${elec.basis}`));
  box.append(dim(`module basis: ${fleet.basis}`));
  box.append(dim('Computed on this device when the page loaded; no result above is typed into the page. The page divides kW by 1,000,000 to print GW.'));
}
$('loadExample').addEventListener('click', () => {
  for (const [k, v] of Object.entries(EXAMPLE)) { S[k].inp.value = v; S[k].show(); }
  draw();
});

workedExample();
draw();
window.__seven = { ready: true, current: () => current };
