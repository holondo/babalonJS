import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { Geometry } from '@babylonjs/core/Meshes/geometry.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { SubMesh } from '@babylonjs/core/Meshes/subMesh.js';
import { BoundingInfo } from '@babylonjs/core/Culling/boundingInfo.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { MorphTarget } from '@babylonjs/core/Morph/morphTarget.js';
import { MorphTargetManager } from '@babylonjs/core/Morph/morphTargetManager.js';

/** A mesh's triangles (and, after an exact cut, its own vertex data): what a separated part stores. */
export interface MeshPart {
  indices: number[];
  materials: { material: number; start: number; count: number }[];
  attributes?: Record<string, number[]>;
  morphs?: { name: string; influence: number; attributes: Record<string, number[]> }[];
}
/** Keep vertex order for subset edits: skeletons and morph targets remain byte-for-byte intact. */
export function capturePart(mesh: Mesh, geometry = false): MeshPart {
  const part: MeshPart = { indices: Array.from(mesh.getIndices() ?? []), materials: mesh.subMeshes.map(s => ({ material: s.materialIndex, start: s.indexStart, count: s.indexCount })) };
  if (geometry) {
    part.attributes = Object.fromEntries(mesh.getVerticesDataKinds().map(k => [k, Array.from(mesh.getVerticesData(k)!)]));
    const manager = mesh.morphTargetManager;
    if (manager) part.morphs = Array.from({ length: manager.numTargets }, (_, i) => {
      const t = manager.getTarget(i), attributes: Record<string, number[]> = {};
      for (const [kind, values] of [['position', t.getPositions()], ['normal', t.getNormals()], ['tangent', t.getTangents()], ['uv', t.getUVs()], ['uv2', t.getUV2s()], ['color', t.getColors()]] as const) if (values) attributes[kind] = Array.from(values);
      return { name: t.name, influence: t.influence, attributes };
    });
  }
  return part;
}

export function applyPart(mesh: Mesh, part: MeshPart) {
  // Skinned meshes: bind-pose positions aren't where the mesh is drawn, so keep the file's (larger) bounds
  const kept = mesh.skeleton ? mesh.getBoundingInfo() : null;
  const keptMin = kept?.minimum.clone(), keptMax = kept?.maximum.clone();
  if (part.attributes) {
    const data = new VertexData(); for (const [k, a] of Object.entries(part.attributes)) data.set(Float32Array.from(a), k);
    data.indices = part.indices;
    new Geometry(`${mesh.name} separated`, mesh.getScene(), data).applyToMesh(mesh);
    if (part.morphs) {
      const manager = new MorphTargetManager(mesh.getScene());
      for (const state of part.morphs) {
        const t = new MorphTarget(state.name, state.influence, mesh.getScene());
        const a = state.attributes;
        if (a.position) t.setPositions(a.position); if (a.normal) t.setNormals(a.normal); if (a.tangent) t.setTangents(a.tangent);
        if (a.uv) t.setUVs(a.uv); if (a.uv2) t.setUV2s(a.uv2); if (a.color) t.setColors(a.color);
        manager.addTarget(t);
      }
      mesh.morphTargetManager = manager;
    }
  } else { mesh.makeGeometryUnique(); mesh.setIndices(part.indices); }
  mesh.releaseSubMeshes();
  for (const s of part.materials) if (s.count) new SubMesh(s.material, 0, mesh.getTotalVertices(), s.start, s.count, mesh);
  if (keptMin && keptMax) { mesh.setBoundingInfo(new BoundingInfo(keptMin, keptMax)); mesh.computeWorldMatrix(true); return; }
  // Full vertex streams deliberately survive subset edits; bounds must use only referenced vertices.
  const p = mesh.getVerticesData('position')!;
  const min = new Vector3(Infinity, Infinity, Infinity), max = min.negate();
  for (const i of part.indices) { const v = Vector3.FromArray(p, i * 3); min.minimizeInPlace(v); max.maximizeInPlace(v); }
  if (!part.indices.length) min.setAll(0), max.setAll(0);
  mesh.setBoundingInfo(new BoundingInfo(min, max)); mesh.computeWorldMatrix(true);
}

export function subset(part: MeshPart, faces: Set<number>, selected: boolean): MeshPart {
  const out: MeshPart = { ...part, indices: [], materials: [] };
  for (const s of part.materials) {
    const start = out.indices.length;
    for (let i = s.start; i < s.start + s.count; i += 3) if (faces.has(i / 3) === selected) out.indices.push(...part.indices.slice(i, i + 3));
    out.materials.push({ material: s.material, start, count: out.indices.length - start });
  }
  return out;
}

