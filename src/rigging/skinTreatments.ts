/**
 * Optional treatments for where a limb meets the trunk, applied to the skin weights after they
 * are computed (with either weight method). They only use the skeleton and the vertices, never
 * anything specific to a model.
 *
 * - `current` (Direct weights): the computed weights, unchanged.
 * - `protected` (Trunk protection): trunk skin next to a limb root gives the limb's influence to
 *   the nearest trunk bone, so raising the limb doesn't drag the trunk.
 * - `helper` (Distributed rotation): skin around a limb root moves partly with a helper bone that
 *   follows half of the limb's rotation, spreading the bend over a wider area.
 *
 * The ids are stored in projects: keep them.
 */
export type SkinTreatment = 'current' | 'protected' | 'helper';

export const SKIN_TREATMENTS: { value: SkinTreatment; label: string; description: string }[] = [
  { value: 'current', label: 'Direct weights', description: 'The calculated weights, unchanged.' },
  { value: 'protected', label: 'Trunk protection', description: 'Raising an arm doesn’t pull the side of the trunk.' },
  { value: 'helper', label: 'Distributed rotation', description: 'Helper bones spread the bend where the arms meet the trunk.' },
];

export interface TreatmentInput {
  points: Float32Array;
  /** Bone segments (start x, y, z, end x, y, z). */
  bones: Float32Array;
  /** Limb roots whose junction with the trunk is treated (one per side). */
  treatedRoots?: Uint32Array;
  /** For each bone, the limb root it hangs from (-1: none). */
  limbRootOf?: Int16Array;
  /** Outward axis of each limb root. */
  limbAxes?: Float32Array;
  /** Up direction of the trunk. */
  trunkUp?: Float32Array;
  /** Bones of the trunk (spine chain) that can take over influence. */
  trunkBones?: Uint32Array;
}

const smoothstep = (t: number) => {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
};

/** Squared distance from a point to a bone segment. */
function distanceSquared(bones: Float32Array, bone: number, x: number, y: number, z: number) {
  const k = bone * 6;
  const ax = bones[k + 3] - bones[k];
  const ay = bones[k + 4] - bones[k + 1];
  const az = bones[k + 5] - bones[k + 2];
  const px = x - bones[k];
  const py = y - bones[k + 1];
  const pz = z - bones[k + 2];
  const t = Math.max(0, Math.min(1, (px * ax + py * ay + pz * az) / (ax * ax + ay * ay + az * az || 1e-8)));
  return (px - t * ax) ** 2 + (py - t * ay) ** 2 + (pz - t * az) ** 2;
}

/**
 * Applies a treatment to dense weights (vertex × bone). The input array is never changed;
 * `helper` adds one column per treated root after the skeleton's bones.
 */
export function applySkinTreatment(dense: Float32Array, input: TreatmentInput, treatment: SkinTreatment): Float32Array {
  const { points, bones, treatedRoots, limbRootOf, limbAxes, trunkUp, trunkBones } = input;
  if (treatment === 'current' || !treatedRoots || !limbRootOf || !limbAxes || !trunkUp || !trunkBones?.length) return dense;
  const B = bones.length / 6;
  const count = points.length / 3;
  const width = treatment === 'helper' ? B + treatedRoots.length : B;
  const out = new Float32Array(count * width);
  for (let i = 0; i < count; i++) out.set(dense.subarray(i * B, (i + 1) * B), i * width);

  for (let side = 0; side < treatedRoots.length; side++) {
    const root = treatedRoots[side];
    const j = root * 6;
    const length = Math.max(1e-8, Math.hypot(bones[j + 3] - bones[j], bones[j + 4] - bones[j + 1], bones[j + 5] - bones[j + 2]));
    const limb: number[] = [];
    for (let b = 0; b < B; b++) if (limbRootOf[b] === root) limb.push(b);

    for (let i = 0; i < count; i++) {
      const x = points[i * 3];
      const y = points[i * 3 + 1];
      const z = points[i * 3 + 2];
      const dx = x - bones[j];
      const dy = y - bones[j + 1];
      const dz = z - bones[j + 2];
      const inward = -(dx * limbAxes[root * 3] + dy * limbAxes[root * 3 + 1] + dz * limbAxes[root * 3 + 2]);
      const below = -(dx * trunkUp[0] + dy * trunkUp[1] + dz * trunkUp[2]);
      // How much of the limb's influence moves: trunk side of a sloped boundary (protected),
      // or a falloff around the joint (helper)
      let fraction = treatment === 'protected' ? smoothstep((inward + Math.max(0, below) * 0.5) / (length * 0.12)) : 0.7 * (1 - smoothstep(Math.hypot(dx, dy, dz) / (length * 0.75)));
      if (fraction <= 0) continue;

      let target = trunkBones[0];
      if (treatment === 'protected') {
        let trunkDistance = Infinity;
        let limbDistance = Infinity;
        let closestLimbBone = root;
        for (const b of trunkBones) {
          const d = distanceSquared(bones, b, x, y, z);
          if (d < trunkDistance) {
            trunkDistance = d;
            target = b;
          }
        }
        for (const b of limb) {
          const d = distanceSquared(bones, b, x, y, z);
          if (d < limbDistance) {
            limbDistance = d;
            closestLimbBone = b;
          }
        }
        // Only skin next to the limb root, and only where the trunk is closer: a forearm or a
        // hand resting beside the body must never be anchored to the spine
        fraction *= closestLimbBone === root ? smoothstep((limbDistance - trunkDistance) / Math.max(0.25 * limbDistance, 1e-12)) : 0;
        if (fraction <= 0) continue;
      }

      const row = i * width;
      let moved = 0;
      for (const b of limb) {
        const amount = out[row + b] * fraction;
        out[row + b] -= amount;
        moved += amount;
      }
      // The influence is handed over, not dropped: weights still add up to 1
      if (treatment === 'helper') out[row + B + side] += moved;
      else out[row + target] += moved;
    }
  }
  return out;
}
