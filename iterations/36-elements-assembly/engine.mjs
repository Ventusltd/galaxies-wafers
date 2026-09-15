/* engine.mjs — level 4, IN ACTION.
 *
 * Approach reused from iteration 31 (card.mjs): the first input each engine
 * module's own proof calls it with, held with the exact text that must appear
 * in that proof at the pinned commit (whitespace collapsed) and the proof line
 * the call sits on. The page reads the proof at the pin and refuses to run if
 * either check fails, so a fixture cannot drift away from its proof unseen.
 *
 * The module itself is imported, never copied: a Web Worker built from a Blob
 * imports it from jsDelivr at the pinned commit, removes its own network access,
 * calls one exported function with the fixture and posts the answer back. A run
 * that does not answer within 10 s (module download included) is stopped.
 *
 * Where the proof's first call is built from constants the proof computes or
 * imports, no input is recorded here, and the page says so with the reason.
 */

export const ENGINE_REPO = 'Ventusltd/ventus-grid-engine';
export const PIN = 'd9cd18b0e2034325814924e6e4a0e958014f2748';
export const CDN = `https://cdn.jsdelivr.net/gh/${ENGINE_REPO}@${PIN}/`;
export const RAW = `https://raw.githubusercontent.com/${ENGINE_REPO}/${PIN}/`;
const RUN_MS = 10000;   /* includes importing the module and its imports from the CDN */

export const DISCLAIMER = 'Illustrative physics drawn by a computer from published data. Not an engineering design or certified calculation. Any real design above 100 kW needs study and approval by a qualified chartered electrical engineer under the applicable standards.';

/* args are passed positionally. {$ref:'EXPORT.KEY'} is resolved inside the worker
   from the module's own export, so the page never types a module constant. */
export const FIXTURES = {
  'engine/geo-core.js': { fn: 'haversine', args: [0, 0, 0, 1], proof: 'proofs/geodesy.proof.mjs', line: 60,
    evidence: ['haversine(0, 0, 0, 1)'], names: ['lon1 (degrees east)', 'lat1 (degrees north)', 'lon2 (degrees east)', 'lat2 (degrees north)'], returns: 'km (the module\'s @returns)' },
  'engine/geo-area.js': { fn: 'polygonAreaKm2', args: [[[-0.1, 51.5], [-0.095, 51.502], [-0.09, 51.4995], [-0.093, 51.496], [-0.099, 51.4965]]],
    proof: 'proofs/geodesy.proof.mjs', line: 87,
    evidence: ['const LONDON = [[-0.1000, 51.5000], [-0.0950, 51.5020], [-0.0900, 51.4995], [-0.0930, 51.4960], [-0.0990, 51.4965]];', 'polygonAreaKm2(LONDON)'],
    names: ['pts ([lon, lat] pairs, degrees)'] },
  'engine/geo-shapes.js': { fn: 'destinationCirclePoints', args: [-2.35, 56.05, 10, 24], proof: 'proofs/geodesy.proof.mjs', line: 162,
    evidence: ['destinationCirclePoints(-2.35, 56.05, 10, 24)'], names: ['lon (degrees east)', 'lat (degrees north)', 'radiusKm (km)', 'n (points)'] },
  'engine/geo-geojson.js': { fn: 'circleFeatureCollection', args: [-2.35, 56.05, 10], proof: 'proofs/geodesy.proof.mjs', line: 182,
    evidence: ['circleFeatureCollection(-2.35, 56.05, 10)'], names: ['lon (degrees east)', 'lat (degrees north)', 'radiusKm (km)'] },
  'engine/electrification-demand.js': { fn: 'averagePowerGw', args: [{ annualTwh: 8.76 }], proof: 'proofs/electrification-demand.proof.mjs', line: 51,
    evidence: ['averagePowerGw({ annualTwh: 8.76 })'] },
  'engine/firm-capacity.js': { fn: 'apparentPowerMva', args: [{ mw: 100, powerFactor: 0.95 }], proof: 'proofs/firm-capacity.proof.mjs', line: 29,
    evidence: ['apparentPowerMva({ mw: 100, powerFactor: 0.95 })'] },
  'engine/connection-capacity.js': { fn: 'exceedance', args: [{ profileKw: [20, 42, 36, 20], capKw: 30, intervalHours: 0.5 }],
    proof: 'proofs/connection-capacity.proof.mjs', line: 28,
    evidence: ['exceedance({ profileKw: [20, 42, 36, 20], capKw: 30, intervalHours: HALF_HOUR })', 'const HALF_HOUR = 0.5;'] },
  'engine/current-from-power.js': { fn: 'currentFromMvaAtKv', args: [{ mva: 1200, kv: 400 }], proof: 'proofs/current-from-power.proof.mjs', line: 54,
    evidence: ['currentFromMvaAtKv({ mva: 1200, kv: 400 })'] },
  'engine/diversified-demand.js': { fn: 'populationEnergyTwh', args: [{ unitCount: 10000000, perUnitKwhPerYear: 2500 }],
    proof: 'proofs/diversified-demand.proof.mjs', line: 23,
    evidence: ['populationEnergyTwh({ unitCount: 10_000_000, perUnitKwhPerYear: 2500 })'] },
  'engine/electrification-model.js': { fn: 'quantity', args: [12.25, 'kW', { $ref: 'MEANING.THERMAL_OUTPUT' }],
    proof: 'proofs/electrification-model.proof.mjs', line: 24,
    evidence: ["quantity(12.25, 'kW', MEANING.THERMAL_OUTPUT)"], names: ['value', 'unit', 'meaning (the module\'s MEANING.THERMAL_OUTPUT)'] },
  'engine/power-factor.js': { fn: 'apparentPowerKva', args: [{ kw: 1000, powerFactor: 0.85 }], proof: 'proofs/power-factor.proof.mjs', line: 25,
    evidence: ['apparentPowerKva({ kw: 1000, powerFactor: 0.85 })'] },
  'engine/voltage-drop.js': { fn: 'voltageDropVolts', args: [{ currentA: 200, lengthM: 250, resistanceOhmPerKm: 0.1, reactanceOhmPerKm: 0.08, powerFactor: 0.9, phases: 'three' }],
    proof: 'proofs/voltage-drop.proof.mjs', line: 33,
    evidence: ["const a = { currentA: 200, lengthM: 250, resistanceOhmPerKm: 0.1, reactanceOhmPerKm: 0.08, powerFactor: 0.9, phases: 'three' };", 'voltageDropVolts(a)'] },
  'engine/interconnector-economics.js': { fn: 'flowDirection', args: [{ gbPriceGbpPerMwh: 90, neighbourPriceGbpPerMwh: 60 }],
    proof: 'proofs/interconnector-economics.proof.mjs', line: 47,
    evidence: ['flowDirection({ gbPriceGbpPerMwh: 90, neighbourPriceGbpPerMwh: 60 })'] }
};

/* No runnable input recorded, and why: the proof's first call is not a literal. */
export const NOT_RECORDED = {
  'engine/v9-nearest-search.js': 'its proof (proofs/v9-engine.proof.mjs line 71) first calls index([DECOY_NORTH, TRUE_EAST, FAR, LOW_VOLTAGE]), points whose coordinates the proof computes, and the answer is an object of functions',
  'engine/network-topology.js': 'its proof (proofs/network-topology.proof.mjs line 72) first calls index(PRODUCT), a product the proof builds in code',
  'engine/published-fault-level.js': 'its proof (proofs/published-fault-level.proof.mjs line 74) first calls record(clone()), a copy of a record the proof holds',
  'engine/route-obstacles.js': 'its proof (proofs/route-obstacles.proof.mjs line 37) first calls routeEstimate with a distance constant and CABLE_FACTOR imported from engine/corridor-estimate.js'
};

/* Which single-line-diagram element a module feeds, and through which function
   (iteration 31's table). The function must exist in the source read at PIN. */
export const SLD = {
  'engine/voltage-drop.js': { element: 'cable route (the feeder cable between two busbars)', fn: 'voltageDropVolts' },
  'engine/current-from-power.js': { element: 'feeder (the current a circuit rating implies)', fn: 'currentFromMvaAtKv' },
  'engine/firm-capacity.js': { element: 'transformer (firm capacity of a substation\'s units)', fn: 'firmCapacityMva' },
  'engine/power-factor.js': { element: 'feeder (reactive power and its correction)', fn: 'correctionKvar' },
  'engine/route-obstacles.js': { element: 'cable route (length with crossings)', fn: 'routeEstimate' },
  'engine/published-fault-level.js': { element: 'protection (a published fault level at a busbar)', fn: 'quote' }
};

export const collapse = s => s.replace(/\s+/g, ' ');

/* Returns null when the proof agrees, otherwise the refusal sentence. */
export function checkProof(fx, proofText) {
  const flat = collapse(proofText);
  for (const ev of fx.evidence) {
    if (!flat.includes(collapse(ev))) return `"${ev}" was not found in ${fx.proof} at ${PIN.slice(0, 7)}, so this page will not claim it is the proof's input.`;
  }
  const lines = proofText.split('\n');
  if (!(lines[fx.line - 1] || '').includes(fx.fn + '(')) return `${fx.proof} line ${fx.line} at ${PIN.slice(0, 7)} does not call ${fx.fn}, so the recorded line is wrong and nothing was run.`;
  return null;
}

const WORKER_SRC = `
self.onmessage = async ({ data }) => {
  let m;
  try { m = await import(data.url); }
  catch (e) { postMessage({ ok: false, kind: 'ImportFailed', message: String(e && e.message || e) }); return; }
  const refuse = () => { throw new Error('network access is refused inside this run'); };
  for (const k of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts']) { try { self[k] = refuse; } catch (e) {} }
  try {
    if (typeof m[data.fn] !== 'function') { postMessage({ ok: false, kind: 'NotExported', message: 'the module exports no function named ' + data.fn }); return; }
    const args = data.args.map(a => {
      if (a && typeof a === 'object' && typeof a.$ref === 'string') {
        const [ex, key] = a.$ref.split('.');
        if (!m[ex] || !(key in m[ex])) throw new Error('the module has no export ' + a.$ref);
        return m[ex][key];
      }
      return a;
    });
    const r = m[data.fn](...args);
    postMessage({ ok: true, resolved: args, result: JSON.parse(JSON.stringify(r === undefined ? null : r)) });
  } catch (e) {
    postMessage({ ok: false, kind: (e && e.name) || 'Error', message: String(e && e.message !== undefined ? e.message : e) });
  }
};`;

export function runInWorker(path, fx) {
  return new Promise(resolve => {
    const wurl = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
    let w = null;
    const done = r => { clearTimeout(timer); try { w && w.terminate(); } catch (e) {} URL.revokeObjectURL(wurl); resolve(r); };
    const timer = setTimeout(() => done({ ok: false, kind: 'Stopped', message: `stopped after ${RUN_MS / 1000} s without an answer, module download included` }), RUN_MS);
    try { w = new Worker(wurl, { type: 'module' }); }
    catch (e) { done({ ok: false, kind: 'NoWorker', message: 'this browser would not start a module worker: ' + e.message }); return; }
    w.onmessage = e => done(e.data);
    w.onerror = e => { if (e.preventDefault) e.preventDefault(); done({ ok: false, kind: 'LoadError', message: e.message || 'the module could not be loaded in the worker' }); };
    w.postMessage({ url: CDN + path, fn: fx.fn, args: fx.args });
  });
}
