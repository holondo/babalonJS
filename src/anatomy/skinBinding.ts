import type { Vec3M } from './landmarks';

export interface SkinVertexBinding {
  skinIndex: number;
  restSkinPos: Vec3M;
  structureName: string;
  sourceVertexIndex: number;
  restSourcePos: Vec3M;
  normal: Vec3M;
  fatThickness: number;
}

export interface DrivenMeshState {
  bindings: SkinVertexBinding[];
  restSkinPositions: Float32Array;
}

export interface SimplifiedAnatomyMesh {
  name: string;
  positions: Float32Array;
  normals?: Float32Array;
}

function distSq(a: Vec3M, b: Vec3M): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Bind each vertex of a target skin mesh to the nearest underlying anatomical structure at rest.
 */
export function bindSkinToAnatomy(
  skinPositions: Float32Array,
  anatomyMeshes: SimplifiedAnatomyMesh[],
  maxSearchDist = 0.15
): DrivenMeshState {
  const skinCount = skinPositions.length / 3;
  const bindings: SkinVertexBinding[] = new Array(skinCount);
  const maxDistSq = maxSearchDist * maxSearchDist;

  // Filter superficial structures that should drive the skin (muscles, bones, aponeuroses)
  const superficial = anatomyMeshes.filter(m =>
    !m.name.includes('internal_oblique') &&
    !m.name.includes('transversus') &&
    !m.name.includes('deep_')
  );

  for (let i = 0; i < skinCount; i++) {
    const skinPos: Vec3M = [
      skinPositions[i * 3],
      skinPositions[i * 3 + 1],
      skinPositions[i * 3 + 2],
    ];

    let bestDistSq = Infinity;
    let bestStructure = '';
    let bestVertexIdx = -1;
    let bestSourcePos: Vec3M = [skinPos[0], skinPos[1], skinPos[2]];

    for (const mesh of superficial) {
      const pos = mesh.positions;
      const count = pos.length / 3;
      // Stride sampling if mesh is extremely dense
      const stride = count > 10000 ? 4 : 1;
      for (let j = 0; j < count; j += stride) {
        const srcPos: Vec3M = [pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]];
        const d2 = distSq(skinPos, srcPos);
        if (d2 < bestDistSq) {
          bestDistSq = d2;
          bestStructure = mesh.name;
          bestVertexIdx = j;
          bestSourcePos = srcPos;
        }
      }
    }

    const fatThickness = bestDistSq < maxDistSq ? Math.sqrt(bestDistSq) : 0;
    const normal: Vec3M = fatThickness > 1e-6
      ? [
          (skinPos[0] - bestSourcePos[0]) / fatThickness,
          (skinPos[1] - bestSourcePos[1]) / fatThickness,
          (skinPos[2] - bestSourcePos[2]) / fatThickness,
        ]
      : [0, 0, 1];

    bindings[i] = {
      skinIndex: i,
      restSkinPos: skinPos,
      structureName: bestStructure,
      sourceVertexIndex: bestVertexIdx,
      restSourcePos: bestSourcePos,
      normal,
      fatThickness,
    };
  }

  return {
    bindings,
    restSkinPositions: new Float32Array(skinPositions),
  };
}

/**
 * Deform target skin vertices according to the movement of underlying anatomical structures.
 * Target skin = rest skin + Delta(anatomy edited - anatomy rest) * attenuation.
 */
export function driveSkinPositions(
  state: DrivenMeshState,
  currentAnatomyMeshes: SimplifiedAnatomyMesh[],
  fatDamping = 0.8
): Float32Array {
  const count = state.bindings.length;
  const out = new Float32Array(count * 3);
  const meshMap = new Map<string, SimplifiedAnatomyMesh>();
  for (const m of currentAnatomyMeshes) {
    meshMap.set(m.name, m);
  }

  for (let i = 0; i < count; i++) {
    const b = state.bindings[i];
    const rest = b.restSkinPos;

    if (!b.structureName || b.sourceVertexIndex < 0) {
      out[i * 3] = rest[0];
      out[i * 3 + 1] = rest[1];
      out[i * 3 + 2] = rest[2];
      continue;
    }

    const currentMesh = meshMap.get(b.structureName);
    if (!currentMesh) {
      out[i * 3] = rest[0];
      out[i * 3 + 1] = rest[1];
      out[i * 3 + 2] = rest[2];
      continue;
    }

    const curPos = currentMesh.positions;
    const vIdx = b.sourceVertexIndex;
    const curX = curPos[vIdx * 3];
    const curY = curPos[vIdx * 3 + 1];
    const curZ = curPos[vIdx * 3 + 2];

    const dx = curX - b.restSourcePos[0];
    const dy = curY - b.restSourcePos[1];
    const dz = curZ - b.restSourcePos[2];

    // Attenuation based on subcutaneous fat thickness
    const attenuation = 1 / (1 + b.fatThickness * fatDamping * 10);

    out[i * 3] = rest[0] + dx * attenuation;
    out[i * 3 + 1] = rest[1] + dy * attenuation;
    out[i * 3 + 2] = rest[2] + dz * attenuation;
  }

  return out;
}
