/* The code particle: a tapped line opens the real code block it belongs to.
 *
 * Grid Atlas pattern, rewritten for one panel: nothing is fetched at page load;
 * the block register is fetched once on first need; source files go through a
 * FetchQueue of concurrency 2; setTag is the single writer of the WAIT/LOAD/OK/FAIL
 * state shown in the panel. Fetched text only ever reaches the DOM via textContent.
 */

const REGISTER = 'https://ventusltd.github.io/stars/blocks/blocks.json';
const RAW = 'https://raw.githubusercontent.com/';
const SHOW = 200;

class FetchQueue {
  constructor(concurrency) { this.concurrency = concurrency; this.active = 0; this.waiting = []; }
  async add(task, onWait) {
    if (this.active >= this.concurrency) { onWait?.(); await new Promise(r => this.waiting.push(r)); }
    this.active++;
    try { return await task(); }
    finally { this.active--; if (this.waiting.length) this.waiting.shift()(); }
  }
}
const queue = new FetchQueue(2);
const source = new Map();          /* repo@commit:path -> Promise<string> */
let register = null;               /* Promise<Map<familyN, block>> */
let token = 0;                     /* the panel belongs to the latest tap only */

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

function loadRegister() {
  if (!register) register = fetch(REGISTER, { cache: 'default' }).then(r => {
    if (!r.ok) throw new Error(REGISTER + ' returned HTTP ' + r.status);
    return r.json();
  }).then(j => {
    const byFamily = new Map();
    for (const b of j.blocks) for (const i of b.inside || []) if (!byFamily.has(i.family)) byFamily.set(i.family, b);
    return byFamily;
  }).catch(e => { register = null; throw e; });
  return register;
}

function readFile(file, onWait) {
  const key = `${file.repo}@${file.commit}:${file.path}`;
  if (!source.has(key)) {
    const p = queue.add(async () => {
      const url = `${RAW}${file.repo}/${file.commit}/${file.path}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(url + ' returned HTTP ' + r.status);
      return r.text();
    }, onWait);
    p.catch(() => source.delete(key));
    source.set(key, p);
  }
  return source.get(key);
}

/* families: the family records carrying the tapped line, in panel order. */
export async function openCode(families, host) {
  const mine = ++token;
  const box = el('div'); box.id = 'code';
  const tag = el('span', 'tag');
  const msg = el('span', 'dim');
  const setTag = (state, text) => {                 /* the single writer */
    if (mine !== token) return false;
    tag.dataset.s = state; tag.textContent = state;
    if (text != null) msg.textContent = text;
    return true;
  };
  box.append(tag, msg);
  host.querySelector('#code')?.remove();
  host.appendChild(box);

  setTag('LOAD', 'reading the block register…');
  let byFamily;
  try { byFamily = await loadRegister(); }
  catch (e) { setTag('FAIL', 'Could not read the block register: ' + e.message); return; }

  let fam = null, block = null;
  for (const f of families) { const b = byFamily.get(f.n); if (b && b.files?.length) { fam = f; block = b; break; } }
  if (!block) {
    setTag('OK', `Resolved no block: none of the ${families.length} ${families.length === 1 ? 'family' : 'families'} carrying this line is inside any block in the register, so there is no pinned code to show.`);
    return;
  }
  const where = el('p', 'dim', `Resolved block ${block.symbol} · ${block.title} — via family #${fam.n} ${fam.name}` +
    (families.length > 1 ? ` (the first of the ${families.length} carrying families that a block contains)` : ''));
  box.appendChild(where);

  /* A block can pin several copies; read them in register order through the
     queue and stop at the first that defines the family's function. */
  const esc = fam.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const def = new RegExp(`(function\\s*\\*?\\s*${esc}\\b|\\b(const|let|var)\\s+${esc}\\s*=|^\\s*(async\\s+)?${esc}\\s*(\\(|:)|\\bdef\\s+${esc}\\b)`);
  const word = new RegExp(`\\b${esc}\\b`);
  let file = null, lines = null, hit = -1, lastErr = null;
  for (const [n, f] of block.files.entries()) {
    setTag('LOAD', `fetching file ${n + 1} of ${block.files.length} at its pinned commit…`);
    let text;
    try { text = await readFile(f, () => setTag('WAIT', 'queued behind other fetches…')); }
    catch (e) { lastErr = e; continue; }
    if (mine !== token) return;
    const ls = text.split('\n'), h = ls.findIndex(l => def.test(l));
    if (!file || h >= 0) { file = f; lines = ls; hit = h; }
    if (h >= 0) break;
  }
  if (!file) { setTag('FAIL', 'Could not read the source: ' + lastErr.message); return; }
  const defined = hit >= 0;
  if (!defined) hit = lines.findIndex(l => word.test(l) && !/^\s*(\*|\/\/|\/\*|#)/.test(l));
  const start = hit < 0 ? 0 : Math.max(0, Math.min(hit - 4, lines.length - SHOW));
  const shown = lines.slice(start, start + SHOW);

  const gh = `https://github.com/${file.repo}/blob/${file.commit}/${file.path}` + (hit >= 0 ? `#L${hit + 1}` : '');
  const head = el('div', 'codehead');
  head.append(`${file.path} · ${file.repo} @ ${file.commit.slice(0, 7)} · lines ${start + 1}–${start + shown.length} of ${lines.length}` +
    (hit < 0 ? ` · "${fam.name}" not found in this file, showing the top`
             : ` · ${fam.name} ${defined ? 'defined' : 'first used'} at line ${hit + 1}`) + ' · ');
  const a = el('a', null, 'open on GitHub'); a.href = gh; a.target = '_blank'; a.rel = 'noopener';
  head.appendChild(a);
  const pre = el('pre');
  pre.textContent = shown.map((l, i) => String(start + i + 1).padStart(5) + '  ' + l).join('\n');
  box.append(head, pre);
  setTag('OK', `file ${block.files.indexOf(file) + 1} of ${block.files.length} in the block, at the commit the register pins`);
  if (hit >= 0) {
    const lh = parseFloat(getComputedStyle(pre).lineHeight) || 16;
    pre.scrollTop = (hit - start) * lh;
  }
}
