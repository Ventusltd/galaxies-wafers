/* Hidden Wires — the page. Loading in Grid Atlas grammar, drawing on one
   canvas, one card re-filled. The arithmetic lives in wires.mjs. */
import * as W from './wires.mjs';

const STAR_MAKER_COMMIT = 'c5bf5f6518feba594bb057988e8e99ca81044952';
const RAW = `https://raw.githubusercontent.com/Ventusltd/star-maker/${STAR_MAKER_COMMIT}/`;
const URL_REGISTER = 'https://ventusltd.github.io/stars/blocks/blocks.json';
const URL_COMPOUNDS = RAW + 'chemistry/compounds.json';
const URL_GRAPH = RAW + 'chemistry/graph.json';
const URL_LEGEND = RAW + 'CHEMISTRY.md';
const URL_CVAA = 'https://api.github.com/repos/Ventusltd/cvaa/contents/vaccines';
const ROW_CAP = 200;

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const fmt = n => Number(n).toLocaleString('en-GB');
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
      if (!res.ok) {
        let why = '';
        try { const j = await res.json(); if (j && j.message) why = ' ' + j.message; } catch (_) { /* no body */ }
        throw new Error(`HTTP ${res.status}${why}`);
      }
      return as === 'text' ? await res.text() : await res.json();
    } catch (err) {
      throw new Error(err && err.name === 'AbortError' ? 'timed out after 15 s' : (err && err.message) || String(err));
    } finally { clearTimeout(timer); }
  }).catch(err => { urlCache.delete(url); throw err; });
  urlCache.set(url, p);
  return p;
}

const RT = Object.fromEntries(['parts', 'declared', 'hidden', 'vaccines'].map(id => [id, { loaded: false, loading: null, status: 'WAIT', visible: false }]));

function updateUIState(id, state, detail) {
  RT[id].status = state;
  const span = $('lbl-' + id);
  if (span) span.textContent = `${span.getAttribute('data-base-label')} [${detail ? state + ' · ' + detail : state}]`;
}

const D = { reg: null, idx: null, chem: null, graph: null, legend: null, vaccines: null, vaccineError: null };

function hydrate(id) {
  const rt = RT[id];
  if (rt.loaded) return Promise.resolve(true);
  if (rt.loading) return rt.loading;
  updateUIState(id, 'LOAD');
  rt.loading = (async () => {
    try {
      if (id === 'parts' || id === 'declared') {
        const reg = await fetchOnce(URL_REGISTER, 'json');
        if (!D.idx) { D.reg = reg; D.idx = W.registerIndex(reg); buildNodes(); }
        if (!D.idx.blocks.length) { updateUIState(id, 'EMPTY', 'the register lists no blocks'); rt.loading = null; return false; }
        rt.loaded = true;
        updateUIState(id, 'OK', id === 'parts' ? `${fmt(D.idx.blocks.length)} blocks` : `${fmt(D.idx.edges.length)} depends_on lines`);
      } else if (id === 'hidden') {
        const partsOk = hydrate('parts');
        const [chem, graph, md] = await Promise.all([fetchOnce(URL_COMPOUNDS, 'json'), fetchOnce(URL_GRAPH, 'json'), fetchOnce(URL_LEGEND, 'text')]);
        const ok = await partsOk;
        if (!ok) throw new Error('the block register did not load, so no part can be placed');
        D.chem = W.countFailures(chem); D.chemDoc = chem; D.graph = graph; D.legend = W.legend(md);
        if (!D.chem.total) { updateUIState(id, 'EMPTY', 'compounds.json holds no compositions'); rt.loading = null; return false; }
        buildWires();
        rt.loaded = true;
        updateUIState(id, D.wires.length ? 'OK' : 'EMPTY', D.wires.length ? `${D.wires.length} wires from ${fmt(D.chem.failed)} failed compositions` : 'no failure message names a needed module');
        paintSummary(); buildRows(); paintQuestions();
      } else if (id === 'vaccines') {
        const list = await fetchOnce(URL_CVAA, 'github');
        if (!Array.isArray(list)) throw new Error('the contents endpoint did not return a list');
        D.vaccines = list.filter(x => x && x.type === 'file').map(x => x.name);
        rt.loaded = true;
        updateUIState(id, D.vaccines.length ? 'OK' : 'EMPTY', D.vaccines.length ? `${D.vaccines.length} vaccine names` : 'the vaccines folder lists no files');
        refreshVaccineCells(); paintQuestions();
      }
      rt.loading = null;
      schedule();
      if (S.sel) fillCard();
      return rt.loaded;
    } catch (err) {
      rt.loading = null;
      if (id === 'vaccines') { D.vaccineError = err.message; refreshVaccineCells(); if (S.sel) fillCard(); }
      updateUIState(id, 'FAIL', err.message + ' · tick again to retry');
      const box = document.querySelector(`input[data-layer="${id}"]`);
      if (box) box.checked = false;
      rt.visible = false;
      if (id === 'hidden') { $('summary').textContent = `FAIL — ${err.message}. Nothing is drawn in its place.`; }
      schedule();
      return false;
    }
  })();
  return rt.loading;
}

document.querySelectorAll('input[data-layer]').forEach(box => {
  box.checked = false;
  box.addEventListener('change', () => {
    const id = box.dataset.layer;
    RT[id].visible = box.checked;
    if (box.checked) hydrate(id);
    schedule();
  });
});

/* ── model for drawing ───────────────────────────────────────────────────── */
let NODES = [];            // {id, x, y, label, kind, block}
const NODE_BY_ID = new Map();
D.wires = [];

function buildNodes(extra = []) {
  const pos = W.layout(D.idx.blocks, extra);
  NODES = []; NODE_BY_ID.clear();
  for (const b of D.idx.blocks) {
    const [x, y] = pos.get(b.symbol);
    const n = { id: b.symbol, x, y, label: b.symbol, title: b.title, kind: 'block', block: b };
    NODES.push(n); NODE_BY_ID.set(n.id, n);
  }
  for (const name of new Set(extra)) {
    const [x, y] = pos.get('part:' + name);
    const n = { id: 'part:' + name, x, y, label: name, title: name, kind: 'part', block: null };
    NODES.push(n); NODE_BY_ID.set(n.id, n);
  }
}

function endpointOf(name) {
  const b = D.idx.byTitle.get(name);
  return b ? b.symbol : 'part:' + name;
}

function buildWires() {
  const extra = [];
  for (const w of D.chem.wires) {
    if (!D.idx.byTitle.has(w.reporter)) extra.push(w.reporter);
    if (!D.idx.byTitle.has(w.needed)) extra.push(w.needed);
  }
  buildNodes(extra);
  const max = Math.max(1, ...D.chem.wires.map(w => w.compositions));
  const symbols = Object.keys(D.legend);
  D.wires = D.chem.wires.map((w, i) => {
    const hostId = endpointOf(w.reporter);
    const host = NODE_BY_ID.get(hostId);
    let fromId = hostId;
    if (w.failing !== w.reporter) {
      /* the failing part is a module inside the reporting part: a satellite of it */
      fromId = 'sat:' + w.failing;
      if (!NODE_BY_ID.has(fromId)) {
        const len = Math.hypot(host.x, host.y) || 1;
        const ux = host.x / len || 0, uy = host.y / len || -1;
        const n = { id: fromId, x: host.x + ux * 9 - uy * 4, y: host.y + uy * 9 + ux * 4, label: w.failing, title: `${w.failing} (inside ${w.reporter})`, kind: 'sat', block: null, host: hostId };
        NODES.push(n); NODE_BY_ID.set(fromId, n);
      }
    }
    const toId = endpointOf(w.needed);
    const a = NODE_BY_ID.get(fromId), b = NODE_BY_ID.get(toId);
    const hostSymbol = symbols.find(s => D.legend[s] === w.reporter) || null;
    return {
      ...w, fromId, toId, hostId, hostSymbol,
      pts: W.curve([a.x, a.y], [b.x, b.y], i % 2 ? -0.18 : 0.18),
      width: 2 + 8 * Math.sqrt(w.compositions / max),
      decl: W.declaredNow(D.idx, w.reporter, w.needed),
      unplug: W.unplugSuppliers(D.chemDoc, w.text, hostSymbol, symbols),
      decay: W.decayEdges(D.graph, w.text)
    };
  });
  for (const w of D.wires) {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (let i = 0; i < w.pts.length; i += 2) { minx = Math.min(minx, w.pts[i]); maxx = Math.max(maxx, w.pts[i]); miny = Math.min(miny, w.pts[i + 1]); maxy = Math.max(maxy, w.pts[i + 1]); }
    w.bbox = [minx, miny, maxx, maxy];
  }
  fit();
}

/* ── state ──────────────────────────────────────────────────────────────── */
const S = { filter: 'all', sel: null, view: { x: 0, y: 0, k: 1 }, fitK: 1 };
const wireShown = w => S.filter === 'all' || w.decl.declared === false;

$('filter').addEventListener('click', e => {
  const b = e.target.closest('button[data-f]');
  if (!b) return;
  S.filter = b.dataset.f;
  $('filter').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  $('worktitle').textContent = S.filter === 'all' ? 'hidden wires' : 'hidden, not yet declared';
  for (const [id, r] of rowById) { const w = D.wires.find(x => x.id === id); r.li.hidden = !wireShown(w); }
  paintWorkCount();
  if (!RT.hidden.visible && S.filter === 'undeclared') { const box = document.querySelector('input[data-layer="hidden"]'); box.checked = true; RT.hidden.visible = true; hydrate('hidden'); }
  schedule();
});

/* ── canvas ─────────────────────────────────────────────────────────────── */
const canvas = $('plane');
const ctx = canvas.getContext('2d');
let W_CSS = 1, H_CSS = 1, DPR = 1;
const R = 100;

function resize() {
  const r = canvas.getBoundingClientRect();
  W_CSS = Math.max(1, r.width); H_CSS = Math.max(1, r.height);
  DPR = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(W_CSS * DPR); canvas.height = Math.round(H_CSS * DPR);
  const wasFit = Math.abs(S.view.k - S.fitK) < 1e-9;
  S.fitK = fitScale();
  if (wasFit) S.view.k = S.fitK;
  schedule();
}
function fit() { S.fitK = fitScale(); S.view = { x: 0, y: 0, k: S.fitK }; schedule(); }
new ResizeObserver(resize).observe(canvas);
$('fit').addEventListener('click', fit);

function fitScale() { return Math.max(0.2, (Math.min(W_CSS, H_CSS) - 40) / (2 * 1.25 * R + 12)); }
const sx = x => W_CSS / 2 + (x - S.view.x) * S.view.k;
const sy = y => H_CSS / 2 + (y - S.view.y) * S.view.k;
const wx = px => S.view.x + (px - W_CSS / 2) / S.view.k;
const wy = py => S.view.y + (py - H_CSS / 2) / S.view.k;

let pending = false;
function schedule() { if (!pending) { pending = true; requestAnimationFrame(draw); } }
const drawn = { nodes: 0, lines: 0, wires: 0, ms: 0, frames: 0 };
let lastDrawnText = '';

function inView(minx, miny, maxx, maxy, pad = 20) {
  return sx(maxx) >= -pad && sx(minx) <= W_CSS + pad && sy(maxy) >= -pad && sy(miny) <= H_CSS + pad;
}

function draw() {
  pending = false;
  const t0 = performance.now();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#05060a';
  ctx.fillRect(0, 0, W_CSS, H_CSS);
  let nNodes = 0, nLines = 0, nWires = 0;
  const k = S.view.k;

  if (!D.idx) {
    ctx.fillStyle = '#8b93a7'; ctx.font = '12px ui-monospace,Menlo,Consolas,monospace'; ctx.textAlign = 'center';
    ctx.fillText('WAIT — tick a layer', W_CSS / 2, H_CSS / 2);
    finish(t0, 0, 0, 0); return;
  }

  /* charted plane guides: the register disc and the ring of unregistered parts */
  ctx.strokeStyle = '#141925'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(sx(0), sy(0), R * 1.04 * k, 0, Math.PI * 2); ctx.stroke();
  if (RT.hidden.loaded && RT.hidden.visible) { ctx.setLineDash([2, 6]); ctx.beginPath(); ctx.arc(sx(0), sy(0), R * 1.25 * k, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }

  const selNode = S.sel && S.sel.type === 'node' ? S.sel.id : null;
  const selEdge = S.sel && S.sel.type === 'edge' ? S.sel.i : -1;
  const dimDeclared = S.filter === 'undeclared';

  /* declared needs: solid, cased */
  if (RT.declared.loaded && RT.declared.visible) {
    const hi = [];
    const casing = new Path2D(), core = new Path2D();
    D.idx.edges.forEach((e, i) => {
      const a = NODE_BY_ID.get(e.from), b = NODE_BY_ID.get(e.to);
      if (!inView(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y))) return;
      nLines++;
      if (e.from === selNode || e.to === selNode || i === selEdge) { hi.push([a, b]); return; }
      casing.moveTo(sx(a.x), sy(a.y)); casing.lineTo(sx(b.x), sy(b.y));
      core.moveTo(sx(a.x), sy(a.y)); core.lineTo(sx(b.x), sy(b.y));
    });
    ctx.lineCap = 'round';
    ctx.globalAlpha = dimDeclared ? 0.35 : 0.9; ctx.strokeStyle = '#000'; ctx.lineWidth = 3.4; ctx.stroke(casing);
    ctx.globalAlpha = dimDeclared ? 0.25 : 0.7; ctx.strokeStyle = '#5b6780'; ctx.lineWidth = 1.2; ctx.stroke(core);
    ctx.globalAlpha = 1;
    for (const [a, b] of hi) {
      ctx.strokeStyle = '#000'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(sx(a.x), sy(a.y)); ctx.lineTo(sx(b.x), sy(b.y)); ctx.stroke();
      ctx.strokeStyle = '#c3ccda'; ctx.lineWidth = 2; ctx.stroke();
    }
  }

  /* dots */
  const partsOn = RT.parts.loaded && RT.parts.visible;
  const wiresOn = RT.hidden.loaded && RT.hidden.visible;
  const onWire = new Set();
  if (wiresOn) for (const w of D.wires) if (wireShown(w)) { onWire.add(w.fromId); onWire.add(w.toId); onWire.add(w.hostId); }
  const rDot = Math.max(2, Math.min(6, 1 + k * 0.9));
  if (partsOn || (RT.declared.loaded && RT.declared.visible)) {
    const casing = new Path2D(), fill = new Path2D();
    for (const n of NODES) {
      if (n.kind !== 'block' || onWire.has(n.id)) continue;
      if (!partsOn) continue;
      const X = sx(n.x), Y = sy(n.y);
      if (X < -10 || X > W_CSS + 10 || Y < -10 || Y > H_CSS + 10) continue;
      nNodes++;
      casing.moveTo(X + rDot + 1.5, Y); casing.arc(X, Y, rDot + 1.5, 0, Math.PI * 2);
      fill.moveTo(X + rDot, Y); fill.arc(X, Y, rDot, 0, Math.PI * 2);
    }
    ctx.fillStyle = '#000'; ctx.fill(casing);
    ctx.fillStyle = '#aeb6c4'; ctx.fill(fill);
  }

  /* hidden wires: dashed, neutral, thickness by compositions */
  if (wiresOn) {
    for (const w of D.wires) {
      if (!wireShown(w)) continue;
      const [a0, b0, a1, b1] = w.bbox;
      if (!inView(a0, b0, a1, b1, 40)) continue;
      nWires++;
      const sel = S.sel && S.sel.type === 'wire' && S.sel.id === w.id;
      const path = new Path2D();
      for (let i = 0; i < w.pts.length; i += 2) { const X = sx(w.pts[i]), Y = sy(w.pts[i + 1]); i ? path.lineTo(X, Y) : path.moveTo(X, Y); }
      ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
      if (sel) { ctx.strokeStyle = 'rgba(239,233,220,0.22)'; ctx.lineWidth = w.width + 14; ctx.stroke(path); }
      ctx.strokeStyle = '#000'; ctx.lineWidth = w.width + 4; ctx.stroke(path);
      ctx.setLineDash([Math.max(8, w.width * 2.2), Math.max(6, w.width * 1.4)]);
      ctx.strokeStyle = '#efe9dc'; ctx.lineWidth = w.width; ctx.stroke(path);
      ctx.setLineDash([]);
      /* arrowhead near the needed end */
      const n = w.pts.length / 2, j = Math.floor(n * 0.8);
      const ax = sx(w.pts[j * 2]), ay = sy(w.pts[j * 2 + 1]), bx = sx(w.pts[(j + 1) * 2]), by = sy(w.pts[(j + 1) * 2 + 1]);
      const ang = Math.atan2(by - ay, bx - ax), s = 7 + w.width;
      ctx.beginPath(); ctx.moveTo(bx + Math.cos(ang) * s * 0.6, by + Math.sin(ang) * s * 0.6);
      ctx.lineTo(bx + Math.cos(ang + 2.5) * s, by + Math.sin(ang + 2.5) * s); ctx.lineTo(bx + Math.cos(ang - 2.5) * s, by + Math.sin(ang - 2.5) * s); ctx.closePath();
      ctx.fillStyle = '#efe9dc'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.stroke(); ctx.fill();
    }
    /* wire ends */
    ctx.font = '11px ui-monospace,Menlo,Consolas,monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (const id of onWire) {
      const n = NODE_BY_ID.get(id);
      const X = sx(n.x), Y = sy(n.y);
      if (X < -60 || X > W_CSS + 60 || Y < -20 || Y > H_CSS + 20) continue;
      nNodes++;
      ctx.beginPath(); ctx.arc(X, Y, 8, 0, Math.PI * 2); ctx.fillStyle = '#000'; ctx.fill();
      ctx.beginPath(); ctx.arc(X, Y, 6, 0, Math.PI * 2);
      if (n.kind === 'block') { ctx.fillStyle = '#ffffff'; ctx.fill(); }
      else { ctx.lineWidth = 2.2; ctx.strokeStyle = '#ffffff'; ctx.setLineDash(n.kind === 'part' ? [3, 2.5] : []); ctx.stroke(); ctx.setLineDash([]); }
      const text = n.kind === 'block' ? `${n.label} ${n.title}` : n.label;
      /* ends on the right half label inward so the text stays on the plane */
      if (n.x > 0 && n.kind === 'part') { ctx.textAlign = 'right'; label(text, X - 11, Y + 14); ctx.textAlign = 'left'; }
      else if (n.kind === 'part') label(text, X - 6, Y + 14);
      else label(text, X + 11, Y);
    }
  }

  /* block labels when zoomed in far enough to separate them */
  if (partsOn && k > 3.2) {
    ctx.font = '10px ui-monospace,Menlo,Consolas,monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (const n of NODES) {
      if (n.kind !== 'block' || onWire.has(n.id)) continue;
      const X = sx(n.x), Y = sy(n.y);
      if (X < -40 || X > W_CSS + 4 || Y < -10 || Y > H_CSS + 10) continue;
      label(k > 9 ? `${n.label} ${n.title.slice(0, 28)}` : n.label, X + rDot + 3, Y, '#8b93a7');
    }
  }

  if (selNode) {
    const n = NODE_BY_ID.get(selNode);
    if (n) { ctx.beginPath(); ctx.arc(sx(n.x), sy(n.y), 12, 0, Math.PI * 2); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.stroke(); }
  }
  finish(t0, nNodes, nLines, nWires);
}

function label(text, X, Y, colour = '#ffffff') {
  ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText(text, X, Y);
  ctx.fillStyle = colour; ctx.fillText(text, X, Y);
}

function finish(t0, nNodes, nLines, nWires) {
  drawn.nodes = nNodes; drawn.lines = nLines; drawn.wires = nWires; drawn.ms = performance.now() - t0; drawn.frames++;
  const text = `drawn last frame: ${nNodes} dots · ${nLines} declared lines · ${nWires} hidden wires`;
  if (text !== lastDrawnText) { $('drawn').textContent = text; lastDrawnText = text; }
}

/* ── touch: drag to pan, pinch or wheel to zoom, tap to read ────────────── */
const pointers = new Map();
let gesture = null;
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
  if (pointers.size === 1) gesture = { tap: true, t: performance.now(), x0: e.offsetX, y0: e.offsetY, vx: S.view.x, vy: S.view.y };
  else { gesture = { tap: false, pinch: pinchStart() }; }
});
canvas.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId) || !gesture) return;
  pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
  if (pointers.size === 1 && !gesture.pinch) {
    const dx = e.offsetX - gesture.x0, dy = e.offsetY - gesture.y0;
    if (Math.hypot(dx, dy) > 8) gesture.tap = false;
    if (!gesture.tap) { S.view.x = gesture.vx - dx / S.view.k; S.view.y = gesture.vy - dy / S.view.k; schedule(); }
  } else if (pointers.size >= 2 && gesture.pinch) {
    const [p, q] = [...pointers.values()];
    const d = Math.hypot(p.x - q.x, p.y - q.y) || 1, mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
    const g = gesture.pinch;
    const k = clampK(g.k * d / g.d);
    S.view.k = k; S.view.x = g.wx - (mx - W_CSS / 2) / k; S.view.y = g.wy - (my - H_CSS / 2) / k;
    schedule();
  }
});
function pinchStart() {
  const [p, q] = [...pointers.values()];
  const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
  return { d: Math.hypot(p.x - q.x, p.y - q.y) || 1, k: S.view.k, wx: wx(mx), wy: wy(my) };
}
function endPointer(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (gesture && gesture.tap && pointers.size === 0 && e.type === 'pointerup' && performance.now() - gesture.t < 600) tapAt(e.offsetX, e.offsetY);
  if (pointers.size === 0) gesture = null;
  else if (pointers.size === 1) { const [p] = [...pointers.values()]; gesture = { tap: false, x0: p.x, y0: p.y, vx: S.view.x, vy: S.view.y }; }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const k = clampK(S.view.k * Math.exp(-e.deltaY * 0.0015));
  const X = wx(e.offsetX), Y = wy(e.offsetY);
  S.view.k = k; S.view.x = X - (e.offsetX - W_CSS / 2) / k; S.view.y = Y - (e.offsetY - H_CSS / 2) / k;
  schedule();
}, { passive: false });
const clampK = k => Math.max(S.fitK * 0.5, Math.min(S.fitK * 60, k));

function tapAt(px, py) {
  if (!D.idx) return;
  let best = null;
  if (RT.hidden.loaded && RT.hidden.visible) {
    for (const w of D.wires) {
      if (!wireShown(w)) continue;
      let d = Infinity;
      for (let i = 2; i < w.pts.length; i += 2) d = Math.min(d, W.distToSegment(px, py, sx(w.pts[i - 2]), sy(w.pts[i - 1]), sx(w.pts[i]), sy(w.pts[i + 1])));
      const tol = 18 + w.width / 2;
      if (d <= tol && (!best || d < best.d)) best = { d, sel: { type: 'wire', id: w.id } };
    }
  }
  if (!best) {
    for (const n of NODES) {
      const visible = (n.kind === 'block' && RT.parts.loaded && RT.parts.visible) || (RT.hidden.loaded && RT.hidden.visible && D.wires.some(w => wireShown(w) && (w.fromId === n.id || w.toId === n.id || w.hostId === n.id)));
      if (!visible) continue;
      const d = Math.hypot(sx(n.x) - px, sy(n.y) - py);
      if (d <= 16 && (!best || d < best.d)) best = { d, sel: { type: 'node', id: n.id } };
    }
  }
  if (!best && RT.declared.loaded && RT.declared.visible) {
    D.idx.edges.forEach((e, i) => {
      const a = NODE_BY_ID.get(e.from), b = NODE_BY_ID.get(e.to);
      const d = W.distToSegment(px, py, sx(a.x), sy(a.y), sx(b.x), sy(b.y));
      if (d <= 10 && (!best || d < best.d)) best = { d, sel: { type: 'edge', i } };
    });
  }
  select(best ? best.sel : null);
}

function select(sel) {
  S.sel = sel;
  for (const [id, r] of rowById) r.btn.classList.toggle('on', !!(sel && sel.type === 'wire' && sel.id === id));
  if (sel && sel.type === 'wire' && !RT.vaccines.loaded && !RT.vaccines.loading) {
    /* reading a wire asks whether a vaccine names it: one listing, fetched once */
    const box = document.querySelector('input[data-layer="vaccines"]');
    box.checked = true; RT.vaccines.visible = true; hydrate('vaccines');
  }
  fillCard();
  schedule();
}

/* ── the card: one element, re-filled ───────────────────────────────────── */
function dl(pairs) {
  const d = el('dl');
  for (const [k, v] of pairs) { d.append(el('dt', null, k)); const dd = el('dd'); if (v instanceof Node) dd.append(v); else dd.textContent = v; d.append(dd); }
  return d;
}
function vaccineText(w) {
  if (D.vaccines) {
    const hits = W.vaccineMentions(D.vaccines, w);
    return hits.length ? `yes — ${hits.join(', ')}` : `no — none of ${D.vaccines.length} vaccine file names mentions "${w.failing}" or "${w.needed}"`;
  }
  if (D.vaccineError) return `not known — the cvaa listing did not load: ${D.vaccineError}`;
  return RT.vaccines.loading ? 'LOAD — reading the cvaa vaccine names' : 'WAIT — tick Vaccine names';
}
function declaredText(w) {
  const d = w.decl;
  if (d.declared === null) return `not known — ${d.reason}`;
  if (d.declared) return `yes — block ${d.host} ${d.by}`;
  return `no — block ${d.host} lists ${d.depends} depends_on and ${d.needs} needs; none is ${[...new Set([w.needed, W.camel(w.needed)])].map(x => `"${x}"`).join(' or ')}`;
}

function fillCard() {
  const card = $('card');
  card.textContent = '';
  const sel = S.sel;
  if (!sel) { card.append(el('p', 'dim', 'Tap a dashed wire to read its failure. Tap a dot to read its block.')); return; }
  if (sel.type === 'wire') {
    const w = D.wires.find(x => x.id === sel.id);
    card.append(el('h3', null, `${w.failing} → ${w.needed}`));
    card.append(el('p', 'dim small', w.failing === w.reporter ? `hidden wire from ${w.reporter} to the module it needed` : `hidden wire from ${w.failing}, a module inside ${w.reporter}, to the module it needed`));
    const msg = el('code', 'msg', w.text); card.append(msg);
    const count = el('span', 'big', `${fmt(w.compositions)} compositions`);
    const kinds = Object.entries(w.kinds).map(([k, v]) => `${k} ${fmt(v)}`).join(' · ');
    const stamps = Object.entries(w.stamps).map(([s, r]) => `${s} ${r.min}–${r.max} (${r.set.size} generations)`).join(' · ') || 'no stamped elements';
    const u = w.unplug;
    const unplug = !u.hits ? `not exposed by unplugging: none of the ${u.withHost} unplug compositions containing ${w.hostSymbol || w.reporter} failed with this message`
      : u.suppliers.length ? `${u.hits} of ${u.withHost} unplug compositions containing ${w.hostSymbol} failed with it; each lacks ${u.suppliers.map(s => `${s.symbol} (${D.legend[s.symbol]})`).join(', ')}, and none containing it failed`
      : `${u.hits} of ${u.withHost} unplug compositions containing ${w.hostSymbol} failed with it; no single unplugged element explains all of them`;
    const cand = w.decl.candidates && w.decl.candidates.length && !w.decl.target ? `blocks whose title contains "${w.needed}" (name-match inference): ${w.decl.candidates.map(s => `${s} ${D.idx.bySymbol.get(s).title}`).join('; ')}; ${w.decl.host || 'the host'} depends on ${w.decl.candidateDeps.length ? w.decl.candidateDeps.join(', ') : 'none of them'}` : w.decl.target ? `block ${w.decl.target}` : `no block's title contains "${w.needed}"`;
    const decay = w.decay ? (w.decay.node ? `${w.decay.elements} elements carry a DECAYS_TO edge to it` : 'graph.json has no decay node with this text') : 'graph.json not read';
    card.append(dl([
      ['failed on it', count],
      ['by kind', kinds],
      ['stars', fmt(w.stars)],
      ['generations', stamps],
      ['register declares it now', declaredText(w)],
      ['needed part in register', cand],
      ['cvaa vaccine name', vaccineText(w)],
      ['unplug evidence', unplug],
      ['graph.json', decay]
    ]));
    return;
  }
  if (sel.type === 'node') {
    const n = NODE_BY_ID.get(sel.id);
    const touching = D.wires.filter(w => w.fromId === n.id || w.toId === n.id || w.hostId === n.id);
    if (n.block) {
      const b = n.block;
      card.append(el('h3', null, `${b.symbol} · ${b.title}`));
      card.append(el('p', 'dim small', b.description || ''));
      const f = (b.files || [])[0];
      card.append(dl([
        ['category / kind', `${b.category} / ${b.kind}`],
        ['functions', `${fmt(b.functions)} (${fmt(b.named_functions)} named)`],
        ['declared depends_on', (b.depends_on || []).length ? b.depends_on.map(d => `${d.symbol} via ${(d.via || []).join(', ')}`).join('; ') : 'none'],
        ['used_by (register)', `${(b.used_by || []).length} blocks`],
        ['hidden wires touching', RT.hidden.loaded ? (touching.length ? touching.map(w => `${w.failing} → ${w.needed} (${fmt(w.compositions)})`).join('; ') : 'none recorded') : 'WAIT — tick Hidden wires'],
        ['first file', f ? `${f.repo} ${f.path} @ ${short(f.commit)}` : 'the register lists no file']
      ]));
    } else {
      card.append(el('h3', null, n.title));
      card.append(el('p', 'dim small', n.kind === 'sat' ? `A module inside ${NODE_BY_ID.get(n.host).title}, named only by its failure message. It has no register block of its own.` : 'Named in a failure message; no register block carries this exact title, so it sits on the outer ring.'));
      card.append(dl([['hidden wires touching', touching.map(w => `${w.failing} → ${w.needed} (${fmt(w.compositions)})`).join('; ') || 'none']]));
    }
    return;
  }
  if (sel.type === 'edge') {
    const e = D.idx.edges[sel.i];
    const a = D.idx.bySymbol.get(e.from), b = D.idx.bySymbol.get(e.to);
    card.append(el('h3', null, `${a.symbol} → ${b.symbol}`));
    card.append(dl([['declared need', `${a.title} depends on ${b.title}`], ['via (register)', e.via.join(', ') || 'not stated'], ['kind', 'declared in blocks.json depends_on; solid line']]));
  }
}

/* ── lists: built once, rows updated in place ───────────────────────────── */
const rowById = new Map();
function buildRows() {
  const ul = $('worklist');
  ul.textContent = '';
  rowById.clear();
  if (!D.wires.length) ul.append(el('li', 'plain', 'EMPTY — no failure message in compounds.json names a needed module.'));
  for (const w of D.wires.slice(0, ROW_CAP)) {
    const li = el('li'), btn = el('button');
    btn.type = 'button';
    const decl = el('span', null, declaredText(w)), vac = el('span', null, vaccineText(w));
    btn.append(el('span', 't', `${w.failing} → ${w.needed}`), el('br'), el('span', 'dim', `${fmt(w.compositions)} compositions · declared: `), decl, el('br'), el('span', 'dim', 'vaccine: '), vac);
    btn.addEventListener('click', () => { if (!RT.hidden.visible) { const box = document.querySelector('input[data-layer="hidden"]'); box.checked = true; RT.hidden.visible = true; } select({ type: 'wire', id: w.id }); focusWire(w); });
    li.append(btn); ul.append(li);
    li.hidden = !wireShown(w);
    rowById.set(w.id, { li, btn, decl, vac });
  }
  if (D.wires.length > ROW_CAP) ul.append(el('li', 'plain dim', `${fmt(D.wires.length - ROW_CAP)} more wires are drawn but not listed (row cap ${ROW_CAP}).`));
  const un = $('unnamed');
  un.textContent = '';
  if (!D.chem.unnamed.length) un.append(el('li', 'plain dim', 'EMPTY — every failure message names a needed module.'));
  for (const m of D.chem.unnamed.slice(0, ROW_CAP)) {
    const li = el('li', 'plain');
    li.append(el('code', null, m.text), el('br'), el('span', 'dim', `${fmt(m.compositions)} compositions · ${Object.entries(m.kinds).map(([k, v]) => `${k} ${fmt(v)}`).join(' · ')} · no "requires the … module" wording, so no far end`));
    un.append(li);
  }
  paintWorkCount();
}
function refreshVaccineCells() { for (const w of D.wires) { const r = rowById.get(w.id); if (r) r.vac.textContent = vaccineText(w); } }
function paintWorkCount() {
  if (!RT.hidden.loaded) return;
  const n = D.wires.filter(wireShown).length;
  $('worktitle').textContent = (S.filter === 'all' ? 'hidden wires' : 'hidden, not yet declared') + ` · ${n}`;
}
function focusWire(w) {
  const [a0, b0, a1, b1] = w.bbox;
  S.view.x = (a0 + a1) / 2; S.view.y = (b0 + b1) / 2;
  S.view.k = clampK(Math.min(W_CSS / ((a1 - a0) * 1.6 + 1), H_CSS / ((b1 - b0) * 1.6 + 1)));
  canvas.scrollIntoView({ block: 'nearest' });
  schedule();
}

/* ── computed prose ─────────────────────────────────────────────────────── */
function paintSummary() {
  const c = D.chem;
  const s = $('summary');
  s.textContent = '';
  const top = c.wires.map(w => `"${w.failing} requires ${w.needed}" on ${fmt(w.compositions)}`).join(', then ');
  s.append(el('b', null, `${fmt(c.failed)} of ${fmt(c.total)} compositions failed`),
    ` (star-maker chemistry, generated ${c.generated_utc}). ${c.messages.length} distinct failure messages; ${c.wires.length} name the module the failing part needed and are drawn as wires, carried by ${fmt(c.withWire)} of the failed compositions (one composition can carry several messages). By compositions: ${top || 'none'}.`);
  $('prov').textContent = `Sources: star-maker chemistry/compounds.json, chemistry/graph.json and CHEMISTRY.md at commit ${STAR_MAKER_COMMIT} (raw.githubusercontent.com); block register ${URL_REGISTER} as served now (generated ${D.idx.generated_utc}); cvaa vaccine names from the GitHub contents API as served now.`;
}

function paintQuestions() {
  if (!D.idx) return;
  const host = D.wires[0] ? D.idx.byTitle.get(D.wires[0].reporter) : null;
  $('q-host').textContent = host ? `${host.symbol}, number ${host.number}` : 'not found by exact title';
  $('q-used').textContent = host ? String((host.used_by || []).length) : 'not known';
  const sup = D.wires.flatMap(w => w.unplug.suppliers.map(s => `unplugging ${s.symbol} (${D.legend[s.symbol]}) exposed "${w.failing} requires ${w.needed}" in every one of ${s.lacking} unplug compositions that kept ${w.hostSymbol} and lacked it`));
  $('q-supplier').textContent = sup.length ? sup.join('; ') : 'no unplug composition singles out a supplier';
  const undeclared = D.wires.filter(w => w.decl.declared === false).length;
  const vacc = D.vaccines ? D.wires.filter(w => !W.vaccineMentions(D.vaccines, w).length).length : null;
  $('q-work').textContent = `${undeclared} of ${D.wires.length} hidden wires are not declared in the register; ${vacc == null ? 'vaccine names not yet read (tick Vaccine names)' : `${vacc} of ${D.wires.length} are named by no cvaa vaccine file`}`;
  $('machine').textContent = `Machine detail · inputs: compounds[].formula (element symbols with generation stamps), compounds[].kind (live, unplug, version, constellation), compounds[].red and amber (star counts), compounds[].decays[].text and .n (failure message, star count) from compounds.json; the Symbols line of CHEMISTRY.md; DECAYS_TO edges of graph.json; blocks[].title, depends_on[].symbol, needs[].name, used_by of blocks.json; file names in cvaa vaccines/ · outputs: per wire the failing part and needed module (parsed from "<X> requires the <Y> module"), compositions (count of compounds carrying the text), stars (sum of n), per-kind counts, generation range per element, declared (yes, no, or not known), vaccine mention (yes, no, or not known), unplug suppliers; line thickness 2 + 8·sqrt(count/max) px · refusals: a message without that wording draws no wire and is listed; a part with no exact register title sits on the outer ring and its register answers read from the reporting block; a source that fails reads FAIL with its reason and nothing is drawn for it · source: star-maker ${STAR_MAKER_COMMIT}; register generated ${D.idx.generated_utc}.`;
}

try { if (window.matchMedia('(min-width: 900px)').matches) $('questions').open = true; } catch (_) { /* stays collapsed */ }

/* for tests: where things are on screen, and what was drawn */
window.__hw = {
  RT, drawn, fetchLog, queue, get sel() { return S.sel; }, get view() { return { ...S.view }; },
  wires: () => D.wires.map(w => ({ id: w.id, failing: w.failing, needed: w.needed, compositions: w.compositions, declared: w.decl.declared, shown: wireShown(w) })),
  wireScreen(id) {
    const w = D.wires.find(x => x.id === id); if (!w) return null;
    const i = Math.floor(w.pts.length / 4) * 2, r = canvas.getBoundingClientRect();
    return { x: r.left + sx(w.pts[i]), y: r.top + sy(w.pts[i + 1]) };
  },
  panBy(dx, dy) { S.view.x += dx / S.view.k; S.view.y += dy / S.view.k; schedule(); },
  zoomTo(f) { S.view.k = clampK(S.fitK * f); schedule(); }
};
resize();
