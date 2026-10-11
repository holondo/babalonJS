import { Color3, Material, PBRMaterial, StandardMaterial } from '@babylonjs/core';
import type { PointLight, SpotLight } from '@babylonjs/core';
import type { Editor, Entity, LightType } from './editor';

export interface MaterialJSON {
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
  diffuse?: string;
  specular?: string;
  specularPower?: number;
}

export function materialToJSON(m: Material): MaterialJSON {
  const base = { alpha: m.alpha, transparencyMode: m.transparencyMode, backFaceCulling: m.backFaceCulling, wireframe: m.wireframe };
  if (m instanceof PBRMaterial) {
    return {
      ...base,
      type: 'pbr',
      albedo: m.albedoColor.toHexString(),
      metallic: m.metallic,
      roughness: m.roughness,
      clearCoat: m.clearCoat.isEnabled,
      clearCoatIntensity: m.clearCoat.intensity,
      unlit: m.unlit,
      emissive: m.emissiveColor.toHexString(),
      emissiveIntensity: m.emissiveIntensity,
      textureHidden: !!m.metadata?.stashedAlbedo,
    };
  }
  if (m instanceof StandardMaterial) {
    return {
      ...base,
      type: 'standard',
      diffuse: m.diffuseColor.toHexString(),
      specular: m.specularColor.toHexString(),
      specularPower: m.specularPower,
      emissive: m.emissiveColor.toHexString(),
    };
  }
  return { ...base, type: 'other' };
}

export function applyMaterial(m: Material, j: MaterialJSON) {
  m.alpha = j.alpha;
  m.transparencyMode = j.transparencyMode === undefined ? (j.alpha < 1 ? Material.MATERIAL_ALPHABLEND : null) : j.transparencyMode;
  m.backFaceCulling = j.backFaceCulling;
  m.wireframe = j.wireframe;
  if (m instanceof PBRMaterial && j.type === 'pbr') {
    m.albedoColor = Color3.FromHexString(j.albedo!);
    if (j.metallic !== undefined) m.metallic = j.metallic;
    if (j.roughness !== undefined) m.roughness = j.roughness;
    m.clearCoat.isEnabled = !!j.clearCoat;
    m.clearCoat.intensity = j.clearCoatIntensity ?? 1;
    m.unlit = !!j.unlit;
    m.emissiveColor = Color3.FromHexString(j.emissive!);
    m.emissiveIntensity = j.emissiveIntensity ?? 1;
    if (j.textureHidden && m.albedoTexture) {
      (m.metadata ??= {}).stashedAlbedo = m.albedoTexture;
      m.albedoTexture = null;
    } else if (!j.textureHidden && m.metadata?.stashedAlbedo) {
      m.albedoTexture = m.metadata.stashedAlbedo;
      m.metadata.stashedAlbedo = null;
    }
  } else if (m instanceof StandardMaterial && j.type === 'standard') {
    m.diffuseColor = Color3.FromHexString(j.diffuse!);
    m.specularColor = Color3.FromHexString(j.specular!);
    m.specularPower = j.specularPower ?? 64;
    m.emissiveColor = Color3.FromHexString(j.emissive!);
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
