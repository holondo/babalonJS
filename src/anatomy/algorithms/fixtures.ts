/** Synthetic shapes for algorithm tests only — NOT a medically accurate anatomical dataset. */
import { add, cross, orthogonal, scale, sub, unit, type Vec3 } from './math.js';

import type { AnatomyModel, BoneDefinition, IndexedMesh } from './types.js';
export function makeTestBone(id:string,restStart:Vec3,restEnd:Vec3,radius=0.03,segments=12):BoneDefinition {
  const axis=unit(sub(restEnd,restStart)),u=orthogonal(axis),v=unit(cross(axis,u));
  const points:number[]=[];
  for(const center of [restStart,restEnd])for(let j=0;j<segments;j++){
    const angle=j*2*Math.PI/segments,p=add(center,add(scale(u,Math.cos(angle)*radius),scale(v,Math.sin(angle)*radius)));points.push(...p);
  }
  const a=points.length/3;points.push(...restStart);const b=points.length/3;points.push(...restEnd);
  const indices:number[]=[];
  for(let j=0;j<segments;j++){const jj=(j+1)%segments;indices.push(j,jj,segments+j,segments+j,jj,segments+jj);indices.push(a,jj,j,b,segments+j,segments+jj);}
  const mesh:IndexedMesh={positions:new Float32Array(points),indices:new Uint32Array(indices)};
  return {id,mesh,restStart,restEnd};
}
export function hamstringDemo():AnatomyModel {
  const bones=[
    makeTestBone('pelvis',[-0.17,0.99,0],[0.17,0.99,0],0.075),
    makeTestBone('femur',[0.11,0.96,0],[0.11,0.53,0],0.035),
    makeTestBone('tibia',[0.11,0.53,0],[0.11,0.11,0],0.023)
  ];
  return {bones,muscles:[{
    id:'hamstring_demo',origin:{boneId:'pelvis',triangle:0,barycentric:[0.2,0.3,0.5]},
    insertion:{boneId:'tibia',triangle:4,barycentric:[0.25,0.5,0.25]},
    via:[{boneId:'femur',restPoint:[0.13,0.76,-0.07]},{boneId:'femur',restPoint:[0.14,0.56,-0.065]}],
    architecture:{kind:'fusiform',targetVolume:0.00018,aspectRatio:0.8,endTaper:0.16}
  }]};
}
