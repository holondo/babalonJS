import { WebIO } from '@gltf-transform/core';
import type { Texture } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

/**
 * Compact GLB (loaded on demand): geometry quantized and compressed with EXT_meshopt_compression,
 * and the KTX2 textures made by the texture optimizer embedded (KHR_texture_basisu) in place of
 * the PNG/JPEG the Babylon exporter wrote. Opens in any viewer that supports both extensions
 * (Babylon, three.js, model-viewer, Blender 4.2+…).
 */

/** Babylon material slot → glTF texture of the material (only slots exported one to one). */
const SLOTS: Record<string, 'baseColor' | 'normal' | 'emissive'> = {
  albedoTexture: 'baseColor',
  diffuseTexture: 'baseColor',
  bumpTexture: 'normal',
  emissiveTexture: 'emissive',
};

export async function compactGLB(glb: Uint8Array, ktx2: { material: string; property: string; data: Uint8Array }[]) {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  const io = new WebIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const doc = await io.readBinary(glb);
  const replaced = new Set<Texture>();
  for (const t of ktx2) {
    const slot = SLOTS[t.property];
    if (!slot) continue;
    for (const m of doc.getRoot().listMaterials()) {
      if (m.getName() !== t.material) continue;
      const texture = slot === 'baseColor' ? m.getBaseColorTexture() : slot === 'normal' ? m.getNormalTexture() : m.getEmissiveTexture();
      if (!texture || replaced.has(texture)) continue;
      texture.setImage(t.data).setMimeType('image/ktx2').setURI(texture.getURI().replace(/\.\w+$/, '.ktx2'));
      replaced.add(texture);
    }
  }
  if (replaced.size) doc.createExtension(KHRTextureBasisu).setRequired(true);
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  return io.writeBinary(doc);
}
