/* No Record, No Permission — the page. Loading in Grid Atlas grammar, one
   canvas for the board, one card and one verdict box re-filled. The rules and
   arithmetic live in records.mjs. */
import * as R from './records.mjs';

/* stars origin/main when this page was built; every file is read at this commit */
const STARS_COMMIT = '7f9490a5f6d84669640af18ade4fbeef521cf3af';
const RAW = `https://raw.githubusercontent.com/Ventusltd/stars/${STARS_COMMIT}/decisions/`;
const BLOB = `https://github.com/Ventusltd/stars/blob/${STARS_COMMIT}/decisions/`;
const URL_LIST = `https://api.github.com/repos/Ventusltd/stars/contents/decisions?ref=${STARS_COMMIT}`;
const URL_SCHEMA = RAW + 'SCHEMA.md', URL_README = RAW + 'README.md', URL_GRAPH = RAW + 'graph.json';
const BOARD_CAP = 3;
const WAFER = n => `https://ventusltd.github.io/galaxies-wafers/?line=${n}`;
const CODE = n => `../31-code-card-everywhere/?line=${n}`;
const ELEMENT = key => `https://github.com/Ventusltd/elements/blob/main/ELEMENTS.md#:~:text=${encodeURIComponent(key)}`;

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const link = (href, text, cls) => { const a = el('a', cls, text); a.href = href; if (/^https?:/.test(href)) a.rel = 'noopener'; return a; };
const short = s => String(s).slice(0, 12);

/* ── loading, as Grid Atlas does it ─────────────────────────────────────── */
class FetchQueue {
  constructor(concurrency) { this.concurrency = concurrency; this.active = 0; this.queue = []; this.peak = 0; }
  async add(task) {
    if (this.active >= this.concurrency) await new Promise(resolve => this.queue.push(resolve));
    this.active++; this.peak = Math.max(this.peak, this.active);
    try { return await task(); }
    finally { this.active--; if (this.queue.length > 0) this.queue.shift()(); }
  }
}
const queue = new FetchQueue(3);
const urlCache = new Map();
const fetchLog = [];

function fetchOnce(url, as) {
  if (urlCache.has(url)) return urlCache.get(url);
  const p = queue.add(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    fetchLog.push(url);
    try {
      const res = await fetch(url, { signal: controller.signal, headers: as === 'github' ? { Accept: 'application/vnd.github+json' } : undefined });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (as === 'text') return text;
      try { return JSON.parse(text); } catch (e) { throw new Error('not valid JSON: ' + e.message); }
    } catch (err) {
      throw new Error(err && err.name === 'AbortError' ? 'timed out after 15 s' : (err && err.message) || String(err));
    } finally { clearTimeout(timer); }
  }).catch(err => { urlCache.delete(url); throw err; });
  urlCache.set(url, p);
  return p;
}

const RT = { stones: { loaded: false, loading: null, visible: false }, edges: { loaded: false, loading: null, visible: false } };
function updateUIState(id, state, detail) {
  const span = $('lbl-' + id);
  if (span) span.textContent = `${span.getAttribute('data-base-label')} [${detail ? state + ' · ' + detail : state}]`;
}
function tick(id) { const box = document.querySelector(`input[data-layer="${id}"]`); if (box && !box.checked) box.checked = true; RT[id].visible = true; }

/* ── data ───────────────────────────────────────────────────────────────── */
const D = {
  schema: null, readme: '', firstToTake: null, settlesWith: null,
  index: null, indexMethod: '', indexNote: '',
  recs: new Map(),          // id → { rec, v, file, board }
  boards: new Map(),        // board → true once fetched
  graph: null, nodeById: new Map(), graphDiff: null,
};
const S = { board: 0, sel: null, hiKey: null, view: { x: 9, y: 9, k: 1 } };
let LAYOUT = { stones: [], keys: [] };
let EDGES = { drawable: [], skipped: 0, reasons: new Map() };

function hydrate(id) {
  const rt = RT[id];
  if (rt.loaded) return Promise.resolve(true);
  if (rt.loading) return rt.loading;
  updateUIState(id, 'LOAD');
  rt.loading = (async () => {
    try {
      if (id === 'stones') {
        const [schemaMd, readme, index] = await Promise.all([fetchOnce(URL_SCHEMA, 'text'), fetchOnce(URL_README, 'text'), loadIndex()]);
        D.schema = R.parseSchema(schemaMd);
        D.readme = readme;
        const first = readme.match(/first decision to take is `(d\d+)`/);
        const withIt = readme.match(/it settles `(d\d+)` with it/);
        D.firstToTake = first ? first[1] : null; D.settlesWith = withIt ? withIt[1] : null;
        D.index = index;
        if (!index.length) { updateUIState(id, 'EMPTY', `the decisions folder at ${short(STARS_COMMIT)} lists no dNNN.json file`); rt.loading = null; $('summary').textContent = 'EMPTY — no decision record exists, so every key has no record and no permission.'; paintAll(); return false; }
        await loadBoard(S.board);
        rt.loaded = true;
      } else if (id === 'edges') {
        const g = await fetchOnce(URL_GRAPH, 'json');
        if (!g || !Array.isArray(g.nodes) || !Array.isArray(g.edges)) throw new Error('graph.json has no nodes and edges lists');
        D.graph = g; D.nodeById = new Map(g.nodes.map(n => [n.id, n]));
        rt.loaded = true;
        if (!g.edges.length) updateUIState(id, 'EMPTY', 'graph.json lists no edges');
      }
      rt.loading = null;
      rebuild();
      return true;
    } catch (err) {
      rt.loading = null;
      updateUIState(id, 'FAIL', err.message + ' · tick again to retry');
      const box = document.querySelector(`input[data-layer="${id}"]`);
      if (box) box.checked = false;
      rt.visible = false;
      if (id === 'stones') $('summary').textContent = `FAIL — ${err.message}. Nothing is drawn in its place, and no key can be granted.`;
      schedule();
      return false;
    }
  })();
  return rt.loading;
}

/* The list of record files: the repository's own listing at the pinned commit;
   when that is refused, the record ids named in graph.json, said so. */
async function loadIndex() {
  const pick = names => [...new Set(names.filter(n => /^d\d{3,}$/.test(n)))].sort((a, b) => R.numberOf(a) - R.numberOf(b));
  try {
    const list = await fetchOnce(URL_LIST, 'github');
    if (!Array.isArray(list)) throw new Error('the listing is not a list');
    D.indexMethod = 'the repository listing of decisions/';
    return pick(list.filter(x => x && x.type === 'file' && /^d\d{3,}\.json$/.test(x.name)).map(x => x.name.replace(/\.json$/, '')));
  } catch (err) {
    const g = await fetchOnce(URL_GRAPH, 'json');
    D.indexMethod = 'the decision nodes of graph.json (fallback)';
    D.indexNote = `The repository listing was refused (${err.message}); records written after graph.json was generated would be missed.`;
    return pick((g.nodes || []).filter(n => n.type === 'decision').map(n => String(n.id).replace(/^decision:/, '')));
  }
}

async function loadRecord(id) {
  if (D.recs.has(id)) return D.recs.get(id);
  const file = id + '.json';
  let entry;
  try {
    const rec = await fetchOnce(RAW + file, 'json');
    entry = { rec, v: R.validate(rec, file, D.schema), file };
  } catch (err) {
    entry = { rec: { id }, v: { ok: false, problems: [`the file could not be read: ${err.message}`], notes: [] }, file, failed: true };
    urlCache.delete(RAW + file);
  }
  entry.board = R.boardOf(R.numberOf(id));
  D.recs.set(id, entry);
  return entry;
}

async function loadBoard(b, keep = []) {
  const ids = D.index.filter(id => R.boardOf(R.numberOf(id)) === b);
  await Promise.all(ids.map(loadRecord));
  D.boards.set(b, true);
  /* cap: evict the boards farthest from the one in view, never the one in view */
  const hold = new Set([S.board, b, ...keep]);
  while (D.boards.size > BOARD_CAP) {
    const far = [...D.boards.keys()].filter(x => !hold.has(x)).sort((x, y) => Math.abs(y - S.board) - Math.abs(x - S.board))[0];
    if (far === undefined) break;
    D.boards.delete(far);
    for (const [id, r] of D.recs) if (r.board === far) { D.recs.delete(id); urlCache.delete(RAW + r.file); }
  }
}

const boardsTotal = () => (D.index && D.index.length ? R.boardOf(R.numberOf(D.index[D.index.length - 1])) + 1 : 0);
const loadedList = () => [...D.recs.values()];

document.querySelectorAll('input[data-layer]').forEach(box => {
  box.checked = false;
  box.addEventListener('change', () => {
    const id = box.dataset.layer;
    RT[id].visible = box.checked;
    if (box.checked) hydrate(id);
    schedule();
  });
});

/* ── derived state: layout, edges, lists ────────────────────────────────── */
function rebuild() {
  if (D.schema && D.index) {
    const onBoard = loadedList().filter(r => r.board === S.board && !r.failed && typeof r.rec.id === 'string');
    LAYOUT = R.layoutBoard(onBoard);
    /* a record that could not be read still has a place: its number */
    for (const r of loadedList().filter(r => r.board === S.board && r.failed)) { const n = R.numberOf(r.rec.id); const [x, y] = R.stonePoint(n); LAYOUT.stones.push({ id: r.rec.id, n, x, y, r }); }
    const stones = loadedList().filter(r => r.board === S.board);
    const bad = stones.filter(r => !r.v.ok).length;
    updateUIState('stones', 'OK', `${stones.length} records on board ${S.board + 1} of ${boardsTotal()} · ${bad} do not conform`);
  }
  buildEdges();
  paintAll();
  schedule();
}

function buildEdges() {
  EDGES = { drawable: [], skipped: 0, reasons: new Map() };
  D.graphDiff = null;
  if (!D.graph) return;
  const pos = new Map();
  for (const s of LAYOUT.stones) pos.set('decision:' + s.id, s);
  for (const k of LAYOUT.keys) pos.set(k.key, k);
  const why = (r) => EDGES.reasons.set(r, (EDGES.reasons.get(r) || 0) + 1);
  for (const e of D.graph.edges) {
    const a = pos.get(e.from), b = pos.get(e.to);
    if (a && b) EDGES.drawable.push({ ...e, a, b });
    else {
      EDGES.skipped++;
      if (e.from === 'decisions' || e.to === 'decisions') why('the "decisions" whole node is not a stone');
      else if (!D.index || !D.schema) why('Stones not loaded');
      else why('an end is not on the board in view');
    }
  }
  /* graph.json against the records: keys a record judges without an edge, and edges no record carries */
  if (D.schema && D.index) {
    const edgeSet = new Set(D.graph.edges.filter(e => e.type === 'concerns').map(e => e.from + '>' + e.to));
    const missing = [], extra = [];
    for (const r of loadedList()) {
      if (r.failed) continue;
      const subjAlso = [...R.splitKey(r.rec?.subject?.key), ...(Array.isArray(r.rec.also) ? r.rec.also.flatMap(R.splitKey) : [])];
      for (const k of new Set(subjAlso)) if (!edgeSet.has(`decision:${r.rec.id}>${k}`)) missing.push(`${r.rec.id} → ${k}`);
    }
    for (const e of D.graph.edges) {
      if (e.type !== 'concerns') continue;
      const id = String(e.from).replace(/^decision:/, '');
      const r = D.recs.get(id);
      if (r && !r.failed && !R.keysOf(r.rec).includes(e.to)) extra.push(`${id} → ${e.to}`);
    }
    const inGraph = new Set(D.graph.nodes.filter(n => n.type === 'decision').map(n => String(n.id).replace(/^decision:/, '')));
    const notInGraph = D.index.filter(id => !inGraph.has(id));
    D.graphDiff = { missing, extra, notInGraph };
  }
  const reasons = [...EDGES.reasons].map(([r, n]) => `${n} skipped: ${r}`).join('; ');
  updateUIState('edges', 'OK', `${EDGES.drawable.length} drawn of ${D.graph.edges.length} in file${reasons ? ' · ' + reasons : ''}`);
}

/* ── painting the text ───────────────────────────────────────────────────── */
function paintAll() { paintSummary(); paintNonconf(); paintBoardNav(); paintQuestions(); paintMachine(); if (S.sel) fillCard(); }

function countStatus() {
  const c = { open: 0, decided: 0, superseded: 0, other: 0, bad: 0 };
  for (const r of loadedList()) { if (!r.v.ok) c.bad++; if (c[r.rec.status] !== undefined && r.rec.status !== 'other') c[r.rec.status]++; else c.other++; }
  return c;
}

function paintSummary() {
  if (!D.index || !D.schema) return;
  const c = countStatus();
  const s = $('summary'); s.replaceChildren();
  const b = t => el('b', null, t);
  s.append(b(String(D.index.length)), ` record files listed by ${D.indexMethod}; `, b(String(D.recs.size)), ' read: ',
    b(String(c.decided)), ' decided (permission), ', b(String(c.open)), ' open (a question), ', b(String(c.superseded)), ' superseded, ',
    b(String(c.bad)), ' not conforming to SCHEMA.md. Every other key has no record, so no permission.');
  if (D.indexNote) s.append(el('br'), el('span', 'dim', D.indexNote));
}

function paintNonconf() {
  const ul = $('nonconf');
  if (!D.schema || !D.index) return;
  ul.replaceChildren();
  const cross = R.crossCheck(loadedList());
  const bad = loadedList().filter(r => !r.v.ok || r.v.notes.length || cross.some(c => c.id === r.rec.id));
  if (!bad.length) ul.append(el('li', 'plain', `None: all ${D.recs.size} records read conform to the ${D.schema.fields.size} fields of SCHEMA.md, and no record carries a field SCHEMA.md does not name.`));
  for (const r of bad.sort((a, b) => R.numberOf(a.rec.id) - R.numberOf(b.rec.id))) {
    const li = el('li', 'plain');
    li.append(el('b', null, `${r.rec.id} · ${r.v.ok ? 'conforms, with notes' : 'DOES NOT CONFORM — grants nothing'}`));
    const list = el('ul');
    for (const p of r.v.problems) list.append(el('li', null, p));
    for (const c of cross.filter(c => c.id === r.rec.id)) list.append(el('li', null, c.problem));
    for (const n of r.v.notes) list.append(el('li', 'dim', 'note: ' + n));
    li.append(list, link(BLOB + r.file, 'read the file'));
    ul.append(li);
  }
  /* the gate, seen failing: a copy of the first record read, broken on purpose, must not pass */
  const first = loadedList().filter(r => !r.failed).sort((a, b) => R.numberOf(a.rec.id) - R.numberOf(b.rec.id))[0];
  if (first) {
    const mutant = structuredClone(first.rec); mutant.question = ''; mutant.status = 'pending';
    const v = R.validate(mutant, first.file, D.schema);
    $('gate').textContent = v.ok
      ? `GATE BROKEN — a copy of ${first.rec.id} with an empty question and status "pending" passed the check. Treat every "conforms" above as unproven.`
      : `Gate seen failing: a copy of ${first.rec.id} with an empty question and status "pending" is refused with ${v.problems.length} problems (${v.problems.join('; ')}). The check can fail.`;
  }
  if (D.graphDiff) {
    const g = D.graphDiff;
    const p = el('p', 'small dim');
    p.textContent = `graph.json against the records: ${g.missing.length} keys a record judges with no edge${g.missing.length ? ' (' + g.missing.join(', ') + ')' : ''}; ${g.extra.length} edges no record carries${g.extra.length ? ' (' + g.extra.join(', ') + ')' : ''}; ${g.notInGraph.length} records not in graph.json${g.notInGraph.length ? ' (' + g.notInGraph.join(', ') + ')' : ''}. Generated ${D.graph.generated_utc || 'at an unstated time'}.`;
    $('gate').after(p);
    const old = $('graphdiff'); if (old) old.remove();
    p.id = 'graphdiff';
  }
}

function paintBoardNav() {
  const total = boardsTotal();
  $('boardname').textContent = total ? `board ${S.board + 1} of ${total} · d${String(S.board * R.PER_BOARD + 1).padStart(3, '0')}–d${String((S.board + 1) * R.PER_BOARD).padStart(3, '0')}` : 'board —';
  $('prev').disabled = !(total && S.board > 0);
  $('next').disabled = !(total && S.board < total - 1);
}
async function goBoard(b) {
  if (!D.index || b < 0 || b >= boardsTotal()) return;
  S.board = b; S.sel = null; paintBoardNav();
  updateUIState('stones', 'LOAD', `board ${b + 1}`);
  await loadBoard(b);
  rebuild();
  writeURL();
}
$('prev').addEventListener('click', () => goBoard(S.board - 1));
$('next').addEventListener('click', () => goBoard(S.board + 1));

const keyName = key => { const n = D.nodeById.get(key); return n ? n.label : null; };

function keyButtons(key, into) {
  const box = el('div', 'btns');
  const line = /^line:(\d+)$/.exec(key);
  const blocks = R.splitKey(key).filter(k => k.startsWith('block:'));
  if (line) { box.append(link(WAFER(line[1]), 'WAFER', 'btn'), link(CODE(line[1]), 'CODE', 'btn')); }
  else {
    box.append(el('span', 'btn off', 'WAFER'), el('span', 'btn off', 'CODE'));
  }
  if (blocks.length) for (const b of blocks) box.append(link(ELEMENT(b), `ELEMENT ${b}`, 'btn'));
  else box.append(el('span', 'btn off', 'ELEMENT'));
  const why = [];
  if (!line) why.push('WAFER and CODE open a line key; this key is not one');
  if (!blocks.length) why.push('ELEMENT looks up a block key in ELEMENTS.md; this key names no block');
  if (why.length) box.append(el('span', 'why', why.join('. ') + '.'));
  into.append(box);
}

function fillCard() {
  const card = $('card');
  card.replaceChildren();
  const r = S.sel && D.recs.get(S.sel);
  if (!r) { card.append(el('p', 'dim', S.sel ? `${S.sel} is not loaded: its board was evicted or never fetched.` : 'Tap a stone to read its record.')); return; }
  const rec = r.rec;
  card.append(el('h3', null, `${rec.id} · ${rec.status ?? 'no status'}${r.v.ok ? '' : ' · DOES NOT CONFORM'}`));
  const statusSentence = !r.v.ok ? 'This record does not conform to SCHEMA.md, so it grants nothing.'
    : rec.status === 'decided' ? 'Decided: permission to do what "agents may" says.'
    : rec.status === 'open' ? 'Open: a question. Agents may gather evidence and propose, but not change the key.'
    : rec.status === 'superseded' ? 'Superseded: history. It grants nothing now.' : '';
  card.append(el('p', 'dim small', statusSentence));
  const dl = el('dl');
  const row = (t, v) => { dl.append(el('dt', null, t)); const dd = el('dd'); if (v instanceof Node) dd.append(v); else dd.textContent = v; dl.append(dd); };
  row('question', Object.assign(el('span', 'q', rec.question || '(empty)')));
  row('decision', rec.decision ? rec.decision : (rec.status === 'open' ? 'none yet: the record is open' : '(empty)'));
  row('rationale', rec.rationale || '(empty)');
  row('subject', rec.subject ? `${rec.subject.type} · ${rec.subject.key}` : '(missing)');
  row('also', Array.isArray(rec.also) && rec.also.length ? rec.also.join(', ') : 'none');
  row('settles', Array.isArray(rec.consequences?.settles) && rec.consequences.settles.length ? rec.consequences.settles.join(', ') : 'nothing yet');
  const may = el('ul'); for (const s of rec.consequences?.agents_may || []) may.append(el('li', null, s));
  row('agents may', may.childNodes.length ? may : 'nothing stated');
  const ev = el('ul'); for (const e of Array.isArray(rec.evidence) ? rec.evidence : []) { const li = el('li'); li.append(/^https?:\/\//.test(e) ? link(e, e.replace(/^https?:\/\/(www\.)?/, '')) : el('code', null, e)); ev.append(li); }
  row('evidence', ev.childNodes.length ? ev : 'none');
  row('date', rec.date || '(missing)');
  row('status', rec.status || '(missing)');
  row('supersedes', rec.supersedes || 'none');
  const src = el('span');
  if (rec.source && rec.source.url) src.append(link(rec.source.url, `issue ${rec.source.issue}`)); else src.textContent = 'not given (the record did not come from an issue, or does not say)';
  row('source', src);
  row('author', 'SCHEMA.md names no author field; its rule is "No names of people."');
  const f = el('span'); f.append(link(BLOB + r.file, `${r.file} at ${short(STARS_COMMIT)}`)); row('file', f);
  if (!r.v.ok || r.v.notes.length) { const u = el('ul', 'prob'); for (const p of r.v.problems) u.append(el('li', null, p)); for (const n of r.v.notes) u.append(el('li', 'dim', 'note: ' + n)); row('schema', u); }
  card.append(dl);
  card.append(el('p', 'dim small', 'Keys it judges:'));
  for (const k of R.keysOf(rec)) {
    const p = el('p', null);
    const name = keyName(k);
    const b = el('button', 'btn', name ? `${k} · ${name.replace(/^\S+ · /, '')}` : k);
    b.type = 'button'; b.addEventListener('click', () => { $('key').value = k; runCheck(k); });
    p.append(b); card.append(p);
    keyButtons(k, card);
  }
}

function paintQuestions() {
  $('q-pin').textContent = short(STARS_COMMIT);
  if (!D.schema || !D.index) return;
  /* keys that feed a drawing, and what each feeds; the verdict is computed */
  const FEEDS = [
    ['block:Ss', 'the sld-sandbox cartridge, which draws the single-line panel'],
    ['block:G2', 'a grid layer drawn on the map (the network the diagram connects to)'],
    ['block:Ek', 'the earth radius behind every straight-line distance in km (not a cable route)'],
    ['block:Gc', 'the one haversine: distance and bearing between two drawn points'],
    ['block:Hr', 'how near a tap must be to select a drawn line'],
    ['block:Hi', 'how near a tap must be to select a drawn point'],
  ];
  const ul = $('q-draw'); ul.replaceChildren();
  for (const [key, feeds] of FEEDS) {
    const p = R.permission({ key, parts: [key] }, loadedList());
    const li = el('li');
    const ids = [...p.decided, ...p.open, ...p.history].map(r => r.rec.id).join(', ');
    const verdictText = p.verdict === 'GRANTS' ? `GRANTS (${ids}): ${p.may.map(m => m.s).join(' ')}`
      : p.verdict === 'REFUSES' ? `REFUSES change (${ids} open): ${p.may.map(m => m.s).join(' ')}`
      : p.verdict === 'HISTORY' ? `NO CURRENT RECORD (${ids} superseded): no permission`
      : 'NO RECORD: no permission';
    li.append(el('code', null, key), ` — ${feeds}. `, el('b', null, verdictText));
    ul.append(li);
  }
  const q = $('q-next'); q.replaceChildren();
  if (D.firstToTake) {
    const r = D.recs.get(D.firstToTake);
    q.append(`README.md names ${D.firstToTake} as the first decision to take${D.settlesWith ? ` (it settles ${D.settlesWith} with it)` : ''}; its status now: `,
      el('b', null, r ? String(r.rec.status) : 'not loaded'), `. When it is decided, the key check here turns from REFUSES to GRANTS for ${r ? R.keysOf(r.rec).join(', ') : 'its keys'}, and the generator that reads graph.json links the decision instead of a question. `);
  } else q.append('README.md at this commit names no first decision to take: not established. ');
  const c = countStatus();
  q.append(`Records open now: ${c.open} of ${D.recs.size} read. Next element: the block each record judges, opened with ELEMENT on its card.`);
}

function paintMachine() {
  const m = $('machine');
  if (!D.schema || !D.index) return;
  const s = D.schema;
  m.textContent = `Machine detail · inputs: SCHEMA.md field table (${s.fields.size} fields; statuses ${s.statuses.join('/')}; subject types ${s.subjectTypes.join('/')}; key forms ${s.prefixes.map(p => p + ':').join(' ')}), `
    + `${D.index.length} record files listed by ${D.indexMethod}, ${D.recs.size} read (JSON, one record each), `
    + (D.graph ? `graph.json ${D.graph.nodes.length} nodes / ${D.graph.edges.length} edges, ` : 'graph.json not loaded, ')
    + `and the typed key (text: block:<symbol>, family:<number>, a pair joined by +, or line:<number>). `
    + `Outputs: per record, conforms yes/no with each problem; per key, GRANTS | REFUSES | HISTORY | NO RECORD with the record ids and their agents_may sentences; per stone, a board point (column, row 0–${R.SIZE - 1}) = (${R.OFFSET} + ((n−1) mod ${R.PER_BOARD} mod ${R.PER_ROW})×${R.STEP}, ${R.OFFSET} + ⌊((n−1) mod ${R.PER_BOARD})/${R.PER_ROW}⌋×${R.STEP}) on board ⌊(n−1)/${R.PER_BOARD}⌋. `
    + `Refusals: NOT A KEY with its reason; a record that does not conform grants nothing; line: is not a subject type in SCHEMA.md, so a line key never has a record. `
    + `Fetched ${fetchLog.length} files, peak ${queue.peak} at once. Source: Ventusltd/stars ${STARS_COMMIT}.`;
  $('prov').textContent = `Every record, SCHEMA.md, README.md and graph.json are read at run time from raw.githubusercontent.com at stars commit ${STARS_COMMIT} (origin/main when this page was built). Nothing is a typed copy.`;
}

/* ── the key check ──────────────────────────────────────────────────────── */
let checkSeq = 0;
async function runCheck(input) {
  const seq = ++checkSeq;
  const box = $('verdict');
  const say = (cls, v, ...rest) => { box.className = 'verdict ' + cls; box.replaceChildren(el('div', 'v', v), ...rest); };
  say('none', 'LOAD', el('span', 'dim', ' reading the records…'));
  tick('stones');
  const ok = await hydrate('stones');
  if (seq !== checkSeq) return;
  if (!ok || !D.schema) { say('none', 'NO PERMISSION', el('p', null, 'The records could not be read, so nothing can be granted. See the Stones layer for the reason.')); return; }
  const k = R.readKey(input, D.schema);
  S.hiKey = null;
  if (!k.ok) { say('none', 'NOT A KEY · NO PERMISSION', el('p', null, k.why + '.')); schedule(); writeURL(); return; }
  S.hiKey = k.key;
  /* coverage: every listed record read, or those graph.json wires to the key */
  let coverage = 'all';
  const unread = D.index.filter(id => !D.recs.has(id));
  if (unread.length && !k.lineOnly) {
    coverage = 'graph';
    try {
      tick('edges'); await hydrate('edges');
      const wired = new Set(D.graph.edges.filter(e => k.parts.includes(e.to) || e.to === k.key).map(e => String(e.from).replace(/^decision:/, '')));
      const want = [...wired].filter(id => D.index.includes(id) && !D.recs.has(id));
      const boards = [...new Set(want.map(id => R.boardOf(R.numberOf(id))))];
      for (const b of boards) await loadBoard(b, boards);
      rebuild();
    } catch (err) { coverage = 'loaded'; }
  }
  if (seq !== checkSeq) return;
  const p = R.permission(k, loadedList());
  const rest = [];
  const ids = rs => rs.map(r => r.rec.id).join(', ');
  const mayList = () => { const u = el('ul'); for (const m of p.may) u.append(el('li', null, `${m.id}: ${m.s}`)); return u; };
  let cls = 'none', head = 'NO RECORD · NO PERMISSION';
  if (p.verdict === 'GRANTS') { cls = 'grants'; head = `GRANTS · ${ids(p.decided)} decided`; rest.push(el('p', null, `A decided record is permission on ${k.key}. Agents may:`), mayList()); }
  else if (p.verdict === 'REFUSES') { cls = 'refuses'; head = `REFUSES · ${ids(p.open)} open`; rest.push(el('p', null, `Only open records judge ${k.key}: a question, so the key is not changed. What agents may do meanwhile:`), mayList()); }
  else if (p.verdict === 'HISTORY') { head = 'NO CURRENT RECORD · NO PERMISSION'; rest.push(el('p', null, `Only superseded records judge ${k.key} (${ids(p.history)}): history, no permission now.`)); }
  else if (p.bad.length) { head = 'NO CONFORMING RECORD · NO PERMISSION'; rest.push(el('p', null, `Only records that do not conform to SCHEMA.md judge ${k.key}: no permission.`)); }
  else rest.push(el('p', null, k.lineOnly
    ? `No record judges ${k.key}. SCHEMA.md defines block, constant, family and pair subjects, not line keys, so no record can: no permission.`
    : `No record judges ${k.key}: no permission.`));
  if (p.bad.length) rest.push(el('p', 'small', `Not counted: ${ids(p.bad)} judge this key but do not conform to SCHEMA.md, so they grant nothing.`));
  const name = keyName(k.key);
  if (name) rest.push(el('p', 'small dim', `graph.json names it: ${name}.`));
  const cov = coverage === 'all' ? `Searched all ${D.recs.size} records listed.`
    : coverage === 'graph' ? `Searched the ${D.recs.size} records in memory, including every record graph.json wires to this key; ${D.index.filter(id => !D.recs.has(id)).length} other records were not read.`
    : `graph.json could not be read, so only the ${D.recs.size} records in memory were searched; an unread record could judge this key. Still no permission is assumed.`;
  rest.push(el('p', 'small dim', cov));
  const btnHolder = el('div'); keyButtons(k.key, btnHolder); rest.push(btnHolder);
  say(cls, head, ...rest);
  writeURL();
  schedule();
}
$('keyform').addEventListener('submit', e => { e.preventDefault(); $('key').blur(); runCheck($('key').value); });

/* ── canvas ─────────────────────────────────────────────────────────────── */
const canvas = $('board');
const ctx = canvas.getContext('2d');
let W_CSS = 1, H_CSS = 1, DPR = 1;
function resize() {
  const r = canvas.getBoundingClientRect();
  W_CSS = Math.max(1, r.width); H_CSS = Math.max(1, r.height);
  DPR = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(W_CSS * DPR); canvas.height = Math.round(H_CSS * DPR);
  schedule();
}
new ResizeObserver(resize).observe(canvas);
function fit() { S.view = { x: (R.SIZE - 1) / 2, y: (R.SIZE - 1) / 2, k: 1 }; schedule(); }
$('fit').addEventListener('click', fit);

const cell = () => Math.min(W_CSS, H_CSS - 44) / (R.SIZE + 0.6) * S.view.k;
const sx = x => W_CSS / 2 + (x - S.view.x) * cell();
const sy = y => (H_CSS + 44) / 2 + (y - S.view.y) * cell();
const wx = px => S.view.x + (px - W_CSS / 2) / cell();
const wy = py => S.view.y + (py - (H_CSS + 44) / 2) / cell();

let pending = false;
function schedule() { if (!pending) { pending = true; requestAnimationFrame(draw); } }
const drawn = { stones: 0, keys: 0, edges: 0, ms: 0, frames: 0, maxMs: 0 };
let lastDrawnText = '';
const MONO = 'ui-monospace,Menlo,Consolas,monospace';

function draw() {
  pending = false;
  const t0 = performance.now();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, W_CSS, H_CSS);
  const c = cell();
  /* the board: dark, its lines faint, the star points marked */
  const N = R.SIZE - 1;
  ctx.fillStyle = '#0c0f16';
  ctx.fillRect(sx(-0.5), sy(-0.5), (N + 1) * c, (N + 1) * c);
  ctx.strokeStyle = '#1d2333'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const X = Math.round(sx(i)) + 0.5, Y = Math.round(sy(i)) + 0.5;
    ctx.moveTo(X, sy(0)); ctx.lineTo(X, sy(N));
    ctx.moveTo(sx(0), Y); ctx.lineTo(sx(N), Y);
  }
  ctx.stroke();
  ctx.fillStyle = '#2a3146';
  for (const i of [3, 9, 15]) for (const j of [3, 9, 15]) { ctx.beginPath(); ctx.arc(sx(i), sy(j), Math.max(1.5, c * 0.09), 0, Math.PI * 2); ctx.fill(); }

  let nS = 0, nK = 0, nE = 0;
  const vis = (x, y, pad) => { const X = sx(x), Y = sy(y); return X > -pad && X < W_CSS + pad && Y > -pad && Y < H_CSS + pad; };
  const showStones = RT.stones.loaded && RT.stones.visible;
  if (!showStones) {
    ctx.fillStyle = '#8b93a7'; ctx.font = `12px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    label(RT.stones.loading ? 'LOAD — reading the records' : 'WAIT — tick Stones or check a key', W_CSS / 2, (H_CSS + 44) / 2, '#8b93a7');
  }
  const selKeys = new Set();
  if (S.sel && D.recs.get(S.sel)) for (const k of R.keysOf(D.recs.get(S.sel).rec)) selKeys.add(k);

  /* edges from graph.json: cased, only where both ends are on the board */
  if (showStones && RT.edges.loaded && RT.edges.visible) {
    const casing = new Path2D(), core = new Path2D(), hi = new Path2D();
    for (const e of EDGES.drawable) {
      if (!vis(e.a.x, e.a.y, c * 20) && !vis(e.b.x, e.b.y, c * 20)) continue;
      nE++;
      const path = (e.from === 'decision:' + S.sel || (S.hiKey && R.splitKey(S.hiKey).includes(e.to))) ? hi : core;
      casing.moveTo(sx(e.a.x), sy(e.a.y)); casing.lineTo(sx(e.b.x), sy(e.b.y));
      path.moveTo(sx(e.a.x), sy(e.a.y)); path.lineTo(sx(e.b.x), sy(e.b.y));
    }
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#000'; ctx.lineWidth = Math.min(8, Math.max(3.5, c * 0.22)); ctx.stroke(casing);
    ctx.strokeStyle = '#8c97ad'; ctx.lineWidth = Math.min(3, Math.max(1.3, c * 0.08)); ctx.stroke(core);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.min(4, Math.max(2, c * 0.11)); ctx.stroke(hi);
  }

  if (showStones) {
    /* keys: lit points with a halo */
    const rk = Math.min(8, Math.max(2.5, c * 0.16));
    ctx.textBaseline = 'middle';
    for (const k of LAYOUT.keys) {
      if (!vis(k.x, k.y, 40)) continue;
      nK++;
      const X = sx(k.x), Y = sy(k.y);
      const on = selKeys.has(k.key) || (S.hiKey && R.splitKey(S.hiKey).includes(k.key));
      const g = ctx.createRadialGradient(X, Y, 0, X, Y, rk * 3.2);
      g.addColorStop(0, on ? 'rgba(255,255,255,0.55)' : 'rgba(94,200,242,0.45)'); g.addColorStop(1, 'rgba(94,200,242,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X, Y, rk * 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(X, Y, rk + 1.2, 0, Math.PI * 2); ctx.fillStyle = '#000'; ctx.fill();
      ctx.beginPath(); ctx.arc(X, Y, rk, 0, Math.PI * 2); ctx.fillStyle = on ? '#ffffff' : (k.key.startsWith('family:') ? '#b8ccff' : '#5ec8f2'); ctx.fill();
      if (c >= 15) {
        const name = keyName(k.key);
        const txt = c >= 42 && name ? name : k.key.replace(/^block:/, '');
        ctx.font = `${Math.min(13, Math.max(9, c * 0.45))}px ${MONO}`; ctx.textAlign = 'left';
        label(txt, X + rk + 3, Y, on ? '#ffffff' : '#9fd8f0');
      }
    }
    /* stones */
    const rs = c * 0.46;
    ctx.textAlign = 'center';
    for (const s of LAYOUT.stones) {
      if (!vis(s.x, s.y, rs + 4)) continue;
      nS++;
      const X = sx(s.x), Y = sy(s.y), rec = s.r.rec, ok = s.r.v.ok;
      ctx.beginPath(); ctx.arc(X, Y, rs + 1.5, 0, Math.PI * 2); ctx.fillStyle = '#000'; ctx.fill();
      ctx.beginPath(); ctx.arc(X, Y, rs, 0, Math.PI * 2);
      let text = '#ffffff';
      if (rec.status === 'decided' && ok) { ctx.fillStyle = '#eceff4'; ctx.fill(); text = '#0b0d12'; }
      else if (rec.status === 'superseded' && ok) { ctx.fillStyle = '#0c0f16'; ctx.fill(); ctx.strokeStyle = '#6b7385'; ctx.lineWidth = Math.max(1.5, rs * 0.22); ctx.stroke(); text = '#8b93a7'; }
      else { ctx.fillStyle = '#14161c'; ctx.fill(); if (ok) { ctx.strokeStyle = '#ffb000'; ctx.lineWidth = Math.max(1.5, rs * 0.22); ctx.beginPath(); ctx.arc(X, Y, rs * 0.86, 0, Math.PI * 2); ctx.stroke(); } }
      if (!ok) { ctx.setLineDash([3, 2.5]); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(X, Y, rs + 3, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
      if (s.id === S.sel) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X, Y, rs + 5.5, 0, Math.PI * 2); ctx.stroke(); }
      if (rs >= 6) {
        ctx.font = `600 ${Math.min(14, Math.max(8, rs * 0.8))}px ${MONO}`;
        ctx.fillStyle = text;
        ctx.fillText(rs >= 16 ? s.id : String(s.n), X, Y + 0.5);
        if (!ok) { ctx.fillStyle = '#ffffff'; ctx.fillText('!', X + rs * 0.95, Y - rs * 0.95); }
      }
    }
  }
  const ms = performance.now() - t0;
  drawn.stones = nS; drawn.keys = nK; drawn.edges = nE; drawn.ms = ms; drawn.frames++; drawn.maxMs = Math.max(drawn.maxMs, ms);
  const text = `drawn last frame: ${nS} stones · ${nK} keys · ${nE} edges`;
  if (text !== lastDrawnText) { $('drawn').textContent = text; lastDrawnText = text; }
}
function label(text, X, Y, colour) {
  ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText(text, X, Y);
  ctx.fillStyle = colour; ctx.fillText(text, X, Y);
}

/* ── touch: drag to pan, pinch or wheel to zoom, tap to read ────────────── */
const pointers = new Map();
const at = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
let gesture = null;
const clampView = () => { if (!Number.isFinite(S.view.k) || !Number.isFinite(S.view.x) || !Number.isFinite(S.view.y)) S.view = { x: (R.SIZE - 1) / 2, y: (R.SIZE - 1) / 2, k: 1 }; S.view.k = Math.max(0.6, Math.min(8, S.view.k)); S.view.x = Math.max(-2, Math.min(R.SIZE + 1, S.view.x)); S.view.y = Math.max(-2, Math.min(R.SIZE + 1, S.view.y)); };
function pinchState() { const [a, b] = [...pointers.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; }
canvas.addEventListener('pointerdown', e => {
  try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer */ }
  pointers.set(e.pointerId, at(e));
  if (pointers.size === 1) gesture = { tap: true, x0: at(e).x, y0: at(e).y, vx: S.view.x, vy: S.view.y };
  else if (pointers.size === 2) { const p = pinchState(); gesture = { tap: false, pinch: { ...p, k: S.view.k, wx: wx(p.mx), wy: wy(p.my) } }; }
});
canvas.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId) || !gesture) return;
  const pt = at(e);
  pointers.set(e.pointerId, pt);
  if (pointers.size === 1 && !gesture.pinch) {
    const dx = pt.x - gesture.x0, dy = pt.y - gesture.y0;
    if (Math.hypot(dx, dy) > 8) gesture.tap = false;
    if (!gesture.tap) { const c = cell(); S.view.x = gesture.vx - dx / c; S.view.y = gesture.vy - dy / c; clampView(); schedule(); }
  } else if (pointers.size >= 2 && gesture.pinch) {
    const p = pinchState(), g = gesture.pinch;
    S.view.k = g.k * p.d / g.d; clampView();
    const c = cell();
    S.view.x = g.wx - (p.mx - W_CSS / 2) / c; S.view.y = g.wy - (p.my - (H_CSS + 44) / 2) / c; clampView();
    schedule();
  }
});
const up = e => {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (gesture && gesture.tap && pointers.size === 0) { const pt = at(e); tapAt(pt.x, pt.y); }
  if (pointers.size === 0) gesture = null;
};
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); gesture = null; });
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const pt = at(e);
  const before = [wx(pt.x), wy(pt.y)];
  S.view.k *= Math.exp(-e.deltaY * 0.0016); clampView();
  const c = cell();
  S.view.x = before[0] - (pt.x - W_CSS / 2) / c; S.view.y = before[1] - (pt.y - (H_CSS + 44) / 2) / c; clampView();
  schedule();
}, { passive: false });

function tapAt(px, py) {
  if (!(RT.stones.loaded && RT.stones.visible)) return;
  const c = cell();
  let best = null, bd = Infinity;
  for (const s of LAYOUT.stones) { const d = Math.hypot(sx(s.x) - px, sy(s.y) - py); if (d < bd && d <= Math.max(22, c * 0.6)) { bd = d; best = { type: 'stone', s }; } }
  for (const k of LAYOUT.keys) { const d = Math.hypot(sx(k.x) - px, sy(k.y) - py); if (d < bd && d <= Math.max(16, c * 0.45)) { bd = d; best = { type: 'key', k }; } }
  if (!best) return;
  if (best.type === 'stone') { select(best.s.id); $('card').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  else { $('key').value = best.k.key; runCheck(best.k.key); }
}
function select(id) { S.sel = id; fillCard(); writeURL(); schedule(); }

/* ── URL ─────────────────────────────────────────────────────────────────── */
function writeURL() {
  const q = new URLSearchParams();
  if (S.sel) q.set('d', S.sel);
  if (S.hiKey) q.set('key', S.hiKey);
  if (S.board) q.set('board', String(S.board + 1));
  history.replaceState(null, '', q.toString() ? '?' + q.toString().replace(/%3A/gi, ':').replace(/%2B/gi, '+') : location.pathname);
}
(async function start() {
  resize(); fit(); paintQuestions();
  $('loadingrule').textContent = `Loading, as Grid Atlas does it: both layers start hidden and unfetched. Ticking Stones fetches SCHEMA.md, README.md, the list of record files, and the records of the board in view, through one queue of at most ${queue.concurrency} requests, each with a 15 s timeout; a file is fetched once and shared; a failed fetch is retried by ticking again; unticking hides and keeps the data. Tile rule: one board holds ${R.PER_BOARD} records by number (d001–d${String(R.PER_BOARD).padStart(3, '0')}, then the next ${R.PER_BOARD}, …); only the board in view is fetched, and at most ${BOARD_CAP} boards are kept in memory, the one farthest from the board in view evicted first. A key check searches the records in memory plus every record graph.json wires to the key, fetched by the same rule. No DOM element is created per stone, key or edge.`;
  const q = new URLSearchParams(location.search);
  const d = q.get('d'), key = q.get('key'), board = Number(q.get('board'));
  if (d || key || board) {
    tick('stones');
    if (Number.isInteger(board) && board > 1) S.board = board - 1;
    if (d && /^d\d{3,}$/.test(d)) S.board = R.boardOf(R.numberOf(d));
    const ok = await hydrate('stones');
    if (ok && d) { if (D.recs.has(d)) select(d); else { $('card').replaceChildren(el('p', null, `EMPTY — the link asked for ${d}, which the decisions folder at ${short(STARS_COMMIT)} does not list.`)); } }
    if (key) { $('key').value = key; runCheck(key); }
  }
})();
window.__decisions = { D, S, RT, drawn, fetchLog, queue, get layout() { return LAYOUT; }, get edges() { return EDGES; } };
