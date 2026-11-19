/** Non-destructive, low-fidelity surface coupling for PREVIEWS ONLY.
 * NOT a collision-aware skin solver and NOT a physical simulation.
 * The source positions/indices/UVs/materials remain owned by the caller and untouched.
 */
import { clamp, dist, smoothstep, sub, scale, add, type Vec3 } from './math.js';
export interface TissueMotionControl {rest:Vec3;posed:Vec3;radius:number;strength?:number}
export function previewSkinPositions(source:Float32Array,controls:readonly TissueMotionControl[],maxDisplacement=0.06):Float32Array {
  if(source.length%3)throw new Error('Position buffer must contain XYZ triples');
  if(!(maxDisplacement>=0)||!Number.isFinite(maxDisplacement))throw new Error('Invalid displacement cap');
  for(const c of controls)if(!(c.radius>0)||c.rest.some(x=>!Number.isFinite(x))||c.posed.some(x=>!Number.isFinite(x)))throw new Error('Invalid skin control');
  const result=new Float32Array(source);
  for(let i=0;i<source.length;i+=3){
    const p:Vec3=[source[i]!,source[i+1]!,source[i+2]!];
    let wx=0,wy=0,wz=0,total=0;
    for(const c of controls){
      const k=dist(p,c.rest)/c.radius;if(k>=1)continue;
      const w=smoothstep(1-k)*clamp(c.strength??1,0,1);
      const d=sub(c.posed,c.rest);wx+=d[0]*w;wy+=d[1]*w;wz+=d[2]*w;total+=w;
    }
    if(!total)continue;
    // Multiple neighboring controls normalize; one control retains the falloff to zero.
    let move:Vec3=[wx/Math.max(1,total),wy/Math.max(1,total),wz/Math.max(1,total)];
    const size=Math.hypot(...move);if(size>maxDisplacement)move=scale(move,maxDisplacement/size);
    const q=add(p,move);result[i]=q[0];result[i+1]=q[1];result[i+2]=q[2];
  }
  return result;
}
