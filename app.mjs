/* The Line Wafer.
 *
 * WHAT THIS IS. Every line of code in the estate that has been given a
 * permanent number is one point on one surface. There are 250,174 of them and
 * they are numbered 1 to 342,795: the number is the line's permanent key, it
 * never changes and it is never reused, and numbers missing from the sequence
 * were never issued. Those gaps are drawn as gaps.
 *
 * WHY THE NUMBER IS THE ADDRESS. A point's position here is a pure function of
 * its own permanent key and of nothing else:
 *
 *     r = SPACING * sqrt(key)        theta = key * GOLDEN
 *
 * so line 8,285 is in the same place on every device, in every session, for
 * ever, and the surface can be reconstituted from the numbers alone. Nothing
 * about a position is stored, fetched or remembered. That is what makes the
 * surface unbounded rather than large: the estate can issue line 400,000
 * tomorrow and the wafer already has somewhere to put it.
 *
 * THE BEAM. The camera is a beam. It steers over the wafer and focuses, and
 * where it focuses the structure resolves — one line, its length, whether any
 * function family carries it, and which. Focus is the only instrument; there
 * are no levels and nothing is pre-rendered.
 *
 * THE RULE THIS PAGE EXISTS TO MEET. It must be able to connect any two
 * uniquely numbered lines in the estate. Type two numbers and it answers: the
 * families that carry both, or a refusal naming which of the two no family
 * carries.
 *
 * TWO RELATIONS, AND THE FIRST VERSION OF THIS PAGE CONFUSED THEM.
 * FANOUT is one number appearing in several families: the same text sitting in
 * several places, which is duplication. CO-MEMBERSHIP is two different numbers
 * appearing in one family: two lines of the same function, which is
 * neighbourhood and is NOT the same text. Connecting uses co-membership, so a
 * line carried by exactly one family is perfectly connectable — to another line
 * of that family. The page originally claimed the opposite and a reviewer was
 * right to reject it. See lib.mjs.
 *
 * WHAT IS NOT CLAIMED. Neither relation is a dependency and neither means one
 * line calls the other. Triviality is visible rather than hidden: a line's
 * fanout is printed, so line 2, an empty line in 2,281 families, looks exactly
 * as meaningless as it is.
 *
 * ROOT PROMOTION (iteration 38). What three merged iterations proved is carried
 * into this root page, each section citing the file it was lifted from:
 *   iterations/22-fast-zoom/app.mjs — the moving-frame cache, culling by radius
 *     band, antialias off, the marks canvas resized only on a size change, the
 *     measured frame budget, and a finger lifting after a pinch is not a tap.
 *   iterations/31-code-card-everywhere/card.mjs and app.mjs — a tap on a line,
 *     a route or empty ground opens a code card (the "code card" section below).
 *   iterations/21-dark-pixels/app.mjs — the dark ground, here a toggle that is
 *     OFF by default, so the page looks exactly as it did until it is ticked.
 * The placement law is untouched: every position still comes from lib.mjs.
 */

import { place, placeAll, parseKey, indexOfKey as findKey, ownersOf, fanoutCount,
         connectAnswer, esc, fmt, SPACING } from './lib.mjs';

const DATA = 'https://globalgrid2050.com/testcode/202609142202/data/';

const $ = id => document.getElementById(id);
let stage = $("stage");

const U = {
  fanout: null,        /* lines carried by MORE THAN ONE family; counted, never typed */
  keys: null,        /* Uint32Array, sorted: every permanent line number issued */
  lens: null,        /* Uint16Array: characters in that line */
  inFam: null,       /* Uint8Array: 1 when at least one family carries it */
  pos: null,         /* Float32Array 2N: the pure function of the key */
  n: 0,
  families: null,    /* tier 2 */
  famLines: null,
  ownerOf: null,     /* Map<key, number[]> family indexes, built once on demand */
  meta: null
};

const view = { x: 0, y: 0, zoom: 1, w: 0, h: 0, dpr: 1, focus: -1, link: null };
/* The one read-only hook for layers: the live camera, and listeners called after every frame. */
/* Listeners get a frozen scalar snapshot, never the live object: a listener that
   mutates what it received cannot move the wafer's camera. (Codex review.) */
const snapshot = () => Object.freeze({ x: view.x, y: view.y, zoom: view.zoom, w: view.w, h: view.h, dpr: view.dpr, moving: MOTION.moving, dark: GROUND.dark });

/* DARK GROUND (iterations/21-dark-pixels/app.mjs), as a toggle, OFF by default.
   When on, every line point is drawn near-black and the layers panel wakes only
   the keys a ticked layer charts. The reader switches it with #darkGround; it
   travels in the URL as ground=dark. Layers read it from the snapshot. */
const GROUND = { dark: false };
const CLEAR_LIT = [0.043, 0.051, 0.071], CLEAR_DARK = [0.012, 0.014, 0.020];   /* 21-dark-pixels render() */
const clearColour = () => GROUND.dark ? CLEAR_DARK : CLEAR_LIT;

/* FAST ZOOM (iteration 22). While a gesture is moving the camera the wafer is
   not re-rasterised: its 250k points are drawn once into an offscreen texture
   CACHE_SPAN times the screen in each direction, and each moving frame only
   draws that texture as one transformed quad. The texture is redrawn when the
   camera leaves it (panned past its margin, zoomed out past it, or magnified
   more than CACHE_MAGNIFY times), and full detail returns SETTLE_MS after the
   last gesture event. Layers read `moving` from the snapshot to thin their
   drawing in the same frames. */
const SETTLE_MS = 150;
const CACHE_SPAN = 1.5;
const CACHE_MAGNIFY = 2;
const MOTION = { moving: false, timer: 0 };
function motion() {
  MOTION.moving = true;
  clearTimeout(MOTION.timer);
  MOTION.timer = setTimeout(() => { MOTION.moving = false; draw(); }, SETTLE_MS);
}

window.__wafer = Object.freeze({ get view() { return snapshot(); }, onDraw: new Set(),
  get moving() { return MOTION.moving; }, get settleMs() { return SETTLE_MS; }, get dark() { return GROUND.dark; },
  get stats() { return Object.freeze({ drawn: frameStats.drawn, total: U.n, rasters: cache.rasters }); } });

/* ── the surface ─────────────────────────────────────────────────────────── */

const placeOne = place;                       /* where a number sits, issued or not */
const indexOfKey = key => findKey(U.keys, key);

/* ── loading ─────────────────────────────────────────────────────────────── */

async function bin(name, Kind) {
  const r = await fetch(DATA + name, { cache: 'default' });
  if (!r.ok) throw new Error(DATA + name + ' returned HTTP ' + r.status);
  return new Kind(await r.arrayBuffer());
}

async function tier1() {
  const [meta, keys, lens, inFam] = await Promise.all([
    fetch(DATA + 'all-lines.meta.json').then(r => r.json()),
    bin('all-lines.bin', Uint32Array),
    bin('all-lines.len.bin', Uint16Array),
    bin('all-lines.family.bin', Uint8Array)
  ]);
  U.meta = meta; U.keys = keys; U.lens = lens; U.inFam = inFam; U.n = keys.length;
  U.pos = placeAll(keys);

  let carried = 0;
  for (let i = 0; i < inFam.length; i++) carried += inFam[i];
  $('count').textContent =
    `${fmt(U.n)} numbered lines · 1 to ${fmt(meta.max)} · ${fmt(carried)} carried by a family`;
  $('prov').textContent =
    `numbered database built ${meta.built_utc.slice(0, 16).replace('T', ' ')} UTC · pack ${meta.source.sha256.slice(0, 12)}`;
}

async function tier2() {
  const [families, famLines] = await Promise.all([
    fetch(DATA + 'families.json').then(r => r.json()),
    bin('lines.bin', Uint32Array)
  ]);
  U.families = families; U.famLines = famLines;
  const owner = ownersOf(families, famLines);
  U.ownerOf = owner;
  U.fanout = fanoutCount(owner);
  if (view.focus >= 0) paintPanel(view.focus);
  if (view.link) connect(view.link[0], view.link[1]);
  if (waitingKey > 0) openLine(waitingKey);   /* 31-code-card-everywhere: a card waiting on the index resumes */
}

/* ── drawing ─────────────────────────────────────────────────────────────── */

const VS = `#version 300 es
precision highp float;
in vec2 a_pos; in float a_len; in float a_fam;
uniform vec2 u_res; uniform vec2 u_cam; uniform float u_zoom; uniform float u_dpr;
uniform float u_focusKey;
out float v_fam; out float v_len; out float v_focus;
void main(){
  vec2 p = (a_pos - u_cam) * u_zoom;
  gl_Position = vec4(p / (u_res * 0.5), 0.0, 1.0);
  float base = 1.0 + min(a_len, 120.0) * 0.012;
  gl_PointSize = clamp(base * sqrt(u_zoom) * u_dpr, 1.0, 26.0 * u_dpr);
  v_fam = a_fam; v_len = a_len; v_focus = 0.0;
}`;

const FS = `#version 300 es
precision highp float;
in float v_fam; in float v_len; in float v_focus;
uniform float u_dark;
out vec4 o;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  if (r > 0.5) discard;
  float edge = smoothstep(0.5, 0.42, r);
  vec3 carried = vec3(0.84, 0.87, 0.94);
  vec3 alone   = vec3(0.30, 0.34, 0.44);
  float a = 0.30 + 0.70 * v_fam;
  if (u_dark > 0.5) {
    /* iterations/21-dark-pixels/app.mjs: the ground is dead but still faintly there */
    carried = vec3(0.16, 0.18, 0.23);
    alone   = vec3(0.09, 0.10, 0.13);
    a = 0.45 + 0.30 * v_fam;
  }
  vec3 c = mix(alone, carried, v_fam);
  o = vec4(c, edge * a);
}`;

let gl = null, prog = null, loc = {}, vao = null, ctx2d = null;

function compile(g, type, src) {
  const s = g.createShader(type); g.shaderSource(s, src); g.compileShader(s);
  if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(s));
  return s;
}

/* If anything after acquiring the context fails — a shader that will not compile
   on some driver, a program that will not link — the page must fall back, not
   half-run. A canvas cannot hand out a 2D context once it has given out a WebGL
   one, so the canvas itself is replaced. The first version left `gl` non-null on
   failure and then asked the same canvas for a 2D context, which returns null:
   the fallback it advertised did not exist. */
function initGL() {
  /* Iteration 22: antialias off. Each point already fades its own edge in the
     fragment shader, and multisampling a full-screen buffer was measured GPU cost. */
  gl = stage.getContext('webgl2', { antialias: false, alpha: false });
  if (!gl) { gl = null; return fallback2d(); }
  try { return buildGL(); }
  catch (e) { gl = null; console.warn('WebGL setup failed, falling back:', e.message); return fallback2d(); }
}

function fallback2d() {
  const fresh = stage.cloneNode(false);
  stage.replaceWith(fresh);
  stage = fresh;
  ctx2d = stage.getContext('2d');
  $('hint').textContent = ctx2d
    ? 'drawn without the GPU: at low zoom one line in seven is plotted'
    : 'this browser gave neither a GPU nor a 2D canvas; nothing can be drawn';
  return false;
}

function buildGL() {
  prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  for (const u of ['u_res', 'u_cam', 'u_zoom', 'u_dpr', 'u_focusKey', 'u_dark']) loc[u] = gl.getUniformLocation(prog, u);

  vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const put = (data, name, size, Kind, norm) => {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const l = gl.getAttribLocation(prog, name);
    gl.enableVertexAttribArray(l);
    gl.vertexAttribPointer(l, size, Kind, !!norm, 0, 0);
  };
  put(U.pos, 'a_pos', 2, gl.FLOAT, false);
  put(U.lens, 'a_len', 1, gl.UNSIGNED_SHORT, false);
  put(U.inFam, 'a_fam', 1, gl.UNSIGNED_BYTE, false);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  return true;
}

function resize() {
  view.dpr = Math.min(window.devicePixelRatio || 1, 2);
  view.w = stage.clientWidth; view.h = stage.clientHeight;
  stage.width = Math.round(view.w * view.dpr);
  stage.height = Math.round(view.h * view.dpr);
  if (gl) gl.viewport(0, 0, stage.width, stage.height);
}

let overlay = null;
function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement('canvas');
  overlay.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:1';
  document.body.appendChild(overlay);
  return overlay;
}

/* The marks canvas is resized only when the stage changes size and cleared only
   when it holds something: assigning canvas.width every frame reallocates a
   full-screen backing store on every frame. */
let marksDirty = true;
function drawMarks() {
  const o = ensureOverlay();
  const has = !!view.link || view.focus >= 0;
  if (o.width !== stage.width || o.height !== stage.height) { o.width = stage.width; o.height = stage.height; marksDirty = true; }
  if (!has && !marksDirty) return;
  const c = o.getContext('2d');
  c.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  c.clearRect(0, 0, view.w, view.h);
  marksDirty = has;
  if (!has) return;
  const toScreen = ([x, y]) => [
    (x - view.x) * view.zoom + view.w / 2,
    view.h / 2 - ((y - view.y) * view.zoom)
  ];
  if (view.link) {
    const [ka, kb] = view.link;
    const A = toScreen(placeOne(ka)), B = toScreen(placeOne(kb));
    c.strokeStyle = '#5ec8f2'; c.lineWidth = 1.2; c.setLineDash([5, 4]);
    c.beginPath(); c.moveTo(A[0], A[1]);
    c.quadraticCurveTo((A[0] + B[0]) / 2, (A[1] + B[1]) / 2 - 40, B[0], B[1]);
    c.stroke(); c.setLineDash([]);
    for (const P of [A, B]) {
      c.strokeStyle = '#5ec8f2'; c.beginPath(); c.arc(P[0], P[1], 9, 0, 6.2832); c.stroke();
    }
  }
  if (view.focus >= 0) {
    const P = toScreen(placeOne(view.focus));
    c.strokeStyle = '#ffd54a'; c.lineWidth = 1.4;
    c.beginPath(); c.arc(P[0], P[1], 11, 0, 6.2832); c.stroke();
    c.beginPath(); c.moveTo(P[0] - 18, P[1]); c.lineTo(P[0] - 13, P[1]);
    c.moveTo(P[0] + 13, P[1]); c.lineTo(P[0] + 18, P[1]);
    c.moveTo(P[0], P[1] - 18); c.lineTo(P[0], P[1] - 13);
    c.moveTo(P[0], P[1] + 13); c.lineTo(P[0], P[1] + 18);
    c.stroke();
  }
}

/* ── the moving-frame cache ──────────────────────────────────────────────── */

const BLIT_VS = `#version 300 es
in vec2 a_q; uniform vec4 u_rect; out vec2 v_uv;
void main(){ v_uv = a_q; gl_Position = vec4(mix(u_rect.xy, u_rect.zw, a_q), 0.0, 1.0); }`;
const BLIT_FS = `#version 300 es
precision mediump float; in vec2 v_uv; uniform sampler2D u_tex; out vec4 o;
void main(){ o = texture(u_tex, v_uv); }`;

const cache = { fbo: null, tex: null, w: 0, h: 0, prog: null, vao: null, rect: null, valid: false, x: 0, y: 0, zoom: 1, rasters: 0, broken: false };

/* CULLING BY THE LAW. r = sqrt(key), so the keys that can appear in a world
   rectangle are exactly those whose radius lies between the rectangle's nearest
   and farthest distance from the origin: keys in [r0^2, r1^2]. U.keys is sorted,
   so that is one contiguous index range, found by two binary searches, and one
   drawArrays call over it. POINT_MARGIN_PX widens the rectangle by the largest
   point radius so a point straddling the edge is not cut. */
const POINT_MARGIN_PX = 14;
const frameStats = { drawn: 0 };
function lowerBound(a, v) { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >>> 1; if (a[m] < v) lo = m + 1; else hi = m; } return lo; }
function visibleRange(halfWpx, halfHpx, cx, cy) {
  const k = view.zoom * view.dpr;
  const hw = halfWpx / k + POINT_MARGIN_PX / view.zoom, hh = halfHpx / k + POINT_MARGIN_PX / view.zoom;
  const ax = Math.abs(cx), ay = Math.abs(cy);
  const dx = Math.max(ax - hw, 0), dy = Math.max(ay - hh, 0);
  const r0 = Math.hypot(dx, dy) / SPACING, r1 = Math.hypot(ax + hw, ay + hh) / SPACING;
  return [lowerBound(U.keys, Math.floor(r0 * r0)), lowerBound(U.keys, Math.ceil(r1 * r1) + 1)];
}

function drawPoints(w, h, cx, cy) {
  gl.clearColor(...clearColour(), 1); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(prog); gl.bindVertexArray(vao);
  gl.uniform2f(loc.u_res, w, h);
  gl.uniform2f(loc.u_cam, cx, cy);
  gl.uniform1f(loc.u_zoom, view.zoom * view.dpr);
  gl.uniform1f(loc.u_dpr, view.dpr);
  gl.uniform1f(loc.u_focusKey, view.focus);
  gl.uniform1f(loc.u_dark, GROUND.dark ? 1 : 0);
  const [lo, hi] = visibleRange(w / 2, h / 2, cx, cy);
  if (hi > lo) gl.drawArrays(gl.POINTS, lo, hi - lo);
  frameStats.drawn = hi - lo;
}

/* Returns false when this GPU cannot give a render target, and the page then
   simply draws every moving frame in full, as the root page does. */
function ensureCache() {
  if (cache.broken) return false;
  const max = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
  const w = Math.min(max, Math.ceil(stage.width * CACHE_SPAN)), h = Math.min(max, Math.ceil(stage.height * CACHE_SPAN));
  if (cache.tex && cache.w === w && cache.h === h) return true;
  try {
    if (!cache.prog) {
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, BLIT_VS));
      gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, BLIT_FS));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      cache.prog = p; cache.rect = gl.getUniformLocation(p, 'u_rect');
      cache.vao = gl.createVertexArray(); gl.bindVertexArray(cache.vao);
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
      const l = gl.getAttribLocation(p, 'a_q'); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 2, gl.FLOAT, false, 0, 0);
    }
    if (cache.tex) { gl.deleteTexture(cache.tex); gl.deleteFramebuffer(cache.fbo); }
    cache.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, cache.tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    cache.fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, cache.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, cache.tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) throw new Error('framebuffer incomplete');
    cache.w = w; cache.h = h; cache.valid = false;
    return true;
  } catch (e) {
    console.warn('moving-frame cache unavailable, drawing every frame in full:', e.message);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    cache.broken = true;
    return false;
  }
}

/* Where the cached texture lands on screen, in clip space: [x0, y0, x1, y1]. */
function cacheRect() {
  const hw = cache.w / (cache.zoom * view.dpr * 2), hh = cache.h / (cache.zoom * view.dpr * 2);   /* half extents, world units */
  const kx = view.zoom * view.dpr * 2 / stage.width, ky = view.zoom * view.dpr * 2 / stage.height;
  return [(cache.x - hw - view.x) * kx, (cache.y - hh - view.y) * ky,
          (cache.x + hw - view.x) * kx, (cache.y + hh - view.y) * ky];
}

function rasterCache() {
  gl.bindFramebuffer(gl.FRAMEBUFFER, cache.fbo);
  gl.viewport(0, 0, cache.w, cache.h);
  drawPoints(cache.w, cache.h, view.x, view.y);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, stage.width, stage.height);
  cache.x = view.x; cache.y = view.y; cache.zoom = view.zoom; cache.valid = true; cache.rasters++;
}

function blitCache() {
  let r = cacheRect();
  const covers = r[0] <= -1 && r[1] <= -1 && r[2] >= 1 && r[3] >= 1 && view.zoom / cache.zoom <= CACHE_MAGNIFY;
  if (!cache.valid || !covers) { rasterCache(); r = cacheRect(); }
  gl.clearColor(...clearColour(), 1); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.disable(gl.BLEND);
  gl.useProgram(cache.prog); gl.bindVertexArray(cache.vao);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, cache.tex);
  gl.uniform4f(cache.rect, r[0], r[1], r[2], r[3]);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.enable(gl.BLEND);
}

/* ── the frame budget: measured, never typed ─────────────────────────────── */

/* The time between consecutive drawn frames while the camera is moving. It
   includes the GPU and compositor work that the draw calls themselves do not
   wait for. A gap longer than IDLE_GAP_MS is the camera resting, not a frame. */
const IDLE_GAP_MS = 250;
const budget = { last: 0, ring: new Float64Array(60), n: 0, i: 0, shown: 0 };
function recordFrame() {
  const t = performance.now(), dt = t - budget.last;
  budget.last = t;
  if (dt <= 0 || dt > IDLE_GAP_MS) return;
  budget.ring[budget.i] = dt; budget.i = (budget.i + 1) % 60; budget.n = Math.min(60, budget.n + 1);
  if (t - budget.shown < 250) return;
  budget.shown = t;
  const s = Array.from(budget.ring.subarray(0, budget.n)).sort((x, y) => x - y);
  const el = $('budget');
  if (el) el.textContent = `frame ${s[s.length >> 1].toFixed(1)} ms · median of the last ${budget.n} frames`;
}

function render() {
  recordFrame();
  if (gl) {
    if (MOTION.moving && ensureCache()) blitCache();
    else { cache.valid = false; drawPoints(stage.width, stage.height, view.x, view.y); }
  } else if (ctx2d) {
    const c = ctx2d;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = GROUND.dark ? '#030406' : '#0b0d12'; c.fillRect(0, 0, stage.width, stage.height);
    c.fillStyle = GROUND.dark ? '#1e222c' : '#7d8598';   /* dark values: 21-dark-pixels */
    const step = view.zoom < 0.5 ? 7 : 1;
    for (let i = 0; i < U.n; i += step) {
      const x = (U.pos[i * 2] - view.x) * view.zoom * view.dpr + stage.width / 2;
      const y = stage.height / 2 - (U.pos[i * 2 + 1] - view.y) * view.zoom * view.dpr;
      if (x < 0 || y < 0 || x > stage.width || y > stage.height) continue;
      c.fillRect(x, y, view.dpr, view.dpr);
    }
  }
  drawMarks();
  { const snap = snapshot(); for (const f of window.__wafer.onDraw) { try { f(snap); } catch (e) { console.warn('onDraw listener failed:', e); } } }
}

let pending = false;
function draw() { if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; render(); }); } }

/* ── the beam: steering and focusing ─────────────────────────────────────── */

function home() {
  const maxR = SPACING * Math.sqrt(U.meta.max);
  view.x = 0; view.y = 0;
  view.zoom = Math.min(view.w, view.h) / (maxR * 2.15);
  draw();
}

function flyTo(key, zoom) {
  const [x, y] = placeOne(key);
  const z0 = view.zoom, x0 = view.x, y0 = view.y;
  const z1 = zoom ?? Math.max(view.zoom, 9);
  const t0 = performance.now(), ms = 620;
  (function step(t) {
    const u = Math.min(1, (t - t0) / ms);
    const e = u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    view.x = x0 + (x - x0) * e; view.y = y0 + (y - y0) * e;
    view.zoom = Math.exp(Math.log(z0) + (Math.log(z1) - Math.log(z0)) * e);
    motion(); render();
    if (u < 1) requestAnimationFrame(step);
  })(t0);
}

/* ── the panel: what the beam found ──────────────────────────────────────── */

function famsOf(key) {
  if (!U.ownerOf) return null;
  return U.ownerOf.get(key) || [];
}

function paintPanel(key) {
  const i = indexOfKey(key);
  const p = $('panelbody');
  if (i < 0) {
    p.innerHTML =
      `<h2>Line <span class="n">${fmt(key)}</span></h2>
       <p class="refuse">This number was never issued. The numbering runs 1 to ${fmt(U.meta.max)} and
       ${fmt(U.meta.max - U.n)} of those numbers were skipped, so a gap is a real answer rather than a
       missing record. The surface still has a place for it, and the beam is pointing at it.</p>`;
    $('panel').hidden = false; return;
  }
  const chars = U.lens[i], carried = U.inFam[i] === 1;
  const fams = famsOf(key);
  let body =
    `<h2>Line <span class="n">${fmt(key)}</span></h2>
     <dl>
       <dt>characters</dt><dd>${chars === 65535
          ? 'at least 65,535 — the pack stores this in sixteen bits and this line reaches the ceiling, so its true length is not known here'
          : fmt(chars) + (chars === 0 ? ' (an empty line)' : '')}</dd>
       <dt>permanent</dt><dd>this number is never reused, so it means this line for ever</dd>
       <dt>carried by</dt><dd>${carried ? 'at least one function family' : 'no function family'}</dd>
     </dl>`;
  if (!carried) {
    body += `<p class="refuse">Nothing can be connected to this line. It is numbered and it exists, but no
      function family in the estate carries it, so it has no partner to join it to.</p>`;
  } else if (fams === null) {
    body += `<p class="dim">The family index is still loading; the families carrying this line will appear here.</p>`;
  } else if (fams.length === 0) {
    body += `<p class="refuse">The pack marks this line as carried, but no family range in this build
      contains it. That disagreement is shown rather than smoothed over.</p>`;
  } else {
    const show = fams.slice(0, 12);
    body += `<p>Carried by <span class="fam">${fmt(fams.length)}</span> ${fams.length === 1 ? 'family' : 'families'}${fams.length > 12 ? ', first twelve' : ''}:</p><ul>` +
      show.map(f => {
        const fa = U.families[f];
        const cat = fa.category ?? 'no category recorded';
        return `<li><span class="fam">${esc(fa.name)}</span> <span class="dim">#${fmt(fa.n)} · ${esc(fa.kind)} · ${esc(cat)} · ${fmt(fa.lineCount)} lines</span></li>`;
      }).join('') + `</ul>`;
    if (fams.length > 60) {
      body += `<p class="dim">A line carried by this many families is almost certainly trivial: a brace, a
        blank, an import. Its connection count is drawn here rather than hidden, so you can see that for
        yourself.</p>`;
    }
  }
  p.innerHTML = body;
  $('panel').hidden = false;
}

function connect(ka, kb) {
  view.link = [ka, kb];
  const p = $('panelbody');
  const head = `<h2>Connect <span class="n">${fmt(ka)}</span> to <span class="n">${fmt(kb)}</span></h2>`;

  /* The index is the only thing that can be missing; everything else is decided
     by lib.mjs so the page cannot disagree with the proofs. */
  if (!U.ownerOf) {
    p.innerHTML = head + `<p class="dim">The family index is still loading. The answer will appear here
      without another tap.</p>`;
    $('panel').hidden = false; draw(); return;
  }

  const a = connectAnswer(ka, kb, { keys: U.keys, owner: U.ownerOf });
  const famLine = f => {
    const fa = U.families[f];
    return `<li><span class="fam">${esc(fa.name)}</span> <span class="dim">#${fmt(fa.n)} · ${esc(fa.category ?? 'no category recorded')}</span></li>`;
  };
  let body = head;

  if (a.verdict === 'absent') {
    body += `<p class="refuse">${a.absent.map(fmt).join(' and ')} ${a.absent.length > 1 ? 'were' : 'was'}
      never issued in this numbering, so there is nothing at that address to connect.</p>`;

  } else if (a.verdict === 'same-line') {
    body += `<p class="refuse">Those are the same line. A line is not connected to itself, and reporting
      that it is would be the page agreeing with you rather than answering you.</p>` +
      (a.both.length
        ? `<p>Line ${fmt(ka)} is carried by ${fmt(a.both.length)} ${a.both.length === 1 ? 'family' : 'families'}.</p>`
        : `<p>No family carries line ${fmt(ka)}.</p>`);

  } else if (a.verdict === 'no-family') {
    body += `<p class="refuse">${a.without.map(fmt).join(' and ')} ${a.without.length > 1 ? 'are' : 'is'}
      carried by no function family at all, so ${a.without.length > 1 ? 'they have' : 'it has'} nothing to be
      joined through.</p>`;

  } else if (a.verdict === 'joined') {
    body += `<p>Joined by <span class="fam">${fmt(a.both.length)}</span>
      ${a.both.length === 1 ? 'family that carries' : 'families that carry'} both lines${a.both.length > 12 ? ', first twelve' : ''}:</p>
      <ul>${a.both.slice(0, 12).map(famLine).join('')}</ul>
      <p class="dim">This is co-membership: two different lines sitting in one function. It is not the same
      text in two places, and it is not a dependency. Either line may be carried by only that one family and
      still connect perfectly well through it.</p>`;

  } else {
    body += `<p class="refuse">No family carries both lines, so these two are not joined.</p>
      <dl><dt>${fmt(ka)}</dt><dd>${a.A.length ? fmt(a.A.length) + ' ' + (a.A.length === 1 ? 'family' : 'families') : 'no family'}</dd>
          <dt>${fmt(kb)}</dt><dd>${a.B.length ? fmt(a.B.length) + ' ' + (a.B.length === 1 ? 'family' : 'families') : 'no family'}</dd></dl>
      <p class="dim">An unjoined pair is the ordinary case: most lines of the estate sit in unrelated
      functions. This is not about fanout. ${fmt(U.fanout)} of the ${fmt(U.n)} numbered lines appear in more
      than one family, which is duplication; joining two numbers asks the different question of whether one
      family holds them both.</p>`;
  }

  p.innerHTML = body;
  $('panel').hidden = false;

  /* Frame both ends. */
  const [ax, ay] = placeOne(ka), [bx, by] = placeOne(kb);
  view.x = (ax + bx) / 2; view.y = (ay + by) / 2;
  const span = Math.max(Math.hypot(bx - ax, by - ay), 4);
  view.zoom = Math.min(view.w, view.h) / (span * 1.8);
  draw();
}

/* ── gestures ────────────────────────────────────────────────────────────── */

function gestures() {
  let down = null, moved = 0, pinch = null, wasPinch = false;   /* a finger lifting after a pinch is not a tap */
  const pts = new Map();
  stage.addEventListener('pointerdown', e => {
    stage.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 1) { down = [e.clientX, e.clientY]; moved = 0; }
    if (pts.size >= 2) wasPinch = true;
    if (pts.size === 2) {
      const [p, q] = [...pts.values()];
      pinch = { d: Math.hypot(p[0] - q[0], p[1] - q[1]), z: view.zoom };
    }
  });
  stage.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId);
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2 && pinch) {
      const [p, q] = [...pts.values()];
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (pinch.d > 0) view.zoom = Math.max(0.02, Math.min(4000, pinch.z * (d / pinch.d)));
      motion(); draw(); return;
    }
    if (pts.size === 1) {
      const dx = e.clientX - prev[0], dy = e.clientY - prev[1];
      moved += Math.abs(dx) + Math.abs(dy);
      view.x -= dx / view.zoom; view.y += dy / view.zoom;
      motion(); draw();
    }
  });
  const up = e => {
    /* wasPinch: iterations/22-fast-zoom/app.mjs. The root treated the last finger
       of a pinch lifting as a tap and opened a panel under it. */
    if (pts.size === 1 && down && moved < 7 && !wasPinch) {
      /* iterations/31-code-card-everywhere/app.mjs: every tap opens a code card,
         on a line, a route or empty ground; the line panel stays for FLY and links */
      $('panel').hidden = true; view.focus = -1; view.link = null; draw();
      cardTap(e.clientX, e.clientY);
    }
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (pts.size === 0) { down = null; wasPinch = false; }
  };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', e => { pts.delete(e.pointerId); pinch = null; down = null; if (pts.size === 0) wasPinch = false; });
  stage.addEventListener('wheel', e => {
    e.preventDefault();
    const f = Math.exp(-e.deltaY * 0.0016);
    view.zoom = Math.max(0.02, Math.min(4000, view.zoom * f));
    motion(); draw();
  }, { passive: false });
  stage.addEventListener('dblclick', () => { view.focus = -1; view.link = null; $('panel').hidden = true; home(); });
}

/* ── the code card ───────────────────────────────────────────────────────────
 *
 * Lifted from iterations/31-code-card-everywhere/card.mjs; its description
 * follows. Differences here: it reads U and draw() directly instead of through
 * bindWafer(); a card waiting on the family index is resumed by tier2(); the
 * tile band on empty ground comes from the layers panel's tile rule; a point
 * hit also lists that feature's properties; and the tap's click is swallowed on
 * anything that is not the wafer.
 *
 * Any tap on the wafer opens a card:
 *   on a line   — its key, the exact text of that line inside the function that
 *                 contains it, read from the file at the commit the numbered
 *                 database pins, with its family, block and app;
 *   on a route  — the module the route draws, its first and last line, its stops;
 *   on nothing  — the nearest issued line and the radius band the point sits in,
 *                 both computed from the placement law r = sqrt(key).
 *
 * Reused, not reinvented:
 *   iteration 03 (code-particle.mjs): the block register, a fetch queue, reading
 *     a file from raw.githubusercontent at its pinned commit, one writer for the
 *     WAIT / LOAD / OK / EMPTY / FAIL tag, and fetched text reaching the page only
 *     through textContent.
 *   iteration 07 (code-card.mjs): the Grid Atlas popup look — black ground, #444
 *     edge, monospace, an amber title, grey detail, the bordered cyan button.
 *
 * Where a line sits in its file. The modular star publishes one record per
 * function family (stars/code/f/<n div 500>.json). Each record lists the family's
 * permanent line keys in file order and every place the family lives
 * (repository, commit, path, first and last line). A key at position j of the
 * record is file line first + j. The page then checks the text it finds there
 * against the character count the numbered database holds for that key, and says
 * whether they agree.
 *
 * Changing a digit. Tap a line in the code window and each digit run on it is
 * an input. Edits exist
 * only in this page's memory: nothing is written to any repository, nothing is
 * stored in the browser. For a ventus-grid-engine module the page can run the
 * module twice in a Web Worker built from a Blob — once as published at the
 * commit the estate imports, once with the edit — calling one documented
 * function with the input its own proof uses first, and shows both answers.
 *
 * Loading, as Grid Atlas loads: nothing is fetched until a card opens; one
 * queue runs at most two fetches at once, each aborted after 15 s; one promise
 * per URL is shared, and a failed fetch leaves the cache so a retry can happen;
 * at most eight source files and four family buckets are held, the least
 * recently used evicted first. The card is one element, re-filled on every tap:
 * the code window is one text node however long the function, and only the one
 * selected line becomes editable fields.
 */


const STARS = 'https://ventusltd.github.io/stars/';
const REGISTER = STARS + 'blocks/blocks.json';
const RAW = 'https://raw.githubusercontent.com/';
const ENGINE_REPO = 'Ventusltd/ventus-grid-engine';
const PIN = 'd9cd18b0e2034325814924e6e4a0e958014f2748';   /* the engine commit the estate imports */
const BUCKET = 500;            /* stars/code/index.json bucket_size; checked when the index is read */
const WINDOW_MAX = 160;        /* lines shown when a function is longer than this */
const RUN_MS = 2000;
const FETCH_MS = 15000;        /* Grid Atlas: every fetch has a 15 s AbortController timeout */
const MAX_FIELDS = 40;         /* digit fields on one selected line */
const REACH = 22;              /* px: the wafer's own tap reach, as the root's nearestKeyAt had it */
const DISCLAIMER = 'Illustrative physics drawn by a computer from published data. Not an engineering design or certified calculation. Any real design above 100 kW needs study and approval by a qualified chartered electrical engineer under the applicable standards.';

/* The first input each engine module's own proof calls it with. `evidence` must
   appear, whitespace collapsed, in the proof file at PIN or the run is refused. */
const FIXTURES = {
  'engine/voltage-drop.js': {
    fn: 'voltageDropVolts',
    input: { currentA: 200, lengthM: 250, resistanceOhmPerKm: 0.1, reactanceOhmPerKm: 0.08, powerFactor: 0.9, phases: 'three' },
    proof: 'proofs/voltage-drop.proof.mjs',
    evidence: "currentA: 200, lengthM: 250, resistanceOhmPerKm: 0.1, reactanceOhmPerKm: 0.08, powerFactor: 0.9, phases: 'three'"
  },
  'engine/current-from-power.js': {
    fn: 'currentFromMvaAtKv',
    input: { mva: 1200, kv: 400 },
    proof: 'proofs/current-from-power.proof.mjs',
    evidence: 'currentFromMvaAtKv({ mva: 1200, kv: 400 })'
  }
};

/* Which single-line-diagram element an engine module feeds, and through which
   function. The function must exist in the fetched source or the answer is
   withheld; the field it returns (quantity, unit) is read from that source. */
const SLD = {
  'engine/voltage-drop.js': { element: 'cable route (the feeder cable between two busbars)', fn: 'voltageDropVolts' },
  'engine/current-from-power.js': { element: 'feeder (the current a circuit rating implies)', fn: 'currentFromMvaAtKv' },
  'engine/firm-capacity.js': { element: 'transformer (firm capacity of a substation\'s units)', fn: 'firmCapacityMva' },
  'engine/power-factor.js': { element: 'feeder (reactive power and its correction)', fn: 'correctionKvar' },
  'engine/route-obstacles.js': { element: 'cable route (length with crossings)', fn: 'routeEstimate' },
  'engine/published-fault-level.js': { element: 'protection (a published fault level at a busbar)', fn: 'quote' }
};

/* ── fetching: one queue of two, bounded caches ─────────────────────────────── */

class Queue {
  constructor(n) { this.n = n; this.active = 0; this.waiting = []; }
  async add(task, onWait) {
    if (this.active >= this.n) { onWait?.(); await new Promise(r => this.waiting.push(r)); }
    this.active++;
    try { return await task(); }
    finally { this.active--; this.waiting.shift()?.(); }
  }
}
class LRU {
  constructor(n) { this.n = n; this.m = new Map(); }
  get(k) { const v = this.m.get(k); if (v !== undefined) { this.m.delete(k); this.m.set(k, v); } return v; }
  set(k, v) { this.m.delete(k); this.m.set(k, v); while (this.m.size > this.n) this.m.delete(this.m.keys().next().value); }
  delete(k) { this.m.delete(k); }
  get size() { return this.m.size; }
}
const queue = new Queue(2);
const sources = new LRU(8);
const buckets = new LRU(4);
const once = new Map();
let fetchCount = 0;

function cached(cache, url, parse, onWait) {
  let p = cache.get(url);
  if (!p) {
    p = queue.add(async () => {
      fetchCount++;
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), FETCH_MS);
      try {
        const r = await fetch(url, { signal: ac.signal });
        if (!r.ok) throw new Error(url + ' returned HTTP ' + r.status);
        return await (parse === 'json' ? r.json() : r.text());
      } catch (e) {
        throw e.name === 'AbortError' ? new Error(url + ` gave no answer within ${FETCH_MS / 1000} s`) : e;
      } finally { clearTimeout(t); }
    }, onWait);
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}
const onceMap = { get: k => once.get(k), set: (k, v) => once.set(k, v), delete: k => once.delete(k) };
const rawURL = (repo, commit, path) => `${RAW}${repo}/${commit}/${path}`;
const ghURL = (repo, commit, path, a, b) => `https://github.com/${repo}/blob/${commit}/${path}` + (a ? `#L${a}` + (b && b !== a ? `-L${b}` : '') : '');

function register() {
  return cached(onceMap, REGISTER, 'json').then(j => {
    if (!j._bySymbol) {
      const m = new Map();
      for (const b of j.blocks || []) if (!m.has(b.symbol)) m.set(b.symbol, b);
      Object.defineProperty(j, '_bySymbol', { value: m });
    }
    return j._bySymbol;
  });
}
async function familyRecord(n, onWait) {
  const idx = await cached(onceMap, STARS + 'code/index.json', 'json', onWait);
  const size = idx.bucket_size ?? BUCKET;
  const b = Math.floor(n / size);
  if (Array.isArray(idx.buckets) && !idx.buckets.includes(b)) return { missing: `bucket ${b} is not listed in stars/code/index.json` };
  const j = await cached(buckets, `${STARS}code/f/${b}.json`, 'json', onWait);
  const rec = j[String(n)];
  return rec ? { rec, bucket: b } : { missing: `family #${n} is not in bucket ${b}` };
}
const readSource = (repo, commit, path, onWait) => cached(sources, rawURL(repo, commit, path), 'text', onWait)
  .then(t => t.split('\n').map(l => l.replace(/\r$/, '')));

/* ── DOM helpers: fetched text only ever meets textContent ─────────────────── */

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = String(text);
  return e;
};
const link = (href, text) => { const a = el('a', 'cc-link', text); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; };
const row = (dl, k, ...v) => { dl.append(el('dt', null, k)); const dd = el('dd'); dd.append(...v.map(x => typeof x === 'string' ? document.createTextNode(x) : x)); dl.append(dd); return dd; };
const btn = (text, cls, on) => { const b = el('button', cls || 'popup-btn', text); b.type = 'button'; b.addEventListener('click', on); return b; };

let token = 0;         /* the card belongs to the latest open only */
let mark = null;       /* {kind:'key', key} | {kind:'point', x, y, key} | {kind:'route', keys} */
let waitingKey = -1;

/* the card's mark follows the camera like any layer (registered where markCanvas is made, below) */

/* ── the sheet ─────────────────────────────────────────────────────────────── */

function sheet(title, sub) {
  const mine = ++token;
  const card = $('card');
  card.replaceChildren();
  card.hidden = false;
  card.scrollTop = 0;
  const x = btn('×', 'cc-x', closeCard); x.setAttribute('aria-label', 'close');
  const t = el('span', 'cc-title', title);
  card.append(x, t);
  if (sub) card.append(el('span', 'cc-grey', sub));
  const tagLine = el('div', 'cc-tagline');
  const tag = el('span', 'cc-tag'), msg = el('span', 'cc-grey');
  tagLine.append(tag, msg);
  card.append(tagLine);
  const body = el('div', 'cc-body');
  card.append(body);
  const setTag = (s, text) => {                 /* the single writer of the state */
    if (mine !== token) return false;
    tag.dataset.s = s; tag.textContent = s;
    if (text != null) msg.textContent = text;
    return true;
  };
  return { mine, card, body, setTag, live: () => mine === token };
}

function closeCard() { token++; $('card').hidden = true; $('card').replaceChildren(); mark = null; waitingKey = -1; draw(); }
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('card').hidden) closeCard(); });

/* A card opening under a finger must not take that same tap's click. Widened
   from card.mjs (which guarded #card only) to anything that is not the wafer:
   the defect noted in iterations/21-dark-pixels/layers-panel.mjs was the same
   click landing on a layers checkbox that had just appeared under the finger. */
let swallowUntil = 0;
document.addEventListener('click', e => {
  if (performance.now() < swallowUntil && e.target instanceof Element && e.target.id !== 'stage') { e.preventDefault(); e.stopPropagation(); }
  swallowUntil = 0;
}, true);

/* ── the tap ───────────────────────────────────────────────────────────────── */

function cardTap(cx, cy) {
  if (!U.pos) return;
  swallowUntil = performance.now() + 450;
  const hit = window.__layers?.pickAt?.(cx, cy);
  if (hit?.feature?.geometry?.type === 'LineString') {
    /* on one of the route's own stops: that line's card; on the stroke between stops: the route's */
    const v = window.__wafer.view, fam = hit.feature.properties?.family;
    let stop = -1, bestD = 14 * 14;
    for (const k of hit.feature.geometry.keys) {
      const [x, y] = place(k), dx = (x - v.x) * v.zoom + v.w / 2 - cx, dy = v.h / 2 - (y - v.y) * v.zoom - cy, d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; stop = k; }
    }
    if (stop > 0) return openLine(stop, { layer: hit.layer, family: fam });
    return openRoute(hit.layer, hit.feature);
  }
  if (hit?.feature?.geometry?.type === 'Point') return openLine(hit.feature.geometry.key, { layer: hit.layer, props: hit.feature.properties });
  const v = window.__wafer.view;
  const wx = (cx - v.w / 2) / v.zoom + v.x, wy = (v.h / 2 - cy) / v.zoom + v.y;
  const near = nearestIssued(wx, wy);
  if (near && near.d * v.zoom <= REACH) return openLine(near.key);
  return openArea(wx, wy, near, v.zoom);
}

function nearestIssued(wx, wy) {
  const { pos, keys, n } = U;
  let best = -1, bestD = Infinity;
  for (let i = 0; i < n; i++) {
    const dx = pos[i * 2] - wx, dy = pos[i * 2 + 1] - wy, d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best < 0 ? null : { key: keys[best], d: Math.sqrt(bestD) };
}
const issuedIn = (a, b) => lowerBound(U.keys, b) - lowerBound(U.keys, a);   /* keys in [a, b) */

/* ── marks on the wafer ─────────────────────────────────────────────────────── */

const markCanvas = document.createElement('canvas');
markCanvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2';
document.body.appendChild(markCanvas);
const mctx = markCanvas.getContext('2d');
window.__wafer.onDraw.add(drawMark);
let drawnMark = false;

function drawMark(v) {
  if (!mark && !drawnMark) return;
  const dpr = v.dpr || 1, Wd = Math.round(v.w * dpr), H = Math.round(v.h * dpr);
  if (markCanvas.width !== Wd || markCanvas.height !== H) { markCanvas.width = Wd; markCanvas.height = H; }
  mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  mctx.clearRect(0, 0, v.w, v.h);
  drawnMark = !!mark;
  if (!mark) return;
  const S = ([x, y]) => [(x - v.x) * v.zoom + v.w / 2, v.h / 2 - (y - v.y) * v.zoom];
  mctx.lineWidth = 1.6; mctx.strokeStyle = '#00ffff';
  if (mark.kind === 'route') {
    mctx.beginPath();
    mark.keys.forEach((k, i) => { const [x, y] = S(place(k)); i ? mctx.lineTo(x, y) : mctx.moveTo(x, y); });
    mctx.setLineDash([6, 4]); mctx.stroke(); mctx.setLineDash([]);
    for (const k of [mark.keys[0], mark.keys[mark.keys.length - 1]]) { const [x, y] = S(place(k)); mctx.beginPath(); mctx.arc(x, y, 10, 0, 6.2832); mctx.stroke(); }
    return;
  }
  if (mark.kind === 'point') {
    const [px, py] = S([mark.x, mark.y]);
    mctx.beginPath(); mctx.moveTo(px - 8, py); mctx.lineTo(px + 8, py); mctx.moveTo(px, py - 8); mctx.lineTo(px, py + 8); mctx.stroke();
    if (mark.key > 0) {
      const [kx, ky] = S(place(mark.key));
      mctx.setLineDash([3, 3]); mctx.beginPath(); mctx.moveTo(px, py); mctx.lineTo(kx, ky); mctx.stroke(); mctx.setLineDash([]);
      mctx.beginPath(); mctx.arc(kx, ky, 9, 0, 6.2832); mctx.stroke();
    }
    return;
  }
  const [x, y] = S(place(mark.key));
  mctx.strokeStyle = '#ffd54a';
  mctx.beginPath(); mctx.arc(x, y, 11, 0, 6.2832); mctx.stroke();
}

/* ── a line ────────────────────────────────────────────────────────────────── */

async function openLine(key, opts = {}) {
  mark = { kind: 'key', key }; draw();
  const i = findKey(U.keys, key);
  const chars = i >= 0 ? U.lens[i] : null;
  const { body, setTag, live } = sheet('Line ' + fmt(key),
    i < 0 ? ' number never issued' : ' ' + (chars === 65535 ? 'at least 65,535 characters' : fmt(chars) + (chars === 1 ? ' character' : ' characters')));
  if (opts.layer) { const s = el('div', 'cc-small', 'tapped on the layer ' + opts.layer.label); body.append(s); }
  if (opts.props && Object.keys(opts.props).length) {
    /* root promotion: the layer feature's own properties, which the root's inspect box used to show */
    const pd = el('dl', 'cc-dl');
    for (const [k, v] of Object.entries(opts.props)) row(pd, k, v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v));
    body.append(pd);
  }
  const q = { sld: null, use: null, next: null, machine: null };

  if (i < 0) {
    setTag('EMPTY', `This number was never issued (the numbering runs 1 to ${fmt(U.meta.max)}), so no file holds a line with this key.`);
    return questions(body, { sld: 'none yet: no line has this key.', use: 'nothing: the key was never issued.', next: 'not established: there is no line to follow.', machine: `input: key ${key} · output: none · source: numbered database ${U.meta.built_utc}` });
  }
  if (!U.ownerOf) {
    waitingKey = key;
    setTag('WAIT', 'the family index is still loading; this card fills in when it lands');
    return;
  }
  waitingKey = -1;
  const famIdx = U.ownerOf.get(key) || [];
  if (!famIdx.length) {
    setTag('EMPTY', 'No function family carries this line, so the numbered database records no file and commit for it and its text cannot be read from a pinned place.');
    return questions(body, {
      sld: 'none yet: the line belongs to no function family.',
      use: 'not established: no family, block or file is recorded for this line.',
      next: 'not established: with no family there is no recorded use or dependency.',
      machine: `input: key ${key} · output: none · ${fmt(chars)} characters in the numbered database (built ${U.meta.built_utc})`
    });
  }
  const fams = famIdx.map(f => U.families[f]);
  let chosen = opts.family != null ? fams.find(f => f.n === opts.family) : null;
  chosen ||= fams.find(f => f.block) || fams[0];

  /* family chooser */
  const famRow = el('div', 'cc-row');
  famRow.append(el('span', 'cc-grey', `${fmt(fams.length)} ${fams.length === 1 ? 'family carries' : 'families carry'} it · `));
  if (fams.length > 1) {
    const sel = el('select', 'cc-select'); sel.setAttribute('aria-label', 'family');
    for (const f of fams.slice(0, 60)) { const o = el('option', null, `#${f.n} ${f.name}${f.block ? ' · ' + f.block : ''}`); o.value = f.n; if (f === chosen) o.selected = true; sel.append(o); }
    sel.addEventListener('change', () => openLine(key, { ...opts, family: Number(sel.value), place: 0 }));
    famRow.append(sel);
    if (fams.length > 60) famRow.append(el('span', 'cc-small', ` first 60 of ${fmt(fams.length)}`));
  } else famRow.append(el('span', 'cc-amber', `#${chosen.n} ${chosen.name}`));
  body.append(famRow);

  const onWait = () => setTag('WAIT', 'queued behind other fetches (two at a time)…');
  setTag('LOAD', `reading family #${chosen.n}'s record from the modular star…`);
  let fr, reg = null;
  try { [fr, reg] = await Promise.all([familyRecord(chosen.n, onWait), register().catch(() => null)]); }
  catch (e) { setTag('FAIL', 'Could not read the family record: ' + e.message); return; }
  if (!live()) return;
  if (fr.missing) { setTag('EMPTY', 'No place is recorded: ' + fr.missing + '.'); return; }
  const rec = fr.rec;
  const block = chosen.block && reg ? reg.get(chosen.block) : null;
  const places = rec.places || [];
  if (!places.length) { setTag('EMPTY', `Family #${chosen.n} records no place in any file.`); return; }
  const pi = Math.min(opts.place ?? 0, places.length - 1);
  const pl = places[pi];
  const at = [];
  rec.lines.forEach((k, j) => { if (k === key) at.push(j); });

  const meta = el('dl', 'cc-dl');
  row(meta, 'family', `#${chosen.n} ${(rec.names || [chosen.name]).join(', ')} · ${chosen.kind}${chosen.category ? ' · ' + chosen.category : ''}`);
  row(meta, 'block', chosen.block ? `${chosen.block}${block ? ' · ' + block.title : ' · not found in the live register'}` : 'none: no block in the register names this family');
  const app = row(meta, 'app', pl.repo);
  if (pl.live) { app.append(' · '); app.append(link(pl.live, 'live page')); }
  if (places.length > 1) {
    const sel = el('select', 'cc-select'); sel.setAttribute('aria-label', 'place');
    places.slice(0, 40).forEach((p, j) => { const o = el('option', null, `${j + 1}. ${p.repo.split('/')[1]} · ${p.path}`); o.value = j; if (j === pi) o.selected = true; sel.append(o); });
    sel.addEventListener('change', () => openLine(key, { ...opts, family: chosen.n, place: Number(sel.value) }));
    row(meta, 'place', sel, places.length > 40 ? ` first 40 of ${places.length}` : ` ${places.length} places`);
  }
  body.append(meta);

  if (!at.length) {
    setTag('EMPTY', `Family #${chosen.n}'s record does not list line ${key} among its ${rec.lines.length} lines, although the family pack says it carries it. That disagreement is shown, not smoothed over.`);
    return;
  }
  const fileLine = pl.first + at[0];
  setTag('LOAD', `fetching ${pl.path} at ${pl.commit.slice(0, 7)}…`);
  let lines;
  try { lines = await readSource(pl.repo, pl.commit, pl.path, onWait); }
  catch (e) { setTag('FAIL', 'Could not read the source: ' + e.message); return; }
  if (!live()) return;
  if (pl.last > lines.length) { setTag('FAIL', `The place record says lines ${pl.first}–${pl.last}, but the file at ${pl.commit.slice(0, 7)} has ${lines.length} lines.`); return; }

  const text = lines[fileLine - 1];
  const agree = chars === 65535 ? null : text.length === chars;
  let a = pl.first, b = pl.last;
  if (b - a + 1 > WINDOW_MAX) { a = Math.max(pl.first, fileLine - WINDOW_MAX / 2); b = Math.min(pl.last, a + WINDOW_MAX - 1); }

  const head = el('div', 'cc-codehead');
  head.append(`${pl.path} · ${pl.repo} @ ${pl.commit.slice(0, 7)} · line ${fileLine}` +
    (at.length > 1 ? ` (also at ${at.slice(1, 6).map(j => pl.first + j).join(', ')})` : '') +
    ` · function lines ${pl.first}–${pl.last}${a !== pl.first || b !== pl.last ? `, showing ${a}–${b}` : ''} · `);
  head.append(link(ghURL(pl.repo, pl.commit, pl.path, pl.first, pl.last), 'file at this commit on GitHub'));
  body.append(head);
  body.append(el('div', 'cc-check', agree === null
    ? `This line reaches the database's 16-bit length ceiling, so its length cannot confirm the match.`
    : agree ? `The text at line ${fileLine} is ${fmt(text.length)} characters, the length the numbered database holds for key ${key}.`
            : `Not confirmed: line ${fileLine} is ${fmt(text.length)} characters but the numbered database holds ${fmt(chars)} for key ${key}. Shown as read.`));

  const editor = codeWindow(lines, a, b, fileLine);
  body.append(editor.node);
  setTag('OK', `family #${chosen.n}, place ${pi + 1} of ${places.length}, at the commit the modular star pins`);
  requestAnimationFrame(() => editor.scrollToTarget());

  const engineModule = pl.repo === ENGINE_REPO && /^engine\/[A-Za-z0-9._-]+\.js$/.test(pl.path) ? pl.path : null;
  if (engineModule) body.append(runPanel(engineModule, pl, lines, editor, rec.names || []));

  /* the three questions and the machine detail, from the record and the source */
  const fnText = lines.slice(pl.first - 1, pl.last).join('\n');
  const who = (xs, verb) => xs?.length
    ? `${verb} ${xs.slice(0, 8).map(u => `#${u.family} ${u.name}`).join(', ')}${xs.length > 8 ? ` and ${xs.length - 8} more` : ''} (name-match inference by the modular star build: a needed name linked to the families defining it, ${[...new Set(xs.map(u => u.via || 'by name'))].join(' / ')})`
    : null;
  const sld = SLD[engineModule];
  let sldText;
  if (sld) {
    const src = lines.join('\n');
    const has = new RegExp(`export\\s+function\\s+${sld.fn}\\b`).test(src);
    const out = has ? outputsOf(functionBody(lines, sld.fn)) : [];
    sldText = has ? `${sld.element}: ${pl.path} → ${sld.fn}()${out.length ? ' returns ' + out.join('; ') : ''}. The page's module-to-element table, with the function checked present in this file at ${pl.commit.slice(0, 7)}.`
                  : `not established: ${sld.fn} is not exported by ${pl.path} at ${pl.commit.slice(0, 7)}.`;
  } else sldText = engineModule
    ? `none yet: ${pl.path} is an engine module this page does not map to a diagram element.`
    : `none yet: ${pl.path} in ${pl.repo} is not an engine module, and no diagram element is recorded for family #${chosen.n}.`;
  const dep = block?.depends_on?.length ? `the register's depends_on for block ${block.symbol}: ${block.depends_on.join(', ')}` : null;
  q.sld = sldText;
  q.use = `${block ? `block ${block.symbol} (${block.title})` : 'no block'} · function ${(rec.names || []).join(', ')} · ${pl.path} @ ${pl.commit.slice(0, 7)} in ${pl.repo}${rec.places.length > 1 ? `, and ${rec.places.length - 1} other places` : ''}. Called by: ${who(rec.used_by, '') || 'no caller is recorded in the family record'}.`;
  q.next = [who(rec.uses, 'It uses'), dep].filter(Boolean).join(' · ') || `not established: family #${chosen.n} records no uses and ${block ? `block ${block.symbol} declares no depends_on` : 'no block declares a dependency'}.`;
  q.machine = machineDetail(fnText, lines, pl);
  questions(body, q);
}

/* The code window. One <pre> holding one text node for the whole window, one
   highlight bar for the tapped line and one for the selected line. Tapping a
   row selects it; only the selected line is split into digit fields, in one
   strip below that is re-filled on every selection. Edits live in a Map for as
   long as this card is open. */
const DIGITS = /(?<![A-Za-z_$])\d+/g;
function codeWindow(lines, a, b, target) {
  const edits = new Map();              /* line -> string[] of digit-run values */
  const runs = n => [...lines[n - 1].matchAll(DIGITS)];
  const changedOn = n => { const v = edits.get(n); return !!v && runs(n).some((m, i) => v[i] !== m[0]); };
  const lineText = n => {
    const vals = edits.get(n);
    if (!vals) return lines[n - 1];
    let i = 0;
    return lines[n - 1].replace(DIGITS, m => { const v = vals[i++]; return v ?? m; });
  };
  let total = 0;
  for (let n = a; n <= b; n++) total += runs(n).length;

  const wrap = el('div', 'cc-codewrap');
  const pre = el('pre', 'cc-code');
  pre.setAttribute('aria-label', 'source code; tap a line to edit its digits');
  const text = document.createTextNode('');
  const hiTarget = el('div', 'cc-hi cc-hi-target'), hiSel = el('div', 'cc-hi cc-hi-sel');
  pre.append(hiTarget, hiSel, text);
  const paint = () => {
    const out = [];
    for (let n = a; n <= b; n++) out.push(String(n).padStart(4) + (changedOn(n) ? '*' : ' ') + ' ' + lineText(n));
    text.nodeValue = out.join('\n');
  };
  const lh = () => parseFloat(getComputedStyle(pre).lineHeight) || 16;
  const padTop = () => parseFloat(getComputedStyle(pre).paddingTop) || 0;
  const placeBar = (bar, n) => { bar.style.top = (padTop() + (n - a) * lh()) + 'px'; bar.style.height = lh() + 'px'; };

  const strip = el('div', 'cc-strip');
  const stripHead = el('div', 'cc-grey');
  const stripLine = el('div', 'cc-stripline');
  const note = el('div', 'cc-local');
  const nav = el('div', 'cc-nav');
  let sel = target;
  const refresh = () => {
    let changed = 0;
    for (const [n, v] of edits) runs(n).forEach((m, i) => { if (v[i] !== m[0]) changed++; });
    note.textContent = `${total} digit ${total === 1 ? 'run' : 'runs'} in this window · ${changed} changed · local edit, not saved, not published`;
  };
  function select(n) {
    sel = Math.max(a, Math.min(b, n));
    placeBar(hiSel, sel);
    const ms = runs(sel);
    stripHead.textContent = `line ${sel}` + (ms.length ? ` · ${ms.length} digit ${ms.length === 1 ? 'run' : 'runs'}` : ' · no digits on this line; tap another line or step to the next with digits');
    stripLine.replaceChildren();
    if (!edits.has(sel) && ms.length) edits.set(sel, ms.map(m => m[0]));
    const vals = edits.get(sel);
    let last = 0;
    const src = lines[sel - 1];
    ms.slice(0, MAX_FIELDS).forEach((m, i) => {
      if (m.index > last) stripLine.append(document.createTextNode(src.slice(last, m.index)));
      const inp = el('input', 'cc-digit');
      inp.value = vals[i]; inp.size = Math.max(1, vals[i].length);
      inp.setAttribute('inputmode', 'numeric'); inp.setAttribute('pattern', '[0-9]*'); inp.setAttribute('autocomplete', 'off');
      inp.setAttribute('aria-label', `digits ${m[0]} on line ${sel}`);
      inp.dataset.line = String(sel);
      inp.classList.toggle('cc-changed', vals[i] !== m[0]);
      inp.addEventListener('input', () => {
        const clean = inp.value.replace(/\D/g, '');
        if (clean !== inp.value) inp.value = clean;
        inp.size = Math.max(1, clean.length);
        vals[i] = clean;
        inp.classList.toggle('cc-changed', clean !== m[0]);
        inp.classList.toggle('cc-blank', clean === '');
        paint(); refresh();
      });
      stripLine.append(inp);
      last = m.index + m[0].length;
    });
    if (ms.length > MAX_FIELDS) stripLine.append(document.createTextNode(` … ${ms.length - MAX_FIELDS} more digit runs on this line are not offered`));
    else if (last < src.length) stripLine.append(document.createTextNode(src.slice(last)));
  }
  const step = dir => { for (let n = sel + dir; n >= a && n <= b; n += dir) if (runs(n).length) return select(n); };
  nav.append(btn('◀ digits', 'cc-mini', () => step(-1)), btn('digits ▶', 'cc-mini', () => step(1)),
    btn('reset digits', 'cc-mini', () => { edits.clear(); paint(); select(sel); refresh(); }));
  pre.addEventListener('click', e => {
    const y = e.clientY - pre.getBoundingClientRect().top + pre.scrollTop - padTop();
    select(a + Math.floor(y / lh()));
  });
  strip.append(stripHead, stripLine, nav, note);
  wrap.append(pre, strip);
  paint(); refresh();
  return {
    node: wrap,
    edits() {
      const out = [];
      for (const [n, v] of edits) {
        if (!changedOn(n)) continue;
        out.push({ line: n, before: lines[n - 1], after: lineText(n), blank: v.some(x => x === '') });
      }
      return out;
    },
    select,
    scrollToTarget() {
      placeBar(hiTarget, target); select(sel);
      pre.scrollTop = Math.max(0, (target - a) * lh() - pre.clientHeight / 3);
    }
  };
}

/* ── run with my edit ──────────────────────────────────────────────────────── */

function runPanel(path, pl, lines, editor, names) {
  const box = el('div', 'cc-run');
  const fx = FIXTURES[path];
  box.append(el('div', 'cc-sub', 'RUN THE MODULE'));
  if (!fx) {
    const t = el('span', 'cc-tag', 'EMPTY'); t.dataset.s = 'EMPTY';
    box.append(t, el('span', 'cc-grey', ` No proof fixture is wired to this page for ${path}. Runs are offered for ${Object.keys(FIXTURES).join(' and ')}, each with the first input its own proof uses.`));
    return box;
  }
  box.append(el('div', 'cc-grey', `Calls ${fx.fn}(${JSON.stringify(fx.input)}) — scenario input, the first fixture in ${fx.proof} — on ${path} at ${PIN.slice(0, 7)}, the commit the estate imports, in a worker with no network and a 2 s limit.`));
  if (!names.includes(fx.fn)) box.append(el('div', 'cc-local', `This window is ${names.join(', ')}; the run calls ${fx.fn}. An edit here changes the answer only if ${fx.fn} reaches it.`));
  const go = btn('RUN WITH MY EDIT', 'popup-btn popup-btn-images', () => run());
  const out = el('div', 'cc-results');
  box.append(go, out);

  async function run() {
    const mine = token;
    go.disabled = true;
    out.replaceChildren(el('div', 'cc-grey', 'reading the module, its imports and its proof at ' + PIN.slice(0, 7) + '…'));
    const urls = [];
    try {
      const edits = editor.edits();
      if (edits.some(e => e.blank)) throw refusal('A digit field is empty; an empty field is not a number, so nothing was run.');
      const [pinned, proof] = await Promise.all([
        readSource(ENGINE_REPO, PIN, path),
        cached(onceMap, rawURL(ENGINE_REPO, PIN, fx.proof), 'text')
      ]);
      if (!proof.replace(/\s+/g, ' ').includes(fx.evidence)) throw refusal(`The fixture was not found in ${fx.proof} at ${PIN.slice(0, 7)}, so this page will not claim it is the proof's input.`);
      /* carry each edited line onto the module as imported */
      const edited = pinned.slice();
      const placed = [];
      for (const e of edits) {
        let at = -1;
        if (pl.commit === PIN || pinned[e.line - 1] === e.before) at = e.line - 1;
        else {
          const hits = []; pinned.forEach((l, j) => { if (l === e.before) hits.push(j); });
          if (hits.length !== 1) throw refusal(`Line ${e.line} as shown (${pl.commit.slice(0, 7)}) appears ${hits.length} times in ${path} at ${PIN.slice(0, 7)}, so the edit cannot be placed without guessing.`);
          at = hits[0];
        }
        if (pinned[at] !== e.before) throw refusal(`Line ${e.line} differs at ${PIN.slice(0, 7)}; the edit was not applied.`);
        edited[at] = e.after; placed.push(`line ${e.line} → ${PIN.slice(0, 7)} line ${at + 1}`);
      }
      const deps = new Map();
      const origURL = await moduleURL(path, pinned.join('\n'), deps, urls, 0);
      const editURL = edits.length ? await moduleURL(path, edited.join('\n'), deps, urls, 0) : origURL;
      const [A, B] = await Promise.all([runIn(origURL, fx), edits.length ? runIn(editURL, fx) : null]);
      if (mine !== token) return;
      out.replaceChildren();
      out.append(el('div', 'cc-grey', edits.length ? `${edits.length} edited ${edits.length === 1 ? 'line' : 'lines'} applied: ${placed.join('; ')}.` : 'No digit changed: both columns are the same published text, so the one run is shown twice.'));
      const grid = el('div', 'cc-cols');
      grid.append(result('as published @ ' + PIN.slice(0, 7), A), result(edits.length ? 'with your edit (local)' : 'with your edit (none made)', B ?? A));
      out.append(grid, el('div', 'cc-disclaimer', DISCLAIMER));
    } catch (e) {
      if (mine !== token) return;
      out.replaceChildren(el('div', 'cc-refuse', e.refusal ? e.message : 'Could not run: ' + e.message));
    } finally {
      for (const u of urls) URL.revokeObjectURL(u);
      go.disabled = false;
    }
  }
  return box;
}
const refusal = m => Object.assign(new Error(m), { refusal: true });

/* A module's text as a Blob URL, its relative imports read at PIN and rewritten
   to Blob URLs of their own. Anything that would reach the network is refused. */
async function moduleURL(path, text, deps, urls, depth) {
  if (depth > 6) throw refusal('The import chain is deeper than six modules; not run.');
  if (/\bimport\s*\(/.test(text)) throw refusal(`${path} uses a dynamic import(), which could reach the network; not run.`);
  const specRe = /(\b(?:import|export)\b[^'";]*?\bfrom\s*|\bimport\s*)(['"])([^'"]+)\2/g;
  const specs = [...text.matchAll(specRe)].map(m => m[3]);
  const map = new Map();
  for (const s of new Set(specs)) {
    if (!s.startsWith('./') && !s.startsWith('../')) throw refusal(`${path} imports "${s}", which is not a file of this repository; not run.`);
    const target = new URL(s, 'https://x/' + path).pathname.slice(1);
    if (!deps.has(target)) {
      const t = (await readSource(ENGINE_REPO, PIN, target)).join('\n');
      deps.set(target, await moduleURL(target, t, deps, urls, depth + 1));
    }
    map.set(s, deps.get(target));
  }
  const rewritten = text.replace(specRe, (all, pre, q, s) => pre + q + map.get(s) + q);
  const u = URL.createObjectURL(new Blob([rewritten], { type: 'text/javascript' }));
  urls.push(u);
  return u;
}

const WORKER_SRC = `
const refuse = () => { throw new Error('network access is refused inside this run'); };
for (const k of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'Request', 'navigator']) {
  try { Object.defineProperty(self, k, { value: refuse, configurable: false, writable: false }); } catch (e) { try { self[k] = refuse; } catch (e2) {} }
}
self.onmessage = async ({ data }) => {
  try {
    const m = await import(data.url);
    if (typeof m[data.fn] !== 'function') { postMessage({ ok: false, kind: 'NotExported', message: 'the module exports no function named ' + data.fn }); return; }
    const r = m[data.fn](data.input);
    postMessage({ ok: true, result: JSON.parse(JSON.stringify(r)) });
  } catch (e) {
    postMessage({ ok: false, kind: (e && e.name) || 'Error', message: String(e && e.message !== undefined ? e.message : e) });
  }
};`;

function runIn(url, fx) {
  return new Promise(resolve => {
    const wurl = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
    let w;
    const done = r => { clearTimeout(timer); try { w?.terminate(); } catch (e) {} URL.revokeObjectURL(wurl); resolve(r); };
    const timer = setTimeout(() => done({ ok: false, kind: 'Stopped', message: `stopped after ${RUN_MS / 1000} s without an answer` }), RUN_MS);
    try { w = new Worker(wurl, { type: 'module' }); }
    catch (e) { done({ ok: false, kind: 'NoWorker', message: 'this browser would not start a module worker: ' + e.message }); return; }
    w.onmessage = e => done(e.data);
    w.onerror = e => { e.preventDefault?.(); done({ ok: false, kind: 'SyntaxOrLoadError', message: e.message || 'the edited module could not be loaded (a syntax error, or an import that failed)' }); };
    w.postMessage({ url, fn: fx.fn, input: fx.input });
  });
}

function result(label, r) {
  const col = el('div', 'cc-col');
  col.append(el('div', 'cc-sub', label));
  if (!r.ok) {
    col.append(el('div', 'cc-refuse', `${r.kind}: ${r.message}`));
    col.dataset.value = 'refused';
    return col;
  }
  const v = r.result;
  const head = v && typeof v === 'object' && 'value' in v ? `${v.value} ${v.unit ?? ''}`.trim() : JSON.stringify(v);
  col.dataset.value = v && typeof v === 'object' && 'value' in v ? String(v.value) : head;
  col.append(el('div', 'cc-value', head));
  if (v?.quantity) col.append(el('div', 'cc-grey', v.quantity));
  const pre = el('pre', 'cc-json', JSON.stringify(v, null, 1));
  col.append(pre);
  return col;
}

/* ── the machine detail: read from the source text ─────────────────────────── */

const UNIT_SUFFIX = [
  ['OhmPerKm', 'ohm per kilometre'], ['Kwh', 'kilowatt-hours'], ['Mwh', 'megawatt-hours'], ['Gwh', 'gigawatt-hours'], ['Twh', 'terawatt-hours'],
  ['Kvar', 'kilovolt-amperes reactive'], ['Mva', 'megavolt-amperes'], ['Kva', 'kilovolt-amperes'], ['Va', 'volt-amperes'],
  ['Kw', 'kilowatts'], ['Mw', 'megawatts'], ['Gw', 'gigawatts'], ['Kv', 'kilovolts'], ['Km2', 'square kilometres'], ['Km', 'kilometres'],
  ['Gbp', 'pounds sterling'], ['Percent', 'percent'], ['Hz', 'hertz'], ['Deg', 'degrees'], ['M', 'metres'], ['A', 'amperes'], ['V', 'volts'], ['W', 'watts']
];
const WHOLE_NAME = { mva: 'megavolt-amperes', kv: 'kilovolts', kw: 'kilowatts', mw: 'megawatts', kva: 'kilovolt-amperes', hours: 'hours', lat: 'degrees', lon: 'degrees' };
function unitOf(name) {
  if (WHOLE_NAME[name]) return WHOLE_NAME[name];
  for (const [s, u] of UNIT_SUFFIX) if (name.length > s.length && name.endsWith(s) && /[a-z0-9]/.test(name[name.length - s.length - 1])) return u;
  return null;
}
function functionBody(lines, fn) {
  const start = lines.findIndex(l => new RegExp(`function\\s+${fn}\\b`).test(l));
  if (start < 0) return '';
  let depth = 0, seen = false;
  for (let j = start; j < lines.length; j++) {
    for (const c of lines[j].replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '')) { if (c === '{') { depth++; seen = true; } else if (c === '}') depth--; }
    if (seen && depth <= 0) return lines.slice(start, j + 1).join('\n');
  }
  return lines.slice(start).join('\n');
}
function outputsOf(text) {
  const out = [];
  for (const m of text.matchAll(/quantity:\s*'([^']+)'[\s\S]{0,120}?unit:\s*'([^']*)'/g)) out.push(`${m[1]} in ${m[2]}`);
  return [...new Set(out)];
}
function machineDetail(fnText, lines, pl) {
  const sig = fnText.match(/function\s*\*?\s*[\w$]*\s*\(([\s\S]*?)\)\s*\{/) || fnText.match(/\(([^()]*)\)\s*=>/);
  let inputs = 'no parameter list read from this window';
  if (sig) {
    const names = sig[1].replace(/[{}\[\]]/g, '').split(',').map(p => p.split('=')[0].split(':').pop().trim()).filter(p => /^[A-Za-z_$][\w$]*$/.test(p));
    inputs = names.length ? names.map(n => { const u = unitOf(n); return u ? `${n} (${u})` : `${n} (no unit in the name)`; }).join(', ') : 'none';
  }
  const outs = outputsOf(fnText);
  const throws = [...new Set([...fnText.matchAll(/throw\s+new\s+(\w+)/g)].map(m => m[1]))];
  const src = lines.join('\n');
  const nc = src.match(/export\s+const\s+NOT_COMPUTED\s*=\s*Object\.freeze\(\{([\s\S]*?)\n\}\);/);
  const ncKeys = nc ? [...nc[1].matchAll(/^\s{2,8}([A-Za-z_$][\w$]*)\s*:/gm)].map(m => m[1]) : [];
  const other = [...src.matchAll(/export\s+const\s+(NOT_[A-Z_]+|NO_[A-Z_]+|NEVER_[A-Z_]+)\s*=/g)].map(m => m[1]).filter(n => n !== 'NOT_COMPUTED' || !nc);
  return `inputs: ${inputs} (units read from parameter name suffixes, name-match inference) · outputs: ${outs.length ? outs.join('; ') : 'no quantity/unit fields in this function'} · refusals: ${throws.length ? 'throws ' + throws.join(', ') : 'no throw in this function'}${ncKeys.length ? ' · NOT_COMPUTED: ' + ncKeys.join(', ') : ''}${other.length ? ' · also ' + other.join(', ') : ''} · source ${pl.repo} ${pl.path} @ ${pl.commit}`;
}

function questions(body, q) {
  const d = el('details', 'cc-q');
  if (window.matchMedia('(min-width: 760px)').matches) d.open = true;
  d.append(el('summary', null, 'Questions'));
  const dl = el('dl', 'cc-dl');
  row(dl, 'draws', q.sld);
  row(dl, 'used for', q.use);
  row(dl, 'leads to', q.next);
  d.append(el('div', 'cc-small', '1 how does this help draw a system or single-line diagram · 2 what is this code used for, and who calls it · 3 where does it lead next'), dl);
  const m = el('div', 'cc-machine'); m.append(el('span', 'cc-sub', 'Machine detail '), document.createTextNode(q.machine));
  d.append(m);
  body.append(d);
}

/* ── a route ───────────────────────────────────────────────────────────────── */

async function openRoute(layer, f) {
  const keys = f.geometry.keys || [];
  mark = { kind: 'route', keys }; draw();
  const p = f.properties || {};
  const { body, setTag, live } = sheet(layer.label, ` route · ${fmt(keys.length)} stops`);
  const dl = el('dl', 'cc-dl');
  const module = [p.block && `block ${p.block}`, p.function && `function ${p.function}`, p.family != null && `family #${p.family}`, p.module_path].filter(Boolean).join(' · ');
  row(dl, 'module', module || 'the route names no module');
  const first = keys[0], last = keys[keys.length - 1];
  row(dl, 'first line', btn(fmt(first), 'cc-key', () => openLine(first, { family: p.family })));
  row(dl, 'last line', btn(fmt(last), 'cc-key', () => openLine(last, { family: p.family })));
  for (const [k, v] of Object.entries(p)) if (!['block', 'function', 'family'].includes(k)) row(dl, k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  body.append(dl);
  const stops = el('div', 'cc-stops');
  stops.append(el('div', 'cc-sub', 'STOPS, IN ROUTE ORDER'));
  const shownStops = keys.slice(0, 400);
  stops.append(el('div', 'cc-stoplist', shownStops.map((k, j) => `${j + 1}:${k}`).join('  ') + (keys.length > 400 ? `  … and ${fmt(keys.length - 400)} more` : '')));
  const pick = el('input', 'cc-pick'); pick.setAttribute('inputmode', 'numeric'); pick.setAttribute('aria-label', 'stop number'); pick.value = '1';
  const openStop = btn('OPEN STOP', 'cc-mini', () => {
    const j = Number(pick.value.replace(/\D/g, '')) - 1;
    if (j >= 0 && j < keys.length) openLine(keys[j], { family: p.family });
    else pick.value = '1';
  });
  const pr = el('div', 'cc-row'); pr.append(el('span', 'cc-grey', `stop 1 to ${keys.length}: `), pick, openStop);
  stops.append(pr);
  body.append(stops, el('div', 'cc-small', 'evidence: ' + (layer.evidence ?? 'none recorded') + ' · tap a stop to open its code card'));

  if (p.family == null) {
    setTag('OK', 'the route as the layer draws it');
    return questions(body, { sld: 'none yet: this route names no family.', use: `drawn by the layer ${layer.id}; it names no module.`, next: 'not established: the route names no family to follow.', machine: `input: ${fmt(keys.length)} keys · output: a polyline through their placements · source: layers/${layer.id}` });
  }
  setTag('LOAD', `reading family #${p.family}'s record…`);
  let fr, reg;
  try { [fr, reg] = await Promise.all([familyRecord(p.family, () => setTag('WAIT', 'queued behind other fetches…')), register().catch(() => null)]); }
  catch (e) { setTag('FAIL', 'Could not read the family record: ' + e.message); return; }
  if (!live()) return;
  if (fr.missing) { setTag('EMPTY', fr.missing); return; }
  const rec = fr.rec, pl = rec.places?.[0], block = p.block && reg ? reg.get(p.block) : null;
  if (pl) {
    const h = el('div', 'cc-codehead');
    h.append(`${pl.path} · ${pl.repo} @ ${pl.commit.slice(0, 7)} · lines ${pl.first}–${pl.last} · `, link(ghURL(pl.repo, pl.commit, pl.path, pl.first, pl.last), 'on GitHub'));
    body.insertBefore(h, stops);
  }
  const sld = pl ? SLD[pl.path] : null;
  setTag('OK', `family #${p.family}: ${(rec.names || []).join(', ')}`);
  questions(body, {
    sld: sld && pl.repo === ENGINE_REPO ? `${sld.element}: ${pl.path} → ${sld.fn}(). The page's module-to-element table; open a stop to see the function checked in its source.` : `none yet: ${pl ? pl.path : 'this family'} is not mapped to a diagram element.`,
    use: `${block ? `block ${block.symbol} (${block.title})` : 'no block in the register'} · function ${(rec.names || []).join(', ')}${pl ? ` · ${pl.path} @ ${pl.commit.slice(0, 7)}` : ''} · called by: ${rec.used_by?.length ? rec.used_by.slice(0, 8).map(u => `#${u.family} ${u.name}`).join(', ') + ' (name-match inference)' : 'no caller recorded'}.`,
    next: rec.uses?.length ? `uses ${rec.uses.slice(0, 8).map(u => `#${u.family} ${u.name} (${u.via})`).join(', ')} (name-match inference)` : `not established: family #${p.family} records no uses${block?.depends_on?.length ? '' : ' and its block declares no depends_on'}.`,
    machine: `route: ${fmt(keys.length)} keys from ${fmt(first)} to ${fmt(last)}, ${p.route ?? 'order as stored in the layer'} · family lines in the record: ${rec.lines.length}${pl ? ` · source ${pl.repo} ${pl.path} @ ${pl.commit}` : ''}`
  });
}

/* ── empty ground ──────────────────────────────────────────────────────────── */

/* The tile scheme is owned by layers-panel.mjs (its tile rule and fetch queue);
   the card asks it rather than reading a manifest field no layer carries. */
async function tileBandWidth() {
  const f = window.__layers?.tileScheme;
  return f ? f() : null;
}

async function openArea(wx, wy, near, zoom) {
  mark = { kind: 'point', x: wx, y: wy, key: near?.key ?? -1 }; draw();
  const r = Math.hypot(wx, wy) / SPACING;
  const b = Math.floor(r);
  const k0 = b * b, k1 = (b + 1) * (b + 1);
  const { body, setTag, live } = sheet('Empty ground', ` radius ${r.toFixed(2)} · no line within ${REACH} px`);
  const dl = el('dl', 'cc-dl');
  row(dl, 'point', `x ${wx.toFixed(2)}, y ${wy.toFixed(2)} in wafer units`);
  row(dl, 'ring', `r = sqrt(key) puts radius ${b} to ${b + 1} at keys ${fmt(k0)} to ${fmt(k1 - 1)} · ${fmt(issuedIn(k0, k1))} of those ${fmt(k1 - k0)} numbers were issued`);
  const bandDD = row(dl, 'tile band', 'reading the tile scheme…');
  if (near) {
    const dd = row(dl, 'nearest line', btn(fmt(near.key), 'cc-key', () => openLine(near.key)));
    dd.append(` · ${near.d.toFixed(2)} units away, ${(near.d * zoom).toFixed(0)} px at this zoom · ${(U.ownerOf?.get(near.key) || []).length} ${(U.ownerOf?.get(near.key) || []).length === 1 ? 'family' : 'families'}`);
  }
  body.append(dl);
  setTag('OK', 'computed from the placement law and the issued keys');
  questions(body, {
    sld: 'none yet: empty ground draws nothing.',
    use: `nothing: no issued line sits within ${REACH} px of this point.`,
    next: near ? `the nearest issued line, ${fmt(near.key)}; tap its number for its code card.` : 'not established: no issued line was found.',
    machine: `input: a tap at wafer x ${wx.toFixed(2)}, y ${wy.toFixed(2)} · output: radius ${r.toFixed(3)} and key range [${k0}, ${k1}) from r = sqrt(key) · source: numbered database built ${U.meta.built_utc}`
  });
  try {
    const t = await tileBandWidth();
    if (!live()) return;
    if (!t) { bandDD.textContent = 'EMPTY: no layer in the manifest is tiled, so no tile band scheme is published'; return; }
    const tb = Math.floor(Math.floor(Math.sqrt(Math.max(0, Math.floor(r * r)))) / t.S);
    const a = (tb * t.S) ** 2, z = ((tb + 1) * t.S) ** 2;
    bandDD.textContent = `band ${tb} of the layer tiles (${t.law}, S = ${t.S}, read from ${t.path}): keys ${fmt(a)} to ${fmt(z - 1)} · ${fmt(issuedIn(a, z))} issued`;
  } catch (e) { if (live()) bandDD.textContent = 'FAIL: could not read the tile scheme: ' + e.message; }
}

window.__codecard = Object.freeze({
  get open() { return !$('card').hidden; },
  get fetches() { return fetchCount; },
  get cachedSources() { return sources.size; },
  get cachedBuckets() { return buckets.size; },
  openLine: (k, o) => openLine(k, o)
});

/* ── URL state: the whole of it, in permanent numbers ────────────────────── */

function readURL() {
  const q = new URLSearchParams(location.search);
  const pa = parseKey(q.get('line') ?? ''), pb = parseKey(q.get('to') ?? '');
  if (!pa.ok) { if (q.get('line')) refuse(`The link carried a line number this page cannot use: ${pa.why}.`); return; }
  $('a').value = String(pa.key);
  const rawTo = q.get('to');
  if (pb.ok) { $('b').value = String(pb.key); view.link = [pa.key, pb.key]; connect(pa.key, pb.key); }
  else if (rawTo !== null && rawTo.trim() !== '') {
    /* focus stays unset: tier 2 repaints the panel for a focused key when it
       lands, which would silently replace this refusal with an ordinary card. */
    refuse(`The link asked to connect to "${rawTo}", which is not a line number: ${pb.why}. `
         + `Line ${pa.key} is where the beam is pointing.`);
    flyTo(pa.key);
  }
  else { view.focus = pa.key; paintPanel(pa.key); flyTo(pa.key); }
}

/* One refusal path, so a bad number is always visible rather than ignored. */
function refuse(sentence) {
  $('panelbody').replaceChildren();
  const h = document.createElement('h2'); h.textContent = 'Refused';
  const p2 = document.createElement('p'); p2.className = 'refuse'; p2.textContent = sentence;
  $('panelbody').append(h, p2);
  $('panel').hidden = false;
}
/* Keeps the parameters other parts of the page own (layers, ground). The root
   version rebuilt the query from line and to alone, so flying to a line dropped
   the ticked layers from the link; iterations/21-dark-pixels/app.mjs fixed it. */
function writeURL(a, b) {
  const q = new URLSearchParams(location.search);
  q.delete('line'); q.delete('to');
  if (a) q.set('line', String(a));
  if (b) q.set('to', String(b));
  const text = q.toString().replace(/%2C/gi, ',');
  history.replaceState(null, '', text ? '?' + text : location.pathname);
}

/* The dark-ground toggle: off unless the reader ticks it or the link says ground=dark. */
function setGround(dark) {
  GROUND.dark = !!dark;
  cache.valid = false;
  const box = $('darkGround');
  if (box && box.checked !== GROUND.dark) box.checked = GROUND.dark;
  document.body.classList.toggle('dark-ground', GROUND.dark);
  const q = new URLSearchParams(location.search);
  if (GROUND.dark) q.set('ground', 'dark'); else q.delete('ground');
  const text = q.toString().replace(/%2C/gi, ',');
  const next = location.pathname + (text ? '?' + text : '') + location.hash;
  if (next !== location.pathname + location.search + location.hash) history.replaceState(history.state, '', next);
  draw();
}

/* ── start ───────────────────────────────────────────────────────────────── */

(async function start() {
  try {
    await tier1();
  } catch (e) {
    $('count').textContent = 'Could not load the numbered database: ' + e.message
      + '. Check the internet connection and reload.';
    return;
  }
  resize();
  try { initGL(); } catch (e) {
    ctx2d = stage.getContext('2d');
    $('hint').textContent = 'GPU not available: drawn without animation';
  }
  home();
  gestures();
  if (new URLSearchParams(location.search).get('ground') === 'dark') setGround(true);
  $('darkGround')?.addEventListener('change', e => setGround(e.target.checked));
  window.addEventListener('resize', () => { resize(); draw(); });

  $('beam').addEventListener('submit', e => {
    e.preventDefault();
    const pa = parseKey($('a').value), pb = parseKey($('b').value);
    if (!pa.ok) { refuse(`That is not a line number: ${pa.why}.`); return; }
    if ($('b').value.trim() && !pb.ok) { refuse(`Second number: ${pb.why}.`); return; }
    closeCard();
    if (pb.ok) { view.focus = -1; connect(pa.key, pb.key); writeURL(pa.key, pb.key); }
    else { view.focus = pa.key; view.link = null; paintPanel(pa.key); flyTo(pa.key); writeURL(pa.key, null); }
    document.activeElement?.blur();
  });
  $('close').addEventListener('click', () => { $('panel').hidden = true; view.focus = -1; view.link = null; draw(); });

  readURL();
  tier2().catch(e => { $('prov').textContent = 'family index unavailable: ' + e.message; });
})();
