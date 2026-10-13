import { SculptStroke, SculptContext, applyStrokeState } from './sculpt';
import { forgetFaceData } from './smartSelect';
import type { SurfaceBrush } from './sculpt';
import { bridgePart, connectBorders } from './connect';
import { fillHoles } from './holes';
import { editBlocker } from './combine';
import { SelectionTransform } from './transformSelection';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Entity, Editor } from '../core/editor';
import { tr } from '../core/i18n';
import { FaceSelection } from './selection';
import { openEdges } from './faceTopology';
import { applyPart, capturePart, compactFaces, mergeLocal, subset, encodeSeparation, decodeSeparation } from './parts';
import type { MeshPart } from './parts';
export type { MeshPart } from './parts';
import { selectScreen } from './lasso';
import type { ScreenPoint } from './lasso';
import { selectionRing, smartSelect } from './smartSelect';
import type { PlaneCut } from './planeCut';

export type { SeparationState } from './parts';
import type { SeparationState } from './parts';
export { encodeSeparation, decodeSeparation } from './parts';
export type SelectTool = 'piece' | 'smart' | 'lasso' | 'brush';

export class Separator {
  selection: FaceSelection | null = null;
  readonly editor: Editor;
  constructor(editor: Editor) { this.editor = editor; }
  blocker(entity: Entity) {
    if (!entity.source || entity.kind !== 'model' || entity.meshes.some(m => !(m instanceof Mesh) || !m.getVerticesData('position') || m.getClassName().includes('Splat'))) return tr('Choose a triangle model to separate.');
    if (entity.optimization) return tr('Revert optimization before editing geometry.');
    return null;
  }
  start(entity: Entity) { const reason = this.blocker(entity); if (reason) throw new Error(reason); this.stop(); this.editor.anim.pause(entity); this.editor.pose.stop(); this.editor.rigger.toRest(entity); this.selection = new FaceSelection(this.editor, entity); this.selection.prefetch(); this.editor.refreshTool(); return this.selection; }
  /**
   * The faces selected when Mesh mode last ended (per mesh, by vertex): operations between
   * objects, like Shrinkwrap, can be limited to them (Blender's vertex group).
   */
  lastFaces: { entity: Entity; masks: Map<Mesh, Uint8Array> } | null = null;
  stop() { this.cutGeneration++; this.cutLoading = false; if (this.selection?.count) this.lastFaces = { entity: this.selection.entity, masks: this.selection.vertexMasks() }; this.sculptContexts.clear(); this.clearBridge(); this.transform?.dispose(); this.transform = null; this.mode = 'select'; this.selection?.dispose(); this.selection = null; this.editor.refreshTool(); }
  copy(from: Entity, to: Entity) { if (from.separation) this.restore(to, structuredClone(from.separation!)); }
  restore(entity: Entity, state: SeparationState) {
    if (state.meshes.length !== entity.meshes.length) throw new Error(tr('The separated model does not match its source.'));
    state.meshes.forEach((part, i) => applyPart(entity.meshes[i] as Mesh, part));
    // The saved root position already sits at the part's origin: only the inner node moves back
    const fit = fitNode(entity);
    if (fit) fit.position.subtractInPlace(Vector3.FromArray(state.pivot).subtract(Vector3.FromArray(entity.separation?.pivot ?? [0, 0, 0])));
    entity.separation = state;
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

  surfaceBrush: SurfaceBrush | null = null;
  brushStrength = .3;
  brushSelected = false;
  bridgePreview: Mesh | null = null;
  bridgeReverse = false;
  bridgeOffset = 0;
  clearBridge() { if (this.bridgePreview) { this.editor.overlays.delete(this.bridgePreview); this.bridgePreview.dispose(); this.bridgePreview = null; } }
  previewBridge() {
    this.clearBridge();
    const bridge = bridgePart(this.selection!, this.bridgeReverse, this.bridgeOffset);
    const mesh = new Mesh('Connection preview', this.editor.scene);
    mesh.overrideMaterialSideOrientation = bridge.mesh.overrideMaterialSideOrientation;
    applyPart(mesh, bridge.part); mesh.material = bridge.mesh.material; mesh.parent = this.selection!.entity.root; mesh.isPickable = false;
    this.bridgePreview = mesh; this.editor.overlays.add(mesh); this.editor.invalidate();
  }
  connect() {
    const selection = this.selection!;
    this.clearBridge();
    const result = connectBorders(this.editor, selection, this.bridgeReverse, this.bridgeOffset);
    this.stop(); this.start(result); this.mode = 'surface'; return result;
  }

  mode: 'select' | 'transform' | 'surface' = 'select';
  transform: SelectionTransform | null = null;
  setMode(mode: typeof this.mode) {
    if (mode !== 'select') { const reason = editBlocker(this.selection!.entity); if (reason) throw new Error(reason); }
    if (mode === 'transform' && !this.selection!.count) throw new Error(tr('Select faces first.'));
    this.clearBridge();
    this.transform?.dispose(); this.transform = null;
    if (mode === 'transform') { this.transform = new SelectionTransform(this.editor, this.selection!); this.transform.softRadius = this.softRadius; }
    this.mode = mode; this.editor.refreshTool(); this.editor.notify('tool');
    // Prepare the brushes right away (after this frame), so the first stroke starts instantly
    if (mode === 'surface') setTimeout(() => {
      const selection = this.selection;
      if (!selection || this.mode !== 'surface') return;
      for (const mesh of selection.faces.keys()) if (!this.sculptContexts.has(mesh)) this.sculptContexts.set(mesh, new SculptContext(mesh, selection));
      selection.refresh();
    }, 50);
  }

  /** Soft selection for Move / Rotate / Scale of faces (world units along the surface). */
  softRadius = 0;
  setSoftRadius(radius: number) { this.softRadius = radius; if (this.transform) this.transform.softRadius = radius; }

  tool: SelectTool = 'piece';
  add = true;
  /** Smart selection: 0 strict … 1 loose. */
  tolerance = 0.3;
  /** Brush radius in CSS pixels. */
  radius = 28;
  /** Lasso and brush also take faces hidden behind others. */
  through = false;
  cut: PlaneCut | null = null;
  cutLoading = false;
  private cutGeneration = 0;

  get active() { return !!this.selection; }

  setTool(tool: SelectTool) { this.tool = tool; this.editor.notify('tool'); }
  set(partial: Partial<Pick<Separator, 'add' | 'tolerance' | 'radius' | 'through'>>) { Object.assign(this, partial); this.editor.notify('tool'); }

  /**
   * Tap on the model: the connected piece or the smart region under the pointer. `add` (Shift)
   * or `remove` (Ctrl) override the Add/Remove setting; a plain tap on empty space clears the
   * selection. Also works while transforming faces (the handle moves to the new selection).
   */
  tap(x: number, y: number, modifier: 'add' | 'remove' | null = null) {
    const selection = this.selection;
    if (!selection || this.cut || this.mode === 'surface') return;
    const hit = this.editor.pickSurface(x, y);
    const add = modifier ? modifier === 'add' : this.add;
    if (!hit || hit.entity !== selection.entity || !(hit.mesh instanceof Mesh) || hit.faceId < 0) {
      if (modifier || !selection.count) return;
      selection.clear();
    } else if (this.tool === 'smart') smartSelect(selection, hit.mesh, hit.faceId, this.tolerance, add);
    else selection.island(hit.mesh, hit.faceId, add);
    if (this.transform) {
      if (selection.count) this.transform.recenter();
      else this.setMode('select');
    }
    this.editor.refreshTool();
    this.editor.notify('tool');
  }

  /** Lasso (closed shape) or brush (stroke) in CSS pixels over the canvas. */
  stroke(points: ScreenPoint[]) {
    const selection = this.selection;
    if (selection && this.mode === 'surface' && this.surfaceBrush) {
      // A whole stroke at once (scripts, or a pointer path that already ended)
      if (!points.length || !this.brushDown(points[0].x, points[0].y)) return;
      for (const q of points.slice(1)) this.brushMove(q.x, q.y);
      this.brushUp();
      return;
    }
    if (!selection || points.length < (this.tool === 'lasso' ? 3 : 1)) return;
    selection.checkpoint();
    selectScreen(selection, points, this.tool === 'brush' ? this.radius : null, this.through, this.add);
    this.editor.notify('tool');
  }

  // ---------- Surface brushes, live while dragging ----------

  private sculpting: SculptStroke | null = null;
  /** Per-mesh brush setup for this session (dropped when the geometry changes or the mode ends). */
  private sculptContexts = new Map<Mesh, SculptContext>();

  /** Finger/button down with a surface brush: true when the model was under it. */
  brushDown(x: number, y: number) {
    const selection = this.selection;
    if (!selection || this.mode !== 'surface' || !this.surfaceBrush) return false;
    this.sculpting = SculptStroke.begin(this.editor, selection, this.sculptContexts, x, y, this.surfaceBrush, this.radius, this.brushStrength, this.brushSelected);
    return !!this.sculpting;
  }

  brushMove(x: number, y: number) { this.sculpting?.move(x, y); }

  /** End of a stroke: one undo step, and the edited geometry is saved with the project. */
  brushUp() {
    const stroke = this.sculpting;
    this.sculpting = null;
    const result = stroke?.end();
    if (!result) return;
    const entity = this.selection!.entity, previous = entity.separation;
    const next = { meshes: entity.meshes.map((m) => capturePart(m as Mesh, true)), pivot: previous?.pivot ?? [0, 0, 0], rigSpace: !!entity.rig };
    entity.separation = next;
    forgetFaceData([result.mesh]);
    const put = (state: typeof result.before, separation: typeof previous) => {
      this.sculptContexts.clear();
      applyStrokeState(result.mesh, state);
      entity.separation = separation;
      forgetFaceData([result.mesh]);
      this.selection?.refresh(); this.editor.notify('transform');
    };
    this.editor.record({ undo: () => put(result.before, previous), redo: () => put(result.after, next) });
    this.editor.notify('transform');
  }

  edit(fn: (selection: FaceSelection) => void) {
    if (!this.selection) return;
    fn(this.selection);
    this.editor.notify('tool');
  }
  ring(grow: boolean) { this.edit((s) => selectionRing(s, grow)); }

  /** Publish a full geometry edit using the existing separation persistence format. */
  applyGeometry(parts: MeshPart[]) {
    const selection = this.selection!;
    const entity = selection.entity;
    const reason = editBlocker(entity); if (reason) throw new Error(reason);
    const before = entity.meshes.map(m => capturePart(m as Mesh, true)), previous = entity.separation;
    const next = { meshes: parts, pivot: previous?.pivot ?? [0, 0, 0], rigSpace: !!entity.rig };
    const apply = (state: typeof previous, meshes: MeshPart[]) => {
      meshes.forEach((p, i) => applyPart(entity.meshes[i] as Mesh, p)); entity.separation = state;
      selection.invalidateTopology(); selection.refresh(); this.editor.refreshShadowCasters(); this.editor.notify('transform');
    };
    apply(next, parts);
    this.editor.record({ undo: () => apply(previous, before), redo: () => apply(next, parts) });
  }

  repairMaterial = 0;
  /** Closes the openings next to the selected faces; returns how many were closed and skipped. */
  fillHoles(material = this.repairMaterial) {
    const sel = this.selection!;
    if (!sel.count) throw new Error(tr('Select faces first.'));
    const report = { closed: 0, skipped: 0 };
    let firstError: unknown = null;
    const parts = sel.entity.meshes.map(m => {
      const mesh = m as Mesh, part = capturePart(mesh, true), faces = sel.faces.get(mesh)!;
      if (!faces.size) return part;
      // Work on the faces along open edges only (a small local part), then put the caps back
      const topology = sel.neighbors(mesh), { faces: border, open } = openEdges(topology, part.indices);
      if (!border.length) return part;
      const { local, globalOf } = compactFaces(part, border);
      const chosen = { has: (f: number) => faces.has(border[f]) };
      // A skeleton from the file stores vertices in its bind pose: shape the cap on what's shown
      let shown: Float32Array | undefined;
      if (mesh.skeleton && !sel.entity.rig) {
        const all = mesh.getPositionData(true, true);
        if (all) { shown = new Float32Array(globalOf.length * 3); for (let i = 0; i < globalOf.length; i++) for (let c = 0; c < 3; c++) shown[i * 3 + c] = all[globalOf[i] * 3 + c]; }
      }
      try {
        const cap = Math.min(material, Math.max(0, ...part.materials.map(s => s.material)));
        const welded = Uint32Array.from(globalOf, (v) => topology.weld[v]);
        const result = fillHoles(local, chosen, 0, undefined, shown, report, (f, j) => open(border[f], j), welded);
        return mergeLocal(part, local, result, globalOf, cap);
      } catch (error) {
        firstError ??= error;
        return part;
      }
    });
    if (!report.closed) throw firstError ?? new Error(tr('Select faces next to an open border.'));
    this.applyGeometry(parts);
    return report;
  }

  async setCut(on: boolean) {
    const selection = this.selection;
    if (!selection || (on === !!this.cut && !this.cutLoading)) return;
    const generation = ++this.cutGeneration;
    if (!on) {
      this.cutLoading = false;
      this.cut?.dispose(); this.cut = null;
      this.editor.notify('tool');
      return;
    }
    this.cutLoading = true;
    this.editor.notify('activity');
    try {
      const { PlaneCut } = await import('./planeCut');
      if (generation !== this.cutGeneration || this.selection !== selection) return;
      this.cut = new PlaneCut(this.editor, selection);
      this.editor.notify('tool');
    } finally {
      if (generation === this.cutGeneration) { this.cutLoading = false; this.editor.notify('activity'); }
    }
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
    const oldRoot = source.root.position.clone();
    const oldFit = fitNode(source)?.position.clone();
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
      // Origin at the bottom center of the part: the root moves there and its content moves back,
      // so nothing changes on screen but moving, rotating and scaling now work around the part
      // (a Babylon pivot point instead made the gizmos shift the object while scaling)
      const delta = new Vector3((min.x + max.x) / 2, min.y, (min.z + max.z) / 2);
      const fit = fitNode(entity);
      if (fit) {
        entity.root.position.addInPlace(Vector3.TransformNormal(delta, entity.root.getWorldMatrix()));
        fit.position.subtractInPlace(delta);
        entity.root.computeWorldMatrix(true);
      }
      const total = Vector3.FromArray(entity.separation?.pivot ?? [0, 0, 0]).add(fit ? delta : Vector3.Zero());
      entity.separation = { meshes, pivot: total.asArray(), rigSpace: !!entity.rig };
    };
    this.stop();
    this.editor.group(() => {
      apply(source, remaining);
      // A part of a model rigged in the app keeps the skeleton (its weights come with its geometry)
      if (source.rig) this.editor.rigger.copySkeleton(source, copy);
      apply(copy, selected);
      const afterRoot = source.root.position.clone(), afterFit = fitNode(source)?.position.clone(), after = source.separation;
      const place = (root: Vector3, fit?: Vector3) => { source.root.position.copyFrom(root); if (fit) fitNode(source)?.position.copyFrom(fit); };
      this.editor.record({
        undo: () => { before.forEach((p, i) => applyPart(source.meshes[i] as Mesh, p)); place(oldRoot, oldFit); source.separation = persistent; this.editor.notify('entities'); },
        redo: () => { after!.meshes.forEach((p, i) => applyPart(source.meshes[i] as Mesh, p)); place(afterRoot, afterFit); source.separation = after; this.editor.notify('entities'); },
      });
      this.editor.publishSeparated(copy);
    });
    this.editor.refreshShadowCasters();
    this.editor.select(copy); this.editor.notify('entities'); return copy;
  }
}

/** The node between a model's root and its content (see Editor.instantiate). */
function fitNode(entity: Entity) {
  return entity.root.getChildren((n) => n.name === 'fit', true)[0] as TransformNode | undefined;
}

