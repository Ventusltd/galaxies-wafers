/* Pure report logic shared by the page and its offline tests. */
export const STATUSES = Object.freeze(['CONTRADICTED', 'PARTIALLY EVALUATED', 'NOT EVALUATED', 'HONOURED']);
const count = n => Number.isSafeInteger(n) && n >= 0;
export function validateReport(report) {
  if (report?.schema !== 'bond.v1' || !Array.isArray(report.rows) || !Array.isArray(report.input_checks)) throw new Error('Unrecognised audit document');
  if (!/^[0-9a-f]{40}$/.test(report.provenance?.commit || '')) throw new Error('Full source commit is missing');
  if (!report.input_checks.length || report.input_checks.some(p => p.status !== 'PASSED')) throw new Error('Audit source-input checks did not all pass');
  const ids = new Set();
  for (const row of report.rows) {
    if (typeof row.layer_id !== 'string' || !row.layer_id || ids.has(row.layer_id)) throw new Error('Missing or duplicate layer identifier');
    ids.add(row.layer_id);
    if (!STATUSES.includes(row.status) || !Array.isArray(row.predicates) || !Array.isArray(row.not_evaluated) || !Array.isArray(row.disclosed)) throw new Error('Malformed layer result');
    for (const p of row.predicates) {
      if (!['PASSED','FAILED','NOT EVALUATED'].includes(p.status) || ![p.checked,p.total,p.passed,p.failed].every(count) || p.checked > p.total || p.passed + p.failed !== p.checked) throw new Error('Malformed check coverage');
      if (p.status === 'PASSED' && (p.failed || p.checked !== p.total)) throw new Error('Incomplete predicate marked passed');
    }
    const contradicted = row.predicates.some(p => p.failed > 0 || p.status === 'FAILED');
    if (contradicted !== (row.status === 'CONTRADICTED')) throw new Error('Contradiction does not agree with predicates');
    if (row.status === 'HONOURED' && (row.not_evaluated.length || row.predicates.some(p => p.status !== 'PASSED'))) throw new Error('Unevaluated result marked honoured');
  }
  return report;
}
export function filterRows(rows, query = '', status = '') {
  const q = query.trim().toLowerCase();
  return rows.filter(r => (!status || r.status === status) && (!q || `${r.layer_id} ${r.claim_text || ''}`.toLowerCase().includes(q)));
}
export function summarise(rows) {
  return rows.reduce((s,r) => {
    s.layers++; s.statuses[r.status]++;
    s.statements += r.not_evaluated.length; s.gapRecords += r.disclosed.length;
    for (const p of r.predicates) { s.checked += p.checked; s.total += p.total; }
    return s;
  }, {layers:0, statements:0, gapRecords:0, checked:0, total:0, statuses:Object.fromEntries(STATUSES.map(s=>[s,0]))});
}
export function selectionFromHash(hash, rows) {
  const q = new URLSearchParams(hash.replace(/^#/,'')), values = q.getAll('layer');
  if (!values.length) return {row:null,why:''};
  if (values.length !== 1) return {row:null,why:'The link names more than one layer. No selection inferred.'};
  const row = rows.find(r=>r.layer_id === values[0]);
  return row ? {row,why:''} : {row:null,why:'The linked layer is absent from this snapshot. No selection inferred.'};
}
export const layerHash = id => '#'+new URLSearchParams({layer:id}).toString();
