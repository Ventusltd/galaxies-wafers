/* Counts That Say Themselves — the page. Loading in Grid Atlas grammar: every
   section exists from the start, nothing is fetched until the reader opens it,
   one queue of 4, a 15 s timeout on every fetch, one promise per URL, and only
   the changed row or label is touched. The rules live in audit.mjs. */
import * as A from './audit.mjs';

const STARS = 'https://ventusltd.github.io/stars/';
const GG = 'https://globalgrid2050.com/testcode/';
const ELEMENTS = 'https://raw.githubusercontent.com/Ventusltd/elements/main/catalogue/';
const API = 'https://api.github.com/repos/Ventusltd/';
const HERE = new URL('./', import.meta.url);
const SITE = new URL('../../', HERE);            // galaxies-wafers root as served
const rel = p => new URL(p, SITE).href;
const TIMEOUT = 15000, CONCURRENCY = 4;

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const link = (href, text) => { const a = el('a', null, text); a.href = href; a.rel = 'noopener'; return a; };

/* where a served file lives in its repository, for a file-and-line citation */
function blob(url, line) {
  const L = line ? `#L${line}` : '';
  if (url.startsWith(STARS)) return { label: `stars/${url.slice(STARS.length)}`, href: `https://github.com/Ventusltd/stars/blob/main/${url.slice(STARS.length)}${L}` };
  if (url.startsWith(GG)) return { label: `globalgrid2050/testcode/${url.slice(GG.length)}`, href: `https://github.com/Ventusltd/globalgrid2050/blob/main/testcode/${url.slice(GG.length)}${L}` };
  if (url.startsWith(ELEMENTS)) return { label: `elements/catalogue/${url.slice(ELEMENTS.length)}`, href: `https://github.com/Ventusltd/elements/blob/main/catalogue/${url.slice(ELEMENTS.length)}${L}` };
  if (url.startsWith(SITE.href)) return { label: `galaxies-wafers/${url.slice(SITE.href.length)}`, href: `https://github.com/Ventusltd/galaxies-wafers/blob/main/${url.slice(SITE.href.length)}${L}` };
  return { label: url, href: url };
}
const cite = (url, line) => { const b = blob(url, line); return { label: line ? `${b.label}:${line}` : b.label, href: b.href }; };

/* ── loading, as Grid Atlas does it ─────────────────────────────────────── */
class FetchQueue {
  constructor(n) { this.n = n; this.active = 0; this.wait = []; this.peak = 0; }
  async add(task) {
    if (this.active >= this.n) await new Promise(r => this.wait.push(r));
    this.active++; this.peak = Math.max(this.peak, this.active);
    try { return await task(); } finally { this.active--; if (this.wait.length) this.wait.shift()(); }
  }
}
const queue = new FetchQueue(CONCURRENCY);
const urlCache = new Map();
const M = { fetches: 0, failed: 0, bytes: 0, timeouts: 0 };

function withTimeout(run) {
  return queue.add(async () => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT);
    M.fetches++; paintMachine();
    try { return await run(ctl.signal, ctl); }
    catch (err) {
      M.failed++;
      if (err && err.name === 'AbortError') { M.timeouts++; throw new Error('timed out after 15 s'); }
      throw new Error((err && err.message) || String(err));
    } finally { clearTimeout(timer); paintMachine(); }
  });
}

function fetchOnce(url, as = 'json') {
  const key = as + ' ' + url;
  if (urlCache.has(key)) return urlCache.get(key);
  let p;
  if (as === 'head') {
    p = withTimeout(async signal => {
      const res = await fetch(url, { method: 'HEAD', signal, cache: 'no-cache' });
      return { ok: res.ok, status: res.status };
    });
  } else if (as === 'first2k') {
    /* the first bytes of a large file, then the stream is cancelled */
    p = withTimeout(async (signal, ctl) => {
      const res = await fetch(url, { signal, cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!res.body || !res.body.getReader) { const t = await res.text(); M.bytes += t.length; return t.slice(0, 2048); }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let t = '';
      while (t.length < 2048) { const { done, value } = await reader.read(); if (done) break; M.bytes += value.length; t += dec.decode(value, { stream: true }); }
      try { await reader.cancel(); } catch (_) { /* already closed */ }
      ctl.abort();
      return t.slice(0, 2048);
    });
  } else {
    p = withTimeout(async signal => {
      const res = await fetch(url, { signal, cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const t = await res.text();
      M.bytes += t.length;
      if (as === 'text') return t;
      try { return JSON.parse(t); } catch (e) { throw new Error('not valid JSON'); }
    });
  }
  p = p.catch(err => { urlCache.delete(key); throw err; });
  urlCache.set(key, p);
  return p;
}
/* a value, or null with the reason kept */
async function tryGet(url, as) { try { return { v: await fetchOnce(url, as) }; } catch (e) { return { v: null, why: `${blob(url).label}: ${e.message}` }; } }

/* the whole of LINES.md, streamed through the row counter; nothing is kept */
let linesCount = null;
function countLinesMd(onProgress) {
  if (linesCount) return linesCount;
  linesCount = withTimeout(async signal => {
    const res = await fetch(STARS + 'LINES.md', { signal, cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const c = A.lineRowCounter(); const dec = new TextDecoder(); const reader = res.body.getReader();
    let bytes = 0, last = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length; M.bytes += value.length;
      c.push(dec.decode(value, { stream: true }));
      if (bytes - last > 1 << 20) { last = bytes; onProgress(bytes, c.rows); }
    }
    return { ...c.end(), bytes };
  }).catch(e => { linesCount = null; throw e; });
  return linesCount;
}

/* ── rows: created once, re-filled one at a time ─────────────────────────── */
const ROWS = new Map();      // id -> { li, parts, status, typed, sec }
function addRow(sec, id, title) {
  if (ROWS.has(id)) return ROWS.get(id);
  const li = el('li', 'row unknown');
  const head = el('div', 'rhead');
  const st = el('span', 'st', 'WAIT');
  const t = el('span', 'rt', title);
  head.append(st, t);
  const served = el('code', 'served', '');
  const where = el('div', 'where small');
  const nums = el('div', 'nums');
  const rule = el('div', 'rule small dim');
  li.append(head, served, where, nums, rule);
  $('rows-' + sec).append(li);
  const row = { li, st, t, served, where, nums, rule, status: null, typed: false, sec, whereLabel: '' };
  ROWS.set(id, row);
  return row;
}
function fillRow(id, r) {
  const row = ROWS.get(id);
  const status = r.status || A.statusOf(r.stated, r.recount);
  row.status = status; row.typed = !!r.typed; row.whereLabel = r.where ? r.where.label : '';
  row.li.className = 'row ' + (status === A.STATUS.MATCH ? 'match' : status === A.STATUS.DIFFERS ? 'differs' : 'unknown');
  row.st.textContent = status;
  if (r.title) row.t.textContent = r.title;
  row.served.textContent = r.served ? r.served.trim().slice(0, 420) : '(not found in the served text)';
  row.where.replaceChildren();
  if (r.where) row.where.append(link(r.where.href, r.where.label));
  row.where.append(' · ');
  row.where.append(el('span', r.typed ? 'tag typed' : 'tag', r.kind));
  row.nums.replaceChildren();
  const s = el('span', null, 'states '); s.append(el('b', null, A.fmt(r.stated)));
  const c = el('span', null, ' · recomputed '); c.append(el('b', null, A.fmt(r.recount)));
  row.nums.append(s, c);
  row.rule.replaceChildren();
  row.rule.append('rule: ' + r.rule);
  if (r.ruleCite) { row.rule.append(' · '); row.rule.append(link(r.ruleCite.href, r.ruleCite.label)); }
  if (r.note) row.rule.append(el('div', 'note', r.note));
  paintTally();
}
function failRow(id, title, reason) {
  fillRow(id, { title, served: '', kind: 'not read', stated: null, recount: null, rule: 'not yet known', note: reason, status: A.STATUS.UNKNOWN });
}

function paintTally() {
  const n = { MATCH: 0, DIFFERS: 0, UNKNOWN: 0, typed: 0 };
  const differs = [];
  for (const r of ROWS.values()) {
    if (!r.status) continue;
    if (r.status === A.STATUS.MATCH) n.MATCH++; else if (r.status === A.STATUS.DIFFERS) { n.DIFFERS++; differs.push(r.whereLabel); } else n.UNKNOWN++;
    if (r.typed) n.typed++;
  }
  const total = n.MATCH + n.DIFFERS + n.UNKNOWN;
  $('summary').textContent = total
    ? `${total} counts checked in the sections opened · ${n.MATCH} MATCH · ${n.DIFFERS} DIFFERS · ${n.UNKNOWN} NOT YET KNOWN · ${n.typed} typed rather than computed`
    : 'WAIT: nothing is fetched until you open a section.';
  const uniq = [...new Set(differs.filter(Boolean))];
  $('q-next').textContent = total
    ? (uniq.length ? `The next thing a count leads to is the file that states it wrongly: ${uniq.slice(0, 12).join('; ')}${uniq.length > 12 ? ` and ${uniq.length - 12} more` : ''}. From there, the data file the sentence names.` : 'Every count checked so far matches its data, so it leads to the data file it names (the row\'s rule link); no correction is established.')
    : 'not yet known: open a section.';
  paintMachine();
}
function paintMachine() {
  const m = $('machine'); if (!m) return;
  m.textContent = `Machine detail · inputs: served page text and JSON data files (bytes, UTF-8), fetched at run time · outputs: counts (whole numbers, no unit), each marked MATCH, DIFFERS or NOT YET KNOWN, and "typed" where the digits are written into the source · refusals: HTTP status, "timed out after 15 s", "sentence not found in the served text", GitHub listing refused · queue ${CONCURRENCY} (peak ${queue.peak}), timeout 15 s, ${M.fetches} fetches, ${M.failed} failed, ${M.timeouts} timed out, ${(M.bytes / 1048576).toFixed(1)} MB read · rows ${ROWS.size}, DOM nodes ${document.getElementsByTagName('*').length} · sources read at main on each open (stars origin/main was 7f9490a5f6d8 when this page was built).`;
}

/* ── sections ───────────────────────────────────────────────────────────── */
const RT = {};
function label(sec, state, detail) {
  const span = $('lbl-' + sec);
  span.textContent = `${span.getAttribute('data-base-label')} [${detail ? state + ' · ' + detail : state}]`;
}
function hydrate(sec) {
  const rt = RT[sec] || (RT[sec] = { loaded: false, loading: null });
  if (rt.loaded) return rt.loading || Promise.resolve(true);
  if (rt.loading) return rt.loading;
  label(sec, 'LOAD');
  rt.loading = (async () => {
    try {
      await HYDRATE[sec]();
      rt.loaded = true;
      const rows = [...ROWS.values()].filter(r => r.sec === sec);
      label(sec, rows.length ? 'OK' : 'EMPTY', rows.length ? `${rows.length} counts` : 'no count sentence found');
      return true;
    } catch (err) {
      label(sec, 'FAIL', err.message + ' · close and open to retry');
      return false;
    } finally { rt.loading = null; }
  })();
  return rt.loading;
}

/* the stars data every stars-derived sentence counts */
async function starsData() {
  const [b, f, i, h] = await Promise.all([tryGet(STARS + 'blocks/blocks.json'), tryGet(STARS + 'blocks/families.json'), tryGet(STARS + 'code/index.json'), tryGet(STARS + 'LINES.md', 'first2k')]);
  const C = A.starsCounts(b.v, f.v, i.v);
  const header = A.parseLinesHeader(h.v);
  const why = [b.why, f.why, i.why].filter(Boolean).join('; ');
  return { C, header, why, headerWhy: h.why || (header ? '' : 'LINES.md header not found in its first 2 kB'), blocksDoc: b.v };
}

/* recount by noun, under the rule of the code family the sentence belongs to */
function nounRule(noun, S, family, tableNamedCite, famCite) {
  const C = S.C;
  const bj = cite(STARS + 'blocks/blocks.json'), fj = cite(STARS + 'blocks/families.json');
  switch (noun) {
    case 'named blocks':
      if (family === 'old-lens') return { value: C.blocksAll, rule: 'the lens\'s own countsLine counts every entry of blocks.json blocks[] as a named block', cite: famCite, note: `blocks.json marks ${A.fmt(C.blocksAuto)} of those entries kind "auto"; table.html names only ${A.fmt(C.blocksNamedByKind)}.` };
      return { value: C.blocksNamedByKind, rule: 'blocks.json blocks[] whose kind is not "auto"', cite: tableNamedCite, note: `blocks.json holds ${A.fmt(C.blocksAll)} blocks in all.` };
    case 'blocks': return { value: C.blocksAll, rule: 'length of blocks.json blocks[]', cite: bj };
    case 'categories': return { value: C.categories, rule: 'length of blocks.json categories[]', cite: bj };
    case 'groups': return { value: C.groupKeys, rule: 'keys of blocks/families.json (block or unnamed group → family numbers)', cite: fj, note: `${A.fmt(C.unnamedGroups)} of those keys are not a block symbol.` };
    case 'families': case 'function families': return { value: C.familiesDistinct, rule: 'distinct family numbers across every list in blocks/families.json', cite: fj };
    case 'unique lines': case 'unique numbered lines': return { value: S.header ? S.header.unique : null, rule: 'the LINES.md header (its rows are recounted in the LINES.md section)', cite: cite(STARS + 'LINES.md', 3), note: S.headerWhy || '' };
    case 'repositories': return { value: C.repositories, rule: 'distinct names in blocks.json blocks[].repos', cite: bj };
    default: return { value: null, rule: 'no rule for this noun', cite: null };
  }
}

async function scanTyped(sec, url, S, family, tableNamedCite, famCite) {
  const got = await tryGet(url, 'text');
  if (got.v == null) { const id = `${sec}:${url}:read`; addRow(sec, id, blob(url).label); failRow(id, blob(url).label, got.why); return; }
  const found = A.findTyped(got.v);
  for (const f of found) {
    const id = `${sec}:${url}:${f.line}:${f.number}:${f.noun}`;
    addRow(sec, id, `"${A.fmt(f.number)} ${f.noun}"`);
    const r = nounRule(f.noun, S, family, tableNamedCite, famCite);
    fillRow(id, {
      served: f.text, where: cite(url, f.line), typed: true, kind: f.comment ? 'typed (in a comment)' : 'typed',
      stated: f.number, recount: r.value, rule: r.rule, ruleCite: r.cite,
      note: [r.note, r.value == null ? (S.why || 'the data is not available') : ''].filter(Boolean).join(' '),
    });
  }
}

/* a sentence built by code: its expression evaluated on the data now, and the recount */
function computedRow(sec, id, title, url, text, re, stated, recount, rule, ruleCite, note) {
  addRow(sec, id, title);
  const at = A.locate(text, re);
  if (!at) { failRow(id, title, `sentence not found in the served text of ${blob(url).label}`); return; }
  fillRow(id, { served: at.text, where: cite(url, at.line), typed: false, kind: 'computed in the browser', stated, recount, rule, ruleCite, note });
}

const HYDRATE = {
  async stars() {
    const [S, start, table, code] = await Promise.all([starsData(), tryGet(STARS + 'start.html', 'text'), tryGet(STARS + 'table.html', 'text'), tryGet(STARS + 'code.html', 'text')]);
    const namedAt = A.locate(table.v, /const named = data\.blocks\.filter\(b => b\.kind !== 'auto'\)/);
    const namedCite = namedAt ? cite(STARS + 'table.html', namedAt.line) : cite(STARS + 'table.html');
    for (const u of ['start.html', 'table.html', 'code.html']) await scanTyped('stars', STARS + u, S, 'stars', namedCite, null);
    const C = S.C, T = table.v, K = code.v;
    if (T) {
      computedRow('stars', 'st:named', 'table.html status · named blocks', STARS + 'table.html', T, /\$\{named\.length\} named blocks/, C.blocksNamedByKind, C.blocksNamedByKind, 'same rule recomputed: blocks.json blocks[] whose kind is not "auto"', namedCite, S.why);
      computedRow('stars', 'st:auto', 'table.html status · blocks found automatically', STARS + 'table.html', T, /\$\{autos\.length\} blocks found automatically/, C.blocksAuto, C.blocksAuto, 'same rule recomputed: blocks.json blocks[] whose kind is "auto"', namedCite, S.why);
      computedRow('stars', 'st:fns', 'table.html status · functions underneath', STARS + 'table.html', T, /functions underneath/, C.functionsSum, C.familiesPerBlockSum, 'states the sum of blocks[].functions; recomputed as the sum, over every block, of the length of its list in blocks/families.json', cite(STARS + 'blocks/families.json'), S.why);
    } else { addRow('stars', 'st:table', 'table.html'); failRow('st:table', 'table.html', table.why); }
    if (K) {
      computedRow('stars', 'cd:fam', 'code.html status · functions with a permanent number', STARS + 'code.html', K, /functions with a permanent number/, C.indexFamilies, C.familiesDistinct, 'states code/index.json families; recomputed as the distinct family numbers across blocks/families.json', cite(STARS + 'blocks/families.json'), S.why);
      addRow('stars', 'cd:el', 'code.html status · functions and classes in the code');
      const at = A.locate(K, /functions and classes in the code/);
      fillRow('cd:el', { served: at ? at.text : '', where: at ? cite(STARS + 'code.html', at.line) : null, kind: 'computed in the browser', stated: C.indexElements, recount: null, rule: 'not yet known', note: 'code/index.json elements has no published list beside it; a recount needs every family bucket code/f/*.json, which this page does not fetch at once.', status: A.STATUS.UNKNOWN });
      computedRow('stars', 'cd:lines', 'code.html status · unique lines', STARS + 'code.html', K, /unique lines · updated/, C.indexLines, S.header ? S.header.unique : null, 'states code/index.json lines; compared with the LINES.md header (rows recounted in the LINES.md section)', cite(STARS + 'LINES.md', 3), S.headerWhy || S.why);
    } else { addRow('stars', 'st:code', 'code.html'); failRow('st:code', 'code.html', code.why); }
  },

  async lines() {
    const [i, lm] = await Promise.all([tryGet(STARS + 'code/index.json'), tryGet(STARS + 'modular-star/lines.mjs', 'text')]);
    const genAt = A.locate(lm.v, /unique lines, numbered 1 to/);
    const genCite = genAt ? cite(STARS + 'modular-star/lines.mjs', genAt.line) : cite(STARS + 'modular-star/lines.mjs');
    const ids = [['ln:unique', 'LINES.md header · unique lines'], ['ln:last', 'LINES.md header · numbered to'], ['ln:first', 'LINES.md header · numbered from'], ['ln:index', 'code/index.json lines (printed by code.html and every countsLine)']];
    for (const [id, t] of ids) addRow('lines', id, t);
    let res;
    try { res = await countLinesMd((bytes, rows) => label('lines', 'LOAD', `${(bytes / 1048576).toFixed(1)} MB read · ${rows.toLocaleString('en-GB')} rows so far`)); }
    catch (e) { for (const [id, t] of ids) failRow(id, t, `LINES.md: ${e.message}; the rows could not be counted.`); return; }
    const h = A.parseLinesHeader(res.header);
    const where = cite(STARS + 'LINES.md', 3);
    const kind = 'written by a build (typed into the served file)';
    const note = `${(res.bytes / 1048576).toFixed(1)} MB streamed; ${res.badOrder} rows out of ascending order.`;
    fillRow('ln:unique', { served: res.header, where, kind, typed: false, stated: h && h.unique, recount: res.rows, rule: 'rows of the form number<TAB>code, counted in full', ruleCite: genCite, note });
    fillRow('ln:last', { served: res.header, where, kind, stated: h && h.last, recount: res.max, rule: 'the highest row number', ruleCite: genCite, note });
    fillRow('ln:first', { served: res.header, where, kind, stated: h && h.first, recount: res.min, rule: 'the lowest row number', ruleCite: genCite });
    fillRow('ln:index', { served: i.v ? `"lines": ${i.v.lines}` : '', where: cite(STARS + 'code/index.json'), kind: 'a published data field', stated: i.v ? i.v.lines : null, recount: res.rows, rule: 'rows of LINES.md counted in full', ruleCite: genCite, note: i.why || '' });
  },

  async lenses() {
    const S = await starsData();
    const L1350 = GG + '202609141350/', L1754 = GG + '202609141754/code-map/', L2225 = GG + '202609142225/';
    const texts = await Promise.all([L1350 + 'core.js', L1754 + 'core.js', L2225 + 'core.js'].map(u => tryGet(u, 'text')));
    const famLine = (t, u) => { const at = A.locate(t, /function countsLine\(\)/); return at ? cite(u, at.line) : cite(u); };
    const oldCite1350 = famLine(texts[0].v, L1350 + 'core.js'), oldCite1754 = famLine(texts[1].v, L1754 + 'core.js');
    const at2225 = A.locate(texts[2].v, /const named = U\.blocks\.filter\(b => b\.kind !== 'auto'\)/);
    const named2225 = at2225 ? cite(L2225 + 'core.js', at2225.line) : cite(L2225 + 'core.js');
    const C = S.C;
    /* computed count sentences */
    for (const [t, u, c, tag] of [[texts[0], L1350 + 'core.js', oldCite1350, '1350'], [texts[1], L1754 + 'core.js', oldCite1754, '1754']]) {
      if (!t.v) { addRow('lenses', 'cl:' + tag, blob(u).label); failRow('cl:' + tag, blob(u).label, t.why); continue; }
      const re = /\$\{U\.blocks\.length\} named blocks/;
      computedRow('lenses', `cl:${tag}:named`, `countsLine · named blocks (${tag})`, u, t.v, re, C.blocksAll, C.blocksNamedByKind, 'states blocks.json blocks[].length; recomputed as the blocks table.html and the newer countsLine call named: kind not "auto"', named2225, `The word differs from what the code counts: ${A.fmt(C.blocksAuto)} of the ${A.fmt(C.blocksAll)} are kind "auto". ${S.why}`);
      computedRow('lenses', `cl:${tag}:unnamed`, `countsLine · unnamed groups (${tag})`, u, t.v, /\$\{U\.unnamed\.length\} unnamed groups/, C.unnamedGroups, C.unnamedGroups, 'same rule recomputed: keys of blocks/families.json that are not a block symbol', c, S.why);
      computedRow('lenses', `cl:${tag}:fam`, `countsLine · function families (${tag})`, u, t.v, /function families/, C.indexFamilies, C.familiesDistinct, 'states code/index.json families; recomputed as distinct family numbers in blocks/families.json', cite(STARS + 'blocks/families.json'), S.why);
      computedRow('lenses', `cl:${tag}:lines`, `countsLine · unique numbered lines (${tag})`, u, t.v, /unique numbered lines/, C.indexLines, S.header ? S.header.unique : null, 'states code/index.json lines; compared with the LINES.md header', cite(STARS + 'LINES.md', 3), S.headerWhy || S.why);
    }
    if (texts[2].v) {
      const u = L2225 + 'core.js', t = texts[2].v;
      computedRow('lenses', 'cl:2225:table', 'countsLine · blocks on the table (GRAMMAR core)', u, t, /blocks on the table \(/, C.blocksAll, C.blocksAll, 'same rule recomputed: length of blocks.json blocks[]', named2225, S.why);
      computedRow('lenses', 'cl:2225:named', 'countsLine · named (GRAMMAR core)', u, t, /blocks on the table \(/, C.blocksNamedByKind, C.blocksNamedByKind, 'same rule recomputed: kind not "auto"', named2225, S.why);
      computedRow('lenses', 'cl:2225:off', 'countsLine · groups off the table (GRAMMAR core)', u, t, /groups off the table/, C.unnamedGroups, C.unnamedGroups, 'same rule recomputed: keys of blocks/families.json that are not a block symbol', named2225, S.why);
      computedRow('lenses', 'cl:2225:repos', 'countsLine · repositories (GRAMMAR core)', u, t, /repositories · data/, C.repositories, C.repositories, 'same rule recomputed: distinct blocks[].repos', named2225, S.why);
    } else { addRow('lenses', 'cl:2225', blob(L2225 + 'core.js').label); failRow('cl:2225', blob(L2225 + 'core.js').label, texts[2].why); }
    /* typed counts in the lens pages */
    const typedFiles = [
      [L1350 + 'core.js', 'old-lens', oldCite1350], [L1350 + 'index.html', 'old-lens', oldCite1350], [L1350 + 'v02-radial-sunburst/index.html', 'old-lens', oldCite1350],
      [L1350 + 'v03-particle-universe/index.html', 'old-lens', oldCite1350], [L1350 + 'v04-periodic-arrows/index.html', 'old-lens', oldCite1350],
      [L1754 + 'core.js', 'old-lens', oldCite1754], [L1754 + 'index.html', 'old-lens', oldCite1754], [L1754 + 'v02-radial-hierarchy/index.html', 'old-lens', oldCite1754],
      [L1754 + 'v03-block-map/index.html', 'old-lens', oldCite1754], [L1754 + 'v04-block-register-links/index.html', 'old-lens', oldCite1754],
      [L2225 + 'core.js', 'grammar', named2225], [L2225 + 'lenses/column.js', 'grammar', named2225],
    ];
    await Promise.all(typedFiles.map(([u, fam, c]) => scanTyped('lenses', u, S, fam, named2225, c)));
  },

  async iter() {
    const idxUrl = rel('iterations/index.json'), buildUrl = rel('build/build_iterations_index.py');
    const [idx, py, list] = await Promise.all([tryGet(idxUrl), tryGet(buildUrl, 'text'), tryGet(API + 'galaxies-wafers/contents/iterations?ref=main')]);
    const at = A.locate(py.v, /'count': len\(rows\)/);
    const ruleCite = at ? cite(buildUrl, at.line) : cite(buildUrl);
    const served = idx.v ? `"count": ${idx.v.count}` : '';
    const where = idx.v ? cite(idxUrl, 3) : cite(idxUrl);
    const kind = 'written by a build';
    const stated = idx.v ? idx.v.count : null;
    const rows = idx.v && Array.isArray(idx.v.iterations) ? idx.v.iterations : null;
    addRow('iter', 'it:rows', 'iterations/index.json count · rows in the same file');
    fillRow('it:rows', { served, where, kind, stated, recount: rows ? rows.length : null, rule: 'length of iterations[]', ruleCite, note: idx.why || '' });
    addRow('iter', 'it:repo', 'iterations/index.json count · directories in the repository');
    let dirs = null;
    if (Array.isArray(list.v)) dirs = list.v.filter(x => x.type === 'dir' && A.ITER_DIR.test(x.name)).map(x => x.name);
    const inIdx = new Set((rows || []).map(r => r.dir));
    const extra = dirs ? dirs.filter(d => !inIdx.has(d)) : [], missing = dirs ? [...inIdx].filter(d => !dirs.includes(d)) : [];
    fillRow('it:repo', { served, where, kind, stated, recount: dirs ? dirs.length : null, rule: 'directories named NN-slug under iterations/ in the GitHub listing of main, read now (the build also requires an index.html)', ruleCite,
      note: dirs ? `${extra.length ? 'In the repository, not in the index: ' + extra.join(', ') + '. ' : ''}${missing.length ? 'In the index, not in the repository: ' + missing.join(', ') + '.' : ''}` : (list.why || 'the listing was refused') });
    addRow('iter', 'it:served', 'iterations/index.json count · directories served');
    if (!rows) { failRow('it:served', 'iterations/index.json count · directories served', idx.why); return; }
    let done = 0, ok = 0; const absent = [];
    await Promise.all(rows.map(async r => {
      try { const h = await fetchOnce(rel(`iterations/${r.dir}/index.html`), 'head'); if (h.ok) ok++; else absent.push(`${r.dir} (HTTP ${h.status})`); }
      catch (e) { absent.push(`${r.dir} (${e.message})`); }
      done++; label('iter', 'LOAD', `${done}/${rows.length} directories checked`);
    }));
    fillRow('it:served', { served, where, kind, stated, recount: absent.some(a => /timed out|fetch/i.test(a)) ? null : ok, rule: 'index entries whose <dir>/index.html answers HTTP 2xx from the host serving this page', ruleCite,
      note: absent.length ? 'Not served: ' + absent.join(', ') : `Host: ${SITE.host}.` });
  },

  async layers() {
    const manUrl = rel('layers/manifest.json'), buildUrl = rel('build/build_layers.py');
    const [man, py, l1, l2] = await Promise.all([tryGet(manUrl), tryGet(buildUrl, 'text'), tryGet(API + 'galaxies-wafers/contents/layers?ref=main'), tryGet(API + 'galaxies-wafers/contents/layers/modules?ref=main')]);
    const at = A.locate(py.v, /"features": len\(d\["features"\]\)/);
    const ruleCite = at ? cite(buildUrl, at.line) : cite(buildUrl);
    const layers = man.v && Array.isArray(man.v.layers) ? man.v.layers : null;
    const stated = layers ? layers.length : null;
    const where = cite(manUrl);
    const served = layers ? `"layers": [ … ${layers.length} entries … ]` : '';
    addRow('layers', 'ly:repo', 'layers/manifest.json layers · JSON files in the repository');
    let files = null;
    if (Array.isArray(l1.v) && Array.isArray(l2.v)) files = [...l1.v, ...l2.v].filter(x => x.type === 'file' && /\.json$/.test(x.name) && x.path !== 'layers/manifest.json').map(x => x.path);
    const inMan = new Set((layers || []).map(l => l.file));
    const extra = files ? files.filter(f => !inMan.has(f)) : [], missing = files ? [...inMan].filter(f => !files.includes(f)) : [];
    fillRow('ly:repo', { served, where, kind: 'written by a build (no count field; the list is the statement)', stated, recount: files ? files.length : null,
      rule: 'JSON files in layers/ and layers/modules/ of main (manifest.json excluded; layers/tiles/ holds tiles, not layers)', ruleCite,
      note: files ? `${extra.length ? 'Files not in the manifest: ' + extra.join(', ') + '. ' : ''}${missing.length ? 'Manifest entries with no file: ' + missing.slice(0, 20).join(', ') + '.' : ''}` : [l1.why, l2.why].filter(Boolean).join('; ') || 'the listing was refused' });
    addRow('layers', 'ly:served', 'layers/manifest.json layers · files served');
    if (!layers) { failRow('ly:served', 'layers/manifest.json layers · files served', man.why); return; }
    let done = 0, ok = 0; const absent = [];
    await Promise.all(layers.map(async l => {
      try { const h = await fetchOnce(rel(l.file), 'head'); if (h.ok) ok++; else absent.push(`${l.file} (HTTP ${h.status})`); }
      catch (e) { absent.push(`${l.file} (${e.message})`); }
      done++; if (done % 10 === 0 || done === layers.length) label('layers', 'LOAD', `${done}/${layers.length} files checked`);
    }));
    fillRow('ly:served', { served, where, kind: 'written by a build', stated, recount: absent.some(a => /timed out|fetch/i.test(a)) ? null : ok, rule: 'manifest entries whose file answers HTTP 2xx from the host serving this page', ruleCite, note: absent.length ? 'Not served: ' + absent.slice(0, 20).join(', ') : `Host: ${SITE.host}.` });
    /* per-layer features: one file at a time, only when asked */
    const sel = $('layer-pick');
    sel.replaceChildren(...layers.map((l, k) => { const o = el('option', null, `${l.id} · ${A.fmt(l.features)} features · ${(l.bytes / 1024).toFixed(0)} kB`); o.value = String(k); return o; }));
    $('layer-check').disabled = false;
    $('layer-check').onclick = async () => {
      const l = layers[+sel.value]; const id = 'ly:f:' + l.file;
      addRow('layers', id, `${l.file} · features`);
      ROWS.get(id).st.textContent = 'LOAD';
      const got = await tryGet(rel(l.file));
      const n = got.v && Array.isArray(got.v.features) ? got.v.features.length : null;
      fillRow(id, { served: `"features": ${l.features}`, where, kind: 'written by a build', stated: l.features, recount: n, rule: 'length of features[] in the layer file', ruleCite, note: got.why || '' });
      const rows = [...ROWS.values()].filter(r => r.sec === 'layers');
      label('layers', 'OK', `${rows.length} counts`);
    };
  },

  async elements() {
    const pUrl = ELEMENTS + 'provenance.json';
    const [pt, S] = await Promise.all([tryGet(pUrl, 'text'), starsData()]);
    if (pt.v == null) throw new Error(pt.why);
    let P; try { P = JSON.parse(pt.v); } catch (e) { throw new Error('provenance.json is not valid JSON'); }
    const counts = P.counts || {};
    const lineOf = key => { const a = A.locate(pt.v, new RegExp(`"${key}":\\s*(\\d+)`)); return a ? a : null; };
    const row = (id, title, key, recount, rule, ruleCite, note) => {
      addRow('elements', id, title);
      const a = lineOf(key);
      fillRow(id, { served: a ? a.text : '', where: cite(pUrl, a && a.line), kind: 'written by a build', stated: counts[key] ?? null, recount, rule, ruleCite, note });
    };
    const arr = async name => { const g = await tryGet(ELEMENTS + name); return { n: Array.isArray(g.v) ? g.v.length : null, v: g.v, why: g.why || (g.v && !Array.isArray(g.v) ? `${name} is not an array` : '') }; };
    const [apps, els, surf] = await Promise.all([arr('apps.json'), arr('elements.json'), arr('surfaces.json')]);
    const ruleText = k => (P.rule && P.rule[k]) ? `"${P.rule[k]}"` : '';
    row('el:elements', 'catalogue elements · elements.json', 'elements', els.n, `length of elements.json; the file's rule: ${ruleText('elements')}`, cite(ELEMENTS + 'elements.json'), els.why);
    row('el:apps', 'catalogue apps · apps.json', 'apps', apps.n, `length of apps.json; the file's rule: ${ruleText('apps')}`, cite(ELEMENTS + 'apps.json'), apps.why);
    row('el:surfaces', 'catalogue surfaces · surfaces.json', 'surfaces', surf.n, `length of surfaces.json; the file's rule: ${ruleText('surfaces')}`, cite(ELEMENTS + 'surfaces.json'), surf.why);
    row('el:reg', 'catalogue elements · the live register now', 'elements', S.C.blocksAll, 'length of stars blocks/blocks.json blocks[] as served now', cite(STARS + 'blocks/blocks.json'), `Catalogue built from the register generated ${P.register ? P.register.generated_utc : 'not stated'}; the register served now was generated ${S.blocksDoc ? S.blocksDoc.generated_utc : 'not yet known'}. ${S.why}`);
    row('el:regapps', 'catalogue apps · the live register now', 'apps', S.C.apps, 'stars blocks/blocks.json blocks[] whose kind is "app", as served now', cite(STARS + 'blocks/blocks.json'), S.why);
    const fn = await arr('functions.json');
    row('el:fns', 'catalogue functions over 10 lines · functions.json', 'functions_over_10_lines', fn.n, 'length of functions.json', cite(ELEMENTS + 'functions.json'), fn.why);
    const nd = (P.numbered_database || []).find(x => /\/families\.json$/.test(x.url || ''));
    if (nd) {
      const g = await tryGet(nd.url);
      const list = Array.isArray(g.v) ? g.v : null;
      row('el:famtot', 'catalogue families_total · the numbered database', 'families_total', list ? list.length : null, 'length of the numbered database families.json the catalogue names', cite(nd.url), g.why || '');
      row('el:over10', 'catalogue functions over 10 lines · recomputed by its rule', 'functions_over_10_lines', list ? list.filter(f => f.lineCount > 10).length : null, `entries of that families.json with lineCount above 10; the file's rule: ${ruleText('functions')}`, cite(nd.url), g.why || '');
    } else {
      row('el:famtot', 'catalogue families_total', 'families_total', null, 'not yet known', null, 'provenance.json names no numbered-database families.json');
    }
    const own = A.parseLinesHeader(P.lines_source && P.lines_source.header);
    row('el:lines-own', 'catalogue numbered_lines · the header it copied', 'numbered_lines', own ? own.unique : null, 'the LINES.md header held in provenance.json lines_source.header', cite(pUrl), '');
    row('el:lines-live', 'catalogue numbered_lines · LINES.md served now', 'numbered_lines', S.header ? S.header.unique : null, 'the LINES.md header as served now', cite(STARS + 'LINES.md', 3), S.headerWhy || 'A difference here means the catalogue is a snapshot of an older LINES.md, not that either file miscounts.');
    row('el:max-live', 'catalogue highest_line_key · LINES.md served now', 'highest_line_key', S.header ? S.header.last : null, 'the highest key in the LINES.md header as served now', cite(STARS + 'LINES.md', 3), S.headerWhy || '');
  },
};

/* ── wiring ─────────────────────────────────────────────────────────────── */
document.querySelectorAll('details.sec').forEach(d => {
  d.addEventListener('toggle', () => { if (d.open) hydrate(d.dataset.sec); });
});
window.__counts = { rows: () => [...ROWS.entries()].map(([id, r]) => ({ id, sec: r.sec, title: r.t.textContent, status: r.status, typed: r.typed, where: r.whereLabel, nums: r.nums.textContent, note: r.rule.textContent })), M, queue, RT };
paintTally();
