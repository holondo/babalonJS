import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
let playwright;
try { playwright=require('playwright'); } catch { playwright=require(process.env.PLAYWRIGHT_MODULE); }
const base=process.argv[2] ?? 'http://127.0.0.1:5173';
const path=process.argv[3];
assert.ok(path,'Pass a local humanoid GLB path as the second argument.');
const browser=await playwright.chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL ?? 'chrome'});
try {
  const page=await browser.newPage({viewport:{width:1100,height:820}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{window.requestAnimationFrame=cb=>setTimeout(()=>cb(performance.now()),16);});
  await page.route('**/__inverse-real.glb',route=>route.fulfill({path,contentType:'model/gltf-binary'}));
  await page.goto(base+'/scripts/fixtures/anatomy-priority.html');
  await page.waitForFunction(()=>window.anatomyTest);
  const source=await page.evaluate(async()=>{
    const {editor}=anatomyTest;
    await editor.addFromUrl('/__inverse-real.glb','Inverse source');
    const target=editor.entities.find(e=>e.name==='Inverse source');
    const mesh=[...target.meshes].sort((a,b)=>b.getTotalVertices()-a.getTotalVertices())[0];
    const entity=await editor.addAnatomy(),body=entity.anatomyBody;
    const hash=data=>{let h=2166136261;for(const value of data??[])h=Math.imul(h^Math.round(value*1e7),16777619);return h;};
    window.realFit={editor,target,mesh,entity,body,hash,base:new Float32Array(mesh.getVerticesData('position')),material:mesh.material,
      uv:hash(mesh.getVerticesData('uv')),indices:hash(mesh.getIndices()),status:'ready'};
    return{vertices:mesh.getTotalVertices(),triangles:mesh.getTotalIndices()/3,rigged:!!mesh.skeleton};
  });
  for(const jointHints of (process.env.INVERSE_TRUNK_ONLY ? [true] : [false,true])) {
    await page.evaluate(async jointHints=>{
      const {editor,target,mesh,body}=realFit;
      if(jointHints && editor.rigger.canRig(target)) {editor.rigger.start(target);editor.rigger.findPose();}
      realFit.status='running';const start=performance.now();
      body.adaptToTargetMesh({positions:new Float32Array(mesh.getVerticesData('position')),mesh,name:target.name,
        hints:{heightCm:175,surface:'skin',parameters:{fat:16}}}).then(result=>Object.assign(realFit,{status:'done',result,fitMs:performance.now()-start}))
        .catch(error=>Object.assign(realFit,{status:'error',error:error.stack}));
    },jointHints);
    await page.waitForFunction(()=>realFit.status!=='running',{},{timeout:180000});
    const result=await page.evaluate(async()=>{
      const {mesh,body,base,hash}=realFit;
      if(realFit.status!=='done')return{status:realFit.status,error:realFit.error};
      const same=()=>base.every((v,i)=>v===mesh.getVerticesData('position')[i]);
      const initialSame=same(),materialSame=mesh.material===realFit.material,uvSame=hash(mesh.getVerticesData('uv'))===realFit.uv,indicesSame=hash(mesh.getIndices())===realFit.indices;
      const binding=body.skinDrive;
      const {sourcePointToCanonical}=await import('/src/anatomy/binding/anatomySkinDrive.ts');
      const drive=body.drive.drive,correspondence=drive.correspondence, worst=[];
      for(let v=0;v<correspondence.distance.length;v++) {
        if(worst.length===3 && correspondence.distance[v]<=worst[2].mm/1000)continue;
        const t=correspondence.triangle[v],ids=drive.baselineIndices;
        worst.push({original:sourcePointToCanonical(drive.source.frame,...Array.from(drive.source.restPositions.subarray(v*3,v*3+3))),mm:correspondence.distance[v]*1000,source:Array.from(drive.source.analysisPositions.subarray(v*3,v*3+3)),target:[0,1,2].map(k=>[0,1,2].reduce((sum,j)=>sum+drive.baselineSurface[ids[t*3+j]*3+k]*correspondence.weights[v*3+j],0))});
        worst.sort((a,b)=>b.mm-a.mm);worst.length=Math.min(3,worst.length);
      }
      body.setGrowth('rectus_abdominis',2.2);body.commit();await body.ready();
      const moved=body.skinDrive;
      body.resetSkinDrive();
      const restored=same();
      // Re-fitting starts from the original snapshot, not the previously edited skin.
      body.detachSkinDrive();body.setGrowth('rectus_abdominis',1);body.commit();await body.ready();
      return{status:'PASS',worst,boneParameters:body.parameters.boneLengthsCm,fitMs:realFit.fitMs,initialSame,materialSame,uvSame,indicesSame,restored,binding,moved,evidence:body.fitEvidence,height:body.parameters.height,fat:body.parameters.fat};
    });
    assert.equal(result.status,'PASS',result.error);
    for(const key of ['initialSame','materialSame','uvSame','indicesSame','restored'])assert.equal(result[key],true,key);
    assert.equal(result.height,175);assert.equal(result.fat,16);assert.ok(result.binding.bound);
    assert.ok(result.moved.movedVertices>0,'Real imported vertices respond to rectus growth');
    if(jointHints && !source.rigged)assert.equal(result.evidence.pose.method,'joint-hints');
    if(jointHints)assert.deepEqual(result.boneParameters,result.evidence.boneLengthsCm);
    if(result.evidence.trunkFit){const trunk=result.evidence.trunkFit;assert.ok(trunk.finalMm<=trunk.initialMm+.001);assert.ok(trunk.validationAfterMm<=trunk.validationBeforeMm+.25);assert.ok(trunk.attachmentMaxMm<2);}
    if(jointHints) {
      const bones=await page.evaluate(async()=>{
        const {body,entity,mesh,base}=realFit;
        body.patch({bonesOpacity:1});await body.ready();
        const humerus=()=>entity.meshes.find(m=>m.metadata?.anatomicalName==='humerus_L');
        const before=new Float32Array(humerus().getVerticesData('position')),lengths=structuredClone(body.parameters.boneLengthsCm);
        body.patch({boneLengthsCm:{...lengths,upperArm_L:lengths.upperArm_L+4}});await body.ready();
        const changed=humerus().getVerticesData('position').some((v,i)=>Math.abs(v-before[i])>1e-5);
        body.patch({boneLengthsCm:lengths,bonesOpacity:0});await body.ready();body.resetSkinDrive();
        return{changed,restored:base.every((v,i)=>v===mesh.getVerticesData('position')[i])};
      });
      assert.deepEqual(bones,{changed:true,restored:true});console.log(JSON.stringify({proceduralBones:'PASS',...bones}));
    }
    console.log(JSON.stringify({jointHints,source,...result}));
  }
  if(!process.env.INVERSE_TRUNK_ONLY) {
  await page.evaluate(()=>{
    const {editor,entity,body}=realFit;editor.rigger.cancel();editor.select(entity);body.region='overview';anatomyTest.ui.openPart('objects','anatomy');
  });
  await page.getByText('Parameters and comparison',{exact:true}).click();
  await page.getByText('Use current height as fitting hint',{exact:true}).click();
  await page.getByText('Keep current fat as fitting hint',{exact:true}).click();
  await page.getByRole('combobox',{name:'Target surface',exact:true}).selectOption('skin');
  await page.getByRole('button',{name:'Adapt anatomy to model',exact:true}).click();
  await page.waitForFunction(()=>realFit.body.skinDrive?.bound && !realFit.body.busy,{},{timeout:180000});
  const uiFit=await page.evaluate(()=>({bound:realFit.body.skinDrive.bound,fat:realFit.body.parameters.fat,height:realFit.body.parameters.height,identity:realFit.base.every((v,i)=>v===realFit.mesh.getVerticesData('position')[i])}));
  assert.deepEqual(uiFit,{bound:true,fat:16,height:175,identity:true});
  console.log(JSON.stringify({nativeUi:'PASS',...uiFit}));
  }
  if(process.env.ANATOMY_SCREENSHOTS && !process.env.INVERSE_TRUNK_ONLY) {
    await page.evaluate(()=>{
      const{editor,entity,target,body}=realFit;entity.root.setEnabled(false);editor.select(null);document.body.classList.add('ui-hidden');document.querySelector('#test').hidden=true;document.querySelector('#result').hidden=true;
      editor.focus(target);editor.camera.alpha=Math.PI/2+body.drive.drive.source.frame.yaw;editor.camera.beta=Math.PI/2;editor.invalidate();
    });
    await page.waitForTimeout(300);await page.screenshot({path:process.env.ANATOMY_SCREENSHOTS+'/inverse-original.png'});
    await page.evaluate(async()=>{
      const{editor,target,mesh,body}=realFit,source=body.drive.drive.source;
      const preview=mesh.clone('Neutral measurement copy');preview.makeGeometryUnique();preview.parent=null;preview.position.setAll(0);preview.rotation.setAll(0);preview.rotationQuaternion=null;preview.scaling.setAll(1);preview.skeleton=null;
      preview.setVerticesData('position',source.analysisPositions,true);
      const{computeSmoothNormals}=await import('/src/anatomy/binding/skinCorrespondence.ts');const normals=new Float32Array(source.analysisPositions.length);computeSmoothNormals(source.analysisPositions,source.indices,normals);preview.setVerticesData('normal',normals,true);preview.refreshBoundingInfo(true);
      target.root.setEnabled(false);preview.setEnabled(true);editor.focus({...target,root:preview,meshes:[preview]});editor.camera.alpha=Math.PI/2;editor.camera.beta=Math.PI/2;editor.invalidate();
    });
    await page.waitForTimeout(300);await page.screenshot({path:process.env.ANATOMY_SCREENSHOTS+'/inverse-neutral-analysis.png'});
  }
  assert.deepEqual(errors,[]);
  await page.setViewportSize({width:375,height:812});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
} finally { await browser.close(); }
