import type { AnatomyMesh } from './contracts';
import type { Vec3M } from './landmarks';

export const tissueHintLabels = {
  nipple_L: 'Left nipple', nipple_R: 'Right nipple', navel: 'Navel',
  inguinal_L_inner: 'Left inguinal fold: inner end', inguinal_L_middle: 'Left inguinal fold: middle', inguinal_L_outer: 'Left inguinal fold: outer end',
  inguinal_R_inner: 'Right inguinal fold: inner end', inguinal_R_middle: 'Right inguinal fold: middle', inguinal_R_outer: 'Right inguinal fold: outer end',
} as const;
export type TissueHintName = keyof typeof tissueHintLabels;
export type TissueHints = Partial<Record<TissueHintName, Vec3M>>;
export interface TissueFit { version: 1; anchors: { name:TissueHintName; source:Vec3M; delta:Vec3M; radius:number }[]; }
export function normalizeTissueFit(value:unknown):TissueFit|undefined {
  const p=value as TissueFit|undefined;
  if(p?.version!==1||!Array.isArray(p.anchors)||p.anchors.length>9)return;
  if(p.anchors.some(a=>!a||typeof a!=='object'||!(a.name in tissueHintLabels)||!Array.isArray(a.source)||a.source.length!==3||a.source.some(v=>!Number.isFinite(v))||!Array.isArray(a.delta)||a.delta.length!==3||a.delta.some(v=>!Number.isFinite(v)||Math.abs(v)>.06)||!Number.isFinite(a.radius)||a.radius<.02||a.radius>.2))return;
  return structuredClone(p);
}
/** Compact-support soft-tissue correction. The posterior and deep tissues are
 * protected; bones and ligaments are excluded by the generation pipeline. */
export function tissueFitPoint(field:TissueFit,p:readonly number[]):Vec3M {
  const out=[...p] as Vec3M;let total=0;const delta=[0,0,0];
  for(const a of field.anchors){
    const r=Math.hypot(p[0]-a.source[0],p[1]-a.source[1],(p[2]-a.source[2])*.7)/a.radius;
    if(r>=1)continue;
    const depth=Math.max(0,Math.min(1,1+(p[2]-a.source[2])/.08));
    const w=(1-r)**4*(1+4*r)*depth*depth*(3-2*depth);
    total+=w;for(let k=0;k<3;k++)delta[k]+=a.delta[k]*w;
  }
  for(let k=0;k<3;k++)out[k]+=delta[k]/Math.max(1,total);
  return out;
}
export function applyTissueFit(mesh:AnatomyMesh,field:TissueFit,height:number){
  const f=[18/height,1.8/17.5,18/height];
  for(let i=0;i<mesh.positions.length;i+=3){const p=tissueFitPoint(field,[mesh.positions[i]*f[0],mesh.positions[i+1]*f[1],mesh.positions[i+2]*f[2]]);for(let k=0;k<3;k++)mesh.positions[i+k]=p[k]/f[k];}
}
