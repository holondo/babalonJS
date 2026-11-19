import type { AnatomyMesh } from './contracts';
import { defaults, type AnatomyParameters } from './parameters';
import { navelDetailAt, navelDetailLayout, type FittedNavel, type FittedNippleEdit } from './surfaceFit';
import { unfoldNavelPatch } from './navelPatch';

type Point = [number, number, number];
type Anchor = { vertices: Point; weights: Point };
export type SkinFeatureFrame = { center: Point; normal: Point; radius: number; aspect: number;
  areola?: Partial<Pick<FittedNippleEdit, 'areolaScale' | 'pigmentation' | 'edgeSoftness'>> };
type Feature = { anchor: Anchor; radius: number; aspect: number; relief: number };
export type SkinFeatureBindings = { features: (Feature | undefined)[]; oldNavel?: Anchor; oldNavelRing?: Anchor[];
  smoothFittedNavelTip?: boolean; refinedNavel?: boolean };

/** Attach to a front-facing triangle in the material chart. Store barycentric
 * coordinates so fitting and posing can move the detail with the skin. */
function anchorAt(mesh: AnatomyMesh, x: number, y: number, points = mesh.materialPositions ?? mesh.positions): Anchor | undefined {
  let best = .2, anchor: Anchor | undefined;
  for (let i=0;i<mesh.indices.length;i+=3) {
    const a=mesh.indices[i]*3,b=mesh.indices[i+1]*3,c=mesh.indices[i+2]*3;
    if (x<Math.min(points[a],points[b],points[c]) || x>Math.max(points[a],points[b],points[c]) ||
      y<Math.min(points[a+1],points[b+1],points[c+1]) || y>Math.max(points[a+1],points[b+1],points[c+1])) continue;
    const ax=points[a],ay=points[a+1],ux=points[b]-ax,uy=points[b+1]-ay,vx=points[c]-ax,vy=points[c+1]-ay;
    const d=ux*vy-uy*vx;
    if (Math.abs(d)<1e-9) continue;
    const u=((x-ax)*vy-(y-ay)*vx)/d,v=(ux*(y-ay)-uy*(x-ax))/d,w=1-u-v;
    if (Math.min(u,v,w)<-1e-5) continue;
    const z=points[a+2]*w+points[b+2]*u+points[c+2]*v;
    if (z>best) { best=z; anchor={vertices:[a,b,c],weights:[w,u,v]}; }
  }
  return anchor;
}

export function skinFeatureCoordinates(p: AnatomyParameters, navel: readonly number[]) {
  return [
    [navel[0]+p.navelOffsetX/100, navel[1]+p.navelOffsetY/100],
    [-.86+p.nippleLeftX/100,12.78+p.nippleLeftY/100],
    [.86+p.nippleRightX/100,12.78+p.nippleRightY/100],
  ];
}

export function bindSkinFeatures(mesh: AnatomyMesh, p: AnatomyParameters, navel: readonly number[]): SkinFeatureBindings {
  const features = skinFeatureCoordinates(p,navel).map(([x,y],i) => {
    const anchor=anchorAt(mesh,x,y);
    if (!anchor) return;
    return {anchor, radius:[.10*p.navelSize,p.nippleLeftRadius/100,p.nippleRightRadius/100][i],
      aspect:i===0?p.navelAspect:1,relief:[-.055*p.navelDepth,p.nippleLeftProjection/100,p.nippleRightProjection/100][i]};
  });
  const oldNavel = p.skinModel === 0 ? anchorAt(mesh,navel[0],navel[1]) : undefined;
  const oldNavelRing = oldNavel ? [[-.22,0],[.22,0],[0,-.22],[0,.22]]
    .map(([x,y])=>anchorAt(mesh,navel[0]+x,navel[1]+y)).filter((a):a is Anchor=>!!a) : undefined;
  return {features,oldNavel,oldNavelRing};
}

const dot = (a: Point,b: Point) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const unit = (a: Point): Point => {const length=Math.hypot(...a)||1;return [a[0]/length,a[1]/length,a[2]/length];};
const cross = (a: Point,b: Point): Point => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function position(anchor: Anchor, vertices: Float32Array): Point {
  return [0,1,2].map(k=>anchor.vertices.reduce((sum,i,j)=>sum+vertices[i+k]*anchor.weights[j],0)) as Point;
}
function frame(anchor: Anchor, vertices: Float32Array, rest: Float32Array) {
  const [a,b,c]=anchor.vertices;
  const normalFor=(p:Float32Array)=>cross([p[b]-p[a],p[b+1]-p[a+1],p[b+2]-p[a+2]], [p[c]-p[a],p[c+1]-p[a+1],p[c+2]-p[a+2]]);
  const normal=unit(normalFor(vertices)), sign=normalFor(rest)[2]<0?-1:1;
  for(let k=0;k<3;k++) normal[k]*=sign;
  const tangent=unit(cross([0,1,0],normal)), vertical=cross(normal,tangent);
  return {center:position(anchor,vertices),normal,tangent,vertical};
}

export function fittedNavelFor(p: AnatomyParameters) {
  if (!p.referencePose?.enabled) return;
  const controls = ['navelDepth', 'navelSize', 'navelOffsetX', 'navelOffsetY', 'navelAspect'] as const;
  if (controls.every(key => p[key] === defaults[key])) return p.skinFit?.fittedNavel;
}

export function fittedNippleFor(p: AnatomyParameters, side: 0 | 1) {
  const suffix = side === 0 ? 'Left' : 'Right';
  const controls = [`nipple${suffix}X`, `nipple${suffix}Y`, `nipple${suffix}Radius`, `nipple${suffix}Projection`] as const;
  if (p.referencePose?.enabled && controls.every(key => p[key] === defaults[key])) return p.skinFit?.fittedNipples?.[side];
}

const influence = (r: number) => r < 1 ? (1 - r*r)**3 : 0;

export function offsetNavelCavity(positions: Float32Array, navel: FittedNavel, lateral: number, vertical: number) {
  if (!navel.cavityOffsetMm) return;
  const depth = navel.cavityOffsetMm / (1000 * lateral);
  const halfWidth = Math.max(.010, navel.radius * 1.8);
  for (let i = 0; i < positions.length; i += 3) {
    const drop = navel.y - positions[i+1] * vertical;
    if (drop <= 0 || drop >= .016 || positions[i+2] * lateral < .055) continue;
    const x = (positions[i] * lateral - navel.x) / halfWidth;
    const weight = influence(Math.hypot(x, (drop - .008) / .008));
    positions[i+2] -= depth * weight;
  }
}

/** Transfer measured relief over a continuation of the surrounding abdomen. */
export function applyNavelDetail(mesh: AnatomyMesh, positions: Float32Array, navel: FittedNavel, lateral: number, vertical: number) {
  const detail = navel.detail;
  if (!detail) return false;
  const sample = (x: number, y: number) => {
    const anchor = anchorAt(mesh, (navel.x + x) / lateral, (navel.y + y) / vertical, positions);
    return anchor && position(anchor, positions)[2] * lateral;
  };
  const layout = navelDetailLayout(detail), radius = layout.radius - layout.step;
  const rim = Math.max(.058, radius + .016);
  const boundary = Array.from({ length: 24 }, (_, i) => {
    const angle = i * Math.PI / 12;
    const x = Math.cos(angle), y = Math.sin(angle);
    return { x, y, belly: sample(x*rim,y*rim), detail: navelDetailAt(detail,x*radius,y*radius) };
  });
  if (boundary.some(point => point.belly === undefined)) return false;
  // Boundary depth alone cannot preserve the convexity of the abdomen.
  // Estimate the radial curvature from a second ring on each surface.
  const curvature = (extent: number, a: number, b: number, read: (x: number, y: number) => number | undefined) => {
    const slopes = boundary.flatMap(({ x, y }) => {
      const inner = read(x*a,y*a), outer = read(x*b,y*b);
      return inner === undefined || outer === undefined ? [] : [(outer-inner)/(b*b-a*a)];
    }).sort((x,y) => x-y);
    const median = slopes[Math.floor(slopes.length/2)] ?? 0;
    return Math.max(-.025, Math.min(.025, -median*extent*extent));
  };
  const bellyCurve = curvature(rim,rim,rim+.014,sample);
  const detailCurve = curvature(radius,radius-.010,radius,(x,y) => navelDetailAt(detail,x,y));
  // Continue the surrounding surface into the patch using its measured boundary.
  const baseline = (x: number, y: number, extent: number, key: 'belly' | 'detail') => {
    const scale = Math.max(extent, Math.hypot(x,y)/.94);
    x /= scale; y /= scale;
    const squared = x*x + y*y;
    let total = 0, weights = 0;
    for (const point of boundary) {
      const weight = 1 / (1 + squared - 2*(x*point.x + y*point.y));
      total += point[key]! * weight; weights += weight;
    }
    return total / weights;
  };
  const ease = (t: number) => t*t*(3-2*t);
  const arcLift = (navel.arcLiftMm ?? 0) / 1000;
  const arcWidth = Math.max(.012, navel.radius * 1.9);
  const displacement = (x: number, y: number, z: number, lift: number) => {
    const r = Math.hypot(x,y);
    const blend = ease(Math.min(1,(rim-r)/.024));
    const upper = y > 0 ? influence(Math.abs(x) / arcWidth) * ease(Math.min(1, y/.005)) *
      (1 - ease(Math.min(1, Math.max(0,(y-.010)/.010)))) : 0;
    const sampleY = upper ? Math.max(0, y - lift * upper) : y;
    const belly = baseline(x,y,rim,'belly') + bellyCurve*(1 - (r/rim)**2);
    const reliefWeight = ease(Math.max(0, Math.min(1,(radius-r)/.014)));
    const targetBase = baseline(x,sampleY,radius,'detail') + detailCurve*(1 - (x*x + sampleY*sampleY)/(radius*radius));
    const fitted = belly + reliefWeight*(navelDetailAt(detail, x, sampleY) - targetBase);
    return blend * (fitted - z);
  };
  // A second outward rise after the opening produces a broad lip under side lighting.
  // Limit that rise along its measured direction, outside the editable opening.
  const core = .024, shoulder = .048;
  const rimLimits = boundary.map(({ x, y }) => {
    const inner = sample(x*core,y*core), outer = sample(x*shoulder,y*shoulder);
    if (radius <= shoulder || inner === undefined || outer === undefined) return { height: 0, strength: 0 };
    const height = displacement(x*core,y*core,inner,0);
    const rise = displacement(x*shoulder,y*shoulder,outer,0) - height;
    return { height: Math.max(0,height), strength: height > .002 ? ease(Math.max(0,Math.min(1,(rise-.0007)/.001))) : 0 };
  });
  // A broad lip at the top of the patch also calls for a shorter transition
  // around its sides. Use the measured upper sectors to limit the whole blend.
  const wideRim = (rimLimits[5].strength + rimLimits[6].strength + rimLimits[7].strength) / 3;
  unfoldNavelPatch(mesh, positions, navel, lateral, vertical);
  for (let i = 0; i < positions.length; i += 3) {
    const z = positions[i+2] * lateral;
    if (z < .055) continue;
    const x = positions[i] * lateral - navel.x, y = positions[i+1] * vertical - navel.y;
    const r = Math.hypot(x,y);
    if (r >= rim) continue;
    let delta = displacement(x,y,z,arcLift);
    if (r > core) {
      const bearing = (Math.atan2(y,x)*12/Math.PI + 24) % 24;
      const sector = Math.floor(bearing), fraction = ease(bearing-sector);
      const left = rimLimits[sector], right = rimLimits[(sector+1)%24];
      const height = left.height + (right.height-left.height)*fraction;
      const strength = left.strength + (right.strength-left.strength)*fraction;
      const decay = 1 - ease((r-core)/(rim-core));
      delta -= strength * ease(Math.min(1,(r-core)/.012)) * Math.max(0, delta-height*decay);
      delta *= 1 - .85*wideRim*ease(Math.min(1,(r-core)/.032));
    }
    positions[i+2] += delta / lateral;
  }
  return true;
}

export function flattenAuthoredNavel(mesh: AnatomyMesh, positions: Float32Array) {
  const bindings=mesh.skinFeatures, rest=mesh.materialPositions;
  if (!bindings || !rest) return;
  if (bindings.oldNavel && (bindings.oldNavelRing?.length ?? 0) >= 3) {
    const old=frame(bindings.oldNavel,positions,rest), origin=position(bindings.oldNavel,rest);
    const ring=bindings.oldNavelRing!.map(anchor=>position(anchor,positions));
    const level=ring.reduce((sum,p)=>sum+dot(p,old.normal),0)/ring.length;
    for(let i=0;i<rest.length;i+=3){
      const w=influence(Math.hypot(rest[i]-origin[0],rest[i+1]-origin[1],rest[i+2]-origin[2])/.30);
      if(!w)continue;
      const dz=Math.max(0,Math.min(.14,level-dot([positions[i],positions[i+1],positions[i+2]],old.normal)))*w;
      for(let k=0;k<3;k++)positions[i+k]+=old.normal[k]*dz;
    }
  }
}

/** Soften the sharp lower point without moving the opening or its upper fold. */
export function softenNavelTip(mesh: AnatomyMesh, positions: Float32Array, navel: FittedNavel, lateral: number, vertical: number) {
  const ramp = (t: number) => t*t*(3-2*t);
  const patch = new Map<number, { weight: number; neighbours: Set<number> }>();
  for (let i = 0; i < positions.length; i += 3) {
    if (positions[i+2]*lateral < .055) continue;
    const drop = navel.y - positions[i+1]*vertical;
    if (drop <= 0 || drop >= .025) continue;
    const x = (positions[i]*lateral - navel.x) / .017;
    const upperFade = ramp(Math.min(1, drop/.004));
    const lowerFade = ramp(Math.min(1, (.025-drop)/.015));
    const weight = influence(Math.abs(x)) * upperFade * lowerFade;
    if (weight) patch.set(i/3, { weight, neighbours: new Set() });
  }
  for (let i = 0; i < mesh.indices.length; i += 3) {
    for (let j = 0; j < 3; j++) {
      const vertex = patch.get(mesh.indices[i+j]);
      if (!vertex) continue;
      vertex.neighbours.add(mesh.indices[i+(j+1)%3]);
      vertex.neighbours.add(mesh.indices[i+(j+2)%3]);
    }
  }
  const corrections = new Map<number, number>();
  for (const [vertex, { weight, neighbours }] of patch) {
    if (!neighbours.size) continue;
    const z = vertex*3+2;
    let mean = 0;
    for (const neighbour of neighbours) mean += positions[neighbour*3+2];
    const delta = (mean / neighbours.size - positions[z]) * lateral;
    corrections.set(z, weight * Math.max(-.0038, Math.min(.0038, delta*.8)) / lateral);
  }
  for (const [z, correction] of corrections) positions[z] += correction;
}

export function rebuildSkinFeatures(mesh: AnatomyMesh, positions: Float32Array, parameters?: AnatomyParameters,
  omitNipples = false): (SkinFeatureFrame | undefined)[] {
  const bindings=mesh.skinFeatures, rest=mesh.materialPositions;
  if (!bindings || !rest) return [];
  const fitted = parameters && fittedNavelFor(parameters);
  if (!fitted) flattenAuthoredNavel(mesh, positions);
  return bindings.features.map((feature,index)=>{
    if (index === 0 && fitted && parameters) {
      const lateral = 18 / parameters.height, vertical = 1.8 / 17.5;
      const anchor = anchorAt(mesh, fitted.x / lateral, fitted.y / vertical, mesh.referencePositions ?? positions);
      if (!anchor) return;
      const { center, normal } = frame(anchor, positions, rest);
      return { center, normal, radius: fitted.radius / lateral, aspect: fitted.aspect * lateral / vertical };
    }
    const nipple = parameters && index !== 0 && fittedNippleFor(parameters, index === 1 ? 0 : 1);
    if (omitNipples && index !== 0) return;
    const lateral = parameters ? 18 / parameters.height : .1, vertical = 1.8 / 17.5;
    const edit = nipple ? nipple.edit : undefined;
    const anchor = nipple ? anchorAt(mesh,
      (nipple.x + Math.sign(nipple.x) * (edit?.outwardMm ?? 0) / 1000) / lateral,
      (nipple.y + (edit?.upMm ?? 0) / 1000) / vertical,
      mesh.referencePositions ?? positions) : feature?.anchor;
    if (!anchor || !feature) return;
    const local=frame(anchor,positions,rest), origin=position(anchor,rest);
    const radius = nipple ? nipple.radius / lateral : feature.radius;
    const aspect = nipple ? (nipple.aspect ?? 1) * lateral / vertical : feature.aspect;
    const projection = nipple ? Math.max(0, Math.min(.008, nipple.projection + (edit?.projectionMm ?? 0) / 1000)) : undefined;
    const relief = projection === undefined ? feature.relief : projection / lateral;
    const baseRadius = radius * (edit?.baseScale ?? 1);
    for(let i=0;i<positions.length;i+=3){
      if(Math.hypot(rest[i]-origin[0],rest[i+1]-origin[1],rest[i+2]-origin[2])>.65)continue;
      const d:Point=[positions[i]-local.center[0],positions[i+1]-local.center[1],positions[i+2]-local.center[2]];
      const r=Math.hypot(dot(d,local.tangent)/baseRadius,dot(d,local.vertical)/(baseRadius*aspect));
      const w=influence(r*(index===0 || nipple ? 1 : 1.45));
      if(!w)continue;
      for(let k=0;k<3;k++)positions[i+k]+=local.normal[k]*relief*w;
    }
    return {center:local.center,normal:local.normal,radius,aspect,areola:edit};
  });
}
