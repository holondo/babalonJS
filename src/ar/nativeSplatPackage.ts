import type { SplatLodTree } from '../optimize/splatLodMath';

export const NATIVE_SPLAT_EXTENSION = 'BABALON_ar_gaussian_lod';
export interface NativeSplatPart { tree: SplatLodTree; matrix: number[]; alpha: number; }

/** Session-only GLB extension; no project/source buffer is modified or transferred. */
export async function appendNativeSplats(glb: Blob, parts: NativeSplatPart[]): Promise<Blob> {
  if (!parts.length) return glb;
  const input = await glb.arrayBuffer(), view = new DataView(input);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('Invalid session GLB');
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(input, 20, jsonLength)));
  const binOffset = 20 + jsonLength;
  const bin = binOffset < input.byteLength ? new Uint8Array(input, binOffset + 8, view.getUint32(binOffset, true)) : new Uint8Array();
  const chunks: Uint8Array<ArrayBuffer>[] = [bin];
  let length = bin.byteLength;
  json.bufferViews ??= [];
  const meshBufferViewCount = json.bufferViews.length;
  const add = (data: ArrayBufferView<ArrayBuffer> | ArrayBuffer) => {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const index = json.bufferViews.length;
    json.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes.byteLength });
    chunks.push(bytes); length += bytes.byteLength;
    return index;
  };
  const trees = parts.map(({ tree, matrix, alpha }) => ({
    root: tree.root, count: tree.radii.length, sourceCount: tree.sourceCount,
    records: add(tree.data), radii: add(tree.radii as Float32Array<ArrayBuffer>),
    children: add(tree.children as Int32Array<ArrayBuffer>), matrix, alpha,
  }));
  json.buffers = [{ byteLength: length }];
  json.extensions ??= {};
  json.extensions[NATIVE_SPLAT_EXTENSION] = { version: 1, meshBufferByteLength: bin.byteLength, meshBufferViewCount, trees };
  json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), NATIVE_SPLAT_EXTENSION])];
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const padded = new Uint8Array(Math.ceil(encoded.length / 4) * 4); padded.fill(32); padded.set(encoded);
  const header = new ArrayBuffer(20), h = new DataView(header);
  h.setUint32(0, 0x46546c67, true); h.setUint32(4, 2, true); h.setUint32(8, 28 + padded.length + length, true);
  h.setUint32(12, padded.length, true); h.setUint32(16, 0x4e4f534a, true);
  const binHeader = new ArrayBuffer(8), bh = new DataView(binHeader);
  bh.setUint32(0, length, true); bh.setUint32(4, 0x004e4942, true);
  return new Blob([header, padded, binHeader, ...chunks], { type: 'model/gltf-binary' });
}
