import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Observer } from '@babylonjs/core/Misc/observable.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { Editor } from '../core/editor';
import type { FaceSelection } from './selection';
import { Deform, recordDeform } from './deform';
import { editBlocker } from './combine';
import { tr } from '../core/i18n';

/**
 * Moves, turns or scales only the selected faces with the gizmo (soft selection fades the change
 * over connected surface distance). Each frame only touches the vertices that move.
 */
export class SelectionTransform {
  readonly handle: Mesh;
  softRadius = 0;
  private observer: Observer<Scene>;
  private sessions: { deform: Deform; vertices: Uint32Array; weights: Float32Array; world: Matrix; inverse: Matrix }[] | null = null;
  private center = Vector3.Zero();
  private signature = '';
  readonly editor: Editor;
  readonly selection: FaceSelection;
  constructor(editor: Editor, selection: FaceSelection) {
    this.editor = editor; this.selection = selection;
    const reason = editBlocker(selection.entity); if (reason) throw new Error(reason);
    this.handle = new Mesh('Selection transform', editor.scene);
    this.handle.isPickable = false; this.handle.rotationQuaternion = Quaternion.Identity();
    this.recenter();
    this.observer = editor.scene.onBeforeRenderObservable.add(() => {
      if (!this.sessions) return;
      const key = this.handle.position.asArray().join() + this.handle.scaling.asArray().join() + this.handle.rotationQuaternion!.asArray().join();
      if (key !== this.signature) { this.signature = key; this.update(); }
    });
  }
  recenter() {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    const v = new Vector3();
    for (const [mesh, faces] of this.selection.faces) {
      if (!faces.size) continue;
      const indices = mesh.getIndices()!, p = mesh.getVerticesData('position')!, world = mesh.computeWorldMatrix(true), m = faces.mask;
      for (let f = 0; f < m.length; f++) if (m[f]) for (let j = 0; j < 3; j++) {
        const i = indices[f * 3 + j] * 3;
        Vector3.TransformCoordinatesFromFloatsToRef(p[i], p[i + 1], p[i + 2], world, v);
        if (v.x < x0) x0 = v.x; if (v.y < y0) y0 = v.y; if (v.z < z0) z0 = v.z;
        if (v.x > x1) x1 = v.x; if (v.y > y1) y1 = v.y; if (v.z > z1) z1 = v.z;
      }
    }
    if (!Number.isFinite(x0)) throw new Error(tr('Select faces first.'));
    this.center.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.handle.position.copyFrom(this.center); this.handle.scaling.setAll(1); this.handle.rotationQuaternion!.copyFrom(Quaternion.Identity());
  }
  /** Start of a gizmo drag: which vertices move and by how much (soft selection). */
  begin() {
    if (this.sessions) return;
    this.sessions = [];
    for (const [mesh, faces] of this.selection.faces) {
      if (!faces.size) continue;
      const topology = this.selection.neighbors(mesh), deform = new Deform(mesh, topology);
      const { weld, vertexStart, vertexFaces } = topology, indices = mesh.getIndices()!, p = deform.base;
      let groups = 0;
      for (let i = 0; i < weld.length; i++) if (weld[i] + 1 > groups) groups = weld[i] + 1;
      // Distance along the surface (in world units) from the selection, per welded vertex
      const distance = new Float32Array(groups).fill(Infinity), queue: number[] = [];
      const m = faces.mask;
      for (let f = 0; f < m.length; f++) if (m[f]) for (let j = 0; j < 3; j++) { const w = weld[indices[f * 3 + j]]; if (distance[w] !== 0) { distance[w] = 0; queue.push(w); } }
      const world = mesh.computeWorldMatrix(true).clone();
      const scale = Math.cbrt(Math.abs(world.determinant())) || 1;
      if (this.softRadius > 0) {
        // Representative position of each welded vertex
        const rep = new Int32Array(groups).fill(-1);
        for (let i = 0; i < weld.length; i++) if (rep[weld[i]] < 0) rep[weld[i]] = i;
        // Dijkstra over the surface: each vertex is settled once (a plain queue re-visits a lot)
        const heap = new MinHeap(groups);
        for (const w of queue) heap.push(w, 0);
        const done = new Uint8Array(groups);
        while (heap.size) {
          const a = heap.pop(); if (done[a]) continue; done[a] = 1;
          const pa = rep[a] * 3, da = distance[a];
          for (let k = vertexStart[a]; k < vertexStart[a + 1]; k++) {
            const f = vertexFaces[k];
            for (let j = 0; j < 3; j++) {
              const b = weld[indices[f * 3 + j]];
              if (done[b]) continue;
              const pb = rep[b] * 3;
              const d = da + Math.hypot(p[pb] - p[pa], p[pb + 1] - p[pa + 1], p[pb + 2] - p[pa + 2]) * scale;
              if (d < this.softRadius && d < distance[b]) { distance[b] = d; heap.push(b, d); }
            }
          }
        }
      }
      // Moving vertices and their weights (smoothstep falloff)
      const vertices: number[] = [], weights: number[] = [];
      for (let i = 0; i < weld.length; i++) {
        const d = distance[weld[i]];
        if (d === Infinity) continue;
        const t = d === 0 ? 1 : this.softRadius ? Math.max(0, 1 - d / this.softRadius) : 0;
        if (t <= 0) continue;
        vertices.push(i); weights.push(t * t * (3 - 2 * t));
      }
      this.sessions.push({ deform, vertices: Uint32Array.from(vertices), weights: Float32Array.from(weights), world, inverse: world.clone().invert() });
    }
    // The meshes' buffers were replaced by updatable ones: the highlight follows them
    this.selection.refresh();
  }
  /** One frame of the drag: only the moving vertices, only the changed GPU range. */
  update() {
    if (!this.sessions) return;
    const transform = Matrix.Translation(-this.center.x, -this.center.y, -this.center.z).multiply(Matrix.Compose(this.handle.scaling, this.handle.rotationQuaternion!, this.handle.position));
    const v = new Vector3();
    for (const { deform, vertices, weights, world, inverse } of this.sessions) {
      const full = world.multiply(transform).multiply(inverse);
      const b = deform.base, p = deform.positions;
      for (let k = 0; k < vertices.length; k++) {
        const i = vertices[k], o = i * 3, w = weights[k];
        Vector3.TransformCoordinatesFromFloatsToRef(b[o], b[o + 1], b[o + 2], full, v);
        p[o] = b[o] + (v.x - b[o]) * w; p[o + 1] = b[o + 1] + (v.y - b[o + 1]) * w; p[o + 2] = b[o + 2] + (v.z - b[o + 2]) * w;
        deform.touch(i);
      }
      deform.updateNormals(vertices);
      deform.upload();
    }
    this.editor.invalidate();
  }
  end(cancel = false) {
    const sessions = this.sessions;
    if (!sessions) return;
    if (!cancel) this.update();
    this.sessions = null;
    const before = sessions.map((s) => ({ mesh: s.deform.mesh, state: s.deform.startState() }));
    if (cancel) {
      before.forEach(({ mesh, state }) => Deform.restore(mesh, state));
      this.selection.refresh(); this.editor.invalidate();
      return;
    }
    sessions.forEach((s) => s.deform.finish());
    const after = sessions.map((s) => ({ mesh: s.deform.mesh, state: s.deform.state() }));
    if (!after.some((a, i) => positionsDiffer(a.state.positions, before[i].state.positions))) { this.recenter(); return; }
    // Saved like any edited geometry; one undo step for the whole drag
    recordDeform(this.editor, this.selection.entity, after.map((a, i) => ({ mesh: a.mesh, before: before[i].state, after: a.state })), () => this.selection.refresh());
    this.recenter();
  }
  dispose() { this.end(true); this.editor.scene.onBeforeRenderObservable.remove(this.observer); this.handle.dispose(); }
}

function positionsDiffer(a: Float32Array, b: Float32Array) {
  if (a.length !== b.length) return true;
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return true;
  return false;
}

/** Binary min-heap of (item, key) on typed arrays (grows when needed). */
class MinHeap {
  private items: Uint32Array;
  private keys: Float32Array;
  size = 0;
  constructor(capacity: number) { this.items = new Uint32Array(Math.max(16, capacity)); this.keys = new Float32Array(this.items.length); }
  push(item: number, key: number) {
    if (this.size === this.items.length) {
      const items = new Uint32Array(this.size * 2), keys = new Float32Array(this.size * 2);
      items.set(this.items); keys.set(this.keys); this.items = items; this.keys = keys;
    }
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= key) break;
      this.items[i] = this.items[parent]; this.keys[i] = this.keys[parent]; i = parent;
    }
    this.items[i] = item; this.keys[i] = key;
  }
  pop() {
    const top = this.items[0], lastItem = this.items[--this.size], lastKey = this.keys[this.size];
    let i = 0;
    while (true) {
      let child = i * 2 + 1;
      if (child >= this.size) break;
      if (child + 1 < this.size && this.keys[child + 1] < this.keys[child]) child++;
      if (this.keys[child] >= lastKey) break;
      this.items[i] = this.items[child]; this.keys[i] = this.keys[child]; i = child;
    }
    this.items[i] = lastItem; this.keys[i] = lastKey;
    return top;
  }
}
