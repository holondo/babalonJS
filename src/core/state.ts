import { textureStates, applyTextureStates } from './materialTextures';
import type { TextureStates } from './materialTextures';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import type { PointLight } from '@babylonjs/core/Lights/pointLight.js';
import type { SpotLight } from '@babylonjs/core/Lights/spotLight.js';
import type { Editor, Entity, LightType } from './editor';

export interface MaterialJSON {
  textures?: TextureStates;
  type: 'pbr' | 'standard' | 'other';
  alpha: number;
  transparencyMode?: number | null;
  backFaceCulling: boolean;
  wireframe: boolean;
  albedo?: string;
  metallic?: number | null;
  roughness?: number | null;
  clearCoat?: boolean;
  clearCoatIntensity?: number;
  unlit?: boolean;
  emissive?: string;
  emissiveIntensity?: number;
  textureHidden?: boolean;
  metallicChannels?: [boolean, boolean, boolean];
  advanced?: {
    refraction: boolean; transmission: number; ior: number; linkTransparency: boolean;
    sheen: boolean; sheenIntensity: number; sheenColor: string; sheenRoughness: number | null;
    iridescence: boolean; iridescenceIntensity: number; filmMin: number; filmMax: number;
    anisotropy: boolean; anisotropyIntensity: number; anisotropyDirection: number[];
  };
  diffuse?: string;
  specular?: string;
  specularPower?: number;
}

export function materialToJSON(m: Material): MaterialJSON {
  const base = { textures: textureStates(m), alpha: m.alpha, transparencyMode: m.transparencyMode, backFaceCulling: m.backFaceCulling, wireframe: m.wireframe };
  if (m instanceof PBRMaterial) {
    return {
      ...base,
      type: 'pbr',
      albedo: m.albedoColor ? m.albedoColor.toHexString() : '#ffffff',
      metallic: m.metallic,
      roughness: m.roughness,
      clearCoat: m.clearCoat?.isEnabled ?? false,
      clearCoatIntensity: m.clearCoat?.intensity ?? 1,
      unlit: m.unlit,
      emissive: m.emissiveColor ? m.emissiveColor.toHexString() : '#000000',
      emissiveIntensity: m.emissiveIntensity,
      metallicChannels: [m.useRoughnessFromMetallicTextureAlpha, m.useRoughnessFromMetallicTextureGreen, m.useMetallnessFromMetallicTextureBlue],
      textureHidden: !!m.metadata?.stashedAlbedo,
      advanced: {
        refraction: m.subSurface?.isRefractionEnabled ?? false, transmission: m.subSurface?.refractionIntensity ?? 0,
        ior: m.subSurface?.indexOfRefraction ?? 1.5, linkTransparency: m.subSurface?.linkRefractionWithTransparency ?? false,
        sheen: m.sheen?.isEnabled ?? false, sheenIntensity: m.sheen?.intensity ?? 0, sheenColor: m.sheen?.color ? m.sheen.color.toHexString() : '#ffffff', sheenRoughness: m.sheen?.roughness ?? null,
        iridescence: m.iridescence?.isEnabled ?? false, iridescenceIntensity: m.iridescence?.intensity ?? 0,
        filmMin: m.iridescence?.minimumThickness ?? 100, filmMax: m.iridescence?.maximumThickness ?? 400,
        anisotropy: m.anisotropy?.isEnabled ?? false, anisotropyIntensity: m.anisotropy?.intensity ?? 0, anisotropyDirection: m.anisotropy?.direction?.asArray?.() ?? [1, 0],
      },
    };
  }
  if (m instanceof StandardMaterial) {
    return {
      ...base,
      type: 'standard',
      diffuse: m.diffuseColor ? m.diffuseColor.toHexString() : '#ffffff',
      specular: m.specularColor ? m.specularColor.toHexString() : '#ffffff',
      specularPower: m.specularPower,
      emissive: m.emissiveColor ? m.emissiveColor.toHexString() : '#000000',
    };
  }
  return { ...base, type: 'other' };
}

export function applyMaterial(m: Material, j: MaterialJSON) {
  if (j.textures) applyTextureStates(m, j.textures);
  m.alpha = j.alpha;
  m.transparencyMode = j.transparencyMode === undefined ? (j.alpha < 1 ? Material.MATERIAL_ALPHABLEND : null) : j.transparencyMode;
  m.backFaceCulling = j.backFaceCulling;
  m.wireframe = j.wireframe;
  if (m instanceof PBRMaterial && j.type === 'pbr') {
    if (j.metallicChannels) [m.useRoughnessFromMetallicTextureAlpha, m.useRoughnessFromMetallicTextureGreen, m.useMetallnessFromMetallicTextureBlue] = j.metallicChannels;
    if (j.albedo) m.albedoColor = Color3.FromHexString(j.albedo);
    if (j.metallic !== undefined) m.metallic = j.metallic;
    if (j.roughness !== undefined) m.roughness = j.roughness;
    if (m.clearCoat) {
      m.clearCoat.isEnabled = !!j.clearCoat;
      m.clearCoat.intensity = j.clearCoatIntensity ?? 1;
    }
    if (j.advanced) {
      const a = j.advanced;
      if (m.subSurface) {
        Object.assign(m.subSurface, { isRefractionEnabled: a.refraction, refractionIntensity: a.transmission, indexOfRefraction: a.ior, linkRefractionWithTransparency: a.linkTransparency });
      }
      if (m.sheen) {
        Object.assign(m.sheen, { isEnabled: a.sheen, intensity: a.sheenIntensity, roughness: a.sheenRoughness });
        if (a.sheenColor) m.sheen.color = Color3.FromHexString(a.sheenColor);
      }
      if (m.iridescence) {
        Object.assign(m.iridescence, { isEnabled: a.iridescence, intensity: a.iridescenceIntensity, minimumThickness: a.filmMin, maximumThickness: a.filmMax });
      }
      if (m.anisotropy) {
        Object.assign(m.anisotropy, { isEnabled: a.anisotropy, intensity: a.anisotropyIntensity });
        if (a.anisotropyDirection && m.anisotropy.direction) {
          m.anisotropy.direction.set(a.anisotropyDirection[0], a.anisotropyDirection[1]);
        }
      }
    }
    m.unlit = !!j.unlit;
    if (j.emissive) m.emissiveColor = Color3.FromHexString(j.emissive);
    m.emissiveIntensity = j.emissiveIntensity ?? 1;
    if (j.textureHidden && m.albedoTexture) {
      (m.metadata ??= {}).stashedAlbedo = m.albedoTexture;
      m.albedoTexture = null;
    } else if (!j.textureHidden && m.metadata?.stashedAlbedo) {
      m.albedoTexture = m.metadata.stashedAlbedo;
      m.metadata.stashedAlbedo = null;
    }
  } else if (m instanceof StandardMaterial && j.type === 'standard') {
    if (j.diffuse) m.diffuseColor = Color3.FromHexString(j.diffuse);
    if (j.specular) m.specularColor = Color3.FromHexString(j.specular);
    m.specularPower = j.specularPower ?? 64;
    if (j.emissive) m.emissiveColor = Color3.FromHexString(j.emissive);
  }
}

export interface LightJSON {
  type: LightType;
  color: string;
  intensity: number;
  shadows: boolean;
  angle?: number;
  exponent?: number;
  range?: number;
}

export function lightToJSON(e: Entity): LightJSON {
  const l = e.light!;
  return {
    type: e.lightType!, color: l.diffuse.toHexString(), intensity: l.intensity, shadows: !!e.shadowGen,
    ...(e.lightType === 'spot' ? { angle: (l as SpotLight).angle, exponent: (l as SpotLight).exponent } : {}),
    ...(e.lightType !== 'directional' ? { range: (l as PointLight).range } : {}),
  };
}

export function applyLight(editor: Editor, e: Entity, state: LightJSON) {
  const l = e.light!;
  l.diffuse = Color3.FromHexString(state.color);
  l.specular = l.diffuse.clone();
  l.intensity = state.intensity;
  if (state.angle !== undefined) (l as SpotLight).angle = state.angle;
  if (state.exponent !== undefined) (l as SpotLight).exponent = state.exponent;
  if (state.range !== undefined) (l as PointLight).range = state.range;
  if (!!e.shadowGen !== state.shadows) editor.setLightShadows(e, state.shadows);
  for (const mesh of e.root.getChildMeshes()) {
    if (mesh.material instanceof StandardMaterial) mesh.material.emissiveColor.copyFrom(l.diffuse);
  }
}
