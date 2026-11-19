/** Muscle mesh builder. Aimed at fusiform/strap-like muscles, NOT sheet-like pectoralis/abdominals. */
import { add, dist, framesAlong, scale, type Vec3 } from './math.js';
import type { MeshGeometry, MuscleArchitecture } from './types.js';
function radiusProfile(t:number,kind:MuscleArchitecture['kind'],taper:number):number {
  const wave=Math.pow(Math.max(0,Math.sin(Math.PI*t)),0.85);
  const strap=Math.min(1,t/0.12,(1-t)/0.12);
  return taper+(1-taper)*(kind==='fusiform'?wave:Math.max(0,strap));
}
export function signedMeshVolume(mesh: { positions: ArrayLike<number>; indices: Uint32Array }):number {
  const p=mesh.positions,t=mesh.indices;let sum=0;
  for(let i=0;i<t.length;i+=3){const a=t[i]!*3,b=t[i+1]!*3,c=t[i+2]!*3;
    const ux=p[a]!,uy=p[a+1]!,uz=p[a+2]!,vx=p[b]!,vy=p[b+1]!,vz=p[b+2]!,wx=p[c]!,wy=p[c+1]!,wz=p[c+2]!;
    sum+=ux*(vy*wz-vz*wy)+uy*(vz*wx-vx*wz)+uz*(vx*wy-vy*wx);
  }
  return sum/6;
}
export function meshVolume(mesh: Pick<MeshGeometry,'positions'|'indices'>):number { return Math.abs(signedMeshVolume(mesh)); }
/** Normal-weighted sum of triangles. Correct outward normals require consistent winding. */
export function calculateNormals(positions:Float32Array,indices:Uint32Array):Float32Array {
  const n=new Float32Array(positions.length);
  // Scalar form of cross(vb - va, vc - va): same operations without per-triangle arrays.
  for(let i=0;i<indices.length;i+=3){const a=indices[i]!*3,b=indices[i+1]!*3,c=indices[i+2]!*3;
    const ux=positions[b]!-positions[a]!,uy=positions[b+1]!-positions[a+1]!,uz=positions[b+2]!-positions[a+2]!;
    const vx=positions[c]!-positions[a]!,vy=positions[c+1]!-positions[a+1]!,vz=positions[c+2]!-positions[a+2]!;
    const x=uy*vz-uz*vy,y=uz*vx-ux*vz,z=ux*vy-uy*vx;
    n[a]!+=x;n[a+1]!+=y;n[a+2]!+=z;n[b]!+=x;n[b+1]!+=y;n[b+2]!+=z;n[c]!+=x;n[c+1]!+=y;n[c+2]!+=z;
  }
  for(let i=0;i<n.length;i+=3){const size=Math.hypot(n[i]!,n[i+1]!,n[i+2]!);if(size>1e-12){n[i]!/=size;n[i+1]!/=size;n[i+2]!/=size;}}
  return n;
}
export function loftMuscle(path:readonly Vec3[],architecture:MuscleArchitecture,radialSegments=16):MeshGeometry {
  if(path.length<3)throw new Error('Loft requires at least 3 path samples');
  const {targetVolume,aspectRatio,endTaper,kind}=architecture;
  if(!(targetVolume>0)||!(aspectRatio>0)||!(endTaper>0&&endTaper<=1)||!['fusiform','strap'].includes(kind))throw new Error('Invalid muscle architecture');
  if(!Number.isInteger(radialSegments)||radialSegments<6||radialSegments>1024)throw new Error('Invalid radial segments');
  const cumulative=[0];for(let i=1;i<path.length;i++){const len=dist(path[i]!,path[i-1]!);if(len<1e-9)throw new Error('Duplicate path samples');cumulative.push(cumulative[i-1]!+len);}
  const length=cumulative[cumulative.length-1]!,frames=framesAlong(path);
  if(length<1e-7)throw new Error('Degenerate muscle path');
  const profiles=cumulative.map(s=>radiusProfile(s/length,kind,endTaper));
  let areaIntegral=0;
  for(let i=1;i<path.length;i++)areaIntegral+=(cumulative[i]!-cumulative[i-1]!)*(profiles[i-1]!**2+profiles[i]!**2)*Math.PI/2;
  const baseRadius=Math.sqrt(targetVolume/areaIntegral);
  const ratioSqrt=Math.sqrt(aspectRatio),ringCount=path.length,verts:number[]=[];
  for(let i=0;i<ringCount;i++){
    const f=frames[i]!,r=profiles[i]!*baseRadius,rx=r*ratioSqrt,ry=r/ratioSqrt;
    for(let j=0;j<radialSegments;j++){
      const th=2*Math.PI*j/radialSegments;
      const v=add(path[i]!,add(scale(f.normal,rx*Math.cos(th)),scale(f.binormal,ry*Math.sin(th))));
      verts.push(...v);
    }
  }
  const startCap=verts.length/3;verts.push(...path[0]!);
  const endCap=verts.length/3;verts.push(...path[ringCount-1]!);
  const triangles:number[]=[];
  for(let i=0;i<ringCount-1;i++)for(let j=0;j<radialSegments;j++){
    const jj=(j+1)%radialSegments,a=i*radialSegments+j,b=(i+1)*radialSegments+j;
    const c=(i+1)*radialSegments+jj,d=i*radialSegments+jj;
    triangles.push(a,d,b,b,d,c);
  }
  for(let j=0;j<radialSegments;j++){
    const jj=(j+1)%radialSegments;
    triangles.push(startCap,jj,j);
    const offset=(ringCount-1)*radialSegments;
    triangles.push(endCap,offset+j,offset+jj);
  }
  const positions=new Float32Array(verts),indices=new Uint32Array(triangles);
  return {positions,indices,normals:calculateNormals(positions,indices)};
}
