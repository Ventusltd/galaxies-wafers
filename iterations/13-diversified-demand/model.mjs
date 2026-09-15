export const SOURCE = Object.freeze({repository:'Ventusltd/ventus-grid-engine',commit:'d9cd18b0e2034325814924e6e4a0e958014f2748',file:'engine/diversified-demand.js',sha256:'d3fa87733b1131a4b3f44fe9ab45b7304aae7168e31403dc1fddbc032e14043f'});
export const MODULE_URL = `https://cdn.jsdelivr.net/gh/${SOURCE.repository}@${SOURCE.commit}/${SOURCE.file}`;
export function numberInput(text) {
  if (typeof text !== 'string') throw new TypeError('Interface input must be text');
  return text.trim() === '' ? undefined : Number(text);
}
export function calculate(engine, mode, inputs) {
  if (!['assumed','implied'].includes(mode)) throw new RangeError('Unknown calculation direction');
  if (inputs.unitCount > 10000000 || (Number.isInteger(inputs.unitCount) && !Number.isSafeInteger(inputs.unitCount))) throw new RangeError('Interface policy: unitCount must be a safe integer no greater than 10000000');
  if (inputs.perUnitKw > 1000) throw new RangeError('Interface policy: perUnitKw must not exceed 1000 kW');
  const args = {unitCount:inputs.unitCount,perUnitKw:inputs.perUnitKw};
  const name = mode === 'assumed' ? 'diversifiedDemandKw' : 'impliedCoincidence';
  const field = mode === 'assumed' ? 'coincidenceFactor' : 'measuredGroupPeakKw';
  args[field] = inputs[field];
  const result = engine[name](args);
  const groupKw = mode === 'assumed' ? result.value : result.from.measuredGroupPeakKw;
  const factor = mode === 'assumed' ? result.from.coincidenceFactor : result.value;
  if (![result.value,result.from.unrestrictedKw,groupKw,factor].every(Number.isFinite)) throw new RangeError('Interface policy: nonfinite result refused');
  if (result.from.unrestrictedKw <= 0 || groupKw <= 0 || factor <= 0 || factor > 1) throw new RangeError('Interface policy: inconsistent result refused');
  return {schema:'galaxy-demand-lab.v1',source:SOURCE,mode,assumption:'Synthetic illustration; supplied values are not verified measurements.',function:name,inputs:args,quantity:result.quantity,value:result.value,unit:result.unit,from:result.from,groupKw,factor,notEstablished:['connection point','firm capacity','future coincidence','time series','equipment sizing']};
}
