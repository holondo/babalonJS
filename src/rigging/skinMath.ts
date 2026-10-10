/** Geometry helpers shared by the skin-weight code and its worker (no DOM, no Babylon). */

/** Distance from a point to a segment. */
export function segmentDistance(px: number, py: number, pz: number, b: Float32Array, k: number) {
  const ax = b[k * 6];
  const ay = b[k * 6 + 1];
  const az = b[k * 6 + 2];
  const dx = b[k * 6 + 3] - ax;
  const dy = b[k * 6 + 4] - ay;
  const dz = b[k * 6 + 5] - az;
  const len2 = dx * dx + dy * dy + dz * dz;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = ax + dx * t - px;
  const y = ay + dy * t - py;
  const z = az + dz * t - pz;
  return Math.sqrt(x * x + y * y + z * z);
}

/** Merges vertices at the same position: `map[i]` is the welded index of vertex i. */
export function weld(points: Float32Array) {
  const n = points.length / 3;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < points.length; i++) {
    if (points[i] < min) min = points[i];
    if (points[i] > max) max = points[i];
  }
  const cell = Math.max(max - min, 1e-6) * 1e-5;
  const keys = new Map<string, number>();
  const map = new Uint32Array(n);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(points[i * 3] / cell)},${Math.round(points[i * 3 + 1] / cell)},${Math.round(points[i * 3 + 2] / cell)}`;
    let w = keys.get(key);
    if (w === undefined) {
      w = out.length / 3;
      keys.set(key, w);
      out.push(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]);
    }
    map[i] = w;
  }
  return { map, points: new Float32Array(out) };
}

/** How far a point is behind the start of a bone (along the bone; 0 when beside or past it). */
export function behind(x: number, y: number, z: number, b: Float32Array, k: number) {
  const dx = b[k * 6 + 3] - b[k * 6];
  const dy = b[k * 6 + 4] - b[k * 6 + 1];
  const dz = b[k * 6 + 5] - b[k * 6 + 2];
  const len = Math.hypot(dx, dy, dz) || 1;
  return Math.max(0, -((x - b[k * 6]) * dx + (y - b[k * 6 + 1]) * dy + (z - b[k * 6 + 2]) * dz) / len);
}

/**
 * Distance used to decide which bones move a vertex. Plain distance to the bone, made longer
 * when the bone can't be "seen" from inside the body at that vertex:
 * - limb roots (shoulder, hip) don't reach back into the trunk: a vertex on the trunk side of
 *   the joint is penalized (the chest follows the spine, not the arm);
 * - a bone in front of the surface (outside the body, e.g. the arm seen from the side of the
 *   chest or the armpit) is penalized by how much the surface faces it.
 */
export function boneDistance(x: number, y: number, z: number, nx: number, ny: number, nz: number, b: Float32Array, k: number, limbRoot: boolean) {
  const ax = b[k * 6];
  const ay = b[k * 6 + 1];
  const az = b[k * 6 + 2];
  const dx = b[k * 6 + 3] - ax;
  const dy = b[k * 6 + 4] - ay;
  const dz = b[k * 6 + 5] - az;
  const len2 = dx * dx + dy * dy + dz * dz;
  let t = len2 > 0 ? ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / len2 : 0;
  const before = t < 0 ? -t * Math.sqrt(len2) : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const vx = ax + dx * t - x;
  const vy = ay + dy * t - y;
  const vz = az + dz * t - z;
  let d = Math.sqrt(vx * vx + vy * vy + vz * vz);
  if (limbRoot && before > 0) d += before * 3;
  if (d > 0) {
    // > 0: the bone is on the outer side of this surface
    const out = (nx * vx + ny * vy + nz * vz) / d;
    if (out > 0.2) d *= 1 + 3 * (out - 0.2);
  }
  return d;
}

/** Area-weighted vertex normals of a (welded) mesh, pointing outwards. */
export function vertexNormals(points: Float32Array, tris: Uint32Array) {
  const n = new Float32Array(points.length);
  let volume = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3;
    const b = tris[t + 1] * 3;
    const c = tris[t + 2] * 3;
    const e1x = points[b] - points[a];
    const e1y = points[b + 1] - points[a + 1];
    const e1z = points[b + 2] - points[a + 2];
    const e2x = points[c] - points[a];
    const e2y = points[c + 1] - points[a + 1];
    const e2z = points[c + 2] - points[a + 2];
    const cx = e1y * e2z - e1z * e2y;
    const cy = e1z * e2x - e1x * e2z;
    const cz = e1x * e2y - e1y * e2x;
    volume += points[a] * cx + points[a + 1] * cy + points[a + 2] * cz;
    for (const v of [a, b, c]) {
      n[v] += cx;
      n[v + 1] += cy;
      n[v + 2] += cz;
    }
  }
  // Winding decides the side: make the normals point out of the closed volume
  const sign = volume < 0 ? -1 : 1;
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] = (n[i] * sign) / l;
    n[i + 1] = (n[i + 1] * sign) / l;
    n[i + 2] = (n[i + 2] * sign) / l;
  }
  return n;
}

/**
 * Grid cell of a point for simplifying a mesh, split by the main direction its surface faces:
 * two surfaces that touch but face each other (inner arm and side of the chest, inner thighs)
 * never merge.
 */
export function cellKey(x: number, y: number, z: number, nx: number, ny: number, nz: number, cell: number) {
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  const face = ax >= ay && ax >= az ? (nx > 0 ? 0 : 1) : ay >= az ? (ny > 0 ? 2 : 3) : nz > 0 ? 4 : 5;
  return `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)},${face}`;
}

/** Grid clusters must also be connected through triangles inside the cell. Even surfaces
 * facing the same way (a lowered hand and the hip) can share a cell across an air gap. */
export function surfaceClusters(points: Float32Array, normals: Float32Array, tris: Uint32Array, cell: number, origin = [0, 0, 0]) {
  const n = points.length / 3;
  const cells = new Uint32Array(n);
  const parent = Uint32Array.from({ length: n }, (_, i) => i);
  const keys = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const key = cellKey(points[i * 3] - origin[0], points[i * 3 + 1] - origin[1], points[i * 3 + 2] - origin[2], normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2], cell);
    let c = keys.get(key);
    if (c === undefined) { c = keys.size; keys.set(key, c); }
    cells[i] = c;
  }
  const root = (i: number) => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const join = (a: number, b: number) => {
    if (cells[a] !== cells[b]) return;
    const ra = root(a), rb = root(b);
    parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  for (let t = 0; t < tris.length; t += 3) {
    join(tris[t], tris[t + 1]); join(tris[t + 1], tris[t + 2]); join(tris[t + 2], tris[t]);
  }
  const ids = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const r = root(i);
    let id = ids.get(r);
    if (id === undefined) { id = ids.size; ids.set(r, id); }
    cells[i] = id;
  }
  return { cluster: cells, count: ids.size };
}
