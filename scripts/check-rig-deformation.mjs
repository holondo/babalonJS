// Real GLB smoke test for chest/hip leakage while changing only the arm pose.
// node scripts/check-rig-deformation.mjs <meshopt GLB> [heat|envelope]
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import ts from 'typescript';
import { NullEngine, Scene, Mesh, TransformNode, VertexData, Vector3, Matrix } from '@babylonjs/core';
const modules = new Map();
function sourceModule(url) {
  if (modules.has(url.href)) return modules.get(url.href);
  let source = ts.transpileModule(fs.readFileSync(url, 'utf8'), { compilerOptions: {target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext} }).outputText;
  source = source.replace(/from ['"]([^'"]+)['"]/g, (_, name) => `from ${JSON.stringify(name.startsWith('.') ? sourceModule(new URL(name + '.ts', url)) : import.meta.resolve(name))}`);
  const encoded = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  modules.set(url.href, encoded); return encoded;
}
const load = name => import(sourceModule(new URL(`../src/${name}.ts`, import.meta.url)));
const { Rigger, updateShoulderHelpers } = await load('rigging');
const { strongest } = await load('weights');
const { applyBoneDirections, characterFrame, captureJoints, restoreJoints } = await load('pose');
const { worldMatrix } = await load('humanoid');
const { RIG_TEMPLATE, TIP_JOINTS } = await load('humanoidTemplate');
const { POSE_PRESETS } = await load('presets');
const { visibleBoneDistances } = await load('skinVisibility');
const { vertexNormals } = await load('skinMath');
const decoderScope = { WebAssembly, Uint8Array, Int8Array, Uint32Array, Float32Array, console };
decoderScope.self = decoderScope;
vm.runInNewContext(fs.readFileSync(new URL('../node_modules/@babylonjs/core/assets/meshopt/meshopt_decoder.js', import.meta.url),'utf8'), decoderScope);
const decoder = decoderScope.MeshoptDecoder;
await decoder.ready;
const file = fs.readFileSync(process.argv[2]);
const jsonLength = file.readUInt32LE(12);
const json = JSON.parse(file.toString('utf8',20,20+jsonLength));
const bin = file.subarray(28+jsonLength);
function accessor(id, Type) {
  const a = json.accessors[id], view = json.bufferViews[a.bufferView], ext = view.extensions.EXT_meshopt_compression;
  const out = new Uint8Array(view.byteLength);
  decoder.decodeGltfBuffer(out, ext.count, ext.byteStride, bin.subarray(ext.byteOffset,ext.byteOffset+ext.byteLength),ext.mode,ext.filter);
  return new Type(out.buffer);
}
const primitive = json.meshes[0].primitives[0];
const positions = accessor(primitive.attributes.POSITION,Float32Array);
const triangles = accessor(primitive.indices,Uint32Array);
const packedNormals = accessor(primitive.attributes.NORMAL,Int8Array);
const normals = new Float32Array(positions.length);
for(let i=0;i<normals.length/3;i++) for(let k=0;k<3;k++) normals[i*3+k]=Math.max(-1,packedNormals[i*4+k]/127);
const engine = new NullEngine(), scene = new Scene(engine);
const root = new TransformNode('root',scene), fit = new TransformNode('fit',scene), mesh = new Mesh('model',scene);
fit.parent = root; mesh.parent = fit;
const vd = new VertexData(); vd.positions=positions; vd.indices=triangles; vd.normals=normals; vd.applyToMesh(mesh);
const entity = {id:1,name:'model',kind:'model',root,meshes:[mesh],animations:[]};
const editor = {scene,pose:{stop(){}},viewFrom(){},refreshTool(){},refreshShadowCasters(){},notify(){},invalidate(){}};
const rig = new Rigger(editor);
rig.start(entity); rig.findPose();
const state = rig.build(entity,rig.joints);
const input = rig.skinInput(state);
input.comparison = process.argv[4] === 'comparison';
const B = input.bones.length/6;
const armBones = new Set(RIG_TEMPLATE.filter(j=>!TIP_JOINTS.includes(j.id)).flatMap((j,i)=>/Arm|Hand/.test(j.id)?[i]:[]));
const method = process.argv[3] ?? 'heat';
let result;
console.time(method);
const workerModule = sourceModule(new URL('../src/weights.worker.ts',import.meta.url));
const workerSource = `import {parentPort,workerData} from 'node:worker_threads'; globalThis.self={postMessage(m){parentPort.postMessage(m)}}; await import(${JSON.stringify(workerModule)}); self.onmessage({data:workerData});`;
const worker = new Worker(new URL(`data:text/javascript;base64,${Buffer.from(workerSource).toString('base64')}`),{workerData:{...input,method,limit:15000}});
let ticks=0;
const heartbeat=setInterval(()=>ticks++,25);
try {
  result = await new Promise((resolve,reject)=>{
    worker.on('message',m=>{if(m.type==='done')resolve(m);else if(m.type==='error')reject(new Error(m.message));});
    worker.on('error',reject);
  });
} finally {clearInterval(heartbeat); await worker.terminate();}
assert.ok(ticks>1,'The weight worker must keep the calling thread responsive');
console.log('Calling-thread heartbeat ticks',ticks);
console.timeEnd(method);
if (input.comparison) {
  assert.ok(result.variants, 'The worker must produce all shoulder variants from the same solve');
  for (const [name, variant] of Object.entries(result.variants)) {
    const boneCount = B + (name === 'helper' ? 2 : 0);
    let helperVertices = 0, changedVertices = 0;
    for (let i=0; i<variant.weights.length; i+=4) {
      let sum=0, changed=false, helper=false;
      for (let k=0;k<4;k++) {
        const w=variant.weights[i+k], index=variant.indices[i+k];
        assert.ok(Number.isFinite(w) && w>=0 && index>=0 && index<boneCount);
        sum+=w;
        if (index>=B && w>0) helper=true;
        if (index!==result.indices[i+k] || Math.abs(w-result.weights[i+k])>1e-5) changed=true;
      }
      assert.ok(Math.abs(sum-1)<1e-5);
      if(helper) helperVertices++;
      if(changed) changedVertices++;
    }
    if(name==='current') assert.equal(changedVertices,0);
    else assert.ok(changedVertices>0, 'The experimental variant must actually change weights');
    if(name==='helper') assert.ok(helperVertices>0);
    console.log('Variant',name,{changedVertices,helperVertices});
  }

  // Audit the final Babylon skinning, not just the solver output. Each copy receives its
  // own geometry, packed vertex buffers and strategy-specific skeleton exactly as in the app.
  const poses = ['relaxed', 'arms-up', 'wave'];
  const outputs = {};
  for (const [name, variant] of Object.entries(result.variants)) {
    const copyRoot=new TransformNode(`audit-${name}`,scene), copyFit=new TransformNode(`audit-fit-${name}`,scene), copyMesh=new Mesh(`audit-mesh-${name}`,scene);
    copyFit.parent=copyRoot; copyMesh.parent=copyFit;
    const copyData=new VertexData();copyData.positions=positions.slice();copyData.indices=triangles;copyData.normals=normals.slice();copyData.applyToMesh(copyMesh);
    const copy={id:name,name,kind:'model',root:copyRoot,meshes:[copyMesh],animations:[]};
    const st=rig.build(copy,rig.joints,undefined,name);
    rig.applyWeights(st,variant);
    assert.deepEqual(Float32Array.from(copyMesh.getVerticesData('matricesWeights')), variant.weights, 'The mesh must receive its own variant weights');
    const joints=Object.fromEntries([...st.joints].filter(([id])=>!TIP_JOINTS.includes(id)));
    const rest=captureJoints([...st.joints.values()]);
    const localFrame=characterFrame(joints,copyRoot);
    outputs[name]={};
    for (const poseId of poses) {
      restoreJoints(rest);
      const dirs=POSE_PRESETS.find(p=>p.id===poseId).dirs;
      applyBoneDirections(joints,localFrame,Object.fromEntries(Object.entries(dirs).map(([id,d])=>[id,Vector3.FromArray(d).normalize()])));
      updateShoulderHelpers(st);
      for(const n of [...st.joints.values(),...st.helpers.map(h=>h.node)]) worldMatrix(n);
      // Multiple poses are evaluated without rendering; force the linked bone matrices
      // to update rather than reusing Babylon's matrices from the same render frame.
      st.skeleton.prepare(true);
      outputs[name][poseId]=Float32Array.from(copyMesh.getPositionData(true,false));
    }
    st.skeleton.dispose();copyRoot.dispose(false,false);
  }
  for(const name of Object.keys(outputs)) assert.ok(outputs[name]['arms-up'].some((v,i)=>Math.abs(v-outputs[name].relaxed[i])>.001), 'Different poses must not reuse cached skin matrices');
  const auditHips=Vector3.FromArray(state.data.joints.hips),auditNeck=Vector3.FromArray(state.data.joints.neck);
  const auditFrame=characterFrame(Object.fromEntries([...state.joints].filter(([id])=>!TIP_JOINTS.includes(id))),root);
  const auditWidth=Vector3.Distance(Vector3.FromArray(state.data.joints.leftUpperArm),Vector3.FromArray(state.data.joints.rightUpperArm));
  for(const poseId of poses) for(const [left,right] of [['current','protected'],['current','helper'],['protected','helper']]) {
    const a=outputs[left][poseId],b=outputs[right][poseId];
    let maximum=0,sum=0,count=0,above1mm=0,above5mm=0;
    let backMax=0,backSum=0,backCount=0,backAbove1mm=0;
    for(let i=0;i<a.length;i+=3) {
      const d=Math.hypot(a[i]-b[i],a[i+1]-b[i+1],a[i+2]-b[i+2]);
      assert.ok(Number.isFinite(d));maximum=Math.max(maximum,d);sum+=d;count++;
      if(d>.001)above1mm++;if(d>.005)above5mm++;
      const x=input.points[i]-auditHips.x,y=input.points[i+1]-auditHips.y,z=input.points[i+2]-auditHips.z;
      const lateral=Math.abs(x*auditFrame.right.x+y*auditFrame.right.y+z*auditFrame.right.z);
      const height=auditNeck.y-auditHips.y;
      if(lateral>auditWidth*.2 && lateral<auditWidth*.6 && y>height*.15 && y<height*.85 && x*auditFrame.forward.x+y*auditFrame.forward.y+z*auditFrame.forward.z<0) {
        backCount++;backSum+=d;backMax=Math.max(backMax,d);if(d>.001)backAbove1mm++;
      }
    }
    assert.ok(maximum>1e-6, `${poseId}: ${left} and ${right} must produce distinct final geometry`);
    console.log('Final Babylon deformation',poseId,`${left} vs ${right}`,{maxMm:maximum*1000,meanMm:sum/count*1000,verticesAbove1mm:above1mm,verticesAbove5mm:above5mm});
    console.log('Lateral back',poseId,`${left} vs ${right}`,{sampleVertices:backCount,maxMm:backMax*1000,meanMm:backSum/backCount*1000,verticesAbove1mm:backAbove1mm});
  }
}
const skin = result.indices ? result : strongest(result.dense,result.map,B);
const map = Object.fromEntries([...state.joints].filter(([id])=>!TIP_JOINTS.includes(id)));
const frame = characterFrame(map,root);
applyBoneDirections(map,frame,Object.fromEntries(Object.entries(POSE_PRESETS.find(p=>p.id==='relaxed').dirs).filter(([id])=>/Arm/.test(id)).map(([id,d])=>[id,Vector3.FromArray(d)])));
const boneMatrices = state.skeleton.bones.map(b=>{
  const node=b.getTransformNode();
  const id=[...state.joints].find(([,n])=>n===node)[0];
  const p=state.data.joints[id];
  return Matrix.Translation(-p[0],-p[1],-p[2]).multiply(worldMatrix(node));
});
const hips=Vector3.FromArray(state.data.joints.hips), chest=Vector3.FromArray(state.data.joints.chest), neck=Vector3.FromArray(state.data.joints.neck);
const shoulderWidth = Vector3.Distance(Vector3.FromArray(state.data.joints.leftUpperArm),Vector3.FromArray(state.data.joints.rightUpperArm));
const regions = {chest:{n:0,maxArm:0,meanArm:0,maxMovement:0,meanMovement:0},pelvis:{n:0,maxArm:0,meanArm:0,maxMovement:0,meanMovement:0}};
const distances = new Float64Array(B), sourceCounts = {};
const surfaceNormals = vertexNormals(input.points,input.triangles);
const distanceAt = visibleBoneDistances(input.points,input.triangles);
const p=new Vector3(), q=new Vector3(), moved=new Vector3();
for(let i=0;i<input.points.length/3;i++) {
  p.copyFromFloats(input.points[i*3],input.points[i*3+1],input.points[i*3+2]);
  const lateral=Math.abs(Vector3.Dot(p.subtract(hips),frame.right));
  const region = lateral < shoulderWidth*.32 && p.y>chest.y && p.y<neck.y-.03 ? regions.chest : lateral<shoulderWidth*.32 && Math.abs(p.y-hips.y)<.035 ? regions.pelvis : null;
  if(!region) continue;
  if(region===regions.chest && region.n%400===0) {
    distanceAt(p.x,p.y,p.z,surfaceNormals[i*3],surfaceNormals[i*3+1],surfaceNormals[i*3+2],input.bones,input.limbRoots,distances);
    let closest=0;for(let b=1;b<B;b++) if(distances[b]<distances[closest]) closest=b;
    const name=state.skeleton.bones[closest].name;
    sourceCounts[name]=(sourceCounts[name]??0)+1;
  }
  moved.setAll(0); let arm=0;
  for(let k=0;k<4;k++) {
    const b=skin.indices[i*4+k], w=skin.weights[i*4+k];
    if(armBones.has(b)) arm+=w;
    Vector3.TransformCoordinatesToRef(p,boneMatrices[b],q); moved.addInPlace(q.scaleInPlace(w));
  }
  const movement=Vector3.Distance(p,moved);
  region.n++; region.maxArm=Math.max(region.maxArm,arm);region.meanArm+=arm;
  region.maxMovement=Math.max(region.maxMovement,movement);region.meanMovement+=movement;
}
for(const [name,r] of Object.entries(regions)) console.log(name,{vertices:r.n,maxArmPercent:r.maxArm*100,meanArmPercent:r.meanArm/r.n*100,maxMovementMm:r.maxMovement*1000,meanMovementMm:r.meanMovement/r.n*1000});
console.log('Nearest chest bones',sourceCounts);
engine.dispose();
assert.ok(regions.chest.maxArm < .01, 'Arm diffusion must not move the central chest');
assert.ok(regions.chest.maxMovement < .005, 'Lowering only the arms must preserve the central chest within 5 mm');
assert.ok(regions.pelvis.maxArm < .01, 'The A-pose pelvis must remain isolated from the arms');
