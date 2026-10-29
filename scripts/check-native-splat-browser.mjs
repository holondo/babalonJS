// Real SPZ -> worker LOD -> native GLB session, exercising source preservation and mixed exports.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const {chromium}=await import(process.env.BABALON_PLAYWRIGHT_PATH?pathToFileURL(process.env.BABALON_PLAYWRIGHT_PATH).href:'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  const page=await browser.newPage({viewport:{width:375,height:812}});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.BABALON_TEST_URL??'http://localhost:5175/');
  await page.waitForFunction(()=>window.editor&&window.ui);
  await page.evaluate(()=>{ui.scheduleAutosave=()=>{};clearTimeout(ui.autosaveTimer);});
  const chooser=page.waitForEvent('filechooser'); await page.getByRole('button',{name:'Choose files',exact:true}).click();
  await(await chooser).setFiles(process.env.BABALON_TEST_SPZ);
  await page.waitForFunction(()=>editor.entities.some(e=>e.kind==='model'),null,{timeout:60000});
  await page.evaluate(async mixed=>{
    const {exportNativeAR}=await import('/src/ar/nativeSplats.ts');
    const {snapshot}=await import('/src/core/project.ts');
    const ed=editor,source=ed.selected.meshes.find(m=>m.splatsData);
    if(mixed) {
      const copy=ed.duplicate();
      copy.root.scaling.set(-0.7,1.2,0.8);copy.root.position.x+=1.5;
      ed.addPrimitive('box');
    }
    ed.cameraTween=null;
    await new Promise(resolve=>setTimeout(resolve,300));
    const hash=async()=>Promise.all([source.splatsData,...source.shData].map(async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).join(',')));
    const before=await hash(),sceneBefore=snapshot(ed,'native').json;
    const started=performance.now();
    window.nativeResult={};
    window.nativeJob=exportNativeAR(ed).then(async blob=>{
      const buffer=await blob.arrayBuffer(),dv=new DataView(buffer);
      const json=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,20,dv.getUint32(12,true))));
      const ext=json.extensions?.BABALON_ar_gaussian_lod;
      if(!ext||ext.version!==1||ext.trees.length!==(mixed?2:1))throw new Error('Missing native hierarchy');
      const tree=ext.trees[0],view=json.bufferViews[tree.records];
      if(tree.sourceCount!==source.splatsData.byteLength/32||tree.count>262143)throw new Error('Wrong source/atlas count');
      if(view.byteLength!==tree.count*32||!tree.matrix.every(Number.isFinite))throw new Error('Invalid native record layout');
      if(JSON.stringify(before)!==JSON.stringify(await hash()))throw new Error('Source or SH was modified');
      const after=snapshot(ed,'native').json;
      for(const key of ['entities','env']) if(JSON.stringify(sceneBefore[key])!==JSON.stringify(after[key]))throw new Error(`Export changed saved editor ${key}`);
      if((json.meshes??[]).some(m=>m.primitives.some(p=>p.mode===0||p.extensions?.KHR_gaussian_splatting||p.extensions?.BABALON_gaussian_splatting)))throw new Error('Point fallback/original was exported into native AR');
      if(mixed&&!(json.meshes??[]).some(m=>m.primitives.some(p=>p.mode===undefined||p.mode===4)))throw new Error('Ordinary mesh was lost from mixed native scene');
      if(ext.trees.reduce((sum,t)=>sum+t.count,0)>270000)throw new Error('Native atlas memory was not bounded globally');
      window.nativeBlob=blob;
      window.nativeResult={done:true,bytes:blob.size,source:tree.sourceCount,nodes:ext.trees.reduce((sum,t)=>sum+t.count,0),instances:ext.trees.length,mixed,ms:Math.round(performance.now()-started),sourcePreserved:true,scenePreserved:true};
    }).catch(e=>{window.nativeResult={error:String(e)};});
  },!!process.env.BABALON_NATIVE_MIXED);
  await page.waitForFunction(()=>window.nativeResult?.done||window.nativeResult?.error,null,{timeout:90000});
  const result=await page.evaluate(()=>window.nativeResult); assert.ok(!result.error,result.error); assert.ok(result.done);
  console.log(JSON.stringify(result));
  if(process.env.BABALON_NATIVE_GLB) {
    const download=page.waitForEvent('download');
    await page.evaluate(()=>{const a=document.createElement('a');a.href=URL.createObjectURL(window.nativeBlob);a.download='native-splats.glb';a.click();});
    await(await download).saveAs(process.env.BABALON_NATIVE_GLB);
  }
  assert.deepEqual(errors,[]);
} finally {await browser.close();}
