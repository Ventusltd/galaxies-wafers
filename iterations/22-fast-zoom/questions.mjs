/* questions.mjs — iteration 22: the owner's three questions and the machine
 * detail line. Every count is read at run time from layers/manifest.json or from
 * the live wafer; function names and files are cited from this directory's own
 * source. Nothing here is a guess: where an answer is not established it says so.
 */
import { FEATURE_CAP, FETCH_TIMEOUT_MS, MAX_FETCH, THIN_STEP } from './layers-panel.mjs';

const BASE_COMMIT = 'abda58b';   /* the root commit this directory was copied from */
const $ = id => document.getElementById(id);
const fmt = n => Number(n).toLocaleString('en-GB');

function answer(dl, q, a) {
  const dt = document.createElement('dt'); dt.textContent = q;
  const dd = document.createElement('dd'); dd.textContent = a;
  dl.append(dt, dd);
}

(async () => {
  const dl = $('qlist');
  if (!dl) return;
  let sld = 'the layer manifest could not be read, so no SLD layer can be named';
  try {
    const r = await fetch('../../layers/manifest.json', { cache: 'default' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const m = await r.json();
    const hits = m.layers.filter(l => /sld/i.test(l.id));
    sld = hits.length
      ? `Of ${fmt(m.layers.length)} layers in layers/manifest.json, ${hits.length} carry "sld" in their id (name-match inference): ` +
        hits.map(l => `${l.id} (${fmt(l.features)} features)`).join(', ') + '.'
      : `None of the ${fmt(m.layers.length)} layers in layers/manifest.json carries "sld" in its id.`;
  } catch (e) { sld = `the layer manifest could not be read (${e.message}), so no SLD layer can be named`; }

  answer(dl, '1 · How does this help draw a system or a single-line diagram?',
    'None yet: this page draws no busbar, feeder, transformer, cable route, protection or earthing. ' +
    'It is the drawing surface made cheap to move, so layers that mark SLD code stay readable during a pinch. ' + sld +
    ' Such a layer is drawn by drawOverlay() in layers-panel.mjs from each feature\'s geometry.key or geometry.keys.');
  answer(dl, '2 · What is this code used for?',
    `Pan and zoom of the numbered wafer. app.mjs: render(), blitCache(), rasterCache(), visibleRange(); ` +
    `layers-panel.mjs: fetchJSON(), makeRoom(), updateTiles(), buildCache(), drawOverlay(). build_tiles.py writes the radius-band tiles. Copied from the root app.mjs and layers-panel.mjs at commit ${BASE_COMMIT}. ` +
    'In the estate the root page and the iteration 09 deep-link receiver run the root versions of these functions (read from their source); nothing calls this copy.');
  answer(dl, '3 · Where does it lead next?',
    'Not established: the page carries no electrical element, so it joins no next element of a system. ' +
    'The owner\'s link opens iteration 09, which still draws every point on every frame; this frame rule has not been carried there.');

  const machine = $('machine');
  const paint = () => {
    const s = window.__wafer?.stats;
    const L = window.__waferLayers?.stats;
    machine.textContent = 'Machine detail · inputs: wheel deltaY and pointer positions (CSS px), layer files of permanent line keys (dimensionless) · ' +
      `outputs: ${s ? `${fmt(s.drawn)} of ${fmt(s.total)} points in the last wafer draw, ${fmt(s.rasters)} cache rasters` : 'waiting for the wafer'}, frame ms (measured, above) · ` +
      (L ? `layers: ${fmt(L.held)} of ${fmt(L.cap)} features in memory, ${fmt(L.bandsInMemory)} bands, ${fmt(L.keysDrawn)} keys in the last overlay frame, ${fmt(L.evictions)} released · ` : '') +
      `refusals: REFUSED above ${fmt(FEATURE_CAP)} features in memory, FAIL with its HTTP status or a ${FETCH_TIMEOUT_MS / 1000} s timeout, EMPTY with the layer's reason · ` +
      `moving frames keep every ${THIN_STEP}th layer vertex; at most ${MAX_FETCH} fetches at once · source: copied from ${BASE_COMMIT}`;
  };
  paint();
  setInterval(() => { if ($('questions').open) paint(); }, 500);
})();
