// Minimal glTF binary reader for offline reference extraction (node transforms, quantized attributes).
import { readFileSync } from 'node:fs';

export function readGlb(file) {
  const bytes = readFileSync(file), jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString()), bin = bytes.subarray(20 + jsonLength + 8);
  const parents = new Map();
  json.nodes.forEach((node, i) => (node.children ?? []).forEach(child => parents.set(child, i)));
  const local = node => {
    if (node.matrix) return node.matrix;
    const [tx, ty, tz] = node.translation ?? [0, 0, 0], [x, y, z, w] = node.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = node.scale ?? [1, 1, 1];
    return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0, 2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0, 2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
  };
  const multiply = (a, b) => { const r = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) for (let l = 0; l < 4; l++) r[k * 4 + i] += a[l * 4 + i] * b[k * 4 + l]; return r; };
  const world = i => { let m = local(json.nodes[i]); for (let p = parents.get(i); p !== undefined; p = parents.get(p)) m = multiply(local(json.nodes[p]), m); return m; };
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const read = index => {
    const a = json.accessors[index], v = json.bufferViews[a.bufferView], size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const bytesPer = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
    const get = { 5120: o => view.getInt8(o), 5121: o => view.getUint8(o), 5122: o => view.getInt16(o, true), 5123: o => view.getUint16(o, true), 5125: o => view.getUint32(o, true), 5126: o => view.getFloat32(o, true) }[a.componentType];
    const stride = v.byteStride ?? bytesPer * size, base = (v.byteOffset ?? 0) + (a.byteOffset ?? 0), out = new Float64Array(a.count * size);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < size; k++) out[i * size + k] = get(base + i * stride + k * bytesPer);
    return out;
  };
  /** World-space positions (meters) and indices of every mesh node whose name passes `accept`. */
  function meshes(accept) {
    const result = [];
    json.nodes.forEach((node, i) => {
      if (node.mesh === undefined || !accept(node)) return;
      const m = world(i), positions = [], indices = [];
      for (const primitive of json.meshes[node.mesh].primitives) {
        const base = positions.length / 3, raw = read(primitive.attributes.POSITION);
        for (let k = 0; k < raw.length; k += 3) positions.push(m[0] * raw[k] + m[4] * raw[k + 1] + m[8] * raw[k + 2] + m[12], m[1] * raw[k] + m[5] * raw[k + 1] + m[9] * raw[k + 2] + m[13], m[2] * raw[k] + m[6] * raw[k + 1] + m[10] * raw[k + 2] + m[14]);
        if (primitive.indices !== undefined) for (const index of read(primitive.indices)) indices.push(index + base);
      }
      result.push({ name: node.name, extras: node.extras ?? {}, positions: Float64Array.from(positions), indices: Uint32Array.from(indices) });
    });
    return result;
  }
  return { asset: json.asset, meshes };
}
