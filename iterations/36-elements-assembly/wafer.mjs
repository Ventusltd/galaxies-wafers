/* wafer.mjs — level 1's dark wafer (base: iteration 21, Dark Pixels).
 *
 * Every issued line key is one near-black point at the placement law of
 * lib.mjs (r = sqrt(key), theta = key x golden angle). Only one function's keys
 * are ever lit: a second, small buffer refilled when the chosen function
 * changes. The lit run is drawn in its sequence order (the order of the key
 * list in lines.bin), which is the order of the function's lines, not the
 * numeric order of the keys.
 *
 * SPEED (iteration 36b). The run line was first stroked on the 2D overlay as one
 * path of every segment, every frame. Measured in WebKit (iPhone 13 emulation)
 * that one stroke cost about 660 ms for the largest function's 6,517 segments,
 * while every GPU draw on the page cost about 1 ms: the whole 707 ms frame. The
 * run is now a third GPU buffer, each segment a thin quad built once per
 * function, drawn 1.1 CSS px wide in the same colour; a depth pass lets each
 * pixel take the colour once, as a single stroked path does where it crosses
 * itself. Only the three rings and the head dot stay on the overlay. Without
 * WebGL the page still strokes the path on the 2D canvas, as before.
 */
import { placeAll, place } from '../../lib.mjs';

const VS = `#version 300 es
precision highp float;
in vec2 a_pos;
uniform vec2 u_res; uniform vec2 u_cam; uniform float u_zoom; uniform float u_size;
void main(){
  vec2 p = (a_pos - u_cam) * u_zoom;
  gl_Position = vec4(p / (u_res * 0.5), 0.0, 1.0);
  gl_PointSize = u_size;
}`;
const FS = `#version 300 es
precision highp float;
uniform vec4 u_col;
out vec4 o;
void main(){
  vec2 d = gl_PointCoord - 0.5; float r = length(d);
  if (r > 0.5) discard;
  o = vec4(u_col.rgb, u_col.a * smoothstep(0.5, 0.35, r));
}`;

/* the run: one quad per segment, widened in device pixels in the vertex shader */
const RVS = `#version 300 es
precision highp float;
in vec2 a_p0; in vec2 a_p1; in vec2 a_ts;
uniform vec2 u_res; uniform vec2 u_cam; uniform float u_zoom; uniform float u_half;
void main(){
  vec2 c0 = (a_p0 - u_cam) * u_zoom, c1 = (a_p1 - u_cam) * u_zoom, d = c1 - c0;
  float l = length(d); d = l > 1e-6 ? d / l : vec2(1.0, 0.0);
  vec2 p = mix(c0, c1, a_ts.x) + vec2(-d.y, d.x) * a_ts.y * u_half;
  gl_Position = vec4(p / (u_res * 0.5), 0.0, 1.0);
}`;
const RFS = `#version 300 es
precision highp float;
uniform vec4 u_col;
out vec4 o;
void main(){ o = u_col; }`;
const QUAD = [0, -1, 0, 1, 1, -1, 1, -1, 0, 1, 1, 1];   /* (end, side) for the six corners */

export class Wafer {
  constructor(glCanvas, overlay) {
    this.cv = glCanvas; this.ov = overlay;
    this.view = { x: 0, y: 0, zoom: 1, w: 0, h: 0, dpr: 1 };
    this.groundN = 0; this.lit = null; this.litN = 0; this.seq = null; this.head = 1; this.ring = -1;
    this.gl = null; this.ctx = null; this.drawnLit = 0; this.frames = [];
  }
  init(keys) {
    const gl = this.cv.getContext('webgl2', { antialias: true, alpha: false });
    this.groundPos = placeAll(keys); this.groundN = keys.length;
    if (!gl) { this.ctx = this.cv.getContext('2d'); return false; }
    try {
      const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      this.p = p; this.loc = {};
      for (const u of ['u_res', 'u_cam', 'u_zoom', 'u_size', 'u_col']) this.loc[u] = gl.getUniformLocation(p, u);
      const al = gl.getAttribLocation(p, 'a_pos');
      const mk = data => {
        const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
        const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(al); gl.vertexAttribPointer(al, 2, gl.FLOAT, false, 0, 0);
        return { vao, b };
      };
      this.ground = mk(this.groundPos);
      this.litBuf = mk(new Float32Array(2));
      const rp = gl.createProgram();
      gl.attachShader(rp, sh(gl.VERTEX_SHADER, RVS)); gl.attachShader(rp, sh(gl.FRAGMENT_SHADER, RFS)); gl.linkProgram(rp);
      if (!gl.getProgramParameter(rp, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(rp));
      this.rp = rp; this.rloc = {};
      for (const u of ['u_res', 'u_cam', 'u_zoom', 'u_half', 'u_col']) this.rloc[u] = gl.getUniformLocation(rp, u);
      const rvao = gl.createVertexArray(); gl.bindVertexArray(rvao);
      const rb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, rb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(6), gl.DYNAMIC_DRAW);
      [['a_p0', 0], ['a_p1', 2], ['a_ts', 4]].forEach(([name, off]) => { const l = gl.getAttribLocation(rp, name); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 2, gl.FLOAT, false, 24, off * 4); });
      this.runBuf = { vao: rvao, b: rb }; this.runSegs = 0;
      gl.bindVertexArray(null);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      this.gl = gl;
      return true;
    } catch (e) {
      console.warn('WebGL setup failed, drawing without the GPU:', e.message);
      const fresh = this.cv.cloneNode(false); this.cv.replaceWith(fresh); this.cv = fresh;
      this.ctx = fresh.getContext('2d');
      return false;
    }
  }
  resize() {
    const v = this.view, r = this.cv.getBoundingClientRect();
    v.dpr = Math.min(window.devicePixelRatio || 1, 2); v.w = r.width; v.h = r.height;
    for (const c of [this.cv, this.ov]) {
      const W = Math.round(v.w * v.dpr), H = Math.round(v.h * v.dpr);
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    }
    if (this.gl) this.gl.viewport(0, 0, this.cv.width, this.cv.height);
  }
  /* seq: the function's keys in sequence order (may repeat a key). */
  setRun(seq, ringKey) {
    this.seq = seq; this.ring = ringKey ?? -1;
    const distinct = [...new Set(seq)];
    this.lit = placeAll(distinct); this.litN = distinct.length;
    this.seqPos = placeAll(seq);
    if (this.gl) {
      const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this.litBuf.b); gl.bufferData(gl.ARRAY_BUFFER, this.lit, gl.DYNAMIC_DRAW);
      const S = this.seqPos, segs = Math.max(0, S.length / 2 - 1), q = new Float32Array(segs * 36);
      for (let i = 0, o = 0; i < segs; i++) {
        for (let k = 0; k < 12; k += 2, o += 6) {
          q[o] = S[i * 2]; q[o + 1] = S[i * 2 + 1]; q[o + 2] = S[i * 2 + 2]; q[o + 3] = S[i * 2 + 3]; q[o + 4] = QUAD[k]; q[o + 5] = QUAD[k + 1];
        }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.runBuf.b); gl.bufferData(gl.ARRAY_BUFFER, q, gl.DYNAMIC_DRAW);
      this.runSegs = segs;
    }
  }
  frame() {
    if (!this.seqPos || !this.seqPos.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < this.seqPos.length; i += 2) {
      const x = this.seqPos[i], y = this.seqPos[i + 1];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const v = this.view;
    v.x = (x0 + x1) / 2; v.y = (y0 + y1) / 2;
    v.zoom = Math.min(v.w / Math.max(x1 - x0, 6), v.h / Math.max(y1 - y0, 6)) * 0.8;
    this.fitZoom = v.zoom;
  }
  render() {
    const t0 = performance.now();
    const v = this.view, gl = this.gl;
    if (gl) {
      gl.clearColor(0.012, 0.014, 0.020, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(this.p);
      gl.uniform2f(this.loc.u_res, this.cv.width, this.cv.height);
      gl.uniform2f(this.loc.u_cam, v.x, v.y);
      gl.uniform1f(this.loc.u_zoom, v.zoom * v.dpr);
      /* ground: dark, size by zoom */
      gl.uniform1f(this.loc.u_size, Math.max(1, Math.min(10, 0.9 * Math.sqrt(v.zoom))) * v.dpr);
      gl.uniform4f(this.loc.u_col, 0.16, 0.18, 0.23, 0.55);
      gl.bindVertexArray(this.ground.vao); gl.drawArrays(gl.POINTS, 0, this.groundN);
      if (this.litN) {
        const s = Math.max(3, Math.min(22, 2.2 * Math.sqrt(v.zoom) + 3));
        gl.uniform1f(this.loc.u_size, (s + 5) * v.dpr);            /* halo so it reads on black */
        gl.uniform4f(this.loc.u_col, 0.0, 0.0, 0.0, 0.85);
        gl.bindVertexArray(this.litBuf.vao); gl.drawArrays(gl.POINTS, 0, this.litN);
        gl.uniform1f(this.loc.u_size, s * v.dpr);
        gl.uniform4f(this.loc.u_col, 1.0, 0.835, 0.29, 1.0);
        gl.drawArrays(gl.POINTS, 0, this.litN);
      }
      const S = this.seqPos;
      if (this.runSegs && S) {                                     /* the run, up to the head, over the lit keys */
        const upto = Math.max(1, Math.round(this.head * (S.length / 2)));
        const segs = Math.min(this.runSegs, upto - 1);
        if (segs > 0) {
          gl.useProgram(this.rp);
          gl.uniform2f(this.rloc.u_res, this.cv.width, this.cv.height);
          gl.uniform2f(this.rloc.u_cam, v.x, v.y);
          gl.uniform1f(this.rloc.u_zoom, v.zoom * v.dpr);
          gl.uniform1f(this.rloc.u_half, 0.55 * v.dpr);              /* 1.1 CSS px wide, as the 2D stroke */
          gl.uniform4f(this.rloc.u_col, 94 / 255, 200 / 255, 242 / 255, 0.75);
          gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS);           /* each pixel takes the colour once */
          gl.bindVertexArray(this.runBuf.vao); gl.drawArrays(gl.TRIANGLES, 0, segs * 6);
          gl.disable(gl.DEPTH_TEST);
        }
      }
    } else if (this.ctx) {
      const c = this.ctx; c.setTransform(1, 0, 0, 1, 0, 0);
      c.fillStyle = '#030406'; c.fillRect(0, 0, this.cv.width, this.cv.height);
      c.fillStyle = '#1e222c';
      const step = v.zoom < 0.5 ? 7 : 1, P = this.groundPos;
      for (let i = 0; i < this.groundN; i += step) {
        const x = (P[i * 2] - v.x) * v.zoom * v.dpr + this.cv.width / 2, y = this.cv.height / 2 - (P[i * 2 + 1] - v.y) * v.zoom * v.dpr;
        if (x >= 0 && y >= 0 && x <= this.cv.width && y <= this.cv.height) c.fillRect(x, y, v.dpr, v.dpr);
      }
      c.fillStyle = '#ffd54a';
      for (let i = 0; i < this.litN; i++) {
        const x = (this.lit[i * 2] - v.x) * v.zoom * v.dpr + this.cv.width / 2, y = this.cv.height / 2 - (this.lit[i * 2 + 1] - v.y) * v.zoom * v.dpr;
        c.fillRect(x - 2 * v.dpr, y - 2 * v.dpr, 4 * v.dpr, 4 * v.dpr);
      }
    }
    this.drawRun();
    this.frames.push(performance.now() - t0); if (this.frames.length > 240) this.frames.shift();
  }
  toScreen(x, y) { const v = this.view; return [(x - v.x) * v.zoom + v.w / 2, v.h / 2 - (y - v.y) * v.zoom]; }
  /* the run: consecutive keys joined in sequence order, lit up to `head` (0..1) */
  drawRun() {
    const c = this.ov.getContext('2d'), v = this.view;
    c.setTransform(v.dpr, 0, 0, v.dpr, 0, 0); c.clearRect(0, 0, v.w, v.h);
    const S = this.seqPos; if (!S || S.length < 2) { this.drawnLit = 0; return; }
    const n = S.length / 2, upto = Math.max(1, Math.round(this.head * n));
    let drawn = 0;
    const gpu = !!(this.gl && this.runSegs);                       /* the line itself is drawn by render() on the GPU */
    const hw = v.w / 2, hh = v.h / 2, z = v.zoom;
    if (!gpu) { c.lineWidth = 1.1; c.strokeStyle = 'rgba(94,200,242,0.75)'; c.beginPath(); }
    for (let i = 0; i < upto; i++) {
      const x = (S[i * 2] - v.x) * z + hw, y = hh - (S[i * 2 + 1] - v.y) * z;
      if (!gpu) { if (i === 0) c.moveTo(x, y); else c.lineTo(x, y); }
      if (x > -20 && y > -20 && x < v.w + 20 && y < v.h + 20) drawn++;
    }
    if (!gpu) c.stroke();
    this.drawnLit = drawn;
    const mark = (x, y, col, r) => { c.strokeStyle = col; c.lineWidth = 1.5; c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.stroke(); };
    const [fx, fy] = this.toScreen(S[0], S[1]); mark(fx, fy, '#ffffff', 9);
    const [lx, ly] = this.toScreen(S[(n - 1) * 2], S[(n - 1) * 2 + 1]); mark(lx, ly, '#5ec8f2', 12);
    if (this.ring >= 0) { const [p, q] = place(this.ring); const [rx, ry] = this.toScreen(p, q); mark(rx, ry, '#ffd54a', 15); }
    if (upto < n) { const [hx, hy] = this.toScreen(S[(upto - 1) * 2], S[(upto - 1) * 2 + 1]); c.fillStyle = '#ffd54a'; c.beginPath(); c.arc(hx, hy, 4, 0, 6.2832); c.fill(); }
  }
  nearestSeq(cx, cy) {
    const S = this.seqPos; if (!S) return -1;
    let best = -1, bd = 22 * 22;
    for (let i = 0; i < S.length / 2; i++) {
      const [x, y] = this.toScreen(S[i * 2], S[i * 2 + 1]);
      const d = (x - cx) ** 2 + (y - cy) ** 2; if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
}
