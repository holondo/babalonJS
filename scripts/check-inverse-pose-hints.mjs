import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import ts from 'typescript';

const transpile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext }
}).outputText;

const { registerHooks } = await import('node:module');
const { fileURLToPath } = await import('node:url');
const prefix = new URL('../src/anatomy/', import.meta.url).href;

registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.startsWith(prefix) && specifier.startsWith('.')) {
      const url = new URL(specifier, context.parentURL);
      if (specifier.endsWith('.js') && existsSync(fileURLToPath(url.href.slice(0, -3) + '.ts'))) {
        specifier = specifier.slice(0, -3) + '.ts';
      } else if (!/\.(ts|json)$/.test(specifier) && existsSync(fileURLToPath(url.href + '.ts'))) {
        specifier += '.ts';
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith(prefix) && url.endsWith('.ts')) {
      return { format: 'module', source: transpile(readFileSync(fileURLToPath(url), 'utf8')), shortCircuit: true };
    }
    if (url.startsWith(prefix) && url.endsWith('.json')) {
      return { format: 'module', source: 'export default ' + readFileSync(fileURLToPath(url), 'utf8') + ';', shortCircuit: true };
    }
    return next(url, context);
  }
});

const{neutralizeForMeasurement}=await import('../src/anatomy/inference/bodyEvidence.ts');
const{AnatomySkinDrive,canonicalAnatomyFactors,sourcePointToCanonical,sourcePointFromCanonical}=await import('../src/anatomy/binding/anatomySkinDrive.ts');
const{inverseSkinningDifferentials,ImportedAnatomyController}=await import('../src/anatomy/integration/importedAnatomyController.ts');
const frame={yaw:.6,scale:1.7,offset:[.1,-.2,.03]},point=[.2,.8,-.1];
const restored=sourcePointFromCanonical(frame,...sourcePointToCanonical(frame,...point));assert.ok(restored.every((v,i)=>Math.abs(v-point[i])<1e-12));
const reflectedFrame={...frame,forwardSign:-1};const reflected=sourcePointFromCanonical(reflectedFrame,...sourcePointToCanonical(reflectedFrame,...point));assert.ok(reflected.every((v,i)=>Math.abs(v-point[i])<1e-12),'reflected GLB frame roundtrip');
const vertices=new Float32Array([-.2,1.4,0,-.5,1.4,0,-.5,1.4,.25,-.1,.9,0,-.1,.5,.2,-.1,.2,.45]);
const original=vertices.slice();const hints={heightCm:180,landmarks:{shoulder_L:[-.2,1.4,0],elbow_L:[-.5,1.4,0],wrist_L:[-.5,1.4,.25],hipJoint_L:[-.1,.9,0],knee_L:[-.1,.5,.2],ankle_L:[-.1,.2,.45]},vertexBones:new Uint8Array([1,1,2,5,5,6])};
const neutral=neutralizeForMeasurement(vertices,{yaw:0,scale:1,offset:[0,0,0]},hints);assert.deepEqual(vertices,original);assert.equal(neutral.pose.method,'joint-hints');
assert.ok(Math.abs(neutral.boneLengthsCm.upperArm_L-30)<1e-6);assert.ok(Math.abs(neutral.boneLengthsCm.forearm_L-25)<1e-6);
for(const [a,b,len]of [[0,1,.3],[1,2,.25],[3,4,Math.hypot(.4,.2)],[4,5,Math.hypot(.3,.25)]])assert.ok(Math.abs(Math.hypot(...[0,1,2].map(k=>neutral.positions[a*3+k]-neutral.positions[b*3+k]))-len)<1e-6);
const{NullEngine}=await import('@babylonjs/core/Engines/nullEngine.js');const{Scene}=await import('@babylonjs/core/scene.js');const{Mesh}=await import('@babylonjs/core/Meshes/mesh.js');const{Skeleton}=await import('@babylonjs/core/Bones/skeleton.js');const{Bone}=await import('@babylonjs/core/Bones/bone.js');const{Quaternion,Vector3}=await import('@babylonjs/core/Maths/math.vector.js');
const engine=new NullEngine(),scene=new Scene(engine),mesh=new Mesh('rigged skin',scene),skeleton=new Skeleton('rig','rig',scene);const bone=new Bone('root',skeleton);
const skin={positions:new Float32Array([0,0,0,1,0,0,0,1,0]),normals:new Float32Array([0,0,1,0,0,1,0,0,1]),indices:new Uint32Array([0,1,2])};
const factors=canonicalAnatomyFactors(180);const rest=Float32Array.from(skin.positions,(v,i)=>v*(i%3===1?factors.vertical:factors.lateral));
mesh.setVerticesData('position',rest,true);mesh.setIndices(skin.indices);mesh.setVerticesData('matricesIndices',new Float32Array(12),false,4);mesh.setVerticesData('matricesWeights',new Float32Array([1,0,0,0,1,0,0,0,1,0,0,0]),false,4);mesh.skeleton=skeleton;
bone.setRotationQuaternion(Quaternion.RotationAxis(Vector3.Up(),Math.PI/3));skeleton.prepare();
const inverse=inverseSkinningDifferentials(mesh),transforms=skeleton.getTransformMatrices(mesh);const rotations=new Float32Array(27);
for(let v=0;v<3;v++)for(let r=0;r<3;r++)for(let c=0;c<3;c++)rotations[v*9+r*3+c]=transforms[c*4+r];
const drive=new ImportedAnatomyController({refreshShadows(){},invalidate(){}});
const bound=drive.bind({mesh,name:'rigged',positions:rest,indices:skin.indices,analysisPositions:rest,inversePoseRotations:rotations},{yaw:0,scale:1,offset:[0,0,0]},skin,180);
assert.equal(bound.bound,true);assert.equal(mesh.skeleton,skeleton);
for(let r=0;r<3;r++)for(let c=0;c<3;c++){let value=0;for(let k=0;k<3;k++)value+=inverse[r*3+k]*transforms[c*4+k];assert.ok(Math.abs(value-(r===c?1:0))<1e-6);}
const changed={...skin,positions:skin.positions.slice()};for(let i=2;i<changed.positions.length;i+=3)changed.positions[i]+=1;
const report=drive.apply(changed,180);assert.ok(report.movedVertices>0);
for(let i=0;i<rest.length;i++)assert.ok(Math.abs(mesh.getVerticesData('position')[i]-rest[i]-(i%3===2?.1:0))<1e-6);
drive.revert();assert.deepEqual(Float32Array.from(mesh.getVerticesData('position')),rest);assert.equal(mesh.skeleton,skeleton);scene.dispose();engine.dispose();
console.log('PASS: neutralization before measurement, preserved segment lengths, reversible source pose and existing rig skinning');

// Nearest vertex can belong to a different sheet than the closest triangle interior.
const {buildSkinCorrespondence,sampleSurfaceDelta,accumulateSkinNormals,updateDrivenSkinNormals}=await import('../src/anatomy/binding/skinCorrespondence.ts');
const target=new Float32Array([-1,-1,0,1,-1,0,0,1,0,0,0,.08,.01,0,.08,0,.01,.08]);
const ids=new Uint32Array([0,1,2,3,4,5]);
const correspondence=buildSkinCorrespondence(new Float32Array([0,0,.005,0,0,.5]),target,ids);
assert.equal(correspondence.triangle[0],0,'triangle fallback finds the large triangle interior');
assert.ok(Math.abs(correspondence.distance[0]-.005)<1e-6);assert.equal(correspondence.clamped[1],1);
const grown=target.slice();for(let i=2;i<grown.length;i+=3)grown[i]+=.01;
const delta=new Float32Array(6);sampleSurfaceDelta(correspondence,ids,target,grown,delta);
assert.ok(Math.abs(delta[2]-.01)<1e-6);assert.equal(delta[5],0,'unreliable matches remain unchanged');
console.log('PASS: exact triangle fallback and rejection of distant correspondences');

const restSurface = new Float32Array([0,0,0, 1,0,0, 0,1,0, 2,0,0, 3,0,0, 2,1,0]);
const bent = restSurface.slice(); bent[8] = 1;
const authored = new Float32Array([0,0,1, 0,0,1, 0,0,1, .6,0,.8, .6,0,.8, .6,0,.8]);
const restSums = new Float32Array(restSurface.length), updated = restSums.slice();
accumulateSkinNormals(restSurface, ids, restSums);
updateDrivenSkinNormals(bent, ids, restSurface, new Uint8Array([0,0,1,0,0,0]), restSums, authored, updated);
assert.ok(Math.abs(updated[1] + Math.SQRT1_2) < 1e-6 && Math.abs(updated[2] - Math.SQRT1_2) < 1e-6);
assert.deepEqual(updated.subarray(9), authored.subarray(9), 'Untouched faces retain authored normals byte for byte');
console.log('PASS: affected normals rotate with the skin and untouched authored normals stay exact');
