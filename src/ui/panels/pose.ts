import { Move3d, Play, ArrowLeftRight, Bone, Check, PersonStanding, Rotate3d, RotateCcw, RotateCw } from 'lucide';
import type { IconNode } from 'lucide';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Entity } from '../../core/editor';
import { REQUIRED_BONES, boneLabel, humanoidOf, jointNodes, setBoneMapping } from '../../rigging/humanoid';
import type { HumanBone } from '../../rigging/humanoid';
import { mappedParent, rotationOf } from '../../animation/pose';
import type { PoseJoint } from '../../animation/pose';
import { POSE_PRESETS } from '../../core/presets';
import { tr } from '../../core/i18n';
import { button, h, hint, icon, iconButton, row, section, select, slider, toggle } from '../dom';
import type { UI } from '../ui';
import { jointLabel } from '../shared';

/** Objects → Pose: posing joints by hand, ready poses, skeleton mapping, treatment comparison; the pose bar and joint handles. */
export class PosePanel {
  private readonly ui: UI;

  constructor(ui: UI) {
    this.ui = ui;
  }

  differenceScale = .5;

  /** Show the manual bone mapping even when nothing is missing. */
  mapBones = false;

  /** Selection bar while posing: the joint, how to move it, and Done. */
  renderPoseBar() {
    const p = this.ui.editor.pose;
    const j = p.joint;
    this.ui.selbar.classList.add('show');
    const tool = (t: 'rotate' | 'move', node: IconNode, label: string, title = label) => iconButton(node, title, () => p.setTool(t), { active: p.tool === t, label, cls: 'tool' });
    this.ui.selbar.replaceChildren(
      h('div', { class: 'sel-name always' }, icon(Bone, 16), h('span', {}, j ? jointLabel(j) : tr('Tap a joint'))),
      h(
        'div',
        { class: 'sel-tools' },
        j ? tool('rotate', Rotate3d, tr('Turn')) : null,
        j && p.canMove() ? tool('move', Move3d, tr('Drag'), tr('Drag the hand or foot: the arm or leg follows')) : null,
        p.human ? iconButton(ArrowLeftRight, tr('Mirror pose'), () => p.mirror()) : null,
        h('span', { class: 'sep' }),
        button(tr('Done'), () => p.stop(), { icon: Check, cls: 'small primary' }),
      ),
    );
  }

  /** Joint handles over the posed object (or the skeleton being placed while rigging). */
  renderPoseOverlay() {
    const ed = this.ui.editor;
    const p = ed.pose;
    const r = ed.rigger;
    if (r.active && r.step === 'place' && !ed.cleanView) return this.ui.rigUI.renderRigOverlay();
    if (!p.active || ed.cleanView) return this.ui.jointOverlay.clear();
    const joints = p.joints();
    const map = p.human;
    const id = (j: PoseJoint) => String(joints.indexOf(j));
    const byNode = new Map(joints.map((j) => [j.node, j]));
    this.ui.jointOverlay.set(
      joints.map((j) => {
        let parent: PoseJoint | undefined;
        if (map && j.bone) {
          const pb = mappedParent(map, j.bone);
          parent = pb ? joints.find((x) => x.bone === pb) : undefined;
        } else {
          parent = byNode.get(j.node.parent as never);
        }
        return {
          id: id(j),
          position: () => j.node.getAbsolutePosition(),
          parent: parent ? id(parent) : undefined,
          label: jointLabel(j),
          cls: `${p.joint?.node === j.node ? 'active' : ''} ${p.canMove(j) ? 'ik' : ''}`,
        };
      }),
      { onPick: (i) => p.selectJoint(p.joint?.node === joints[+i].node ? null : joints[+i]) },
    );
  }

  startPosing(e: Entity) {
    this.ui.editor.pose.start(e);
    this.ui.segment.objects = 'pose';
    if (this.ui.tab === 'objects') this.ui.renderPanel();
  }

  posePanel(): (Node | null)[] {
    const ed = this.ui.editor;
    const e = ed.selected;
    if (!e) return [];
    const p = ed.pose;
    const d = humanoidOf(e);
    const active = p.active && p.entity === e;
    const out: (Node | null)[] = [];
    if (!active) {
      out.push(
        section(
          tr('Pose'),
          hint(tr('Turn the joints of this character to pose it for scenes and photos.')),
          row(button(tr('Pose joints'), () => this.startPosing(e), { icon: PersonStanding, cls: 'primary' })),
        ),
      );
    } else {
      const joints = p.joints();
      const j = p.joint;
      const turn = (axis: 'x' | 'y' | 'z', label: string) => {
        let from: ReturnType<typeof rotationOf> | null = null;
        return slider(
          label,
          0,
          { min: -180, max: 180, step: 1, format: (v) => `${Math.round(v)}°`, onCommit: () => ((from = null), p.end()) },
          (v) => {
            if (!j) return;
            from ??= rotationOf(j.node).clone();
            this.ui.quiet(() => p.turnJoint(axis, v, from!));
          },
        );
      };
      out.push(
        section(
          tr('Joint'),
          select(
            tr('Joint'),
            [{ value: '', label: tr('Tap a joint or pick one') }, ...joints.map((x, i) => ({ value: String(i), label: jointLabel(x) }))],
            j ? String(joints.findIndex((x) => x.node === j.node)) : '',
            (v) => p.selectJoint(v === '' ? null : joints[+v]),
          ),
          ...(j
            ? [
                turn('x', tr('Bend')),
                turn('y', tr('Twist')),
                turn('z', tr('Tilt')),
                row(button(tr('Reset joint'), () => p.reset(j.node), { icon: RotateCcw, cls: 'small ghost' })),
              ]
            : [hint(tr('Drag the rings to turn the joint. Hands and feet can also be dragged: the arm or leg follows.'))]),
        ),
      );
      out.push(
        section(
          tr('Whole pose'),
          p.human
            ? row(
                button(tr('Mirror'), () => p.mirror(), { icon: ArrowLeftRight, cls: 'small' }),
                button(tr('Left → right'), () => p.copySide('left'), { cls: 'small' }),
                button(tr('Right → left'), () => p.copySide('right'), { cls: 'small' }),
              )
            : null,
          row(
            button(tr('Reset pose'), () => p.reset(), { icon: RotateCcw, cls: 'small ghost' }),
            e.animationGroups.length ? button(tr('Back to animation'), () => p.backToAnimation(), { icon: Play, cls: 'small ghost' }) : null,
          ),
        ),
      );
    }
    if (d?.humanoid && d.complete) {
      out.push(
        section(
          tr('Ready poses'),
          e.rig?.data.comparison ? hint(tr('Ready poses apply to all models in this comparison.')) : null,
          h(
            'div',
            { class: 'chips' },
            ...POSE_PRESETS.map((preset) =>
              h(
                'button',
                {
                  class: 'chip',
                  onClick: () => this.ui.run(() => {
                    const targets = [...ed.rigger.comparisonMembers(e).filter(other => other !== e), e];
                    if (!preset.dirs) return ed.clips.poseManyFromClip(targets, preset.clip!, preset.time ?? 0);
                    const dirs = Object.fromEntries(Object.entries(preset.dirs).map(([b, v]) => [b, Vector3.FromArray(v).normalize()]));
                    ed.group(() => targets.forEach(target => p.applyDirections(target, dirs)));
                  }),
                },
                tr(preset.label),
              ),
            ),
          ),
        ),
      );
    }
    if (e.rig?.data.comparison) {
      const difference = ed.rigger.difference;
      const shown = difference.group === e.rig.data.comparison;
      const show = () =>
        this.ui.run(() => {
          const css = getComputedStyle(document.documentElement);
          const palette = ['--purple', '--gold', '--terra'].map((key) => Color3.FromHexString(css.getPropertyValue(key).trim())) as [Color3, Color3, Color3];
          difference.show(ed.rigger.comparisonMembers(e), this.differenceScale, palette);
          this.ui.renderPanel();
        });
      out.push(
        section(
          tr('Compare treatments'),
          toggle(tr('Difference map'), shown, (v) => (v ? show() : (difference.clear(), ed.invalidate(), this.ui.renderPanel()))),
          ...(shown
            ? [
                hint(tr('Purple: same as Direct weights. Gold to red: more displacement.')),
                slider(tr('Red at'), this.differenceScale, { min: 0.05, max: 5, step: 0.05, format: (v) => tr('{n}% of height', { n: v.toFixed(2) }) }, (v) => {
                  this.differenceScale = v;
                  difference.setScale(v);
                }),
                h(
                  'ul',
                  { class: 'readout' },
                  ...difference.summaries.map((s) =>
                    h('li', {}, h('span', {}, s.entity.name), h('b', {}, tr('max {max}% · mean {mean}%', { max: s.maximum.toFixed(2), mean: s.mean.toFixed(2) }))),
                  ),
                ),
                row(button(tr('Update for this pose'), show, { icon: RotateCw, cls: 'small' })),
              ]
            : [hint(tr('Colors each copy by how far it moves from Direct weights in the current pose.'))]),
        ),
      );
    }
    out.push(this.skeletonSection(e));
    return out;
  }

  /** Which joint is which (humanoid detection), with manual mapping when something is missing. */
  skeletonSection(e: Entity) {
    const ed = this.ui.editor;
    const d = humanoidOf(e);
    if (!d) return null;
    const joints = jointNodes(e);
    const status = d.complete
      ? tr('Humanoid skeleton: all main bones were recognized ({n} joints).', { n: joints.length })
      : d.humanoid
        ? tr('Some bones were not recognized. Pick them below to use ready poses and animations.')
        : tr('This skeleton was not recognized as a person. You can still turn its joints, or map its bones by hand.');
    const showMap = this.mapBones || (d.humanoid && !d.complete);
    const options = [{ value: '', label: '—' }, ...joints.map((n) => ({ value: n.name, label: n.name }))];
    const remap = (bone: HumanBone, v: string) => {
      setBoneMapping(e, bone, v || null);
      if (ed.pose.entity === e) ed.pose.selectJoint(null);
      ed.notify('pose');
    };
    return section(
      tr('Skeleton'),
      hint(status),
      ...(showMap ? REQUIRED_BONES.map((b) => select(tr(boneLabel(b)), options, d.map[b]?.name ?? '', (v) => remap(b, v))) : []),
      !showMap ? row(button(tr('Map bones by hand'), () => ((this.mapBones = true), this.ui.renderPanel()), { icon: Bone, cls: 'small ghost' })) : null,
    );
  }
}
