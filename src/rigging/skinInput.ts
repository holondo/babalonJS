import { BONE_END, RIG_TEMPLATE, TIP_JOINTS } from './humanoidTemplate';
import type { RigJoint } from './humanoidTemplate';
import type { HumanBone } from './humanoid';
import type { SkinInput } from './weights';

/** Bones of the standard skeleton, parents first (tips are bone ends only). */
export const SKIN_BONES = RIG_TEMPLATE.filter((j) => !TIP_JOINTS.includes(j.id));

type Point = readonly [number, number, number];
const sub = (a: Point, b: Point): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unit = (v: [number, number, number]) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l) as [number, number, number]; };

/**
 * The bone part of a {@link SkinInput} for the standard skeleton: one segment per bone (joint to its
 * `BONE_END`), the limb roots and their trunk boundary, and the trunk bones the junction treatments
 * use. Pure data, so the Rigger and the anatomy worker build it the same way.
 */
export function skinBones(positionOf: (id: RigJoint) => Point): Pick<SkinInput, 'bones' | 'limbRoots' | 'limbRootOf' | 'limbAxes' | 'treatedRoots' | 'trunkUp' | 'trunkBones'> {
  const bones = new Float32Array(SKIN_BONES.length * 6);
  SKIN_BONES.forEach((j, i) => bones.set([...positionOf(j.id), ...positionOf(BONE_END[j.id as HumanBone])], i * 6));
  const limbRoots = new Uint8Array(SKIN_BONES.length);
  SKIN_BONES.forEach((j, i) => (limbRoots[i] = /(UpperArm|UpperLeg)$/.test(j.id) ? 1 : 0));
  const limbRootOf = new Int16Array(SKIN_BONES.length).fill(-1);
  SKIN_BONES.forEach((_, i) => {
    let ancestor = i;
    while (ancestor >= 0) {
      if (limbRoots[ancestor]) { limbRootOf[i] = ancestor; break; }
      const parent = SKIN_BONES[ancestor].parent;
      ancestor = SKIN_BONES.findIndex((j) => j.id === parent);
    }
  });
  const limbAxes = new Float32Array(SKIN_BONES.length * 3);
  const left = positionOf('leftUpperArm'), right = positionOf('rightUpperArm');
  const shoulderCenter: Point = [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2, (left[2] + right[2]) / 2];
  SKIN_BONES.forEach((j, i) => {
    if (!limbRoots[i]) return;
    const start = positionOf(j.id);
    limbAxes.set(unit(j.id.endsWith('UpperArm') ? sub(start, shoulderCenter) : sub(positionOf(BONE_END[j.id as HumanBone]), start)), i * 3);
  });
  const treatedRoots = new Uint32Array(['leftUpperArm', 'rightUpperArm'].map((id) => SKIN_BONES.findIndex((j) => j.id === id)));
  const trunkUp = new Float32Array(unit(sub(positionOf('neck'), positionOf('hips'))));
  const trunkBones = new Uint32Array(['spine', 'chest', 'upperChest'].map((id) => SKIN_BONES.findIndex((j) => j.id === id)));
  return { bones, limbRoots, limbRootOf, limbAxes, treatedRoots, trunkUp, trunkBones };
}
