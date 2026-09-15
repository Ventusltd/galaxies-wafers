import {place} from './wafer.mjs';
export const CATALOG_SHA256='89dbaa88310ab87e1b4caa6e16efdaa3473bd50e1b942a9564fa4f12f2ab2cd7';
export function validateCatalog(c){
  if(c?.schema!=='code.visibility-catalog.v1'||c.substrate!=='wafer.v1'||!Array.isArray(c.layers))throw Error('Catalogue contract refused');
  const ids=new Set();let total=0,empty=0;
  for(const l of c.layers){
    if(!/^[\w-]+$/.test(l.id)||ids.has(l.id)||!/^#[0-9a-f]{6}$/i.test(l.colour)||!Number.isSafeInteger(l.features)||l.features<0||l.file!==`geometry/${l.id}.json`||!Number.isSafeInteger(l.bytes)||l.bytes<0||!/^[a-f0-9]{64}$/.test(l.sha256))throw Error('Layer metadata refused');
    ids.add(l.id);total+=l.features;empty+=Number(l.features===0);
  }
  if(c.counts?.layers!==ids.size||c.counts.features!==total||c.counts.empty_layers!==empty)throw Error('Catalogue count mismatch');
  return c;
}
export function prepareGeometry(doc,layer,maxKey){
  if(doc?.schema!=='code.geometry.v1'||doc.layer_id!==layer.id||!Array.isArray(doc.features)||doc.features.length!==layer.features)throw Error('Geometry identity or count refused');
  const keys=new Map(),features=[];
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  doc.features.forEach((feature,index)=>{
    if(!['Point','LineString'].includes(feature.type)||!Array.isArray(feature.keys)||!feature.keys.length||(feature.type==='Point'&&feature.keys.length!==1)||(feature.type==='LineString'&&feature.keys.length<2))throw Error('Geometry shape refused');
    const xy=feature.keys.map(key=>{
      if(!Number.isSafeInteger(key)||key<=0||key>maxKey)throw Error('Geometry key range refused');
      if(!keys.has(key)){const [x,y]=place(key);keys.set(key,{key,x,y,feature_index:index});minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
      return keys.get(key);
    });features.push({type:feature.type,xy});
  });
  return {features,keys:[...keys.values()],bounds:keys.size?{minX,maxX,minY,maxY}:null};
}
export function cameraFor(mode,geometry,width,height,maxKey){
  if(mode==='home'||!geometry?.keys.length)return{x:0,y:0,zoom:Math.min(width,height)/(Math.sqrt(maxKey)*2.15)};
  if(mode==='near'){const p=geometry.keys[0];return{x:p.x,y:p.y,zoom:9};}
  if(mode!=='fit')throw Error('Unknown camera');
  const b=geometry.bounds;return{x:(b.minX+b.maxX)/2,y:(b.minY+b.maxY)/2,zoom:Math.min(20,(width-36)/Math.max(1,b.maxX-b.minX),(height-36)/Math.max(1,b.maxY-b.minY))};
}
