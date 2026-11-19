import type { LandmarkName, Vec3M } from '../landmarks';
import type { AnatomyParameters } from '../parameters';
import { anatomyArmJoints, alignSourceToAnatomyPose } from '../binding/poseAlignment';
import { sourcePointToCanonical, type SourceCanonicalFrame } from '../binding/anatomySkinDrive';

/** Joint hints are in the same local coordinates as the analyzed vertex buffer. */
export interface BodyHints {
  tissues?: import('../tissueFit').TissueHints;
  heightCm?: number;
  yawRad?: number;
  zUp?: boolean;
  forward?: Vec3M;
  landmarks?: Partial<Record<LandmarkName, Vec3M>>;
  jointSource?: 'rig' | 'manual';
  parameters?: Partial<AnatomyParameters>;
  lockMuscleShape?: boolean;
  /** Existing editor settings are priors, not locked observations. */
  priorParameters?: AnatomyParameters;
  surface?: 'skin' | 'clothed' | 'unknown';
  /** Optional semantic bone labels: 0=trunk, then upper/lower L arm, R arm, L leg, R leg. */
  vertexBones?: Uint8Array;
}
export interface BodyEvidence {
  volumeFit?: import('./volumeFit').VolumeFitEvidence;
  tissueFit?: {count:number;beforeMm:number[];afterMm:number[];minJacobian:number;appliedFraction:number;boneDisplacementMm:0};
  poseFit?: {meanMm:number;p95Mm:number};
  surfaceRegistration?: import('./surfaceRegistration').SurfaceRegistrationEvidence;
  trunkFit?: import('./trunkFit').TrunkFitEvidence;
  surfaceProxy?: { method: 'connected-meshopt'; sourceTriangles: number; triangles: number; estimatedErrorMm: number };
  boneSource: 'joint-hints' | 'template-prior';
  pose: { method: 'joint-hints' | 'surface-estimate'; movedVertices: number; confidence: number };
  boneLengthsCm: Partial<Record<'upperArm_L' | 'upperArm_R' | 'forearm_L' | 'forearm_R' | 'thigh_L' | 'thigh_R' | 'shin_L' | 'shin_R', number>>;
  composition: { fatMm: number; muscleScale: number; confidence: number; source: 'hint' | 'prior' | 'conditioned-prior'; fatRangeMm: [number, number] };
  warnings: string[];
}
const add = (a: Vec3M, b: Vec3M): Vec3M => a.map((v, k) => v + b[k]) as Vec3M;
const sub = (a: Vec3M, b: Vec3M): Vec3M => a.map((v, k) => v - b[k]) as Vec3M;
const dot = (a: Vec3M, b: Vec3M) => a.reduce((s, v, k) => s + v * b[k], 0);
const length = (a: Vec3M) => Math.hypot(...a);
const unit = (a: Vec3M): Vec3M => { const n = length(a) || 1; return a.map(v => v / n) as Vec3M; };
const scale = (a: Vec3M, n: number): Vec3M => a.map(v => v * n) as Vec3M;
const cross = (a: Vec3M, b: Vec3M): Vec3M => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function rotation(from: Vec3M, to: Vec3M, influence = 1): number[] {
  const a = unit(from), b = unit(to), cosine = Math.max(-1, Math.min(1, dot(a, b)));
  let axis = cross(a, b);
  if (length(axis) < 1e-8) axis = cosine < 0 ? cross(a, Math.abs(a[0]) < .8 ? [1, 0, 0] : [0, 1, 0]) : [0, 1, 0];
  const [x, y, z] = unit(axis), angle = Math.acos(cosine) * influence, c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  return [t*x*x+c,t*x*y-s*z,t*x*z+s*y,t*x*y+s*z,t*y*y+c,t*y*z-s*x,t*x*z-s*y,t*y*z+s*x,t*z*z+c];
}
const turn = (m: number[], p: Vec3M): Vec3M => [dot(m.slice(0,3) as Vec3M,p),dot(m.slice(3,6) as Vec3M,p),dot(m.slice(6,9) as Vec3M,p)];

/** Analysis only: never change the source GLB. Segment lengths survive neutralization. */
export function neutralizeForMeasurement(positions: Float32Array, frame: SourceCanonicalFrame, hints: BodyHints = {}) {
  const neutral = new Float32Array(positions.length), joints: Partial<Record<LandmarkName, Vec3M>> = {};
  const inverseRotations = new Float32Array(positions.length * 3), limbMask = new Uint8Array(positions.length / 3);
  for (let v=0;v<limbMask.length;v++) for(let k=0;k<3;k++) inverseRotations[v*9+k*3+k]=1;
  for (let i = 0; i < positions.length; i += 3) neutral.set(sourcePointToCanonical(frame, positions[i], positions[i+1], positions[i+2]), i);
  for (const [key, value] of Object.entries(hints.landmarks ?? {})) {
    if (value?.length !== 3 || !value.every(Number.isFinite)) throw Error('Invalid anatomical joint hint.');
    joints[key as LandmarkName] = sourcePointToCanonical(frame, ...value as Vec3M);
  }
  if (hints.vertexBones && hints.vertexBones.length !== positions.length / 3) throw Error('Body region hints do not match the source vertices.');
  const lengths: BodyEvidence['boneLengthsCm'] = {};
  const segments: { id: number; a: Vec3M; b: Vec3M; target: Vec3M; rotate: number[]; radius: number }[] = [];
  for (const [sideIndex, side] of (['L', 'R'] as const).entries()) {
    const sign = side === 'L' ? -1 : 1;
    for (const [leg, names] of [[false, ['shoulder','elbow','wrist']], [true, ['hipJoint','knee','ankle']]] as const) {
      const [a,b,c] = names.map(name => joints[`${name}_${side}` as LandmarkName]);
      if (!a || !b || !c || length(sub(b,a)) < .02 || length(sub(c,b)) < .02) continue;
      const upper = length(sub(b,a)), lower = length(sub(c,b));
      const direction: Vec3M = leg ? [sign*.025,-1,0] : [sign*.316,-.949,0];
      const targetB = add(a, scale(unit(direction),upper));
      const lowerDirection: Vec3M = leg ? [sign * -.015,-1,0] : [sign * .133,-.991,0];
      const targetC = add(targetB,scale(unit(lowerDirection),lower));
      const id = (leg ? 5 : 1) + sideIndex*2;
      segments.push({id,a,b,target:a,rotate:rotation(sub(b,a),sub(targetB,a)),radius:leg ? .22 : .14});
      segments.push({id:id+1,a:b,b:c,target:targetB,rotate:rotation(sub(c,b),sub(targetC,targetB)),radius:leg ? .20 : .16});
      joints[`${names[1]}_${side}` as LandmarkName] = targetB;
      joints[`${names[2]}_${side}` as LandmarkName] = targetC;
      const realScale = (hints.heightCm ?? 180) / 180;
      lengths[`${leg?'thigh':'upperArm'}_${side}`] = upper*100*realScale;
      lengths[`${leg?'shin':'forearm'}_${side}`] = lower*100*realScale;
    }
  }
  let moved = 0;
  if (segments.length) {
    const prepared = segments.map(segment => {
      const axis = sub(segment.b, segment.a);
      return { ...segment, axis, lengthSquared: dot(axis, axis), radiusSquared: segment.radius ** 2 };
    });
    for (let i=0; i<neutral.length; i+=3) {
      const point: Vec3M = [neutral[i], neutral[i + 1], neutral[i + 2]];
      let best: typeof prepared[number] | undefined, distance = Infinity;
      for (const segment of prepared) {
        if (hints.vertexBones && hints.vertexBones[i/3] !== segment.id) continue;
        const [x, y, z] = segment.axis;
        const dx = point[0] - segment.a[0], dy = point[1] - segment.a[1], dz = point[2] - segment.a[2];
        const t = (dx * x + dy * y + dz * z) / segment.lengthSquared;
        if (!hints.vertexBones && (t < -.1 || t > (segment.id % 2 === 0 ? 2 : 1.15))) continue;
        const u = Math.max(0, Math.min(1, t));
        const d = (dx - x * u) ** 2 + (dy - y * u) ** 2 + (dz - z * u) ** 2;
        if (d < distance && (hints.vertexBones || d < segment.radiusSquared)) { best=segment;distance=d; }
      }
      if (!best) continue;
      let rotate = best.rotate;
      if (!hints.vertexBones && (best.id === 1 || best.id === 3)) {
        const axis = sub(best.b,best.a), t = dot(sub(point,best.a),axis)/dot(axis,axis);
        const lateral = (Math.abs(point[0])-Math.abs(best.a[0])+.025)/.065;
        const fade = Math.max(0,Math.min(1,t/.3)) * Math.max(0,Math.min(1,lateral));
        rotate = rotation(sub(best.b,best.a),turn(best.rotate,sub(best.b,best.a)),fade);
      }
      const p = add(best.target,turn(rotate,sub(point,best.a)));
      if (length(sub(point,p)) > 1e-6) moved++;
      neutral.set(p,i);
      limbMask[i/3] = best.id;
      for(let row=0;row<3;row++) for(let col=0;col<3;col++) inverseRotations[i*3+row*3+col]=rotate[col*3+row];
    }
  } else {
    const report = alignSourceToAnatomyPose(neutral, null, {yaw:0,scale:1,offset:[0,0,0]}, anatomyArmJoints({shoulderWidth:43},180), {inverseRotations});
    moved = report.moved;
    for(let v=0;v<limbMask.length;v++) if(Math.abs(inverseRotations[v*9]-1)+Math.abs(inverseRotations[v*9+4]-1)+Math.abs(inverseRotations[v*9+8]-1)>1e-6) limbMask[v]=neutral[v*3]<0?1:3;
  }
  return { positions: neutral, joints, inverseRotations, limbMask, boneLengthsCm: lengths, pose: { method: segments.length ? 'joint-hints' as const : 'surface-estimate' as const, movedVertices:moved, confidence:segments.length ? (hints.vertexBones?.length ? .9 : .65) : .35 } };
}
