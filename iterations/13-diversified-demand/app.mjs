import {SOURCE,MODULE_URL,numberInput,calculate} from './model.mjs';
const $ = id => document.getElementById(id);
const fields = ['unitCount','perUnitKw','coincidenceFactor','measuredGroupPeakKw'];
const fmt = n => n!==0 && Math.abs(n)<0.000001 ? n.toExponential(4) : n.toLocaleString('en-GB',{maximumFractionDigits:6});
let engine, current;
$('source').href=`https://github.com/${SOURCE.repository}/blob/${SOURCE.commit}/${SOURCE.file}`;
$('sourcePin').textContent=`${SOURCE.repository} / ${SOURCE.commit} / ${SOURCE.file}\nSHA256 ${SOURCE.sha256}`;
function refresh() {
  current=null; $('download').disabled=true;
  const mode=$('mode').value;
  $('factorFields').hidden=mode!=='assumed'; $('peakFields').hidden=mode!=='implied';
  if(!engine)return;
  try {
    const inputs=Object.fromEntries(fields.map(id=>[id,numberInput($(id).value)]));
    current=calculate(engine,mode,inputs);
    $('resultLabel').textContent=mode==='assumed'?'Aggregate group demand · under the stated assumption':'Coincidence factor · implied by the supplied peak';
    $('answer').textContent=fmt(current.value); $('answerUnit').textContent=current.unit==='kW'?'kW':'fraction';
    $('equation').textContent=mode==='assumed'?`${fmt(inputs.unitCount)} units × ${fmt(inputs.perUnitKw)} kW × ${fmt(current.factor)}`:`${fmt(current.groupKw)} kW ÷ ${fmt(current.from.unrestrictedKw)} kW`;
    $('unrestricted').textContent=`${fmt(current.from.unrestrictedKw)} kW`;
    $('group').textContent=`${fmt(current.groupKw)} kW`;
    $('groupLabel').textContent=mode==='assumed'?'With the assumed factor':'Supplied group peak';
    $('fraction').textContent=`${fmt(current.factor*100)}% of this group's unrestricted total. This is aggregate kW, not kW per unit.`;
    $('loadLabel').textContent=`${fmt(current.groupKw)} kW`;
    $('groupBar').style.width=`${current.factor*100}%`;
    $('record').textContent=JSON.stringify(current,null,2);
    $('result').hidden=false; $('error').hidden=true; $('status').textContent='Calculated by the pinned module · illustrative inputs'; $('download').disabled=false;
  } catch(error) {
    $('result').hidden=true; $('error').hidden=false; $('error').textContent=`REFUSED · ${error.name}: ${error.message}`;
    $('record').textContent='No current result. Correct the refused input.'; $('status').textContent='Input refused; previous result cleared.';
  }
}
$('controls').addEventListener('submit',event=>event.preventDefault());
$('controls').addEventListener('input',event=>{if(event.target.id==='factorSlide')$('coincidenceFactor').value=$('factorSlide').value;else if(event.target.id==='coincidenceFactor' && Number($('coincidenceFactor').value)>0 && Number($('coincidenceFactor').value)<=1)$('factorSlide').value=$('coincidenceFactor').value;refresh();});
$('mode').addEventListener('change',refresh);
$('reset').addEventListener('click',()=>{$('mode').value='assumed';$('unitCount').value='100';$('perUnitKw').value='7';$('coincidenceFactor').value='0.3';$('factorSlide').value='0.3';$('measuredGroupPeakKw').value='210';refresh();});
$('download').addEventListener('click',()=>{if(!current)return;const url=URL.createObjectURL(new Blob([JSON.stringify(current,null,2)+'\n'],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='group-demand.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
try {
  engine=await import(MODULE_URL);
  for(const [name,reason] of Object.entries(engine.NOT_COMPUTED)) {const term=document.createElement('dt');term.textContent=name;const desc=document.createElement('dd');desc.textContent=reason;$('exclusions').append(term,desc);}
  refresh();
} catch(error) {
  $('status').textContent='Calculation module unavailable. No substitute result is calculated.';
  $('error').hidden=false;$('error').textContent=`Source import failed: ${error.message}`;
}
const context=document.modelContext;
if(context?.registerTool) {
  const lifecycle=new AbortController();
  addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
  const register=tool=>{try{Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}};
  register({name:'read_group_demand',description:'Read the current illustrative group-demand record without changing the page.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute(input){if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).length)throw new TypeError('Expected an empty object');return current?JSON.parse(JSON.stringify(current)):{available:false,status:$('status').textContent};}});
  register({name:'configure_group_demand',description:'Set illustrative group inputs and recalculate the visible comparison. Does not approve a connection or publish data.',inputSchema:{type:'object',properties:{mode:{type:'string',enum:['assumed','implied']},unitCount:{type:'integer',minimum:1,maximum:10000000},perUnitKw:{type:'number',exclusiveMinimum:0,maximum:1000},coincidenceFactor:{type:'number',exclusiveMinimum:0,maximum:1},measuredGroupPeakKw:{type:'number',exclusiveMinimum:0}},required:['mode','unitCount','perUnitKw'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){
    if(!engine)throw new Error('Calculation module unavailable');
    if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>!['mode',...fields].includes(key)))throw new TypeError('Unexpected configuration fields');
    const needed=['unitCount','perUnitKw',input.mode==='assumed'?'coincidenceFactor':'measuredGroupPeakKw'];
    if(needed.some(key=>typeof input[key]!=='number' || !Number.isFinite(input[key])))throw new TypeError('Required inputs must be finite numbers');
    calculate(engine,input.mode,input);
    $('mode').value=input.mode;for(const key of needed)$(key).value=String(input[key]);
    if(input.mode==='assumed')$('factorSlide').value=String(input.coincidenceFactor);
    refresh();return JSON.parse(JSON.stringify(current));
  }});
}
