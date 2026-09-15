import {exportVisibility,sourceContexts,currentStyle,proposedStyle,measureStyle} from './visibility-style.mjs';
import {CATALOG_SHA256,validateCatalog,prepareGeometry,cameraFor} from './model.mjs';
const $=id=>document.getElementById(id), canvases=[$('current'),$('proposed')];
let catalog=null,selected=null,geometry=null,epoch=0,controller=null,queue=Promise.resolve(),tableBuilt=false;
const cache=new Map(), views=new Map();
const sourceRoot='https://github.com/Ventusltd/galaxies-wafers/blob/be62c82b9ffebeaa9b1152a7e7fae1658b585d4b/';
const options=()=>({casing:$('casing').value,pointRadiusCssPx:4,strokeCssPx:2});
function error(message){$('failure').textContent=message;$('failure').hidden=false;}
function clearError(){$('failure').hidden=true;}
async function readChecked(path,expected,bytes,signal){
  const response=await fetch(new URL(path,import.meta.url),{signal});if(!response.ok)throw Error(`Input unavailable: HTTP ${response.status}`);
  const raw=await response.arrayBuffer();if(bytes!==undefined&&raw.byteLength!==bytes)throw Error('Input byte length refused');
  const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',raw))].map(x=>x.toString(16).padStart(2,'0')).join('');
  if(digest!==expected)throw Error('Input digest refused');return JSON.parse(new TextDecoder().decode(raw));
}
function styles(){return[currentStyle(selected),proposedStyle(selected,options())];}
function styleReadings(){
  if(!selected)return;
  const values=styles().map(s=>measureStyle(s,sourceContexts())[0]);
  $('current-ratio').textContent=selected.features?values[0].core_to_context_ratio.toFixed(2)+':1':'EMPTY';
  $('proposed-ratio').textContent=selected.features?values[1].core_to_context_ratio.toFixed(2)+':1':'EMPTY';
  $('boundary-ratio').textContent=selected.features?values[1].boundary_ratio.toFixed(2)+':1':'EMPTY';
  $('style-limit').textContent=!selected.features?'EMPTY: no geometry or contrast claim.':options().casing==='dark'?'Black casing separates a mark from bright points, but its outer boundary has low contrast against dark ground. The coloured core is measured separately.':options().casing==='light'?'White casing separates from dark ground, but can disappear against bright substrate points. This is not a universal solution.':'With no casing, the coloured core is the outer boundary. Overlap and antialiasing are not evaluated by these ratios.';
  const report=exportVisibility(catalog,options());
  const ground=report.counts.contexts.find(x=>x.context_id==='webgl_ground');
  $('counts').textContent=`${catalog.layers.length} layers · ${catalog.counts.features.toLocaleString()} source features · ${catalog.counts.empty_layers} EMPTY · ${ground.current_meets_3_to_1}/${ground.evaluated_layers} current cores reach 3:1 against source ground`;
  $('table-count').textContent=`(${catalog.layers.length})`;
  if(tableBuilt){for(const row of report.rows){const tr=$('row-'+row.layer_id);tr.cells[2].textContent=row.status==='EMPTY'?'EMPTY':row.current_measurements[0].core_to_context_ratio.toFixed(2)+':1';tr.cells[3].textContent=row.status==='EMPTY'?'EMPTY':row.proposed_measurements[0].core_to_context_ratio.toFixed(2)+':1';}}
}
function draw(){
  if(!catalog||!selected)return;
  const pair=styles();
  canvases.forEach((canvas,i)=>{
    const width=canvas.clientWidth,height=canvas.clientHeight,dpr=Math.min(devicePixelRatio||1,3);
    const wantedW=Math.round(width*dpr),wantedH=Math.round(height*dpr);
    if(canvas.width!==wantedW)canvas.width=wantedW;if(canvas.height!==wantedH)canvas.height=wantedH;
    const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.globalAlpha=1;ctx.fillStyle='#0b0d12';ctx.fillRect(0,0,width,height);
    const view=cameraFor($('camera').value,geometry,width,height,catalog.max_issued_key);views.set(canvas,{...view,width,height});
    if(!geometry?.features.length){ctx.fillStyle='#b5c1d1';ctx.font='14px system-ui';ctx.textAlign='center';ctx.fillText(geometry?'EMPTY · no marks':'Load a layer to see its issued keys',width/2,height/2);return;}
    const s=pair[i],position=p=>[(p.x-view.x)*view.zoom+width/2,height/2-(p.y-view.y)*view.zoom];
    for(const f of geometry.features){
      if(f.type==='Point'){
        const [x,y]=position(f.xy[0]);if(x<-8||x>width+8||y<-8||y>height+8)continue;
        if(s.point_shape==='square'){ctx.globalAlpha=s.alpha;ctx.fillStyle=s.base_colour;ctx.fillRect(x-1,y-1,2,2);}
        else{if(s.casing){ctx.globalAlpha=s.casing.alpha;ctx.fillStyle=s.casing.colour;ctx.beginPath();ctx.arc(x,y,s.casing.point_radius_css_px,0,2*Math.PI);ctx.fill();}ctx.globalAlpha=s.alpha;ctx.fillStyle=s.base_colour;ctx.beginPath();ctx.arc(x,y,s.point_radius_css_px,0,2*Math.PI);ctx.fill();}
      }else{
        ctx.beginPath();f.xy.forEach((p,j)=>{const [x,y]=position(p);j?ctx.lineTo(x,y):ctx.moveTo(x,y);});
        if(s.casing){ctx.globalAlpha=s.casing.alpha;ctx.strokeStyle=s.casing.colour;ctx.lineWidth=s.casing.line_width_css_px;ctx.stroke();}
        ctx.globalAlpha=s.alpha;ctx.strokeStyle=s.base_colour;ctx.lineWidth=s.line_width_css_px;ctx.stroke();
      }
    }
    ctx.globalAlpha=1;
  });
}
async function choose(id,load=true){
  if(!catalog)return;const next=catalog.layers.find(l=>l.id===id);if(!next)throw Error('Unknown layer refused');
  selected=next;$('layer').value=id;geometry=null;clearError();controller?.abort();const ticket=++epoch;
  $('feature-detail').textContent='Tap a charted point to inspect its key and source feature. This view does not contain source-code bodies.';
  $('geometry-status').textContent=`${id}: WAIT · ${next.features} source features`;styleReadings();draw();
  if(!load)return;
  queue=queue.catch(()=>{}).then(async()=>{
    if(ticket!==epoch)return;
    $('geometry-status').textContent=`${id}: LOAD`;
    try{
      let prepared=cache.get(id);
      if(!prepared){controller=new AbortController();const doc=await readChecked(next.file,next.sha256,next.bytes,controller.signal);if(ticket!==epoch)return;prepared=prepareGeometry(doc,next,catalog.max_issued_key);cache.set(id,prepared);while(cache.size>2)cache.delete(cache.keys().next().value);}
      if(ticket!==epoch)return;geometry=prepared;
      $('geometry-status').textContent=`${id}: ${geometry.features.length?'OK':'EMPTY'} · ${geometry.features.length.toLocaleString()} features · ${geometry.keys.length.toLocaleString()} unique charted keys · unselected keys dark`;
      draw();
    }catch(e){if(ticket===epoch&&e.name!=='AbortError'){$('geometry-status').textContent=`${id}: REFUSED`;error(e.message);geometry=null;draw();}}
  });return queue;
}
function buildTable(){
  if(tableBuilt||!catalog)return;tableBuilt=true;const frag=document.createDocumentFragment();
  for(const l of catalog.layers){const tr=document.createElement('tr');tr.id='row-'+l.id;for(const value of [l.label,l.features,'','']){const td=document.createElement('td');td.textContent=value;tr.append(td);}frag.append(tr);}
  $('rows').append(frag);styleReadings();
}
function registerPageTools(){
  const context=document.modelContext;if(!context?.registerTool)return;
  const lifecycle=new AbortController();addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
  const snapshot=()=>({layer_id:selected?.id??null,geometry_status:$('geometry-status').textContent,features:geometry?.features.length??0,keys:geometry?.keys.length??0,casing:$('casing').value});
  const register=tool=>{try{Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}};
  register({name:'read_visibility',description:'Read the currently selected layer, geometry counts and casing.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:input=>{if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)throw Error('Expected empty input');return snapshot();}});
  register({name:'select_visibility_layer',description:'Select and load one catalogue layer in the visible comparison.',inputSchema:{type:'object',properties:{layerId:{type:'string'}},required:['layerId'],additionalProperties:false},annotations:{readOnlyHint:false},execute:async input=>{if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==1||typeof input.layerId!=='string'||!catalog.layers.some(x=>x.id===input.layerId))throw Error('Unknown layer refused');await choose(input.layerId);return snapshot();}});
}
canvases.forEach(canvas=>canvas.addEventListener('click',event=>{
  if(!geometry?.keys.length)return;const rect=canvas.getBoundingClientRect(),v=views.get(canvas),x=event.clientX-rect.left,y=event.clientY-rect.top;
  let nearest=null,best=100;
  for(const p of geometry.keys){const dx=(p.x-v.x)*v.zoom+v.width/2-x,dy=v.height/2-(p.y-v.y)*v.zoom-y,d=dx*dx+dy*dy;if(d<best){best=d;nearest=p;}}
  if(!nearest)return;$('feature-card').open=true;
  $('feature-detail').textContent=JSON.stringify({layer_id:selected.id,key:nearest.key,feature_index_zero_based:nearest.feature_index,geometry_source:sourceRoot+selected.source_file,source_sha256:selected.source_sha256,note:'Code address, not an electrical coordinate. Exact source-code body is not included in this geometry projection.'},null,2);
}));
$('layer').addEventListener('change',()=>choose($('layer').value).catch(e=>error(e.message)));
$('load').addEventListener('click',()=>choose($('layer').value).catch(e=>error(e.message)));
$('camera').addEventListener('change',draw);$('casing').addEventListener('change',()=>{styleReadings();draw();});
$('table-panel').addEventListener('toggle',()=>{if($('table-panel').open)buildTable();});
$('export').addEventListener('click',()=>{
  const report=exportVisibility(catalog,options());report.provenance=catalog.source;report.geometry_projection='catalog.json; feature counts independently checked during export; geometry fetched only on selection';
  const blob=new Blob([JSON.stringify(report,null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='visibility-style.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
new ResizeObserver(draw).observe($('current'));
async function init(){
  try{
    catalog=validateCatalog(await readChecked('catalog.json',CATALOG_SHA256));
    $('layer').replaceChildren(...catalog.layers.map(l=>{const option=document.createElement('option');option.value=l.id;option.textContent=`${l.id} · ${l.label}`;return option;}));
    for(const id of ['grid-engine-shell','learned','module-Ga','crossname','spider','module-Gg']){const button=document.createElement('button');button.textContent=id;button.addEventListener('click',()=>choose(id).catch(e=>error(e.message)));$('priorities').append(button);}
    $('layer').disabled=false;$('load').disabled=false;$('export').disabled=false;
    $('overlay-source').href=sourceRoot+'layers-panel.mjs';$('wafer-source').href=sourceRoot+'wafer.mjs';
    $('machine').textContent=`Inputs: ${catalog.layers.length} pinned layer entries, colour in sRGB, opacity in [0,1], dimensions in CSS px, positive integer issued keys. Outputs: unitless contrast ratios and code-space geometry. Source commit ${catalog.source.commit}. Placement is unchanged; inferred electrical quantities: none.`;
    await choose('module-Ga',false);registerPageTools();
  }catch(e){error(e.message);$('counts').textContent='Catalogue REFUSED';}
}
init();
