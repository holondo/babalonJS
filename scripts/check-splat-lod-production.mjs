// Run against npm run preview: no /src imports, real production chunks and workers.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.BABALON_PLAYWRIGHT_PATH?pathToFileURL(process.env.BABALON_PLAYWRIGHT_PATH).href:'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:375,height:812}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.addInitScript(()=>{
    Object.defineProperty(navigator,'xr',{configurable:true,value:{isSessionSupported:async()=>true}});
    const Original=Worker;window.workerCount=0;
    window.Worker=class extends Original{alive=true;constructor(...args){super(...args);window.workerCount++;}terminate(){if(this.alive){this.alive=false;window.workerCount--;}return super.terminate();}};
  });
  await page.goto(process.env.BABALON_PREVIEW_URL??'http://localhost:5176/');await page.waitForFunction(()=>window.ui&&window.editor);
  await page.evaluate(()=>{ui.scheduleAutosave=()=>{};clearTimeout(ui.autosaveTimer);});
  const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Choose files',exact:true}).click();await(await chooser).setFiles(process.env.BABALON_TEST_SPZ);
  await page.waitForFunction(()=>editor.entities.some(e=>e.kind==='model'),null,{timeout:60000});
  await page.evaluate(async()=>{
    const ed=editor,source=ed.selected.meshes.find(m=>m.getClassName().includes('GaussianSplatting'));
    ed.cameraTween=null;ed.select(null);
    const hash=async()=>Promise.all([source.splatsData,...(source.shData??[])].map(async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).join(',')));
    const quality=()=>[source.shDegree,source.material.alpha,source.material.kernelSize,source.material.minPixelSize,source.material.compensation];
    const initialQuality=quality(),hashes=await hash();await ui.arLoader();const ar=ui.ar;
    ar.xr={baseExperience:{featuresManager:{attachFeature(){},detachFeature(){}},sessionManager:{session:{}},enterXRAsync:async()=>{}}};
    window.productionLod={ar,source,hash,quality,initialQuality,hashes,workers:window.workerCount,textures:ed.engine._internalTexturesCache.length};
    await ar.enter(ui.arOverlay);ar.anchor.setEnabled(true);
  });
  await page.waitForFunction(()=>window.productionLod.ar.splatStats?.ready&&!window.productionLod.ar.lodLoading&&window.productionLod.ar.splatStats.active>5,null,{timeout:60000});
  const result=await page.evaluate(async()=>{
    const t=window.productionLod,{ar,source}=t,initial={...ar.splatStats};
    if(initial.active>30000||source.isVisible||ar.appliedResolutionScale!==.5||ar.xrCanvasOptions.antialias!==false)throw new Error('Production AR did not use fast defaults');
    ar.setSplatBudget(1000);await new Promise(r=>setTimeout(r,600));
    if(ar.splatStats.active>1000)throw new Error('Production budget was exceeded');
    ar.cleanup();await new Promise(r=>setTimeout(r,300));
    if(!source.isVisible||JSON.stringify(await t.hash())!==JSON.stringify(t.hashes)||JSON.stringify(t.quality())!==JSON.stringify(t.initialQuality))throw new Error('Production LOD changed the original');
    if(window.workerCount!==t.workers||editor.engine._internalTexturesCache.length!==t.textures)throw new Error('Production LOD leaked workers/textures');
    return {source:initial.source,active:initial.active,pool:initial.pool,resolution:.5,originalRestored:true};
  });
  assert.deepEqual(errors,[]);console.log(JSON.stringify(result));
}finally{await browser.close();}
