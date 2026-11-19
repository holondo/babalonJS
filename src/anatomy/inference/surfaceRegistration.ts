import type { AnatomyParameters } from '../parameters';
import type { SurfaceFit } from '../surfaceFit';
import { latticeWeights, surfaceFitPoint } from '../surfaceFit';
import { generateAnatomy } from '../generation';
import { canonicalAnatomyFactors } from '../binding/anatomySkinDrive';
import { SurfaceBVH } from './observationProxy';
import type { AnatomyMesh } from '../contracts';

export interface SurfaceRegistrationEvidence { beforeMm:number;afterMm:number;p95Mm:number;minJacobian:number;iterations:number;landmarkBeforeMm:number;landmarkAfterMm:number;validationBeforeMm:number;validationAfterMm:number;generatedToTargetMm:number;targetToGeneratedMm:number; }
/** Coarse-to-fine residual registration. Parameters describe anatomy; this field
 * supplies the missing local shape degrees of freedom without editing the GLB.
 */
export function registerSurface(p:AnatomyParameters,target:SurfaceBVH,progress?:(fraction:number)=>void,anchors:{source:number[];target:number[];weight:number}[] = [],base?:AnatomyMesh) {
  const skin=base??generateAnatomy({...p,surfaceFit:undefined},[]).meshes.skin[0],f=canonicalAnatomyFactors(p.height);
  const rest=Float32Array.from(skin.positions,(v,i)=>v*(i%3===1?f.vertical:f.lateral));
  const min:[number,number,number]=[Infinity,Infinity,Infinity],max:[number,number,number]=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<rest.length;i++) {const k=i%3;min[k]=Math.min(min[k],rest[i]-.04);max[k]=Math.max(max[k],rest[i]+.04);}
  const size:[number,number,number]=[18,38,14],count=size[0]*size[1]*size[2];
  const field:SurfaceFit={version:1,min,max,size,offsets:new Array(count*3).fill(0)};
  const sampleStride=Math.max(1,Math.floor(rest.length/3/6500));
  const random=(initial:number)=>{let seed=initial;return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}};
  const targetSamples=target.sampleSurface(1500,random(8191)).points,validationSamples=target.sampleSurface(1500,random(65537)).points;
  function currentSurface(){const positions=new Float32Array(rest.length);for(let i=0;i<rest.length;i+=3)positions.set(surfaceFitPoint(field,[rest[i],rest[i+1],rest[i+2]]),i);return{positions,bvh:new SurfaceBVH({positions,indices:skin.indices})};}
  function errors(validation=false){const values:number[]=[];for(let i=validation?3:0;i<rest.length;i+=3*sampleStride){const v=surfaceFitPoint(field,[rest[i],rest[i+1],rest[i+2]]);values.push(Math.sqrt(target.queryClosestPoint(v).distanceSq)*1000);}const forward=values.reduce((s,v)=>s+v,0)/values.length;
    const {bvh}=currentSurface(),source=validation?validationSamples:targetSamples;let reverse=0;
    for(let i=0;i<source.length;i+=3){const d=Math.sqrt(bvh.queryClosestPoint([source[i],source[i+1],source[i+2]]).distanceSq)*1000;reverse+=d;values.push(d);}reverse/=source.length/3;
    values.sort((a,b)=>a-b);return {mean:(forward+reverse)*.5,forward,reverse,p95:values[Math.floor(values.length*.95)]};}

  const landmarkError=()=>anchors.length?anchors.reduce((sum,a)=>{const v=surfaceFitPoint(field,a.source);return sum+Math.hypot(...v.map((x,k)=>x-a.target[k]));},0)/anchors.length*1000:0;
  const landmarkBeforeMm=landmarkError();
  const before=errors(),validationBefore=errors(true);let iterations=0,minJacobian=1;
  function jacobian(blocked?:Set<number>){let minimum=Infinity;const step=size.map((n,k)=>(max[k]-min[k])/(n-1));
    for(let z=0;z<size[2]-1;z++)for(let y=0;y<size[1]-1;y++)for(let x=0;x<size[0]-1;x++){
      const i=((z*size[1]+y)*size[0]+x)*3,axes=[3,size[0]*3,size[0]*size[1]*3];
      const a=axes.map((offset,k)=>[0,1,2].map(r=>(field.offsets[i+offset+r]-field.offsets[i+r])/step[k]+(r===k?1:0)));
      const det=a[0][0]*(a[1][1]*a[2][2]-a[1][2]*a[2][1])-a[1][0]*(a[0][1]*a[2][2]-a[0][2]*a[2][1])+a[2][0]*(a[0][1]*a[1][2]-a[0][2]*a[1][1]);minimum=Math.min(minimum,det);
      if(det<.23&&blocked)for(let dz=0;dz<2;dz++)for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++)blocked.add(((z+dz)*size[1]+y+dy)*size[0]+x+dx);
    }return minimum;}
  for(let iteration=0;iteration<22;iteration++){
    const delta=new Float64Array(count*3),weights=new Float64Array(count);
    for(let i=0;i<rest.length;i+=3*sampleStride){
      const source=[rest[i],rest[i+1],rest[i+2]],v=surfaceFitPoint(field,source),hit=target.queryClosestPoint(v),distance=Math.sqrt(hit.distanceSq);
      if(distance>.25)continue;
      const gain=Math.min(1,.035/Math.max(distance,1e-9));
      latticeWeights(field,source,(n,w)=>{weights[n]+=w;for(let k=0;k<3;k++)delta[n*3+k]+=(hit.point[k]-v[k])*gain*w;});
    }
    // Reverse correspondences prevent a small/collapsed surface from matching
    // only an easy subset of the reference. Transfer triangle barycentrics back
    // to the undeformed lattice domain before accumulating the observation.
    const current=currentSurface();
    for(let i=0;i<targetSamples.length;i+=3){
      const desired:[number,number,number]=[targetSamples[i],targetSamples[i+1],targetSamples[i+2]],hit=current.bvh.queryClosestPoint(desired);if(hit.triangleIndex<0||hit.distanceSq>.25**2)continue;
      const ids=[0,1,2].map(k=>skin.indices[hit.triangleIndex*3+k]*3),a=ids.map(j=>Array.from(current.positions.subarray(j,j+3))),u=a[1].map((v,k)=>v-a[0][k]),v=a[2].map((x,k)=>x-a[0][k]),q=hit.point.map((x,k)=>x-a[0][k]);
      const dot=(x:number[],y:number[])=>x.reduce((sum,x,k)=>sum+x*y[k],0),uu=dot(u,u),vv=dot(v,v),uv=dot(u,v),den=uu*vv-uv*uv;if(den<1e-15)continue;
      const b=(vv*dot(q,u)-uv*dot(q,v))/den,c=(uu*dot(q,v)-uv*dot(q,u))/den,w=[1-b-c,b,c],source=[0,1,2].map(k=>ids.reduce((sum,j,n)=>sum+rest[j+k]*w[n],0)),gain=Math.min(1,.035/Math.max(Math.sqrt(hit.distanceSq),1e-9));
      latticeWeights(field,source,(n,weight)=>{weights[n]+=weight*4;for(let k=0;k<3;k++)delta[n*3+k]+=(desired[k]-hit.point[k])*gain*weight*4;});
    }
    for(const anchor of anchors){const v=surfaceFitPoint(field,anchor.source);latticeWeights(field,anchor.source,(n,w)=>{weights[n]+=w*anchor.weight;for(let k=0;k<3;k++)delta[n*3+k]+=(anchor.target[k]-v[k])*w*anchor.weight;});}
    const old=field.offsets.slice(),candidate=old.slice();
    for(let n=0;n<count;n++)if(weights[n])for(let k=0;k<3;k++)candidate[n*3+k]+=.8*delta[n*3+k]/weights[n];
    // Laplacian regularization extends surface observations into the interior.
    for(let pass=0;pass<4;pass++){
      const copy=candidate.slice();
      for(let z=1;z<size[2]-1;z++)for(let y=1;y<size[1]-1;y++)for(let x=1;x<size[0]-1;x++){
        const n=(z*size[1]+y)*size[0]+x,near=[n-1,n+1,n-size[0],n+size[0],n-size[0]*size[1],n+size[0]*size[1]],smooth=weights[n]>.01?.2:.8;
        for(let k=0;k<3;k++)candidate[n*3+k]=copy[n*3+k]*(1-smooth)+near.reduce((s,j)=>s+copy[j*3+k],0)/6*smooth;
      }
    }
    // A small difficult region (often fingertips) must not freeze every other
    // degree of freedom. Project offending cells back toward the last valid map.
    field.offsets=candidate;
    for(let pass=0;pass<16;pass++){
      const blocked=new Set<number>();jacobian(blocked);if(!blocked.size)break;
      for(const n of blocked)for(let k=0;k<3;k++)candidate[n*3+k]=old[n*3+k]+(candidate[n*3+k]-old[n*3+k])*.4;
    }
    let accepted=false;
    for(let rate=1;rate>=1/64;rate/=2){field.offsets=candidate.map((v,i)=>Math.max(-.25,Math.min(.25,old[i]+(v-old[i])*rate)));minJacobian=jacobian();if(minJacobian>.2){accepted=true;break;}}
    if(!accepted){field.offsets=old;minJacobian=jacobian();break;}
    iterations++;progress?.((iteration+1)/22);
  }
  let after=errors(),validationAfter=errors(true);
  if(validationAfter.mean>validationBefore.mean){field.offsets.fill(0);after=before;validationAfter=validationBefore;minJacobian=1;iterations=0;}
  return {field,evidence:{beforeMm:before.mean,afterMm:after.mean,p95Mm:after.p95,minJacobian,iterations,validationBeforeMm:validationBefore.mean,validationAfterMm:validationAfter.mean,generatedToTargetMm:after.forward,targetToGeneratedMm:after.reverse,landmarkBeforeMm,landmarkAfterMm:landmarkError()} satisfies SurfaceRegistrationEvidence};
}
