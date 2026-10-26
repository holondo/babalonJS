import type { GaussianSplattingMeshBase } from '@babylonjs/core/Meshes/GaussianSplatting/gaussianSplattingMeshBase.js';

export const STANDARD_SPLAT_EXTENSION = 'KHR_gaussian_splatting';
export const SH_C0 = 0.28209479177387814;

/** Decode retained Babylon records into the ratified ellipse-kernel attributes. */
export async function standardSplatAttributes(mesh: GaussianSplattingMeshBase, reflectX: boolean) {
  const data = mesh.splatsData!;
  const floats = new Float32Array(data), bytes = new Uint8Array(data), count = data.byteLength / 32;
  const attributes: Record<string, { data: Float32Array; type: 'SCALAR' | 'VEC3' | 'VEC4' }> = {};
  const add = (name: string, type: 'SCALAR' | 'VEC3' | 'VEC4', components: number) => {
    const data = new Float32Array(count * components);
    attributes[`${STANDARD_SPLAT_EXTENSION}:${name}`] = { data, type };
    return data;
  };
  const rotation = add('ROTATION', 'VEC4', 4), scale = add('SCALE', 'VEC3', 3);
  const opacity = add('OPACITY', 'SCALAR', 1), dc = add('SH_DEGREE_0_COEF_0', 'VEC3', 3);
  // The standard defines degrees 0–3. App exports retain any additional bands.
  const degree = Math.min(3, Reflect.get(mesh, '_maxShDegree') as number);
  const harmonics: Float32Array[] = [];
  for (let l = 1; l <= degree; l++) for (let m = 0; m < 2 * l + 1; m++) {
    harmonics.push(add(`SH_DEGREE_${l}_COEF_${m}`, 'VEC3', 3));
  }
  // Real SH polynomials odd in x change sign under the exporter's x reflection.
  const oddX = new Set([2, 3, 6, 9, 12, 14]);
  for (let i = 0; i < count; i++) {
    const p = i * 3, b = i * 32, f = i * 8, r = i * 4;
    let norm = 0;
    for (let c = 0; c < 4; c++) {
      const v = (bytes[b + 28 + (c + 1) % 4] - 127.5) / 127.5;
      rotation[r + c] = v * (reflectX && (c === 1 || c === 2) ? -1 : 1);
      norm += v * v;
    }
    norm = Math.sqrt(norm);
    for (let c = 0; c < 4; c++) rotation[r + c] /= norm;
    for (let c = 0; c < 3; c++) {
      scale[p + c] = Math.abs(floats[f + 3 + c]);
      dc[p + c] = (bytes[b + 24 + c] / 255 - 0.5) / SH_C0;
    }
    opacity[i] = bytes[b + 27] / 255 * Math.min(1, Math.max(0, mesh.material?.alpha ?? 1));
    for (let k = 0; k < harmonics.length; k++) for (let c = 0; c < 3; c++) {
      const flat = k * 3 + c;
      const value = mesh.shData?.[flat >> 4]?.[i * 16 + (flat & 15)] ?? 128;
      harmonics[k][p + c] = (value / 128 - 1) * (reflectX && oddX.has(k) ? -1 : 1);
    }
    if (i && i % 16384 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  return attributes;
}
