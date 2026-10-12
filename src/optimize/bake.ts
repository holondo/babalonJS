import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture.js';
import type { Material } from '@babylonjs/core/Materials/material.js';
import type { Scene } from '@babylonjs/core/scene.js';

/**
 * Normal map baking from the original mesh onto its optimized version, in a Web Worker
 * (see bake.worker.ts for the method).
 */

export interface BakeJob {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** Original triangles (indices into the vertices above). */
  high: Uint32Array;
  /** Optimized triangles (a subset of the same vertices). */
  low: Uint32Array;
  /** Output size in pixels (square). */
  size: number;
  /** The material's current normal map (folded into the bake). */
  existing?: { pixels: Uint8Array; width: number; height: number };
  /** The material's invertNormalMapX / Y. */
  flipX: boolean;
  flipY: boolean;
}

export const BAKE_SIZES = [1024, 2048, 4096];

export function bakeNormals(job: BakeJob, onProgress: (p: number) => void = () => {}) {
  const worker = new Worker(new URL('./bake.worker.ts', import.meta.url), { type: 'module' });
  let reject: (e: Error) => void = () => {};
  const promise = new Promise<{ pixels: Uint8Array; size: number }>((resolve, rej) => {
    reject = rej;
    worker.onmessage = (ev: MessageEvent) => {
      const m = ev.data;
      if (m.type === 'progress') onProgress(m.value);
      else {
        worker.terminate();
        if (m.type === 'done') resolve(m);
        else rej(new Error(m.message));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      rej(new Error(e.message || 'Worker error'));
    };
    worker.postMessage(job);
  });
  return {
    promise,
    cancel: () => {
      worker.terminate();
      reject(new DOMException('Cancelled', 'AbortError'));
    },
  };
}

/** Normal-map slot of a material (PBR and standard materials). */
export function normalMapOf(m: Material | null): { texture: BaseTexture | null; flipX: boolean; flipY: boolean } | null {
  if (!m || !('bumpTexture' in m)) return null;
  const mat = m as Material & { bumpTexture: BaseTexture | null; invertNormalMapX: boolean; invertNormalMapY: boolean };
  return { texture: mat.bumpTexture, flipX: !!mat.invertNormalMapX, flipY: !!mat.invertNormalMapY };
}

export function setNormalMap(m: Material, texture: BaseTexture | null) {
  (m as Material & { bumpTexture: BaseTexture | null }).bumpTexture = texture;
}

/** RGBA pixels → texture (rows in UV order, like the bake). */
export function bakedTexture(scene: Scene, pixels: Uint8Array, size: number, name: string) {
  const t = RawTexture.CreateRGBATexture(pixels, size, size, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  t.name = name;
  return t;
}

/** PNG of baked pixels (for projects). */
export async function bakedPng(pixels: Uint8Array, size: number) {
  const canvas = new OffscreenCanvas(size, size);
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer, pixels.byteOffset, pixels.byteLength), size, size), 0, 0);
  return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
}

/** Texture from a saved PNG (same orientation as when baked). */
export function pngTexture(scene: Scene, png: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' }));
  const t = new Texture(url, scene, { invertY: false, forcedExtension: '.png' });
  t.name = name;
  return t;
}
