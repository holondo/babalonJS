import type { AnatomyMesh } from './contracts';
import { SurfaceBVH } from './inference/observationProxy';
import { calculateNormals } from './algorithms/loft';
import type { Vec3M } from './landmarks';

/** Cover authored genetic variation without shrinking muscle volume or moving the skeleton. */
export function coverGeneticMuscles(skin: AnatomyMesh, muscles: AnatomyMesh[]) {
  if (!muscles.length) return;
  const count = skin.positions.length / 3, adjacency: number[][] = Array.from({ length: count }, () => []);
  const canonical = new Int32Array(count), welded = new Map<string, number>();
  for (let v = 0; v < count; v++) {
    const key = [0,1,2].map(k => Math.round(skin.positions[v*3+k]*1e4)).join(',');
    canonical[v] = welded.get(key) ?? (welded.set(key, v), v);
  }
  for (let i = 0; i < skin.indices.length; i += 3) for (let k = 0; k < 3; k++) {
    const a = canonical[skin.indices[i+k]];
    adjacency[a].push(canonical[skin.indices[i+(k+1)%3]], canonical[skin.indices[i+(k+2)%3]]);
  }
  for (let iteration = 0; iteration < 4; iteration++) {
    const surface = new SurfaceBVH(skin), need = new Float32Array(count);
    const orientation = Math.sign(surface.queryClosestPoint([0, 12.6, 4]).normal[2]) || 1;
    let exposed = 0;
    const sample = (point: Vec3M) => {
      const hit = surface.queryClosestPoint(point);
      if (hit.triangleIndex < 0) return;
      const depth = orientation * hit.normal.reduce((sum, n, k) => sum + n*(point[k]-hit.point[k]), 0);
      if (depth < -.008 || depth > .4) return;
      // A closest-normal sign alone is ambiguous at folds and narrow recesses.
      // Confirm exposure from outside the actual closed skin before growing it.
      const length = Math.sqrt(hit.distanceSq) || 1;
      const normal: Vec3M = point.map((v, k) => (v-hit.point[k])/length) as Vec3M;
      const directions: Vec3M[] = [normal, [0,0,1], [0,0,-1], [1,0,0], [-1,0,0]];
      if (!directions.some(direction => {
        const start = point.map((v, k) => v+20*direction[k]) as Vec3M;
        const ray = surface.queryRay(start, direction.map(v => -v) as Vec3M, 40);
        return ray && ray.distance > 20.002;
      })) return;
      const amount = Math.min(.15, depth + .012);
      if (amount < .002) return;
      exposed++;
      for (let k = 0; k < 3; k++) {
        const vertex = canonical[skin.indices[hit.triangleIndex*3+k]];
        need[vertex] = Math.max(need[vertex], amount);
      }
    };
    for (const mesh of muscles) {
      const p = mesh.positions;
      for (let i = 0; i < p.length; i += 3) sample([p[i],p[i+1],p[i+2]]);
      for (let i = 0; i < mesh.indices.length; i += 3) {
        const a = mesh.indices[i]*3, b = mesh.indices[i+1]*3, c = mesh.indices[i+2]*3;
        const longest = Math.max(Math.hypot(p[a]-p[b],p[a+1]-p[b+1],p[a+2]-p[b+2]),
          Math.hypot(p[a]-p[c],p[a+1]-p[c+1],p[a+2]-p[c+2]), Math.hypot(p[b]-p[c],p[b+1]-p[c+1],p[b+2]-p[c+2]));
        if (longest > .18) sample([(p[a]+p[b]+p[c])/3,(p[a+1]+p[b+1]+p[c+1])/3,(p[a+2]+p[b+2]+p[c+2])/3]);
      }
    }
    if (!exposed) break;
    let spread = need.slice();
    for (let pass = 0; pass < 3; pass++) {
      const next = spread.slice();
      for (let v = 0; v < count; v++) for (const neighbour of adjacency[v]) next[v] = Math.max(next[v], spread[neighbour]*.7);
      spread = next;
    }
    for (let pass = 0; pass < 3; pass++) {
      const next = spread.slice();
      for (let v = 0; v < count; v++) {
        let sum = spread[v]; for (const neighbour of adjacency[v]) sum += spread[neighbour];
        next[v] = Math.max(need[v], sum/(adjacency[v].length+1));
      }
      spread = next;
    }
    const sharedNormals = new Float32Array(skin.normals.length);
    for (let v = 0; v < count; v++) for (let k = 0; k < 3; k++) sharedNormals[canonical[v]*3+k] += skin.normals[v*3+k];
    for (let v = 0; v < count; v++) {
      const i = v*3, rig = v*4;
      if (skin.rig && (skin.rig[rig+2] > .95 || skin.positions[i+1] > 15.1 && skin.rig[rig+3] > .95)) continue;
      const n = canonical[v]*3, length = Math.hypot(sharedNormals[n], sharedNormals[n+1], sharedNormals[n+2]) || 1;
      for (let k = 0; k < 3; k++) skin.positions[i+k] += sharedNormals[n+k]/length*spread[canonical[v]];
    }
    skin.normals = calculateNormals(skin.positions, skin.indices);
  }
}
