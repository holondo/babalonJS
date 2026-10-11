import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Entity, Editor } from '../core/editor';
import { tr } from '../core/i18n';
import { FaceSelection } from './selection';
import { applyPart, capturePart, subset } from './parts';
import type { MeshPart } from './parts';
export type { MeshPart } from './parts';
import { selectScreen } from './lasso';
import type { ScreenPoint } from './lasso';
import { selectionRing, smartSelect } from './smartSelect';
import { PlaneCut } from './planeCut';

export interface SeparationState { meshes: MeshPart[]; pivot: number[] }
export type SelectTool = 'piece' | 'smart' | 'lasso' | 'brush';

export class Separator {
  selection: FaceSelection | null = null;
  readonly editor: Editor;
  constructor(editor: Editor) { this.editor = editor; }
  blocker(entity: Entity) {
    if (!entity.source || entity.kind !== 'model' || entity.meshes.some(m => !(m instanceof Mesh) || !m.getVerticesData('position') || m.getClassName().includes('Splat'))) return tr('Choose a triangle model to separate.');
    if (entity.rig || entity.optimization) return tr('Revert rigging and optimization before separating this model.');
    return null;
  }
  start(entity: Entity) { const reason = this.blocker(entity); if (reason) throw new Error(reason); this.stop(); this.editor.anim.pause(entity); this.selection = new FaceSelection(this.editor, entity); this.editor.refreshTool(); return this.selection; }
  stop() { this.selection?.dispose(); this.selection = null; this.editor.refreshTool(); }
  copy(from: Entity, to: Entity) { if (from.separation) this.restore(to, structuredClone(from.separation!)); }
  restore(entity: Entity, state: SeparationState) {
    if (state.meshes.length !== entity.meshes.length) throw new Error(tr('The separated model does not match its source.'));
    state.meshes.forEach((part, i) => applyPart(entity.meshes[i] as Mesh, part));
    entity.root.setPivotPoint(Vector3.FromArray(state.pivot)); entity.separation = state;
    this.editor.invalidate();
  }
  /** One binary file per separated entity: a JSON header followed by the arrays (deflated in the project ZIP). */
  private readonly encoded = new WeakMap<SeparationState, Uint8Array>();
  serialize(entity: Entity): Uint8Array | null {
    const state = entity.separation;
    if (!state) return null;
    // A separation never changes once made (undo/redo swap whole states): encode it once
    let data = this.encoded.get(state);
    if (!data) this.encoded.set(state, (data = encodeSeparation(state)));
    return data;
  }
  restoreData(entity: Entity, data: Uint8Array) {
    this.restore(entity, decodeSeparation(data));
  }

  // ---------- Separate mode (one model at a time) ----------

  tool: SelectTool = 'piece';
  add = true;
  /** Smart selection: 0 strict … 1 loose. */
  tolerance = 0.3;
  /** Brush radius in CSS pixels. */
  radius = 28;
  /** Lasso and brush also take faces hidden behind others. */
  through = false;
  cut: PlaneCut | null = null;

  get active() { return !!this.selection; }

  setTool(tool: SelectTool) { this.tool = tool; this.editor.notify('tool'); }
  set(partial: Partial<Pick<Separator, 'add' | 'tolerance' | 'radius' | 'through'>>) { Object.assign(this, partial); this.editor.notify('tool'); }

  /** Tap on the model: the connected piece or the smart region under the pointer. */
  tap(x: number, y: number) {
    const selection = this.selection;
    if (!selection || this.cut) return;
    const hit = this.editor.pickSurface(x, y);
    if (!hit || hit.entity !== selection.entity || !(hit.mesh instanceof Mesh) || hit.faceId < 0) return;
    if (this.tool === 'smart') smartSelect(selection, hit.mesh, hit.faceId, this.tolerance, this.add);
    else selection.island(hit.mesh, hit.faceId, this.add);
    this.editor.notify('tool');
  }

  /** Lasso (closed shape) or brush (stroke) in CSS pixels over the canvas. */
  stroke(points: ScreenPoint[]) {
    const selection = this.selection;
    if (!selection || points.length < (this.tool === 'lasso' ? 3 : 1)) return;
    selection.checkpoint();
    selectScreen(selection, points, this.tool === 'brush' ? this.radius : null, this.through, this.add);
    this.editor.notify('tool');
  }

  edit(fn: (selection: FaceSelection) => void) {
    if (!this.selection) return;
    fn(this.selection);
    this.editor.notify('tool');
  }
  ring(grow: boolean) { this.edit((s) => selectionRing(s, grow)); }

  setCut(on: boolean) {
    if (!this.selection || on === !!this.cut) return;
    if (on) this.cut = new PlaneCut(this.editor, this.selection);
    else { this.cut!.dispose(); this.cut = null; }
    this.editor.notify('tool');
  }

  /** Makes the selection (or the plane's front side) a new object. */
  separate() {
    const parts = this.cut?.calculate();
    this.cut?.dispose();
    this.cut = null;
    const copy = this.split(parts);
    this.editor.notify('tool');
    return copy;
  }

  cancel() {
    this.cut?.dispose();
    this.cut = null;
    this.stop();
    this.editor.notify('tool');
  }

  split(parts?: [MeshPart[], MeshPart[]]) {
    const selection = this.selection; if (!selection) return null;
    const source = selection.entity;
    const reason = this.blocker(source); if (reason) throw new Error(reason);
    const before = source.meshes.map(m => capturePart(m as Mesh, true));
    const persistent = source.separation;
    const current = source.meshes.map(m => capturePart(m as Mesh, !!persistent?.meshes.some(p => p.attributes)));
    const selected = parts?.[0] ?? current.map((p, i) => subset(p, selection.faces.get(source.meshes[i] as Mesh) ?? new Set(), true));
    const remaining = parts?.[1] ?? current.map((p, i) => subset(p, selection.faces.get(source.meshes[i] as Mesh) ?? new Set(), false));
    if (!selected.some(p => p.indices.length) || !remaining.some(p => p.indices.length)) throw new Error(tr('Select part of the model, leaving some faces unselected.'));
    const copy = this.editor.createModelCopy(source);
    const oldPivot = source.root.getPivotPoint().asArray();
    const apply = (entity: Entity, meshes: MeshPart[]) => {
      meshes.forEach((p, i) => applyPart(entity.meshes[i] as Mesh, p));
      entity.root.computeWorldMatrix(true);
      const inv = entity.root.getWorldMatrix().clone().invert();
      const min = new Vector3(Infinity, Infinity, Infinity), max = min.negate();
      // Pivot at the bottom center of what is drawn (pose applied), from the triangles kept
      for (const m of entity.meshes as Mesh[]) {
        const indices = m.getIndices();
        if (!indices?.length) continue;
        const p = m.getPositionData(true, true) ?? m.getVerticesData('position')!;
        const toRoot = m.computeWorldMatrix(true).multiply(inv);
        const v = new Vector3();
        for (let k = 0; k < indices.length; k += Math.max(1, Math.floor(indices.length / 20000))) {
          Vector3.TransformCoordinatesFromFloatsToRef(p[indices[k] * 3], p[indices[k] * 3 + 1], p[indices[k] * 3 + 2], toRoot, v);
          min.minimizeInPlace(v); max.maximizeInPlace(v);
        }
      }
      const pivot = [(min.x + max.x) / 2, min.y, (min.z + max.z) / 2];
      entity.root.setPivotPoint(Vector3.FromArray(pivot)); entity.separation = { meshes, pivot };
    };
    this.stop();
    this.editor.group(() => {
      apply(source, remaining); apply(copy, selected);
      this.editor.record({ undo: () => { before.forEach((p, i) => applyPart(source.meshes[i] as Mesh, p)); source.root.setPivotPoint(Vector3.FromArray(oldPivot)); source.separation = persistent; this.editor.notify('entities'); }, redo: () => { apply(source, remaining); this.editor.notify('entities'); } });
      this.editor.publishSeparated(copy);
    });
    this.editor.refreshShadowCasters();
    this.editor.select(copy); this.editor.notify('entities'); return copy;
  }
}

/** Arrays are moved to a binary body (Float32 for vertex data, Uint32 for indices). */
export function encodeSeparation(state: SeparationState): Uint8Array {
  const chunks: ArrayBufferView[] = [];
  let offset = 0;
  const put = (values: number[], type: 'f' | 'u') => {
    const array = type === 'f' ? Float32Array.from(values) : Uint32Array.from(values);
    chunks.push(array);
    const ref = { o: offset, n: values.length, t: type };
    offset += array.byteLength;
    return ref;
  };
  const attributes = (a?: Record<string, number[]>) => a && Object.fromEntries(Object.entries(a).map(([k, v]) => [k, put(v, 'f')]));
  const header = {
    pivot: state.pivot,
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
    meshes: header.meshes.map((m: { indices: Ref; materials: MeshPart['materials']; attributes?: Record<string, Ref>; morphs?: { name: string; influence: number; attributes: Record<string, Ref> }[] }) => ({
      indices: get(m.indices),
      materials: m.materials,
      attributes: attributes(m.attributes),
      morphs: m.morphs?.map((t) => ({ name: t.name, influence: t.influence, attributes: attributes(t.attributes)! })),
    })),
  };
}
