/**
 * Skin weights for rigging: how much each bone moves each vertex.
 *
 * - Envelope (E1, default): each vertex follows the bones closest to it (inverse
 *   distance to the bone segments), then the weights are smoothed over the surface.
 * - Heat diffusion (E2, optional, in a Web Worker): bone influence spreads over the surface
 *   like heat (Baran & Popović, "Automatic Rigging and Animation of 3D Characters", 2007),
 *   which bends shoulders, hips and armpits much more naturally.
 *
 * Both work on all the model's meshes together, welded by position (so texture seams and
 * separate parts like clothes still get smooth, consistent weights), and end with the 4
 * strongest bones per vertex.
 */

import { segmentDistance, surfaceClusters, vertexNormals, weld } from './skinMath';
import { visibleBoneDistances } from './skinVisibility';

export interface SkinInput {
  /** Vertex positions (x, y, z), all meshes together, in the skeleton's space. */
  points: Float32Array;
  /** Triangles (vertex indices into `points`). */
  triangles: Uint32Array;
  /** Bone segments: start x, y, z, end x, y, z per bone. */
  bones: Float32Array;
  /** Bones that start a limb (upper arm, upper leg): they must not pull the trunk. */
  limbRoots?: Uint8Array;
  /** The limb root of each bone, including its descendants; -1 for axial bones/clavicles. */
  limbRootOf?: Int16Array;
  /** Outward joint-plane normals. Arm planes follow the shoulder span, not the A-pose angle. */
  limbAxes?: Float32Array;
}

export interface SkinWeights {
  /** 4 bone indices per vertex. */
  indices: Float32Array;
  /** 4 weights per vertex (sum 1). */
  weights: Float32Array;
}

export const INFLUENCES = 4;

export { segmentDistance, weld };

/** Neighbors of each (welded) vertex, from the triangles (compressed: offsets + list). */
export function adjacency(count: number, triangles: Uint32Array, map?: Uint32Array) {
  const sets: Set<number>[] = Array.from({ length: count }, () => new Set());
  for (let t = 0; t < triangles.length; t += 3) {
    const a = map ? map[triangles[t]] : triangles[t];
    const b = map ? map[triangles[t + 1]] : triangles[t + 1];
    const c = map ? map[triangles[t + 2]] : triangles[t + 2];
    if (a !== b) (sets[a].add(b), sets[b].add(a));
    if (b !== c) (sets[b].add(c), sets[c].add(b));
    if (a !== c) (sets[a].add(c), sets[c].add(a));
  }
  const offsets = new Uint32Array(count + 1);
  for (let i = 0; i < count; i++) offsets[i + 1] = offsets[i] + sets[i].size;
  const list = new Uint32Array(offsets[count]);
  for (let i = 0; i < count; i++) list.set([...sets[i]], offsets[i]);
  return { offsets, list };
}

/** Envelope weights (E1): dense weights (vertex × bone) on the welded vertices, smoothed. */
export function envelopeWeights(input: SkinInput, onProgress: (p: number) => void = () => {}): { dense: Float32Array; map: Uint32Array } {
  onProgress(0);
  const { map, points } = weld(input.points);
  const n = points.length / 3;
  const B = input.bones.length / 6;
  const bones = input.bones;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 1; i < points.length; i += 3) {
    minY = Math.min(minY, points[i]);
    maxY = Math.max(maxY, points[i]);
  }
  const height = Math.max(maxY - minY, 1e-6);
  const welded = new Uint32Array(input.triangles.length);
  for (let t = 0; t < welded.length; t++) welded[t] = map[input.triangles[t]];
  const normals = vertexNormals(points, welded);
  const distances = new Float64Array(B);
  const distanceAt = visibleBoneDistances(points, welded);
  onProgress(0.1);
  const dense = new Float32Array(n * B);
  for (let i = 0; i < n; i++) {
    if (i % 8192 === 0) onProgress(0.1 + 0.75 * i / n);
    const x = points[i * 3];
    const y = points[i * 3 + 1];
    const z = points[i * 3 + 2];
    let sum = 0;
    distanceAt(x, y, z, normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2], bones, input.limbRoots, distances);
    for (let k = 0; k < B; k++) {
      const d = distances[k];
      const w = 1 / Math.pow(d * d + 1e-8, 2);
      dense[i * B + k] = w;
      sum += w;
    }
    for (let k = 0; k < B; k++) dense[i * B + k] /= sum;
  }
  onProgress(0.85);
  const smoothed = smoothOnProxy(dense, points, normals, input.triangles, map, B, height * 0.012, 16);
  limitLimbInfluence(points, bones, input.limbRootOf, smoothed, input.limbAxes);
  onProgress(0.95);
  return { dense: smoothed, map };
}

/**
 * Surface smoothing/diffusion can carry arm weights into the chest even when every chest
 * source belongs to the spine. Apply the joint's trunk boundary to the entire limb chain,
 * on the original vertices, with a smooth shoulder/hip transition (not on proxy centroids).
 */
export function limitLimbInfluence(points: Float32Array, bones: Float32Array, limbRootOf: Int16Array | undefined, dense: Float32Array, limbAxes?: Float32Array) {
  if (!limbRootOf) return;
  const B = bones.length / 6;
  const chains = new Map<number, number[]>();
  for (let b = 0; b < B; b++) {
    const root = limbRootOf[b];
    if (root < 0) continue;
    const chain = chains.get(root) ?? [];
    chain.push(b); chains.set(root, chain);
  }
  for (const [root, chain] of chains) {
    const j = root * 6;
    const length = Math.hypot(bones[j + 3] - bones[j], bones[j + 4] - bones[j + 1], bones[j + 5] - bones[j + 2]) || 1e-8;
    const transition = length * 0.25;
    const nx = limbAxes ? limbAxes[root * 3] : (bones[j + 3] - bones[j]) / length;
    const ny = limbAxes ? limbAxes[root * 3 + 1] : (bones[j + 4] - bones[j + 1]) / length;
    const nz = limbAxes ? limbAxes[root * 3 + 2] : (bones[j + 5] - bones[j + 2]) / length;
    for (let i = 0; i < points.length / 3; i++) {
      const inward = -((points[i * 3] - bones[j]) * nx + (points[i * 3 + 1] - bones[j + 1]) * ny + (points[i * 3 + 2] - bones[j + 2]) * nz);
      const t = Math.max(0, Math.min(1, inward / transition));
      if (t <= 0) continue;
      const allowed = 1 - t * t * (3 - 2 * t);
      for (const b of chain) dense[i * B + b] *= allowed;
    }
  }
}

/**
 * Smooths weights over the surface at a fixed real-world scale: vertices are grouped in grid
 * cells of `cell` size, the cells are smoothed with their neighbors, and every vertex takes its
 * cell's weights. A dense mesh (1M vertices) gets transitions as wide as a light one.
 */
function smoothOnProxy(dense: Float32Array, points: Float32Array, normals: Float32Array, triangles: Uint32Array, map: Uint32Array, B: number, cell: number, iterations: number) {
  const n = points.length / 3;
  const weldedTris = new Uint32Array(triangles.length);
  for (let t = 0; t < triangles.length; t++) weldedTris[t] = map[triangles[t]];
  const { cluster, count: C } = surfaceClusters(points, normals, weldedTris, cell);
  let w = new Float32Array(C * B);
  const count = new Float32Array(C);
  for (let i = 0; i < n; i++) {
    const c = cluster[i];
    count[c]++;
    for (let k = 0; k < B; k++) w[c * B + k] += dense[i * B + k];
  }
  for (let c = 0; c < C; c++) for (let k = 0; k < B; k++) w[c * B + k] /= count[c];
  // Cells are neighbors when a triangle connects them (separate parts stay separate)
  const tri = new Uint32Array(triangles.length);
  for (let t = 0; t < triangles.length; t++) tri[t] = cluster[map[triangles[t]]];
  const { offsets, list } = adjacency(C, tri);
  for (let iter = 0; iter < iterations; iter++) {
    const next = new Float32Array(C * B);
    for (let c = 0; c < C; c++) {
      const a = offsets[c];
      const b = offsets[c + 1];
      const deg = b - a;
      for (let k = 0; k < B; k++) {
        let s = 0;
        for (let j = a; j < b; j++) s += w[list[j] * B + k];
        next[c * B + k] = deg ? 0.5 * w[c * B + k] + (0.5 * s) / deg : w[c * B + k];
      }
    }
    w = next;
  }
  const out = new Float32Array(n * B);
  for (let i = 0; i < n; i++) out.set(w.subarray(cluster[i] * B, cluster[i] * B + B), i * B);
  return out;
}

/** Keeps the 4 strongest bones of each original vertex (dense weights are per welded vertex). */
export function strongest(dense: Float32Array, map: Uint32Array, bones: number): SkinWeights {
  const n = map.length;
  const indices = new Float32Array(n * INFLUENCES);
  const weights = new Float32Array(n * INFLUENCES);
  const best = new Array<number>(INFLUENCES);
  const bestW = new Array<number>(INFLUENCES);
  for (let i = 0; i < n; i++) {
    const row = map[i] * bones;
    best.fill(0);
    bestW.fill(-1);
    for (let k = 0; k < bones; k++) {
      const w = dense[row + k];
      if (w <= bestW[INFLUENCES - 1]) continue;
      let p = INFLUENCES - 1;
      while (p > 0 && w > bestW[p - 1]) {
        bestW[p] = bestW[p - 1];
        best[p] = best[p - 1];
        p--;
      }
      bestW[p] = w;
      best[p] = k;
    }
    let sum = 0;
    for (let s = 0; s < INFLUENCES; s++) sum += Math.max(0, bestW[s]);
    for (let s = 0; s < INFLUENCES; s++) {
      indices[i * INFLUENCES + s] = best[s];
      weights[i * INFLUENCES + s] = sum > 0 ? Math.max(0, bestW[s]) / sum : s === 0 ? 1 : 0;
    }
  }
  return { indices, weights };
}

// ---------- Background computation (both methods) ----------

export interface WeightJob {
  promise: Promise<SkinWeights>;
  cancel: () => void;
}

/** Proxy size for heat diffusion (vertices): bigger meshes are simplified first (decision D4). */
export function heatLimit() {
  return matchMedia('(pointer: coarse)').matches ? 6000 : 15000;
}

/** All expensive weight work, including packing the four influences, stays in the worker. */
export function computeSkinWeights(input: SkinInput, method: 'heat' | 'envelope', onProgress: (p: number) => void): WeightJob {
  const worker = new Worker(new URL('./weights.worker.ts', import.meta.url), { type: 'module' });
  let reject: (e: Error) => void = () => {};
  const promise = new Promise<SkinWeights>((resolve, rej) => {
    reject = rej;
    worker.onmessage = (ev: MessageEvent) => {
      const m = ev.data;
      if (m.type === 'progress') onProgress(m.value);
      else if (m.type === 'done') {
        worker.terminate();
        resolve({ indices: m.indices, weights: m.weights });
      } else if (m.type === 'error') {
        worker.terminate();
        rej(new Error(m.message));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      rej(new Error(e.message || 'Worker error'));
    };
    worker.postMessage({ points: input.points, triangles: input.triangles, bones: input.bones, limbRoots: input.limbRoots, limbRootOf: input.limbRootOf, limbAxes: input.limbAxes, method, limit: heatLimit() });
  });
  return {
    promise,
    cancel: () => {
      worker.terminate();
      reject(new DOMException('Cancelled', 'AbortError'));
    },
  };
}
