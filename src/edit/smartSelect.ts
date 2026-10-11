import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { FaceSelection } from './selection';

export function selectionRing(selection: FaceSelection, grow: boolean) {
  selection.checkpoint();
  for (const [mesh, faces] of selection.faces) {
    const neighbors = selection.neighbors(mesh), next = new Set(faces);
    for (const face of faces) {
      if (grow) for (const n of neighbors[face]) next.add(n);
      else if (neighbors[face].length < 3 || neighbors[face].some(n => !faces.has(n))) next.delete(face);
    }
    selection.faces.set(mesh, next);
  }
  selection.refresh();
}

/** Flood along actual welded edges, respecting material, UV, crease and narrow-edge boundaries. */
export function smartSelect(selection: FaceSelection, mesh: Mesh, seed: number, tolerance: number, add: boolean) {
  selection.checkpoint();
  const indices = mesh.getIndices()!, positions = mesh.getVerticesData('position')!, uv = mesh.getVerticesData('uv');
  const neighbors = selection.neighbors(mesh);
  const normals: Vector3[] = [], areas: number[] = [];
  const point = (v: number) => Vector3.FromArray(positions, v * 3);
  for (let face = 0; face < indices.length / 3; face++) { const a = point(indices[face * 3]), b = point(indices[face * 3 + 1]), c = point(indices[face * 3 + 2]); const n = Vector3.Cross(b.subtract(a), c.subtract(a)); areas.push(n.length() / 2); normals.push(n.normalize()); }
  const material = (f: number) => mesh.subMeshes.find(s => f * 3 >= s.indexStart && f * 3 < s.indexStart + s.indexCount)?.materialIndex;
  const cosine = Math.cos((5 + tolerance * 100) * Math.PI / 180);
  const seen = new Set([seed]), queue = [seed];
  for (let i = 0; i < queue.length; i++) for (const neighbor of neighbors[queue[i]] ?? []) {
    const face = queue[i]; if (seen.has(neighbor) || material(face) !== material(neighbor) || Vector3.Dot(normals[face], normals[neighbor]) < cosine) continue;
    const shared: [number, number][] = [];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) { const va = indices[face * 3 + a], vb = indices[neighbor * 3 + b]; if (Vector3.DistanceSquared(point(va), point(vb)) < 1e-12) shared.push([va, vb]); }
    if (shared.length < 2) continue;
    if (uv && shared.some(([a, b]) => Math.abs(uv[a * 2] - uv[b * 2]) + Math.abs(uv[a * 2 + 1] - uv[b * 2 + 1]) > 1e-5)) continue;
    const edge = Vector3.Distance(point(shared[0][0]), point(shared[1][0]));
    if (edge < Math.sqrt(Math.max(areas[face], areas[neighbor])) * (1 - tolerance) * 0.35) continue;
    seen.add(neighbor); queue.push(neighbor);
  }
  selection.apply(mesh, seen, add); selection.refresh();
}
