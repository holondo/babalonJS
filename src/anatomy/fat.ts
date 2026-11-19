import { buildRegionalSurface } from './geometry';
import type { AnatomyMesh } from './contracts';
import type { AnatomyParameters } from './parameters';

/** Independent approximate subcutaneous volume bounded by the covered and lean surfaces. */
export function buildAdipose(p: AnatomyParameters, skin: AnatomyMesh, preparedLean?: AnatomyMesh): AnatomyMesh[] {
  if (!p.fatPaint && p.fat <= 0 && p.lowerAbdominalFat <= 0 && p.flankFullness <= 0 && p.suprapubicFat <= 0) return [];
  const lean: AnatomyMesh = preparedLean ?? buildRegionalSurface({ ...p, fat: 0, lowerAbdominalFat: 0, flankFullness: 0, suprapubicFat: 0 });
  const positions = new Float32Array(skin.positions.length + lean.positions.length);
  const normals = new Float32Array(positions.length);
  positions.set(skin.positions); positions.set(lean.positions, skin.positions.length);
  normals.set(skin.normals);
  for (let i = 0; i < skin.positions.length; ++i) positions[i] -= skin.normals[i] * .008;
  for (let i = 0; i < lean.normals.length; ++i) normals[skin.normals.length + i] = -lean.normals[i];
  const indices = new Uint32Array(skin.indices.length + lean.indices.length), offset = skin.positions.length / 3;
  indices.set(skin.indices);
  for (let i = 0; i < lean.indices.length; i += 3) {
    indices[skin.indices.length + i] = lean.indices[i] + offset;
    indices[skin.indices.length + i + 1] = lean.indices[i + 2] + offset;
    indices[skin.indices.length + i + 2] = lean.indices[i + 1] + offset;
  }
  let rig: Float32Array | undefined;
  if (skin.rig) { rig = new Float32Array(skin.rig.length * 2); rig.set(skin.rig); rig.set(skin.rig, skin.rig.length); }
  return [{ positions, normals, indices, rig,adiposePairs:offset }];
}
