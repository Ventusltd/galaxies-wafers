/* Immunity — the page. Loading in Grid Atlas grammar; one canvas for the ring,
   one card and one integrity table re-filled. Parsing and counting live in
   vax.mjs. No antibody is ever executed here: its source is text. */
import * as V from './vax.mjs';

/* Ventusltd/cvaa origin/main when this page was built; every file is read at this commit */
const COMMIT = '48393ff23b4602b045fbc9d7c1db16ffc5b6e6d4';
const RAW = `https://raw.githubusercontent.com/Ventusltd/cvaa/${COMMIT}/`;
const BLOB = `https://github.com/Ventusltd/cvaa/blob/${COMMIT}/`;
const URL_LIST = `https://api.github.com/repos/Ventusltd/cvaa/contents/vaccines?ref=${COMMIT}`;
const URL_LOCK = RAW + 'vaccines.lock';
const URL_FIRED = RAW + 'vaccines/last-fired.json';
const URL_SELFTEST = RAW + 'tools/selftest.mjs';
const WINDOW = 48;          // vaccine files read per window of the Files layer
const TEXT_CAP = 96;        // parsed files whose section text is kept; beyond it the oldest drop their text, never their counts
const short = s => String(s).slice(0, 12);

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const link = (href, text, cls) => { const a = el('a', cls, text); a.href = href; a.rel = 'noopener'; return a; };

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
const queue = new FetchQueue(4);
const urlCache = new Map();
const NET = { fetches: 0, bytes: 0 };

class HttpError extends Error { constructor(status, source) { super(`HTTP ${status}`); this.status = status; this.source = source || 'http'; } }
function fetchOnce(url, as) {
  if (urlCache.has(url)) return urlCache.get(url);
  const p = queue.add(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    NET.fetches++;
    try {
      const res = await fetch(url, { signal: controller.signal, headers: as === 'github' ? { Accept: 'application/vnd.github+json' } : undefined });
      if (!res.ok) throw new HttpError(res.status);
      const buf = await res.arrayBuffer();
      NET.bytes += buf.byteLength;
      if (as === 'bytes') return buf;
      const text = new TextDecoder('utf-8').decode(buf);
      if (as === 'text') return text;
      try { return JSON.parse(text); } catch (e) { throw new Error('not valid JSON: ' + e.message); }
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new Error(err && err.name === 'AbortError' ? 'timed out after 15 s' : (err && err.message) || String(err));
    } finally { clearTimeout(timer); }
  }).catch(err => { urlCache.delete(url); throw err; });
  urlCache.set(url, p);
  return p;
}

const LAYERS = ['ring', 'files', 'gen', 'dose', 'sup', 'fired'];
const RT = Object.fromEntries(LAYERS.map(id => [id, { loaded: false, loading: null, visible: false }]));
function updateUIState(id, state, detail) {
  const span = $('lbl-' + id);
  const text = `${span.getAttribute('data-base-label')} [${detail ? state + ' · ' + detail : state}]`;
  if (span.textContent !== text) span.textContent = text;
}
function tick(id) { const box = document.querySelector(`input[data-layer="${id}"]`); if (box && !box.checked) box.checked = true; RT[id].visible = true; }
function setText(id, text) { const n = $(id); if (n && n.textContent !== text) n.textContent = text; }

/* ── data ───────────────────────────────────────────────────────────────── */
const D = {
  names: null, listMethod: '', listNote: '',
  lock: null,
  ring: [], broken: [], others: [], dup: 0,
  parsed: new Map(),      // file → { p (parsed), status, rawHex, lfHex, bytes, adapted, failed }
  pending: new Map(),     // file → promise
  filesRead: 0,           // how many ring files the Files layer has asked for
  fired: undefined, firedWhy: '',
  edges: { gen: [], dose: [], sup: [], reasons: [] },
  selftest: undefined,
};
const S = { sel: -1, epoch: 0, view: { x: 0, y: 0, k: 0 }, fitted: false };

function hydrate(id) {
  const rt = RT[id];
  if (rt.loaded) return Promise.resolve(true);
  if (rt.loading) return rt.loading;
  updateUIState(id, 'LOAD');
  rt.loading = (async () => {
    try {
      if (id === 'ring') {
        const [names, lock] = await Promise.all([loadListing(), fetchOnce(URL_LOCK, 'json')]);
        if (!lock || typeof lock !== 'object' || Array.isArray(lock)) throw new Error('vaccines.lock is not an object of file → sha256');
        D.lock = lock; D.names = names;
        const o = V.orderRing(names);
        D.ring = o.placed; D.broken = o.broken; D.others = o.others; D.dup = o.duplicateTimestamps;
        rt.loaded = true;
        if (!D.ring.length) updateUIState(id, 'EMPTY', `no file in vaccines/ at ${short(COMMIT)} matches <12 digits>-<slug>.md`);
        else updateUIState(id, 'OK', `${D.ring.length} vaccines placed by timestamp${D.broken.length ? ` · ${D.broken.length} names break the rule and are not placed` : ''}`);
        if (!S.fitted) fit();
      } else if (id === 'files') {
        await hydrate('ring');
        if (!RT.ring.loaded) throw new Error('the ring could not be read');
        await readWindow();
        rt.loaded = true;
      } else if (id === 'gen' || id === 'dose' || id === 'sup') {
        tick('files');
        await hydrate('files');
        if (!RT.files.loaded) throw new Error('the vaccine files could not be read');
        rt.loaded = true;
      } else if (id === 'fired') {
        await hydrate('ring');
        try {
          if (D.names && !/fallback/.test(D.listMethod) && !D.names.includes('last-fired.json')) throw new HttpError(404, 'listing');
          const lf = await fetchOnce(URL_FIRED, 'json');
          if (!lf || typeof lf !== 'object' || Array.isArray(lf)) throw new Error('last-fired.json is not an object of vaccine → {sha, at}');
          D.fired = lf;
          const n = Object.keys(lf).length;
          updateUIState(id, n ? 'OK' : 'EMPTY', n ? `${n} vaccines with a recorded firing` : 'the file lists no firing');
        } catch (err) {
          if (err.status === 404) {
            D.fired = null;
            D.firedWhy = `vaccines/last-fired.json is not present at commit ${short(COMMIT)} (${err.source === 'listing' ? 'absent from the vaccines/ listing at that commit, so it was not fetched' : 'HTTP 404'}). inoculate.mjs writes this sidecar on runs without --no-write, recording the commit and time for each vaccine that found something; no copy is committed at this pin, so no firing can be read.`;
            urlCache.delete(URL_FIRED);
            urlCache.set(URL_FIRED, Promise.resolve(null));
            updateUIState(id, 'EMPTY', `not present at ${short(COMMIT)} (${err.source === 'listing' ? 'not in the listing' : 'HTTP 404'}) · no firing recorded`);
          } else throw err;
        }
        rt.loaded = true;
      }
      rt.loading = null;
      refresh();
      return true;
    } catch (err) {
      rt.loading = null;
      updateUIState(id, 'FAIL', (err.message || String(err)) + ' · tick again to retry');
      const box = document.querySelector(`input[data-layer="${id}"]`);
      if (box) box.checked = false;
      rt.visible = false;
      if (id === 'ring') setText('summary', `FAIL — ${err.message}. No vaccine is drawn in its place.`);
      refresh();
      return false;
    }
  })();
  return rt.loading;
}

/* The list of vaccine files: the repository's own listing at the pinned commit;
   when GitHub refuses it (rate limit), the file names in vaccines.lock, said so. */
async function loadListing() {
  try {
    const list = await fetchOnce(URL_LIST, 'github');
    if (!Array.isArray(list)) throw new Error('the listing is not a list');
    D.listMethod = 'the GitHub contents listing of vaccines/ at the pinned commit';
    return list.filter(x => x && x.type === 'file').map(x => x.name);
  } catch (err) {
    const lock = await fetchOnce(URL_LOCK, 'json');
    D.listMethod = 'the file names in vaccines.lock (fallback)';
    D.listNote = `The contents listing was refused (${err.message}); files present but absent from the lock cannot be seen, and "lock entries without a file" cannot be established.`;
    return Object.keys(lock || {});
  }
}

async function readWindow() {
  const from = D.filesRead, to = Math.min(D.ring.length, from + WINDOW);
  D.filesRead = to;
  let done = 0;
  const total = to - from;
  updateUIState('files', 'LOAD', `0 of ${total} files`);
  await Promise.all(D.ring.slice(from, to).map(v => loadFile(v.file).then(() => { done++; updateUIState('files', 'LOAD', `${done} of ${total} files`); })));
  const read = [...D.parsed.values()].filter(x => !x.failed).length;
  const failed = [...D.parsed.values()].filter(x => x.failed).length;
  updateUIState('files', 'OK', `${read} of ${D.ring.length} files read${failed ? ` · ${failed} could not be read (tap one to retry)` : ''}`);
  const w = $('window');
  if (D.filesRead < D.ring.length) {
    w.hidden = false; w.textContent = '';
    w.append(`Files are read ${WINDOW} at a time in timestamp order; ${D.ring.length - D.filesRead} remain. `);
    const b = el('button', 'btn', `read the next ${Math.min(WINDOW, D.ring.length - D.filesRead)}`);
    b.type = 'button';
    b.addEventListener('click', () => { b.disabled = true; readWindow().then(refresh); });
    w.append(b);
  } else { w.hidden = true; }
}

async function sha256hex(buf) {
  if (!(globalThis.crypto && crypto.subtle && crypto.subtle.digest)) return null;
  return V.hex(await crypto.subtle.digest('SHA-256', buf));
}

function loadFile(file) {
  const have = D.parsed.get(file);
  if (have && !have.failed && !have.textDropped) return Promise.resolve(have);
  if (D.pending.has(file)) return D.pending.get(file);
  const url = RAW + 'vaccines/' + file;
  const pr = (async () => {
    try {
      const buf = await fetchOnce(url, 'bytes');
      const text = new TextDecoder('utf-8').decode(buf);
      const p = V.parseVaccine(file, text);
      const rawHex = await sha256hex(buf);
      const norm = V.normalise(text);
      const lfHex = rawHex == null ? null : (norm === text ? rawHex : await sha256hex(new TextEncoder().encode(norm)));
      const status = V.lockStatus(D.lock, file, rawHex, lfHex);
      const adapted = V.hasPrivateWord(text) || V.hasPrivateWord(file);
      const entry = { p, status, rawHex, lfHex, bytes: buf.byteLength, adapted, failed: false, textDropped: false, at: NET.fetches };
      D.parsed.set(file, entry);
      capText();
      return entry;
    } catch (err) {
      const entry = { p: null, failed: true, why: err.message, status: { state: 'NOT COMPUTED', detail: `the file could not be read: ${err.message}` } };
      D.parsed.set(file, entry);
      return entry;
    } finally {
      urlCache.delete(url);           // the parsed record is kept; the bytes are not
      D.pending.delete(file);
    }
  })();
  D.pending.set(file, pr);
  return pr;
}

/* keep counts for every file, section text for at most TEXT_CAP of them */
function capText() {
  const withText = [...D.parsed.entries()].filter(([, e]) => !e.failed && !e.textDropped);
  if (withText.length <= TEXT_CAP) return;
  const selFile = S.sel >= 0 ? D.ring[S.sel].file : null;
  withText.sort((a, b) => a[1].at - b[1].at);
  for (const [f, e] of withText) {
    if (withText.filter(([, x]) => !x.textDropped).length <= TEXT_CAP) break;
    if (f === selFile) continue;
    e.p = { ...e.p, sections: null, code: null }; e.textDropped = true;
  }
}

document.querySelectorAll('input[data-layer]').forEach(box => {
  box.checked = false;
  box.addEventListener('change', () => {
    const id = box.dataset.layer;
    RT[id].visible = box.checked;
    if (box.checked) hydrate(id); else if (!RT[id].loaded && !RT[id].loading) updateUIState(id, 'WAIT');
    refresh();
  });
});

/* ── derived state ──────────────────────────────────────────────────────── */
function parsedMap() { const m = new Map(); for (const [f, e] of D.parsed) if (!e.failed && e.p) m.set(f, e.p); return m; }

function refresh() {
  if (RT.ring.loaded) {
    D.edges = V.buildEdges(D.ring, parsedMap());
    if (RT.gen.loaded) updateUIState('gen', D.edges.gen.length ? 'OK' : 'EMPTY', D.edges.gen.length ? `${D.edges.gen.length} edges` : 'no two consecutive vaccines with readable generations');
    if (RT.dose.loaded) {
      const by = {}; for (const e of D.edges.dose) by[e.dose] = (by[e.dose] || 0) + 1;
      updateUIState('dose', D.edges.dose.length ? 'OK' : 'EMPTY', D.edges.dose.length ? `${D.edges.dose.length} edges · ${Object.entries(by).map(([k, n]) => `${k} ${n}`).join(' · ')}` : 'no dose is shared by two readable vaccines');
    }
    if (RT.sup.loaded) updateUIState('sup', D.edges.sup.length ? 'OK' : 'EMPTY', D.edges.sup.length ? `${D.edges.sup.length} edge${D.edges.sup.length === 1 ? '' : 's'}` : 'no vaccine read names a superseded_by successor that exists');
  }
  paintSummary();
  paintIntegrity();
  paintQuestions();
  paintMachine();
  schedule();
}

function counts() {
  const files = D.ring.map(v => D.parsed.get(v.file)).filter(Boolean);
  const read = files.filter(e => !e.failed);
  const lockKeys = D.lock ? Object.keys(D.lock) : [];
  const nameSet = new Set(D.names || []);
  return {
    found: D.ring.length + D.broken.length,
    placed: D.ring.length,
    named: D.ring.filter(v => D.lock && v.file in D.lock).length,
    read: read.length,
    locked: read.filter(e => e.status.state === 'LOCKED').length,
    differs: read.filter(e => e.status.state === 'HASH DIFFERS').length,
    notComputed: files.filter(e => e.status.state === 'NOT COMPUTED').length,
    orphan: lockKeys.filter(k => !nameSet.has(k)),
    unlocked: [...D.ring, ...D.broken].filter(v => !(D.lock && v.file in D.lock)).map(v => v.file),
    superseded: read.filter(e => e.p.meta && e.p.meta.superseded_by),
    fm: read.filter(e => e.p.problems.length),
    adapted: read.filter(e => e.adapted),
  };
}

function paintSummary() {
  if (!RT.ring.loaded) return;
  const c = counts();
  const parts = [`${c.placed} vaccines on the ring, ordered by timestamp.`];
  if (c.read) parts.push(`${c.read} files read: ${c.locked} LOCKED, ${c.differs} HASH DIFFERS${c.notComputed ? `, ${c.notComputed} NOT COMPUTED` : ''}.`);
  else parts.push('Tick Files or open Registry integrity to hash every file against vaccines.lock.');
  setText('summary', parts.join(' '));
}

function paintIntegrity() {
  if (!RT.ring.loaded) return;
  const c = counts();
  const allRead = RT.files.loaded && D.filesRead >= D.ring.length;
  const need = n => (allRead ? String(n) : `${n} so far (${c.read} of ${c.placed} files read)`);
  const listApi = !/fallback/.test(D.listMethod);
  setText('i-found', `${c.found} .md files (${c.placed} placed on the ring)`);
  setText('i-named', `${c.named} of ${c.placed}`);
  setText('i-locked', c.read ? need(c.locked) : 'not yet known: tick Files');
  setText('i-differs', c.read ? need(c.differs) : 'not yet known: tick Files');
  setText('i-orphan', listApi ? `${c.orphan.length}${c.orphan.length ? ': ' + c.orphan.map(V.adapt).join(', ') : ''}` : 'not established: the contents listing was refused, so the lock itself supplied the names');
  setText('i-unlocked', `${c.unlocked.length}${c.unlocked.length ? ': ' + c.unlocked.map(V.adapt).join(', ') : ''}`);
  setText('i-super', c.read ? need(c.superseded.length) + (c.superseded.length ? ' · ' + c.superseded.map(e => `${V.adapt(e.p.meta.vaccine)} → ${V.adapt(e.p.meta.superseded_by)}`).join(', ') : '') : 'not yet known: tick Files');
  setText('i-names', listApi ? `${c.found ? D.broken.length : 0}${D.broken.length ? ': ' + D.broken.map(b => `${V.adapt(b.file)} (${b.why})`).join('; ') : ''}` : 'not established: the listing was refused');
  setText('i-dup', String(D.dup));
  setText('i-fm', c.read ? need(c.fm.length) : 'not yet known: tick Files');
  setText('i-other', listApi ? `${D.others.length}${D.others.length ? ': ' + D.others.map(V.adapt).join(', ') + ' (not vaccines)' : ''}` : 'not established: the listing was refused');
  setText('i-adapted', c.read ? need(c.adapted.length) + (c.adapted.length ? ' · shown by file slug: ' + c.adapted.map(e => V.adapt(e.p.name.ok ? e.p.name.slug : e.p.file)).join(', ') : '') : 'not yet known: tick Files');
  const lines = [];
  if (D.listNote) lines.push(D.listNote);
  for (const e of c.fm) for (const pr of e.p.problems) lines.push(`${V.adapt(e.p.file)}: ${V.adapt(pr)}`);
  for (const r of D.edges.reasons) lines.push(V.adapt(r));
  for (const v of D.ring) { const e = D.parsed.get(v.file); if (e && (e.failed || e.status.state !== 'LOCKED')) lines.push(`${V.adapt(v.file)}: ${e.status.state} — ${V.adapt(e.status.detail)}`); }
  const key = lines.join('\n');
  const ul = $('i-list');
  if (ul.dataset.key !== key) { ul.dataset.key = key; ul.replaceChildren(...lines.map(t => el('li', null, t))); }
}

const SLD_RE = /\b(substations?|cables?|busbars?|feeders?|transformers?|earthing|leaf|dead ends?|grid)\b/i;
function paintQuestions() {
  if (!$('questions').open) return;
  const read = D.ring.map(v => [v, D.parsed.get(v.file)]).filter(([, e]) => e && !e.failed);
  const key = `${read.length}:${D.edges.sup.length}`;
  if ($('q-draw').dataset.key === key) return;
  $('q-draw').dataset.key = key;
  if (!read.length) return;
  const items = [];
  const repos = new Map();
  let noText = 0;
  for (const [v, e] of read) {
    if (!e.p.sections) { noText++; continue; }
    const hay = `${e.p.sections.Disease || ''}\n${e.p.sections.Symptom || ''}`;
    const m = hay.match(SLD_RE);
    if (m) {
      const first = (e.p.sections.Disease || '').split(/(?<=\.)\s/)[0];
      const li = el('li');
      li.append(el('code', null, V.adapt(v.slug)), ` matched "${m[0]}": ${V.adapt(first)}`);
      items.push(li);
    }
    for (const r of V.reposNamed(e.p.sections.Provenance || '')) repos.set(r, (repos.get(r) || []).concat(v.slug));
  }
  $('q-draw').replaceChildren(...(items.length ? items : [el('li', 'dim', `EMPTY — none of the ${read.length} files read names a grid element in Disease or Symptom.`)]));
  const next = $('q-next'); next.textContent = '';
  const sup = D.edges.sup.map(e => `${V.adapt(D.ring[e.a].slug)} is retired in favour of ${V.adapt(D.ring[e.b].slug)}`);
  next.append(sup.length ? `Inside the registry: ${sup.join('; ')}. ` : 'Inside the registry: no superseded_by edge among the files read. ');
  const rs = [...repos.entries()].sort((a, b) => b[1].length - a[1].length);
  next.append(rs.length ? `Out of the registry, the repositories named in Provenance, where each disease was first observed (name-match on "Ventusltd/…"): ${rs.map(([r, s]) => `${r} (${s.length})`).join(', ')}. ` : 'Out of the registry: no Provenance read names a Ventusltd repository. ');
  next.append(`Each consumer workflow runs inoculate.mjs on its own push, so the next element is that repository's pinned call; which cvaa commit each consumer pins is not established here.${noText ? ` ${noText} files had their text dropped by the memory cap and were not searched; tap one to read it again.` : ''}`);
}

function paintMachine() {
  const c = RT.ring.loaded ? counts() : null;
  setText('machine', `Machine detail · inputs: GitHub contents listing of vaccines/ at ${COMMIT} (JSON: file name, bytes); vaccines.lock (JSON: file name → sha256, 64 hex); each vaccine file (UTF-8 markdown bytes); vaccines/last-fired.json (JSON: vaccine name → sha, the 40-hex commit of the repository inoculated, and at, ISO-8601 UTC). Outputs: ring rank by 12-digit timestamp (dimensionless), sha256 of the file bytes by SubtleCrypto (64 hex) and its lock state LOCKED | NOT IN LOCK | HASH DIFFERS | NOT COMPUTED, integrity counts. Refusals: EMPTY on HTTP 404, FAIL on any other HTTP error, bad JSON or the 15 s timeout, NOT COMPUTED when SubtleCrypto is absent; names breaking the filename rule are counted, never placed. Measured now: ${NET.fetches} fetches, ${NET.bytes} bytes, peak concurrency ${queue.peak} of 4${c ? `, ${c.read} files parsed, listing from ${D.listMethod}` : ''}.`);
}

/* ── the card ───────────────────────────────────────────────────────────── */
const DOSE_WORDS = { 'every-loop': 'every loop', 'every-commit': 'every commit', 'every-deploy': 'every deploy' };
const tsWords = ts => `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)} ${ts.slice(8, 10)}:${ts.slice(10, 12)}`;

async function select(i) {
  if (!D.ring.length) return;
  S.sel = (i + D.ring.length) % D.ring.length;
  const epoch = ++S.epoch;
  const v = D.ring[S.sel];
  schedule();
  const card = $('card');
  card.replaceChildren(el('h3', null, V.adapt(v.slug)), el('p', 'dim', `LOAD — reading ${V.adapt(v.file)} at ${short(COMMIT)}…`));
  tick('fired');
  const [e] = await Promise.all([loadFile(v.file), hydrate('fired')]);
  if (epoch !== S.epoch) return;
  paintCard(v, e);
  refresh();
}

function row(dl, dt, dd) { dl.append(el('dt', null, dt)); const d = el('dd'); if (typeof dd === 'string') d.textContent = dd; else d.append(...[].concat(dd)); dl.append(d); return d; }

function paintCard(v, e) {
  const card = $('card');
  const nodes = [];
  const h = el('h3', null, V.adapt(v.slug));
  nodes.push(h);
  if (e.adapted) { const note = el('p'); note.append(el('span', 'adapted', 'wording adapted for this page: a private word for illusion is shown as "illusion"; the file on GitHub holds the original bytes, and the hash below is over those bytes')); nodes.push(note); }
  const dl = el('dl');
  row(dl, 'timestamp', `${tsWords(v.ts)} · ${v.ts}, position ${S.sel + 1} of ${D.ring.length} on the ring`);
  if (e.failed) {
    row(dl, 'file', `FAIL — ${e.why}. Tap the node again to retry.`);
    D.parsed.delete(v.file);
  } else {
    const m = e.p.meta || {};
    row(dl, 'generation', m.generation ? `${m.generation}${m.generation === v.ts ? ' (equals the filename timestamp)' : ' (differs from the filename timestamp)'}` : 'EMPTY — no generation in front matter');
    row(dl, 'dose', m.dose ? `${DOSES_OK(m.dose)}` : 'EMPTY — no dose in front matter');
    row(dl, 'superseded_by', m.superseded_by ? `${V.adapt(m.superseded_by)} — this vaccine is retired and inoculate.mjs skips it` : 'none: this vaccine is active');
    if (!e.p.sections) row(dl, 'sections', 'the section text was dropped by the memory cap; tap again to read it');
    else {
      row(dl, 'Disease', V.adapt(e.p.sections.Disease || 'EMPTY — no Disease section'));
      row(dl, 'Symptom', V.adapt(e.p.sections.Symptom || 'EMPTY — no Symptom section'));
      row(dl, 'Dose', V.adapt(e.p.sections.Dose || 'EMPTY — no Dose section'));
      row(dl, 'Provenance', V.adapt(e.p.sections.Provenance || 'EMPTY — no Provenance section'));
      const pre = el('pre');
      pre.textContent = e.p.code == null ? 'EMPTY — no ```js block' : V.adapt(e.p.code);   // text only, never executed
      row(dl, 'Antibody (source, not run)', pre);
    }
    const st = el('span', 'state', e.status.state);
    row(dl, 'sha256', [st, ` — ${V.adapt(e.status.detail)}`, el('br'), el('code', null, e.rawHex || 'NOT COMPUTED: SubtleCrypto is not available in this browser context'), ` over ${e.bytes} bytes`]);
    if (e.p.problems.length) row(dl, 'rules', V.adapt(e.p.problems.join('; ')));
  }
  const name = (e.p && e.p.meta && e.p.meta.vaccine) || v.slug;
  if (D.fired && D.fired[name]) {
    const f = D.fired[name];
    row(dl, 'last fired', `${f.at || 'time not recorded'} · commit ${f.sha || 'not recorded'}`);
  } else if (D.fired === null) row(dl, 'last fired', `no firing recorded — ${D.firedWhy}`);
  else if (D.fired) row(dl, 'last fired', 'no firing recorded — last-fired.json has no entry for this vaccine');
  else row(dl, 'last fired', `not yet known — ${($('lbl-fired').textContent.match(/\[(.*)\]/) || [])[1] || 'WAIT'}`);
  nodes.push(dl);
  const btns = el('p', 'btns');
  btns.append(link(BLOB + 'vaccines/' + v.file, 'CODE', 'btn'), link(BLOB + 'README.md', 'APP', 'btn'));
  nodes.push(btns);
  const fx = el('details', 'fixture');
  fx.append(el('summary', 'small', 'Diseased fixture in tools/selftest.mjs'), el('p', 'small dim', 'WAIT — opens on tap.'));
  fx.addEventListener('toggle', () => { if (fx.open) paintFixture(fx, v.slug); });
  nodes.push(fx);
  card.replaceChildren(...nodes);
}
const DOSES_OK = d => (V.DOSES.includes(d) ? `${d}: the antibody is meant to run ${DOSE_WORDS[d]}` : `${V.adapt(d)} — not one of ${V.DOSES.join(' | ')}`);

async function paintFixture(fx, slug) {
  const p = fx.querySelector('p');
  p.textContent = 'LOAD — reading tools/selftest.mjs…';
  try {
    const src = await fetchOnce(URL_SELFTEST, 'text');
    const lines = src.split('\n');
    const idx = lines.findIndex(l => l.includes(`'${slug}':`) || l.includes(`"${slug}":`));
    p.textContent = '';
    if (idx < 0) { p.append(`EMPTY — no DISEASED entry keyed '${V.adapt(slug)}' found by name-match in tools/selftest.mjs; the selftest may exercise this antibody another way.`); return; }
    p.append(`The DISEASED table keys a fixture for this vaccine at line ${idx + 1} (name-match). selftest requires the antibody to fire on it and stay silent on CLEAN. `, link(`${BLOB}tools/selftest.mjs#L${idx + 1}`, 'CODE', 'btn'));
    const pre = el('pre');
    pre.textContent = V.adapt(lines.slice(idx, idx + 6).join('\n'));
    p.after(pre);
  } catch (err) { p.textContent = `FAIL — ${err.message}. Close and open again to retry.`; }
}

/* ── the ring ───────────────────────────────────────────────────────────── */
const canvas = $('ring');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, DPR = 1;
function resize() {
  const r = canvas.getBoundingClientRect();
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = r.width; H = r.height;
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  if (!S.fitted) fit(); else schedule();
}
const baseK = () => Math.min(W, H) * (W >= 700 ? 0.3 : 0.4);
function fit() { S.view = { x: 0, y: 0, k: baseK() }; S.fitted = W > 0; schedule(); }
const sx = x => W / 2 + (x - S.view.x) * S.view.k;
const sy = y => H / 2 + (y - S.view.y) * S.view.k;
const wx = px => (px - W / 2) / S.view.k + S.view.x;
const wy = py => (py - H / 2) / S.view.k + S.view.y;
const pos = i => { const t = -Math.PI / 2 + (2 * Math.PI * i) / D.ring.length; return [Math.cos(t), Math.sin(t), t]; };

let queued = false, lastDraw = 0;
function schedule() { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; draw(); }); } }

function cased(path, color, width, dash) {
  ctx.setLineDash([]); ctx.lineCap = 'round';
  ctx.strokeStyle = '#000'; ctx.lineWidth = width + 3; path(); ctx.stroke();
  ctx.setLineDash(dash || []); ctx.strokeStyle = color; ctx.lineWidth = width; path(); ctx.stroke();
  ctx.setLineDash([]);
}
const COL = { gen: '#9aa3b8', 'every-loop': '#5ec8f2', 'every-commit': '#c9a2ff', 'every-deploy': '#f2a7c8' };

function draw() {
  const t0 = performance.now();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, W, H);
  const N = D.ring.length;
  if (!RT.ring.loaded || !RT.ring.visible) {
    ctx.fillStyle = '#8b93a7'; ctx.font = '12px ui-monospace, Menlo, Consolas, monospace'; ctx.textAlign = 'center';
    ctx.fillText(RT.ring.loaded ? 'Ring hidden: tick Ring to draw it' : (RT.ring.loading ? 'LOAD — reading the listing…' : 'WAIT — tick Ring, or tap ‹ ›'), W / 2, H / 2);
    setText('drawn', 'drawn: 0 nodes');
    return;
  }
  const k = S.view.k;
  ctx.strokeStyle = '#1b2030'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(sx(0), sy(0), k, 0, Math.PI * 2); ctx.stroke();
  let edges = 0;
  if (RT.gen.visible && RT.gen.loaded) for (const e of D.edges.gen) {
    const [ax, ay] = pos(e.a), [bx, by] = pos(e.b);
    cased(() => { ctx.beginPath(); ctx.moveTo(sx(ax), sy(ay)); ctx.lineTo(sx(bx), sy(by)); }, COL.gen, 1.6); edges++;
  }
  if (RT.dose.visible && RT.dose.loaded) {
    const bend = { 'every-loop': 0.78, 'every-commit': 0.58, 'every-deploy': 0.38 };
    for (const e of D.edges.dose) {
      const [ax, ay] = pos(e.a), [bx, by] = pos(e.b);
      const f = bend[e.dose];
      cased(() => { ctx.beginPath(); ctx.moveTo(sx(ax), sy(ay)); ctx.quadraticCurveTo(sx((ax + bx) / 2 * f), sy((ay + by) / 2 * f), sx(bx), sy(by)); }, COL[e.dose], 1.8); edges++;
    }
  }
  if (RT.sup.visible && RT.sup.loaded) for (const e of D.edges.sup) {
    const [ax, ay] = pos(e.a), [bx, by] = pos(e.b);
    const X1 = sx(ax), Y1 = sy(ay), X2 = sx(bx), Y2 = sy(by);
    cased(() => { ctx.beginPath(); ctx.moveTo(X1, Y1); ctx.lineTo(X2, Y2); }, '#ffffff', 2, [6, 4]);
    const a = Math.atan2(Y2 - Y1, X2 - X1), L = 11, back = 9;
    const tx = X2 - Math.cos(a) * back, ty = Y2 - Math.sin(a) * back;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx - L * Math.cos(a - 0.45), ty - L * Math.sin(a - 0.45)); ctx.lineTo(tx - L * Math.cos(a + 0.45), ty - L * Math.sin(a + 0.45)); ctx.closePath();
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.stroke(); ctx.fill();
    edges++;
  }
  const r = Math.max(3, Math.min(9, 2 + k * 0.012));
  const spacing = (2 * Math.PI * k) / Math.max(1, N);
  const labels = spacing >= 13 && (W >= 700 || k >= baseK() * 1.8);   // on a phone the whole ring fits only without labels
  let drawnNodes = 0, fired = 0;
  ctx.font = `${Math.min(12, Math.max(9, spacing * 0.7))}px ui-monospace, Menlo, Consolas, monospace`;
  for (let i = 0; i < N; i++) {
    const [x, y, t] = pos(i);
    const X = sx(x), Y = sy(y);
    if (X < -60 || Y < -60 || X > W + 60 || Y > H + 60) continue;
    drawnNodes++;
    const e = D.parsed.get(D.ring[i].file);
    const read = e && !e.failed;
    const sup = read && e.p.meta && e.p.meta.superseded_by;
    ctx.beginPath(); ctx.arc(X, Y, r, 0, Math.PI * 2);
    if (sup) { ctx.fillStyle = '#05060a'; ctx.fill(); ctx.lineWidth = 3.5; ctx.strokeStyle = '#000'; ctx.stroke(); ctx.lineWidth = 2; ctx.strokeStyle = '#eceff4'; ctx.stroke(); ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(X, Y, r + 4, 0, Math.PI * 2); ctx.strokeStyle = '#6b7385'; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]); }
    else if (read) { ctx.fillStyle = '#eceff4'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#000'; ctx.stroke(); }
    else { ctx.fillStyle = '#14161c'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#6b7385'; ctx.stroke(); }
    const name = read && e.p.meta && e.p.meta.vaccine || D.ring[i].slug;
    if (RT.fired.visible && D.fired && D.fired[name]) {
      fired++;
      ctx.beginPath(); ctx.arc(X + Math.cos(t) * (r + 7), Y + Math.sin(t) * (r + 7), 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#5ec8f2'; ctx.fill();
    }
    if (i === S.sel) { ctx.beginPath(); ctx.arc(X, Y, r + 6, 0, Math.PI * 2); ctx.strokeStyle = '#000'; ctx.lineWidth = 4; ctx.stroke(); ctx.strokeStyle = '#5ec8f2'; ctx.lineWidth = 2; ctx.stroke(); }
    if (labels) {
      const full = V.adapt(D.ring[i].slug); const text = full.length > 30 ? full.slice(0, 29) + '…' : full;
      ctx.save();
      ctx.translate(X, Y);
      const left = Math.cos(t) < 0;
      ctx.rotate(left ? t + Math.PI : t);
      ctx.textAlign = left ? 'right' : 'left'; ctx.textBaseline = 'middle';
      const off = (left ? -1 : 1) * (r + 12);
      ctx.lineWidth = 3; ctx.strokeStyle = '#05060a'; ctx.strokeText(text, off, 0);
      ctx.fillStyle = i === S.sel ? '#ffffff' : '#c3cad8'; ctx.fillText(text, off, 0);
      ctx.restore();
    }
  }
  if (!labels && S.sel >= 0 && S.sel < N) {   /* the selected name, level at the centre, so it never leaves the canvas */
    const full = V.adapt(D.ring[S.sel].slug);
    ctx.font = '12px ui-monospace, Menlo, Consolas, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 4; ctx.strokeStyle = '#05060a'; ctx.strokeText(full, sx(0), sy(0)); ctx.fillStyle = '#ffffff'; ctx.fillText(full, sx(0), sy(0));
    ctx.fillStyle = '#8b93a7'; ctx.font = '10.5px ui-monospace, Menlo, Consolas, monospace'; ctx.fillText(D.ring[S.sel].ts, sx(0), sy(0) + 16);
  }
  lastDraw = performance.now() - t0;
  setText('drawn', `drawn: ${drawnNodes} of ${N} nodes · ${edges} edges${RT.fired.visible && D.fired ? ` · ${fired} fired marks` : ''} · labels ${labels ? "on" : "off (zoom in or tap a node)"} · ${lastDraw.toFixed(1)} ms`);
}

/* ── touch: drag to pan, pinch or wheel to zoom, tap to read ────────────── */
const pointers = new Map();
let gesture = null;
const at = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
function pinchState() { const [a, b] = [...pointers.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; }
function zoomAbout(px, py, k) {
  const X = wx(px), Y = wy(py);
  const base = baseK();
  S.view.k = Math.max(base * 0.5, Math.min(base * 12, k));
  S.view.x = X - (px - W / 2) / S.view.k; S.view.y = Y - (py - H / 2) / S.view.k;
  S.view.x = Math.max(-1.6, Math.min(1.6, S.view.x)); S.view.y = Math.max(-1.6, Math.min(1.6, S.view.y));
  schedule();
}
canvas.addEventListener('pointerdown', e => {
  try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer */ }
  pointers.set(e.pointerId, at(e));
  if (pointers.size === 1) gesture = { tap: true, x0: at(e).x, y0: at(e).y, vx: S.view.x, vy: S.view.y };
  else if (pointers.size === 2) { const p = pinchState(); gesture = { tap: false, pinch: { ...p, k: S.view.k } }; }
});
canvas.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId) || !gesture) return;
  const pt = at(e);
  pointers.set(e.pointerId, pt);
  if (pointers.size === 1 && !gesture.pinch) {
    if (Math.hypot(pt.x - gesture.x0, pt.y - gesture.y0) > 8) gesture.tap = false;
    if (!gesture.tap) { S.view.x = Math.max(-1.6, Math.min(1.6, gesture.vx - (pt.x - gesture.x0) / S.view.k)); S.view.y = Math.max(-1.6, Math.min(1.6, gesture.vy - (pt.y - gesture.y0) / S.view.k)); schedule(); }
  } else if (pointers.size >= 2 && gesture.pinch) {
    const p = pinchState(), g = gesture.pinch;
    zoomAbout(p.mx, p.my, g.k * (p.d / g.d));
  }
});
function up(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (gesture && gesture.tap && pointers.size === 0) { const pt = at(e); tapAt(pt.x, pt.y); }
  if (pointers.size === 0) gesture = null;
}
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); gesture = null; });
canvas.addEventListener('wheel', e => { e.preventDefault(); const pt = at(e); zoomAbout(pt.x, pt.y, S.view.k * Math.exp(-e.deltaY * 0.0015)); }, { passive: false });

function tapAt(px, py) {
  if (!RT.ring.loaded) { tick('ring'); hydrate('ring'); return; }
  let best = -1, bd = 24;
  for (let i = 0; i < D.ring.length; i++) { const [x, y] = pos(i); const d = Math.hypot(sx(x) - px, sy(y) - py); if (d < bd) { bd = d; best = i; } }
  if (best >= 0) select(best);
}
async function step(d) {
  if (!RT.ring.loaded) { tick('ring'); const ok = await hydrate('ring'); if (!ok) return; select(0); return; }
  select(S.sel < 0 ? (d > 0 ? 0 : D.ring.length - 1) : S.sel + d);
}
$('prev').addEventListener('click', () => step(-1));
$('next').addEventListener('click', () => step(1));
$('fit').addEventListener('click', fit);

$('integrity').addEventListener('toggle', () => { if ($('integrity').open) { tick('ring'); tick('files'); hydrate('files'); } });
$('questions').addEventListener('toggle', () => { if ($('questions').open) { $('q-draw').dataset.key = ''; paintQuestions(); } });

window.addEventListener('resize', resize);
new ResizeObserver(resize).observe(canvas);

$('pin').textContent = COMMIT;
$('q-code').href = BLOB + 'inoculate.mjs';
$('q-app').href = BLOB + 'README.md';
$('prov').textContent = `Source: github.com/Ventusltd/cvaa at ${COMMIT}. File bytes from raw.githubusercontent.com; the vaccines/ listing from the GitHub contents API at that commit.`;
paintMachine();
resize();

/* test hook: read-only numbers for the receipts */
window.__immunity = { counts: () => (RT.ring.loaded ? counts() : null), net: NET, queue, RT, D, lastDraw: () => lastDraw, cacheSize: () => urlCache.size };
