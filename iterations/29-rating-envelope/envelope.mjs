/* Ratings That Do Not Add — engine/rating-envelope.js, called as it is.
   The circuits come from the fixture written in the module's own proof,
   read from the proof's served bytes at the pinned commit. The page never
   adds, averages or ranks a rating: every derived figure on screen is a
   field the module returned. */

const COMMIT = 'd9cd18b0e2034325814924e6e4a0e958014f2748';
const BASE = `https://cdn.jsdelivr.net/gh/Ventusltd/ventus-grid-engine@${COMMIT}/`;
const ENVELOPE = 'engine/rating-envelope.js';
const TOPOLOGY = 'engine/network-topology.js';
const PROOF = 'proofs/rating-envelope.proof.mjs';
const SOURCES = [ENVELOPE, TOPOLOGY, PROOF];

/* Lifted from the Grid Atlas v8 topology config (ukConfig, "Topology
   (GeoJSON)"): the voltage levels the Atlas draws and the colour of each.
   Substations are #ffffff. */
const ATLAS_VOLTAGES = [
  { kv: 400, color: '#0054ff' },
  { kv: 275, color: '#ff0000' },
  { kv: 220, color: '#ff9900' },
  { kv: 132, color: '#00cc00' },
  { kv: 66,  color: '#b200ff' },
  { kv: 11,  color: '#ff00ff' }
];
const GREY = '#8a8f98';
const colourOf = kv => (ATLAS_VOLTAGES.find(v => v.kv === kv) || { color: GREY }).color;

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

/* ── loading, Grid Atlas grammar ─────────────────────────────────────────── */
const state = Object.fromEntries(SOURCES.map(s => [s, 'WAIT']));
function paintMods() {
  const box = $('mods');
  box.textContent = '';
  for (const s of SOURCES) {
    const st = state[s];
    const sp = st.indexOf(' ');
    const span = el('span');
    span.dataset.src = s;
    span.append(el('b', null, sp < 0 ? st : st.slice(0, sp)), ` ${s}` + (sp < 0 ? '' : ' — ' + st.slice(sp + 1)));
    box.append(span);
  }
}
paintMods();
$('pin').textContent = `The module, its proof and network-topology.js are read from ventus-grid-engine at commit ${COMMIT.slice(0, 12)}.`;

/* Three sources, loaded together: never more than three requests at once. */
async function load(src, job) {
  state[src] = 'LOAD'; paintMods();
  try {
    const out = await job();
    state[src] = 'OK'; paintMods();
    return out;
  } catch (err) {
    state[src] = 'FAIL ' + (err && err.message ? err.message : String(err)); paintMods();
    return null;
  }
}

/* The proof declares its fixture as a JavaScript object literal named
   PRODUCT. It is read as text and converted to JSON without evaluating
   any code; the one identifier in it, ACCEPTS, is the value
   network-topology.js exports under that name. */
function fixtureFrom(text, accepts) {
  const lines = text.split('\n');
  const start = lines.findIndex(l => /^const PRODUCT = \{/.test(l));
  if (start < 0) throw new Error('no "const PRODUCT = {" line in the proof');
  let end = -1;
  for (let i = start + 1; i < lines.length; i++) if (/^\};/.test(lines[i])) { end = i; break; }
  if (end < 0) throw new Error('the PRODUCT literal has no closing line');
  let src = lines.slice(start, end + 1).join('\n')
    .replace(/^const PRODUCT = /, '').replace(/;\s*$/, '')
    .replace(/\/\/[^\n]*/g, '');
  if (/\bACCEPTS\b/.test(src)) {
    if (typeof accepts !== 'string') throw new Error('the fixture names ACCEPTS but network-topology.js did not load');
    src = src.replace(/\bACCEPTS\b/g, JSON.stringify(accepts));
  }
  src = src.replace(/'([^'\\\n]*)'/g, (_, s) => JSON.stringify(s))
    .replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":')
    .replace(/,(\s*[}\]])/g, '$1');
  return { product: JSON.parse(src), firstLine: start + 1, lastLine: end + 1 };
}

const S = { season: null, voltageKv: null, corridor: [] };
let ENV = null, TOPO = null, FIX = null, IDX = null, GRAPH = null;
const cards = new Map();     // circuit id -> card parts
const flagsById = new Map(); // circuit id -> what at() reported for it

const idOf = rec => [rec.node_1, rec.node_2].sort().join('|');

async function boot() {
  const [env, topo, proofText] = await Promise.all([
    load(ENVELOPE, () => import(BASE + ENVELOPE)),
    load(TOPOLOGY, () => import(BASE + TOPOLOGY)),
    load(PROOF, async () => {
      const r = await fetch(BASE + PROOF);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    })
  ]);
  ENV = env; TOPO = topo;
  if (proofText != null) {
    try { FIX = fixtureFrom(proofText, topo && topo.ACCEPTS); }
    catch (err) { state[PROOF] = 'FAIL fixture could not be read: ' + err.message; paintMods(); }
  }
  if (!ENV || !TOPO || !FIX) return emptyAll();
  IDX = TOPO.index(FIX.product);
  if (!IDX) { state[TOPOLOGY] = 'FAIL index() returned null for the fixture'; paintMods(); return emptyAll(); }
  GRAPH = IDX.graph();

  $('provenance').textContent = `Scenario input: the PRODUCT records at ${PROOF} lines ${FIX.firstLine}–${FIX.lastLine}, ventus-grid-engine commit ${COMMIT.slice(0, 12)}. Test records written for the proof, not real network data.`;
  $('notcap').textContent = ENV.NOT_A_CAPACITY;

  /* Flags and unpublished seasons, exactly as at() reports them, collected
     by calling at() once for every site in the fixture. */
  for (const site of FIX.product.sites || []) {
    const r = ENV.at(IDX, site.code);
    if (!r) continue;
    for (const c of r.circuits) {
      const id = [c.from_node, c.to_node].sort().join('|');
      if (!flagsById.has(id)) flagsById.set(id, { flags: c.flags, seasons_not_published: c.seasons_not_published });
    }
  }

  paintQuestions();
  S.season = ENV.SEASONS[0];
  buildSeasons();
  buildVolts();
  buildCircuits();
  paintTray();
  paintResult();
  document.documentElement.dataset.ready = '1';
}

/* Questions panel and machine line: the cited text is in index.html; the
   values below are read from the loaded module, not typed. */
function paintQuestions() {
  const never = String(ENV.NEVER_SUMMED).split('. ');
  $('q-never').textContent = never[never.length - 1];
  $('q-exports').textContent = Object.keys(ENV).sort().join(', ');
  document.querySelectorAll('.pin12').forEach(n => { n.textContent = COMMIT.slice(0, 12); });
  $('machine').textContent = `Machine detail · inputs: index (a network-topology index whose graph().schema is "${ENV.requires}"), key (site code or exact site name), options.voltageKv (kV, optional); per circuit record ${ENV.SEASONS.map(s => s + '_mva').join(', ')} (MVA, seasonal thermal rating as published) · outputs (schema "${ENV.schema}"): circuits[].ratings_mva (MVA per season), circuits[].flags (season, value in MVA, reason), circuits[].seasons_not_published, ohl_km and cable_km (km), parameters_pct_100mva (percent on a 100 MVA base); by_season.lowest_circuit_mva and highest_circuit_mva (MVA, two real published values), circuits and excluded_as_implausible (counts); counts; never_summed and not_a_capacity (text) · refusals: returns null when the index has no graph(), the graph schema differs, or the site is unknown; a value at or above IMPLAUSIBLE_MVA = ${ENV.IMPLAUSIBLE_MVA} MVA is flagged and excluded from the range; a season with no qualifying circuit reads published: false; no function returns a sum or a mean · source: ventus-grid-engine ${ENVELOPE} at ${COMMIT}.`;
  try { if (window.matchMedia('(min-width: 900px)').matches) $('questions').open = true; } catch (_) { /* stays collapsed */ }
}

function emptyAll() {
  $('circuits').replaceChildren(el('li', 'empty', 'EMPTY — nothing is drawn: a source above did not load, and no circuit or rating is invented in its place.'));
  $('sum').replaceChildren(el('div', 'empty', 'EMPTY — the module is not available to call.'));
  document.documentElement.dataset.ready = 'empty';
}

/* ── controls ────────────────────────────────────────────────────────────── */
function segment(box, opts, isOn, onPick) {
  box.textContent = '';
  const buttons = opts.map(o => {
    const b = el('button', null, o.label);
    b.type = 'button';
    b.dataset.v = o.label;
    b.addEventListener('click', () => {
      onPick(o);
      buttons.forEach((bb, j) => bb.setAttribute('aria-pressed', String(isOn(opts[j]))));
    });
    b.setAttribute('aria-pressed', String(isOn(o)));
    box.append(b);
    return b;
  });
}

function buildSeasons() {
  segment($('seasons'), ENV.SEASONS.map(s => ({ label: s, s })), o => o.s === S.season,
    o => { S.season = o.s; for (const id of cards.keys()) paintCard(id); paintResult(); });
}

function buildVolts() {
  const kvs = [...new Set((FIX.product.nodes || []).map(n => GRAPH.nodeVoltageKv(n.node)).filter(Number.isFinite))].sort((a, b) => b - a);
  const opts = [{ label: 'not passed', kv: null }, ...kvs.map(kv => ({ label: kv + ' kV', kv }))];
  segment($('volts'), opts, o => o.kv === S.voltageKv, o => { S.voltageKv = o.kv; paintResult(); });
}

/* ── circuits ────────────────────────────────────────────────────────────── */
function nodeLine(name) {
  const kv = GRAPH.nodeVoltageKv(name);
  const code = GRAPH.nodeSiteCode(name);
  const site = code ? GRAPH.siteByCode(code) : null;
  return `${name} · ${kv == null ? 'voltage undeclared' : kv + ' kV'}${site && site.name ? ' · ' + site.name : ''}`;
}

function buildCircuits() {
  const ul = $('circuits');
  ul.textContent = '';
  for (const rec of FIX.product.circuits || []) {
    const id = idOf(rec);
    const li = el('li', 'circ');
    li.dataset.id = id;
    const top = el('div', 'top');
    const grip = el('button', 'grip', '⠿');
    grip.type = 'button';
    grip.setAttribute('aria-label', `drag circuit ${rec.node_1} to ${rec.node_2} into the corridor`);
    const meta = [rec.circuit_type, ...['ohl_km', 'cable_km'].filter(k => Number.isFinite(rec[k])).map(k => `${k} ${rec[k]}`)].filter(Boolean).join(' · ');
    const name = el('span', 'name', `${rec.node_1} — ${rec.node_2}`);
    const act = el('button', 'act', '+ corridor');
    act.type = 'button';
    act.addEventListener('click', () => toggle(id));
    top.append(grip, name, act);

    const wire = el('div', 'wire');
    wire.style.setProperty('--c1', colourOf(GRAPH.nodeVoltageKv(rec.node_1)));
    wire.style.setProperty('--c2', colourOf(GRAPH.nodeVoltageKv(rec.node_2)));
    wire.append(el('div', 'halo'), el('div', 'core'), el('div', 'sub a'), el('div', 'sub b'));

    const ends = el('div', 'ends dim');
    ends.append(el('span', null, nodeLine(rec.node_1)), el('span', null, nodeLine(rec.node_2)));
    const metaLine = el('div', 'dim small', meta);
    const fields = el('div', 'fields');
    const reason = el('div', 'reasons');
    li.append(top, wire, ends, metaLine, fields, reason);
    ul.append(li);
    cards.set(id, { li, rec, wire, fields, reason, act });
    attachDrag(grip, id, `${rec.node_1} — ${rec.node_2}`, false);
    paintCard(id);
  }
  $('legend').textContent = `Drawn: ${cards.size} circuit records from the fixture. Dashed grey: the shown season's value is flagged by the module as a placeholder. Dotted grey: the record publishes no value for that season. The fixture's ${(FIX.product.transformers || []).length} transformer record(s) are not drawn: at() reads circuits only.`;
}

function paintCard(id) {
  const c = cards.get(id);
  const known = flagsById.has(id);
  const info = flagsById.get(id) || { flags: [], seasons_not_published: [] };
  const flagged = new Map(info.flags.map(f => [f.season, f]));
  const season = S.season;
  const notPublished = !known || info.seasons_not_published.includes(season);
  c.wire.classList.toggle('ph', flagged.has(season));
  c.wire.classList.toggle('np', !flagged.has(season) && notPublished);
  const inside = S.corridor.includes(id);
  c.li.classList.toggle('in', inside);
  c.act.textContent = inside ? '− corridor' : '+ corridor';

  c.fields.textContent = '';
  for (const key of Object.keys(c.rec).filter(k => /_mva$/.test(k))) {
    const f = el('span', 'f');
    const s = ENV.SEASONS.find(x => key.startsWith(x + '_'));
    if (s === season) f.classList.add('on');
    if (s && flagged.has(s)) f.classList.add('ph');
    f.append(key + ' ', el('b', null, String(c.rec[key])));
    c.fields.append(f);
  }
  c.reason.textContent = '';
  for (const f of info.flags) {
    const r = el('div', 'reason');
    r.append(el('i', null, `module flag · ${f.season} · ${f.value} · reason: `), f.reason);
    c.reason.append(r);
  }
  if (!known) {
    const r = el('div', 'reason');
    r.append(el('i', null, 'EMPTY · '), 'at() returned no row for this circuit at any fixture site, so no flag can be read for it.');
    c.reason.append(r);
  }
}

/* ── corridor ────────────────────────────────────────────────────────────── */
function toggle(id, want) {
  const has = S.corridor.includes(id);
  const add = want == null ? !has : want;
  if (add === has) return;
  S.corridor = add ? [...S.corridor, id] : S.corridor.filter(x => x !== id);
  paintCard(id);
  paintTray();
  paintResult();
}

function paintTray() {
  const box = $('traychips');
  box.textContent = '';
  const n = S.corridor.length;
  $('traycount').textContent = `${n} circuit${n === 1 ? '' : 's'} · total: none offered by the module`;
  if (!n) box.append(el('span', 'hint', 'drop circuits here (drag by ⠿, or tap + corridor)'));
  for (const id of S.corridor) {
    const { rec } = cards.get(id);
    const chip = el('span', 'chip');
    chip.dataset.id = id;
    const grip = el('button', 'grip', '⠿');
    grip.type = 'button';
    grip.setAttribute('aria-label', 'drag out of the corridor');
    const x = el('button', 'x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', `remove ${rec.node_1} to ${rec.node_2}`);
    x.addEventListener('click', () => toggle(id, false));
    chip.append(grip, `${rec.node_1}—${rec.node_2}`, x);
    box.append(chip);
    attachDrag(grip, id, `${rec.node_1} — ${rec.node_2}`, true);
  }
}

function attachDrag(grip, id, label, fromTray) {
  let ghost = null;
  const tray = $('tray');
  const over = e => {
    const r = tray.getBoundingClientRect();
    return e.clientY >= r.top && e.clientY <= r.bottom && e.clientX >= r.left && e.clientX <= r.right;
  };
  grip.addEventListener('pointerdown', e => {
    e.preventDefault();
    try { grip.setPointerCapture(e.pointerId); } catch (_) { /* capture is optional */ }
    ghost = el('div', 'ghost', label);
    ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px';
    document.body.append(ghost);
  });
  grip.addEventListener('pointermove', e => {
    if (!ghost) return;
    ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px';
    tray.classList.toggle('over', over(e));
  });
  const end = (e, cancelled) => {
    if (!ghost) return;
    ghost.remove(); ghost = null;
    tray.classList.remove('over');
    if (cancelled) return;
    if (over(e)) toggle(id, true);
    else if (fromTray) toggle(id, false);
  };
  grip.addEventListener('pointerup', e => end(e, false));
  grip.addEventListener('pointercancel', e => end(e, true));
}

/* ── the module's answer ─────────────────────────────────────────────────── */
function siteCodesOf(id) {
  const { rec } = cards.get(id);
  return new Set([rec.node_1, rec.node_2].map(n => GRAPH.nodeSiteCode(n)).filter(Boolean));
}

function paintResult() {
  const sum = $('sum');
  const calls = $('calls');
  sum.textContent = ''; calls.textContent = '';

  /* What the module exports, read from the live namespace. */
  const exportsList = Object.keys(ENV).sort();
  const fns = exportsList.filter(k => typeof ENV[k] === 'function');
  const adders = fns.filter(k => /sum|total|add|aggregate/i.test(k));

  if (adders.length) {
    sum.append(el('p', 'plain', `The module exports a function named ${adders.join(', ')}; this page was not written to call it.`));
  } else {
    sum.append(el('p', 'plain', 'This module offers no way to add these ratings.'));
    const parts = String(ENV.NEVER_SUMMED).split('. ');
    sum.append(el('q', null, parts[parts.length - 1]));
    sum.append(el('div', 'by', 'from NEVER_SUMMED, exported by ' + ENVELOPE));
  }
  sum.append(el('div', 'by', `Exports read from the live module (${exportsList.length}): ${exportsList.map(k => k + (typeof ENV[k] === 'function' ? `(${ENV[k].length} parameters)` : '')).join(', ')}. Functions: ${fns.length} (${fns.join(', ')}).`));

  if (!S.corridor.length) {
    calls.append(el('div', 'call empty', 'EMPTY — no circuit is in the corridor yet. Drag a circuit by ⠿ into the corridor bar, or tap + corridor.'));
    return;
  }
  let shared = null;
  for (const id of S.corridor) {
    const codes = siteCodesOf(id);
    shared = shared == null ? codes : new Set([...shared].filter(c => codes.has(c)));
  }
  if (!shared.size) {
    calls.append(el('div', 'call empty', `EMPTY — the circuits in the corridor share no site. The module's function${fns.length === 1 ? '' : 's'} ${fns.map(f => f + '(index, key, options)').join(', ')} read${fns.length === 1 ? 's' : ''} the circuits landing at one site; there is no call that takes a chosen set of circuits, so nothing is called.`));
    return;
  }
  for (const code of [...shared].sort()) calls.append(callCard(code));
}

function callCard(code) {
  const box = el('div', 'call');
  const opts = S.voltageKv == null ? undefined : { voltageKv: S.voltageKv };
  const callText = `at(index, ${JSON.stringify(code)}${opts ? ', ' + JSON.stringify(opts) : ''})`;
  box.append(el('div', 'small', `Every circuit in the corridor lands at site ${code}. The page calls`), el('code', null, callText));
  let result;
  try { result = ENV.at(IDX, code, opts); }
  catch (err) { box.append(el('div', 'v', 'FAIL — at() threw: ' + (err && err.message))); return box; }
  if (result === null) { box.append(el('div', 'v', 'at() returned: null')); return box; }

  const chosen = new Set(S.corridor);
  const returned = result.circuits.map(c => [c.from_node, c.to_node].sort().join('|'));
  const extra = returned.filter(id => !chosen.has(id)).length;
  const missing = S.corridor.filter(id => !returned.includes(id)).length;
  const rows = result.circuits.length;
  box.append(el('div', 'v', `at() returned ${rows} circuit row${rows === 1 ? '' : 's'}. It reads every circuit at the site${opts ? ' on that voltage' : ''}, not the corridor you built: ${extra} returned row${extra === 1 ? ' is' : 's are'} not in your corridor, ${missing} of your corridor ${missing === 1 ? 'is' : 'are'} not returned.`));

  const wrap = el('div', 'scroll');
  const t = el('table');
  const keys = [...new Set(Object.values(result.by_season).flatMap(o => Object.keys(o)))];
  const head = el('tr');
  head.append(el('th', null, 'by_season'), ...keys.map(k => el('th', null, k)));
  t.append(head);
  for (const s of ENV.SEASONS) {
    const tr = el('tr', s === S.season ? 'on' : null);
    const o = result.by_season[s] || {};
    tr.append(el('td', null, s), ...keys.map(k => el('td', null, k in o ? String(o[k]) : '—')));
    t.append(tr);
  }
  wrap.append(t);
  box.append(wrap);

  const line = (k, v) => { const d = el('div', 'v'); d.append(el('i', null, k + ': '), String(v)); return d; };
  box.append(line('scope', result.scope), line('counts', JSON.stringify(result.counts)),
    line('never_summed', result.never_summed), line('not_a_capacity', result.not_a_capacity));
  const det = el('details');
  det.append(el('summary', null, 'the whole returned object, verbatim'), el('pre', null, JSON.stringify(result, null, 2)));
  box.append(det);
  return box;
}

boot();
