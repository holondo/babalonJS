import { Animation, TransformNode } from '@babylonjs/core';
import type { Animatable } from '@babylonjs/core';
import type { Editor, Entity } from '../core/editor';

/**
 * Simple motion for any object, no keyframes: spin, float, pulse or sway. It runs on a child
 * pivot of the object, so the object itself can still be moved, turned and scaled (and undo
 * stays clean). Built from Babylon animations: render-on-demand keeps drawing while it runs
 * and stops when it's paused.
 */

export type MotionType = 'none' | 'spin' | 'float' | 'pulse' | 'sway';

export interface MotionSettings {
  type: MotionType;
  /** Cycles per second (spin: turns per second). */
  speed: number;
  /** How much: float = height (fraction of the object's size), pulse = scale change, sway = angle (degrees). */
  amount: number;
  playing: boolean;
}

export const DEFAULT_MOTION: Record<Exclude<MotionType, 'none'>, Omit<MotionSettings, 'type' | 'playing'>> = {
  spin: { speed: 0.25, amount: 1 },
  float: { speed: 0.5, amount: 0.15 },
  pulse: { speed: 0.8, amount: 0.08 },
  sway: { speed: 0.5, amount: 12 },
};

const FPS = 60;
const SAMPLES = 32;

interface Running {
  pivot: TransformNode;
  animatable: Animatable | null;
}

export class Motion {
  private readonly editor: Editor;
  private readonly running = new WeakMap<Entity, Running>();

  constructor(editor: Editor) {
    this.editor = editor;
  }

  get(e: Entity): MotionSettings {
    return e.motion ?? { type: 'none', speed: 1, amount: 1, playing: true };
  }

  /** Changes the motion (one undo step when `record`). */
  set(e: Entity, settings: MotionSettings, record = true) {
    const before = e.motion ? { ...e.motion } : undefined;
    this.apply(e, settings.type === 'none' ? undefined : { ...settings });
    if (record) this.commit(e, before);
  }

  /** One undo step from `before` to the current motion (after a slider drag, for example). */
  commit(e: Entity, before: MotionSettings | undefined) {
    const after = e.motion ? { ...e.motion } : undefined;
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    this.editor.record({ undo: () => this.apply(e, before), redo: () => this.apply(e, after) });
  }

  /** Picks a motion type with its default speed and amount. */
  choose(e: Entity, type: MotionType) {
    if (type === 'none') return this.set(e, { ...this.get(e), type });
    this.set(e, { type, ...DEFAULT_MOTION[type], playing: true });
  }

  /** Stops drawing an object's motion while it's out of the scene (deleted, waiting for undo). */
  suspend(e: Entity) {
    this.running.get(e)?.animatable?.pause();
  }

  /** Ends the motion for good (the object is being disposed). */
  stop(e: Entity) {
    this.running.get(e)?.animatable?.stop();
    this.running.delete(e);
  }

  resume(e: Entity) {
    if (e.motion?.playing) this.running.get(e)?.animatable?.restart();
  }

  private apply(e: Entity, m: MotionSettings | undefined) {
    e.motion = m;
    const run = this.pivotOf(e);
    run.animatable?.stop();
    run.animatable = null;
    const p = run.pivot;
    p.position.setAll(0);
    p.rotation.setAll(0);
    p.scaling.setAll(1);
    if (m) {
      const anim = this.build(e, m);
      const frames = Math.round(FPS / Math.max(0.01, m.speed));
      run.animatable = this.editor.scene.beginDirectAnimation(p, [anim], 0, frames, true);
      if (!m.playing) run.animatable.pause();
    }
    this.editor.invalidate();
    this.editor.notify('animation');
  }

  /** The child node that moves (created the first time; holds everything the object had). */
  private pivotOf(e: Entity): Running {
    let run = this.running.get(e);
    if (!run) {
      const pivot = new TransformNode('motion', this.editor.scene);
      pivot.parent = e.root;
      for (const child of e.root.getChildren()) if (child !== pivot) (child as TransformNode).parent = pivot;
      run = { pivot, animatable: null };
      this.running.set(e, run);
    }
    return run;
  }

  /** One cycle of the motion as keys (smooth: sampled sine). */
  private build(e: Entity, m: MotionSettings) {
    const frames = Math.round(FPS / Math.max(0.01, m.speed));
    const wave = (fn: (s: number) => number) =>
      Array.from({ length: SAMPLES + 1 }, (_, i) => ({ frame: (i / SAMPLES) * frames, value: fn(Math.sin((i / SAMPLES) * Math.PI * 2)) }));
    const size = this.editor.boundsOf(e).size;
    const height = Math.max(size.y, 0.01) / Math.max(e.root.scaling.y, 1e-6);
    switch (m.type) {
      case 'spin': {
        const a = new Animation('spin', 'rotation.y', FPS, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
        a.setKeys([
          { frame: 0, value: 0 },
          { frame: frames, value: Math.PI * 2 },
        ]);
        return a;
      }
      case 'float': {
        const a = new Animation('float', 'position.y', FPS, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
        // Bobs above its place (never sinks into the floor)
        a.setKeys(wave((s) => ((s + 1) / 2) * m.amount * height));
        return a;
      }
      case 'pulse': {
        const a = new Animation('pulse', 'scaling', FPS, Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CYCLE);
        a.setKeys(wave((s) => 1 + s * m.amount).map((k) => ({ frame: k.frame, value: e.root.scaling.clone().setAll(k.value) })));
        return a;
      }
      default: {
        const a = new Animation('sway', 'rotation.z', FPS, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
        a.setKeys(wave((s) => (s * m.amount * Math.PI) / 180));
        return a;
      }
    }
  }
}
