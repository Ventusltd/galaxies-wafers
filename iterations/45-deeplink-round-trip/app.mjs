/* 45 · The MAP Button, Round Trip.
 * Every link, parse, refusal and layer id on this page comes from the estate's
 * contract module, imported at a pinned commit. Nothing here re-implements it. */
const COMMIT = 'd9cd18b0e2034325814924e6e4a0e958014f2748';
const ROOT = `https://cdn.jsdelivr.net/gh/Ventusltd/ventus-grid-engine@${COMMIT}/`;
const MOD_URL = ROOT + 'deeplink/contract.js';
const RECEIVERS_URL = ROOT + 'deeplink/receivers.json';
/* The v9.5.1 MAP sender, quoted (not imported): pipelinenews
 * releases/javascript/202608261927-projects-v9-5-1.js, atlasUrlV9_5_1(), line 44. */
const SENDER_V951 = { file: 'pipelinenews releases/javascript/202608261927-projects-v9-5-1.js', fn: 'atlasUrlV9_5_1', line: 44,
  base: 'https://globalgrid2050.com/repd_grid_atlasv8/' };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const show = (v) => v === null ? 'null' : v === undefined ? 'undefined' : typeof v === 'string' ? JSON.stringify(v) : String(v);

/* Grid Atlas loading grammar: one queue (4 at once), 15 s timeout, one promise per URL, a failure leaves the cache. */
const queue = { running: 0, waiting: [], max: 4 };
function enqueue(task) {
  return new Promise((resolve, reject) => {
    queue.waiting.push({ task, resolve, reject });
    pump();
  });
}
function pump() {
  while (queue.running < queue.max && queue.waiting.length) {
    const { task, resolve, reject } = queue.waiting.shift();
    queue.running++;
    task().then(resolve, reject).finally(() => { queue.running--; pump(); });
  }
}
function timedFetch(url, init = {}) {
  return enqueue(async () => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15000);
    const t0 = performance.now();
    try {
      const res = await fetch(url, { ...init, signal: ctl.signal });
      const text = await res.text();
      return { res, text, ms: performance.now() - t0 };
    } finally { clearTimeout(timer); }
  });
}
const cache = new Map();
function cachedText(url) {
  if (!cache.has(url)) {
    const p = timedFetch(url).then(({ res, text }) => { if (!res.ok) throw new Error('HTTP ' + res.status); return text; });
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return cache.get(url);
}

let C;              // the contract module
let records = [];   // synthetic records, one per bucket
let otherReason = null;

function syntheticRecords() {
  /* Synthetic: identities are not REPD references; points are a fixed arithmetic walk, not project sites. */
  return C.BUCKETS.map((technology, i) => ({
    repd_ref: `SYNTH-${String(i + 1).padStart(2, '0')}`,
    technology,
    latitude: 50.1 + i * 0.37,
    longitude: -5.2 + i * 0.61,
    zoom: 12
  }));
}

function extractNullReason(src) {
  const lines = src.split('\n');
  const at = lines.findIndex((l) => /`other` maps to null/.test(l));
  if (at < 0) return null;
  let end = at;
  while (end < lines.length && !/\*\//.test(lines[end])) end++;
  const text = lines.slice(at, end).map((l) => l.replace(/^\s*\*\s?/, '')).join(' ').replace(/\s+/g, ' ').trim();
  return { text, from: at + 1, to: end };
}

function reasonText(bucket) {
  return otherReason
    ? `EMPTY: no Atlas layer. The module, contract.js lines ${otherReason.from}-${otherReason.to}: “${otherReason.text}”`
    : `EMPTY: no Atlas layer (LAYER_ID_FOR_BUCKET.${bucket} is null). Reading the module's stated reason from its source...`;
}

function roundTrip() {
  let survived = 0, noLayer = 0, renamed = 0;
  const frag = document.createDocumentFragment();
  for (const rec of records) {
    const li = document.createElement('li');
    li.dataset.bucket = rec.technology;
    let href, parsed;
    try { href = C.buildDeepLink(rec); parsed = C.parseDeepLink(href); }
    catch (e) {
      li.className = 'row empty';
      li.innerHTML = `<div class="rhead"><span class="st">REFUSED</span><span>${esc(rec.technology)}</span></div><div class="quote">${esc(e.message)}</div>`;
      frag.append(li); continue;
    }
    const fields = Object.keys(C.PARAMS);
    const diffs = fields.filter((k) => parsed[k] !== rec[k]);
    if (!diffs.length) survived++;
    const layer = parsed.layer_id;
    if (!parsed.layer_exists) noLayer++;
    if (layer !== null && layer !== rec.technology) renamed++;
    li.className = 'row ' + (diffs.length ? 'changed' : 'same');
    li.dataset.survived = String(!diffs.length);
    li.dataset.layer = String(layer);
    const rows = fields.map((k) => `<span>${k}</span><span>${esc(show(rec[k]))} → ${esc(show(parsed[k]))}${parsed[k] === rec[k] ? ' (===)' : ' <b class="refuse">changed</b>'}</span>`).join('');
    const layerRows = `<span>layer_id</span><span>${esc(show(layer))}${layer !== null && layer !== rec.technology ? ' (renamed by LAYER_ID_FOR_BUCKET)' : ''}</span><span>layer_exists</span><span>${parsed.layer_exists}</span><span>known_bucket</span><span>${parsed.known_bucket}</span>`;
    const reason = layer === null ? `<div class="quote reason" data-bucket="${esc(rec.technology)}">${esc(reasonText(rec.technology))}</div>` : '';
    li.innerHTML = `<div class="rhead"><span class="st">${diffs.length ? 'CHANGED ' + esc(diffs.join(', ')) : 'EVERY FIELD SURVIVED'}</span><span>${esc(rec.technology)}</span><span class="dim small">synthetic</span></div>
      <code class="link">${esc(href)}</code><div class="f">${rows}${layerRows}</div>${reason}`;
    frag.append(li);
  }
  $('round').replaceChildren(frag);
  const n = records.length;
  const s = $('summary');
  s.innerHTML = `<b>${survived}</b> of <b>${n}</b> buckets read from <code>BUCKETS</code> survived build → parse with every field identical. <b>${noLayer}</b> resolve to no Atlas layer (<code>layer_exists</code> false). <b>${renamed}</b> are renamed by <code>LAYER_ID_FOR_BUCKET</code>.`;
  s.dataset.survived = survived; s.dataset.total = n; s.dataset.nolayer = noLayer; s.dataset.renamed = renamed;
}

function fillReasons() {
  document.querySelectorAll('.reason').forEach((el) => {
    el.textContent = otherReason ? reasonText(el.dataset.bucket)
      : `EMPTY: no Atlas layer (LAYER_ID_FOR_BUCKET.${el.dataset.bucket} is null). The module source could not be read for its stated reason.`;
  });
}

/* ── Receivers ─────────────────────────────────────────────────────────── */
let receivers = [];
function listReceivers(json) {
  receivers = [{ kind: 'canonical', ...json.canonical }, ...json.retired.map((r) => ({ kind: 'retired', ...r }))];
  const frag = document.createDocumentFragment();
  receivers.forEach((r, i) => {
    const li = document.createElement('li');
    li.className = 'row empty'; li.id = 'recv-' + i;
    const claim = r.kind === 'canonical' ? r.evidence : `${r.reason} Recorded: ${r.measured}.`;
    li.innerHTML = `<div class="rhead"><span class="st">${r.kind.toUpperCase()}</span><span>${esc(r.id)}</span><span class="dim">carries_engine: ${r.carries_engine}</span></div>
      <code class="link">${esc(r.route)}</code><div class="dim small">file says: ${esc(claim)}</div>
      <div class="f"><span>module</span><span>isRetiredReceiver → ${C.isRetiredReceiver(r.route)}</span><span>status now</span><span class="now">WAIT: tap measure</span></div>`;
    frag.append(li);
  });
  $('recv').replaceChildren(frag);
  $('measure').disabled = false;
}
let measuring = false;
async function measure() {
  if (measuring || !receivers.length) return;
  measuring = true; $('measure').disabled = true;
  await Promise.all(receivers.map(async (r, i) => {
    const li = $('recv-' + i), now = li.querySelector('.now');
    now.textContent = 'LOAD: fetching...';
    try {
      const { res, text, ms } = await timedFetch(r.route, { cache: 'no-store' });
      const count = (needle) => text.split(needle).length - 1;
      li.className = 'row same';
      li.dataset.status = res.status;
      now.textContent = `HTTP ${res.status}${res.statusText ? ' ' + res.statusText : ''} · ${Math.round(ms)} ms · ${text.length.toLocaleString('en-GB')} characters${res.redirected ? ' · redirected to ' + res.url : ''} · in the body now: "current.json" ${count('current.json')}×, "cartridge" ${count('cartridge')}×, "nearest" ${count('nearest')}×`;
    } catch (e) {
      li.className = 'row empty';
      li.dataset.status = 'FAIL';
      now.textContent = `FAIL: ${e.name === 'AbortError' ? 'no answer within 15 s' : e.name + ': ' + e.message} (the browser exposes no HTTP status for this)`;
    }
  }));
  measuring = false; $('measure').disabled = false; $('measure').textContent = 'measure again';
}

/* ── Break it ──────────────────────────────────────────────────────────── */
function analyse(text) {
  const out = [];
  const add = (st, field, words) => out.push({ st, field, words });
  const input = text.trim();
  let parsed;
  try { parsed = C.parseDeepLink(input); }
  catch (e) {
    add('REFUSED', 'the whole link', `parseDeepLink threw. Its first act is new URL(href); the browser's message: “${e.message}”`);
    return out;
  }
  const url = new URL(input);
  const base = url.origin + url.pathname;
  const strip = (v) => v.replace(/\/+$/, '');
  if (C.isRetiredReceiver(base)) add('REFUSED', 'receiver', 'isRetiredReceiver(base) is true: this route is in RETIRED_RECEIVERS. buildDeepLink\'s own words are on the rebuild line.');
  else if (strip(base) !== strip(C.CANONICAL_RECEIVER)) add('NOT REGISTERED', 'receiver', `${base} is neither CANONICAL_RECEIVER (${C.CANONICAL_RECEIVER}) nor in RETIRED_RECEIVERS. The module does not refuse it; it does not vouch for it either.`);
  else add('OK', 'receiver', 'CANONICAL_RECEIVER');
  for (const [k, spec] of Object.entries(C.PARAMS)) {
    const all = url.searchParams.getAll(k);
    const raw = all.length ? all[0] : null;
    const note = spec.note ? `note: “${spec.note}”` : `units: “${spec.units}”`;
    if (all.length > 1) add('AMBIGUOUS', k, `sent ${all.length} times (${all.map(show).join(', ')}); parseDeepLink reads searchParams.get, which keeps the first.`);
    if (raw === null || raw.trim() === '') {
      if (spec.required) add('REFUSED', k, `missing, and PARAMS.${k}.required is true; ${note}. parseDeepLink returns ${show(parsed[k])}.`);
      else add('ABSENT', k, `optional (PARAMS.${k}.required is false); parseDeepLink returns null.`);
      continue;
    }
    if (spec.type === 'number') {
      if (parsed[k] === null) add('REFUSED', k, `${show(raw)} is not a finite number, so parseDeepLink returns null (type "number", ${note}).`);
      else if ((k === 'latitude' && Math.abs(parsed[k]) > 90) || (k === 'longitude' && Math.abs(parsed[k]) > 180))
        add('LET THROUGH', k, `${parsed[k]} is outside the earth's range and the contract does not range-check it: parseDeepLink returns it as a number. (The spine emitter drops such values before sending, per docs/deeplink-contract.md section 1a.)`);
      else add('OK', k, `${show(raw)} → ${parsed[k]}`);
    } else if (k === 'technology') {
      if (!parsed.known_bucket) add('REFUSED', k, `${show(raw)} is not in BUCKETS (known_bucket false); ${note}. layerIdForBucket gives ${show(parsed.layer_id)}; layer_exists ${parsed.layer_exists}${parsed.layer_exists ? ': a real layer id, but the sender speaks buckets, not layer ids' : ''}.`);
      else if (parsed.layer_id === null) add('NO LAYER', k, `${show(raw)} is a bucket whose layer_id is null. ${otherReason ? 'The module: “' + otherReason.text + '”' : ''}`);
      else add('OK', k, `${show(raw)} → layer ${show(parsed.layer_id)}${parsed.layer_id !== raw ? ' (renamed by LAYER_ID_FOR_BUCKET)' : ''}`);
    } else {
      add('OK', k, show(raw));
    }
  }
  for (const k of new Set(url.searchParams.keys())) {
    if (k in C.PARAMS) continue;
    const words = k === 'repd_id'
      ? `not a contract parameter. IDENTITY_PARAM is ${show(C.IDENTITY_PARAM)}; the module's comment: “The project is identified by repd_ref. NOT repd_id.”`
      : 'not in PARAMS; the contract does not carry it, and a rebuild drops it.';
    add('DROPPED', k, words);
  }
  try {
    const project = Object.fromEntries(Object.keys(C.PARAMS).map((k) => [k, parsed[k]]));
    const rebuilt = C.buildDeepLink(base, project);
    add(rebuilt === input ? 'OK' : 'CHANGED', 'rebuild', rebuilt === input ? 'buildDeepLink(base, parsed) returns exactly the text above.' : `buildDeepLink(base, parsed) returns: ${rebuilt}`);
  } catch (e) {
    add('REFUSED', 'rebuild', `buildDeepLink threw: “${e.message}”`);
  }
  return out;
}
let editTimer = 0;
function renderVerdict() {
  const out = analyse($('edit').value);
  const refused = out.filter((o) => o.st === 'REFUSED');
  const v = $('verdict');
  v.dataset.refused = refused.map((o) => o.field).join(',');
  v.innerHTML = `<p class="small"><b>${refused.length}</b> refused${refused.length ? ': ' + refused.map((o) => esc(o.field)).join(', ') : ''}</p><ul class="rows">` +
    out.map((o) => `<li class="row ${o.st === 'OK' ? 'same' : o.st === 'ABSENT' ? 'empty' : 'changed'}"><div class="rhead"><span class="st">${esc(o.st)}</span><span>${esc(o.field)}</span></div><div class="small">${esc(o.words)}</div></li>`).join('') + '</ul>';
}
function chips() {
  const set = (k, v) => (h) => { const u = new URL(h); if (v === null) u.searchParams.delete(k); else u.searchParams.set(k, v); return u.toString(); };
  const defs = [
    ['intact', (h) => h],
    ['v9.5.1 base', (h) => h.replace(C.CANONICAL_RECEIVER, SENDER_V951.base)],
    ['repd_id', (h) => h.replace('repd_ref=', 'repd_id=')],
    ['latitude=abc', set('latitude', 'abc')],
    ['latitude=91', set('latitude', '91')],
    ['technology=wind', set('technology', 'wind')],
    ['technology=other', set('technology', 'other')],
    ['no technology', set('technology', null)],
    ['two repd_ref', (h) => h + '&repd_ref=SYNTH-99'],
    ['+project name', set('project', 'Synthetic name')],
    ['not a URL', (h) => h.replace('https://', '')]
  ];
  for (const [label, fn] of defs) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.textContent = label; b.dataset.chip = label;
    b.addEventListener('click', () => { $('edit').value = fn(C.buildDeepLink(records[0])); renderVerdict(); });
    $('chips').append(b);
  }
}

/* ── MAP button ────────────────────────────────────────────────────────── */
function mapButton() {
  const sel = $('pick');
  records.forEach((r, i) => { const o = document.createElement('option'); o.value = i; o.textContent = `${r.repd_ref} · ${r.technology} (synthetic)`; sel.append(o); });
  const a = document.createElement('a');
  a.className = 'action-link atlaslink'; a.target = '_blank'; a.rel = 'noopener'; a.id = 'map'; a.textContent = 'MAP ↗';
  $('mapbtn').replaceChildren(a);
  const update = () => {
    const r = records[Number(sel.value)];
    const href = C.buildDeepLink(r);
    a.href = href;
    $('maphref').textContent = href;
    let refusal;
    try { refusal = 'built without refusal: ' + C.buildDeepLink(SENDER_V951.base, r); } catch (e) { refusal = e.message; }
    $('sender').innerHTML = `The same record through the base hard-coded in <code>${SENDER_V951.fn}()</code> (${esc(SENDER_V951.file)}, line ${SENDER_V951.line}, quoted from source): <code>${esc(SENDER_V951.base)}</code>. isRetiredReceiver → <b>${C.isRetiredReceiver(SENDER_V951.base)}</b>. buildDeepLink(thatBase, record):<span class="quote" style="display:block">${esc(refusal)}</span>`;
  };
  sel.addEventListener('change', update);
  update();
}

function questions() {
  const names = Object.keys(C).sort();
  $('q2').innerHTML = `Module <code>deeplink/contract.js</code>, ventus-grid-engine @ <code>${COMMIT.slice(0, 8)}</code>; exports read at run time (${names.length}): ${names.map((n) => '<code>' + n + '</code>').join(', ')}. Sender: Pipeline News, whose MAP button builds the URL (<code>${SENDER_V951.fn}</code> in v9.5.1; <code>buildAtlasV9DeepLink</code> in the later spine emitter, per docs/deeplink-contract.md section 1). Receiver: Grid Atlas v9 at the canonical route, which reads <code>repd_ref</code>, <code>technology</code>, <code>latitude</code>, <code>longitude</code>, <code>zoom</code>. Importers inside the engine repo: proofs/deeplink.proof.mjs and proofs/deeplink-receiver.proof.mjs (read from source).`;
  $('machine').innerHTML = `Machine detail: inputs ${Object.entries(C.PARAMS).map(([k, s]) => `<code>${k}</code> (${s.type}${s.units ? ', ' + esc(s.units) : ''}${s.required ? ', required' : ''})`).join(', ')}. Outputs: <code>buildDeepLink</code> → URL string on CANONICAL_RECEIVER; <code>parseDeepLink</code> → those fields plus <code>layer_id</code> (string or null), <code>layer_exists</code> (boolean), <code>known_bucket</code> (boolean). Refusals: buildDeepLink throws on a missing repd_ref or a retired base; new URL throws on text that is not a URL; parseDeepLink returns null for a non-finite number. Counted now: buckets ${C.BUCKETS.length}, engine layer ids ${C.REPD_LAYER_IDS.length}, correction-table entries ${Object.keys(C.LAYER_ID_FOR_BUCKET).length}, retired receivers ${C.RETIRED_RECEIVERS.length}. Source commit ${COMMIT}.`;
}

async function main() {
  try { C = await import(MOD_URL); }
  catch (e) {
    $('summary').textContent = `FAIL: the contract module could not be imported (${e.message}). Nothing on this page can be computed without it.`;
    return;
  }
  $('src').innerHTML = `module: <a href="${MOD_URL}">ventus-grid-engine @ ${COMMIT.slice(0, 12)} / deeplink/contract.js</a> · imported`;
  records = syntheticRecords();
  roundTrip();
  chips();
  $('edit').value = C.buildDeepLink(records[0]);
  $('edit').addEventListener('input', () => { clearTimeout(editTimer); editTimer = setTimeout(renderVerdict, 120); });
  renderVerdict();
  mapButton();
  questions();
  $('measure').addEventListener('click', measure);
  cachedText(MOD_URL).then((src) => { otherReason = extractNullReason(src); fillReasons(); renderVerdict(); })
    .catch(() => fillReasons());
  cachedText(RECEIVERS_URL).then((t) => listReceivers(JSON.parse(t)))
    .catch((e) => { $('recv').innerHTML = `<li class="row empty"><span class="st">FAIL</span> receivers.json could not be read: ${esc(e.message)}</li>`; });
}
main();
