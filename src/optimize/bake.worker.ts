/// <reference lib="webworker" />
/**
 * Normal map baking from the original mesh onto its optimized version (decision D4).
 *
 * The optimized mesh keeps a subset of the original vertices and their UVs, so both meshes share
 * one UV layout: no ray casting is needed. The original's shading normal (with its own normal
 * map, if any) is rasterized in UV space; then, for every texel of the optimized mesh, that normal
 * is expressed in the tangent frame Babylon rebuilds at runtime from the position and UV
 * derivatives (T = ∂p/∂u, B = ∂p/∂v, N = interpolated normal), solving the 3×3 system exactly so
 * the shader reproduces it.
 */
import type { BakeJob } from './bake';

const post = (m: unknown, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer);

self.onmessage = (ev: MessageEvent<BakeJob>) => {
  try {
    const result = bake(ev.data, (p) => post({ type: 'progress', value: p }));
    post({ type: 'done', ...result }, [result.pixels.buffer as ArrayBuffer]);
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};

interface Frame {
  t: [number, number, number];
  b: [number, number, number];
}

/** Per-triangle ∂p/∂u and ∂p/∂v from its edges in UV space (null for degenerate UVs). */
function triangleFrame(P: Float32Array, U: Float32Array, a: number, b: number, c: number): Frame | null {
  const e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]];
  const e2 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
  const du1 = U[b * 2] - U[a * 2];
  const dv1 = U[b * 2 + 1] - U[a * 2 + 1];
  const du2 = U[c * 2] - U[a * 2];
  const dv2 = U[c * 2 + 1] - U[a * 2 + 1];
  const det = du1 * dv2 - du2 * dv1;
  if (Math.abs(det) < 1e-12) return null;
  const r = 1 / det;
  const t: [number, number, number] = [(e1[0] * dv2 - e2[0] * dv1) * r, (e1[1] * dv2 - e2[1] * dv1) * r, (e1[2] * dv2 - e2[2] * dv1) * r];
  const bt: [number, number, number] = [(e2[0] * du1 - e1[0] * du2) * r, (e2[1] * du1 - e1[1] * du2) * r, (e2[2] * du1 - e1[2] * du2) * r];
  // Like Babylon's cotangent frame: T and B divided by the larger of their lengths
  const inv = 1 / Math.sqrt(Math.max(t[0] ** 2 + t[1] ** 2 + t[2] ** 2, bt[0] ** 2 + bt[1] ** 2 + bt[2] ** 2) || 1);
  return { t: [t[0] * inv, t[1] * inv, t[2] * inv], b: [bt[0] * inv, bt[1] * inv, bt[2] * inv] };
}

/** Visits the texel centers inside a UV triangle with their barycentric coordinates. */
function rasterize(U: Float32Array, a: number, b: number, c: number, size: number, visit: (index: number, w0: number, w1: number, w2: number) => void) {
  const x0 = U[a * 2] * size;
  const y0 = U[a * 2 + 1] * size;
  const x1 = U[b * 2] * size;
  const y1 = U[b * 2 + 1] * size;
  const x2 = U[c * 2] * size;
  const y2 = U[c * 2 + 1] * size;
  const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (Math.abs(area) < 1e-12) return;
  const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
  const maxX = Math.min(size - 1, Math.ceil(Math.max(x0, x1, x2)));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
  const maxY = Math.min(size - 1, Math.ceil(Math.max(y0, y1, y2)));
  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const w1 = ((px - x0) * (y2 - y0) - (x2 - x0) * (py - y0)) / area;
      const w2 = ((x1 - x0) * (py - y0) - (px - x0) * (y1 - y0)) / area;
      const w0 = 1 - w1 - w2;
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      visit(y * size + x, w0, w1, w2);
    }
  }
}

function bake(job: BakeJob, onProgress: (p: number) => void) {
  const { positions: P, normals: N, uvs: U, high, low, size, existing, flipX, flipY } = job;
  const sx = flipX ? -1 : 1;
  const sy = flipY ? -1 : 1;
  // UVs must stay in one tile to share a layout
  let outside = 0;
  for (let i = 0; i < U.length; i++) if (U[i] < -0.001 || U[i] > 1.001) outside++;
  if (outside > U.length * 0.01) throw new Error('UVs repeat outside the 0–1 square: this model can’t be baked.');

  const texels = size * size;
  const target = new Float32Array(texels * 3);
  const written = new Uint8Array(texels);
  let conflicts = 0;
  let covered = 0;
  const sampleExisting = (u: number, v: number): [number, number, number] => {
    if (!existing) return [0, 0, 1];
    const ex = Math.min(existing.width - 1, Math.max(0, Math.floor(u * existing.width)));
    const ey = Math.min(existing.height - 1, Math.max(0, Math.floor(v * existing.height)));
    const k = (ey * existing.width + ex) * 4;
    return [(existing.pixels[k] / 255) * 2 - 1, (existing.pixels[k + 1] / 255) * 2 - 1, (existing.pixels[k + 2] / 255) * 2 - 1];
  };

  // 1. Shading normal of the original, in UV space
  const highTris = high.length / 3;
  for (let t = 0; t < highTris; t++) {
    const a = high[t * 3];
    const b = high[t * 3 + 1];
    const c = high[t * 3 + 2];
    const f = existing ? triangleFrame(P, U, a, b, c) : null;
    rasterize(U, a, b, c, size, (i, w0, w1, w2) => {
      let nx = N[a * 3] * w0 + N[b * 3] * w1 + N[c * 3] * w2;
      let ny = N[a * 3 + 1] * w0 + N[b * 3 + 1] * w1 + N[c * 3 + 1] * w2;
      let nz = N[a * 3 + 2] * w0 + N[b * 3 + 2] * w1 + N[c * 3 + 2] * w2;
      if (f) {
        const u = U[a * 2] * w0 + U[b * 2] * w1 + U[c * 2] * w2;
        const v = U[a * 2 + 1] * w0 + U[b * 2 + 1] * w1 + U[c * 2 + 1] * w2;
        const m = sampleExisting(u, v);
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l;
        ny /= l;
        nz /= l;
        const ex = m[0] * sx;
        const ey = m[1] * sy;
        nx = f.t[0] * ex + f.b[0] * ey + nx * m[2];
        ny = f.t[1] * ex + f.b[1] * ey + ny * m[2];
        nz = f.t[2] * ex + f.b[2] * ey + nz * m[2];
      }
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
      if (written[i]) {
        // Another triangle already wrote here: overlapping UVs if it faces another way
        if (target[i * 3] * nx + target[i * 3 + 1] * ny + target[i * 3 + 2] * nz < 0.3) conflicts++;
        return;
      }
      written[i] = 1;
      covered++;
      target[i * 3] = nx;
      target[i * 3 + 1] = ny;
      target[i * 3 + 2] = nz;
    });
    if (t % 20000 === 0) onProgress((t / highTris) * 0.6);
  }
  if (covered && conflicts > covered * 0.02) throw new Error('Parts of the model share the same UV area: this model can’t be baked.');

  // 2. Expressed in the optimized mesh's tangent frame
  const out = new Uint8Array(texels * 4);
  const done = new Uint8Array(texels);
  const lowTris = low.length / 3;
  for (let t = 0; t < lowTris; t++) {
    const a = low[t * 3];
    const b = low[t * 3 + 1];
    const c = low[t * 3 + 2];
    const f = triangleFrame(P, U, a, b, c);
    if (!f) continue;
    rasterize(U, a, b, c, size, (i, w0, w1, w2) => {
      let nx = N[a * 3] * w0 + N[b * 3] * w1 + N[c * 3] * w2;
      let ny = N[a * 3 + 1] * w0 + N[b * 3 + 1] * w1 + N[c * 3 + 1] * w2;
      let nz = N[a * 3 + 2] * w0 + N[b * 3 + 2] * w1 + N[c * 3 + 2] * w2;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
      const h = written[i] ? [target[i * 3], target[i * 3 + 1], target[i * 3 + 2]] : [nx, ny, nz];
      const m = solve(f.t, f.b, [nx, ny, nz], h);
      let mx = m[0] * sx;
      let my = m[1] * sy;
      let mz = m[2];
      if (mz < 0.05) mz = 0.05;
      const ml = Math.hypot(mx, my, mz) || 1;
      mx /= ml;
      my /= ml;
      mz /= ml;
      out[i * 4] = Math.round((mx * 0.5 + 0.5) * 255);
      out[i * 4 + 1] = Math.round((my * 0.5 + 0.5) * 255);
      out[i * 4 + 2] = Math.round((mz * 0.5 + 0.5) * 255);
      out[i * 4 + 3] = 255;
      done[i] = 1;
    });
    if (t % 5000 === 0) onProgress(0.6 + (t / lowTris) * 0.35);
  }
  dilate(out, done, size, 4);
  // Texels no triangle covers: flat normal
  for (let i = 0; i < texels; i++) if (!done[i]) out.set([128, 128, 255, 255], i * 4);
  onProgress(1);
  return { pixels: out, size };
}

/** Solves [T B N]·m = h (columns), so T·mx + B·my + N·mz points along h. */
function solve(t: number[], b: number[], n: number[], h: number[]): [number, number, number] {
  const det = t[0] * (b[1] * n[2] - b[2] * n[1]) - b[0] * (t[1] * n[2] - t[2] * n[1]) + n[0] * (t[1] * b[2] - t[2] * b[1]);
  if (Math.abs(det) < 1e-14) return [0, 0, 1];
  const r = 1 / det;
  const mx = (h[0] * (b[1] * n[2] - b[2] * n[1]) - b[0] * (h[1] * n[2] - h[2] * n[1]) + n[0] * (h[1] * b[2] - h[2] * b[1])) * r;
  const my = (t[0] * (h[1] * n[2] - h[2] * n[1]) - h[0] * (t[1] * n[2] - t[2] * n[1]) + n[0] * (t[1] * h[2] - t[2] * h[1])) * r;
  const mz = (t[0] * (b[1] * h[2] - b[2] * h[1]) - b[0] * (t[1] * h[2] - t[2] * h[1]) + h[0] * (t[1] * b[2] - t[2] * b[1])) * r;
  return [mx, my, mz];
}

/** Grows the baked islands a few texels so mipmaps and filtering don't pull in the background. */
function dilate(px: Uint8Array, done: Uint8Array, size: number, steps: number) {
  for (let s = 0; s < steps; s++) {
    const add: number[] = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        if (done[i]) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const j = ny * size + nx;
          if (done[j]) {
            px.copyWithin(i * 4, j * 4, j * 4 + 4);
            add.push(i);
            break;
          }
        }
      }
    }
    for (const i of add) done[i] = 1;
  }
}
