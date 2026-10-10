/// <reference lib="webworker" />
/**
 * Heat-diffusion skin weights (rigging E2), off the main thread.
 *
 * For each bone b, solves (L + M·H) w_b = M·H·p_b on the surface (Baran & Popović 2007):
 * L is the cotangent Laplacian (clamped to stay stable on rough meshes), M the lumped vertex
 * areas, H_i = 1/d_i² with d_i the distance to the nearest bone, p_b(i) = 1 where b is that
 * bone. One matrix for all bones, solved with Jacobi-preconditioned conjugate gradient.
 * Big meshes are first simplified by vertex clustering (the weights are then copied back).
 */
import { surfaceClusters, vertexNormals, weld } from './skinMath';
import { visibleBoneDistances } from './skinVisibility';
import { envelopeWeights, limitLimbInfluence, strongest } from './weights';
import type { SkinInput } from './weights';
import { SHOULDER_STRATEGIES, shoulderWeights } from './shoulderWeights';

interface Job extends SkinInput {
  points: Float32Array;
  triangles: Uint32Array;
  bones: Float32Array;
  limbRoots?: Uint8Array;
  limbRootOf?: Int16Array;
  limbAxes?: Float32Array;
  limit: number;
  method?: 'heat' | 'envelope';
}

const post = (m: unknown, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer);

self.onmessage = (ev: MessageEvent<Job>) => {
  try {
    if (ev.data.method === 'envelope') {
      const { dense, map } = envelopeWeights(ev.data, value => post({ type: 'progress', value }));
      finish(dense, map, { ...ev.data, points: weld(ev.data.points).points });
      return;
    }
    const { points, triangles, bones, limbRoots, limit } = ev.data;
    const welded = weld(points);
    let P = welded.points;
    let tris = remapTriangles(triangles, welded.map);
    let N = vertexNormals(P, tris);
    const distanceAt = visibleBoneDistances(P, tris);
    let cluster: Uint32Array | null = null;
    if (P.length / 3 > limit) {
      const d = decimate(P, N, tris, limit);
      P = d.points;
      N = d.normals;
      tris = d.triangles;
      cluster = d.cluster;
    }
    const proxy = solve(P, N, tris, bones, limbRoots, distanceAt);
    const B = bones.length / 6;
    const nWelded = welded.points.length / 3;
    let dense = proxy;
    if (cluster) {
      dense = new Float32Array(nWelded * B);
      for (let i = 0; i < nWelded; i++) dense.set(proxy.subarray(cluster[i] * B, cluster[i] * B + B), i * B);
    }
    limitLimbInfluence(welded.points, bones, ev.data.limbRootOf, dense, ev.data.limbAxes);
    finish(dense, welded.map, { ...ev.data, points: welded.points });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};

function finish(dense: Float32Array, map: Uint32Array, input: SkinInput) {
  const B = input.bones.length / 6;
  const pack = (strategy: import('./shoulderWeights').ShoulderStrategy) => {
    const treated = shoulderWeights(dense, input, strategy);
    return strongest(treated, map, treated.length / (input.points.length / 3));
  };
  if (input.comparison) {
    const variants = Object.fromEntries(SHOULDER_STRATEGIES.map(({ value }) => [value, pack(value)]));
    const transfer = Object.values(variants).flatMap(v => [v.indices.buffer, v.weights.buffer]);
    post({ type: 'done', ...variants.current, variants }, transfer);
  } else {
    const result = input.shoulderStrategy ? pack(input.shoulderStrategy) : strongest(dense, map, B);
    post({ type: 'done', ...result }, [result.indices.buffer, result.weights.buffer]);
  }
}

function remapTriangles(tris: Uint32Array, map: Uint32Array) {
  const out: number[] = [];
  for (let t = 0; t < tris.length; t += 3) {
    const a = map[tris[t]];
    const b = map[tris[t + 1]];
    const c = map[tris[t + 2]];
    if (a !== b && b !== c && a !== c) out.push(a, b, c);
  }
  return new Uint32Array(out);
}

/** Vertex clustering: one vertex per occupied grid cell, about `limit` of them. */
function decimate(P: Float32Array, N: Float32Array, tris: Uint32Array, limit: number) {
  const n = P.length / 3;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++)
    for (let c = 0; c < 3; c++) {
      min[c] = Math.min(min[c], P[i * 3 + c]);
      max[c] = Math.max(max[c], P[i * 3 + c]);
    }
  const diag = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  let cell = (diag / Math.sqrt(limit)) * 0.8;
  let cluster = new Uint32Array(n);
  let count = 0;
  for (let attempt = 0; attempt < 8; attempt++) {
    const clustered = surfaceClusters(P, N, tris, cell, min);
    cluster = clustered.cluster;
    count = clustered.count;
    if (count <= limit) break;
    cell *= 1.25;
  }
  const points = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const weight = new Float32Array(count);
  for (let i = 0; i < n; i++) {
    const c = cluster[i];
    for (let k = 0; k < 3; k++) normals[c * 3 + k] += N[i * 3 + k];
    points[c * 3] += P[i * 3];
    points[c * 3 + 1] += P[i * 3 + 1];
    points[c * 3 + 2] += P[i * 3 + 2];
    weight[c]++;
  }
  for (let c = 0; c < count; c++) {
    for (let k = 0; k < 3; k++) points[c * 3 + k] /= weight[c];
    const l = Math.hypot(normals[c * 3], normals[c * 3 + 1], normals[c * 3 + 2]) || 1;
    for (let k = 0; k < 3; k++) normals[c * 3 + k] /= l;
  }
  return { points, normals, triangles: remapTriangles(tris, cluster), cluster };
}

/** Dense weights (vertex × bone) on the given mesh. */
function solve(P: Float32Array, N: Float32Array, tris: Uint32Array, bones: Float32Array, limbRoots: Uint8Array | undefined, distanceAt: ReturnType<typeof visibleBoneDistances>) {
  const n = P.length / 3;
  const B = bones.length / 6;

  // Cotangent weights per edge (clamped ≥ 0) and lumped areas
  const edges = new Map<number, number>();
  const mass = new Float64Array(n);
  const addEdge = (i: number, j: number, w: number) => {
    const key = i < j ? i * n + j : j * n + i;
    edges.set(key, (edges.get(key) ?? 0) + w);
  };
  const v = (i: number) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
  const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  for (let t = 0; t < tris.length; t += 3) {
    const ids = [tris[t], tris[t + 1], tris[t + 2]];
    const p = ids.map(v);
    const area = Math.hypot(...cross(sub(p[1], p[0]), sub(p[2], p[0]))) / 2;
    if (area < 1e-14) continue;
    for (const i of ids) mass[i] += area / 3;
    for (let k = 0; k < 3; k++) {
      // Angle at vertex k, opposite the edge (k+1, k+2)
      const a = sub(p[(k + 1) % 3], p[k]);
      const b = sub(p[(k + 2) % 3], p[k]);
      const cot = dot(a, b) / Math.max(Math.hypot(...cross(a, b)), 1e-12);
      addEdge(ids[(k + 1) % 3], ids[(k + 2) % 3], Math.max(0, Math.min(cot, 1e3)) / 2);
    }
  }
  // Isolated vertices still need a positive diagonal
  let meanMass = 0;
  for (let i = 0; i < n; i++) meanMass += mass[i];
  meanMass = meanMass / n || 1e-6;
  for (let i = 0; i < n; i++) if (mass[i] <= 0) mass[i] = meanMass * 0.1;

  // CSR of L (off-diagonal −w, diagonal Σw) + M·H
  const rows: number[][] = Array.from({ length: n }, () => []);
  const vals: number[][] = Array.from({ length: n }, () => []);
  const diag = new Float64Array(n);
  for (const [key, w] of edges) {
    if (w <= 0) continue;
    const i = Math.floor(key / n);
    const j = key - i * n;
    rows[i].push(j);
    vals[i].push(-w);
    rows[j].push(i);
    vals[j].push(-w);
    diag[i] += w;
    diag[j] += w;
  }
  const offsets = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) offsets[i + 1] = offsets[i] + rows[i].length;
  const cols = new Uint32Array(offsets[n]);
  const data = new Float64Array(offsets[n]);
  for (let i = 0; i < n; i++) {
    cols.set(rows[i], offsets[i]);
    data.set(vals[i], offsets[i]);
  }

  // Heat sources: nearest bone(s) of each vertex
  const heat = new Float64Array(n);
  const nearest: number[][] = [];
  const d = new Float64Array(B);
  for (let i = 0; i < n; i++) {
    distanceAt(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], N[i * 3], N[i * 3 + 1], N[i * 3 + 2], bones, limbRoots, d);
    let dmin = Infinity;
    for (let k = 0; k < B; k++) {
      dmin = Math.min(dmin, d[k]);
    }
    const near: number[] = [];
    for (let k = 0; k < B; k++) if (d[k] <= dmin * 1.02 + 1e-9) near.push(k);
    nearest.push(near);
    heat[i] = mass[i] / Math.max(dmin * dmin, 1e-8);
    diag[i] += heat[i];
  }

  const out = new Float32Array(n * B);
  const x = new Float64Array(n);
  const r = new Float64Array(n);
  const z = new Float64Array(n);
  const p = new Float64Array(n);
  const q = new Float64Array(n);
  const rhs = new Float64Array(n);
  const mul = (src: Float64Array, dst: Float64Array) => {
    for (let i = 0; i < n; i++) {
      let s = diag[i] * src[i];
      for (let e = offsets[i]; e < offsets[i + 1]; e++) s += data[e] * src[cols[e]];
      dst[i] = s;
    }
  };
  for (let b = 0; b < B; b++) {
    // Right-hand side and a good first guess: 1 where this is the nearest bone
    for (let i = 0; i < n; i++) {
      const near = nearest[i];
      const share = near.includes(b) ? 1 / near.length : 0;
      rhs[i] = heat[i] * share;
      x[i] = share;
    }
    mul(x, q);
    let rz = 0;
    let rhsNorm = 0;
    for (let i = 0; i < n; i++) {
      r[i] = rhs[i] - q[i];
      z[i] = r[i] / diag[i];
      p[i] = z[i];
      rz += r[i] * z[i];
      rhsNorm += rhs[i] * rhs[i];
    }
    const tol = 1e-10 * Math.max(rhsNorm, 1e-30);
    for (let iter = 0; iter < 3000; iter++) {
      let rr = 0;
      for (let i = 0; i < n; i++) rr += r[i] * r[i];
      if (rr <= tol) break;
      mul(p, q);
      let pq = 0;
      for (let i = 0; i < n; i++) pq += p[i] * q[i];
      if (pq <= 0) break;
      const alpha = rz / pq;
      let rzNext = 0;
      for (let i = 0; i < n; i++) {
        x[i] += alpha * p[i];
        r[i] -= alpha * q[i];
        z[i] = r[i] / diag[i];
        rzNext += r[i] * z[i];
      }
      const beta = rzNext / rz;
      rz = rzNext;
      for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
    }
    for (let i = 0; i < n; i++) out[i * B + b] = Math.max(0, x[i]);
    post({ type: 'progress', value: (b + 1) / B });
  }
  return out;
}
