// Focused regression: shoulder alternatives must preserve normalized weights and rest geometry.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = ts.transpileModule(fs.readFileSync(new URL('../src/shoulderWeights.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
}).outputText;
const { shoulderWeights } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const input = {
  points: new Float32Array([.17, .6, 0, .4, .7, 0, .22, .79, 0]),
  bones: new Float32Array([0,.5,0,0,.8,0, .2,.8,0,.45,.8,0, -.2,.8,0,-.45,.8,0]),
  armRoots: new Uint32Array([1,2]), limbRootOf: new Int16Array([-1,1,2]),
  limbAxes: new Float32Array([0,0,0,1,0,0,-1,0,0]), torsoUp: new Float32Array([0,1,0]),
  torsoBones: new Uint32Array([0]),
};
const dense = new Float32Array([.2,.8,0, .05,.95,0, .3,.7,0]);
const current = shoulderWeights(dense,input,'current');
assert.equal(current,dense, 'The reference must use the existing weights unchanged');
const protectedWeights = shoulderWeights(dense,input,'protected');
assert.ok(protectedWeights[1]<.01, 'Lower lateral trunk must stop following the upper arm');
assert.ok(protectedWeights[0]>.99, 'Removed arm influence must go to the trunk');
assert.equal(protectedWeights[4],dense[4], 'The outer arm must remain free to move');
const helper = shoulderWeights(dense,input,'helper');
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
assert.deepEqual(shoulderWeights(loweredWeights,lowered,'protected'),loweredWeights,'A lowered A-pose arm close to its own bone must not be reassigned to the trunk');
console.log('Shoulder strategies: reference, trunk protection, helper falloff and normalization pass');
