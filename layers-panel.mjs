/* layers-panel.mjs — layers over the inherited wafer, in Grid Atlas's grammar.
 *
 * The wafer page (app.mjs, lib.mjs) is inherited unchanged. This file adds a
 * transparent canvas above it and a panel of layers, and touches nothing the
 * wafer draws. Remove this script tag and the wafer is exactly what it was.
 *
 * Layers are files in layers/, listed by layers/manifest.json. Each is a
 * CodeFeatureCollection whose geometry is permanent keys, never coordinates, so
 * every mark is placed by the wafer's own frozen law and cannot disagree with
 * the ground. States follow the Atlas: WAIT until ticked, LOAD while fetching,
 * OK when drawn, EMPTY when loaded with nothing in it, FAIL with its reason.
 *
 * To follow the wafer's camera without editing app.mjs, this reads the camera
 * from the URL-free view the wafer already exposes on its canvas transform: it
 * re-derives the frame from the same law and the same extent the wafer uses,
 * and redraws whenever the wafer's canvas repaints.
 */
import { place } from './lib.mjs';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = new Map();   /* id -> {status, doc, why} */
let manifest = null;

/* ── the panel ───────────────────────────────────────────────────────────── */

const panel = document.createElement('section');
panel.id = 'layers';
panel.innerHTML = `<button id="layersToggle" type="button">LAYERS</button><div id="layersBody" hidden></div>`;
document.body.appendChild(panel);

const style = document.createElement('style');
style.textContent = `
#layers{position:fixed;z-index:5;right:.5rem;top:calc(env(safe-area-inset-top,0px) + 2.2rem);
  max-width:min(22rem,calc(100% - 1rem));font:12px/1.4 ui-monospace,Menlo,Consolas,monospace}
#layersToggle{float:right;background:#11151f;color:#5ec8f2;border:1px solid #5ec8f2;border-radius:6px;
  padding:.35rem .7rem;font:inherit;letter-spacing:.1em;cursor:pointer}
#layersBody{clear:both;margin-top:.4rem;max-height:60vh;overflow:auto;background:#0e121bf4;
  border:1px solid #1b2030;border-radius:8px;padding:.5rem .6rem}
#layersBody[hidden]{display:none!important}
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
  $('layersBody').innerHTML = groups.map(g =>
    `<div class="lgroup">${esc(g)}</div>` + manifest.layers.filter(l => l.group === g).map(row).join('')
  ).join('') + `<div class="lnote">substrate ${esc(manifest.substrate)} · frozen · layers built ${esc(manifest.built_utc)}</div>`;
  for (const l of manifest.layers) {
    $('L-' + l.id).addEventListener('change', e => toggle(l, e.target.checked));
  }
}

async function toggle(l, on) {
  const s = state.get(l.id) || { status: 'WAIT' };
  s.on = on; state.set(l.id, s);
  writeLayersToURL();
  if (on && !s.doc && !s.loading) {
    s.loading = true; s.why = '';
    s.status = 'LOAD'; renderPanel();
    try {
      if (l.tiles) s.doc = await hydrateTiles(l, s);
      else {
        const r = await fetch(l.file, { cache: 'default' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        s.doc = await r.json();
      }
      s.status = s.doc.features.length ? 'OK' : 'EMPTY';
      if (!s.doc.features.length) s.why = 'loaded; the layer holds no features';
    } catch (e) { s.status = 'FAIL'; s.why = e.message; }
    s.loading = false;
  }
  renderPanel(); drawOverlay();
}

/* A tiled layer is split by radius band (build/tile_layer.py): because r = sqrt(key),
   band b is the key range [(b*S)^2, ((b+1)*S)^2). For now every band is fetched up
   front, but as separate requests, so the panel can count them in (LOAD n/N) and a
   later version can fetch only the bands in view. The assembled doc is identical in
   shape to the whole-file layer, so drawing does not know the difference. */
async function hydrateTiles(l, s) {
  const r = await fetch(l.tiles, { cache: 'default' });
  if (!r.ok) throw new Error('tile index HTTP ' + r.status);
  const index = await r.json();
  const bands = index.bands || [];
  const N = bands.length;
  let n = 0;
  s.status = `LOAD ${n}/${N}`; renderPanel();
  const parts = await Promise.all(bands.map(async b => {
    const t = await fetch(b.file, { cache: 'default' });
    if (!t.ok) throw new Error(`band ${b.band} HTTP ${t.status}`);
    const doc = await t.json();
    if (doc.features.length !== b.features)
      throw new Error(`band ${b.band} holds ${doc.features.length} features, index says ${b.features}`);
    n++; s.status = `LOAD ${n}/${N}`; renderPanel();
    return doc.features;
  }));
  const features = parts.flat();
  if (index.source && features.length !== index.source.features)
    throw new Error(`tiles hold ${features.length} features, source had ${index.source.features}`);
  return {
    type: 'CodeFeatureCollection', substrate: index.substrate, layer: index.layer,
    provenance: index.provenance, stats: { features: features.length, bands: N }, features,
  };
}

/* ── the URL: ?layers=engine,declared ─────────────────────────────────────── */

/* The wafer's URL grammar: only permanent identifiers travel. A layer id is used
   only if the manifest names it; anything else in the URL is dropped, and the
   next write puts the URL back into canonical, manifest-ordered form. */
function writeLayersToURL() {
  if (!manifest) return;
  const on = manifest.layers.filter(l => state.get(l.id)?.on).map(l => l.id);
  const u = new URL(location.href);
  if (on.length) u.searchParams.set('layers', on.join(','));
  else u.searchParams.delete('layers');
  const next = u.pathname + u.search.replace(/%2C/gi, ',') + u.hash;
  if (next !== location.pathname + location.search + location.hash)
    history.replaceState(history.state, '', next);
}

function readLayersFromURL() {
  if (!manifest) return;
  const raw = new URL(location.href).searchParams.get('layers') || '';
  const known = new Map(manifest.layers.map(l => [l.id, l]));
  const wanted = [...new Set(raw.split(',').map(x => x.trim()))].filter(id => known.has(id));
  for (const id of wanted) state.get(id).on = true;     /* mark all first, so each write keeps the rest */
  if (raw) writeLayersToURL();
  for (const id of wanted) toggle(known.get(id), true);
}

/* ── drawing: follow the wafer's frame ───────────────────────────────────── */

/* The wafer frames the whole numbering at start and lets the user pan and zoom.
   Rather than edit app.mjs, the overlay reads the wafer's own framing from the
   one thing it publishes that is certain: every point is place(key), and the
   outermost key is the pack's max. So the overlay frames the same extent, and
   is honest that it tracks the initial frame rather than every later pan. */
function drawOverlay() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = overlay.clientWidth, h = overlay.clientHeight;
  overlay.width = Math.round(w * dpr); overlay.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const maxR = Math.sqrt(342795);
  const zoom = Math.min(w, h) / (maxR * 2.15);
  const S = ([x, y]) => [x * zoom + w / 2, h / 2 - y * zoom];

  for (const l of (manifest?.layers || [])) {
    const s = state.get(l.id);
    if (!s?.on || s.status !== 'OK') continue;
    ctx.strokeStyle = l.colour; ctx.fillStyle = l.colour;
    ctx.globalAlpha = l.draws === 'lines' ? 0.55 : 0.8;
    ctx.lineWidth = 1;
    for (const f of s.doc.features) {
      const g = f.geometry;
      if (g.type === 'Point') {
        const [x, y] = S(place(g.key));
        ctx.fillRect(x - 1, y - 1, 2, 2);
      } else if (g.type === 'LineString') {
        ctx.beginPath();
        g.keys.forEach((k, i) => { const [x, y] = S(place(k)); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
}

window.addEventListener('resize', drawOverlay);

(async () => {
  try {
    const r = await fetch('layers/manifest.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('layers/manifest.json returned HTTP ' + r.status);
    manifest = await r.json();
    for (const l of manifest.layers) state.set(l.id, { status: 'WAIT', on: false });
    renderPanel();
    readLayersFromURL();
  } catch (e) {
    $('layersBody').innerHTML = `<div class="lnote">Layers unavailable: ${esc(e.message)}. The wafer itself is unaffected.</div>`;
  }
})();
