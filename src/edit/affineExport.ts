import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { Scene } from '@babylonjs/core/scene.js';
import { GLTFExporter } from '@babylonjs/serializers/glTF/2.0/glTFExporter.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Matrix } from '@babylonjs/core/Maths/math.vector.js';

/** glTF matrices retain shear that a TRS-only export would silently discard. */
export function affineExport(scene: Scene) {
  const wrappers: { node: TransformNode; pre: Matrix; child: TransformNode; children: TransformNode[] }[] = [];
  const animated = new Set(scene.animationGroups.flatMap(g => g.targetedAnimations.map(a => a.target)));
  for (const node of [...scene.transformNodes, ...scene.meshes]) {
    if (node.getPivotMatrix().isIdentity() || !(node.animations.length || animated.has(node)) || node instanceof Mesh && node.getTotalVertices()) continue;
    const pre = node.getPivotMatrix().clone();
    const children = node.getChildren().filter((n): n is TransformNode => n instanceof TransformNode);
    const child = new TransformNode('Affine transform', scene); child.parent = node; child.setPreTransformMatrix(pre);
    node.setPreTransformMatrix(Matrix.Identity()); children.forEach(n => { n.parent = child; });
    wrappers.push({ node, pre, child, children });
  }
  const name = 'BABALON_affine';
  GLTFExporter.RegisterExtension(name, () => ({
    name, enabled: true, required: false, wasUsed: false, dispose() {},
    async postExportNodeAsync(_context, node, original, _map, rightHanded) {
      if (!(original instanceof TransformNode) || original.getPivotMatrix().isIdentity()) return node;
      let local = original.computeWorldMatrix(true).clone();
      if (original.parent instanceof TransformNode) local = local.multiply(original.parent.computeWorldMatrix(true).clone().invert());
      if (rightHanded) { const flip = Matrix.Scaling(1, 1, -1); local = flip.multiply(local).multiply(flip); }
      node.matrix = Array.from(local.asArray());
      // Babylon's glTF loader decomposes node.matrix into TRS; retain the exact matrix
      // as metadata so reopening our own export can restore its affine transform.
      node.extras = { ...node.extras, babalonAffine: node.matrix };
      delete node.translation; delete node.rotation; delete node.scale;
      return node;
    },
  }));
  return () => {
    GLTFExporter.UnregisterExtension(name);
    for (const { node, pre, child, children } of wrappers) { children.forEach(n => { n.parent = node; }); node.setPreTransformMatrix(pre); child.dispose(); }
  };
}
