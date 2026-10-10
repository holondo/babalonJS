import { Animation, Bone, Matrix, Mesh, Quaternion, Skeleton, SkeletonViewer, TransformNode, Vector3, VertexBuffer } from '@babylonjs/core';
import type { AbstractMesh, AnimationGroup, Geometry, Material, Node } from '@babylonjs/core';
import type { Editor, Entity } from './editor';
import { forgetHumanoid, jointPosition, skeletonsOf, worldMatrix } from './humanoid';
import type { HumanBone, HumanoidMap } from './humanoid';
import { BONE_END, RIG_TEMPLATE, TEMPLATE_HEIGHT, TIP_JOINTS, templateJoint } from './humanoidTemplate';
import type { RigJoint } from './humanoidTemplate';
import { applyBoneDirections, captureJoints, characterFrame, restoreJoints } from './pose';
import type { JointState } from './pose';
import { INFLUENCES, computeSkinWeights, envelopeWeights, strongest, weld } from './weights';
import type { WeightJob, SkinInput, SkinWeights } from './weights';
import { tr } from './i18n';
import { SHOULDER_STRATEGIES, shoulderWeights } from './shoulderWeights';
import type { ShoulderStrategy } from './shoulderWeights';

/**
 * Manual rigging (E1/E2): the standard skeleton (humanoidTemplate.ts) appears fitted to a static
 * model; the user drags its joints into place in a front view (depth is found automatically,
 * left and right mirror each other); then the mesh is bound to the skeleton with automatic skin
 * weights, checked with a test pose and a weight heat map, and confirmed (one undo step).
 * Cancelling leaves the model exactly as it was.
 */

export type RigStep = 'place' | 'check';
export type WeightMethod = 'envelope' | 'heat';

/** What a rig is made of (saved with projects; positions in the skeleton's space). */
export interface RigData {
  joints: Partial<Record<RigJoint, number[]>>;
  /** 1: the model faces +Z, -1: it faces -Z. */
  facing: 1 | -1;
  /** Which way the model faces, as a turn around the vertical axis (0 = +Z). */
  yaw?: number;
  method: WeightMethod;
  shoulderStrategy?: ShoulderStrategy;
  /** Comparisons share ready poses, including after reloading the project. */
  comparison?: string;
}

interface MeshBackup {
  mesh: Mesh;
  parent: Node | null;
  position: Vector3;
  rotation: Vector3;
  rotationQuaternion: Quaternion | null;
  scaling: Vector3;
  geometry: Geometry | null;
}

/** A bound rig: skeleton, joint nodes and what's needed to undo/redo the binding. */
export interface RigState {
  data: RigData;
  node: TransformNode;
  skeleton: Skeleton;
  joints: Map<RigJoint, TransformNode>;
  backups: MeshBackup[];
  /** Bound geometry of each mesh (with skin weights). */
  geometries: (Geometry | null)[];
  helpers: { node: TransformNode; driver: TransformNode }[];
}

/** Center joints: kept on the middle line when symmetry is on. */
const CENTER: RigJoint[] = ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'headTop'];
const BONES = RIG_TEMPLATE.filter((j) => !TIP_JOINTS.includes(j.id));
const ratio = (id: RigJoint) => (templateJoint(id).pos[1] - templateJoint('hips').pos[1]) / (templateJoint('neck').pos[1] - templateJoint('hips').pos[1]);

/** Test pose (character frame): arms down and forward, one knee up, a little lean. */
const TEST_POSE: Partial<Record<HumanBone, [number, number, number]>> = {
  leftUpperArm: [-0.35, -0.8, 0.45],
  leftLowerArm: [0.25, -0.2, 0.95],
  rightUpperArm: [0.35, -0.8, 0.45],
  rightLowerArm: [-0.25, -0.2, 0.95],
  leftUpperLeg: [0, -0.45, 0.9],
  leftLowerLeg: [0, -1, -0.05],
  spine: [0, 0.95, 0.3],
};

export class Rigger {
  private readonly editor: Editor;
  entity: Entity | null = null;
  step: RigStep = 'place';
  symmetric = true;
  /** Which way the model faces (radians around Y in its own space; 0 = +Z, π/2 = +X). */
  yaw = 0;
  method: WeightMethod = 'envelope';
  shoulderStrategy: ShoulderStrategy = 'current';
  comparing = false;
  /** Heat weights progress (0–1) while computing. */
  progress: number | null = null;
  testPose = 0;
  heatBone: HumanBone | null = null;
  /** Heat weights failed and envelope weights were used (the interface tells the user once). */
  fellBack = false;
  /** Joint positions in the object's own (root) space. */
  readonly joints = new Map<RigJoint, Vector3>();
  /** Joint placement history while rigging (undo/redo of drags, turns, resets). */
  private past: { yaw: number; joints: Map<RigJoint, Vector3> }[] = [];
  private future: { yaw: number; joints: Map<RigJoint, Vector3> }[] = [];
  private box = { min: Vector3.Zero(), max: Vector3.Zero() };
  private scale = 1;
  private pending: RigState | null = null;
  private rest: JointState[] | null = null;
  private job: WeightJob | null = null;
  private readonly heatMaterials = new Map<AbstractMesh, Material | null>();

  constructor(editor: Editor) {
    this.editor = editor;
  }

  updateHelpers() {
    for (const e of this.editor.entities) if (e.rig && e.root.isEnabled()) updateShoulderHelpers(e.rig);
    if (this.pending) updateShoulderHelpers(this.pending);
  }

  get active() {
    return !!this.entity;
  }

  /** Static models made of regular meshes can be rigged. */
  canRig(e: Entity) {
    return e.kind === 'model' && !skeletonsOf(e).length && e.meshes.length > 0 && e.meshes.every((m) => m instanceof Mesh && m.getTotalIndices() > 0);
  }

  // ---------- Placing the joints ----------

  start(e: Entity) {
    if (!this.canRig(e)) return;
    this.editor.pose.stop();
    this.entity = e;
    this.step = 'place';
    this.testPose = 0;
    this.heatBone = null;
    this.box = this.rootBounds(e);
    this.yaw = this.guessYaw(e);
    this.past = [];
    this.future = [];
    this.selected = null;
    this.cachedPoints = null;
    this.fit();
    this.frontView();
    this.editor.refreshTool();
    this.editor.notify('rig');
  }

  /** Leaves rigging without changing the model. */
  cancel() {
    if (!this.entity) return;
    this.job?.cancel();
    if (this.pending) this.discardPending();
    this.entity = null;
    this.editor.refreshTool();
    this.editor.notify('rig');
  }

  /** Turns the template around the model (`quarter`: 90°, otherwise 180°). */
  turn(quarter = false) {
    this.remember();
    this.yaw = (this.yaw + (quarter ? Math.PI / 2 : Math.PI)) % (Math.PI * 2);
    this.fit();
    this.frontView();
    this.editor.notify('rig');
  }

  setSymmetric(on: boolean) {
    this.remember();
    this.symmetric = on;
    if (on) for (const j of RIG_TEMPLATE) if (j.handle && j.id.startsWith('left')) this.mirrorFrom(j.id);
    this.derive();
    this.editor.notify('rig');
  }

  /** Camera straight in front of the model (the view the joints are placed in). */
  frontView() {
    const e = this.entity;
    if (!e) return;
    const rot = worldMatrix(e.root).getRotationMatrix();
    const forward = Vector3.TransformNormal(this.fwd, rot).normalize();
    const center = this.toWorld(this.box.min.add(this.box.max).scale(0.5));
    const size = this.box.max.subtract(this.box.min).multiply(e.root.scaling);
    this.editor.viewFrom(forward, center, size);
  }

  /** Template joints scaled to the model (arms lowered to match an A-pose), depth found on the mesh. */
  fit() {
    const e = this.entity!;
    this.box = this.rootBounds(e);
    const { min, max } = this.box;
    const s = (this.scale = (max.y - min.y) / TEMPLATE_HEIGHT);
    const c = this.center();
    const r = this.right;
    const f = this.fwd;
    // Arms: a model narrower than the T-pose has its arms lowered (A-pose)
    const reach = (templateJoint('rightHandTip').pos[0] - templateJoint('rightUpperArm').pos[0]) * s;
    const halfWidth = (Math.abs(r.x) * (max.x - min.x) + Math.abs(r.z) * (max.z - min.z)) / 2;
    const cos = Math.min(1, Math.max(0.05, (halfWidth - templateJoint('rightUpperArm').pos[0] * s) / reach));
    const angle = cos > 0.92 ? 0 : Math.acos(cos);
    this.joints.clear();
    for (const j of RIG_TEMPLATE) {
      let [x, y, z] = j.pos;
      if (angle && /(UpperArm|LowerArm|Hand|HandTip)$/.test(j.id)) {
        const side = j.id.startsWith('left') ? 'left' : 'right';
        const [sx, sy] = templateJoint(`${side}UpperArm` as RigJoint).pos;
        const dx = x - sx;
        x = sx + dx * Math.cos(angle);
        y = sy - Math.abs(dx) * Math.sin(angle);
      }
      this.joints.set(j.id, c.add(r.scale(x * s)).addInPlace(f.scale(z * s)).addInPlace(new Vector3(0, y * s + min.y, 0)));
    }
    for (const j of RIG_TEMPLATE) if (j.handle && !j.id.endsWith('Toes')) this.findDepth(j.id);
    this.derive();
  }

  /**
   * Finds the joints from the shape of the mesh (standing model, arms open in a T or A pose):
   * where the legs split (crotch), the narrowest part above the shoulders (neck), the arm and
   * leg ends; elbows, knees and wrists by the template's proportions along each limb.
   */
  findPose() {
    const e = this.entity;
    if (!e || this.step !== 'place') return false;
    const { min, max } = this.box;
    const H = max.y - min.y;
    const c = this.center();
    const r = this.right;
    const f = this.fwd;
    // Points as (u = right, v = height above the feet, w = forward), at most ~60k
    const inv = worldMatrix(e.root).clone().invert();
    const total = e.meshes.reduce((n, m) => n + m.getTotalVertices(), 0);
    const step = Math.max(1, Math.floor(total / 60000));
    const U: number[] = [];
    const V: number[] = [];
    const W: number[] = [];
    const p = new Vector3();
    for (const m of e.meshes) {
      const pos = m.getVerticesData(VertexBuffer.PositionKind);
      if (!pos) continue;
      const toRoot = worldMatrix(m).multiply(inv);
      for (let i = 0; i < pos.length; i += 3 * step) {
        Vector3.TransformCoordinatesFromFloatsToRef(pos[i], pos[i + 1], pos[i + 2], toRoot, p);
        const d = p.subtract(c);
        U.push(Vector3.Dot(d, r));
        V.push(p.y - min.y);
        W.push(Vector3.Dot(d, f));
      }
    }
    const n = U.length;
    if (n < 50) return false;
    const band = H * 0.012;
    const slice = (v: number, filter: (i: number) => boolean = () => true) => {
      const out: number[] = [];
      for (let i = 0; i < n; i++) if (Math.abs(V[i] - v) < band && filter(i)) out.push(i);
      return out;
    };
    /** The body piece around the middle line at a height ([from, to] along u). */
    const middle = (v: number) => {
      const us = slice(v)
        .map((i) => U[i])
        .sort((a, b) => a - b);
      if (!us.length) return null;
      let lo = 0;
      let best: [number, number] | null = null;
      for (let i = 1; i <= us.length; i++) {
        if (i === us.length || us[i] - us[i - 1] > H * 0.02) {
          const a = us[lo];
          const b = us[i - 1];
          if (!best || Math.abs((a + b) / 2) < Math.abs((best[0] + best[1]) / 2)) best = [a, b];
          lo = i;
        }
      }
      return best;
    };
    const mean = (ids: number[], arr: number[]) => (ids.length ? ids.reduce((t, i) => t + arr[i], 0) / ids.length : 0);
    // Crotch: the lowest height where something covers the middle line
    let crotch = H * 0.45;
    for (let v = H * 0.2; v < H * 0.65; v += band) {
      if (slice(v, (i) => Math.abs(U[i]) < H * 0.012).length) {
        crotch = v;
        break;
      }
    }
    // Neck: the narrowest middle piece between the shoulders and the head
    let neckV = H * 0.84;
    let narrow = Infinity;
    for (let v = H * 0.76; v < H * 0.93; v += band) {
      const m = middle(v);
      if (m && m[1] - m[0] < narrow) {
        narrow = m[1] - m[0];
        neckV = v;
      }
    }
    const chest = middle(H * 0.7);
    const torsoHalf = chest ? (chest[1] - chest[0]) / 2 : H * 0.11;
    const at = (u: number, v: number, w = 0) => c.add(r.scale(u)).addInPlace(f.scale(w)).addInPlace(new Vector3(0, min.y + v, 0));
    const J = (id: RigJoint) => this.joints.get(id)!;
    const s = this.scale;
    J('hips').copyFrom(at(0, crotch + H * 0.05));
    J('neck').copyFrom(at(0, neckV - H * 0.025));
    J('head').copyFrom(at(0, neckV + H * 0.02));
    for (const sideSign of [-1, 1]) {
      const name = sideSign < 0 ? 'left' : 'right';
      const j = (k: string) => J(`${name}${k}` as RigJoint);
      const mine = (i: number) => U[i] * sideSign > H * 0.01;
      // Legs
      const thigh = slice(crotch - H * 0.04, mine);
      const hipU = thigh.length ? mean(thigh, U) : sideSign * H * 0.05;
      const feet: number[] = [];
      for (let i = 0; i < n; i++) if (V[i] < H * 0.1 && mine(i)) feet.push(i);
      const footU = feet.length ? mean(feet, U) : hipU;
      const ankleV = H * 0.055;
      j('UpperLeg').copyFrom(at(hipU, crotch + H * 0.06));
      j('Foot').copyFrom(at(footU, ankleV));
      const kneeV = (crotch + H * 0.06 + ankleV) / 2;
      const knee = slice(kneeV, mine);
      j('LowerLeg').copyFrom(at(knee.length ? mean(knee, U) : (hipU + footU) / 2, kneeV));
      let front = -Infinity;
      for (const i of feet) front = Math.max(front, W[i]);
      j('Toes').copyFrom(at(footU, H * 0.008, (Number.isFinite(front) ? front : H * 0.1) - 0.092 * s));
      // Arms: from the shoulder to the furthest point on this side (the finger tips)
      let tip = -1;
      for (let i = 0; i < n; i++) if (V[i] > crotch && (tip < 0 || U[i] * sideSign > U[tip] * sideSign)) tip = i;
      const shoulder = at(sideSign * torsoHalf * 0.85, H * 0.787);
      const tipP = tip >= 0 ? at(U[tip], V[tip]) : shoulder;
      j('UpperArm').copyFrom(shoulder);
      j('LowerArm').copyFrom(Vector3.Lerp(shoulder, tipP, 0.351));
      j('Hand').copyFrom(Vector3.Lerp(shoulder, tipP, 0.701));
    }
    for (const j of RIG_TEMPLATE) if (j.handle && !j.id.endsWith('Toes')) this.findDepth(j.id);
    this.derive();
    this.placeHandle();
    this.editor.invalidate();
    this.editor.notify('rig');
    return true;
  }

  /** Joints the user drags (the others follow them). */
  handles() {
    return RIG_TEMPLATE.filter((j) => j.handle);
  }

  /** Joint picked for the move gizmo (axis-locked moves). */
  selected: RigJoint | null = null;
  private handleNode: TransformNode | null = null;

  /** Helper node the move gizmo holds (follows the selected joint). */
  get handle() {
    return (this.handleNode ??= new TransformNode('rigHandle', this.editor.scene));
  }

  selectJoint(id: RigJoint | null) {
    this.selected = this.selected === id ? null : id;
    this.placeHandle();
    this.editor.refreshTool();
    this.editor.notify('rig');
  }

  gizmoHandle() {
    return this.entity && this.step === 'place' && this.selected ? this.handle : null;
  }

  private placeHandle() {
    if (this.selected && this.entity) this.handle.position.copyFrom(this.jointWorld(this.selected));
  }

  /** The move gizmo moved the handle: the joint follows (mirrored with symmetry). */
  dragHandle() {
    const id = this.selected;
    if (!id || !this.entity) return;
    const p = this.toRoot(this.handle.position);
    if (this.symmetric && CENTER.includes(id)) p.subtractInPlace(this.right.scale(this.side(p)));
    this.joints.get(id)!.copyFrom(p);
    this.mirrorFrom(id);
    this.derive();
  }

  endHandleDrag() {
    this.placeHandle();
    this.editor.notify('rig');
  }

  /** Remembers the joints before a change (one undo step). */
  remember() {
    if (this.step !== 'place') return;
    this.past.push(this.snapshot());
    if (this.past.length > 100) this.past.shift();
    this.future = [];
    this.editor.notify('history');
  }

  get canUndo() {
    return this.step === 'place' ? this.past.length > 0 : false;
  }

  get canRedo() {
    return this.step === 'place' ? this.future.length > 0 : false;
  }

  undo() {
    const s = this.step === 'place' ? this.past.pop() : undefined;
    if (!s) return;
    this.future.push(this.snapshot());
    this.load(s);
  }

  redo() {
    const s = this.step === 'place' ? this.future.pop() : undefined;
    if (!s) return;
    this.past.push(this.snapshot());
    this.load(s);
  }

  private snapshot() {
    return { yaw: this.yaw, joints: new Map([...this.joints].map(([k, v]) => [k, v.clone()])) };
  }

  private load(s: { yaw: number; joints: Map<RigJoint, Vector3> }) {
    this.yaw = s.yaw;
    this.joints.clear();
    for (const [k, v] of s.joints) this.joints.set(k, v.clone());
    this.placeHandle();
    this.editor.invalidate();
    this.editor.notify('rig');
    this.editor.notify('history');
  }

  jointWorld(id: RigJoint) {
    return this.toWorld(this.joints.get(id)!);
  }

  /** Drags a joint to a screen position (CSS pixels on the canvas), keeping its depth. */
  dragJoint(id: RigJoint, x: number, y: number) {
    const ed = this.editor;
    const cam = ed.camera;
    const ray = ed.scene.createPickingRay(x, y, Matrix.Identity(), cam);
    const anchor = this.jointWorld(id);
    const normal = cam.getDirection(Vector3.Forward()).normalize();
    const denom = Vector3.Dot(ray.direction, normal);
    if (Math.abs(denom) < 1e-6) return;
    const t = Vector3.Dot(anchor.subtract(ray.origin), normal) / denom;
    const p = this.toRoot(ray.origin.add(ray.direction.scale(t)));
    const cur = this.joints.get(id)!;
    // Keep the depth (along the facing direction); center joints stay on the middle line
    const next = p.subtract(this.fwd.scale(Vector3.Dot(p.subtract(cur), this.fwd)));
    if (this.symmetric && CENTER.includes(id)) next.subtractInPlace(this.right.scale(this.side(next)));
    cur.copyFrom(next);
    this.mirrorFrom(id);
    this.derive();
  }

  /** After a drag: the joint goes to the middle of the body part under it. */
  endDrag(id: RigJoint) {
    if (!id.endsWith('Toes')) this.findDepth(id);
    if (this.selected === id) this.placeHandle();
    this.mirrorFrom(id);
    this.derive();
    this.editor.notify('rig');
  }

  /** Facing direction and the model's right, in its own space. */
  private get fwd() {
    return new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  private get right() {
    return new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  private center() {
    const c = this.box.min.add(this.box.max).scale(0.5);
    c.y = 0;
    return c;
  }

  /** Signed distance from the middle plane (positive: the model's right). */
  private side(p: Vector3) {
    return Vector3.Dot(p.subtract(this.center()), this.right);
  }

  /**
   * Which way the model faces: the arms (widest horizontal extent) run left–right, and the
   * toes stick out further in front of the feet than the heels behind.
   */
  private guessYaw(e: Entity) {
    const { min, max } = this.box;
    let yaw = max.x - min.x >= max.z - min.z ? 0 : Math.PI / 2;
    const inv = worldMatrix(e.root).clone().invert();
    const c = this.center();
    const low = min.y + (max.y - min.y) * 0.04;
    const f = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    let front = 0;
    let back = 0;
    const p = new Vector3();
    for (const m of e.meshes) {
      const pos = m.getVerticesData(VertexBuffer.PositionKind);
      if (!pos) continue;
      const toRoot = worldMatrix(m).multiply(inv);
      for (let i = 0; i < pos.length; i += 3) {
        Vector3.TransformCoordinatesFromFloatsToRef(pos[i], pos[i + 1], pos[i + 2], toRoot, p);
        if (p.y > low) continue;
        const w = Vector3.Dot(p.subtract(c), f);
        front = Math.max(front, w);
        back = Math.max(back, -w);
      }
    }
    if (back > front) yaw += Math.PI;
    return yaw;
  }

  private mirrorFrom(id: RigJoint) {
    if (!this.symmetric) return;
    const other = id.startsWith('left') ? id.replace('left', 'right') : id.startsWith('right') ? id.replace('right', 'left') : null;
    if (!other) return;
    const p = this.joints.get(id)!;
    this.joints.get(other as RigJoint)!.copyFrom(p.subtract(this.right.scale(2 * this.side(p))));
  }

  /**
   * Depth of a joint: a ray from the front through the joint enters and leaves the body part
   * there; the joint goes halfway between. No hit: the depth stays as it was.
   */
  private findDepth(id: RigJoint) {
    const p = this.joints.get(id)!;
    const { pos: pts, nrm } = this.points();
    const H = this.box.max.y - this.box.min.y;
    const r = this.right;
    const f = this.fwd;
    const pu = Vector3.Dot(p, r);
    const pw = Vector3.Dot(p, f);
    // Vertices in a thin cylinder through the joint, along the facing direction
    for (const radius of [H * 0.012, H * 0.025, H * 0.04]) {
      const hits: { w: number; facing: number }[] = [];
      for (let i = 0; i < pts.length; i += 3) {
        const dy = pts[i + 1] - p.y;
        if (dy > radius || dy < -radius) continue;
        const du = pts[i] * r.x + pts[i + 2] * r.z - pu;
        if (du * du + dy * dy > radius * radius) continue;
        hits.push({ w: pts[i] * f.x + pts[i + 2] * f.z, facing: nrm[i] * f.x + nrm[i + 2] * f.z });
      }
      if (hits.length < 4) continue;
      // Front to back: the front skin of the first body part, then its back skin (normals facing
      // backwards). The surface is hollow, so the joint goes halfway between the two.
      hits.sort((a, b) => b.w - a.w);
      const start = Math.max(0, hits.findIndex((h) => h.facing > 0.2));
      const entry = hits[start].w;
      // Walk back through this body part: it ends where, after an empty gap, a surface faces
      // the front again (another part behind it, like the chest behind an arm). Details inside
      // (mouth, fingers) don't break it; the last back-facing surface is its back skin.
      let back = entry;
      for (let k = start + 1; k < hits.length; k++) {
        const h = hits[k];
        if (h.facing > 0.2 && hits[k - 1].w - h.w > H * 0.05) break;
        if (h.facing < -0.2) back = h.w;
      }
      p.addInPlace(f.scale((entry + back) / 2 - pw));
      return;
    }
  }

  private cachedPoints: { entity: Entity; pos: Float32Array; nrm: Float32Array } | null = null;

  /** Every vertex (and normal) of the model in its root space, computed once per rigging session. */
  private points() {
    const e = this.entity!;
    if (this.cachedPoints?.entity === e) return this.cachedPoints;
    const inv = worldMatrix(e.root).clone().invert();
    const count = e.meshes.reduce((n, m) => n + m.getTotalVertices(), 0) * 3;
    const pos = new Float32Array(count);
    const nrm = new Float32Array(count);
    const p = new Vector3();
    const n = new Vector3();
    let k = 0;
    for (const m of e.meshes) {
      const vp = m.getVerticesData(VertexBuffer.PositionKind);
      const vn = m.getVerticesData(VertexBuffer.NormalKind);
      if (!vp) continue;
      const toRoot = worldMatrix(m).multiply(inv);
      for (let i = 0; i + 2 < vp.length; i += 3) {
        Vector3.TransformCoordinatesFromFloatsToRef(vp[i], vp[i + 1], vp[i + 2], toRoot, p);
        if (vn) Vector3.TransformNormalFromFloatsToRef(vn[i], vn[i + 1], vn[i + 2], toRoot, n).normalize();
        else n.setAll(0);
        pos[k] = p.x;
        pos[k + 1] = p.y;
        pos[k + 2] = p.z;
        nrm[k] = n.x;
        nrm[k + 1] = n.y;
        nrm[k + 2] = n.z;
        k += 3;
      }
    }
    this.cachedPoints = { entity: e, pos, nrm };
    return this.cachedPoints;
  }

  /** Spine, shoulders and bone ends follow the joints the user placed. */
  private derive() {
    const J = (id: RigJoint) => this.joints.get(id)!;
    const hips = J('hips');
    const neck = J('neck');
    for (const id of ['spine', 'chest', 'upperChest'] as RigJoint[]) J(id).copyFrom(Vector3.Lerp(hips, neck, ratio(id)));
    const s = this.scale;
    const head = J('head');
    J('headTop').copyFrom(new Vector3(head.x, Math.max(this.box.max.y, head.y + 0.1 * s), head.z));
    for (const side of ['left', 'right']) {
      const j = (n: string) => J(`${side}${n}` as RigJoint);
      j('Shoulder').copyFrom(Vector3.Lerp(Vector3.Lerp(J('upperChest'), neck, 0.83), j('UpperArm'), 0.3));
      j('HandTip').copyFrom(j('Hand').add(j('Hand').subtract(j('LowerArm')).scale(0.85)));
      j('ToesTip').copyFrom(j('Toes').add(this.fwd.scale(0.092 * s)));
    }
  }

  // ---------- Binding ----------

  /** Binds the mesh to the skeleton and moves on to checking it. */
  async bind() {
    const e = this.entity;
    if (!e || this.pending || this.progress !== null || this.comparing) return;
    const positions = new Map<RigJoint, Vector3>([...this.joints].map(([id, p]) => [id, p.clone()]));
    const state = this.build(e, positions);
    let weights: SkinWeights;
    try {
      weights = await this.computeWeights(state);
    } catch (err) {
      this.unbind(e, state, true);
      if (err instanceof DOMException && err.name === 'AbortError') return;
      throw err;
    }
    if (this.entity !== e) return this.unbind(e, state, true);
    this.applyWeights(state, weights);
    this.pending = state;
    this.step = 'check';
    this.rest = captureJoints([...state.joints.values()]);
    this.editor.invalidate();
    this.editor.notify('rig');
  }

  /** Prepare all variants from one solver run and publish them atomically; the source stays untouched. */
  async createComparison() {
    const source = this.entity;
    if (!source?.source || this.step !== 'place' || this.progress !== null || this.comparing) return;
    const positions = new Map([...this.joints].map(([id, p]) => [id, p.clone()]));
    const copies: Entity[] = [];
    const states: RigState[] = [];
    this.comparing = true;
    const comparison = crypto.randomUUID();
    try {
      const direction = Vector3.TransformNormal(this.right, worldMatrix(source.root)).normalize();
      const size = this.box.max.subtract(this.box.min);
      const spacing = (Math.abs(this.right.x)*size.x + Math.abs(this.right.z)*size.z) * Math.max(source.root.scaling.x, source.root.scaling.z) * 1.15;
      for (const [i, strategy] of SHOULDER_STRATEGIES.entries()) {
        const copy = this.editor.createModelCopy(source);
        copies.push(copy);
        copy.name = `${source.name} — ${tr(strategy.label)}`;
        const st = this.build(copy, positions, undefined, strategy.value);
        states.push(st);
        st.data.comparison = comparison;
        // Joint positions are transformed while the copy still has the source's exact transform.
        copy.root.position.addInPlace(direction.scale(spacing * (i - 1)));
      }
      const weights = await this.computeWeights(states[0], true);
      if (this.entity !== source) throw new DOMException('Cancelled', 'AbortError');
      if (!weights.variants) throw new Error(tr('Could not create the rig comparison.'));
      states.forEach((st, i) => {
        st.data.method = states[0].data.method;
        this.applyWeights(st, weights.variants![SHOULDER_STRATEGIES[i].value]);
        copies[i].rig = st;
        forgetHumanoid(copies[i]);
      });
      this.entity = null;
      this.editor.addModelComparison(copies, source);
    } catch (err) {
      states.forEach((st, i) => this.unbind(copies[i], st, true));
      copies.forEach(e => e.root.dispose(false, false));
      if (!(err instanceof DOMException && err.name === 'AbortError')) throw err;
    } finally {
      this.comparing = false;
      this.editor.refreshTool();
      this.editor.notify('rig');
    }
  }

  comparisonMembers(e: Entity) {
    const id = e.rig?.data.comparison;
    return id ? this.editor.entities.filter(other => other.rig?.data.comparison === id) : [e];
  }

  /** Back to placing the joints (drops the binding). */
  adjust() {
    if (!this.pending) return;
    this.discardPending();
    this.step = 'place';
    this.editor.notify('rig');
  }

  /** Keeps the rig: the model is now a skinned character (one undo step). */
  confirm() {
    const e = this.entity;
    const state = this.pending;
    if (!e || !state) return;
    this.setTestPose(0);
    this.setHeatBone(null);
    this.pending = null;
    this.entity = null;
    e.rig = state;
    this.editor.record({ undo: () => this.unbind(e, state, false), redo: () => this.rebind(e, state) });
    forgetHumanoid(e);
    this.editor.refreshTool();
    this.editor.notify('rig');
    this.editor.notify('entities');
  }

  /** Cancels the heat-weights computation. */
  stopComputing() {
    this.job?.cancel();
  }

  setTestPose(t: number) {
    const st = this.pending;
    if (!st || !this.rest || !this.entity) return;
    this.testPose = t;
    restoreJoints(this.rest);
    if (t > 0) {
      const map = humanoidMap(st);
      const frame = characterFrame(map, this.entity.root);
      const dirs: Partial<Record<HumanBone, Vector3>> = {};
      for (const [bone, d] of Object.entries(TEST_POSE) as [HumanBone, [number, number, number]][]) {
        const tip = st.joints.get(BONE_END[bone]) ?? null;
        const node = st.joints.get(bone)!;
        const restDir = tip ? jointPosition(tip).subtract(jointPosition(node)).normalize() : null;
        if (!restDir) continue;
        const from = new Vector3(Vector3.Dot(restDir, frame.right), Vector3.Dot(restDir, frame.up), Vector3.Dot(restDir, frame.forward));
        dirs[bone] = Vector3.Lerp(from, Vector3.FromArray(d).normalize(), t).normalize();
      }
      applyBoneDirections(map, frame, dirs);
    }
    updateShoulderHelpers(st);
    this.editor.invalidate();
  }

  /** Colors the mesh by how much one bone moves it (null: normal materials). */
  setHeatBone(bone: HumanBone | null) {
    const st = this.pending;
    this.heatBone = bone;
    for (const [m, mat] of this.heatMaterials) m.material = mat;
    this.heatMaterials.clear();
    if (st && bone) {
      const index = st.skeleton.bones.findIndex((b) => b.getTransformNode() === st.joints.get(bone));
      const shader = SkeletonViewer.CreateBoneWeightShader({ skeleton: st.skeleton, targetBoneIndex: index }, this.editor.scene);
      for (const m of this.entity!.meshes) {
        this.heatMaterials.set(m, m.material);
        m.material = shader;
      }
    }
    this.editor.invalidate();
  }

  private discardPending() {
    const e = this.entity;
    const st = this.pending;
    this.setTestPose(0);
    this.setHeatBone(null);
    this.pending = null;
    this.rest = null;
    if (e && st) this.unbind(e, st, true);
  }

  /** Skeleton + joint nodes in the model's fitting space; meshes moved into that space. */
  private build(e: Entity, positions: Map<RigJoint, Vector3>, data?: RigData, strategy = this.shoulderStrategy): RigState {
    const shoulderStrategy = data ? data.shoulderStrategy ?? 'current' : strategy;
    const scene = this.editor.scene;
    const fit = fitNodeOf(e);
    const node = new TransformNode('rig', scene);
    node.parent = fit;
    const toRig = worldMatrix(node).clone().invert();
    const rootWorld = worldMatrix(e.root);
    // Positions arrive in root space (placing) or already in rig space (restoring a project)
    const rigPos = new Map<RigJoint, Vector3>();
    for (const [id, p] of positions) rigPos.set(id, data ? p.clone() : Vector3.TransformCoordinates(Vector3.TransformCoordinates(p, rootWorld), toRig));
    const skeleton = new Skeleton(`${e.name} skeleton`, `rig-${e.id}-${performance.now()}`, scene);
    const bones = new Map<RigJoint, Bone>();
    const joints = new Map<RigJoint, TransformNode>();
    for (const j of BONES) {
      const p = rigPos.get(j.id)!;
      const pp = j.parent ? rigPos.get(j.parent)! : Vector3.Zero();
      const local = Matrix.Translation(p.x - pp.x, p.y - pp.y, p.z - pp.z);
      const bone = new Bone(j.name, skeleton, j.parent ? bones.get(j.parent) : null, local, local.clone(), local.clone());
      const t = new TransformNode(j.name, scene);
      t.parent = j.parent ? joints.get(j.parent)! : node;
      t.position.set(p.x - pp.x, p.y - pp.y, p.z - pp.z);
      t.rotationQuaternion = Quaternion.Identity();
      bone.linkTransformNode(t);
      bones.set(j.id, bone);
      joints.set(j.id, t);
    }
    // Tips have no bone but are kept (bone segments for the weights, saving)
    for (const id of TIP_JOINTS) {
      const t = new TransformNode(templateJoint(id).name, scene);
      const parent = templateJoint(id).parent!;
      t.parent = joints.get(parent)!;
      t.position.copyFrom(rigPos.get(id)!.subtract(rigPos.get(parent)!));
      joints.set(id, t);
    }
    const helpers: RigState['helpers'] = [];
    if (shoulderStrategy === 'helper') {
      for (const id of ['leftUpperArm', 'rightUpperArm'] as const) {
        const driver = joints.get(id)!;
        const name = `deform_support.${id.startsWith('left') ? 'L' : 'R'}`;
        const parent = templateJoint(id).parent!;
        const local = Matrix.Translation(driver.position.x, driver.position.y, driver.position.z);
        const bone = new Bone(name, skeleton, bones.get(parent)!, local, local.clone(), local.clone());
        const helper = new TransformNode(name, scene);
        helper.parent = driver.parent;
        helper.position.copyFrom(driver.position);
        helper.rotationQuaternion = Quaternion.Identity();
        bone.linkTransformNode(helper);
        helpers.push({ node: helper, driver });
      }
    }
    const backups: MeshBackup[] = [];
    const geometries: (Geometry | null)[] = [];
    for (const m of e.meshes as Mesh[]) {
      backups.push({
        mesh: m,
        parent: m.parent,
        position: m.position.clone(),
        rotation: m.rotation.clone(),
        rotationQuaternion: m.rotationQuaternion?.clone() ?? null,
        scaling: m.scaling.clone(),
        geometry: m.geometry,
      });
      // The geometry is shared with the loaded file (and copies): give this mesh its own
      m.makeGeometryUnique();
      const toRigSpace = worldMatrix(m).multiply(toRig);
      m.bakeTransformIntoVertices(toRigSpace);
      m.parent = node;
      m.position.setAll(0);
      m.rotation.setAll(0);
      m.rotationQuaternion = null;
      m.scaling.setAll(1);
      geometries.push(m.geometry);
    }
    const out: RigJoint[] = [...joints.keys()];
    const saved: RigData = data ?? { joints: {}, facing: Math.cos(this.yaw) >= 0 ? 1 : -1, yaw: this.yaw, method: this.method, shoulderStrategy };
    if (!data) for (const id of out) saved.joints[id] = rigPos.get(id)!.asArray().map((v) => +v.toFixed(5));
    return { data: saved, node, skeleton, joints, backups, geometries, helpers };
  }

  private skinInput(st: RigState): SkinInput {
    const meshes = st.backups.map((b) => b.mesh);
    let total = 0;
    let tris = 0;
    for (const m of meshes) {
      total += m.getTotalVertices();
      tris += m.getTotalIndices();
    }
    const points = new Float32Array(total * 3);
    const triangles = new Uint32Array(tris);
    let v = 0;
    let t = 0;
    for (const m of meshes) {
      const pos = m.getVerticesData(VertexBuffer.PositionKind)!;
      for (let i = 0; i < m.getTotalVertices() * 3; i++) points[v * 3 + i] = pos[i];
      const idx = m.getIndices()!;
      for (let i = 0; i < idx.length; i++) triangles[t + i] = idx[i] + v;
      v += m.getTotalVertices();
      t += idx.length;
    }
    // Auxiliary bones receive transferred influence after solving; they are not additional heat sources.
    const bones = new Float32Array(BONES.length * 6);
    BONES.forEach((j, i) => {
      const a = rigPosition(st, j.id);
      const b = rigPosition(st, BONE_END[j.id as HumanBone]);
      bones.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
    });
    const limbRoots = new Uint8Array(BONES.length);
    BONES.forEach((j, i) => (limbRoots[i] = /(UpperArm|UpperLeg)$/.test(j.id) ? 1 : 0));
    const limbRootOf = new Int16Array(BONES.length).fill(-1);
    BONES.forEach((_, i) => {
      let ancestor = i;
      while (ancestor >= 0) {
        if (limbRoots[ancestor]) { limbRootOf[i] = ancestor; break; }
        const parent = BONES[ancestor].parent;
        ancestor = BONES.findIndex(j => j.id === parent);
      }
    });
    const limbAxes = new Float32Array(BONES.length * 3);
    const shoulderCenter = rigPosition(st, 'leftUpperArm').add(rigPosition(st, 'rightUpperArm')).scale(0.5);
    BONES.forEach((j, i) => {
      if (!limbRoots[i]) return;
      const start = rigPosition(st, j.id);
      const axis = j.id.endsWith('UpperArm') ? start.subtract(shoulderCenter) : rigPosition(st, BONE_END[j.id as HumanBone]).subtract(start);
      axis.normalize();
      limbAxes.set(axis.asArray(), i * 3);
    });
    const armRoots = new Uint32Array(['leftUpperArm', 'rightUpperArm'].map(id => BONES.findIndex(j => j.id === id)));
    const torsoUp = new Float32Array(rigPosition(st, 'neck').subtract(rigPosition(st, 'hips')).normalize().asArray());
    const torsoBones = new Uint32Array(['spine', 'chest', 'upperChest'].map(id => BONES.findIndex(j => j.id === id)));
    return { points, triangles, bones, limbRoots, limbRootOf, limbAxes, armRoots, torsoUp, torsoBones, shoulderStrategy: st.data.shoulderStrategy ?? 'current' };
  }

  private async computeWeights(st: RigState, comparison = false): Promise<SkinWeights> {
    const input = this.skinInput(st);
    input.comparison = comparison;
    this.progress = 0;
    this.editor.notify('rig');
    const onProgress = (p: number) => {
      this.progress = p;
      this.editor.notify('rig');
    };
    this.job = computeSkinWeights(input, st.data.method, onProgress);
    try {
      return await this.job.promise;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      if (st.data.method !== 'heat') throw err;
      // Heat diffusion failed (e.g. a broken mesh): fall back to envelope weights
      this.fellBack = true;
      st.data.method = 'envelope';
      this.job = computeSkinWeights(input, 'envelope', onProgress);
      return await this.job.promise;
    } finally {
      this.job = null;
      this.progress = null;
    }
  }

  private applyWeights(st: RigState, w: SkinWeights) {
    let v = 0;
    for (const { mesh } of st.backups) {
      const n = mesh.getTotalVertices();
      mesh.setVerticesData(VertexBuffer.MatricesIndicesKind, w.indices.slice(v * INFLUENCES, (v + n) * INFLUENCES), false, INFLUENCES);
      mesh.setVerticesData(VertexBuffer.MatricesWeightsKind, w.weights.slice(v * INFLUENCES, (v + n) * INFLUENCES), false, INFLUENCES);
      mesh.numBoneInfluencers = INFLUENCES;
      mesh.skeleton = st.skeleton;
      v += n;
    }
    this.editor.refreshShadowCasters();
  }

  /** Puts the meshes back as they were (`dispose`: the rig is gone for good). */
  private unbind(e: Entity, st: RigState, dispose: boolean) {
    for (const b of st.backups) {
      const m = b.mesh;
      m.skeleton = null;
      b.geometry?.applyToMesh(m);
      m.parent = b.parent;
      m.position.copyFrom(b.position);
      m.rotation.copyFrom(b.rotation);
      m.rotationQuaternion = b.rotationQuaternion?.clone() ?? null;
      m.scaling.copyFrom(b.scaling);
    }
    if (dispose) {
      st.geometries.forEach((g) => g?.dispose());
      st.skeleton.dispose();
      st.node.dispose();
    } else {
      st.node.setEnabled(false);
    }
    if (e.rig === st) e.rig = undefined;
    forgetHumanoid(e);
    this.editor.pose.stop();
    this.editor.refreshShadowCasters();
    this.editor.notify('entities');
  }

  private rebind(e: Entity, st: RigState) {
    st.node.setEnabled(true);
    st.backups.forEach((b, i) => {
      const m = b.mesh;
      st.geometries[i]?.applyToMesh(m);
      m.parent = st.node;
      m.position.setAll(0);
      m.rotation.setAll(0);
      m.rotationQuaternion = null;
      m.scaling.setAll(1);
      m.numBoneInfluencers = INFLUENCES;
      m.skeleton = st.skeleton;
    });
    e.rig = st;
    forgetHumanoid(e);
    this.editor.refreshShadowCasters();
    this.editor.notify('entities');
  }

  // ---------- Projects and copies ----------

  /** Saved form of a rig: joints and the skin weights (4 bone indices + 4 weights per vertex, bytes). */
  serialize(e: Entity): { data: RigData; weights: Uint8Array } | null {
    const st = e.rig;
    if (!st) return null;
    const meshes = st.backups.map((b) => b.mesh);
    const total = meshes.reduce((n, m) => n + m.getTotalVertices(), 0);
    const out = new Uint8Array(total * INFLUENCES * 2);
    let v = 0;
    for (const m of meshes) {
      const idx = m.getVerticesData(VertexBuffer.MatricesIndicesKind)!;
      const w = m.getVerticesData(VertexBuffer.MatricesWeightsKind)!;
      for (let i = 0; i < m.getTotalVertices() * INFLUENCES; i++) {
        out[(v * INFLUENCES + i) * 2] = idx[i];
        out[(v * INFLUENCES + i) * 2 + 1] = Math.round(w[i] * 255);
      }
      v += m.getTotalVertices();
    }
    return { data: { ...st.data, joints: { ...st.data.joints } }, weights: out };
  }

  /** Rebuilds a saved rig on a freshly loaded model (or on a copy). */
  restore(e: Entity, data: RigData, weights: Uint8Array | null) {
    if (!this.canRig(e)) return;
    const positions = new Map<RigJoint, Vector3>();
    for (const [id, p] of Object.entries(data.joints) as [RigJoint, number[]][]) positions.set(id, Vector3.FromArray(p));
    if (RIG_TEMPLATE.some((j) => !positions.has(j.id))) throw new Error(tr('The saved rig is incomplete.'));
    const st = this.build(e, positions, { ...data, joints: { ...data.joints } });
    const total = st.backups.reduce((n, b) => n + b.mesh.getTotalVertices(), 0);
    let w: SkinWeights;
    if (weights && weights.length === total * INFLUENCES * 2) {
      const indices = new Float32Array(total * INFLUENCES);
      const values = new Float32Array(total * INFLUENCES);
      for (let i = 0; i < total; i++) {
        let sum = 0;
        for (let k = 0; k < INFLUENCES; k++) sum += weights[(i * INFLUENCES + k) * 2 + 1];
        for (let k = 0; k < INFLUENCES; k++) {
          indices[i * INFLUENCES + k] = weights[(i * INFLUENCES + k) * 2];
          values[i * INFLUENCES + k] = sum ? weights[(i * INFLUENCES + k) * 2 + 1] / sum : k === 0 ? 1 : 0;
        }
      }
      w = { indices, weights: values };
    } else {
      const input = this.skinInput(st);
      const { dense, map } = envelopeWeights(input);
      const weldedPoints = weld(input.points).points;
      const treated = shoulderWeights(dense, { ...input, points: weldedPoints }, input.shoulderStrategy!);
      w = strongest(treated, map, treated.length / (weldedPoints.length / 3));
    }
    this.applyWeights(st, w);
    e.rig = st;
    forgetHumanoid(e);
  }

  /** Same rig on a duplicate (same model file, so same vertices). */
  copy(from: Entity, to: Entity) {
    const saved = this.serialize(from);
    if (saved) this.restore(to, { ...saved.data, comparison: undefined }, saved.weights);
  }

  // ---------- Spaces ----------

  private toWorld(p: Vector3) {
    return Vector3.TransformCoordinates(p, worldMatrix(this.entity!.root));
  }

  private toRoot(w: Vector3) {
    return Vector3.TransformCoordinates(w, worldMatrix(this.entity!.root).clone().invert());
  }

  /** Bounding box of the model in its own (root) space. */
  private rootBounds(e: Entity) {
    const inv = worldMatrix(e.root).clone().invert();
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const m of e.meshes) {
      const toRoot = worldMatrix(m).multiply(inv);
      for (const c of m.getBoundingInfo().boundingBox.vectors) {
        const p = Vector3.TransformCoordinates(c, toRoot);
        min.minimizeInPlace(p);
        max.maximizeInPlace(p);
      }
    }
    return { min, max };
  }
}

/** The node under the object's root (or its motion pivot) that holds the model's nodes. */
function fitNodeOf(e: Entity): TransformNode {
  let n: Node = e.meshes[0];
  while (n.parent && n.parent !== e.root && n.parent.name !== 'motion') n = n.parent;
  return n as TransformNode;
}

function rigPosition(st: RigState, id: RigJoint) {
  const p = st.data.joints[id]!;
  return new Vector3(p[0], p[1], p[2]);
}

/** Canonical bones of a rig made in the app. */
function humanoidMap(st: RigState): HumanoidMap {
  const map: HumanoidMap = {};
  for (const [id, node] of st.joints) if (!TIP_JOINTS.includes(id)) map[id as HumanBone] = node;
  return map;
}

const HELPER_REST = Quaternion.Identity();

/** No geometry work: each support joint follows half of the upper arm's local rotation. */
export function updateShoulderHelpers(st: RigState) {
  for (const { node, driver } of st.helpers) {
    Quaternion.SlerpToRef(HELPER_REST, driver.rotationQuaternion ?? HELPER_REST, .5, node.rotationQuaternion!);
    node.position.copyFrom(driver.position);
  }
}

/** Bake support rotations into added clips too, so exported GLB animations need no app callbacks. */
export function addShoulderHelperTracks(entity: Entity, group: AnimationGroup) {
  for (const { node, driver } of entity.rig?.helpers ?? []) {
    const source = group.targetedAnimations.find(t => t.target === driver && t.animation.targetProperty === 'rotationQuaternion')?.animation;
    if (source) {
      const track = new Animation(`${node.name} rotation`, 'rotationQuaternion', source.framePerSecond, Animation.ANIMATIONTYPE_QUATERNION, source.loopMode);
      const frames = new Set(source.getKeys().map(k => k.frame));
      for (let frame = Math.ceil(group.from); frame <= group.to; frame++) frames.add(frame);
      track.setKeys([...frames].sort((a,b) => a-b).map(frame => ({ frame, value: Quaternion.Slerp(HELPER_REST, source.evaluate(frame) as Quaternion, .5) })));
      group.addTargetedAnimation(track, node);
    }
    const position = group.targetedAnimations.find(t => t.target === driver && t.animation.targetProperty === 'position')?.animation;
    if (position) group.addTargetedAnimation(position.clone(), node);
  }
}
