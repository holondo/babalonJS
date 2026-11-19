import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
let playwright;try{playwright=require('playwright')}catch{playwright=require(process.env.PLAYWRIGHT_MODULE)}
const [url,file]=process.argv.slice(2);assert.ok(url&&file,'Pass dev URL and humanoid GLB');
const browser=await playwright.chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1100,height:820}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
try{
  await page.addInitScript(()=>{window.requestAnimationFrame=cb=>setTimeout(()=>cb(performance.now()),16)});
  await page.goto(url+'/scripts/fixtures/anatomy-priority.html');await page.waitForFunction(()=>window.anatomyTest);
  await page.evaluate(async()=>{const{editor,ui}=anatomyTest,e=await editor.addAnatomy();editor.select(e);ui.openPart('objects','anatomy-fit');window.fitUX={editor,ui,entity:e,body:e.anatomyBody};});
  await page.getByRole('tab',{name:'From a model',exact:true}).click();
  await page.locator('input[type=file][accept=".glb"]').setInputFiles(file);
  await page.waitForFunction(()=>anatomyTest.editor.entities.some(e=>!e.anatomy&&e.kind==='model')&&anatomyTest.editor.selected?.anatomyBody,{},{timeout:60000});
  if(!process.env.SKIP_JOINT_REVIEW){
    await page.getByRole('button',{name:'Review joint hints',exact:true}).click();await page.waitForFunction(()=>anatomyTest.editor.rigger.fittingSession);
    const edited=await page.evaluate(()=>{const r=anatomyTest.editor.rigger,j=r.joints.get('leftHand');j.x+=.002;r.refreshPlacement();return j.asArray();});
    await page.getByRole('button',{name:'Use joint hints and return',exact:true}).first().click();
    await page.waitForFunction(()=>anatomyTest.editor.selected?.anatomyBody&&!anatomyTest.editor.rigger.active);
    await page.getByRole('button',{name:'Review joint hints',exact:true}).click();await page.waitForFunction(()=>anatomyTest.editor.rigger.fittingSession);
    const restored=await page.evaluate(()=>anatomyTest.editor.rigger.joints.get('leftHand').asArray());assert.ok(restored.every((v,i)=>Math.abs(v-edited[i])<1e-6));
    await page.getByRole('button',{name:'Use joint hints and return',exact:true}).first().click();
  }
  await page.evaluate(()=>{
    const{editor,body}=fitUX,target=editor.entities.find(e=>!e.anatomy&&e.kind==='model'),mesh=[...target.meshes].sort((a,b)=>b.getTotalVertices()-a.getTotalVertices())[0];
    Object.assign(fitUX,{target,mesh,original:new Float32Array(mesh.getVerticesData('position')),progress:[],fitCalls:0});
    const adapt=body.adaptToTargetMesh.bind(body);
    body.adaptToTargetMesh=opts=>{fitUX.fitCalls++;fitUX.done=false;fitUX.started=performance.now();return adapt({...opts,onProgress:(stage,fraction)=>{fitUX.progress.push({stage,fraction});opts.onProgress?.(stage,fraction);}}).then(result=>{fitUX.done=true;fitUX.elapsed=performance.now()-fitUX.started;return result;}).catch(e=>{fitUX.error=e.stack;fitUX.done=true;throw e;});};
  });
  if(process.env.TISSUE_HINTS){
    console.log('Marking representative surface points through the canvas');
    const points=await page.evaluate(async()=>{
      const{editor,target,mesh}=fitUX;editor.rigger.start(target);editor.rigger.findPose();editor.rigger.frontView();
      const{collectBodyHints}=await import('/src/anatomy/integration/bodyHints.ts'),{fitAnatomyToHumanoid}=await import('/src/anatomy/fitBody.ts'),{sourcePointToCanonical}=await import('/src/anatomy/binding/anatomySkinDrive.ts'),{Vector3}=await import('/node_modules/@babylonjs/core/Maths/math.vector.js');
      const hints=collectBodyHints(editor,target,mesh),a=fitAnatomyToHumanoid(new Float32Array(mesh.getVerticesData('position')),hints).analysis,frame={yaw:a.yawCorrection,forwardSign:a.forwardSign,scale:a.scaleCorrection,offset:a.offsetCorrection};
      fitUX.expectedForward=Vector3.TransformNormal(new Vector3(...hints.forward),mesh.computeWorldMatrix(true)).normalize().asArray();editor.rigger.cancel();editor.select(fitUX.entity);fitUX.ui.openPart('objects','anatomy-fit');
      const desired={nipple_L:[-.095,1.31],nipple_R:[.095,1.31],navel:[0,1.075],inguinal_L_inner:[-.03,.88],inguinal_L_middle:[-.085,.94],inguinal_L_outer:[-.145,.99],inguinal_R_inner:[.03,.88],inguinal_R_middle:[.085,.94],inguinal_R_outer:[.145,.99]},out={},positions=mesh.getVerticesData('position');
      for(const[name,[x,y]]of Object.entries(desired)){let best=Infinity,point;for(let i=0;i<positions.length;i+=3){const q=sourcePointToCanonical(frame,positions[i],positions[i+1],positions[i+2]);if(q[2]<.02)continue;const d=(q[0]-x)**2+(q[1]-y)**2;if(d<best){best=d;point=[positions[i],positions[i+1],positions[i+2]];}}out[name]=point;}
      return out;
    });
    await page.waitForTimeout(900);
    const labels={nipple_L:'Left nipple',nipple_R:'Right nipple',navel:'Navel',inguinal_L_inner:'Left inguinal fold: inner end',inguinal_L_middle:'Left inguinal fold: middle',inguinal_L_outer:'Left inguinal fold: outer end',inguinal_R_inner:'Right inguinal fold: inner end',inguinal_R_middle:'Right inguinal fold: middle',inguinal_R_outer:'Right inguinal fold: outer end'};
    for(const[name,point]of Object.entries(points)){
      await page.getByRole('button',{name:labels[name],exact:true}).click();
      const screen=await page.evaluate(async p=>{const{Vector3}=await import('/node_modules/@babylonjs/core/Maths/math.vector.js');return fitUX.editor.toScreen(Vector3.TransformCoordinates(new Vector3(...p),fitUX.mesh.computeWorldMatrix(true)));},point);
      await page.mouse.click(screen.x,screen.y);await page.waitForFunction(key=>!!fitUX.body.state.fitSetup.hints.tissues?.[key],name);
    }
    assert.equal(await page.evaluate(()=>Object.keys(fitUX.body.state.fitSetup.hints.tissues).length),9);
  }
  await page.getByLabel('What covers the body?',{exact:true}).selectOption('skin',{force:true});
  await page.getByRole('button',{name:'Fit only',exact:true}).click();
  await page.waitForFunction(()=>fitUX.progress.length>2,{},{timeout:60000});
  await page.waitForFunction(()=>fitUX.done,{},{timeout:180000});
  const result=await page.evaluate(()=>({error:fitUX.error,elapsed:fitUX.elapsed,fitCalls:fitUX.fitCalls,evidence:fitUX.body.fitEvidence,chains:fitUX.body.parameters.referencePose?.chains.length,referencePoseEnabled:fitUX.body.parameters.referencePose?.enabled,sourcePreserved:fitUX.original.every((v,i)=>v===fitUX.mesh.getVerticesData('position')[i]),skinBound:!!fitUX.body.skinDrive?.bound}));
  assert.equal(result.error,undefined);assert.ok(result.sourcePreserved);assert.equal(result.skinBound,false);assert.equal(result.chains,4);assert.ok(result.referencePoseEnabled);
  assert.equal(result.fitCalls,1);assert.ok(result.evidence.volumeFit?.reusedReferenceSurface);
  assert.ok(result.evidence.surfaceRegistration.afterMm<result.evidence.surfaceRegistration.beforeMm*.8);assert.ok(result.evidence.surfaceRegistration.minJacobian>.19);
  if(process.env.REFINE_VOLUMES){
    await page.getByRole('tab',{name:'From a model',exact:true}).click();
    const measureRectus=async()=>page.evaluate(async()=>{
      const {generateAnatomy}=await import('/src/anatomy/generation.ts'),p=fitUX.body.parameters;
      const meshes=generateAnatomy(p,['rectusAbdominis']).meshes.rectusAbdominis;
      return [1.06,1.10,1.14].map(y=>{
        let left=Infinity,right=-Infinity;
        for(const mesh of meshes)for(let i=0;i<mesh.positions.length;i+=3){
          if(Math.abs(mesh.positions[i+1]*1.8/17.5-y)>.018)continue;
          const x=mesh.positions[i]*18000/p.height;
          left=Math.min(left,x);right=Math.max(right,x);
        }
        return Number.isFinite(right-left)?right-left:null;
      });
    });
    const beforeRectus=process.env.FIT_PROFILE_DIAGNOSTICS?await measureRectus():undefined;
    await page.evaluate(async()=>{const{generateAnatomy}=await import('/src/anatomy/generation.ts');fitUX.fixedBones=generateAnatomy(fitUX.body.parameters,['bones']).meshes.bones.map(m=>Array.from(m.positions));fitUX.fixedPose=JSON.stringify(fitUX.body.parameters.referencePose);fitUX.fixedRoot=Array.from(fitUX.entity.root.computeWorldMatrix(true).m);});
    await page.evaluate(()=>{fitUX.done=false;});await page.getByRole('button',{name:'Refine muscles and fat',exact:true}).click();await page.waitForFunction(()=>fitUX.done,{},{timeout:180000});
    const volumes=await page.evaluate(async()=>{const{generateAnatomy}=await import('/src/anatomy/generation.ts'),bones=generateAnatomy(fitUX.body.parameters,['bones']).meshes.bones;return{error:fitUX.error,evidence:fitUX.body.fitEvidence.volumeFit,bonesIdentical:bones.length===fitUX.fixedBones.length&&bones.every((m,j)=>m.positions.every((v,i)=>v===fitUX.fixedBones[j][i])),poseIdentical:JSON.stringify(fitUX.body.parameters.referencePose)===fitUX.fixedPose,rootIdentical:Array.from(fitUX.entity.root.computeWorldMatrix(true).m).every((v,i)=>v===fitUX.fixedRoot[i]),elapsed:fitUX.elapsed};});
    assert.equal(volumes.error,undefined);assert.ok(volumes.bonesIdentical&&volumes.poseIdentical&&volumes.rootIdentical,'refinement preserves the skeleton');assert.ok(volumes.evidence.muscles>=8);assert.ok(volumes.evidence.skin.validationAfterMm<volumes.evidence.skin.validationBeforeMm*.9);console.log(JSON.stringify({volumes:'PASS',...volumes,evidence:{...volumes.evidence,profiles:Object.fromEntries(Object.entries(volumes.evidence.profiles).map(([id,p])=>[id,{min:Math.min(...p),max:Math.max(...p)}]))}}));
    if(beforeRectus)console.log(JSON.stringify({rectusWidthMm:{before:beforeRectus,after:await measureRectus()}}));
  }
  if(process.env.TISSUE_HINTS){
    const checks=await page.evaluate(async()=>{
      const{generateAnatomy}=await import('/src/anatomy/generation.ts'),{Vector3}=await import('/node_modules/@babylonjs/core/Maths/math.vector.js'),p=fitUX.body.parameters;
      const layers=['bones','rectusAbdominis','inguinalLigaments'],original=generateAnatomy({...p,tissueFit:undefined},layers),fitted=generateAnatomy(p,layers);
      const equal=key=>original.meshes[key].every((m,j)=>m.positions.every((v,i)=>v===fitted.meshes[key][j].positions[i]));
      const forward=Vector3.TransformNormal(Vector3.Forward(),fitUX.entity.root.computeWorldMatrix(true)).normalize();
      return{bonesIdentical:equal('bones'),ligamentsIdentical:equal('inguinalLigaments'),forwardDot:Vector3.Dot(forward,new Vector3(...fitUX.expectedForward)),evidence:fitUX.body.fitEvidence.tissueFit};
    });
    assert.ok(checks.bonesIdentical);assert.ok(checks.ligamentsIdentical);assert.ok(checks.forwardDot>.99,'automatic facing survives empty hints');assert.equal(checks.evidence.count,9);assert.ok(checks.evidence.minJacobian>=.25);assert.ok(Math.max(...checks.evidence.afterMm)<Math.max(...checks.evidence.beforeMm));console.log(JSON.stringify({tissues:'PASS',...checks}));
  }
  console.log(JSON.stringify({status:'PASS',...result}));
  if(process.env.SAVE_FIT_PARAMS)writeFileSync(process.env.SAVE_FIT_PARAMS,JSON.stringify(await page.evaluate(()=>({state:fitUX.body.captureState(),position:fitUX.entity.root.position.asArray(),scale:fitUX.entity.root.scaling.asArray(),rotation:fitUX.entity.root.rotationQuaternion.asArray()}))));
  if(process.env.AUDIT_INTERNAL_FIT){
    await page.evaluate(async()=>{fitUX.body.patch({skinFit:undefined});await fitUX.body.ready();});
  }
  if(process.env.ANATOMY_SCREENSHOTS){
    await page.evaluate(()=>{const{editor,body}=fitUX;document.body.classList.add('ui-hidden');document.querySelector('#test').hidden=true;document.querySelector('#result').hidden=true;editor.select(null);body.frame('body');body.view('front');const c=fitUX.mesh.getBoundingInfo().boundingBox.centerWorld;editor.camera.target.x=(fitUX.entity.root.position.x+c.x)/2;editor.camera.target.z=(fitUX.entity.root.position.z+c.z)/2;editor.invalidate();});
    await page.waitForTimeout(1200);await page.evaluate(()=>{fitUX.editor.camera.radius=1.9;fitUX.editor.invalidate();});await page.waitForTimeout(300);
    await page.screenshot({path:process.env.ANATOMY_SCREENSHOTS+'/fit-ux-comparison-skin.png'});
    if(process.env.FIT_PROFILE_DIAGNOSTICS){
      await page.evaluate(()=>{
        const {editor,entity,mesh}=fitUX,skin=entity.meshes.find(m=>m.metadata?.anatomyLayer==='skin');
        const neutral=new mesh.material.constructor('Comparison material',editor.scene);
        neutral.albedoColor=skin.material.albedoColor.clone();neutral.roughness=.75;neutral.metallic=0;
        neutral.backFaceCulling=false;neutral.twoSidedLighting=skin.material.twoSidedLighting;
        fitUX.restoreComparisonMaterial=()=>{mesh.material=fitUX.sourceComparisonMaterial;skin.material=fitUX.skinComparisonMaterial;neutral.dispose();editor.invalidate();};
        fitUX.sourceComparisonMaterial=mesh.material;fitUX.skinComparisonMaterial=skin.material;
        mesh.material=neutral;skin.material=neutral;editor.invalidate();
      });
      await page.waitForTimeout(500);
      await page.screenshot({path:process.env.ANATOMY_SCREENSHOTS+'/fit-ux-comparison-neutral.png'});
      await page.evaluate(()=>fitUX.restoreComparisonMaterial());
    }
    await page.evaluate(async()=>{const{editor,ui,entity,body}=fitUX;editor.select(entity);ui.openPart('objects','anatomy-fit');body.patch({skinOpacity:0,otherMusclesOpacity:1,rectusAbdominisOpacity:1,externalObliqueOpacity:1});await body.ready();editor.select(null);});await page.waitForTimeout(300);
    await page.screenshot({path:process.env.ANATOMY_SCREENSHOTS+'/fit-ux-comparison-muscles.png'});
    await page.evaluate(()=>{const{editor,ui,entity,body}=fitUX;body.patch({skinOpacity:1});document.body.classList.remove('ui-hidden');editor.select(entity);ui.openPart('objects','anatomy-fit');});
  }
  if(process.env.TEST_OUTER_SKIN){
    await page.getByLabel('Fitting goal',{exact:true}).selectOption('skin');await page.evaluate(()=>{fitUX.done=false;fitUX.progress=[]});
    await page.getByRole('button',{name:process.env.REFINE_VOLUMES?'Refine muscles and fat':'Fit body shape',exact:true}).click();await page.waitForFunction(()=>fitUX.done,{},{timeout:180000});
    if(process.env.TEST_DRAG_PREVIEW){
      const preview=await page.evaluate(async()=>{
        const {body,mesh,entity}=fitUX;
        const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        body.patch({rectusAbdominisOpacity:1});await body.ready();
        const layers=[...entity.meshes];
        body.setGrowth('rectus_abdominis',1.6);body.commit();await body.ready();
        const procedural=layers.find(m=>m.metadata?.anatomyLayer==='rectusAbdominis');
        const before=new Float32Array(procedural.getVerticesData('position')),outer=new Float32Array(mesh.getVerticesData('position'));
        const generation=body.computeMs,dragStart=performance.now();
        body.setGrowth('rectus_abdominis',1.85);await frame();
        const latency=performance.now()-dragStart;
        const proceduralMoved=before.some((v,i)=>v!==procedural.getVerticesData('position')[i]);
        const outerMoved=outer.some((v,i)=>v!==mesh.getVerticesData('position')[i]);
        const cached=body.computeMs===generation,previewMs=body.previewMs,skinPreviewMs=body.skinPreviewMs;
        const firstBytes=body.skinPreviewBytes;
        await new Promise(resolve=>setTimeout(resolve,60));
        body.setGrowth('rectus_abdominis',1.95);await frame();
        const steadyBytes=body.skinPreviewBytes,steadySkinMs=body.skinPreviewMs;
        const release=performance.now();body.commit();await body.ready();
        return {proceduralMoved,outerMoved,cached,latency,previewMs,skinPreviewMs,firstBytes,steadyBytes,steadySkinMs,releaseMs:performance.now()-release,computeMs:body.computeMs,applyMs:body.applyMs,skinExactMs:body.skinDrive.lastUpdateMs,reused:layers.every((layer,i)=>layer===entity.meshes[i])};
      });
      assert.ok(preview.proceduralMoved&&preview.outerMoved&&preview.cached&&preview.reused,JSON.stringify(preview));
      console.log(JSON.stringify({dragPreview:'PASS',...preview}));
      await page.evaluate(()=>{fitUX.body.setGrowth('rectus_abdominis',1,true);});
      await page.evaluate(()=>fitUX.body.ready());
    }
    const outer=await page.evaluate(async()=>{const{body,mesh,original}=fitUX;const preserved=original.every((v,i)=>v===mesh.getVerticesData('position')[i]);body.setGrowth('rectus_abdominis',2.2);body.commit();await body.ready();const moved=body.skinDrive;body.resetSkinDrive();return{error:fitUX.error,bound:body.skinDrive?.bound,preserved,movedVertices:moved.movedVertices,reset:original.every((v,i)=>v===mesh.getVerticesData('position')[i]),hiddenProceduralSkin:body.parameters.skinOpacity===0};});
    assert.equal(outer.error,undefined);assert.ok(outer.bound&&outer.preserved&&outer.reset&&outer.hiddenProceduralSkin&&outer.movedVertices>0);console.log(JSON.stringify({outerSkin:'PASS',...outer}));
  }
  await page.setViewportSize({width:375,height:812});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(process.env.TISSUE_HINTS){await page.getByRole('button',{name:'Navel ✓',exact:true}).click();assert.ok(await page.getByRole('button',{name:'Cancel',exact:true}).isVisible());await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await page.evaluate(()=>Object.keys(fitUX.body.state.fitSetup.hints.tissues).length),9);}
  assert.ok(await page.evaluate(()=>anatomyTest.ui.panel.scrollWidth<=anatomyTest.ui.panel.clientWidth+1));
  assert.deepEqual(errors,[]);console.log('PASS: phone layout, landmark cancellation and browser errors');
  if (process.env.TEST_ABDOMEN_PROFILE) {
    const reopened = await page.evaluate(async () => {
      const { snapshot, toZip, fromZip, restore } = await import('/src/core/project.ts');
      const { editor, body } = fitUX;
      const profiles = p => ['L', 'R'].map(side => p.definition?.muscles[`rectus_abdominis.${side}`]?.fittedWidthProfile);
      const before = profiles(body.parameters);
      const snap = snapshot(editor, 'Abdominal profile');
      snap.json.entities = snap.json.entities.filter(entity => entity.anatomy);
      snap.json.assets = [];
      snap.files = {};
      const missing = await restore(editor, await fromZip(await toZip(snap)));
      const anatomy = editor.entities.find(entity => entity.anatomyBody);
      await anatomy.anatomyBody.ready();
      return { before, after: profiles(anatomy.anatomyBody.parameters), missing, sourceRemoved: editor.entities.every(entity => entity.kind !== 'model' || entity.anatomyBody) };
    });
    assert.ok(reopened.before.every(profile => profile?.length === 5 && profile.every(Number.isFinite)));
    assert.deepEqual(reopened.after, reopened.before);
    assert.deepEqual(reopened.missing, []);
    assert.ok(reopened.sourceRemoved);
    console.log(JSON.stringify({ abdomenProfileRoundTrip: reopened }));
  }
}catch(error){if(process.env.ANATOMY_SCREENSHOTS)await page.screenshot({path:process.env.ANATOMY_SCREENSHOTS+'/fit-ux-failure.png'});throw error;}finally{await browser.close()}
