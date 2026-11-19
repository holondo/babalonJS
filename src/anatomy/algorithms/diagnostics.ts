import { cross, dot, norm, sub, type Vec3 } from './math.js';
import { meshVolume, signedMeshVolume } from './loft.js';
import type { IndexedMesh } from './types.js';
export interface MeshReport {valid:boolean;triangles:number;vertices:number;degenerateTriangles:number;nonManifoldEdges:number;boundaryEdges:number;volume:number;issues:string[]}
export function inspectMesh(mesh:IndexedMesh):MeshReport {
  const issues:string[]=[];const {positions:p,indices:ids}=mesh;
  if(p.length%3!==0||ids.length%3!==0)issues.push('Invalid positions or index buffer length');
  const vertices=p.length/3;let degenerates=0,invalidIndices=0;
  const edgeCounts=new Map<string,number>();
  for(let k=0;k<ids.length;k+=3){
    const [a,b,c]=[ids[k]!,ids[k+1]!,ids[k+2]!];
    if([a,b,c].some(i=>i>=vertices)||[a,b,c].some(i=>!Number.isInteger(i))){invalidIndices++;continue;}
    const A:Vec3=[p[3*a]!,p[3*a+1]!,p[3*a+2]!],B:Vec3=[p[3*b]!,p[3*b+1]!,p[3*b+2]!],C:Vec3=[p[3*c]!,p[3*c+1]!,p[3*c+2]!];
    if(norm(cross(sub(B,A),sub(C,A)))<1e-12)degenerates++;
    for(const [u,v] of [[a,b],[b,c],[c,a]]){const id=`${Math.min(u!,v!)}:${Math.max(u!,v!)}`;edgeCounts.set(id,(edgeCounts.get(id)??0)+1);}
  }
  const boundaryEdges=[...edgeCounts.values()].filter(n=>n===1).length;
  const nonManifoldEdges=[...edgeCounts.values()].filter(n=>n>2).length;
  if(invalidIndices)issues.push(`${invalidIndices} triangle(s) with invalid indices`);
  if(degenerates)issues.push(`${degenerates} degenerate triangles`);
  if(nonManifoldEdges)issues.push(`${nonManifoldEdges} non-manifold edges`);
  if(boundaryEdges)issues.push(`${boundaryEdges} open boundary edges`);
  if([...p].some(x=>!Number.isFinite(x)))issues.push('Non-finite positions');
  const volume=issues.some(v=>v.includes('invalid indices')||v.includes('buffer length'))?0:meshVolume(mesh);
  if(!(volume>0))issues.push('Zero or invalid enclosed volume');
  if(signedMeshVolume(mesh)<-1e-12)issues.push('Inward-facing mesh winding (negative signed volume)');
  return {valid:issues.length===0,triangles:ids.length/3,vertices,degenerateTriangles:degenerates,nonManifoldEdges,boundaryEdges,volume,issues};
}
export interface PathReport {length:number;maxTurnRadians:number;finite:boolean}
export function inspectPath(path:readonly Vec3[]):PathReport {
  let length=0,maxTurnRadians=0;
  for(let i=1;i<path.length;i++)length+=norm(sub(path[i]!,path[i-1]!));
  for(let i=1;i<path.length-1;i++){
    const a=sub(path[i]!,path[i-1]!),b=sub(path[i+1]!,path[i]!);
    const denom=norm(a)*norm(b);if(denom>1e-12)maxTurnRadians=Math.max(maxTurnRadians,Math.acos(Math.max(-1,Math.min(1,dot(a,b)/denom))));
  }
  return {length,maxTurnRadians,finite:path.every(p=>p.every(Number.isFinite))};
}
