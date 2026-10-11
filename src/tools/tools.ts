import {
  Color3,
  CreateGreasedLine,
  GreasedLineMeshMaterialType,
  Matrix,
  Mesh,
  MeshBuilder,
  Observable,
  Plane,
  PointerEventTypes,
  StandardMaterial,
  TransformNode,
  Vector3,
  VertexBuffer,
} from '@babylonjs/core';
import type { AbstractMesh, GreasedLineBaseMesh, PointerInfo } from '@babylonjs/core';
import type { Editor, Entity } from '../core/editor';

export type Unit = 'm' | 'cm' | 'mm' | 'in' | 'ft';
export type Axis = 'x' | 'y' | 'z';
export type Edge = 'min' | 'center' | 'max';

export const UNITS: Record<Unit, { factor: number; decimals: number }> = {
  m: { factor: 1, decimals: 3 },
  cm: { factor: 100, decimals: 1 },
  mm: { factor: 1000, decimals: 0 },
  in: { factor: 39.3701, decimals: 2 },
  ft: { factor: 3.28084, decimals: 2 },
};

const MEASURE_COLOR = Color3.FromHexString('#e9a83b');
const GUIDE_COLOR = Color3.FromHexString('#b98bd0');
const SMART_COLOR = Color3.FromHexString('#e0705a');
/** Rendering group drawn after clearing depth: always on top of the scene. */
const ON_TOP = 2;

/** A point either glued to an object (local coordinates, follows it) or free in the world. */
export interface Anchor {
  entity: Entity | null;
  local: Vector3;
  normal: Vector3;
}

export interface Measurement {
  id: number;
  a: Anchor;
  b: Anchor;
  surface: boolean;
  /** Surface path in the local space of `a.entity`, or null when straight / not computed. */
  path: Vector3[] | null;
  /** The surface path could not be computed (different objects, floor, open mesh…). */
  surfaceFailed: boolean;
  length: number;
  line: GreasedLineBaseMesh;
  markers: [Mesh, Mesh];
  /** Last points sent to the line, to skip rebuilding it when nothing moved. */
  drawn?: Vector3[];
}

export interface Guide {
  id: number;
  axis: Axis;
  value: number;
  node: TransformNode;
}

export interface ToolsJSON {
  unit: Unit;
  smartGuides: boolean;
  guides: { axis: Axis; value: number }[];
  measurements: { a: AnchorJSON; b: AnchorJSON; surface: boolean }[];
}

interface AnchorJSON {
  entity: number | null;
  p: number[];
  n: number[];
}

export class Tools {
  readonly changed = new Observable<void>();
  measureMode = false;
  measurements: Measurement[] = [];
  guides: Guide[] = [];
  active: Measurement | null = null;
  /** Guide whose chip is expanded (shows the delete button). */
  activeGuide: Guide | null = null;
  pending: Anchor | null = null;
  surfaceDefault = true;
  snapVertices = true;
  smartGuides = true;
  unit: Unit = 'm';

  private nextId = 1;
  private readonly markerMat: StandardMaterial;
  private readonly guideMat: StandardMaterial;
  private readonly pendingMarker: Mesh;
  private dragging: { m: Measurement; end: 'a' | 'b' } | null = null;
  private smartLines: GreasedLineBaseMesh[] = [];
  private readonly editor: Editor;

  constructor(editor: Editor) {
    this.editor = editor;
    const scene = editor.scene;
    scene.setRenderingAutoClearDepthStencil(ON_TOP, true, true, true);

    this.markerMat = new StandardMaterial('measureMarker', scene);
    this.markerMat.disableLighting = true;
    this.markerMat.emissiveColor = Color3.White();
    this.guideMat = new StandardMaterial('guide', scene);
    this.guideMat.disableLighting = true;
    this.guideMat.emissiveColor = GUIDE_COLOR;
    this.guideMat.alpha = 0.1;
    this.guideMat.backFaceCulling = false;

    this.pendingMarker = this.createMarker();
    this.pendingMarker.setEnabled(false);

    scene.onBeforeRenderObservable.add(() => this.update());
    editor.changed.add((kind) => {
      if (kind === 'photo') this.applyVisibility();
      if (kind === 'entities') this.update();
    });
  }

  private get scene() {
    return this.editor.scene;
  }

  // ---------- Units ----------

  format(meters: number) {
    const u = UNITS[this.unit];
    const v = meters * u.factor;
    const decimals = this.unit === 'm' && Math.abs(v) >= 10 ? 2 : u.decimals;
    return `${v.toFixed(decimals)} ${this.unit}`;
  }

  toUnit(meters: number) {
    return meters * UNITS[this.unit].factor;
  }

  fromUnit(value: number) {
    return value / UNITS[this.unit].factor;
  }

  setUnit(unit: Unit) {
    this.unit = unit;
    this.changed.notifyObservers();
  }

  private editDepth = 0;
  private loading = false;

  beginEdit() {
    if (this.loading) return;
    const entities = [...this.editor.entities];
    this.editor.beginEdit(this, () => ({ ...this.toJSON(entities), snapVertices: this.snapVertices, surfaceDefault: this.surfaceDefault }), (state) => {
      const unit = this.unit;
      this.load({ ...state, unit }, entities);
      this.snapVertices = state.snapVertices;
      this.surfaceDefault = state.surfaceDefault;
    });
  }

  endEdit() { this.editor.endEdit(this); }

  edit<T>(fn: () => T): T {
    if (this.loading || this.editDepth) return fn();
    this.beginEdit();
    this.editDepth++;
    try { return fn(); }
    finally { this.editDepth--; this.endEdit(); }
  }

  // ---------- Measure mode ----------

  setMeasureMode(on: boolean) {
    this.measureMode = on;
    if (!on) this.cancelPending();
    if (on) this.editor.select(null);
    this.changed.notifyObservers();
  }

  cancelPending() {
    this.pending = null;
    this.pendingMarker.setEnabled(false);
  }

  /** Called by the editor for every pointer event. Returns true when the event was consumed. */
  handlePointer(info: PointerInfo): boolean {
    const scene = this.scene;
    const x = scene.pointerX;
    const y = scene.pointerY;
    switch (info.type) {
      case PointerEventTypes.POINTERDOWN: {
        const hit = scene.pick(x, y, (m) => m.metadata?.measureId !== undefined && m.isEnabled());
        if (!hit?.pickedMesh) return false;
        const m = this.measurements.find((mm) => mm.id === hit.pickedMesh!.metadata.measureId);
        if (!m) return false;
        this.beginEdit();
        this.dragging = { m, end: hit.pickedMesh.metadata.end };
        this.setActive(m);
        this.editor.camera.detachControl();
        return true;
      }
      case PointerEventTypes.POINTERMOVE: {
        if (!this.dragging) return false;
        const anchor = this.resolveAnchor(x, y);
        if (anchor) {
          this.dragging.m[this.dragging.end] = anchor;
          this.setPath(this.dragging.m, null);
        }
        return true;
      }
      case PointerEventTypes.POINTERUP: {
        if (!this.dragging) return false;
        const m = this.dragging.m;
        this.dragging = null;
        this.editor.camera.attachControl(true);
        this.computeSurface(m);
        this.endEdit();
        this.changed.notifyObservers();
        return true;
      }
      case PointerEventTypes.POINTERTAP:
      case PointerEventTypes.POINTERDOUBLETAP: {
        // Two quick taps arrive as TAP + DOUBLETAP: in measure mode both must place points
        if (info.type === PointerEventTypes.POINTERDOUBLETAP && !this.measureMode) return false;
        const hit = scene.pick(x, y, (m) => m.metadata?.measureId !== undefined && m.isEnabled());
        if (hit?.pickedMesh) {
          this.setActive(this.measurements.find((mm) => mm.id === hit.pickedMesh!.metadata.measureId) ?? null);
          return true;
        }
        if (!this.measureMode) {
          // Tapping elsewhere collapses expanded labels/chips (and still selects normally)
          if (this.active || this.activeGuide) {
            this.active = null;
            this.activeGuide = null;
            this.changed.notifyObservers();
          }
          return false;
        }
        const anchor = this.resolveAnchor(x, y);
        if (!anchor) return true;
        if (!this.pending) {
          this.pending = anchor;
          this.pendingMarker.setEnabled(!this.editor.cleanView);
        } else {
          const m = this.addMeasurement(this.pending, anchor, this.surfaceDefault);
          this.cancelPending();
          this.setActive(m);
        }
        this.changed.notifyObservers();
        return true;
      }
    }
    return false;
  }

  /** Point under the pointer: on a model surface (optionally snapped to a vertex), on the floor, or facing the camera. */
  private resolveAnchor(x: number, y: number): Anchor | null {
    const hit = this.editor.pickSurface(x, y);
    if (hit) {
      let point = hit.point;
      if (this.snapVertices) point = this.snapToVertex(hit.mesh, hit.faceId, x, y) ?? point;
      return this.anchorOn(hit.entity, point, hit.normal);
    }
    const ray = this.scene.createPickingRay(x, y, Matrix.Identity(), this.editor.camera);
    const floor = ray.intersectsPlane(new Plane(0, 1, 0, 0));
    if (floor !== null && floor > 0 && floor < 1e4) return this.anchorOn(null, ray.origin.add(ray.direction.scale(floor)), Vector3.Up());
    const cam = this.editor.camera;
    const normal = cam.position.subtract(cam.target).normalize();
    const dist = ray.intersectsPlane(Plane.FromPositionAndNormal(cam.target, normal));
    if (dist === null) return null;
    return this.anchorOn(null, ray.origin.add(ray.direction.scale(dist)), normal);
  }

  private snapToVertex(mesh: AbstractMesh, faceId: number, x: number, y: number) {
    const indices = mesh.getIndices();
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
    if (!indices || !positions || faceId < 0) return null;
    const world = mesh.getWorldMatrix();
    let best: Vector3 | null = null;
    let bestDist = 14; // pixels
    for (let k = 0; k < 3; k++) {
      const i = indices[faceId * 3 + k];
      const v = Vector3.TransformCoordinates(Vector3.FromArray(positions, i * 3), world);
      const s = this.editor.toScreen(v);
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bestDist) {
        bestDist = d;
        best = v;
      }
    }
    return best;
  }

  private anchorOn(entity: Entity | null, world: Vector3, normal: Vector3): Anchor {
    if (!entity) return { entity: null, local: world.clone(), normal: normal.clone() };
    const inv = entity.root.computeWorldMatrix(true).clone().invert();
    return { entity, local: Vector3.TransformCoordinates(world, inv), normal: Vector3.TransformNormal(normal, inv).normalize() };
  }

  worldOf(a: Anchor) {
    return a.entity ? Vector3.TransformCoordinates(a.local, a.entity.root.getWorldMatrix()) : a.local.clone();
  }

  private normalOf(a: Anchor) {
    return a.entity ? Vector3.TransformNormal(a.normal, a.entity.root.getWorldMatrix()).normalize() : a.normal.clone();
  }

  // ---------- Measurements ----------

  addMeasurement(a: Anchor, b: Anchor, surface: boolean) {
    return this.edit(() => {
    const id = this.nextId++;
    const line = this.screenLine(`measure${id}`, [this.worldOf(a), this.worldOf(b)], MEASURE_COLOR, 3, true);
    const markers: [Mesh, Mesh] = [this.createMarker(), this.createMarker()];
    markers[0].metadata = { measureId: id, end: 'a' };
    markers[1].metadata = { measureId: id, end: 'b' };
    const m: Measurement = { id, a, b, surface, path: null, surfaceFailed: false, length: 0, line, markers };
    this.measurements.push(m);
    this.computeSurface(m);
    this.applyVisibility();
    this.changed.notifyObservers();
    return m;
    });
  }

  private createMarker() {
    const marker = MeshBuilder.CreateSphere('measurePoint', { diameter: 1, segments: 12 }, this.scene);
    marker.material = this.markerMat;
    marker.renderingGroupId = ON_TOP;
    this.editor.overlays.add(marker);
    return marker;
  }

  removeMeasurement(m: Measurement) {
    return this.edit(() => {
    m.line.dispose();
    m.markers.forEach((mk) => {
      this.editor.overlays.delete(mk);
      mk.dispose();
    });
    this.editor.overlays.delete(m.line);
    this.measurements = this.measurements.filter((x) => x !== m);
    if (this.active === m) this.active = null;
    this.changed.notifyObservers();
    });
  }

  clearMeasurements() {
    return this.edit(() => {
    for (const m of [...this.measurements]) this.removeMeasurement(m);
    this.cancelPending();
    });
  }

  setActive(m: Measurement | null) {
    this.active = m;
    this.changed.notifyObservers();
  }

  setSurface(m: Measurement, on: boolean) {
    return this.edit(() => {
    m.surface = on;
    this.computeSurface(m);
    this.changed.notifyObservers();
    });
  }

  private computeSurface(m: Measurement) {
    m.surfaceFailed = false;
    if (!m.surface) return this.setPath(m, null);
    const entity = m.a.entity;
    if (!entity || entity !== m.b.entity) {
      m.surfaceFailed = true;
      return this.setPath(m, null);
    }
    const path = surfacePath(entity.meshes, this.worldOf(m.a), this.normalOf(m.a), this.worldOf(m.b), this.normalOf(m.b), this.editor.camera.getDirection(Vector3.Forward()));
    if (!path) {
      m.surfaceFailed = true;
      return this.setPath(m, null);
    }
    const inv = entity.root.computeWorldMatrix(true).clone().invert();
    this.setPath(m, path.map((p) => Vector3.TransformCoordinates(p, inv)));
  }

  private setPath(m: Measurement, path: Vector3[] | null) {
    m.path = path;
  }

  /** World points of the drawn line. */
  private linePoints(m: Measurement) {
    if (m.path && m.a.entity) {
      const world = m.a.entity.root.getWorldMatrix();
      return m.path.map((p) => Vector3.TransformCoordinates(p, world));
    }
    return [this.worldOf(m.a), this.worldOf(m.b)];
  }

  /** Where the measurement label goes (middle of the line). */
  labelPoint(m: Measurement) {
    const pts = this.linePoints(m);
    if (pts.length === 2) return pts[0].add(pts[1]).scale(0.5);
    let half = m.length / 2;
    for (let i = 1; i < pts.length; i++) {
      const d = Vector3.Distance(pts[i - 1], pts[i]);
      if (half <= d) return Vector3.Lerp(pts[i - 1], pts[i], d ? half / d : 0);
      half -= d;
    }
    return pts[pts.length - 1];
  }

  pendingPoint() {
    return this.pending ? this.worldOf(this.pending) : null;
  }

  private alive(a: Anchor) {
    return !a.entity || this.editor.entities.includes(a.entity);
  }

  private update() {
    const visible = !this.editor.cleanView;
    for (const m of this.measurements) {
      const on = visible && this.alive(m.a) && this.alive(m.b);
      m.line.setEnabled(on);
      m.markers.forEach((mk) => mk.setEnabled(on));
      if (!on) continue;
      const pts = this.linePoints(m);
      if (m.line.metadata?.points !== pts.length) {
        // An updatable line can't change its point count: rebuild it
        this.editor.overlays.delete(m.line);
        m.line.dispose();
        m.line = this.screenLine(`measure${m.id}`, pts, MEASURE_COLOR, 3, true);
        m.drawn = pts;
      } else if (!m.drawn || pts.some((p, i) => !p.equalsWithEpsilon(m.drawn![i], 1e-6))) {
        m.line.setPoints(pts);
        m.drawn = pts;
      }
      let length = 0;
      for (let i = 1; i < pts.length; i++) length += Vector3.Distance(pts[i - 1], pts[i]);
      m.length = length;
      this.placeMarker(m.markers[0], this.worldOf(m.a), m === this.active ? 14 : 11);
      this.placeMarker(m.markers[1], this.worldOf(m.b), m === this.active ? 14 : 11);
    }
    if (this.pending) this.placeMarker(this.pendingMarker, this.worldOf(this.pending), 14);
  }

  /**
   * Line with a constant thickness on screen. Without size attenuation GreasedLine widths are a
   * fraction of the viewport height, so convert from pixels.
   */
  private screenLine(name: string, points: Vector3[] | Vector3[][], color: Color3, pixels: number, onTop: boolean) {
    const height = this.editor.engine.getRenderingCanvas()?.clientHeight || 800;
    const line = CreateGreasedLine(
      name,
      { points, updatable: true },
      { color, width: (pixels * 2) / height, sizeAttenuation: false, materialType: GreasedLineMeshMaterialType.MATERIAL_TYPE_SIMPLE },
      this.scene,
    );
    if (onTop) line.renderingGroupId = ON_TOP;
    line.isPickable = false;
    this.editor.overlays.add(line);
    line.metadata = { points: points.length };
    return line;
  }

  /** Keeps a marker at a constant size on screen. */
  private placeMarker(marker: Mesh, pos: Vector3, pixels: number) {
    marker.position.copyFrom(pos);
    marker.scaling.setAll(this.editor.worldPerPixel(pos) * pixels);
  }

  private applyVisibility() {
    const on = !this.editor.cleanView;
    for (const g of this.guides) g.node.setEnabled(on);
    this.pendingMarker.setEnabled(on && !!this.pending);
    this.clearSmartLines();
    this.update();
  }

  // ---------- Guides ----------

  addGuide(axis: Axis, value?: number) {
    return this.edit(() => {
    const sel = this.editor.selected;
    if (value === undefined) {
      if (sel && sel.kind !== 'light') value = this.editor.boundsOf(sel)[axis === 'y' ? 'max' : 'center'][axis];
      else value = axis === 'y' ? 1 : this.editor.camera.target[axis];
    }
    const node = this.buildGuide(axis);
    const g: Guide = { id: this.nextId++, axis, value, node };
    this.guides.push(g);
    this.setGuideValue(g, value);
    this.applyVisibility();
    this.changed.notifyObservers();
    return g;
    });
  }

  /** Guide geometry is built at unit size and scaled to the scene in setGuideValue(). */
  private buildGuide(axis: Axis) {
    const scene = this.scene;
    const node = new TransformNode(`guide-${axis}`, scene);
    const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
    let plane: Mesh;
    let lines: Vector3[][];
    if (axis === 'y') {
      plane = MeshBuilder.CreateGround('guidePlane', { width: 1, height: 1 }, scene);
      lines = [
        [v(-0.5, 0, -0.5), v(0.5, 0, -0.5), v(0.5, 0, 0.5), v(-0.5, 0, 0.5), v(-0.5, 0, -0.5)],
        [v(-0.5, 0, 0), v(0.5, 0, 0)],
        [v(0, 0, -0.5), v(0, 0, 0.5)],
      ];
    } else {
      plane = MeshBuilder.CreatePlane('guidePlane', { width: 1, height: 1, sideOrientation: Mesh.DOUBLESIDE }, scene);
      plane.position.y = 0.5;
      if (axis === 'x') plane.rotation.y = Math.PI / 2;
      lines =
        axis === 'x'
          ? [[v(0, 0, -0.5), v(0, 0, 0.5)], [v(0, 1, -0.5), v(0, 1, 0.5)], [v(0, 0, 0), v(0, 1, 0)]]
          : [[v(-0.5, 0, 0), v(0.5, 0, 0)], [v(-0.5, 1, 0), v(0.5, 1, 0)], [v(0, 0, 0), v(0, 1, 0)]];
    }
    plane.material = this.guideMat;
    plane.isPickable = false;
    plane.parent = node;
    this.editor.overlays.add(plane);
    const line = this.screenLine('guideLine', lines, GUIDE_COLOR, 1.5, false);
    line.parent = node;
    return node;
  }

  setGuideValue(g: Guide, value: number) {
    g.value = value;
    const b = this.editor.sceneBounds();
    const c = b?.center ?? this.editor.camera.target;
    const span = b ? Math.max(b.size.x, b.size.z) : 2;
    const size = Math.max(3, span * 1.8);
    const height = Math.max(2, (b?.max.y ?? 1) * 1.4);
    if (g.axis === 'y') {
      g.node.position.set(c.x, value, c.z);
      g.node.scaling.set(size, 1, size);
    } else if (g.axis === 'x') {
      g.node.position.set(value, 0, c.z);
      g.node.scaling.set(1, height, size);
    } else {
      g.node.position.set(c.x, 0, value);
      g.node.scaling.set(size, height, 1);
    }
  }

  /** Where a guide's drag handle sits: just beside the objects, on the guide itself. */
  guideHandle(g: Guide) {
    // On the guide, next to where the camera is looking (so it's always close to what you see)
    const cam = this.editor.camera;
    const t = cam.target;
    const canvas = this.editor.engine.getRenderingCanvas()!;
    let base: Vector3;
    let dir: Vector3;
    let pixels: number;
    if (g.axis === 'y') {
      base = new Vector3(t.x, g.value, t.z);
      dir = cam.getDirection(Vector3.Right());
      dir.y = 0;
      if (dir.lengthSquared() < 1e-6) dir.set(1, 0, 0);
      pixels = canvas.clientWidth * 0.28;
    } else {
      base = g.axis === 'x' ? new Vector3(g.value, t.y, t.z) : new Vector3(t.x, t.y, g.value);
      dir = Vector3.Up();
      pixels = canvas.clientHeight * 0.22;
    }
    return base.add(dir.normalize().scale(this.editor.worldPerPixel(base) * pixels));
  }

  setActiveGuide(g: Guide | null) {
    this.activeGuide = g;
    this.changed.notifyObservers();
  }

  /**
   * Moves a guide so its handle follows the pointer (canvas CSS pixels). Snaps to object
   * edges/centers on the guide's axis, to the floor, and to the grid when the magnet is on.
   */
  dragGuide(g: Guide, x: number, y: number) {
    const cam = this.editor.camera;
    const ray = this.scene.createPickingRay(x, y, Matrix.Identity(), cam);
    const handle = this.guideHandle(g);
    let normal: Vector3;
    if (g.axis === 'y') {
      // Vertical plane through the handle, facing the camera
      normal = cam.position.subtract(handle);
      normal.y = 0;
      if (normal.lengthSquared() < 1e-6) return;
      normal.normalize();
    } else {
      normal = Vector3.Up();
    }
    const d = ray.intersectsPlane(Plane.FromPositionAndNormal(handle, normal));
    if (d === null) return;
    let value = ray.origin.add(ray.direction.scale(d))[g.axis];

    const threshold = this.editor.worldPerPixel(handle) * 10;
    const candidates = g.axis === 'y' ? [0] : [];
    for (const e of this.editor.entities) {
      if (e.kind === 'light' || !e.visible) continue;
      const b = this.editor.boundsOf(e);
      candidates.push(b.min[g.axis], b.center[g.axis], b.max[g.axis]);
    }
    let best: number | null = null;
    for (const c of candidates) if (Math.abs(c - value) <= threshold && (best === null || Math.abs(c - value) < Math.abs(best - value))) best = c;
    if (best !== null) value = best;
    else if (this.editor.snap) value = Math.round(value / 0.25) * 0.25;
    this.setGuideValue(g, value);
  }

  /** Puts the guide at the bottom, center or top (min/center/max) of the selected object. */
  guideToSelection(g: Guide, edge: Edge) {
    return this.edit(() => {
    const sel = this.editor.selected;
    if (!sel || sel.kind === 'light') return;
    this.setGuideValue(g, this.editor.boundsOf(sel)[edge][g.axis]);
    this.changed.notifyObservers();
    });
  }

  removeGuide(g: Guide) {
    return this.edit(() => {
    for (const m of g.node.getChildMeshes()) this.editor.overlays.delete(m);
    g.node.dispose();
    this.guides = this.guides.filter((x) => x !== g);
    if (this.activeGuide === g) this.activeGuide = null;
    this.changed.notifyObservers();
    });
  }

  clearGuides() {
    for (const g of [...this.guides]) this.removeGuide(g);
  }

  setSmartGuides(on: boolean) {
    return this.edit(() => {
    this.smartGuides = on;
    if (!on) this.clearSmartLines();
    this.changed.notifyObservers();
    });
  }

  // ---------- Smart guides (snapping while moving) ----------

  /**
   * Snaps the moving object's edges/center to other objects and to guides, Figma style.
   * `pos` is the proposed root position; only the axes in `axes` may change.
   */
  snap(entity: Entity, pos: Vector3, axes: Record<Axis, boolean>): Vector3 {
    this.clearSmartLines();
    if (!this.smartGuides || entity.kind === 'light') return pos;
    const own = this.editor.boundsOf(entity);
    const offset = pos.subtract(entity.root.position);
    const moving = { min: own.min.add(offset), max: own.max.add(offset), center: own.center.add(offset) };
    const threshold = this.editor.worldPerPixel(moving.center) * 8;
    const selection = new Set(this.editor.selection);
    const others = this.editor.entities.filter((e) => e.kind !== 'light' && e.visible && !selection.has(e)).map((e) => this.editor.boundsOf(e));
    const out = pos.clone();
    const lines: Vector3[][] = [];

    for (const axis of ['x', 'y', 'z'] as Axis[]) {
      if (!axes[axis]) continue;
      let best: { delta: number; value: number; other: { min: Vector3; max: Vector3 } | null } | null = null;
      const consider = (value: number, other: { min: Vector3; max: Vector3 } | null) => {
        for (const edge of ['min', 'center', 'max'] as Edge[]) {
          const delta = value - moving[edge][axis];
          if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, value, other };
        }
      };
      for (const b of others) for (const edge of ['min', 'center', 'max'] as Edge[]) consider(b[edge][axis], b);
      for (const g of this.guides) if (g.axis === axis) consider(g.value, null);
      if (axis === 'y') consider(0, null);
      if (!best) continue;
      const found = best as { delta: number; value: number; other: { min: Vector3; max: Vector3 } | null };
      out[axis] += found.delta;
      if (found.other) lines.push(this.smartLine(axis, found.value, moving, found.other));
    }
    for (const pts of lines) {
      this.smartLines.push(this.screenLine('smartGuide', pts, SMART_COLOR, 2, true));
    }
    return out;
  }

  /** Line showing an alignment on `axis` at `value`, spanning both boxes along another axis. */
  private smartLine(axis: Axis, value: number, moving: { min: Vector3; max: Vector3 }, other: { min: Vector3; max: Vector3 }) {
    const along: Axis = axis === 'x' ? 'z' : 'x';
    const min = Math.min(moving.min[along], other.min[along]);
    const max = Math.max(moving.max[along], other.max[along]);
    const a = new Vector3();
    const b = new Vector3();
    a[axis] = b[axis] = value;
    a[along] = min;
    b[along] = max;
    const rest: Axis = (['x', 'y', 'z'] as Axis[]).find((k) => k !== axis && k !== along)!;
    const restValue = rest === 'y' ? Math.max(0.002, Math.min(moving.min.y, other.min.y)) : (moving.min[rest] + moving.max[rest]) / 2;
    a[rest] = b[rest] = restValue;
    return [a, b];
  }

  clearSmartLines() {
    for (const l of this.smartLines) {
      this.editor.overlays.delete(l);
      l.dispose();
    }
    this.smartLines = [];
  }

  // ---------- Alignment (needs 2+ selected; the first selected is the reference) ----------

  align(axis: Axis, edge: Edge) {
    const [ref, ...rest] = this.editor.selection.filter((e) => e.kind !== 'light');
    if (!ref || !rest.length) return;
    const target = this.editor.boundsOf(ref)[edge][axis];
    this.editor.transformMany(rest, (e) => {
      e.root.position[axis] += target - this.editor.boundsOf(e)[edge][axis];
    });
  }

  /** Scales the others uniformly so their size on `axis` matches the reference. */
  matchSize(axis: Axis) {
    const [ref, ...rest] = this.editor.selection.filter((e) => e.kind !== 'light');
    if (!ref || !rest.length) return;
    const target = this.editor.boundsOf(ref).size[axis];
    this.editor.transformMany(rest, (e) => {
      const b = this.editor.boundsOf(e);
      const size = b.size[axis];
      if (size <= 1e-6) return;
      const bottom = b.min.y;
      e.root.scaling.scaleInPlace(target / size);
      e.root.position.y += bottom - this.editor.boundsOf(e).min.y;
    });
  }

  matchScale() {
    const [ref, ...rest] = this.editor.selection.filter((e) => e.kind !== 'light');
    if (!ref || !rest.length) return;
    this.editor.transformMany(rest, (e) => e.root.scaling.copyFrom(ref.root.scaling));
  }

  /** Puts the others on top of the reference. */
  stackOnTop() {
    const [ref, ...rest] = this.editor.selection.filter((e) => e.kind !== 'light');
    if (!ref || !rest.length) return;
    const top = this.editor.boundsOf(ref).max.y;
    this.editor.transformMany(rest, (e) => {
      e.root.position.y += top - this.editor.boundsOf(e).min.y;
    });
  }

  /** Spreads the selection with equal gaps along an axis (keeps the two outermost in place). */
  distribute(axis: Axis) {
    const items = this.editor.selection.filter((e) => e.kind !== 'light');
    if (items.length < 3) return;
    const boxes = items.map((e) => ({ e, b: this.editor.boundsOf(e) })).sort((p, q) => p.b.center[axis] - q.b.center[axis]);
    const first = boxes[0].b;
    const last = boxes[boxes.length - 1].b;
    const sizes = boxes.reduce((s, x) => s + x.b.size[axis], 0);
    const gap = (last.max[axis] - first.min[axis] - sizes) / (boxes.length - 1);
    let cursor = first.max[axis] + gap;
    this.editor.transformMany(
      boxes.slice(1, -1).map((x) => x.e),
      (e) => {
        const b = this.editor.boundsOf(e);
        e.root.position[axis] += cursor - b.min[axis];
        cursor += b.size[axis] + gap;
      },
    );
  }

  dropToFloor() {
    const items = this.editor.selection.filter((e) => e.kind !== 'light');
    this.editor.transformMany(items, (e) => {
      e.root.position.y -= this.editor.boundsOf(e).min.y;
    });
  }

  // ---------- Save / load ----------

  toJSON(entities: Entity[]): ToolsJSON {
    const anchor = (a: Anchor): AnchorJSON => ({ entity: a.entity ? entities.indexOf(a.entity) : null, p: a.local.asArray(), n: a.normal.asArray() });
    return {
      unit: this.unit,
      smartGuides: this.smartGuides,
      guides: this.guides.map((g) => ({ axis: g.axis, value: g.value })),
      measurements: this.measurements.filter((m) => this.alive(m.a) && this.alive(m.b)).map((m) => ({ a: anchor(m.a), b: anchor(m.b), surface: m.surface })),
    };
  }

  load(json: ToolsJSON | undefined, entities: (Entity | null)[]) {
    const wasLoading = this.loading;
    this.loading = true;
    try {
    this.clear();
    if (!json) return;
    this.unit = json.unit ?? 'm';
    this.smartGuides = json.smartGuides ?? true;
    for (const g of json.guides ?? []) this.addGuide(g.axis, g.value);
    const anchor = (a: AnchorJSON): Anchor | null => {
      const entity = a.entity === null ? null : entities[a.entity] ?? undefined;
      if (entity === undefined) return null;
      return { entity, local: Vector3.FromArray(a.p), normal: Vector3.FromArray(a.n) };
    };
    for (const m of json.measurements ?? []) {
      const a = anchor(m.a);
      const b = anchor(m.b);
      if (a && b) this.addMeasurement(a, b, m.surface);
    }
    this.active = null;
    this.changed.notifyObservers();
    } finally { this.loading = wasLoading; }
  }

  clear() {
    const wasLoading = this.loading;
    this.loading = true;
    try {
    this.clearMeasurements();
    this.clearGuides();
    this.clearSmartLines();
    this.measureMode = false;
    } finally { this.loading = wasLoading; }
  }
}

/**
 * Path between two surface points that follows the surface: the mesh is cut by the plane that
 * contains A, B and the average surface normal, and the shortest route along that cut is taken.
 */
export function surfacePath(meshes: AbstractMesh[], a: Vector3, na: Vector3, b: Vector3, nb: Vector3, viewDir: Vector3): Vector3[] | null {
  const ab = b.subtract(a);
  const span = ab.length();
  if (span < 1e-6) return null;
  let up = na.add(nb);
  if (up.lengthSquared() < 1e-6) up = viewDir.scale(-1);
  let pn = Vector3.Cross(ab, up);
  if (pn.lengthSquared() < 1e-10) pn = Vector3.Cross(ab, viewDir);
  if (pn.lengthSquared() < 1e-10) return null;
  pn.normalize();
  const pd = -Vector3.Dot(pn, a);

  const eps = span * 1e-5;
  const keyOf = (p: Vector3) => `${Math.round(p.x / eps)},${Math.round(p.y / eps)},${Math.round(p.z / eps)}`;
  const nodes: Vector3[] = [];
  const index = new Map<string, number>();
  const adj: number[][] = [];
  const owner: number[] = [];
  const segs: [number, number][] = [];
  let meshId = 0;
  const node = (p: Vector3) => {
    const k = keyOf(p);
    let i = index.get(k);
    if (i === undefined) {
      i = nodes.length;
      nodes.push(p);
      adj.push([]);
      owner.push(meshId);
      index.set(k, i);
    }
    return i;
  };
  const link = (i: number, j: number) => {
    if (i === j) return;
    adj[i].push(j);
    adj[j].push(i);
  };

  const p0 = new Vector3();
  const p1 = new Vector3();
  const p2 = new Vector3();
  for (const mesh of meshes) {
    meshId++;
    const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
    const idx = mesh.getIndices();
    if (!pos || !idx) continue;
    const world = mesh.computeWorldMatrix(true);
    const wp = new Float32Array(pos.length);
    const t = new Vector3();
    for (let i = 0; i < pos.length; i += 3) {
      Vector3.TransformCoordinatesFromFloatsToRef(pos[i], pos[i + 1], pos[i + 2], world, t);
      wp[i] = t.x;
      wp[i + 1] = t.y;
      wp[i + 2] = t.z;
    }
    const dist = (i: number) => pn.x * wp[i * 3] + pn.y * wp[i * 3 + 1] + pn.z * wp[i * 3 + 2] + pd;
    for (let f = 0; f < idx.length; f += 3) {
      const tri = [idx[f], idx[f + 1], idx[f + 2]];
      const d = tri.map(dist);
      const pts: Vector3[] = [];
      for (let e = 0; e < 3; e++) {
        const i = e;
        const j = (e + 1) % 3;
        if (d[i] >= 0 === d[j] >= 0) continue;
        // Interpolate in a canonical order so neighbouring triangles produce the exact same point
        let [u, v, du, dv] = [tri[i], tri[j], d[i], d[j]];
        p0.set(wp[u * 3], wp[u * 3 + 1], wp[u * 3 + 2]);
        p1.set(wp[v * 3], wp[v * 3 + 1], wp[v * 3 + 2]);
        if (p0.x > p1.x || (p0.x === p1.x && (p0.y > p1.y || (p0.y === p1.y && p0.z > p1.z)))) {
          [u, v, du, dv] = [v, u, dv, du];
          p2.copyFrom(p0);
          p0.copyFrom(p1);
          p1.copyFrom(p2);
        }
        pts.push(Vector3.Lerp(p0, p1, du / (du - dv)));
      }
      if (pts.length === 2) {
        const i = node(pts[0]);
        const j = node(pts[1]);
        link(i, j);
        segs.push([i, j]);
      }
    }
  }
  if (!segs.length) return null;

  // Models are often made of separate parts (e.g. leather + visor): bridge small gaps between them
  const gap = span * 0.03;
  const cells = new Map<string, number[]>();
  const cellOf = (p: Vector3, dx = 0, dy = 0, dz = 0) => `${Math.floor(p.x / gap) + dx},${Math.floor(p.y / gap) + dy},${Math.floor(p.z / gap) + dz}`;
  for (let i = 0; i < nodes.length; i++) {
    const k = cellOf(nodes[i]);
    const list = cells.get(k);
    if (list) list.push(i);
    else cells.set(k, [i]);
  }
  for (let i = 0; i < nodes.length; i++) {
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          for (const j of cells.get(cellOf(nodes[i], dx, dy, dz)) ?? []) {
            if (j > i && owner[j] !== owner[i] && Vector3.Distance(nodes[i], nodes[j]) <= gap) link(i, j);
          }
        }
  }

  // Hook A and B into the closest cut segment
  const attach = (p: Vector3) => {
    let best = -1;
    let bestDist = Infinity;
    for (let s = 0; s < segs.length; s++) {
      const d = distToSegment(p, nodes[segs[s][0]], nodes[segs[s][1]]);
      if (d < bestDist) {
        bestDist = d;
        best = s;
      }
    }
    if (best < 0 || bestDist > span * 0.05) return -1;
    const i = nodes.length;
    nodes.push(p.clone());
    adj.push([]);
    link(i, segs[best][0]);
    link(i, segs[best][1]);
    return i;
  };
  const ia = attach(a);
  const ib = attach(b);
  if (ia < 0 || ib < 0) return null;

  // Dijkstra
  const dist = new Float64Array(nodes.length).fill(Infinity);
  const prev = new Int32Array(nodes.length).fill(-1);
  const heap = new MinHeap();
  dist[ia] = 0;
  heap.push(ia, 0);
  while (heap.size) {
    const [u, du] = heap.pop();
    if (du > dist[u]) continue;
    if (u === ib) break;
    for (const v of adj[u]) {
      const nd = du + Vector3.Distance(nodes[u], nodes[v]);
      if (nd < dist[v]) {
        dist[v] = nd;
        prev[v] = u;
        heap.push(v, nd);
      }
    }
  }
  if (!isFinite(dist[ib])) return null;
  const path: Vector3[] = [];
  for (let v = ib; v !== -1; v = prev[v]) path.push(nodes[v]);
  return path.reverse();
}

function distToSegment(p: Vector3, a: Vector3, b: Vector3) {
  const ab = b.subtract(a);
  const len = ab.lengthSquared();
  const t = len ? Math.max(0, Math.min(1, Vector3.Dot(p.subtract(a), ab) / len)) : 0;
  return Vector3.Distance(p, a.add(ab.scale(t)));
}

class MinHeap {
  private items: number[] = [];
  private keys: number[] = [];
  get size() {
    return this.items.length;
  }
  push(item: number, key: number) {
    this.items.push(item);
    this.keys.push(key);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): [number, number] {
    const top: [number, number] = [this.items[0], this.keys[0]];
    const lastItem = this.items.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.items.length) {
      this.items[0] = lastItem;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.keys.length && this.keys[l] < this.keys[m]) m = l;
        if (r < this.keys.length && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(i: number, j: number) {
    [this.items[i], this.items[j]] = [this.items[j], this.items[i]];
    [this.keys[i], this.keys[j]] = [this.keys[j], this.keys[i]];
  }
}
