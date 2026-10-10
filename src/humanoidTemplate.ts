import type { HumanBone } from './humanoid';

/**
 * The standard skeleton used to rig static models (decision D1 in docs/animation_sources.md):
 * the rig of the Universal Animation Library by Quaternius (CC0), without fingers. Rigs made in
 * the app use its bone names and proportions, so the built-in clips fit them exactly.
 *
 * Positions are the CC0 Mannequin's joints in its T-pose, in meters, in the character's frame
 * (x = its right, y = up, z = forward), with the feet at y = 0 and the body centered on x and z.
 */

/** Joints: the deforming bones plus the ends of the end bones (top of the head, finger tips, toe tips). */
export type RigJoint = HumanBone | 'headTop' | 'leftHandTip' | 'rightHandTip' | 'leftToesTip' | 'rightToesTip';

export interface TemplateJoint {
  id: RigJoint;
  /** Node name in the rig (the Quaternius/Rigify deform bone names). */
  name: string;
  parent: RigJoint | null;
  pos: [number, number, number];
  /** Placed by the user; the others follow them (spine, shoulders, tips). */
  handle: boolean;
}

export const TEMPLATE_HEIGHT = 1.829;

const RIGHT: TemplateJoint[] = [
  { id: 'rightShoulder', name: 'DEF-shoulder.R', parent: 'upperChest', pos: [0.019, 1.457, 0.051], handle: false },
  { id: 'rightUpperArm', name: 'DEF-upper_arm.R', parent: 'rightShoulder', pos: [0.192, 1.44, -0.086], handle: true },
  { id: 'rightLowerArm', name: 'DEF-forearm.R', parent: 'rightUpperArm', pos: [0.466, 1.44, -0.091], handle: true },
  { id: 'rightHand', name: 'DEF-hand.R', parent: 'rightLowerArm', pos: [0.739, 1.44, -0.086], handle: true },
  { id: 'rightHandTip', name: 'hand_tip.R', parent: 'rightHand', pos: [0.972, 1.441, -0.084], handle: false },
  { id: 'rightUpperLeg', name: 'DEF-thigh.R', parent: 'hips', pos: [0.089, 0.932, -0.019], handle: true },
  { id: 'rightLowerLeg', name: 'DEF-shin.R', parent: 'rightUpperLeg', pos: [0.089, 0.531, -0.022], handle: true },
  { id: 'rightFoot', name: 'DEF-foot.R', parent: 'rightLowerLeg', pos: [0.089, 0.103, -0.056], handle: true },
  { id: 'rightToes', name: 'DEF-toe.R', parent: 'rightFoot', pos: [0.089, 0.015, 0.093], handle: true },
  { id: 'rightToesTip', name: 'toe_tip.R', parent: 'rightToes', pos: [0.089, 0.015, 0.185], handle: false },
];

const mirror = (j: TemplateJoint): TemplateJoint => ({
  id: j.id.replace('right', 'left') as RigJoint,
  name: j.name.replace('.R', '.L'),
  parent: j.parent ? (j.parent.replace('right', 'left') as RigJoint) : null,
  pos: [-j.pos[0], j.pos[1], j.pos[2]],
  handle: j.handle,
});

/** Parents always come before their children. */
export const RIG_TEMPLATE: TemplateJoint[] = [
  { id: 'hips', name: 'DEF-hips', parent: null, pos: [0, 0.916, -0.071], handle: true },
  { id: 'spine', name: 'DEF-spine.001', parent: 'hips', pos: [0, 1.05, -0.036], handle: false },
  { id: 'chest', name: 'DEF-spine.002', parent: 'spine', pos: [0, 1.173, -0.021], handle: false },
  { id: 'upperChest', name: 'DEF-spine.003', parent: 'chest', pos: [0, 1.314, -0.026], handle: false },
  { id: 'neck', name: 'DEF-neck', parent: 'upperChest', pos: [0, 1.487, -0.031], handle: true },
  { id: 'head', name: 'DEF-head', parent: 'neck', pos: [0, 1.568, -0.016], handle: true },
  { id: 'headTop', name: 'head_tip', parent: 'head', pos: [0, TEMPLATE_HEIGHT, -0.016], handle: false },
  ...RIGHT.map(mirror),
  ...RIGHT,
];

/** Joints that are bone ends only (no bone of their own). */
export const TIP_JOINTS: RigJoint[] = ['headTop', 'leftHandTip', 'rightHandTip', 'leftToesTip', 'rightToesTip'];

/** Each bone runs from its joint to this one (used to weight the skin). */
export const BONE_END: Record<HumanBone, RigJoint> = {
  hips: 'spine',
  spine: 'chest',
  chest: 'upperChest',
  upperChest: 'neck',
  neck: 'head',
  head: 'headTop',
  leftShoulder: 'leftUpperArm',
  leftUpperArm: 'leftLowerArm',
  leftLowerArm: 'leftHand',
  leftHand: 'leftHandTip',
  rightShoulder: 'rightUpperArm',
  rightUpperArm: 'rightLowerArm',
  rightLowerArm: 'rightHand',
  rightHand: 'rightHandTip',
  leftUpperLeg: 'leftLowerLeg',
  leftLowerLeg: 'leftFoot',
  leftFoot: 'leftToes',
  leftToes: 'leftToesTip',
  rightUpperLeg: 'rightLowerLeg',
  rightLowerLeg: 'rightFoot',
  rightFoot: 'rightToes',
  rightToes: 'rightToesTip',
};

export const templateJoint = (id: RigJoint) => RIG_TEMPLATE.find((j) => j.id === id)!;
