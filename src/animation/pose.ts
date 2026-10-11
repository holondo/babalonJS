import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { BONE_PARENT, HUMAN_BONES, boneDirection, humanoidOf, jointNodes, jointPosition, mirrorBone, skeletonsOf, worldMatrix } from '../rigging/humanoid';
import type { HumanBone, HumanoidMap } from '../rigging/humanoid';
import type { Editor, Entity } from '../core/editor';

/**
 * Joint math shared by posing, IK, presets, retargeting and rigging. Works on joint nodes
 * in world space, so it is correct under any parent transform (including the mirrored
 * root glTF models get in Babylon's left-handed scenes).
 */

/** Local rotations (and positions) of joints, to undo a change or restore a pose. */
export interface JointState {
  node: TransformNode;
  q: Quaternion;
  p: Vector3;
}

export function captureJoints(nodes: TransformNode[]): JointState[] {
  return nodes.map((node) => ({ node, q: rotationOf(node).clone(), p: node.position.clone() }));
}

export function restoreJoints(states: JointState[]) {
  for (const s of states) {
    rotationOf(s.node).copyFrom(s.q);
    s.node.position.copyFrom(s.p);
  }
}

export function sameJoints(a: JointState[], b: JointState[]) {
  return a.length === b.length && a.every((s, i) => s.node === b[i].node && s.q.equalsWithEpsilon(b[i].q, 1e-5) && s.p.equalsWithEpsilon(b[i].p, 1e-6));
}

/** The node's rotation quaternion (created from its Euler rotation if it had none). */
export function rotationOf(node: TransformNode): Quaternion {
  if (!node.rotationQuaternion) {
    node.rotationQuaternion = Quaternion.FromEulerVector(node.rotation);
    node.rotation.setAll(0);
  }
  return node.rotationQuaternion;
}

const tmpA = new Matrix();
const tmpB = new Matrix();
const tmpC = new Matrix();

/** Rotates a joint about its own position by a rotation given in world space. */
export function rotateJointWorld(node: TransformNode, q: Quaternion) {
  const world = worldMatrix(node);
  const p = world.getTranslation();
  // world' = world · T(-p) · R · T(p): the joint turns in place
  Matrix.TranslationToRef(-p.x, -p.y, -p.z, tmpA);
  q.toRotationMatrix(tmpB);
  tmpA.multiplyToRef(tmpB, tmpC);
  Matrix.TranslationToRef(p.x, p.y, p.z, tmpA);
  tmpC.multiplyToRef(tmpA, tmpB);
  world.multiplyToRef(tmpB, tmpC);
  // local = world' · parent⁻¹
  if (node.parent) {
    node.parent.computeWorldMatrix(true).invertToRef(tmpA);
    tmpC.multiplyToRef(tmpA, tmpB);
  } else {
    tmpB.copyFrom(tmpC);
  }
  const r = new Quaternion();
  tmpB.decompose(undefined, r);
  rotationOf(node).copyFrom(r);
  node.computeWorldMatrix(true);
}

/** World rotation that turns the bone so it points along `dir` (the shortest turn, no twist). */
export function aimRotation(from: Vector3, to: Vector3) {
  return Quaternion.FromUnitVectorsToRef(from.normalizeToNew(), to.normalizeToNew(), new Quaternion());
}

/** Turns a bone so it points along a world direction. */
export function aimBone(map: HumanoidMap, bone: HumanBone, dir: Vector3) {
  const node = map[bone];
  const current = boneDirection(map, bone);
  if (!node || !current) return;
  rotateJointWorld(node, aimRotation(current, dir));
}

/** Mapped bones, parents first (so aiming a parent before its children keeps them consistent). */
export function bonesTopDown(map: HumanoidMap): HumanBone[] {
  return HUMAN_BONES.filter((b) => map[b]);
}

/**
 * The character's own axes in world space: x = its right, y = up, z = forward. Taken from the
 * legs (or arms) and the object's up axis, so it works whichever way the model was authored
 * or turned.
 */
export interface CharacterFrame {
  right: Vector3;
  up: Vector3;
  forward: Vector3;
}

export function characterFrame(map: HumanoidMap, root: TransformNode): CharacterFrame {
  const up = Vector3.TransformNormal(Vector3.Up(), worldMatrix(root)).normalize();
  const pair: [HumanBone, HumanBone][] = [
    ['leftUpperLeg', 'rightUpperLeg'],
    ['leftUpperArm', 'rightUpperArm'],
    ['leftShoulder', 'rightShoulder'],
  ];
  let right = Vector3.TransformNormal(Vector3.Right(), worldMatrix(root));
  for (const [l, r] of pair) {
    if (map[l] && map[r]) {
      right = jointPosition(map[r]!).subtract(jointPosition(map[l]!));
      break;
    }
  }
  right = right.subtract(up.scale(Vector3.Dot(right, up))).normalize();
  return { right, up, forward: Vector3.Cross(right, up).normalize() };
}

export function toCharacter(f: CharacterFrame, w: Vector3) {
  return new Vector3(Vector3.Dot(w, f.right), Vector3.Dot(w, f.up), Vector3.Dot(w, f.forward));
}

export function fromCharacter(f: CharacterFrame, d: Vector3) {
  return f.right.scale(d.x).addInPlace(f.up.scale(d.y)).addInPlace(f.forward.scale(d.z));
}

/** Bone directions in the character's frame (copying poses between humanoids, mirroring). */
export function boneDirections(map: HumanoidMap, frame: CharacterFrame): Partial<Record<HumanBone, Vector3>> {
  const out: Partial<Record<HumanBone, Vector3>> = {};
  for (const b of bonesTopDown(map)) {
    const d = boneDirection(map, b);
    if (d) out[b] = toCharacter(frame, d);
  }
  return out;
}

/** Points each bone along the given directions (character frame), parents first. */
export function applyBoneDirections(map: HumanoidMap, frame: CharacterFrame, dirs: Partial<Record<HumanBone, Vector3>>) {
  for (const b of bonesTopDown(map)) {
    const d = dirs[b];
    if (d) aimBone(map, b, fromCharacter(frame, d));
  }
}

const reflect = (d: Vector3) => new Vector3(-d.x, d.y, d.z);

/** Mirrors the pose left ↔ right across the character's middle plane. */
export function mirrorPose(map: HumanoidMap, root: TransformNode) {
  const frame = characterFrame(map, root);
  const dirs = boneDirections(map, frame);
  const mirrored: Partial<Record<HumanBone, Vector3>> = {};
  for (const [b, d] of Object.entries(dirs) as [HumanBone, Vector3][]) mirrored[mirrorBone(b)] = reflect(d);
  applyBoneDirections(map, frame, mirrored);
}

/** Copies one side onto the other (pose the left arm, then make the right one match). */
export function symmetrize(map: HumanoidMap, root: TransformNode, from: 'left' | 'right') {
  const frame = characterFrame(map, root);
  const dirs = boneDirections(map, frame);
  const out: Partial<Record<HumanBone, Vector3>> = {};
  for (const [b, d] of Object.entries(dirs) as [HumanBone, Vector3][]) if (b.startsWith(from)) out[mirrorBone(b)] = reflect(d);
  applyBoneDirections(map, frame, out);
}

/**
 * Two-bone IK (arm or leg): moves the chain's end joint to `target`, bending the middle joint
 * towards `pole` (or keeping its current bend direction). Results are plain FK rotations.
 */
export function solveTwoBone(upper: TransformNode, middle: TransformNode, end: TransformNode, target: Vector3, pole?: Vector3) {
  const a = jointPosition(upper);
  const b = jointPosition(middle);
  const c = jointPosition(end);
  const l1 = Vector3.Distance(a, b);
  const l2 = Vector3.Distance(b, c);
  const toTarget = target.subtract(a);
  const dist = Math.min(Math.max(toTarget.length(), Math.abs(l1 - l2) + 1e-4), l1 + l2 - 1e-4);
  const dir = toTarget.lengthSquared() > 1e-12 ? toTarget.normalize() : c.subtract(a).normalize();
  // Bend plane: from the current elbow/knee (or the pole hint)
  const bendHint = (pole ?? b).subtract(a);
  let bend = bendHint.subtract(dir.scale(Vector3.Dot(bendHint, dir)));
  if (bend.lengthSquared() < 1e-10) bend = Vector3.Cross(dir, Math.abs(dir.y) < 0.9 ? Vector3.Up() : Vector3.Right());
  bend.normalize();
  // Law of cosines: angle at the upper joint between the target line and the upper bone
  const cosA = Math.min(1, Math.max(-1, (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)));
  const angA = Math.acos(cosA);
  const elbow = a.add(dir.scale(Math.cos(angA) * l1)).add(bend.scale(Math.sin(angA) * l1));
  rotateJointWorld(upper, aimRotation(b.subtract(a), elbow.subtract(a)));
  const b2 = jointPosition(middle);
  const c2 = jointPosition(end);
  rotateJointWorld(middle, aimRotation(c2.subtract(b2), a.add(dir.scale(dist)).subtract(b2)));
}

/** Bones whose chains IK can move: end joint → [upper, middle]. */
export const IK_CHAINS: Partial<Record<HumanBone, [HumanBone, HumanBone]>> = {
  leftHand: ['leftUpperArm', 'leftLowerArm'],
  rightHand: ['rightUpperArm', 'rightLowerArm'],
  leftFoot: ['leftUpperLeg', 'leftLowerLeg'],
  rightFoot: ['rightUpperLeg', 'rightLowerLeg'],
};

/** Bones a canonical bone hangs from, nearest first (skips bones the model doesn't have). */
export function mappedParent(map: HumanoidMap, bone: HumanBone): HumanBone | null {
  for (let p = BONE_PARENT[bone]; p; p = BONE_PARENT[p]) if (map[p]) return p;
  return null;
}

// ---------- Pose mode ----------

export type PoseTool = 'rotate' | 'move';

/** A joint offered for posing: its node and, on humanoids, its canonical bone. */
export interface PoseJoint {
  node: TransformNode;
  bone?: HumanBone;
}

/**
 * Posing an object's skeleton by hand: pick a joint, turn it (rotation gizmo or sliders) or,
 * for hands and feet, drag it and let IK bend the arm or leg. Each change is one undo step.
 * The clip is paused while posing; the pose is kept over it until the clip plays again.
 */
export class Poser {
  private readonly editor: Editor;
  entity: Entity | null = null;
  joint: PoseJoint | null = null;
  tool: PoseTool = 'rotate';
  /** Gizmo target for IK: the hand/foot follows it. */
  readonly ikTarget: TransformNode;
  private before: JointState[] | null = null;

  constructor(editor: Editor) {
    this.editor = editor;
    this.ikTarget = new TransformNode('ikTarget', editor.scene);
  }

  get active() {
    return !!this.entity;
  }

  /** Humanoid map of the posed object (null for other skeletons). */
  get human(): HumanoidMap | null {
    const d = this.entity ? humanoidOf(this.entity) : null;
    return d?.humanoid ? d.map : null;
  }

  /** Joints shown as handles: the canonical bones of a humanoid, every joint otherwise. */
  joints(entity = this.entity): PoseJoint[] {
    if (!entity) return [];
    const d = humanoidOf(entity);
    if (d?.humanoid) return bonesTopDown(d.map).map((bone) => ({ node: d.map[bone]!, bone }));
    return jointNodes(entity).map((node) => ({ node }));
  }

  start(entity: Entity) {
    if (!skeletonsOf(entity).length) return;
    if (this.entity !== entity) this.stop();
    this.entity = entity;
    this.editor.anim.hold(entity);
    this.editor.refreshTool();
    this.editor.notify('pose');
  }

  stop() {
    if (!this.entity) return;
    this.end();
    this.entity = null;
    this.joint = null;
    this.editor.refreshTool();
    this.editor.notify('pose');
  }

  selectJoint(joint: PoseJoint | null) {
    this.joint = joint;
    if (joint && !this.canMove(joint)) this.tool = 'rotate';
    this.placeIkTarget();
    this.editor.refreshTool();
    this.editor.notify('pose');
  }

  setTool(tool: PoseTool) {
    this.tool = tool;
    this.placeIkTarget();
    this.editor.refreshTool();
    this.editor.notify('pose');
  }

  /** Hands and feet can be dragged (IK moves the whole arm/leg). */
  canMove(joint = this.joint) {
    return !!joint?.bone && !!IK_CHAINS[joint.bone] && !!this.human;
  }

  /** What the gizmo should hold now. */
  gizmoTarget(): { node: TransformNode; mode: PoseTool } | null {
    if (!this.joint) return null;
    if (this.tool === 'move' && this.canMove()) return { node: this.ikTarget, mode: 'move' };
    return { node: this.joint.node, mode: 'rotate' };
  }

  private placeIkTarget() {
    if (this.joint) this.ikTarget.position.copyFrom(jointPosition(this.joint.node));
  }

  /** Start of a change (gizmo drag, slider…): remembers the joints for undo. */
  begin() {
    if (this.entity && !this.before) this.before = captureJoints(jointNodes(this.entity));
  }

  /** End of a change: one undo step if anything moved. */
  end() {
    const e = this.entity;
    const before = this.before;
    this.before = null;
    if (!e || !before) return;
    const after = captureJoints(before.map((s) => s.node));
    if (sameJoints(before, after)) return;
    const wasPosed = !!e.posed;
    e.posed = true;
    const apply = (states: JointState[], posed: boolean) => {
      this.editor.anim.hold(e);
      restoreJoints(states);
      e.posed = posed;
      this.placeIkTarget();
      this.editor.notify('pose');
    };
    this.editor.record({ undo: () => apply(before, wasPosed), redo: () => apply(after, true) });
    this.placeIkTarget();
    this.editor.notify('pose');
  }

  /** Runs a pose change as one undo step. */
  change(fn: () => void) {
    if (!this.entity) return;
    this.begin();
    fn();
    this.end();
    this.editor.invalidate();
  }

  /** IK: the dragged target moved. */
  dragIk() {
    const map = this.human;
    const bone = this.joint?.bone;
    const chain = bone && IK_CHAINS[bone];
    if (!map || !chain || !bone) return;
    const [u, m] = chain;
    if (!map[u] || !map[m] || !map[bone]) return;
    this.begin();
    solveTwoBone(map[u]!, map[m]!, map[bone]!, this.ikTarget.position);
  }

  /** Turns the selected joint by `deg` around a character axis, from a remembered rotation. */
  turnJoint(axis: 'x' | 'y' | 'z', deg: number, from: Quaternion) {
    const node = this.joint?.node;
    if (!node || !this.entity) return;
    this.begin();
    rotationOf(node).copyFrom(from);
    const map = this.human;
    const f = map ? characterFrame(map, this.entity.root) : null;
    const axes = { x: f?.right ?? Vector3.Right(), y: f?.up ?? Vector3.Up(), z: f?.forward ?? Vector3.Forward() };
    rotateJointWorld(node, Quaternion.RotationAxis(axes[axis], (deg * Math.PI) / 180));
    this.editor.invalidate();
  }

  mirror() {
    const map = this.human;
    if (map) this.change(() => mirrorPose(map, this.entity!.root));
  }

  copySide(from: 'left' | 'right') {
    const map = this.human;
    if (map) this.change(() => symmetrize(map, this.entity!.root, from));
  }

  /** Back to the rest pose (one joint, or the whole skeleton). */
  reset(joint: TransformNode | null = null) {
    const e = this.entity;
    if (!e) return;
    this.change(() => {
      for (const skeleton of skeletonsOf(e)) {
        for (const bone of skeleton.bones) {
          const node = bone.getTransformNode();
          if (!node || (joint && node !== joint)) continue;
          const r = new Quaternion();
          const p = new Vector3();
          bone.getRestMatrix().decompose(undefined, r, p);
          rotationOf(node).copyFrom(r);
          node.position.copyFrom(p);
        }
      }
    });
  }

  /** Applies bone directions (a pose preset), starting from the rest pose. */
  applyDirections(entity: Entity, dirs: Partial<Record<HumanBone, Vector3>>) {
    const d = humanoidOf(entity);
    if (!d?.humanoid) return;
    this.start(entity);
    this.change(() => {
      for (const s of skeletonsOf(entity)) s.returnToRest();
      applyBoneDirections(d.map, characterFrame(d.map, entity.root), dirs);
    });
  }

  /** Back to the clip: drops the hand-made pose. */
  backToAnimation() {
    const e = this.entity;
    if (!e) return;
    this.stop();
    e.posed = false;
    if (e.animationGroups.length) this.editor.anim.play(e);
    else for (const s of skeletonsOf(e)) s.returnToRest();
    this.editor.notify('pose');
  }
}

