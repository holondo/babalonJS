/** Analytic signed distance sampling and bounded grid baking (CPU reference).
 * Negative means inside; this is a distance to the analytic obstacle, not a mesh-to-SDF converter.
 */
import { dot, norm, scale, sub, type Vec3 } from './math.js';
import type { WorldObstacle } from './wrapping.js';
export function obstacleSDF(p:Vec3,obstacle:WorldObstacle):number {
  const rel=sub(p,obstacle.center);
  if(obstacle.kind==='sphere')return norm(rel)-obstacle.radius;
  const axis=obstacle.axis,den=dot(axis,axis);
  if(den<1e-12)throw new Error('Zero obstacle cylinder axis');
  const radial=sub(rel,scale(axis,dot(rel,axis)/den));
  return norm(radial)-obstacle.radius;
}
export interface ScalarGrid { origin:Vec3;step:Vec3;size:readonly[number,number,number];distances:Float32Array }
export function bakeObstacleSDF(obstacles:readonly WorldObstacle[],min:Vec3,max:Vec3,size:readonly[number,number,number]):ScalarGrid {
  if(!obstacles.length)throw new Error('SDF bake requires an obstacle');
  const [nx,ny,nz]=size;
  if([nx,ny,nz].some(n=>!Number.isInteger(n)||n<2)||nx*ny*nz>10_000_000)throw new Error('Unsafe SDF grid size');
  const step:Vec3=[(max[0]-min[0])/(nx-1),(max[1]-min[1])/(ny-1),(max[2]-min[2])/(nz-1)];
  if(step.some(v=>!(v>0)||!Number.isFinite(v)))throw new Error('Invalid SDF bounds');
  const distances=new Float32Array(nx*ny*nz);
  for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
    const p:Vec3=[min[0]+x*step[0],min[1]+y*step[1],min[2]+z*step[2]];
    let d=Infinity;for(const o of obstacles)d=Math.min(d,obstacleSDF(p,o));
    distances[(z*ny+y)*nx+x]=d;
  }
  return {origin:min,step,size,distances};
}
/** Trilinear interpolation inside the stored grid. Returns infinity outside, not extrapolated values. */
export function sampleSDF(grid:ScalarGrid,p:Vec3):number {
  const xyz=p.map((v,i)=>(v-grid.origin[i]!)/grid.step[i]!) as [number,number,number];
  if(xyz.some((v,i)=>v<0||v>grid.size[i]!-1))return Infinity;
  const [nx,ny]=grid.size,base=xyz.map((v,i)=>Math.min(Math.floor(v),grid.size[i]!-2)) as [number,number,number];
  const t=xyz.map((v,i)=>v-base[i]!) as [number,number,number];
  const at=(x:number,y:number,z:number)=>grid.distances[(z*ny+y)*nx+x]!;
  let sum=0;
  for(let dz=0;dz<2;dz++)for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
    const w=(dx?t[0]:1-t[0])*(dy?t[1]:1-t[1])*(dz?t[2]:1-t[2]);
    sum+=at(base[0]+dx,base[1]+dy,base[2]+dz)*w;
  }
  return sum;
}
