import assert from 'node:assert/strict';
import { buildSplatLod, selectSplatLod } from '../src/optimize/splatLodMath.ts';
import {GaussianSplattingMeshBase} from '@babylonjs/core/Meshes/GaussianSplatting/gaussianSplattingMeshBase.js';
import {Vector3} from '@babylonjs/core/Maths/math.vector.js';
const data=new ArrayBuffer(9*32),f=new Float32Array(data),b=new Uint8Array(data);
for(let i=0;i<9;i++){f.set([i/8-.5,0,0,.1,.2,.3],i*8);b.set([100,150,200,128,255,128,128,128],i*32+24);}
const original=b.slice(),tree=buildSplatLod(data),limited=buildSplatLod(data,false,4);
assert.deepEqual(b,original,'LOD changed source records');
assert.equal(limited.leafCount,4);assert.equal(tree.leafCount,9);
const result=new Float32Array(tree.data);
for(let i=0;i<result.length;i+=8)for(let k=0;k<6;k++)assert.ok(Number.isFinite(result[i+k]));
assert.ok(Math.abs(result[tree.root*8])<.01,'Weighted aggregate center drifted');
assert.ok(Math.max(...result.slice(tree.root*8+3,tree.root*8+6))>.3,'Aggregation failed to include center variance');
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],instances=[{tree:0,matrix:identity},{tree:0,matrix:identity}];
const view={position:[0,0,-2],planes:[],focal:1000};
const near=selectSplatLod([tree],instances,view,8),far=selectSplatLod([tree],instances,{...view,position:[0,0,-10000]},8);
const size=ranges=>ranges.flat().reduce((n,r)=>n+r.count,0);
assert.ok(size(near)<=8&&size(near)>size(far));
for(const ranges of near){
  const seen=new Set();
  const walk=node=>{const left=tree.children[node*2],right=tree.children[node*2+1];if(left<0){assert.ok(!seen.has(node),'Parent and child rendered together');seen.add(node);}else{walk(left);if(right>=0)walk(right);}};
  for(const range of ranges)for(let i=range.offset;i<range.offset+range.count;i++)walk(i);
  assert.equal(seen.size,tree.leafCount,'LOD omitted source regions');
}
assert.equal(size(selectSplatLod([tree],instances,{...view,planes:[1,0,0,-1000]},8)),0);
// Check the quaternion/covariance convention against Babylon's actual upload math.
const rotated=new ArrayBuffer(64),rf=new Float32Array(rotated),rb=new Uint8Array(rotated);
for(let i=0;i<2;i++){rf.set([0,0,0,.1,.4,.2],i*8);rb.set([100,150,200,100,235,160,185,145],i*32+24);}
const rotatedTree=buildSplatLod(rotated);
const gpuCovariance=(data,index)=>{
  const storage={_splatPositions:new Float32Array(4),_tmpCovariances:new Float64Array(6),_useRGBACovariants:true,_needsRotationScaleTextures:false,_splatSizeMin:Infinity,_splatSizeMax:-Infinity};
  GaussianSplattingMeshBase.prototype._makeSplat.call(storage,0,new Float32Array(data),new Uint8Array(data),new Uint16Array(4),new Uint16Array(4),new Uint8Array(4),new Vector3(Infinity,Infinity,Infinity),new Vector3(-Infinity,-Infinity,-Infinity),false,index);
  return Array.from(storage._tmpCovariances);
};
const inputCov=gpuCovariance(rotated,0),aggregateCov=gpuCovariance(rotatedTree.data,rotatedTree.root);
assert.ok(inputCov.every((v,i)=>Math.abs(v-aggregateCov[i])<Math.max(...inputCov)*.02),'LOD quaternion convention disagrees with Gaussian renderer');
console.log(JSON.stringify({nodes:tree.radii.length,leaves:tree.leafCount,near:size(near),far:size(far),sourcePreserved:true}));
