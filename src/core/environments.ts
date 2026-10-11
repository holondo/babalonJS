import { CubeTexture } from '@babylonjs/core/Materials/Textures/cubeTexture.js';
import type { BaseTexture, Scene } from '@babylonjs/core';
import { tr } from './i18n';

export interface EnvironmentAsset { file: File; texture: BaseTexture }
/** Load completely before replacing the current lighting; failed imports leave it intact. */
export async function loadEnvironment(scene: Scene, file: File, size = 512): Promise<EnvironmentAsset> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!['hdr', 'exr', 'env'].includes(extension ?? '')) throw new Error(tr('Choose an HDR, EXR or ENV file.'));
  const url = URL.createObjectURL(file);
  try {
    const factory = extension === 'hdr' ? (await import('@babylonjs/core/Materials/Textures/hdrCubeTexture.js')).HDRCubeTexture
      : extension === 'exr' ? (await import('@babylonjs/core/Materials/Textures/exrCubeTexture.js')).EXRCubeTexture : null;
    const texture = await new Promise<BaseTexture>((resolve, reject) => {
      const done = () => resolve(tex);
      const fail = () => { tex.dispose(); reject(new Error(tr('Could not load environment.'))); };
      const tex = factory ? new factory(url, scene, size, false, true, false, true, done, fail)
        : new CubeTexture(url, scene, { prefiltered: true, forcedExtension: '.env', onLoad: done, onError: fail });
    });
    texture.name = file.name;
    return { file, texture };
  } finally { URL.revokeObjectURL(url); }
}
