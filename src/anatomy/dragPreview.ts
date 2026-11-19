import type { AnatomyMesh, AnatomyResult } from './contracts';
import type { AnatomyParameters } from './parameters';
import { posedPositions, poseJoints, type AnatomyPose } from './pose';

export function orderedMeshes(result: AnatomyResult) {
  return Object.values(result.meshes).flat();
}

export function sameMeshTopology(a: AnatomyMesh[], b: AnatomyMesh[]) {
  return a.length === b.length && a.every((mesh, i) => {
    const next = b[i];
    return mesh.anatomicalName === next.anatomicalName && mesh.anatomyId === next.anatomyId &&
      mesh.positions.length === next.positions.length && mesh.indices.length === next.indices.length &&
      mesh.indices.every((index, j) => index === next.indices[j]);
  });
}

export function previewDeltas(
  base: AnatomyResult, sample: AnatomyResult,
  before: AnatomyParameters, after: AnatomyParameters,
  pose: AnatomyPose, span: number,
) {
  const a = orderedMeshes(base), b = orderedMeshes(sample);
  if (!Number.isFinite(span) || Math.abs(span) < 1e-6 || !sameMeshTopology(a, b)) return;
  const jointsBefore = poseJoints(before), jointsAfter = poseJoints(after);
  return a.flatMap((mesh, i) => {
    const from = posedPositions(mesh, before, pose, jointsBefore), to = posedPositions(b[i], after, pose, jointsAfter);
    const delta = Float32Array.from(to, (value, k) => {
      const scale = k % 3 === 1 ? .1 / 175 : .1;
      return (k % 3 === 1 ? value * after.height - from[k] * before.height : value - from[k]) * scale / span;
    });
    return delta.some(value => Math.abs(value) > 1e-7) ? [{ index: i, delta }] : [];
  });
}
