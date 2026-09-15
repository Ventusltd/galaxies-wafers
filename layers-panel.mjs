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
  $('layersBody').innerHTML = groups.map(g =>
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
  renderPanel(); drawOverlay();
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
  } catch (e) {
    $('layersBody').innerHTML = `<div class="lnote">Layers unavailable: ${esc(e.message)}. The wafer itself is unaffected.</div>`;
  }
})();
