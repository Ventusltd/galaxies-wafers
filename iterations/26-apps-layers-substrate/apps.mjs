/* apps.mjs — the top tier: apps as tabs over the layers over the substrate.
 *
 * THREE TIERS ON ONE PAGE.
 *   SUBSTRATE  every permanently numbered line of the estate, drawn dark
 *              (app.mjs, iteration 21's dark wafer).
 *   LAYERS     layers/manifest.json: one module-<symbol> layer per register
 *              block, plus the other layers (layers-panel.mjs).
 *   APPS       the tabs across the top. Selecting one wakes exactly that app's
 *              module layers on the substrate.
 *
 * WHERE THE APPS COME FROM. Nothing here is a typed list of apps. The live block
 * register (stars/blocks/blocks.json) gives every block its files, each with a
 * repository, a path and, when it is served, a live URL. A file belongs to the
 * app that is its repository plus the first folder of its path (or the first
 * two folders, when the reader asks for the finer grouping; "depth" below). A
 * block belongs to every app one of its files belongs to, so a block copied
 * into two apps is counted in both, as the register records it. A block with
 * no file belongs to "No app".
 *
 * WHAT A TAB IS CALLED. When the files are served, the app's live URL is the
 * served base of a file plus that folder. The tab is named from the <title> of
 * the page found there, fetched only when the tab scrolls into view, through the
 * page's one bounded queue, reading at most the first 64 KB. When no page is
 * served there (a folder of scripts answers 404) the tab keeps its folder name
 * and the card says why.
 *
 * WHAT IS COUNTED. Modules are counted from the register; lines are counted from
 * the layers once they have loaded (distinct permanent keys), so the line count
 * is a measurement of what is on the wafer, never a number from the register.
 */
import { run, fetchJSON } from './queue.mjs';

const REGISTER = 'https://ventusltd.github.io/stars/blocks/blocks.json';
const ALL = '~all', NONE = '~none';
const TITLE_BYTES = 64 * 1024;

const $ = id => document.getElementById(id);
const fmt = n => Number(n).toLocaleString('en-GB');
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = String(text);
  return n;
};
const link = (href, text) => {
  const a = el('a', 'alink', text);
  a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
  return a;
};

let register = null;          /* the live block register */
let bySymbol = new Map();
let manifest = null;
let layerIds = new Set();
let depth = 1;
let apps = new Map();         /* id -> {id, repo, folder, url, blocks: Map(symbol -> block)} */
let appsOfSymbol = new Map(); /* symbol -> Set(app id) */
const titles = new Map();     /* url -> {status, title, why} */
let current = null;           /* selected app id */
let tabEls = new Map();
let cardRows = new Map();     /* symbol -> row element, for the selected app only */
let observer = null;

/* ── grouping, from the register ─────────────────────────────────────────── */

function appOfFile(f, d) {
  const segs = String(f.path || '').split('/').filter(Boolean);
  const folderSegs = segs.slice(0, -1).slice(0, d);
  const repoName = String(f.repo || 'unknown').split('/').pop();
  const folder = folderSegs.join('/');
  let url = null;
  if (typeof f.live === 'string' && f.path && f.live.endsWith(f.path)) {
    url = f.live.slice(0, f.live.length - f.path.length) + (folder ? folder + '/' : '');
  }
  return { id: [repoName, ...folderSegs].join('~'), repo: f.repo, folder, url };
}

function group(d) {
  apps = new Map(); appsOfSymbol = new Map();
  const none = { id: NONE, repo: null, folder: '', url: null, blocks: new Map() };
  for (const b of register.blocks) {
    const mine = new Set();
    for (const f of (b.files || [])) {
      const a = appOfFile(f, d);
      if (!apps.has(a.id)) apps.set(a.id, { ...a, blocks: new Map() });
      const app = apps.get(a.id);
      if (!app.url && a.url) app.url = a.url;
      app.blocks.set(b.symbol, b);
      mine.add(a.id);
    }
    if (!mine.size) { none.blocks.set(b.symbol, b); mine.add(NONE); }
    appsOfSymbol.set(b.symbol, mine);
  }
  const sorted = [...apps.values()].sort((x, y) => y.blocks.size - x.blocks.size || x.id.localeCompare(y.id));
  apps = new Map([[ALL, { id: ALL, repo: null, folder: '', url: null, blocks: bySymbol }],
                  ...sorted.map(a => [a.id, a]), [NONE, none]]);
}

const folderName = a => a.id === ALL ? 'All apps' : a.id === NONE ? 'No app'
  : a.repo.split('/').pop() + (a.folder ? ' / ' + a.folder : ' (repository root)');

function nameOf(a) {
  const t = a.url && titles.get(a.url);
  return t && t.status === 'OK' && t.title ? t.title : folderName(a);
}

/* ── titles, fetched lazily through the bounded queue ────────────────────── */

function wantTitle(a) {
  if (!a.url || titles.has(a.url)) return;
  const rec = { status: 'LOAD', title: '', why: '' };
  titles.set(a.url, rec);
  const url = a.url;
  run(async signal => {
    const r = await fetch(url, { cache: 'default', signal });
    if (!r.ok) throw new Error(`no page is served at this folder (HTTP ${r.status})`);
    const type = r.headers.get('content-type') || '';
    if (!/html/i.test(type)) { r.body?.cancel(); throw new Error(`the folder answers with ${type || 'no content type'}, not a page`); }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let text = '', bytes = 0, m = null;
    while (bytes < TITLE_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length; text += dec.decode(value, { stream: true });
      m = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      if (m) break;
    }
    reader.cancel().catch(() => {});
    if (!m) throw new Error(`the page carries no <title> in its first ${fmt(Math.round(TITLE_BYTES / 1024))} KB`);
    const doc = new DOMParser().parseFromString(`<title>${m[1]}</title>`, 'text/html');
    const t = doc.title.replace(/\s+/g, ' ').trim();
    if (!t) throw new Error('the page title is empty');
    return t;
  }, () => tabEls.has(a.id) || current === a.id)
    .then(t => { rec.status = 'OK'; rec.title = t; })
    .catch(e => { if (e.unwanted) { titles.delete(url); return; } rec.status = 'FAIL'; rec.why = e.message; })
    .finally(() => { for (const x of apps.values()) if (x.url === url) paintTab(x); if (apps.get(current)?.url === url) paintHead(); });
}

/* ── tabs ────────────────────────────────────────────────────────────────── */

function buildTabs() {
  const strip = $('apps');
  observer?.disconnect();
  strip.replaceChildren();
  tabEls = new Map();
  observer = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { const a = apps.get(e.target.dataset.app); if (a) wantTitle(a); }
  }, { root: strip, rootMargin: '0px 120px' });
  for (const a of apps.values()) {
    const b = el('button', 'tab');
    b.type = 'button'; b.dataset.app = a.id;
    b.setAttribute('role', 'tab');
    b.append(el('span', 'tname'), el('span', 'tcount'));
    b.addEventListener('click', () => select(a.id));
    strip.appendChild(b);
    tabEls.set(a.id, b);
    paintTab(a);
    if (a.url) observer.observe(b);
  }
}

function paintTab(a) {
  const b = tabEls.get(a.id);
  if (!b) return;
  b.querySelector('.tname').textContent = nameOf(a);
  b.querySelector('.tcount').textContent = ' ' + fmt(a.blocks.size);
  b.title = `${folderName(a)} · ${fmt(a.blocks.size)} register blocks`;
  b.setAttribute('aria-selected', String(a.id === current));
}

/* ── selecting an app ────────────────────────────────────────────────────── */

function layersFor(a) {
  if (a.id === ALL) return layerIds.has('blocks') ? ['blocks'] : [];
  return [...a.blocks.keys()].map(s => 'module-' + s).filter(id => layerIds.has(id));
}

function select(id, { scroll = true } = {}) {
  const prev = current;
  current = apps.has(id) ? id : ALL;
  if (prev && tabEls.get(prev)) paintTab(apps.get(prev));
  const a = apps.get(current);
  paintTab(a);
  if (scroll) tabEls.get(current)?.scrollIntoView({ block: 'nearest', inline: 'center' });
  wantTitle(a);
  window.__layers.setApp(layersFor(a));
  writeURL();
  buildCard(a);
}

function writeURL() {
  const u = new URL(location.href);
  if (current && current !== ALL) u.searchParams.set('app', current); else u.searchParams.delete('app');
  if (depth !== 1) u.searchParams.set('depth', String(depth)); else u.searchParams.delete('depth');
  const next = u.pathname + u.search.replace(/%2C/gi, ',').replace(/%7E/gi, '~') + u.hash;
  if (next !== location.pathname + location.search + location.hash) history.replaceState(history.state, '', next);
}

/* ── the card: the selected app, its modules and its questions ──────────── */

const phone = () => window.matchMedia('(max-width: 759px)').matches;

function paintHead() {
  const a = apps.get(current);
  if (!a) return;
  $('appname').textContent = nameOf(a);
  const src = $('appsrc');
  src.replaceChildren();
  if (a.id === ALL) {
    const inApps = [...bySymbol.keys()].filter(s => !appsOfSymbol.get(s)?.has(NONE)).length;
    src.append(el('span', 'dim', `${fmt(apps.size - 2)} apps at this grouping · ${fmt(inApps)} of ${fmt(bySymbol.size)} register blocks sit in at least one · wakes the register-wide layer "blocks"`));
    return;
  }
  if (a.id === NONE) {
    src.append(el('span', 'dim', 'register blocks that list no file in any repository, so they belong to no app'));
    return;
  }
  src.append(el('span', 'dim', folderName(a) + ' · '));
  if (a.url) {
    const t = titles.get(a.url);
    /* a folder that serves no page gets no link: a link to a 404 is a dead end */
    if (t?.status === 'FAIL') src.append(el('span', 'dim', `no app to open, named from its folder: ${t.why}`));
    else {
      src.append(link(a.url, 'open the app'));
      if (t?.status === 'LOAD') src.append(el('span', 'dim', ' · reading the page title'));
    }
  } else {
    src.append(el('span', 'dim', `no live URL: the register records these files only in the repository ${a.repo}`));
  }
}

function buildCard(a) {
  paintHead();
  const body = $('appbody');
  body.replaceChildren();
  cardRows = new Map();
  body.append(el('div', 'acounts', ''));
  if (a.id !== ALL) {
    const det = el('details', 'amods');
    det.open = !phone();
    det.append(el('summary', null, 'Modules'));
    const list = el('div', 'alist');
    for (const [sym, b] of [...a.blocks].sort((x, y) => (x[1].number ?? 0) - (y[1].number ?? 0))) {
      const r = el('div', 'arow');
      r.append(el('span', 'asym', sym), el('span', 'atitle', ' ' + (b.title || '')), el('span', 'ltag WAIT', ''), el('div', 'awhy', ''));
      list.appendChild(r);
      cardRows.set(sym, r);
    }
    det.append(list);
    body.append(det);
  }
  const q = el('details', 'aq');
  q.open = !phone();
  q.append(el('summary', null, 'Questions'));
  q.append(el('div', 'aqbody'));
  body.append(q);
  refresh();
}

/* Only the selected app's rows are touched, and only when one of its layers changed. */
function refresh(changedIds) {
  const a = apps.get(current);
  if (!a) return;
  const ids = layersFor(a);
  const mem = window.__layers.memory(), kb = n => fmt(Math.round(n / 1024)) + ' KB';
  const memText = `memory: ${kb(mem.shown)} of layer files shown · ${kb(mem.hidden)} hidden and kept, cap ${kb(mem.cap)} · ${fmt(mem.evictions)} evicted`;
  if ($('appmem').textContent !== memText) $('appmem').textContent = memText;
  if (changedIds && !changedIds.some(id => ids.includes(id) || id === 'blocks')) return;
  const woken = new Set();
  let loaded = 0, ok = 0, empty = 0, fail = 0;
  const refusals = new Set();
  for (const id of ids) {
    const s = window.__layers.status(id);
    if (!s) continue;
    if (s.status === 'OK' || s.status === 'EMPTY' || s.status === 'FAIL') loaded++;
    if (s.status === 'OK') { ok++; for (const k of s.woken) woken.add(k); }
    if (s.status === 'EMPTY') empty++;
    if (s.status === 'FAIL') fail++;
    if (s.features) for (const f of s.features) for (const r of (f.properties?.refuses || [])) refusals.add(String(r));
  }
  let noLayer = 0;
  for (const [sym, b] of a.blocks) {
    const r = cardRows.get(sym);
    const has = layerIds.has('module-' + sym);
    if (!has) noLayer++;
    if (!r) continue;
    const tag = r.children[2], why = r.children[3];
    let st, text;
    if (!has) {
      st = 'EMPTY';
      text = (b.named_functions ?? 0) === 0
        ? 'no layer: the register names no function inside this block, so no numbered line can be charted'
        : `no layer: the register names ${fmt(b.named_functions)} functions, but layers/manifest.json (built ${manifest.built_utc}) holds no module-${sym}`;
    } else {
      const s = window.__layers.status('module-' + sym);
      st = s.status;
      text = st === 'OK' ? `${fmt(s.woken.size)} lines woken` : (s.why || (st === 'WAIT' ? 'queued' : ''));
    }
    tag.className = 'ltag ' + String(st).split(' ')[0];
    if (tag.textContent !== `[${st}]`) tag.textContent = `[${st}]`;
    if (why.textContent !== text) why.textContent = text;
  }
  const counts = $('appbody').querySelector('.acounts');
  if (counts) {
    const parts = a.id === ALL
      ? [`${fmt(woken.size)} lines woken by the "blocks" layer`, ids.length ? `layer ${loaded ? 'loaded' : 'loading'}` : 'no "blocks" layer in the manifest']
      : [`${fmt(a.blocks.size)} ${a.blocks.size === 1 ? 'module' : 'modules'} in the register`,
         `${fmt(ids.length)} with a layer`,
         `${fmt(woken.size)} lines woken`,
         `loaded ${fmt(loaded)}/${fmt(ids.length)}`,
         ...(noLayer ? [`${fmt(noLayer)} EMPTY, no layer`] : []),
         ...(empty ? [`${fmt(empty)} layers EMPTY`] : []),
         ...(fail ? [`${fmt(fail)} FAIL`] : [])];
    counts.textContent = parts.join(' · ');
  }
  paintQuestions(a, refusals, loaded === ids.length);
}

/* ── Questions: computed from the register and the loaded layers ─────────── */

const ELEMENTS = [
  ['single-line diagram', /\bsld\b|single[ -]?line/i],
  ['busbar', /bus ?bar/i],
  ['feeder', /feeder/i],
  ['transformer', /transformer/i],
  ['substation', /substation/i],
  ['cable route', /cable|route/i],
  ['protection or fault level', /protection|fault/i],
  ['earthing', /earthing|grounding/i],
];

function list(arr, n) {
  return arr.length > n ? arr.slice(0, n).join(', ') + ` and ${fmt(arr.length - n)} more` : arr.join(', ');
}

let lastQ = '';
function paintQuestions(a, refusals, complete) {
  const box = $('appbody').querySelector('.aqbody');
  if (!box) return;
  const blocks = [...a.blocks.values()];

  /* 1: which system element a function or block title names */
  const hits = [];
  for (const [name, re] of ELEMENTS) {
    const who = [];
    for (const b of blocks) {
      if (re.test(b.title || '')) who.push(`${b.symbol} "${b.title}"`);
      for (const f of (b.inside || [])) if (re.test(f.name || '')) who.push(`${b.symbol}.${f.name}`);
    }
    if (who.length) hits.push(`${name}: ${list([...new Set(who)], 4)}`);
  }
  const q1 = hits.length
    ? hits.join('; ') + '. Method: name-match inference over block titles and function names in the register.'
    : `none yet: no block title or function name in this app names a single-line diagram, busbar, feeder, transformer, substation, cable route, protection or earthing (name-match over ${fmt(blocks.length)} blocks).`;

  /* 2: what the code is */
  const fns = [...new Set(blocks.flatMap(b => (b.inside || []).map(f => f.name)).filter(Boolean))];
  const files = new Map();
  for (const b of blocks) for (const f of (b.files || [])) {
    if (a.id !== ALL && a.id !== NONE && appOfFile(f, depth).id !== a.id) continue;
    files.set(`${f.path} @ ${String(f.commit || 'no commit').slice(0, 7)}`, 1);
  }
  const callers = [...new Set(blocks.flatMap(b => b.used_by || []))].filter(s => !a.blocks.has(s) || a.id === ALL);
  const q2 = [
    `${fmt(blocks.length)} blocks: ${list(blocks.map(b => `${b.symbol} ${b.title || ''}`.trim()), 5)}`,
    `${fmt(fns.length)} named functions: ${fns.length ? list(fns, 8) : 'none named in the register'}`,
    a.id === NONE ? 'no files: these blocks list none' : `${fmt(files.size)} files: ${list([...files.keys()], 4)}`,
    callers.length ? `called from outside by ${list(callers, 8)} (the register's used_by field)` : 'the register records no caller outside this app',
  ].join('. ') + '.';

  /* 3: where it leads, through the register's own edges */
  const next = new Map();
  if (a.id !== ALL) {
    for (const b of blocks) for (const s of [...(b.depends_on || []), ...(b.used_by || [])]) {
      for (const other of (appsOfSymbol.get(s) || [])) {
        if (other === a.id || other === NONE) continue;
        if (!next.has(other)) next.set(other, new Set());
        next.get(other).add(`${b.symbol}→${s}`);
      }
    }
  }
  const q3 = a.id === ALL ? 'every app: pick a tab to follow one.'
    : next.size
      ? [...next].sort((x, y) => y[1].size - x[1].size).slice(0, 5)
          .map(([id, e]) => `${nameOf(apps.get(id))} (${list([...e], 3)})`).join('; ')
        + '. From the register\'s depends_on and used_by fields.'
      : 'not established: the register records no depends_on or used_by edge from these blocks into another app.';

  /* machine detail */
  const needs = new Map();
  for (const b of blocks) for (const n of (b.needs || [])) needs.set(n.name, n.meaning);
  const commits = [...new Set(blocks.flatMap(b => (b.files || []).map(f => `${String(f.repo).split('/').pop()}@${String(f.commit || '').slice(0, 7)}`)))];
  const machine = [
    `inputs: ${needs.size ? list([...needs].map(([k, v]) => k === v ? k : `${k} (${v})`), 8) + '; units not recorded in the register' : 'none recorded in the register'}`,
    'outputs: not recorded in the register',
    `refusals: ${refusals.size ? list([...refusals], 6) : complete ? 'none declared in the loaded layers' : 'layers still loading'}`,
    `source commits: ${commits.length ? list(commits, 4) : 'none'}`,
    `register generated ${register.generated_utc}`,
  ].join(' · ');

  const sig = [q1, q2, q3, machine].join('|');
  if (sig === lastQ) return;
  lastQ = sig;
  box.replaceChildren();
  const qa = (q, ans) => { const d = el('div', 'qa'); d.append(el('div', 'qq', q), el('div', 'qans', ans)); box.append(d); };
  qa('How does this help draw a system or a single-line diagram?', q1);
  qa('What is this code used for?', q2);
  qa('Where does it lead next?', q3);
  const m = el('div', 'qa machine'); m.append(el('span', 'qq', 'Machine detail '), el('span', 'qans', machine)); box.append(m);
}

/* ── start ───────────────────────────────────────────────────────────────── */

(async function start() {
  const head = $('appname');
  head.textContent = 'reading the block register…';
  manifest = await window.__layers?.ready;
  if (!manifest) { head.textContent = 'Apps unavailable: the layers manifest did not load.'; return; }
  layerIds = new Set(manifest.layers.map(l => l.id));
  try {
    register = await fetchJSON(REGISTER, 'the block register returned HTTP ');
  } catch (e) {
    head.textContent = 'Apps unavailable: ' + e.message + '. The layers and the wafer are unaffected.';
    return;
  }
  bySymbol = new Map(register.blocks.map(b => [b.symbol, b]));

  const q = new URLSearchParams(location.search);
  depth = q.get('depth') === '2' ? 2 : 1;
  $('depth').value = String(depth);
  group(depth);
  buildTabs();
  const asked = q.get('app');
  select(asked && apps.has(asked) ? asked : ALL);
  if (asked && !apps.has(asked)) {
    $('appsrc').prepend(el('span', 'refuse', `The link asked for app "${asked}", which the register does not group at this depth; showing all apps. `));
  }

  $('depth').addEventListener('change', e => {
    depth = e.target.value === '2' ? 2 : 1;
    const keep = current;
    group(depth);
    buildTabs();
    select(apps.has(keep) ? keep : ALL);
  });
  $('appfold').addEventListener('click', () => {
    const b = $('appbody'); b.hidden = !b.hidden;
    $('appfold').textContent = b.hidden ? '▸' : '▾';
    $('appfold').setAttribute('aria-expanded', String(!b.hidden));
  });
  window.__layers.onChange.add(refresh);

  window.__apps = Object.freeze({
    ids: () => [...apps.keys()],
    select: id => select(id),
    get current() { return current; },
    layersFor: id => apps.has(id) ? layersFor(apps.get(id)) : null,
  });
})();
