/// <reference lib="webworker" />
/** Face connectivity of a large mesh, off the main thread (see FaceSelection.prefetch). */
import { computeTopology } from './faceTopology';

self.onmessage = (ev: MessageEvent<{ positions: Float32Array; indices: Uint32Array }>) => {
  const t = computeTopology(ev.data.positions, ev.data.indices);
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(t, [t.offsets.buffer, t.list.buffer, t.weld.buffer, t.vertexStart.buffer, t.vertexFaces.buffer]);
};
