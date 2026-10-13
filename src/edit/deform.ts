import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { FaceTopology } from './faceTopology';

/** Positions and normals of a mesh at one moment (for undo of a deformation). */
export interface DeformState { positions: Float32Array; normals: Float32Array | null }

/**
 * Moves vertices of one mesh in place, cheaply enough for every frame of a drag on millions of
 * vertices: positions and normals are edited in the mesh's own (updatable) arrays, only the
 * normals around moved vertices are recomputed, and only the changed range is sent to the GPU.
 * Hard edges keep their split normals; UV seams stay smooth (normals shared by position).
 */
export class Deform {
  readonly mesh: Mesh;
  readonly topology: FaceTopology;
  /** Current positions (the mesh's own array). */
  readonly positions: Float32Array;
  /** Positions when the deformation started. */
  readonly base: Float32Array;
  readonly normals: Float32Array | null;
  private readonly baseNormals: Float32Array | null;
  private readonly indices: ArrayLike<number>;
  /** Vertices whose normal is split from the others at the same position (a hard edge). */
  private hard: Uint8Array | null = null;
  /** Triangle order of the mesh (+1 / -1), so recomputed normals face the same way. */
  private winding = 1;
  private low = Infinity;
  private high = -1;

  constructor(mesh: Mesh, topology: FaceTopology) {
    this.mesh = mesh;
    this.topology = topology;
    this.indices = mesh.getIndices()!;
    // Updatable copies the GPU buffers can be refreshed from in place
    this.positions = Float32Array.from(mesh.getVerticesData('position')!);
    this.base = this.positions.slice();
    const normals = mesh.getVerticesData('normal');
    this.normals = normals ? Float32Array.from(normals) : null;
    this.baseNormals = this.normals?.slice() ?? null;
    mesh.setVerticesData('position', this.positions, true);
    if (this.normals) mesh.setVerticesData('normal', this.normals, true);
    this.winding = this.findWinding();
  }

  /** Starts a new edit from the current shape (reused across brush strokes). */
  rebase() {
    this.base.set(this.positions);
    if (this.normals && this.baseNormals) this.baseNormals.set(this.normals);
  }

  /** Marks a vertex as moved (for the GPU upload range). */
  touch(v: number) { if (v < this.low) this.low = v; if (v > this.high) this.high = v; }

  /** Recomputes normals around the given vertices (and their neighbors) from the current positions. */
  updateNormals(vertices: ArrayLike<number>) {
    const n = this.normals;
    if (!n) return;
    const { weld, vertexStart, vertexFaces } = this.topology;
    const idx = this.indices, p = this.positions;
    this.hard ??= this.findHardEdges();
    // Faces around the moved vertices, then every vertex of those faces
    const faceSeen = new Uint8Array(idx.length / 3), faces: number[] = [];
    for (let i = 0; i < vertices.length; i++) {
      const w = weld[vertices[i]];
      for (let k = vertexStart[w]; k < vertexStart[w + 1]; k++) { const f = vertexFaces[k]; if (!faceSeen[f]) { faceSeen[f] = 1; faces.push(f); } }
    }
    const vertexSeen = new Set<number>();
    for (const f of faces) for (let j = 0; j < 3; j++) vertexSeen.add(idx[f * 3 + j]);
    for (const v of vertexSeen) {
      let x = 0, y = 0, z = 0;
      const w = weld[v], own = this.hard[v] === 1;
      for (let k = vertexStart[w]; k < vertexStart[w + 1]; k++) {
        const f = vertexFaces[k];
        const a = idx[f * 3], b = idx[f * 3 + 1], c = idx[f * 3 + 2];
        // A hard-edge vertex only takes the faces it is part of itself
        if (own && a !== v && b !== v && c !== v) continue;
        const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
        const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
        x += vy * uz - vz * uy; y += vz * ux - vx * uz; z += vx * uy - vy * ux;
      }
      const l = Math.hypot(x, y, z);
      if (l < 1e-20) continue;
      const s = this.winding / l;
      n[v * 3] = x * s; n[v * 3 + 1] = y * s; n[v * 3 + 2] = z * s;
      this.touch(v);
    }
  }

  /** Sends the changed range of positions and normals to the GPU. */
  upload() {
    if (this.high < 0) return;
    const from = this.low * 3, to = (this.high + 1) * 3;
    upload(this.mesh, 'position', this.positions, from, to);
    if (this.normals) upload(this.mesh, 'normal', this.normals, from, to);
    this.low = Infinity; this.high = -1;
  }

  /** Current state (copied), for undo/redo. */
  state(): DeformState { return { positions: this.positions.slice(), normals: this.normals?.slice() ?? null }; }
  startState(): DeformState { return { positions: this.base.slice(), normals: this.baseNormals?.slice() ?? null }; }

  /** Puts a saved state back (undo/redo). */
  static restore(mesh: Mesh, state: DeformState) {
    mesh.setVerticesData('position', state.positions.slice(), true);
    if (state.normals) mesh.setVerticesData('normal', state.normals.slice(), true);
    if (!mesh.skeleton) mesh.refreshBoundingInfo();
  }

  finish() {
    this.upload();
    if (!this.mesh.skeleton) this.mesh.refreshBoundingInfo();
  }

  private findWinding() {
    const p = this.positions, n = this.normals, idx = this.indices;
    if (!n) return 1;
    for (let f = 0; f < idx.length; f += 3) {
      const a = idx[f] * 3, b = idx[f + 1] * 3, c = idx[f + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      const dot = (vy * uz - vz * uy) * (n[a] + n[b] + n[c]) + (vz * ux - vx * uz) * (n[a + 1] + n[b + 1] + n[c + 1]) + (vx * uy - vy * ux) * (n[a + 2] + n[b + 2] + n[c + 2]);
      if (Math.abs(dot) > 1e-12) return dot > 0 ? 1 : -1;
    }
    return 1;
  }

  /** Vertices whose stored normal differs from the average at their position. */
  private findHardEdges() {
    const n = this.baseNormals, { weld } = this.topology, count = weld.length;
    const hard = new Uint8Array(count);
    if (!n) return hard;
    let groups = 0;
    for (let v = 0; v < count; v++) if (weld[v] + 1 > groups) groups = weld[v] + 1;
    const sum = new Float32Array(groups * 3);
    for (let v = 0; v < count; v++) { const w = weld[v] * 3; sum[w] += n[v * 3]; sum[w + 1] += n[v * 3 + 1]; sum[w + 2] += n[v * 3 + 2]; }
    for (let v = 0; v < count; v++) {
      const w = weld[v] * 3, l = Math.hypot(sum[w], sum[w + 1], sum[w + 2]) || 1;
      if ((sum[w] * n[v * 3] + sum[w + 1] * n[v * 3 + 1] + sum[w + 2] * n[v * 3 + 2]) / l < 0.95) hard[v] = 1;
    }
    return hard;
  }
}

/**
 * Sends part of an array to the GPU. Babylon forgets its CPU copy after a partial update (it can't
 * know the rest is unchanged); here the CPU array is the full, current data, so it's kept, which
 * picking, bounds and saving read.
 */
function upload(mesh: Mesh, kind: string, data: Float32Array, from: number, to: number) {
  const buffer = mesh.getVertexBuffer(kind);
  if (!buffer) return;
  buffer.updateDirectly(data.subarray(from, to), from);
  (buffer.getWrapperBuffer() as unknown as { _data: Float32Array | null })._data = data;
}
