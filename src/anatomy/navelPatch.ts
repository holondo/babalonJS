import type { AnatomyMesh } from './contracts';
import type { FittedNavel } from './surfaceFit';
import { navelDetailLayout } from './surfaceFit';

/** Split shared edges so the skin and its lean counterpart keep the same topology. */
export function refineNavelPatch(skin: AnatomyMesh, lean: AnatomyMesh | undefined, navel: FittedNavel, height: number) {
  if (lean && (lean.positions.length !== skin.positions.length || lean.indices.length !== skin.indices.length)) return false;
  const meshes = lean ? [skin, lean] : [skin], lateral = 18 / height, vertical = 1.8 / 17.5;
  let refined = false;
  const rim = navel.detail ? navelDetailLayout(navel.detail).radius : 0;
  for (const radius of [Math.max(.061,rim+.017), Math.max(.046,rim+.003), .033]) {
    const count = skin.positions.length / 3, positions = skin.positions;
    const edges = new Map<number, number>(), added: [number, number][] = [], indices: number[] = [];
    const split = (a: number, b: number) => {
      const key = Math.min(a,b) * count + Math.max(a,b);
      const existing = edges.get(key);
      if (existing !== undefined) return existing;
      const x = (positions[a*3] + positions[b*3]) * lateral / 2;
      const y = (positions[a*3+1] + positions[b*3+1]) * vertical / 2;
      const z = (positions[a*3+2] + positions[b*3+2]) * lateral / 2;
      if (z < .055 || Math.hypot(x - navel.x, y - navel.y) >= radius) return -1;
      const index = count + added.length;
      edges.set(key, index);
      added.push([a,b]);
      return index;
    };
    for (let i = 0; i < skin.indices.length; i += 3) {
      let a = skin.indices[i], b = skin.indices[i+1], c = skin.indices[i+2];
      let ab = split(a,b), bc = split(b,c), ca = split(c,a);
      if (ab >= 0 && bc >= 0 && ca >= 0) indices.push(a,ab,ca, ab,b,bc, ca,bc,c, ab,bc,ca);
      else if (ab < 0 && bc < 0 && ca < 0) indices.push(a,b,c);
      else {
        // Keep the original winding when one or two edges split.
        while (ab < 0 || ca >= 0) {
          [a,b,c] = [b,c,a];
          [ab,bc,ca] = [bc,ca,ab];
        }
        if (bc >= 0) indices.push(a,ab,c, ab,b,bc, ab,bc,c);
        else indices.push(a,ab,c, ab,b,c);
      }
    }
    if (!added.length) continue;
    refined = true;
    const interpolate = (values: Float32Array, stride: number) => {
      const result = new Float32Array((count + added.length) * stride);
      result.set(values);
      added.forEach(([a,b], i) => {
        for (let k = 0; k < stride; k++) result[(count+i)*stride+k] = (values[a*stride+k] + values[b*stride+k]) / 2;
      });
      return result;
    };
    const topology = Uint32Array.from(indices);
    for (const mesh of meshes) {
      mesh.positions = interpolate(mesh.positions, 3);
      mesh.normals = interpolate(mesh.normals, 3);
      if (mesh.rig) mesh.rig = interpolate(mesh.rig, 4);
      mesh.indices = topology;
    }
  }
  return refined;
}

/** Unfold the authored opening in the frontal chart before applying measured depth. */
export function unfoldNavelPatch(mesh: AnatomyMesh, positions: Float32Array, navel: FittedNavel, lateral: number, vertical: number) {
  const inside = (i: number, radius: number) => positions[i+2]*lateral > .055 &&
    Math.hypot(positions[i]*lateral-navel.x, positions[i+1]*vertical-navel.y) < radius;
  let folded = false;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.indices[i]*3, b = mesh.indices[i+1]*3, c = mesh.indices[i+2]*3;
    if (!inside(a,.053) || !inside(b,.053) || !inside(c,.053)) continue;
    const area = (positions[b]-positions[a])*(positions[c+1]-positions[a+1]) - (positions[b+1]-positions[a+1])*(positions[c]-positions[a]);
    if (area < -1e-8) { folded = true; break; }
  }
  if (!folded) return;
  const patch = new Map<number, Set<number>>();
  for (let i = 0; i < positions.length; i += 3) if (inside(i,.054)) patch.set(i,new Set());
  for (let i = 0; i < mesh.indices.length; i += 3) {
    for (let j = 0; j < 3; j++) {
      const neighbours = patch.get(mesh.indices[i+j]*3);
      neighbours?.add(mesh.indices[i+(j+1)%3]*3);
      neighbours?.add(mesh.indices[i+(j+2)%3]*3);
    }
  }
  // A fixed outer ring leaves the rest of the abdomen in place.
  for (let pass = 0; pass < 64; pass++) for (const [i, neighbours] of patch) {
    if (!neighbours.size) continue;
    let x = 0, y = 0;
    for (const j of neighbours) { x += positions[j]; y += positions[j+1]; }
    positions[i] = x / neighbours.size;
    positions[i+1] = y / neighbours.size;
  }
}
