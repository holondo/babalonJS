/// <reference lib="webworker" />
/**
 * Triangle reduction with meshoptimizer (quadric error simplification aware of attributes).
 *
 * It only collapses edges onto vertices that already exist, so the result is a new index buffer
 * over the original vertices: UVs, normals, colors and skin weights stay valid and textures keep
 * their full quality. Attribute seams (UV and normal splits) are preserved.
 */
import { MeshoptSimplifier } from 'meshoptimizer';
import type { SimplifyJob } from './simplify';

const post = (m: unknown, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer);

self.onmessage = async (ev: MessageEvent<SimplifyJob>) => {
  try {
    await MeshoptSimplifier.ready;
    const { meshes, ratios, lockBorder } = ev.data;
    const total = meshes.length * ratios.length;
    const levels = ratios.map(() => ({ indices: [] as Uint32Array[], error: 0 }));
    let done = 0;
    for (const mesh of meshes) {
      const n = mesh.positions.length / 3;
      // Attributes compared during simplification: normal (3), UV (2), color (3)
      const stride = 8;
      const attributes = new Float32Array(n * stride);
      for (let i = 0; i < n; i++) {
        if (mesh.normals) attributes.set(mesh.normals.subarray(i * 3, i * 3 + 3), i * stride);
        if (mesh.uvs) attributes.set(mesh.uvs.subarray(i * 2, i * 2 + 2), i * stride + 3);
        if (mesh.colors) attributes.set(mesh.colors.subarray(i * 4, i * 4 + 3), i * stride + 5);
      }
      const weights = [0.5, 0.5, 0.5, mesh.uvs ? 1 : 0, mesh.uvs ? 1 : 0, mesh.colors ? 0.5 : 0, mesh.colors ? 0.5 : 0, mesh.colors ? 0.5 : 0];
      ratios.forEach((ratio, l) => {
        let indices = mesh.indices;
        let error = 0;
        if (ratio < 1) {
          const target = Math.max(3, Math.floor((mesh.indices.length * ratio) / 3) * 3);
          [indices, error] = MeshoptSimplifier.simplifyWithAttributes(mesh.indices, mesh.positions, 3, attributes, stride, weights, null, target, 1, lockBorder ? ['LockBorder'] : []);
        }
        levels[l].indices.push(indices);
        levels[l].error = Math.max(levels[l].error, error);
        post({ type: 'progress', value: ++done / total });
      });
    }
    post({ type: 'done', levels }, levels.flatMap((l) => l.indices.map((i) => i.buffer as ArrayBuffer)));
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
