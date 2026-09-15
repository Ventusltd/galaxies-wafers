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
 * for all network work, four at a time; every fetch has a 15 s timeout; one
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
import { atlasUrls, atlasFile, declaredLayerIds, configLayerIds, receiverLink, bucketsForLayer } from './atlas-join.mjs';
import { shapeOf, newIndex, addBucket, holds, classify, CLASS_TEXT } from './unknown-paths.mjs';
import { esc, fmt } from '../../lib.mjs';

export const SHA = '23bc10acb5fb9577d5cd68b04ad6ed336c182013'; // ventus-grid-engine main after the spider manifest fix (genome-spider reads its real graph)
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
const queue = new FetchQueue(4);
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

function say(html) {
  $('sayBody').className = ''; $('sayBody').innerHTML = html;
  const el = $('atlasIds');  /* the tapped node's Atlas layer ids, once read */
  if (el && st.atlasDd) el.innerHTML = st.atlasDd;
}

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
    ${atlasRow(n, seq)}
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

/* ── shared keys with Grid Atlas (atlas-join.mjs) ─────────────────────────────
   Fetched only when a node with a Grid Atlas file link is tapped, or when the
   reader opens the drawer. A file's text is held only while its line ranges
   are read; what is kept is the ids it declares. */
const ATLAS_LIVE = 'https://ventusltd.github.io/gridatlas/atlas/';
const fileIds = new Map();      /* raw + '#' + lines -> {ids: Map id -> Set(form)} | {error} */
const fileRead = new Map();     /* raw -> promise while in flight */
const fileKey = f => f.raw + '#' + (f.lines ? f.lines.join('-') : '');

function fetchFresh(url, kind) {   /* the same queue and timeout, no cache: the caller keeps what it needs */
  return queue.add(async () => {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 15000);
    try {
      const r = await fetch(url, { signal: ctl.signal, cache: 'default' });
      if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
      return kind === 'text' ? await r.text() : kind === 'json' ? await r.json() : await r.arrayBuffer();
    } catch (e) { if (e.name === 'AbortError') throw new Error('no answer within 15 s'); throw e; }
    finally { clearTimeout(t); }
  });
}

async function atlasConfig() {
  if (!st.atlasCfgP) {
    st.atlasCfgP = (async () => {
      const cur = await getJSON(ATLAS_LIVE + 'current.json');
      const url = new URL(cur.shell.index, ATLAS_LIVE).href;
      const html = await fetchFresh(url, 'text');
      const ids = configLayerIds(html);
      const labels = new Map([...html.matchAll(/\{\s*id:\s*"([^"]+)"\s*,\s*label:\s*"([^"]*)"/g)].map(m => [m[1], m[2]]));
      const receivers = await getJSON(CDN + 'deeplink/receivers.json');
      return { ids: new Set(ids), order: ids, labels, url, release: cur.shell.release_id, generation: cur.generation, receivers };
    })();
    st.atlasCfgP.catch(() => { st.atlasCfgP = null; });
  }
  return st.atlasCfgP;
}

/* Read every file these descriptors name, once per file, all line ranges of it together. */
async function readAtlasFiles(files, onDone) {
  const byRaw = new Map();
  for (const f of files) { const have = fileIds.get(fileKey(f)); if (have && !have.error) continue; if (!byRaw.has(f.raw)) byRaw.set(f.raw, []); byRaw.get(f.raw).push(f); }
  await Promise.all([...byRaw].map(async ([raw, fs]) => {
    if (!fileRead.has(raw)) {
      fileRead.set(raw, (async () => {
        let text = null, error = null;
        try { text = await fetchFresh(raw, 'text'); } catch (e) { error = e.status ? 'HTTP ' + e.status : e.message; }
        return { text, error };
      })());
    }
    const got = await fileRead.get(raw);
    for (const f of fs) fileIds.set(fileKey(f), got.error ? { error: got.error } : { ids: declaredLayerIds(got.text, f.lines) });
    fileRead.delete(raw);  /* the text goes with the promise; only the ids stay */
    onDone?.();
  }));
}

async function nodeJoin(n) {
  const urls = atlasUrls(n), files = urls.map(atlasFile).filter(Boolean);
  const out = { urls, files, ids: new Map(), inCfg: [], errors: [] };
  if (!files.length) return out;
  const [cfg] = await Promise.all([atlasConfig(), readAtlasFiles(files)]);
  for (const f of files) {
    const r = fileIds.get(fileKey(f));
    if (r.error) { out.errors.push(`${f.path}: ${r.error}`); continue; }
    for (const [id, forms] of r.ids) {
      if (!out.ids.has(id)) out.ids.set(id, { forms: new Set(), files: new Set() });
      forms.forEach(x => out.ids.get(id).forms.add(x)); out.ids.get(id).files.add(f);
    }
  }
  out.inCfg = [...out.ids.keys()].filter(id => cfg.ids.has(id));
  out.cfg = cfg;
  return out;
}

function atlasRow(n, seq) {
  st.atlasDd = null;
  const urls = atlasUrls(n);
  if (!urls.length) return '';
  const files = urls.map(atlasFile).filter(Boolean);
  if (!files.length) return `<dt>Atlas layer ids</dt><dd><span class="refuse">EMPTY</span> <span class="dim">· ${fmt(urls.length)} link(s) name Grid Atlas, but none names a cartridge, cartridge part, composition manifest or config file, so no layer id is declared to read</span></dd>`;
  nodeJoin(n).then(r => { if (seq === tapSeq) { st.atlasDd = atlasDdHtml(r); say($('sayBody').innerHTML); } })
    .catch(e => { if (seq === tapSeq) { st.atlasDd = `<span class="refuse">FAIL</span> ${esc(e.message)}`; say($('sayBody').innerHTML); } });
  return `<dt>Atlas layer ids</dt><dd id="atlasIds"><span class="dim">LOAD · reading ${fmt(new Set(files.map(f => f.raw)).size)} Grid Atlas file(s) this node links…</span></dd>`;
}

function atlasDdHtml(r) {
  const cfg = r.cfg, c = st.contract;
  const method = [...new Set(r.files.map(f => f.kind))].join(', ');
  const src = r.files.map(f => `${esc(f.path)}${f.lines ? ' lines ' + f.lines.join('-') : ''} <span class="dim">(${f.pinned ? 'pinned @' + esc(f.ref.slice(0, 7)) : f.ref ? 'ref ' + esc(f.ref) + ', not pinned' : 'served page, not pinned'})</span>`).join('; ');
  const errs = r.errors.length ? `<br><span class="refuse">FAIL ${r.errors.map(esc).join('; ')}</span>` : '';
  const other = [...r.ids.keys()].filter(id => !cfg.ids.has(id));
  if (!r.inCfg.length) return `<span class="refuse">EMPTY</span> <span class="dim">· declared in the ${esc(method)} file: no Grid Atlas v9 config layer id${other.length ? ` (it declares ${fmt(other.length)} id(s) of its own that the config does not: ${other.slice(0, 8).map(esc).join(', ')})` : ''}. Read: ${src}</span>${errs}`;
  const rl = c ? receiverLink(c, cfg.receivers) : null;
  const list = r.inCfg.map(id => {
    const d = r.ids.get(id), b = c ? bucketsForLayer(c, id) : [];
    return `<li><b>${esc(id)}</b> ${esc(cfg.labels.get(id) || '')} <span class="dim">· ${[...d.forms].map(esc).join('; ')}${b.length ? ' · contract buckets resolving to it: ' + b.map(esc).join(', ') : ''}</span></li>`;
  }).join('');
  return `<span class="known">${fmt(r.inCfg.length)} Grid Atlas layer id(s)</span> <span class="dim">· join method: declared in the ${esc(method)} file, matched to the ${esc(cfg.release)} config</span><ul>${list}</ul>`
    + (other.length ? `<p class="dim">Also declared, not config layers: ${other.slice(0, 12).map(esc).join(', ')}${other.length > 12 ? ' …' : ''}</p>` : '')
    + (rl ? `<p><a class="mapbtn" href="${esc(rl.href)}" target="_blank" rel="noopener">MAP</a> <span class="dim">opens the canonical receiver ${esc(rl.href)} (deeplink/receivers.json${rl.agrees ? ', agrees with contract.js CANONICAL_RECEIVER' : ', <span class="refuse">differs from contract.js</span>'}). No layer parameter: ${esc(rl.why)}.</span></p>` : '<p class="dim">The deep-link contract has not loaded, so no MAP link is offered.</p>')
    + `<p class="dim">Read: ${src}</p>${errs}`;
}

/* Every graph of the manifest, through the queue, each row relabelled as it lands. */
async function loadAllGraphs(onEach) {
  await Promise.all(st.manifest.graphs.map(g => loadGraph(g.id).then(s => { onEach?.(); return s; })));
}

let atlasRun = null;
function openAtlasDrawer() {
  if (atlasRun) return;
  atlasRun = runAtlasDrawer().catch(e => { $('aStatus').innerHTML = `<span class="refuse">FAIL</span> ${esc(e.message)}`; atlasRun = null; });
}
async function runAtlasDrawer() {
  const status = $('aStatus');
  let g = 0; const G = st.manifest.graphs.length;
  status.textContent = `LOAD · spider graphs 0/${G}`;
  await loadAllGraphs(() => { status.textContent = `LOAD · spider graphs ${++g}/${G}`; });
  const cfg = await atlasConfig();
  const nodes = [];
  for (const gr of st.manifest.graphs) {
    const s = st.graphs.get(gr.id); if (s?.status !== 'OK') continue;
    s.graph.nodes.forEach((n, i) => { const urls = atlasUrls(n); if (urls.length) nodes.push({ g: gr.id, i, n, urls, files: urls.map(atlasFile).filter(Boolean) }); });
  }
  const all = nodes.flatMap(x => x.files), raws = new Set(all.map(f => f.raw));
  let done = 0;
  status.textContent = `LOAD · Grid Atlas files 0/${raws.size}`;
  await readAtlasFiles(all, () => { status.textContent = `LOAD · Grid Atlas files ${++done}/${raws.size}`; });
  const A = { nodes: nodes.length, urls: new Set(nodes.flatMap(x => x.urls)).size, withFile: 0, joined: [], noFile: 0, noDecl: 0, failed: 0, reached: new Map(), files: raws.size, pinnedFiles: new Set(all.filter(f => f.pinned).map(f => f.raw)).size, cfg };
  for (const x of nodes) {
    if (!x.files.length) { A.noFile++; continue; }
    A.withFile++;
    const r = await nodeJoin(x.n);
    if (r.inCfg.length) { A.joined.push({ ...x, ids: r.inCfg }); r.inCfg.forEach(id => A.reached.set(id, (A.reached.get(id) || 0) + 1)); }
    else if (r.errors.length === x.files.length) A.failed++;
    else A.noDecl++;
  }
  st.atlasSummary = A;
  status.innerHTML = `<span class="known">OK</span> <span class="dim">· ${fmt(A.files)} files read (${fmt(A.pinnedFiles)} pinned by commit)</span>`;
  renderAtlasDrawer(0);
  writeTest(); writeQuestions();
}
function renderAtlasDrawer(page) {
  const A = st.atlasSummary, PER = 12;
  const ids = [...A.reached].sort((a, b) => b[1] - a[1]);
  const rows = A.joined.slice(page * PER, page * PER + PER).map((x, k) => `<li><button type="button" class="rowbtn" data-k="${page * PER + k}">${esc(x.g)} · ${esc(x.n.label.slice(0, 60))}</button> <span class="dim">${x.ids.map(esc).join(', ')}</span></li>`).join('');
  $('aBody').innerHTML = `<p><b>${fmt(A.joined.length)}</b> spider nodes joined · <b>${fmt(A.reached.size)}</b> Grid Atlas layer ids reached · <b>${fmt(A.nodes - A.joined.length)}</b> nodes with a Grid Atlas URL but no declared config layer (${fmt(A.noFile)} link no cartridge, part, manifest or config file; ${fmt(A.noDecl)} link one that declares none; ${fmt(A.failed)} whose files failed to load). ${fmt(A.nodes)} nodes carry ${fmt(A.urls)} distinct Grid Atlas URLs.</p>
    <p class="dim">Join method: declared in the cartridge file. A layer id counts when the file a node links (a cartridge, cartridge part, composition manifest or config file, read as served, over the linked lines when the link names them) declares it as a ukConfig entry, a LAYER_ID / LAYER_IDS / LAYERS constant, a data-layer-id attribute or an engine layer name 'l-&lt;id&gt;', and the Grid Atlas ${esc(A.cfg.release)} config (generation ${esc(A.cfg.generation)}, ${fmt(A.cfg.ids.size)} layer ids) declares it too.</p>
    <p>Reached: ${ids.map(([id, k]) => `<b>${esc(id)}</b> ${esc(A.cfg.labels.get(id) || '')} (${fmt(k)} nodes)`).join(' · ') || 'none'}</p>
    ${st.contract ? `<p class="dim">Deep link: ${esc(receiverLink(st.contract, A.cfg.receivers).why)}.</p>` : ''}
    <ul class="pagelist">${rows}</ul>
    <p class="pager">${page > 0 ? `<button type="button" data-p="${page - 1}">previous</button>` : ''} <span class="dim">${fmt(page * PER + 1)}–${fmt(Math.min(A.joined.length, page * PER + PER))} of ${fmt(A.joined.length)}</span> ${page * PER + PER < A.joined.length ? `<button type="button" data-p="${page + 1}">next</button>` : ''}</p>`;
  $('aBody').querySelectorAll('[data-p]').forEach(b => b.addEventListener('click', () => renderAtlasDrawer(Number(b.dataset.p))));
  $('aBody').querySelectorAll('[data-k]').forEach(b => b.addEventListener('click', () => openNode(A.joined[Number(b.dataset.k)])));
}
async function openNode(x) {
  if (st.current !== x.g) { writeGraphChoice(x.g); linkBox(null); await showGraph(x.g); }
  tapSpider(x.i);
  $('say').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/* ── the unknown paths (unknown-paths.mjs) ─────────────────────────────────── */
const PACK_STARS = '15667ee5bdd5c3bb07946a6968c335e59fde6a15';  /* the stars commit whose code/index.json has the sha256 the pack's provenance records; checked below at run time */
export const NEWER_DATA = 'https://globalgrid2050.com/testcode/202609152203/data/';
const LINES_MD = 'https://ventusltd.github.io/stars/LINES.md';

async function sha256hex(buf) {
  if (!crypto?.subtle) return null;
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return [...h].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* Read a list of code-index buckets into one index; bytes checked against a provenance sha256 when given. */
async function readBuckets(list, onEach) {
  const ix = newIndex(); const R = { ok: 0, match: 0, differ: 0, unverified: 0, failed: [] , bytes: 0 };
  const dec = new TextDecoder();
  await Promise.all(list.map(async b => {
    try {
      const buf = await fetchFresh(b.url, 'bin');
      R.bytes += buf.byteLength;
      if (b.sha256) { const h = await sha256hex(buf); if (h === null) R.unverified++; else if (h === b.sha256) R.match++; else R.differ++; }
      addBucket(ix, JSON.parse(dec.decode(buf)));
      R.ok++;
    } catch (e) { R.failed.push(b.url.split('/').pop() + ': ' + (e.status ? 'HTTP ' + e.status : e.message)); }
    onEach?.();
  }));
  return { ix, R };
}

/* The first lines of LINES.md, streamed and then cancelled: its header names its generation. */
async function linesHeader() {
  return queue.add(async () => {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 15000);
    try {
      const r = await fetch(LINES_MD, { signal: ctl.signal, cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const total = Number(r.headers.get('content-length')) || null;
      const reader = r.body.getReader(); const dec = new TextDecoder(); let text = '', bytes = 0;
      while (text.length < 4000 && !/```text/.test(text)) { const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength; text += dec.decode(value, { stream: true }); }
      reader.cancel().catch(() => {});
      const line = (text.split('\n').find(l => /unique lines/.test(l)) || '').trim();
      return { line, bytes, total };
    } finally { clearTimeout(t); }
  });
}

let unknownRun = null;
function openUnknownDrawer() {
  if (unknownRun) return;
  unknownRun = runUnknownDrawer().catch(e => { $('uStatus').innerHTML = `<span class="refuse">FAIL</span> ${esc(e.message)}`; unknownRun = null; });
}
async function runUnknownDrawer() {
  const status = $('uStatus');
  let g = 0; const G = st.manifest.graphs.length;
  status.textContent = `LOAD · spider graphs 0/${G}`;
  await loadAllGraphs(() => { status.textContent = `LOAD · spider graphs ${++g}/${G}`; });
  if (!st.reg) throw new Error('the block register did not load, so no path can be called unknown');
  const items = [];
  for (const gr of st.manifest.graphs) {
    const s = st.graphs.get(gr.id); if (s?.status !== 'OK') continue;
    s.graph.nodes.forEach((n, i) => {
      const ref = nodeRefs(gr.id, n); if (ref.kind !== 'path') return;
      if (counterpart(ref, st.reg, null).state !== 'unknown') return;
      items.push({ g: gr.id, i, n, repo: ref.repo, path: ref.path, shape: shapeOf(n, ref) });
    });
  }
  /* the pack this page draws, and the code-index generation it was built from */
  const prov = await getJSON(DATA + 'provenance.json');
  const src = prov.sources.filter(x => /\/stars\/code\/f\/\d+\.json$/.test(x.url));
  const idxSrc = prov.sources.find(x => /\/stars\/code\/index\.json$/.test(x.url));
  const pinned = url => url.replace('https://ventusltd.github.io/stars/', `https://raw.githubusercontent.com/Ventusltd/stars/${PACK_STARS}/`);
  const idxHash = await sha256hex(await fetchFresh(pinned(idxSrc.url), 'bin'));
  let k = 0;
  status.textContent = `LOAD · pack code-index buckets 0/${src.length}`;
  const old = await readBuckets(src.map(x => ({ url: pinned(x.url), sha256: x.sha256 })), () => { status.textContent = `LOAD · pack code-index buckets ${++k}/${src.length}`; });
  for (const it of items) Object.assign(it, classify(it, old.ix));
  const U = { items, old, prov, idxOk: idxHash === idxSrc.sha256, idxHash, bySrc: null };
  /* class 3, and class 2, against the newer source */
  const later = items.filter(it => it.cls === 3 || it.cls === 2);
  if (later.length) {
    let newer = null;
    try {
      const meta = await fetchFresh(NEWER_DATA + 'all-lines.meta.json', 'json');
      const p2 = await fetchFresh(NEWER_DATA + 'provenance.json', 'json');
      newer = { kind: 'pack', meta, prov: p2, list: p2.sources.filter(x => /\/stars\/code\/f\/\d+\.json$/.test(x.url)).map(x => ({ url: x.url, sha256: x.sha256 })) };
    } catch (e) {
      const idx = await fetchFresh('https://ventusltd.github.io/stars/code/index.json', 'json');
      newer = { kind: 'served', why: e.message, idx, list: idx.buckets.map(b => ({ url: `https://ventusltd.github.io/stars/code/f/${b}.json` })) };
      try { newer.lines = await linesHeader(); } catch (e2) { newer.linesError = e2.message; }
    }
    let j = 0;
    status.textContent = `LOAD · newer code-index buckets 0/${newer.list.length}`;
    const nw = await readBuckets(newer.list, () => { status.textContent = `LOAD · newer code-index buckets ${++j}/${newer.list.length}`; });
    newer.read = nw;
    for (const it of later) it.now = holds(nw.ix, it.repo, it.path, it.shape) ? 'numbered after the pack was built' : 'not numbered';
    U.newer = newer;
  }
  st.unknownSummary = U;
  status.innerHTML = `<span class="known">OK</span>`;
  renderUnknownDrawer(3, 0);
  writeTest(); writeQuestions();
}
function unknownCounts(U) {
  const c = { 1: [], 2: [], 3: [], 4: [] };
  for (const it of U.items) c[it.cls].push(it);
  const distinct = list => new Set(list.map(it => it.repo + '/' + it.path)).size;
  return { c, distinct };
}
function renderUnknownDrawer(cls, page) {
  const U = st.unknownSummary, { c, distinct } = unknownCounts(U), PER = 12;
  const o = U.old, N = U.newer;
  const exts = [...o.ix.exts].sort((a, b) => b[1] - a[1]).map(([e, k]) => '.' + e + ' ' + fmt(k)).join(', ');
  const after = list => list.filter(it => it.now === 'numbered after the pack was built').length;
  let newerLine = '';
  if (N) {
    const r = N.read.R;
    newerLine = N.kind === 'pack'
      ? `Newer source: the numbered database pack ${esc(NEWER_DATA.split('/').slice(-3, -2)[0])} (built ${esc(N.prov.built_utc)}, ${fmt(N.meta.lines)} lines, max key ${fmt(N.meta.max)}), newer than the pack drawn here (built ${esc(U.prov.built_utc)}). Its provenance lists ${fmt(N.list.length)} code-index buckets; read from the served stars site, ${fmt(r.match)} match its sha256, ${fmt(r.differ)} differ${r.differ ? ' (the served bytes have moved on since that pack was built)' : ''}${r.unverified ? `, ${fmt(r.unverified)} unverified (no crypto in this browser)` : ''}${r.failed.length ? `, <span class="refuse">${fmt(r.failed.length)} failed</span>` : ''}; ${fmt(N.read.ix.repos.size)} repositories, ${fmt(N.read.ix.paths.size)} paths.`
      : `Newer source: the newer pack did not answer (${esc(N.why)}), so the served stars code index answered (generated ${esc(N.idx.generated_utc)}, ${fmt(N.idx.families)} families), newer than the pack. ${N.lines ? `LINES.md was streamed for its header only (${fmt(N.lines.bytes)} of ${N.lines.total ? fmt(N.lines.total) : 'unknown'} bytes, then cancelled): "${esc(N.lines.line.slice(0, 160))}". It carries number and code, no file path, so it cannot say whether a file is numbered.` : `LINES.md: ${esc(N.linesError || '')}`}`;
  }
  const tab = k => `<button type="button" data-c="${k}"${k === cls ? ' aria-pressed="true" class="on"' : ''}>class ${k}: ${fmt(c[k].length)}</button>`;
  const list = c[cls], rows = list.slice(page * PER, page * PER + PER).map((it, k) => `<li><button type="button" class="rowbtn" data-k="${page * PER + k}">${esc(it.g)} · ${esc(it.n.label.slice(0, 48))}</button> <span>${esc(it.repo)}${it.path ? '/' + esc(it.path) : ' (repository)'}</span> <span class="dim">· ${esc(it.shape)} · ${esc(it.why)}${it.now ? ' · now: ' : ''}</span>${it.now ? `<span class="${it.now === 'not numbered' ? 'refuse' : 'known'}">${esc(it.now)}</span>` : ''}</li>`).join('');
  $('uBody').innerHTML = `<p>${fmt(U.items.length)} spider nodes name a repository or path that the live block register does not hold (${fmt(distinct(U.items))} distinct). Measured classes:</p>
    <ol class="classes">
      <li><b>${fmt(c[1].length)}</b> nodes (${fmt(distinct(c[1]))} distinct) · not code by file type. <span class="dim">${esc(CLASS_TEXT[1])}</span></li>
      <li><b>${fmt(c[2].length)}</b> nodes (${fmt(distinct(c[2]))} distinct) · code in a repository the numbered database does not scan. <span class="dim">${esc(CLASS_TEXT[2])}</span>${N ? ` <span class="dim">Of these, numbered after the pack was built (the newer source has a place there): ${fmt(after(c[2]))}.</span>` : ''}</li>
      <li><b>${fmt(c[3].length)}</b> nodes (${fmt(distinct(c[3]))} distinct) · code in a scanned repository, absent from the pack. <span class="dim">${esc(CLASS_TEXT[3])}</span>${N ? ` <span class="known">${fmt(after(c[3]))} numbered after the pack was built</span> · <span class="refuse">${fmt(c[3].length - after(c[3]))} not numbered</span>` : ''}</li>
      ${c[4].length ? `<li><b>${fmt(c[4].length)}</b> nodes (${fmt(distinct(c[4]))} distinct) · held by the pack, not by the register. <span class="dim">${esc(CLASS_TEXT[4])}</span></li>` : ''}
    </ol>
    <p class="dim">The pack: ${esc(DATA)} (built ${esc(U.prov.built_utc)}). Its provenance.json lists ${fmt(o.R.ok + o.R.failed.length)} code-index buckets by the stars site URL and sha256, not by commit; they are read at stars@${PACK_STARS.slice(0, 7)}, whose code/index.json sha256 ${U.idxOk ? 'equals' : '<span class="refuse">does not equal</span>'} the provenance record, and ${fmt(o.R.match)} of ${fmt(src_n(o))} buckets match their recorded sha256${o.R.differ ? `, <span class="refuse">${fmt(o.R.differ)} differ</span>` : ''}${o.R.failed.length ? `, <span class="refuse">${fmt(o.R.failed.length)} failed: classes 2 to 4 are INCOMPLETE</span>` : ''}. ${fmt(o.ix.repos.size)} repositories scanned, ${fmt(o.ix.paths.size)} paths with a function place; extensions read: ${esc(exts)}. Limit of the method: ${fmt(o.ix.short)} of ${fmt(o.ix.families)} families list fewer places than the files they are in (at most ${fmt(o.ix.maxPlaces)} places are listed per family), so a file whose every function sits only in those families would read as absent.</p>
    ${newerLine ? `<p class="dim">${newerLine}</p>` : ''}
    <p class="tabs">${[1, 2, 3, 4].filter(k => k < 4 || c[4].length).map(tab).join(' ')}</p>
    <ul class="pagelist">${rows || '<li class="dim">EMPTY: no node in this class</li>'}</ul>
    <p class="pager">${page > 0 ? `<button type="button" data-p="${page - 1}">previous</button>` : ''} <span class="dim">${list.length ? fmt(page * PER + 1) + '–' + fmt(Math.min(list.length, page * PER + PER)) + ' of ' + fmt(list.length) : ''}</span> ${page * PER + PER < list.length ? `<button type="button" data-p="${page + 1}">next</button>` : ''}</p>`;
  $('uBody').querySelectorAll('[data-c]').forEach(b => b.addEventListener('click', () => renderUnknownDrawer(Number(b.dataset.c), 0)));
  $('uBody').querySelectorAll('[data-p]').forEach(b => b.addEventListener('click', () => renderUnknownDrawer(cls, Number(b.dataset.p))));
  $('uBody').querySelectorAll('[data-k]').forEach(b => b.addEventListener('click', () => openNode(list[Number(b.dataset.k)])));
}
const src_n = o => o.R.ok + o.R.failed.length;

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
    <p>${testAtlasLine()}</p><p>${testUnknownLine()}</p>
    <p class="dim">The full test, run in headless Chrome and WebKit on the live spider page, with the Grid Atlas config comparison and every URL status, is kept with this iteration's test receipts.</p>`;
  $('nameBtn')?.addEventListener('click', nameMatch);
}

function testAtlasLine() {
  const A = st.atlasSummary;
  if (!A) return '<b>Shared keys with Grid Atlas:</b> <span class="dim">WAIT · not measured until the "Shared keys with Grid Atlas" drawer is opened (it reads every Grid Atlas cartridge file the spider links).</span>';
  const rl = st.contract ? receiverLink(st.contract, A.cfg.receivers) : null;
  return `<b>Shared keys with Grid Atlas (measured here):</b> ${fmt(A.nodes)} nodes across the loaded graphs carry ${fmt(A.urls)} distinct Grid Atlas URLs; ${fmt(A.withFile)} of them link a cartridge, cartridge part, composition manifest or config file; <b>${fmt(A.joined.length)}</b> join Grid Atlas by a layer id declared in the cartridge file; <b>${fmt(A.reached.size)}</b> Atlas layer ids reached (${[...A.reached.keys()].map(esc).join(', ') || 'none'}); <b>${fmt(A.nodes - A.joined.length)}</b> have a Grid Atlas URL but no declared config layer. The audit's finding that no node carries a layer parameter still holds; this join is by the files the nodes link, not by URL parameters.${rl && !rl.layerParam ? ' The deep-link contract has no layer parameter, so MAP opens the canonical receiver without one.' : ''}`;
}
function testUnknownLine() {
  const U = st.unknownSummary;
  if (!U) return '<b>The unknown paths:</b> <span class="dim">WAIT · not classified until "The unknown paths" drawer is opened (it reads the code-index buckets of the pack).</span>';
  const { c } = unknownCounts(U), after = c[3].filter(it => it.now === 'numbered after the pack was built').length;
  return `<b>The unknown paths (measured here):</b> ${fmt(U.items.length)} nodes name a repository or path the live register does not hold: class 1 not code by file type <b>${fmt(c[1].length)}</b>; class 2 in a repository the pack does not scan <b>${fmt(c[2].length)}</b>; class 3 in a scanned repository, absent from the pack <b>${fmt(c[3].length)}</b>${U.newer ? ` (${fmt(after)} numbered after the pack was built, ${fmt(c[3].length - after)} not numbered; answered by ${U.newer.kind === 'pack' ? 'the newer pack code index' : 'the served stars code index'})` : ''}${c[4].length ? `; held by the pack but not the register <b>${fmt(c[4].length)}</b>` : ''}.`;
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
  <li><b>Where does it lead next?</b> From the spider: to the ${fmt(n)} graphs its manifest lists and to each node's GitHub and external links. From the wafer: to module layers and named functions. ${atlasQ()} To an electrical element itself: not established, because no spider node carries a busbar, feeder or cable identity, only code identities.</li>
  </ol>
  <p class="machine"><b>Machine detail.</b> Inputs: spider/manifest.json graphs[] {id, path, edges_path} and each graph's nodes {id, label, type, rag, reason, gh, ext, path} and edges ([from, to, type] index-array-v1 or {from, to, type}) at ventus-grid-engine@${SHA}; the live block register blocks[] {symbol, files[] {repo, path, commit}}; the numbered database families.json {n, name, block, lineOffset, lineCount} and lines.bin (unsigned 32-bit permanent line keys). Outputs: per spider node a counterpart state (known, unknown, none, pending) with the method; woken keys, dimensionless permanent integers placed at r = √key, θ = key × golden angle. Refusals: "not in the numbered universe yet" with the reason; a graph that returns HTTP 404 shows FAIL; a block in the register with no charted lines is named. Shared keys: inputs the Grid Atlas files a node links (raw.githubusercontent.com at the link's commit when it names one) and the release config named by gridatlas atlas/current.json shell.index; output per node the declared layer ids that are config ids, with the declaration form; refusals EMPTY when a file declares none, and no layer parameter on MAP because deeplink/contract.js PARAMS has none. Unknown paths: inputs the code-index buckets listed in the pack's provenance.json (sha256 checked) and the newer pack's; output a class per node with its reason. Units: none physical; this page computes no electrical quantity.</p>`;
}
function atlasQ() {
  const A = st.atlasSummary;
  if (!A) return 'To Grid Atlas: open "Shared keys with Grid Atlas" to measure which Atlas layers the linked cartridge files declare.';
  const ids = [...A.reached.keys()];
  return `To Grid Atlas: ${fmt(A.joined.length)} nodes lead to ${fmt(ids.length)} Atlas layers declared in their cartridge files (${ids.map(id => esc(id) + ' ' + esc(A.cfg.labels.get(id) || '')).join('; ')}); the MAP button opens the canonical receiver, where those layers are ticked by hand. By their config labels these are voltage line layers and the substations layer: the network a feeder or cable route and a busbar would be read against, not a drawn diagram element.`;
}

function writeRules() {
  $('rBody').className = '';
  $('rBody').innerHTML = `<ul>
  <li>One fetch queue, four requests at a time, each with a 15 s timeout; one shared promise per URL, dropped when it fails so a retry can happen.</li>
  <li>A spider graph is fetched only when chosen in the list; only its row is relabelled WAIT, LOAD, OK, EMPTY or FAIL. Preloaded: the manifest, the Federation graph (the spider's own default), the block register and the wafer's layer manifest.</li>
  <li>Spider nodes are drawn on one canvas, never as page elements; at most ${MAX_LABELS_TEXT} neighbour labels are written.</li>
  <li>The wafer ground is one GPU draw of every numbered line. A woken line is drawn only when its radius √key lies in the band of radii the pane can see, and at most ${fmt(MAX_DRAWN)} woken lines are drawn in one frame.</li>
  <li>Shared keys with Grid Atlas: a node's linked cartridge files are read when that node is tapped; every file the spider links is read only when that drawer is opened. A file's text is dropped once its layer ids are read; only the ids stay.</li>
  <li>The unknown paths: the code-index buckets of the pack and of the newer pack are read only when that drawer is opened, through the same queue; each bucket is parsed, its place paths kept and the rest dropped. LINES.md is streamed only if the newer pack does not answer, and only as far as its header.</li>
  <li>At most ${MAX_DOCS} layer files are held; the least recently used is dropped first. A spider node wakes at most ${MAX_BLOCKS_WOKEN} blocks. The family index and its line file load only when a family is asked for.</li>
  </ul>`;
}
const MAX_LABELS_TEXT = 28;

/* ── start ─────────────────────────────────────────────────────────────────── */
(async function start() {
  if (matchMedia('(min-width:760px)').matches) $('questions').open = true;
  writeRules();
  $('atlasKeys').addEventListener('toggle', () => { if ($('atlasKeys').open && st.manifest) openAtlasDrawer(); });
  $('unknownPaths').addEventListener('toggle', () => { if ($('unknownPaths').open && st.manifest) openUnknownDrawer(); });
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
