import type { BaseTexture, Material } from '@babylonjs/core';
import type { Editor, Entity } from '../core/editor';

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
  for (const m of e.meshes) {
    triangles += Math.floor(m.getTotalIndices() / 3);
    vertices += m.getTotalVertices();
    if (m.skeleton) skinned = true;
    if (m.morphTargetManager?.numTargets) morphMeshes++;
  }
  const textures = e.kind === 'light' ? [] : texturesOf(editor.materialsOf(e)).map(textureCost);
  return { triangles, vertices, meshes: e.meshes.length, skinned, morphMeshes, textures, textureBytes: textures.reduce((n, t) => n + t.bytes, 0) };
}

/** The whole scene (visible objects; textures shared between objects counted once). */
export function analyzeScene(editor: Editor) {
  let triangles = 0;
  const textures = new Map<BaseTexture, TextureCost>();
  for (const e of editor.entities) {
    if (e.kind === 'light' || !e.visible) continue;
    const c = analyzeEntity(editor, e);
    triangles += c.triangles;
    for (const t of c.textures) textures.set(t.texture, t);
  }
  return { triangles, textureBytes: [...textures.values()].reduce((n, t) => n + t.bytes, 0) };
}

export function overBudget(cost: { triangles: number; textureBytes: number }, budget = deviceBudget()) {
  return cost.triangles > budget.triangles || cost.textureBytes > budget.textureBytes;
}

export function formatBytes(bytes: number) {
  return bytes >= MB ? `${(bytes / MB).toFixed(bytes >= 100 * MB ? 0 : 1)} MB` : `${Math.round(bytes / 1024)} KB`;
}
