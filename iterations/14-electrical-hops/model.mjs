export const PIN='d9cd18b0e2034325814924e6e4a0e958014f2748';
export const BASE=`https://cdn.jsdelivr.net/gh/Ventusltd/ventus-grid-engine@${PIN}/`;
export const SOURCES=[{file:'engine/electrical-distance.js',sha256:'b6b55e2207e29a7078f0ab9a1ee0575125a0252386907e93434b78aeead2c4a3'},{file:'engine/network-topology.js',sha256:'cf04c754e550e594ddd09096ec2b2c04c0082058126897c6e7afdeee92f7561c'}];
export function query(engine,index,{from,to,budget,voltage}) {
  if(typeof from!=='string' || typeof to!=='string' || !from || !to)throw new TypeError('Interface policy: supply origin and destination identifiers');
  if(!Number.isInteger(budget) || budget<0 || budget>6)throw new RangeError('Interface policy: hop budget must be an integer from 0 to 6');
  if(voltage!==null && (!Number.isFinite(voltage) || voltage<=0))throw new RangeError('Interface policy: origin voltage must be positive kV or unfiltered');
  const options={maxHops:budget,...(voltage===null?{}:{voltageKv:voltage})};
  const route=engine.between(index,from,to,options);
  const neighbourhood=engine.within(index,from,{hops:budget,...(voltage===null?{}:{voltageKv:voltage})});
  return {schema:'galaxy-hop-lab.v1',source:{repository:'Ventusltd/ventus-grid-engine',commit:PIN,files:SOURCES},fixture:'Synthetic PRODUCT from proofs/electrical-distance.proof.mjs at the same pin; not an actual network map.',inputs:{from,to,budget,voltage},route,neighbourhood};
}
export const edgeKey=(a,b)=>[a,b].sort().join('|');
