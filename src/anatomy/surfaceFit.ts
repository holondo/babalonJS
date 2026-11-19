import type { AnatomyMesh } from './contracts';
import type { Vec3M } from './landmarks';

/** Serializable smooth volumetric residual, in canonical metres. */
export interface SurfaceFit {
  version: 1;
  min: Vec3M;
  max: Vec3M;
  size: [number, number, number];
  offsets: number[];
  /** Anterior abdominal covering correction in millimetres, sampled after the lattice. */
  abdominalDepth?: number[];
  abdominalFlanks?: number[];
  fittedNavel?: FittedNavel;
  pectoralDepth?: number[];
  sternumSurface?: number[];
  sternumRelax?: true;
  armCovering?: [number, number, number, number, number, number][];
  fittedNipples?: [FittedNipple | null, FittedNipple | null];
}

export const abdominalDepthGrid = { x: -.17, y: 1, step: .01, columns: 35, rows: 29 };
export const abdominalDepthLimitMm = 22;
export const abdominalFlankGrid = { angle: Math.PI / 4, angleStep: Math.PI / 30, y: 1.01, step: .01, columns: 16, rows: 27 };
export const navelGrid = { radius: .036, step: .004, size: 19, limitMm: 18 };
const legacyNavelDetailGrid = { radius: .030, step: .002, size: 31, limitMm: 36 };
export const navelDetailGrid = { radius: .056, step: .002, size: 57, limitMm: 48 };
export function navelDetailLayout(detail: readonly number[]) {
  return detail.length === legacyNavelDetailGrid.size ** 2 ? legacyNavelDetailGrid : navelDetailGrid;
}
export const pectoralDepthGrid = { x: -.25, y: 1.224, step: .008, columns: 63, rows: 34, limitMm: 25 };
export interface FittedNipple {
  x: number;
  y: number;
  radius: number;
  projection: number;
  /** Vertical radius divided by horizontal radius in the observed front view. */
  aspect?: number;
  edit?: Partial<FittedNippleEdit>;
}

export const fittedNippleEditDefaults = { outwardMm: 0, upMm: 0, projectionMm: 0, baseScale: 1, areolaScale: 1, pigmentation: 1, edgeSoftness: 1 };
export type FittedNippleEdit = typeof fittedNippleEditDefaults;
const fittedNippleEditLimits: Record<keyof FittedNippleEdit, [number, number]> = {
  outwardMm: [-12, 12], upMm: [-12, 12], projectionMm: [-8, 8], baseScale: [.65, 1.65],
  areolaScale: [.5, 2], pigmentation: [0, 1.5], edgeSoftness: [.5, 2],
};

export function normalizeFittedNippleEdit(value: Partial<FittedNippleEdit> | undefined) {
  const edit: Partial<FittedNippleEdit> = {};
  for (const key of Object.keys(fittedNippleEditDefaults) as (keyof FittedNippleEdit)[]) {
    const raw = value?.[key];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    const [min, max] = fittedNippleEditLimits[key];
    const bounded = Math.max(min, Math.min(max, raw));
    if (bounded !== fittedNippleEditDefaults[key]) edit[key] = bounded;
  }
  return Object.keys(edit).length ? edit : undefined;
}
export interface FittedNavel {
  x: number;
  y: number;
  radius: number;
  aspect: number;
  depth: number[];
  /** Measured anterior relief relative to the local belly plane, in millimetres. */
  detail?: number[];
  arcLiftMm?: number;
  /** User correction to the cavity floor. Positive values deepen it. */
  cavityOffsetMm?: number;
}

export const navelCavityOffsetLimitMm = 6;

export function normalizeNavelCavityOffset(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(-navelCavityOffsetLimitMm, Math.min(navelCavityOffsetLimitMm, value)) : 0;
}

export function normalizeNavelArcLift(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(-4, Math.min(4, value)) : 0;
}

/** Use the four corners outside the opening to remove local belly tilt. */
export function navelDetailPlane(sample: (x: number, y: number) => number | undefined, r = navelDetailGrid.radius) {
  const a = sample(-r, -r), b = sample(r, -r), c = sample(-r, r), d = sample(r, r);
  if (a === undefined || b === undefined || c === undefined || d === undefined) return;
  const z = (a + b + c + d) / 4, dx = (b + d - a - c) / (4 * r), dy = (c + d - a - b) / (4 * r);
  return (x: number, y: number) => z + dx*x + dy*y;
}

function depthAt(depth: readonly number[], u: number, v: number, columns: number, rows: number, offset = 0) {
  if (u <= 0 || v <= 0 || u >= columns - 1 || v >= rows - 1) return 0;
  const i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j;
  const k = offset + j * columns + i;
  return ((1 - b) * ((1 - a) * depth[k] + a * depth[k + 1]) +
    b * ((1 - a) * depth[k + columns] + a * depth[k + columns + 1])) / 1000;
}
export function abdominalDepthAt(depth: readonly number[], x: number, y: number, z: number) {
  const { x: left, y: bottom, step, columns, rows } = abdominalDepthGrid;
  return z < .055 ? 0 : depthAt(depth, (x - left) / step, (y - bottom) / step, columns, rows);
}
export function abdominalFlankAt(depth: readonly number[], x: number, y: number, z: number) {
  const { angle, angleStep, y: bottom, step, columns, rows } = abdominalFlankGrid;
  if (y <= bottom || y >= bottom + step * (rows - 1)) return 0;
  return depthAt(depth, (Math.atan2(Math.abs(x), z) - angle) / angleStep, (y - bottom) / step,
    columns, rows, x < 0 ? 0 : columns * rows);
}
export function navelDepthAt(navel: FittedNavel, x: number, y: number, z: number) {
  const { radius, step, size } = navelGrid;
  return z < .055 ? 0 : depthAt(navel.depth, (x - navel.x + radius) / step, (y - navel.y + radius) / step, size, size);
}
export function navelDetailAt(detail: readonly number[], x: number, y: number) {
  const { radius, step, size } = navelDetailLayout(detail);
  return depthAt(detail, (x + radius) / step, (y + radius) / step, size, size);
}
export function pectoralDepthAt(depth: readonly number[], x: number, y: number, z: number) {
  const { x: left, y: bottom, step, columns, rows } = pectoralDepthGrid;
  return z < .055 ? 0 : depthAt(depth, (x - left) / step, (y - bottom) / step, columns, rows);
}

export function sternumSurfaceAt(depth: readonly number[], x: number, y: number) {
  const { x: left, y: bottom, step, columns, rows } = pectoralDepthGrid;
  const u = (x - left) / step, v = (y - bottom) / step;
  if (u < 0 || v < 0 || u >= columns - 1 || v >= rows - 1) return 0;
  const col = Math.floor(u), row = Math.floor(v), a = u - col, b = v - row;
  const i = row * columns + col;
  // Zero marks an unmeasured cell, not a surface at zero depth.
  const values = [depth[i], depth[i + 1], depth[i + columns], depth[i + columns + 1]];
  const weights = [(1 - a) * (1 - b), a * (1 - b), (1 - a) * b, a * b];
  let sum = 0, weight = 0;
  for (let j = 0; j < 4; j++) {
    if (values[j] <= 0) continue;
    sum += weights[j] * values[j];
    weight += weights[j];
  }
  return weight > .25 ? sum / weight / 1000 : 0;
}

export function armCoveringAt(field: NonNullable<SurfaceFit['armCovering']>, x: number, y: number, z: number) {
  const delta = [0,0,0];
  let total = .18;
  for (const [px,py,pz,dx,dy,dz] of field) {
    const radius = ((x-px)**2+(y-py)**2+(z-pz)**2)/.048**2;
    if (radius >= 1) continue;
    const weight = (1-radius)**3;
    total += weight;
    delta[0] += weight*dx; delta[1] += weight*dy; delta[2] += weight*dz;
  }
  return delta.map(value=>value/total);
}
function validDepth(depth: unknown, size: number, limit: number): depth is number[] {
  return Array.isArray(depth) && depth.length === size && depth.every(value => Number.isFinite(value) && Math.abs(value) <= limit);
}
export function normalizeSurfaceFit(value: unknown): SurfaceFit | undefined {
  if (!value || typeof value !== 'object') return;
  const p=value as SurfaceFit;
  if(p.version!==1 || !Array.isArray(p.size) || p.size.length!==3 || p.size.some(n=>!Number.isInteger(n)||n<2||n>48)) return;
  if(!Array.isArray(p.min)||!Array.isArray(p.max)||p.min.length!==3||p.max.length!==3||p.min.some((v,k)=>!Number.isFinite(v)||!Number.isFinite(p.max[k])||p.max[k]<=v))return;
  if(!Array.isArray(p.offsets)||p.offsets.length!==p.size[0]*p.size[1]*p.size[2]*3||p.offsets.some(v=>!Number.isFinite(v)||Math.abs(v)>.3))return;
  const result: SurfaceFit = {version:1,min:[...p.min],max:[...p.max],size:[...p.size],offsets:p.offsets.slice()};
  const depth = p.abdominalDepth;
  if (validDepth(depth, abdominalDepthGrid.columns * abdominalDepthGrid.rows, abdominalDepthLimitMm)) result.abdominalDepth = depth.slice();
  if (validDepth(p.abdominalFlanks, 2 * abdominalFlankGrid.columns * abdominalFlankGrid.rows, abdominalDepthLimitMm))
    result.abdominalFlanks = p.abdominalFlanks.slice();
  const navel = p.fittedNavel;
  if (navel && Number.isFinite(navel.x) && Math.abs(navel.x) <= .055 && navel.y >= .99 && navel.y <= 1.20 &&
    navel.radius >= .003 && navel.radius <= .016 && navel.aspect >= .4 && navel.aspect <= 1.8 &&
    validDepth(navel.depth, navelGrid.size ** 2, navelGrid.limitMm)) {
    const cavityOffsetMm = normalizeNavelCavityOffset(navel.cavityOffsetMm);
    const arcLiftMm = normalizeNavelArcLift(navel.arcLiftMm);
    const detailGrid = Array.isArray(navel.detail) ? navelDetailLayout(navel.detail) : navelDetailGrid;
    const detail = validDepth(navel.detail, detailGrid.size ** 2, detailGrid.limitMm) ? navel.detail!.slice() : undefined;
    result.fittedNavel = { x: navel.x, y: navel.y, radius: navel.radius, aspect: navel.aspect,
      depth: navel.depth.slice(), ...(cavityOffsetMm ? { cavityOffsetMm } : {}),
      ...(detail ? { detail, ...(arcLiftMm ? { arcLiftMm } : {}) } : {}) };
  }
  if (validDepth(p.pectoralDepth, pectoralDepthGrid.columns * pectoralDepthGrid.rows, pectoralDepthGrid.limitMm))
    result.pectoralDepth = p.pectoralDepth.slice();
  if (validDepth(p.sternumSurface, pectoralDepthGrid.columns * pectoralDepthGrid.rows, 250))
    result.sternumSurface = p.sternumSurface.slice();
  if (p.sternumRelax === true) result.sternumRelax = true;
  if (Array.isArray(p.armCovering) && p.armCovering.length <= 256 && p.armCovering.every(row =>
    Array.isArray(row) && row.length === 6 && row.every((v,i)=>Number.isFinite(v) && Math.abs(v) <= (i < 3 ? 2 : .035))))
    result.armCovering = p.armCovering.map(row=>[...row]);
  if (Array.isArray(p.fittedNipples) && p.fittedNipples.length === 2) {
    const nipple = (value: FittedNipple | null, side: number): FittedNipple | null => {
      if (!value || !(value.x * side >= .045 && value.x * side <= .185 && value.y >= 1.26 && value.y <= 1.43 &&
        value.radius >= .004 && value.radius <= .014 && value.projection >= 0 && value.projection <= .008)) return null;
      const edit = normalizeFittedNippleEdit(value.edit);
      return { x: value.x, y: value.y, radius: value.radius, projection: value.projection,
        ...(value.aspect !== undefined && value.aspect >= .6 && value.aspect <= 1.65 ? { aspect: value.aspect } : {}),
        ...(edit ? { edit } : {}) };
    };
    const pair = [nipple(p.fittedNipples[0], -1), nipple(p.fittedNipples[1], 1)] as const;
    if (pair[0] || pair[1]) result.fittedNipples = [...pair];
  }
  return result;
}
/** Eight trilinear basis weights; the same field moves skin and internal tissues. */
export function latticeWeights(field: SurfaceFit, p: readonly number[], visit:(index:number,weight:number)=>void) {
  const cell=p.map((v,k)=>Math.max(0,Math.min(field.size[k]-1.000001,(v-field.min[k])/(field.max[k]-field.min[k])*(field.size[k]-1))));
  const base=cell.map(Math.floor),t=cell.map((v,k)=>v-base[k]);
  for(let z=0;z<2;z++)for(let y=0;y<2;y++)for(let x=0;x<2;x++)visit(((base[2]+z)*field.size[1]+base[1]+y)*field.size[0]+base[0]+x,(x?t[0]:1-t[0])*(y?t[1]:1-t[1])*(z?t[2]:1-t[2]));
}
export function surfaceFitPoint(field: SurfaceFit,p: readonly number[]): Vec3M {
  const out=[...p] as Vec3M;
  latticeWeights(field,p,(i,w)=>{for(let k=0;k<3;k++)out[k]+=field.offsets[i*3+k]*w;});return out;
}
export function applySurfaceFit(mesh: AnatomyMesh, field: SurfaceFit, height: number) {
  const lateral=18/height,vertical=1.8/17.5;
  for(let i=0;i<mesh.positions.length;i+=3){
    const point=surfaceFitPoint(field,[mesh.positions[i]*lateral,mesh.positions[i+1]*vertical,mesh.positions[i+2]*lateral]);
    mesh.positions[i]=point[0]/lateral;mesh.positions[i+1]=point[1]/vertical;mesh.positions[i+2]=point[2]/lateral;
  }
}
