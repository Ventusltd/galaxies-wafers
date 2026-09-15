/* The verdict for one browser job, kept pure so its failure cases can be proved
 * without a browser (see judge.check.mjs). A requested layer passes only if it
 * ends OK or EMPTY. WAIT, LOAD, FAIL, a missing row ("absent") or anything else
 * fails, because a page that never loads what was asked has not passed. */
export function judge({ errors = [], failedRequests = [], layers = {} }) {
  const entries = Object.entries(layers);
  const failedLayers = entries.filter(([, s]) => s === 'FAIL').map(([id]) => id);
  const unsettledLayers = entries.filter(([, s]) => !/^(OK|EMPTY)$/.test(s)).map(([id, s]) => `${id}:${s}`);
  return { failedLayers, unsettledLayers, pass: !errors.length && !failedRequests.length && !unsettledLayers.length };
}
