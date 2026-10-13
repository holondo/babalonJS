import type { GizmoManager } from '@babylonjs/core/Gizmos/gizmoManager.js';

const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
export const TRANSFORM_GIZMO_THICKNESS = touch ? 2 : 1.5;

/** Apply after enabling a tool: Babylon only updates controls already allocated. */
export function applyTransformGizmoStyle(manager: GizmoManager) {
  manager.scaleRatio = touch ? 1.5 : 1.1;
}
