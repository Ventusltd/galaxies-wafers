export const SOURCE={repository:'Ventusltd/ventus-grid-engine',commit:'d9cd18b0e2034325814924e6e4a0e958014f2748',file:'engine/firm-capacity.js',sha256:'2e855b2e829bb65d033b86330cf43bee6733ffaaa0eee696cbbd36f20cc4c54a'};
export const MODULE_URL=`https://cdn.jsdelivr.net/gh/${SOURCE.repository}@${SOURCE.commit}/${SOURCE.file}`;
export const parseNumber=text=>text.trim()===''?undefined:Number(text);
export const parseUnits=text=>text.split(',').map(parseNumber);
export function calculate(engine,{units,demandMva}){
  if(!Array.isArray(units) || units.length<1 || units.length>6 || Array.from({length:units.length},(_,i)=>i).some(i=>!Object.hasOwn(units,i)))throw new TypeError('Interface policy: one to six dense unit ratings required');
  if(units.some(n=>typeof n==='number' && Number.isFinite(n) && (n<0.001 || n>1000)) || demandMva>5000)throw new RangeError('Interface policy: each unit0.001–1000MVA; demand at most5000MVA');
  const firm=engine.firmCapacityMva({units});
  const assessment=engine.assessAgainstFirm({units,demandMva});
  const{basis,...values}=assessment;
  for(const key of ['firmMva','installedMva','demandMva','shortfallMva','utilisationOfInstalled'])if(!Number.isFinite(values[key]))throw new RangeError('Interface policy: nonfinite arithmetic refused');
  if(values.firmMva===0 && values.utilisationOfFirm===Infinity)values.utilisationOfFirm={kind:'nonfinite',value:'Infinity',reason:'Positive demand divided by zero arithmetic firm capacity; not a finite percentage.'};
  else if(!Number.isFinite(values.utilisationOfFirm))throw new RangeError('Interface policy: unexpected nonfinite firm utilisation');
  return{schema:'galaxy-firm-lab.v1',source:SOURCE,fixture:'Synthetic caller-supplied ratings and demand, not an actual substation or connection assessment.',inputs:{units:[...units],demandMva},largestUnitMva:firm.from.largestUnitMva,assessment:values,notComputed:['spare capacity','connection availability','cyclic and emergency rating','security compliance'],sourceBasisOmitted:'The lab reports numerical fields. The source narrative can overstate outage conclusions for unequal units; only largest-unit-loss arithmetic is described.'};
}
