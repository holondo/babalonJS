import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { Editor } from '../core/editor';
import type { FaceSelection } from './selection';
import { Deform } from './deform';
import type { DeformState } from './deform';
import { editBlocker } from './combine';

export type SurfaceBrush = 'pull' | 'inflate' | 'smooth' | 'flatten';

/**
 * What a brush needs about a mesh, built once per Surface session and reused by every stroke:
 * the deformation (updatable buffers) and welded vertex groups.
 */
export class SculptContext {
  readonly deform: Deform;
  readonly groupStart: Uint32Array;
  readonly groupVertices: Uint32Array;
  readonly mark: Uint32Array;
  constructor(mesh: Mesh, selection: FaceSelection) {
    const topology = selection.neighbors(mesh);
    this.deform = new Deform(mesh, topology);
    const { weld } = topology;
    let groups = 0;
    for (let i = 0; i < weld.length; i++) if (weld[i] + 1 > groups) groups = weld[i] + 1;
    this.groupStart = new Uint32Array(groups + 1);
    for (let i = 0; i < weld.length; i++) this.groupStart[weld[i] + 1]++;
    for (let g = 0; g < groups; g++) this.groupStart[g + 1] += this.groupStart[g];
    this.groupVertices = new Uint32Array(weld.length);
    const fill = this.groupStart.slice(0, groups);
    for (let i = 0; i < weld.length; i++) this.groupVertices[fill[weld[i]]++] = i;
    this.mark = new Uint32Array(groups);
  }
}

/**
 * One brush stroke, applied while dragging (not on release). Built for dense meshes:
 * - one pick at the start; later points walk across the surface from the previous one;
 * - the brush region is a surface flood within the radius (doesn't leak into a nearby limb);
 * - only vertices in the radius move; vertices at the same position move together (UV seams
 *   stay closed); normals and GPU data are updated only around them.
 */
export class SculptStroke {
  readonly mesh: Mesh;
  private readonly editor: Editor;
  private readonly deform: Deform;
  private readonly brush: SurfaceBrush;
  private readonly strength: number;
  private readonly radius: number;
  private readonly allowed: Uint8Array | null;
  /** Welded vertex → its original vertices (CSR) and one representative. */
  private readonly groupStart: Uint32Array;
  private readonly groupVertices: Uint32Array;
  private readonly world: Matrix;
  private readonly inverse: Matrix;
  /** Current brush center: a welded vertex on the surface, and its world position. */
  private at: number;
  private center: Vector3;
  private readonly planeNormal: Vector3;
  private readonly planePoint: Vector3;
  private readonly startState: DeformState;
  private moved = false;
  private readonly mark: Uint32Array;
  private stamp = 0;

  private constructor(editor: Editor, selection: FaceSelection, context: SculptContext, face: number, point: Vector3, brush: SurfaceBrush, pixels: number, strength: number, selectedOnly: boolean) {
    const mesh = context.deform.mesh;
    this.editor = editor; this.mesh = mesh; this.brush = brush; this.strength = strength;
    this.deform = context.deform;
    this.deform.rebase();
    this.startState = this.deform.startState();
    this.world = mesh.computeWorldMatrix(true).clone();
    this.inverse = this.world.clone().invert();
    this.groupStart = context.groupStart;
    this.groupVertices = context.groupVertices;
    this.mark = context.mark;
    const { weld } = this.deform.topology;
    const groups = this.mark.length;
    // Restricted to the selection: welded vertices of selected faces
    if (selectedOnly) {
      const faces = selection.faces.get(mesh), idx = mesh.getIndices()!;
      if (faces?.size) {
        this.allowed = new Uint8Array(groups);
        const m = faces.mask;
        for (let f = 0; f < m.length; f++) if (m[f]) for (let j = 0; j < 3; j++) this.allowed[weld[idx[f * 3 + j]]] = 1;
      } else this.allowed = null;
    } else this.allowed = null;
    // Brush radius in world units from screen pixels at the hit
    const camera = editor.camera, distance = Math.abs(Vector3.Dot(point.subtract(camera.globalPosition), camera.getForwardRay().direction));
    this.radius = Math.max(1e-6, distance * Math.tan(camera.fov / 2) * 2 * pixels / (editor.engine.getRenderHeight() * editor.engine.getHardwareScalingLevel()));
    const idx = mesh.getIndices()!;
    this.at = this.nearestOf(weld[idx[face * 3]], point);
    this.center = point.clone();
    this.planePoint = point.clone();
    this.planeNormal = this.normalAt(this.at);
  }

  /** Starts a stroke at a screen point (null when the model isn't under it). */
  static begin(editor: Editor, selection: FaceSelection, contexts: Map<Mesh, SculptContext>, x: number, y: number, brush: SurfaceBrush, pixels: number, strength: number, selectedOnly: boolean) {
    const reason = editBlocker(selection.entity); if (reason) throw new Error(reason);
    const hit = editor.pickSurface(x, y);
    if (!hit || hit.entity !== selection.entity || !(hit.mesh instanceof Mesh) || hit.faceId < 0) return null;
    let context = contexts.get(hit.mesh);
    // Reused only while the mesh still uses the same position array (other edits and undo replace it)
    if (!context || hit.mesh.getVerticesData('position') !== context.deform.positions) {
      contexts.set(hit.mesh, (context = new SculptContext(hit.mesh, selection)));
      // Its buffers became updatable: the highlight follows them
      selection.refresh();
    }
    const stroke = new SculptStroke(editor, selection, context, hit.faceId, hit.point, brush, pixels, strength, selectedOnly);
    stroke.dab(hit.point);
    return stroke;
  }

  /** Continues the stroke towards a screen point. */
  move(x: number, y: number) {
    const camera = this.editor.camera;
    const ray = this.editor.scene.createPickingRay(x, y, Matrix.Identity(), camera);
    // Where the ray meets the plane through the current center facing the camera…
    const facing = camera.getForwardRay().direction;
    const denom = Vector3.Dot(ray.direction, facing);
    if (Math.abs(denom) < 1e-6) return;
    const t = Vector3.Dot(this.center.subtract(ray.origin), facing) / denom;
    const target = ray.origin.add(ray.direction.scale(t));
    // …then walk the surface towards it (cheap, continuous; no full pick per move)
    const step = Vector3.Distance(target, this.center);
    if (step < this.radius * 0.2) return;
    const previous = this.center.clone();
    this.at = this.walk(this.at, target);
    const reached = this.positionOf(this.at);
    if (this.brush === 'pull') {
      // Pull follows the finger even off the surface
      this.dab(reached, target.subtract(previous));
      this.center = target;
    } else {
      this.dab(reached);
      this.center = reached;
    }
  }

  /** End of the stroke: one undo step (null when nothing moved). */
  end() {
    this.deform.finish();
    if (!this.moved) return null;
    return { mesh: this.mesh, before: this.startState, after: this.deform.state() };
  }

  // ---------- Internals ----------

  private positionOf(group: number, out = new Vector3()) {
    const v = this.groupVertices[this.groupStart[group]] * 3, p = this.deform.positions;
    return Vector3.TransformCoordinatesFromFloatsToRef(p[v], p[v + 1], p[v + 2], this.world, out);
  }

  private normalAt(group: number) {
    const n = this.deform.normals, v = this.groupVertices[this.groupStart[group]] * 3;
    if (!n) return this.editor.camera.getForwardRay().direction.scale(-1);
    return Vector3.TransformNormal(new Vector3(n[v], n[v + 1], n[v + 2]), this.world).normalize();
  }

  /** Welded neighbors of a welded vertex (through the faces around it). */
  private forNeighbors(group: number, visit: (other: number) => void) {
    const { weld, vertexStart, vertexFaces } = this.deform.topology, idx = this.mesh.getIndices()!;
    for (let k = vertexStart[group]; k < vertexStart[group + 1]; k++) {
      const f = vertexFaces[k];
      for (let j = 0; j < 3; j++) { const o = weld[idx[f * 3 + j]]; if (o !== group) visit(o); }
    }
  }

  /** Greedy walk across the surface to the vertex nearest to a world point. */
  private walk(from: number, target: Vector3) {
    let current = from, best = Vector3.DistanceSquared(this.positionOf(current), target);
    const p = new Vector3();
    for (let guard = 0; guard < 2000; guard++) {
      let next = -1;
      this.forNeighbors(current, (o) => { const d = Vector3.DistanceSquared(this.positionOf(o, p), target); if (d < best) { best = d; next = o; } });
      if (next < 0) break;
      current = next;
    }
    return current;
  }

  private nearestOf(group: number, point: Vector3) { return this.walk(group, point); }

  /** One brush stamp around a surface point. */
  private dab(center: Vector3, drag?: Vector3) {
    const r2 = this.radius * this.radius, stamp = ++this.stamp, mark = this.mark;
    // Surface flood within the radius from the center vertex
    const region: number[] = [this.at];
    mark[this.at] = stamp;
    const p = new Vector3();
    for (let i = 0; i < region.length; i++) this.forNeighbors(region[i], (o) => {
      if (mark[o] === stamp) return;
      mark[o] = stamp;
      if (Vector3.DistanceSquared(this.positionOf(o, p), center) <= r2) region.push(o);
    });
    const positions = this.deform.positions, moved: number[] = [];
    const local = drag ? Vector3.TransformNormal(drag, this.inverse) : null;
    const planeLocal = Vector3.TransformCoordinates(this.planePoint, this.inverse), normalLocal = Vector3.TransformNormal(this.planeNormal, this.inverse).normalize();
    const radiusLocal = Vector3.TransformNormal(new Vector3(this.radius, 0, 0), this.inverse).length();
    const n = this.deform.normals;
    // Smooth reads the neighbors' current positions: compute all targets first
    const targets = new Float32Array(region.length * 3);
    for (let i = 0; i < region.length; i++) {
      const g = region[i];
      if (this.allowed && !this.allowed[g]) { targets[i * 3] = NaN; continue; }
      const v = this.groupVertices[this.groupStart[g]] * 3;
      const x = positions[v], y = positions[v + 1], z = positions[v + 2];
      const d = Math.sqrt(Vector3.DistanceSquared(this.positionOf(g, p), center)) / this.radius;
      const fall = 1 - Math.min(1, d), w = fall * fall * (3 - 2 * fall) * this.strength;
      let tx = x, ty = y, tz = z;
      if (this.brush === 'pull' && local) { tx += local.x * w; ty += local.y * w; tz += local.z * w; }
      else if (this.brush === 'inflate' && n) { const s = radiusLocal * 0.25 * w; tx += n[v] * s; ty += n[v + 1] * s; tz += n[v + 2] * s; }
      else if (this.brush === 'flatten') {
        const dist = (x - planeLocal.x) * normalLocal.x + (y - planeLocal.y) * normalLocal.y + (z - planeLocal.z) * normalLocal.z;
        tx -= normalLocal.x * dist * w; ty -= normalLocal.y * dist * w; tz -= normalLocal.z * dist * w;
      } else if (this.brush === 'smooth') {
        let ax = 0, ay = 0, az = 0, c = 0;
        this.forNeighbors(g, (o) => { const u = this.groupVertices[this.groupStart[o]] * 3; ax += positions[u]; ay += positions[u + 1]; az += positions[u + 2]; c++; });
        if (c) { const k = Math.min(1, w * 1.5); tx += (ax / c - x) * k; ty += (ay / c - y) * k; tz += (az / c - z) * k; }
      }
      targets[i * 3] = tx; targets[i * 3 + 1] = ty; targets[i * 3 + 2] = tz;
    }
    for (let i = 0; i < region.length; i++) {
      if (Number.isNaN(targets[i * 3])) continue;
      const g = region[i];
      for (let k = this.groupStart[g]; k < this.groupStart[g + 1]; k++) {
        const v = this.groupVertices[k];
        positions[v * 3] = targets[i * 3]; positions[v * 3 + 1] = targets[i * 3 + 1]; positions[v * 3 + 2] = targets[i * 3 + 2];
        this.deform.touch(v); moved.push(v);
      }
    }
    if (!moved.length) return;
    this.moved = true;
    this.deform.updateNormals(moved);
    this.deform.upload();
    this.editor.invalidate();
  }
}

/** Puts a stroke's before/after state back (undo/redo). */
export function applyStrokeState(mesh: Mesh, state: DeformState) { Deform.restore(mesh, state); }
