// Builds the built-in animation library (public/animations/) and the Mannequin samples
// (public/models/mannequin.glb, rigged; mannequin-static.glb, no skeleton, to try rigging)
// from the Quaternius Universal Animation Library (CC0).
//
// Usage:
//   node scripts/build-animation-library.mjs "<path>/AnimationLibrary_Godot_Standard.glb"
//
// Source: https://opengameart.org/content/universal-animation-library (Standard, CC0 1.0).
// No dependencies: reads and writes binary glTF directly.
//
// Each clip becomes its own small .glb (skeleton nodes + one animation, no mesh), so the app
// downloads only the clips that are used. Channels are optimized without visible change:
// constant channels are reduced to one key and keys that linear interpolation reproduces
// are removed.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = process.argv[2];
if (!SRC) {
  console.error('Usage: node scripts/build-animation-library.mjs <AnimationLibrary_Godot_Standard.glb>');
  process.exit(1);
}
const OUT_ANIMS = 'public/animations';
const OUT_MODEL = 'public/models/mannequin.glb';
const OUT_STATIC = 'public/models/mannequin-static.glb';
/** Clip embedded in the Mannequin sample so it doesn't stand in a T-pose. */
const MANNEQUIN_CLIP = 'Idle_Loop';
/** Duplicates (root-motion variants) and the reference pose are not bundled. */
const SKIP = new Set(['A_TPose', 'Roll_RM', 'Sword_Attack_RM']);
/** Allowed error when removing keys (radians-ish for quaternions, meters for translations). */
const EPS = { rotation: 2e-4, translation: 1e-4, scale: 1e-4 };

// ---------- GLB I/O ----------

function readGlb(path) {
  const d = readFileSync(path);
  if (d.readUInt32LE(0) !== 0x46546c67) throw new Error('Not a GLB file');
  const jsonLen = d.readUInt32LE(12);
  const json = JSON.parse(d.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;
  const binLen = d.readUInt32LE(20 + jsonLen);
  return { json, bin: d.subarray(binStart, binStart + binLen) };
}

function writeGlb(path, json, bin) {
  const pad = (buf, byte) => Buffer.concat([buf, Buffer.alloc((4 - (buf.length % 4)) % 4, byte)]);
  const jsonBuf = pad(Buffer.from(JSON.stringify(json), 'utf8'), 0x20);
  const binBuf = pad(bin, 0);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);
  const chunk = (buf, type) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(buf.length, 0);
    h.writeUInt32LE(type, 4);
    return Buffer.concat([h, buf]);
  };
  writeFileSync(path, Buffer.concat([header, chunk(jsonBuf, 0x4e4f534a), chunk(binBuf, 0x004e4942)]));
}

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

/** Raw bytes of an accessor (tightly packed). */
function accessorBytes(src, index) {
  const a = src.json.accessors[index];
  const bv = src.json.bufferViews[a.bufferView];
  const elem = COMPONENTS[a.type] * BYTES[a.componentType];
  if (bv.byteStride && bv.byteStride !== elem) throw new Error('Interleaved buffers are not supported');
  const start = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  return src.bin.subarray(start, start + a.count * elem);
}

function readFloats(src, index) {
  const b = accessorBytes(src, index);
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

/** Collects binary data and creates accessors for a new file. */
class Packer {
  constructor() {
    this.parts = [];
    this.length = 0;
    this.bufferViews = [];
    this.accessors = [];
  }
  add(bytes, accessor, target) {
    const offset = this.length;
    this.parts.push(bytes);
    this.length += bytes.length;
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) {
      this.parts.push(Buffer.alloc(pad));
      this.length += pad;
    }
    const bv = { buffer: 0, byteOffset: offset, byteLength: bytes.length };
    if (target) bv.target = target;
    this.bufferViews.push(bv);
    this.accessors.push({ ...accessor, bufferView: this.bufferViews.length - 1 });
    delete this.accessors[this.accessors.length - 1].byteOffset;
    return this.accessors.length - 1;
  }
  floats(values, type) {
    const n = COMPONENTS[type];
    const acc = { componentType: 5126, count: values.length / n, type };
    if (type === 'SCALAR') {
      acc.min = [Math.min(...values)];
      acc.max = [Math.max(...values)];
    }
    return this.add(Buffer.from(new Float32Array(values).buffer), acc);
  }
  buffer() {
    return Buffer.concat(this.parts);
  }
}

// ---------- Key reduction ----------

function lerpError(values, n, i0, i, i1, t) {
  let err = 0;
  for (let c = 0; c < n; c++) {
    const a = values[i0 * n + c];
    const b = values[i1 * n + c];
    err = Math.max(err, Math.abs(a + (b - a) * t - values[i * n + c]));
  }
  return err;
}

/** Removes keys that linear interpolation between the kept neighbors reproduces within `eps`. */
function reduceKeys(times, values, n, eps) {
  const count = times.length;
  const keep = [0];
  for (let i = 1; i < count - 1; i++) {
    const i0 = keep[keep.length - 1];
    // Every skipped key between the last kept one and i+1 must still be reproduced
    let ok = true;
    for (let j = i0 + 1; j <= i && ok; j++) {
      const t = (times[j] - times[i0]) / (times[i + 1] - times[i0]);
      ok = lerpError(values, n, i0, j, i + 1, t) <= eps;
    }
    if (!ok) keep.push(i);
  }
  if (count > 1) keep.push(count - 1);
  const constant = keep.length === 2 && lerpError(values, n, 0, count - 1, count - 1, 0) <= eps;
  const idx = constant ? [0] : keep;
  return {
    times: idx.map((i) => times[i]),
    values: idx.flatMap((i) => Array.from(values.subarray(i * n, i * n + n))),
  };
}

/** Quaternion keys: keep each key in the same hemisphere as the previous one before comparing. */
function fixHemispheres(values) {
  for (let i = 4; i < values.length; i += 4) {
    const dot = values[i] * values[i - 4] + values[i + 1] * values[i - 3] + values[i + 2] * values[i - 2] + values[i + 3] * values[i - 1];
    if (dot < 0) for (let c = 0; c < 4; c++) values[i + c] = -values[i + c];
  }
}

function sameAsRest(values, n, rest, eps) {
  for (let i = 0; i < values.length; i += n) for (let c = 0; c < n; c++) if (Math.abs(values[i + c] - rest[c]) > eps) return false;
  return true;
}

// ---------- Build ----------

const src = readGlb(SRC);
const g = src.json;
const meshNode = g.nodes.findIndex((n) => n.mesh !== undefined);
const skeletonNodes = g.nodes.map((n, i) => i).filter((i) => i !== meshNode);
const remap = new Map(skeletonNodes.map((old, i) => [old, i]));

/** Skeleton nodes only (no mesh, no skin), with indices remapped. */
function skeletonJSON() {
  return skeletonNodes.map((old) => {
    const { children, mesh, skin, ...rest } = g.nodes[old];
    const node = { ...rest };
    const kids = (children ?? []).filter((c) => remap.has(c)).map((c) => remap.get(c));
    if (kids.length) node.children = kids;
    return node;
  });
}

const REST = {
  rotation: (n) => n.rotation ?? [0, 0, 0, 1],
  translation: (n) => n.translation ?? [0, 0, 0],
  scale: (n) => n.scale ?? [1, 1, 1],
};

/** Optimized copy of an animation into `packer`, targeting nodes through `nodeIndex`. */
function packAnimation(anim, packer, nodeIndex) {
  const samplers = [];
  const channels = [];
  for (const ch of anim.channels) {
    const path = ch.target.path;
    const node = g.nodes[ch.target.node];
    const sampler = anim.samplers[ch.sampler];
    const n = path === 'rotation' ? 4 : 3;
    const times = readFloats(src, sampler.input);
    const values = readFloats(src, sampler.output);
    if (path === 'rotation') fixHemispheres(values);
    // Scale and translation that never leave the rest pose add nothing
    if (path !== 'rotation' && sameAsRest(values, n, REST[path](node), EPS[path])) continue;
    const reduced = reduceKeys(times, values, n, EPS[path]);
    const input = packer.floats(reduced.times, 'SCALAR');
    const output = packer.floats(reduced.values, n === 4 ? 'VEC4' : 'VEC3');
    samplers.push({ input, output, interpolation: 'LINEAR' });
    channels.push({ sampler: samplers.length - 1, target: { node: nodeIndex(ch.target.node), path } });
  }
  return { name: anim.name, samplers, channels };
}

const asset = { version: '2.0', generator: 'babalon JS build-animation-library', copyright: 'CC0 1.0 - Universal Animation Library by Quaternius' };

mkdirSync(OUT_ANIMS, { recursive: true });
const index = [];
let total = 0;
for (const anim of g.animations) {
  if (SKIP.has(anim.name)) continue;
  const packer = new Packer();
  const out = packAnimation(anim, packer, (i) => remap.get(i));
  const sceneRoot = remap.get(g.scenes[g.scene ?? 0].nodes[0]);
  const json = {
    asset,
    scene: 0,
    scenes: [{ name: 'Scene', nodes: [sceneRoot] }],
    nodes: skeletonJSON(),
    animations: [out],
    accessors: packer.accessors,
    bufferViews: packer.bufferViews,
    buffers: [{ byteLength: packer.length }],
  };
  const file = `${anim.name}.glb`;
  writeGlb(join(OUT_ANIMS, file), json, packer.buffer());
  const size = readFileSync(join(OUT_ANIMS, file)).length;
  total += size;
  const times = readFloats(src, anim.samplers[0].input);
  index.push({ name: anim.name, file, seconds: +times[times.length - 1].toFixed(2), kb: Math.round(size / 1024) });
}

/** Mesh data copied into a new file (`skinned`: with joints and weights). */
function packMeshes(packer, skinned) {
  const used = new Map();
  const copy = (i, target) => {
    if (!used.has(i)) used.set(i, packer.add(accessorBytes(src, i), g.accessors[i], target));
    return used.get(i);
  };
  const meshes = g.meshes.map((m) => ({
    ...m,
    primitives: m.primitives.map((p) => ({
      ...p,
      indices: copy(p.indices, 34963),
      attributes: Object.fromEntries(
        Object.entries(p.attributes)
          .filter(([k]) => skinned || !/^(JOINTS|WEIGHTS)_/.test(k))
          .map(([k, v]) => [k, copy(v, 34962)]),
      ),
    })),
  }));
  return { meshes, copy };
}

mkdirSync('public/models', { recursive: true });

// Mannequin: the full model (mesh + skin) with one clip
{
  const packer = new Packer();
  const { meshes, copy } = packMeshes(packer, true);
  const skins = g.skins.map((s) => ({ ...s, inverseBindMatrices: copy(s.inverseBindMatrices) }));
  const clip = packAnimation(g.animations.find((a) => a.name === MANNEQUIN_CLIP), packer, (i) => i);
  const json = {
    asset,
    scene: 0,
    scenes: g.scenes,
    nodes: g.nodes,
    meshes,
    skins,
    materials: g.materials,
    animations: [clip],
    accessors: packer.accessors,
    bufferViews: packer.bufferViews,
    buffers: [{ byteLength: packer.length }],
  };
  writeGlb(OUT_MODEL, json, packer.buffer());
  console.log(`${OUT_MODEL}: ${Math.round(readFileSync(OUT_MODEL).length / 1024)} KB`);
}

// Static Mannequin (no skeleton, T-pose): a free model to try rigging on
{
  const packer = new Packer();
  const { meshes } = packMeshes(packer, false);
  const { skin, ...node } = g.nodes[meshNode];
  void skin;
  const json = {
    asset,
    scene: 0,
    scenes: [{ name: 'Scene', nodes: [0] }],
    nodes: [{ ...node, mesh: 0 }],
    meshes,
    materials: g.materials,
    accessors: packer.accessors,
    bufferViews: packer.bufferViews,
    buffers: [{ byteLength: packer.length }],
  };
  writeGlb(OUT_STATIC, json, packer.buffer());
  console.log(`${OUT_STATIC}: ${Math.round(readFileSync(OUT_STATIC).length / 1024)} KB`);
}

console.log(`${index.length} clips, ${Math.round(total / 1024)} KB in ${OUT_ANIMS}`);
for (const c of index) console.log(`  ${c.name.padEnd(24)} ${String(c.seconds).padStart(5)} s ${String(c.kb).padStart(4)} KB`);
