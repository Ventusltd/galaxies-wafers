export const PIN='d9cd18b0e2034325814924e6e4a0e958014f2748';
export const SOURCE={repository:'Ventusltd/ventus-grid-engine',commit:PIN,file:'engine/interconnector-economics.js',sha256:'e6c4b9de5bc2bf6a8900ef776b3d5005ca358a3f73b38ba002205a37f7ca41f8'};
export const URL=`https://cdn.jsdelivr.net/gh/${SOURCE.repository}@${PIN}/${SOURCE.file}`;
export const FIELDS=['capacityGw','hours','utilisation','gbPriceGbpPerMwh','neighbourPriceGbpPerMwh'];
export const parse=text=>text.trim()===''?undefined:Number(text);
export function calculate(engine,input){
  if(input.capacityGw>100 || input.hours>8760 || Math.abs(input.gbPriceGbpPerMwh)>10000 || Math.abs(input.neighbourPriceGbpPerMwh)>10000)throw new RangeError('Interface policy: at most 100 GW, 8760 hours and absolute price 10000 GBP/MWh');
  const common={capacityGw:input.capacityGw,hours:input.hours,utilisation:input.utilisation};
  const direction=engine.flowDirection({gbPriceGbpPerMwh:input.gbPriceGbpPerMwh,neighbourPriceGbpPerMwh:input.neighbourPriceGbpPerMwh});
  const energy=engine.energyTransferredGwh(common);
  if(![energy.value,direction.spreadGbpPerMwh,direction.signedSpreadGbpPerMwh].every(Number.isFinite) || energy.value<=0)throw new RangeError('Interface policy: nonfinite or underflowed arithmetic refused');
  let rent=null,refusal=null,series=[];
  try{rent=engine.congestionRentGbp({...common,spreadGbpPerMwh:direction.spreadGbpPerMwh});}
  catch(error){if(direction.spreadGbpPerMwh!==0)throw error;refusal={function:'congestionRentGbp',name:error.name,message:error.message};}
  if(rent){
    if(!Number.isFinite(rent.value) || rent.value<=0)throw new RangeError('Interface policy: nonfinite or underflowed gross value refused');
    series=Array.from({length:10},(_,i)=>{const utilisation=(i+1)/10;const result=engine.congestionRentGbp({...common,utilisation,spreadGbpPerMwh:direction.spreadGbpPerMwh});if(!Number.isFinite(result.value) || result.value<=0)throw new RangeError('Interface policy: nonfinite or underflowed sensitivity point');return{utilisation,grossGbp:result.value};});
  }
  const compact=r=>r?{quantity:r.quantity,value:r.value,unit:r.unit,from:r.from}:null;
  return{schema:'galaxy-spread-lab.v1',source:SOURCE,fixture:'Synthetic caller-supplied prices, capacity, hours and utilisation; not a forecast or scheduled flow.',inputs:Object.fromEntries(FIELDS.map(key=>[key,input[key]])),direction:{direction:direction.direction,signedSpreadGbpPerMwh:direction.signedSpreadGbpPerMwh,spreadGbpPerMwh:direction.spreadGbpPerMwh,from:direction.from},energy:compact(energy),rent:compact(rent),refusal,series,notComputed:['route geometry','price forecast','scheduled flow','profit','losses and availability']};
}
