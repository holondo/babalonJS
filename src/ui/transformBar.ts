import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { tr } from '../core/i18n';
import { SlidersHorizontal } from 'lucide';
import { chips, h, iconButton, slider } from './dom';
import type { UI } from './ui';

type Axis = 'all' | 'x' | 'y' | 'z';
const AXES: Record<Exclude<Axis, 'all'>, Vector3> = { x: Vector3.Right(), y: Vector3.Up(), z: Vector3.Forward() };

/**
 * Optional row in the context bubble while Scale or Rotate is the tool: a slider that scales
 * (keeping proportions, or along one axis) or turns the selected objects or faces. Each drag is
 * relative to where it starts and is one undo step; the slider goes back to the middle after.
 */
export class TransformBar {
  readonly el = h('div', { class: 'xbar' });
  open = false;
  private scaleAxis: Axis = 'all';
  private turnAxis: Exclude<Axis, 'all'> = 'y';
  private readonly ui: UI;
  constructor(ui: UI) { this.ui = ui; }

  /** The selection bar's switch for this bar (only with Scale or Rotate). */
  button() {
    const tool = this.ui.editor.tool;
    if ((tool !== 'scale' && tool !== 'rotate') || !this.available()) return null;
    return iconButton(SlidersHorizontal, tr('Slider'), () => this.toggle(), { active: this.open, label: tr('Slider'), cls: 'tool slider-btn' });
  }

  toggle() { this.open = !this.open; this.render(); this.ui.renderSelbar(); }

  /** Something to transform: faces in mesh mode, otherwise objects. */
  available() {
    const ed = this.ui.editor;
    if (ed.photoMode || ed.rigger.active || ed.pose.active) return false;
    if (ed.separator.active) return !!ed.separator.transform;
    return !!ed.selected;
  }

  render() {
    const ed = this.ui.editor, tool = ed.tool;
    const context = this.ui.focusedContext;
    const show = this.open && (context === 'selection' || context === 'mesh') && (tool === 'scale' || tool === 'rotate') && this.available();
    this.el.classList.toggle('show', show);
    if (!show) { this.el.replaceChildren(); return; }
    const commit = () => { ed.endLive(); this.render(); };
    if (tool === 'scale') {
      // Logarithmic: the middle is 100%, the ends ×0.1 and ×10 (repeat for more)
      this.el.replaceChildren(
        chips([{ value: 'all', label: tr('All') }, { value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Z' }], this.scaleAxis, (v) => { this.scaleAxis = v; this.render(); }),
        slider(tr('Size'), 0, { min: -1, max: 1, step: 0.005, format: (v) => `${Math.round(10 ** v * 100)}%`, onCommit: commit }, (v) => {
          if (!ed.beginLive()) return;
          const f = 10 ** v, scale = this.scaleAxis === 'all' ? new Vector3(f, f, f) : Vector3.One().add(AXES[this.scaleAxis].scale(f - 1));
          ed.setLive({ scale });
        }),
      );
      return;
    }
    this.el.replaceChildren(
      chips([{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Z' }], this.turnAxis, (v) => { this.turnAxis = v; this.render(); }),
      slider(tr('Angle'), 0, { min: -180, max: 180, step: 1, format: (v) => `${Math.round(v)}°`, onCommit: commit }, (v) => {
        if (ed.beginLive()) ed.setLive({ axis: AXES[this.turnAxis], angle: (v * Math.PI) / 180 });
      }),
    );
  }
}
