import{SOURCE,URL,FIELDS,parse,calculate}from'./model.mjs';
const $=id=>document.getElementById(id),fmt=n=>n!==0 && Math.abs(n)<.000001?n.toExponential(4):n.toLocaleString('en-GB',{maximumFractionDigits:3});
let engine,current;
$('code').href=`https://github.com/${SOURCE.repository}/blob/${SOURCE.commit}/${SOURCE.file}`;$('proof').href=`https://github.com/${SOURCE.repository}/blob/${SOURCE.commit}/proofs/interconnector-economics.proof.mjs`;
$('provenance').textContent=`${SOURCE.repository} / ${SOURCE.commit} / ${SOURCE.file}\nSHA256 ${SOURCE.sha256}`;
const NS='http://www.w3.org/2000/svg';function svg(tag,attrs){const e=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,String(v));$('curve').append(e);return e;}
function draw(){
  $('curve').replaceChildren();$('rows').replaceChildren();if(!current?.rent)return;
  const max=current.series.at(-1).grossGbp,x=u=>50+(u-.1)/.9*435,y=value=>225-value/max*190;
  svg('path',{d:'M50 25 V225 H490',class:'axis'});
  for(const[px,py,label]of[[50,255,'0.1'],[243,255,'0.5'],[485,255,'1.0'],[50,19,`GBP ${fmt(max)}`]]){const e=svg('text',{x:px,y:py});e.textContent=label;}
  svg('polyline',{points:current.series.map(p=>`${x(p.utilisation)},${y(p.grossGbp)}`).join(' '),class:'curve',pathLength:1});
  for(const point of current.series){svg('circle',{cx:x(point.utilisation),cy:y(point.grossGbp),r:3,class:'point'});const tr=document.createElement('tr');for(const value of [fmt(point.utilisation),fmt(point.grossGbp)]){const td=document.createElement('td');td.textContent=value;tr.append(td);}$('rows').append(tr);}
  if(current.inputs.utilisation>=.1)svg('circle',{cx:x(current.inputs.utilisation),cy:y(current.rent.value),r:6,class:'selected'});
}
function refresh(){
  current=null;$('download').disabled=true;$('error').hidden=true;
  if(!engine)return;
  try{
    current=calculate(engine,Object.fromEntries(FIELDS.map(id=>[id,parse($(id).value)])));
    $('energy').textContent=fmt(current.energy.value);$('gross').textContent=current.rent?`£${fmt(current.rent.value)}`:'Not computed';
    $('direction').textContent=`Commercial incentive: ${current.direction.direction}`;
    $('spread').textContent=`Signed GB-minus-neighbour spread: ${fmt(current.direction.signedSpreadGbpPerMwh)} GBP/MWh. Absolute spread: ${fmt(current.direction.spreadGbpPerMwh)} GBP/MWh.`;
    $('quick').textContent=`${fmt(current.energy.value)} GWh · ${current.rent?`£${fmt(current.rent.value)} gross, not profit`:'gross value refused at zero spread'}`;
    $('refusal').hidden=!current.refusal;$('refusal').textContent=current.refusal?`${current.refusal.function} REFUSED · ${current.refusal.name}: ${current.refusal.message}`:'';
    $('chart').hidden=!current.rent;$('result').hidden=false;$('record').textContent=JSON.stringify(current,null,2);$('download').disabled=false;$('status').textContent=current.refusal?'Partial result: energy and incentive only; gross-value refusal retained.':'Calculated by the pinned module under the stated assumptions.';draw();
  }catch(error){current=null;$('result').hidden=true;$('quick').textContent='Input refused; previous result cleared.';$('status').textContent='No current calculation.';$('error').hidden=false;$('error').textContent=`${error.name}: ${error.message}`;$('record').textContent='No current result.';$('curve').replaceChildren();$('rows').replaceChildren();}
}
$('controls').addEventListener('submit',event=>{event.preventDefault();refresh();});$('controls').addEventListener('input',refresh);
$('swap').addEventListener('click',()=>{const value=$('gbPriceGbpPerMwh').value;$('gbPriceGbpPerMwh').value=$('neighbourPriceGbpPerMwh').value;$('neighbourPriceGbpPerMwh').value=value;refresh();});
for(const[id,reason]of Object.entries({wafer:'No numbered line established for this element: the pinned module has not been matched to an issued line and manifest layer in this lab.',application:'No registered application URL established for this calculation. The lab does not invent a register entry.',tools:'No manifest layer established for this calculation. A tool handoff requires a verified layer identifier.'}))$(id).addEventListener('click',()=>{$('handoff').textContent=reason;});
$('download').addEventListener('click',()=>{if(!current)return;const blob=globalThis.URL.createObjectURL(new Blob([JSON.stringify(current,null,2)+'\n'],{type:'application/json'}));const a=document.createElement('a');a.href=blob;a.download='spread-calculation.json';a.click();setTimeout(()=>globalThis.URL.revokeObjectURL(blob),1000);});
try{engine=await import(URL);refresh();}catch(error){$('quick').textContent='Calculation module unavailable.';$('status').textContent='No substitute calculation.';$('error').hidden=false;$('error').textContent=error.message;}
if(document.modelContext?.registerTool){const lifecycle=new AbortController();addEventListener('pagehide',()=>lifecycle.abort(),{once:true});const register=tool=>{try{Promise.resolve(document.modelContext.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}};
  register({name:'read_spread_calculation',description:'Read this synthetic price-spread result without changing state.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute(input){if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).length)throw new TypeError('Expected empty object');return current?JSON.parse(JSON.stringify(current)):{available:false,status:$('status').textContent};}});
  register({name:'configure_spread_calculation',description:'Set synthetic assumptions and run the visible calculation; no price forecast, dispatch or financial transaction.',inputSchema:{type:'object',properties:Object.fromEntries(FIELDS.map(key=>[key,{type:'number'}])),required:FIELDS,additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){if(!engine)throw new Error('Module unavailable');if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>!FIELDS.includes(key)) || FIELDS.some(key=>typeof input[key]!=='number' || !Number.isFinite(input[key])))throw new TypeError('All five named fields must be finite numbers');calculate(engine,input);for(const key of FIELDS)$(key).value=String(input[key]);refresh();return JSON.parse(JSON.stringify(current));}});
}
