import { tr } from '../core/i18n';
import { h, section, select } from './dom';

export function poseJointPicker(joints: { id: string; label: string }[], selected: string, pick: (id: string) => void) {
  return select(tr('Joint'), [
    { value: '', label: tr('Tap a joint or pick one') },
    ...joints.map(joint => ({ value: joint.id, label: joint.label })),
  ], selected, pick);
}

export function readyPoseSection(poses: { label: string; apply: () => void }[], note: HTMLElement | null = null) {
  return section(tr('Ready poses'), note, h('div', { class: 'chips' },
    ...poses.map(pose => h('button', { class: 'chip', onClick: pose.apply }, tr(pose.label)))));
}
