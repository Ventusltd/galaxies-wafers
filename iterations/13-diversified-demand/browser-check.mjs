import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {SOURCE,MODULE_URL} from './model.mjs';
const playwright=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output=process.env.PROOF_OUTPUT || path.resolve('browser-evidence');
await mkdir(output,{recursive:true});
const url=process.env.PAGE_URL || 'http://127.0.0.1:8779/';
const server=process.env.PAGE_URL?null:spawn(process.platform==='win32'?'python':'python3',['-m','http.server','8779','--bind','127.0.0.1'],{stdio:'ignore'});
const results=[];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
try {
  for(let attempt=0;attempt<30;attempt++){try{const response=await fetch(url);if(response.ok)break;}catch{}if(attempt===29)throw Error('Preview server unavailable');await new Promise(resolve=>setTimeout(resolve,100));}
  for(const name of(process.env.BROWSER_ENGINES || 'chromium,webkit').split(',')) {
    const browser=await playwright[name].launch({headless:true,...(name==='chromium' && process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
    try {for(const width of[390,1400]) {
      const context=await browser.newContext({viewport:{width,height:width===390?844:900},deviceScaleFactor:width===390?3:1,isMobile:width===390,hasTouch:width===390,acceptDownloads:true});
      const page=await context.newPage();page.setDefaultTimeout(12000);
      const errors=[],failures=[],sources=[];
      const receipt={engine:name,version:browser.version(),width,dpr:width===390?3:1,started:new Date().toISOString(),pass:false,errors,failed_requests:failures};
      let negative=false;
      page.on('pageerror',e=>{if(!negative)errors.push(e.message);});
      page.on('console',message=>{if(!negative && message.type()==='error')errors.push(message.text());});
      page.on('requestfailed',request=>{if(!negative)failures.push({url:request.url(),error:request.failure()?.errorText});});
      page.on('response',response=>{if(negative)return;if(response.status()>=400)failures.push({url:response.url(),status:response.status()});if(response.url()===MODULE_URL)sources.push(response.body().then(bytes=>({status:response.status(),sha256:hash(bytes)})));});
      try {
        await page.goto(url);await page.waitForFunction(()=>document.querySelector('#answer').textContent==='210');
        assert.equal(await page.locator('#unrestricted').innerText(),'700 kW');
        await page.screenshot({path:path.join(output,`${name}-${width}-assumed.png`),fullPage:true});
        await page.locator('#coincidenceFactor').fill('0.6');assert.equal(await page.locator('#answer').innerText(),'420');
        await page.locator('#coincidenceFactor').fill('0');assert.match(await page.locator('#error').innerText(),/greater than zero/);assert.equal(await page.locator('#result').isVisible(),false);assert.equal(await page.locator('#download').isDisabled(),true);
        await page.locator('#coincidenceFactor').fill('');assert.match(await page.locator('#error').innerText(),/finite number/);
        await page.locator('#reset').click();await page.locator('#mode').selectOption('implied');assert.equal(await page.locator('#answer').innerText(),'0.3');
        await page.locator('#measuredGroupPeakKw').fill('701');assert.match(await page.locator('#error').innerText(),/exceeds the unrestricted total/);
        await page.locator('#measuredGroupPeakKw').fill('350');assert.equal(await page.locator('#answer').innerText(),'0.5');
        await page.locator('#unitCount').fill('1.5');assert.match(await page.locator('#error').innerText(),/whole number/);
        await page.locator('#unitCount').fill('10000001');assert.match(await page.locator('#error').innerText(),/Interface policy/);
        await page.locator('#reset').click();await page.locator('#mode').selectOption('implied');await page.locator('#measuredGroupPeakKw').fill('350');
        await page.getByText('Machine detail',{exact:true}).click();
        assert.equal(await page.locator('#exclusions dt').count(),4);
        const downloadPromise=page.waitForEvent('download');await page.locator('#download').click();const download=await downloadPromise;
        const filename=path.join(output,`${name}-${width}-result.json`);await download.saveAs(filename);
        const record=JSON.parse(await readFile(filename,'utf8'));assert.equal(record.value,0.5);assert.equal(record.groupKw,350);assert.equal(record.source.sha256,SOURCE.sha256);
        receipt.overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(receipt.overflow,false);
        await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('#groupBar').evaluate(e=>getComputedStyle(e).transitionDuration),'0s');
        receipt.source_responses=await Promise.all(sources);assert.ok(receipt.source_responses.length>=1);for(const source of receipt.source_responses){assert.equal(source.status,200);assert.equal(source.sha256,SOURCE.sha256);}
        assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
        negative=true;await page.route(MODULE_URL,route=>route.abort('failed'));await page.reload();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('module unavailable'));
        assert.equal(await page.locator('#result').isVisible(),false);assert.equal(await page.locator('#download').isDisabled(),true);receipt.module_unavailable_refused=true;
        receipt.native_webmcp='Not exercised; no native support is claimed verified.';receipt.pass=true;
      }catch(error){receipt.pass=false;receipt.error=error.stack;}finally{receipt.finished=new Date().toISOString();results.push(receipt);await context.close();}
    }}finally{await browser.close();}
  }
}finally{server?.kill();await writeFile(path.join(output,'receipt.json'),JSON.stringify({source_commit:process.env.GITHUB_SHA || null,url,results},null,2)+'\n');}
console.log(JSON.stringify({cases:results.length,passed:results.filter(r=>r.pass).length}));
if(!results.length || results.some(r=>!r.pass))process.exitCode=1;
