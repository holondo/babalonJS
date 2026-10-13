import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';

/** Preserve the full affine transform, including shear from a rotated, nonuniformly scaled group. */
export function reparent(node: TransformNode, parent: TransformNode | null) {
  const local = node.computeWorldMatrix(true).clone();
  if (parent) local.multiplyToRef(parent.computeWorldMatrix(true).clone().invert(), local);
  node.parent = parent;
  setAffineTransform(node, local);
}

export function setAffineTransform(node: TransformNode, local: Matrix) {
  local.decompose(node.scaling, node.rotationQuaternion!, node.position);
  const linear = local.clone(); linear.setTranslation(Vector3.Zero());
  const scaleRotation = Matrix.Compose(node.scaling, node.rotationQuaternion!, Vector3.Zero());
  const pre = linear.multiply(scaleRotation.invert());
  const nearlyIdentity = pre.asArray().every((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-6);
  node.setPreTransformMatrix(nearlyIdentity ? Matrix.Identity() : pre);
  node.computeWorldMatrix(true);
}
