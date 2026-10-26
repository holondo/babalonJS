import { GLTFExporter } from '@babylonjs/serializers/glTF/2.0/glTFExporter.js';
import type { IMeshPrimitive, AccessorType } from 'babylonjs-gltf2interface';
import { isSplat, SPLAT_GLTF_EXTENSION as SPLAT_EXTENSION } from './splats';
import { materialToJSON } from './state';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import type { Node } from '@babylonjs/core/node.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { GaussianSplattingMeshBase } from '@babylonjs/core/Meshes/GaussianSplatting/gaussianSplattingMeshBase.js';
import { tr } from './i18n';
import { STANDARD_SPLAT_EXTENSION, standardSplatAttributes } from './splatStandard';

const sources = new WeakMap<Node, GaussianSplattingMeshBase>();
const standardProxies = new WeakSet<Node>();

/** Keep Babylon's triangle exporter away from splat counts and billboard buffers. */
export function prepareSplatExport(scene: Scene, standard = false) {
  const proxies = scene.meshes.filter(isSplat).filter(mesh => mesh.isEnabled() && mesh.isVisible).map(mesh => {
    const proxy = new TransformNode(mesh.name, scene);
    proxy.parent = mesh.parent;
    proxy.position.copyFrom(mesh.position);
    proxy.scaling.copyFrom(mesh.scaling);
    proxy.rotation.copyFrom(mesh.rotation);
    proxy.rotationQuaternion = mesh.rotationQuaternion?.clone() ?? null;
    proxy.setPreTransformMatrix(mesh.getPivotMatrix().clone());
    sources.set(proxy, mesh);
    if (standard) standardProxies.add(proxy);
    return proxy;
  });
  return () => proxies.forEach(proxy => proxy.dispose());
}

/** Lossless app round-trip, with an ordinary colored point cloud for other viewers. */
for (const standard of [false, true]) GLTFExporter.RegisterExtension(standard ? STANDARD_SPLAT_EXTENSION : SPLAT_EXTENSION, exporter => {
 const shared = new WeakMap<ArrayBuffer, Map<string, number>>();
 return {
  name: standard ? STANDARD_SPLAT_EXTENSION : SPLAT_EXTENSION, enabled: true, required: false, wasUsed: false, dispose() {},
  async postExportNodeAsync(_context, node, original, _map, rightHanded, buffers) {
    const mesh = sources.get(original);
    if (!mesh || standardProxies.has(original) !== standard) return node;
    const data = mesh.splatsData;
    if (!data) throw new Error(tr('Gaussian splat source data is unavailable. Reopen the original asset before exporting.'));
    const appearance = mesh.material ? materialToJSON(mesh.material) : undefined;
    const key = JSON.stringify([appearance, mesh.shDegree, Reflect.get(mesh, '_flipY'), rightHanded]);
    const cached = shared.get(data)?.get(key);
    if (cached !== undefined) { node.mesh = cached; this.wasUsed = true; return node; }
    const count = data.byteLength / 32;
    const f = new Float32Array(data), b = new Uint8Array(data);
    const positions = new Float32Array(count * 3), colors = new Float32Array(count * 4);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const flipY = !!Reflect.get(mesh, '_flipY');
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < 3; c++) {
        const value = f[i * 8 + c] * (c === 1 && flipY || c === 0 && rightHanded ? -1 : 1);
        positions[i * 3 + c] = value;
        min[c] = Math.min(min[c], value); max[c] = Math.max(max[c], value);
        const srgb = b[i * 32 + 24 + c] / 255;
        colors[i * 4 + c] = srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
      }
      colors[i * 4 + 3] = b[i * 32 + 27] / 255 * (mesh.material?.alpha ?? 1);
      if (i && i % 32768 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    const attribute = (data: Float32Array, type: 'SCALAR' | 'VEC3' | 'VEC4', bounds?: { min: number[]; max: number[] }) => {
      const accessor = buffers.createAccessor(buffers.createBufferView(data), type as AccessorType, 5126, count, 0, bounds);
      return exporter._accessors.push(accessor) - 1;
    };
    if (standard) {
      const attributes: Record<string, number> = { POSITION: attribute(positions, 'VEC3', { min, max }), COLOR_0: attribute(colors, 'VEC4') };
      for (const [name, value] of Object.entries(await standardSplatAttributes(mesh, rightHanded))) attributes[name] = attribute(value.data, value.type);
      const primitive: IMeshPrimitive = {
        mode: 0, attributes,
        extensions: { [STANDARD_SPLAT_EXTENSION]: { kernel: 'ellipse', colorSpace: 'srgb_rec709_display', projection: 'perspective', sortingMethod: 'cameraDistance' } },
      };
      node.mesh = exporter._meshes.push({ name: mesh.name, primitives: [primitive] }) - 1;
      if (!shared.has(data)) shared.set(data, new Map());
      shared.get(data)!.set(key, node.mesh);
      this.wasUsed = true;
      return node;
    }
    const extension = {
      version: 1, bufferView: -1, shDegree: Reflect.get(mesh, '_maxShDegree'),
      flipY, rightHanded, appearance,
    };
    buffers.setBufferView(extension, buffers.createBufferView(b));
    // BufferManager resolves bufferView indices only when generating the binary.
    const harmonics = (mesh.shData ?? []).map(sh => {
      const ref = { bufferView: -1 };
      buffers.setBufferView(ref, buffers.createBufferView(sh.subarray(0, count * 16)));
      return ref;
    });
    const payload = Object.assign(extension, { harmonics });
    const primitive: IMeshPrimitive = {
      mode: 0, attributes: { POSITION: attribute(positions, 'VEC3', { min, max }), COLOR_0: attribute(colors, 'VEC4') },
      extensions: { [SPLAT_EXTENSION]: payload },
    };
    node.mesh = exporter._meshes.push({ name: mesh.name, primitives: [primitive] }) - 1;
    if (!shared.has(data)) shared.set(data, new Map());
    shared.get(data)!.set(key, node.mesh);
    this.wasUsed = true;
    return node;
  },
}; });
