import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';

/** Update native picking and bounds to match the surface rendered by the skeleton. */
export function prepareSurface(mesh: AbstractMesh) {
  if (mesh instanceof Mesh && mesh.skeleton) {
    mesh.skeleton.prepare(true);
    mesh.refreshBoundingInfo(true);
  }
}

/** Mesh-local positions with skinning and morph targets applied, without altering source buffers. */
export function surfacePositions(mesh: AbstractMesh) {
  return mesh instanceof Mesh ? mesh.getPositionData(true, true) : mesh.getVerticesData('position');
}

/** A deformed triangle normal cannot be read from the authored normal buffer. */
export function surfaceNormal(mesh: AbstractMesh, faceId: number) {
  if (!mesh.skeleton && !(mesh instanceof Mesh && mesh.morphTargetManager)) return null;
  const positions = surfacePositions(mesh), indices = mesh.getIndices();
  if (!positions || !indices || faceId < 0) return null;
  const world = mesh.computeWorldMatrix(true);
  const points = [0, 1, 2].map(k => Vector3.TransformCoordinates(Vector3.FromArray(positions, indices[faceId * 3 + k] * 3), world));
  return Vector3.Cross(points[0].subtract(points[1]), points[2].subtract(points[1])).normalize();
}
