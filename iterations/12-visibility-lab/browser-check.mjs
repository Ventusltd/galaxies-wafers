import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const {chromium,webkit}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const directory=dirname(fileURLToPath(import.meta.url));
const output=resolve(process.env.PROOF_OUTPUT||'browser-evidence');await mkdir(output,{recursive:true});
let server=null;const base=process.env.PAGE_URL||'http://127.0.0.1:8779/';
if(!process.env.PAGE_URL){server=spawn('python',['-m','http.server','8779','--bind','127.0.0.1','--directory',directory],{stdio:'ignore',windowsHide:true});for(let i=0;i<40;i++){try{if((await fetch(base)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}}
const results=[];let failed=false;
try{
  for(const engineName of (process.env.BROWSER_ENGINES||'chromium,webkit').split(',')){
    const engine={chromium,webkit}[engineName];if(!engine)throw Error('Unsupported test browser');
    const launchOptions=engineName==='chromium'&&process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{};
    const browser=await engine.launch({headless:true,...launchOptions});
    try{
      for(const viewport of [{width:390,height:844},{width:1400,height:900}]){
        const started=new Date().toISOString(),errors=[],failedRequests=[],geometryRequests=[];
        const context=await browser.newContext({viewport,deviceScaleFactor:viewport.width===390?3:1,isMobile:viewport.width===390,hasTouch:viewport.width===390});
        const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('requestfailed',r=>{if(!/ABORTED|cancelled/i.test(r.failure()?.errorText||''))failedRequests.push(r.url());});page.on('request',r=>{if(r.url().includes('/geometry/'))geometryRequests.push(r.url());});
        let result={engine:engineName,version:browser.version(),viewport,dpr:viewport.width===390?3:1,started,pass:false};
        try{
          const response=await page.goto(base,{waitUntil:'networkidle'});assert.equal(response.status(),200);
          await page.waitForFunction(()=>!document.querySelector('#layer').disabled);
          assert.equal(await page.locator('#layer option').count(),201);assert.equal(geometryRequests.length,0);
          await page.getByRole('button',{name:'Load selected layer',exact:true}).click();
          await page.waitForFunction(()=>document.querySelector('#geometry-status').textContent.includes('module-Ga: OK'));
          assert.equal(geometryRequests.length,1);
          await page.locator('#camera').selectOption('fit');
          await page.screenshot({path:resolve(output,`${engineName}-${viewport.width}-fit.png`),fullPage:true});
          await page.locator('#camera').selectOption('near');
          await page.screenshot({path:resolve(output,`${engineName}-${viewport.width}-near.png`),fullPage:true});
          const rect=await page.locator('#proposed').boundingBox();await page.locator('#proposed').click({position:{x:rect.width/2,y:rect.height/2}});
          assert.match(await page.locator('#feature-detail').textContent(),/"key":/);
          await page.getByRole('button',{name:'spider',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#geometry-status').textContent.includes('spider: EMPTY'));
          assert.equal(await page.locator('#current-ratio').textContent(),'EMPTY');
          await page.locator('#table-panel summary').click();await page.waitForFunction(()=>document.querySelectorAll('#rows tr').length===201);assert.equal(await page.locator('#rows tr').count(),201);assert.equal(geometryRequests.length,2);
          await page.getByRole('button',{name:'learned',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#geometry-status').textContent.includes('learned: OK'));
          await page.locator('#casing').selectOption('light');assert.match(await page.locator('#style-limit').textContent(),/bright substrate/);
          const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Download style JSON'}).click();const download=await downloadPromise;assert.equal(download.suggestedFilename(),'visibility-style.json');
          const downloadPath=resolve(output,`${engineName}-${viewport.width}-style.json`);await download.saveAs(downloadPath);const exported=JSON.parse(await readFile(downloadPath,'utf8'));assert.equal(exported.rows.length,201);assert.equal(exported.counts.empty_layers,3);assert.equal(exported.rows[0].proposed.point_radius_css_px,4);
          const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false);assert.deepEqual(errors,[]);assert.deepEqual(failedRequests,[]);
          result={...result,pass:true,geometry_fetches:geometryRequests.length,overflow,errors,failed_requests:failedRequests,webmcp_validation:'Not exercised by this harness; optional support is not claimed verified.'};
          await page.route('**/catalog.json',route=>route.fulfill({status:200,contentType:'application/json',body:'{}'}));await page.reload({waitUntil:'networkidle'});assert.match(await page.locator('#failure').textContent(),/digest refused/);assert.equal(await page.locator('#layer').isDisabled(),true);result.tampered_catalog_refused=true;
        }catch(e){failed=true;result={...result,pass:false,error:e.message,errors,failed_requests:failedRequests};}
        result.finished=new Date().toISOString();results.push(result);await context.close();
      }
    }finally{await browser.close();}
  }
}finally{server?.kill();await writeFile(resolve(output,'receipt.json'),JSON.stringify({source_commit:process.env.GITHUB_SHA||null,url:base,results},null,2)+'\n');}
console.log(JSON.stringify({cases:results.length,passed:results.filter(x=>x.pass).length}));if(failed)process.exitCode=1;
