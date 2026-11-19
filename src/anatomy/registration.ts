import type { Landmarks, Vec3M } from './landmarks';
import { CANONICAL_LANDMARKS } from './landmarks';

export interface RegistrationSegment {
  id: string;
  sourceStart: Vec3M;
  sourceEnd: Vec3M;
  targetStart: Vec3M;
  targetEnd: Vec3M;
  sourceLateral?: Vec3M;
  targetLateral?: Vec3M;
  radius: number;
}

export interface AnatomyRegistration {
  sourceLandmarks: Landmarks;
  targetLandmarks: Landmarks;
  warpPoint(p: Vec3M): Vec3M;
  warpMesh(positions: Float32Array, normals?: Float32Array): { positions: Float32Array; normals?: Float32Array };
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

function norm(v: Vec3M): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function unit(v: Vec3M): Vec3M {
  const n = norm(v);
  return n > 1e-9 ? scale(v, 1 / n) : [0, 0, 0];
}

function cross(a: Vec3M, b: Vec3M): Vec3M {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** 3x3 Matrix times vector. */
function matMulVec(m: readonly number[], v: Vec3M): Vec3M {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/** Compute a 3x3 orientation frame from axial + lateral directions. */
function makeFrame(axial: Vec3M, lateralRef: Vec3M): number[] {
  const y = unit(axial);
  let x = cross(unit(lateralRef), y);
  if (norm(x) < 1e-5) x = cross([0, 0, 1], y);
  if (norm(x) < 1e-5) x = cross([1, 0, 0], y);
  x = unit(x);
  const z = unit(cross(x, y));
  return [
    x[0], y[0], z[0],
    x[1], y[1], z[1],
    x[2], y[2], z[2],
  ];
}

/** Invert an orthonormal 3x3 matrix (transpose). */
function matTranspose(m: readonly number[]): number[] {
  return [
    m[0], m[3], m[6],
    m[1], m[4], m[7],
    m[2], m[5], m[8],
  ];
}

/** Segment warp: computes affine coordinate transformation along a segment. */
function transformSegment(
  p: Vec3M,
  srcStart: Vec3M,
  srcEnd: Vec3M,
  tgtStart: Vec3M,
  tgtEnd: Vec3M,
  srcLateral?: Vec3M,
  tgtLateral?: Vec3M
): { point: Vec3M; distSq: number } {
  const srcAxis = sub(srcEnd, srcStart);
  const tgtAxis = sub(tgtEnd, tgtStart);
  const srcLen = norm(srcAxis);
  const tgtLen = norm(tgtAxis);

  if (srcLen < 1e-6 || tgtLen < 1e-6) {
    return { point: add(tgtStart, sub(p, srcStart)), distSq: 0 };
  }

  const srcUAxis = unit(srcAxis);
  const tgtUAxis = unit(tgtAxis);

  const srcRel = sub(p, srcStart);
  const axialFraction = dot(srcRel, srcUAxis) / srcLen;
  const radialOffset = sub(srcRel, scale(srcUAxis, axialFraction * srcLen));
  const distSq = dot(radialOffset, radialOffset);

  // Compute rotation from src frame to tgt frame
  const srcFrame = makeFrame(srcUAxis, srcLateral ?? [1, 0, 0]);
  const tgtFrame = makeFrame(tgtUAxis, tgtLateral ?? [1, 0, 0]);
  const srcToLocal = matTranspose(srcFrame);

  // Local radial coords in src frame
  const localRadial = matMulVec(srcToLocal, radialOffset);

  // Radial scaling based on length ratio or explicit factor
  const axialScale = tgtLen / srcLen;
  const radialScale = Math.sqrt(axialScale); // Soft volumetric conservation

  // Transform to target frame
  const tgtRadial = matMulVec(tgtFrame, [
    localRadial[0] * radialScale,
    0,
    localRadial[2] * radialScale,
  ]);

  const targetPoint = add(
    add(tgtStart, scale(tgtAxis, axialFraction)),
    tgtRadial
  );

  return { point: targetPoint, distSq };
}

/** Create a full registration warp between two sets of landmarks. */
export function createRegistration(
  source: Landmarks = CANONICAL_LANDMARKS,
  target: Landmarks
): AnatomyRegistration {
  const segments: RegistrationSegment[] = [
    // Head / neck
    { id: 'head', sourceStart: source.c7, sourceEnd: source.headTop, targetStart: target.c7, targetEnd: target.headTop, radius: 0.18 },
    // Thorax / spine
    { id: 'thorax', sourceStart: source.pubis, sourceEnd: source.jugularNotch, targetStart: target.pubis, targetEnd: target.jugularNotch, radius: 0.28 },
    // Pelvis
    { id: 'pelvis', sourceStart: source.coccyx, sourceEnd: source.waist, targetStart: target.coccyx, targetEnd: target.waist, radius: 0.24 },

    // Arms
    { id: 'upperArm_L', sourceStart: source.shoulder_L, sourceEnd: source.elbow_L, targetStart: target.shoulder_L, targetEnd: target.elbow_L, radius: 0.14 },
    { id: 'upperArm_R', sourceStart: source.shoulder_R, sourceEnd: source.elbow_R, targetStart: target.shoulder_R, targetEnd: target.elbow_R, radius: 0.14 },
    { id: 'forearm_L', sourceStart: source.elbow_L, sourceEnd: source.wrist_L, targetStart: target.elbow_L, targetEnd: target.wrist_L, radius: 0.11 },
    { id: 'forearm_R', sourceStart: source.elbow_R, sourceEnd: source.wrist_R, targetStart: target.elbow_R, targetEnd: target.wrist_R, radius: 0.11 },

    // Legs
    { id: 'thigh_L', sourceStart: source.hipJoint_L, sourceEnd: source.knee_L, targetStart: target.hipJoint_L, targetEnd: target.knee_L, radius: 0.18 },
    { id: 'thigh_R', sourceStart: source.hipJoint_R, sourceEnd: source.knee_R, targetStart: target.hipJoint_R, targetEnd: target.knee_R, radius: 0.18 },
    { id: 'shank_L', sourceStart: source.knee_L, sourceEnd: source.ankle_L, targetStart: target.knee_L, targetEnd: target.ankle_L, radius: 0.14 },
    { id: 'shank_R', sourceStart: source.knee_R, sourceEnd: source.ankle_R, targetStart: target.knee_R, targetEnd: target.ankle_R, radius: 0.14 },
  ];

  const warpPoint = (p: Vec3M): Vec3M => {
    let sumWeight = 0;
    let outX = 0;
    let outY = 0;
    let outZ = 0;

    for (const seg of segments) {
      const res = transformSegment(p, seg.sourceStart, seg.sourceEnd, seg.targetStart, seg.targetEnd);
      const d = Math.sqrt(res.distSq);
      // Inverse distance weighting with soft radius kernel
      const w = 1 / (Math.pow(d / seg.radius, 4) + 1e-4);
      outX += res.point[0] * w;
      outY += res.point[1] * w;
      outZ += res.point[2] * w;
      sumWeight += w;
    }

    if (sumWeight < 1e-9) return p;
    return [outX / sumWeight, outY / sumWeight, outZ / sumWeight];
  };

  const warpMesh = (positions: Float32Array, normals?: Float32Array) => {
    const count = positions.length / 3;
    const outPos = new Float32Array(positions.length);
    for (let i = 0; i < count; i++) {
      const p: Vec3M = [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
      const warped = warpPoint(p);
      outPos[i * 3] = warped[0];
      outPos[i * 3 + 1] = warped[1];
      outPos[i * 3 + 2] = warped[2];
    }

    let outNorm: Float32Array | undefined;
    if (normals) {
      outNorm = new Float32Array(normals.length);
      const eps = 0.005;
      for (let i = 0; i < count; i++) {
        const p: Vec3M = [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
        const n: Vec3M = [normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]];
        const p1 = warpPoint(add(p, scale(n, eps)));
        const p0 = [outPos[i * 3], outPos[i * 3 + 1], outPos[i * 3 + 2]] as Vec3M;
        const warpedN = unit(sub(p1, p0));
        outNorm[i * 3] = warpedN[0];
        outNorm[i * 3 + 1] = warpedN[1];
        outNorm[i * 3 + 2] = warpedN[2];
      }
    }

    return { positions: outPos, normals: outNorm };
  };

  return {
    sourceLandmarks: source,
    targetLandmarks: target,
    warpPoint,
    warpMesh,
  };
}
