import { tr } from '../core/i18n';
import { fillHoles } from './holes';
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { GizmoManager } from '@babylonjs/core/Gizmos/gizmoManager.js';
import { applyTransformGizmoStyle, TRANSFORM_GIZMO_THICKNESS } from '../core/gizmoStyle';
import { TransformGizmoVisuals } from '../core/transformGizmoVisuals';
import type { Editor, Entity } from '../core/editor';
import type { FaceLookup, MeshPart } from './parts';
import { capturePart, compactFaces, mergeLocal } from './parts';
import type { FaceSelection } from './selection';
import { disposeShared, sharedMesh } from './selection';

/** Signed distance of every vertex (as shown: pose and shape keys applied) to a world plane. */
export function planeDistances(mesh: Mesh, origin: Vector3, normal: Vector3) {
  const shown = mesh.getPositionData(true, true) ?? mesh.getVerticesData('position')!;
  const m = mesh.computeWorldMatrix(true).m, count = shown.length / 3, out = new Float32Array(count);
  const nx = normal.x, ny = normal.y, nz = normal.z, d0 = origin.x * nx + origin.y * ny + origin.z * nz;
  for (let i = 0; i < count; i++) {
    const x = shown[i * 3], y = shown[i * 3 + 1], z = shown[i * 3 + 2];
    const w = x * m[3] + y * m[7] + z * m[11] + m[15];
    const wx = (x * m[0] + y * m[4] + z * m[8] + m[12]) / w, wy = (x * m[1] + y * m[5] + z * m[9] + m[13]) / w, wz = (x * m[2] + y * m[6] + z * m[10] + m[14]) / w;
    out[i] = wx * nx + wy * ny + wz * nz - d0;
  }
  return out;
}

/**
 * Splits a mesh by a plane. Whole mode: each triangle goes to the side of its center (no new
 * vertices). Exact mode: only triangles the plane crosses are clipped; new vertices sit on the
 * crossed edges (one per edge, shared by both sides) and interpolate every attribute, skin
 * weights included. Untouched triangles keep their vertices. Both sides keep the full vertex
 * streams (like any subset), so attribute arrays are shared, not copied per side.
 */
export function cutMesh(mesh: Mesh, origin: Vector3, normal: Vector3, exact: boolean, limit?: FaceLookup): [MeshPart, MeshPart] {
  const indices = mesh.getIndices()!, distance = planeDistances(mesh, origin, normal);
  const materials = mesh.subMeshes.map((s) => ({ material: s.materialIndex, start: s.indexStart, count: s.indexCount }));
  if (!exact) {
    const side = new Uint8Array(indices.length / 3), counts = [0, 0];
    for (let f = 0; f < side.length; f++) {
      const a = indices[f * 3], b = indices[f * 3 + 1], c = indices[f * 3 + 2];
      side[f] = (!limit || limit.has(f)) && distance[a] + distance[b] + distance[c] >= 0 ? 0 : 1;
      counts[side[f]] += 3;
    }
    return [0, 1].map((s) => {
      const out = new Uint32Array(counts[s]), runs: MeshPart['materials'] = [];
      let k = 0;
      for (const run of materials) {
        const begin = k;
        for (let i = run.start; i < run.start + run.count; i += 3) if (side[i / 3] === s) { out[k++] = indices[i]; out[k++] = indices[i + 1]; out[k++] = indices[i + 2]; }
        runs.push({ material: run.material, start: begin, count: k - begin });
      }
      return { indices: out, materials: runs };
    }) as [MeshPart, MeshPart];
  }
  const src = capturePart(mesh, true), count = mesh.getTotalVertices();
  // New vertices on crossed edges: (a, b, t), keyed by the edge so both sides share them
  const edgeVertex = new Map<number, number>(), newA: number[] = [], newB: number[] = [], newT: number[] = [];
  const onEdge = (a: number, b: number) => {
    const key = a < b ? a * count + b : b * count + a;
    let v = edgeVertex.get(key);
    if (v === undefined) {
      v = count + newA.length;
      newA.push(a); newB.push(b); newT.push(distance[a] / (distance[a] - distance[b]));
      edgeVertex.set(key, v);
    }
    return v;
  };
  const out: [number[], number[]] = [[], []], runs: [MeshPart['materials'], MeshPart['materials']] = [[], []];
  const polygon: number[] = [];
  for (const run of materials) {
    const begin = [out[0].length, out[1].length];
    for (let i = run.start; i < run.start + run.count; i += 3) {
      const v = [indices[i], indices[i + 1], indices[i + 2]], d = v.map((x) => distance[x]);
      const included = !limit || limit.has(i / 3);
      const positive = d[0] >= 0 && d[1] >= 0 && d[2] >= 0, negative = d[0] <= 0 && d[1] <= 0 && d[2] <= 0;
      // Untouched triangles (and those outside a limited cut) keep their vertices
      if (!included || (negative && !positive)) { out[1].push(v[0], v[1], v[2]); continue; }
      if (positive) { out[0].push(v[0], v[1], v[2]); continue; }
      for (let s = 0; s < 2; s++) {
        polygon.length = 0;
        const sign = s ? -1 : 1;
        for (let j = 0; j < 3; j++) {
          const n = (j + 1) % 3, a = d[j] * sign, b = d[n] * sign;
          if (a >= 0) polygon.push(v[j]);
          if ((a > 0 && b < 0) || (a < 0 && b > 0)) polygon.push(onEdge(v[j], v[n]));
        }
        for (let j = 1; j + 1 < polygon.length; j++) out[s].push(polygon[0], polygon[j], polygon[j + 1]);
      }
    }
    for (let s = 0; s < 2; s++) runs[s].push({ material: run.material, start: begin[s], count: out[s].length - begin[s] });
  }
  // Attributes: originals as they are, then the new edge vertices interpolated
  const added = newA.length, attributes: Record<string, Float32Array> = {};
  for (const [kind, values] of Object.entries(src.attributes!)) {
    const stride = values.length / count, arr = new Float32Array((count + added) * stride);
    arr.set(values);
    if (kind.startsWith('matricesIndices') || kind.startsWith('matricesWeights')) { attributes[kind] = arr; continue; }
    for (let k = 0; k < added; k++) {
      const a = newA[k] * stride, b = newB[k] * stride, t = newT[k], o = (count + k) * stride;
      for (let c = 0; c < stride; c++) arr[o + c] = values[a + c] + (values[b + c] - values[a + c]) * t;
      if (kind === 'normal' || kind === 'tangent') {
        const l = Math.hypot(arr[o], arr[o + 1], arr[o + 2]) || 1;
        for (let c = 0; c < 3; c++) arr[o + c] /= l;
        if (kind === 'tangent' && stride === 4) arr[o + 3] = arr[o + 3] < 0 ? -1 : 1;
      }
    }
    attributes[kind] = arr;
  }
  // Skin: bone ids are categories; blend influences by id and keep the strongest 4 (or 8)
  if (src.attributes!.matricesIndices && src.attributes!.matricesWeights) {
    const extra = !!src.attributes!.matricesIndicesExtra;
    const suffixes = extra ? ['', 'Extra'] : [''];
    const influences = new Map<number, number>();
    for (let k = 0; k < added; k++) {
      influences.clear();
      for (const [vertex, share] of [[newA[k], 1 - newT[k]], [newB[k], newT[k]]] as const) for (const suffix of suffixes) for (let c = 0; c < 4; c++) {
        const bone = src.attributes![`matricesIndices${suffix}`][vertex * 4 + c], weight = src.attributes![`matricesWeights${suffix}`][vertex * 4 + c] * share;
        if (weight > 0) influences.set(bone, (influences.get(bone) ?? 0) + weight);
      }
      const sorted = [...influences].sort((x, y) => y[1] - x[1]).slice(0, extra ? 8 : 4), total = sorted.reduce((sum, [, w]) => sum + w, 0) || 1;
      suffixes.forEach((suffix, part) => {
        for (let c = 0; c < 4; c++) {
          attributes[`matricesIndices${suffix}`][(count + k) * 4 + c] = sorted[part * 4 + c]?.[0] ?? 0;
          attributes[`matricesWeights${suffix}`][(count + k) * 4 + c] = (sorted[part * 4 + c]?.[1] ?? 0) / total;
        }
      });
    }
  }
  const morphs = src.morphs?.map((m) => ({
    ...m,
    attributes: Object.fromEntries(Object.entries(m.attributes).map(([kind, values]) => {
      const stride = values.length / count, arr = new Float32Array((count + added) * stride);
      arr.set(values);
      for (let k = 0; k < added; k++) for (let c = 0; c < stride; c++) arr[(count + k) * stride + c] = values[newA[k] * stride + c] + (values[newB[k] * stride + c] - values[newA[k] * stride + c]) * newT[k];
      return [kind, arr];
    })),
  }));
  return [0, 1].map((s) => ({ indices: Uint32Array.from(out[s]), materials: runs[s], attributes, morphs })) as [MeshPart, MeshPart];
}

/**
 * Closes the opening a cut left on one side, working on the faces at the plane only (a small
 * local part) and putting the cap back into the full part.
 */
function capSide(part: MeshPart, plane: { origin: Vector3; normal: Vector3; tolerance: number }, material: number): MeshPart {
  const p = part.attributes!.position, near: number[] = [];
  const onPlane = (v: number) => Math.abs((p[v * 3] - plane.origin.x) * plane.normal.x + (p[v * 3 + 1] - plane.origin.y) * plane.normal.y + (p[v * 3 + 2] - plane.origin.z) * plane.normal.z) <= plane.tolerance;
  for (let f = 0; f < part.indices.length / 3; f++) if (onPlane(part.indices[f * 3]) || onPlane(part.indices[f * 3 + 1]) || onPlane(part.indices[f * 3 + 2])) near.push(f);
  if (!near.length) return part;
  const { local, globalOf } = compactFaces(part, near);
  const result = fillHoles(local, undefined, 0, plane);
  return mergeLocal(part, local, result, globalOf, material);
}

export class PlaneCut {
  readonly plane: Mesh;
  readonly gizmos: GizmoManager;
  private readonly visuals: TransformGizmoVisuals;
  exact = false;
  cap = false;
  capMaterial = 0;
  error: string | null = null;
  limited = false;
  private previews: Mesh[] = [];
  private materials: StandardMaterial[] = [];
  private observer: ReturnType<Editor['scene']['onBeforeRenderObservable']['add']>;
  private signature = '';
  /** The preview is recomputed shortly after the plane stops moving (cutting dense meshes is not free). */
  private timer = 0;
  readonly editor: Editor;
  readonly entity: Entity;
  readonly selection: FaceSelection;
  constructor(editor: Editor, selection: FaceSelection) {
    this.editor = editor; this.entity = selection.entity; this.selection = selection;
    const bounds = editor.boundsOf(this.entity);
    this.plane = CreatePlane('Cut plane', { size: Math.max(bounds.size.length(), 0.1), sideOrientation: Mesh.DOUBLESIDE }, editor.scene);
    this.plane.isPickable = false; editor.overlays.add(this.plane);
    for (const color of ['#bb98df', '#e6b94a', '#44216b']) { const m = new StandardMaterial('Cut preview', editor.scene); m.diffuseColor = m.emissiveColor = Color3.FromHexString(color); m.alpha = 0.34; m.disableLighting = true; m.backFaceCulling = false; m.zOffset = -3; this.materials.push(m); }
    this.plane.material = this.materials[0]; this.plane.position.copyFrom(bounds.min.add(bounds.max).scale(0.5)); this.snap('horizontal');
    this.gizmos = new GizmoManager(editor.scene, TRANSFORM_GIZMO_THICKNESS); this.gizmos.usePointerToAttachGizmos = false; this.gizmos.positionGizmoEnabled = true; this.gizmos.rotationGizmoEnabled = true; applyTransformGizmoStyle(this.gizmos); this.gizmos.attachToMesh(this.plane);
    this.visuals = new TransformGizmoVisuals(this.gizmos); this.visuals.ensure();
    this.observer = editor.scene.onBeforeRenderObservable.add(() => { const key = this.plane.position.asArray().join() + this.plane.rotationQuaternion?.asArray().join() + this.exact + this.limited + this.cap; if (key !== this.signature) { this.signature = key; clearTimeout(this.timer); this.timer = window.setTimeout(() => this.preview(), 150); } });
    this.preview();
  }
  snap(axis: 'horizontal' | 'vertical' | 'camera') { const normal = axis === 'horizontal' ? Vector3.Up() : axis === 'vertical' ? Vector3.Right() : this.editor.camera.getForwardRay().direction; this.plane.rotationQuaternion = Quaternion.FromUnitVectorsToRef(Vector3.Forward(), normal.normalize(), new Quaternion()); this.editor.invalidate(); }
  center() { const b = this.editor.boundsOf(this.entity); this.plane.position.copyFrom(b.min.add(b.max).scale(0.5)); this.editor.invalidate(); }
  calculate(): [MeshPart[], MeshPart[]] {
    const normal = Vector3.TransformNormal(Vector3.Forward(), this.plane.computeWorldMatrix(true)).normalize();
    const cuts = this.entity.meshes.map(m => cutMesh(m as Mesh, this.plane.position, normal, this.exact, this.limited ? this.selection.faces.get(m as Mesh) ?? new Set() : undefined));
    if (this.exact && this.cap) for (const [i, cut] of cuts.entries()) {
      const mesh = this.entity.meshes[i];
      // A rig made in the app shows its stored vertices as they are in the rest pose; a skeleton from
      // the file stores them in another (bind) pose, where the cut plane doesn't match the border
      if ((mesh.skeleton && !this.entity.rig) || mesh.morphTargetManager?.numTargets) throw new Error(tr('Closing the cut needs a model without a skeleton from its file or shape keys. Cut without closing, then use Close opening.'));
      const world = mesh.computeWorldMatrix(true);
      const plane = { origin: Vector3.TransformCoordinates(this.plane.position, world.clone().invert()), normal: Vector3.TransformNormal(normal, world.clone().transpose()).normalize(), tolerance: Math.max(...mesh.getBoundingInfo().boundingBox.extendSize.asArray()) * 1e-4 };
      const materials = Math.max(0, ...cut[0].materials.map(m => m.material), ...cut[1].materials.map(m => m.material));
      for (let side = 0; side < 2; side++) if (cut[side].indices.length) cut[side] = capSide(cut[side], plane, Math.min(this.capMaterial, materials));
    }
    return [cuts.map(c => c[0]), cuts.map(c => c[1])];
  }
  /**
   * Preview: which side each triangle goes to, tinted on meshes that borrow the model's GPU
   * buffers (no geometry copies while the plane moves). The exact cut and the closing are
   * computed once, on Separate.
   */
  preview() {
    const normal = Vector3.TransformNormal(Vector3.Forward(), this.plane.computeWorldMatrix(true)).normalize();
    this.entity.meshes.forEach((abstract, i) => {
      const mesh = abstract as Mesh;
      const [front, back] = cutMesh(mesh, this.plane.position, normal, false, this.limited ? this.selection.faces.get(mesh) : undefined);
      [front, back].forEach((part, s) => {
        let shown = this.previews[i * 2 + s];
        if (!shown || shown.metadata?.source !== mesh.getVertexBuffer('position')) {
          if (shown) { this.editor.overlays.delete(shown); disposeShared(shown); }
          shown = sharedMesh(mesh, 'Cut side');
          shown.material = this.materials[s + 1];
          this.editor.overlays.add(shown);
          this.previews[i * 2 + s] = shown;
        }
        shown.setIndices(part.indices, mesh.getTotalVertices(), true);
        shown.setEnabled(part.indices.length > 0);
      });
    });
    if (this.error) { this.error = null; this.editor.notify('tool'); }
    this.editor.invalidate();
  }
  private clearPreview() { for (const m of this.previews) if (m) { this.editor.overlays.delete(m); disposeShared(m); } this.previews = []; }
  dispose() { clearTimeout(this.timer); this.editor.scene.onBeforeRenderObservable.remove(this.observer); this.visuals.dispose(); this.gizmos.dispose(); this.clearPreview(); this.editor.overlays.delete(this.plane); this.plane.dispose(); this.materials.forEach(m => m.dispose()); this.editor.invalidate(); }
}
