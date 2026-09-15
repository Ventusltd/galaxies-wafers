/* layers-panel.mjs — layers over the inherited wafer, in Grid Atlas's grammar.
 *
 * The wafer page (app.mjs, lib.mjs) is inherited unchanged but for one hook.
 * This file adds a transparent canvas above it and a panel of layers, and
 * touches nothing the wafer draws. Remove this script tag and the wafer is
 * exactly what it was.
 *
 * Layers are files in layers/, listed by layers/manifest.json. Each is a
 * CodeFeatureCollection whose geometry is permanent keys, never coordinates, so
 * every mark is placed by the wafer's own frozen law and cannot disagree with
 * the ground. States follow the Atlas: WAIT until ticked, LOAD while fetching,
 * OK when drawn, EMPTY when loaded with nothing in it, FAIL with its reason.
 *
 * FOLLOWING THE CAMERA. app.mjs exposes exactly one read-only hook,
 * window.__wafer: a getter for its live `view` and a set of `onDraw` listeners
 * it calls at the end of every render(). The overlay registers there, so it
 * repaints in the same frame as the wafer and maps world to screen with the
 * wafer's own formula. An earlier version re-derived only the initial frame and
 * drifted off the points the moment anyone panned; that is what this replaces.
 *
 * TAP TO INSPECT. A tap on the wafer that lands within 14 px of a drawn layer
 * feature shows that feature's properties and its layer's evidence. The wafer
 * still receives the same tap and does whatever it does with it; nothing here
 * captures, prevents or stops the event.
 */
import { place } from './lib.mjs';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = new Map();   /* id -> {status, doc, why} */
let manifest = null;
let picked = null;         /* {layer, feature} currently inspected */

const TAP_SLOP = 7;        /* px of movement under which a pointer-up is a tap */
const PICK_REACH = 14;     /* px within which a tap picks a layer feature */

/* ── the panel ───────────────────────────────────────────────────────────── */

const panel = document.createElement('section');
panel.id = 'layers';
panel.innerHTML = `<button id="layersToggle" type="button">LAYERS</button><div id="layersBody" hidden><div id="layersInspect" hidden></div><div id="layersList"></div></div>`;
document.body.appendChild(panel);

const style = document.createElement('style');
style.textContent = `
#layers{position:fixed;z-index:5;right:.5rem;top:calc(env(safe-area-inset-top,0px) + 2.2rem);
  max-width:min(22rem,calc(100% - 1rem));font:12px/1.4 ui-monospace,Menlo,Consolas,monospace}
#layersToggle{float:right;background:#11151f;color:#5ec8f2;border:1px solid #5ec8f2;border-radius:6px;
  padding:.35rem .7rem;font:inherit;letter-spacing:.1em;cursor:pointer}
#layersBody{clear:both;margin-top:.4rem;max-height:60vh;overflow:auto;background:#0e121bf4;
  border:1px solid #1b2030;border-radius:8px;padding:.5rem .6rem}
#layersBody[hidden],#layersInspect[hidden]{display:none!important}
#layersInspect{border-bottom:1px solid #1b2030;padding-bottom:.45rem;margin-bottom:.3rem;position:relative}
#layersInspect h3{margin:.1rem 1.6rem .25rem 0;font-size:12.5px;font-weight:600}
#layersInspect dl{display:grid;grid-template-columns:auto 1fr;gap:.1rem .5rem;margin:.3rem 0}
#layersInspect dt{color:#8b93a7}
#layersInspect dd{margin:0;overflow-wrap:anywhere}
#layersInspect .lnote{margin-left:0}
#layersInspectClose{position:absolute;top:0;right:0;background:none;border:0;color:#8b93a7;font:inherit;cursor:pointer}
.lgroup{color:#8b93a7;font-size:10.5px;letter-spacing:.08em;margin:.55rem 0 .15rem}
.lrow{display:flex;gap:.45rem;align-items:flex-start;margin:.2rem 0}
.lrow input{margin-top:.15rem}
.lname{flex:1}
.ltag{font-size:10.5px}
.ltag.WAIT{color:#8b93a7}.ltag.LOAD{color:#ffd54a}.ltag.OK{color:#7fd6a2}
.ltag.EMPTY{color:#b39ddb}.ltag.FAIL{color:#ff8a80}
.lnote{color:#8b93a7;font-size:10.5px;margin:.1rem 0 .35rem 1.5rem}
#overlay{position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:1}
`;
document.head.appendChild(style);

const overlay = document.createElement('canvas');
overlay.id = 'overlay';
document.body.appendChild(overlay);
const ctx = overlay.getContext('2d');

$('layersToggle').addEventListener('click', () => { $('layersBody').hidden = !$('layersBody').hidden; });

function row(l) {
  const s = state.get(l.id) || { status: 'WAIT' };
  const why = s.why ? ` · ${esc(s.why)}` : '';
  const stat = s.doc?.stats ? ` · ${esc(JSON.stringify(s.doc.stats).slice(0, 80))}` : '';
  return `<div class="lrow"><input type="checkbox" id="L-${esc(l.id)}" ${s.on ? 'checked' : ''}>
    <label class="lname" for="L-${esc(l.id)}" style="color:${esc(l.colour)}">${esc(l.label)}
    <span class="ltag ${s.status}">[${s.status}]</span></label></div>
    <div class="lnote">${esc(l.evidence)}${why}${s.status === 'OK' ? stat : ''}</div>`;
}

function renderPanel() {
  if (!manifest) return;
  const groups = [...new Set(manifest.layers.map(l => l.group))];
  $('layersList').innerHTML = groups.map(g =>
    `<div class="lgroup">${esc(g)}</div>` + manifest.layers.filter(l => l.group === g).map(row).join('')
  ).join('') + `<div class="lnote">substrate ${esc(manifest.substrate)} · frozen · layers built ${esc(manifest.built_utc)}</div>`;
  for (const l of manifest.layers) {
    $('L-' + l.id).addEventListener('change', e => toggle(l, e.target.checked));
  }
}

async function toggle(l, on) {
  const s = state.get(l.id) || { status: 'WAIT' };
  s.on = on; state.set(l.id, s);
  if (on && !s.doc) {
    s.status = 'LOAD'; renderPanel();
    try {
      const r = await fetch(l.file, { cache: 'default' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      s.doc = await r.json();
      s.status = s.doc.features.length ? 'OK' : 'EMPTY';
      if (!s.doc.features.length) s.why = 'loaded; the layer holds no features';
    } catch (e) { s.status = 'FAIL'; s.why = e.message; }
  }
  if (!on && picked?.layer.id === l.id) inspect(null);
  renderPanel(); drawOverlay();
}

/* ── the camera: the wafer's own, read live ──────────────────────────────── */

const liveView = () => window.__wafer?.view ?? null;

/* The wafer's formula, exactly: see drawMarks() and nearestKeyAt() in app.mjs. */
const toScreen = (v, [x, y]) => [(x - v.x) * v.zoom + v.w / 2, v.h / 2 - (y - v.y) * v.zoom];

function* visibleLayers() {
  for (const l of (manifest?.layers || [])) {
    const s = state.get(l.id);
    if (s?.on && s.status === 'OK') yield [l, s.doc];
  }
}

/* ── drawing ─────────────────────────────────────────────────────────────── */

function drawOverlay() {
  const v = liveView();
  if (!v || !v.w || !v.h) return;          /* the wafer has not framed itself yet */
  const dpr = v.dpr || 1;
  const W = Math.round(v.w * dpr), H = Math.round(v.h * dpr);
  if (overlay.width !== W || overlay.height !== H) { overlay.width = W; overlay.height = H; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, v.w, v.h);
  const S = p => toScreen(v, p);

  for (const [l, doc] of visibleLayers()) {
    ctx.strokeStyle = l.colour; ctx.fillStyle = l.colour;
    ctx.globalAlpha = l.draws === 'lines' ? 0.55 : 0.8;
    ctx.lineWidth = 1;
    for (const f of doc.features) {
      const g = f.geometry;
      if (g.type === 'Point') {
        const [x, y] = S(place(g.key));
        if (x < -2 || y < -2 || x > v.w + 2 || y > v.h + 2) continue;
        ctx.fillRect(x - 1, y - 1, 2, 2);
      } else if (g.type === 'LineString') {
        ctx.beginPath();
        g.keys.forEach((k, i) => { const [x, y] = S(place(k)); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  if (picked) {
    const g = picked.feature.geometry;
    ctx.strokeStyle = picked.layer.colour; ctx.lineWidth = 1.4;
    for (const k of (g.type === 'Point' ? [g.key] : g.keys)) {
      const [x, y] = S(place(k));
      ctx.beginPath(); ctx.arc(x, y, 7, 0, 6.2832); ctx.stroke();
    }
  }
}

window.__wafer?.onDraw.add(drawOverlay);

/* ── tap to inspect ──────────────────────────────────────────────────────── */

function segDist2(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
  const qx = ax + t * dx - px, qy = ay + t * dy - py;
  return qx * qx + qy * qy;
}

/* The nearest drawn feature to a screen point, or null when none is within reach. */
function pickAt(cx, cy) {
  const v = liveView();
  if (!v || !v.zoom) return null;
  let best = null, bestD = PICK_REACH * PICK_REACH;
  for (const [l, doc] of visibleLayers()) {
    for (const f of doc.features) {
      const g = f.geometry;
      let d = Infinity;
      if (g.type === 'Point') {
        const [x, y] = toScreen(v, place(g.key));
        d = (x - cx) ** 2 + (y - cy) ** 2;
      } else if (g.type === 'LineString' && g.keys.length) {
        const pts = g.keys.map(k => toScreen(v, place(k)));
        d = segDist2(cx, cy, pts[0], pts[0]);
        for (let i = 1; i < pts.length; i++) d = Math.min(d, segDist2(cx, cy, pts[i - 1], pts[i]));
      }
      if (d < bestD) { bestD = d; best = { layer: l, feature: f }; }
    }
  }
  return best;
}

const node = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text != null) n.textContent = String(text);
  if (cls) n.className = cls;
  return n;
};

/* Dataset text only ever reaches the page through textContent. */
function inspect(hit) {
  picked = hit;
  const box = $('layersInspect');
  box.replaceChildren();
  if (!hit) { box.hidden = true; drawOverlay(); return; }
  const { layer: l, feature: f } = hit;
  const close = node('button', '✕');
  close.id = 'layersInspectClose'; close.type = 'button'; close.setAttribute('aria-label', 'close');
  close.addEventListener('click', () => inspect(null));
  const h = node('h3', l.label); h.style.color = l.colour;
  const g = f.geometry;
  const where = node('div', g.type === 'Point' ? `line ${g.key}` : `lines ${g.keys.join(' → ')}`, 'lnote');
  const dl = node('dl');
  for (const [k, val] of Object.entries(f.properties || {})) {
    dl.append(node('dt', k), node('dd', val !== null && typeof val === 'object' ? JSON.stringify(val) : val));
  }
  const ev = node('div', 'evidence: ' + (l.evidence ?? 'none recorded'), 'lnote');
  box.append(close, h, where, dl, ev);
  box.hidden = false;
  $('layersBody').hidden = false;
  drawOverlay();
}

/* Non-capturing, and never prevents or stops the event: the wafer's own tap
   (which opens its line panel) still happens exactly as before. */
{
  const pts = new Map();
  let moved = 0;
  const onStage = e => e.target instanceof Element && e.target.id === 'stage';
  document.addEventListener('pointerdown', e => {
    if (!onStage(e)) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 1) moved = 0;
  });
  document.addEventListener('pointermove', e => {
    const prev = pts.get(e.pointerId);
    if (!prev) return;
    moved += Math.abs(e.clientX - prev[0]) + Math.abs(e.clientY - prev[1]);
    pts.set(e.pointerId, [e.clientX, e.clientY]);
  });
  const end = e => {
    if (!pts.has(e.pointerId)) return;
    const single = pts.size === 1;
    pts.delete(e.pointerId);
    if (e.type !== 'pointerup' || !single || moved >= TAP_SLOP) return;
    const hit = pickAt(e.clientX, e.clientY);
    if (hit) inspect(hit);
  };
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
}

(async () => {
  try {
    const r = await fetch('layers/manifest.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('layers/manifest.json returned HTTP ' + r.status);
    manifest = await r.json();
    for (const l of manifest.layers) state.set(l.id, { status: 'WAIT', on: false });
    renderPanel();
  } catch (e) {
    $('layersList').innerHTML = `<div class="lnote">Layers unavailable: ${esc(e.message)}. The wafer itself is unaffected.</div>`;
  }
})();
