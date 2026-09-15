/* questions.mjs — iteration 09, the Deep-Link Receiver: the owner's three
 * questions and the machine detail line. The parsed link and the receiver list
 * are read at run time from the same module instances the page uses
 * (receiver.mjs LINK, engine/code-galaxy-engine.mjs PARAMS and RECEIVERS); layer
 * counts from layers/manifest.json; functions are cited to file and line.
 */
import { LINK } from './receiver.mjs';
import { PARAMS, RECEIVERS, LIFTED_FROM } from '../../engine/code-galaxy-engine.mjs';

const $ = id => document.getElementById(id);
const fmt = n => Number(n).toLocaleString('en-GB');
const DATA_PIN = 'https://globalgrid2050.com/testcode/202609142202/data/';
const SEARCH = 'repository search at ee082ea';   /* the commit the "who else" searches were run on */

/* One question and its answer. Parts are strings or [text, href] links; text only, never HTML. */
function answer(dl, q, parts) {
  const dt = document.createElement('dt'); dt.textContent = q;
  const dd = document.createElement('dd');
  const fill = ps => {
    dd.replaceChildren();
    for (const p of [].concat(ps)) {
      if (Array.isArray(p)) { const a = document.createElement('a'); a.textContent = p[0]; a.href = p[1]; dd.append(a); }
      else dd.append(String(p));
    }
  };
  fill(parts);
  dl.append(dt, dd);
  return fill;
}

/* One fetch, 15 s timeout, only when the reader opens the panel. */
async function readJSON(url) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 15000);
  try {
    const r = await fetch(url, { cache: 'default', signal: c.signal });
    if (!r.ok) throw new Error(url + ' returned HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

/* The layer rows' tags as the layers panel shows them now, counted from its own DOM. */
function layerTags() {
  const c = new Map();
  for (const t of document.querySelectorAll('#layersList .ltag')) {
    const s = (t.textContent.match(/[A-Z]+/) || ['?'])[0];
    c.set(s, (c.get(s) || 0) + 1);
  }
  return c.size ? [...c].map(([s, n]) => `${fmt(n)} ${s}`).join(', ') : 'layer rows not built yet';
}

/* Layers whose id names an SLD, read from a manifest at run time (name-match inference). */
function sldSentence(m, file) {
  const hits = m.layers.filter(l => /sld/i.test(l.id));
  if (!hits.length) return `None of the ${fmt(m.layers.length)} layers in ${file} carries "sld" in its id.`;
  return `Of ${fmt(m.layers.length)} layers in ${file}, ${hits.length} carry "sld" in their id (name-match inference): ` +
    hits.map(l => `${l.id} (${fmt(l.features)} features, draws ${l.draws})`).join(', ') + '.';
}

const text = id => ($(id)?.textContent || '').trim();

/* Collapsed by default. Nothing is read or fetched until the reader opens it; the
   machine line repaints every 500 ms only while it is open. */
function mount(build, machine) {
  const box = $('questions'), dl = $('qlist'), out = $('machine');
  if (!box || !dl || !out) return;
  let built = false, timer = 0;
  /* Opened, the panel stops above whatever is drawn at the bottom (line panel, clock, strip, beam form), never over it. */
  const fit = () => {
    const top = box.getBoundingClientRect().top;
    let floor = innerHeight;
    for (const id of ['panel', 'clock', 'ptable', 'beam']) {
      const el = $(id);
      const r = el && !el.hidden ? el.getBoundingClientRect() : null;
      if (r && r.height > 0 && r.top > top) floor = Math.min(floor, r.top);
    }
    box.style.maxHeight = Math.max(96, Math.min(innerHeight * 0.45, floor - top - 8)) + 'px';
  };
  const paint = () => {
    fit();
    try { out.textContent = 'Machine detail · ' + machine(); }
    catch (e) { out.textContent = 'Machine detail · not established: ' + e.message; }
  };
  /* A bottom element that grows while the panel is open refits it at once, not at the next repaint. */
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(() => { if (box.open) fit(); });
    for (const id of ['panel', 'clock', 'ptable', 'beam']) if ($(id)) ro.observe($(id));
  }
  addEventListener('resize', () => { if (box.open) fit(); });
  box.addEventListener('toggle', () => {
    clearInterval(timer);
    if (!box.open) return;
    if (!built) { built = true; build(dl); }
    paint();
    timer = setInterval(paint, 500);
  });
}

const COMMIT = '8ac6cd4';   /* the last commit to this page before the Questions panel */

mount(dl => {
  const q1 = answer(dl, '1 · How does this help draw a system or a single-line diagram?', 'reading layers/manifest.json…');
  answer(dl, '2 · What is this code used for?',
    'Arriving at a line from a link, and building links out. engine/code-galaxy-engine.mjs: parseDeepLink() line 78 reads a URL and never throws, buildDeepLink() line 55 writes one and throws on a bad field, RECEIVERS line 35 lists where links may point; ' +
    `it is lifted from ${LIFTED_FROM} (read now from LIFTED_FROM, line 24). receiver.mjs parses location.href once (LINK, line 22), paintCard() line 37 shows the arrival or refusal card, emitPanel() line 77 builds links, checkReceivers() line 114 compares engine/receivers.json with RECEIVERS. ` +
    'layers-panel.mjs requestedLayers() line 255 loads a layers-only link only after re-checking to and zoom with a placeholder line; app.mjs readURL() line 645 flies to LINK.line or connects LINK.line to LINK.to. ' +
    `Who else: engine/code-galaxy-engine.mjs is imported by this page's receiver.mjs and layers-panel.mjs and by proof/engine.check.mjs, and by no other file; engine/receivers.json is read only here (${SEARCH}).`);
  answer(dl, '3 · Where does it lead next?',
    'To the receivers its links point at, read now from RECEIVERS: ' +
    RECEIVERS.map(r => `${r.id} (${r.status}, ${r.carries_layers ? 'carries layers' : 'carries no layers'}) at ${r.url}`).join('; ') +
    '. The EMIT panel builds a link to each; the second refuses a layers field in the engine\'s own words.');
  readJSON('../../layers/manifest.json').then(m => {
    q1('It draws no electrical element; it carries a place on the wafer between pages. ' +
      `The link fields, read now from PARAMS (line 28), are ${Object.keys(PARAMS).join(', ')}; none is an electrical quantity. ` +
      'What that enables: a link can arrive with named layers ticked, an SLD layer included. ' + sldSentence(m, 'layers/manifest.json'));
  }).catch(e => q1(`Not established: layers/manifest.json could not be read (${e.message}). The page draws no electrical element.`));
}, () => {
  const card = $('linkcard');
  const link = LINK.ok
    ? `accepted: line ${LINK.line}${LINK.to !== undefined ? `, to ${LINK.to}` : ''}${LINK.zoom !== undefined ? `, zoom ${LINK.zoom}` : ''}${LINK.layers ? `, layers ${LINK.layers.join(',')}` : ''}`
    : `refused: ${LINK.why}`;
  return `inputs: ?line= (the identity, a positive safe integer), ?to= (a second line), ?layers= (ids from layers/manifest.json), ?zoom= (0.02 to 4000), each read only through parseDeepLink(); ` +
    `data: all-lines.meta.json, all-lines.bin, all-lines.len.bin, all-lines.family.bin, families.json and lines.bin from ${DATA_PIN} (app.mjs line 53), ${text('prov') || 'provenance not loaded yet'}; engine/receivers.json and layers/manifest.json from this repository · ` +
    `outputs: this link ${link}; card ${card && !card.hidden ? `shown, ${card.dataset.state || 'no state'}` : 'hidden'}; ${text('count') || 'count not loaded yet'}; layer rows now ${layerTags()}; receivers check ${text('emitReceivers') || 'not run'} · ` +
    'refusals: LINK REFUSED quoting parseDeepLink\'s reason, wafer drawn at home (receiver.mjs line 45); a layers-only link loads its layers only if to and zoom are valid (layers-panel.mjs line 262); unknown layer ids are not ticked and are named as dropped (line 274); receivers.json disagreeing with RECEIVERS reads FAIL (receiver.mjs line 121) · ' +
    `source: page commit ${COMMIT}; engine/code-galaxy-engine.mjs, lib.mjs and layers/ from this repository`;
});
