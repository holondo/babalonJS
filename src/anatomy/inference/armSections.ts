import type { AnatomyParameters } from '../parameters';
import type { Vec3M } from '../landmarks';
import { SurfaceBVH } from './observationProxy';
import type { AnatomyMesh } from '../contracts';
import { posedPositions, normalizePose } from '../pose';
import { canonicalAnatomyFactors } from '../binding/anatomySkinDrive';
import { armSectionBasis, armSectorGain } from '../referencePose';

const dot = (a: Vec3M, b: Vec3M) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const subtract = (a: Vec3M,b: Vec3M): Vec3M => [a[0]-b[0],a[1]-b[1],a[2]-b[2]];

export function armSections(parameters: AnatomyParameters, surface: SurfaceBVH) {
  const arms = parameters.referencePose?.chains.filter(chain=>chain.kind==='arm') ?? [];
  return (side: number, forearm: boolean, point: Vec3M, normal: Vec3M, thickness: number) => {
    const chain = arms.find(item=>item.side===side);
    if (!chain) return;
    const start = chain.target[forearm?1:0], end = chain.target[forearm?2:1];
    const axis = subtract(end,start), lengthSq = dot(axis,axis);
    if (lengthSq<.01) return;
    const t = dot(subtract(point,start),axis)/lengthSq;
    // The elbow, shoulder and wrist do not behave like straight cross-sections.
    if (t<.16 || t>.84) return;
    const center = start.map((value,k)=>value+t*axis[k]) as Vec3M;
    const offset = subtract(point,center), radius = Math.hypot(...offset);
    if (radius<.008 || radius>.105) return;
    const radial = offset.map(value=>value/radius) as Vec3M;
    const facing = dot(radial,normal);
    if (facing<.6) return;
    const hit = surface.queryRay(center,radial,.13);
    if (!hit || hit.distance<.012 || Math.abs(hit.distance-radius)>.045) return;
    return thickness+(hit.distance-radius)/facing;
  };
}

function armEnvelope(parameters: AnatomyParameters, arm: AnatomyMesh[]) {
  const f=canonicalAnatomyFactors(parameters.height), pose=normalizePose({});
  const positions: number[]=[], indices: number[]=[];
  for (const mesh of arm) {
    const offset=positions.length/3, posed=posedPositions(mesh,parameters,pose);
    for(let i=0;i<posed.length;i++)positions.push(posed[i]*(i%3===1?f.vertical:f.lateral));
    for(const index of mesh.indices)indices.push(index+offset);
  }
  return new SurfaceBVH({positions:Float32Array.from(positions),indices:Uint32Array.from(indices)});
}

/** Measure the union of the posed arm muscles against the same skin sections. */
export function fitArmSilhouette(parameters: AnatomyParameters, meshes: AnatomyMesh[], target: SurfaceBVH) {
  const evidence: Record<string,{samples:number;beforeMm:number;afterMm:number}> = {};
  const arm=meshes.filter(mesh=>mesh.rigRegion==='arm' && mesh.anatomyId);
  if (!arm.length || !parameters.referencePose?.chains.some(chain=>chain.kind==='arm')) return evidence;
  const envelope=armEnvelope(parameters,arm);
  type Spoke = { origin:Vec3M; direction:Vec3M; radius:number; skin:number };
  const validation: { chain: typeof parameters.referencePose.chains[number]; segment:0|1; key:string; spokes:Spoke[] }[]=[];
  for (const chain of parameters.referencePose?.chains ?? []) {
    if(chain.kind!=='arm')continue;
    const profiles: [number[],number[]]=[[],[]];
    for(const segment of [0,1] as const) {
      const a=chain.target[segment], axis=subtract(chain.target[segment+1],a);
      const length=Math.hypot(...axis);
      if(length<.1){profiles[segment]=[1,1,1];continue;}
      const [u,v]=armSectionBasis(axis);
      let before=0,after=0,samples=0;
      const spokes:Spoke[]=[];
      for(const t of [1/6,2/6,.5,4/6,5/6]) {
        const center=a.map((value,k)=>value+axis[k]*t) as Vec3M;
        const train:{angle:number;ratio:number}[]=[], held:{angle:number;radius:number;skin:number}[]=[];
        for(let spoke=0;spoke<16;spoke++) {
          const angle=spoke*Math.PI/8, radial=u.map((value,k)=>value*Math.cos(angle)+v[k]*Math.sin(angle)) as Vec3M;
          const skin=target.queryRay(center,radial,.12)?.distance;
          const origin=center.map((value,k)=>value+radial[k]*.12) as Vec3M;
          const direction=radial.map(value=>-value) as Vec3M;
          const hit=envelope.queryRay(origin,direction,.12);
          if(!skin||!hit||skin<.015||skin>.095)continue;
          const radius=.12-hit.distance;
          if(radius<.01||Math.abs(skin-radius)>.04)continue;
          if(spoke%2){held.push({angle,radius,skin});spokes.push({origin,direction,radius,skin});}
          else train.push({angle,ratio:(skin-.004)/radius});
        }
        train.sort((a,b)=>a.ratio-b.ratio);
        const clamp=(x:number)=>Math.max(.8,Math.min(1.25,x));
        const scale=train.length>=4&&held.length>=4?clamp(train[Math.floor(train.length/2)].ratio):1;
        const error=(gains:number[])=>held.reduce((sum,s)=>sum+Math.abs(s.skin-.004-s.radius*armSectorGain(gains,s.angle)),0);
        const crossings=(gains:number[])=>held.filter(s=>s.radius*armSectorGain(gains,s.angle)>s.skin+.002).length;
        const neutral=[1,1,1,1];
        let accepted=neutral;
        if(train.length>=4&&held.length>=4){
          const directional=neutral.map((_,sector)=>{
            let sum=scale, weight=1;
            for(const sample of train){
              const w=Math.max(0,Math.cos(sample.angle-sector*Math.PI/2))**4;
              sum+=w*clamp(sample.ratio);weight+=w;
            }
            return clamp(sum/weight);
          });
          for(const candidate of [neutral.map(()=>scale),directional]){
            if(error(candidate)<error(accepted)-.0006*held.length&&crossings(candidate)<=crossings(neutral))accepted=candidate;
          }
        }
        profiles[segment].push(...accepted);
        before+=error(neutral);after+=error(accepted);samples+=held.length;
      }
      if(samples){
        const key=`${chain.side<0?'L':'R'}.${segment===0?'upper':'forearm'}`;
        evidence[key]={samples,beforeMm:before/samples*1000,afterMm:after/samples*1000};
        validation.push({chain,segment,key,spokes});
      }
    }
    // Smooth along the segment as well as around it. Independently fitted
    // sections can otherwise produce a bulge between neighbouring tendons.
    const smoothProfiles = profiles.map(profile=>profile.length===20
      ? profile.map((gain,i)=>(.5*gain+.25*(profile[i-4]??1)+.25*(profile[i+4]??1)))
      : profile) as [number[],number[]];
    if(smoothProfiles.some(profile=>profile.some(v=>v!==1)))chain.radialFit=smoothProfiles;
  }
  if (validation.some(entry=>entry.chain.radialFit)) {
    const fitted=armEnvelope(parameters,arm);
    for (const {chain,segment,key,spokes} of validation) {
      if(!chain.radialFit?.[segment].some(v=>v!==1))continue;
      let error=0,beforeCrossings=0,afterCrossings=0;
      for(const {origin,direction,skin,radius} of spokes){
        const hit=fitted.queryRay(origin,direction,.12), measured=hit?.distance===undefined?0:.12-hit.distance;
        error+=Math.abs(skin-.004-measured);
        if(radius>skin+.002)beforeCrossings++;
        if(measured>skin+.002)afterCrossings++;
      }
      const entry=evidence[key], afterMm=error/spokes.length*1000;
      if(afterMm<entry.beforeMm-.3 && afterCrossings<=beforeCrossings)entry.afterMm=afterMm;
      else {chain.radialFit[segment]=[1,1,1];entry.afterMm=entry.beforeMm;}
    }
    for(const {chain} of validation) if(chain.radialFit?.every(profile=>profile.every(v=>v===1))) delete chain.radialFit;
  }
  return evidence;
}
