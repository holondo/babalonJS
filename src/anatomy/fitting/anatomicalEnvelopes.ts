import type { Vec3M } from '../landmarks';

export interface EnvelopeVertex {
  bonePoint: Vec3M;
  musclePoint: Vec3M;
  skinPoint: Vec3M;
  normal: Vec3M;
  boneRadius: number;
  muscleThickness: number;
  fatThickness: number;
}

export interface VolumetricEnvelopes {
  vertices: EnvelopeVertex[];
  indices: Uint32Array; // Shared surface triangulation across the 3 layers
  totalVolumeM3: number;
  muscleVolumeM3: number;
  fatVolumeM3: number;
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

/** Signed volume of a tetrahedron formed by 4 vertices. */
export function tetVolume(v0: Vec3M, v1: Vec3M, v2: Vec3M, v3: Vec3M): number {
  const a = sub(v1, v0);
  const b = sub(v2, v0);
  const c = sub(v3, v0);
  return dot(a, cross(b, c)) / 6.0;
}

/**
 * Builds the 3-layer volumetric anatomical envelopes (skeleton -> muscle -> skin).
 * Enforces positive tissue ordering: bone < muscle <= skin.
 */
export function buildSubjectEnvelopes(
  proxyPositions: Float32Array,
  proxyIndices: Uint32Array,
  boneAxisPoints: Vec3M[],
  defaultFatFraction = 0.15
): VolumetricEnvelopes {
  const n = proxyPositions.length / 3;
  const vertices: EnvelopeVertex[] = new Array(n);

  let totalVol = 0;
  let muscleVol = 0;
  let fatVol = 0;

  for (let i = 0; i < n; i++) {
    const skinP: Vec3M = [
      proxyPositions[i * 3],
      proxyPositions[i * 3 + 1],
      proxyPositions[i * 3 + 2],
    ];

    // Find nearest skeletal axis point
    let bestDistSq = Infinity;
    let axisP: Vec3M = [0, skinP[1], 0];
    for (const pt of boneAxisPoints) {
      const d2 = (skinP[0] - pt[0]) ** 2 + (skinP[1] - pt[1]) ** 2 + (skinP[2] - pt[2]) ** 2;
      if (d2 < bestDistSq) {
        bestDistSq = d2;
        axisP = pt;
      }
    }

    const radialVector = sub(skinP, axisP);
    const totalRadialDist = Math.hypot(...radialVector);
    const dir = totalRadialDist > 1e-4 ? scale(radialVector, 1 / totalRadialDist) : ([0, 0, 1] as Vec3M);

    // Bounded physiological fractions:
    // Bone: ~25-35% of radial distance
    // Muscle: ~50-60% of radial distance
    // Subcutaneous fat: remaining ~10-25%
    const boneRad = Math.max(0.015, totalRadialDist * 0.30);
    const fatThick = Math.max(0.003, totalRadialDist * defaultFatFraction);
    const muscleThick = Math.max(0.01, totalRadialDist - boneRad - fatThick);

    const boneP = add(axisP, scale(dir, boneRad));
    const muscleP = add(boneP, scale(dir, muscleThick));

    vertices[i] = {
      bonePoint: boneP,
      musclePoint: muscleP,
      skinPoint: skinP,
      normal: dir,
      boneRadius: boneRad,
      muscleThickness: muscleThick,
      fatThickness: fatThick,
    };
  }

  // Audit tetrahedral volumes in each prism
  const triCount = proxyIndices.length / 3;
  for (let t = 0; t < triCount; t++) {
    const i0 = proxyIndices[t * 3];
    const i1 = proxyIndices[t * 3 + 1];
    const i2 = proxyIndices[t * 3 + 2];

    const s0 = vertices[i0].skinPoint;
    const s1 = vertices[i1].skinPoint;
    const s2 = vertices[i2].skinPoint;

    const m0 = vertices[i0].musclePoint;
    const m1 = vertices[i1].musclePoint;
    const m2 = vertices[i2].musclePoint;

    // Fat layer prism split into 3 tets
    const vF1 = Math.abs(tetVolume(m0, m1, m2, s0));
    const vF2 = Math.abs(tetVolume(s0, m1, s1, m2));
    const vF3 = Math.abs(tetVolume(s0, s1, m2, s2));
    fatVol += vF1 + vF2 + vF3;

    // Muscle layer prism
    const b0 = vertices[i0].bonePoint;
    const vM1 = Math.abs(tetVolume(b0, m0, m1, m2));
    muscleVol += vM1;

    totalVol += vF1 + vF2 + vF3 + vM1;
  }

  return {
    vertices,
    indices: proxyIndices,
    totalVolumeM3: totalVol,
    muscleVolumeM3: muscleVol,
    fatVolumeM3: fatVol,
  };
}
