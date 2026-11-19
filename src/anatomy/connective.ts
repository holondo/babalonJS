import type { AnatomyMesh } from './contracts';
import { patchPoint, samplePatch, type PatchSample } from './attachmentPatches';
import { calculateNormals } from './algorithms/loft';
import { fittedRectusTendonChart } from './geometry';
import type { AnatomyParameters } from './parameters';

export interface SurfaceFollower { vertex: number; sample: PatchSample; offset: [number, number, number]; restOffset?: [number, number, number] }
function frame(mesh: AnatomyMesh, sample: PatchSample, positions: Float32Array, orthogonal = true) {
  const { point, normal } = patchPoint(mesh, sample, positions);
  const a = mesh.indices[sample.triangle * 3] * 3, b = mesh.indices[sample.triangle * 3 + 1] * 3;
  const tangent = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]];
  const alongNormal = tangent.reduce((sum, value, axis) => sum + value * normal[axis], 0);
  if (orthogonal) for (let axis = 0; axis < 3; axis++) tangent[axis] -= normal[axis] * alongNormal;
  const length = Math.hypot(...tangent) || 1;
  for (let axis = 0; axis < 3; axis++) tangent[axis] /= length;
  const bitangent = [normal[1] * tangent[2] - normal[2] * tangent[1], normal[2] * tangent[0] - normal[0] * tangent[2], normal[0] * tangent[1] - normal[1] * tangent[0]];
  return { point, axes: [tangent, bitangent, normal] };
}
/** Resolve connective references against the unedited recipe before growth/attachments move its muscles. */
export function bindRectusFollowers(inside: Record<string, AnatomyMesh[]>, original = false, fitted?: AnatomyParameters) {
  for (const side of ['L', 'R']) {
    const sources = (inside.rectusAbdominis ?? []).filter(mesh => mesh.anatomicalName?.includes(`_${side}_`) && mesh.shellPairs && mesh.surfaceGrid);
    for (const mesh of inside.aponeuroses ?? []) {
      if (!mesh.anatomicalName?.match(new RegExp(`^(tendinous_intersection|linea_alba)_${side}(_|$)`))) continue;
      mesh.followers = [];
      const band = /^tendinous_intersection_[LR]_(\d+)$/.exec(mesh.anatomicalName);
      const continuous = band && sources.find(source => source.anatomicalName?.endsWith('_continuous'));
      for (let vertex = 0; vertex < mesh.positions.length / 3; vertex++) {
        if (fitted && band && continuous && mesh.surfaceGrid && mesh.shellPairs) {
          const {rows,cols} = mesh.surfaceGrid, index = vertex % mesh.shellPairs;
          const chart = fittedRectusTendonChart(fitted, side === 'L' ? -1 : 1, Number(band[1])-1, index%(cols+1)/cols, Math.floor(index/(cols+1))/rows);
          if (chart) {
            const sample = samplePatch(continuous, chart[0], chart[1]);
            const {normal} = patchPoint(continuous,sample);
            const sign = normal[2] < 0 ? -1 : 1;
            mesh.followers.push({vertex,sample,offset:[0,0,sign*(vertex < mesh.shellPairs ? .005 : -.008)]});
            continue;
          }
        }
        const offset = vertex * 3;
        let nearest: AnatomyMesh | undefined, best = Infinity, index = 0;
        for (const source of sources) for (let i = 0; i < source.shellPairs!; i++) {
          const distance = (source.positions[i * 3] - mesh.positions[offset]) ** 2 + (source.positions[i * 3 + 1] - mesh.positions[offset + 1]) ** 2 + (source.positions[i * 3 + 2] - mesh.positions[offset + 2]) ** 2;
          if (distance < best) { best = distance; index = i; nearest = source; }
        }
        if (!nearest) continue;
        const grid = nearest.surfaceGrid!, row = Math.floor(index / (grid.cols + 1)), col = index % (grid.cols + 1);
        const sample = samplePatch(nearest, col / grid.cols, row / grid.rows), basis = frame(nearest, sample, nearest.positions, !original);
        const delta = basis.point.map((value, axis) => mesh.positions[offset + axis] - value);
        mesh.followers.push({ vertex, sample, restOffset: original ? undefined : delta as [number, number, number], offset: basis.axes.map(axis => axis.reduce((sum, value, k) => sum + value * delta[k], 0)) as [number, number, number] });
      }
    }
  }
}
export function applySurfaceFollowers(meshes: AnatomyMesh[], posed?: Map<AnatomyMesh, Float32Array>) {
  const sources = new Map(meshes.filter(mesh => mesh.anatomicalName).map(mesh => [mesh.anatomicalName!, mesh]));
  for (const mesh of meshes) {
    if (!mesh.followers?.length) continue;
    const positions = posed?.get(mesh) ?? mesh.positions;
    for (const follower of mesh.followers) {
      const source = sources.get(follower.sample.surfaceId);
      if (!source) throw new Error('Missing connective tissue support.');
      const basis = frame(source, follower.sample, posed?.get(source) ?? source.positions, !!follower.restOffset);
      // Shape edits translate the authored inscription; only the pose rotates
      // its offset, relative to the current rest surface rather than the recipe.
      const rest = posed && follower.restOffset ? frame(source, follower.sample, source.positions) : undefined;
      const offset = rest ? rest.axes.map(axis => axis.reduce((sum, value, k) => sum + value * follower.restOffset![k], 0)) : follower.offset;
      for (let axis = 0; axis < 3; axis++) positions[follower.vertex * 3 + axis] = basis.point[axis] + (!posed && follower.restOffset ? follower.restOffset[axis] : basis.axes.reduce((sum, vector, k) => sum + vector[axis] * offset[k], 0));
    }
    if (!posed) mesh.normals = calculateNormals(positions, mesh.indices);
  }
}
