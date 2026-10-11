import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { GizmoManager } from '@babylonjs/core/Gizmos/gizmoManager.js';
import type { Editor, Entity } from '../core/editor';
import type { MeshPart } from './parts';
import { applyPart, capturePart } from './parts';
import type { FaceSelection } from './selection';

type Sample = [number, number, number];
/** Plane clipping interpolates from original triangle barycentrics, including morph streams. */
export function cutMesh(mesh: Mesh, origin: Vector3, normal: Vector3, exact: boolean, limit?: Set<number>): [MeshPart, MeshPart] {
  // Sides are decided on the model as shown (pose and morphs applied); new vertices interpolate the stored attributes
  const src = capturePart(mesh, exact), positions = mesh.getPositionData(true, true) ?? mesh.getVerticesData('position')!, world = mesh.computeWorldMatrix(true);
  const output: [MeshPart, MeshPart] = [0, 1].map(() => ({ indices: [], materials: [], ...(exact ? { attributes: Object.fromEntries(Object.keys(src.attributes!).map(k => [k, []])), morphs: src.morphs?.map(m => ({ ...m, attributes: Object.fromEntries(Object.keys(m.attributes).map(k => [k, []])) })) } : {}) })) as unknown as [MeshPart, MeshPart];
  const size = mesh.getTotalVertices();
  const append = (out: MeshPart, verts: number[], bary: Sample) => {
    const index = out.attributes!.position.length / 3;
    const interpolate = (source: Record<string, number[]>, dest: Record<string, number[]>) => {
      for (const [kind, values] of Object.entries(source)) {
        const stride = values.length / size;
        const a = Array.from({ length: stride }, (_, c) => bary.reduce((v, weight, j) => v + weight * values[verts[j] * stride + c], 0));
        if (kind === 'normal' || kind === 'tangent') { const length = Math.hypot(...a.slice(0, 3)) || 1; for (let c = 0; c < 3; c++) a[c] /= length; if (kind === 'tangent' && stride === 4) a[3] = a[3] < 0 ? -1 : 1; }
        dest[kind].push(...a);
      }
    };
    interpolate(src.attributes!, out.attributes!);
    // Bone IDs are categorical. Blend weighted influences by ID, retain the strongest 4/8.
    if (src.attributes!.matricesIndices && src.attributes!.matricesWeights) {
      const influences = new Map<number, number>();
      const extra = !!src.attributes!.matricesIndicesExtra;
      for (let v = 0; v < 3; v++) for (const suffix of extra ? ['', 'Extra'] : ['']) for (let c = 0; c < 4; c++) {
        const bone = src.attributes![`matricesIndices${suffix}`][verts[v] * 4 + c];
        const weight = src.attributes![`matricesWeights${suffix}`][verts[v] * 4 + c] * bary[v];
        influences.set(bone, (influences.get(bone) ?? 0) + weight);
      }
      const sorted = [...influences].sort((a, b) => b[1] - a[1]).slice(0, extra ? 8 : 4), total = sorted.reduce((s, [, w]) => s + w, 0) || 1;
      for (const [offset, suffix] of (extra ? [[0, ''], [4, 'Extra']] : [[0, '']]) as [number, string][]) for (let c = 0; c < 4; c++) {
        out.attributes![`matricesIndices${suffix}`][index * 4 + c] = sorted[offset + c]?.[0] ?? 0;
        out.attributes![`matricesWeights${suffix}`][index * 4 + c] = (sorted[offset + c]?.[1] ?? 0) / total;
      }
    }
    src.morphs?.forEach((m, i) => interpolate(m.attributes, out.morphs![i].attributes));
    return index;
  };
  for (const material of src.materials) {
    const starts = output.map(p => p.indices.length);
    for (let i = material.start; i < material.start + material.count; i += 3) {
      const vertices = src.indices.slice(i, i + 3);
      const distances = vertices.map(v => Vector3.Dot(Vector3.TransformCoordinates(Vector3.FromArray(positions, v * 3), world).subtract(origin), normal));
      const included = !limit || limit.has(i / 3);
      if (!exact) { const side = included && distances.reduce((s, d) => s + d, 0) >= 0 ? 0 : 1; output[side].indices.push(...vertices); continue; }
      for (let side = 0; side < 2; side++) {
        if (!included && side === 0) continue;
        const triangle: Sample[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
        const polygon: Sample[] = [];
        if (!included) polygon.push(...triangle);
        else for (let v = 0; v < 3; v++) {
          const next = (v + 1) % 3, a = distances[v] * (side ? -1 : 1), b = distances[next] * (side ? -1 : 1);
          if (a >= 0) polygon.push(triangle[v]);
          if ((a > 0 && b < 0) || (a < 0 && b > 0)) { const t = a / (a - b); polygon.push(triangle[v].map((w, c) => w * (1 - t) + triangle[next][c] * t) as Sample); }
        }
        // Coplanar triangles belong to the positive side exactly once.
        if (included && side === 1 && distances.every(d => Math.abs(d) < 1e-10)) continue;
        if (polygon.length < 3) continue;
        const ids = polygon.map(b => append(output[side], vertices, b));
        for (let v = 1; v + 1 < ids.length; v++) output[side].indices.push(ids[0], ids[v], ids[v + 1]);
      }
    }
    output.forEach((p, side) => p.materials.push({ material: material.material, start: starts[side], count: p.indices.length - starts[side] }));
  }
  return output;
}

export class PlaneCut {
  readonly plane: Mesh;
  readonly gizmos: GizmoManager;
  exact = false;
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
    this.plane = MeshBuilder.CreatePlane('Cut plane', { size: Math.max(bounds.size.length(), 0.1), sideOrientation: Mesh.DOUBLESIDE }, editor.scene);
    this.plane.isPickable = false; editor.overlays.add(this.plane);
    for (const color of ['#bb98df', '#e6b94a', '#44216b']) { const m = new StandardMaterial('Cut preview', editor.scene); m.diffuseColor = m.emissiveColor = Color3.FromHexString(color); m.alpha = 0.34; m.disableLighting = true; m.backFaceCulling = false; m.zOffset = -3; this.materials.push(m); }
    this.plane.material = this.materials[0]; this.plane.position.copyFrom(bounds.min.add(bounds.max).scale(0.5)); this.snap('horizontal');
    this.gizmos = new GizmoManager(editor.scene); this.gizmos.usePointerToAttachGizmos = false; this.gizmos.positionGizmoEnabled = true; this.gizmos.rotationGizmoEnabled = true; this.gizmos.attachToMesh(this.plane);
    this.observer = editor.scene.onBeforeRenderObservable.add(() => { const key = this.plane.position.asArray().join() + this.plane.rotationQuaternion?.asArray().join() + this.exact + this.limited; if (key !== this.signature) { this.signature = key; clearTimeout(this.timer); this.timer = window.setTimeout(() => this.preview(), 150); } });
    this.preview();
  }
  snap(axis: 'horizontal' | 'vertical' | 'camera') { const normal = axis === 'horizontal' ? Vector3.Up() : axis === 'vertical' ? Vector3.Right() : this.editor.camera.getForwardRay().direction; this.plane.rotationQuaternion = Quaternion.FromUnitVectorsToRef(Vector3.Forward(), normal.normalize(), new Quaternion()); this.editor.invalidate(); }
  center() { const b = this.editor.boundsOf(this.entity); this.plane.position.copyFrom(b.min.add(b.max).scale(0.5)); this.editor.invalidate(); }
  calculate(): [MeshPart[], MeshPart[]] {
    const normal = Vector3.TransformNormal(Vector3.Forward(), this.plane.computeWorldMatrix(true)).normalize();
    const cuts = this.entity.meshes.map(m => cutMesh(m as Mesh, this.plane.position, normal, this.exact, this.limited ? this.selection.faces.get(m as Mesh) ?? new Set() : undefined));
    return [cuts.map(c => c[0]), cuts.map(c => c[1])];
  }
  preview() {
    this.clearPreview();
    const parts = this.calculate();
    parts.forEach((side, s) => side.forEach((part, i) => {
      if (!part.indices.length) return;
      const src = this.entity.meshes[i] as Mesh, mesh = new Mesh('Cut side', this.editor.scene);
      src.geometry?.applyToMesh(mesh); mesh.parent = src; mesh.skeleton = src.skeleton; mesh.morphTargetManager = src.morphTargetManager;
      applyPart(mesh, part); mesh.material = this.materials[s + 1]; mesh.isPickable = false;
      this.editor.overlays.add(mesh); this.previews.push(mesh);
    })); this.editor.invalidate();
  }
  private clearPreview() { for (const m of this.previews) { this.editor.overlays.delete(m); m.dispose(false, false); } this.previews = []; }
  dispose() { clearTimeout(this.timer); this.editor.scene.onBeforeRenderObservable.remove(this.observer); this.gizmos.dispose(); this.clearPreview(); this.editor.overlays.delete(this.plane); this.plane.dispose(); this.materials.forEach(m => m.dispose()); this.editor.invalidate(); }
}
