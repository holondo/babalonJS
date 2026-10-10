import { Box, Lightbulb } from 'lucide';
import type { IconNode } from 'lucide';
import type { Entity } from '../core/editor';
import { boneLabel } from '../rigging/humanoid';
import type { PoseJoint } from '../animation/pose';
import { tr } from '../core/i18n';

/** Small helpers and types shared by the interface modules. */

export type Tab = 'add' | 'objects' | 'light' | 'tools' | 'photo';

export const KIND_ICON: Record<Entity['kind'], IconNode> = { model: Box, primitive: Box, light: Lightbulb };

/** Name of a joint for lists and the selection bar. */
export function jointLabel(j: PoseJoint) {
  return j.bone ? tr(boneLabel(j.bone)) : j.node.name;
}

/** Readable clip name: "Walk_Loop" → "Walk loop". */
export function clipLabel(name: string, i: number) {
  const clean = name.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  return clean ? clean[0].toUpperCase() + clean.slice(1).toLowerCase() : tr('Animation {n}', { n: i + 1 });
}

export const deg = (r: number) => (r * 180) / Math.PI;

export const rad = (d: number) => (d * Math.PI) / 180;

export function fileSafe(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, '-').trim() || tr('my-scene');
}

export function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

export function errorMessage(e: unknown) {
  if (e instanceof Error) return e.message;
  return String(e);
}
