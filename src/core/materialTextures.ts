import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture.js';
import type { Material } from '@babylonjs/core/Materials/material.js';
import type { Scene } from '@babylonjs/core/scene.js';
import { tr } from './i18n';

export const USER_TEXTURE_SLOTS = [
  { slot: 'base', label: 'Base color', color: true },
  { slot: 'normal', label: 'Normal map', color: false },
  { slot: 'metal', label: 'Roughness / metal', color: false },
  { slot: 'emission', label: 'Emission', color: true },
  { slot: 'opacity', label: 'Opacity', color: false },
] as const;
export type TextureSlot = typeof USER_TEXTURE_SLOTS[number]['slot'];
export interface TextureState { path: string; u: number; v: number; rotation: number }
export type TextureStates = Partial<Record<TextureSlot, TextureState>>;
const resources = new WeakMap<Scene, Map<string, { file: File; texture: Texture }>>();
const bindings = new WeakMap<Material, Map<TextureSlot, { original: BaseTexture | null; texture: Texture | null; state: TextureState | null; channels?: [boolean, boolean, boolean] }>>();

function property(m: Material, slot: TextureSlot): string {
  return slot === 'base' ? m instanceof PBRMaterial ? 'albedoTexture' : 'diffuseTexture'
    : slot === 'normal' ? 'bumpTexture' : slot === 'metal' ? 'metallicTexture' : slot === 'emission' ? 'emissiveTexture' : 'opacityTexture';
}
function slots(m: Material) { return m as unknown as Record<string, BaseTexture | null>; }

export async function loadUserTexture(scene: Scene, file: File, path = `textures/${crypto.randomUUID()}/${file.name}`) {
  let map = resources.get(scene);
  if (!map) resources.set(scene, map = new Map());
  if (map.has(path)) return path;
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!['png', 'jpg', 'jpeg', 'webp', 'ktx2'].includes(extension ?? '')) throw new Error(tr('Choose a PNG, JPEG, WebP or KTX2 image.'));
  const url = URL.createObjectURL(file);
  try {
    const texture = await new Promise<Texture>((resolve, reject) => {
      const tex = new Texture(url, scene, { invertY: false, forcedExtension: `.${extension}`, onLoad: () => resolve(tex), onError: () => { tex.dispose(); reject(new Error(tr('Could not load texture.'))); } });
    });
    if (resources.get(scene) !== map) { texture.dispose(); throw new Error(tr('Scene changed while loading.')); }
    texture.name = file.name;
    map.set(path, { file, texture });
    return path;
  } finally { URL.revokeObjectURL(url); }
}

export function textureStates(m: Material): TextureStates {
  return Object.fromEntries([...(bindings.get(m) ?? [])].filter(([, b]) => b.state).map(([slot, b]) => [slot, { ...b.state! }]));
}

export function applyTextureStates(m: Material, state: TextureStates) {
  if (!(m instanceof PBRMaterial || m instanceof StandardMaterial)) return;
  let map = bindings.get(m);
  if (!map) bindings.set(m, map = new Map());
  for (const { slot, color } of USER_TEXTURE_SLOTS) {
    if (slot === 'metal' && !(m instanceof PBRMaterial)) continue;
    const next = state[slot];
    let b = map.get(slot);
    const prop = property(m, slot);
    if (!next && !b) continue;
    if (!b) {
      b = { original: slot === 'base' ? m.metadata?.stashedAlbedo ?? slots(m)[prop] : slots(m)[prop], texture: null, state: null, channels: m instanceof PBRMaterial ? [m.useRoughnessFromMetallicTextureAlpha, m.useRoughnessFromMetallicTextureGreen, m.useMetallnessFromMetallicTextureBlue] : undefined };
      map.set(slot, b);
    }
    if (next && next.path !== b.state?.path) {
      const resource = resources.get(m.getScene())?.get(next.path);
      if (!resource) throw new Error(tr('File missing from project: {path}', { path: next.path }));
      b.texture?.dispose();
      b.texture = resource.texture.clone();
      b.texture.gammaSpace = color;
      if (slot === 'metal' && m instanceof PBRMaterial) {
        m.useRoughnessFromMetallicTextureAlpha = false;
        m.useRoughnessFromMetallicTextureGreen = true;
        m.useMetallnessFromMetallicTextureBlue = true;
      }
    }
    if (!next && slot === 'metal' && m instanceof PBRMaterial && b.channels) {
      [m.useRoughnessFromMetallicTextureAlpha, m.useRoughnessFromMetallicTextureGreen, m.useMetallnessFromMetallicTextureBlue] = b.channels;
    }
    b.state = next ? { ...next } : null;
    if (next && b.texture) { b.texture.uScale = next.u; b.texture.vScale = next.v; b.texture.wAng = next.rotation; }
    if (slot === 'base' && m.metadata?.stashedAlbedo) m.metadata.stashedAlbedo = null;
    slots(m)[prop] = next ? b.texture : b.original;
  }
}

export function userTextureFiles(scene: Scene, state: TextureStates, files: Record<string, Blob>) {
  for (const s of Object.values(state)) {
    const file = resources.get(scene)?.get(s.path)?.file;
    if (file) files[s.path] = file;
  }
}

export function clearUserTextures(scene: Scene) {
  resources.get(scene)?.forEach((r) => r.texture.dispose());
  resources.delete(scene);
}

export function copyUserTextures(source: Material, target: Material) {
  const old = bindings.get(source);
  if (old) for (const [slot, b] of old) slots(target)[property(target, slot)] = b.original;
  applyTextureStates(target, textureStates(source));
}

export function userTextureFile(scene: Scene, path: string) { return resources.get(scene)?.get(path)?.file; }
