import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup.js';
import type { Editor, Entity } from '../core/editor';
import { jointNodes } from '../rigging/humanoid';
import { captureJoints, restoreJoints } from './pose';
import type { JointState } from './pose';

/**
 * Clip playback of objects: play, pause, scrub to a frame (kept as a still for photos),
 * loop or play once, and a short crossfade when switching clips while playing.
 * Render-on-demand needs nothing special: running animations keep the scene drawing,
 * paused or frozen ones don't.
 */

export interface ClipState {
  index: number;
  playing: boolean;
  loop: boolean;
  speed: number;
  /** Current frame (where a paused clip is frozen). */
  frame: number;
  /** Hand-made pose over the paused clip (kept for undo). */
  pose?: JointState[];
}

/** Crossfade when switching clips while playing (seconds). */
const BLEND_SECONDS = 0.3;

export class Animator {
  private readonly editor: Editor;

  constructor(editor: Editor) {
    this.editor = editor;
  }

  clips(e: Entity) {
    return e.animationGroups;
  }

  current(e: Entity): AnimationGroup | null {
    return e.animationGroups[e.clipIndex ?? 0] ?? e.animationGroups[0] ?? null;
  }

  isPlaying(e: Entity) {
    const g = this.current(e);
    return !!g && g.isPlaying;
  }

  /** Frame shown now (0 for a clip that never started). */
  frame(e: Entity) {
    const g = this.current(e);
    const a = g?.animatables[0];
    return a ? a.masterFrame : (g?.from ?? 0);
  }

  /** Clip state; with `withPose`, also the hand-made pose (for undo). */
  state(e: Entity, withPose = false): ClipState {
    const g = this.current(e);
    return {
      index: e.clipIndex ?? 0,
      playing: this.isPlaying(e),
      loop: g?.loopAnimation ?? true,
      speed: g?.speedRatio ?? 1,
      frame: this.frame(e),
      pose: withPose && e.posed ? captureJoints(jointNodes(e)) : undefined,
    };
  }

  /** Pauses without an undo step (posing takes over the joints). */
  hold(e: Entity) {
    const g = this.current(e);
    if (g?.isPlaying) {
      g.pause();
      this.editor.notify('animation');
    }
  }

  /** Plays a clip (the current one by default). Switching while playing crossfades. */
  play(e: Entity, index = e.clipIndex ?? 0) {
    const before = this.state(e, true);
    const next = e.animationGroups[index];
    if (!next) return;
    const prev = this.current(e);
    const blend = !!prev && prev !== next && prev.isPlaying;
    this.switchTo(e, index);
    e.posed = false;
    if (prev === next && next.isStarted && next.animatables.length) {
      // Resume where it was paused
      next.play(next.loopAnimation);
    } else {
      next.enableBlending = blend;
      if (blend) {
        next.blendingSpeed = 1 / (BLEND_SECONDS * 60);
        setTimeout(() => (next.enableBlending = false), BLEND_SECONDS * 1000 + 100);
      }
      next.start(next.loopAnimation, next.speedRatio, next.from, next.to);
    }
    this.commit(e, before);
  }

  pause(e: Entity) {
    const before = this.state(e, true);
    this.current(e)?.pause();
    this.commit(e, before);
  }

  toggle(e: Entity) {
    if (this.isPlaying(e)) this.pause(e);
    else this.play(e);
  }

  /** Shows a clip without playing it: stopped on its first frame (switches clip if needed). */
  select(e: Entity, index: number) {
    if (this.isPlaying(e)) return this.play(e, index);
    const before = this.state(e, true);
    this.switchTo(e, index);
    e.posed = false;
    this.freezeAt(e, e.animationGroups[index].from);
    this.commit(e, before);
  }

  /**
   * Shows a frame and keeps it (pauses). Called continuously while scrubbing: pass
   * `before` (from `state()` when the drag started) on the last call to make it one undo step.
   */
  seek(e: Entity, frame: number, before?: ClipState) {
    e.posed = false;
    this.freezeAt(e, frame);
    if (before) this.commit(e, before);
  }

  setLoop(e: Entity, loop: boolean) {
    const before = this.state(e, true);
    for (const g of e.animationGroups) g.loopAnimation = loop;
    this.commit(e, before);
  }

  setSpeed(e: Entity, speed: number, before?: ClipState) {
    for (const g of e.animationGroups) g.speedRatio = speed;
    this.editor.invalidate();
    if (before) this.commit(e, before);
  }

  /** Puts a clip state back (undo, opening a project). */
  apply(e: Entity, s: ClipState) {
    const g = e.animationGroups[s.index] ?? e.animationGroups[0];
    if (!g) return;
    this.switchTo(e, e.animationGroups.indexOf(g));
    for (const a of e.animationGroups) {
      a.loopAnimation = s.loop;
      a.speedRatio = s.speed;
    }
    g.enableBlending = false;
    if (s.playing) {
      g.start(s.loop, s.speed, g.from, g.to);
      g.goToFrame(s.frame);
    } else {
      this.freezeAt(e, s.frame);
    }
    if (s.pose) restoreJoints(s.pose);
    e.posed = !!s.pose;
    this.editor.invalidate();
  }

  /** Called when a clip that plays once reaches its end (to update the play button). */
  watch(e: Entity) {
    // Loop and speed are per object: every clip follows the current one (looping by default)
    const loop = this.current(e)?.loopAnimation ?? true;
    for (const g of e.animationGroups) {
      if (g.metadata?.watched) continue;
      (g.metadata ??= {}).watched = true;
      g.loopAnimation = loop;
      g.onAnimationGroupEndObservable.add(() => this.editor.notify('animation'));
      g.onAnimationGroupPauseObservable.add(() => this.editor.invalidate());
    }
  }

  private switchTo(e: Entity, index: number) {
    for (const [i, g] of e.animationGroups.entries()) if (i !== index && g.isStarted) g.stop();
    e.clipIndex = index;
  }

  private freezeAt(e: Entity, frame: number) {
    const g = this.current(e);
    if (!g) return;
    // A crossfade still in progress would show the previous pose: restart without blending
    if (g.enableBlending) {
      g.enableBlending = false;
      g.stop();
    }
    if (!g.isStarted || !g.animatables.length) g.start(g.loopAnimation, g.speedRatio, g.from, g.to);
    g.pause();
    g.goToFrame(Math.min(Math.max(frame, g.from), g.to));
    this.editor.invalidate();
  }

  private commit(e: Entity, before: ClipState) {
    const after = this.state(e);
    this.editor.notify('animation');
    const same =
      !before.pose &&
      before.index === after.index &&
      before.playing === after.playing &&
      before.loop === after.loop &&
      before.speed === after.speed &&
      (after.playing || Math.abs(before.frame - after.frame) < 1e-3);
    if (same) return;
    this.editor.record({ undo: () => this.apply(e, before), redo: () => this.apply(e, after) });
  }
}
