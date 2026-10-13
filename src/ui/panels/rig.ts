import { Copy, Bone, Check, RotateCcw, RotateCw, Wand, RefreshCw, ArrowRight, ArrowLeft, Scan, X } from 'lucide';
import { boneLabel } from '../../rigging/humanoid';
import type { HumanBone } from '../../rigging/humanoid';
import { RIG_TEMPLATE } from '../../rigging/humanoidTemplate';
import type { RigJoint } from '../../rigging/humanoidTemplate';
import type { WeightMethod } from '../../rigging/rigging';
import { SKIN_TREATMENTS } from '../../rigging/skinTreatments';
import type { SkinTreatment } from '../../rigging/skinTreatments';
import { tr } from '../../core/i18n';
import { button, progressBar, stepper, h, hint, iconButton, row, section, select, slider, toggle } from '../dom';
import type { UI } from '../ui';

/** Objects → Rig: the three rigging steps, their actions (panel footer or floating bar) and the joint handles. */
export class RigPanel {
  private readonly ui: UI;

  constructor(ui: UI) {
    this.ui = ui;
  }

  /** Rigging, before binding: placing the joints or choosing how the skin follows them. */
  rigStage: 'joints' | 'skin' = 'joints';

  /** Bind one rig, or make one copy per treatment to compare them. */
  rigOutput: 'single' | 'comparison' = 'single';

  /** Selection bar while rigging: the step, its main action and cancel. */
  /** Rigging step: 1 joints, 2 skin, 3 check. */
  get rigStep() {
    const r = this.ui.editor.rigger;
    return r.step === 'check' ? 3 : this.rigStage === 'skin' ? 2 : 1;
  }

  /** Actions of the current rigging step (shared by the panel footer and the rigging bubble). */
  rigActions(): HTMLElement[] {
    const r = this.ui.editor.rigger;
    if (r.progress !== null || r.comparing) return [button(tr('Stop'), () => r.stopComputing(), { icon: X, cls: 'small' })];
    const comparison = this.rigOutput === 'comparison' && !!r.entity?.source;
    const back = (run: () => void) => button(tr('Back'), run, { icon: ArrowLeft, cls: 'small ghost' });
    switch (this.rigStep) {
      case 1:
        return [button(tr('Next'), () => this.setRigStage('skin'), { icon: ArrowRight, cls: 'small primary' })];
      case 2:
        return [back(() => this.setRigStage('joints')), button(tr(comparison ? 'Compare' : 'Apply rig'), () => this.applyRig(), { icon: comparison ? Copy : Check, cls: 'small primary' })];
      default:
        return [back(() => (r.adjust(), this.setRigStage('joints'))), button(tr('Done'), () => this.confirmRig(), { icon: Check, cls: 'small primary' })];
    }
  }

  /** The rigging bubble: the step, its actions, and Cancel. */
  renderRigBar() {
    const r = this.ui.editor.rigger;
    const titles = ['', tr('Joints'), tr('Skin'), tr('Check')];
    const computing = r.progress !== null || r.comparing;
    this.ui.selbar.replaceChildren(
      h(
        'div',
        { class: 'sel-name always' },
        h('b', { class: 'step-count' }, `${this.rigStep}/3`),
        h('span', {}, computing ? tr('Computing weights… {pct}%', { pct: Math.round((r.progress ?? 0) * 100) }) : titles[this.rigStep]),
      ),
      h('div', { class: 'sel-tools' }, ...this.rigActions(), iconButton(X, tr('Cancel rigging'), () => r.cancel())),
    );
  }

  /** Steps at the top of the Rig panel; finished steps can be revisited. */
  rigStepper() {
    const r = this.ui.editor.rigger;
    const busy = r.progress !== null || r.comparing;
    const go = (to: number) => {
      if (busy || to === this.rigStep) return;
      if (this.rigStep === 3) r.adjust();
      if (to === 1) this.setRigStage('joints');
      else if (to === 2) this.setRigStage('skin');
    };
    return stepper([tr('Joints'), tr('Skin'), tr('Check')], this.rigStep - 1, (i) => go(i + 1), busy ? -1 : Math.max(1, this.rigStep - 1));
  }

  /** Bottom of the Rig panel: cancel on the left, the step's actions on the right. */
  rigFooter() {
    const r = this.ui.editor.rigger;
    return h('div', { class: 'panel-foot' }, button(tr('Cancel'), () => r.cancel(), { cls: 'small ghost' }), h('span', { class: 'grow' }), ...this.rigActions());
  }

  setRigStage(stage: 'joints' | 'skin') {
    this.rigStage = stage;
    this.ui.renderSelbar();
    this.ui.poseUI.renderPoseOverlay();
    if (this.ui.tab === 'objects') this.ui.renderPanel();
  }

  /** Template joints to drag onto the model; the joints that follow them are shown smaller. */
  renderRigOverlay() {
    const r = this.ui.editor.rigger;
    this.ui.jointOverlay.set(
      RIG_TEMPLATE.map((j) => ({
        id: j.id,
        position: () => r.jointWorld(j.id),
        parent: j.parent ?? undefined,
        label: tr(boneLabel(j.id as HumanBone)),
        cls: `${j.handle ? '' : 'auto'} ${j.id.startsWith('left') ? 'side' : ''} ${r.selected === j.id ? 'active' : ''}`,
      })),
      {
        onPick: (id) => r.selectJoint(id as RigJoint),
        onDragStart: () => r.remember(),
        onDrag: (id, x, y) => r.dragJoint(id as RigJoint, x, y),
        onDragEnd: (id) => r.endDrag(id as RigJoint),
      },
    );
  }

  async applyRig() {
    const r = this.ui.editor.rigger;
    const e = r.entity;
    if (!e) return;
    if (this.rigOutput === 'comparison' && e.source) {
      await this.ui.run(() => r.createComparison());
      if (!r.active) this.ui.toast(tr('Three copies were created side by side, one per treatment. Ready poses move all of them.'));
    } else {
      await this.ui.run(() => r.bind());
    }
  }

  confirmRig() {
    this.ui.editor.rigger.confirm();
    this.ui.toast(tr('Rig applied. Pose it in Pose, or add an animation in Animate.'));
  }

  rigPanel(): (Node | null)[] {
    const ed = this.ui.editor;
    const e = ed.selected;
    const r = ed.rigger;
    if (!e) return [];
    if (!r.active || r.entity !== e) {
      return [
        section(
          tr('Give it a skeleton'),
          hint(tr('For a standing character without a skeleton, ideally facing forward with open arms (T or A pose). Afterwards it can be posed and animated.')),
          row(button(tr('Start rigging'), () => ((this.rigOutput = 'single'), (this.rigStage = 'joints'), r.start(e)), { icon: Bone, cls: 'primary' })),
        ),
      ];
    }
    const busy = r.progress !== null || r.comparing;
    if (r.step === 'check') {
      const bones = RIG_TEMPLATE.filter((j) => j.id !== 'headTop' && !j.id.endsWith('Tip'));
      return [
        section(
          tr('Test'),
          hint(tr('Bend the test pose and watch shoulders, elbows, hips and knees.')),
          slider(tr('Test pose'), r.testPose, { min: 0, max: 1, step: 0.01, format: (v) => `${Math.round(v * 100)}%` }, (v) => this.ui.quiet(() => r.setTestPose(v))),
          select(
            tr('Show weights of'),
            [{ value: '', label: tr('None') }, ...bones.map((j) => ({ value: j.id, label: tr(boneLabel(j.id as HumanBone)) }))],
            r.heatBone ?? '',
            (v) => r.setHeatBone((v || null) as HumanBone | null),
          ),
          r.heatBone ? hint(tr('Red: moves fully with that bone. Yellow, green, blue: less. Black: not at all.')) : null,
        ),
      ];
    }
    if (this.rigStage === 'skin') {
      const treatments = [
        ...SKIN_TREATMENTS.map((t) => ({ value: t.value as string, label: tr(t.label) })),
        ...(e.source ? [{ value: 'compare', label: tr('Compare all three') }] : []),
      ];
      const current = this.rigOutput === 'comparison' && e.source ? 'compare' : r.treatment;
      const description = current === 'compare' ? 'Makes one copy per treatment side by side, with the same joints. The original is kept hidden.' : SKIN_TREATMENTS.find((t) => t.value === current)!.description;
      return [
        section(
          tr('Calculation'),
          hint(tr('How the mesh follows the skeleton.')),
          select(
            tr('Weights'),
            [
              { value: 'envelope', label: tr('Envelope (fast)') },
              { value: 'heat', label: tr('Heat diffusion (smoother)') },
            ],
            r.method,
            (v) => !busy && ((r.method = v as WeightMethod), this.ui.renderPanel()),
          ),
          select(tr('Treatment'), treatments, current, (v) => {
            if (busy) return;
            this.rigOutput = v === 'compare' ? 'comparison' : 'single';
            if (v !== 'compare') r.treatment = v as SkinTreatment;
            this.ui.renderPanel();
            this.ui.renderSelbar();
          }),
          hint(tr(description)),
          busy ? progressBar(r.progress ?? 0, tr('Computing weights… {pct}%', { pct: Math.round((r.progress ?? 0) * 100) })) : null,
        ),
      ];
    }
    return [
      section(
        tr('Placement'),
        hint(tr('Drag the dots onto the body. Tap a dot to move it along one axis.')),
        row(
          button(tr('Find the joints'), () => this.findJoints(), { icon: Wand, cls: 'small' }),
          button(tr('Reset joints'), () => (r.remember(), r.fit(), ed.notify('rig')), { icon: RotateCcw, cls: 'small ghost' }),
        ),
        toggle(tr('Symmetry (left = right)'), r.symmetric, (v) => r.setSymmetric(v)),
      ),
      section(
        tr('Facing'),
        hint(tr('The dots should face you. If the model faces another way, turn the skeleton.')),
        row(
          button(tr('Turn 90°'), () => r.turn(true), { icon: RotateCw, cls: 'small' }),
          button(tr('Turn 180°'), () => r.turn(), { icon: RefreshCw, cls: 'small' }),
        ),
        row(button(tr('Front view'), () => r.frontView(), { icon: Scan, cls: 'small ghost' })),
      ),
    ];
  }

  findJoints() {
    const r = this.ui.editor.rigger;
    r.remember();
    if (r.findPose()) this.ui.toast(tr('Joints placed from the body shape. Check elbows and knees.'));
    else this.ui.toast(tr('Could not read the shape of this model. Place the joints by hand.'), 'error');
  }
}
