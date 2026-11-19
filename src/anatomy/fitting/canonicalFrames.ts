import type { Vec3M } from '../landmarks';

export interface SkeletalBoneFrame {
  id: string;
  origin: Vec3M;
  axisX: Vec3M;
  axisY: Vec3M;
  axisZ: Vec3M;
  length: number;
}

export interface RigidBoneTransform {
  boneId: string;
  srcFrame: SkeletalBoneFrame;
  tgtFrame: SkeletalBoneFrame;
  longitudinalScale: number;
  radialScale: number;
}

function sub(a: Vec3M, b: Vec3M): Vec3M {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(a: Vec3M, b: Vec3M): Vec3M {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(v: Vec3M, s: number): Vec3M {
  return [v[0] * s, v[1] * s, v[2] * s];
}

function dot(a: Vec3M, b: Vec3M): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3M, b: Vec3M): Vec3M {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function norm(v: Vec3M): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function unit(v: Vec3M): Vec3M {
  const n = norm(v);
  return n > 1e-9 ? scale(v, 1 / n) : [0, 0, 1];
}

/** Compute an orthonormal frame from start/end points and a lateral hint. */
export function buildBoneFrame(start: Vec3M, end: Vec3M, lateralHint: Vec3M = [1, 0, 0]): SkeletalBoneFrame {
  const diff = sub(end, start);
  const len = norm(diff);
  const axisY = unit(diff);

  let axisX = cross(unit(lateralHint), axisY);
  if (norm(axisX) < 1e-4) axisX = cross([0, 0, 1], axisY);
  if (norm(axisX) < 1e-4) axisX = cross([1, 0, 0], axisY);
  axisX = unit(axisX);

  const axisZ = unit(cross(axisX, axisY));

  return {
    id: 'frame',
    origin: start,
    axisX,
    axisY,
    axisZ,
    length: len,
  };
}

/**
 * Computes rigid SE(3) bone transformation from canonical bone frame to subject bone frame.
 * Preserves bone geometry without nonrigid shear or distortion.
 */
export function computeRigidBoneTransform(
  srcStart: Vec3M,
  srcEnd: Vec3M,
  tgtStart: Vec3M,
  tgtEnd: Vec3M,
  boneId: string
): RigidBoneTransform {
  const srcFrame = buildBoneFrame(srcStart, srcEnd);
  const tgtFrame = buildBoneFrame(tgtStart, tgtEnd);

  const srcLen = srcFrame.length;
  const tgtLen = tgtFrame.length;
  const longScale = srcLen > 1e-6 ? tgtLen / srcLen : 1.0;
  const radScale = Math.sqrt(longScale);

  return {
    boneId,
    srcFrame,
    tgtFrame,
    longitudinalScale: longScale,
    radialScale: radScale,
  };
}

/** Transform a point on a bone from canonical rest to fitted subject frame. */
export function transformBonePoint(transform: RigidBoneTransform, canonicalStart: Vec3M, p: Vec3M): Vec3M {
  const rel = sub(p, canonicalStart);
  const sf = transform.srcFrame;
  const tf = transform.tgtFrame;

  // 1. Project to srcFrame local coordinates
  const lx = dot(rel, sf.axisX);
  const ly = dot(rel, sf.axisY);
  const lz = dot(rel, sf.axisZ);

  // 2. Scale along axial and radial directions
  const slx = lx * transform.radialScale;
  const sly = ly * transform.longitudinalScale;
  const slz = lz * transform.radialScale;

  // 3. Transform to target frame world coordinates
  const wx = tf.axisX[0] * slx + tf.axisY[0] * sly + tf.axisZ[0] * slz;
  const wy = tf.axisX[1] * slx + tf.axisY[1] * sly + tf.axisZ[1] * slz;
  const wz = tf.axisX[2] * slx + tf.axisY[2] * sly + tf.axisZ[2] * slz;

  return add(tf.origin, [wx, wy, wz]);
}
