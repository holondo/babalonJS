import { generateAnatomy } from './generation';
import type { AnatomyJob } from './contracts';
import { referencePositions, referenceStageKey } from './pose';

self.onmessage = ({ data }: MessageEvent<AnatomyJob>) => {
  try {
    const start = performance.now(), result = generateAnatomy(data.parameters, data.layers);
    const transfer = new Set<ArrayBuffer>(), key = referenceStageKey(data.parameters);
    // The parameter-only posing stage runs here, off the main thread (see `posedPositions`).
    const meshes = new Set([...Object.values(result.meshes).flat(), ...(result.contactLean ? [result.contactLean] : []), ...(result.lumbarFascia ?? [])]);
    for (const mesh of meshes) {
      mesh.referencePositions = referencePositions(mesh, data.parameters); mesh.referenceKey = key;
      for (const a of [mesh.materialPositions, mesh.positions, mesh.normals, mesh.indices, mesh.fibers, mesh.longitudinal, mesh.tissue, mesh.rig, mesh.fatPaintMm, mesh.referencePositions]) if (a) transfer.add(a.buffer as ArrayBuffer);
    }
    self.postMessage({ id: data.id, ...result, computeMs: performance.now() - start }, [...transfer]);
  } catch (error) {
    self.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) });
  }
};
