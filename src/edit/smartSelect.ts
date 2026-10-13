import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { FaceSelection } from './selection';
import { surfacePositions } from '../core/surface';

/** One ring of faces more (grow) or less (shrink), on the compact face connectivity. */
export function selectionRing(selection: FaceSelection, grow: boolean) {
  selection.checkpoint();
  for (const [mesh, faces] of selection.faces) {
    if (!faces.size) continue;
    const { offsets, list } = selection.neighbors(mesh);
    const before = faces.mask.slice();
    for (let f = 0; f < before.length; f++) {
      if (grow) {
        if (!before[f]) continue;
        for (let k = offsets[f]; k < offsets[f + 1]; k++) faces.add(list[k]);
      } else if (before[f]) {
        let edge = offsets[f + 1] - offsets[f] < 3;
        for (let k = offsets[f]; !edge && k < offsets[f + 1]; k++) if (!before[list[k]]) edge = true;
        if (edge) faces.delete(f);
      }
    }
  }
  selection.refresh();
}

/** Face normals and areas of a mesh, cached per geometry (the wand reads them a lot). */
const faceData = new WeakMap<object, { normals: Float32Array; areas: Float32Array; material: Int32Array }>();
/** After vertices moved, cached face normals of these meshes are stale. */
export function forgetFaceData(meshes: Mesh[]) { for (const m of meshes) { faceData.delete(m.geometry ?? m); faceData.delete(m); } }
function facesOf(mesh: Mesh, p: ArrayLike<number>) {
  const key = mesh.geometry ?? mesh;
  let data = faceData.get(key);
  const deformed = !!(mesh.skeleton || mesh.morphTargetManager);
  if (data && !deformed) return data;
  const indices = mesh.getIndices()!;
  const count = indices.length / 3, normals = new Float32Array(count * 3), areas = new Float32Array(count), material = new Int32Array(count).fill(-1);
  for (let f = 0; f < count; f++) {
    const a = indices[f * 3] * 3, b = indices[f * 3 + 1] * 3, c = indices[f * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    normals[f * 3] = nx / l; normals[f * 3 + 1] = ny / l; normals[f * 3 + 2] = nz / l; areas[f] = l / 2;
  }
  for (const s of mesh.subMeshes ?? []) material.fill(s.materialIndex, s.indexStart / 3, (s.indexStart + s.indexCount) / 3);
  data = { normals, areas, material };
  if (!deformed) faceData.set(key, data);
  return data;
}

/** Flood along actual welded edges, respecting material, UV, crease and narrow-edge boundaries. */
export function smartSelect(selection: FaceSelection, mesh: Mesh, seed: number, tolerance: number, add: boolean) {
  const set = selection.faces.get(mesh); if (!set) return;
  selection.checkpoint();
  const indices = mesh.getIndices()!, p = surfacePositions(mesh)!, uv = mesh.getVerticesData('uv');
  const { offsets, list, weld } = selection.neighbors(mesh);
  const { normals, areas, material } = facesOf(mesh, p);
  const cosine = Math.cos((5 + tolerance * 100) * Math.PI / 180);
  const seen = new Uint8Array(offsets.length - 1), queue = new Uint32Array(offsets.length - 1);
  let head = 0, tail = 0;
  seen[seed] = 1; queue[tail++] = seed;
  while (head < tail) {
    const face = queue[head++];
    for (let k = offsets[face]; k < offsets[face + 1]; k++) {
      const n = list[k];
      if (seen[n] || material[face] !== material[n]) continue;
      if (normals[face * 3] * normals[n * 3] + normals[face * 3 + 1] * normals[n * 3 + 1] + normals[face * 3 + 2] * normals[n * 3 + 2] < cosine) continue;
      // The shared edge: the two welded vertices both faces use
      let a = -1, b = -1, ua = -1, na = -1, nb = -1;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        const vi = indices[face * 3 + i], vj = indices[n * 3 + j];
        if (weld[vi] !== weld[vj]) continue;
        if (a < 0) { a = vi; na = vj; ua = i; } else if (b < 0 && ua !== i) { b = vi; nb = vj; }
      }
      if (b < 0) continue;
      // A UV seam is a boundary too
      if (uv && (Math.abs(uv[a * 2] - uv[na * 2]) + Math.abs(uv[a * 2 + 1] - uv[na * 2 + 1]) > 1e-5 || Math.abs(uv[b * 2] - uv[nb * 2]) + Math.abs(uv[b * 2 + 1] - uv[nb * 2 + 1]) > 1e-5)) continue;
      // Narrow necks (short shared edges relative to the faces) stop the flood
      const edge = Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);
      if (edge < Math.sqrt(Math.max(areas[face], areas[n])) * (1 - tolerance) * 0.35) continue;
      seen[n] = 1; queue[tail++] = n;
    }
  }
  for (let i = 0; i < tail; i++) if (add) set.add(queue[i]); else set.delete(queue[i]);
  selection.refresh();
}
