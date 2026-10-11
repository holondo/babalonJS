import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { weld } from '../rigging/skinMath';
import type { Entity, Editor } from '../core/editor';

/** Faces are addressed in the current index buffer, never by a vertex position. */
export class FaceSelection {
  readonly faces = new Map<Mesh, Set<number>>();
  private history: Map<Mesh, Set<number>>[] = [];
  private overlays: Mesh[] = [];
  private material: StandardMaterial;
  private topology = new Map<Mesh, number[][]>();
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
    for (const mesh of entity.meshes) if (mesh instanceof Mesh && mesh.getIndices()) this.faces.set(mesh, new Set());
  }
  get count() { let n = 0; for (const faces of this.faces.values()) n += faces.size; return n; }
  checkpoint() { this.history.push(new Map([...this.faces].map(([m, s]) => [m, new Set(s)]))); if (this.history.length > 30) this.history.shift(); }
  undo() { const state = this.history.pop(); if (state) { for (const [m, s] of state) this.faces.set(m, s); this.refresh(); } }
  all(invert = false) {
    this.checkpoint();
    for (const [m, selected] of this.faces) { const next = new Set<number>(); for (let f = 0; f < m.getTotalIndices() / 3; f++) if (!invert || !selected.has(f)) next.add(f); this.faces.set(m, next); }
    this.refresh();
  }
  clear() { this.checkpoint(); for (const s of this.faces.values()) s.clear(); this.refresh(); }
  mesh(mesh: Mesh, add: boolean) { this.checkpoint(); const faces = this.faces.get(mesh); if (!faces) return; for (let f = 0; f < mesh.getTotalIndices() / 3; f++) if (add) faces.add(f); else faces.delete(f); this.refresh(); }
  apply(mesh: Mesh, ids: Iterable<number>, add = true) { const set = this.faces.get(mesh); if (!set) return; for (const f of ids) if (add) set.add(f); else set.delete(f); }
  neighbors(mesh: Mesh) {
    let neighbors = this.topology.get(mesh); if (neighbors) return neighbors;
    const indices = mesh.getIndices()!;
    const { map } = weld(Float32Array.from(mesh.getVerticesData('position')!));
    neighbors = Array.from({ length: indices.length / 3 }, () => [] as number[]);
    const edges = new Map<string, number[]>();
    for (let f = 0; f < neighbors.length; f++) for (let e = 0; e < 3; e++) {
      const a = map[indices[f * 3 + e]], b = map[indices[f * 3 + (e + 1) % 3]];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const others = edges.get(key) ?? [];
      for (const other of others) { neighbors[f].push(other); neighbors[other].push(f); }
      others.push(f); edges.set(key, others);
    }
    this.topology.set(mesh, neighbors); return neighbors;
  }
  island(mesh: Mesh, face: number, add = true) {
    this.checkpoint(); const neighbors = this.neighbors(mesh); if (!neighbors[face]) return;
    const seen = new Set([face]), queue = [face];
    for (let i = 0; i < queue.length; i++) for (const n of neighbors[queue[i]]) if (!seen.has(n)) { seen.add(n); queue.push(n); }
    this.apply(mesh, seen, add); this.refresh();
  }
  refresh() {
    this.overlays.forEach(m => { this.editor.overlays.delete(m); m.dispose(false, false); }); this.overlays = [];
    for (const [mesh, faces] of this.faces) {
      if (!faces.size) continue;
      const indices = mesh.getIndices()!, chosen: number[] = [];
      for (const f of faces) chosen.push(indices[f * 3], indices[f * 3 + 1], indices[f * 3 + 2]);
      const overlay = new Mesh('Face selection', this.editor.scene);
      mesh.geometry?.applyToMesh(overlay); overlay.makeGeometryUnique(); overlay.setIndices(chosen);
      overlay.parent = mesh; overlay.skeleton = mesh.skeleton; overlay.morphTargetManager = mesh.morphTargetManager;
      overlay.material = this.material; overlay.isPickable = false; overlay.alwaysSelectAsActiveMesh = true;
      this.editor.overlays.add(overlay); this.overlays.push(overlay);
    }
    this.editor.invalidate();
  }
  dispose() { for (const mesh of this.overlays) { this.editor.overlays.delete(mesh); mesh.dispose(false, false); } this.overlays = []; this.material.dispose(); this.topology.clear(); this.editor.invalidate(); }
}
