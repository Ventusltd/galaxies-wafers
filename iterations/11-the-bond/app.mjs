import { place } from './wafer.mjs';
import { validateReport, filterRows, summarise, selectionFromHash, layerHash } from './model.mjs';

const $ = id => document.getElementById(id);
const state = { report: null, selected: null };
const number = n => Number(n || 0).toLocaleString('en-GB');
const make = (tag, text, className) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n; };
const string = value => typeof value === 'string' ? value : JSON.stringify(value);
function field(parent, title, value) { const box = make('div'); box.append(make('dt', title), make('dd', number(value))); parent.append(box); }
function inspect(row) {
  state.selected = row.layer_id;
  history.replaceState(null, '', layerHash(row.layer_id));
  const panel = $('inspection'); panel.replaceChildren(make('h2', row.layer_id), make('p', row.status));
  const back = make('button', 'Back to layers'); back.type = 'button';
  back.addEventListener('click', () => { $('search').focus(); $('search').scrollIntoView({block:'center'}); }); panel.append(back);
  const permalink = make('a', 'Link to this layer'); permalink.href = layerHash(row.layer_id); const linkBox = make('p'); linkBox.append(permalink); panel.append(linkBox);
  panel.append(make('h3', 'The claim'), make('p', row.claim_text || 'No claim text supplied.'));
  if (row.first_deviation) { panel.append(make('h3','First contradiction'), make('pre',JSON.stringify(row.first_deviation,null,2))); }
  const predicateDetails = make('details'); predicateDetails.open = row.status === 'CONTRADICTED';
  predicateDetails.append(make('summary', `${number(row.predicates.length)} predicate results — expand to inspect`));
  for (const predicate of row.predicates || []) {
    const card = make('section', undefined, 'predicate');
    card.append(make('strong', predicate.text || predicate.id), make('p', `${predicate.status} · ${number(predicate.checked)} of ${number(predicate.total)} checked`));
    if (predicate.first_deviation) card.append(make('pre', JSON.stringify(predicate.first_deviation, null, 2)));
    predicateDetails.append(card);
  }
  if (row.disclosed?.length) { const details = make('details'); details.append(make('summary', `DISCLOSED · ${number(row.disclosed.length)} gap records`)); for (const item of row.disclosed) details.append(make('p', `${item.field}: ${string(item.value)}`)); panel.append(details); }
  if (row.not_evaluated?.length) { const details = make('details'); details.open = true; details.append(make('summary', `NOT EVALUATED · ${number(row.not_evaluated.length)} statements`)); for (const item of row.not_evaluated) { const box = make('div', undefined, 'predicate'); box.append(make('p', item.text || item.field), make('p', item.reason, 'dim')); details.append(box); } panel.append(details); }
  panel.append(predicateDetails);
  for (const button of $('layers').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.layer === row.layer_id));
  draw();
}
function filter() {
  const q = $('search').value.toLowerCase().trim(), result = $('status').value;
  const rows = filterRows(state.report.rows, q, result);
  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    const button = make('button', undefined, 'layer'); button.type = 'button'; button.dataset.layer = row.layer_id;
    button.setAttribute('aria-pressed', String(row.layer_id === state.selected));
    button.append(make('strong', row.layer_id), make('span', row.status, 'state'));
    const predicates = row.predicates || [], passed = predicates.filter(p => p.status === 'PASSED').length;
    button.append(make('p', `${number(passed)} passing predicates · ${number(row.not_evaluated?.length)} statements not evaluated · ${number(row.disclosed?.length)} gap records`));
    button.addEventListener('click', () => { inspect(row); $('inspection').scrollIntoView({block:'start'}); $('inspection').focus({preventScroll:true}); }); fragment.append(button);
  }
  $('layers').replaceChildren(fragment); $('shown').textContent = `${number(rows.length)} of ${number(state.report.rows.length)} layers shown`;
}
function draw() {
  if (!state.report) return;
  const canvas = $('wafer'), rect = canvas.getBoundingClientRect(), ratio = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * ratio); canvas.height = Math.round(rect.height * ratio);
  const ctx = canvas.getContext('2d'); if (!ctx) { $('map-note').textContent = 'Canvas unavailable; all audit evidence remains readable below.'; return; }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, rect.width, rect.height);
  const samples = state.report.preview?.anchors || [], max = state.report.preview?.max_key || 1;
  const scale = Math.min(rect.width, rect.height) * .46 / Math.sqrt(max);
  const plot = (key, radius) => { const [x, y] = place(key); ctx.beginPath(); ctx.arc(rect.width / 2 + x * scale, rect.height / 2 - y * scale, radius, 0, Math.PI * 2); ctx.fill(); };
  ctx.fillStyle = '#677083'; for (const sample of samples) for (const key of sample.keys) plot(key, 1.15);
  const selected = samples.find(s => s.layer_id === state.selected);
  ctx.fillStyle = '#5ec8f2'; for (const key of selected?.keys || []) plot(key, 2.5);
  const count = samples.reduce((n, s) => n + s.keys.length, 0);
  $('map-note').textContent = `${number(count)} sampled layer anchors · frozen wafer.v1 placement${selected ? ` · ${selected.layer_id} selected` : ''}. Marks are not a verdict colour scale.`;
}
async function start() {
  try {
    const response = await fetch('./report.json'); if (!response.ok) throw new Error(`Audit file returned ${response.status}`);
    const report = validateReport(await response.json());
    state.report = report;
    const totals = $('totals');
    const summary = summarise(report.rows);
    field(totals, 'Layers inspected', summary.layers);
    field(totals, 'Contradicted', summary.statuses.CONTRADICTED);
    field(totals, 'Statements not evaluated', summary.statements);
    field(totals, 'Disclosed gap records', summary.gapRecords);
    $('coverage').textContent = `${number(summary.checked)} of ${number(summary.total)} check units evaluated. These mix structural and semantic checks; this is not a percentage of claims proved.`;
    $('load').hidden = true; $('workspace').hidden = false;
    const provenance = report.provenance || {};
    $('provenance').textContent = `Snapshot ${provenance.generated_utc || 'time not recorded'} · source ${provenance.commit || 'not recorded'} · values counted from this audit, not current live state.`;
    if (/^[0-9a-f]{40}$/.test(provenance.commit || '')) $('source').href = `https://github.com/Ventusltd/galaxies-wafers/tree/${provenance.commit}`;
    $('search').addEventListener('input', filter); $('status').addEventListener('change', filter); window.addEventListener('resize', draw);
    const applySelection = () => { const selected = selectionFromHash(location.hash,report.rows); $('selection-note').textContent = selected.why; if (selected.row) { inspect(selected.row); $('inspection').scrollIntoView({block:'start'}); } else { state.selected = null; $('inspection').replaceChildren(make('h2','Select a layer'),make('p',selected.why || 'Its claim, evaluated predicates and gaps appear here.')); filter(); draw(); } };
    window.addEventListener('hashchange',applySelection);
    filter(); draw(); applySelection();
  } catch (error) { $('workspace').hidden = true; $('load').hidden = false; $('load').textContent = `Audit unavailable: ${error.message}. No result has been inferred.`; }
}
start();
