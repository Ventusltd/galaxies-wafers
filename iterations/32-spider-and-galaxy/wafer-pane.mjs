/* wafer-pane.mjs — the dark wafer of iteration 21, drawn inside a pane instead
 * of the whole window.
 *
 * Kept from 21-dark-pixels: the numbered database (tier 1 only), the frozen
 * placement r = sqrt(key), theta = key x golden angle (lib.mjs place/placeAll),
 * the near-black ground shader, the 2D fallback, the Grid Atlas point recipe for
 * woken lines (11kV radius stops, black casing, glow from atlas zoom 13.5, atlas
 * zoom = 8 + log2(pixels per unit)).
 *
 * Changed: the canvases size to the pane; the camera is this module's own; the
 * lines to wake are handed in by the page (wake/unwake) rather than by a layers
 * panel.
 *
 * LOADING, AS GRID ATLAS DOES IT, WITH INFINITY KEPT OUT OF ONE FRAME.
 * The ground is one GPU draw call over every numbered line. Woken lines are
 * drawn on a 2D overlay under two stated limits:
 *   BAND  a woken line is considered only when its radius sqrt(key) lies in the
 *         band of radii the pane can currently see (a key range, since r is a
 *         function of the key alone); every other woken line costs one compare.
 *   CAP   at most MAX_DRAWN woken lines are drawn in one frame; the footer says
 *         when the cap is reached.
 */
import { place, placeAll, SPACING, fmt } from '../../lib.mjs';

export const DATA = 'https://globalgrid2050.com/testcode/202609142202/data/';
export const MAX_DRAWN = 20000;

const VS = `#version 300 es
precision highp float;
in vec2 a_pos; in float a_len; in float a_fam;
uniform vec2 u_res; uniform vec2 u_cam; uniform float u_zoom; uniform float u_dpr;
out float v_fam;
void main(){
  vec2 p = (a_pos - u_cam) * u_zoom;
  gl_Position = vec4(p / (u_res * 0.5), 0.0, 1.0);
  float base = 1.0 + min(a_len, 120.0) * 0.012;
  gl_PointSize = clamp(base * sqrt(u_zoom) * u_dpr, 1.0, 26.0 * u_dpr);
  v_fam = a_fam;
}`;
const FS = `#version 300 es
precision highp float;
in float v_fam;
out vec4 o;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  if (r > 0.5) discard;
  float edge = smoothstep(0.5, 0.42, r);
  vec3 carried = vec3(0.16, 0.18, 0.23);
  vec3 alone   = vec3(0.09, 0.10, 0.13);
  o = vec4(mix(alone, carried, v_fam), edge * (0.45 + 0.30 * v_fam));
}`;

const RADIUS = [[6, 2.5], [10, 3], [13.5, 4], [15, 8], [18, 18]];
const CASING = [[13.5, 1], [15, 2]];
const OPACITY = [[6, 0.7], [13.5, 0.9]];
function interp(stops, x) {
  if (x <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [x1, y1] = stops[i];
    if (x <= x1) { const [x0, y0] = stops[i - 1]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  }
  return stops[stops.length - 1][1];
}

export function createWafer(pane, { onTap, onStatus, onFrame }) {
  const ground = document.createElement('canvas');
  const over = document.createElement('canvas');
  ground.className = 'wground'; over.className = 'wover';
  pane.append(ground, over);
  let stage = ground;

  const U = { keys: null, lens: null, inFam: null, pos: null, n: 0, meta: null };
  const view = { x: 0, y: 0, zoom: 1, w: 0, h: 0, dpr: 1 };
  /* woken sets: id -> {colour, pts Float32Array(2n), r Float32Array(n), keys Uint32Array, props[]} */
  const woken = new Map();
  let picked = null;           /* {set, i} */
  const stats = { drawn: 0, inBand: 0, total: 0, capped: false, frameMs: 0 };

  let gl = null, prog = null, loc = {}, ctx2d = null;

  async function load() {
    const bin = async (name, Kind) => {
      const r = await fetch(DATA + name, { cache: 'default' });
      if (!r.ok) throw new Error(DATA + name + ' returned HTTP ' + r.status);
      return new Kind(await r.arrayBuffer());
    };
    const [meta, keys, lens, inFam] = await Promise.all([
      fetch(DATA + 'all-lines.meta.json').then(r => { if (!r.ok) throw new Error('all-lines.meta.json HTTP ' + r.status); return r.json(); }),
      bin('all-lines.bin', Uint32Array), bin('all-lines.len.bin', Uint16Array), bin('all-lines.family.bin', Uint8Array)
    ]);
    Object.assign(U, { meta, keys, lens, inFam, n: keys.length, pos: placeAll(keys) });
    resize(); initGL(); home(); gestures();
    new ResizeObserver(() => { resize(); draw(); }).observe(pane);
    return meta;
  }

  function compile(type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function initGL() {
    gl = stage.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) return fallback2d();
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      for (const u of ['u_res', 'u_cam', 'u_zoom', 'u_dpr']) loc[u] = gl.getUniformLocation(prog, u);
      gl.bindVertexArray(gl.createVertexArray());
      const put = (data, name, size, Kind) => {
        const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        const l = gl.getAttribLocation(prog, name);
        if (l < 0) return;
        gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, Kind, false, 0, 0);
      };
      put(U.pos, 'a_pos', 2, gl.FLOAT); put(U.lens, 'a_len', 1, gl.UNSIGNED_SHORT); put(U.inFam, 'a_fam', 1, gl.UNSIGNED_BYTE);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      resize();
    } catch (e) { console.warn('WebGL setup failed, falling back:', e.message); fallback2d(); }
  }
  function fallback2d() {
    gl = null;
    const fresh = stage.cloneNode(false); stage.replaceWith(fresh); stage = fresh;
    ctx2d = stage.getContext('2d');
    onStatus?.(ctx2d ? 'drawn without the GPU: at low zoom one line in seven is plotted' : 'this browser gave neither a GPU nor a 2D canvas');
    resize();
  }

  function resize() {
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.w = pane.clientWidth; view.h = pane.clientHeight;
    for (const c of [stage, over]) {
      const W = Math.max(1, Math.round(view.w * view.dpr)), H = Math.max(1, Math.round(view.h * view.dpr));
      if (c.width !== W) c.width = W;
      if (c.height !== H) c.height = H;
    }
    if (gl) gl.viewport(0, 0, stage.width, stage.height);
  }

  function home() {
    view.x = 0; view.y = 0;
    view.zoom = Math.min(view.w, view.h) / (SPACING * Math.sqrt(U.meta.max) * 2.15);
    draw();
  }

  let pending = false;
  function draw() { if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; render(); }); } }

  function render() {
    if (!U.n) return;
    const t0 = performance.now();
    if (gl) {
      gl.clearColor(0.012, 0.014, 0.020, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(loc.u_res, stage.width, stage.height);
      gl.uniform2f(loc.u_cam, view.x, view.y);
      gl.uniform1f(loc.u_zoom, view.zoom * view.dpr);
      gl.uniform1f(loc.u_dpr, view.dpr);
      gl.drawArrays(gl.POINTS, 0, U.n);
    } else if (ctx2d) {
      const c = ctx2d; c.setTransform(1, 0, 0, 1, 0, 0);
      c.fillStyle = '#030406'; c.fillRect(0, 0, stage.width, stage.height);
      c.fillStyle = '#1e222c';
      const step = view.zoom < 0.5 ? 7 : 1;
      for (let i = 0; i < U.n; i += step) {
        const x = (U.pos[i * 2] - view.x) * view.zoom * view.dpr + stage.width / 2;
        const y = stage.height / 2 - (U.pos[i * 2 + 1] - view.y) * view.zoom * view.dpr;
        if (x < 0 || y < 0 || x > stage.width || y > stage.height) continue;
        c.fillRect(x, y, view.dpr, view.dpr);
      }
    }
    drawWoken();
    stats.frameMs = performance.now() - t0;
    onFrame?.(stats);
  }

  /* The band of radii the pane can see: the nearest and farthest distance from
     the origin to any point of the visible world rectangle. */
  function visibleBand(padWorld) {
    const hw = view.w / 2 / view.zoom + padWorld, hh = view.h / 2 / view.zoom + padWorld;
    const x0 = view.x - hw, x1 = view.x + hw, y0 = view.y - hh, y1 = view.y + hh;
    const nx = Math.max(x0, Math.min(0, x1)), ny = Math.max(y0, Math.min(0, y1));
    const rMin = Math.hypot(nx, ny);
    const rMax = Math.hypot(Math.max(Math.abs(x0), Math.abs(x1)), Math.max(Math.abs(y0), Math.abs(y1)));
    return [rMin, rMax];
  }

  function drawWoken() {
    const c = over.getContext('2d');
    c.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    c.clearRect(0, 0, view.w, view.h);
    const az = 8 + Math.log2(view.zoom);
    const rad = interp(RADIUS, az), cas = interp(CASING, az), op = interp(OPACITY, az);
    const z = view.zoom, ox = view.w / 2 - view.x * z, oy = view.h / 2 + view.y * z;
    const pad = rad * 2.4 + 2;
    const [rMin, rMax] = visibleBand(pad / z);
    let drawn = 0, inBand = 0, total = 0, capped = false;
    for (const [, S] of woken) {
      total += S.n;
      const glow = az >= 13.5, glowPath = glow ? new Path2D() : null;
      const casePath = new Path2D(), fillPath = new Path2D();
      let shown = 0;
      for (let i = 0; i < S.n; i++) {
        const r = S.r[i];
        if (r < rMin || r > rMax) continue;          /* outside the visible band */
        inBand++;
        const x = S.pts[i * 2] * z + ox, y = oy - S.pts[i * 2 + 1] * z;
        if (x < -pad || y < -pad || x > view.w + pad || y > view.h + pad) continue;
        if (drawn >= MAX_DRAWN) { capped = true; break; }
        drawn++; shown++;
        if (glow) { glowPath.moveTo(x + rad * 2.4, y); glowPath.arc(x, y, rad * 2.4, 0, 6.2832); }
        casePath.moveTo(x + rad + cas, y); casePath.arc(x, y, rad + cas, 0, 6.2832);
        fillPath.moveTo(x + rad, y); fillPath.arc(x, y, rad, 0, 6.2832);
      }
      if (shown) {
        if (glow) { c.globalAlpha = 0.15; c.fillStyle = S.colour; c.fill(glowPath); }
        c.globalAlpha = 1; c.fillStyle = '#000'; c.fill(casePath);
        c.globalAlpha = op; c.fillStyle = S.colour; c.fill(fillPath);
      }
    }
    c.globalAlpha = 1;
    if (picked && woken.get(picked.set)) {
      const S = woken.get(picked.set);
      const x = S.pts[picked.i * 2] * z + ox, y = oy - S.pts[picked.i * 2 + 1] * z;
      c.strokeStyle = '#ffd54a'; c.lineWidth = 1.4;
      c.beginPath(); c.arc(x, y, rad + cas + 6, 0, 6.2832); c.stroke();
    }
    Object.assign(stats, { drawn, inBand, total, capped, atlasZoom: az });
  }

  /* Wake a set of keys. props[i] describes keys[i] (block, function, family). */
  function wake(id, colour, keys, props) {
    const n = keys.length, pts = new Float32Array(n * 2), r = new Float32Array(n);
    for (let i = 0; i < n; i++) { const [x, y] = place(keys[i]); pts[i * 2] = x; pts[i * 2 + 1] = y; r[i] = SPACING * Math.sqrt(keys[i]); }
    woken.set(id, { colour, pts, r, n, keys: Uint32Array.from(keys), props });
    draw();
  }
  function unwakeAll(except) { for (const id of [...woken.keys()]) if (!except || !except(id)) woken.delete(id); picked = null; draw(); }
  function wokenIds() { return [...woken.keys()]; }

  function flyTo(key, zoom) {
    const [x, y] = place(key);
    const z0 = view.zoom, x0 = view.x, y0 = view.y, z1 = zoom ?? Math.max(view.zoom, 9);
    const t0 = performance.now(), ms = 620;
    (function step(t) {
      const u = Math.min(1, (t - t0) / ms), e = u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      view.x = x0 + (x - x0) * e; view.y = y0 + (y - y0) * e;
      view.zoom = Math.exp(Math.log(z0) + (Math.log(z1) - Math.log(z0)) * e);
      render();
      if (u < 1) requestAnimationFrame(step);
    })(t0);
  }
  /* Frame every woken key of one set. */
  function frame(id) {
    const S = woken.get(id); if (!S || !S.n) return;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < S.n; i++) { const x = S.pts[i * 2], y = S.pts[i * 2 + 1]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const span = Math.max(x1 - x0, y1 - y0, 6);
    const z1 = Math.min(view.w, view.h) / (span * 1.25);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const zs = view.zoom, xs = view.x, ys = view.y, t0 = performance.now(), ms = 620;
    (function step(t) {
      const u = Math.min(1, (t - t0) / ms), e = u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      view.x = xs + (cx - xs) * e; view.y = ys + (cy - ys) * e;
      view.zoom = Math.exp(Math.log(zs) + (Math.log(z1) - Math.log(zs)) * e);
      render();
      if (u < 1) requestAnimationFrame(step);
    })(t0);
  }

  function pickWoken(cx, cy, reach = 16) {
    const z = view.zoom, ox = view.w / 2 - view.x * z, oy = view.h / 2 + view.y * z;
    let best = null, bestD = reach * reach;
    for (const [id, S] of woken) {
      for (let i = 0; i < S.n; i++) {
        const dx = S.pts[i * 2] * z + ox - cx, dy = oy - S.pts[i * 2 + 1] * z - cy, d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = { set: id, i }; }
      }
    }
    picked = best; draw();
    if (!best) return null;
    const S = woken.get(best.set);
    return { set: best.set, key: S.keys[best.i], props: S.props[best.i] };
  }

  function gestures() {
    let down = null, moved = 0, pinch = null;
    const pts = new Map();
    const local = e => { const b = over.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
    over.addEventListener('pointerdown', e => {
      over.setPointerCapture?.(e.pointerId);
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 1) { down = [e.clientX, e.clientY]; moved = 0; }
      if (pts.size === 2) { const [p, q] = [...pts.values()]; pinch = { d: Math.hypot(p[0] - q[0], p[1] - q[1]), z: view.zoom }; }
    });
    over.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return;
      const prev = pts.get(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 2 && pinch) {
        const [p, q] = [...pts.values()], d = Math.hypot(p[0] - q[0], p[1] - q[1]);
        if (pinch.d > 0) view.zoom = Math.max(0.02, Math.min(4000, pinch.z * d / pinch.d));
        moved += 99; draw(); return;
      }
      if (pts.size === 1) {
        const dx = e.clientX - prev[0], dy = e.clientY - prev[1];
        moved += Math.abs(dx) + Math.abs(dy);
        view.x -= dx / view.zoom; view.y += dy / view.zoom; draw();
      }
    });
    const up = e => {
      if (pts.size === 1 && down && moved < 7) { const [x, y] = local(e); onTap?.(x, y); }
      pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (pts.size === 0) down = null;
    };
    over.addEventListener('pointerup', up);
    over.addEventListener('pointercancel', e => { pts.delete(e.pointerId); pinch = null; down = null; });
    over.addEventListener('wheel', e => {
      e.preventDefault();
      view.zoom = Math.max(0.02, Math.min(4000, view.zoom * Math.exp(-e.deltaY * 0.0016))); draw();
    }, { passive: false });
    over.addEventListener('dblclick', () => home());
  }

  return {
    load, wake, unwakeAll, wokenIds, flyTo, frame, pickWoken, home, draw,
    get view() { return Object.freeze({ ...view }); },
    setView(v) { Object.assign(view, v); draw(); },
    stats, U, fmt
  };
}
