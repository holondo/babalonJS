import { AnimationGroup, AnimatorAvatar, Matrix, Quaternion, Vector3 } from '@babylonjs/core';
import type { AssetContainer, TransformNode } from '@babylonjs/core';
import { BONE_TIP, detectHumanoid, humanoidOf, jointNodes, jointPosition, skeletonsOf, worldMatrix } from './humanoid';
import type { Detection, HumanBone, HumanoidMap } from './humanoid';
import { aimBone, bonesTopDown, captureJoints, characterFrame, restoreJoints, rotateJointWorld } from './pose';
import { tr } from './i18n';
import { libraryClipUrl } from './presets';
import type { AssetRef, Editor, Entity } from './editor';

/**
 * Plays animations made for one humanoid on another (imported clips and the built-in library).
 *
 * Babylon's AnimatorAvatar transfers each bone's motion relative to the two rest poses. That
 * only looks right when both rest poses match (T-pose → T-pose), so before retargeting the
 * source skeleton is bent into the target's rest pose (bone by bone, same directions). Clips
 * then play correctly on A-pose and T-pose characters alike.
 */

export interface ClipSource {
  container: AssetContainer;
  detection: Detection;
  groups: AnimationGroup[];
}

/** Reads the humanoid and clips of a loaded animation file. */
export function clipSource(container: AssetContainer): ClipSource {
  const detection = detectHumanoid(container.transformNodes);
  if (!container.animationGroups.length) throw new Error(tr('This file has no animations.'));
  if (!detection.complete) throw new Error(tr('The animations in this file are not for a humanoid skeleton.'));
  return { container, detection, groups: container.animationGroups };
}

export interface RetargetOptions {
  /** Keep the character in place (drop horizontal root motion). */
  inPlace: boolean;
  name?: string;
}

/** Makes a copy of `group` that animates the entity's skeleton. */
export function retargetClip(source: ClipSource, group: AnimationGroup, entity: Entity, target: HumanoidMap, opts: RetargetOptions): AnimationGroup {
  const src = source.detection.map;
  const srcHips = src.hips!;
  const tgtHips = target.hips!;

  // Source joint name → target joint name, for every canonical bone both have
  const mapNodeNames = new Map<string, string>();
  for (const bone of bonesTopDown(src)) if (target[bone]) mapNodeNames.set(src[bone]!.name, target[bone]!.name);

  // Only rotations transfer between different bodies; position only for the hips (proportions differ)
  const filtered = new AnimationGroup(`${group.name} (filtered)`, group.getScene());
  for (const ta of group.targetedAnimations) {
    const prop = ta.animation.targetProperty;
    if (prop === 'rotationQuaternion' || (prop === 'position' && ta.target === srcHips)) filtered.addTargetedAnimation(ta.animation, ta.target);
  }
  filtered.normalize(group.from, group.to);

  const sourceJoints = source.container.transformNodes;
  const savedSource = captureJoints(sourceJoints);
  const targetJoints = Object.values(target) as TransformNode[];
  const savedTarget = captureJoints(targetJoints);
  const root = entity.root;
  const savedRoot = { p: root.position.clone(), q: root.rotationQuaternion!.clone(), s: root.scaling.clone() };
  try {
    // Work in the character's own space: a turned or moved character must get the same motion
    root.position.setAll(0);
    root.rotationQuaternion!.copyFrom(Quaternion.Identity());
    root.scaling.setAll(1);
    for (const s of skeletonsOf(entity)) s.returnToRest();
    const targetRest = restDirections(target);
    // Face the source the way the target faces (bone directions alone don't fix the facing)
    faceLike(src, source.container.rootNodes[0] as TransformNode, target, root);
    // Bend the source into the target's rest pose
    for (const bone of bonesTopDown(src)) {
      const d = targetRest[bone];
      if (d) aimBone(src, bone, d);
    }
    for (const n of sourceJoints) worldMatrix(n);

    const avatar = new AnimatorAvatar(`${entity.name} avatar`, root, false, false);
    avatar.showWarnings = false;
    const leftFoot = src.leftFoot!;
    const out = avatar.retargetAnimationGroup(filtered, {
      animationGroupName: opts.name ?? group.name,
      mapNodeNames,
      fixAnimations: true,
      fixRootPosition: true,
      rootNodeName: srcHips.name,
      groundReferenceNodeName: leftFoot.name,
      fixGroundReference: true,
      fixGroundReferenceDynamicRefNode: true,
    });
    if (opts.inPlace) keepInPlace(out, tgtHips);
    return out;
  } finally {
    filtered.dispose();
    restoreJoints(savedSource);
    restoreJoints(savedTarget);
    root.position.copyFrom(savedRoot.p);
    root.rotationQuaternion!.copyFrom(savedRoot.q);
    root.scaling.copyFrom(savedRoot.s);
    root.computeWorldMatrix(true);
  }
}

/** Direction of each bone at rest, in the (reset) character space. */
function restDirections(map: HumanoidMap) {
  const out: Partial<Record<HumanBone, Vector3>> = {};
  for (const bone of bonesTopDown(map)) {
    const node = map[bone]!;
    const tip = BONE_TIP[bone]?.map((b) => map[b]).find(Boolean);
    if (tip) out[bone] = jointPosition(tip).subtract(jointPosition(node)).normalize();
  }
  return out;
}

/** Removes the horizontal travel of the hips (keeps the up and down motion of a walk). */
function keepInPlace(group: AnimationGroup, hips: TransformNode) {
  const ta = group.targetedAnimations.find((t) => t.target === hips && t.animation.targetProperty === 'position');
  if (!ta) return;
  const keys = ta.animation.getKeys();
  if (!keys.length) return;
  // Horizontal in the character space: convert through the hips' parent
  const parent = hips.parent ? worldMatrix(hips.parent as TransformNode).clone() : Matrix.Identity();
  const toLocal = parent.clone().invert();
  const first = Vector3.TransformCoordinates(keys[0].value as Vector3, parent);
  for (const k of keys) {
    const w = Vector3.TransformCoordinates(k.value as Vector3, parent);
    w.x = first.x;
    w.z = first.z;
    k.value = Vector3.TransformCoordinates(w, toLocal);
  }
}

// ---------- Clips added to objects ----------

/** Where an added clip comes from: the built-in library or an animation file the user imported. */
export type ClipRef = { library: string } | { asset: AssetRef };

export interface AddedClip {
  from: ClipRef;
  /** Clip name in the source file. */
  clip: string;
  inPlace: boolean;
  group: AnimationGroup;
}

const refKey = (ref: ClipRef) => ('library' in ref ? `lib:${ref.library}` : `asset:${ref.asset.id}`);

/**
 * Adds clips from other files to humanoids (and removes them), with undo. Loaded clip files
 * are kept in memory, so duplicating an animated character or adding the same clip again is
 * instant.
 */
export class ClipManager {
  private readonly editor: Editor;
  private readonly sources = new Map<string, Promise<ClipSource>>();
  private readonly loaded = new Map<string, ClipSource>();

  constructor(editor: Editor) {
    this.editor = editor;
  }

  /** Loads (once) the clips of a library entry or an imported file. */
  source(ref: ClipRef): Promise<ClipSource> {
    const key = refKey(ref);
    let p = this.sources.get(key);
    if (!p) {
      const asset: AssetRef = 'library' in ref ? { id: -1, name: ref.library, url: libraryClipUrl(ref.library) } : ref.asset;
      p = this.editor.loadAsset(asset).then((container) => {
        try {
          const s = clipSource(container);
          this.loaded.set(key, s);
          return s;
        } catch (err) {
          container.dispose();
          throw err;
        }
      });
      p.catch(() => this.sources.delete(key));
      this.sources.set(key, p);
    }
    return p;
  }

  /** The humanoid map of a character that can receive clips (throws a clear message otherwise). */
  targetMap(e: Entity): HumanoidMap {
    const d = humanoidOf(e);
    if (!d) throw new Error(tr('This object has no skeleton. Give it one in Objects → Rig first.'));
    if (!d.complete) throw new Error(tr('Some bones of this skeleton were not recognized. Map them in Objects → Pose.'));
    return d.map;
  }

  /**
   * Retargets clips of a file onto a character and adds them to its clips (all of them by
   * default). The first new clip starts playing. One undo step.
   */
  async add(e: Entity, ref: ClipRef, opts: { clips?: string[]; inPlace?: boolean; record?: boolean } = {}) {
    const map = this.targetMap(e);
    const source = await this.source(ref);
    const added = this.retarget(e, map, source, ref, opts.clips ?? source.groups.map((g) => g.name), opts.inPlace ?? true);
    if (!added.length) return [];
    if (opts.record === false) {
      this.attach(e, added);
      return added;
    }
    const before = this.editor.anim.state(e, true);
    this.attach(e, added);
    this.editor.anim.play(e, e.animationGroups.indexOf(added[0].group));
    const after = this.editor.anim.state(e);
    this.editor.record({
      undo: () => {
        this.detach(e, added);
        this.editor.anim.apply(e, before);
      },
      redo: () => {
        this.attach(e, added);
        this.editor.anim.apply(e, after);
      },
    });
    return added;
  }

  /** Same clips on another character (duplicating): instant, the files are already loaded. */
  copy(from: Entity, to: Entity) {
    const map = humanoidOf(to)?.map;
    if (!map || !from.addedClips?.length) return;
    for (const c of from.addedClips) {
      const source = this.loaded.get(refKey(c.from));
      if (source) this.attach(to, this.retarget(to, map, source, c.from, [c.clip], c.inPlace));
    }
  }

  /** Removes an added clip (one undo step). */
  remove(e: Entity, group: AnimationGroup) {
    const clip = e.addedClips?.find((c) => c.group === group);
    if (!clip) return;
    const before = this.editor.anim.state(e, true);
    this.detach(e, [clip]);
    const after = this.editor.anim.state(e);
    this.editor.record({
      undo: () => {
        this.attach(e, [clip]);
        this.editor.anim.apply(e, before);
      },
      redo: () => {
        this.detach(e, [clip]);
        this.editor.anim.apply(e, after);
      },
    });
  }

  /** Poses a character like a frame of a library clip (one undo step, kept as a hand-made pose). */
  async poseFromClip(e: Entity, clipId: string, seconds: number) {
    const map = this.targetMap(e);
    const source = await this.source({ library: clipId });
    const pose = this.editor.pose;
    pose.start(e);
    pose.begin();
    const g = retargetClip(source, source.groups[0], e, map, { inPlace: true });
    const fps = g.targetedAnimations[0]?.animation.framePerSecond || 60;
    g.start(false, 1, g.from, g.to);
    g.pause();
    g.goToFrame(Math.min(g.to, g.from + seconds * fps));
    const frame = captureJoints(jointNodes(e));
    g.stop();
    g.dispose();
    restoreJoints(frame);
    pose.end();
    this.editor.invalidate();
  }

  private retarget(e: Entity, map: HumanoidMap, source: ClipSource, ref: ClipRef, names: string[], inPlace: boolean): AddedClip[] {
    const out: AddedClip[] = [];
    for (const name of names) {
      const group = source.groups.find((g) => g.name === name);
      if (!group) continue;
      const label = 'library' in ref ? ref.library : name;
      out.push({ from: ref, clip: name, inPlace, group: retargetClip(source, group, e, map, { inPlace, name: label }) });
    }
    return out;
  }

  private attach(e: Entity, clips: AddedClip[]) {
    e.addedClips ??= [];
    for (const c of clips) {
      if (!e.animationGroups.includes(c.group)) e.animationGroups.push(c.group);
      if (!e.addedClips.includes(c)) e.addedClips.push(c);
    }
    this.editor.anim.watch(e);
    this.editor.notify('animation');
  }

  private detach(e: Entity, clips: AddedClip[]) {
    const current = this.editor.anim.current(e);
    for (const c of clips) {
      c.group.stop();
      e.animationGroups = e.animationGroups.filter((g) => g !== c.group);
      e.addedClips = e.addedClips?.filter((x) => x !== c);
    }
    e.clipIndex = Math.max(0, current ? e.animationGroups.indexOf(current) : 0);
    this.editor.notify('animation');
  }
}

/** Turns the source skeleton (at its hips) so its character frame matches the target's. */
function faceLike(src: HumanoidMap, srcRoot: TransformNode, target: HumanoidMap, targetRoot: TransformNode) {
  const a = characterFrame(src, srcRoot);
  const b = characterFrame(target, targetRoot);
  const qa = Quaternion.RotationQuaternionFromAxis(a.right, a.up, a.forward);
  const qb = Quaternion.RotationQuaternionFromAxis(b.right, b.up, b.forward);
  // Of the two composition orders, keep the one that really maps the source frame onto the target
  const options = [qb.multiply(Quaternion.Inverse(qa)), Quaternion.Inverse(qa).multiply(qb)];
  const err = (q: Quaternion) => Vector3.Distance(a.forward.applyRotationQuaternion(q), b.forward) + Vector3.Distance(a.right.applyRotationQuaternion(q), b.right);
  const q = err(options[0]) <= err(options[1]) ? options[0] : options[1];
  if (Math.abs(q.w) < 0.9999) rotateJointWorld(src.hips!, q);
}

