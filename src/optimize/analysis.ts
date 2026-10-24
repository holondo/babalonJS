import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture.js';
import type { Material } from '@babylonjs/core/Materials/material.js';
import type { Editor, Entity } from '../core/editor';
import { isSplat, splatTextures } from '../core/splats';

/**
 * What a model costs to draw: triangles, vertices and texture memory on the GPU, and whether it
 * fits the device. Read-only: nothing is changed here.
 */

export interface TextureCost {
  texture: BaseTexture;
  name: string;
  width: number;
  height: number;
  /** GPU memory with mipmaps (bytes). */
  bytes: number;
  compressed: boolean;
}

export interface ModelCost {
  triangles: number;
  vertices: number;
  splats: number;
  meshes: number;
  skinned: boolean;
  /** Meshes with morph targets (blend shapes): not simplified. */
  morphMeshes: number;
  textures: TextureCost[];
  textureBytes: number;
}

export interface Budget {
  /** Triangles of the whole scene that stay smooth. */
  triangles: number;
  /** GPU texture memory of the whole scene. */
  textureBytes: number;
  phone: boolean;
}

const MB = 1024 * 1024;

/** Conservative encoding budget: deviceMemory is approximate, not available tab memory. */
export function textureWorkerLimit(width: number, height: number, cores: number, memory: number | undefined, phone: boolean) {
  if (phone || (memory !== undefined && memory <= 4)) return 1;
  const budget = memory === undefined ? 512 * MB : Math.min(1024, memory * 1024 * .1) * MB;
  // Retain source RGBA and stitched output; reserve ~192 MB for each 2K WASM encoder.
  const available = budget - width * height * 5;
  return Math.max(1, Math.min(3, Math.floor((cores || 2) / 2), Math.floor(available / (192 * MB))));
}

/**
 * Device budgets (decision D7): phones keep the scene under ~500k triangles and 256 MB of
 * textures (AR also draws the camera feed); desktops allow 3M triangles and 1 GB.
 */
export function deviceBudget(): Budget {
  const phone = matchMedia('(pointer: coarse)').matches;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? (phone ? 4 : 8);
  const low = memory <= 4;
  return phone
    ? { triangles: low ? 300_000 : 500_000, textureBytes: (low ? 160 : 256) * MB, phone }
    : { triangles: 3_000_000, textureBytes: 1024 * MB, phone };
}

/** GPU bytes of a texture: RGBA8 (or ~1 byte/texel when compressed) plus a third for mipmaps. */
export function textureBytes(width: number, height: number, compressed: boolean) {
  return Math.round(width * height * (compressed ? 1 : 4) * (4 / 3));
}

export function textureCost(t: BaseTexture): TextureCost {
  const size = t.getSize();
  const compressed = !!(t as { _texture?: { _compression?: unknown } })._texture?._compression || /\.ktx2?($|\?)/i.test(t.name);
  return { texture: t, name: t.name, width: size.width, height: size.height, bytes: textureBytes(size.width, size.height, compressed), compressed };
}

/** Textures used by a set of materials (each counted once). */
export function texturesOf(materials: Material[]): BaseTexture[] {
  const set = new Set<BaseTexture>();
  for (const m of materials) for (const t of m.getActiveTextures()) if (t && !t.isCube) set.add(t);
  return [...set];
}

export function analyzeEntity(editor: Editor, e: Entity): ModelCost {
  let triangles = 0;
  let vertices = 0;
  let morphMeshes = 0;
  let skinned = false;
  let splats = 0;
  for (const m of e.meshes) {
    if (isSplat(m)) { splats += m.getTotalVertices(); continue; }
    triangles += Math.floor(m.getTotalIndices() / 3);
    vertices += m.getTotalVertices();
    if (m.skeleton) skinned = true;
    if (m.morphTargetManager?.numTargets) morphMeshes++;
  }
  const splatSet = new Set(e.meshes.filter(isSplat).flatMap(splatTextures));
  const textures = e.kind === 'light' ? [] : [...new Set([...texturesOf(editor.materialsOf(e)), ...splatSet])].map(texture => {
    const cost = textureCost(texture);
    if (splatSet.has(texture)) {
      const internal = texture.getInternalTexture();
      const channels = internal?.format === 6 ? 1 : internal?.format === 7 ? 2 : internal?.format === 4 ? 3 : 4;
      const bytes = internal?.type === 2 || internal?.type === 5 || internal?.type === 4 ? 2 : internal?.type === 1 || internal?.type === 6 || internal?.type === 7 ? 4 : 1;
      cost.bytes = cost.width * cost.height * channels * bytes;
    }
    return cost;
  });
  return { triangles, vertices, splats, meshes: e.meshes.length, skinned, morphMeshes, textures, textureBytes: textures.reduce((n, t) => n + t.bytes, 0) };
}

/** The whole scene (visible objects; textures shared between objects counted once). */
export function analyzeScene(editor: Editor) {
  let triangles = 0;
  let splats = 0;
  const textures = new Map<BaseTexture, TextureCost>();
  for (const e of editor.entities) {
    if (e.groupMembers) continue;
    if (e.kind === 'light' || !e.visible) continue;
    const c = analyzeEntity(editor, e);
    triangles += c.triangles;
    splats += c.splats;
    for (const t of c.textures) textures.set(t.texture, t);
  }
  return { triangles, splats, textureBytes: [...textures.values()].reduce((n, t) => n + t.bytes, 0) };
}

export function overBudget(cost: { triangles: number; splats?: number; textureBytes: number }, budget = deviceBudget()) {
  // Splats have their own count; do not count Babylon's reusable billboard triangles.
  return cost.triangles > budget.triangles || (cost.splats ?? 0) > budget.triangles || cost.textureBytes > budget.textureBytes;
}

export function formatBytes(bytes: number) {
  return bytes >= MB ? `${(bytes / MB).toFixed(bytes >= 100 * MB ? 0 : 1)} MB` : `${Math.round(bytes / 1024)} KB`;
}
