import type { AnatomyMesh } from './contracts';
import type { SurfaceBVH } from './inference/observationProxy';
import type { Vec3M } from './landmarks';

export const foldFaceSamples: readonly Vec3M[] = [
  [1 / 3, 1 / 3, 1 / 3], [.5, .5, 0], [.5, 0, .5], [0, .5, .5],
];
export const denseFoldFaceSamples: readonly Vec3M[] = [
  ...foldFaceSamples, [.75, .25, 0], [.75, 0, .25], [.25, .75, 0], [0, .75, .25],
  [.25, 0, .75], [0, .25, .75], [.5, .25, .25], [.25, .5, .25], [.25, .25, .5],
];
export const foldViews = [
  [0, 1], [0, -1], [Math.SQRT1_2, Math.SQRT1_2], [Math.SQRT1_2, -Math.SQRT1_2], [1, 0],
];

export function foldViewDepth(skin: SurfaceBVH, [x, y, z]: Vec3M, [dx, dz]: number[]) {
  const side = x < 0 ? -dx : dx;
  const hit = skin.queryRay([x + 12 * side, y, z + 12 * dz], [-side, 0, -dz], 24);
  return hit ? hit.distance - 12 : Infinity;
}

export function inFoldContactBand(x: number, y: number) {
  return Math.abs(x) > 1.25 && Math.abs(x) < 3.9 && y > 11.7 && y < 15.08;
}

/** A long muscle triangle can bridge the axillary recess with all three
 * vertices under skin. Resolve its edge and interior samples against the
 * covering and share each displacement between both faces of the shell. */
export function seatFoldFaces(mesh: AnatomyMesh, positions: Float32Array | undefined, skin: SurfaceBVH, orientation: number, inBand: (x: number, y: number, z: number) => boolean = inFoldContactBand) {
  const count = mesh.shellPairs, grid = mesh.surfaceGrid;
  if (!positions || !count || grid?.kind !== 'shell') return;
  const stride = grid.cols + 1;
  const start = mesh.attachments?.some(a => a.end === 'start');
  const end = mesh.attachments?.some(a => a.end === 'end');
  const mobility = Float32Array.from({ length: count }, (_, v) => {
    const row = Math.floor(v / stride);
    return Math.min(1, start ? row / 2 : 1, end ? (grid.rows - row) / 2 : 1);
  });
  const faces: [number, number, number][] = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const triangle: [number, number, number] = [mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]];
    if (triangle.some(v => inBand(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]))) faces.push(triangle);
  }
  if (!faces.length) return;

  const signedDepth = (point: Vec3M, hit: ReturnType<SurfaceBVH['queryClosestPoint']>) =>
    orientation * hit.normal.reduce((sum, n, axis) => sum + n * (point[axis] - hit.point[axis]), 0);
  const outside = (point: Vec3M) => foldViews.some(view => foldViewDepth(skin, point, view) > .004);
  const clearances = new Map<number, number>();
  const clearanceSquared = (v: number) => {
    const cached = clearances.get(v);
    if (cached !== undefined) return cached;
    const i = v * 3;
    const point: Vec3M = [positions[i], positions[i + 1], positions[i + 2]];
    const hit = skin.queryClosestPoint(point);
    const value = signedDepth(point, hit) < 0 ? hit.distanceSq : 0;
    clearances.set(v, value);
    return value;
  };
  const edgeSquared = (u: number, v: number) => {
    const i = u * 3, j = v * 3;
    return (positions[i] - positions[j]) ** 2 + (positions[i + 1] - positions[j + 1]) ** 2 + (positions[i + 2] - positions[j + 2]) ** 2;
  };
  const original = positions.slice(0, count * 3);
  // The entire face lies inside the empty sphere around an interior vertex
  // when its clearance is larger than the longest edge.
  let active = faces.filter(([a, b, c]) => {
    const longest = Math.max(edgeSquared(a, b), edgeSquared(b, c), edgeSquared(c, a));
    return ![a, b, c].some(v => clearanceSquared(v) > longest);
  });
  for (let pass = 0; pass < 7; pass++) {
    const correction = new Float32Array(count * 3);
    const strength = new Float32Array(count);
    for (const face of active) {
      const [a, b, c] = face;
      const long = Math.max(edgeSquared(a, b), edgeSquared(b, c), edgeSquared(c, a)) > .0256;
      for (const weights of long ? denseFoldFaceSamples : foldFaceSamples) {
        const point: Vec3M = [0, 0, 0];
        for (let i = 0; i < 3; i++) for (let axis = 0; axis < 3; axis++)
          point[axis] += weights[i] * positions[face[i] * 3 + axis];
        if (!inBand(...point)) continue;
        const hit = skin.queryClosestPoint(point);
        if (signedDepth(point, hit) <= .004 || !outside(point)) continue;
        const available = face.reduce((sum, v, i) => sum + weights[i] ** 2 * mobility[v % count], 0);
        if (available < .05) continue;
        const distance = Math.sqrt(hit.distanceSq);
        const step = Math.min(.09, distance + .023) / distance;
        for (let i = 0; i < 3; i++) {
          const pair = face[i] % count;
          const gain = Math.min(1.4, weights[i] * mobility[pair] / available) * step;
          const length = gain * distance;
          if (length <= strength[pair]) continue;
          strength[pair] = length;
          for (let axis = 0; axis < 3; axis++)
            correction[pair * 3 + axis] = gain * (hit.point[axis] - point[axis]);
        }
      }
    }
    if (!strength.some(Boolean)) break;
    const moved = new Uint8Array(count);
    for (let v = 0; v < count; v++) {
      if (!mobility[v]) continue;
      const row = Math.floor(v / stride), col = v % stride;
      const neighbors = [row ? v - stride : -1, row < grid.rows ? v + stride : -1,
        col ? v - 1 : -1, col < grid.cols ? v + 1 : -1];
      const i = v * 3, j = (v + count) * 3;
      const delta: Vec3M = [0, 0, 0];
      const limit = inBand !== inFoldContactBand && !inFoldContactBand(original[i], original[i + 1]) ? .08 : .3;
      for (let axis = 0; axis < 3; axis++) {
        const spread = neighbors.reduce((sum, u) => sum + (correction[u * 3 + axis] ?? 0), 0);
        const current = positions[i + axis] - original[i + axis];
        const next = current + .84 * correction[i + axis] + .08 * spread * mobility[v];
        delta[axis] = Math.max(-limit, Math.min(limit, next)) - current;
      }
      if (!delta.some(Boolean)) continue;
      // The opposite lip of the recess must still cover both shell vertices.
      const safe = (scale: number) => [i, j].every(offset => {
        const before: Vec3M = [positions[offset], positions[offset + 1], positions[offset + 2]];
        const after: Vec3M = [before[0] + scale * delta[0], before[1] + scale * delta[1], before[2] + scale * delta[2]];
        const depth = signedDepth(after, skin.queryClosestPoint(after));
        if (depth <= .004) return true;
        if (!outside(after)) return true;
        return signedDepth(before, skin.queryClosestPoint(before)) >= depth - .004 && outside(before);
      });
      const scale = safe(1) ? 1 : safe(.5) ? .5 : 0;
      if (!scale) continue;
      for (let axis = 0; axis < 3; axis++) {
        positions[i + axis] += scale * delta[axis];
        positions[j + axis] += scale * delta[axis];
      }
      moved[v] = 1;
    }
    active = faces.filter(face => face.some(v => moved[v % count]));
    if (!active.length) break;
  }
}
