import type { Vec3M } from '../landmarks';

export interface SubmeshGeometry {
  id: string;
  positions: Float32Array;
  normals?: Float32Array;
  uvs?: Float32Array;
  indices?: Uint32Array;
  materialName?: string;
  worldMatrix?: readonly number[];
}

export interface ImmutableSourceAsset {
  assetId: string;
  fingerprint: string;
  submeshes: readonly Readonly<SubmeshGeometry>[];
  totalVertices: number;
  totalTriangles: number;
  bounds: {
    min: Vec3M;
    max: Vec3M;
    size: Vec3M;
    center: Vec3M;
  };
}

/** Compute a fast 32-bit hash of a typed array for buffer identity checking. */
export function hashBuffer(buffer: ArrayBufferView): string {
  const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    h1 = Math.imul(h1 ^ b, 2654435761);
    h2 = Math.imul(h2 ^ b, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/**
 * Creates an immutable snapshot of an imported humanoid GLB mesh.
 * Freezes buffers so original geometry can never be mutated by fitting passes.
 */
export function snapshotImmutableSource(
  assetId: string,
  submeshes: SubmeshGeometry[]
): ImmutableSourceAsset {
  let totalVerts = 0;
  let totalTris = 0;
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  const frozenSubmeshes: Readonly<SubmeshGeometry>[] = submeshes.map((sub, idx) => {
    const posCopy = new Float32Array(sub.positions);
    const n = posCopy.length / 3;
    totalVerts += n;

    for (let i = 0; i < n; i++) {
      const x = posCopy[i * 3];
      const y = posCopy[i * 3 + 1];
      const z = posCopy[i * 3 + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }

    if (sub.indices) {
      totalTris += sub.indices.length / 3;
    } else {
      totalTris += n / 3;
    }

    const normCopy = sub.normals ? new Float32Array(sub.normals) : undefined;
    const uvCopy = sub.uvs ? new Float32Array(sub.uvs) : undefined;
    const indCopy = sub.indices ? new Uint32Array(sub.indices) : undefined;

    return Object.freeze({
      id: sub.id || `submesh_${idx}`,
      positions: posCopy,
      normals: normCopy,
      uvs: uvCopy,
      indices: indCopy,
      materialName: sub.materialName,
      worldMatrix: sub.worldMatrix ? Object.freeze([...sub.worldMatrix]) : undefined,
    });
  });

  const hashes = frozenSubmeshes.map(s => hashBuffer(s.positions)).join(':');
  const fingerprint = `${assetId}_${totalVerts}_${hashes}`;

  const bounds = {
    min: [minX, minY, minZ] as Vec3M,
    max: [maxX, maxY, maxZ] as Vec3M,
    size: [maxX - minX, maxY - minY, maxZ - minZ] as Vec3M,
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2] as Vec3M,
  };

  return Object.freeze({
    assetId,
    fingerprint,
    submeshes: Object.freeze(frozenSubmeshes),
    totalVertices: totalVerts,
    totalTriangles: Math.floor(totalTris),
    bounds: Object.freeze(bounds),
  });
}

/**
 * Asserts that an immutable source asset has not experienced any bit-drift or corruption.
 */
export function assertSourceUnchanged(source: ImmutableSourceAsset): boolean {
  for (const sub of source.submeshes) {
    if (!sub.positions || sub.positions.length % 3 !== 0) return false;
    for (let i = 0; i < sub.positions.length; i++) {
      if (!Number.isFinite(sub.positions[i])) return false;
    }
  }
  return true;
}
