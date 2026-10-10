// Focused regression: shoulder alternatives must preserve normalized weights and rest geometry.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = ts.transpileModule(fs.readFileSync(new URL('../src/rigging/skinTreatments.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
}).outputText;
const { applySkinTreatment } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const input = {
  points: new Float32Array([.17, .6, 0, .4, .7, 0, .22, .79, 0]),
  bones: new Float32Array([0,.5,0,0,.8,0, .2,.8,0,.45,.8,0, -.2,.8,0,-.45,.8,0]),
  treatedRoots: new Uint32Array([1,2]), limbRootOf: new Int16Array([-1,1,2]),
  limbAxes: new Float32Array([0,0,0,1,0,0,-1,0,0]), trunkUp: new Float32Array([0,1,0]),
  trunkBones: new Uint32Array([0]),
};
const dense = new Float32Array([.2,.8,0, .05,.95,0, .3,.7,0]);
const current = applySkinTreatment(dense,input,'current');
assert.equal(current,dense, 'The reference must use the existing weights unchanged');
const protectedWeights = applySkinTreatment(dense,input,'protected');
assert.ok(protectedWeights[1]<.01, 'Lower lateral trunk must stop following the upper arm');
assert.ok(protectedWeights[0]>.99, 'Removed arm influence must go to the trunk');
assert.equal(protectedWeights[4],dense[4], 'The outer arm must remain free to move');
const helper = applySkinTreatment(dense,input,'helper');
assert.equal(helper.length, 3*5);
assert.ok(helper[2*5+3]>.1, 'The shoulder transition must use the left helper');
assert.ok(helper[1*5+3]<helper[2*5+3], 'The helper must fade away along the arm');
for (const [weights, bones] of [[current,3],[protectedWeights,3],[helper,5]]) {
  for(let i=0;i<3;i++) {
    const row=weights.subarray(i*bones,(i+1)*bones);
    assert.ok(row.every(w=>Number.isFinite(w)&&w>=0));
    assert.ok(Math.abs(row.reduce((a,b)=>a+b,0)-1)<1e-6,'Each variant must preserve total influence');
  }
}
assert.deepEqual(Array.from(dense), [.2,.8,0,.05,.95,0,.3,.7,0].map(Math.fround), 'Alternatives must not modify the reference');
const lowered={...input,points:new Float32Array([.22,.55,0]),bones:new Float32Array([0,.5,0,0,.8,0, .2,.8,0,.23,.5,0, -.2,.8,0,-.23,.5,0])};
const loweredWeights=new Float32Array([.05,.95,0]);
assert.deepEqual(applySkinTreatment(loweredWeights,lowered,'protected'),loweredWeights,'A lowered A-pose arm close to its own bone must not be reassigned to the trunk');
const distal={...input,points:new Float32Array([.1,.45,0]),bones:new Float32Array([0,.4,0,0,.8,0,.2,.8,0,.2,.6,0,.15,.55,0,.15,.35,0]),limbRootOf:new Int16Array([-1,1,1]),treatedRoots:new Uint32Array([1])};
const distalWeights=new Float32Array([.01,.04,.95]);
assert.deepEqual(applySkinTreatment(distalWeights,distal,'protected'),distalWeights,'Forearm skin beside the trunk must remain attached to its limb');
console.log('Skin treatments: direct weights, trunk protection, helper falloff and normalization pass');
