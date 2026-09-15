/* Spider and Galaxy — one universe, two views.
 *
 * LEFT: the spider of Ventusltd/ventus-grid-engine, drawn here on a canvas from
 * the spider's own published JSON at a pinned commit (spider/manifest.json and
 * the graph files it lists). Graphs the manifest points at on another origin
 * are read live from there and labelled so.
 * RIGHT: the dark wafer of iteration 21: every permanently numbered line of
 * code, dark, with only the lines a question wakes lit.
 * THE BRIDGE (bridge.mjs): a spider node that names a numbered family, a
 * register block, or a repository and path is looked up in the live block
 * register and the numbered database; its lines are woken on the wafer. A lit
 * line on the wafer is looked up the other way, to the spider nodes that name
 * its block, its family or a file of its block.
 *
 * LOADING, LEARNED FROM GRID ATLAS (ventus-corev8engine.js): one fetch queue
 * for all network work, three at a time; every fetch has a 15 s timeout; one
 * shared promise per URL, dropped on failure so a retry can happen; a graph or
 * layer is fetched only when chosen, and its row alone is relabelled
 * WAIT / LOAD / OK / EMPTY / FAIL. Preloaded, as the Atlas preloads its
 * topology: the spider manifest, its default Federation graph, the block
 * register and the wafer's layer manifest, which the bridge cannot work without.
 */
import { readGraph, nodeRefs, indexRegister, counterpart, nodesForBlock, pathCovers } from './bridge.mjs';
import { createSpider } from './spider-pane.mjs';
import { createWafer, MAX_DRAWN, DATA } from './wafer-pane.mjs';
import { readLink } from './link.mjs';
import { esc, fmt } from '../../lib.mjs';

export const SHA = 'd9cd18b0e2034325814924e6e4a0e958014f2748';
const CDN = `https://cdn.jsdelivr.net/gh/Ventusltd/ventus-grid-engine@${SHA}/`;
const REGISTER = 'https://ventusltd.github.io/stars/blocks/blocks.json';
const ROOT = '../../';
const MAX_BLOCKS_WOKEN = 12;   /* blocks woken for one spider node */
const MAX_DOCS = 24;           /* layer files held in memory, least recently used evicted */
const $ = id => document.getElementById(id);

/* ── one queue, one cache, one timeout ─────────────────────────────────────── */
class FetchQueue {
  constructor(n) { this.n = n; this.active = 0; this.wait = []; }
  async add(task) {
    if (this.active >= this.n) await new Promise(r => this.wait.push(r));
    this.active++;
    try { return await task(); } finally { this.active--; this.wait.shift()?.(); }
  }
}
const queue = new FetchQueue(3);
const urlCache = new Map();
function fetchAs(url, kind) {
  const k = kind + ' ' + url;
  if (urlCache.has(k)) return urlCache.get(k);
  const p = queue.add(async () => {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 15000);
    try {
      const r = await fetch(url, { signal: ctl.signal, cache: 'default' });
      if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
      return kind === 'json' ? await r.json() : kind === 'text' ? await r.text() : await r.arrayBuffer();
    } catch (e) { if (e.name === 'AbortError') throw new Error('no answer within 15 s'); throw e; }
    finally { clearTimeout(t); }
  });
  urlCache.set(k, p);
  p.catch(() => urlCache.delete(k));
  return p;
}
const getJSON = u => fetchAs(u, 'json');

/* layer documents, capped */
const docs = new Map();
async function layerDoc(file) {
  if (docs.has(file)) { const d = docs.get(file); docs.delete(file); docs.set(file, d); return d; }
  const d = await getJSON(ROOT + file);
  docs.set(file, d);
  while (docs.size > MAX_DOCS) { const oldest = docs.keys().next().value; docs.delete(oldest); urlCache.delete('json ' + ROOT + oldest); }
  return d;
}

/* ── state ─────────────────────────────────────────────────────────────────── */
const st = {
  manifest: null, graphs: new Map(), current: null,
  reg: null, regRaw: null, layers: null, layerById: new Map(),
  families: null, famLines: null, contract: null,
  bridge: [], refs: []
};

const spider = createSpider($('spiderStage'), { onTap: tapSpider });
const wafer = createWafer($('waferStage'), {
  onTap: tapWafer,
  onStatus: s => { $('waferFoot').textContent = s; },
  onFrame: s => waferFoot(s)
});

let lastFoot = '';
function waferFoot(s) {
  const text = s.total
    ? `${fmt(s.total)} lines woken · ${fmt(s.inBand)} in the visible band · ${fmt(s.drawn)} drawn${s.capped ? ' (cap of ' + fmt(MAX_DRAWN) + ' reached)' : ''} · atlas zoom ${s.atlasZoom.toFixed(1)} · frame ${s.frameMs.toFixed(1)} ms`
    : `every numbered line dark · nothing woken · frame ${s.frameMs.toFixed(1)} ms`;
  if (text !== lastFoot) { $('waferFoot').textContent = text; lastFoot = text; }
}

function say(html) { $('sayBody').className = ''; $('sayBody').innerHTML = html; }

/* ── the spider's graphs ───────────────────────────────────────────────────── */
function graphUrl(p) { return /^https?:/.test(p) ? p : CDN + p.replace(/^\.\//, ''); }
function optionText(g) {
  const s = st.graphs.get(g.id) || { status: 'WAIT' };
  let t = `${g.title} [${s.status}]`;
  if (s.status === 'OK') t += ` ${fmt(s.graph.nodes.length)} nodes · ${fmt(s.graph.edges.length)} edges`;
  return t;
}
function relabel(id) {   /* update only this graph's row */
  const o = $('graphPick').querySelector(`option[value="${CSS.escape(id)}"]`);
  const g = st.manifest.graphs.find(x => x.id === id);
  if (o && g) o.textContent = optionText(g);
}

async function loadGraph(id) {
  const g = st.manifest.graphs.find(x => x.id === id);
  let s = st.graphs.get(id);
  if (s && (s.status === 'OK' || s.status === 'LOAD')) return s;
  s = { status: 'LOAD' }; st.graphs.set(id, s); relabel(id);
  try {
    const raw = await getJSON(graphUrl(g.path));
    const er = g.edges_path ? await getJSON(graphUrl(g.edges_path)) : undefined;
    s.graph = readGraph(raw, er);
    s.pinned = !/^https?:/.test(g.path);
    s.status = s.graph.nodes.length ? 'OK' : 'EMPTY';
    if (!s.graph.nodes.length) s.why = 'the file loaded and holds no nodes';
  } catch (e) {
    s.status = 'FAIL'; s.why = (e.status ? `HTTP ${e.status} for ${graphUrl(g.path)}` : e.message);
  }
  relabel(id);
  return s;
}

async function showGraph(id) {
  st.current = id;
  $('graphPick').value = id;
  const s = await loadGraph(id);
  if (st.current !== id) return;
  const g = st.manifest.graphs.find(x => x.id === id);
  if (s.status !== 'OK') {
    spider.setGraph({ nodes: [], edges: [] }, []);
    $('spiderFoot').textContent = `${g.title} [${s.status}] ${s.why || ''}`;
    say(`<h2>${esc(g.title)}</h2><p class="refuse">${s.status}: ${esc(s.why || '')}</p><p class="dim">The spider's manifest lists this graph at ${esc(g.path)}. ${esc(g.description || '')}</p>`);
    measureBridge(); writeTest(); return;
  }
  computeBridge();
  spider.setGraph(s.graph, st.bridge);
  $('spiderFoot').textContent = `${s.pinned ? 'pinned ventus-grid-engine@' + SHA.slice(0, 7) : 'read live from ' + new URL(graphUrl(g.path)).host + ', not pinned'} · ${fmt(s.graph.nodes.length)} nodes · ${fmt(s.graph.edges.length)} edges drawn · ${fmt(s.graph.dangling)} edges name a missing node`;
  measureBridge(); writeTest(); writeQuestions();
}

/* ── the bridge ────────────────────────────────────────────────────────────── */
function computeBridge() {
  const s = st.graphs.get(st.current);
  if (!s?.graph || !st.reg) { st.bridge = []; return; }
  st.refs = s.graph.nodes.map(n => nodeRefs(st.current, n));
  st.bridge = st.refs.map(r => counterpart(r, st.reg, st.families).state);
}
function measureBridge() {
  const s = st.graphs.get(st.current);
  const g = st.manifest?.graphs.find(x => x.id === st.current);
  if (!s?.graph || !st.reg) { $('bridgeLine').textContent = s?.status === 'FAIL' ? `${g.title}: no graph, so no bridge` : 'measuring the bridge…'; return; }
  const c = { known: 0, unknown: 0, none: 0, pending: 0 };
  for (const b of st.bridge) c[b]++;
  const total = st.bridge.length;
  $('bridgeLine').innerHTML = `${esc(g.title)}: <b>${fmt(c.known)}</b> of ${fmt(total)} spider nodes have a counterpart in the numbered universe · ${fmt(c.unknown)} name something it does not hold · ${fmt(c.none)} name nothing it could hold`
    + (c.pending ? ` · ${fmt(c.pending)} name a family: <button id="famBtn" type="button">load the family index to count them</button>` : '');
  $('famBtn')?.addEventListener('click', async () => { $('famBtn').disabled = true; $('famBtn').textContent = 'loading the family index…'; await ensureFamilies(); computeBridge(); spider.setBridge(st.bridge); measureBridge(); writeTest(); });
}

async function ensureFamilies() {
  if (st.families) return true;
  try {
    const arr = await getJSON(DATA + 'families.json');
    st.families = new Map(arr.map(f => [f.n, f]));
    st.famArr = arr;
    return true;
  } catch (e) { say(`<p class="refuse">The family index could not load: ${esc(e.message)}. Family nodes stay uncounted.</p>`); return false; }
}
async function ensureFamLines() {
  if (st.famLines) return true;
  try { st.famLines = new Uint32Array(await fetchAs(DATA + 'lines.bin', 'bin')); return true; }
  catch (e) { say(`<p class="refuse">The family line index could not load: ${esc(e.message)}.</p>`); return false; }
}

/* Keys a block charts: its module layer when layers/manifest.json has one,
   otherwise its functions' first lines from the blocks layer. */
async function keysForBlock(sym) {
  const L = st.layerById.get('module-' + sym);
  if (L) {
    const d = await layerDoc(L.file);
    const keys = [], props = [];
    for (const f of d.features) {
      const ks = f.geometry?.type === 'Point' ? [f.geometry.key] : (f.geometry?.keys || []);
      for (const k of ks) { keys.push(k); props.push({ block: sym, function: f.properties?.function, family: f.properties?.family, via: L.id }); }
    }
    return { keys, props, colour: L.colour, via: `layer ${L.id} (${L.label})` };
  }
  const B = st.layerById.get('blocks');
  if (B) {
    const d = await layerDoc(B.file);
    const feats = d.features.filter(f => f.properties?.block === sym && f.geometry?.type === 'Point');
    if (feats.length) return { keys: feats.map(f => f.geometry.key), props: feats.map(f => ({ block: sym, function: f.properties.function, family: f.properties.family, via: 'blocks' })), colour: B.colour, via: `first lines in layer blocks` };
  }
  return { keys: [], props: [], colour: null, via: null };
}

let tapSeq = 0;
async function tapSpider(i, fromLink = false) {
  const seq = ++tapSeq;
  const s = st.graphs.get(st.current); if (!s?.graph) return;
  const n = s.graph.nodes[i];
  spider.focus(i);
  if (!fromLink) { writeSelection(n); linkBox(null); }
  let refs = nodeRefs(st.current, n);
  if (!st.reg) { say('<p class="dim">The block register is still loading.</p>'); return; }
  if (refs.kind === 'family' && !st.families) { say(`<h2>${esc(n.label)}</h2><p class="dim">This node names family ${refs.family}; loading the family index…</p>`); await ensureFamilies(); if (seq !== tapSeq) return; computeBridge(); spider.setBridge(st.bridge); measureBridge(); }
  const cp = counterpart(refs, st.reg, st.families);
  const head = `<h2>${esc(n.label)}</h2><dl>
    <dt>spider type</dt><dd>${esc(n.type)}</dd>
    <dt>status label</dt><dd>${esc(n.rag)} <span class="dim">(the spider's own label${n.reason ? ': ' + esc(n.reason.replace(/<[^>]*>/g, ' ').slice(0, 220)) : ''})</span></dd>
    <dt>names</dt><dd>${esc(refs.kind === 'path' ? refs.repo + (refs.path ? '/' + refs.path : ' (whole repository)') : refs.kind === 'family' ? 'family ' + refs.family : refs.kind === 'block' ? 'block ' + refs.block : 'nothing numbered')} <span class="dim">· ${esc(refs.method)}</span></dd>
    ${receiverRow(n)}
  </dl>`;
  wafer.unwakeAll(id => id === 'blocks');
  if (cp.state !== 'known') {
    say(head + `<p class="refuse">Not in the numbered universe yet: ${esc(cp.why)}.</p>`);
    return;
  }
  say(head + `<p class="known">${esc(cp.why)}</p><p class="dim">waking its lines…</p>`);
  const woke = [];
  if (refs.kind === 'family') {
    if (!(await ensureFamLines())) return;
    if (seq !== tapSeq) return;
    const f = cp.family, keys = Array.from(st.famLines.subarray(f.lineOffset, f.lineOffset + f.lineCount));
    wafer.wake('fam-' + f.n, '#ff8c00', keys, keys.map(() => ({ block: f.block, function: f.name, family: f.n, via: 'family' })));
    woke.push(`family ${f.n} ${esc(f.name)}: ${fmt(keys.length)} lines`);
    if (keys.length) wafer.frame('fam-' + f.n);
  } else {
    const blocks = cp.blocks.slice(0, MAX_BLOCKS_WOKEN);
    const results = await Promise.all(blocks.map(async sym => { try { return [sym, await keysForBlock(sym)]; } catch (e) { return [sym, { keys: [], error: e.message }]; } }));
    if (seq !== tapSeq) return;
    let first = null;
    for (const [sym, r] of results) {
      if (r.keys.length) { wafer.wake('blk-' + sym, r.colour || '#00cc00', r.keys, r.props); first ??= 'blk-' + sym; woke.push(`block ${esc(sym)}: ${fmt(r.keys.length)} lines, ${esc(r.via)}`); }
      else woke.push(`block ${esc(sym)}: <span class="refuse">${r.error ? 'layer failed: ' + esc(r.error) : 'in the register, but no layer charts numbered lines for it'}</span>`);
    }
    if (cp.blocks.length > MAX_BLOCKS_WOKEN) woke.push(`<span class="dim">${fmt(cp.blocks.length - MAX_BLOCKS_WOKEN)} more blocks not woken (at most ${MAX_BLOCKS_WOKEN} per node)</span>`);
    if (first) wafer.frame(first);
  }
  say(head + `<p class="known">${esc(cp.why)}</p><ul>${woke.map(w => `<li>${w}</li>`).join('')}</ul><p class="dim">Tap a lit line on the wafer to come back.</p>`);
}

function receiverRow(n) {
  if (!st.contract) return '';
  const urls = [n.gh, n.ext].filter(Boolean);
  const retired = urls.filter(u => st.contract.isRetiredReceiver(u));
  const canon = urls.filter(u => u.startsWith(st.contract.CANONICAL_RECEIVER));
  const atlas = urls.filter(u => /gridatlas|repd_grid_atlas/i.test(u));
  if (!atlas.length && !retired.length) return '';
  return `<dt>Grid Atlas</dt><dd>${retired.length ? '<span class="refuse">links a retired receiver</span> ' : ''}${canon.length ? 'links the canonical receiver ' : ''}${!retired.length && !canon.length ? 'names Grid Atlas source, not a receiver' : ''} <span class="dim">(deeplink/contract.js isRetiredReceiver)</span></dd>`;
}

function tapWafer(x, y) {
  const hit = wafer.pickWoken(x, y);
  const s = st.graphs.get(st.current);
  if (!hit) { spider.highlight([]); say('<p class="dim">No lit line within reach. Only woken lines answer a tap; tap a spider node or wake the named functions first.</p>'); return; }
  const p = hit.props || {};
  const g = st.manifest.graphs.find(x => x.id === st.current);
  const head = `<h2>Line <span class="n">${fmt(hit.key)}</span></h2><dl>
    <dt>block</dt><dd>${esc(p.block ?? 'none recorded')}${p.block && st.reg?.bySymbol.get(p.block) ? ' · ' + esc(st.reg.bySymbol.get(p.block).title) : ''}</dd>
    <dt>function</dt><dd>${esc(p.function ?? 'none recorded')}${p.family != null ? ' · family ' + p.family : ''}</dd>
    <dt>woken by</dt><dd>${esc(p.via ?? '')}</dd></dl>`;
  if (!s?.graph || !p.block) { spider.highlight([]); say(head + `<p class="refuse">No spider graph is drawn, or the line carries no block, so no spider node can be named.</p>`); return; }
  const list = nodesForBlock(p.block, p.family, st.current, s.graph.nodes, st.reg);
  spider.highlight(list);
  if (!list.length) {
    const b = st.reg.bySymbol.get(p.block);
    const files = b ? b.files.map(f => f.repo + '/' + f.path) : [];
    say(head + `<p class="refuse">No node of ${esc(g.title)} names block ${esc(p.block)}${p.family != null ? ', family ' + p.family : ''} or a file of that block.</p>`
      + (files.length ? `<p class="dim">The register places block ${esc(p.block)} in ${fmt(files.length)} file(s), first: ${esc(files[0])}.</p>` : `<p class="dim">The live register records no file for block ${esc(p.block)}.</p>`));
    return;
  }
  say(head + `<p class="known">${fmt(list.length)} node(s) of ${esc(g.title)} lit on the spider:</p><ul>${list.slice(0, 10).map(([i, why]) => `<li>${esc(s.graph.nodes[i].label)} <span class="dim">· ${esc(why)}</span></li>`).join('')}</ul>${list.length > 10 ? `<p class="dim">first ten of ${fmt(list.length)} listed; all are ringed on the spider.</p>` : ''}`);
}

/* ── links in and out: ?graph= ?node= ?key= ?repo= ?path= (link.mjs) ─────────
   A link selects nodes exactly as a manual tap does (tapSpider). A manual tap
   or graph choice writes the selection back with replaceState, keeping every
   parameter it does not own. */
const OWN = ['node', 'key', 'repo', 'path'];
function replaceQuery(edit) {
  const u = new URL(location.href);
  edit(u.searchParams);
  const next = u.pathname + u.search + u.hash;
  if (next !== location.pathname + location.search + location.hash) history.replaceState(history.state, '', next);
}
function writeSelection(n) {
  const r = nodeRefs(st.current, n);
  replaceQuery(q => {
    q.set('graph', st.current); for (const k of OWN) q.delete(k);
    q.set('node', String(n.id));
    if (r.kind === 'block') q.set('key', 'block:' + r.block);
    else if (r.kind === 'family') q.set('key', 'family:' + r.family);
    else if (r.kind === 'path') { q.set('repo', r.repo); if (r.path) q.set('path', r.path); }
  });
}
function writeGraphChoice(id) { replaceQuery(q => { q.set('graph', id); for (const k of OWN) q.delete(k); }); }

/* The link strip: warnings (always, while the link carries them) and the outcome. */
function linkBox(outcome) {
  const box = $('linkBox'), L = st.link;
  const warn = L && L.warnings.length ? `<p class="refuse">Link warning${L.warnings.length > 1 ? 's' : ''}:</p><ul>${L.warnings.map(w => `<li class="refuse">${esc(w)}</li>`).join('')}</ul>` : '';
  box.innerHTML = warn + (outcome || '');
  box.hidden = !box.innerHTML;
}

const byIndex = list => { const m = new Map(); for (const [i, why] of list) if (!m.has(i)) m.set(i, why); return [...m]; };

/* Which nodes of the drawn graph a link parameter names, and how. */
async function linkMatches(kind) {
  const L = st.link, s = st.graphs.get(st.current), nodes = s.graph.nodes, gid = st.current;
  if (kind === 'node') {
    const i = nodes.findIndex(n => String(n.id) === L.node);
    return { list: i < 0 ? [] : [[i, 'node id ' + L.node]], why: i < 0 ? `no node has the id "${L.node}"` : '' };
  }
  if (kind === 'repo') {
    const direct = [];
    nodes.forEach((n, i) => { const r = nodeRefs(gid, n); if (r.kind === 'path' && r.repo === L.repo && pathCovers(r.path, L.path || '')) direct.push([i, 'names ' + r.repo + (r.path ? '/' + r.path : '')]); });
    const files = (st.reg.byRepo.get(L.repo) || []).filter(f => pathCovers(L.path || '', f.path));
    const syms = [...new Set(files.map(f => f.symbol))];
    const via = syms.flatMap(sym => nodesForBlock(sym, null, gid, nodes, st.reg).map(([i, w]) => [i, w + ' (the register places block ' + sym + ' at this path)']));
    return { list: byIndex([...direct, ...via]), why: `the live register records ${fmt(files.length)} file(s) at or under ${L.repo}${L.path ? '/' + L.path : ''}${syms.length ? ' (blocks ' + syms.join(', ') + ')' : ''}, and no node names that path or those blocks` };
  }
  const k = L.key;
  if (k.kind === 'block') {
    const list = nodesForBlock(k.block, null, gid, nodes, st.reg);
    list.sort((a, b) => (b[1].startsWith('names block') ? 1 : 0) - (a[1].startsWith('names block') ? 1 : 0));
    return { list, why: st.reg.bySymbol.has(k.block) ? `block ${k.block} is in the live register, but no node names it or a file of it` : `block ${k.block} is not in the live register, and no node names it` };
  }
  if (!(await ensureFamilies())) return { list: [], why: 'the family index could not load' };
  const famList = [];
  if (k.kind === 'family') {
    const f = st.families.get(k.family);
    if (!f) return { list: [], why: `family ${k.family} is not in the numbered database` };
    famList.push(f);
  } else {
    if (!(await ensureFamLines())) return { list: [], why: 'the family line index could not load' };
    for (const f of st.famArr) {
      const sub = st.famLines.subarray(f.lineOffset, f.lineOffset + f.lineCount);
      if (sub.includes(k.line)) famList.push(f);
    }
    if (!famList.length) return { list: [], why: `line ${k.line} is carried by no numbered function family, so no block or family can name it` };
  }
  const list = [];
  for (const f of famList) {
    nodes.forEach((n, i) => { const r = nodeRefs(gid, n); if (r.kind === 'family' && r.family === f.n) list.push([i, 'names family ' + f.n]); });
    if (f.block) list.push(...nodesForBlock(f.block, f.n, gid, nodes, st.reg).map(([i, w]) => [i, w + ' (family ' + f.n + ' ' + f.name + ')']));
  }
  const fams = famList.slice(0, 6).map(f => f.n + ' ' + f.name + (f.block ? ' / block ' + f.block : '')).join('; ') + (famList.length > 6 ? ` and ${famList.length - 6} more` : '');
  return { list: byIndex(list), why: `${k.kind === 'line' ? 'line ' + k.line + ' is carried by famil' + (famList.length > 1 ? 'ies ' : 'y ') : 'family '}${fams}, and no node names ${famList.length > 1 ? 'those families or their blocks' : 'that family or its block'}` };
}

async function applyLink() {
  const L = st.link;
  if (!L || !L.asked.length) return;
  const g = st.manifest.graphs.find(x => x.id === st.current), s = st.graphs.get(st.current);
  const asked = esc(L.asked.join(' · '));
  if (s?.status !== 'OK') { linkBox(`<p class="refuse">Not in the spider yet: ${esc(g.title)} is ${esc(s?.status || 'not loaded')}, so the link's ${asked} cannot be looked for.</p>`); return; }
  if (!st.reg) { linkBox(`<p class="refuse">Not in the spider yet: the block register did not load, so the link's ${asked} cannot be looked for.</p>`); return; }
  const tries = [];
  if (L.node != null) tries.push(['node', 'node=' + L.node]);
  if (L.key) tries.push(['key', 'key=' + L.key.raw]);
  if (L.repo) tries.push(['repo', 'repo=' + L.repo + (L.path ? ' path=' + L.path : '')]);
  const misses = [];
  for (const [kind, label] of tries) {
    const r = await linkMatches(kind);
    if (!r.list.length) { misses.push(`${esc(label)}: ${esc(r.why)}`); continue; }
    const [i] = r.list[0];
    try { await tapSpider(i, true); } catch (e) { misses.push(`${esc(label)}: the tap failed: ${esc(e.message)}`); continue; }
    if (r.list.length > 1) spider.highlight(r.list);
    st.linkSelected = { by: label, nodes: r.list.map(([j]) => String(s.graph.nodes[j].id)) };
    linkBox(`<p class="known">Opened by the link at ${esc(s.graph.nodes[i].label)} in ${esc(g.title)}: ${esc(label)} ${esc(r.list[0][1])}.${r.list.length > 1 ? ` ${fmt(r.list.length)} nodes match; all are ringed on the spider: ${r.list.slice(0, 8).map(([j]) => esc(s.graph.nodes[j].label)).join(', ')}${r.list.length > 8 ? ' …' : ''}.` : ''}</p>`
      + (misses.length ? `<p class="dim">Tried first: ${misses.join('; ')}.</p>` : ''));
    return;
  }
  st.linkSelected = { by: null, nodes: [] };
  spider.highlight([]);
  linkBox(`<p class="refuse">Not in the spider yet: no node of ${esc(g.title)} (${fmt(s.graph.nodes.length)} nodes read) matches the link's ${asked}.</p><ul>${misses.map(m => `<li class="dim">${m}</li>`).join('')}</ul>`);
  say(`<h2>${asked}</h2><p class="refuse">Not in the spider yet: ${misses.join('; ')}.</p><p class="dim">Choose another graph, or tap a node.</p>`);
}

/* ── the named-functions toggle ────────────────────────────────────────────── */
let blocksOn = false;
$('wakeBlocks').addEventListener('click', async () => {
  const tag = $('wakeBlocksTag');
  if (blocksOn) { blocksOn = false; wafer.unwakeAll(id => id !== 'blocks'); tag.textContent = '[WAIT]'; return; }
  const B = st.layerById.get('blocks');
  if (!B) { tag.textContent = '[FAIL]'; return; }
  tag.textContent = '[LOAD]';
  try {
    const d = await layerDoc(B.file);
    const feats = d.features.filter(f => f.geometry?.type === 'Point');
    if (!feats.length) { tag.textContent = '[EMPTY]'; return; }
    wafer.wake('blocks', B.colour, feats.map(f => f.geometry.key), feats.map(f => ({ block: f.properties.block, function: f.properties.function, family: f.properties.family, via: 'layer blocks' })));
    blocksOn = true; tag.textContent = `[OK ${fmt(feats.length)}]`;
  } catch (e) { tag.textContent = '[FAIL]'; say(`<p class="refuse">layers/blocks.json: ${esc(e.message)}</p>`); }
});
$('clearWake').addEventListener('click', () => { blocksOn = false; $('wakeBlocksTag').textContent = '[WAIT]'; wafer.unwakeAll(); spider.highlight([]); });

$('findNode').addEventListener('change', e => {
  const s = st.graphs.get(st.current); const q = e.target.value.trim().toLowerCase();
  if (!s?.graph || !q) return;
  const i = s.graph.nodes.findIndex(n => n.label.toLowerCase() === q) >= 0 ? s.graph.nodes.findIndex(n => n.label.toLowerCase() === q) : s.graph.nodes.findIndex(n => n.label.toLowerCase().includes(q));
  if (i < 0) { say(`<p class="refuse">No node of this graph has a label containing "${esc(e.target.value)}".</p>`); return; }
  tapSpider(i);
});

/* ── the spider test, measured here ────────────────────────────────────────── */
function writeTest() {
  if (!st.manifest) return;
  const rows = st.manifest.graphs.map(g => {
    const s = st.graphs.get(g.id);
    if (!s || s.status === 'WAIT') return `<tr><td>${esc(g.id)}</td><td class="dim" colspan="5">WAIT: not fetched until chosen</td></tr>`;
    if (s.status !== 'OK') return `<tr><td>${esc(g.id)}</td><td colspan="5" class="refuse">${esc(s.status)} ${esc(s.why || '')}</td></tr>`;
    const G = s.graph;
    let known = '', atlas = 0, retired = 0, layersParam = 0;
    if (st.reg) {
      const states = G.nodes.map(n => counterpart(nodeRefs(g.id, n), st.reg, st.families).state);
      known = `${fmt(states.filter(x => x === 'known').length)} / ${fmt(G.nodes.length)}` + (states.includes('pending') ? ` (${fmt(states.filter(x => x === 'pending').length)} families uncounted)` : '');
    }
    for (const n of G.nodes) {
      const urls = [n.gh, n.ext, ...(n.reason.match(/https?:\/\/[^\s"'<>)]+/g) || [])].filter(Boolean);
      if (urls.some(u => /gridatlas|repd_grid_atlas/i.test(u))) atlas++;
      if (st.contract && urls.some(u => st.contract.isRetiredReceiver(u))) retired++;
      if (urls.some(u => /[?&]layers?=/.test(u))) layersParam++;
    }
    return `<tr><td>${esc(g.id)}</td><td>${fmt(G.nodes.length)} / ${fmt(G.edges.length)}</td><td>${fmt(G.dangling)}</td><td>${atlas} · ${retired} · ${layersParam}</td><td>${known}</td><td>${s.pinned ? '@' + SHA.slice(0, 7) : 'live'}</td></tr>`;
  }).join('');
  let regLine = 'the block register is loading';
  if (st.reg) {
    const vge = st.reg.byRepo.get('Ventusltd/ventus-grid-engine') || [];
    const spiderFiles = vge.filter(f => f.path === 'index.html' || pathCovers('spider/', f.path));
    regLine = `The live register (generated ${esc(st.reg.generated)}, ${fmt(st.reg.blocks)} blocks) records ${fmt(vge.length)} file(s) in Ventusltd/ventus-grid-engine and <b>${fmt(spiderFiles.length)}</b> at index.html or under spider/. `
      + (spiderFiles.length ? 'The claim that the register has no block for the spider is refuted.' : 'The claim that the register has no block for the spider is confirmed for this generation, so the wafer\'s spider layer stays EMPTY.');
  }
  let nameLine = '<button id="nameBtn" type="button">name-match the spider\'s own functions against the numbered families</button> <span class="dim">(loads the family index and the spider\'s index.html)</span>';
  if (st.nameMatch) nameLine = st.nameMatch;
  $('tBody').className = '';
  $('tBody').innerHTML = `<p>Each row is measured in this browser when its graph is chosen. Columns: nodes / edges, edges that name a missing node, nodes linking Grid Atlas · of those a retired receiver · nodes carrying a layer parameter, nodes with a counterpart in the numbered universe, source.</p>
    <div class="twrap"><table class="t"><tr><th>graph</th><th>nodes / edges</th><th>dangling</th><th>atlas · retired · layers=</th><th>counterpart</th><th>source</th></tr>${rows}</table></div>
    <p>${regLine}</p><p>${nameLine}</p>
    <p class="dim">The full test, run in headless Chrome and WebKit on the live spider page, with the Grid Atlas config comparison and every URL status, is kept with this iteration's test receipts.</p>`;
  $('nameBtn')?.addEventListener('click', nameMatch);
}

async function nameMatch() {
  $('nameBtn').disabled = true; $('nameBtn').textContent = 'loading…';
  try {
    await ensureFamilies();
    const src = await fetchAs(CDN + 'index.html', 'text');
    const names = [...new Set([...src.matchAll(/function\s+([A-Za-z0-9_$]+)/g)].map(m => m[1]))];
    const byName = new Map();
    for (const f of st.famArr) { if (!byName.has(f.name)) byName.set(f.name, []); byName.get(f.name).push(f); }
    const hits = names.filter(nm => byName.has(nm));
    const unreg = new Set();
    const lines = hits.map(nm => {
      const fs = byName.get(nm);
      fs.forEach(f => { if (f.block && !st.reg.bySymbol.has(f.block)) unreg.add(f.block); });
      return `${esc(nm)}: ${fs.slice(0, 4).map(f => `${f.n}/${esc(f.block ?? '-')}${f.block && !st.reg.bySymbol.has(f.block) ? '<span class="refuse">*</span>' : ''}`).join(' ')}${fs.length > 4 ? ' …' : ''}`;
    });
    st.nameMatch = `<b>Name-match inference.</b> The spider's index.html at @${SHA.slice(0, 7)} declares ${fmt(names.length)} named functions; ${fmt(hits.length)} of those names are numbered families (family/block; <span class="refuse">*</span> = block absent from the live register${unreg.size ? ': ' + [...unreg].map(esc).join(', ') : ''}). A shared name is not proof the family is this file.<br>${lines.join('<br>')}`;
    computeBridge(); spider.setBridge(st.bridge); measureBridge();
  } catch (e) { st.nameMatch = `<span class="refuse">name-match could not run: ${esc(e.message)}</span>`; }
  writeTest();
}

/* ── questions ─────────────────────────────────────────────────────────────── */
function writeQuestions() {
  const n = st.manifest?.graphs.length ?? 0;
  const eng = st.reg ? [...st.reg.bySymbol.values()].filter(b => b.files?.some(f => f.repo === 'Ventusltd/ventus-grid-engine' && f.path.startsWith('engine/'))) : [];
  const sld = eng.filter(b => /voltage|current|capacity|fault|power factor|rating|topology|obstacle|demand/i.test(b.title + ' ' + b.description));
  $('qBody').className = '';
  $('qBody').innerHTML = `<ol>
  <li><b>How does this help draw a system or a single-line diagram?</b> None yet, directly. The spider draws repositories, files, blocks and families as cards joined by typed edges (nodes[].label, edges[][2]); the wafer draws numbered lines. Neither draws a busbar, feeder, transformer, cable route, protection or earthing. What the pair does is find the code that could: a tap on a spider node that reaches the engine wakes those blocks' lines. The live register names ${fmt(eng.length)} blocks with files under engine/ in Ventusltd/ventus-grid-engine, ${fmt(sld.length)} of them described in electrical terms (${sld.slice(0, 8).map(b => esc(b.symbol + ' ' + b.title)).join('; ')}).</li>
  <li><b>What is this code used for?</b> The spider is ventus-grid-engine index.html at @${SHA.slice(0, 7)}: loadRoot and loadContents read spider/data, wireReceiver reads spider/manifest.json and calls loadManifestScope then normaliseGenericGraph for each of its ${fmt(n)} graphs, drawSpider draws the focus. Who calls it: its own manifest's overview cards link <code>?graph=</code>; the source comment in wireReceiver says dashboards (GridAtlas and Pipeline News File menus) link <code>?focus=</code> (read from source, not measured here). The block register records no file for it (see Spider test); this page's bridge.mjs is its reader here.</li>
  <li><b>Where does it lead next?</b> From the spider: to the ${fmt(n)} graphs its manifest lists and to each node's GitHub and external links. From the wafer: to module layers and named functions. To an electrical element: not established, because no spider node carries a busbar, feeder or cable identity, only code identities.</li>
  </ol>
  <p class="machine"><b>Machine detail.</b> Inputs: spider/manifest.json graphs[] {id, path, edges_path} and each graph's nodes {id, label, type, rag, reason, gh, ext, path} and edges ([from, to, type] index-array-v1 or {from, to, type}) at ventus-grid-engine@${SHA}; the live block register blocks[] {symbol, files[] {repo, path, commit}}; the numbered database families.json {n, name, block, lineOffset, lineCount} and lines.bin (unsigned 32-bit permanent line keys). Outputs: per spider node a counterpart state (known, unknown, none, pending) with the method; woken keys, dimensionless permanent integers placed at r = √key, θ = key × golden angle. Refusals: "not in the numbered universe yet" with the reason; a graph that returns HTTP 404 shows FAIL; a block in the register with no charted lines is named. Units: none physical; this page computes no electrical quantity.</p>`;
}

function writeRules() {
  $('rBody').className = '';
  $('rBody').innerHTML = `<ul>
  <li>One fetch queue, three requests at a time, each with a 15 s timeout; one shared promise per URL, dropped when it fails so a retry can happen.</li>
  <li>A spider graph is fetched only when chosen in the list; only its row is relabelled WAIT, LOAD, OK, EMPTY or FAIL. Preloaded: the manifest, the Federation graph (the spider's own default), the block register and the wafer's layer manifest.</li>
  <li>Spider nodes are drawn on one canvas, never as page elements; at most ${MAX_LABELS_TEXT} neighbour labels are written.</li>
  <li>The wafer ground is one GPU draw of every numbered line. A woken line is drawn only when its radius √key lies in the band of radii the pane can see, and at most ${fmt(MAX_DRAWN)} woken lines are drawn in one frame.</li>
  <li>At most ${MAX_DOCS} layer files are held; the least recently used is dropped first. A spider node wakes at most ${MAX_BLOCKS_WOKEN} blocks. The family index and its line file load only when a family is asked for.</li>
  </ul>`;
}
const MAX_LABELS_TEXT = 28;

/* ── start ─────────────────────────────────────────────────────────────────── */
(async function start() {
  if (matchMedia('(min-width:760px)').matches) $('questions').open = true;
  writeRules();
  import(CDN + 'deeplink/contract.js').then(m => { st.contract = m; writeTest(); }).catch(e => { st.contractError = e.message; });

  const waferP = wafer.load().then(() => true, e => { $('waferFoot').textContent = 'Could not load the numbered database: ' + e.message; return false; });

  try {
    st.manifest = await getJSON(CDN + 'spider/manifest.json');
  } catch (e) {
    $('spiderFoot').textContent = 'The spider manifest could not load: ' + e.message; return;
  }
  const pick = $('graphPick');
  for (const g of st.manifest.graphs) {
    const o = document.createElement('option'); o.value = g.id; o.textContent = optionText(g); pick.appendChild(o);
  }
  pick.addEventListener('change', () => { writeGraphChoice(pick.value); linkBox(null); showGraph(pick.value); });
  st.link = readLink(location.search, st.manifest.graphs.map(g => g.id));
  linkBox(null);

  const regP = getJSON(REGISTER).then(r => { st.regRaw = r; st.reg = indexRegister(r); })
    .catch(e => { $('bridgeLine').textContent = 'The block register could not load: ' + e.message; });
  const layP = getJSON(ROOT + 'layers/manifest.json').then(m => { st.layers = m; for (const l of m.layers) st.layerById.set(l.id, l); })
    .catch(e => { say(`<p class="refuse">layers/manifest.json: ${esc(e.message)}; no lines can be woken.</p>`); });
  const startId = st.link.graph || 'federation';
  await Promise.all([regP, layP, loadGraph(startId)]);
  await showGraph(startId);
  writeQuestions();
  await waferP;
  await applyLink();
})();

window.__pair = { st, spider, wafer };
