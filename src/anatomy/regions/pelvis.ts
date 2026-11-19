import type { AnatomyMesh } from '../contracts';
import type { AnatomyParameters } from '../parameters';
import type { AnatomyDefinition, BoneId } from '../definition';
import { calculateNormals } from '../algorithms/loft';

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Local covering displacement in millimetres. It leaves the internal meshes
 * and the lateral silhouette alone. */
export function applyLowerPelvisProjection(mesh: AnatomyMesh, p: AnatomyParameters) {
  const front = p.lowerPelvisFrontDepth, back = p.lowerPelvisBackDepth;
  if (!front && !back) return;
  const canonicalLateral = 18 / p.height;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = Math.abs(mesh.positions[i] * canonicalLateral), y = mesh.positions[i + 1] * 1.8 / 17.5;
    if (y <= .79 || y >= 1.045 || x >= .245) continue;
    const z = mesh.positions[i + 2] * canonicalLateral;
    const height = smooth(.79, .855, y) * (1 - smooth(.935, 1.045, y));
    const side = 1 - smooth(.13, .245, x);
    const depth = z > 0 ? front * smooth(.025, .075, z) : -back * smooth(.025, .075, -z);
    mesh.positions[i + 2] += height * side * depth / 100;
  }
  mesh.normals = calculateNormals(mesh.positions, mesh.indices);
}
/** Bounded local rest-field shared by pelvic support and its connected tissue neighborhoods. */
export function pelvicPoint(point: readonly number[] | Float32Array, p: AnatomyParameters, definition: AnatomyDefinition): number[] {
  const [x, y, z] = point, side = x < 0 ? 'L' : 'R', shape = definition.bones[`hip_bone.${side}`];
  if (!shape) return [x, y, z];
  const sign = x < 0 ? -1 : 1;
  const w = smooth(7.9, 8.9, y) * (1 - smooth(10, 10.9, y)) * smooth(.08, .45, Math.abs(x)) * (1 - smooth(1.8, 2.6, Math.abs(x)));
  let dx = x * (shape.width - 1) + sign * .3 * shape.flare * Math.exp(-(((y - 9.7) / .6) ** 2));
  let dy = (y - 9.3) * (shape.height - 1), dz = z * (shape.depth - 1);
  const hx = sign * (1.09 + (p.pelvisWidth - 35) / 45), hy = p.skinModel === 1 ? 8.85 : 9.38;
  const weight = Math.exp(-((Math.hypot(x - hx, y - hy, z) / .5) ** 2));
  const angle = shape.acetabularAngle * Math.PI / 180 * sign * weight;
  dx += (x - hx) * (Math.cos(angle) - 1) + z * Math.sin(angle); dz += -(x - hx) * Math.sin(angle) + z * (Math.cos(angle) - 1);
  return [x + dx * w, y + dy * w, z + dz * w];
}
export function deformPelvis(mesh: AnatomyMesh, p: AnatomyParameters, definition: AnatomyDefinition) {
  if (mesh.rigRegion === 'arm' || mesh.rigRegion === 'hand') return;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    if (mesh.rig && mesh.rig[i / 3 * 4] > .5) continue;
    mesh.positions.set(pelvicPoint(mesh.positions.subarray(i, i + 3), p, definition), i);
  }
  mesh.normals = calculateNormals(mesh.positions, mesh.indices);
  if (/^(ilium_wing|iliac_crest|acetabular_rim|hip_bone)_/.test(mesh.anatomicalName ?? '')) mesh.anatomyId = `hip_bone.${mesh.anatomicalName!.endsWith('L') ? 'L' : 'R'}` as BoneId;
}
