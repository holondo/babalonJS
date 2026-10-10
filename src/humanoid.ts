import { Quaternion, TransformNode, Vector3 } from '@babylonjs/core';
import type { Bone, Skeleton } from '@babylonjs/core';
import type { Entity } from './editor';

/**
 * Humanoid skeletons: canonical bone names (VRM humanoid names) and detection of which
 * joint of a model is which, whatever naming convention its author used
 * (Mixamo-style, Unreal, Blender/Rigify, VRM/VRoid, 3ds Max Biped, Quaternius…).
 *
 * Joints are always TransformNodes: glTF skeletons already drive their bones through
 * linked nodes, and skeletons without them get nodes created by `jointNodes()`.
 */

export const HUMAN_BONES = [
  'hips',
  'spine',
  'chest',
  'upperChest',
  'neck',
  'head',
  'leftShoulder',
  'leftUpperArm',
  'leftLowerArm',
  'leftHand',
  'rightShoulder',
  'rightUpperArm',
  'rightLowerArm',
  'rightHand',
  'leftUpperLeg',
  'leftLowerLeg',
  'leftFoot',
  'leftToes',
  'rightUpperLeg',
  'rightLowerLeg',
  'rightFoot',
  'rightToes',
] as const;

export type HumanBone = (typeof HUMAN_BONES)[number];
export type HumanoidMap = Partial<Record<HumanBone, TransformNode>>;

/** Bones every humanoid must have (as in the VRM specification). */
export const REQUIRED_BONES: HumanBone[] = [
  'hips',
  'spine',
  'head',
  'leftUpperArm',
  'leftLowerArm',
  'leftHand',
  'rightUpperArm',
  'rightLowerArm',
  'rightHand',
  'leftUpperLeg',
  'leftLowerLeg',
  'leftFoot',
  'rightUpperLeg',
  'rightLowerLeg',
  'rightFoot',
];

/** Canonical parent of each bone (when present; the nearest mapped ancestor is used otherwise). */
export const BONE_PARENT: Record<HumanBone, HumanBone | null> = {
  hips: null,
  spine: 'hips',
  chest: 'spine',
  upperChest: 'chest',
  neck: 'upperChest',
  head: 'neck',
  leftShoulder: 'upperChest',
  leftUpperArm: 'leftShoulder',
  leftLowerArm: 'leftUpperArm',
  leftHand: 'leftLowerArm',
  rightShoulder: 'upperChest',
  rightUpperArm: 'rightShoulder',
  rightLowerArm: 'rightUpperArm',
  rightHand: 'rightLowerArm',
  leftUpperLeg: 'hips',
  leftLowerLeg: 'leftUpperLeg',
  leftFoot: 'leftLowerLeg',
  leftToes: 'leftFoot',
  rightUpperLeg: 'hips',
  rightLowerLeg: 'rightUpperLeg',
  rightFoot: 'rightLowerLeg',
  rightToes: 'rightFoot',
};

/** The joint a bone points to (first one present): gives the bone's direction. */
export const BONE_TIP: Partial<Record<HumanBone, HumanBone[]>> = {
  hips: ['spine', 'chest', 'upperChest', 'neck'],
  spine: ['chest', 'upperChest', 'neck', 'head'],
  chest: ['upperChest', 'neck', 'head'],
  upperChest: ['neck', 'head'],
  neck: ['head'],
  leftShoulder: ['leftUpperArm'],
  leftUpperArm: ['leftLowerArm'],
  leftLowerArm: ['leftHand'],
  rightShoulder: ['rightUpperArm'],
  rightUpperArm: ['rightLowerArm'],
  rightLowerArm: ['rightHand'],
  leftUpperLeg: ['leftLowerLeg'],
  leftLowerLeg: ['leftFoot'],
  leftFoot: ['leftToes'],
  rightUpperLeg: ['rightLowerLeg'],
  rightLowerLeg: ['rightFoot'],
  rightFoot: ['rightToes'],
};

/** Left ↔ right counterpart (center bones map to themselves). */
export function mirrorBone(b: HumanBone): HumanBone {
  if (b.startsWith('left')) return ('right' + b.slice(4)) as HumanBone;
  if (b.startsWith('right')) return ('left' + b.slice(5)) as HumanBone;
  return b;
}

/** Short label for UI lists ("Left upper arm"). */
export function boneLabel(b: HumanBone | string) {
  // Named after the joint people point at (the shoulder is where the upper arm turns)
  const side = b.startsWith('left') ? 'Left ' : b.startsWith('right') ? 'Right ' : '';
  const part = b.replace(/^(left|right)/, '');
  const name = JOINT_NAMES[part] ?? part.replace(/([A-Z])/g, ' $1').trim().toLowerCase();
  const text = side + (side ? name : name[0].toUpperCase() + name.slice(1));
  return text[0].toUpperCase() + text.slice(1);
}

const JOINT_NAMES: Record<string, string> = {
  hips: 'hips',
  spine: 'lower spine',
  chest: 'middle spine',
  upperChest: 'upper spine',
  neck: 'neck',
  head: 'head',
  headTop: 'head top',
  Shoulder: 'collarbone',
  UpperArm: 'shoulder',
  LowerArm: 'elbow',
  Hand: 'wrist',
  HandTip: 'finger tips',
  UpperLeg: 'hip',
  LowerLeg: 'knee',
  Foot: 'ankle',
  Toes: 'toes',
  ToesTip: 'toe tips',
};

// ---------- Joints of a model ----------

/** Skeletons used by the entity's meshes. */
export function skeletonsOf(entity: Entity): Skeleton[] {
  const set = new Set<Skeleton>();
  for (const m of entity.meshes) if (m.skeleton) set.add(m.skeleton);
  return [...set];
}

/**
 * The joint nodes of an entity's skeletons, parents before children. Bones without a linked
 * node get one (same local transform), so posing and retargeting always work on nodes.
 */
export function jointNodes(entity: Entity): TransformNode[] {
  const out: TransformNode[] = [];
  const seen = new Set<TransformNode>();
  for (const skeleton of skeletonsOf(entity)) {
    const mesh = entity.meshes.find((m) => m.skeleton === skeleton)!;
    for (const bone of skeleton.bones) {
      let node = bone.getTransformNode();
      if (!node) node = linkNode(bone, mesh.parent as TransformNode | null);
      if (!seen.has(node)) {
        seen.add(node);
        out.push(node);
      }
    }
  }
  return out;
}

function linkNode(bone: Bone, meshParent: TransformNode | null): TransformNode {
  const node = new TransformNode(bone.name, bone.getScene());
  const parentBone = bone.getParent();
  node.parent = parentBone ? (parentBone.getTransformNode() ?? linkNode(parentBone, meshParent)) : meshParent;
  const scaling = new Vector3();
  const rotation = new Quaternion();
  const position = new Vector3();
  bone.getLocalMatrix().decompose(scaling, rotation, position);
  node.position.copyFrom(position);
  node.rotationQuaternion = rotation;
  node.scaling.copyFrom(scaling);
  bone.linkTransformNode(node);
  return node;
}

// ---------- Detection ----------

type Part = 'hips' | 'spine' | 'chest' | 'upperChest' | 'neck' | 'head' | 'shoulder' | 'upperArm' | 'lowerArm' | 'hand' | 'upperLeg' | 'lowerLeg' | 'foot' | 'toes';

const ALIASES: Record<string, Part> = {
  hips: 'hips',
  hip: 'hips',
  pelvis: 'hips',
  spine: 'spine',
  chest: 'chest',
  upperchest: 'upperChest',
  neck: 'neck',
  head: 'head',
  shoulder: 'shoulder',
  clavicle: 'shoulder',
  collar: 'shoulder',
  collarbone: 'shoulder',
  upperarm: 'upperArm',
  uparm: 'upperArm',
  arm: 'upperArm',
  humerus: 'upperArm',
  forearm: 'lowerArm',
  lowerarm: 'lowerArm',
  loarm: 'lowerArm',
  elbow: 'lowerArm',
  hand: 'hand',
  wrist: 'hand',
  upperleg: 'upperLeg',
  upleg: 'upperLeg',
  thigh: 'upperLeg',
  femur: 'upperLeg',
  lowerleg: 'lowerLeg',
  leg: 'lowerLeg',
  shin: 'lowerLeg',
  calf: 'lowerLeg',
  knee: 'lowerLeg',
  loleg: 'lowerLeg',
  foot: 'foot',
  ankle: 'foot',
  toe: 'toes',
  toes: 'toes',
  toebase: 'toes',
  ball: 'toes',
};

/** Tokens that only say where a bone comes from (rig prefixes) and carry no meaning. */
const NOISE = new Set(['def', 'deform', 'bip', 'bip01', 'bip001', 'j', 'b', 'bone', 'bn', 'c', 'cc', 'base', 'jnt', 'joint', 'rig', 'sk', 'ik', 'fk']);
const SIDE: Record<string, 'left' | 'right'> = { l: 'left', left: 'left', r: 'right', right: 'right' };

interface Parsed {
  part: Part;
  side: 'left' | 'right' | null;
  /** Number at the end of the name (spine1, spine.002…) */
  index: number;
  /** Deform bone of a Blender rig (preferred over control bones with the same name). */
  deform: boolean;
}

/** Reads what a joint name means: "mixamorig:LeftUpLeg" → upper leg, left. */
export function parseBoneName(raw: string): Parsed | null {
  // Namespaces ("mixamorig:", "Armature|") say nothing about the bone
  let s = raw.replace(/^.*[:|]/, '');
  const deform = /^def[-_.]/i.test(s);
  // Split camelCase and single-letter side prefixes: "LeftUpLeg" → "Left Up Leg", "LHand" → "L Hand"
  s = s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^([LR])([A-Z])/, '$1 $2');
  const tokens = s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let side: Parsed['side'] = null;
  const rest: string[] = [];
  for (const t of tokens) {
    if (SIDE[t]) side = SIDE[t];
    else if (!NOISE.has(t)) rest.push(t);
  }
  let base = rest.join('');
  let index = 0;
  const num = /^(.*?)(\d+)$/.exec(base);
  if (num && num[1]) {
    base = num[1];
    index = +num[2];
  }
  // Names like "spine01_twist" or "hand_end" are helpers, not the bone itself
  const part = ALIASES[base];
  if (!part) return null;
  return { part, side, index, deform };
}

export interface Detection {
  map: HumanoidMap;
  /** Required bones that weren't found. */
  missing: HumanBone[];
  /** All required bones mapped. */
  complete: boolean;
  /** Looks like a person at all (enough bones found to offer mapping the rest by hand). */
  humanoid: boolean;
}

function depth(n: TransformNode) {
  let d = 0;
  for (let p = n.parent; p; p = p.parent) d++;
  return d;
}

function isAncestor(a: TransformNode, b: TransformNode) {
  for (let p = b.parent; p; p = p.parent) if (p === a) return true;
  return false;
}

/** Path of nodes strictly between `top` and `bottom` (top → bottom order). */
function between(top: TransformNode, bottom: TransformNode): TransformNode[] {
  const path: TransformNode[] = [];
  for (let p = bottom.parent as TransformNode | null; p && p !== top; p = p.parent as TransformNode | null) path.unshift(p);
  return path;
}

/** Finds the canonical bones among the joints by name and structure. */
export function detectHumanoid(joints: TransformNode[]): Detection {
  const candidates = new Map<HumanBone, { node: TransformNode; p: Parsed }[]>();
  const add = (bone: HumanBone, node: TransformNode, p: Parsed) => {
    if (!candidates.has(bone)) candidates.set(bone, []);
    candidates.get(bone)!.push({ node, p });
  };
  for (const node of joints) {
    const p = parseBoneName(node.name);
    if (!p) continue;
    const limb = ['shoulder', 'upperArm', 'lowerArm', 'hand', 'upperLeg', 'lowerLeg', 'foot', 'toes'].includes(p.part);
    if (limb) {
      if (!p.side) continue;
      add(`${p.side}${p.part[0].toUpperCase()}${p.part.slice(1)}` as HumanBone, node, p);
    } else if (!p.side) {
      add(p.part as HumanBone, node, p);
    }
  }
  // Several candidates (twist or control bones): deform bones first, then the one closest to the root
  const pick = (bone: HumanBone) =>
    candidates
      .get(bone)
      ?.sort((a, b) => Number(b.p.deform) - Number(a.p.deform) || depth(a.node) - depth(b.node) || a.p.index - b.p.index)[0]?.node;
  const map: HumanoidMap = {};
  for (const bone of HUMAN_BONES) {
    if (['spine', 'chest', 'upperChest'].includes(bone)) continue;
    const node = pick(bone);
    if (node) map[bone] = node;
  }
  // Limbs must hang from each other: drop a match that's not below its canonical parent
  for (const side of ['left', 'right'] as const) {
    for (const chain of [
      ['Shoulder', 'UpperArm', 'LowerArm', 'Hand'],
      ['UpperLeg', 'LowerLeg', 'Foot', 'Toes'],
    ]) {
      for (let i = 1; i < chain.length; i++) {
        const parent = map[`${side}${chain[i - 1]}` as HumanBone];
        const child = `${side}${chain[i]}` as HumanBone;
        if (parent && map[child] && !isAncestor(parent, map[child]!)) delete map[child];
      }
    }
  }
  // Hips: by name, or where both legs meet
  if (!map.hips && map.leftUpperLeg && map.rightUpperLeg) {
    for (let p = map.leftUpperLeg.parent as TransformNode | null; p; p = p.parent as TransformNode | null) {
      if (isAncestor(p, map.rightUpperLeg)) {
        map.hips = p;
        break;
      }
    }
  }
  // Spine chain: the joints between the hips and the neck (or head), bottom to top
  const top = map.neck ?? map.head ?? (map.leftUpperArm && map.rightUpperArm ? commonAncestor(map.leftUpperArm, map.rightUpperArm) : undefined);
  if (map.hips && top && isAncestor(map.hips, top)) {
    const chain = between(map.hips, top);
    if (!map.neck && !map.head && top) chain.push(top);
    if (chain.length >= 1) map.spine = chain[0];
    if (chain.length >= 2) map.chest = chain[1];
    if (chain.length >= 3) map.upperChest = chain[chain.length - 1];
  } else {
    const spine = pick('spine');
    if (spine) map.spine = spine;
    const chest = pick('chest');
    if (chest) map.chest = chest;
  }
  const missing = REQUIRED_BONES.filter((b) => !map[b]);
  const found = REQUIRED_BONES.length - missing.length;
  return { map, missing, complete: missing.length === 0, humanoid: found >= 8 && !!(map.hips || map.leftUpperLeg) };
}

function commonAncestor(a: TransformNode, b: TransformNode): TransformNode | undefined {
  for (let p = a.parent as TransformNode | null; p; p = p.parent as TransformNode | null) if (isAncestor(p, b)) return p;
  return undefined;
}

/** Map from saved joint names (manual mapping, or a project) back to nodes. */
export function mapFromNames(joints: TransformNode[], names: Partial<Record<HumanBone, string>>): HumanoidMap {
  const byName = new Map(joints.map((j) => [j.name, j]));
  const map: HumanoidMap = {};
  for (const [bone, name] of Object.entries(names) as [HumanBone, string][]) {
    const node = byName.get(name);
    if (node) map[bone] = node;
  }
  return map;
}

export function mapToNames(map: HumanoidMap): Partial<Record<HumanBone, string>> {
  const out: Partial<Record<HumanBone, string>> = {};
  for (const [bone, node] of Object.entries(map) as [HumanBone, TransformNode][]) out[bone] = node.name;
  return out;
}

/**
 * Up-to-date world matrix of a node. Babylon caches world matrices, and a child only reads its
 * parent's cached one: after a parent joint turns, every ancestor must be recomputed top-down.
 */
export function worldMatrix(node: TransformNode) {
  const chain: TransformNode[] = [];
  for (let n: TransformNode | null = node; n; n = n.parent as TransformNode | null) chain.push(n);
  for (let i = chain.length - 1; i > 0; i--) chain[i].computeWorldMatrix(true);
  return node.computeWorldMatrix(true);
}

/** World position of a joint (up to date). */
export function jointPosition(node: TransformNode) {
  return worldMatrix(node).getTranslation();
}

/** Direction a bone points to in world space (towards its tip joint), or null for end bones. */
export function boneDirection(map: HumanoidMap, bone: HumanBone): Vector3 | null {
  const node = map[bone];
  const tip = BONE_TIP[bone]?.map((b) => map[b]).find(Boolean);
  if (!node || !tip) return null;
  const d = jointPosition(tip).subtract(jointPosition(node));
  return d.lengthSquared() > 1e-12 ? d.normalize() : null;
}

// ---------- Per object ----------

const detections = new WeakMap<Entity, Detection>();

/**
 * Humanoid bones of an object (null when it has no skeleton): automatic detection plus the
 * bones the user mapped by hand (`entity.boneMap`, saved with the project).
 */
export function humanoidOf(entity: Entity): Detection | null {
  if (!skeletonsOf(entity).length) return null;
  let d = detections.get(entity);
  if (!d) {
    const joints = jointNodes(entity);
    d = detectHumanoid(joints);
    if (entity.boneMap) {
      const manual = mapFromNames(joints, entity.boneMap);
      const map = { ...d.map, ...manual };
      const missing = REQUIRED_BONES.filter((b) => !map[b]);
      d = { map, missing, complete: !missing.length, humanoid: d.humanoid || Object.keys(manual).length > 0 };
    }
    detections.set(entity, d);
  }
  return d;
}

/** Maps a bone by hand (or clears the manual choice with null). */
export function setBoneMapping(entity: Entity, bone: HumanBone, jointName: string | null) {
  const map = { ...(entity.boneMap ?? {}) };
  if (jointName) map[bone] = jointName;
  else delete map[bone];
  entity.boneMap = Object.keys(map).length ? map : undefined;
  detections.delete(entity);
}

/** Forgets the cached detection (after the skeleton changed, e.g. rigging). */
export function forgetHumanoid(entity: Entity) {
  detections.delete(entity);
}
