import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Vec3M } from './landmarks';
import type { AnatomyParameters } from './parameters';
import type { BodyHints } from './inference/bodyEvidence';
import type { SourceCanonicalFrame } from './binding/anatomySkinDrive';
import { sourcePointToCanonical, canonicalAnatomyFactors } from './binding/anatomySkinDrive';
import { proportionChain } from './segmentProportions';
import { surfaceFitPoint } from './surfaceFit';

interface Chain { kind:'arm'|'leg';side:-1|1;source:Vec3M[];target:Vec3M[]; radialFit?: [number[],number[]]; }
export function armBend(chain: Chain) {
  if (chain.kind !== 'arm') return 0;
  const [shoulder, elbow, wrist] = chain.target.map(point => new Vector3(...point));
  return 1 - Vector3.Dot(elbow.subtract(shoulder).normalize(), wrist.subtract(elbow).normalize());
}
export interface ReferencePose { version:1;enabled:boolean;chains:Chain[]; }
export function normalizeReferencePose(value:unknown):ReferencePose|undefined {
  if(!value||typeof value!=='object')return;
  const p=value as ReferencePose;
  if(p.version!==1||!Array.isArray(p.chains)||p.chains.length>4)return;
  const chains:Chain[]=[];
  for(const chain of p.chains){
    if(!['arm','leg'].includes(chain.kind)||![1,-1].includes(chain.side))return;
    for(const points of [chain.source,chain.target])if(!Array.isArray(points)||points.length!==3||points.some(v=>!Array.isArray(v)||v.length!==3||v.some(x=>!Number.isFinite(x)||Math.abs(x)>4)))return;
    if([chain.source,chain.target].some(points=>points.slice(1).some((p,i)=>Math.hypot(...p.map((v,k)=>v-points[i][k]))<.015)))return;
    const copy=structuredClone(chain);
    if (copy.kind!=='arm'||!Array.isArray(copy.radialFit)||copy.radialFit.length!==2||
      copy.radialFit.some(profile=>!Array.isArray(profile)||![3,12,20].includes(profile.length)||profile.some(v=>!Number.isFinite(v)||v<.8||v>1.25))) delete copy.radialFit;
    chains.push(copy);
  }
  return {version:1,enabled:p.enabled!==false,chains};
}
export function armSectionBasis(axis: Vec3M) {
  const direction = new Vector3(...axis).normalize();
  const u = Vector3.Cross(direction,Math.abs(direction.z)<.8?Vector3.Forward(true):Vector3.Up()).normalize();
  return [u.asArray(),Vector3.Cross(direction,u).asArray()] as [Vec3M,Vec3M];
}
export function armSectorGain(profile: readonly number[], angle: number) {
  const index=((angle/(Math.PI/2))%4+4)%4, sector=Math.floor(index), fraction=index-sector;
  return profile[sector]*(1-fraction)+profile[(sector+1)%4]*fraction;
}
export function fitArmRadius(point: Vec3M, chain: Chain): Vec3M {
  if (!chain.radialFit) return point;
  let closest = Infinity, result = point;
  for (const segment of [0,1] as const) {
    const a=chain.target[segment], b=chain.target[segment+1], axis=b.map((v,k)=>v-a[k]);
    const lengthSq=axis.reduce((s,v)=>s+v*v,0);
    if(lengthSq<.01)continue;
    const t=axis.reduce((s,v,k)=>s+v*(point[k]-a[k]),0)/lengthSq;
    if(t<=0||t>=1)continue;
    const center=a.map((v,k)=>v+axis[k]*t), radius=Math.hypot(...center.map((v,k)=>point[k]-v));
    if(radius>=closest)continue;
    closest=radius;
    const profile=chain.radialFit[segment], intervals=profile.length===20?6:4, j=Math.floor(t*intervals), x=t*intervals-j;
    let gainAt=(station:number)=>station===0||station===intervals?1:profile[station-1];
    if(profile.length!==3){
      const [u,v]=armSectionBasis(axis as Vec3M), offset=point.map((n,k)=>n-center[k]);
      const angle=Math.atan2(v.reduce((s,n,k)=>s+n*offset[k],0),u.reduce((s,n,k)=>s+n*offset[k],0));
      gainAt=station=>station===0||station===intervals?1:armSectorGain(profile.slice((station-1)*4,station*4),angle);
    }
    const start=gainAt(j), gain=start+(gainAt(j+1)-start)*x*x*(3-2*x);
    result=point.map((v,k)=>center[k]+(v-center[k])*gain) as Vec3M;
  }
  return result;
}
export function createReferencePose(p:AnatomyParameters,frame:SourceCanonicalFrame,hints:BodyHints):ReferencePose {
  const chains:Chain[]=[],f=canonicalAnatomyFactors(p.height);
  for(const side of ['L','R'] as const)for(const leg of [false,true]){
    const names=leg?['hipJoint','knee','ankle']:['shoulder','elbow','wrist'];
    const target=names.map(name=>hints.landmarks?.[`${name}_${side}` as keyof NonNullable<BodyHints['landmarks']>]);
    if(target.some(p=>!p))continue;
    const source=proportionChain(p,side==='L'?-1:1,leg).target.map(v=>{
      const canonical=v.map((x,k)=>x*(k===1?f.vertical:f.lateral)) as Vec3M;
      return p.surfaceFit?surfaceFitPoint(p.surfaceFit,canonical):canonical;
    });
    chains.push({kind:leg?'leg':'arm',side:side==='L'?-1:1,source,target:target.map(point=>sourcePointToCanonical(frame,...point!))});
  }
  return {version:1,enabled:true,chains};
}
function segment(a:Vec3M,b:Vec3M,c:Vec3M,d:Vec3M) {
  const from=new Vector3(...b).subtract(new Vector3(...a)),to=new Vector3(...d).subtract(new Vector3(...c)),ratio=to.length()/Math.max(.001,from.length()),axis=from.normalize();
  const q=Quaternion.Identity(),matrix=Matrix.Identity();Quaternion.FromUnitVectorsToRef(axis,to.normalize(),q);q.toRotationMatrix(matrix);
  const r=Array.from({length:9},(_,i)=>matrix.m[(i%3)*4+Math.floor(i/3)]),u=axis.asArray();
  // Change axial length to meet the observed endpoints, retaining cross-sectional radius.
  const m=Array.from({length:9},(_,i)=>r[i]+(ratio-1)*[0,1,2].reduce((sum,k)=>sum+r[Math.floor(i/3)*3+k]*u[k]*u[i%3],0));
  return (p:readonly number[]):Vec3M=>[0,1,2].map(row=>c[row]+[0,1,2].reduce((sum,k)=>sum+m[row*3+k]*(p[k]-a[k]),0)) as Vec3M;
}
/** Shared calibration for skin, muscles and bones; controls subsequently add offsets. */
export function referencePoseMapper(pose:ReferencePose|undefined) {
  const chains = pose?.enabled ? pose.chains.map(c => {
    const [start, joint, end] = c.source.map(p => new Vector3(...p));
    const upperAxis = start.subtract(joint).normalize();
    const lowerAxis = joint.subtract(end).normalize();
    // The arm can be oblique in the fitted source frame. Measure elbow
    // proximity along the arm, so the lower segment owns the full wrist.
    const bisector = upperAxis.add(lowerAxis);
    const jointAxis = c.kind === 'leg' ? [0, 1, 0]
      : (bisector.lengthSquared() > 1e-6 ? bisector.normalize() : upperAxis).asArray();
    return {
      ...c, jointAxis, bend: armBend(c),
      upper: segment(c.source[0], c.source[1], c.target[0], c.target[1]),
      lower: segment(c.source[1], c.source[2], c.target[1], c.target[2]),
    };
  }) : [];
  return (point:readonly number[],kind:'arm'|'leg',side:number):Vec3M=>{
    const chain=chains.find(c=>c.kind===kind&&c.side===side);if(!chain)return [...point] as Vec3M;
    const distance = chain.jointAxis.reduce((sum, axis, i) => sum + axis * (point[i] - chain.source[1][i]), 0);
    const t=Math.max(0,Math.min(1,(distance+.025)/.05)),w=t*t*(3-2*t),a=chain.upper(point),b=chain.lower(point);
    const mixed = a.map((v,k)=>v*w+b[k]*(1-w)) as Vec3M;
    if (chain.bend < .3 || w <= 0 || w >= 1) return mixed;
    const pivot = chain.target[1];
    const length = (v: Vec3M) => Math.hypot(v[0]-pivot[0],v[1]-pivot[1],v[2]-pivot[2]);
    const current = length(mixed);
    if (current < .002) return mixed;
    // Blending differently rotated sections collapses the inside of a bent elbow.
    const gain = Math.min(1.16, (w*length(a)+(1-w)*length(b))/current);
    return mixed.map((value,k)=>pivot[k]+(value-pivot[k])*gain) as Vec3M;
  };
}
