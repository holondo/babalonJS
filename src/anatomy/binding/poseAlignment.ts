import type { Vec3M } from '../landmarks';
import type { AnatomyParameters } from '../parameters';
import {
  canonicalAnatomyFactors,
  canonicalDeltaToSource,
  sourcePointFromCanonical,
  sourcePointToCanonical,
  type SourceCanonicalFrame,
} from './anatomySkinDrive';

/**
 * Joint placement of the generator's neutral pose, in canonical meters.
 * These are the anchors `posedPositions` rotates around (`src/anatomy/pose.ts`), so the alignment
 * moves an imported model into the same pose the fitted anatomy is drawn in.
 */
export interface ArmJoint {
  side: 1 | -1;
  /** Shoulder joint (canonical meters). */
  shoulder: Vec3M;
  /** Direction from the shoulder to the elbow of the neutral anatomy pose, normalized. */
  direction: Vec3M;
}

export interface ArmAlignment {
  side: 1 | -1;
  /** False when the arm was already in a usable pose (nothing to do). */
  applied: boolean;
  /** Rotation applied to the arm, in degrees. */
  angle: number;
  /** Vertices that received a non-zero rotation. */
  vertices: number;
  /** Why nothing happened, when it did not. */
  reason: string;
}

export interface PoseAlignmentReport {
  applied: boolean;
  moved: number;
  maxDisplacementMeters: number;
  arms: ArmAlignment[];
}

export interface PoseAlignmentOptions {
  /** Optional per-vertex canonical inverse rotations for transporting edits back to source pose. */
  inverseRotations?: Float32Array;
  /** Rotations beyond this are treated as a different pose, not as an arm to lower. */
  maxAngleDegrees?: number;
  /** Skip arms that are already within this angle of the target. */
  toleranceDegrees?: number;
}

const RAD = Math.PI / 180;

/**
 * Neutral-pose arm joints of the fitted anatomy.
 * `shoulderWidth` shifts the joints exactly like the pose preview does, so posing the imported
 * model lands on the surface the anatomy sliders act on.
 */
export function anatomyArmJoints(parameters: Pick<AnatomyParameters, 'shoulderWidth'>, heightCm: number): ArmJoint[] {
  const { lateral, vertical } = canonicalAnatomyFactors(heightCm);
  const shift = (parameters.shoulderWidth - 43) / 20;
  return ([1, -1] as const).map(side => {
    const shoulder: Vec3M = [side * (1.87532 + shift) * lateral, 14.02683 * vertical, 0];
    const elbow: Vec3M = [side * (2.67656 + shift) * lateral, 11.62313 * vertical, 0];
    const dx = elbow[0] - shoulder[0], dy = elbow[1] - shoulder[1], dz = elbow[2] - shoulder[2];
    const length = Math.hypot(dx, dy, dz) || 1;
    return { side, shoulder, direction: [dx / length, dy / length, dz / length] as Vec3M };
  });
}

function normalize(x: number, y: number, z: number): Vec3M {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

function smooth(a: number, b: number, value: number) {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Rotation of `v` around the unit `axis` by `angle` radians (Rodrigues). */
function rotateAbout(v: Vec3M, axis: Vec3M, angle: number): Vec3M {
  const c = Math.cos(angle), s = Math.sin(angle);
  const dot = v[0] * axis[0] + v[1] * axis[1] + v[2] * axis[2];
  const cx = axis[1] * v[2] - axis[2] * v[1];
  const cy = axis[2] * v[0] - axis[0] * v[2];
  const cz = axis[0] * v[1] - axis[1] * v[0];
  return [
    v[0] * c + cx * s + axis[0] * dot * (1 - c),
    v[1] * c + cy * s + axis[1] * dot * (1 - c),
    v[2] * c + cz * s + axis[2] * dot * (1 - c),
  ];
}

/** Lateral extent that counts as "outside the torso" for the arm search. */
const ARM_START = 0.12;
/** Vertical half-window around the shoulder that still belongs to the arm. */
const ARM_BAND = 0.28;

/**
 * Direction from the shoulder to the middle of the arm, from the model's own vertices.
 * Uses the far half of the arm so a hand or a prop near the elbow cannot swing the estimate.
 */
function detectArmDirection(canonical: Float32Array, joint: ArmJoint): Vec3M | null {
  const side = joint.side, [sx, sy, sz] = joint.shoulder;
  let sum = 0, x = 0, y = 0, z = 0;
  for (let i = 0; i < canonical.length; i += 3) {
    const px = canonical[i], py = canonical[i + 1], pz = canonical[i + 2];
    if (side * (px - sx) < ARM_START) continue;
    if (Math.abs(py - sy) > ARM_BAND) continue;
    // Weight the far end: the wrist must dominate the armpit and the deltoid.
    const reach = Math.max(0, side * (px - sx) - ARM_START);
    sum += reach;
    x += px * reach; y += py * reach; z += pz * reach;
  }
  if (sum <= 1e-6) return null;
  const centroid: Vec3M = [x / sum, y / sum, z / sum];
  return normalize(centroid[0] - sx, centroid[1] - sy, centroid[2] - sz);
}

/**
 * Rotates an imported model into the fitted anatomy's neutral pose.
 *
 * T-posed source models put their arms where the anatomy has no surface at all, so every
 * correspondence, proportion and skin weight derived from that surface would be measured against
 * the wrong body part. Aligning the arms first makes the source and the anatomy describe the same
 * pose, which is what the rest of the pipeline assumes.
 *
 * The rotation is rigid per arm and blended near the shoulder, with the same shape as the anatomy
 * pose preview, so the imported surface keeps its own volume.
 */
export function alignSourceToAnatomyPose(
  positions: Float32Array,
  normals: Float32Array | null,
  frame: SourceCanonicalFrame,
  joints: readonly ArmJoint[],
  options: PoseAlignmentOptions = {},
): PoseAlignmentReport {
  const maxAngle = (options.maxAngleDegrees ?? 105) * RAD;
  const tolerance = (options.toleranceDegrees ?? 4) * RAD;
  const count = positions.length / 3;
  const canonical = new Float32Array(positions.length);
  for (let i = 0; i < count; i++) {
    const [x, y, z] = sourcePointToCanonical(frame, positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    canonical[i * 3] = x; canonical[i * 3 + 1] = y; canonical[i * 3 + 2] = z;
  }

  const arms: ArmAlignment[] = [];
  let moved = 0, maxDisplacement = 0;

  for (const joint of joints) {
    const detected = detectArmDirection(canonical, joint);
    if (!detected) { arms.push({ side: joint.side, applied: false, angle: 0, vertices: 0, reason: 'no arm vertices' }); continue; }
    const from = detected, to = joint.direction;
    const dot = Math.max(-1, Math.min(1, from[0] * to[0] + from[1] * to[1] + from[2] * to[2]));
    const angle = Math.acos(dot);
    if (angle < tolerance) { arms.push({ side: joint.side, applied: false, angle: angle / RAD, vertices: 0, reason: 'already in pose' }); continue; }
    if (joint.side * from[0] < 0.45) { arms.push({ side: joint.side, applied: false, angle: angle / RAD, vertices: 0, reason: 'arm not extended sideways' }); continue; }
    if (angle > maxAngle) { arms.push({ side: joint.side, applied: false, angle: angle / RAD, vertices: 0, reason: 'pose too different to align' }); continue; }

    const axis = normalize(
      from[1] * to[2] - from[2] * to[1],
      from[2] * to[0] - from[0] * to[2],
      from[0] * to[1] - from[1] * to[0],
    );
    // The same rotation expressed in the model's own coordinates, for its normals.
    const [ax, ay, az] = canonicalDeltaToSource(frame, axis[0], axis[1], axis[2]);
    const normalAxis = normalize(ax, ay, az);
    const shoulder = joint.shoulder;
    let vertices = 0;

    for (let i = 0; i < count; i++) {
      const dx = canonical[i * 3] - shoulder[0];
      const dy = canonical[i * 3 + 1] - shoulder[1];
      const dz = canonical[i * 3 + 2] - shoulder[2];
      const along = dx * from[0] + dy * from[1] + dz * from[2];
      if (along <= -0.06) continue;
      const perpX = dx - along * from[0], perpY = dy - along * from[1], perpZ = dz - along * from[2];
      const perp = Math.hypot(perpX, perpY, perpZ);
      const weight = smooth(-0.06, 0.09, along) * (1 - smooth(0.17, 0.30, perp));
      if (weight <= 1e-4) continue;
      const turned = rotateAbout([dx, dy, dz], axis, angle * weight);
      if (options.inverseRotations) {
        for (let col = 0; col < 3; col++) {
          const basis: Vec3M = [0, 0, 0]; basis[col] = 1;
          const v = rotateAbout(basis, axis, -angle * weight);
          for (let row = 0; row < 3; row++) options.inverseRotations[i * 9 + row * 3 + col] = v[row];
        }
      }
      const [px, py, pz] = sourcePointFromCanonical(frame, turned[0] + shoulder[0], turned[1] + shoulder[1], turned[2] + shoulder[2]);
      positions[i * 3] = px; positions[i * 3 + 1] = py; positions[i * 3 + 2] = pz;
      canonical[i * 3] = turned[0] + shoulder[0];
      canonical[i * 3 + 1] = turned[1] + shoulder[1];
      canonical[i * 3 + 2] = turned[2] + shoulder[2];
      moved++;
      const length = Math.hypot(turned[0] - dx, turned[1] - dy, turned[2] - dz);
      if (length > maxDisplacement) maxDisplacement = length;
      vertices++;

      if (normals) {
        // Source-space normals turn about the source-space axis: the frames differ by a rotation only.
        const turned2 = rotateAbout([normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]], normalAxis, angle * weight);
        normals[i * 3] = turned2[0]; normals[i * 3 + 1] = turned2[1]; normals[i * 3 + 2] = turned2[2];
      }
    }
    arms.push({ side: joint.side, applied: vertices > 0, angle: angle / RAD, vertices, reason: vertices > 0 ? '' : 'no vertices in range' });
  }

  if (normals) {
    for (let i = 0; i < normals.length; i += 3) {
      const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
      normals[i] /= length; normals[i + 1] /= length; normals[i + 2] /= length;
    }
  }

  return { applied: moved > 0, moved, maxDisplacementMeters: maxDisplacement, arms };
}
