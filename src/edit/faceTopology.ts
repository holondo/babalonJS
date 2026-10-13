import { weld } from '../rigging/skinMath';

/**
 * Face connectivity of a mesh in compact arrays (built once per geometry, no string keys):
 * `offsets/list` give the faces sharing an edge with each face; vertices are welded by position
 * so UV seams don't split a surface.
 */
export interface FaceTopology {
  offsets: Uint32Array;
  list: Uint32Array;
  /** Vertex → welded vertex id. */
  weld: Uint32Array;
  /** Welded vertex → faces using it (`vertexFaces[vertexStart[v] .. vertexStart[v + 1]]`). */
  vertexStart: Uint32Array;
  vertexFaces: Uint32Array;
}

/** Pure version (also run in a worker, see topology.worker.ts). */
export function computeTopology(positions: Float32Array, indices: ArrayLike<number>): FaceTopology {
  const faces = indices.length / 3;
  const { map, points } = weld(positions);
  const vertices = points.length / 3;
  // Vertex → faces (CSR)
  const vStart = new Uint32Array(vertices + 1);
  for (let i = 0; i < indices.length; i++) vStart[map[indices[i]] + 1]++;
  for (let v = 0; v < vertices; v++) vStart[v + 1] += vStart[v];
  const vFaces = new Uint32Array(indices.length), fill = vStart.slice(0, vertices);
  for (let i = 0; i < indices.length; i++) vFaces[fill[map[indices[i]]]++] = (i / 3) | 0;
  // Face → faces sharing an edge: for edge (a, b), faces around a that also touch b
  const count = new Uint32Array(faces + 1);
  const scratch: number[] = [];
  const edgeNeighbors = (f: number, out: number[]) => {
    out.length = 0;
    for (let e = 0; e < 3; e++) {
      const a = map[indices[f * 3 + e]], b = map[indices[f * 3 + (e + 1) % 3]];
      if (a === b) continue;
      for (let k = vStart[a]; k < vStart[a + 1]; k++) {
        const g = vFaces[k];
        if (g === f) continue;
        const ga = map[indices[g * 3]], gb = map[indices[g * 3 + 1]], gc = map[indices[g * 3 + 2]];
        if (ga === b || gb === b || gc === b) out.push(g);
      }
    }
    return out;
  };
  for (let f = 0; f < faces; f++) count[f + 1] = edgeNeighbors(f, scratch).length;
  for (let f = 0; f < faces; f++) count[f + 1] += count[f];
  const list = new Uint32Array(count[faces]);
  for (let f = 0; f < faces; f++) list.set(edgeNeighbors(f, scratch), count[f]);
  return { offsets: count, list, weld: map, vertexStart: vStart, vertexFaces: vFaces };
}

/**
 * Faces along open edges, and a test saying whether edge `j` (vertices j, j+1) of a face is open
 * (no other face shares it), from the connectivity: for local work on large meshes.
 */
export function openEdges(t: FaceTopology, indices: ArrayLike<number>) {
  const open = (f: number, j: number) => {
    const a = t.weld[indices[f * 3 + j]], b = t.weld[indices[f * 3 + (j + 1) % 3]];
    for (let k = t.offsets[f]; k < t.offsets[f + 1]; k++) {
      const g = t.list[k], x = t.weld[indices[g * 3]], y = t.weld[indices[g * 3 + 1]], z = t.weld[indices[g * 3 + 2]];
      // Degenerate faces (two corners at one point) don't close an edge, as in the border search
      if (x === y || y === z || x === z) continue;
      if ((x === a || y === a || z === a) && (x === b || y === b || z === b)) return false;
    }
    return true;
  };
  const faces: number[] = [];
  for (let f = 0; f < t.offsets.length - 1; f++) if (t.offsets[f + 1] - t.offsets[f] < 3 || open(f, 0) || open(f, 1) || open(f, 2)) faces.push(f);
  return { faces, open };
}
