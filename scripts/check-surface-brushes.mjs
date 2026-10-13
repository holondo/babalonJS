// Regression: skinned multi-part surfaces must be picked and edited where the GPU displays them.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import ts from 'typescript';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine.js';
import {Scene} from '@babylonjs/core/scene.js';
import {ArcRotateCamera} from '@babylonjs/core/Cameras/arcRotateCamera.js';
import {Vector3,Matrix} from '@babylonjs/core/Maths/math.vector.js';
import {CreateSphere} from '@babylonjs/core/Meshes/Builders/sphereBuilder.js';
import {Skeleton} from '@babylonjs/core/Bones/skeleton.js';
import {Bone} from '@babylonjs/core/Bones/bone.js';
import '@babylonjs/core/Culling/ray.js';
const require=createRequire(import.meta.url),urls=new Map();
function moduleURL(filename){
 filename=path.resolve(filename);if(urls.has(filename))return urls.get(filename);
 let code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}}).outputText;
 code=code.replace(/from ['"]([^'"]+)['"]/g,(_,id)=>`from '${id.startsWith('.')?moduleURL(path.resolve(path.dirname(filename),id+'.ts')):pathToFileURL(require.resolve(id)).href}'`);
 const url='data:text/javascript;base64,'+Buffer.from(code).toString('base64');urls.set(filename,url);return url;
}
const root=fileURLToPath(new URL('../src/edit/',import.meta.url));
const {FaceSelection}=await import(moduleURL(path.join(root,'selection.ts')));
const {SculptStroke,SculptContext}=await import(moduleURL(path.join(root,'sculpt.ts')));
const {SelectionTransform}=await import(moduleURL(path.join(root,'transformSelection.ts')));
const engine=new NullEngine({renderWidth:512,renderHeight:512});engine.getCaps().maxVertexUniformVectors=1024;const scene=new Scene(engine);
const camera=new ArcRotateCamera('camera',Math.PI/2,Math.PI/2,8,new Vector3(2,0,0),scene);scene.activeCamera=camera;
const mesh=CreateSphere('skinned',{diameter:1,segments:24},scene);
const second=CreateSphere('other part',{diameter:1,segments:12},scene);second.position.x=-4;
const skeleton=new Skeleton('rig','rig',scene),bone=new Bone('root',skeleton,null,Matrix.Identity());mesh.skeleton=skeleton;mesh.numBoneInfluencers=4;
const count=mesh.getTotalVertices(),weights=new Float32Array(count*4);for(let i=0;i<count;i++)weights[i*4]=1;
mesh.setVerticesData('matricesIndices',new Float32Array(count*4));mesh.setVerticesData('matricesWeights',weights);
bone.updateMatrix(Matrix.Scaling(4,4,4).multiply(Matrix.Translation(2,0,0)),false,true);skeleton.prepare(true);
scene.render();const copy=mesh.clone('untouched');copy.position.x=10;const copyBefore=Array.from(copy.getVerticesData('position'));const entity={visible:true,kind:'model',meshes:[mesh,second]};
const records=[];const editor={record(step){records.push(step)},refreshShadowCasters(){},scene,camera,engine,overlays:new Set(),invalidate(){},notify(){},pickSurface(x,y){const hit=scene.pick(x,y,m=>entity.meshes.includes(m));return hit?.hit&&hit.pickedPoint?{entity,mesh:hit.pickedMesh,faceId:hit.faceId,point:hit.pickedPoint,normal:hit.getNormal(true,true)}:null}};
assert.equal(scene.pick(256,256,m=>m===mesh)?.hit,false,'Authored positions reproduce the original miss');
const selection=new FaceSelection(editor,entity);
try{
 const hit=editor.pickSurface(256,256);assert.equal(hit?.mesh,mesh);assert.ok(hit.faceId>=0);
 assert.equal(editor.overlays.size,0,'Picking must not allocate proxy meshes');
 const contexts=new Map();
 for(const brush of ['pull','inflate','smooth','flatten']){
  const before=Float32Array.from(mesh.getVerticesData('position'));
  const stroke=SculptStroke.begin(editor,selection,contexts,256,256,brush,65,.4,false);assert.ok(stroke,brush+' must start');
  for(let i=1;i<=8;i++)stroke.move(256+i*5,256);const result=stroke.end();assert.ok(result,brush+' must deform');
  assert.ok(before.some((v,i)=>v!==mesh.getVerticesData('position')[i]),brush+' must upload vertices');assert.ok(copyBefore.every((v,i)=>v===copy.getVerticesData('position')[i]),'Shared source geometry must remain unchanged');
  const display=mesh.getPositionData(true,true),box=mesh.getBoundingInfo().boundingBox;
  for(let i=0;i<display.length;i+=3)for(let axis=0;axis<3;axis++){const key=['x','y','z'][axis];assert.ok(display[i+axis]>=box.minimum[key]-1e-5&&display[i+axis]<=box.maximum[key]+1e-5,'Skinned bounds must contain the visible surface');}
  selection.refresh();
 }
 const context=contexts.get(mesh);assert.ok(context instanceof SculptContext);
 const first=context.nextStamp(),next=context.nextStamp();assert.equal(next,first+1,'Flood marks must remain distinct across strokes');

 selection.mesh(mesh,true);
 for(const kind of ['move','rotate','scale']){
  const transform=new SelectionTransform(editor,selection),before=Float32Array.from(mesh.getPositionData(true,true));
  const rawBefore=Float32Array.from(mesh.getVerticesData('position'));
  transform.begin();const center=transform.handle.position.clone();
  if(kind==='move')transform.handle.position.addInPlace(new Vector3(.25,-.1,.15));
  if(kind==='rotate')transform.handle.rotationQuaternion.copyFrom((await import('@babylonjs/core/Maths/math.vector.js')).Quaternion.RotationAxis(Vector3.Up(),.2));
  if(kind==='scale')transform.handle.scaling.set(1.2,.9,1.1);
  const expected=Matrix.Translation(-center.x,-center.y,-center.z).multiply(Matrix.Compose(transform.handle.scaling,transform.handle.rotationQuaternion,transform.handle.position));
  transform.update();const after=mesh.getPositionData(true,true);
  for(let i=0;i<before.length;i+=3){const point=Vector3.TransformCoordinates(Vector3.FromArray(before,i),expected);for(const [j,key]of [[0,'x'],[1,'y'],[2,'z']])assert.ok(Math.abs(after[i+j]-point[key])<5e-5,kind+' must match visible-space coordinates');}
  transform.end();const rawAfter=Float32Array.from(mesh.getVerticesData('position')),record=records.at(-1);assert.ok(record);
  record.undo();assert.ok(rawBefore.every((v,i)=>v===mesh.getVerticesData('position')[i]),kind+' undo');
  record.redo();assert.ok(rawAfter.every((v,i)=>v===mesh.getVerticesData('position')[i]),kind+' redo');transform.dispose();
 }
 console.log('Skinned multi-part picking, four brush uploads, posed bounds, repeated stroke marks native picking and visible-space face transforms with undo/redo pass.');
}finally{selection.dispose();assert.equal(editor.overlays.size,0);scene.dispose();engine.dispose();}
