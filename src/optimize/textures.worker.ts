/// <reference lib="webworker" />
/**
 * Texture encoding off the main thread (decision D2: Basis Universal UASTC in KTX2, near-lossless,
 * 4–8× less GPU memory than RGBA). One image per message; textures.ts splits large images into
 * tiles and encodes them sequentially to bound peak memory. The encoder WASM loads only here.
 */
import { encodeToKTX2 } from 'ktx2-encoder';
import type { EncodeRequest } from './textures';

const post = (m: unknown, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer);

self.onmessage = async (ev: MessageEvent<EncodeRequest>) => {
  try {
    const { pixels, width, height, format, color, normalMap, mipmaps, supercompress } = ev.data;
    let data: Uint8Array;
    if (format === 'png') {
      const canvas = new OffscreenCanvas(width, height);
      canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer), width, height), 0, 0);
      data = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
    } else {
      data = await encodeToKTX2(new Uint8Array(0), {
        isKTX2File: true,
        isUASTC: true,
        uastcLDRQualityLevel: 1,
        needSupercompression: supercompress,
        generateMipmap: mipmaps,
        isNormalMap: normalMap,
        isPerceptual: color,
        isSetKTX2SRGBTransferFunc: color,
        // Pixels are already decoded: hand them to the encoder as is
        imageDecoder: async () => ({ width, height, data: pixels }),
      });
    }
    post({ type: 'done', data }, [data.buffer as ArrayBuffer]);
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
