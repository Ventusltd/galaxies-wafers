import{spawn}from'node:child_process';import{mkdir,writeFile,readFile}from'node:fs/promises';import path from'node:path';import{createHash}from'node:crypto';import assert from'node:assert/strict';import{BASE,SOURCES}from'./model.mjs';
const playwright=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');const output=process.env.PROOF_OUTPUT || path.resolve('browser-evidence');await mkdir(output,{recursive:true});
const url=process.env.PAGE_URL || 'http://127.0.0.1:8779/';const server=process.env.PAGE_URL?null:spawn(process.platform==='win32'?'python':'python3',['-m','http.server','8779','--bind','127.0.0.1'],{stdio:'ignore'});const results=[];
try{
  for(let n=0;n<30;n++){try{if((await fetch(url)).ok)break;}catch{}if(n===29)throw Error('Preview unavailable');await new Promise(r=>setTimeout(r,100));}
  for(const name of(process.env.BROWSER_ENGINES || 'chromium,webkit').split(',')){
    const browser=await playwright[name].launch({headless:true,...(name==='chromium' && process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
    try{for(const width of[390,1400]){
      const context=await browser.newContext({viewport:{width,height:width===390?844:900},deviceScaleFactor:width===390?3:1,isMobile:width===390,hasTouch:width===390,acceptDownloads:true});const page=await context.newPage();page.setDefaultTimeout(12000);
      const errors=[],failed=[],sourceResponses=[];let negative=false;const receipt={engine:name,version:browser.version(),width,dpr:width===390?3:1,started:new Date().toISOString(),pass:false,errors,failed_requests:failed};
      page.on('pageerror',e=>{if(!negative)errors.push(e.message);});page.on('console',m=>{if(!negative && m.type()==='error')errors.push(m.text());});page.on('requestfailed',r=>{if(!negative)failed.push(r.url());});
      page.on('response',r=>{if(negative)return;if(r.status()>=400)failed.push(r.url());const source=SOURCES.find(s=>BASE+s.file===r.url());if(source)sourceResponses.push(r.body().then(bytes=>({file:source.file,status:r.status(),sha256:createHash('sha256').update(bytes).digest('hex')})));});
      try{
        await page.goto(url);await page.waitForFunction(()=>document.querySelector('#headline').textContent==='2 hops');assert.equal(await page.locator('#path li').count(),2);assert.equal(await page.locator('.route').count(),2);assert.equal(await page.locator('.edge.refused').count(),1);
        await page.waitForFunction(()=>[...document.querySelectorAll('.route')].every(e=>Number.parseFloat(getComputedStyle(e).strokeDashoffset)===0));
        await page.screenshot({path:path.join(output,`${name}-${width}-route.png`),fullPage:true});
        await page.locator('#to').selectOption('DIDC');await page.locator('#voltage').selectOption('132');assert.equal(await page.locator('#headline').innerText(),'2 hops');assert.match(await page.locator('#path li').first().innerText(),/transformer/);
        await page.locator('#budget').fill('1');assert.equal(await page.locator('#headline').innerText(),'Not reached');assert.equal(await page.locator('.route').count(),0);
        await page.locator('#budget').fill('1.5');assert.match(await page.locator('#status').innerText(),/REFUSED/);assert.equal(await page.locator('#download').isDisabled(),true);
        await page.locator('#budget').fill('6');await page.locator('#voltage').selectOption('33');assert.match(await page.locator('#reason').innerText(),/no node at 33 kV/);
        await page.locator('#voltage').selectOption('all');await page.locator('#to').selectOption('ISLE');assert.equal(await page.locator('#headline').innerText(),'Not reached');assert.match(await page.locator('#refusals').innerText(),/different declared voltages/);
        await page.locator('#to').selectOption('COWL');assert.equal(await page.locator('#headline').innerText(),'0 hops');assert.equal(await page.locator('#path li').count(),0);
        await page.locator('#to').selectOption('PLCH');assert.match(await page.locator('#path').innerText(),/9999 MVA fixture placeholder/);
        await page.getByText('Machine detail',{exact:true}).click();const promise=page.waitForEvent('download');await page.locator('#download').click();const download=await promise;const filename=path.join(output,`${name}-${width}-query.json`);await download.saveAs(filename);const record=JSON.parse(await readFile(filename,'utf8'));assert.equal(record.route.path[0].ratings_mva.winter,9999);assert.equal(record.route.hops,1);
        await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.route').first().evaluate(e=>getComputedStyle(e).animationName),'none');
        receipt.layout=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,overflowing:[...document.querySelectorAll('main *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(e=>({tag:e.tagName,id:e.id,right:e.getBoundingClientRect().right}))}));
        receipt.overflow=receipt.layout.scrollWidth>receipt.layout.width+1;await page.screenshot({path:path.join(output,`${name}-${width}-details.png`),fullPage:true});assert.equal(receipt.overflow,false);receipt.source_responses=await Promise.all(sourceResponses);for(const source of SOURCES){const observed=receipt.source_responses.filter(r=>r.file===source.file);assert.ok(observed.length);for(const r of observed){assert.equal(r.status,200);assert.equal(r.sha256,source.sha256);}}
        assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);negative=true;await page.route(BASE+SOURCES[0].file,r=>r.abort('failed'));await page.reload();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('module unavailable'));assert.equal(await page.locator('.route').count(),0);assert.equal(await page.locator('#download').isDisabled(),true);receipt.module_unavailable_refused=true;receipt.native_webmcp='Not exercised in a native supported context.';receipt.pass=true;
      }catch(error){receipt.error=error.stack;receipt.pass=false;}finally{receipt.finished=new Date().toISOString();results.push(receipt);await context.close();}
    }}finally{await browser.close();}
  }
}finally{server?.kill();await writeFile(path.join(output,'receipt.json'),JSON.stringify({source_commit:process.env.GITHUB_SHA || null,url,results},null,2)+'\n');}
console.log(JSON.stringify({cases:results.length,passed:results.filter(r=>r.pass).length}));if(!results.length || results.some(r=>!r.pass))process.exitCode=1;
