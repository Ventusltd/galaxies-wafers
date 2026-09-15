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
import { place } from '../../lib.mjs';
/* Iteration 09: layers come from the engine's parse, and dropped ids are reported, not swallowed. */
import { LINK, ROOT, reportLayers } from './receiver.mjs';

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
.ecard{border:1px solid #1b2030;border-radius:6px;padding:.35rem .45rem;margin:.3rem 0;background:#11151f}
.ehead .esym{font-weight:700}.ename{color:#e7ebf3}
.efns{color:#8b93a7;font-size:10.5px;margin:.1rem 0 .2rem}
.emod{border-top:1px dashed #1b2030;padding-top:.2rem;margin-top:.2rem}
.ekv{font-size:10.5px;word-break:break-word}.ek{color:#8b93a7}.ev{color:#e7ebf3}
.eschema{color:#7fd6a2}.enone{color:#b39ddb}
.elinks{font-size:10.5px;margin-top:.15rem}.elink{color:#5ec8f2}
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
  renderElements(manifest, state);
}

/* ── ELEMENT: what a consumer of a module meets ─────────────────────────────
   Shown when a layer that carries properties.schema or properties.export_subpath
   is OK. One card per block symbol, one entry per module that block's functions
   resolve to: its export subpath (or why there is none), the schema it stamps,
   what its NOT_COMPUTED refuses, and where it lives. Built from DOM nodes with
   textContent only; nothing from a dataset is ever parsed as HTML. */
const ENGINE_LIVE = 'https://ventusltd.github.io/ventus-grid-engine/';

function renderElements(manifest, state) {
  const body = $('layersBody');
  if (!body || !manifest) return;
  $('layersElements')?.remove();
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  };
  const link = (href, text) => {
    const a = el('a', 'elink', text);
    a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
    return a;
  };
  const cards = new Map();   /* symbol -> {title, colour, modules: Map(path -> props), functions: Set} */
  for (const l of manifest.layers) {
    const s = state.get(l.id);
    if (!s?.on || s.status !== 'OK') continue;
    const feats = s.doc.features.filter(f => f.properties && ('schema' in f.properties || 'export_subpath' in f.properties));
    for (const f of feats) {
      const p = f.properties;
      if (!p.module_path || !p.block) continue;
      if (!cards.has(p.block)) cards.set(p.block, { title: p.title, colour: l.colour, modules: new Map(), functions: new Set() });
      const c = cards.get(p.block);
      c.functions.add(p.function);
      if (!c.modules.has(p.module_path)) c.modules.set(p.module_path, p);
    }
  }
  if (!cards.size) return;
  const sec = el('div'); sec.id = 'layersElements';
  sec.appendChild(el('div', 'lgroup', 'ELEMENT'));
  for (const [sym, c] of [...cards].sort((a, b) => a[0].localeCompare(b[0]))) {
    const card = el('div', 'ecard');
    const head = el('div', 'ehead');
    const symEl = el('span', 'esym', sym); symEl.style.color = c.colour;
    head.append(symEl, el('span', 'ename', ' ' + (c.title || '')));
    card.appendChild(head);
    card.appendChild(el('div', 'efns', [...c.functions].join(', ')));
    for (const [path, p] of c.modules) {
      const m = el('div', 'emod');
      const kv = (k, v, cls) => { const r = el('div', 'ekv'); r.append(el('span', 'ek', k + ' '), el('span', cls || 'ev', v)); m.appendChild(r); };
      kv('module', path);
      kv('export', p.export_subpath ?? ('none — ' + (p.export_reason || 'no subpath')), p.export_subpath ? 'ev' : 'ev enone');
      kv('schema', p.schema ?? ('none — ' + (p.schema_reason || 'no schema')), p.schema ? 'ev eschema' : 'ev enone');
      kv('refuses', (p.refuses && p.refuses.length) ? p.refuses.join(', ')
        : (p.not_computed_form ? `NOT_COMPUTED is a ${p.not_computed_form}, no keys` : 'nothing declared'));
      const links = el('div', 'elinks');
      links.append(link(ENGINE_LIVE, 'live engine'), el('span', null, ' · '),
        link(p.github || `https://github.com/Ventusltd/ventus-grid-engine/blob/main/${path}`, 'GitHub ' + path));
      m.appendChild(links);
      card.appendChild(m);
    }
    sec.appendChild(card);
  }
  body.appendChild(sec);
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
        const r = await fetch(ROOT + l.file, { cache: 'default' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        s.doc = await r.json();
      }
      s.status = s.doc.features.length ? 'OK' : 'EMPTY';
      if (!s.doc.features.length) s.why = 'loaded; the layer holds no features';
    } catch (e) { s.status = 'FAIL'; s.why = e.message; }
    s.loading = false;
  }
  if (!on && picked?.layer.id === l.id) inspect(null);
  renderPanel(); drawOverlay();
}

/* A tiled layer is split by radius band (build/tile_layer.py): because r = sqrt(key),
   band b is the key range [(b*S)^2, ((b+1)*S)^2). For now every band is fetched up
   front, but as separate requests, so the panel can count them in (LOAD n/N) and a
   later version can fetch only the bands in view. The assembled doc is identical in
   shape to the whole-file layer, so drawing does not know the difference. */
async function hydrateTiles(l, s) {
  const r = await fetch(ROOT + l.tiles, { cache: 'default' });
  if (!r.ok) throw new Error('tile index HTTP ' + r.status);
  const index = await r.json();
  const bands = index.bands || [];
  const N = bands.length;
  let n = 0;
  s.status = `LOAD ${n}/${N}`; renderPanel();
  const parts = await Promise.all(bands.map(async b => {
    const t = await fetch(ROOT + b.file, { cache: 'default' });
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

/* A link that carries layers but no line is not a deep link to a line, so the
   receiver refuses it as one, but its layers are still a plain request the root
   page honours. Earlier this page left them silently in WAIT; now they load and
   the card says the line was missing. Any other refusal (malformed line, bad
   zoom) still loads nothing, as before. */
function requestedLayers() {
  if (LINK.ok) return LINK.layers ?? null;
  if (!/^missing /.test(LINK.why || '')) return null;
  const raw = new URL(location.href).searchParams.get('layers');
  return raw ? [...new Set(raw.split(',').map(x => x.trim()).filter(Boolean))] : null;
}

function readLayersFromURL() {
  const asked = manifest && requestedLayers();
  if (!asked) return;
  const known = new Map(manifest.layers.map(l => [l.id, l]));
  const wanted = asked.filter(id => known.has(id));
  const dropped = asked.filter(id => !known.has(id));
  reportLayers({ ticked: wanted, dropped });
  for (const id of wanted) state.get(id).on = true;     /* mark all first, so each write keeps the rest */
  writeLayersToURL();
  for (const id of wanted) toggle(known.get(id), true);
}

/* ── drawing: follow the wafer's frame ───────────────────────────────────── */

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
    const r = await fetch(ROOT + 'layers/manifest.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error(ROOT + 'layers/manifest.json returned HTTP ' + r.status);
    manifest = await r.json();
    for (const l of manifest.layers) state.set(l.id, { status: 'WAIT', on: false });
    renderPanel();
    readLayersFromURL();
  } catch (e) {
    if (requestedLayers()) reportLayers({ ticked: [], dropped: [], failed: 'unavailable: ' + e.message });
    $('layersList').innerHTML = `<div class="lnote">Layers unavailable: ${esc(e.message)}. The wafer itself is unaffected.</div>`;
  }
})();
