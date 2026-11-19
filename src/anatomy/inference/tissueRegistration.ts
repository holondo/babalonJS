import type { AnatomyParameters } from '../parameters';
import type { AnatomyResult } from '../contracts';
import type { BodyHints } from './bodyEvidence';
import { canonicalAnatomyFactors, sourcePointToCanonical, type SourceCanonicalFrame } from '../binding/anatomySkinDrive';
import { surfaceFitPoint } from '../surfaceFit';
import { tissueFitPoint, type TissueFit, type TissueHintName } from '../tissueFit';
import type { Vec3M } from '../landmarks';
import { superficialLandmarks } from '../geometry';
import { skinFeatureCoordinates } from '../skinFeatures';

/** Semantic constraints have a separate field: they never participate in bone
 * proportion estimation or the shared skeletal registration. */
export function registerTissueHints(p:AnatomyParameters,result:Omit<AnatomyResult,'id'|'computeMs'>,frame:SourceCanonicalFrame,hints:BodyHints){
  const f=canonicalAnatomyFactors(p.height),skin=result.meshes.skin[0].positions;
  const canonical=(q:number[])=>q.map((v,k)=>v*(k===1?f.vertical:f.lateral)) as Vec3M;
  const warped=(q:number[])=>p.surfaceFit?surfaceFitPoint(p.surfaceFit,canonical(q)):canonical(q);
  function anterior(x:number,y:number):Vec3M{
    let best=Infinity,out:Vec3M=[x,y,0];
    for(let i=0;i<skin.length;i+=3){const q=canonical(Array.from(skin.subarray(i,i+3)));if(q[2]<0)continue;const d=(q[0]-x)**2+(q[1]-y)**2;if(d<best){best=d;out=q;}}
    return out;
  }
  const reference=superficialLandmarks(p);
  const details = skinFeatureCoordinates(p,reference.navel);
  const sources:Partial<Record<TissueHintName,Vec3M>>={};
  for(const side of ['L','R'] as const){
    const path=reference.inguinal[side==='L'?0:1];
    for(const [i,label] of (['inner','middle','outer'] as const).entries()){
      const q=warped(path[i]);sources[`inguinal_${side}_${label}`]=anterior(q[0],q[1]);
    }
  }
  const rest=result.meshes.skin[0].materialPositions??skin;
  for(const [j,name] of (['navel','nipple_L','nipple_R'] as const).entries()){
    const [x,y]=details[j];let best=Infinity;
    for(let i=0;i<rest.length;i+=3){if(rest[i+2]<.2)continue;const d=(rest[i]-x)**2+(rest[i+1]-y)**2;if(d<best){best=d;sources[name]=canonical(Array.from(skin.subarray(i,i+3)));}}
  }
  const field:TissueFit={version:1,anchors:[]},targets:Vec3M[]=[];
  for(const [name,point] of Object.entries(hints.tissues??{})){
    const source=sources[name as TissueHintName];if(!source||!point||point.length!==3||!point.every(Number.isFinite))continue;
    const target=sourcePointToCanonical(frame,...point as Vec3M),distance=Math.hypot(...target.map((v,k)=>v-source[k]));
    if(distance>.12)throw Error('A surface hint is too far from its anatomical region. Check facing and point placement.');
    targets.push(target);field.anchors.push({name:name as TissueHintName,source,delta:target.map((v,k)=>Math.max(-.05,Math.min(.05,v-source[k]))) as Vec3M,radius:name.startsWith('nipple')?.15:name==='navel'?.16:.14});
  }
  const error=()=>field.anchors.map((a,i)=>Math.hypot(...tissueFitPoint(field,a.source).map((v,k)=>v-targets[i][k]))*1000);
  const before=field.anchors.map((a,i)=>Math.hypot(...a.source.map((v,k)=>v-targets[i][k]))*1000);
  for(let iteration=0;iteration<12;iteration++){
    const residual=field.anchors.map((a,i)=>tissueFitPoint(field,a.source).map((v,k)=>targets[i][k]-v));
    field.anchors.forEach((a,i)=>a.delta=a.delta.map((v,k)=>Math.max(-.06,Math.min(.06,v+residual[i][k]*.65))) as Vec3M);
  }
  // Exact point matching must yield to a regular map. Sample the soft-tissue
  // neighbourhood, including the depth transition, and back off if it folds.
  const determinant=()=>{
    let minimum=1;const h=.001;
    for(const a of field.anchors)for(let x=-2;x<=2;x++)for(let y=-2;y<=2;y++)for(let z=-4;z<=1;z++){
      const q=[a.source[0]+x*a.radius/3,a.source[1]+y*a.radius/3,a.source[2]+z*.02];
      const axes=[0,1,2].map(k=>{const lo=q.slice(),hi=q.slice();lo[k]-=h;hi[k]+=h;const u=tissueFitPoint(field,lo),v=tissueFitPoint(field,hi);return v.map((n,j)=>(n-u[j])/(2*h));});
      const [u,v,w]=axes,det=u[0]*(v[1]*w[2]-v[2]*w[1])-v[0]*(u[1]*w[2]-u[2]*w[1])+w[0]*(u[1]*v[2]-u[2]*v[1]);minimum=Math.min(minimum,det);
    }return minimum;
  };
  let minJacobian=determinant(),appliedFraction=1;
  for(let step=0;step<24&&minJacobian<.25;step++){field.anchors.forEach(a=>a.delta=a.delta.map(v=>v*.85) as Vec3M);appliedFraction*=.85;minJacobian=determinant();}
  return{field:field.anchors.length?field:undefined,evidence:{count:before.length,beforeMm:before,afterMm:error(),boneDisplacementMm:0 as const,minJacobian,appliedFraction}};
}
