import { boneDistance } from './skinMath';

interface SurfaceNode {
  min: number[];
  max: number[];
  start: number;
  end: number;
  left: number;
  right: number;
}

/**
 * Bone distances with actual surface visibility. A local normal alone cannot detect a ray
 * leaving the torso and entering a nearby lowered arm. The triangle hierarchy is built once
 * on the original surface, before proxy clustering, and reused for every weight query.
 */
export function visibleBoneDistances(points: Float32Array, triangles: Uint32Array) {
  const count = Math.floor(triangles.length / 3);
  const order = Uint32Array.from({ length: count }, (_, i) => i);
  const centers = new Float32Array(count * 3);
  for (let t = 0; t < count; t++) for (let c = 0; c < 3; c++)
    centers[t * 3 + c] = (points[triangles[t * 3] * 3 + c] + points[triangles[t * 3 + 1] * 3 + c] + points[triangles[t * 3 + 2] * 3 + c]) / 3;
  const nodes: SurfaceNode[] = [];
  const build = (start: number, end: number, depth: number): number => {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const cmin = [...min], cmax = [...max];
    for (let i = start; i < end; i++) {
      const t = order[i];
      for (let c = 0; c < 3; c++) {
        cmin[c] = Math.min(cmin[c], centers[t * 3 + c]);
        cmax[c] = Math.max(cmax[c], centers[t * 3 + c]);
        for (let j = 0; j < 3; j++) {
          const p = points[triangles[t * 3 + j] * 3 + c];
          min[c] = Math.min(min[c], p);
          max[c] = Math.max(max[c], p);
        }
      }
    }
    const index = nodes.length;
    const node: SurfaceNode = { min, max, start, end, left: -1, right: -1 };
    nodes.push(node);
    if (end - start <= 8 || depth >= 40) return index;
    let axis = 0;
    for (let c = 1; c < 3; c++) if (cmax[c] - cmin[c] > cmax[axis] - cmin[axis]) axis = c;
    const split = (cmin[axis] + cmax[axis]) / 2;
    let mid = start;
    for (let i = start; i < end; i++) if (centers[order[i] * 3 + axis] < split) {
      const temp = order[mid]; order[mid++] = order[i]; order[i] = temp;
    }
    if (mid === start || mid === end) return index;
    node.left = build(start, mid, depth + 1);
    node.right = build(mid, end, depth + 1);
    return index;
  };
  build(0, count, 0);
  const root = nodes[0];
  const epsilon = Math.max(Math.hypot(root.max[0] - root.min[0], root.max[1] - root.min[1], root.max[2] - root.min[2]) * 1e-6, 1e-9);
  const stack: number[] = [];
  const origin = new Float64Array(3), direction = new Float64Array(3);
  const blocked = (x: number, y: number, z: number, dx: number, dy: number, dz: number) => {
    const length = Math.hypot(dx, dy, dz);
    if (length <= epsilon * 2 || !count) return false;
    const margin = epsilon / length;
    origin[0] = x; origin[1] = y; origin[2] = z;
    direction[0] = dx; direction[1] = dy; direction[2] = dz;
    stack.length = 0;
    stack.push(0);
    while (stack.length) {
      const node = nodes[stack.pop()!];
      let near = margin, far = 1 - margin;
      for (let c = 0; c < 3 && near <= far; c++) {
        if (Math.abs(direction[c]) < 1e-20) {
          if (origin[c] < node.min[c] - epsilon || origin[c] > node.max[c] + epsilon) far = -1;
        } else {
          const a = (node.min[c] - epsilon - origin[c]) / direction[c];
          const b = (node.max[c] + epsilon - origin[c]) / direction[c];
          near = Math.max(near, Math.min(a, b));
          far = Math.min(far, Math.max(a, b));
        }
      }
      if (near > far) continue;
      if (node.left >= 0) { stack.push(node.left, node.right); continue; }
      for (let i = node.start; i < node.end; i++) {
        const t = order[i] * 3;
        const a = triangles[t] * 3, b = triangles[t + 1] * 3, c = triangles[t + 2] * 3;
        const e1x = points[b] - points[a], e1y = points[b + 1] - points[a + 1], e1z = points[b + 2] - points[a + 2];
        const e2x = points[c] - points[a], e2y = points[c + 1] - points[a + 1], e2z = points[c + 2] - points[a + 2];
        const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
        const det = e1x * hx + e1y * hy + e1z * hz;
        if (Math.abs(det) < 1e-12 * length * Math.hypot(e1x, e1y, e1z) * Math.hypot(e2x, e2y, e2z)) continue;
        const sx = x - points[a], sy = y - points[a + 1], sz = z - points[a + 2];
        const u = (sx * hx + sy * hy + sz * hz) / det;
        if (u < -1e-7 || u > 1 + 1e-7) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const v = (dx * qx + dy * qy + dz * qz) / det;
        if (v < -1e-7 || u + v > 1 + 1e-7) continue;
        const hit = (e2x * qx + e2y * qy + e2z * qz) / det;
        if (hit > margin && hit < 1 - margin) return true;
      }
    }
    return false;
  };

  return (x: number, y: number, z: number, nx: number, ny: number, nz: number, bones: Float32Array, limbRoots: Uint8Array | undefined, distances: Float64Array) => {
    let visible = false;
    for (let k = 0; k < distances.length; k++) {
      const j = k * 6;
      const ax = bones[j], ay = bones[j + 1], az = bones[j + 2];
      const bx = bones[j + 3] - ax, by = bones[j + 4] - ay, bz = bones[j + 5] - az;
      const len2 = bx * bx + by * by + bz * bz;
      const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * bx + (y - ay) * by + (z - az) * bz) / len2)) : 0;
      const dx = ax + bx * t - x, dy = ay + by * t - y, dz = az + bz * t - z;
      const outside = nx * dx + ny * dy + nz * dz > Math.hypot(dx, dy, dz) * 0.05 + epsilon;
      const d = boneDistance(x, y, z, nx, ny, nz, bones, k, !!limbRoots?.[k]);
      const occluded = outside || blocked(x, y, z, dx, dy, dz);
      // A strong finite penalty keeps a transition when a manually placed bone is just
      // outside the skin. Hard rejection makes adjacent fingers switch to distant bones.
      distances[k] = occluded ? d * 20 : d;
      visible ||= !occluded;
    }
    // Open meshes, detached clothes or misplaced joints may have no visible bone. Keep the
    // existing envelope fallback rather than returning NaNs or an arbitrary bone in that case.
    if (!visible) for (let k = 0; k < distances.length; k++) distances[k] = boneDistance(x, y, z, nx, ny, nz, bones, k, !!limbRoots?.[k]);
  };
}
