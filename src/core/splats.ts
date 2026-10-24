import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import type { GaussianSplattingMeshBase } from '@babylonjs/core/Meshes/GaussianSplatting/gaussianSplattingMeshBase.js';
import type { GaussianSplattingMesh } from '@babylonjs/core/Meshes/GaussianSplatting/gaussianSplattingMesh.js';
import type { GaussianSplattingMaterial } from '@babylonjs/core/Materials/GaussianSplatting/gaussianSplattingMaterial.js';
import type { Material } from '@babylonjs/core/Materials/material.js';
import { materialToJSON, applyMaterial } from './state';

export const SPLAT_GLTF_EXTENSION = 'BABALON_gaussian_splatting';

/** Structural detection keeps the optional splat implementation out of startup. */
export function isSplat(mesh: { getClassName(): string }): mesh is GaussianSplattingMeshBase {
  return mesh.getClassName().includes('GaussianSplatting');
}

const clones = new WeakMap<AbstractMesh, { source: GaussianSplattingMeshBase; initial: Material }>();

export function recordSplatClone(mesh: AbstractMesh, source: GaussianSplattingMeshBase, initial: Material) {
  clones.set(mesh, { source, initial });
}

/** AssetContainer replaces the material after clone(), so finish its ownership here. */
export function restoreSplatClone(mesh: AbstractMesh) {
  if (!isSplat(mesh)) return;
  const clone = clones.get(mesh);
  // Older Babylon scene files can still produce Babylon's base-class clone.
  if (!clone && mesh.source && isSplat(mesh.source)) {
    const source = mesh.source;
    Object.assign(mesh, { _keepInRam: true, _maxShDegree: Reflect.get(source, '_maxShDegree'), _flipY: Reflect.get(source, '_flipY') });
    mesh._splatsData = source.splatsData;
    mesh._shData = source.shData;
    mesh.shDegree = source.shDegree;
  }
  if (clone && mesh.material !== clone.initial) clone.initial.dispose(false, false);
  (mesh.material as GaussianSplattingMaterial).setSourceMesh(mesh as GaussianSplattingMesh);
  if (clone?.source.material && mesh.material) applyMaterial(mesh.material, materialToJSON(clone.source.material));
  clones.delete(mesh);
}

export function splatTextures(mesh: GaussianSplattingMeshBase) {
  return [mesh.centersTexture, mesh.colorsTexture, mesh.covariancesATexture, mesh.covariancesBTexture, ...(mesh.shTextures ?? [])]
    .filter(texture => !!texture);
}
