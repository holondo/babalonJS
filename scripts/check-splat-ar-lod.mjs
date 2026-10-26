// Real source, actual LOD/sort workers and Gaussian renderer; XR platform calls are simulated.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const {chromium}=await import(process.env.BABALON_PLAYWRIGHT_PATH?pathToFileURL(process.env.BABALON_PLAYWRIGHT_PATH).href:'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  const page=await browser.newPage({viewport:process.env.BABALON_TEST_PHONE?{width:375,height:812}:{width:640,height:480}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.addInitScript(()=>{
    const Original=Worker;window.lodWorkers=0;window.sortSizes=[];
    window.Worker=class extends Original{
      alive=true;constructor(...args){super(...args);window.lodWorkers++;}
      postMessage(data,...args){if(data?.command==='sort')window.sortSizes.push(data.depthMix.length);return super.postMessage(data,...args);}
      terminate(){if(this.alive){this.alive=false;window.lodWorkers--;}return super.terminate();}
    };
  });
  await page.goto(process.env.BABALON_TEST_URL??'http://localhost:5175/');await page.waitForFunction(()=>window.ui&&window.editor);
  await page.evaluate(()=>{ui.scheduleAutosave=()=>{};clearTimeout(ui.autosaveTimer);});
  const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Choose files',exact:true}).click();await(await chooser).setFiles(process.env.BABALON_TEST_SPZ);
  await page.waitForFunction(()=>editor.entities.some(e=>e.kind==='model'),null,{timeout:60000});
  await page.evaluate(async(duplicate)=>{
    const {ARMode}=await import('/src/ar/ar.ts');const {FreeCamera}=await import('/node_modules/@babylonjs/core/Cameras/freeCamera.js');
    const {snapshot}=await import('/src/core/project.ts');
    const ed=editor;if(duplicate)ed.duplicate();
    const source=ed.selected.meshes.find(m=>m.getClassName().includes('GaussianSplatting'));
    ed.cameraTween=null;ed.select(null);await new Promise(r=>setTimeout(r,300));
    const hash=async()=>Promise.all([source.splatsData,...(source.shData??[])].map(async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).join(',')));
    const camera=new FreeCamera('LOD tracked camera',ed.camera.position.clone(),ed.scene);camera.setTarget(ed.camera.target);
    const ar=new ARMode(ed);
    ar.xr={baseExperience:{featuresManager:{attachFeature(){},detachFeature(){}},sessionManager:{session:{}},enterXRAsync:async()=>{}}};
    window.lodTest={ed,ar,source,camera,hash,hashes:await hash(),baseline:snapshot(ed,'LOD').json,workers:window.lodWorkers,textures:ed.engine._internalTexturesCache.length,start:performance.now()};
    await ar.enter(document.createElement('div'));ar.anchor.setEnabled(true);ed.scene.activeCamera=camera;ed.invalidate(8000);
  },!!process.env.BABALON_LOD_DUPLICATE);
  await page.waitForFunction(()=>window.lodTest.ar.splatStats?.ready&&!window.lodTest.ar.lodLoading,null,{timeout:60000});
  await page.waitForFunction(()=>window.lodTest.ar.splatStats.active>5,null,{timeout:10000});
  const initial=await page.evaluate(()=>{const {ar,source,start}=window.lodTest;return {prepareMs:Math.round(performance.now()-start),...ar.splatStats,sourceHidden:!source.isVisible,scale:ar.appliedResolutionScale};});
  console.log(JSON.stringify({initial}));
  assert.ok(initial.active<=30000&&initial.sourceHidden&&initial.scale===.5);
  if(process.env.BABALON_LOD_IMAGE){await page.evaluate(()=>document.body.classList.add('ui-hidden'));await page.screenshot({path:process.env.BABALON_LOD_IMAGE});}
  const result=await page.evaluate(async()=>{
    const {ed,ar,source,camera,hash,hashes,baseline,workers,textures}=window.lodTest;
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const proxy=ed.scene.meshes.find(m=>m.name.endsWith('AR LOD'));
    if(!proxy||proxy.renderedSplatCount>ar.splatBudget)throw new Error('Renderer did not use the active budget');
    const {ARHud}=await import('/src/ar/arHud.ts');const hud=new ARHud(ar);
    hud.el.querySelector('button[title="AR options"]').click();
    const panel=hud.el.querySelector('.ar-options');
    if(panel.scrollWidth>panel.clientWidth+2)throw new Error('AR LOD controls overflow the viewport');
    [...panel.querySelectorAll('button')].find(b=>b.textContent==='75%').click();
    if(ar.resolutionScale!==.75||ar.appliedResolutionScale!==.5)throw new Error('Resolution control did not set the next-session scale');
    hud.el.remove();
    window.sortSizes=[];camera.rotation.y+=.03;await wait(400);camera.rotation.y-=.03;await wait(400);
    if(!window.sortSizes.length||window.sortSizes.some(n=>n>ar.splatBudget+15))throw new Error('Sort worker still processes the full original/atlas');
    const near=ar.splatStats.active,position=camera.position.clone();
    camera.position.copyFrom(camera.position.subtract(camera.getTarget()).scale(30).add(camera.getTarget()));
    await wait(700);const far=ar.splatStats.active;
    camera.position.copyFrom(position);await wait(500);
    ar.setSplatBudget(1000);await wait(500);
    if(ar.splatStats.active>1000||proxy.renderedSplatCount>1000)throw new Error('Lower budget was exceeded');
    ar.setSplatBudget(60000);await wait(700);const higher=ar.splatStats.active;
    if(ed.scene.meshes.filter(m=>m.name.endsWith('AR LOD')).reduce((n,m)=>n+m.renderedSplatCount,0)>60000)throw new Error('Budget was applied per object instead of globally');
    ar.depthSupported=true;ar.depth={attach:()=>true,detach(){}};ar.setOcclusion(true);
    if(ar.depthMaterials.some(p=>p.mesh===source)||!ar.depthMaterials.some(p=>p.mesh===proxy))throw new Error('Depth used the hidden original instead of LOD');
    ar.setSplatPerformance(false);
    if(!source.isVisible||proxy.isEnabled())throw new Error('Full detail did not restore the original');
    ar.setSplatPerformance(true);await wait(300);
    ar.setResolutionScale(.75);
    if(ar.resolutionScale!==.75||ar.appliedResolutionScale!==.5||ar.xrCanvasOptions.framebufferScaleFactor!==.75||ar.xrCanvasOptions.antialias!==false)throw new Error('Resolution did not remain session-scoped');
    ar.cleanup();ed.scene.activeCamera=ed.camera;camera.dispose();await wait(400);
    const {snapshot}=await import('/src/core/project.ts');const final=snapshot(ed,'LOD').json;
    if(JSON.stringify(baseline.entities)!==JSON.stringify(final.entities)||JSON.stringify(baseline.env)!==JSON.stringify(final.env))throw new Error('LOD changed project state');
    if(JSON.stringify(hashes)!==JSON.stringify(await hash()))throw new Error('LOD changed original packed records/harmonics');
    if(!source.isVisible||ed.scene.meshes.includes(proxy)||window.lodWorkers!==workers||ed.engine._internalTexturesCache.length!==textures)throw new Error(`LOD resource leak: ${JSON.stringify({workers:window.lodWorkers,expected:workers,textures:ed.engine._internalTexturesCache.length,expectedTextures:textures})}`);
    // Exercise Babylon's actual output canvas -> XRWebGLLayer option boundary.
    // The hardware session/layer itself still requires phone verification.
    const {WebXRManagedOutputCanvas}=await import('/node_modules/@babylonjs/core/XR/webXRManagedOutputCanvas.js');
    const {Observable}=await import('/node_modules/@babylonjs/core/Misc/observable.js');
    const NativeLayer=window.XRWebGLLayer,layerOptions=[];
    window.XRWebGLLayer=class{constructor(_session,_context,options){layerOptions.push({...options});this.framebufferWidth=1000*options.framebufferScaleFactor;this.framebufferHeight=1000*options.framebufferScaleFactor;this.framebuffer=null;}getViewport(){return {x:0,y:0,width:this.framebufferWidth,height:this.framebufferHeight};}};
    const output=new WebXRManagedOutputCanvas({scene:ed.scene,onXRSessionInit:new Observable(),onXRSessionEnded:new Observable()},{canvasElement:ed.engine.getRenderingCanvas(),canvasOptions:ar.xrCanvasOptions});
    try{const layer=await output.initializeXRLayerAsync({});if(layer.framebufferWidth!==750||layerOptions[0].antialias!==false)throw new Error('XR layer did not receive the requested resolution/antialias settings');}
    finally{output.dispose();window.XRWebGLLayer=NativeLayer;}
    // Entry cancellation while the build worker is starting must also restore and release.
    const next=new (ar.constructor)(ed);next.xr=ar.xr;await next.enter(document.createElement('div'));next.cleanup();await wait(500);
    if(!source.isVisible||window.lodWorkers!==workers)throw new Error('Cancelled LOD preparation leaked or hid the source');
    return {near,far,higher,maxSortedSplats:Math.max(...window.sortSizes),sourcePreserved:true,resourcesRestored:true};
  });
  assert.deepEqual(errors,[]);console.log(JSON.stringify(result));
}finally{await browser.close();}
