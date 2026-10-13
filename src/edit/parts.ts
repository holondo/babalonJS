import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { Geometry } from '@babylonjs/core/Meshes/geometry.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { SubMesh } from '@babylonjs/core/Meshes/subMesh.js';
import { BoundingInfo } from '@babylonjs/core/Culling/boundingInfo.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { MorphTarget } from '@babylonjs/core/Morph/morphTarget.js';
import { MorphTargetManager } from '@babylonjs/core/Morph/morphTargetManager.js';

/** A mesh's triangles (and, after an exact cut, its own vertex data): what a separated part stores. */
/** Vertex data: typed arrays when captured from a mesh (a memory copy), plain arrays while built. */
export type Values = number[] | Float32Array;
export interface MeshPart {
  indices: number[] | Uint32Array;
  materials: { material: number; start: number; count: number }[];
  attributes?: Record<string, Values>;
  morphs?: { name: string; influence: number; attributes: Record<string, Values> }[];
}

/** A part whose arrays can grow (closing openings, connecting borders add vertices and faces). */
export function growable(part: MeshPart) {
  const plain = (a: Values) => Array.from(a);
  return {
    ...part,
    indices: Array.from(part.indices),
    attributes: part.attributes && Object.fromEntries(Object.entries(part.attributes).map(([k, v]) => [k, plain(v)])),
    morphs: part.morphs?.map((m) => ({ ...m, attributes: Object.fromEntries(Object.entries(m.attributes).map(([k, v]) => [k, plain(v)])) })),
  } as MeshPart & { indices: number[]; attributes?: Record<string, number[]> };
}
/** Keep vertex order for subset edits: skeletons and morph targets remain byte-for-byte intact. */
export function capturePart(mesh: Mesh, geometry = false): MeshPart {
  // Typed copies: a memory copy, fast even for millions of vertices
  const part: MeshPart = { indices: Uint32Array.from(mesh.getIndices() ?? []), materials: mesh.subMeshes.map(s => ({ material: s.materialIndex, start: s.indexStart, count: s.indexCount })) };
  if (geometry) {
    part.attributes = Object.fromEntries(mesh.getVerticesDataKinds().flatMap(k => { const d = mesh.getVerticesData(k); return d ? [[k, Float32Array.from(d)]] : []; }));
    const manager = mesh.morphTargetManager;
    if (manager) part.morphs = Array.from({ length: manager.numTargets }, (_, i) => {
      const t = manager.getTarget(i), attributes: Record<string, Values> = {};
      for (const [kind, values] of [['position', t.getPositions()], ['normal', t.getNormals()], ['tangent', t.getTangents()], ['uv', t.getUVs()], ['uv2', t.getUV2s()], ['color', t.getColors()]] as const) if (values) attributes[kind] = Float32Array.from(values);
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
    const oldGeometry = mesh.geometry;
    const data = new VertexData(); for (const [k, a] of Object.entries(part.attributes)) data.set(a instanceof Float32Array ? a : Float32Array.from(a), k);
    data.indices = part.indices;
    new Geometry(`${mesh.name} separated`, mesh.getScene(), data).applyToMesh(mesh);
    if (oldGeometry && !oldGeometry.meshes.length) oldGeometry.dispose();
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

/** Anything that can say whether a face is chosen (a Set, or a FaceSet of a large mesh). */
export interface FaceLookup { has(face: number): boolean }

export function subset(part: MeshPart, faces: FaceLookup, selected: boolean): MeshPart {
  // Two passes into a typed array (no growing of a huge plain array)
  let kept = 0;
  for (const s of part.materials) for (let i = s.start; i < s.start + s.count; i += 3) if (faces.has(i / 3) === selected) kept++;
  const indices = new Uint32Array(kept * 3), materials: MeshPart['materials'] = [];
  let k = 0;
  for (const s of part.materials) {
    const start = k;
    for (let i = s.start; i < s.start + s.count; i += 3) if (faces.has(i / 3) === selected) { indices[k++] = part.indices[i]; indices[k++] = part.indices[i + 1]; indices[k++] = part.indices[i + 2]; }
    materials.push({ material: s.material, start, count: k - start });
  }
  return { ...part, indices, materials };
}


/**
 * A model's own edited geometry. `rigSpace`: captured while the model had a rig made in the app,
 * whose binding moves vertices into the skeleton's space, so it's re-applied after the rig.
 */
export interface SeparationState { meshes: MeshPart[]; pivot: number[]; rigSpace?: boolean }

/** Arrays are moved to a binary body (Float32 for vertex data, Uint32 for indices). */
export function encodeSeparation(state: SeparationState): Uint8Array {
  const chunks: ArrayBufferView[] = [];
  let offset = 0;
  const put = (values: ArrayLike<number>, type: 'f' | 'u') => {
    const array = type === 'f' ? Float32Array.from(values) : Uint32Array.from(values);
    chunks.push(array);
    const ref = { o: offset, n: values.length, t: type };
    offset += array.byteLength;
    return ref;
  };
  const attributes = (a?: Record<string, Values>) => a && Object.fromEntries(Object.entries(a).map(([k, v]) => [k, put(v, 'f')]));
  const header = {
    pivot: state.pivot,
    rigSpace: state.rigSpace || undefined,
    meshes: state.meshes.map((m) => ({
      indices: put(m.indices, 'u'),
      materials: m.materials,
      attributes: attributes(m.attributes),
      morphs: m.morphs?.map((t) => ({ name: t.name, influence: t.influence, attributes: attributes(t.attributes) })),
    })),
  };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(4 + json.length + offset);
  new DataView(out.buffer).setUint32(0, json.length, true);
  out.set(json, 4);
  let at = 4 + json.length;
  for (const c of chunks) {
    out.set(new Uint8Array(c.buffer, c.byteOffset, c.byteLength), at);
    at += c.byteLength;
  }
  return out;
}

export function decodeSeparation(data: Uint8Array): SeparationState {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const length = view.getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(data.subarray(4, 4 + length)));
  const body = data.slice(4 + length);
  type Ref = { o: number; n: number; t: 'f' | 'u' };
  const get = (r: Ref) => Array.from(r.t === 'f' ? new Float32Array(body.buffer, r.o, r.n) : new Uint32Array(body.buffer, r.o, r.n));
  const attributes = (a?: Record<string, Ref>) => a && Object.fromEntries(Object.entries(a).map(([k, r]) => [k, get(r)]));
  return {
    pivot: header.pivot,
    rigSpace: header.rigSpace,
    meshes: header.meshes.map((m: { indices: Ref; materials: MeshPart['materials']; attributes?: Record<string, Ref>; morphs?: { name: string; influence: number; attributes: Record<string, Ref> }[] }) => ({
      indices: get(m.indices),
      materials: m.materials,
      attributes: attributes(m.attributes),
      morphs: m.morphs?.map((t) => ({ name: t.name, influence: t.influence, attributes: attributes(t.attributes)! })),
    })),
  };
}

/**
 * A small part made of some faces of a large one (only the vertices they use), to run local
 * algorithms (closing an opening, capping a cut) without copying millions of vertices.
 */
export function compactFaces(part: MeshPart, faces: ArrayLike<number>) {
  const attrs = part.attributes!, count = attrs.position.length / 3;
  const localOf = new Int32Array(count).fill(-1), globalOf: number[] = [];
  const indices = new Uint32Array(faces.length * 3);
  for (let i = 0; i < faces.length; i++) for (let j = 0; j < 3; j++) {
    const v = part.indices[faces[i] * 3 + j];
    if (localOf[v] < 0) { localOf[v] = globalOf.length; globalOf.push(v); }
    indices[i * 3 + j] = localOf[v];
  }
  const attributes: Record<string, Float32Array> = {};
  for (const [kind, values] of Object.entries(attrs)) {
    const stride = values.length / count, out = new Float32Array(globalOf.length * stride);
    for (let i = 0; i < globalOf.length; i++) for (let c = 0; c < stride; c++) out[i * stride + c] = values[globalOf[i] * stride + c];
    attributes[kind] = out;
  }
  const local: MeshPart = { indices, materials: [{ material: 0, start: 0, count: indices.length }], attributes };
  return { local, globalOf: Uint32Array.from(globalOf) };
}

/**
 * Puts back what a local algorithm added to a compacted part (new vertices and new faces after the
 * original ones) into the large part, as one material run.
 */
export function mergeLocal(part: MeshPart, local: MeshPart, result: MeshPart, globalOf: Uint32Array, material: number): MeshPart {
  const attrs = part.attributes!, count = attrs.position.length / 3;
  const localCount = local.attributes!.position.length / 3, resultCount = result.attributes!.position.length / 3;
  const added = resultCount - localCount, start = local.indices.length;
  if (result.indices.length === start) return part;
  const attributes: Record<string, Float32Array> = {};
  for (const [kind, values] of Object.entries(attrs)) {
    const stride = values.length / count, out = new Float32Array((count + added) * stride);
    out.set(values);
    const extra = result.attributes![kind];
    if (extra) for (let i = 0; i < added * stride; i++) out[count * stride + i] = extra[localCount * stride + i];
    attributes[kind] = out;
  }
  const newFaces = result.indices.length - start;
  const indices = new Uint32Array(part.indices.length + newFaces);
  indices.set(part.indices);
  for (let i = 0; i < newFaces; i++) {
    const v = result.indices[start + i];
    indices[part.indices.length + i] = v < localCount ? globalOf[v] : count + (v - localCount);
  }
  return { ...part, indices, attributes, materials: [...part.materials, { material, start: part.indices.length, count: newFaces }] };
}
