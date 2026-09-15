import {product} from './fixture.mjs';
import {PIN,BASE,SOURCES,query,edgeKey} from './model.mjs';
const $=id=>document.getElementById(id);
const wideCoords={COWL1:[95,70],COWL4:[95,225],DIDC4:[390,225],STRA4:[700,225],ISLE1:[390,375],PLCH4:[390,70]};
const narrowCoords={COWL1:[65,65],COWL4:[65,270],DIDC4:[265,270],STRA4:[265,480],ISLE1:[65,480],PLCH4:[265,65]};
const narrow=matchMedia('(max-width:760px)');
const NS='http://www.w3.org/2000/svg';
let engine,index,current;
function svg(tag,attrs,parent=$('network')){const element=document.createElementNS(NS,tag);for(const[key,value]of Object.entries(attrs))element.setAttribute(key,String(value));parent.append(element);return element;}
function text(x,y,value,cls){const element=svg('text',{x,y,'text-anchor':'middle',class:cls||''});element.textContent=value;}
function draw(){
  const coords=narrow.matches?narrowCoords:wideCoords;
  $('network').setAttribute('viewBox',narrow.matches?'0 0 400 550':'0 0 820 420');
  $('network').replaceChildren();
  const refused=new Set((current?.route?.refusals||[]).map(row=>edgeKey(row.at_node,row.to_node)));
  for(const row of [...product.circuits,...product.transformers]){const[a,b]=[coords[row.node_1],coords[row.node_2]];svg('line',{x1:a[0],y1:a[1],x2:b[0],y2:b[1],class:`edge${refused.has(edgeKey(row.node_1,row.node_2))?' refused':''}`});}
  for(const[step,row]of(current?.route?.path||[]).entries()){const[a,b]=[coords[row.from_node],coords[row.to_node]];svg('line',{x1:a[0],y1:a[1],x2:b[0],y2:b[1],pathLength:1,class:'route',style:`--delay:${step*0.65}s`});}
  const tx=narrow.matches?65:95,ty=narrow.matches?156:139;
  svg('circle',{cx:tx,cy:ty,r:17,class:'transformer'});svg('circle',{cx:tx,cy:ty+19,r:17,class:'transformer'});
  for(const row of product.nodes){const[x,y]=coords[row.node];svg('circle',{cx:x,cy:y,r:10,class:'node'});text(x,y-23,row.node);text(x,y+33,`${row.voltage_consistent_with_site?row.voltage_kv:'undeclared'}${row.voltage_consistent_with_site?' kV':''}`,'kv');}
}
for(const id of ['from','to'])for(const site of product.sites){const option=document.createElement('option');option.value=site.code;option.textContent=`${site.code} · ${site.name}`;$(id).append(option);}
$('to').value='STRA';
$('provenance').textContent=`Ventusltd/ventus-grid-engine @ ${PIN}`;
for(const source of [...SOURCES,{file:'proofs/electrical-distance.proof.mjs'}]){const li=document.createElement('li');const link=document.createElement('a');link.href=`https://github.com/Ventusltd/ventus-grid-engine/blob/${PIN}/${source.file}`;link.textContent=source.file;li.append(link);if(source.sha256)li.append(` · SHA256 ${source.sha256}`);$('sources').append(li);}
function clear(){current=null;$('path').replaceChildren();$('refusals').replaceChildren();$('download').disabled=true;$('replay').disabled=true;$('headline').textContent='No result';$('neighbours').textContent='No current result.';$('record').textContent='No current result.';}
function refresh(){
  clear();if(!engine){draw();return;}
  try{
    const budget=$('budget').value.trim()===''?NaN:Number($('budget').value);
    current=query(engine,index,{from:$('from').value,to:$('to').value,budget,voltage:$('voltage').value==='all'?null:Number($('voltage').value)});
    const route=current.route;
    $('status').textContent=route?'Computed by the pinned search modules':'Unknown site or unavailable compatible graph';
    $('headline').textContent=route?.reached?`${route.hops} ${route.hops===1?'hop':'hops'}`:'Not reached';
    $('reason').textContent=route?.reason || (route?.reached?'Fewest-hop path in this fixture and query. This is not available capacity.':'The module returned no route object.');
    for(const[step,row]of(route?.path||[]).entries()){const li=document.createElement('li');li.textContent=`${row.from_node} → ${row.to_node} · ${row.kind} · ${row.from_voltage_kv??'undeclared'} → ${row.to_voltage_kv??'undeclared'} kV`;if(row.ratings_mva?.winter===9999)li.append(' · 9999 MVA fixture placeholder carried unchanged, not headroom');$('path').append(li);}
    for(const refusal of route?.refusals||[]){const li=document.createElement('li');li.textContent=`${refusal.at_node} → ${refusal.to_node}: ${refusal.reason}`;$('refusals').append(li);}
    if(!$('refusals').children.length){const li=document.createElement('li');li.textContent='None reported by this bounded search. This is not validation of all fixture edges.';$('refusals').append(li);}
    $('neighbours').textContent=current.neighbourhood?.sites.length?current.neighbourhood.sites.map(site=>`${site.code}: ${site.hops} ${site.hops===1?'hop':'hops'}`).join(' · '):'No other sites returned within this origin/budget query.';
    $('record').textContent=JSON.stringify(current,null,2);$('download').disabled=false;$('replay').disabled=!route?.path?.length;
  }catch(error){current=null;$('status').textContent=`REFUSED · ${error.name}`;$('reason').textContent=error.message;}
  draw();
}
$('controls').addEventListener('submit',event=>event.preventDefault());$('controls').addEventListener('input',refresh);$('controls').addEventListener('change',refresh);
$('replay').addEventListener('click',draw);
narrow.addEventListener('change',draw);
$('download').addEventListener('click',()=>{if(!current)return;const url=URL.createObjectURL(new Blob([JSON.stringify(current,null,2)+'\n'],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='topology-query.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
draw();
try{const[search,topology]=await Promise.all(SOURCES.map(source=>import(BASE+source.file)));engine=search;index=topology.index(product);if(!index)throw new Error('Fixture schema refused');refresh();}catch(error){clear();draw();$('status').textContent='Pinned module unavailable. No substitute search.';$('reason').textContent=error.message;}
if(document.modelContext?.registerTool){
  const lifecycle=new AbortController();addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
  const register=tool=>{try{Promise.resolve(document.modelContext.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}};
  register({name:'read_hop_query',description:'Read the current synthetic topology query without changing it.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute(input){if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).length)throw new TypeError('Expected empty object');return current?JSON.parse(JSON.stringify(current)):{available:false,status:$('status').textContent};}});
  register({name:'configure_hop_query',description:'Set origin, destination and hop budget, then update the visible schematic. This does not establish real connectivity or capacity.',inputSchema:{type:'object',properties:{from:{type:'string',enum:product.sites.map(s=>s.code)},to:{type:'string',enum:product.sites.map(s=>s.code)},budget:{type:'integer',minimum:0,maximum:6},voltage:{enum:[null,33,132,400]}},required:['from','to','budget','voltage'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){
    if(!engine || !index)throw new Error('Pinned modules unavailable');
    if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>!['from','to','budget','voltage'].includes(key)))throw new TypeError('Unexpected query fields');
    if(![input.from,input.to].every(code=>product.sites.some(site=>site.code===code)) || ![null,33,132,400].includes(input.voltage))throw new RangeError('Select available fixture sites and origin voltage');
    query(engine,index,input);$('from').value=input.from;$('to').value=input.to;$('budget').value=String(input.budget);$('voltage').value=input.voltage===null?'all':String(input.voltage);refresh();return JSON.parse(JSON.stringify(current));
  }});
}
