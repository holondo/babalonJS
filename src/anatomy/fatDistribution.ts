import type { AnatomyParameters } from './parameters';
export const fatRegions=['chest','shoulders','abdomen','inguinal'] as const;
export type FatDistribution=Record<typeof fatRegions[number],number>;
export function normalizeFatDistribution(input:unknown):FatDistribution|undefined{
  if(!input||typeof input!=='object')return;
  const p=input as FatDistribution;if(fatRegions.some(key=>!Number.isFinite(p[key])))return;
  return Object.fromEntries(fatRegions.map(key=>[key,Math.max(2,Math.min(35,p[key]))])) as FatDistribution;
}
/** A smooth explicit prior, not a tissue measurement recovered from skin. */
export function fatThickness(p:AnatomyParameters,q:readonly number[]){
  const f=p.fatDistribution;if(!f)return p.fat;
  const weights=fatRegionWeights(q),mask=weights.reduce((sum,v)=>sum+v,0);
  return p.fat*(1-mask)+weights.reduce((sum,w,i)=>sum+w*f[fatRegions[i]],0);
}
export function fatRegionWeights(q:readonly number[]){
  const smooth=(a:number,b:number,v:number)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
  const chest=smooth(1.18,1.29,q[1]),pelvis=1-smooth(.98,1.08,q[1]),shoulder=chest*smooth(.14,.25,Math.abs(q[0])),mask=smooth(.78,.9,q[1])*(1-smooth(1.46,1.52,q[1]))*(1-smooth(.34,.48,Math.abs(q[0])));
  return [(1-pelvis)*chest*(1-shoulder)*mask,shoulder*mask,(1-pelvis)*(1-chest)*(1-shoulder)*mask,pelvis*(1-shoulder)*mask];
}
