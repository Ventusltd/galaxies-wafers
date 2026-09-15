/* assembly.mjs — iteration 36, Assembly.
 *
 * The same universe at four assembly levels, each a zoom gate:
 *   1 LINES -> FUNCTION   one function's numbered lines lit on the dark wafer, in
 *                         sequence order, read from the numbered database
 *                         (families.json lineOffset/lineCount into lines.bin).
 *   2 FUNCTIONS -> ELEMENT an element (a register block) drawn as a molecule: its
 *                         function keys as atoms sized by lines, bonds only where
 *                         the register records depends_on / used_by.
 *   3 ELEMENTS -> APP      an app or served surface drawn as an assembly of its
 *                         elements, with a live link.
 *   4 IN ACTION            for elements whose files are ventus-grid-engine engine
 *                         modules at the pinned commit, one documented function
 *                         run with its proof's first fixture in a worker.
 *
 * LOADING, as Grid Atlas does it: nothing is fetched until a level is viewed, and
 * a level fetches only the files it draws. One queue of 4 for all network work,
 * a 15 s AbortController timeout on every fetch, one shared promise per URL (a
 * failed fetch leaves the cache so a retry is possible), and each source's status
 * is one span whose text alone changes. Drawings are canvas, never one DOM node
 * per line, atom or element.
 *
 * FIRST_LINE AND LAST_LINE are the endpoints of a function's line SEQUENCE, not
 * numeric bounds: most functions start on a higher key than they end on, and many
 * repeat a key. Nothing here treats them as an interval. The lit run is the exact
 * key list, and counts say "line occurrences" and "distinct lines".
 */
import { parseKey, indexOfKey, fmt, place } from '../../lib.mjs';
import { Wafer } from './wafer.mjs';
import { FIXTURES, NOT_RECORDED, SLD, DISCLAIMER, PIN, RAW as ENGINE_RAW, CDN, ENGINE_REPO, checkProof, runInWorker } from './engine.mjs';

const CAT_COMMIT = '5eafeef2ffad32bf3099fcb91feba71eab0ffb89';   /* Ventusltd/elements main when this page was built */
const CAT = `https://raw.githubusercontent.com/Ventusltd/elements/${CAT_COMMIT}/catalogue/`;
const DATA = 'https://globalgrid2050.com/testcode/202609142202/data/';
const CONCURRENCY = 4, FETCH_MS = 15000;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

/* ── sources: every file this page may read, a row each, fetched only on demand ── */
const SOURCES = {
  provenance: { url: CAT + 'provenance.json', as: 'json', what: 'catalogue provenance (the sha256 of each numbered-database file)' },
  elements: { url: CAT + 'elements.json', as: 'json', what: 'elements: every register block' },
  functions: { url: CAT + 'functions.json', as: 'json', what: 'functions over 10 lines' },
  surfaces: { url: CAT + 'surfaces.json', as: 'json', what: 'served surfaces' },
  apps: { url: CAT + 'apps.json', as: 'json', what: 'apps: blocks of kind app' },
  families: { url: DATA + 'families.json', as: 'json', what: 'numbered database: every function family', sha: true },
  lines: { url: DATA + 'lines.bin', as: 'u32', what: 'numbered database: every family\'s key list', sha: true },
  allLines: { url: DATA + 'all-lines.bin', as: 'u32', what: 'numbered database: every issued line key (the dark ground)', sha: true },
  proof: { url: null, as: 'text', what: 'engine proof read at the pinned commit (level 4)' },
  module: { url: null, as: 'text', what: 'engine module source read at the pinned commit (Questions)' }
};
const LEVEL_NEEDS = {
  1: ['provenance', 'elements', 'functions', 'families', 'lines', 'allLines'],
  2: ['elements', 'functions'],
  3: ['elements', 'surfaces', 'apps'],
  4: ['elements', 'functions']
};

const queue = { active: 0, waiting: [], peak: 0 };
async function inQueue(task) {
  if (queue.active >= CONCURRENCY) await new Promise(r => queue.waiting.push(r));
  queue.active++; queue.peak = Math.max(queue.peak, queue.active);
  try { return await task(); } finally { queue.active--; const n = queue.waiting.shift(); if (n) n(); }
}
const urlCache = new Map();
let fetchCount = 0;
function getURL(url, as, onStart) {
  let p = urlCache.get(url);
  if (!p) {
    p = inQueue(async () => {
      onStart && onStart();
      fetchCount++;
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), FETCH_MS);
      try {
        const r = await fetch(url, { signal: ac.signal });
        if (!r.ok) throw new Error(`${url} returned HTTP ${r.status}`);
        if (as === 'json') return await r.json();
        if (as === 'text') return await r.text();
        return await r.arrayBuffer();
      } catch (e) {
        throw e.name === 'AbortError' ? new Error(`${url} gave no answer within ${FETCH_MS / 1000} s`) : e;
      } finally { clearTimeout(t); }
    });
    urlCache.set(url, p);
    p.catch(() => urlCache.delete(url));
  }
  return p;
}

const rows = {};
function buildSourceRows() {
  $('rule').textContent = `Nothing is fetched until a level is viewed. One queue of ${CONCURRENCY}, a ${FETCH_MS / 1000} s timeout per fetch, one shared promise per address; a level fetches only its own files. Caps: one function is lit at a time (its own key list, never a range); the dark ground is one GPU buffer of every issued key, as the wafer draws it; a molecule has at most the register's inside list (24 at most today) and an assembly draws on one canvas with no DOM node per element; the button row is six buttons per card. Catalogue pinned at commit ${CAT_COMMIT.slice(0, 7)} (cited, not re-validated here); engine at ${PIN.slice(0, 7)}.`;
  for (const [id, s] of Object.entries(SOURCES)) {
    const li = el('li'); const tag = el('span', 'tag', 'WAIT'); tag.dataset.s = 'WAIT';
    const txt = el('span', null, s.what); const note = el('span', 'dim', '');
    li.append(tag, txt, el('br'), note);
    $('srclist').append(li);
    rows[id] = { tag, note, state: 'WAIT' };
    note.textContent = s.url || 'address chosen when used';
  }
}
function setRow(id, state, note) {
  const r = rows[id]; if (!r) return;
  r.state = state; r.tag.textContent = state; r.tag.dataset.s = state;
  if (note !== undefined) r.note.textContent = note;
}

const D = { data: {}, pending: {} };
async function hex(buf) {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function load(id) {
  if (D.data[id] !== undefined) return Promise.resolve(D.data[id]);
  if (D.pending[id]) return D.pending[id];
  const s = SOURCES[id];
  const p = (async () => {
    const raw = await getURL(s.url, s.as === 'u32' ? 'buf' : (s.sha ? 'buf' : s.as), () => setRow(id, 'LOAD'));
    let value = raw, shaNote = '';
    if (s.sha) {
      const prov = await load('provenance');
      const want = (prov.numbered_database || []).find(x => x.url === s.url);
      if (!want) shaNote = ' · no digest recorded in the catalogue provenance for this address';
      else if (!(globalThis.crypto && crypto.subtle)) shaNote = ' · bytes not checked: this browser gave no SubtleCrypto here';
      else {
        const got = await hex(raw);
        if (got !== want.sha256) throw new Error(`served bytes have sha256 ${got.slice(0, 12)}, the catalogue pins ${want.sha256.slice(0, 12)}; refused`);
        shaNote = ` · sha256 ${got.slice(0, 12)} matches the catalogue provenance`;
      }
      value = s.as === 'u32' ? new Uint32Array(raw) : JSON.parse(new TextDecoder().decode(raw));
    }
    D.data[id] = value;
    const n = Array.isArray(value) ? `${fmt(value.length)} records` : value instanceof Uint32Array ? `${fmt(value.length)} keys` : 'read';
    setRow(id, Array.isArray(value) && !value.length ? 'EMPTY' : 'OK', `${s.url} · ${n}${shaNote}`);
    index(id, value);
    return value;
  })();
  D.pending[id] = p;
  p.catch(e => { delete D.pending[id]; setRow(id, 'FAIL', e.message); });
  return p;
}

const I = {};
function index(id, v) {
  if (id === 'elements') { I.el = new Map(v.map(e => [e.key, e])); }
  if (id === 'functions') { I.fn = new Map(v.map(f => [f.key, f])); }
  if (id === 'surfaces') { I.surf = new Map(v.map(s => [s.key, s])); }
  if (id === 'families') { I.fam = new Map(v.map((f, i) => [f.n, i])); }
  const c = [];
  if (D.data.elements) c.push(`${fmt(D.data.elements.length)} elements`);
  if (D.data.apps) c.push(`${fmt(D.data.apps.length)} apps`);
  if (D.data.surfaces) c.push(`${fmt(D.data.surfaces.length)} surfaces`);
  if (D.data.functions) c.push(`${fmt(D.data.functions.length)} functions over 10 lines`);
  if (D.data.allLines) c.push(`${fmt(D.data.allLines.length)} numbered lines`);
  $('counts').textContent = c.length ? c.join(' · ') + ' (counted from the files loaded)' : '';
}
const ensure = level => Promise.all(LEVEL_NEEDS[level].map(load));

/* ── state ─────────────────────────────────────────────────────────────────── */
const S = { level: 0, gate: 2, element: 'block:Vd', family: null, ringLine: -1, surface: null, engineFile: null, zoom: 1, pan: [0, 0], note: '' };
let token = 0;
let wafer = null;
const mol = $('mol');
let hits = [];
let anim = null;

function refuse(msg, kind = 'refusal') { const r = $('refusal'); r.textContent = msg; r.hidden = !msg; r.dataset.kind = kind; }
function setCard(title, sub) { $('title').textContent = title; $('sub').textContent = sub; }
function actions(...nodes) { $('actions').replaceChildren(...nodes); }
function button(label, fn, cls) { const b = el('button', cls, label); b.type = 'button'; b.addEventListener('click', fn); return b; }
function sayGate(t) { $('gatesay').textContent = t; }

function writeURL() {
  const q = new URLSearchParams();
  q.set('level', String(S.level));
  const key = S.level === 1 && S.family != null ? (S.ringLine >= 0 ? `line:${S.ringLine}` : `family:${S.family}`)
    : S.level === 3 && S.surface ? S.surface : S.element;
  if (key) q.set('key', key);
  history.replaceState(null, '', '?' + q.toString());
}

async function setLevel(L, why) {
  const mine = ++token;
  S.level = L;
  if (anim) { cancelAnimationFrame(anim); anim = null; }
  for (const b of document.querySelectorAll('#rail button')) b.setAttribute('aria-pressed', String(+b.dataset.level === L));
  if (Math.round(S.gate) !== L) S.gate = L;
  $('gate').value = String(S.gate);
  $('wafer').style.visibility = L === 1 ? 'visible' : 'hidden';
  $('result').replaceChildren(); $('handoff').replaceChildren();
  sayGate(`gate ${L}: loading ${LEVEL_NEEDS[L].length} sources${why ? ' · ' + why : ''}`);
  try { await ensure(L); }
  catch (e) {
    if (mine !== token) return;
    setCard('Could not load this level', e.message);
    sayGate(`gate ${L}: FAIL · ${e.message}`);
    return;
  }
  if (mine !== token) return;
  S.zoom = 1; S.pan = [0, 0];
  paint();
  writeURL();
}
function paint() {
  refuse(S.note, 'note'); S.note = '';
  if (S.level === 1) paint1(); else if (S.level === 2) paint2(); else if (S.level === 3) paint3(); else if (S.level === 4) paint4();
}

/* ── helpers over the catalogue ───────────────────────────────────────────── */
const famN = key => +String(key).split(':')[1];
const engineFiles = e => (e.files || []).filter(f => f.repo === ENGINE_REPO && /^engine\/[A-Za-z0-9._-]+\.js$/.test(f.path) && f.commit === PIN);
/* A register reference is drawn as a bond only when both ends are elements of the
   catalogue; the rest are listed as references to blocks not in the register.
   Being drawn does not make an edge checked: the register's method is name-match inference. */
const bonded = list => list.filter(k => I.el.has(k));
const dangling = list => list.filter(k => !I.el.has(k));
const stateWords = e => `kind: ${e.kind} · state: ${e.state ? e.state : 'not recorded in the register'}`;

/* words a grid challenge is named by; matched only in the element's own title and description */
const CHALLENGE_WORDS = ['connection', 'capacity', 'fault', 'voltage', 'cable', 'trench', 'route', 'demand', 'electrification', 'interconnector',
  'substation', 'network', 'transformer', 'solar', 'bess', 'battery', 'power factor', 'distance', 'nearest', 'grid', 'topology', 'single-line',
  'protection', 'earthing', 'busbar', 'feeder', 'heat pump', 'renewable', 'firm', 'losses', 'reactive', 'transmission', 'distribution', 'headroom', 'queue', 'export', 'import'];
function challengeFrom(e) {
  const text = `${e.title}. ${e.description === 'description not yet written' ? '' : e.description}`;
  const found = CHALLENGE_WORDS.filter(w => new RegExp(`\\b${w.replace('-', '\\-')}s?\\b`, 'i').test(text));
  if (!found.length) return { found, say: 'not stated: the element\'s own title and description name no grid challenge.' };
  const sentences = text.split(/(?<=\.)\s+/).filter(s => found.some(w => new RegExp(`\\b${w.replace('-', '\\-')}s?\\b`, 'i').test(s)));
  return { found, say: `its own words name ${found.join(', ')}: ${sentences.map(s => `"${s.trim()}"`).join(' ')} Beyond those words, not stated.` };
}
function dl(pairs) {
  const d = el('dl');
  for (const [k, v] of pairs) { d.append(el('dt', null, k)); const dd = el('dd'); if (v instanceof Node) dd.append(v); else dd.textContent = v; d.append(dd); }
  return d;
}

/* The three questions and the grid-challenge question, for one element. */
function elementQuestions(e, lead) {
  const eng = engineFiles(e);
  const mapped = eng.find(f => SLD[f.path]);
  const sld = el('span');
  if (mapped) {
    const m = SLD[mapped.path];
    sld.textContent = `${m.element}: ${mapped.path} → ${m.fn}() at ${PIN.slice(0, 7)} (the module-to-element table of iteration 31). `;
    const chk = el('span', 'dim', 'Open this panel to check the function in the source.');
    sld.append(chk);
    sldCheck = { path: mapped.path, fn: m.fn, span: chk };
    if ($('questions').open) runSldCheck();
  } else {
    sldCheck = null;
    sld.textContent = `none yet: ${e.key} records ${eng.length ? 'engine modules (' + eng.map(f => f.path).join(', ') + ') that the page\'s module-to-element table does not map' : 'no engine module the page\'s module-to-element table maps'} to a busbar, feeder, transformer, cable route, protection or earthing.`;
  }
  const names = e.function_keys.map(k => I.fn && I.fn.get(k) ? `${k} ${I.fn.get(k).name || '(name not yet known)'}` : `${k} (10 lines or fewer, or not in the numbered database: not in the catalogue)`);
  const files = (e.files || []).slice(0, 6).map(f => `${f.repo}/${f.path}@${(f.commit || 'no commit').slice(0, 7)}`);
  const ub = bonded(e.used_by), db = bonded(e.depends_on), gone = [...new Set([...dangling(e.depends_on), ...dangling(e.used_by)])];
  const used = ub.length ? `used by ${ub.slice(0, 12).join(', ')}${ub.length > 12 ? ` and ${fmt(ub.length - 12)} more` : ''} (register, name-match inference)` : 'the register records no used_by that names an element of the catalogue';
  const next = [];
  if (db.length) next.push(`depends on ${db.join(', ')}`);
  if (ub.length) next.push(`leads to ${ub.slice(0, 12).join(', ')}${ub.length > 12 ? ` and ${fmt(ub.length - 12)} more` : ''}`);
  if (gone.length) next.push(`reference to a block not in the register, not drawn: ${gone.join(', ')}`);
  const ch = challengeFrom(e);
  return dl([
    ...(lead ? [['this view', lead]] : []),
    ['1. How does this help draw a system or a single-line diagram?', sld],
    ['2. What is this code used for?', `${e.key} ${e.title}: "${e.description}" (the register's own words) · ${stateWords(e)} · functions: ${names.slice(0, 10).join('; ')}${names.length > 10 ? `; and ${names.length - 10} more` : ''}${names.length ? '' : 'none listed'} · files: ${files.join(', ') || 'none recorded'}${e.files.length > 6 ? ` and ${e.files.length - 6} more` : ''} · ${used}`],
    ['3. Where does it lead next?', next.length ? next.join(' · ') + ' (register depends_on / used_by, name-match inference; unchecked)' : `not established: the register records no depends_on and no used_by for ${e.key}.`],
    ['Which grid challenge could this help with?', ch.say]
  ]);
}
let sldCheck = null;
async function runSldCheck() {
  if (!sldCheck) return;
  const c = sldCheck;
  SOURCES.module.url = ENGINE_RAW + c.path;
  setRow('module', 'LOAD', SOURCES.module.url);
  try {
    const t = await getURL(ENGINE_RAW + c.path, 'text');
    const ok = new RegExp(`export\\s+function\\s+${c.fn}\\b`).test(t);
    setRow('module', 'OK', `${ENGINE_RAW + c.path} · ${fmt(t.split('\n').length)} lines`);
    c.span.textContent = ok ? `Checked: ${c.path} at ${PIN.slice(0, 7)} exports function ${c.fn}.` : `Withheld: ${c.path} at ${PIN.slice(0, 7)} exports no function ${c.fn}, so this answer is not established.`;
  } catch (e) { setRow('module', 'FAIL', e.message); c.span.textContent = 'Not checked: ' + e.message; }
}

/* ── canvas for levels 2 to 4 ─────────────────────────────────────────────── */
function molSetup() {
  const r = mol.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
  if (mol.width !== W || mol.height !== H) { mol.width = W; mol.height = H; }
  const c = mol.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, r.width, r.height);
  const k = Math.min(r.width, r.height) / 400 * S.zoom * Math.pow(2, (S.level - S.gate) * 1.6);
  const cx = r.width / 2 + S.pan[0], cy = r.height / 2 + S.pan[1];
  return { c, w: r.width, h: r.height, k, cx, cy, P: (x, y) => [cx + x * k, cy + y * k] };
}
function circle(c, x, y, r, fill, stroke, lw) { c.beginPath(); c.arc(x, y, Math.max(0.5, r), 0, 6.2832); if (fill) { c.fillStyle = fill; c.fill(); } if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || 1; c.stroke(); } }
function label(c, t, x, y, col, size, align) { c.font = `${size || 11}px ui-monospace,Menlo,Consolas,monospace`; c.textAlign = align || 'center'; c.lineWidth = 3; c.strokeStyle = '#000'; c.strokeText(t, x, y); c.fillStyle = col || '#d8dee9'; c.fillText(t, x, y); }

/* A molecule: atoms on a golden spiral around the element's nucleus, sized by
   lines; neighbours on an outer ring, depends_on above and used_by below. */
function moleculeLayout(e) {
  const atoms = e.function_keys.map((key, i) => {
    const f = I.fn && I.fn.get(key);
    const a = i * GOLDEN, rad = 58 + 19 * Math.sqrt(i);
    return { key, f, x: rad * Math.cos(a), y: rad * Math.sin(a), r: f ? Math.min(20, 3 + 1.6 * Math.sqrt(f.lines)) : 3.5 };
  });
  const ring = (list, a0, a1, rel) => list.map((key, i) => {
    const a = list.length === 1 ? (a0 + a1) / 2 : a0 + (a1 - a0) * (i / (list.length - 1));
    return { key, rel, x: 172 * Math.cos(a), y: 172 * Math.sin(a) };
  });
  const neigh = [...ring(bonded(e.depends_on), Math.PI * 1.1, Math.PI * 1.9, 'depends on'), ...ring(bonded(e.used_by), Math.PI * 0.1, Math.PI * 0.9, 'used by')];
  return { atoms, neigh };
}
function drawMolecule(e, G, opts = {}) {
  const { c, P, k } = G;
  const L = moleculeLayout(e);
  const [nx, ny] = P(0, 0);
  const showNeighLabels = L.neigh.length <= 14 || k > 1.6;
  for (const n of L.neigh) {
    const [x, y] = P(n.x, n.y);
    c.setLineDash([5, 4]); c.strokeStyle = n.rel === 'depends on' ? '#5ec8f2' : '#8b93a7'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(nx, ny); c.lineTo(x, y); c.stroke(); c.setLineDash([]);
    const ne = I.el.get(n.key);
    circle(c, x, y, 9 * Math.min(1.4, k), '#0b0d12', n.rel === 'depends on' ? '#5ec8f2' : '#8b93a7', 1.2);
    if (showNeighLabels) label(c, ne ? ne.symbol : n.key, x, y + 4, '#d8dee9', 10);
    hits.push({ x, y, r: 14, kind: 'neighbour', key: n.key, rel: n.rel });
  }
  for (const a of L.atoms) {
    const [x, y] = P(a.x, a.y);
    c.strokeStyle = '#2a3040'; c.lineWidth = 1; c.beginPath(); c.moveTo(nx, ny); c.lineTo(x, y); c.stroke();
  }
  for (const a of L.atoms) {
    const [x, y] = P(a.x, a.y), sel = S.family === famN(a.key);
    circle(c, x, y, a.r * k + 3, '#000');
    circle(c, x, y, a.r * k, a.f ? (sel ? '#ffd54a' : '#c9a93c') : null, a.f ? null : '#8b93a7', 1);
    if (sel) circle(c, x, y, a.r * k + 5, null, '#ffffff', 1.2);
    if (k > 1.25 || L.atoms.length <= 8) label(c, a.f && a.f.name ? a.f.name : '#' + famN(a.key), x, y - a.r * k - 5, '#8b93a7', 9.5);
    hits.push({ x, y, r: Math.max(12, a.r * k + 4), kind: 'atom', key: a.key });
  }
  circle(c, nx, ny, 26 * k, '#0b0d12', opts.ring || '#ffd54a', 1.6);
  label(c, e.symbol, nx, ny + 5 * Math.min(k, 1.6), '#ffd54a', Math.round(15 * Math.min(k, 1.6)));
  hits.push({ x: nx, y: ny, r: 26 * k, kind: 'nucleus', key: e.key });
  return { L, nx, ny };
}

/* ── level 1: lines -> function ───────────────────────────────────────────── */
function defaultFamily(e) {
  if (!e) return null;
  const inCat = e.function_keys.find(k => I.fn.has(k));
  return inCat ? famN(inCat) : e.function_keys.length ? famN(e.function_keys[0]) : null;
}
function paint1() {
  const fams = D.data.families, lines = D.data.lines;
  if (!wafer) {
    wafer = new Wafer($('wafer'), mol);
    wafer.init(D.data.allLines);
  }
  wafer.resize();
  const e = I.el.get(S.element);
  if (S.family == null) S.family = defaultFamily(e);
  hits = [];
  if (S.family == null) {
    wafer.setRun([]); wafer.render();
    setCard('Lines → function: EMPTY', `${S.element} lists no function key, so no function's lines can be lit. Type family:<n> or line:<n>.`);
    actions(); fillQuestions(e ? elementQuestions(e, 'no function chosen') : el('span', null, 'not established: no element chosen.'));
    fillMachine(dl([['state', 'EMPTY: no family key']])); sayGate('gate 1 · EMPTY'); return;
  }
  const fi = I.fam.get(S.family);
  if (fi === undefined) {
    wafer.setRun([]); wafer.render();
    setCard(`family:${S.family}: EMPTY`, `family:${S.family} is not in the numbered database (${fmt(fams.length)} families), so it has no key list to light.`);
    actions(); fillMachine(dl([['state', 'EMPTY: family not in families.json']])); sayGate('gate 1 · EMPTY'); return;
  }
  const fam = fams[fi];
  const seq = Array.from(lines.subarray(fam.lineOffset, fam.lineOffset + fam.lineCount));
  const distinct = new Set(seq).size;
  const cat = I.fn.get(`family:${fam.n}`);
  const block = I.el.get(`block:${fam.block}`);
  wafer.setRun(seq, S.ringLine);
  wafer.frame();
  const t0 = performance.now(), dur = Math.min(2400, 500 + seq.length * 12);
  const step = t => { wafer.head = Math.min(1, (t - t0) / dur); wafer.render(); anim = wafer.head < 1 ? requestAnimationFrame(step) : null; };
  wafer.head = 0; anim = requestAnimationFrame(step);

  setCard(`family:${fam.n} ${fam.name || '(name not yet known)'}`,
    `${fmt(seq.length)} line occurrences, ${fmt(distinct)} distinct lines, lit in sequence order from line:${seq[0]} (white ring) to line:${seq[seq.length - 1]} (cyan ring). These are the sequence's endpoints, not a numeric range. ${cat ? 'In the elements catalogue.' : 'Not in the elements catalogue (it lists functions over 10 lines); read from the numbered database.'} ${S.ringLine >= 0 ? `Amber ring: line:${S.ringLine}.` : ''}`);
  actions(
    button('replay the run', () => { paint1(); }),
    ...(block ? [button(`its element ${block.key} (level 2)`, () => { S.element = block.key; setLevel(2, 'from level 1'); })] : [])
  );
  const endpoints = cat ? (cat.first_line === `line:${seq[0]}` && cat.last_line === `line:${seq[seq.length - 1]}`
    ? `catalogue first_line ${cat.first_line} and last_line ${cat.last_line} are the first and last entries of this sequence`
    : `catalogue says ${cat.first_line} … ${cat.last_line}, the sequence reads line:${seq[0]} … line:${seq[seq.length - 1]}: they disagree, shown as found`) : 'no catalogue record to compare';
  buttonRow({ type: 'function', key: `family:${fam.n}`, family: fam.n, firstLine: seq[0], element: block || null });
  fillQuestions(block ? elementQuestions(block, `family:${fam.n} ${fam.name || ''} is one of the functions inside ${block.key} (families.json block field).`)
    : dl([['1. How does this help draw a system or a single-line diagram?', `none yet: family:${fam.n} names pack block ${fam.block}, which is not in the register, so no element is known.`],
      ['2. What is this code used for?', `${fam.kind} ${fam.name || '(name not yet known)'} · found in ${fam.repos} repositories and ${fam.files} files`],
      ['3. Where does it lead next?', `not established: pack block ${fam.block} is not in the current register.`],
      ['Which grid challenge could this help with?', 'not stated: no element title or description is available.']]));
  machine1 = () => dl([
    ['input', `family key family:${fam.n}${S.ringLine >= 0 ? `, reached from line:${S.ringLine}` : ''}`],
    ['read', `families.json record: lineOffset ${fam.lineOffset}, lineCount ${fam.lineCount} → lines.bin entries ${fam.lineOffset} to ${fam.lineOffset + fam.lineCount - 1} (little-endian uint32 keys)`],
    ['output', `${fmt(seq.length)} line occurrences, ${fmt(distinct)} distinct lines; ${endpoints}`],
    ['drawn', `ground ${fmt(wafer.groundN)} dark keys (GPU, one buffer); lit ${fmt(wafer.litN)} keys (one buffer, refilled per function); run line ${wafer.gl ? `${fmt(wafer.runSegs)} segments (GPU, one buffer, refilled per function)` : 'stroked on the 2D overlay (no WebGL)'}; run keys on screen now ${fmt(wafer.drawnLit)}; median frame ${median(wafer.frames).toFixed(2)} ms`],
    ['placement', 'r = sqrt(key), theta = key x golden angle (lib.mjs place)'],
    ['catalogue record', cat ? `${cat.key} · ${cat.lines} lines · ${cat.category || 'no category'} · block ${cat.block}` : 'none (10 lines or fewer)'],
    ['sources', `numbered database ${DATA} (bytes checked against catalogue provenance) · catalogue commit ${CAT_COMMIT.slice(0, 7)}`]
  ]);
  fillMachine(machine1());
  sayGate(`gate 1 · lines → function · drag, pinch or scroll · zoom out past the gate for level 2`);
}
let machine1 = null;
const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

/* ── level 2: functions -> element ─────────────────────────────────────────── */
function paint2() {
  const e = I.el.get(S.element);
  if (!e) { setCard('Functions → element: EMPTY', `${S.element} is not in the elements catalogue.`); return; }
  draw2();
  const inCat = e.function_keys.filter(k => I.fn.has(k)).length;
  setCard(`${e.key} ${e.title}`, `${stateWords(e)} · ${e.category_title} · ${fmt(e.function_keys.length)} function keys inside (${fmt(inCat)} in the catalogue, drawn filled and sized by lines; hollow: 10 lines or fewer, or not in the numbered database) · bonds drawn: ${fmt(bonded(e.depends_on).length)} depends_on, ${fmt(bonded(e.used_by).length)} used_by${dangling([...e.depends_on, ...e.used_by]).length ? ` · reference to a block not in the register, not drawn: ${[...new Set(dangling([...e.depends_on, ...e.used_by]))].join(', ')}` : ''}.`);
  actions(
    ...(defaultFamily(e) != null ? [button('light its lines (level 1)', () => { S.family = S.family != null && e.function_keys.includes(`family:${S.family}`) ? S.family : defaultFamily(e); S.ringLine = -1; setLevel(1, 'from level 2'); })] : []),
    button('its app or surface (level 3)', () => { S.surface = null; setLevel(3, 'from level 2'); }),
    button('in action (level 4)', () => setLevel(4, 'from level 2'))
  );
  buttonRow({ type: e.kind === 'app' ? 'app' : 'element', key: e.key, element: e });
  fillQuestions(elementQuestions(e));
  fillMachine(dl([
    ['input', `element key ${e.key} (register number ${e.number})`],
    ['atoms', `${fmt(e.function_keys.length)} function keys from the register's inside list: ${e.function_keys.join(', ') || 'none'}`],
    ['atom size', 'radius 3 + 1.6 x sqrt(lines), capped at 20, lines from functions.json'],
    ['bonds', `drawn only when both ends are catalogue elements · depends_on: ${bonded(e.depends_on).join(', ') || 'none'} · used_by: ${bonded(e.used_by).join(', ') || 'none'} · not drawn (reference to a block not in the register): ${[...new Set(dangling([...e.depends_on, ...e.used_by]))].join(', ') || 'none'} (register fields, name-match inference, unchecked; the grey spokes are membership, not bonds, and no function-to-function edge is recorded)`],
    ['not in the numbered database', e.functions_not_in_numbered_database.join(', ') || 'none'],
    ['source', `${CAT}elements.json and functions.json at commit ${CAT_COMMIT.slice(0, 7)}`]
  ]));
  sayGate(`gate 2 · functions → element · tap an atom or a bonded element · pinch in past the gate for level 1, out for level 3`);
}
function draw2(extra, glow = -1) {
  const e = I.el.get(S.element); if (!e) return;
  hits = [];
  const G = molSetup();
  const r = drawMolecule(e, G);
  label(G.c, 'depends on (name-match inference)', G.w / 2, 16, '#5ec8f2', 10);
  label(G.c, 'used by (name-match inference)', G.w / 2, G.h - 52, '#8b93a7', 10);
  if (extra) extra(G, r);
  if (glow >= 0) {                                    /* a press: atoms light in register order, then the flow leaves the molecule */
    const n = r.L.atoms.length, lit = Math.floor(glow * 1.4 * n);
    for (let i = 0; i < Math.min(lit, n); i++) { const a = r.L.atoms[i]; const [x, y] = G.P(a.x, a.y); circle(G.c, x, y, a.r * G.k + 4, null, '#ffffff', 1.6); }
    flowOut(G.c, r.nx, r.ny, G.w, glow);
  }
  return { G, r };
}
function flowOut(c, x, y, w, u) {
  if (u < 0.5) return;
  const q = (u - 0.5) * 2;
  c.strokeStyle = 'rgba(94,200,242,0.6)'; c.lineWidth = 1; c.beginPath(); c.moveTo(x, y); c.lineTo(x + (w - x) * q, y); c.stroke();
  for (let j = 0; j < 5; j++) { const t = q - j * 0.12; if (t >= 0 && t <= 1) circle(c, x + (w - x) * t, y, 3.5, '#ffd54a'); }
}

/* ── the button row (GRID pattern: imported on first press; MAP pattern: deep links) ── */
const BUTTONS = ['WAFER', 'RUN', 'APP', 'SPIDER', 'CODE', 'TOOLS'];
const SPIDER_MANIFEST = CDN + 'spider/manifest.json';
const LAYERS_URL = new URL('../../layers/manifest.json', import.meta.url).href;
const EV = { imports: 0, fetches: 0, presses: 0, reasons: 0, handoffs: 0 };
function showEvidence() {
  $('evidence').textContent = `evidence: actions module imported ${EV.imports} · fetched on press ${EV.fetches} · presses ${EV.presses} · reasons given ${EV.reasons} · hand-offs ${EV.handoffs}`;
}
let actionsMod = null, actionsLoading = null;
function loadActions() {
  if (actionsMod) return Promise.resolve(actionsMod);
  if (!actionsLoading) {
    actionsLoading = import('./actions.mjs').then(m => {
      EV.imports += 1;
      if (EV.imports !== 1) throw new Error('the actions module was imported more than once');
      if (m.ACTIONS_CONTRACT.additive_only !== true) throw new Error('the actions module is no longer additive-only');
      actionsMod = m; showEvidence(); return m;
    });
    actionsLoading.catch(() => { actionsLoading = null; });
  }
  return actionsLoading;
}
function buttonRow(t, host) {
  const row = host || $('btnrow');
  const out = host ? el('div', 'handoff') : $('handoff');
  row._out = out;
  row.replaceChildren(...BUTTONS.map(n => {
    const b = el('button', null, n); b.type = 'button'; b.dataset.action = n;
    b.addEventListener('click', () => pressButton(n, t, b, row));
    return b;
  }));
  if (!host) $('handoff').replaceChildren();
  showEvidence();
  return host ? [row, out] : row;
}
async function pressButton(name, t, b, row) {
  const out = row._out;
  EV.presses += 1; showEvidence();
  b.disabled = true;
  out.replaceChildren(el('div', 'dim', `${name} · LOAD`));
  try {
    const m = await loadActions();
    const ctx = {
      I, D, engineFiles, FIXTURES, NOT_RECORDED, SPIDER_MANIFEST, LAYERS_URL,
      getJSON: async url => { const had = urlCache.has(url); const v = await getURL(url, 'json'); if (!had) { EV.fetches += 1; showEvidence(); } return v; }
    };
    const r = await m.press(name, t, ctx);
    if (r.kind === 'reason') {
      EV.reasons += 1; showEvidence(); b.dataset.state = 'reason';
      out.replaceChildren(el('div', 'refuse', `${name}: ${r.text}`)); out.dataset.last = name + ':reason';
      return;
    }
    await animatePress();
    EV.handoffs += 1; showEvidence();
    if (r.kind === 'link') {
      const a = el('a', 'btn', `${name} ↗`); a.href = r.href; a.target = '_blank'; a.rel = 'noopener'; a.dataset.handoff = name;
      out.replaceChildren(a, el('span', 'dim', ` ${r.text}`)); out.dataset.last = name + ':link';
    } else {
      const g = r.go;
      if (g.family != null) { S.family = g.family; S.ringLine = -1; }
      if (g.element) S.element = g.element;
      if (g.engineFile) S.engineFile = g.engineFile;
      await setLevel(g.level, name);
      const deep = el('a', null, 'deep link'); deep.href = r.deep; deep.dataset.handoff = name;
      $('handoff').replaceChildren(el('span', 'dim', `${name}: ${r.text} · `), deep); $('handoff').dataset.last = name + ':internal';
      if (g.run) { const e = I.el.get(S.element); await run4(e, S.engineFile, FIXTURES[S.engineFile]); }
    }
  } catch (e) {
    out.replaceChildren(el('div', 'refuse', `${name} FAIL · ${e.message}`)); out.dataset.last = name + ':fail';
  } finally { b.disabled = false; }
}
function animatePress() {
  return new Promise(res => {
    if (anim) { cancelAnimationFrame(anim); anim = null; }
    const t0 = performance.now(), dur = 900;
    const step = now => {
      const u = Math.min(1, (now - t0) / dur);
      glowFrame(u);
      if (u < 1) anim = requestAnimationFrame(step); else { anim = null; glowFrame(-1); res(); }
    };
    anim = requestAnimationFrame(step);
  });
}
function glowFrame(u) {
  if (S.level === 1 && wafer) { wafer.head = u < 0 ? 1 : u; wafer.render(); }
  else if (S.level === 2) draw2(null, u);
  else if (S.level === 3) draw3(u);
  else if (S.level === 4) draw4(lastRun ? 1 : 0, undefined, u);
}

/* ── level 3: elements -> app or surface ──────────────────────────────────── */
function folderOf(u) { return u.slice(0, u.lastIndexOf('/') + 1); }
function assemblyTarget() {
  const e = I.el.get(S.element);
  if (S.surface && I.surf.get(S.surface)) return { kind: 'surface', s: I.surf.get(S.surface), e };
  if (e && e.kind === 'app') return { kind: 'app', e };
  if (e) {
    const s = D.data.surfaces.find(x => x.blocks.includes(e.key));
    if (s) { S.surface = s.key; return { kind: 'surface', s, e }; }
  }
  return { kind: 'none', e };
}
function paint3() {
  const T = assemblyTarget();
  hits = [];
  if (T.kind === 'none') {
    const G = molSetup(); label(G.c, 'EMPTY', G.w / 2, G.h / 2, '#ffb86b', 14);
    setCard(`${S.element}: no assembly`, `EMPTY: ${S.element} records no live address, so no served surface assembles it, and it is not of kind app.`);
    actions(button('back to its molecule (level 2)', () => setLevel(2)));
    if (T.e) buttonRow({ type: 'element', key: T.e.key, element: T.e });
    if (T.e) fillQuestions(elementQuestions(T.e)); fillMachine(dl([['state', 'EMPTY: no live address recorded']]));
    return;
  }
  let centre, inner, outer = [], link, title, sub;
  if (T.kind === 'app') {
    const e = T.e, folders = new Set(e.live.map(folderOf));
    const co = new Set();
    for (const s of D.data.surfaces) if (folders.has(s.url)) for (const b of s.blocks) if (b !== e.key) co.add(b);
    inner = [...co]; outer = bonded(e.depends_on).filter(k => !co.has(k));
    centre = { sym: e.symbol, key: e.key };
    link = e.live.find(u => /\.html?$|\/$/.test(u)) || [...folders][0];
    title = `${e.key} ${e.title} (app)`;
    sub = `${stateWords(e)} · assembled from ${fmt(inner.length)} elements served in the same folders (inner ring, surfaces.json) and ${fmt(outer.length)} more it depends on (outer ring, register, name-match inference).`;
  } else {
    const s = T.s;
    inner = s.blocks; centre = { sym: 'surface', key: s.key };
    link = s.url;
    title = s.key;
    sub = `${s.description} (catalogue words) · ${fmt(inner.length)} elements drawn as small molecules, each sized by its function keys.`;
  }
  const place3 = (list, rad, rel) => list.map((key, i) => {
    const a = -Math.PI / 2 + i * (2 * Math.PI / Math.max(1, list.length));
    return { key, rel, x: rad * Math.cos(a), y: rad * Math.sin(a) };
  });
  const nodes = [...place3(inner, inner.length > 24 ? 150 : 110, 'served together'), ...place3(outer, 185, 'depends on')];
  L3 = { nodes, centre };
  draw3();
  setCard(title, sub);
  const a = el('a', 'btn', T.kind === 'app' ? 'open the app' : 'open the served folder');
  a.href = link; a.target = '_blank'; a.rel = 'noopener';
  const surfacesOfEl = T.e ? D.data.surfaces.filter(s => s.blocks.includes(T.e.key)) : [];
  const nodesOut = [a];
  if (T.kind === 'surface' && surfacesOfEl.length > 1) {
    const sel = el('select'); sel.setAttribute('aria-label', 'surfaces serving this element');
    for (const s of surfacesOfEl) { const o = el('option', null, s.title); o.value = s.key; o.selected = s.key === S.surface; sel.append(o); }
    sel.addEventListener('change', () => { S.surface = sel.value; paint3(); writeURL(); });
    nodesOut.push(sel);
  }
  nodesOut.push(button('element molecule (level 2)', () => setLevel(2)));
  actions(...nodesOut);
  buttonRow(T.kind === 'app' ? { type: 'app', key: T.e.key, element: T.e } : { type: 'surface', key: T.s.key, surface: T.s });
  finish3(T, nodes, link);
}
let L3 = null;
function draw3(glow = -1) {
  if (!L3) return;
  hits = [];
  const { nodes, centre } = L3;
  const G = molSetup();
  const { c, P, k } = G;
  const [cx0, cy0] = P(0, 0);
  const labels = nodes.length <= 16 || k > 1.6;
  for (const n of nodes) {
    const [x, y] = P(n.x, n.y);
    c.strokeStyle = n.rel === 'depends on' ? '#5ec8f2' : '#2a3040'; c.setLineDash(n.rel === 'depends on' ? [5, 4] : []);
    c.lineWidth = 1; c.beginPath(); c.moveTo(cx0, cy0); c.lineTo(x, y); c.stroke(); c.setLineDash([]);
  }
  for (const n of nodes) {
    const ne = I.el.get(n.key), [x, y] = P(n.x, n.y);
    const fk = ne ? ne.function_keys.length : 0, R = (6 + 2.2 * Math.sqrt(fk)) * Math.min(k, 1.8);
    circle(c, x, y, R + 2, '#000'); circle(c, x, y, R, '#0b0d12', S.element === n.key ? '#ffd54a' : '#8b93a7', 1.2);
    for (let j = 0; j < Math.min(fk, 24); j++) {         /* its atoms, at most 24, as the register lists them */
      const a = j * GOLDEN, rr = R * 0.25 + R * 0.6 * Math.sqrt(j / 24);
      circle(c, x + rr * Math.cos(a), y + rr * Math.sin(a), Math.max(0.8, R * 0.09), '#c9a93c');
    }
    if (labels) label(c, ne ? ne.symbol : n.key, x, y + R + 11, '#d8dee9', 10);
    hits.push({ x, y, r: Math.max(12, R + 3), kind: 'element', key: n.key, rel: n.rel });
  }
  circle(c, cx0, cy0, 30 * Math.min(k, 1.6), '#0b0d12', '#ffffff', 1.6);
  label(c, centre.sym, cx0, cy0 + 4, '#ffffff', 11);
  if (glow >= 0) {                                    /* a press: elements light in turn, then the flow leaves the assembly */
    const lit = Math.floor(glow * 1.4 * nodes.length);
    for (let i = 0; i < Math.min(lit, nodes.length); i++) { const [x, y] = P(nodes[i].x, nodes[i].y); circle(c, x, y, 7, null, '#ffffff', 1.6); }
    flowOut(c, cx0, cy0, G.w, glow);
  }
}
function finish3(T, nodes, link) {
  if (T.kind === 'app') fillQuestions(elementQuestions(T.e, `the app ${T.e.key} and the elements that assemble it`));
  else fillQuestions(dl([
    ['this view', `${T.s.key}, a served folder`],
    ['1. How does this help draw a system or a single-line diagram?', 'none yet: a served folder is an address, not a diagram element. Tap one of its elements for its own answer.'],
    ['2. What is this code used for?', `${T.s.description} (catalogue words); the elements served here: ${T.s.blocks.slice(0, 20).map(b => { const x = I.el.get(b); return x ? `${b} ${x.title}` : b; }).join('; ')}${T.s.blocks.length > 20 ? `; and ${T.s.blocks.length - 20} more` : ''}`],
    ['3. Where does it lead next?', `to its elements, then to what each one's register entry depends on or is used by (tap one); the folder itself records no onward link.`],
    ['Which grid challenge could this help with?', 'not stated: a served folder has no title or description of its own beyond its address.']
  ]));
  fillMachine(dl([
    ['input', T.kind === 'app' ? `app key ${T.e.key}` : `surface key ${T.s.key}`],
    ['assembly rule', T.kind === 'app' ? 'inner ring: blocks listed by the surfaces (surfaces.json) whose folder is a folder of the app\'s live addresses; outer ring: the app\'s depends_on not already inner' : 'ring: the blocks surfaces.json lists for this folder'],
    ['drawn', `${fmt(nodes.length)} elements on one canvas, no DOM node per element; labels shown when 16 or fewer or zoomed in`],
    ['link', `${link} (an address the register records, opened as recorded)`],
    ['source', `${CAT}surfaces.json, apps.json, elements.json at commit ${CAT_COMMIT.slice(0, 7)}`]
  ]));
  sayGate(`gate 3 · elements → ${T.kind} · tap an element for its molecule · pinch in for level 2, out for level 4`);
}

/* ── level 4: in action ───────────────────────────────────────────────────── */
let lastRun = null;
function paint4() {
  const e = I.el.get(S.element);
  if (!e) return;
  const eng = engineFiles(e);
  const runnable = eng.filter(f => FIXTURES[f.path]);
  if (!S.engineFile || !eng.some(f => f.path === S.engineFile)) S.engineFile = (runnable[0] || eng[0] || {}).path || null;
  lastRun = lastRun && lastRun.key === e.key && lastRun.path === S.engineFile ? lastRun : null;
  draw4(lastRun ? 1 : 0);
  const fx = S.engineFile && FIXTURES[S.engineFile];
  let reason = null;
  if (!eng.length) reason = `no runnable input recorded: ${e.key} records no ventus-grid-engine engine module at ${PIN.slice(0, 7)}.`;
  else if (!fx) reason = `no runnable input recorded for ${S.engineFile}: ${NOT_RECORDED[S.engineFile] || 'this page holds no fixture for it'}.`;
  setCard(`${e.key} ${e.title}: in action`, reason || `Runs ${fx.fn}() from ${S.engineFile} at ${PIN.slice(0, 7)} with the first input its own proof calls it with (${fx.proof} line ${fx.line}), scenario input, in a worker with its network removed after the import.`);
  const acts = [];
  if (eng.length > 1) {
    const sel = el('select'); sel.setAttribute('aria-label', 'engine module of this element');
    for (const f of eng) { const o = el('option', null, f.path + (FIXTURES[f.path] ? '' : ' (no input recorded)')); o.value = f.path; o.selected = f.path === S.engineFile; sel.append(o); }
    sel.addEventListener('change', () => { S.engineFile = sel.value; lastRun = null; $('result').replaceChildren(); paint4(); });
    acts.push(sel);
  }
  if (fx) acts.push(button('run', () => run4(e, S.engineFile, fx), 'runbtn'));
  acts.push(button('molecule (level 2)', () => setLevel(2)));
  actions(...acts);
  buttonRow({ type: e.kind === 'app' ? 'app' : 'element', key: e.key, element: e });
  fillQuestions(elementQuestions(e, fx ? `${fx.fn}() run from ${S.engineFile}` : reason));
  fillMachine(machine4(e, fx, lastRun));
  sayGate(`gate 4 · in action · ${fx ? 'tap run' : 'no runnable input recorded'} · pinch in for level 3`);
}
function machine4(e, fx, R) {
  if (!fx) return dl([['input', `${e.key}`], ['run', 'none: no runnable input recorded'], ['engine files at the pin', engineFiles(e).map(f => f.path).join(', ') || 'none']]);
  const names = fx.names || (fx.args[0] && typeof fx.args[0] === 'object' ? Object.keys(fx.args[0]).map(n => `${n}${unitOf(n) ? ` (${unitOf(n)}, from the name)` : ''}`) : []);
  return dl([
    ['inputs', `${fx.fn}(${fx.args.map(a => JSON.stringify(a)).join(', ')}) · ${names.join(', ')} · scenario input from ${fx.proof} line ${fx.line}`],
    ['outputs', R ? (R.ok ? `${describe(R.result)}` : `refused: ${R.kind}: ${R.message}`) : 'not run yet'],
    ['refusals', 'a throw from the module is shown as the module states it; a proof whose text no longer holds the fixture refuses the run'],
    ['module', `${CDN}${S.engineFile}`],
    ['source commit', `${ENGINE_REPO}@${PIN}`]
  ]);
}
const UNIT = [['OhmPerKm', 'ohm per km'], ['Twh', 'terawatt-hours'], ['KwhPerYear', 'kilowatt-hours per year'], ['GbpPerMwh', 'pounds per megawatt-hour'], ['Mva', 'megavolt-amperes'], ['Kw', 'kilowatts'], ['Kv', 'kilovolts'], ['Hours', 'hours'], ['M', 'metres'], ['A', 'amperes']];
const WHOLE = { mva: 'megavolt-amperes', kv: 'kilovolts', kw: 'kilowatts', mw: 'megawatts' };
function unitOf(n) { if (WHOLE[n]) return WHOLE[n]; for (const [s, u] of UNIT) if (n.length > s.length && n.endsWith(s)) return u; return null; }
function describe(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if ('value' in v) return `value ${JSON.stringify(v.value)}${v.unit ? ' ' + v.unit : ''}${v.quantity ? ' · ' + v.quantity : ''} · fields: ${Object.keys(v).join(', ')}`;
  if (Array.isArray(v)) return `an array of ${fmt(v.length)} items`;
  return `an object with fields ${Object.keys(v).join(', ')}`;
}
function headline(v) {
  if (v === null || typeof v !== 'object') return typeof v === 'number' ? String(+v.toPrecision(10)) : JSON.stringify(v);
  if ('value' in v) return `${typeof v.value === 'number' ? +v.value.toPrecision(10) : JSON.stringify(v.value)} ${v.unit || ''}`.trim();
  if ('direction' in v) return String(v.direction);
  if ('areaKm2' in v) return `${+v.areaKm2.toPrecision(8)} km2`;
  if (Array.isArray(v)) return `${v.length} items`;
  if (v.type) return `${v.type}${v.features ? ` · ${v.features.length} features` : ''}`;
  return Object.keys(v).slice(0, 3).join(', ');
}
function draw4(t, R, glow = -1) {
  const out = draw2((G, r) => {
    const { c, w, h } = G;
    const ox = Math.min(w - 60, r.nx + 150), oy = Math.min(h - 50, r.ny + 120);
    if (!R) { if (!lastRun) return; R = lastRun; }
    const [sx, sy] = [r.nx, r.ny];
    c.strokeStyle = '#5ec8f2'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(sx, sy);
    const u = Math.min(1, t), mx = sx + (ox - sx) * u, my = sy + (oy - sy) * u;
    c.lineTo(mx, my); c.stroke();
    for (let j = 0; j < 5; j++) {                 /* the result flowing out: five pulses along the path */
      const q = ((t * 1.6) - j * 0.14); if (q < 0 || q > 1) continue;
      circle(c, sx + (ox - sx) * q, sy + (oy - sy) * q, 3.2, '#ffd54a');
    }
    if (t >= 1) {
      const txt = R.ok ? headline(R.result) : `refused: ${R.kind}`;
      c.font = '12px ui-monospace,Menlo,Consolas,monospace';
      const tw = Math.min(w - 20, c.measureText(txt).width + 16);
      const bx = Math.max(10, Math.min(w - tw - 10, ox - tw / 2));
      c.fillStyle = '#000'; c.strokeStyle = R.ok ? '#ffd54a' : '#ffb86b'; c.lineWidth = 1.2;
      c.fillRect(bx, oy - 14, tw, 26); c.strokeRect(bx, oy - 14, tw, 26);
      label(c, txt.length > 44 ? txt.slice(0, 43) + '…' : txt, bx + tw / 2, oy + 4, R.ok ? '#ffd54a' : '#ffb86b', 12);
    }
  }, glow);
  return out;
}
async function run4(e, path, fx) {
  const mine = token;
  const btn = document.querySelector('.runbtn'); if (btn) btn.disabled = true;
  const res = $('result');
  res.replaceChildren(el('div', 'dim', `reading ${fx.proof} at ${PIN.slice(0, 7)}, then importing ${path} in a worker…`));
  SOURCES.proof.url = ENGINE_RAW + fx.proof;
  setRow('proof', 'LOAD', SOURCES.proof.url);
  try {
    const proof = await getURL(ENGINE_RAW + fx.proof, 'text');
    setRow('proof', 'OK', `${ENGINE_RAW + fx.proof} · ${fmt(proof.split('\n').length)} lines`);
    const bad = checkProof(fx, proof);
    let R;
    if (bad) R = { ok: false, kind: 'Refused', message: bad };
    else R = await runInWorker(path, fx);
    if (mine !== token) return;
    lastRun = { key: e.key, path, ...R };
    res.replaceChildren();
    if (R.ok) {
      res.append(el('div', 'value', headline(R.result)), el('div', 'dim', `${fx.fn}(${fx.args.map(a => JSON.stringify(a)).join(', ')}) → ${describe(R.result)}`));
      const pre = el('pre', null, JSON.stringify(R.result, null, 1).slice(0, 4000)); res.append(pre);
    } else res.append(el('div', 'refuse', `${R.kind}: ${R.message}`));
    res.append(el('div', 'disclaimer', DISCLAIMER));
    res.dataset.run = R.ok ? 'ok' : 'refused';
    const t0 = performance.now();
    const step = t => { const u = Math.min(1.2, (t - t0) / 1100); draw4(u >= 1.2 ? 1 : u, lastRun); anim = u < 1.2 ? requestAnimationFrame(step) : null; if (u >= 1.2) draw4(1, lastRun); };
    anim = requestAnimationFrame(step);
    fillMachine(machine4(e, fx, lastRun));
  } catch (err) {
    setRow('proof', 'FAIL', err.message);
    if (mine === token) res.replaceChildren(el('div', 'refuse', 'Could not run: ' + err.message));
  } finally { if (btn) btn.disabled = false; }
}

/* ── panels ───────────────────────────────────────────────────────────────── */
function fillQuestions(node) { $('qbody').replaceChildren(node); $('qbody').className = ''; }
function fillMachine(node) { $('mbody').replaceChildren(node); $('mbody').className = ''; }

/* ── taps on the drawings ─────────────────────────────────────────────────── */
function tapAt(x, y) {
  if (S.level === 1 && wafer) {
    const i = wafer.nearestSeq(x, y);
    if (i >= 0) {
      const key = wafer.seq[i];
      $('result').replaceChildren(el('div', null, `line:${key} · position ${i + 1} of ${wafer.seq.length} in family:${S.family}'s sequence · appears ${wafer.seq.filter(k => k === key).length} time(s) in it`));
    }
    return;
  }
  let best = null, bd = Infinity;
  for (const h of hits) { const d = Math.hypot(h.x - x, h.y - y); if (d <= h.r && d < bd) { bd = d; best = h; } }
  if (!best) return;
  if (best.kind === 'atom') {
    S.family = famN(best.key); S.ringLine = -1;
    const f = I.fn.get(best.key);
    if (S.level === 4) draw4(lastRun ? 1 : 0); else draw2();
    const box = el('div');
    box.append(el('div', null, f ? `${f.key} ${f.name || '(name not yet known)'} · ${f.lines} line occurrences, ${f.distinct_lines ?? 'unknown'} distinct lines · sequence line:${f.first_line.split(':')[1]} … line:${f.last_line.split(':')[1]} · ${f.category || 'no category'}` : `${best.key}: not in the catalogue (10 lines or fewer, or not in the numbered database)`));
    box.append(button('light its lines (level 1)', () => setLevel(1, 'from an atom')));
    const [row, out] = buttonRow({ type: 'function', key: best.key, family: famN(best.key), firstLine: f ? +f.first_line.split(':')[1] : null, element: I.el.get(S.element) || null }, el('div', 'btnrow'));
    box.append(row, out);
    $('result').replaceChildren(box);
  } else if (best.kind === 'neighbour' || best.kind === 'element') {
    const ne = I.el.get(best.key);
    if (!ne) { $('result').replaceChildren(el('div', 'refuse', `${best.key} is named by the register but is not in the elements catalogue.`)); return; }
    S.element = best.key; S.family = null; S.surface = null; lastRun = null;
    setLevel(2, `${best.rel} ${best.key}`);
  }
}

function gestures() {
  const view = $('view');
  const pts = new Map(); let down = null, moved = 0, pinch = null;
  const rect = () => view.getBoundingClientRect();
  const zoomBy = (f, cx, cy) => {
    if (S.level === 1 && wafer) {
      const v = wafer.view, r = rect();
      const wx = (cx - r.left - v.w / 2) / v.zoom + v.x, wy = (v.h / 2 - (cy - r.top)) / v.zoom + v.y;
      v.zoom = Math.max(0.02, Math.min(4000, v.zoom * f));
      v.x = wx - (cx - r.left - v.w / 2) / v.zoom; v.y = wy - (v.h / 2 - (cy - r.top)) / v.zoom;
      if (wafer.fitZoom && v.zoom < wafer.fitZoom * 0.3) { S.gate = 1.6; setLevel(2, 'zoomed out past gate 1'); return; }
      wafer.render(); if (machine1) fillMachine(machine1());
      return;
    }
    if (!S.level) return;
    S.gate = Math.max(1, Math.min(4, S.gate - Math.log2(f) * 0.5));
    $('gate').value = String(S.gate);
    gateMoved();
  };
  view.addEventListener('pointerdown', e => {
    view.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 1) { down = [e.clientX, e.clientY]; moved = 0; }
    if (pts.size === 2) { const [p, q] = [...pts.values()]; pinch = Math.hypot(p[0] - q[0], p[1] - q[1]); }
  });
  view.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2 && pinch) {
      const [p, q] = [...pts.values()], d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (d > 0) { zoomBy(d / pinch, (p[0] + q[0]) / 2, (p[1] + q[1]) / 2); pinch = d; }
      moved = 99; return;
    }
    if (pts.size === 1) {
      const dx = e.clientX - prev[0], dy = e.clientY - prev[1]; moved += Math.abs(dx) + Math.abs(dy);
      if (S.level === 1 && wafer) { wafer.view.x -= dx / wafer.view.zoom; wafer.view.y += dy / wafer.view.zoom; wafer.render(); }
      else if (S.level >= 2) { S.pan[0] += dx; S.pan[1] += dy; redraw(); }
    }
  });
  const up = e => {
    if (pts.size === 1 && down && moved < 8) { const r = rect(); tapAt(e.clientX - r.left, e.clientY - r.top); }
    pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) down = null;
    if (S.level === 1 && machine1 && moved >= 8) fillMachine(machine1());
  };
  view.addEventListener('pointerup', up);
  view.addEventListener('pointercancel', e => { pts.delete(e.pointerId); pinch = null; down = null; });
  view.addEventListener('wheel', e => { e.preventDefault(); zoomBy(Math.exp(-e.deltaY * 0.0016), e.clientX, e.clientY); }, { passive: false });
}
function redraw() {
  if (S.level === 2) draw2(); else if (S.level === 3) draw3(); else if (S.level === 4) draw4(lastRun ? 1 : 0);
}
function gateMoved() {
  const L = Math.round(S.gate);
  if (L !== S.level) {
    if (L === 1 && S.family == null) { const e = I.el && I.el.get(S.element); if (e) S.family = defaultFamily(e); }
    const g = S.gate; setLevel(L, 'crossed a gate').then(() => { S.gate = g; $('gate').value = String(g); });
  } else redraw();
}

/* ── search: fly to a key ─────────────────────────────────────────────────── */
async function search(raw) {
  const q = raw.trim();
  const m = /^(block|family|line|surface):(.+)$/.exec(q);
  refuse('');
  if (!m) { refuse(`Refused: "${q}" is not a key. Keys are block:<Sym>, family:<n>, line:<n> or surface:<url>.`); return false; }
  const [, kind, rest] = m;
  try {
    if (kind === 'block') {
      await load('elements');
      const e = I.el.get(q);
      if (!e) { refuse(`Refused: ${q} is not in the elements catalogue at ${CAT_COMMIT.slice(0, 7)} (${fmt(D.data.elements.length)} elements; symbols are case-sensitive).`); return false; }
      S.element = q; S.family = null; S.surface = null; S.ringLine = -1; lastRun = null;
      await setLevel(e.kind === 'app' ? 3 : 2, 'searched ' + q); return true;
    }
    if (kind === 'family' || kind === 'line') {
      const pk = parseKey(rest);
      if (!pk.ok) { refuse(`Refused: ${q}: ${pk.why}.`); return false; }
      setRow('families', rows.families.state === 'OK' ? 'OK' : 'LOAD');
      await ensure(1);
      if (kind === 'family') {
        const fi = I.fam.get(pk.key);
        if (fi === undefined) { refuse(`Refused: family:${pk.key} is not in the numbered database (${fmt(D.data.families.length)} families), so it names no function.`); return false; }
        const f = D.data.families[fi];
        S.family = pk.key; S.ringLine = -1;
        if (I.el.has(`block:${f.block}`)) S.element = `block:${f.block}`;
        if (!I.fn.has(q)) S.note = `${q} is in the numbered database but not in the elements catalogue, which lists functions over 10 lines; its ${f.lineCount} line occurrences are read from the numbered database.`;
      } else {
        if (indexOfKey(D.data.allLines, pk.key) < 0) { refuse(`Refused: line:${pk.key} was never issued. The numbering holds ${fmt(D.data.allLines.length)} keys between 1 and ${fmt(D.data.allLines[D.data.allLines.length - 1])}; a gap is a real answer.`); return false; }
        const fams = D.data.families, L = D.data.lines, carriers = [];
        let j = 0;
        for (let i = 0; i < L.length; i++) {
          if (L[i] !== pk.key) continue;
          while (j + 1 < fams.length && fams[j + 1].lineOffset <= i) j++;
          if (carriers[carriers.length - 1] !== j) carriers.push(j);
        }
        if (!carriers.length) { refuse(`Refused: line:${pk.key} is issued, but no function family carries it, so no function assembles it.`); return false; }
        const pick = carriers.find(ix => I.fn.has(`family:${fams[ix].n}`)) ?? carriers[0];
        S.family = fams[pick].n; S.ringLine = pk.key;
        if (I.el.has(`block:${fams[pick].block}`)) S.element = `block:${fams[pick].block}`;
        S.note = `line:${pk.key} is carried by ${fmt(carriers.length)} function ${carriers.length === 1 ? 'family' : 'families'}; showing family:${fams[pick].n}${carriers.length > 1 ? ' (the first of them in the catalogue, else the first)' : ''}.`;
      }
      lastRun = null;
      await setLevel(1, 'searched ' + q); return true;
    }
    if (kind === 'surface') {
      await load('surfaces');
      let key = q; if (!I.surf.has(key) && I.surf.has(q + '/')) key = q + '/';
      if (!I.surf.has(key)) { refuse(`Refused: ${q} is not one of the ${fmt(D.data.surfaces.length)} served surfaces in the catalogue (a surface key is a folder address ending in /).`); return false; }
      S.surface = key; S.element = I.surf.get(key).blocks[0] || S.element; lastRun = null;
      await setLevel(3, 'searched ' + q); return true;
    }
  } catch (e) { refuse(`Could not answer ${q}: ${e.message}`); return false; }
}

/* ── start ────────────────────────────────────────────────────────────────── */
buildSourceRows();
gestures();
for (const b of document.querySelectorAll('#rail button')) b.addEventListener('click', () => {
  const L = +b.dataset.level;
  if (L === 1 && S.family == null && I.el) { const e = I.el.get(S.element); if (e && I.fn) S.family = defaultFamily(e); }
  setLevel(L, 'chosen');
});
$('gate').addEventListener('input', () => { if (!S.level) { setLevel(Math.round(+$('gate').value)); return; } S.gate = +$('gate').value; gateMoved(); });
$('search').addEventListener('submit', e => { e.preventDefault(); search($('q').value); document.activeElement && document.activeElement.blur(); });
$('questions').addEventListener('toggle', () => { if ($('questions').open) runSldCheck(); });
let rz = 0;
window.addEventListener('resize', () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(() => { if (S.level === 1 && wafer) { wafer.resize(); wafer.render(); } else redraw(); }); });
if (window.matchMedia('(min-width:760px)').matches) { $('questions').open = true; $('machine').open = true; }
window.__assembly = { S, D, I, queue, get fetchCount() { return fetchCount; }, get wafer() { return wafer; }, get hits() { return hits; }, search, setLevel };

(function readURL() {
  const q = new URLSearchParams(location.search);
  const key = q.get('key'), level = +q.get('level');
  if (key) { search(key).then(ok => { if (ok && level >= 1 && level <= 4 && level !== S.level) setLevel(level); }); return; }
  if (level >= 1 && level <= 4) { setLevel(level); return; }
  sayGate('nothing loaded yet · choose a level, slide the assembly zoom, or type a key');
  setCard('Assembly', `Four levels of one universe: numbered lines assemble into functions, functions into elements (register blocks), elements into apps and served surfaces, and engine elements run. Start at ${S.element} with a level, or type a key. Catalogue commit ${CAT_COMMIT.slice(0, 7)}.`);
})();
