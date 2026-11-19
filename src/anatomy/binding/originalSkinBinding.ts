import type { Vec3M } from '../landmarks';
import type { ImmutableSourceAsset } from '../inference/sourceGLB';

export interface CageVertexBinding {
  skinVertexIdx: number;
  cageCellIdx: number;
  barycentricWeights: [number, number, number];
  restSkinPos: Vec3M;
  restCagePos: Vec3M;
}

export interface FittedOriginalSkinBinding {
  assetId: string;
  fingerprint: string;
  submeshId: string;
  bindings: CageVertexBinding[];
  restPositions: Float32Array;
  restNormals?: Float32Array;
  restUVs?: Float32Array;
  indices?: Uint32Array;
}

function distSq(a: Vec3M, b: Vec3M): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

/**
 * Creates the original skin binding embedding the imported GLB in the fitted subject cage.
 * Guarantees EXACT identity at baseline theta0.
 */
export function buildOriginalSkinBinding(
  source: ImmutableSourceAsset,
  submeshIdx = 0,
  cagePositions: Float32Array,
  cageIndices: Uint32Array
): FittedOriginalSkinBinding {
  const submesh = source.submeshes[submeshIdx];
  const n = submesh.positions.length / 3;
  const bindings: CageVertexBinding[] = new Array(n);

  const triCount = cageIndices.length / 3;

  for (let i = 0; i < n; i++) {
    const skinP: Vec3M = [
      submesh.positions[i * 3],
      submesh.positions[i * 3 + 1],
      submesh.positions[i * 3 + 2],
    ];

    let bestDistSq = Infinity;
    let bestTri = 0;
    let bestCageP: Vec3M = [skinP[0], skinP[1], skinP[2]];

    // Find nearest cage triangle cell
    const step = triCount > 2000 ? Math.floor(triCount / 500) : 1;
    for (let t = 0; t < triCount; t += step) {
      const i0 = cageIndices[t * 3];
      const cP: Vec3M = [cagePositions[i0 * 3], cagePositions[i0 * 3 + 1], cagePositions[i0 * 3 + 2]];
      const d2 = distSq(skinP, cP);
      if (d2 < bestDistSq) {
        bestDistSq = d2;
        bestTri = t;
        bestCageP = cP;
      }
    }

    bindings[i] = {
      skinVertexIdx: i,
      cageCellIdx: bestTri,
      barycentricWeights: [1 / 3, 1 / 3, 1 / 3],
      restSkinPos: skinP,
      restCagePos: bestCageP,
    };
  }

  return {
    assetId: source.assetId,
    fingerprint: source.fingerprint,
    submeshId: submesh.id,
    bindings,
    restPositions: new Float32Array(submesh.positions),
    restNormals: submesh.normals ? new Float32Array(submesh.normals) : undefined,
    restUVs: submesh.uvs ? new Float32Array(submesh.uvs) : undefined,
    indices: submesh.indices ? new Uint32Array(submesh.indices) : undefined,
  };
}

/**
 * Evaluates the deformed original skin positions given updated cage positions.
 * At currentCagePositions === baselineCagePositions, returns EXACT identity restPositions.
 */
export function evaluateDeformedSkin(
  binding: FittedOriginalSkinBinding,
  currentCagePositions: Float32Array,
  baselineCagePositions: Float32Array,
  cageIndices: Uint32Array,
  attenuation = 1.0
): Float32Array {
  const n = binding.bindings.length;
  const out = new Float32Array(n * 3);

  for (let i = 0; i < n; i++) {
    const b = binding.bindings[i];
    const rest = b.restSkinPos;
    const tri = b.cageCellIdx;
    const i0 = cageIndices[tri * 3];
    const i1 = cageIndices[tri * 3 + 1];
    const i2 = cageIndices[tri * 3 + 2];
    const [w0, w1, w2] = b.barycentricWeights;

    // Compute cage delta across triangle vertices: Delta C = C_current - C_baseline
    const dx0 = currentCagePositions[i0 * 3] - baselineCagePositions[i0 * 3];
    const dy0 = currentCagePositions[i0 * 3 + 1] - baselineCagePositions[i0 * 3 + 1];
    const dz0 = currentCagePositions[i0 * 3 + 2] - baselineCagePositions[i0 * 3 + 2];

    const dx1 = currentCagePositions[i1 * 3] - baselineCagePositions[i1 * 3];
    const dy1 = currentCagePositions[i1 * 3 + 1] - baselineCagePositions[i1 * 3 + 1];
    const dz1 = currentCagePositions[i1 * 3 + 2] - baselineCagePositions[i1 * 3 + 2];

    const dx2 = currentCagePositions[i2 * 3] - baselineCagePositions[i2 * 3];
    const dy2 = currentCagePositions[i2 * 3 + 1] - baselineCagePositions[i2 * 3 + 1];
    const dz2 = currentCagePositions[i2 * 3 + 2] - baselineCagePositions[i2 * 3 + 2];

    const dx = (w0 * dx0 + w1 * dx1 + w2 * dx2) * attenuation;
    const dy = (w0 * dy0 + w1 * dy1 + w2 * dy2) * attenuation;
    const dz = (w0 * dz0 + w1 * dz1 + w2 * dz2) * attenuation;

    // v_i(theta) = v_i^original + Delta C
    out[i * 3] = rest[0] + dx;
    out[i * 3 + 1] = rest[1] + dy;
    out[i * 3 + 2] = rest[2] + dz;
  }

  return out;
}
