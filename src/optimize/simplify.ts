/**
 * Triangle reduction (decision D1: meshoptimizer), run in a Web Worker with progress and cancel.
 * Pure data in and out: index buffers over the original vertices, one per mesh and per level.
 */

export interface SimplifyMesh {
  positions: Float32Array;
  normals?: Float32Array;
  uvs?: Float32Array;
  /** RGBA per vertex. */
  colors?: Float32Array;
  indices: Uint32Array;
}

export interface SimplifyJob {
  meshes: SimplifyMesh[];
  /** Target fraction of triangles for each level (1 = unchanged). */
  ratios: number[];
  /** Keep open borders (holes, cut edges) exactly in place. */
  lockBorder: boolean;
}

export interface SimplifyLevel {
  /** One index buffer per input mesh (indices into its original vertices). */
  indices: Uint32Array[];
  /** Worst deviation, relative to the mesh size (0.01 = 1 %). */
  error: number;
}

export interface SimplifyTask {
  promise: Promise<SimplifyLevel[]>;
  cancel: () => void;
}

export function simplifyMeshes(job: SimplifyJob, onProgress: (p: number) => void = () => {}): SimplifyTask {
  const worker = new Worker(new URL('./simplify.worker.ts', import.meta.url), { type: 'module' });
  let reject: (e: Error) => void = () => {};
  const promise = new Promise<SimplifyLevel[]>((resolve, rej) => {
    reject = rej;
    worker.onmessage = (ev: MessageEvent) => {
      const m = ev.data;
      if (m.type === 'progress') onProgress(m.value);
      else {
        worker.terminate();
        if (m.type === 'done') resolve(m.levels);
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
