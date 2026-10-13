import type { PrimitiveType } from '../core/editor';
import { tr } from '../core/i18n';

export const QUICK_SHAPES: PrimitiveType[] = ['sphere', 'box', 'cylinder', 'cone', 'torus', 'plane'];
export function shapeLabel(type: PrimitiveType) {
  return tr(({ sphere: 'Sphere', box: 'Cube', cylinder: 'Cylinder', cone: 'Cone', torus: 'Torus', plane: 'Plane' } as const)[type]);
}
