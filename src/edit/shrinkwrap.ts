import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Observer } from '@babylonjs/core/Misc/observable.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { Editor, Entity } from '../core/editor';
import { Deform, recordDeform } from './deform';
import { buildTopology, disposeShared, sharedMesh } from './selection';
import { editBlocker } from './combine';
import { tr } from '../core/i18n';

/**
 * Blender's Shrinkwrap wrap modes. Outside: what's inside the tool moves out to its surface (fills
 * grooves). Inside: what's outside moves in (flattens bumps). Surface: both.
 */
export type WrapMode = 'outside' | 'inside' | 'surface';

/** Closest point on a tool object's surface, in world space; returns whether `p` is inside it. */
interface WrapSurface { closest(p: Vector3, out: Vector3): boolean }

/** The app's own sphere, box and cylinder are exact shapes (unit size, centered in their mesh). */
const EXACT = new Set(['sphere', 'box', 'cylinder']);

/**
 * Moves the target's own vertices onto the surface of other objects (the tools), live while
 * the tools move, like Blender's Shrinkwrap modifier with Figma's "first selected is the
 * reference". Only vertices inside a tool, or outside within the falloff, move, so only the part
 * touching it changes. No new geometry: texture, UVs and skin weights stay. Apply records one
 * undo step; Cancel puts the surface back.
 */
export class Shrinkwrap {
  mode: WrapMode = 'outside';
  strength = 1;
  /** How far outside the tools the surface is still pulled, as a share of their size. */
  falloff = 0.15;
  target: Entity | null = null;
  tools: Entity[] = [];
  /** Only these vertices of the target may move (faces selected in Mesh mode), or all. */
  limit: Map<Mesh, Uint8Array> | null = null;
  private parts: { mesh: Mesh; deform: Deform; shown: Float32Array; moved: number[] }[] = [];
  private surfaces: WrapSurface[] = [];
  private wires: Mesh[] = [];
  private hidden: { mesh: Mesh; visibility: number }[] = [];
  private wire: StandardMaterial | null = null;
  private observer: Observer<Scene> | null = null;
  private signature = '';
  readonly editor: Editor;
  constructor(editor: Editor) { this.editor = editor; }

  get active() { return !!this.target; }

  /** Starts with the first entity as the target and the others as tools; `limit` keeps the rest of the target still. */
  start(entities: Entity[], limit: Map<Mesh, Uint8Array> | null = null) {
    this.cancel();
    const [target, ...tools] = entities.filter((e) => e.kind !== 'light');
    if (!target || !tools.length) throw new Error(tr('Select at least two objects.'));
    const reason = editBlocker(target); if (reason) throw new Error(reason);
    if (tools.some((t) => !t.meshes.some((m) => m instanceof Mesh && m.getTotalIndices()))) throw new Error(tr('Choose triangle models or shapes.'));
    this.target = target; this.tools = tools;
    // A limit made before the geometry changed no longer matches its vertices
    this.limit = limit && [...limit].every(([m, mask]) => target.meshes.includes(m) && mask.length === m.getTotalVertices()) ? limit : null;
    this.editor.anim.pause(target);
    this.surfaces = tools.flatMap(toolSurfaces);
    // Tools show as wireframes (Blender's "Display as Wire"): the target stays readable under them
    this.wire = new StandardMaterial('Wrap tool', this.editor.scene);
    this.wire.wireframe = true; this.wire.disableLighting = true;
    this.wire.emissiveColor = Color3.White(); this.wire.alpha = 0.5;
    for (const tool of tools) for (const m of tool.meshes) {
      if (!(m instanceof Mesh) || !m.getTotalIndices()) continue;
      const shown = sharedMesh(m, 'Wrap tool');
      shown.setIndices(m.getIndices()!, m.getTotalVertices());
      shown.material = this.wire;
      this.editor.overlays.add(shown); this.wires.push(shown);
      this.hidden.push({ mesh: m, visibility: m.visibility }); m.visibility = 0;
    }
    this.observer = this.editor.scene.onBeforeRenderObservable.add(() => this.track());
    this.editor.select(tools[0]);
    this.editor.invalidate(); this.editor.notify('tool');
  }

  /** A setting changed: recompute on the next frame. */
  changed() { this.signature = ''; this.editor.invalidate(); }

  apply() {
    const target = this.target;
    if (!target) return 0;
    this.track();
    const changes = this.parts.filter((p) => p.moved.length).map((p) => { p.deform.finish(); return { mesh: p.mesh, before: p.deform.startState(), after: p.deform.state() }; });
    this.parts = [];
    this.stop();
    if (changes.length) recordDeform(this.editor, target, changes);
    return changes.length;
  }

  cancel() {
    if (!this.target) return;
    for (const p of this.parts) if (p.moved.length) Deform.restore(p.mesh, p.deform.startState());
    this.parts = [];
    this.stop();
    this.editor.notify('transform');
  }

  private stop() {
    if (this.observer) this.editor.scene.onBeforeRenderObservable.remove(this.observer);
    this.observer = null;
    for (const w of this.wires) { this.editor.overlays.delete(w); disposeShared(w); }
    for (const { mesh, visibility } of this.hidden) mesh.visibility = visibility;
    this.wire?.dispose();
    this.wires = []; this.hidden = []; this.wire = null; this.surfaces = [];
    this.target = null; this.tools = []; this.limit = null; this.signature = '';
    this.editor.invalidate(); this.editor.notify('tool');
  }

  /** Recomputes when a tool, the target or a setting changed. */
  private track() {
    const target = this.target;
    if (!target) return;
    if (!this.editor.entities.includes(target) || this.tools.some((t) => !this.editor.entities.includes(t))) { this.cancel(); return; }
    const matrices = [target, ...this.tools].map((e) => e.meshes.map((m) => m.computeWorldMatrix(true).m.join()).join()).join('|');
    const key = `${matrices}|${this.mode}|${this.strength}|${this.falloff}|${!!this.limit}`;
    // An undo (or any other edit) replaced the target's geometry: start again from it
    const stale = this.parts.some((p) => p.mesh.getVertexBuffer('position')?.getData() !== p.deform.positions);
    if (key === this.signature && !stale) return;
    if (stale || matrices.split('|')[0] !== this.signature.split('|')[0]) this.prepare(stale);
    this.signature = key;
    this.update();
  }

  /** The target's surface as shown (pose and shape keys), in world space, before wrapping. */
  private prepare(rebuild: boolean) {
    const target = this.target!;
    if (rebuild || !this.parts.length) {
      this.parts = target.meshes.filter((m): m is Mesh => m instanceof Mesh && !!m.getTotalIndices())
        .map((mesh) => ({ mesh, deform: new Deform(mesh, buildTopology(mesh)), shown: new Float32Array(0), moved: [] }));
    }
    for (const p of this.parts) {
      p.deform.reset(p.moved); p.moved = [];
      const local = p.mesh.getPositionData(true, true) ?? p.deform.base, w = p.mesh.computeWorldMatrix(true), v = new Vector3();
      if (p.shown.length !== local.length) p.shown = new Float32Array(local.length);
      for (let i = 0; i < local.length; i += 3) {
        Vector3.TransformCoordinatesFromFloatsToRef(local[i], local[i + 1], local[i + 2], w, v);
        p.shown[i] = v.x; p.shown[i + 1] = v.y; p.shown[i + 2] = v.z;
      }
    }
  }

  private update() {
    // Where the tools are, and how far the falloff reaches
    const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const t of this.tools) for (const m of t.meshes) {
      const box = m.getBoundingInfo().boundingBox;
      min.minimizeInPlace(box.minimumWorld); max.maximizeInPlace(box.maximumWorld);
    }
    const reach = this.falloff * Math.max(max.x - min.x, max.y - min.y, max.z - min.z);
    min.subtractFromFloatsToRef(reach, reach, reach, min); max.addInPlaceFromFloats(reach, reach, reach);
    const here = new Vector3(), best = new Vector3(), point = new Vector3(), delta = new Vector3();
    const skin = new Matrix(), inverse = new Matrix(), sum = new Float32Array(16);
    for (const p of this.parts) {
      const { mesh, deform, shown } = p, pos = deform.positions;
      deform.reset(p.moved);
      const previous = p.moved; p.moved = [];
      const toMesh = mesh.computeWorldMatrix(true).clone().invert();
      const bones = mesh.skeleton ? mesh.skeleton.getTransformMatrices(mesh) : null;
      const ids = bones ? mesh.getVerticesData('matricesIndices') : null, weights = bones ? mesh.getVerticesData('matricesWeights') : null;
      const extraIds = bones ? mesh.getVerticesData('matricesIndicesExtra') : null, extraWeights = bones ? mesh.getVerticesData('matricesWeightsExtra') : null;
      const only = this.limit ? this.limit.get(mesh) : null;
      if (this.limit && !only) { if (previous.length) { deform.updateNormals(previous); deform.upload(); } continue; }
      for (let v = 0; v < shown.length / 3; v++) {
        if (only && !only[v]) continue;
        const x = shown[v * 3], y = shown[v * 3 + 1], z = shown[v * 3 + 2];
        if (x < min.x || y < min.y || z < min.z || x > max.x || y > max.y || z > max.z) continue;
        here.set(x, y, z);
        // Nearest tool surface; inside any tool counts as inside
        let inside = false, distance = Infinity;
        for (const s of this.surfaces) {
          if (s.closest(here, point)) inside = true;
          const d = Vector3.DistanceSquared(here, point);
          if (d < distance) { distance = d; best.copyFrom(point); }
        }
        if (distance === Infinity) continue;
        if ((this.mode === 'outside' && !inside) || (this.mode === 'inside' && inside)) continue;
        let weight = this.strength;
        if (!inside) {
          const d = Math.sqrt(distance);
          if (d >= reach) continue;
          const t = 1 - d / reach;
          weight *= t * t * (3 - 2 * t);
        }
        // World move → mesh space → bind space (undo the vertex's skinning)
        best.subtractToRef(here, delta).scaleInPlace(weight);
        Vector3.TransformNormalToRef(delta, toMesh, delta);
        if (bones && ids && weights) {
          sum.fill(0);
          addInfluences(sum, bones, ids, weights, v);
          if (extraIds && extraWeights) addInfluences(sum, bones, extraIds, extraWeights, v);
          Matrix.FromArrayToRef(sum, 0, skin);
          if (Math.abs(skin.determinant()) > 1e-12) { skin.invertToRef(inverse); Vector3.TransformNormalToRef(delta, inverse, delta); }
        }
        pos[v * 3] += delta.x; pos[v * 3 + 1] += delta.y; pos[v * 3 + 2] += delta.z;
        deform.touch(v); p.moved.push(v);
      }
      // Normals around what moved now and what moved before (now back in place)
      if (p.moved.length) deform.updateNormals(p.moved);
      if (previous.length) deform.updateNormals(previous);
      deform.upload();
    }
    this.editor.invalidate();
  }
}

function addInfluences(sum: Float32Array, bones: Float32Array, ids: ArrayLike<number>, weights: ArrayLike<number>, v: number) {
  for (let c = 0; c < 4; c++) {
    const weight = weights[v * 4 + c];
    if (!weight) continue;
    const o = ids[v * 4 + c] * 16;
    for (let k = 0; k < 16; k++) sum[k] += bones[o + k] * weight;
  }
}

/** Surfaces of one tool object: exact for the app's sphere, box and cylinder, triangles otherwise. */
function toolSurfaces(tool: Entity): WrapSurface[] {
  return tool.meshes.filter((m): m is Mesh => m instanceof Mesh && !!m.getTotalIndices()).map((mesh) => {
    const local = new Vector3(), out = new Vector3();
    if (tool.primitive && EXACT.has(tool.primitive) && !tool.separation) {
      const shape = tool.primitive as 'sphere' | 'box' | 'cylinder';
      return { closest: (p, result) => {
        const world = mesh.computeWorldMatrix(true);
        Vector3.TransformCoordinatesToRef(p, world.clone().invert(), local);
        const inside = shapePoint(shape, local.x, local.y, local.z, out);
        Vector3.TransformCoordinatesToRef(out, world, result);
        return inside;
      } };
    }
    const grid = new TriangleGrid(mesh);
    return { closest: (p, result) => {
      const world = mesh.computeWorldMatrix(true);
      Vector3.TransformCoordinatesToRef(p, world.clone().invert(), local);
      const inside = grid.closest(local, out);
      Vector3.TransformCoordinatesToRef(out, world, result);
      return inside;
    } };
  });
}

/** Closest point on a unit shape's surface (local space, centered) into `out`; true when inside. */
function shapePoint(shape: 'sphere' | 'box' | 'cylinder', x: number, y: number, z: number, out: Vector3): boolean {
  if (shape === 'sphere') {
    const r = Math.hypot(x, y, z);
    if (r < 1e-9) { out.set(0, 0.5, 0); return true; }
    out.set(x / r * 0.5, y / r * 0.5, z / r * 0.5);
    return r < 0.5;
  }
  if (shape === 'cylinder') {
    const rr = Math.hypot(x, z), inside = rr < 0.5 && Math.abs(y) < 0.5;
    const sx = rr < 1e-9 ? 0.5 : x / rr * 0.5, sz = rr < 1e-9 ? 0 : z / rr * 0.5, sy = Math.max(-0.5, Math.min(0.5, y));
    const k = rr > 0.5 ? 0.5 / rr : 1, cy = y >= 0 ? 0.5 : -0.5;
    if (inside) {
      if (0.5 - rr < 0.5 - Math.abs(y)) out.set(sx, y, sz); else out.set(x, cy, z);
    } else if ((x - sx) ** 2 + (y - sy) ** 2 + (z - sz) ** 2 < (x - x * k) ** 2 + (y - cy) ** 2 + (z - z * k) ** 2) out.set(sx, sy, sz);
    else out.set(x * k, cy, z * k);
    return inside;
  }
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  const inside = ax < 0.5 && ay < 0.5 && az < 0.5;
  if (inside) {
    const dx = 0.5 - ax, dy = 0.5 - ay, dz = 0.5 - az;
    if (dx <= dy && dx <= dz) out.set(Math.sign(x || 1) * 0.5, y, z);
    else if (dy <= dz) out.set(x, Math.sign(y || 1) * 0.5, z);
    else out.set(x, y, Math.sign(z || 1) * 0.5);
  } else out.set(Math.max(-0.5, Math.min(0.5, x)), Math.max(-0.5, Math.min(0.5, y)), Math.max(-0.5, Math.min(0.5, z)));
  return inside;
}

/**
 * Triangles of a mesh (local space, as shown) bucketed in a uniform grid, for closest-point
 * queries: cells are searched in growing shells until no closer triangle can remain.
 */
class TriangleGrid {
  private readonly p: Float32Array;
  private readonly idx: Uint32Array;
  private readonly start: Uint32Array;
  private readonly list: Uint32Array;
  private readonly stamp: Uint32Array;
  private query = 0;
  private readonly n: [number, number, number];
  private readonly origin: Vector3;
  private readonly cell: number;
  private readonly winding: number;

  constructor(mesh: Mesh) {
    const p = this.p = Float32Array.from(mesh.getPositionData(true, true) ?? mesh.getVerticesData('position')!);
    const idx = this.idx = Uint32Array.from(mesh.getIndices()!), faces = idx.length / 3;
    const lo = new Vector3(Infinity, Infinity, Infinity), hi = new Vector3(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < p.length; i += 3) { lo.minimizeInPlaceFromFloats(p[i], p[i + 1], p[i + 2]); hi.maximizeInPlaceFromFloats(p[i], p[i + 1], p[i + 2]); }
    const size = hi.subtract(lo), longest = Math.max(size.x, size.y, size.z, 1e-6);
    // About two triangles per cell
    const cell = this.cell = Math.max(longest / 128, Math.cbrt(Math.max(size.x, 1e-6) * Math.max(size.y, 1e-6) * Math.max(size.z, 1e-6) / Math.max(1, faces / 2)));
    this.origin = lo;
    const n = this.n = [Math.max(1, Math.ceil(size.x / cell)), Math.max(1, Math.ceil(size.y / cell)), Math.max(1, Math.ceil(size.z / cell))];
    const counts = new Uint32Array(n[0] * n[1] * n[2] + 1);
    const each = (f: number, fn: (c: number) => void) => {
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let j = 0; j < 3; j++) { const o = idx[f * 3 + j] * 3; x0 = Math.min(x0, p[o]); y0 = Math.min(y0, p[o + 1]); z0 = Math.min(z0, p[o + 2]); x1 = Math.max(x1, p[o]); y1 = Math.max(y1, p[o + 1]); z1 = Math.max(z1, p[o + 2]); }
      const a = this.cellOf(x0, y0, z0), b = this.cellOf(x1, y1, z1);
      for (let i = a[0]; i <= b[0]; i++) for (let j = a[1]; j <= b[1]; j++) for (let k = a[2]; k <= b[2]; k++) fn(i + n[0] * (j + n[1] * k));
    };
    for (let f = 0; f < faces; f++) each(f, (c) => counts[c + 1]++);
    for (let c = 1; c < counts.length; c++) counts[c] += counts[c - 1];
    this.start = counts.slice();
    const list = this.list = new Uint32Array(counts[counts.length - 1]), fill = counts.slice();
    for (let f = 0; f < faces; f++) each(f, (c) => { list[fill[c]++] = f; });
    this.stamp = new Uint32Array(faces);
    // Which way the triangles face, so inside/outside comes from their winding
    const normals = mesh.getVerticesData('normal');
    let winding = 1;
    if (normals) for (let f = 0; f < faces; f++) {
      const a = idx[f * 3] * 3, b = idx[f * 3 + 1] * 3, c = idx[f * 3 + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      const dot = (uy * vz - uz * vy) * normals[a] + (uz * vx - ux * vz) * normals[a + 1] + (ux * vy - uy * vx) * normals[a + 2];
      if (Math.abs(dot) > 1e-12) { winding = dot > 0 ? 1 : -1; break; }
    }
    this.winding = winding;
  }

  private cellOf(x: number, y: number, z: number): [number, number, number] {
    const c = (v: number, o: number, n: number) => Math.min(n - 1, Math.max(0, Math.floor((v - o) / this.cell)));
    return [c(x, this.origin.x, this.n[0]), c(y, this.origin.y, this.n[1]), c(z, this.origin.z, this.n[2])];
  }

  /** Closest point on the triangles into `out`; true when `q` is behind the closest triangle (inside). */
  closest(q: Vector3, out: Vector3) {
    const [cx, cy, cz] = this.cellOf(q.x, q.y, q.z), n = this.n, p = this.p, idx = this.idx;
    const stamp = ++this.query;
    let best = Infinity, face = -1, bx = 0, by = 0, bz = 0;
    const r = new Float64Array(3);
    const maxShell = Math.max(n[0], n[1], n[2]);
    for (let s = 0; s <= maxShell; s++) {
      for (let i = cx - s; i <= cx + s; i++) for (let j = cy - s; j <= cy + s; j++) for (let k = cz - s; k <= cz + s; k++) {
        if (Math.max(Math.abs(i - cx), Math.abs(j - cy), Math.abs(k - cz)) !== s) continue;
        if (i < 0 || j < 0 || k < 0 || i >= n[0] || j >= n[1] || k >= n[2]) continue;
        const c = i + n[0] * (j + n[1] * k);
        for (let t = this.start[c]; t < this.start[c + 1]; t++) {
          const f = this.list[t];
          if (this.stamp[f] === stamp) continue;
          this.stamp[f] = stamp;
          closestOnTriangle(q.x, q.y, q.z, p, idx[f * 3] * 3, idx[f * 3 + 1] * 3, idx[f * 3 + 2] * 3, r);
          const d = (r[0] - q.x) ** 2 + (r[1] - q.y) ** 2 + (r[2] - q.z) ** 2;
          if (d < best) { best = d; face = f; bx = r[0]; by = r[1]; bz = r[2]; }
        }
      }
      // Cells beyond this shell are at least `s` cells away
      if (face >= 0 && best <= (s * this.cell) ** 2) break;
    }
    out.set(bx, by, bz);
    if (face < 0) return false;
    const a = idx[face * 3] * 3, b = idx[face * 3 + 1] * 3, c = idx[face * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const side = ((uy * vz - uz * vy) * (q.x - bx) + (uz * vx - ux * vz) * (q.y - by) + (ux * vy - uy * vx) * (q.z - bz)) * this.winding;
    return side < 0;
  }
}

/** Closest point on triangle (a, b, c offsets into p) to (x, y, z), into r (Ericson, Real-Time Collision Detection). */
function closestOnTriangle(x: number, y: number, z: number, p: Float32Array, a: number, b: number, c: number, r: Float64Array) {
  const abx = p[b] - p[a], aby = p[b + 1] - p[a + 1], abz = p[b + 2] - p[a + 2];
  const acx = p[c] - p[a], acy = p[c + 1] - p[a + 1], acz = p[c + 2] - p[a + 2];
  const apx = x - p[a], apy = y - p[a + 1], apz = z - p[a + 2];
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) { r[0] = p[a]; r[1] = p[a + 1]; r[2] = p[a + 2]; return; }
  const bpx = x - p[b], bpy = y - p[b + 1], bpz = z - p[b + 2];
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { r[0] = p[b]; r[1] = p[b + 1]; r[2] = p[b + 2]; return; }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); r[0] = p[a] + abx * v; r[1] = p[a + 1] + aby * v; r[2] = p[a + 2] + abz * v; return; }
  const cpx = x - p[c], cpy = y - p[c + 1], cpz = z - p[c + 2];
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { r[0] = p[c]; r[1] = p[c + 1]; r[2] = p[c + 2]; return; }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); r[0] = p[a] + acx * w; r[1] = p[a + 1] + acy * w; r[2] = p[a + 2] + acz * w; return; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    r[0] = p[b] + (p[c] - p[b]) * w; r[1] = p[b + 1] + (p[c + 1] - p[b + 1]) * w; r[2] = p[b + 2] + (p[c + 2] - p[b + 2]) * w; return;
  }
  const denom = 1 / (va + vb + vc), v = vb * denom, w = vc * denom;
  r[0] = p[a] + abx * v + acx * w; r[1] = p[a + 1] + aby * v + acy * w; r[2] = p[a + 2] + abz * v + acz * w;
}
