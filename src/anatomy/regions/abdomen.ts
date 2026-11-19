import type { AnatomyMesh } from '../contracts';
import { type AnatomyParameters } from '../parameters';
import type { MuscleId, MuscleShape, MuscleTemplate } from '../definition';
import { priorityProfile } from '../dataBridge';
import { signedMeshVolume, calculateNormals } from '../algorithms/loft';
import { posteriorMuscles } from '../muscleGroups';

export interface AnatomyMetric { id: string; baselineCm3: number; targetCm3: number; actualCm3: number; error: number; quality: 'heuristic'; }
export interface SurfaceChange { source: Float32Array; target: Float32Array; normals: Float32Array; posterior?: boolean; rectus?: boolean }
function volume(meshes: AnatomyMesh[]) { return meshes.reduce((sum, mesh) => sum + Math.abs(signedMeshVolume(mesh)), 0); }
function morphWeight(mesh: AnatomyMesh, vertex: number, u: number) {
  if (mesh.attachments?.length && mesh.surfaceGrid && mesh.shellPairs) u = Math.floor((vertex % mesh.shellPairs) / (mesh.surfaceGrid.cols + 1)) / mesh.surfaceGrid.rows;
  const tissue = mesh.tissue ? Math.max(0, Math.min(1, (mesh.tissue[vertex] - .2) / .6)) : 1;
  return Math.sin(Math.PI * u) ** .6 * tissue;
}
/** Existing shells/fans retain their topology; profile and volume are applied after legacy cage fitting. */
export function shapeMuscle(meshes: AnatomyMesh[], id: MuscleId, shape: MuscleShape, p: AnatomyParameters): { metric: AnatomyMetric; changes: SurfaceChange[] } {
  const template = id.slice(0, -2) as MuscleTemplate;
  // The clavicular fan curves toward the humerus. Scaling world Z moves
  // that fan off its support, so depth is applied by the paired-shell solve.
  const axialDepth = template === 'pectoralis_major_clavicular' ? 1 : shape.depth;
  let low = Infinity, high = -Infinity;
  for (const mesh of meshes) for (let i = 1; i < mesh.positions.length; i += 3) { low = Math.min(low, mesh.positions[i]); high = Math.max(high, mesh.positions[i]); }
  const length = Math.max(.01, high - low), baseline = volume(meshes), changes: SurfaceChange[] = [];
  const centers = meshes.map(mesh => {
    let x = 0, z = 0; const count = mesh.positions.length / 3;
    for (let i = 0; i < mesh.positions.length; i += 3) { x += mesh.positions[i]; z += mesh.positions[i + 2]; }
    return [x / count, z / count];
  });
  for (let j = 0; j < meshes.length; j++) {
    const mesh = meshes[j], source = mesh.positions.slice(), [cx, cz] = centers[j];
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const u = mesh.longitudinal?.[i / 3] ?? Math.max(0, Math.min(1, (source[i + 1] - low) / length));
      const w = morphWeight(mesh, i / 3, u);
      const sample = Math.max(0, Math.min(1, u - (shape.fullness + (shape.peakOffset ?? 0)) * w));
      const profile = Math.sqrt(Math.max(.08, priorityProfile(template, sample)));
      const factor = (1 + shape.profile * (profile - .8) * .6 + shape.activation * .25 * Math.sin(Math.PI * u) ** 2) * Math.exp(shape.fullness * (u - .5));
      const portion = mesh.anatomicalName?.includes('_stern_') ? 1 + shape.balance * .3 : mesh.anatomicalName?.includes('_cost_') ? 1 - shape.balance * .3 : 1;
      // Rectus width grows laterally from each row's medial edge. Separation
      // belongs to rectGap, not to the centroid or the genetic volume solve.
      let widthCenter = cx;
      if (p.abdominalModel === 0 && template === 'rectus_abdominis' && mesh.surfaceGrid && mesh.shellPairs) {
        const cols = mesh.surfaceGrid.cols + 1, row = Math.floor((i / 3 % mesh.shellPairs) / cols), a = row * cols * 3, b = (row * cols + mesh.shellPairs) * 3;
        widthCenter = (source[a] + source[b]) * .5;
      }
      mesh.positions[i] = widthCenter + (source[i] - widthCenter) * (1 + w * (shape.width * factor - 1));
      mesh.positions[i + 2] = cz + (source[i + 2] - cz) * (1 + w * (axialDepth / factor * portion - 1));
    }
    shapeSections(mesh, shape, template === 'rectus_abdominis',
      p.abdominalModel === 1 ? shape.fittedWidthProfile : undefined, low, length);
    changes.push({ source, target: mesh.positions, normals: mesh.normals, posterior: posteriorMuscles.has(template), rectus: template === 'rectus_abdominis' });
  }
  // Adjust each shell around its own paired mid-surface. A global Z centroid
  // leaves curved abdominal sheets with an artificial minimum volume.
  let shaped = meshes.map(mesh => mesh.positions.slice()), depthOnly = false;
  const weights = meshes.map(mesh => {
    const values = new Float32Array(mesh.positions.length / 3);
    for (let vertex = 0; vertex < values.length; vertex++) {
      const u = mesh.longitudinal?.[vertex] ?? Math.max(0, Math.min(1, (mesh.positions[vertex * 3 + 1] - low) / length));
      // Unattached posterior shells may change terminal thickness around a fixed
      // mid-surface; freezing their thick fan ends imposed a false minimum volume.
      values[vertex] = posteriorMuscles.has(template) && !mesh.attachments?.length ? 1 : morphWeight(mesh, vertex, u);
    }
    return values;
  });
  const target = baseline * shape.width * shape.depth * shape.volume;
  const solveThickness = () => {
    const slopes = meshes.map((mesh, j) => {
      const original = shaped[j], pairs = mesh.shellPairs, slope = new Float64Array(original.length);
      for (let vertex = 0; vertex < original.length / 3; vertex++) {
        const paired = pairs ? (vertex < pairs ? vertex + pairs : vertex - pairs) : vertex;
        const w = weights[j][vertex];
        for (let axis = 0; axis < 3; axis++) {
          const i = vertex * 3 + axis;
          const center = pairs ? (original[i] + original[paired * 3 + axis]) * .5 : axis === 2 ? centers[j][1] : original[i];
          slope[i] = depthOnly && axis !== 2 ? 0 : (original[i] - center) * w;
        }
      }
      return slope;
    });
    // A vertex is affine in gain. Its signed tetrahedral volume is cubic.
    // Build the signed polynomial per mesh before taking absolute volumes.
    const coefficients = meshes.map((mesh, j) => {
      const original = shaped[j], slope = slopes[j], positions = new Float64Array(original.length);
      const evaluate = (x: number) => {
        for (let i = 0; i < positions.length; i++) positions[i] = original[i] + slope[i] * x;
        return signedMeshVolume({ positions, indices: mesh.indices });
      };
      const c0 = signedMeshVolume({ positions: original, indices: mesh.indices });
      const plus = evaluate(1), minus = evaluate(-1);
      const odd = (plus - minus) / 2, c2 = (plus + minus) / 2 - c0;
      const c3 = (evaluate(2) - c0 - 2 * odd - 4 * c2) / 6;
      return [c0, odd - c3, c2, c3];
    });
    const predictVolume = (gain: number) => {
      const x = gain - 1;
      return coefficients.reduce((sum, [a, b, c, d]) => sum + Math.abs(((d * x + c) * x + b) * x + a), 0);
    };
    const setThickness = (gain: number) => {
      for (const [j, mesh] of meshes.entries()) {
        const original = shaped[j], slope = slopes[j];
        for (let i = 0; i < original.length; i++) mesh.positions[i] = original[i] + slope[i] * (gain - 1);
      }
    };
    const search = (evaluate: (gain: number) => number) => {
      let lo = .0001, hi = 1;
      while (evaluate(hi) < target && hi < 64) hi *= 2;
      for (let iteration = 0; iteration < 22; iteration++) {
        const mid = (lo + hi) * .5;
        if (evaluate(mid) < target) lo = mid; else hi = mid;
      }
      return (lo + hi) * .5;
    };
    const gain = search(predictVolume);
    setThickness(gain);
    // Preserve the prior numerical path when Float32 quantization dominates.
    if (Math.abs(volume(meshes) - predictVolume(gain)) > Math.max(1e-7, target * 1e-4)) {
      setThickness(search(value => { setThickness(value); return volume(meshes); }));
    }
  };
  solveThickness();
  if (p.abdominalModel === 1 && template === 'rectus_abdominis') {
    // Keep the historical outer width, while separation owns the medial edge.
    // Normalize volume in depth afterwards so the correction cannot widen it again.
    const side = id.endsWith('.L') ? -1 : 1;
    meshes.forEach((mesh, index) => {
      if (!mesh.surfaceGrid || !mesh.shellPairs) return;
      const { rows, cols } = mesh.surfaceGrid, stride = cols + 1, source = changes[index].source;
      for (let row = 0; row <= rows; row++) {
        if (mesh.attachments?.some(binding => binding.end === 'start' ? row === 0 : row === rows)) continue;
        const first = row * stride, gap = side * (source[first * 3] + source[(first + mesh.shellPairs) * 3]) * .5;
        let low = Infinity, high = -Infinity;
        for (let layer = 0; layer < 2; layer++) for (let col = 0; col <= cols; col++) {
          const x = side * mesh.positions[(first + col + layer * mesh.shellPairs) * 3]; low = Math.min(low, x); high = Math.max(high, x);
        }
        if (high - low < .0001 || high - gap < .0001) continue;
        for (let layer = 0; layer < 2; layer++) for (let col = 0; col <= cols; col++) {
          const i = (first + col + layer * mesh.shellPairs) * 3, u = (side * mesh.positions[i] - low) / (high - low);
          mesh.positions[i] = side * (col === 0 ? gap : gap + u * (high - gap));
        }
      }
    });
    shaped = meshes.map(mesh => mesh.positions.slice()); depthOnly = true; solveThickness();
  }
  for (const mesh of meshes) { mesh.normals = calculateNormals(mesh.positions, mesh.indices); mesh.anatomyId = id; }
  const actual = volume(meshes), unit = 1000 * p.height / 175;
  return { changes, metric: { id, baselineCm3: baseline * unit, targetCm3: target * unit, actualCm3: actual * unit, error: target ? Math.abs(actual - target) / target : 0, quality: 'heuristic' } };
}

/** Move each transverse section in its own frame, with a fixed first and last row. */
function shapeSections(mesh: AnatomyMesh, shape: MuscleShape, keepMedialEdge: boolean, fitted: number[] | undefined, low: number, muscleLength: number) {
  const { surfaceGrid: grid, shellPairs: pairs, positions } = mesh;
  const bend = keepMedialEdge ? 0 : shape.centerlineBend ?? 0;
  if (!grid || !pairs || (!shape.widthProfile && !fitted && !bend)) return;
  const stride = grid.cols + 1;
  for (let row = fitted ? 0 : 1; row <= grid.rows - (fitted ? 0 : 1); row++) {
    const first = row * stride, last = first + grid.cols, u = row / grid.rows;
    const a = [0, 1, 2].map(k => (positions[first * 3 + k] + positions[(first + pairs) * 3 + k]) / 2);
    const b = [0, 1, 2].map(k => (positions[last * 3 + k] + positions[(last + pairs) * 3 + k]) / 2);
    const direction = b.map((value, k) => value - a[k]), length = Math.hypot(...direction);
    if (length < 1e-5) continue;
    const axis = direction.map(value => value / length);
    const center = keepMedialEdge ? a : a.map((value, k) => (value + b[k]) / 2);
    const t = u * 4, section = Math.min(3, Math.floor(t)), fraction = t - section;
    const blend = fraction * fraction * (3 - 2 * fraction);
    const sample = (profile?: number[]) => profile ? profile[section] * (1 - blend) + profile[section + 1] * blend : 1;
    const weight = Math.sin(Math.PI * u) ** 2;
    const s = Math.max(0, Math.min(1, (a[1] - low) / muscleLength));
    const lastStation = (fitted?.length ?? 5) - 1;
    const x = Math.max(0, Math.min(lastStation - .000001, lastStation === 4 ? (s - .1) * 5 : s * lastStation));
    const i = Math.floor(x), v = x - i, q = v * v * (3 - 2 * v);
    const end = Math.min(1, s / .18, (1 - s) / .18);
    const taper = lastStation === 4 ? Math.sin(Math.PI * s) ** 2 : end * end * (3 - 2 * end);
    const fittedDelta = fitted ? taper * (fitted[i] * (1 - q) + fitted[i + 1] * q - 1) : 0;
    for (let column = keepMedialEdge ? 1 : 0; column <= grid.cols; column++) for (let layer = 0; layer < 2; layer++) {
      const offset = (first + column + layer * pairs) * 3;
      const transverse = axis.reduce((sum, value, k) => sum + value * (positions[offset + k] - center[k]), 0);
      const delta = weight * (transverse * (sample(shape.widthProfile) - 1) + bend * .1) + transverse * fittedDelta;
      for (let k = 0; k < 3; k++) positions[offset + k] += axis[k] * delta;
    }
  }
}
