import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture.js';
import type { Material } from '@babylonjs/core/Materials/material.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { Editor, Entity } from '../core/editor';
import { tr } from '../core/i18n';
import { deviceBudget, textureBytes, textureWorkerLimit } from './analysis';
import { read, write } from 'ktx-parse';
import type { KTX2Container } from 'ktx-parse';

/**
 * Lighter textures for a model: compressed to KTX2 (same resolution, near-lossless UASTC) and,
 * only when the user asks, downscaled. Non-destructive: the original textures stay in memory and
 * in projects; one undo step; the result is saved so projects reopen without re-encoding.
 */

export interface TextureSettings {
  /** GPU-compressed KTX2 (UASTC). */
  compress: boolean;
  /** Largest side in pixels (null: keep the resolution). */
  maxSize: number | null;
}

export const DEFAULT_TEXTURES: TextureSettings = { compress: true, maxSize: null };

export interface TextureJob {
  pixels: Uint8Array;
  width: number;
  height: number;
  maxSize: number | null;
  compress: boolean;
  /** Color data (sRGB): albedo, emissive. Normal, roughness and occlusion maps are linear. */
  color: boolean;
  normalMap: boolean;
}

/** One image for the encoding worker. */
export interface EncodeRequest {
  pixels: Uint8Array;
  width: number;
  height: number;
  format: 'ktx2' | 'png';
  color: boolean;
  normalMap: boolean;
  mipmaps: boolean;
  /** Zstandard supercompression (smaller files); off for parts that get stitched together. */
  supercompress: boolean;
}

/** The Basis encoder accepts at most this many texels per image (12 Mpix). */
const ENCODER_LIMIT = 12_582_912;
/** Tile side for larger images (a multiple of the 4×4 block size). */
const TILE = 2048;

/** Texture slots of a material and whether each holds color (sRGB) or data. */
const SLOTS: { property: string; color: boolean; normal?: boolean }[] = [
  { property: 'albedoTexture', color: true },
  { property: 'diffuseTexture', color: true },
  { property: 'emissiveTexture', color: true },
  { property: 'bumpTexture', color: false, normal: true },
  { property: 'metallicTexture', color: false },
  { property: 'ambientTexture', color: false },
  { property: 'opacityTexture', color: false },
  { property: 'specularTexture', color: true },
];

interface SlotChange {
  material: Material;
  property: string;
  original: BaseTexture;
  replacement: BaseTexture;
}

interface EncodedTexture {
  /** The original texture this replaces (in this model's materials). */
  original: BaseTexture;
  data: Uint8Array;
  format: 'ktx2' | 'png';
  width: number;
  height: number;
  replacement: BaseTexture;
}

export interface TextureOptimization {
  settings: TextureSettings;
  encoded: EncodedTexture[];
  changes: SlotChange[];
  before: number;
  after: number;
}

export class TextureOptimizer {
  private readonly editor: Editor;
  /** Encoding workers running now (cancel stops them all). */
  private readonly workers = new Map<Worker, () => void>();
  progress: number | null = null;
  entity: Entity | null = null;

  constructor(editor: Editor) {
    this.editor = editor;
  }

  get busy() {
    return this.progress !== null;
  }

  cancel() {
    this.cancelled = true;
    for (const abort of this.workers.values()) abort();
  }

  private cancelled = false;

  /** Optimizes every texture of a model; one undo step. */
  async apply(e: Entity, settings: TextureSettings) {
    if (this.busy) throw new Error(tr('An optimization is already running.'));
    if (!settings.compress && !settings.maxSize) throw new Error(tr('Choose compression or a maximum size.'));
    const slots = this.slotsOf(e, true);
    const unique = [...new Set(slots.map((s) => s.texture))];
    if (!unique.length) throw new Error(tr('This model has no textures to optimize.'));
    this.progress = 0;
    this.entity = e;
    this.cancelled = false;
    this.editor.notify('activity');
    const encoded: EncodedTexture[] = [];
    try {
      for (const [i, texture] of unique.entries()) {
        this.checkCancelled();
        const slot = slots.find((s) => s.texture === texture)!;
        const job = await readTexture(texture, settings, slot.color, !!slot.normal);
        this.checkCancelled();
        const result = await this.encode(job, (p) => {
          this.progress = (i + p) / unique.length;
          this.editor.notify('activity');
        });
        encoded.push({ original: texture, ...result, replacement: makeTexture(this.editor.scene, texture, result.data, result.format) });
      }
      this.checkCancelled();
    } catch (error) {
      this.cancel();
      for (const texture of encoded) texture.replacement.dispose();
      throw error;
    } finally {
      this.progress = null;
      this.entity = null;
      this.editor.notify('activity');
    }
    if (this.cancelled) throw new DOMException('Cancelled', 'AbortError');
    const before = e.textureOptimization;
    const after = this.build(e, settings, encoded);
    this.swap(e, before, after);
    this.editor.record({ undo: () => this.swap(e, after, before), redo: () => this.swap(e, before, after) });
    return after;
  }

  revert(e: Entity) {
    const before = e.textureOptimization;
    if (!before) return;
    this.swap(e, before, undefined);
    this.editor.record({ undo: () => this.swap(e, undefined, before), redo: () => this.swap(e, before, undefined) });
  }

  // ---------- Saving and copies ----------

  serialize(e: Entity) {
    const o = e.textureOptimization;
    if (!o) return null;
    const originals = this.originalTextures(e);
    return {
      settings: { ...o.settings },
      textures: o.encoded.map((t) => ({ index: originals.indexOf(t.original), format: t.format, width: t.width, height: t.height, data: t.data })),
    };
  }

  /** Puts saved textures back (no re-encoding). */
  restore(e: Entity, settings: TextureSettings, textures: { index: number; format: 'ktx2' | 'png'; width: number; height: number; data: Uint8Array }[]) {
    const originals = this.originalTextures(e);
    const encoded: EncodedTexture[] = [];
    for (const t of textures) {
      const original = originals[t.index];
      if (!original) continue;
      encoded.push({ original, data: t.data, format: t.format, width: t.width, height: t.height, replacement: makeTexture(this.editor.scene, original, t.data, t.format) });
    }
    if (encoded.length) this.swap(e, undefined, this.build(e, settings, encoded));
  }

  copy(from: Entity, to: Entity) {
    const saved = this.serialize(from);
    if (saved) this.restore(to, saved.settings, saved.textures);
  }

  // ---------- Internals ----------

  /** Material slots holding an image texture (original ones when `original` is set). */
  private slotsOf(e: Entity, original: boolean) {
    const out: { material: Material; property: string; texture: BaseTexture; color: boolean; normal?: boolean }[] = [];
    const swapped = new Map((e.textureOptimization?.changes ?? []).map((c) => [`${c.material.uniqueId}:${c.property}`, c.original]));
    for (const material of this.editor.materialsOf(e)) {
      for (const s of SLOTS) {
        let texture = (material as unknown as Record<string, BaseTexture | null>)[s.property];
        if (original) texture = swapped.get(`${material.uniqueId}:${s.property}`) ?? texture;
        if (texture && !texture.isCube && !texture.isRenderTarget) out.push({ material, property: s.property, texture, color: s.color, normal: s.normal });
      }
    }
    return out;
  }

  /**
   * Prepares textures for the glTF exporter, which can't read compressed GPU textures: KTX2
   * replacements go back to the originals while exporting (and are returned so the compact
   * export can embed them); downscaled PNGs stay only in the compact export. Returns the restore.
   */
  forExport(compact: boolean) {
    const ktx2: { material: string; property: string; data: Uint8Array }[] = [];
    const undo: (() => void)[] = [];
    for (const e of this.editor.entities) {
      const o = e.textureOptimization;
      if (!o) continue;
      for (const c of o.changes) {
        const t = o.encoded.find((x) => x.replacement === c.replacement);
        if (compact && t?.format === 'png') continue;
        if (compact && t?.format === 'ktx2') ktx2.push({ material: c.material.name, property: c.property, data: t.data });
        const slots = c.material as unknown as Record<string, BaseTexture>;
        slots[c.property] = c.original;
        undo.push(() => (slots[c.property] = c.replacement));
      }
    }
    return { ktx2, restore: () => undo.forEach((u) => u()) };
  }

  /** Original textures in a stable order (saved files refer to them by position). */
  private originalTextures(e: Entity) {
    return [...new Set(this.slotsOf(e, true).map((s) => s.texture))];
  }

  private build(e: Entity, settings: TextureSettings, encoded: EncodedTexture[]): TextureOptimization {
    const changes: SlotChange[] = [];
    for (const s of this.slotsOf(e, true)) {
      const t = encoded.find((x) => x.original === s.texture);
      if (t) changes.push({ material: s.material, property: s.property, original: s.texture, replacement: t.replacement });
    }
    const before = encoded.reduce((n, t) => {
      const size = t.original.getSize();
      return n + textureBytes(size.width, size.height, false);
    }, 0);
    const after = encoded.reduce((n, t) => n + textureBytes(t.width, t.height, t.format === 'ktx2'), 0);
    return { settings: { ...settings }, encoded, changes, before, after };
  }

  private swap(e: Entity, from: TextureOptimization | undefined, to: TextureOptimization | undefined) {
    for (const c of from?.changes ?? []) (c.material as unknown as Record<string, BaseTexture>)[c.property] = c.original;
    for (const c of to?.changes ?? []) (c.material as unknown as Record<string, BaseTexture>)[c.property] = c.replacement;
    e.textureOptimization = to;
    this.editor.invalidate();
    this.editor.notify('optimize');
  }

  private checkCancelled() {
    if (this.cancelled) throw new DOMException('Cancelled', 'AbortError');
  }

  /** Downscale (if asked), then KTX2 or PNG; bounded tile encoding. */
  private async encode(job: TextureJob, onProgress: (p: number) => void) {
    let { pixels, width, height } = job;
    if (job.maxSize && Math.max(width, height) > job.maxSize) {
      const scale = job.maxSize / Math.max(width, height);
      const w = Math.max(4, Math.round((width * scale) / 4) * 4);
      const h = Math.max(4, Math.round((height * scale) / 4) * 4);
      pixels = await resize(pixels, width, height, w, h);
      width = w;
      height = h;
    }
    const base = { color: job.color, normalMap: job.normalMap };
    if (!job.compress) {
      const data = await this.run({ ...base, pixels, width, height, format: 'png', mipmaps: false, supercompress: false });
      onProgress(1);
      return { data, format: 'png' as const, width, height };
    }
    const data =
      width * height <= ENCODER_LIMIT
        ? await this.run({ ...base, pixels, width, height, format: 'ktx2', mipmaps: true, supercompress: true })
        : write(await this.encodeLarge(pixels, width, height, base, onProgress));
    onProgress(1);
    return { data, format: 'ktx2' as const, width, height };
  }

  /**
   * Images over the encoder limit (4K and up), kept at full resolution: UASTC encodes every 4×4
   * block on its own. Stitch each tile immediately with a device-dependent worker limit.
   * Encode mipmaps afterwards, so their encoder does not add to the parallel tile budget.
   */
  private async encodeLarge(pixels: Uint8Array, width: number, height: number, base: { color: boolean; normalMap: boolean }, onProgress: (p: number) => void): Promise<KTX2Container> {
    if (width % 4 || height % 4) throw new Error(tr('Texture size must be a multiple of 4 to compress at full resolution. Choose a maximum size.'));
    const tiles: { x: number; y: number; w: number; h: number }[] = [];
    for (let y = 0; y < height; y += TILE) for (let x = 0; x < width; x += TILE) tiles.push({ x, y, w: Math.min(TILE, width - x), h: Math.min(TILE, height - y) });
    let done = 0;
    const step = () => onProgress(++done / (tiles.length + 1));
    const blocksW = width / 4;
    const level0 = new Uint8Array(blocksW * (height / 4) * 16);
    let out: KTX2Container | undefined;
    let next = 0;
    const limit = Math.min(tiles.length, this.workerLimit(width, height));
    await Promise.all(Array.from({ length: limit }, async () => {
      while (next < tiles.length) {
        const t = tiles[next++];
        this.checkCancelled();
        const tile = new Uint8Array(t.w * t.h * 4);
        for (let y = 0; y < t.h; y++) tile.set(pixels.subarray(((t.y + y) * width + t.x) * 4, ((t.y + y) * width + t.x + t.w) * 4), y * t.w * 4);
        const c = read(await this.run({ ...base, pixels: tile, width: t.w, height: t.h, format: 'ktx2', mipmaps: false, supercompress: false }));
        const blocks = c.levels[0].levelData;
        const tbw = t.w / 4;
        for (let r = 0; r < t.h / 4; r++) level0.set(blocks.subarray(r * tbw * 16, (r + 1) * tbw * 16), ((t.y / 4 + r) * blocksW + t.x / 4) * 16);
        if (!out) {
          out = c;
          // Keep metadata, not the first tile's backing buffer.
          out.levels = [];
        }
        step();
      }
    }));
    this.checkCancelled();
    const h = await resize(pixels, width, height, width / 2, height / 2);
    const rest = (width / 2) * (height / 2) <= ENCODER_LIMIT
      ? read(await this.run({ ...base, pixels: h, width: width / 2, height: height / 2, format: 'ktx2', mipmaps: true, supercompress: false }))
      : await this.encodeLarge(h, width / 2, height / 2, base, () => {});
    step();
    if (!out) throw new Error('No texture tiles');
    out.pixelWidth = width;
    out.pixelHeight = height;
    out.levels = [{ levelData: level0, uncompressedByteLength: level0.length }, ...rest.levels];
    out.levelCount = out.levels.length;
    out.supercompressionScheme = 0;
    return out;
  }

  private workerLimit(width: number, height: number) {
    return textureWorkerLimit(width, height, navigator.hardwareConcurrency,
      (navigator as Navigator & { deviceMemory?: number }).deviceMemory, deviceBudget().phone);
  }

  /** One image in a disposable worker, releasing its WASM heap after encoding. */
  private run(request: EncodeRequest) {
    return new Promise<Uint8Array>((resolve, reject) => {
      this.checkCancelled();
      const worker = new Worker(new URL('./textures.worker.ts', import.meta.url), { type: 'module' });
      const end = () => {
        worker.terminate();
        this.workers.delete(worker);
      };
      this.workers.set(worker, () => {
        end();
        reject(new DOMException('Cancelled', 'AbortError'));
      });
      worker.onmessage = (ev) => {
        end();
        if (ev.data.type === 'done') resolve(ev.data.data);
        else reject(new Error(ev.data.message));
      };
      worker.onerror = (ev) => {
        end();
        reject(new Error(ev.message || 'Worker error'));
      };
      try {
        worker.postMessage(request, [request.pixels.buffer as ArrayBuffer]);
      } catch (error) {
        end();
        reject(error);
      }
    });
  }
}

/** High-quality resampling of RGBA pixels. */
async function resize(pixels: Uint8Array, width: number, height: number, w: number, h: number) {
  const bitmap = await createImageBitmap(new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer, pixels.byteOffset, pixels.byteLength), width, height), {
    resizeWidth: w,
    resizeHeight: h,
    resizeQuality: 'high',
  });
  const canvas = new OffscreenCanvas(w, h);
  try {
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    return new Uint8Array(ctx.getImageData(0, 0, w, h).data.buffer);
  } finally {
    bitmap.close();
    canvas.width = canvas.height = 1;
  }
}

/** Pixels of a texture as stored on the GPU (RGBA8, first row as uploaded). */
async function readTexture(t: BaseTexture, settings: TextureSettings, color: boolean, normalMap: boolean): Promise<TextureJob> {
  const size = t.getSize();
  const data = await t.readPixels(0, 0, null, true, false);
  if (!data) throw new Error(tr('Could not read the texture {name}.', { name: t.name }));
  const pixels = data instanceof Uint8Array ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return { pixels, width: size.width, height: size.height, maxSize: settings.maxSize, compress: settings.compress, color, normalMap };
}

/**
 * A texture from encoded bytes, sampled exactly like the original. The bytes keep the GPU row
 * order of the original, so they load without flipping.
 */
function makeTexture(scene: Scene, original: BaseTexture, data: Uint8Array, format: 'ktx2' | 'png') {
  const url = URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>], { type: format === 'ktx2' ? 'image/ktx2' : 'image/png' }));
  const release = () => URL.revokeObjectURL(url);
  const t = new Texture(url, scene, { noMipmap: false, invertY: false, buffer: data, forcedExtension: format === 'ktx2' ? '.ktx2' : '.png', onLoad: release, onError: release });
  t.onDisposeObservable.addOnce(release);
  t.name = `${original.name} (${format.toUpperCase()})`;
  const o = original as Texture;
  t.wrapU = o.wrapU;
  t.wrapV = o.wrapV;
  t.coordinatesIndex = o.coordinatesIndex;
  t.uScale = o.uScale ?? 1;
  t.vScale = o.vScale ?? 1;
  t.uOffset = o.uOffset ?? 0;
  t.vOffset = o.vOffset ?? 0;
  t.uAng = o.uAng ?? 0;
  t.vAng = o.vAng ?? 0;
  t.wAng = o.wAng ?? 0;
  t.level = o.level;
  t.hasAlpha = o.hasAlpha;
  t.gammaSpace = o.gammaSpace;
  t.getAlphaFromRGB = o.getAlphaFromRGB;
  return t;
}
