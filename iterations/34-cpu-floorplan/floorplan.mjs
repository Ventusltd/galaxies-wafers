/* Logical Floorplan — iteration 34.
 *
 * WHAT THIS IS. A dark die with the blocks of a textbook processor: the classic
 * five-stage RISC pipeline (IF, ID, EX, MEM, WB) with pipeline registers between
 * the stages, a branch predictor, split L1 instruction and data caches, L2, L3,
 * a memory bus and I/O. It is illustrative architecture, not a model of any
 * specific chip. The only size or latency figures are orders of magnitude, and
 * they are labelled so.
 *
 * WHAT FLOWS THROUGH IT. The real engine module voltage-drop.js at the pinned
 * commit, fetched as text (never executed here), cut into tokens by a small
 * tokenizer, one exported function chosen, and its source lines stepped through
 * the pipeline as though each line were one instruction. Five lines are in
 * flight at once, one per stage, as in a real pipeline. Everything shown in a
 * stage is derived from that line's tokens. It is a teaching mapping: a real
 * JavaScript engine compiles to bytecode and JIT machine code first.
 *
 * LOADING, LEARNED FROM GRID ATLAS. One queue (at most three requests at a
 * time) with a 15 s abort timeout and one promise per URL, removed on failure
 * so a retry works. The source (one small file) and the engine layer (one small
 * file) load at start; the numbered database is read only when FIND LINE KEYS
 * is pressed, by byte-range reads, never whole. The die, the blocks and every
 * token are drawn on one canvas: there is no DOM node per token or per line,
 * and the detail panel exists once and is re-filled.
 */

const COMMIT = 'd9cd18b0e2034325814924e6e4a0e958014f2748';
const MODULE = 'engine/voltage-drop.js';
const SRC_URL = `https://cdn.jsdelivr.net/gh/Ventusltd/ventus-grid-engine@${COMMIT}/${MODULE}`;
const ENGINE_LAYER = '../../layers/engine.json';
const LINES_URL = 'https://ventusltd.github.io/stars/LINES.md';
const CARD = '../31-code-card-everywhere/';
const WAFER = '../../';

const CHUNK = 8192;                 /* bytes per binary-search probe */
const WINDOW = 32768;               /* bytes of rows read from the function's first key onward */
const SEARCH_CAP = 64 * 1024 * 1024; /* the binary search assumes the database is under 64 MB; a 416 past the end narrows it */
const QUEUE_MAX = 3;
const TIMEOUT_MS = 15000;

const $ = id => document.getElementById(id);

/* ── network: the Atlas FetchQueue, urlCache, timeout ─────────────────────── */

class FetchQueue {
  constructor(n) { this.n = n; this.active = 0; this.q = []; this.peak = 0; this.count = 0; }
  async add(task) {
    if (this.active >= this.n) await new Promise(r => this.q.push(r));
    this.active++; this.count++; this.peak = Math.max(this.peak, this.active);
    try { return await task(); }
    finally { this.active--; if (this.q.length) this.q.shift()(); }
  }
}
const queue = new FetchQueue(QUEUE_MAX);
const urlCache = new Map();

function fetchTimed(url, init = {}) {
  return queue.add(async () => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try { return await fetch(url, { ...init, signal: ac.signal }).then(async r => ({ r, ac })); }
    finally { clearTimeout(t); }
  });
}
function fetchText(url) {
  if (urlCache.has(url)) return urlCache.get(url);
  const p = fetchTimed(url, { cache: 'default' }).then(async ({ r }) => {
    if (!r.ok) throw new Error(`${url} returned HTTP ${r.status}`);
    return r.text();
  }).catch(e => { urlCache.delete(url); throw e; });
  urlCache.set(url, p);
  return p;
}
/* One byte range. Returns {bytes} or {past:true} for 416. A server that ignores
   the range (200) is aborted at once rather than downloading the whole file. */
async function fetchRange(start, len) {
  const { r, ac } = await fetchTimed(LINES_URL, { headers: { Range: `bytes=${start}-${start + len - 1}` }, cache: 'default' });
  if (r.status === 416) return { past: true };
  if (r.status === 200) { ac.abort(); throw new Error('the server ignored the byte range; refusing to download the whole database'); }
  if (r.status !== 206) throw new Error(`byte range read returned HTTP ${r.status}`);
  return { bytes: new Uint8Array(await r.arrayBuffer()) };
}

/* ── tokenizer ───────────────────────────────────────────────────────────── */

const KEYWORDS = new Set(('break case catch class const continue debugger default delete do else export extends '
  + 'finally for function if import in instanceof let new return super switch this throw try typeof var void '
  + 'while with yield async await of null true false undefined').split(' '));
const OPS = ['>>>=', '===', '!==', '**=', '...', '>>>', '<<=', '>>=', '&&=', '||=', '??=', '=>', '==', '!=', '<=', '>=',
  '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '**', '<<', '>>', '&=', '|=', '^=',
  '+', '-', '*', '/', '%', '<', '>', '=', '!', '&', '|', '^', '~', '?', ':'];
const PUNC = new Set(['(', ')', '{', '}', '[', ']', ',', ';', '.']);

/* Tokens: {c: class, v: text, line: 0-based line}. A token spanning lines
   (a template literal or block comment) is emitted once per physical line. */
function tokenize(src) {
  const out = [];
  let i = 0, line = 0;
  const push = (c, start, end) => {
    const parts = src.slice(start, end).split('\n');
    parts.forEach((p, k) => { if (p.length) out.push({ c, v: p, line: line + k }); });
    line += parts.length - 1;
  };
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\n') { line++; i++; continue; }
    if (ch === ' ' || ch === '\t' || ch === '\r') { i++; continue; }
    if (ch === '/' && src[i + 1] === '/') { let j = src.indexOf('\n', i); if (j < 0) j = src.length; push('com', i, j); i = j; continue; }
    if (ch === '/' && src[i + 1] === '*') { let j = src.indexOf('*/', i + 2); j = j < 0 ? src.length : j + 2; push('com', i, j); i = j; continue; }
    if (ch === '"' || ch === "'") {
      let j = i + 1; while (j < src.length && src[j] !== ch && src[j] !== '\n') { if (src[j] === '\\') j++; j++; }
      push('str', i, j + 1); i = j + 1; continue;
    }
    if (ch === '`') {
      /* The simple tokenizer keeps a template literal as one string, ${...} included. */
      let j = i + 1, depth = 0;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (depth === 0 && src[j] === '`') break;
        if (src[j] === '$' && src[j + 1] === '{') { depth++; j += 2; continue; }
        if (depth > 0 && src[j] === '}') depth--;
        j++;
      }
      push('str', i, j + 1); i = j + 1; continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = /^(0[xX][0-9a-fA-F_]+|(\d[\d_]*)?\.?\d*([eE][+-]?\d+)?n?)/.exec(src.slice(i, i + 40));
      const n = Math.max(1, m[0].length); push('num', i, i + n); i += n; continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i + 1; while (j < src.length && /[\w$]/.test(src[j])) j++;
      push(KEYWORDS.has(src.slice(i, j)) ? 'kw' : 'id', i, j); i = j; continue;
    }
    const op = OPS.find(o => src.startsWith(o, i));
    if (op) { push('op', i, i + op.length); i += op.length; continue; }
    if (PUNC.has(ch)) { push('punc', i, i + 1); i++; continue; }
    push('other', i, i + 1); i++;
  }
  return out;
}

/* Exported functions: `export function NAME (` ... matching `{` ... `}`. */
function exportedFunctions(tokens) {
  const fns = [];
  for (let k = 0; k + 2 < tokens.length; k++) {
    if (!(tokens[k].v === 'export' && tokens[k + 1].v === 'function' && tokens[k + 2].c === 'id')) continue;
    let j = k + 3, paren = 0;
    for (; j < tokens.length; j++) {
      const v = tokens[j].v;
      if (tokens[j].c !== 'punc') continue;
      if (v === '(') paren++;
      else if (v === ')') { paren--; if (paren === 0) break; }
    }
    const params = tokens.slice(k + 3, j + 1);
    while (j < tokens.length && tokens[j].v !== '{') j++;
    let depth = 0, end = j;
    for (; end < tokens.length; end++) {
      if (tokens[end].c !== 'punc') continue;
      if (tokens[end].v === '{') depth++;
      else if (tokens[end].v === '}') { depth--; if (depth === 0) break; }
    }
    fns.push({ name: tokens[k + 2].v, startLine: tokens[k].line, endLine: tokens[end].line, params, body: tokens.slice(j, end + 1) });
  }
  return fns;
}

/* ── the teaching mapping: one line's tokens, per stage ──────────────────── */

const ALU = { '+': 'ADD', '-': 'SUB', '*': 'MUL', '/': 'DIV', '%': 'REM', '**': 'POW', '<<': 'SHL', '>>': 'SHR', '>>>': 'SHRU', '&': 'AND', '|': 'OR', '^': 'XOR' };
const BRANCH = new Set(['===', '!==', '==', '!=', '<', '<=', '>', '>=', '&&', '||', '??', '?']);
const BRANCH_KW = new Set(['if', 'else', 'for', 'while', 'switch', 'case', 'do']);
const ASSIGN = new Set(['=', '+=', '-=', '*=', '/=', '%=', '**=']);

function analyse(toks) {
  const code = toks.filter(t => t.c !== 'com');
  const counts = {};
  for (const t of code) counts[t.c] = (counts[t.c] || 0) + 1;
  const alu = [], branches = [], calls = [], reads = [], writes = [], wb = [];
  const decl = new Set(['const', 'let', 'var']);
  let ternary = 0;
  code.forEach((t, k) => {
    const prev = code[k - 1], next = code[k + 1];
    if (t.c === 'op') {
      if (t.v === '?') ternary++;
      if (ALU[t.v]) {
        const strSide = (prev && prev.c === 'str') || (next && next.c === 'str');
        alu.push(`${ALU[t.v]} (${t.v})${t.v === '+' && strSide ? ' next to a string: string concatenation at run time; the tokenizer cannot know types' : ''}`);
      }
      if (BRANCH.has(t.v)) branches.push(t.v === '?' ? 'conditional ? (branch)' : `compare ${t.v} (branch)`);
      if (ASSIGN.has(t.v) && prev && prev.c === 'id') wb.push(`${prev.v} <- result of the right-hand side`);
      if (t.v === ':' && prev && prev.c === 'id' && ternary === 0) wb.push(`field ${prev.v} <- value (object literal)`);
      if (t.v === ':' && ternary > 0) ternary--;
    }
    if (t.c === 'kw' && BRANCH_KW.has(t.v)) branches.push(`${t.v} (branch)`);
    if (t.c === 'kw' && t.v === 'return') wb.push('return value -> caller');
    if (t.c === 'kw' && t.v === 'throw') branches.push('throw (exception: control leaves the function)');
    if (t.c !== 'id') return;
    const member = prev && (prev.v === '.' || prev.v === '?.');
    if (next && next.v === '(') { calls.push(`CALL ${member ? '.' : ''}${t.v}`); return; }
    if (prev && prev.c === 'kw' && decl.has(prev.v)) { writes.push(`STORE ${t.v} (new binding)`); return; }
    if (next && ASSIGN.has(next.v)) { writes.push(`STORE ${t.v}`); return; }
    if (next && next.v === ':' && ternary === 0) { writes.push(`STORE field ${t.v}`); return; }
    reads.push(member ? `LOAD field .${t.v}` : `LOAD ${t.v}`);
  });
  if (code.some(t => t.c === 'kw' && decl.has(t.v)) && !wb.length) {
    const k = code.findIndex(t => decl.has(t.v)); if (code[k + 1]) wb.push(`${code[k + 1].v} <- bound`);
  }
  return { code, counts, alu, branches, calls, reads, writes, wb };
}

/* ── state ───────────────────────────────────────────────────────────────── */

const S = {
  src: null, srcLines: null, tokens: null, fns: [], fn: null,
  steps: [],              /* [{lineNo, text, toks, a}] one per non-empty, non-comment source line */
  cycle: 0,               /* instruction k is in stage s when cycle - k === s */
  anim: 0,                /* 0..1 transition progress */
  playing: false, speed: 1, last: 0,
  selected: 'IF',
  layerKeys: null,        /* function name -> first key, from ../../layers/engine.json (block Vd) */
  keys: new Map(),        /* line text -> key, from the rows read */
  keyState: 'WAIT', keyWhy: '', rowsRead: 0, keyRange: null, dbHeader: '',
  redraws: 0
};
const STAGES = ['IF', 'ID', 'EX', 'MEM', 'WB'];
const STAGE_NAME = { IF: 'Fetch', ID: 'Decode', EX: 'Execute', MEM: 'Memory', WB: 'Write-back' };
const SPEEDS = [0.25, 0.5, 1, 2, 4];
const BASE_MS = 1100;

/* ── canvas layout (die units: 0..1 across, 0..H_RATIO down) ─────────────── */

const cv = $('die');
const ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;
const H_RATIO = 1.28;
const B = {};  /* block rects in die units */
function layout() {
  const x0 = 0.06, x1 = 0.94;
  B.L1i = { x: x0, y: 0.13, w: 0.16, h: 0.17, label: 'L1i' };
  B.BP = { x: 0.26, y: 0.13, w: 0.30, h: 0.17, label: 'Branch predictor' };
  B.L1d = { x: 0.60, y: 0.13, w: 0.16, h: 0.17, label: 'L1d' };
  const sy = 0.38, sh = 0.26, reg = 0.022, gap = 0.012;
  const sw = (x1 - x0 - 4 * (reg + 2 * gap)) / 5;
  let x = x0;
  STAGES.forEach((s, i) => {
    B[s] = { x, y: sy, w: sw, h: sh, label: s, stage: i };
    x += sw;
    if (i < 4) { B['R' + i] = { x: x + gap, y: sy - 0.02, w: reg, h: sh + 0.04, label: `${s}/${STAGES[i + 1]}`, reg: i }; x += reg + 2 * gap; }
  });
  B.TOK = { x: x0, y: 0.69, w: x1 - x0, h: 0.13 };
  B.L2 = { x: x0, y: 0.86, w: 0.32, h: 0.17, label: 'L2 cache' };
  B.L3 = { x: 0.42, y: 0.86, w: 0.52, h: 0.25, label: 'L3 cache (shared)' };
  B.IO = { x: x0, y: 1.06, w: 0.32, h: 0.05, label: 'I/O' };
  B.BUS = { x: x0, y: 1.155, w: x1 - x0, h: 0.035, label: 'memory bus -> DRAM, off-die' };
}
layout();

function resize() {
  const cssW = Math.max(280, Math.min(cv.parentElement.clientWidth, 760));
  DPR = Math.min(window.devicePixelRatio || 1, 3);
  W = cssW; H = Math.round(cssW * H_RATIO);
  cv.style.height = H + 'px';
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  draw();
}

const px = r => ({ x: r.x * W, y: r.y * W, w: r.w * W, h: r.h * W });
const COL = { kw: '#5ec8f2', id: '#d8dee9', num: '#ffd54a', op: '#ff9e64', str: '#8b93a7', punc: '#6b7386', com: '#4b5263', other: '#8b93a7' };

function inFlight(stageIndex) {
  const k = S.cycle - stageIndex;
  return k >= 0 && k < S.steps.length ? S.steps[k] : null;
}
function stepIndex(stageIndex) { return S.cycle - stageIndex; }
function predictorLit() {
  const d = inFlight(1), e = inFlight(2);
  return !!((d && d.a.branches.length) || (e && e.a.branches.length));
}

function rrect(r, fill, stroke, lw = 1) {
  const p = px(r);
  ctx.beginPath(); ctx.rect(p.x, p.y, p.w, p.h);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
  return p;
}
function text(s, x, y, size, color, align = 'left', weight = '') {
  ctx.font = `${weight} ${size}px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace`;
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'top';
  ctx.fillText(s, x, y);
}
function clip(s, maxW, size) {
  ctx.font = `${size}px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace`;
  if (ctx.measureText(s).width <= maxW) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ctx.measureText(s.slice(0, m) + '…').width <= maxW) lo = m; else hi = m - 1; }
  return s.slice(0, lo) + '…';
}
function wire(a, b, lit) {
  const pa = px(a), pb = px(b);
  ctx.beginPath();
  ctx.moveTo(pa.x + pa.w / 2, pa.y + pa.h); ctx.lineTo(pb.x + pb.w / 2, pb.y);
  ctx.strokeStyle = lit ? '#ffd54a' : '#2a3348'; ctx.lineWidth = lit ? 1.6 : 1; ctx.stroke();
}

function draw() {
  S.redraws++;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#0b0d12'; ctx.fillRect(0, 0, W, H);
  const fs = Math.max(9, Math.round(W / 38)), fsS = Math.max(8, Math.round(W / 46));

  /* die and pad ring */
  const die = { x: 0.02, y: 0.02, w: 0.96, h: H_RATIO - 0.04 };
  rrect(die, '#0f131c', '#3a4560', 1.5);
  ctx.fillStyle = '#232a3b';
  const pads = 22, pd = die.w / pads;
  for (let i = 0; i < pads; i++) {
    for (const yy of [die.y + 0.006, die.y + die.h - 0.018]) ctx.fillRect((die.x + i * pd + pd * 0.25) * W, yy * W, pd * 0.5 * W, 0.012 * W);
  }
  text('ILLUSTRATIVE ARCHITECTURE, NOT A MODEL OF ANY SPECIFIC CHIP', 0.06 * W, 0.045 * W, fsS, '#ffd54a');
  text(S.fn ? `${MODULE} · ${S.fn.name}() · ${S.steps.length} lines` : 'waiting for source', 0.06 * W, 0.075 * W, fsS, '#8b93a7');

  const lit = {
    IF: !!inFlight(0), L1i: !!inFlight(0), BP: predictorLit(),
    L1d: !!(inFlight(3) && (inFlight(3).a.reads.length || inFlight(3).a.writes.length))
  };
  wire(B.L1i, B.IF, lit.L1i);
  wire(B.BP, B.IF, lit.BP);
  wire(B.L1d, B.MEM, lit.L1d);
  /* EX reports the branch outcome back to the predictor */
  { const pe = px(B.EX), pb = px(B.BP); ctx.beginPath(); ctx.moveTo(pe.x + pe.w / 2, pe.y); ctx.lineTo(pb.x + pb.w * 0.8, pb.y + pb.h);
    ctx.strokeStyle = lit.BP ? '#ffd54a' : '#2a3348'; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]); }

  /* caches, predictor, L2, L3, IO, bus */
  const side = (key, sub) => {
    const r = B[key], on = !!lit[key], sel = S.selected === key;
    const p = rrect(r, on ? '#1d2230' : '#131825', sel ? '#5ec8f2' : (on ? '#ffd54a' : '#2a3348'), sel ? 2 : 1);
    text(clip(r.label, p.w - 8, fs), p.x + 5, p.y + 4, fs, on ? '#ffd54a' : '#d8dee9');
    sub.forEach((s, i) => text(clip(s, p.w - 8, fsS), p.x + 5, p.y + 6 + fs + i * (fsS + 3), fsS, '#8b93a7'));
  };
  side('L1i', ['instruction', '~tens of KB', '~1 ns']);
  side('BP', [lit.BP ? 'lit: a branch in ID/EX' : 'idle: no branch in ID/EX', 'predicts next PC']);
  side('L1d', ['data', '~tens of KB', '~1 ns']);
  side('L2', ['~hundreds of KB', 'to MB · ~few ns']);
  side('L3', ['~MB to tens of MB', '~10 ns', 'shared by cores']);
  side('IO', []);
  side('BUS', []);
  text('sizes and latencies: typical order of magnitude, illustrative', 0.06 * W, 1.115 * W, fsS, '#6b7386');
  { const a = px(B.L2), b = px(B.L3); ctx.beginPath(); ctx.moveTo(a.x + a.w, a.y + a.h / 2); ctx.lineTo(b.x, a.y + a.h / 2); ctx.strokeStyle = '#2a3348'; ctx.lineWidth = 1; ctx.stroke(); }

  /* pipeline registers */
  for (let i = 0; i < 4; i++) {
    const r = B['R' + i], p = rrect(r, '#1a2030', '#3a4560');
    ctx.save(); ctx.translate(p.x + p.w / 2, p.y + p.h + 3); text(r.label, 0, 0, fsS - 1, '#6b7386', 'center'); ctx.restore();
  }
  text('pipeline registers hold each stage\'s result between clock edges', 0.06 * W, 0.335 * W, fsS, '#6b7386');

  /* stages */
  STAGES.forEach((s, i) => {
    const r = B[s], step = inFlight(i), sel = S.selected === s;
    const p = rrect(r, step ? '#182033' : '#10141d', sel ? '#5ec8f2' : (step ? '#ffd54a' : '#2a3348'), sel ? 2.2 : 1.2);
    text(s, p.x + 4, p.y + 4, fs + 1, step ? '#ffd54a' : '#d8dee9', 'left', 'bold');
    text(clip(STAGE_NAME[s], p.w - 8, fsS), p.x + 4, p.y + 6 + fs, fsS, '#8b93a7');
    if (!step) { text('bubble', p.x + 4, p.y + p.h - fsS - 5, fsS, '#4b5263'); return; }
    text(`line ${step.lineNo}`, p.x + 4, p.y + 10 + fs + fsS, fsS, '#5ec8f2');
    const a = step.a;
    const facts = {
      IF: [`${step.text.trim().length} chars`],
      ID: Object.entries(a.counts).filter(([c]) => c !== 'punc').map(([c, n]) => `${n} ${c}`),
      EX: [...a.alu.map(x => x.split(' ')[0]), ...a.branches.map(() => 'BR'), ...a.calls.map(() => 'CALL')],
      MEM: [`${a.reads.length} LOAD`, `${a.writes.length} STORE`],
      WB: a.wb.length ? a.wb.map(x => x.split(' ')[0]) : ['none']
    }[s];
    facts.slice(0, 5).forEach((f, k) => text(clip(f, p.w - 8, fsS), p.x + 4, p.y + 14 + fs + fsS * 2 + k * (fsS + 2), fsS, '#d8dee9'));
    if (facts.length > 5) text(`+${facts.length - 5}`, p.x + 4, p.y + 14 + fs + fsS * 2 + 5 * (fsS + 2), fsS, '#8b93a7');
  });

  /* moving packets during a clock transition: each in-flight line crosses its register */
  if (S.anim > 0 && S.anim < 1) {
    for (let i = 1; i < 5; i++) {
      if (!inFlight(i)) continue;
      const a = px(B[STAGES[i - 1]]), b = px(B[STAGES[i]]);
      const x = a.x + a.w * 0.5 + (b.x - a.x) * S.anim, y = a.y + a.h * 0.55;
      ctx.beginPath(); ctx.arc(x, y, Math.max(3, W / 110), 0, Math.PI * 2);
      ctx.fillStyle = '#ffd54a'; ctx.shadowColor = '#ffd54a'; ctx.shadowBlur = 8; ctx.fill(); ctx.shadowBlur = 0;
    }
  }

  /* token strip: the selected stage's line, every token coloured by class, drawn on canvas */
  const tp = rrect(B.TOK, '#0c1018', '#2a3348');
  const selStage = STAGES.indexOf(S.selected);
  const shown = inFlight(selStage >= 0 ? selStage : 0);
  text(shown ? `tokens of line ${shown.lineNo}, in ${selStage >= 0 ? S.selected : 'IF'}` : 'tokens: stage empty', tp.x + 5, tp.y + 4, fsS, '#8b93a7');
  if (shown) {
    let x = tp.x + 5, y = tp.y + 8 + fsS; const lh = fs + 4, maxX = tp.x + tp.w - 5;
    ctx.font = `${fs}px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace`;
    const handled = handledSet(selStage >= 0 ? S.selected : 'IF', shown);
    for (const t of shown.a.code) {
      const s = t.v.length > 40 ? t.v.slice(0, 39) + '…' : t.v;
      const w = ctx.measureText(s).width;
      if (x + w > maxX) { x = tp.x + 5; y += lh; }
      if (y + lh > tp.y + tp.h) break;
      const on = handled(t);
      if (on) { ctx.fillStyle = '#22304a'; ctx.fillRect(x - 1, y - 1, w + 2, lh - 2); }
      text(s, x, y, fs, on ? COL[t.c] : '#3a4152');
      x += w + ctx.measureText(' ').width;
    }
  }
}

/* Which tokens a stage handles, for highlighting in the strip. */
function handledSet(stage, step) {
  const a = step.a;
  if (stage === 'IF' || stage === 'ID') return () => true;
  if (stage === 'EX') return t => (t.c === 'op' && (ALU[t.v] || BRANCH.has(t.v))) || (t.c === 'kw' && (BRANCH_KW.has(t.v) || t.v === 'throw'))
    || (t.c === 'id' && a.calls.some(c => c.endsWith(t.v) && nextIsParen(step, t)));
  if (stage === 'MEM') return t => t.c === 'id' && !nextIsParen(step, t);
  if (stage === 'WB') return t => (t.c === 'kw' && (t.v === 'return' || t.v === 'const' || t.v === 'let')) || (t.c === 'op' && (ASSIGN.has(t.v) || t.v === ':'));
  return () => false;
}
function nextIsParen(step, t) { const c = step.a.code, k = c.indexOf(t); return c[k + 1] && c[k + 1].v === '('; }

/* ── the detail panel: one set of nodes, re-filled ───────────────────────── */

function paintDetail() {
  const key = S.selected;
  const si = STAGES.indexOf(key);
  $('dcycle').textContent = S.steps.length ? `clock cycle ${S.cycle + 1} of ${S.steps.length + 4}` : '';
  let title = '', body = '', step = null;
  if (si >= 0) {
    step = inFlight(si);
    title = `${key} · ${STAGE_NAME[key]}`;
    if (!step) body = `Empty (a bubble): ${stepIndex(si) < 0 ? 'no line has reached this stage yet' : 'every line has already left this stage'}.`;
    else {
      const a = step.a;
      const L = [`line ${step.lineNo} of ${MODULE}`, step.text.trim(), ''];
      if (key === 'IF') L.push('Fetch: the program counter addresses this line; its text is read from the L1 instruction cache.', `${step.text.trim().length} characters, ${a.code.length} tokens.`);
      if (key === 'ID') {
        L.push('Decode: tokens classified by the tokenizer.');
        for (const c of ['kw', 'id', 'num', 'op', 'str', 'punc']) {
          const v = a.code.filter(t => t.c === c).map(t => t.v.length > 48 ? t.v.slice(0, 47) + '…' : t.v);
          if (v.length) L.push(`${{ kw: 'keywords', id: 'identifiers', num: 'numbers', op: 'operators', str: 'strings', punc: 'punctuation' }[c]} (${v.length}): ${v.join('  ')}`);
        }
      }
      if (key === 'EX') {
        L.push('Execute: arithmetic operators as ALU operations, comparisons as branches, calls as control transfers.');
        L.push(a.alu.length ? `ALU: ${a.alu.join('; ')}` : 'ALU: no arithmetic operator on this line.');
        L.push(a.branches.length ? `branch: ${a.branches.join('; ')} — the branch predictor is lit.` : 'branch: none; the predictor stays idle for this line.');
        L.push(a.calls.length ? `calls: ${a.calls.join('; ')}` : 'calls: none.');
      }
      if (key === 'MEM') {
        L.push('Memory: identifier reads (LOAD) and writes (STORE), served by the L1 data cache in this mapping.');
        L.push(a.reads.length ? a.reads.join('; ') : 'no reads.');
        L.push(a.writes.length ? a.writes.join('; ') : 'no writes.');
      }
      if (key === 'WB') {
        L.push('Write-back: where a result is committed.');
        L.push(a.wb.length ? a.wb.join('; ') : 'nothing is written back by this line (it passes through).');
      }
      body = L.join('\n');
    }
  } else {
    step = inFlight(0);
    const txt = {
      BP: `Branch predictor. Guesses the next program counter before a branch is resolved so fetch need not wait. In this mapping it lights while a line in ID or EX carries a comparison, conditional or branch keyword (now: ${predictorLit() ? 'lit' : 'idle'}). Mispredict flushes are not modelled.`,
      L1i: 'L1 instruction cache: the smallest, fastest store, next to fetch. Typical order of magnitude, illustrative: tens of KB, about a nanosecond.',
      L1d: 'L1 data cache: serves the memory stage\'s loads and stores. Typical order of magnitude, illustrative: tens of KB, about a nanosecond.',
      L2: 'L2 cache: larger and slower than L1. Typical order of magnitude, illustrative: hundreds of KB to MB, a few nanoseconds. Not animated: this page cannot know what a real run would miss.',
      L3: 'L3 cache: larger again, shared between cores. Typical order of magnitude, illustrative: MB to tens of MB, around ten nanoseconds. Not animated.',
      IO: 'I/O: controllers for devices outside the memory hierarchy. The module text itself arrived through the network, which is I/O.',
      BUS: 'Memory bus to DRAM, off the die. Typical order of magnitude, illustrative: GB of capacity, around a hundred nanoseconds per access.'
    }[key] || '';
    title = B[key] ? B[key].label : key; body = txt;
  }
  $('dtitle').textContent = title;
  $('dbody').textContent = body;
  paintKey(step);
}

function paintKey(step) {
  const card = $('lcard'), waf = $('lwafer');
  if (!step) { $('dkey').textContent = ''; card.hidden = waf.hidden = true; return; }
  if (S.keyState !== 'OK') {
    $('dkey').textContent = `line key: ${S.keyState}${S.keyWhy ? ' — ' + S.keyWhy : ' — press FIND LINE KEYS'}`;
    card.hidden = waf.hidden = true; return;
  }
  const k = S.keys.get(step.text);
  if (k === undefined) {
    $('dkey').textContent = `line key: EMPTY — not in the numbered database rows read (keys ${S.keyRange[0]} to ${S.keyRange[1]}, ${S.rowsRead} rows). This exact text may carry a key elsewhere; the page does not scan the whole database.`;
    card.hidden = waf.hidden = true; return;
  }
  $('dkey').textContent = `line key ${k} · numbered database`;
  card.href = `${CARD}?line=${k}`; waf.href = `${WAFER}?line=${k}`;
  card.hidden = waf.hidden = false;
}

/* ── the clock ───────────────────────────────────────────────────────────── */

const maxCycle = () => S.steps.length + 4;
function tick() {
  if (S.cycle >= maxCycle() - 1) { S.playing = false; $('play').textContent = 'PLAY'; return false; }
  S.cycle++; S.anim = 0.0001; paintDetail(); return true;
}
function frame(t) {
  if (!S.playing && !(S.anim > 0 && S.anim < 1)) { S.raf = 0; return; }
  const dt = S.last ? t - S.last : 16; S.last = t;
  if (S.anim > 0 && S.anim < 1) { S.anim = Math.min(1, S.anim + dt / (BASE_MS * 0.45 / S.speed)); if (S.anim >= 1) S.anim = 0; }
  else if (S.playing) { S.wait = (S.wait || 0) + dt; if (S.wait >= BASE_MS / S.speed) { S.wait = 0; tick(); } }
  draw();
  S.raf = requestAnimationFrame(frame);
}
function kick() { if (!S.raf) { S.last = 0; S.raf = requestAnimationFrame(frame); } }

/* ── wiring ──────────────────────────────────────────────────────────────── */

function chooseFunction(name) {
  S.fn = S.fns.find(f => f.name === name);
  const byLine = new Map();
  for (const t of S.tokens) if (t.line >= S.fn.startLine && t.line <= S.fn.endLine) { if (!byLine.has(t.line)) byLine.set(t.line, []); byLine.get(t.line).push(t); }
  S.steps = [];
  for (let ln = S.fn.startLine; ln <= S.fn.endLine; ln++) {
    const toks = byLine.get(ln) || [];
    if (!toks.some(t => t.c !== 'com')) continue;
    S.steps.push({ lineNo: ln + 1, text: S.srcLines[ln], toks, a: analyse(toks) });
  }
  S.cycle = 0; S.anim = 0; S.playing = false; $('play').textContent = 'PLAY';
  paintDetail(); paintQuestions(); draw();
}

function paintQuestions() {
  const f = S.fn; if (!f) return;
  const names = S.fns.map(x => x.name);
  const paramIds = f.params.filter((t, k) => t.c === 'id' && !(f.params[k - 1] && f.params[k - 1].v === '=')).map(t => t.v);
  const units = f.body.filter((t, k) => t.c === 'id' && t.v === 'unit' && f.body[k + 1] && f.body[k + 1].v === ':').map((t, k2) => {
    const k = f.body.indexOf(t, 0); return f.body[k + 2] ? f.body[k + 2].v : '';
  });
  const quantity = (() => { const k = f.body.findIndex((t, i) => t.v === 'quantity' && f.body[i + 1] && f.body[i + 1].v === ':'); return k >= 0 ? f.body[k + 2].v : 'not stated'; })();
  const retFields = [];
  { let depth = 0, inRet = false;
    for (let k = 0; k < f.body.length; k++) {
      const t = f.body[k];
      if (t.v === 'return') { inRet = true; depth = 0; continue; }
      if (!inRet) continue;
      if (t.v === '{') depth++;
      else if (t.v === '}') { depth--; if (depth === 0) inRet = false; }
      else if (depth === 1 && t.c === 'id' && f.body[k + 1] && (f.body[k + 1].v === ':' || f.body[k + 1].v === ',') && f.body[k - 1] && (f.body[k - 1].v === '{' || f.body[k - 1].v === ',')) retFields.push(t.v);
    }
  }
  const guards = f.body.filter((t, k) => t.c === 'id' && f.body[k + 1] && f.body[k + 1].v === '(' && ['positive', 'nonNegative', 'ratio', 'phasesOf'].includes(t.v)).map(t => t.v);
  const notComputed = (() => {
    const k = S.tokens.findIndex((t, i) => t.v === 'NOT_COMPUTED' && S.tokens[i - 1] && S.tokens[i - 1].v === 'const');
    if (k < 0) return [];
    const out = []; let depth = 0;
    for (let j = k; j < S.tokens.length; j++) {
      const t = S.tokens[j]; if (t.v === '{') depth++; else if (t.v === '}') { depth--; if (depth === 0) break; }
      else if (depth === 1 && t.c === 'id' && S.tokens[j + 1] && S.tokens[j + 1].v === ':') out.push(t.v);
    }
    return out;
  })();
  const lineKey = S.layerKeys && S.layerKeys.get(f.name);

  $('q1').textContent = `None: this page draws no electrical element. It explains how the computation that feeds a drawing runs. `
    + `${f.name}() in ${MODULE} returns ${retFields.join(', ') || 'no named fields'} (quantity ${quantity}); on a single-line diagram those numbers belong on a cable route or feeder label, drawn by a different page.`;
  $('q2').textContent = `Module ${MODULE} at commit ${COMMIT.slice(0, 7)} (block Vd "Voltage drop" in the engine layer, ${S.layerKeys ? S.layerKeys.size + ' of its functions placed on the wafer' : 'layer not loaded'}). `
    + `Exported functions found by the tokenizer: ${names.join(', ')}. Within the engine at that commit it is imported by proofs/voltage-drop.proof.mjs and, for PHASE_FACTOR, by proofs/current-from-power.proof.mjs (read from the source); current-from-power.js states in its header that it exists to supply voltage-drop.js its currentA.`;
  /* A function g leads to h when the last two words of g's returned quantity
     (plural s stripped) are all words of one of h's parameter names. */
  const words = x => x.replace(/['"]/g, '').split(/_|(?=[A-Z])/).map(w => w.toLowerCase().replace(/es$/, '').replace(/s$/, '')).filter(Boolean);
  const quantityOf = g => { const k = g.body.findIndex((t, i) => t.v === 'quantity' && g.body[i + 1] && g.body[i + 1].v === ':'); return k >= 0 ? g.body[k + 2].v : ''; };
  const chain = [];
  for (const g of S.fns) {
    const q = words(quantityOf(g)).slice(-2); if (q.length < 2) continue;
    for (const h of S.fns) {
      if (g === h) continue;
      const hit = h.params.filter(t => t.c === 'id').map(t => t.v).find(p => { const pw = words(p); return q.every(w => pw.includes(w)); });
      if (hit) chain.push(`${g.name} -> ${h.name} (its ${quantityOf(g)} fits parameter ${hit})`);
    }
  }
  $('q3').textContent = `Name-match inference from parameter names: ${chain.length ? chain.join('; ') : 'not established'}. `
    + `Upstream, current-from-power.js currentA() supplies the currentA this module requires (stated in that module's header). The next element in a drawn system, a cable route between two busbars, is not established on this page.`;
  $('q4').textContent = `inputs of ${f.name}(): ${paramIds.join(', ')} (units read from the names: A amperes, M metres, OhmPerKm ohms per kilometre, a power factor as a fraction in (0, 1], phases "three" or "single"). `
    + `outputs: ${retFields.join(', ')}; unit ${units.join(', ') || 'not stated'}. refusals: ${guards.length ? [...new Set(guards)].map(g => `${g} x${guards.filter(x => x === g).length}`).join(', ') + ' throw TypeError or RangeError on a bad input' : 'none on this function'}; NOT_COMPUTED lists ${notComputed.join(', ')}. `
    + `source ${SRC_URL.replace('https://', '')}; ${S.steps.length} non-comment lines walked, ${S.tokens.length} tokens in the module. `
    + `first key ${lineKey ?? 'EMPTY (not in the engine layer)'} from layers/engine.json.`;
}

async function loadSource() {
  $('srcstate').textContent = 'LOAD';
  try {
    const [src, layer] = await Promise.all([
      fetchText(SRC_URL),
      fetchText(ENGINE_LAYER).then(t => JSON.parse(t)).catch(e => ({ error: e }))
    ]);
    S.src = src.replace(/\r\n?/g, '\n');
    S.srcLines = S.src.split('\n');
    S.tokens = tokenize(S.src);
    S.fns = exportedFunctions(S.tokens);
    if (!layer.error && Array.isArray(layer.features)) {
      S.layerKeys = new Map();
      for (const ft of layer.features) if (ft.properties && ft.properties.block === 'Vd') S.layerKeys.set(ft.properties.function, ft.geometry.key);
    }
    $('srcstate').textContent = `OK · ${S.srcLines.length} lines · ${S.tokens.length} tokens · ${S.fns.length} exported functions`;
    $('srcline').textContent = `${MODULE} @ ${COMMIT.slice(0, 7)} via jsDelivr, read as text, never executed`;
    if (!S.fns.length) { $('srcstate').textContent = 'EMPTY · the tokenizer found no exported function'; return; }
    const sel = $('fn');
    sel.replaceChildren(...S.fns.map(f => { const o = document.createElement('option'); o.value = o.textContent = f.name; return o; }));
    sel.disabled = false;
    ['step', 'play', 'reset', 'findkeys'].forEach(id => { $(id).disabled = false; });
    chooseFunction(S.fns[0].name);
  } catch (e) {
    $('srcstate').textContent = `FAIL · ${e.name === 'AbortError' ? 'timed out after 15 s' : e.message}`;
  }
}

/* ── line keys: byte-range binary search of the numbered database ────────── */

const dec = new TextDecoder('utf-8');
/* Complete rows inside a chunk: [{key, text, off}] with absolute byte offsets. */
function rowsIn(bytes, base) {
  const rows = [];
  let s = bytes.indexOf(10); if (s < 0) return rows;
  s++;
  while (s < bytes.length) {
    const e = bytes.indexOf(10, s); if (e < 0) break;
    const line = dec.decode(bytes.subarray(s, e));
    const m = /^(\d+)\t(.*)$/s.exec(line);
    if (m) rows.push({ key: +m[1], text: m[2], off: base + s });
    s = e + 1;
  }
  return rows;
}
function setKeyState(state, why = '') { S.keyState = state; S.keyWhy = why; $('keystate').textContent = state + (why ? ' · ' + why : ''); paintDetail(); }

async function findKeys() {
  if (S.keyState === 'LOAD' || S.keyState === 'OK') return;   /* never double-fetch */
  const f = S.fn;
  const target = S.layerKeys && S.layerKeys.get(f.name);
  if (!target) { setKeyState('EMPTY', `${f.name} has no first key in layers/engine.json, so there is nowhere to start reading`); return; }
  setKeyState('LOAD', `searching for key ${target}`);
  try {
    const head = await fetchRange(0, 1024);
    if (head.bytes) { const h = dec.decode(head.bytes).split('\n').find(l => /unique lines/.test(l)); S.dbHeader = h ? h.split('.')[0] : ''; }
    /* Bracket first by interpolation from the key density seen so far, so the
       search rarely reads past the end of a file whose size it cannot see. */
    let lo = 0, hi = null, found = null, probes = 1, o = 1 << 20;
    for (let g = 0; g < 10 && hi === null && !found; g++) {
      const r = await fetchRange(o, CHUNK); probes++;
      if (r.past) { hi = o; break; }
      const rows = rowsIn(r.bytes, o);
      if (!rows.length) { hi = o; break; }
      if (rows[0].key > target) hi = o;
      else if (rows[rows.length - 1].key < target) { lo = o; o = Math.max(o + CHUNK, Math.round(target * (o / rows[0].key) * 1.03)); }
      else found = rows.find(x => x.key >= target);
      $('keystate').textContent = `LOAD · probe ${probes}`;
    }
    if (hi === null) hi = lo + SEARCH_CAP;
    while (hi - lo > CHUNK && !found) {
      const mid = Math.floor((lo + hi) / 2);
      const r = await fetchRange(mid, CHUNK); probes++;
      if (r.past) { hi = mid; continue; }
      const rows = rowsIn(r.bytes, mid);
      if (!rows.length) { hi = mid; continue; }
      if (rows[rows.length - 1].key < target) lo = mid;
      else if (rows[0].key > target) hi = mid;
      else found = rows.find(x => x.key >= target);
      $('keystate').textContent = `LOAD · probe ${probes}`;
    }
    if (!found) { const r = await fetchRange(lo, CHUNK * 2); probes++; if (r.bytes) found = rowsIn(r.bytes, lo).find(x => x.key >= target); }
    if (!found || found.key !== target) { setKeyState('EMPTY', `key ${target} was not found in the database after ${probes} range reads`); return; }
    const w = await fetchRange(found.off - 1, WINDOW); probes++;
    const rows = w.bytes ? rowsIn(w.bytes, found.off - 1) : [];
    for (const row of rows) if (!S.keys.has(row.text)) S.keys.set(row.text, row.key);
    S.rowsRead = rows.length;
    S.keyRange = [rows[0].key, rows[rows.length - 1].key];
    const matched = S.steps.filter(s => S.keys.has(s.text)).length;
    S.keyState = 'OK';
    setKeyState('OK', `${matched} of ${S.steps.length} lines of ${f.name} matched exactly · ${rows.length} rows read (keys ${S.keyRange[0]} to ${S.keyRange[1]}) · ${probes} range reads${S.dbHeader ? ' · database: ' + S.dbHeader : ''}`);
  } catch (e) {
    setKeyState('FAIL', e.name === 'AbortError' ? 'a range read timed out after 15 s' : `${e.message}${/fetch/i.test(e.message) ? ' (a cross-origin byte-range read can be refused by the browser; on the published site the database is same-origin)' : ''}`);
  }
}

$('fn').addEventListener('change', e => {
  chooseFunction(e.target.value);
  if (S.keyState === 'OK' || S.keyState === 'EMPTY') { S.keyState = 'WAIT'; S.keys.clear(); setKeyState('WAIT', 'function changed: press FIND LINE KEYS'); }
});
$('step').addEventListener('click', () => { S.playing = false; $('play').textContent = 'PLAY'; if (tick()) kick(); else draw(); });
$('play').addEventListener('click', () => {
  if (S.cycle >= maxCycle() - 1) { S.cycle = 0; paintDetail(); }
  S.playing = !S.playing; $('play').textContent = S.playing ? 'PAUSE' : 'PLAY';
  if (S.playing) { S.wait = BASE_MS; kick(); }
});
$('reset').addEventListener('click', () => { S.playing = false; $('play').textContent = 'PLAY'; S.cycle = 0; S.anim = 0; paintDetail(); draw(); });
$('speed').addEventListener('input', e => { S.speed = SPEEDS[+e.target.value]; $('speedv').textContent = `${S.speed}x`; });
$('findkeys').addEventListener('click', findKeys);
cv.addEventListener('click', e => {
  const rect = cv.getBoundingClientRect();
  const u = (e.clientX - rect.left) / W, v = (e.clientY - rect.top) / W;
  const hit = [...STAGES, 'BP', 'L1i', 'L1d', 'L2', 'L3', 'IO', 'BUS'].find(k => {
    const r = B[k]; return u >= r.x && u <= r.x + r.w && v >= r.y && v <= r.y + r.h;
  });
  if (!hit) return;
  S.selected = hit; paintDetail(); draw();
});
window.addEventListener('resize', resize);
$('rules').textContent = `Loading: one queue, at most ${QUEUE_MAX} requests at once, ${TIMEOUT_MS / 1000} s timeout each; the source and the engine layer at start; the numbered database only on FIND LINE KEYS, in ${CHUNK / 1024} KB probes and one ${WINDOW / 1024} KB window. Drawing: one canvas; no DOM node per token or per line.`;

window.__floorplan = { S, queue, tokenize, analyse };
resize();
loadSource();
