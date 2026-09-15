/* code-card.mjs — iteration 07: brightness by association, and the code card.
 *
 * Two things lifted from Grid Atlas (repd_grid_atlasv8 / v9):
 *
 * 1. SIZE BY WEIGHT. The Atlas sizes a REPD project by capacity with
 *      ['interpolate', ['linear'], capacity, 0,8, 10,12, 50,16, 100,20, 200,26, 350,32, 500,38]
 *    so Cleve Hill and Botley West read as the big bright sites they are. Here the
 *    weight is a line's association count: how many function families carry it.
 *    The count is put onto the Atlas's own capacity axis by the layer's own
 *    maximum (read from the data, never typed), so the fewest families take the
 *    Atlas's smallest stop and the layer's most-carried line takes its largest.
 *
 * 2. THE POPUP. The Atlas's maplibregl popup (ventusv8.css: black ground, cyan,
 *    #444 edge, monospace, a bold 13px title, grey detail, amber figure, the
 *    bordered popup-btn) opens at the point tapped. The same card opens here at
 *    the tapped line. Everything in it is textContent.
 */

import { place, ownersOf, indexOfKey, fmt } from '../../lib.mjs';

const DATA = 'https://globalgrid2050.com/testcode/202609142202/data/';
const LAYER = 'copying';
const COLOUR = '#ffd54a';
const WAFER = '../../';

/* The Atlas's REPD radius stops, verbatim: [capacity, radius px] pairs. */
const ATLAS_STOPS = [[0, 8], [10, 12], [50, 16], [100, 20], [200, 26], [350, 32], [500, 38]];
const ATLAS_TOP = ATLAS_STOPS[ATLAS_STOPS.length - 1][0];
const ATLAS_MIN_R = ATLAS_STOPS[0][1], ATLAS_MAX_R = ATLAS_STOPS[ATLAS_STOPS.length - 1][1];

function atlasRadius(v) {
  if (v <= ATLAS_STOPS[0][0]) return ATLAS_MIN_R;
  for (let i = 1; i < ATLAS_STOPS.length; i++) {
    const [x1, y1] = ATLAS_STOPS[i];
    if (v <= x1) { const [x0, y0] = ATLAS_STOPS[i - 1]; return y0 + (y1 - y0) * (v - x0) / (x1 - x0); }
  }
  return ATLAS_MAX_R;
}

const $ = id => document.getElementById(id);

/* ── styles: the Atlas popup, lifted ─────────────────────────────────────── */

const css = document.createElement('style');
css.textContent = `
#brightness{position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:1}
.codecard{position:fixed;z-index:7;transform:translate(-50%,calc(-100% - 12px));
  background:#000;color:#00ffff;border:1px solid #444;border-radius:4px;
  font-family:monospace;font-size:12px;line-height:1.45;padding:8px 10px;
  min-width:220px;max-width:280px;box-shadow:0 1px 6px #0009}
.codecard::after{content:'';position:absolute;left:50%;bottom:-7px;margin-left:-6px;
  border:6px solid transparent;border-bottom:0;border-top-color:#444}
.codecard[data-below]{transform:translate(-50%,12px)}
.codecard[data-below]::after{bottom:auto;top:-7px;border-top:0;border-bottom:6px solid #444}
.codecard .cc-x{position:absolute;top:0;right:2px;background:none;border:0;color:#888;
  font:inherit;font-size:14px;cursor:pointer;padding:2px 5px}
.codecard .cc-title{display:block;color:#ffd54a;font-size:13px;font-weight:bold;margin-right:14px}
.codecard .cc-grey{color:#888}
.codecard .cc-amber{color:#ffae00}
.codecard .cc-small{color:#555;font-size:10px}
.codecard .cc-fam{display:block;color:#aaa;font-size:11px;overflow-wrap:anywhere}
.codecard .cc-sym{color:#00ffff;font-weight:bold}
.popup-search-btns{display:flex;gap:6px;margin-top:8px}
.popup-btn{flex:1;padding:5px 0;font-family:monospace;font-size:11px;font-weight:bold;border:1px solid #444;
  border-radius:3px;cursor:pointer;text-align:center;text-decoration:none;display:block;transition:border-color .15s,color .15s}
.popup-btn-images{background:#0a0a0a;color:#00ffff;border-color:#00ffff}
.popup-btn-images:hover{background:#00ffff;color:#000}
`;
document.head.appendChild(css);

const canvas = document.createElement('canvas');
canvas.id = 'brightness';
document.body.appendChild(canvas);
const ctx = canvas.getContext('2d');

/* ── data ────────────────────────────────────────────────────────────────── */

const S = {
  particles: null,   /* [{key, families, chars, x, y}] ascending by families, brightest drawn last */
  maxFam: 0,
  families: null, owner: null, ownerKeys: null, ownerXY: null,
  keys: null, lens: null
};

async function bin(name, Kind) {
  const r = await fetch(DATA + name, { cache: 'default' });
  if (!r.ok) throw new Error(DATA + name + ' returned HTTP ' + r.status);
  return new Kind(await r.arrayBuffer());
}

/* The family index and lengths, for the card. Same files, same cache as app.mjs. */
const index = (async () => {
  const [families, famLines, keys, lens] = await Promise.all([
    fetch(DATA + 'families.json', { cache: 'default' }).then(r => r.json()),
    bin('lines.bin', Uint32Array), bin('all-lines.bin', Uint32Array), bin('all-lines.len.bin', Uint16Array)
  ]);
  S.families = families; S.keys = keys; S.lens = lens;
  S.owner = ownersOf(families, famLines);
  S.ownerKeys = Uint32Array.from(S.owner.keys());
  S.ownerXY = new Float32Array(S.ownerKeys.length * 2);
  S.ownerKeys.forEach((k, i) => { const [x, y] = place(k); S.ownerXY[i * 2] = x; S.ownerXY[i * 2 + 1] = y; });
})().catch(e => { console.warn('code card: family index unavailable:', e); });

window.addEventListener('wafer:layer', e => {
  const { id, on, doc } = e.detail;
  if (id !== LAYER) return;
  if (!on || !doc) { S.particles = null; S.maxFam = 0; redraw(); return; }
  let max = 0;
  const ps = doc.features.filter(f => f.geometry?.type === 'Point').map(f => {
    const fam = f.properties?.families ?? 0;
    if (fam > max) max = fam;
    const [x, y] = place(f.geometry.key);
    return { key: f.geometry.key, families: fam, chars: f.properties?.chars, x, y };
  });
  ps.sort((a, b) => a.families - b.families);
  S.particles = ps; S.maxFam = max;
  redraw();
});

/* A line's association count on the Atlas's capacity axis, then its radius and shine. */
const onAtlasAxis = fam => (S.maxFam ? Math.min(fam, S.maxFam) / S.maxFam : 0) * ATLAS_TOP;
const shine = r => (r - ATLAS_MIN_R) / (ATLAS_MAX_R - ATLAS_MIN_R);

/* ── drawing ─────────────────────────────────────────────────────────────── */

const LEVELS = 8;   /* shine is quantised to this many steps for drawing */
let marked = -1, lastView = null;

function draw(v) {
  lastView = v;
  if (!v || !v.w || !v.h) return;
  const dpr = v.dpr || 1, W = Math.round(v.w * dpr), H = Math.round(v.h * dpr);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, v.w, v.h);
  if (S.particles) {
    /* Atlas radii are for a map of a few thousand sites; the wafer holds tens of
       thousands, so the whole scale follows the camera and reaches the Atlas's
       own pixel sizes once the beam is focused in. */
    const k = Math.min(1, Math.sqrt(v.zoom) / 4);
    /* One path per shine level, so tens of thousands of particles cost a handful
       of fills rather than one fill each. */
    const halos = Array.from({ length: LEVELS }, () => new Path2D());
    const cores = Array.from({ length: LEVELS }, () => new Path2D());
    for (const p of S.particles) {
      const sx = (p.x - v.x) * v.zoom + v.w / 2, sy = v.h / 2 - (p.y - v.y) * v.zoom;
      const R = atlasRadius(onAtlasAxis(p.families)), r = Math.max(0.6, R * k);
      if (sx < -r || sy < -r || sx > v.w + r || sy > v.h + r) continue;
      const b = Math.round(shine(R) * (LEVELS - 1)), rc = Math.max(0.5, r * 0.4);
      halos[b].moveTo(sx + r, sy); halos[b].arc(sx, sy, r, 0, 6.2832);
      cores[b].moveTo(sx + rc, sy); cores[b].arc(sx, sy, rc, 0, 6.2832);
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = COLOUR;
    for (let b = 0; b < LEVELS; b++) {
      const s = b / (LEVELS - 1);
      ctx.globalAlpha = 0.12 + 0.28 * s; ctx.fill(halos[b]);   /* the halo */
      ctx.globalAlpha = 0.35 + 0.65 * s; ctx.fill(cores[b]);   /* the core */
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
  if (marked > 0) {
    const [x, y] = place(marked);
    const sx = (x - v.x) * v.zoom + v.w / 2, sy = v.h / 2 - (y - v.y) * v.zoom;
    ctx.strokeStyle = COLOUR; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(sx, sy, 9, 0, 6.2832); ctx.stroke();
  }
  if (card && marked > 0) positionCard();
}
const redraw = () => draw(window.__wafer?.view ?? null);
window.__wafer?.onDraw.add(draw);

/* ── tap: the nearest carried line ───────────────────────────────────────── */

const REACH = 16;   /* px */

function pick(cx, cy) {
  const v = window.__wafer?.view;
  if (!v || !v.zoom || !S.ownerKeys) return -1;
  let best = -1, bestD = REACH * REACH, bestF = 0;
  const n = S.ownerKeys.length;
  for (let i = 0; i < n; i++) {
    const dx = (S.ownerXY[i * 2] - v.x) * v.zoom + v.w / 2 - cx;
    const dy = v.h / 2 - (S.ownerXY[i * 2 + 1] - v.y) * v.zoom - cy;
    const d = dx * dx + dy * dy;
    if (d > bestD) continue;
    const f = S.owner.get(S.ownerKeys[i]).length;
    if (d < bestD || f > bestF) { best = S.ownerKeys[i]; bestD = d; bestF = f; }
  }
  return best;
}

let card = null;

function closeCard() { if (card) card.remove(); card = null; marked = -1; redraw(); }

function positionCard() {
  const v = window.__wafer?.view; if (!v || !card) return;
  const [x, y] = place(marked);
  const sx = (x - v.x) * v.zoom + v.w / 2, sy = v.h / 2 - (y - v.y) * v.zoom;
  const half = card.offsetWidth / 2 + 8;
  card.style.left = Math.max(half, Math.min(v.w - half, sx)) + 'px';
  card.style.top = sy + 'px';
  if (sy - card.offsetHeight - 20 < 0) card.setAttribute('data-below', ''); else card.removeAttribute('data-below');
}

function span(cls, text) { const s = document.createElement('span'); s.className = cls; s.textContent = text; return s; }

function openCard(key) {
  if (card) card.remove();
  marked = key;
  const fams = S.owner.get(key) || [];
  const i = indexOfKey(S.keys, key);
  const chars = i >= 0 ? S.lens[i] : null;

  card = document.createElement('div');
  card.className = 'codecard';
  card.setAttribute('role', 'dialog');
  card.dataset.key = String(key);
  card.dataset.families = String(fams.length);

  const x = document.createElement('button');
  x.className = 'cc-x'; x.type = 'button'; x.textContent = '×'; x.setAttribute('aria-label', 'close');
  x.addEventListener('click', closeCard);
  card.appendChild(x);

  const title = span('cc-title', 'Line ' + fmt(key));
  card.appendChild(title);
  card.appendChild(span('cc-grey', 'numbered line of code'));
  card.appendChild(document.createElement('br'));
  card.appendChild(span('cc-amber', fmt(fams.length) + (fams.length === 1 ? ' association' : ' associations')));
  card.appendChild(span('cc-small', ' ● ' + (chars === null ? 'length unknown' : fmt(chars) + ' characters')));
  card.appendChild(document.createElement('br'));
  for (const f of fams.slice(0, 3)) {
    const fa = S.families[f];
    const row = document.createElement('span'); row.className = 'cc-fam';
    row.append(span('cc-sym', fa.block ?? '—'), document.createTextNode(' ' + fa.name));
    card.appendChild(row);
  }
  if (fams.length > 3) card.appendChild(span('cc-small', 'and ' + fmt(fams.length - 3) + ' more'));

  const btns = document.createElement('div'); btns.className = 'popup-search-btns';
  const a = document.createElement('a');
  a.className = 'popup-btn popup-btn-images';
  a.href = WAFER + '?line=' + encodeURIComponent(String(key));
  a.textContent = 'OPEN IN THE LINE WAFER';
  btns.appendChild(a);
  card.appendChild(btns);

  document.body.appendChild(card);
  positionCard();
  redraw();
}

let down = null;
document.addEventListener('pointerdown', e => { down = e.isPrimary ? [e.clientX, e.clientY] : null; });
document.addEventListener('pointerup', e => {
  if (!down || e.target?.id !== 'stage') return;
  const moved = Math.abs(e.clientX - down[0]) + Math.abs(e.clientY - down[1]);
  down = null;
  if (moved >= 7) return;
  const key = pick(e.clientX, e.clientY);
  if (key > 0) openCard(key); else closeCard();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCard(); });

window.__codecard = Object.freeze({ ready: () => index, get particles() { return S.particles?.length ?? 0; } });
