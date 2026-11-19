import { SurfaceBVH } from '../inference/observationProxy';
import type { Vec3M } from '../landmarks';

/**
 * Correspondence from an imported skin vertex to the procedural skin surface it follows.
 * Points at triangles (not vertices) so the stored displacement is continuous across edges.
 */
export interface SkinCorrespondence {
  /** Procedural skin triangle per source vertex, or -1 when no triangle was found. */
  triangle: Int32Array;
  /** Three barycentric weights per source vertex (they sum to 1). */
  weights: Float32Array;
  /** Distance in the same unit as both surfaces (meters for the canonical frames). */
  distance: Float32Array;
  /** 1 when the closest surface is too distant to transport an anatomical edit reliably. */
  clamped: Uint8Array;
  /** Source vertices that found no triangle at all (disconnected islands, accessories). */
  unmatched: number;
  maxDistance: number;
  medianDistance: number;
}

interface Closest {
  d2: number;
  w0: number;
  w1: number;
  w2: number;
}

const scratch: Closest = { d2: Infinity, w0: 1, w1: 0, w2: 0 };

/** Closest point on triangle abc to p (Ericson, Real-Time Collision Detection). */
function closestOnTriangle(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): Closest {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  let w0 = 0, w1 = 0, w2 = 0;
  if (d1 <= 0 && d2 <= 0) { w0 = 1; }
  else {
    const bpx = px - bx, bpy = py - by, bpz = pz - bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz;
    const d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) { w1 = 1; }
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); w0 = 1 - v; w1 = v; }
      else {
        const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
        const d5 = abx * cpx + aby * cpy + abz * cpz;
        const d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) { w2 = 1; }
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); w0 = 1 - w; w2 = w; }
          else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
              const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); w1 = 1 - w; w2 = w;
            } else {
              const denom = 1 / (va + vb + vc);
              w1 = vb * denom; w2 = vc * denom; w0 = 1 - w1 - w2;
            }
          }
        }
      }
    }
  }
  const qx = ax * w0 + bx * w1 + cx * w2;
  const qy = ay * w0 + by * w1 + cy * w2;
  const qz = az * w0 + bz * w1 + cz * w2;
  scratch.d2 = (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2;
  scratch.w0 = w0; scratch.w1 = w1; scratch.w2 = w2;
  return scratch;
}

/** Uniform grid over the target vertices, as CSR arrays. */
function buildVertexGrid(positions: Float32Array, cellSize: number) {
  const n = positions.length / 3;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const nx = Math.max(1, Math.min(512, Math.ceil((maxX - minX) / cellSize) + 1));
  const ny = Math.max(1, Math.min(512, Math.ceil((maxY - minY) / cellSize) + 1));
  const nz = Math.max(1, Math.min(512, Math.ceil((maxZ - minZ) / cellSize) + 1));
  const cellX = (maxX - minX) / nx || 1, cellY = (maxY - minY) / ny || 1, cellZ = (maxZ - minZ) / nz || 1;
  const cells = nx * ny * nz;
  const counts = new Int32Array(cells + 1);
  const cellOf = (i: number) => {
    const ix = Math.min(nx - 1, Math.max(0, Math.floor((positions[i * 3] - minX) / cellX)));
    const iy = Math.min(ny - 1, Math.max(0, Math.floor((positions[i * 3 + 1] - minY) / cellY)));
    const iz = Math.min(nz - 1, Math.max(0, Math.floor((positions[i * 3 + 2] - minZ) / cellZ)));
    return (iz * ny + iy) * nx + ix;
  };
  for (let i = 0; i < n; i++) counts[cellOf(i) + 1]++;
  for (let c = 0; c < cells; c++) counts[c + 1] += counts[c];
  const items = new Int32Array(n);
  const fill = counts.slice(0, cells);
  for (let i = 0; i < n; i++) items[fill[cellOf(i)]++] = i;
  return { minX, minY, minZ, cellX, cellY, cellZ, nx, ny, nz, cells, starts: counts, items };
}

/** Per-vertex incident triangles, as CSR arrays. */
function buildVertexTriangles(vertexCount: number, indices: Uint32Array) {
  const counts = new Int32Array(vertexCount + 1);
  for (let t = 0; t < indices.length; t++) counts[indices[t] + 1]++;
  for (let v = 0; v < vertexCount; v++) counts[v + 1] += counts[v];
  const items = new Int32Array(indices.length);
  const fill = counts.slice(0, vertexCount);
  for (let t = 0; t < indices.length; t++) items[fill[indices[t]]++] = (t / 3) | 0;
  return { starts: counts, items };
}

const DEFAULT_CELL_SIZE = 0.02;
/** Stop the spatial search after this many rings: farther matches are not meaningful for skin. */
const MAX_RING = 8;

/**
 * Embeds every source vertex in the closest triangle of a target surface.
 * The target surface is sampled through a uniform grid plus triangle adjacency, so the cost is
 * proportional to the vertex count instead of the vertex pair count.
 */
export function buildSkinCorrespondence(
  sourcePositions: Float32Array,
  targetPositions: Float32Array,
  targetIndices: Uint32Array,
  cellSize = DEFAULT_CELL_SIZE,
): SkinCorrespondence {
  const sourceCount = sourcePositions.length / 3;
  const targetCount = targetPositions.length / 3;
  const triangle = new Int32Array(sourceCount).fill(-1);
  const weights = new Float32Array(sourceCount * 3);
  const distance = new Float32Array(sourceCount).fill(Infinity);
  const clamped = new Uint8Array(sourceCount);
  const triCount = (targetIndices.length / 3) | 0;
  if (!sourceCount || !triCount || !targetCount) {
    return { triangle, weights, distance, clamped, unmatched: sourceCount, maxDistance: Infinity, medianDistance: Infinity };
  }

  const grid = buildVertexGrid(targetPositions, cellSize);
  const adjacency = buildVertexTriangles(targetCount, targetIndices);
  const seen = new Int32Array(triCount).fill(-1);
  let exact: SurfaceBVH | undefined;
  let unmatched = 0, maxDistance = 0;

  const state = {
    px: 0, py: 0, pz: 0, stamp: -1,
    bestVertex: -1, bestVertexD2: Infinity,
    bestD2: Infinity, bestTri: -1, w0: 1, w1: 0, w2: 0,
  };

  const scanCell = (ix: number, iy: number, iz: number) => {
    const cell = (iz * grid.ny + iy) * grid.nx + ix;
    for (let s = grid.starts[cell]; s < grid.starts[cell + 1]; s++) {
      const v = grid.items[s];
      const dx = targetPositions[v * 3] - state.px, dy = targetPositions[v * 3 + 1] - state.py, dz = targetPositions[v * 3 + 2] - state.pz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < state.bestVertexD2) { state.bestVertexD2 = d2; state.bestVertex = v; }
    }
  };

  const testTriangle = (t: number) => {
    const i0 = targetIndices[t * 3], i1 = targetIndices[t * 3 + 1], i2 = targetIndices[t * 3 + 2];
    const hit = closestOnTriangle(
      state.px, state.py, state.pz,
      targetPositions[i0 * 3], targetPositions[i0 * 3 + 1], targetPositions[i0 * 3 + 2],
      targetPositions[i1 * 3], targetPositions[i1 * 3 + 1], targetPositions[i1 * 3 + 2],
      targetPositions[i2 * 3], targetPositions[i2 * 3 + 1], targetPositions[i2 * 3 + 2],
    );
    if (hit.d2 < state.bestD2) {
      state.bestD2 = hit.d2; state.bestTri = t;
      state.w0 = hit.w0; state.w1 = hit.w1; state.w2 = hit.w2;
    }
  };

  const testVertexTriangles = (v: number) => {
    for (let a = adjacency.starts[v]; a < adjacency.starts[v + 1]; a++) {
      const t = adjacency.items[a];
      if (seen[t] === state.stamp) continue;
      seen[t] = state.stamp;
      testTriangle(t);
    }
  };

  const rings = Math.min(Math.max(grid.nx, grid.ny, grid.nz), MAX_RING);

  for (let i = 0; i < sourceCount; i++) {
    state.px = sourcePositions[i * 3]; state.py = sourcePositions[i * 3 + 1]; state.pz = sourcePositions[i * 3 + 2];
    state.stamp = i;
    state.bestVertex = -1; state.bestVertexD2 = Infinity;
    state.bestD2 = Infinity; state.bestTri = -1;
    const cx = Math.min(grid.nx - 1, Math.max(0, Math.floor((state.px - grid.minX) / grid.cellX)));
    const cy = Math.min(grid.ny - 1, Math.max(0, Math.floor((state.py - grid.minY) / grid.cellY)));
    const cz = Math.min(grid.nz - 1, Math.max(0, Math.floor((state.pz - grid.minZ) / grid.cellZ)));

    // 1. Nearest target vertex: squared distances only, over growing cell rings.
    let ringUsed = 0;
    for (let r = 0; r <= rings; r++) {
      const z0 = Math.max(0, cz - r), z1 = Math.min(grid.nz - 1, cz + r);
      const y0 = Math.max(0, cy - r), y1 = Math.min(grid.ny - 1, cy + r);
      const x0 = Math.max(0, cx - r), x1 = Math.min(grid.nx - 1, cx + r);
      for (let iz = z0; iz <= z1; iz++) {
        const ringZ = iz === cz - r || iz === cz + r;
        for (let iy = y0; iy <= y1; iy++) {
          const ringY = ringZ || iy === cy - r || iy === cy + r;
          if (ringZ || ringY) {
            for (let ix = x0; ix <= x1; ix++) scanCell(ix, iy, iz);
          } else {
            if (cx - r >= 0) scanCell(cx - r, iy, iz);
            if (cx + r < grid.nx) scanCell(cx + r, iy, iz);
          }
        }
      }
      ringUsed = r;
      if (state.bestVertex >= 0 && state.bestVertexD2 <= (r * cellSize) ** 2) break;
    }
    if (state.bestVertex < 0) { unmatched++; continue; }

    // 2. Point-to-triangle only on the triangles around that vertex and its ring neighbours.
    testVertexTriangles(state.bestVertex);
    if (state.bestTri < 0) { unmatched++; continue; }
    if (state.w0 < 0.05 || state.w1 < 0.05 || state.w2 < 0.05) {
      const first = adjacency.starts[state.bestVertex], last = adjacency.starts[state.bestVertex + 1];
      for (let a = first; a < last; a++) {
        const t = adjacency.items[a];
        testVertexTriangles(targetIndices[t * 3]);
        testVertexTriangles(targetIndices[t * 3 + 1]);
        testVertexTriangles(targetIndices[t * 3 + 2]);
      }
    }
    if (state.bestTri < 0) { unmatched++; continue; }

    // A local vertex neighbourhood is fast, but not a global triangle query.
    // Resolve uncertain or truncated searches against triangle bounds before accepting a match.
    if (state.bestD2 > .04 ** 2 || (ringUsed >= rings && state.bestVertexD2 > (ringUsed * cellSize) ** 2)) {
      exact ??= new SurfaceBVH({ positions: targetPositions, indices: targetIndices });
      const hit = exact.queryClosestPoint([state.px, state.py, state.pz]);
      if (hit.triangleIndex >= 0) testTriangle(hit.triangleIndex);
    }
    const dist = Math.sqrt(state.bestD2);
    triangle[i] = state.bestTri;
    weights[i * 3] = state.w0; weights[i * 3 + 1] = state.w1; weights[i * 3 + 2] = state.w2;
    distance[i] = dist;
    if (dist > maxDistance) maxDistance = dist;
    if (dist > .12) clamped[i] = 1;
  }

  return {
    triangle, weights, distance, clamped, unmatched, maxDistance,
    medianDistance: median(distance, sourceCount),
  };
}

function median(values: Float32Array, count: number): number {
  if (!count) return Infinity;
  const sample: number[] = [];
  const stride = Math.max(1, Math.floor(count / 4096));
  for (let i = 0; i < count; i += stride) if (Number.isFinite(values[i])) sample.push(values[i]);
  if (!sample.length) return Infinity;
  sample.sort((a, b) => a - b);
  return sample[sample.length >> 1];
}

/**
 * Samples the per-triangle displacement of the target surface into a per-source-vertex delta.
 * Returns false when the target did not move (the delta is exactly zero everywhere).
 */
export function sampleSurfaceDelta(
  correspondence: SkinCorrespondence,
  indices: Uint32Array,
  basePositions: Float32Array,
  currentPositions: Float32Array,
  out: Float32Array,
): boolean {
  let moved = false;
  for (let i = 0; i < correspondence.triangle.length; i++) {
    const t = correspondence.triangle[i];
    if (t < 0 || correspondence.clamped[i]) { out[i * 3] = 0; out[i * 3 + 1] = 0; out[i * 3 + 2] = 0; continue; }
    const w0 = correspondence.weights[i * 3], w1 = correspondence.weights[i * 3 + 1], w2 = correspondence.weights[i * 3 + 2];
    let dx = 0, dy = 0, dz = 0;
    for (let k = 0; k < 3; k++) {
      const v = indices[t * 3 + k] * 3;
      const w = k === 0 ? w0 : k === 1 ? w1 : w2;
      dx += w * (currentPositions[v] - basePositions[v]);
      dy += w * (currentPositions[v + 1] - basePositions[v + 1]);
      dz += w * (currentPositions[v + 2] - basePositions[v + 2]);
    }
    // Fade uncertain matches continuously so the reliability boundary cannot leave a hard seam.
    const fade = Math.max(0, Math.min(1, (correspondence.distance[i] - .08) / .04));
    const confidence = 1 - fade * fade * (3 - 2 * fade);
    dx *= confidence; dy *= confidence; dz *= confidence;
    out[i * 3] = dx; out[i * 3 + 1] = dy; out[i * 3 + 2] = dz;
    if (dx !== 0 || dy !== 0 || dz !== 0) moved = true;
  }
  return moved;
}

/** Accumulate face normals, or their difference for the affected faces. */
export function accumulateSkinNormals(positions: Float32Array, indices: Uint32Array, out: Float32Array, rest?: Float32Array, moved?: Uint8Array) {
  out.fill(0);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    if (moved && !moved[a / 3] && !moved[b / 3] && !moved[c / 3]) continue;
    const abx = positions[b] - positions[a], aby = positions[b + 1] - positions[a + 1], abz = positions[b + 2] - positions[a + 2];
    const acx = positions[c] - positions[a], acy = positions[c + 1] - positions[a + 1], acz = positions[c + 2] - positions[a + 2];
    let nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
    if (rest) {
      const bx = rest[b] - rest[a], by = rest[b + 1] - rest[a + 1], bz = rest[b + 2] - rest[a + 2];
      const cx = rest[c] - rest[a], cy = rest[c + 1] - rest[a + 1], cz = rest[c + 2] - rest[a + 2];
      nx -= by * cz - bz * cy; ny -= bz * cx - bx * cz; nz -= bx * cy - by * cx;
    }
    out[a] += nx; out[a + 1] += ny; out[a + 2] += nz;
    out[b] += nx; out[b + 1] += ny; out[b + 2] += nz;
    out[c] += nx; out[c + 1] += ny; out[c + 2] += nz;
  }
}

export function computeSmoothNormals(positions: Float32Array, indices: Uint32Array, out: Float32Array) {
  accumulateSkinNormals(positions, indices, out);
  for (let i = 0; i < out.length; i += 3) {
    const length = Math.hypot(out[i], out[i + 1], out[i + 2]) || 1;
    out[i] /= length; out[i + 1] /= length; out[i + 2] /= length;
  }
}

/** Rotate authored normals with the local surface, retaining source seam shading. */
export function updateDrivenSkinNormals(
  positions: Float32Array, indices: Uint32Array, rest: Float32Array, moved: Uint8Array,
  restSums: Float32Array, authored: Float32Array, out: Float32Array,
) {
  accumulateSkinNormals(positions, indices, out, rest, moved);
  for (let i = 0; i < out.length; i += 3) {
    const dx = out[i], dy = out[i + 1], dz = out[i + 2];
    const ax = authored[i], ay = authored[i + 1], az = authored[i + 2];
    if (dx === 0 && dy === 0 && dz === 0) {
      out[i] = ax; out[i + 1] = ay; out[i + 2] = az;
      continue;
    }
    const rx = restSums[i], ry = restSums[i + 1], rz = restSums[i + 2];
    const from = Math.hypot(rx, ry, rz), to = Math.hypot(rx + dx, ry + dy, rz + dz);
    if (from < 1e-12 || to < 1e-12) {
      out[i] = ax; out[i + 1] = ay; out[i + 2] = az;
      continue;
    }
    const x = rx / from, y = ry / from, z = rz / from;
    const nx = (rx + dx) / to, ny = (ry + dy) / to, nz = (rz + dz) / to;
    const cx = y * nz - z * ny, cy = z * nx - x * nz, cz = x * ny - y * nx;
    const dot = x * nx + y * ny + z * nz;
    if (dot < -.9999) {
      out[i] = nx; out[i + 1] = ny; out[i + 2] = nz;
      continue;
    }
    const vx = cy * az - cz * ay, vy = cz * ax - cx * az, vz = cx * ay - cy * ax;
    const scale = 1 / (1 + dot);
    out[i] = ax + vx + (cy * vz - cz * vy) * scale;
    out[i + 1] = ay + vy + (cz * vx - cx * vz) * scale;
    out[i + 2] = az + vz + (cx * vy - cy * vx) * scale;
  }
}

/** Applies a per-vertex canonical-frame delta to source-local vertices and converts it. */
export function applyDeltaFromCanonical(
  rest: Float32Array,
  sourceCanonical: (dx: number, dy: number, dz: number, index: number) => Vec3M,
  delta: Float32Array,
  out: Float32Array,
): { moved: number; maxMeters: number } {
  let moved = 0, maxMeters = 0;
  for (let i = 0; i < rest.length / 3; i++) {
    const dx = delta[i * 3], dy = delta[i * 3 + 1], dz = delta[i * 3 + 2];
    if (dx === 0 && dy === 0 && dz === 0) {
      out[i * 3] = rest[i * 3]; out[i * 3 + 1] = rest[i * 3 + 1]; out[i * 3 + 2] = rest[i * 3 + 2];
      continue;
    }
    const local = sourceCanonical(dx, dy, dz, i);
    out[i * 3] = rest[i * 3] + local[0];
    out[i * 3 + 1] = rest[i * 3 + 1] + local[1];
    out[i * 3 + 2] = rest[i * 3 + 2] + local[2];
    moved++;
    const length = Math.hypot(dx, dy, dz);
    if (length > maxMeters) maxMeters = length;
  }
  return { moved, maxMeters };
}
