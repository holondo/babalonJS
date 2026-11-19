import type { Vec3M } from '../landmarks';

export interface TriangleMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

export interface ClosestPointResult {
  point: Vec3M;
  distanceSq: number;
  triangleIndex: number;
  normal: Vec3M;
}

interface BVHNode {
  min: Vec3M;
  max: Vec3M;
  left?: BVHNode;
  right?: BVHNode;
  triangleIndices?: number[];
}

function sub(a: Vec3M, b: Vec3M): Vec3M {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(a: Vec3M, b: Vec3M): Vec3M {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(v: Vec3M, s: number): Vec3M {
  return [v[0] * s, v[1] * s, v[2] * s];
}

function dot(a: Vec3M, b: Vec3M): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3M, b: Vec3M): Vec3M {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function norm(v: Vec3M): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function unit(v: Vec3M): Vec3M {
  const n = norm(v);
  return n > 1e-9 ? scale(v, 1 / n) : [0, 0, 1];
}

/**
 * Closest point on a 3D triangle to query point p (Ericson's region test), without allocations:
 * this is the hot nearest-point search. Writes the point into `out` and returns its squared distance.
 */
function closestOnTriangle(px: number, py: number, pz: number, ax: number, ay: number, az: number,
  bx: number, by: number, bz: number, cx: number, cy: number, cz: number, out: Float64Array): number {
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let qx: number, qy: number, qz: number;
  if (d1 <= 0 && d2 <= 0) { qx = ax; qy = ay; qz = az; }
  else {
    const bpx = px - bx, bpy = py - by, bpz = pz - bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    const vc = d1 * d4 - d3 * d2;
    if (d3 >= 0 && d4 <= d3) { qx = bx; qy = by; qz = bz; }
    else if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      const v = d1 / (d1 - d3);
      qx = ax + abx * v; qy = ay + aby * v; qz = az + abz * v;
    } else {
      const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
      const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
      const vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
      if (d6 >= 0 && d5 <= d6) { qx = cx; qy = cy; qz = cz; }
      else if (vb <= 0 && d2 >= 0 && d6 <= 0) {
        const w = d2 / (d2 - d6);
        qx = ax + acx * w; qy = ay + acy * w; qz = az + acz * w;
      } else if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
        const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
        qx = bx + (cx - bx) * w; qy = by + (cy - by) * w; qz = bz + (cz - bz) * w;
      } else {
        const denom = 1 / (va + vb + vc);
        const v = vb * denom, w = vc * denom;
        qx = ax + abx * v + acx * w; qy = ay + aby * v + acy * w; qz = az + abz * v + acz * w;
      }
    }
  }
  out[0] = qx; out[1] = qy; out[2] = qz;
  const dx = px - qx, dy = py - qy, dz = pz - qz;
  return dx * dx + dy * dy + dz * dz;
}

const closestScratch = new Float64Array(3);

/** Axis-Aligned Bounding Box distance to point. */
function aabbDistSq(p: Vec3M, min: Vec3M, max: Vec3M): number {
  let sqDist = 0;
  for (let i = 0; i < 3; i++) {
    const v = p[i];
    if (v < min[i]) sqDist += (min[i] - v) * (min[i] - v);
    if (v > max[i]) sqDist += (v - max[i]) * (v - max[i]);
  }
  return sqDist;
}

/**
 * Spatial Bounding Volume Hierarchy for fast surface queries.
 */
export class SurfaceBVH {
  private readonly positions: Float32Array;
  private readonly indices: Uint32Array;
  private readonly root: BVHNode;

  constructor(mesh: TriangleMesh) {
    this.positions = mesh.positions;
    this.indices = mesh.indices;
    const triCount = mesh.indices.length / 3;
    const allTriangles = new Array<number>(triCount);
    for (let i = 0; i < triCount; i++) allTriangles[i] = i;
    this.root = this.buildNode(allTriangles, 0);
  }

  /** Surface vertices (canonical metres), read-only. */
  vertices(): Readonly<Float32Array> { return this.positions; }

  private getTri(triIdx: number): [Vec3M, Vec3M, Vec3M] {
    const i0 = this.indices[triIdx * 3];
    const i1 = this.indices[triIdx * 3 + 1];
    const i2 = this.indices[triIdx * 3 + 2];
    const p = this.positions;
    return [
      [p[i0 * 3], p[i0 * 3 + 1], p[i0 * 3 + 2]],
      [p[i1 * 3], p[i1 * 3 + 1], p[i1 * 3 + 2]],
      [p[i2 * 3], p[i2 * 3 + 1], p[i2 * 3 + 2]],
    ];
  }

  /** Two-sided first intersection; source winding may be reflected by glTF. */
  queryRay(origin:Vec3M,direction:Vec3M,maxDistance=.5):{point:Vec3M;distance:number}|undefined{
    const d=unit(direction);let best=maxDistance,found=false;
    const intersects=(node:BVHNode)=>{let lo=0,hi=best;for(let k=0;k<3;k++){if(Math.abs(d[k])<1e-10){if(origin[k]<node.min[k]||origin[k]>node.max[k])return false;continue;}const a=(node.min[k]-origin[k])/d[k],b=(node.max[k]-origin[k])/d[k];lo=Math.max(lo,Math.min(a,b));hi=Math.min(hi,Math.max(a,b));if(lo>hi)return false;}return true;};
    const visit=(node:BVHNode)=>{
      if(!intersects(node))return;
      if(node.triangleIndices)for(const id of node.triangleIndices){
        const[a,b,c]=this.getTri(id),e=sub(b,a),f=sub(c,a),h=cross(d,f),det=dot(e,h);if(Math.abs(det)<1e-10)continue;
        const s=sub(origin,a),u=dot(s,h)/det;if(u<0||u>1)continue;
        const q=cross(s,e),v=dot(d,q)/det;if(v<0||u+v>1)continue;
        const t=dot(f,q)/det;if(t>1e-6&&t<best){best=t;found=true;}
      }else{if(node.left)visit(node.left);if(node.right)visit(node.right);}
    };visit(this.root);return found?{point:add(origin,scale(d,best)),distance:best}:undefined;
  }

  private buildNode(triangles: number[], depth: number): BVHNode {
    let min: Vec3M = [Infinity, Infinity, Infinity];
    let max: Vec3M = [-Infinity, -Infinity, -Infinity];

    for (const t of triangles) {
      const [a, b, c] = this.getTri(t);
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], a[k], b[k], c[k]);
        max[k] = Math.max(max[k], a[k], b[k], c[k]);
      }
    }

    if (triangles.length <= 16 || depth >= 18) {
      return { min, max, triangleIndices: triangles };
    }

    // Split along longest axis
    const size = sub(max, min);
    let axis = 0;
    if (size[1] > size[0] && size[1] > size[2]) axis = 1;
    else if (size[2] > size[0] && size[2] > size[1]) axis = 2;

    const mid = (min[axis] + max[axis]) / 2;
    const leftTris: number[] = [];
    const rightTris: number[] = [];

    for (const t of triangles) {
      const [a, b, c] = this.getTri(t);
      const centroid = (a[axis] + b[axis] + c[axis]) / 3;
      if (centroid < mid) leftTris.push(t);
      else rightTris.push(t);
    }

    if (!leftTris.length || !rightTris.length) {
      return { min, max, triangleIndices: triangles };
    }

    return {
      min,
      max,
      left: this.buildNode(leftTris, depth + 1),
      right: this.buildNode(rightTris, depth + 1),
    };
  }

  /**
   * Find closest point on the mesh to query point p.
   */
  queryClosestPoint(p: Vec3M): ClosestPointResult {
    let bestDistSq = Infinity;
    const bestPoint: Vec3M = [0, 0, 0];
    let bestTri = -1;
    const px = p[0], py = p[1], pz = p[2], positions = this.positions, indices = this.indices, point = closestScratch;

    const traverse = (node: BVHNode) => {
      if (aabbDistSq(p, node.min, node.max) >= bestDistSq) return;

      if (node.triangleIndices) {
        for (const t of node.triangleIndices) {
          const i0 = indices[t * 3] * 3, i1 = indices[t * 3 + 1] * 3, i2 = indices[t * 3 + 2] * 3;
          const distSq = closestOnTriangle(px, py, pz, positions[i0], positions[i0 + 1], positions[i0 + 2],
            positions[i1], positions[i1 + 1], positions[i1 + 2], positions[i2], positions[i2 + 1], positions[i2 + 2], point);
          if (distSq < bestDistSq) {
            bestDistSq = distSq;
            bestPoint[0] = point[0]; bestPoint[1] = point[1]; bestPoint[2] = point[2];
            bestTri = t;
          }
        }
        return;
      }

      if (node.left && node.right) {
        const dLeft = aabbDistSq(p, node.left.min, node.left.max);
        const dRight = aabbDistSq(p, node.right.min, node.right.max);
        if (dLeft < dRight) {
          traverse(node.left);
          traverse(node.right);
        } else {
          traverse(node.right);
          traverse(node.left);
        }
      } else if (node.left) {
        traverse(node.left);
      } else if (node.right) {
        traverse(node.right);
      }
    };

    traverse(this.root);

    let normal: Vec3M = [0, 0, 1];
    if (bestTri >= 0) {
      const [a, b, c] = this.getTri(bestTri);
      normal = unit(cross(sub(b, a), sub(c, a)));
    }

    return {
      point: bestPoint,
      distanceSq: bestDistSq,
      triangleIndex: bestTri,
      normal,
    };
  }

  /**
   * Generates N uniformly distributed area-weighted sample points on the surface.
   */
  sampleSurface(numSamples: number, random: () => number = Math.random): { points: Float32Array; normals: Float32Array; areas: Float32Array } {
    const triCount = this.indices.length / 3;
    const areas = new Float64Array(triCount);
    let totalArea = 0;

    for (let t = 0; t < triCount; t++) {
      const [a, b, c] = this.getTri(t);
      const ab = sub(b, a);
      const ac = sub(c, a);
      const crossProd = cross(ab, ac);
      const area = 0.5 * norm(crossProd);
      areas[t] = area;
      totalArea += area;
    }

    const cdf = new Float64Array(triCount);
    let accum = 0;
    for (let t = 0; t < triCount; t++) {
      accum += areas[t] / totalArea;
      cdf[t] = accum;
    }

    const outPoints = new Float32Array(numSamples * 3);
    const outNormals = new Float32Array(numSamples * 3);
    const outSampleAreas = new Float32Array(numSamples);
    const sampleArea = totalArea / numSamples;

    for (let i = 0; i < numSamples; i++) {
      const r = random();
      // Binary search CDF
      let lo = 0, hi = triCount - 1;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (cdf[mid] < r) lo = mid + 1;
        else hi = mid;
      }
      const t = lo;
      const [a, b, c] = this.getTri(t);
      const n = unit(cross(sub(b, a), sub(c, a)));

      // Random barycentric inside triangle
      const r1 = random();
      const r2 = random();
      const sqrtR1 = Math.sqrt(r1);
      const u = 1 - sqrtR1;
      const v = r2 * sqrtR1;
      const w = 1 - u - v;

      const px = u * a[0] + v * b[0] + w * c[0];
      const py = u * a[1] + v * b[1] + w * c[1];
      const pz = u * a[2] + v * b[2] + w * c[2];

      outPoints[i * 3] = px;
      outPoints[i * 3 + 1] = py;
      outPoints[i * 3 + 2] = pz;

      outNormals[i * 3] = n[0];
      outNormals[i * 3 + 1] = n[1];
      outNormals[i * 3 + 2] = n[2];

      outSampleAreas[i] = sampleArea;
    }

    return {
      points: outPoints,
      normals: outNormals,
      areas: outSampleAreas,
    };
  }
}
