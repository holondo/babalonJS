import { MeshoptSimplifier } from 'meshoptimizer';

/** Connected analysis-only surface. Sampling isolated source triangles leaves
 * artificial holes and biases point-to-surface fitting on dense scan meshes.
 * Original source buffers, attributes and topology are never modified.
 */
export async function connectedSurfaceProxy(positions: Float32Array, indices: Uint32Array, targetTriangles = 18000) {
  await MeshoptSimplifier.ready;
  const [simplified, error] = indices.length > targetTriangles * 3
    ? MeshoptSimplifier.simplify(indices, positions, 3, targetTriangles * 3, .002, ['ErrorAbsolute'])
    : [indices, 0] as const;
  const remap = new Int32Array(positions.length / 3).fill(-1), compact: number[] = [], compactIndices = new Uint32Array(simplified.length);
  for (let i = 0; i < simplified.length; i++) {
    const vertex = simplified[i];
    if (remap[vertex] < 0) { remap[vertex] = compact.length / 3; compact.push(positions[vertex*3],positions[vertex*3+1],positions[vertex*3+2]); }
    compactIndices[i] = remap[vertex];
  }
  return { positions: new Float32Array(compact), indices: compactIndices,
    evidence: { method: 'connected-meshopt' as const, sourceTriangles: indices.length / 3, triangles: simplified.length / 3, estimatedErrorMm: error * 1000 } };
}
