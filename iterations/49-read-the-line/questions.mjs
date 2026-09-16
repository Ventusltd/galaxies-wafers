/* questions.mjs — iteration 04: the owner's three questions and the machine
 * detail line, added after the page was built. It changes nothing the page
 * does: it fetches nothing until the reader opens the panel, then reads
 * layers/manifest.json, atlas/index.html (the Topology group of GROUPS) and this
 * directory's own layers-panel.mjs, so every count, style and line number below
 * is measured at run time. Band lower bounds are read from the engine panel the
 * page already prints (#engineThresholds), never recomputed here.
 */
import { FEATURE_CAP, FETCH_TIMEOUT_MS, MAX_FETCH } from './layers-panel.mjs';

const ROOT = '../../';
const BASE_COMMIT = '6d17227';   /* the branch commit this panel was added on */
const $ = id => document.getElementById(id);
const fmt = n => Number(n).toLocaleString('en-GB');

const box = $('questions'), body = $('qbody');

/* The open panel sits between the engine panel and the FLY form, under both. */
function place() {
  if (!box.open) return;
  const e = $('engine')?.getBoundingClientRect(), f = $('beam')?.getBoundingClientRect();
  const top = Math.ceil((e ? e.bottom : 40) + 8), bottom = Math.floor(f ? f.top - 8 : innerHeight - 90);
  body.style.top = top + 'px';
  body.style.maxHeight = Math.max(120, bottom - top) + 'px';
}
addEventListener('resize', place);

async function text(url) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { cache: 'default', signal: ctl.signal });
    if (!r.ok) throw new Error(url.replace(ROOT, '') + ' HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}

/* The 1-based line on which a declaration starts in a source text, or null. */
const lineOf = (src, re) => { const i = src.search(re); return i < 0 ? null : src.slice(0, i).split('\n').length; };

function answer(dl, q, a) {
  const dt = document.createElement('dt'); dt.textContent = q;
  const dd = document.createElement('dd'); dd.textContent = a;
  dl.append(dt, dd);
}

const bandsPrinted = () => [...document.querySelectorAll('#engineThresholds .ethreshold')]
  .map(e => e.textContent.replace(/\s+/g, ' ').replace(/ lines from q\d+/, '').trim());

let built = null, facts = null;
async function build() {
  const dl = $('qlist');
  facts = { mods: null, atlas: null, L: {}, atlasLine: null, groupsLine: null, why: [] };
  const [man, atlas, src] = await Promise.allSettled([text(ROOT + 'layers/manifest.json'), text(ROOT + 'atlas/index.html'), text('layers-panel.mjs')]);
  if (man.status === 'fulfilled') {
    const m = JSON.parse(man.value);
    const mods = m.layers.filter(l => l.id.startsWith('module-'));
    facts.mods = { n: mods.length, layers: m.layers.length, features: mods.reduce((s, l) => s + (Number(l.features) || 0), 0) };
  } else facts.why.push('layers/manifest.json: ' + man.reason.message);
  if (atlas.status === 'fulfilled') {
    const h = atlas.value, start = h.indexOf('group: "Topology');
    facts.groupsLine = lineOf(h, /const GROUPS\s*=/);
    if (start >= 0) {
      facts.atlasLine = h.slice(0, start).split('\n').length;
      const rows = h.slice(start, h.indexOf('] },', start)).split('\n').filter(t => /\{\s*id:/.test(t));
      const get = (t, k) => (t.match(new RegExp(k + ':\\s*"([^"]*)"')) || [])[1];
      facts.atlas = rows.map(t => ({ label: get(t, 'label'), color: get(t, 'color'), type: get(t, 'type'), width: (t.match(/width:\s*([0-9.]+)/) || [])[1] }));
    } else facts.why.push('atlas/index.html has no Topology group');
  } else facts.why.push('atlas/index.html: ' + atlas.reason.message);
  if (src.status === 'fulfilled') {
    const s = src.value;
    for (const [k, re] of Object.entries({
      evalExpr: /function evalExpr\(/, readAtlasTopology: /async function readAtlasTopology\(/, moduleStats: /function moduleStats\(/,
      computeBands: /function computeBands\(/, bandOf: /const bandOf =/, FEATURE_CAP: /export const FEATURE_CAP/, makeRoom: /function makeRoom\(/,
      viewRing: /function viewRing\(/, loadInView: /async function loadInView\(/, strokeRoute: /function strokeRoute\(/, planRaster: /function planRaster\(/,
    })) facts.L[k] = lineOf(s, re);
  } else facts.why.push('layers-panel.mjs: ' + src.reason.message);

  const at = k => facts.L[k] ? `${k}() line ${facts.L[k]}` : `${k}() (line not found)`;
  const lines = facts.atlas ? facts.atlas.filter(r => r.type === 'line') : [];
  const sub = facts.atlas ? facts.atlas.find(r => r.type === 'point') : null;
  const styles = lines.length
    ? lines.map(r => `${r.label} ${r.color} width ${r.width}`).join(', ') + (sub ? `; ${sub.label} ${sub.color} point` : '')
    : 'not read (' + facts.why.join('; ') + ')';

  answer(dl, '1 · How does this help draw a system or a single-line diagram?',
    'It draws no network and no SLD. It is a visual metaphor for code: each module\'s routes (LineString geometry.keys in its layers/module-*.json file) ' +
    'are painted as if they were transmission lines, and a module\'s "voltage" is only its quantile band of distinct numbered lines, not a voltage. ' +
    `The styles are the Grid Atlas Topology group, read now from atlas/index.html${facts.atlasLine ? ' line ' + facts.atlasLine : ''}: ${styles}. ` +
    `Each module's smallest key is drawn as the substation point, its radius from the Atlas zoom expression by ${at('evalExpr')}. ` +
    'What it enables: the feeder and cable-route line grammar (colour and width per voltage level) and the substation marker, taken from Atlas data rather than typed, ' +
    `drawn over thousands of routes by ${at('strokeRoute')} and ${at('planRaster')} in layers-panel.mjs. A later SLD layer could reuse that paint; no busbar, transformer, protection or earthing is drawn here.`);

  answer(dl, '2 · What is this code used for?',
    'Files: index.html, app.mjs (the wafer), layers-panel.mjs (layers and engine mode), style.css, questions.mjs (this panel). ' +
    `In layers-panel.mjs: loader ${at('loadInView')}, ${at('viewRing')}, ${at('makeRoom')}, FEATURE_CAP line ${facts.L.FEATURE_CAP ?? 'not found'}; ` +
    `Atlas reader ${at('readAtlasTopology')} (reads the Topology group of GROUPS${facts.groupsLine ? ', declared at atlas/index.html line ' + facts.groupsLine : ''}); ` +
    `bands ${at('moduleStats')}, ${at('computeBands')}, bandOf line ${facts.L.bandOf ?? 'not found'}. Line numbers are measured from this copy of the file at run time. ` +
    'Who else uses the same styles: iterations/33-engines-as-tools/tools.mjs states in its source that its evalExpr, parseAtlasTopology and voltageBands were lifted from this file ' +
    '(cited from its source comments, at an earlier commit with other line numbers); iterations/41-golden-angle/app.mjs lists this directory\'s app.mjs and layers-panel.mjs among importers of place() (name-match inference). ' +
    'Nothing imports this copy.');

  answer(dl, '3 · Where does it lead next?',
    'iterations/33-engines-as-tools: the same drawing logic as tools (voltageBands, strokeLikeTransmission, substationDot) applied to any layer, not only module routes. ' +
    'iterations/30-journey: the wafer by level of detail, following one thread stop by stop. ' +
    'The next electrical element of a real system is not established: this page carries none.');
  const nav = document.createElement('p');
  nav.innerHTML = '<a href="../33-engines-as-tools/">33 · engines as tools</a> · <a href="../30-journey/">30 · journey</a>';
  dl.after(nav);
}

function paintMachine() {
  const v = window.__wafer?.view, b = bandsPrinted(), F = facts;
  const held = window.__layers04?.held?.();
  const t = 'Machine detail · inputs: ' +
    (F?.mods ? `${fmt(F.mods.n)} module layers of ${fmt(F.mods.layers)} in layers/manifest.json (${fmt(F.mods.features)} features; keys are dimensionless line numbers)` : 'layers/manifest.json module layers (not read yet)') +
    `; atlas GROUPS Topology: ${F?.atlas ? F.atlas.length + ' rows' : 'not read yet'}; zoom proxy log2(pixels per wafer unit) = ${v?.zoom ? Math.log2(v.zoom).toFixed(2) : 'waiting for the wafer'} · ` +
    `outputs: band lower bounds in distinct lines per module, ${b.length ? b.join(', ') : 'none yet (no module routes loaded)'} (read live from the engine panel) · ` +
    `refusals and limits: ${fmt(FEATURE_CAP)}-feature ceiling (${held != null ? fmt(held) + ' held now' : 'held count unavailable'}), a module that does not fit is not loaded, with the reason on its row; ` +
    `each press loads only modules with a line in the ring of radii on screen; ${MAX_FETCH} fetches at a time, ${FETCH_TIMEOUT_MS / 1000} s timeout; an unreadable Atlas turns engine mode off with the reason · ` +
    `commits: this directory at ${BASE_COMMIT}; 33's tools.mjs cites 04 at 34f7a16c6677; numbered database testcode 202609142202 (app.mjs DATA)` +
    (F?.why.length ? ' · not read: ' + F.why.join('; ') : '');
  const m = $('machine');
  if (m.textContent !== t) m.textContent = t;
}

let timer = 0;
box.addEventListener('toggle', () => {
  if (!box.open) { clearInterval(timer); timer = 0; return; }
  place();
  if (!built) built = build().then(paintMachine, e => { $('machine').textContent = 'Questions could not be built: ' + e.message; });
  paintMachine();
  if (!timer) timer = setInterval(() => { place(); paintMachine(); }, 500);
});
