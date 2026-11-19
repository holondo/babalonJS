import type { Landmarks, Vec3M } from '../landmarks';
import { CANONICAL_LANDMARKS } from '../landmarks';
import { computeRigidBoneTransform, transformBonePoint, type RigidBoneTransform } from './canonicalFrames';

export interface RegistrationV2 {
  sourceLandmarks: Landmarks;
  targetLandmarks: Landmarks;
  boneTransforms: Map<string, { transform: RigidBoneTransform; srcStart: Vec3M }>;
  warpSoftTissue(p: Vec3M): Vec3M;
  warpBone(boneId: string, p: Vec3M): Vec3M;
}

function sub(a: Vec3M, b: Vec3M): Vec3M {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function norm(v: Vec3M): number {
  return Math.hypot(v[0], v[1], v[2]);
}

export function createRegistrationV2(
  source: Landmarks = CANONICAL_LANDMARKS,
  target: Landmarks
): RegistrationV2 {
  const boneMap = new Map<string, { transform: RigidBoneTransform; srcStart: Vec3M }>();

  // Define primary skeletal bones
  const boneDefs = [
    { id: 'pelvis', srcA: source.sacrum, srcB: source.pubis, tgtA: target.sacrum, tgtB: target.pubis },
    { id: 'femur_L', srcA: source.hipJoint_L, srcB: source.knee_L, tgtA: target.hipJoint_L, tgtB: target.knee_L },
    { id: 'femur_R', srcA: source.hipJoint_R, srcB: source.knee_R, tgtA: target.hipJoint_R, tgtB: target.knee_R },
    { id: 'tibia_L', srcA: source.knee_L, srcB: source.ankle_L, tgtA: target.knee_L, tgtB: target.ankle_L },
    { id: 'tibia_R', srcA: source.knee_R, srcB: source.ankle_R, tgtA: target.knee_R, tgtB: target.ankle_R },
    { id: 'humerus_L', srcA: source.shoulder_L, srcB: source.elbow_L, tgtA: target.shoulder_L, tgtB: target.elbow_L },
    { id: 'humerus_R', srcA: source.shoulder_R, srcB: source.elbow_R, tgtA: target.shoulder_R, tgtB: target.elbow_R },
    { id: 'forearm_L', srcA: source.elbow_L, srcB: source.wrist_L, tgtA: target.elbow_L, tgtB: target.wrist_L },
    { id: 'forearm_R', srcA: source.elbow_R, srcB: source.wrist_R, tgtA: target.elbow_R, tgtB: target.wrist_R },
    { id: 'thorax', srcA: source.pubis, srcB: source.jugularNotch, tgtA: target.pubis, tgtB: target.jugularNotch },
    { id: 'head', srcA: source.c7, srcB: source.headTop, tgtA: target.c7, tgtB: target.headTop },
  ];

  for (const b of boneDefs) {
    const transform = computeRigidBoneTransform(b.srcA, b.srcB, b.tgtA, b.tgtB, b.id);
    boneMap.set(b.id, { transform, srcStart: b.srcA });
  }

  const warpBone = (boneId: string, p: Vec3M): Vec3M => {
    const entry = boneMap.get(boneId);
    if (!entry) return warpSoftTissue(p);
    return transformBonePoint(entry.transform, entry.srcStart, p);
  };

  const warpSoftTissue = (p: Vec3M): Vec3M => {
    let sumWeight = 0;
    let outX = 0, outY = 0, outZ = 0;

    for (const [, entry] of boneMap) {
      const transformed = transformBonePoint(entry.transform, entry.srcStart, p);
      const d = norm(sub(p, entry.srcStart));
      const w = 1 / (Math.pow(d / 0.25, 4) + 1e-4);
      outX += transformed[0] * w;
      outY += transformed[1] * w;
      outZ += transformed[2] * w;
      sumWeight += w;
    }

    if (sumWeight < 1e-9) return p;
    return [outX / sumWeight, outY / sumWeight, outZ / sumWeight];
  };

  return {
    sourceLandmarks: source,
    targetLandmarks: target,
    boneTransforms: boneMap,
    warpSoftTissue,
    warpBone,
  };
}
