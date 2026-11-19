/** CPU reference implementation of ONE XPBD constraint: tetrahedral volume preservation.
 * Not a complete muscle/skin FEM simulator: no shear, stretch, collisions or material models.
 * Useful as a reproducible baseline before a WebGPU implementation.
 */
import { add, cross, dot, normSq, scale, sub, type Vec3 } from './math.js';
export interface TetConstraint { ids:readonly[number,number,number,number];restVolume:number;lambda:number }
export function signedTetVolume(a:Vec3,b:Vec3,c:Vec3,d:Vec3):number {
  return dot(sub(b,a),cross(sub(c,a),sub(d,a)))/6;
}
export function makeTetConstraints(vertices:readonly Vec3[],tets:readonly (readonly[number,number,number,number])[]):TetConstraint[] {
  return tets.map(ids=>{
    const p=ids.map(i=>vertices[i]);
    if(new Set(ids).size!==4||p.some(v=>!v||v.some(x=>!Number.isFinite(x))))throw new Error('Invalid tetrahedron vertices');
    const volume=signedTetVolume(p[0]!,p[1]!,p[2]!,p[3]!);
    if(!(volume>1e-12))throw new Error('Invalid or inverted rest tetrahedron');
    return {ids,restVolume:volume,lambda:0};
  });
}
/** Positions are mutated deliberately, unlike the non-destructive geometry builders. */
export function projectTetVolumes(positions:Vec3[],inverseMasses:readonly number[],constraints:TetConstraint[],dt:number,iterations=6,compliance=0):void {
  if(!(dt>0)||!(compliance>=0)||iterations<1||!Number.isInteger(iterations))throw new Error('Invalid XPBD timestep');
  for(const c of constraints)c.lambda=0;
  const alpha=compliance/(dt*dt);
  for(let step=0;step<iterations;step++)for(const c of constraints){
    const [i,j,k,l]=c.ids,[a,b,cc,d]=[positions[i]!,positions[j]!,positions[k]!,positions[l]!];
    if(!a||!b||!cc||!d)throw new Error('Invalid tet indices');
    const gb=scale(cross(sub(cc,a),sub(d,a)),1/6);
    const gc=scale(cross(sub(d,a),sub(b,a)),1/6);
    const gd=scale(cross(sub(b,a),sub(cc,a)),1/6);
    const ga=scale(add(add(gb,gc),gd),-1);
    const gradients=[ga,gb,gc,gd];
    const diff=signedTetVolume(a,b,cc,d)-c.restVolume;
    let denominator=alpha;
    for(let n=0;n<4;n++)denominator+=(inverseMasses[c.ids[n]!]??0)*normSq(gradients[n]!);
    if(denominator<1e-20)continue;
    const deltaLambda=(-diff-alpha*c.lambda)/denominator;
    c.lambda+=deltaLambda;
    for(let n=0;n<4;n++){
      const index=c.ids[n]!,inv=inverseMasses[index]??0;
      if(inv>0)positions[index]=add(positions[index]!,scale(gradients[n]!,inv*deltaLambda));
    }
  }
}
