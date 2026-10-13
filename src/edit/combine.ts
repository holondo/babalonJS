import { AssetContainer } from '@babylonjs/core/assetContainer.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MultiMaterial } from '@babylonjs/core/Materials/multiMaterial.js';
import type { Material } from '@babylonjs/core/Materials/material.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { AssetRef, Editor, Entity, PrimitiveType } from '../core/editor';
import { copyUserTextures } from '../core/materialTextures';
import { applyMaterial, materialToJSON } from '../core/state';
import { tr } from '../core/i18n';
import { capturePart, encodeSeparation } from './parts';

export interface PartOrigin { asset?: AssetRef; primitive?: PrimitiveType; mesh: number; material?: number; sideOrientation?: number }
export interface Composite { origins: PartOrigin[]; geometry: Uint8Array }

export function cloneMaterial(source: Material): Material {
  if (source instanceof MultiMaterial) {
    const copy = new MultiMaterial(source.name, source.getScene());
    copy.subMaterials = source.subMaterials.map(m => m ? cloneMaterial(m) : null);
    return copy;
  }
  const copy = source.clone(source.name);
  if (!copy) throw new Error(tr('This material cannot be copied.'));
  if (copy.metadata) copy.metadata = { ...copy.metadata };
  copyUserTextures(source, copy);
  applyMaterial(copy, materialToJSON(source));
  return copy;
}

export function disposeMeshCopy(mesh: Mesh) {
  const material = mesh.material;
  const materials = material instanceof MultiMaterial ? [...material.subMaterials, material] : [material];
  mesh.dispose(false, false);
  for (const m of materials) m?.dispose(false, false);
}

/**
 * In-place edits (cut, region transform, brushes, closing openings) keep each vertex's skin
 * weights, so rigged, skinned and animated models can be edited (in their rest pose). Shape keys
 * store absolute positions per vertex and would no longer match, so those meshes are refused.
 * An optimization must be frozen first (see ModelOptimizer.freeze).
 */
export function editBlocker(e: Entity) {
  if (!e.visible) return tr('Show the object before editing its geometry.');
  if (e.groupMembers || e.groupParent) return tr('Ungroup these objects before editing their geometry.');
  if (e.kind === 'light' || !e.meshes.length || e.meshes.some(m => !(m instanceof Mesh) || !m.getVerticesData('position'))) return tr('Choose triangle models or shapes.');
  if (e.meshes.some(m => m.morphTargetManager?.numTargets)) return tr('This model has shape keys (morph targets): editing its surface would break them.');
  if (e.optimization) return tr('Revert optimization before editing geometry.');
  return null;
}

/** Combine, fuse and connect create a new object, which can't carry a skeleton or animations. */
export function staticMeshBlocker(e: Entity) {
  const reason = editBlocker(e);
  if (reason) return reason;
  if (e.rig || e.motion || e.animationGroups.length || e.meshes.some(m => m.skeleton)) return tr('Combining, fusing and connecting make a new object without skeleton or animations. Edit this model in place, or remove its rig first.');
  if (e.textureOptimization) return tr('Revert the texture optimization before combining, fusing or connecting.');
  return null;
}

/** A detached copy with positions baked into the result's coordinate system. */
export function copyMesh(mesh: Mesh, transform?: Matrix) {
  const copy = mesh.clone(mesh.name, null, true);
  if (!copy) throw new Error(tr('This mesh cannot be copied.'));
  copy.parent = null;
  copy.material = null;
  try {
    copy.metadata = null;
    mesh.geometry?.copy(`edit-${copy.uniqueId}`).applyToMesh(copy);
    if (mesh.material) copy.material = cloneMaterial(mesh.material);
    copy.setEnabled(true); copy.isVisible = true;
    if (transform) {
      copy.bakeTransformIntoVertices(transform);
      // Babylon bakes positions and flips winding, but normals need inverse-transpose
      // under nonuniform scale. Retain UV seams and the authored normal directions.
      const normals = mesh.getVerticesData('normal');
      if (normals) {
        const normalMatrix = transform.clone().invert().transpose();
        const out = Array.from(normals), v = new Vector3();
        for (let i = 0; i < out.length; i += 3) Vector3.TransformNormalFromFloatsToRef(normals[i], normals[i + 1], normals[i + 2], normalMatrix, v).normalize().toArray(out, i);
        copy.setVerticesData('normal', out);
      }
      if (transform.determinant() < 0) {
        const tangent = copy.getVerticesData('tangent');
        if (tangent) { for (let i = 3; i < tangent.length; i += 4) tangent[i] *= -1; copy.setVerticesData('tangent', tangent); }
      }
    }
    copy.setPreTransformMatrix(Matrix.Identity());
    copy.position.setAll(0); copy.rotation.setAll(0); copy.rotationQuaternion = null; copy.scaling.setAll(1);
    return copy;
  } catch (error) { disposeMeshCopy(copy); throw error; }
}

/** Keep detached templates as the source so duplicate, separate and rig share the normal model path. */
export function spawnComposite(editor: Editor, name: string, meshes: Mesh[], origins: PartOrigin[], record = false, publish = false) {
  const container = new AssetContainer(editor.scene);
  container.meshes = meshes;
  container.rootNodes = meshes;
  container.removeAllFromScene();
  const asset: AssetRef = { id: editor.nextAssetId++, name };
  const e = editor.spawnModel(container, name, { container, asset, fitScale: 1, fitOffset: Vector3.Zero() }, asset, { record, select: false, publish });
  for (const [i, m] of e.meshes.entries()) if (meshes[i].material) { const old = m.material; m.material = cloneMaterial(meshes[i].material!); old?.dispose(false, false); }
  e.composite = { origins: origins.map((o, i) => ({ ...o, sideOrientation: meshes[i].overrideMaterialSideOrientation })), geometry: encodeSeparation({ meshes: meshes.map(m => capturePart(m, true)), pivot: [0, 0, 0] }) };
  return e;
}

export function combine(editor: Editor, entities = editor.selection, minimum = 2) {
  if (entities.length < minimum) throw new Error(tr('Select at least two objects.'));
  for (const e of entities) { const reason = staticMeshBlocker(e); if (reason) throw new Error(reason); }
  const meshes: Mesh[] = [], origins: PartOrigin[] = [];
  const bounds = entities.map(e => editor.boundsOf(e));
  const min = bounds[0].min.clone(), max = bounds[0].max.clone();
  for (const b of bounds) { min.minimizeInPlace(b.min); max.maximizeInPlace(b.max); }
  const center = new Vector3((min.x + max.x) / 2, min.y, (min.z + max.z) / 2);
  const toRoot = Matrix.Translation(-center.x, -center.y, -center.z);
  try {
    for (const e of entities) for (const [i, m] of e.meshes.entries()) {
      if (!m.getTotalIndices()) continue;
      meshes.push(copyMesh(m as Mesh, m.computeWorldMatrix(true).multiply(toRoot)));
      origins.push(e.composite?.origins[i] ?? { asset: e.source?.asset, primitive: e.primitive, mesh: i });
    }
    if (!meshes.length) throw new Error(tr('Choose triangle models or shapes.'));
  } catch (error) { meshes.forEach(disposeMeshCopy); throw error; }
  const result = spawnComposite(editor, tr('Combined object'), meshes, origins);
  result.root.position.copyFrom(center);
  editor.group(() => {
    entities.forEach(e => editor.remove(e));
    editor.publishSeparated(result);
  });
  editor.select(result);
  return result;
}
