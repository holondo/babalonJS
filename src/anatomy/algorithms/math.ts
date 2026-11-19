/** Small deterministic geometry kernel, independent of Babylon.js and DOM. Metres, right-handed. */
export type Vec3 = readonly [number, number, number];
export type Vec2 = readonly [number, number];
export const EPS = 1e-10;
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0]*s, a[1]*s, a[2]*s];
export const dot = (a: Vec3, b: Vec3) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
export const normSq = (a: Vec3) => dot(a,a);
export const norm = (a: Vec3) => Math.sqrt(normSq(a));
export const dist = (a: Vec3, b: Vec3) => norm(sub(a,b));
export const mix = (a: Vec3,b: Vec3,t: number): Vec3 => add(scale(a,1-t),scale(b,t));
export const clamp = (x: number,a: number,b: number) => Math.min(b,Math.max(a,x));
export const smoothstep = (t: number) => { const s=clamp(t,0,1);return s*s*(3-2*s); };
export const finite = (v: Vec3) => v.every(Number.isFinite);
export function unit(a: Vec3): Vec3 { const n=norm(a); if(n<EPS) throw new Error('Cannot normalize a zero-length vector'); return scale(a,1/n); }
export function orthogonal(axis: Vec3): Vec3 {
  const u=unit(axis);
  const candidate: Vec3 = Math.abs(u[0])<=Math.abs(u[1])&&Math.abs(u[0])<=Math.abs(u[2])?[1,0,0]:Math.abs(u[1])<=Math.abs(u[2])?[0,1,0]:[0,0,1];
  return unit(cross(u,candidate));
}
/** Minimal rotation mapping one direction to another (defined for antiparallel inputs). */
export function rotateFromTo(v: Vec3, from: Vec3, to: Vec3): Vec3 {
  const a=unit(from), b=unit(to), c=clamp(dot(a,b),-1,1);
  if(c>1-1e-10) return v;
  if(c< -1+1e-10) { const ax=orthogonal(a);return add(scale(v,-1),scale(ax,2*dot(ax,v))); }
  const axis=unit(cross(a,b));
  return add(add(scale(v,c),scale(cross(axis,v),Math.sqrt(1-c*c))),scale(axis,dot(axis,v)*(1-c)));
}
/** Unit normal, binormal, tangent. Each is continuous relative to the preceding sample. */
export interface Frame { tangent: Vec3; normal: Vec3; binormal: Vec3 }
export function framesAlong(points: readonly Vec3[]): Frame[] {
  if(points.length<2) throw new Error('At least two points required');
  const tangents=points.map((p,i)=>{
    const d=i===0?sub(points[1]!,p):i===points.length-1?sub(p,points[i-1]!):sub(points[i+1]!,points[i-1]!);
    return norm(d)<EPS?null:unit(d);
  });
  const first=tangents.find((t):t is Vec3=>t!==null);
  if(!first) throw new Error('Path is degenerate');
  let prev: Frame={tangent:first, normal:orthogonal(first),binormal:[0,0,0]};
  prev={...prev,binormal:unit(cross(prev.tangent,prev.normal))};
  const out:Frame[]=[];
  for(const t0 of tangents) {
    const t=t0??prev.tangent;
    const rotated=rotateFromTo(prev.normal,prev.tangent,t);
    const n0=sub(rotated,scale(t,dot(t,rotated)));
    const normal=unit(norm(n0)<EPS?orthogonal(t):n0);
    const next:Frame={tangent:t,normal,binormal:unit(cross(t,normal))};
    out.push(next);prev=next;
  }
  return out;
}
/** Resample without changing endpoints. Parameter is cumulative arc length, not vertex index. */
export function resamplePolyline(points: readonly Vec3[], count: number): Vec3[] {
  if(!Number.isInteger(count)||count<2||points.length<2) throw new Error('Invalid path resolution');
  const filtered=[points[0]!];
  for(let i=1;i<points.length;i++) if(dist(points[i]!,filtered[filtered.length-1]!)>EPS)filtered.push(points[i]!);
  if(filtered.length<2) throw new Error('Degenerate path');
  const cum=[0];for(let i=1;i<filtered.length;i++)cum.push(cum[i-1]!+dist(filtered[i]!,filtered[i-1]!));
  const total=cum[cum.length-1]!, result:Vec3[]=[];let k=1;
  for(let i=0;i<count;i++) {
    const at=total*(i/(count-1));while(k<cum.length-1&&cum[k]!<at)k++;
    const f=(at-cum[k-1]!)/(cum[k]!-cum[k-1]!);
    result.push(mix(filtered[k-1]!,filtered[k]!,clamp(f,0,1)));
  }
  return result;
}
export const pathLength=(points:readonly Vec3[])=>points.reduce((sum,p,i)=>i?sum+dist(points[i-1]!,p):sum,0);
export function catmullRom(points:readonly Vec3[],stepsPerSegment=8):Vec3[] {
  if(points.length<2)throw new Error('Need two control points');
  if(points.length===2)return [...points];
  const out:Vec3[]=[];
  for(let i=0;i<points.length-1;i++) {
    const a=points[Math.max(0,i-1)]!,b=points[i]!,c=points[i+1]!,d=points[Math.min(points.length-1,i+2)]!;
    for(let k=0;k<stepsPerSegment;k++) {
      const t=k/stepsPerSegment,t2=t*t,t3=t2*t;
      const f=(j:number)=>0.5*(2*b[j]!+(-a[j]!+c[j]!)*t+(2*a[j]!-5*b[j]!+4*c[j]!-d[j]!)*t2+(-a[j]!+3*b[j]!-3*c[j]!+d[j]!)*t3);
      out.push([f(0),f(1),f(2)]);
    }
  }
  out.push(points[points.length-1]!);return out;
}
