// Actual Babylon bones, animation tracks and GLB export: helpers must survive outside the editor.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { Animation, AnimationGroup, Color3, Mesh, MorphTarget, MorphTargetManager, NullEngine, Quaternion, Scene, StandardMaterial, TransformNode, VertexData } from '@babylonjs/core';
import { GLTF2Export } from '@babylonjs/serializers/glTF/2.0/glTFSerializer.js';
const modules=new Map();
function moduleUrl(url) {
  if(modules.has(url.href)) return modules.get(url.href);
  let source=ts.transpileModule(fs.readFileSync(url,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}}).outputText;
  source=source.replaceAll('import.meta.env.BASE_URL', JSON.stringify('/'));
  source=source.replace(/from ['"]([^'"]+)['"]/g,(_,name)=>`from ${JSON.stringify(name.startsWith('.')?moduleUrl(new URL(name+'.ts',url)):import.meta.resolve(name))}`);
  const encoded=`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  modules.set(url.href,encoded); return encoded;
}
const {Rigger,updateHelperBones,addHelperBoneTracks}=await import(moduleUrl(new URL('../src/rigging.ts',import.meta.url)));
const {RIG_TEMPLATE,TIP_JOINTS}=await import(moduleUrl(new URL('../src/humanoidTemplate.ts',import.meta.url)));
const engine=new NullEngine(), scene=new Scene(engine);
function entity(id) {
  const root=new Mesh(`root${id}`,scene),fit=new TransformNode(`fit${id}`,scene),mesh=new Mesh(`mesh${id}`,scene);
  fit.parent=root;mesh.parent=fit;
  const geometry=VertexData.CreateBox({size:.2});geometry.applyToMesh(mesh);
  return {id,name:'character',kind:'model',root,meshes:[mesh],animationGroups:[],visible:true};
}
const editor={scene,entities:[],pose:{stop(){}},refreshShadowCasters(){},refreshTool(){},notify(){},invalidate(){}};
const rigger=new Rigger(editor), original=entity(1);
const {Vector3}=await import('@babylonjs/core');
const positions=new Map(RIG_TEMPLATE.map(j=>[j.id,Vector3.FromArray(j.pos)]));
const state=rigger.build(original,positions,undefined,'helper');original.rig=state;
assert.equal(state.helpers.length,2);
assert.equal(state.skeleton.bones.length,RIG_TEMPLATE.length-TIP_JOINTS.length+2);
const support=state.helpers[0],base=state.skeleton.bones.length-2;
updateHelperBones(state);
const point=new Vector3(.1,1.2,.1);
// Rest skin matrix of every bone, including appended helpers, must leave geometry unchanged.
for(const bone of state.skeleton.bones) {
  const skin=bone.getAbsoluteInverseBindMatrix().multiply(bone.getTransformNode().computeWorldMatrix(true));
  assert.ok(Vector3.Distance(point,Vector3.TransformCoordinates(point,skin))<1e-6);
}
support.driver.rotationQuaternion=Quaternion.RotationAxis(Vector3.Forward(),Math.PI/2);
updateHelperBones(state);
assert.ok(Math.abs(Quaternion.Dot(support.node.rotationQuaternion,Quaternion.RotationAxis(Vector3.Forward(),Math.PI/4)))>1-1e-6);
const animation=new Animation('arm','rotationQuaternion',30,Animation.ANIMATIONTYPE_QUATERNION);
animation.setKeys([{frame:0,value:Quaternion.Identity()},{frame:30,value:Quaternion.RotationAxis(Vector3.Forward(),Math.PI/2)}]);
const group=new AnimationGroup('arm movement',scene);group.addTargetedAnimation(animation,support.driver);
addHelperBoneTracks(original,group);
const track=group.targetedAnimations.find(t=>t.target===support.node).animation;
assert.ok(Math.abs(Quaternion.Dot(track.evaluate(15),Quaternion.RotationAxis(Vector3.Forward(),Math.PI/8)))>1-1e-6);
const n=original.meshes[0].getTotalVertices(),indices=new Float32Array(n*4),weights=new Float32Array(n*4);
for(let i=0;i<n;i++) {indices[i*4]=base;weights[i*4]=1;}
rigger.applyWeights(state,{indices,weights});state.data.comparison='shared-test-group';
const saved=rigger.serialize(original),restored=entity(2);
rigger.restore(restored,JSON.parse(JSON.stringify(saved.data)),saved.weights);
assert.equal(restored.rig.helpers.length,2);
assert.equal(restored.rig.data.treatment,'helper');
assert.equal(restored.rig.data.comparison,'shared-test-group');
assert.equal(restored.meshes[0].getVerticesData('matricesIndices')[0],base);
rigger.treatment='helper';
const legacy=entity(3),legacyWeights=new Uint8Array(n*8);
for(let i=0;i<n;i++) legacyWeights[i*8+1]=255;
rigger.restore(legacy,{...saved.data,treatment:undefined,comparison:undefined},legacyWeights);
assert.equal(legacy.rig.helpers.length,0,'Old projects must retain the current strategy regardless of the last UI choice');
const independent=entity(4);rigger.copy(original,independent);
assert.equal(independent.rig.helpers.length,2);
assert.equal(independent.rig.data.comparison,undefined,'A regular duplicate must not join the test group');
const file=await GLTF2Export.GLBAsync(scene,'helper-test');
const bytes=Buffer.from(await file.glTFFiles['helper-test.glb'].arrayBuffer());
const jsonLength=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+jsonLength).toString());
const helpers=json.nodes.flatMap((node,index)=>node.name?.startsWith('deform_support.')?[index]:[]);
assert.ok(helpers.length>=2);
assert.ok(json.skins.some(s=>helpers.some(index=>s.joints.includes(index))),'GLB skin must include support bones');
assert.ok(json.animations.some(a=>a.channels.some(c=>helpers.includes(c.target.node)&&c.target.path==='rotation')),'GLB animation must include support rotations');
globalThis.matchMedia=()=>({matches:false});
const {Editor}=await import(moduleUrl(new URL('../src/editor.ts',import.meta.url)));
const actualExport=GLTF2Export.GLBAsync;
let filteredFile;
GLTF2Export.GLBAsync=async (...args)=>{
  filteredFile=await actualExport(...args);filteredFile.downloadFiles=()=>{};return filteredFile;
};
original.visible=false;original.meshes.forEach(m=>m.isVisible=false);
try {
  await Editor.prototype.exportGLB.call({scene,entities:[original,restored,legacy,independent],helpers:new Set(),overlays:new Set(),
    pose:{ikTarget:new TransformNode('ikTarget',scene)},rigger:{handle:new TransformNode('rigHandle',scene),difference:rigger.difference}});
} finally {GLTF2Export.GLBAsync=actualExport;}
const filteredBytes=Buffer.from(await filteredFile.glTFFiles['scene.glb'].arrayBuffer());
const filtered=JSON.parse(filteredBytes.subarray(20,20+filteredBytes.readUInt32LE(12)).toString());
assert.ok(!filtered.nodes.some(n=>['root1','fit1','mesh1'].includes(n.name)),'Hidden originals and descendants must not reappear in comparison exports');
assert.ok(filtered.nodes.some(n=>n.name==='mesh2'),'Visible comparison copies must remain exportable');
// Temporary diagnostic materials must not leak into saves, material editing or export.
const originalMaterial=new StandardMaterial('original surface',scene);
legacy.meshes[0].material=originalMaterial;independent.meshes[0].material=originalMaterial;
legacy.rig.data.comparison=independent.rig.data.comparison='difference-test';
editor.entities=[legacy,independent];
independent.root.position.x=100; // Layout offsets must not become deformation differences.
independent.rig.helpers[0].driver.rotationQuaternion=Quaternion.RotationAxis(Vector3.Forward(),Math.PI/2);
rigger.difference.show(editor.entities,.5,[Color3.Blue(),Color3.Yellow(),Color3.Red()]);
assert.equal(rigger.difference.summaries[0].maximum,0);
assert.ok(rigger.difference.summaries[1].maximum>0 && rigger.difference.summaries[1].maximum<1000);
assert.equal(rigger.difference.materialOf(legacy.meshes[0]),originalMaterial);
assert.deepEqual(Editor.prototype.materialsOf.call({rigger},legacy),[originalMaterial]);
assert.ok(independent.meshes[0].getVerticesData('rigDifference').some(v=>v>0));
rigger.difference.clear();
assert.equal(legacy.meshes[0].material,originalMaterial);
assert.equal(independent.meshes[0].getVerticesData('rigDifference'),null);
assert.equal(rigger.difference.group,null);
rigger.difference.show(editor.entities,.5,[Color3.Blue(),Color3.Yellow(),Color3.Red()]);
independent.rig.joints.get('leftLowerArm').rotationQuaternion=Quaternion.RotationAxis(Vector3.Forward(),Math.PI/3);
rigger.updateHelpers();
assert.equal(rigger.difference.group,null,'Moving a joint must invalidate the diagnostic snapshot');
assert.equal(independent.meshes[0].material,originalMaterial);
// Active morphs are part of final deformation, and changing their influence invalidates it.
const morph=new MorphTarget('shape',1,scene),manager=new MorphTargetManager(scene);
const morphPositions=Float32Array.from(legacy.meshes[0].getVerticesData('position'));
for(let i=0;i<morphPositions.length;i+=3)morphPositions[i]+=.1;
morph.setPositions(morphPositions);manager.addTarget(morph);legacy.meshes[0].morphTargetManager=manager;
rigger.difference.show(editor.entities,.5,[Color3.Blue(),Color3.Yellow(),Color3.Red()]);
const morphedMean=rigger.difference.summaries[1].mean;
morph.influence=0;rigger.updateHelpers();
assert.equal(rigger.difference.group,null,'Changing morph influence must invalidate the map');
rigger.difference.show(editor.entities,.5,[Color3.Blue(),Color3.Yellow(),Color3.Red()]);
assert.ok(Math.abs(rigger.difference.summaries[1].mean-morphedMean)>.1,'The diagnostic must measure active morph deformation');
rigger.difference.clear();
console.log('Helper bones: rest matrices, half rotation, baked clip, saved weights and GLB skin/animation pass');
engine.dispose();
