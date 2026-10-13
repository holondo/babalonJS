import { Geometry } from '@babylonjs/core/Meshes/geometry.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture.js';
import type { Material } from '@babylonjs/core/Materials/material.js';
import type { Editor, Entity } from '../core/editor';
import { tr } from '../core/i18n';
import { simplifyMeshes } from './simplify';
import type { SimplifyMesh } from './simplify';
import { bakeNormals, bakedPng, bakedTexture, normalMapOf, pngTexture, setNormalMap } from './bake';
import { capturePart } from '../edit/parts';

/**
 * Optimized variants of models: fewer triangles, same look. Non-destructive and reversible
 * (one undo step), saved with projects, copied with duplicates, optionally with levels of detail
 * and usable only for an AR session.
 *
 * The simplifier keeps a subset of the original vertices, so every attribute of a kept vertex
 * (UVs, normals, colors, tangents, skin weights) is copied as is: textures, animations and poses
 * keep working.
 */

export type OptimizePreset = 'high' | 'balanced' | 'light';

/** Fraction of triangles kept by each preset. */
export const OPTIMIZE_PRESETS: { value: OptimizePreset; label: string; ratio: number }[] = [
  { value: 'high', label: 'High quality', ratio: 0.5 },
  { value: 'balanced', label: 'Balanced', ratio: 0.2 },
  { value: 'light', label: 'Lightest', ratio: 0.07 },
];

export interface OptimizeSettings {
  /** Fraction of triangles kept (0–1). */
  ratio: number;
  /** Keep open borders exactly in place. */
  lockBorder: boolean;
  /** Add two lighter levels used automatically when the object is small on screen. */
  lods: boolean;
  /** Bake the original's surface detail into a normal map of this size (null: no baking). */
  bakeSize?: number | null;
}

export const DEFAULT_OPTIMIZE: OptimizeSettings = { ratio: 0.2, lockBorder: true, lods: false, bakeSize: null };

/** Screen coverage below which each extra level is used, and its size relative to the main level. */
const LOD_LEVELS = [
  { coverage: 0.12, ratio: 0.35 },
  { coverage: 0.04, ratio: 0.1 },
];

interface MeshVariant {
  mesh: Mesh;
  /** Geometry before optimizing (shared with the loaded file and copies). */
  original: Geometry | null;
  optimized: Geometry;
  /** Kept triangles as indices into the original vertices, per level (saved in projects). */
  levels: Uint32Array[];
  lodMeshes: Mesh[];
  /** Normal map baked from the original (replaces the material's while optimized). */
  normal?: { material: Material; original: BaseTexture | null; texture: BaseTexture; png: Uint8Array; size: number };
}

export interface Optimization {
  settings: OptimizeSettings;
  /** Worst deviation relative to the model size. */
  error: number;
  before: { triangles: number; vertices: number };
  after: { triangles: number; vertices: number };
  meshes: MeshVariant[];
  /** Created only for an AR session (not saved, removed when AR ends). */
  session?: boolean;
}

/** Meshes the simplifier can work on: indexed triangle meshes without morph targets. */
export function optimizableMeshes(e: Entity): Mesh[] {
  return e.meshes.filter((m): m is Mesh => m instanceof Mesh && m.getTotalIndices() > 0 && !!m.getVerticesData('position') && !m.morphTargetManager?.numTargets);
}

export class ModelOptimizer {
  private readonly editor: Editor;
  /** Running computation (one at a time). */
  private task: { cancel: () => void } | null = null;
  progress: number | null = null;
  entity: Entity | null = null;
  phase: 'geometry' | 'bake' = 'geometry';

  constructor(editor: Editor) {
    this.editor = editor;
  }

  /** Why a model can't be optimized (null when it can). */
  blocker(e: Entity): string | null {
    if (e.kind !== 'model') return tr('Only models can be optimized.');
    if (e.rig) return tr('This model was rigged in the app: optimize it before rigging.');
    if (e.textureOptimization) return tr('Revert the texture optimization first, then change the geometry.');
    if (!optimizableMeshes(e).length) return tr('This model has no meshes that can be simplified.');
    return null;
  }

  get busy() {
    return this.progress !== null;
  }

  cancel() {
    this.task?.cancel();
  }

  /** Optimizes a model (replacing a previous optimization); one undo step. */
  async apply(e: Entity, settings: OptimizeSettings, record = true) {
    const reason = this.blocker(e);
    if (reason) throw new Error(reason);
    if (this.task) throw new Error(tr('An optimization is already running.'));
    const meshes = optimizableMeshes(e);
    const ratios = [settings.ratio, ...(settings.lods ? LOD_LEVELS.map((l) => settings.ratio * l.ratio) : [])];
    // Simplify from the original geometry even when an optimization is active
    const sources = meshes.map((m) => this.originalOf(e, m));
    this.progress = 0;
    this.entity = e;
    this.phase = 'geometry';
    this.editor.notify('activity');
    const simplify = simplifyMeshes(
      { meshes: sources.map((g, i) => simplifyInput(g ?? meshes[i].geometry!)), ratios, lockBorder: settings.lockBorder },
      (p) => {
        this.progress = p;
        this.editor.notify('activity');
      },
    );
    this.task = simplify;
    try {
      const levels = await simplify.promise;
      const perMesh = meshes.map((_, i) => levels.map((l) => l.indices[i]));
      const error = Math.max(...levels.map((l) => l.error));
      const before = e.optimization;
      const after = this.build(e, settings, perMesh, error);
      if (settings.bakeSize) await this.bake(after, settings.bakeSize);
      this.swap(e, before, after);
      if (record) this.editor.record({ undo: () => this.swap(e, after, before), redo: () => this.swap(e, before, after) });
      return after;
    } finally {
      this.task = null;
      this.progress = null;
      this.entity = null;
      this.editor.notify('activity');
    }
  }

  /** Back to the original geometry (one undo step). */
  revert(e: Entity) {
    const before = e.optimization;
    if (!before) return;
    if (e.textureOptimization) throw new Error(tr('Revert the texture optimization first, then change the geometry.'));
    this.swap(e, before, undefined);
    this.editor.record({ undo: () => this.swap(e, undefined, before), redo: () => this.swap(e, before, undefined) });
  }

  /**
   * Optimizes for an AR session only (no undo step, not saved); returns the function that puts
   * every model back. Models already optimized are left as they are.
   */
  async applyForSession(entities: Entity[], settings: OptimizeSettings): Promise<() => void> {
    const changed: Entity[] = [];
    for (const e of entities) {
      if (e.optimization || this.blocker(e)) continue;
      const o = await this.apply(e, settings, false);
      o.session = true;
      changed.push(e);
    }
    return () => {
      for (const e of changed) if (e.optimization?.session) this.swap(e, e.optimization, undefined);
    };
  }

  /** Bakes the original's surface detail onto each optimized mesh that has UVs and a material. */
  private async bake(o: Optimization, size: number) {
    this.phase = 'bake';
    this.progress = 0;
    this.editor.notify('activity');
    const targets = o.meshes.filter((v) => normalMapOf(v.mesh.material) && (v.original ?? v.mesh.geometry)?.getVerticesData('uv'));
    if (!targets.length) throw new Error(tr('Baking needs a material and UVs.'));
    for (const [k, v] of targets.entries()) {
      const source = (v.original ?? v.mesh.geometry)!;
      const slot = normalMapOf(v.mesh.material)!;
      let existing: { pixels: Uint8Array; width: number; height: number } | undefined;
      if (slot.texture) {
        const s = slot.texture.getSize();
        const data = await slot.texture.readPixels(0, 0, null, true, false);
        if (data) existing = { pixels: new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice(), width: s.width, height: s.height };
      }
      const job = bakeNormals(
        {
          positions: Float32Array.from(source.getVerticesData('position')!),
          normals: Float32Array.from(source.getVerticesData('normal')!),
          uvs: Float32Array.from(source.getVerticesData('uv')!),
          high: Uint32Array.from(source.getIndices()!),
          low: v.levels[0],
          size,
          existing,
          flipX: slot.flipX,
          flipY: slot.flipY,
        },
        (p) => {
          this.progress = (k + p) / targets.length;
          this.editor.notify('activity');
        },
      );
      this.task = job;
      const result = await job.promise;
      const texture = bakedTexture(this.editor.scene, result.pixels, size, `${v.mesh.name} baked normals`);
      v.normal = { material: v.mesh.material!, original: slot.texture, texture, png: await bakedPng(result.pixels, size), size };
    }
  }

  // ---------- Saving and copies ----------

  /** Saved form: settings plus, per optimized mesh and level, its kept indices. */
  private readonly savedData = new WeakMap<Optimization, Uint8Array>();

  serialize(e: Entity): { settings: OptimizeSettings; error: number; meshes: number[]; data: Uint8Array; bakes: { mesh: number; size: number; png: Uint8Array }[] } | null {
    const o = e.optimization;
    if (!o || o.session) return null;
    // An optimization never changes once made (a new one replaces it): build its bytes once
    let data = this.savedData.get(o);
    if (!data) {
      const parts: Uint32Array[] = [];
      for (const v of o.meshes) {
        parts.push(Uint32Array.of(v.levels.length));
        for (const l of v.levels) parts.push(Uint32Array.of(l.length), l);
      }
      const out = new Uint32Array(parts.reduce((n, p) => n + p.length, 0));
      let k = 0;
      for (const p of parts) {
        out.set(p, k);
        k += p.length;
      }
      data = new Uint8Array(out.buffer);
      this.savedData.set(o, data);
    }
    const bakes = o.meshes.filter((v) => v.normal).map((v) => ({ mesh: e.meshes.indexOf(v.mesh), size: v.normal!.size, png: v.normal!.png }));
    return { settings: { ...o.settings }, error: o.error, meshes: o.meshes.map((v) => e.meshes.indexOf(v.mesh)), data, bakes };
  }

  /** Rebuilds a saved optimization (no recomputation). Returns false if it doesn't fit the model. */
  restore(e: Entity, saved: { settings: OptimizeSettings; error: number; meshes: number[] }, data: Uint8Array, bakes: { mesh: number; size: number; png: Uint8Array }[] = []): boolean {
    const words = new Uint32Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    const meshes: Mesh[] = [];
    const perMesh: Uint32Array[][] = [];
    let k = 0;
    for (const index of saved.meshes) {
      const mesh = e.meshes[index];
      const count = words[k++];
      const levels: Uint32Array[] = [];
      for (let l = 0; l < count; l++) {
        const n = words[k++];
        levels.push(words.slice(k, k + n));
        k += n;
      }
      if (!(mesh instanceof Mesh) || levels.some((l) => l.some((i) => i >= mesh.getTotalVertices()))) return false;
      meshes.push(mesh);
      perMesh.push(levels);
    }
    const o = this.build(e, saved.settings, perMesh, saved.error, meshes);
    for (const b of bakes) {
      const v = o.meshes.find((x) => e.meshes.indexOf(x.mesh) === b.mesh);
      const slot = v && normalMapOf(v.mesh.material);
      if (v && slot) v.normal = { material: v.mesh.material!, original: slot.texture, texture: pngTexture(this.editor.scene, b.png, `${v.mesh.name} baked normals`), png: b.png, size: b.size };
    }
    this.swap(e, undefined, o);
    return true;
  }

  /** Same optimization on a duplicate (same file, same vertices). */
  copy(from: Entity, to: Entity) {
    const saved = this.serialize(from);
    if (saved) this.restore(to, saved, saved.data, saved.bakes);
  }

  // ---------- Geometry ----------

  /** The geometry the mesh had before any optimization. */
  private originalOf(e: Entity, m: Mesh): Geometry | null {
    return e.optimization?.meshes.find((v) => v.mesh === m)?.original ?? m.geometry;
  }

  private build(e: Entity, settings: OptimizeSettings, perMesh: Uint32Array[][], error: number, meshes = optimizableMeshes(e)): Optimization {
    let beforeTris = 0;
    let beforeVerts = 0;
    let afterTris = 0;
    let afterVerts = 0;
    for (const m of e.meshes) {
      if (meshes.includes(m as Mesh)) continue;
      beforeTris += m.getTotalIndices() / 3;
      afterTris += m.getTotalIndices() / 3;
      beforeVerts += m.getTotalVertices();
      afterVerts += m.getTotalVertices();
    }
    const variants = meshes.map((mesh, i) => {
      const original = this.originalOf(e, mesh);
      const source = original ?? mesh.geometry!;
      beforeTris += source.getTotalIndices() / 3;
      beforeVerts += source.getTotalVertices();
      const optimized = compactGeometry(source, perMesh[i][0], `${mesh.name} optimized`);
      afterTris += perMesh[i][0].length / 3;
      afterVerts += optimized.getTotalVertices();
      const lodMeshes = perMesh[i].slice(1).map((indices, l) => {
        const lod = new Mesh(`${mesh.name} LOD${l + 1}`, mesh.getScene());
        useGeometry(lod, compactGeometry(source, indices, `${lod.name} geometry`));
        lod.isPickable = false;
        lod.setEnabled(false);
        return lod;
      });
      return { mesh, original, optimized, levels: perMesh[i], lodMeshes };
    });
    return {
      settings: { ...settings },
      error,
      before: { triangles: Math.round(beforeTris), vertices: beforeVerts },
      after: { triangles: Math.round(afterTris), vertices: afterVerts },
      meshes: variants,
    };
  }

  /** Shows the original geometry (true) or the optimized one again (false), without any change. */
  preview(e: Entity, original: boolean) {
    const o = e.optimization;
    if (!o) return;
    for (const v of o.meshes) {
      useGeometry(v.mesh, original && v.original ? v.original : v.optimized);
      if (v.normal) setNormalMap(v.normal.material, original ? v.normal.original : v.normal.texture);
      v.lodMeshes.forEach((lod, l) => {
        if (original) v.mesh.removeLODLevel(lod);
        else v.mesh.addLODLevel(LOD_LEVELS[l].coverage, lod);
        lod.setEnabled(!original);
      });
    }
    this.editor.invalidate();
  }

  /** Replaces one optimization state with another (either can be none). */
  /**
   * Makes the optimized geometry the model's own, so its surface can be edited: levels of detail
   * are dropped (they would no longer match) and the geometry is saved like an edited mesh.
   * A baked normal map becomes the material's normal texture. Undo goes back to the
   * optimization, with the original still available.
   */
  async freeze(e: Entity) {
    const o = e.optimization;
    if (!o || o.session) return;
    // Baked normals live in the optimization: keep them as the material's own texture
    for (const v of o.meshes) {
      if (!v.normal) continue;
      const file = new File([v.normal.png as Uint8Array<ArrayBuffer>], `${v.mesh.name || 'mesh'}-normals.png`, { type: 'image/png' });
      await this.editor.setMaterialTexture(v.normal.material, 'normal', file);
    }
    const previous = e.separation;
    const frozen = () => {
      for (const v of o.meshes) {
        for (const lod of v.lodMeshes) {
          v.mesh.removeLODLevel(lod);
          lod.setEnabled(false);
        }
        v.mesh.useLODScreenCoverage = false;
      }
      e.optimization = undefined;
      e.separation = { meshes: e.meshes.map((m) => capturePart(m as Mesh, true)), pivot: previous?.pivot ?? [0, 0, 0] };
      this.editor.notify('optimize');
      this.editor.notify('entities');
    };
    const unfrozen = () => {
      e.separation = previous;
      this.swap(e, undefined, o);
    };
    frozen();
    this.editor.record({ undo: unfrozen, redo: frozen });
  }

  private swap(e: Entity, from: Optimization | undefined, to: Optimization | undefined) {
    for (const v of from?.meshes ?? []) {
      for (const lod of v.lodMeshes) {
        v.mesh.removeLODLevel(lod);
        lod.setEnabled(false);
      }
      v.mesh.useLODScreenCoverage = false;
      if (v.original) useGeometry(v.mesh, v.original);
      if (v.normal) setNormalMap(v.normal.material, v.normal.original);
    }
    for (const v of to?.meshes ?? []) {
      useGeometry(v.mesh, v.optimized);
      if (v.normal) setNormalMap(v.normal.material, v.normal.texture);
      if (v.lodMeshes.length) {
        v.mesh.useLODScreenCoverage = true;
        v.lodMeshes.forEach((lod, l) => {
          lod.parent = v.mesh.parent;
          lod.position.copyFrom(v.mesh.position);
          lod.rotationQuaternion = v.mesh.rotationQuaternion?.clone() ?? null;
          lod.rotation.copyFrom(v.mesh.rotation);
          lod.scaling.copyFrom(v.mesh.scaling);
          lod.material = v.mesh.material;
          lod.skeleton = v.mesh.skeleton;
          lod.numBoneInfluencers = v.mesh.numBoneInfluencers;
          lod.receiveShadows = v.mesh.receiveShadows;
          lod.isVisible = v.mesh.isVisible;
          lod.setEnabled(true);
          v.mesh.addLODLevel(LOD_LEVELS[l].coverage, lod);
        });
      }
    }
    e.optimization = to;
    this.editor.refreshShadowCasters();
    this.editor.invalidate();
    this.editor.notify('optimize');
    this.editor.notify('entities');
  }
}

/**
 * Puts a geometry on a mesh. Babylon keeps the mesh's draw range (submesh) when a geometry with
 * another triangle count is applied, so it must be rebuilt, or part of the mesh isn't drawn.
 */
function useGeometry(mesh: Mesh, geometry: Geometry) {
  geometry.applyToMesh(mesh);
  mesh._createGlobalSubMesh(true);
  mesh.refreshBoundingInfo();
}

/** Data the simplifier needs from a geometry. */
function simplifyInput(g: Geometry): SimplifyMesh {
  const float = (kind: string) => {
    const d = g.getVerticesData(kind);
    return d ? Float32Array.from(d) : undefined;
  };
  const colors = g.getVerticesData('color');
  const n = g.getTotalVertices();
  return {
    positions: float('position')!,
    normals: float('normal'),
    uvs: float('uv'),
    // Colors may be RGB or RGBA: always pass RGBA
    colors: colors ? (colors.length === n * 4 ? Float32Array.from(colors) : expandRgb(colors, n)) : undefined,
    indices: Uint32Array.from(g.getIndices()!),
  };
}

function expandRgb(c: ArrayLike<number>, n: number) {
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) out.set([c[i * 3], c[i * 3 + 1], c[i * 3 + 2], 1], i * 4);
  return out;
}

/**
 * A new geometry with only the vertices the kept triangles use (every vertex attribute copied,
 * including skin weights and tangents), indices renumbered.
 */
export function compactGeometry(source: Geometry, indices: Uint32Array, id: string): Geometry {
  const n = source.getTotalVertices();
  const remap = new Int32Array(n).fill(-1);
  const order: number[] = [];
  const out = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i];
    if (remap[v] < 0) {
      remap[v] = order.length;
      order.push(v);
    }
    out[i] = remap[v];
  }
  const data = new VertexData();
  for (const kind of source.getVerticesDataKinds()) {
    const src = source.getVerticesData(kind);
    if (!src) continue;
    const size = src.length / n;
    const dst = new Float32Array(order.length * size);
    for (let i = 0; i < order.length; i++) for (let c = 0; c < size; c++) dst[i * size + c] = src[order[i] * size + c];
    data.set(dst, kind);
  }
  data.indices = out;
  return new Geometry(id, source.getScene(), data, false);
}
