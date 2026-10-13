import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { Geometry } from '@babylonjs/core/Meshes/geometry.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { computeTopology } from './faceTopology';
import type { FaceTopology } from './faceTopology';
export type { FaceTopology } from './faceTopology';
import type { Entity, Editor } from '../core/editor';

/**
 * Selected faces of one mesh: a byte per face instead of a Set (a 2M-triangle model would need a
 * 2M-entry Set). Same interface as a Set of face numbers, so callers don't change.
 */
export class FaceSet implements Iterable<number> {
  mask: Uint8Array;
  size = 0;
  constructor(count: number) { this.mask = new Uint8Array(count); }
  has(f: number) { return this.mask[f] === 1; }
  add(f: number) { if (this.mask[f] !== 1 && f >= 0 && f < this.mask.length) { this.mask[f] = 1; this.size++; } return this; }
  delete(f: number) { if (this.mask[f] === 1) { this.mask[f] = 0; this.size--; return true; } return false; }
  clear() { this.mask.fill(0); this.size = 0; }
  fill() { this.mask.fill(1); this.size = this.mask.length; }
  clone() { const c = new FaceSet(this.mask.length); c.mask.set(this.mask); c.size = this.size; return c; }
  *[Symbol.iterator]() { const m = this.mask; for (let f = 0; f < m.length; f++) if (m[f]) yield f; }
  values() { return this[Symbol.iterator](); }
}

export function buildTopology(mesh: Mesh): FaceTopology {
  return computeTopology(Float32Array.from(mesh.getVerticesData('position')!), mesh.getIndices()!);
}

/** Faces are addressed in the current index buffer, never by a vertex position. */
export class FaceSelection {
  readonly faces = new Map<Mesh, FaceSet>();
  private history: Map<Mesh, FaceSet>[] = [];
  /** One highlight mesh per mesh, sharing its vertex buffers; only its indices change. */
  private overlays = new Map<Mesh, Mesh>();
  private material: StandardMaterial;
  private topology = new Map<Mesh, FaceTopology>();
  private readonly topologyWorkers = new Set<Worker>();
  private topologyTotal = 0;
  get topologyProgress() { return this.topologyWorkers.size ? 1 - this.topologyWorkers.size / this.topologyTotal : null; }
  cancelPrefetch() {
    for (const worker of this.topologyWorkers) worker.terminate();
    this.topologyWorkers.clear();
    this.editor.notify('activity');
  }
  readonly editor: Editor;
  readonly entity: Entity;
  constructor(editor: Editor, entity: Entity) {
    this.editor = editor; this.entity = entity;
    this.material = new StandardMaterial('Selected faces', editor.scene);
    // Lilac (the palette's selection color) stands out on most models, including gold ones
    this.material.emissiveColor = Color3.FromHexString('#a57abb');
    this.material.diffuseColor = this.material.emissiveColor;
    this.material.alpha = 0.7;
    this.material.disableLighting = true;
    this.material.backFaceCulling = false;
    this.material.zOffset = -2;
    this.reset();
  }
  /** Sizes the selection to the current geometry, keeping it where the face count didn't change. */
  reset() {
    for (const mesh of this.entity.meshes) {
      if (!(mesh instanceof Mesh) || !mesh.getIndices()) continue;
      const count = mesh.getTotalIndices() / 3, current = this.faces.get(mesh);
      if (current?.mask.length === count) continue;
      this.faces.set(mesh, new FaceSet(count));
    }
  }
  get count() { let n = 0; for (const faces of this.faces.values()) n += faces.size; return n; }
  /** World box of the selected faces as shown (pose applied), or null when none are selected. */
  bounds() {
    const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity), v = new Vector3();
    for (const [mesh, faces] of this.faces) {
      if (!faces.size) continue;
      const p = mesh.getPositionData(true, true) ?? mesh.getVerticesData('position')!, world = mesh.computeWorldMatrix(true), idx = mesh.getIndices()!, m = faces.mask;
      for (let f = 0; f < m.length; f++) if (m[f]) for (let j = 0; j < 3; j++) {
        const i = idx[f * 3 + j] * 3;
        Vector3.TransformCoordinatesFromFloatsToRef(p[i], p[i + 1], p[i + 2], world, v);
        min.minimizeInPlace(v); max.maximizeInPlace(v);
      }
    }
    return Number.isFinite(min.x) ? { min, max, center: min.add(max).scaleInPlace(0.5), size: max.subtract(min) } : null;
  }
  /** Vertices of the selected faces, per mesh (1 = selected). */
  vertexMasks() {
    const out = new Map<Mesh, Uint8Array>();
    for (const [mesh, faces] of this.faces) {
      if (!faces.size) continue;
      const idx = mesh.getIndices()!, mask = new Uint8Array(mesh.getTotalVertices()), m = faces.mask;
      for (let f = 0; f < m.length; f++) if (m[f]) { mask[idx[f * 3]] = 1; mask[idx[f * 3 + 1]] = 1; mask[idx[f * 3 + 2]] = 1; }
      out.set(mesh, mask);
    }
    return out;
  }
  checkpoint() { this.history.push(new Map([...this.faces].map(([m, s]) => [m, s.clone()]))); if (this.history.length > 20) this.history.shift(); }
  undo() { const state = this.history.pop(); if (state) { for (const [m, s] of state) this.faces.set(m, s); this.refresh(); } }
  all(invert = false) {
    this.checkpoint();
    for (const set of this.faces.values()) {
      if (!invert) { set.fill(); continue; }
      const m = set.mask; let n = 0;
      for (let f = 0; f < m.length; f++) { m[f] ^= 1; n += m[f]; }
      set.size = n;
    }
    this.refresh();
  }
  clear() { this.checkpoint(); for (const s of this.faces.values()) s.clear(); this.refresh(); }
  mesh(mesh: Mesh, add: boolean) { this.checkpoint(); const faces = this.faces.get(mesh); if (!faces) return; if (add) faces.fill(); else faces.clear(); this.refresh(); }
  apply(mesh: Mesh, ids: Iterable<number>, add = true) { const set = this.faces.get(mesh); if (!set) return; for (const f of ids) if (add) set.add(f); else set.delete(f); }
  /** After an edit changed the geometry: topology and face numbers are no longer valid. */
  invalidateTopology() { this.topology.clear(); this.reset(); }
  neighbors(mesh: Mesh) {
    let t = this.topology.get(mesh);
    if (!t) this.topology.set(mesh, (t = buildTopology(mesh)));
    return t;
  }
  /**
   * Builds the connectivity of every mesh in a worker right away (entering edit mode), so the
   * first tap doesn't wait for it; a tap before it's ready still computes it on the spot.
   */
  prefetch() {
    for (const mesh of this.faces.keys()) {
      if (this.topology.has(mesh) || mesh.getTotalIndices() < 30000) continue;
      const geometry = mesh.geometry;
      const worker = new Worker(new URL('./topology.worker.ts', import.meta.url), { type: 'module' });
      this.topologyWorkers.add(worker);
      this.topologyTotal++;
      const finish = () => {
        worker.terminate();
        this.topologyWorkers.delete(worker);
        this.editor.notify('activity');
      };
      const positions = Float32Array.from(mesh.getVerticesData('position')!), indices = Uint32Array.from(mesh.getIndices()!);
      worker.onmessage = (ev: MessageEvent<FaceTopology>) => {
        // Only if nothing changed meanwhile
        if (mesh.geometry === geometry && !this.topology.has(mesh) && this.faces.has(mesh)) this.topology.set(mesh, ev.data);
        finish();
      };
      worker.onerror = finish;
      try { worker.postMessage({ positions, indices }, [positions.buffer, indices.buffer]); }
      catch { finish(); }
    }
    if (this.topologyWorkers.size) this.editor.notify('activity');
  }
  island(mesh: Mesh, face: number, add = true) {
    const set = this.faces.get(mesh); if (!set) return;
    this.checkpoint();
    const { offsets, list } = this.neighbors(mesh);
    const seen = new Uint8Array(offsets.length - 1), queue = new Uint32Array(offsets.length - 1);
    let head = 0, tail = 0;
    seen[face] = 1; queue[tail++] = face;
    while (head < tail) {
      const f = queue[head++];
      for (let k = offsets[f]; k < offsets[f + 1]; k++) { const g = list[k]; if (!seen[g]) { seen[g] = 1; queue[tail++] = g; } }
    }
    for (let i = 0; i < tail; i++) if (add) set.add(queue[i]); else set.delete(queue[i]);
    this.refresh();
  }
  refresh() {
    for (const [mesh, faces] of this.faces) {
      let overlay = this.overlays.get(mesh);
      if (!faces.size) { overlay?.setEnabled(false); continue; }
      const indices = mesh.getIndices()!, chosen = new Uint32Array(faces.size * 3), m = faces.mask;
      for (let f = 0, k = 0; f < m.length; f++) if (m[f]) { chosen[k++] = indices[f * 3]; chosen[k++] = indices[f * 3 + 1]; chosen[k++] = indices[f * 3 + 2]; }
      // A new geometry or new position buffer (edits make them updatable) needs a new highlight
      if (!overlay || overlay.metadata?.source !== mesh.getVertexBuffer('position')) {
        if (overlay) this.disposeOverlay(overlay);
        overlay = this.createOverlay(mesh);
        this.overlays.set(mesh, overlay);
      }
      overlay.setIndices(chosen, mesh.getTotalVertices(), true);
      overlay.setEnabled(true);
    }
    this.editor.invalidate();
  }
  private createOverlay(mesh: Mesh) {
    const overlay = sharedMesh(mesh, 'Face selection');
    overlay.material = this.material;
    this.editor.overlays.add(overlay);
    return overlay;
  }
  private disposeOverlay(overlay: Mesh) {
    this.editor.overlays.delete(overlay);
    disposeShared(overlay);
  }
  dispose() { this.cancelPrefetch(); for (const o of this.overlays.values()) this.disposeOverlay(o); this.overlays.clear(); this.material.dispose(); this.topology.clear(); this.editor.invalidate(); }
}

/**
 * A mesh drawing some triangles of another one with the same GPU vertex buffers (no copy of a
 * large model): selection highlights, cut previews. Only its index list is its own.
 */
export function sharedMesh(mesh: Mesh, name: string) {
  const scene = mesh.getScene();
  const shared = new Mesh(name, scene);
  const geometry = new Geometry(`${name}-${mesh.uniqueId}`, scene, undefined, true, shared);
  for (const kind of ['position', 'normal', 'matricesIndices', 'matricesWeights', 'matricesIndicesExtra', 'matricesWeightsExtra']) {
    const buffer = mesh.getVertexBuffer(kind);
    if (buffer) geometry.setVerticesBuffer(buffer, mesh.getTotalVertices(), false);
  }
  shared.metadata = { source: mesh.getVertexBuffer('position'), shared: true };
  shared.parent = mesh; shared.skeleton = mesh.skeleton; shared.numBoneInfluencers = mesh.numBoneInfluencers;
  shared.isPickable = false; shared.alwaysSelectAsActiveMesh = true;
  return shared;
}

/** Disposes a shared mesh without disposing the vertex buffers it borrows. */
export function disposeShared(shared: Mesh) {
  const geometry = shared.geometry as unknown as { _vertexBuffers?: Record<string, unknown> } | null;
  if (geometry) geometry._vertexBuffers = {};
  shared.dispose(false, false);
}
