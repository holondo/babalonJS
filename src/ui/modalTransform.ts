import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { tr } from '../core/i18n';
import { h } from './dom';
import type { UI } from './ui';

type Kind = 'move' | 'rotate' | 'scale';
type Axis = 'x' | 'y' | 'z';
const AXES: Record<Axis, Vector3> = { x: Vector3.Right(), y: Vector3.Up(), z: Vector3.Forward() };

/**
 * Blender's modal transform from the keyboard: G moves, R rotates, S scales with the mouse, no
 * gizmo needed. X / Y / Z keep one axis (Shift+X / Y / Z every axis but that one), digits type an
 * exact value, Enter or a click confirms, Esc or the right button cancels. Works on the selected
 * objects, or on the selected faces in mesh mode, through the editor's live transform.
 */
export class ModalTransform {
  private kind: Kind | null = null;
  private axis: Axis | null = null;
  private exclude = false;
  private typed = '';
  private center = Vector3.Zero();
  private start = { x: 0, y: 0 };
  private pointer = { x: 0, y: 0 };
  private onCanvas = false;
  private readonly hint = h('div', { class: 'modal-hint' });
  private readonly ui: UI;

  constructor(ui: UI) {
    this.ui = ui;
    document.body.append(this.hint);
    const canvas = ui.editor.engine.getRenderingCanvas()!;
    // Where the mouse is (keys start from it)
    window.addEventListener('pointermove', (ev) => {
      if (ev.pointerType !== 'mouse') return;
      const r = canvas.getBoundingClientRect();
      this.pointer = { x: ev.clientX - r.left, y: ev.clientY - r.top };
      this.onCanvas = ev.target === canvas;
      if (this.kind) this.update();
    }, true);
    // A click confirms, the right button cancels; neither reaches the scene
    window.addEventListener('pointerdown', (ev) => {
      if (!this.kind) return;
      ev.preventDefault(); ev.stopImmediatePropagation();
      this.finish(ev.button === 2);
    }, true);
    window.addEventListener('contextmenu', (ev) => { if (this.kind) ev.preventDefault(); }, true);
    window.addEventListener('keydown', (ev) => this.key(ev), true);
  }

  get active() { return !!this.kind; }

  /** Starts from the keyboard; false when there's nothing to transform or the mouse isn't over the view. */
  begin(kind: Kind) {
    const ed = this.ui.editor, s = ed.separator;
    if (!this.onCanvas || this.kind) return false;
    if (s.active && !s.transform) {
      if (!s.selection?.count || s.mode === 'surface') return false;
      s.setMode('transform');
      this.ui.renderSelbar();
    }
    const center = ed.beginLive();
    if (!center) return false;
    this.kind = kind; this.axis = null; this.exclude = false; this.typed = '';
    this.center = center; this.start = { ...this.pointer };
    this.update();
    return true;
  }

  private key(ev: KeyboardEvent) {
    if (!this.kind) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    const k = ev.key.toLowerCase();
    if (k === 'escape') return this.finish(true);
    if (k === 'enter') return this.finish(false);
    if (k === 'x' || k === 'y' || k === 'z') {
      // Pressing the same axis again frees it, like Blender
      if (this.axis === k && this.exclude === ev.shiftKey) this.axis = null;
      else { this.axis = k; this.exclude = ev.shiftKey; }
    } else if (/^[0-9.]$/.test(k)) this.typed += k;
    else if (k === '-') this.typed = this.typed.startsWith('-') ? this.typed.slice(1) : `-${this.typed}`;
    else if (k === 'backspace') this.typed = this.typed.slice(0, -1);
    else return;
    this.update();
  }

  private finish(cancel: boolean) {
    this.kind = null;
    this.hint.classList.remove('show');
    this.ui.editor.endLive(cancel);
    this.ui.renderSelbar();
  }

  private update() {
    const ed = this.ui.editor, kind = this.kind!;
    const value = this.typed && this.typed !== '-' && this.typed !== '.' ? parseFloat(this.typed) : null;
    const axis = this.axis ? AXES[this.axis] : null;
    let text = '';
    if (kind === 'move') {
      let move: Vector3;
      if (value !== null) {
        move = (axis ?? Vector3.Right()).scale(value);
        text = `${value}`;
      } else {
        // The mouse moves the selection across a plane facing the camera
        move = this.onPlane(this.pointer).subtract(this.onPlane(this.start));
        if (axis) move = this.exclude ? move.subtract(axis.scale(Vector3.Dot(move, axis))) : axis.scale(Vector3.Dot(move, axis));
        text = [move.x, move.y, move.z].map((v) => v.toFixed(3)).join('  ');
      }
      ed.setLive({ move });
    } else if (kind === 'scale') {
      const c = this.screen(this.center);
      const factor = value ?? Math.hypot(this.pointer.x - c.x, this.pointer.y - c.y) / Math.max(1, Math.hypot(this.start.x - c.x, this.start.y - c.y));
      const scale = !axis ? new Vector3(factor, factor, factor)
        : this.exclude ? new Vector3(factor, factor, factor).subtract(axis.scale(factor - 1))
        : Vector3.One().add(axis.scale(factor - 1));
      ed.setLive({ scale });
      text = factor.toFixed(3);
    } else {
      const c = this.screen(this.center);
      // Screen y points down: turning counterclockwise on screen is a positive angle toward the viewer
      const turn = Math.atan2(-(this.pointer.y - c.y), this.pointer.x - c.x) - Math.atan2(-(this.start.y - c.y), this.start.x - c.x);
      const angle = value !== null ? (value * Math.PI) / 180 : turn;
      const view = ed.camera.getForwardRay().direction.scale(-1);
      ed.setLive({ axis: axis ?? view, angle: axis && Vector3.Dot(axis, view) < 0 && value === null ? -angle : angle });
      text = `${Math.round((angle * 180) / Math.PI)}°`;
    }
    const labels = { move: tr('Move'), rotate: tr('Rotate'), scale: tr('Scale') };
    const constraint = this.axis ? ` · ${this.exclude ? tr('not {axis}', { axis: this.axis.toUpperCase() }) : this.axis.toUpperCase()}` : '';
    this.hint.textContent = `${labels[kind]} ${text}${constraint} — ${tr('X/Y/Z axis, type a value, Enter or click to confirm, Esc to cancel')}`;
    this.hint.classList.add('show');
  }

  /** Point of the camera-facing plane through the center, under a screen point (CSS pixels). */
  private onPlane(p: { x: number; y: number }) {
    const ed = this.ui.editor, ray = ed.scene.createPickingRay(p.x, p.y, Matrix.Identity(), ed.camera);
    const normal = ed.camera.getForwardRay().direction;
    const denom = Vector3.Dot(ray.direction, normal);
    if (Math.abs(denom) < 1e-6) return this.center.clone();
    const t = Vector3.Dot(this.center.subtract(ray.origin), normal) / denom;
    return ray.origin.add(ray.direction.scale(t));
  }

  /** A world point on screen (CSS pixels). */
  private screen(p: Vector3) {
    const ed = this.ui.editor, engine = ed.engine, scale = engine.getHardwareScalingLevel();
    const q = Vector3.Project(p, Matrix.Identity(), ed.scene.getTransformMatrix(), ed.camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()));
    return { x: q.x * scale, y: q.y * scale };
  }
}
