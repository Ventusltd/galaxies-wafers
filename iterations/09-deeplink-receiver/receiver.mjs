/* receiver.mjs — iteration 09: the page reads its own URL through the engine.
 *
 * The inherited page parsed `line` and `to` with its own readURL and `layers`
 * with its own reader, and nothing read `zoom`. Here the URL is parsed once,
 * by parseDeepLink from engine/code-galaxy-engine.mjs, and every other module
 * takes its orders from LINK. Like the Atlas's receiver (repd_ref, validated,
 * then centre and open a card), a link is never guessed at: a bad one is
 * refused in a card that quotes the engine's own reason, and the wafer is
 * drawn at home.
 *
 * The card also reports what the receiver did with the layers field: ids the
 * manifest names are ticked, ids it does not are listed as dropped.
 *
 * The emit panel is the other half of the contract: buildDeepLink, for the
 * layered receiver and for the layerless one, which refuses a layers field in
 * the engine's words. engine/receivers.json is fetched and compared with the
 * module's RECEIVERS; any disagreement is shown as FAIL.
 */
import { parseDeepLink, buildDeepLink, RECEIVERS, IDENTITY_PARAM } from '../../engine/code-galaxy-engine.mjs';

export const ROOT = '../../';
export const LINK = parseDeepLink(location.href);
export const hasLink = new URL(location.href).search.length > 0;

const $ = id => document.getElementById(id);
const node = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text != null) n.textContent = String(text);
  if (cls) n.className = cls;
  return n;
};

/* ── the arrival card ────────────────────────────────────────────────────── */

const card = { layers: null };

function paintCard() {
  const box = $('linkcard');
  if (!box) return;
  box.replaceChildren();
  if (!hasLink) { box.hidden = true; return; }
  const close = node('button', '✕', 'lcclose'); close.type = 'button'; close.setAttribute('aria-label', 'close');
  close.addEventListener('click', () => { box.hidden = true; });
  box.append(close);
  if (!LINK.ok) {
    box.dataset.state = 'refused';
    box.append(node('b', 'LINK REFUSED', 'lctitle'),
      node('div', LINK.why, 'lcwhy'),
      node('div', 'the engine\'s parseDeepLink returned ok:false; the wafer is drawn at home', 'lcdim'));
    box.hidden = false; return;
  }
  box.dataset.state = 'ok';
  box.append(node('b', `LINE ${LINK.line}`, 'lctitle'));
  const dl = node('dl');
  const kv = (k, v, cls) => dl.append(node('dt', k), node('dd', v, cls));
  kv(IDENTITY_PARAM, String(LINK.line));
  if (LINK.to !== undefined) kv('to', String(LINK.to));
  if (LINK.zoom !== undefined) kv('zoom', String(LINK.zoom));
  if (LINK.layers) {
    if (!card.layers) kv('layers', LINK.layers.join(', ') + ' (waiting for the manifest)', 'lcdim');
    else {
      kv('layers ticked', card.layers.ticked.length ? card.layers.ticked.join(', ') : 'none');
      if (card.layers.dropped.length) kv('dropped', card.layers.dropped.join(', ') + ' — not in layers/manifest.json', 'lcdrop');
      if (card.layers.failed) kv('layers', card.layers.failed, 'lcdrop');
    }
  }
  kv('receiver', LINK.receiver ?? 'this page (not a published receiver URL)', 'lcdim');
  box.append(dl);
  box.hidden = false;
}

/* layers-panel.mjs calls this once it knows the manifest. */
export function reportLayers(r) { card.layers = r; paintCard(); }

/* ── the emit panel ──────────────────────────────────────────────────────── */

function emitPanel(manifest) {
  const sec = $('emit');
  const body = $('emitBody');
  $('emitToggle').addEventListener('click', () => { body.hidden = !body.hidden; });
  const inLine = $('emitLine'), inTo = $('emitTo'), pick = $('emitLayers');
  if (LINK.ok) { inLine.value = String(LINK.line); if (LINK.to !== undefined) inTo.value = String(LINK.to); }
  for (const l of (manifest?.layers || [])) {
    const o = node('option', l.id); o.value = l.id;
    if (LINK.ok && LINK.layers?.includes(l.id)) o.selected = true;
    pick.append(o);
  }
  const intOrUndef = s => (s.trim() === '' ? undefined : (/^[0-9]+$/.test(s.trim()) ? Number(s.trim()) : s.trim()));
  const show = (id, fn) => {
    const out = $(id);
    try { out.textContent = fn(); out.className = 'eurl'; out.dataset.ok = '1'; }
    catch (e) { out.textContent = e.message; out.className = 'eurl eerr'; out.dataset.ok = ''; }
  };
  const update = () => {
    const line = intOrUndef(inLine.value), to = intOrUndef(inTo.value);
    const chosen = [...pick.selectedOptions].map(o => o.value);
    const layers = chosen.length ? chosen : undefined;
    show('emitA', () => buildDeepLink(RECEIVERS[0].id, { line, to, layers }));
    show('emitB', () => buildDeepLink('line-wafer-202609151339', { line, to, layers }));
  };
  for (const el of [inLine, inTo, pick]) el.addEventListener('input', update);
  pick.addEventListener('change', update);
  $('emitCopy').addEventListener('click', async () => {
    const t = $('emitA').dataset.ok ? $('emitA').textContent : '';
    if (!t) return;
    try { await navigator.clipboard.writeText(t); $('emitCopy').textContent = 'COPIED'; }
    catch { $('emitCopy').textContent = 'COPY BLOCKED'; }
    setTimeout(() => { $('emitCopy').textContent = 'COPY'; }, 1400);
  });
  update();
  sec.hidden = false;
}

async function checkReceivers() {
  const out = $('emitReceivers');
  try {
    const r = await fetch(ROOT + 'engine/receivers.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('engine/receivers.json returned HTTP ' + r.status);
    const doc = await r.json();
    const a = JSON.stringify(doc.receivers), b = JSON.stringify(RECEIVERS);
    if (a !== b) throw new Error('engine/receivers.json disagrees with RECEIVERS in the module');
    out.textContent = `receivers.json agrees with the module · ${RECEIVERS.map(x => x.id).join(', ')}`;
    out.className = 'estat OK';
  } catch (e) { out.textContent = 'FAIL · ' + e.message; out.className = 'estat FAIL'; }
}

paintCard();
checkReceivers();
fetch(ROOT + 'layers/manifest.json', { cache: 'no-cache' })
  .then(r => (r.ok ? r.json() : null)).catch(() => null)
  .then(m => emitPanel(m));
