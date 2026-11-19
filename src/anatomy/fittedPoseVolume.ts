import type { AnatomyMesh, AnatomyResult } from './contracts';
import type { AnatomyParameters } from './parameters';
import { normalizePose, posedPositions, poseJoints, referenceStageKey } from './pose';
import { applyOrderedAttachments } from './attachmentPatches';
import { seatLumbarMuscles, solveTissueContact } from './tissueContact';
import { seatAxillaryMuscles } from './axillaryContact';
import { signedMeshVolume } from './algorithms/loft';
import { SurfaceBVH } from './inference/observationProxy';
import { foldViewDepth, foldViews, seatFoldFaces } from './foldFaceContact';

const references = new WeakMap<AnatomyResult, { key: string; volumes: Map<AnatomyMesh, number> }>();
const shoulderMuscle =
  /^(pectoralis_major_|latissimus_dorsi_|deltoid|trapezius_|levator_scapulae_|teres_|subscapularis_|supraspinatus_|infraspinatus_|subclavius_|sternocleidomastoid_)/;

/** Conserve the settled fitted volume, including the reference attachments and
 * contact. Thickness is redistributed inward from the superficial shell face. */
export function preserveFittedPoseVolumes(
  result: AnatomyResult,
  parameters: AnatomyParameters,
  meshes: AnatomyMesh[],
  posed: Map<AnatomyMesh, Float32Array>,
) {
  const key = referenceStageKey(parameters);
  let reference = references.get(result);
  if (!reference || reference.key !== key) {
    const joints = poseJoints(parameters),
      zero = normalizePose({});
    const rest = new Map(meshes.map((mesh) => [mesh, posedPositions(mesh, parameters, zero, joints)]));
    const surfaces = new Map(
      meshes.filter((mesh) => mesh.anatomicalName).map((mesh) => [mesh.anatomicalName!, mesh]),
    );
    applyOrderedAttachments(meshes, surfaces, rest);
    if (result.lumbarFascia?.length)
      seatLumbarMuscles(
        [...(result.meshes.otherMuscles ?? []), ...(result.meshes.externalOblique ?? [])],
        result.lumbarFascia,
        rest,
      );
    if (parameters.definition?.interaction?.contact)
      solveTissueContact(
        result.meshes,
        result.meshes.skin[0],
        result.contactLean,
        parameters.definition.interaction.clearanceMm,
        rest,
        parameters.abdominalModel === 1,
      );
    seatAxillaryMuscles(result.meshes.otherMuscles ?? [], result.meshes.skin[0], rest, meshes, parameters);
    reference = {
      key,
      volumes: new Map(
        meshes
          .filter((mesh) => shoulderMuscle.test(mesh.anatomicalName ?? '') && mesh.shellPairs)
          .map((mesh) => [
            mesh,
            Math.abs(signedMeshVolume({ positions: rest.get(mesh)!, indices: mesh.indices })),
          ]),
      ),
    };
    references.set(result, reference);
  }
  const skin = result.meshes.skin[0];
  const surface = new SurfaceBVH({ positions: posed.get(skin)!, indices: skin.indices });
  const orientation = Math.sign(surface.queryClosestPoint([0, 12.6, 3]).normal[2]) || 1;
  for (const [mesh, target] of reference.volumes) {
    const positions = posed.get(mesh),
      count = mesh.shellPairs,
      grid = mesh.surfaceGrid;
    if (!positions || !count || grid?.kind !== 'shell' || target < 1e-9) continue;
    const protectedPairs = new Uint8Array(count);
    for (let constraintPass = 0; constraintPass < 3; constraintPass++) {
      if (constraintPass && /^(pectoralis_major_|latissimus_dorsi_)/.test(mesh.anatomicalName ?? '')) break;
      // The moving shoulder may leave the reference pose's contact band.
      // Resolve exposed vertices against the actual posed surface there too.
      for (let i = 0; i < positions.length; i += 3) {
        const point: [number, number, number] = [positions[i], positions[i + 1], positions[i + 2]];
        const hit = surface.queryClosestPoint(point);
        const depth =
          orientation * hit.normal.reduce((sum, n, axis) => sum + n * (point[axis] - hit.point[axis]), 0);
        if (depth <= 0.004 || !foldViews.some((view) => foldViewDepth(surface, point, view) > 0.004))
          continue;
        for (let axis = 0; axis < 3; axis++)
          positions[i + axis] = hit.point[axis] - orientation * hit.normal[axis] * 0.009;
      }
      if (!/^(pectoralis_major_|latissimus_dorsi_)/.test(mesh.anatomicalName ?? '')) {
        const beforeFaces = positions.slice();
        seatFoldFaces(mesh, positions, surface, orientation, () => true);
        for (let vertex = 0; vertex < count; vertex++) {
          for (const face of [vertex, vertex + count])
            for (let axis = 0; axis < 3; axis++)
              if (Math.abs(positions[face * 3 + axis] - beforeFaces[face * 3 + axis]) > 1e-6)
                protectedPairs[vertex] = 1;
        }
      }
      const original = positions.slice(),
        stride = grid.cols + 1,
        offset = count * 3;
      const available = Float32Array.from({ length: count }, (_, vertex) => {
        if (protectedPairs[vertex]) return 0;
        const i = vertex * 3 + offset;
        const point: [number, number, number] = [original[i], original[i + 1], original[i + 2]];
        const hit = surface.queryClosestPoint(point);
        const inside =
          orientation * hit.normal.reduce((sum, n, axis) => sum + n * (point[axis] - hit.point[axis]), 0) < 0;
        const thickness = Math.hypot(
          original[i] - original[i - offset],
          original[i + 1] - original[i - offset + 1],
          original[i + 2] - original[i - offset + 2],
        );
        return inside && thickness > 1e-9 ? (0.8 * Math.sqrt(hit.distanceSq)) / thickness : 0;
      });
      const setThickness = (gain: number) => {
        for (let vertex = 0; vertex < count; vertex++) {
          const t = Math.floor(vertex / stride) / grid.rows;
          const weight = Math.sin(Math.PI * t) ** 2;
          const i = vertex * 3;
          const step = Math.max(-available[vertex], Math.min(available[vertex], (gain - 1) * weight));
          for (let axis = 0; axis < 3; axis++)
            positions[i + offset + axis] =
              original[i + offset + axis] + step * (original[i + offset + axis] - original[i + axis]);
        }
        return Math.abs(signedMeshVolume({ positions, indices: mesh.indices }));
      };
      const volume = setThickness(1);
      if (Math.abs(volume - target) / target < 0.0001) break;
      const slope = setThickness(2) - volume;
      if (Math.abs(slope) < 1e-10) {
        setThickness(1);
        break;
      }
      const gain = 1 + (target - volume) / slope;
      if (gain <= 0 || !Number.isFinite(gain)) {
        setThickness(1);
        break;
      }
      let currentGain = gain;
      for (let iteration = 0; iteration < 4; iteration++) {
        const currentVolume = setThickness(currentGain);
        if (Math.abs(currentVolume - target) / target < 0.00001) break;
        const step = Math.max(0.001, currentGain * 0.001);
        const derivative = (setThickness(currentGain + step) - currentVolume) / step;
        if (Math.abs(derivative) < 1e-10) break;
        const next = currentGain + (target - currentVolume) / derivative;
        if (!Number.isFinite(next) || next <= 0) break;
        currentGain = next;
      }
      setThickness(currentGain);
    }
  }
}
