import { capturePart } from './parts';
import { normalSign } from './normals';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MultiMaterial } from '@babylonjs/core/Materials/multiMaterial.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import type { Editor, Entity } from '../core/editor';
import { copyMesh, spawnComposite, staticMeshBlocker, cloneMaterial, disposeMeshCopy } from './combine';
import type { PartOrigin } from './combine';
import { applyPart } from './parts';
import type { BooleanOperation, SolidInput, FuseResult } from './fuse.worker';
export type { BooleanOperation } from './fuse.worker';
import { tr } from '../core/i18n';

/**
 * Boolean operations between objects (Figma's Union / Subtract / Intersect, with Manifold in a
 * worker): the first entity is the target, the others the tools. Shows a preview; Apply replaces
 * the originals with the result (one undo step).
 */
export class Fusion {
  busy = false;
  preview: Entity | null = null;
  operation: BooleanOperation = 'union';
  private generation = 0;
  private worker: Worker | null = null;
  private originals: Entity[] = [];
  private enabled: boolean[] = [];
  private reject: ((error: Error) => void) | null = null;
  readonly editor: Editor;
  constructor(editor: Editor) { this.editor = editor; }
  async start(entities = this.editor.selection, operation: BooleanOperation = 'union') {
    this.cancel();
    this.operation = operation;
    const generation = ++this.generation;
    if (entities.length < 2) throw new Error(tr('Select at least two objects.'));
    for (const e of entities) { const reason = staticMeshBlocker(e); if (reason) throw new Error(reason); }
    const materials: { material: Material; origin: PartOrigin }[] = [], inputs: SolidInput[] = [];
    const kinds = [{ kind: 'position', stride: 3 }, { kind: 'normal', stride: 3 }, { kind: 'uv', stride: 2 },
      ...['uv2', 'uv3', 'uv4', 'uv5', 'uv6', 'color'].filter(kind => entities.some(e => e.meshes.some(m => m.isVerticesDataPresent(kind)))).map(kind => ({ kind, stride: kind === 'color' ? 4 : 2 }))];
    const width = kinds.reduce((n, k) => n + k.stride, 0);
    const templates: Mesh[] = [];
    try {
      for (const e of entities) {
        const properties: number[] = [], indices: number[] = [], runs: number[] = [], ids: number[] = [];
        for (const [mi, m] of e.meshes.entries()) {
          if (!m.getTotalIndices()) continue;
          const copy = copyMesh(m as Mesh, m.computeWorldMatrix(true)); templates.push(copy);
          const streams = kinds.map(k => copy.getVerticesData(k.kind));
          const offset = properties.length / width;
          for (let i = 0; i < copy.getTotalVertices(); i++) for (const [ki, k] of kinds.entries()) for (let c = 0; c < k.stride; c++) properties.push(streams[ki]?.[i * k.stride + c] ?? (k.kind === 'color' || k.kind === 'normal' && c === 1 ? 1 : 0));
          const faces = copy.getIndices()!;
          const winding = normalSign(capturePart(copy, true));
          for (const sub of copy.subMeshes) {
            if (!sub.indexCount) continue;
            const mat = copy.material instanceof MultiMaterial ? copy.material.subMaterials[sub.materialIndex] : copy.material;
            if (!mat) throw new Error(tr('This material cannot be copied.'));
            runs.push(indices.length); ids.push(materials.length);
            const origin = e.composite?.origins[mi] ?? { asset: e.source?.asset, primitive: e.primitive, mesh: mi };
            materials.push({ material: mat, origin: { ...origin, material: copy.material instanceof MultiMaterial ? sub.materialIndex : origin.material } });
            for (let i = sub.indexStart; i < sub.indexStart + sub.indexCount; i += 3) indices.push(...(winding > 0 ? [faces[i + 2], faces[i + 1], faces[i]] : [faces[i], faces[i + 1], faces[i + 2]]).map(v => v + offset));
          }
        }
        runs.push(indices.length);
        inputs.push({ numProp: width, properties: Float32Array.from(properties), indices: Uint32Array.from(indices), runs: Uint32Array.from(runs), materials: Uint32Array.from(ids) });
      }
      this.originals = [...entities]; this.enabled = entities.map(e => e.root.isEnabled());
      this.busy = true; this.editor.refreshTool(); this.editor.notify('tool');
      const worker = this.worker = new Worker(new URL('./fuse.worker.ts', import.meta.url), { type: 'module' });
      const output = await new Promise<FuseResult>((resolve, reject) => {
        this.reject = reject;
        worker.onmessage = ev => ev.data.result ? resolve(ev.data.result) : reject(new Error(tr('Boolean operations need closed surfaces that overlap. Use Combine for open parts.')));
        worker.onerror = () => reject(new Error(tr('The boolean operation could not run. Try combining the objects.')));
        worker.postMessage({ solids: inputs, operation }, inputs.flatMap(i => [i.properties.buffer, i.indices.buffer, i.runs.buffer, i.materials.buffer]));
      });
      if (this.worker !== worker || entities.some(e => !this.editor.entities.includes(e))) throw new Error(tr('Boolean operation cancelled'));
      const meshes: Mesh[] = [], origins: PartOrigin[] = [];
      for (let run = 0; run < output.materials.length; run++) {
        const original = materials[output.materials[run]];
        if (!original) throw new Error(tr('The boolean operation could not run. Try combining the objects.'));
        const attributes: Record<string, number[]> = Object.fromEntries(kinds.map(k => [k.kind, []]));
        const indices: number[] = [], remap = new Map<number, number>();
        for (let i = output.runs[run]; i < output.runs[run + 1]; i += 3) for (const k of [i + 2, i + 1, i]) {
          const index = output.indices[k]; let target = remap.get(index);
          if (target === undefined) {
            target = attributes.position.length / 3; remap.set(index, target); let start = index * output.numProp;
            for (const k of kinds) { attributes[k.kind].push(...output.properties.slice(start, start + k.stride)); start += k.stride; }
          }
          indices.push(target);
        }
        if (!indices.length) continue;
        const mesh = new Mesh(tr('Boolean result'), this.editor.scene);
        mesh.overrideMaterialSideOrientation = Material.CounterClockWiseSideOrientation;
        applyPart(mesh, { indices, materials: [{ material: 0, start: 0, count: indices.length }], attributes });
        mesh.material = cloneMaterial(original.material); meshes.push(mesh); origins.push(original.origin);
      }
      if (!meshes.length) throw new Error(tr('The boolean operation could not run. Try combining the objects.'));
      this.preview = spawnComposite(this.editor, operation === 'union' ? tr('Union') : operation === 'subtract' ? tr('Subtraction') : tr('Intersection'), meshes, origins, false, false);
      for (const m of [this.preview.root, ...this.preview.meshes]) { this.editor.overlays.add(m); m.isPickable = false; }
      entities.forEach(e => e.root.setEnabled(false));
      this.editor.invalidate();
    } finally {
      templates.forEach(disposeMeshCopy);
      if (generation === this.generation) { this.worker?.terminate(); this.worker = null; this.reject = null; this.busy = false; this.editor.refreshTool(); this.editor.notify('tool'); }
    }
  }
  apply() {
    const result = this.preview; if (!result) return;
    if (this.originals.some(e => !this.editor.entities.includes(e))) { this.cancel(); return; }
    this.restoreSources();
    for (const m of [result.root, ...result.meshes]) { this.editor.overlays.delete(m); m.isPickable = m !== result.root; }
    const originals = this.originals; this.preview = null; this.originals = [];
    this.editor.group(() => { originals.forEach(e => this.editor.remove(e)); this.editor.publishSeparated(result); });
    this.editor.select(result); this.editor.notify('entities');
  }
  private restoreSources() { this.originals.forEach((e, i) => e.root.setEnabled(this.enabled[i])); }
  cancel() {
    this.generation++;
    this.worker?.terminate(); this.worker = null; this.reject?.(new Error(tr('Boolean operation cancelled'))); this.reject = null;
    this.restoreSources();
    if (this.preview) { for (const m of [this.preview.root, ...this.preview.meshes]) this.editor.overlays.delete(m); this.preview.meshes.forEach(m => disposeMeshCopy(m as Mesh)); this.preview.root.dispose(); this.preview.source?.container.dispose(); }
    this.preview = null; this.originals = []; this.busy = false; this.editor.refreshTool(); this.editor.invalidate(); this.editor.notify('tool');
  }
}
