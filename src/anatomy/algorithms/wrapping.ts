/** Analytic circular wrapping for spheres and INFINITE cylinders.
 * Geometry only; no biomechanical force/activation model.
 */
import { add, clamp, cross, dist, dot, norm, orthogonal, scale, sub, unit, type Vec2, type Vec3 } from './math.js';
export interface WorldSphere {kind:'sphere'; id:string;center:Vec3;radius:number}
export interface WorldCylinder {kind:'infinite-cylinder';id:string;center:Vec3;axis:Vec3;radius:number}
export type WorldObstacle=WorldSphere|WorldCylinder;
export interface WrapMemory { sides: Record<string,1|-1> }
export function makeWrapMemory():WrapMemory{return {sides:{}};}
const TAU=2*Math.PI;
const wrapAngle=(x:number)=>(x%TAU+TAU)%TAU;
const dot2=(a:Vec2,b:Vec2)=>a[0]*b[0]+a[1]*b[1];
const length2=(a:Vec2)=>Math.hypot(a[0],a[1]);
const minus2=(a:Vec2,b:Vec2):Vec2=>[a[0]-b[0],a[1]-b[1]];
const tangent=(p:Vec2,direction:1|-1):Vec2=>[-direction*p[1],direction*p[0]];
function minDistanceSegment2D(a:Vec2,b:Vec2):number {
  const d=minus2(b,a);const sq=dot2(d,d);if(sq<1e-20)return length2(a);
  const t=clamp(-dot2(a,d)/sq,0,1);return Math.hypot(a[0]+t*d[0],a[1]+t*d[1]);
}
interface CircleSolution { points:Vec2[];side:1|-1;length:number }
/** Path along the obstacle circumference with tangents at both endpoints. */
function circleRoute(a:Vec2,b:Vec2,radius:number,arcSegments:number,sidePreference?:1|-1):CircleSolution|null {
  const da=length2(a),db=length2(b),tol=radius*1e-7;
  if(da<=radius+tol||db<=radius+tol) throw new Error('Wrap endpoint inside or on obstacle; adjust attachments or obstacle');
  if(minDistanceSegment2D(a,b)>=radius-1e-8*radius)return null;
  const phiA=Math.atan2(a[1],a[0]),phiB=Math.atan2(b[1],b[0]);
  const alphaA=Math.acos(clamp(radius/da,-1,1)),alphaB=Math.acos(clamp(radius/db,-1,1));
  let best:CircleSolution|null=null;
  let preferred:CircleSolution|null=null;
  for(const direction of [1,-1] as const) for(const sA of [-1,1] as const) for(const sB of [-1,1] as const) {
    const angleA=phiA+sA*alphaA,angleB=phiB+sB*alphaB;
    const tA:Vec2=[radius*Math.cos(angleA),radius*Math.sin(angleA)];
    const tB:Vec2=[radius*Math.cos(angleB),radius*Math.sin(angleB)];
    // Tangency alone is insufficient: segment directions must match the circle orientation.
    if(dot2(minus2(tA,a),tangent(tA,direction))<=1e-10)continue;
    if(dot2(minus2(b,tB),tangent(tB,direction))<=1e-10)continue;
    const angle=direction===1?wrapAngle(angleB-angleA):wrapAngle(angleA-angleB);
    if(angle<1e-9||angle>TAU-1e-9)continue;
    const n=Math.max(2,Math.ceil(arcSegments*angle/Math.PI));
    const points:Vec2[]=[a,tA];
    for(let k=1;k<n;k++) {
      const th=angleA+direction*angle*k/n;points.push([radius*Math.cos(th),radius*Math.sin(th)]);
    }
    points.push(tB,b);
    const total=Math.sqrt(da*da-radius*radius)+radius*angle+Math.sqrt(db*db-radius*radius);
    const sol={points,side:direction,length:total};
    if(!best||total<best.length)best=sol;
    if(sidePreference===direction&&(!preferred||total<preferred.length))preferred=sol;
  }
  if(!best)throw new Error('No valid tangent wrapping path');
  // A small hysteresis prevents rapidly alternating the wrap side near symmetric poses.
  return preferred&&preferred.length<=best.length*1.02?preferred:best;
}
export function segmentClearance(a:Vec3,b:Vec3,obstacle:WorldObstacle):number {
  const d=sub(b,a),dd=dot(d,d);
  if(obstacle.kind==='sphere'){
    const t=dd<1e-14?0:clamp(dot(sub(obstacle.center,a),d)/dd,0,1);
    return dist(add(a,scale(d,t)),obstacle.center)-obstacle.radius;
  }
  const axis=unit(obstacle.axis), radial=(p:Vec3)=>{const q=sub(p,obstacle.center);return sub(q,scale(axis,dot(q,axis)));};
  const x=radial(a),y=radial(b),diff=sub(y,x),rs=dot(diff,diff);
  const t=rs<1e-14?0:clamp(-dot(x,diff)/rs,0,1);
  return norm(add(x,scale(diff,t)))-obstacle.radius;
}
function clean(points:readonly Vec3[]):Vec3[]{const out:Vec3[]=[];for(const p of points)if(!out.length||dist(p,out[out.length-1]!)>1e-10)out.push(p);return out;}
export function routeSegment(a:Vec3,b:Vec3,obstacle:WorldObstacle,memory?:WrapMemory,arcSegments=24):Vec3[] {
  if(!(obstacle.radius>0)||!Number.isFinite(obstacle.radius))throw new Error(`Invalid obstacle radius: ${obstacle.id}`);
  const radialDistance=(p:Vec3):number=>{
    const d=sub(p,obstacle.center);
    if(obstacle.kind==='sphere')return norm(d);
    const axis=unit(obstacle.axis);return norm(sub(d,scale(axis,dot(d,axis))));
  };
  if(radialDistance(a)<=obstacle.radius*(1+1e-7)||radialDistance(b)<=obstacle.radius*(1+1e-7))
    throw new Error('Wrap endpoint inside or on obstacle; adjust attachments or obstacle');
  if(segmentClearance(a,b,obstacle)>=-1e-9)return [a,b];
  const preference=memory?.sides[obstacle.id];
  if(obstacle.kind==='sphere'){
    const ra=sub(a,obstacle.center),rb=sub(b,obstacle.center);
    const u=unit(ra),nn=cross(ra,rb),v=norm(nn)>1e-10?unit(cross(unit(nn),u)):orthogonal(u);
    const to2=(p:Vec3):Vec2=>[dot(sub(p,obstacle.center),u),dot(sub(p,obstacle.center),v)];
    const sol=circleRoute(to2(a),to2(b),obstacle.radius,arcSegments,preference);
    if(!sol)return [a,b];
    if(memory)memory.sides[obstacle.id]=sol.side;
    return clean(sol.points.map(p=>add(obstacle.center,add(scale(u,p[0]),scale(v,p[1])))));
  }
  const axis=unit(obstacle.axis),u=orthogonal(axis),v=unit(cross(axis,u));
  const to2=(p:Vec3):Vec2=>[dot(sub(p,obstacle.center),u),dot(sub(p,obstacle.center),v)];
  const a2=to2(a),b2=to2(b);
  const sol=circleRoute(a2,b2,obstacle.radius,arcSegments,preference);
  if(!sol)return [a,b];
  if(memory)memory.sides[obstacle.id]=sol.side;
  const zA=dot(sub(a,obstacle.center),axis),zB=dot(sub(b,obstacle.center),axis);
  // Axial displacement distributed by the projected contour's arc-length.
  const cum:number[]=[0];for(let i=1;i<sol.points.length;i++)cum.push(cum[i-1]!+length2(minus2(sol.points[i]!,sol.points[i-1]!)));
  const total=cum[cum.length-1]!;
  return clean(sol.points.map((p,i)=>add(obstacle.center,add(add(scale(u,p[0]),scale(v,p[1])),scale(axis,zA+(zB-zA)*(cum[i]!/total))))));
}
/** Sequential obstacle routing, then a clearance audit; fails if obstacles overlap incompatibly. */
export function routePolyline(points:readonly Vec3[],obstacles:readonly WorldObstacle[],memory?:WrapMemory,arcSegments=32):Vec3[] {
  if(points.length<2)throw new Error('Need two path points');
  let out=clean(points);
  for(const o of obstacles){const next:Vec3[]=[out[0]!];for(let i=1;i<out.length;i++){const routed=routeSegment(out[i-1]!,out[i]!,o,memory,arcSegments);next.push(...routed.slice(1));}out=clean(next);}
  for(const o of obstacles)for(let i=1;i<out.length;i++){
    // Polygonal chords of an analytic arc are marginally inside the circle/sphere.
    const tol=o.radius*(1-Math.cos(Math.PI/Math.max(8,arcSegments)))+1e-6;
    if(segmentClearance(out[i-1]!,out[i]!,o)<-tol)throw new Error(`Wrapped path still penetrates ${o.id}; increase sampling or revise obstacle layout`);
  }
  return out;
}
