import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';

type Prepared = { frame: number; bones: Float32Array | null; morphs: number[] };
let prepared = new WeakMap<Mesh, Prepared>();
/** Scene edits invalidate the opt-in picking cache; activity/progress does not. */
export function invalidateSurfaces() { prepared = new WeakMap(); }

/** Update native picking and bounds to match skinning and shape keys on screen. */
export function prepareSurface(mesh: AbstractMesh) {
  if (mesh instanceof Mesh && (mesh.skeleton || mesh.morphTargetManager)) {
    const frame = mesh.getScene().getRenderId();
    const previous = prepared.get(mesh);
    if (previous?.frame === frame) return;
    mesh.skeleton?.prepare(true);
    const bones = mesh.skeleton?.getTransformMatrices(mesh) ?? null;
    const manager = mesh.morphTargetManager;
    const morphs = manager ? Array.from({ length: manager.numTargets }, (_, i) => manager.getTarget(i).influence) : [];
    if (previous && ((!bones && !previous.bones) || (bones && previous.bones && bones.length === previous.bones.length && bones.every((v, i) => v === previous.bones![i]))) && morphs.length === previous.morphs.length && morphs.every((v, i) => v === previous.morphs[i])) {
      previous.frame = frame;
      return;
    }
    mesh.refreshBoundingInfo(true, true);
    prepared.set(mesh, { frame, bones: bones?.slice() ?? null, morphs });
  }
}

/** Mesh-local positions with skinning and morph targets applied, without altering source buffers. */
export function surfacePositions(mesh: AbstractMesh) {
  return mesh instanceof Mesh ? mesh.getPositionData(true, true) : mesh.getVerticesData('position');
}

/** A deformed triangle normal cannot be read from the authored normal buffer. */
export function surfaceNormal(mesh: AbstractMesh, faceId: number) {
  if (!mesh.skeleton && !(mesh instanceof Mesh && mesh.morphTargetManager)) return null;
  if (!(mesh instanceof Mesh)) return null;
  prepareSurface(mesh);
  // Babylon's native picking cache is filled by refreshBoundingInfo above. Read only
  // the hit triangle instead of skinning the entire mesh a second time for its normal.
  const positions = mesh._positions, indices = mesh.getIndices();
  if (!positions || !indices || faceId < 0) return null;
  const world = mesh.computeWorldMatrix(true);
  const points = [0, 1, 2].map(k => Vector3.TransformCoordinates(positions[indices[faceId * 3 + k]], world));
  return Vector3.Cross(points[0].subtract(points[1]), points[2].subtract(points[1])).normalize();
}
