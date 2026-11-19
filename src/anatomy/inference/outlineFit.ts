import type { AnatomyMesh } from '../contracts';
import type { AnatomyParameters } from '../parameters';
import type { Vec3M } from '../landmarks';
import type { SurfaceBVH } from './observationProxy';
import { posedPositions, type normalizePose } from '../pose';
import { fatThickness } from '../fatDistribution';
import { envelopeBasis, envelopeWeight, isCostalEnvelope, shiftedEnvelopeU } from '../muscleEnvelope';

/**
 * Outline fitting: move a superficial muscle's footprint over its deep surface
 * to where the skin shows it, before its thickness is fitted.
 *
 * Each outer-shell vertex reads the thickness the skin allows along the shell
 * normal (skin distance minus the fat prior), exactly as the envelope fit
 * does. A misplaced template asks for thickness where it has none and has
 * thickness where the skin is close, and the smooth 5x3 thickness profile
 * cannot express that. The score is therefore the held-out error left after
 * the same regularized thickness solve; a warp (see `outlineDisplacement`)
 * is searched directly on that score, muscle by muscle.
 */
export const outlineTemplates = ['deltoid_anterior', 'deltoid_middle', 'deltoid_posterior', 'pectoralis_major_clavicular', 'pectoralis_major_sternocostal', 'external_oblique', 'trapezius_upper', 'latissimus_dorsi'] as const;

export function facesObservedEnvelope(id: string | undefined, point: Vec3M, normal: Vec3M) {
  return !id?.startsWith('latissimus_dorsi.') || (normal[2] <= -.45 && point[2] <= -.035);
}

type Pose = ReturnType<typeof normalizePose>;
interface Sample { basis: number[]; coeff: number; target: number; weight: number; validation: boolean }
/** beforeMm/afterMm: held-out thickness error plus half the coverage gap (the search score). */
export interface OutlineFitEntry { coefficients: number[]; beforeMm: number; afterMm: number; samples: number; coverageBeforeMm?: number; coverageAfterMm?: number; lumbarBeforeMm?: number; lumbarAfterMm?: number }

export function outlineKey(mesh: AnatomyMesh) {
  return mesh.anatomyId ? mesh.anatomyId + (isCostalEnvelope(mesh) ? ':costal' : '') : undefined;
}

export function outlineMeshes(meshes: Record<string, AnatomyMesh[]>) {
  return Object.values(meshes).flat().filter(mesh => mesh.shellPairs && mesh.surfaceGrid && mesh.anatomyId &&
    outlineTemplates.some(template => mesh.anatomyId === `${template}.L` || mesh.anatomyId === `${template}.R`));
}

/** The envelope fit's own observations for one muscle (canonical metres, millimetre targets). */
export function outlineSamples(mesh: AnatomyMesh, p: AnatomyParameters, posed: Float32Array, target: SurfaceBVH, f: { lateral: number; vertical: number }): Sample[] {
  const { rows, cols } = mesh.surfaceGrid!, n = mesh.shellPairs!, out: Sample[] = [];
  const point = (index: number): Vec3M => [posed[index * 3] * f.lateral, posed[index * 3 + 1] * f.vertical, posed[index * 3 + 2] * f.lateral];
  const offset = p.definition?.muscles[mesh.anatomyId as keyof NonNullable<typeof p.definition>['muscles']]?.peakOffset;
  for (let vertex = 0; vertex < n; vertex += 2) {
    const u = Math.floor(vertex / (cols + 1)) / rows, v = vertex % (cols + 1) / cols, w = envelopeWeight(mesh, u);
    if (w < .2 || v < .08 || v > .92) continue;
    const outer = point(vertex), inner = point(vertex + n), delta = outer.map((x, k) => x - inner[k]), thickness = Math.hypot(...delta);
    if (thickness < .001 || thickness > .06) continue;
    const normal = delta.map(x => x / thickness) as Vec3M, origin = inner.map((x, k) => x - normal[k] * .006) as Vec3M;
    if (!facesObservedEnvelope(mesh.anatomyId, outer, normal)) continue;
    const hit = target.queryRay(origin, normal, .2);
    if (!hit) continue;
    let skin = hit.distance - .006;
    // Front-facing pectoral samples read the same chest section, as in the envelope fit.
    if (normal[2] > .75 && mesh.anatomyId?.startsWith('pectoralis')) {
      const front = target.queryRay([outer[0], outer[1], .6], [0, 0, -1], .65)?.point[2];
      if (front !== undefined) { const projected = thickness + (front - outer[2]) / normal[2]; if (Math.abs(projected - skin) < .04) skin = .25 * skin + .75 * projected; }
    }
    const available = skin - fatThickness(p, outer) / 1000;
    if (available < -.02 || available > .10) continue;
    const basis = new Array(15).fill(0);
    envelopeBasis(shiftedEnvelopeU(u, offset), v, (j, x) => basis[j] = x);
    out.push({ basis, coeff: thickness * 1000 * w, target: (available - thickness) * 1000, weight: Math.max(.15, Math.min(1, thickness / .008)) * w * w, validation: vertex % 5 === 0 });
  }
  return out;
}

function solve(matrix: number[][], rhs: number[]) {
  const size = rhs.length, a = matrix.map((row, j) => [...row, rhs[j]]);
  for (let j = 0; j < size; j++) {
    let pivot = j; for (let r = j + 1; r < size; r++) if (Math.abs(a[r][j]) > Math.abs(a[pivot][j])) pivot = r;
    [a[j], a[pivot]] = [a[pivot], a[j]];
    const divisor = a[j][j]; if (Math.abs(divisor) < 1e-12) continue;
    for (let k = j; k <= size; k++) a[j][k] /= divisor;
    for (let r = 0; r < size; r++) if (r !== j) { const q = a[r][j]; for (let k = j; k <= size; k++) a[r][k] -= a[j][k] * q; }
  }
  return a.map(row => row[size]);
}

/** Held-out error (mm) after the envelope fit's regularized 5x3 thickness solve. */
export function outlineMisfit(samples: Sample[]) {
  const train = samples.filter(s => !s.validation), held = samples.filter(s => s.validation);
  if (train.length < 12 || !held.length) return Infinity;
  const a = Array.from({ length: 15 }, () => new Array(15).fill(0)), b = new Array(15).fill(0);
  for (const s of train) for (let j = 0; j < 15; j++) {
    const cj = s.basis[j] * s.coeff; b[j] += cj * s.target * s.weight;
    for (let k = 0; k < 15; k++) a[j][k] += cj * s.basis[k] * s.coeff * s.weight;
  }
  const regularity = Math.max(1, train.length * .5);
  for (let j = 0; j < 15; j++) {
    a[j][j] += .2;
    for (const k of [j % 3 < 2 ? j + 1 : -1, j < 12 ? j + 3 : -1]) if (k >= 0) { a[j][j] += regularity; a[k][k] += regularity; a[j][k] -= regularity; a[k][j] -= regularity; }
  }
  const profile = solve(a, b).map(value => Math.max(.35, Math.min(20, 1 + value)));
  return held.reduce((sum, s) => sum + Math.abs(s.target - s.basis.reduce((total, w, i) => total + w * (profile[i] - 1), 0) * s.coeff), 0) / held.length;
}

/** Moves tried by the coordinate search: shift u, shift v, stretch u, stretch v. */
export const outlineMoves: { index: number; step: number }[] = [.12, .06, .03].flatMap(step => [0, 1, 2, 3].flatMap(index => [{ index, step }, { index, step: -step }]));

/** 99th-percentile triangle edge length of one muscle (authored units), to reject tearing warps. */
export function outlineStretch(mesh: AnatomyMesh) {
  const lengths: number[] = [], p = mesh.positions;
  for (let i = 0; i < mesh.indices.length; i += 3) for (let k = 0; k < 3; k++) {
    const a = mesh.indices[i + k] * 3, b = mesh.indices[i + (k + 1) % 3] * 3;
    lengths.push(Math.hypot(p[a] - p[b], p[a + 1] - p[b + 1], p[a + 2] - p[b + 2]));
  }
  lengths.sort((x, y) => x - y);
  return lengths[Math.floor(lengths.length * .99)] ?? 0;
}

/**
 * Coverage: the envelope samples only see skin above the muscle as it is,
 * so a muscle that stops short of a bulge (the upper trapezius below a
 * bodybuilder's neck-shoulder line) is never asked to reach it. Each skin
 * point near the superficial muscles is assigned once to the nearest one;
 * a muscle then pays for every assigned point it leaves far below the skin.
 */
type Outer = { key: string; points: number[] };
function outerPoints(mesh: AnatomyMesh, posed: Float32Array, f: { lateral: number; vertical: number }) {
  const out: number[] = [];
  for (let i = 0; i < mesh.shellPairs! * 3; i += 3) out.push(posed[i] * f.lateral, posed[i + 1] * f.vertical, posed[i + 2] * f.lateral);
  return out;
}
const cellOf = (x: number, y: number, z: number, size: number) => `${Math.floor(x / size)},${Math.floor(y / size)},${Math.floor(z / size)}`;
function nearest(hash: Map<string, number[]>, x: number, y: number, z: number, size: number, limit: number) {
  const c = [x, y, z].map(v => Math.floor(v / size)); let best = limit, owner = -1;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) {
    const list = hash.get(`${c[0] + a},${c[1] + b},${c[2] + d}`); if (!list) continue;
    for (let i = 0; i < list.length; i += 4) { const e = Math.hypot(list[i] - x, list[i + 1] - y, list[i + 2] - z); if (e < best) { best = e; owner = list[i + 3]; } }
  }
  return { distance: best, owner };
}
/** Skin points (with their fat prior) assigned to each outline muscle key. */
export function coverageSetup(meshes: AnatomyMesh[], p: AnatomyParameters, pose: Pose, target: SurfaceBVH, f: { lateral: number; vertical: number }) {
  const size = .05, hash = new Map<string, number[]>(), outers: Outer[] = meshes.map(mesh => ({ key: outlineKey(mesh)!, points: outerPoints(mesh, posedPositions(mesh, p, pose), f) }));
  outers.forEach((outer, owner) => {
    for (let i = 0; i < outer.points.length; i += 3) {
      const [x,y,z] = [outer.points[i],outer.points[i+1],outer.points[i+2]];
      if (outer.key.startsWith('latissimus_dorsi.') && z > -.035) continue;
      const k = cellOf(x,y,z,size);
      (hash.get(k) ?? hash.set(k, []).get(k)!).push(x,y,z,owner);
    }
  });
  const skin = target.vertices(), assigned = new Map<string, number[]>();
  for (let i = 0; i < skin.length; i += 3) {
    const x = skin[i], y = skin[i + 1], z = skin[i + 2];
    if (y < .9 || y > 1.7) continue;
    const { distance, owner } = nearest(hash, x, y, z, size, .05);
    if (owner < 0 || distance < .002) continue;
    if (outers[owner].key.startsWith('latissimus_dorsi.') && z > -.035) continue;
    const list = assigned.get(outers[owner].key) ?? assigned.set(outers[owner].key, []).get(outers[owner].key)!;
    list.push(x, y, z, fatThickness(p, [x, y, z]) / 1000);
  }
  return assigned;
}
/** Mean depth (mm) by which this muscle's assigned skin lies beyond muscle plus fat. */
export function coverageGaps(mesh: AnatomyMesh, posed: Float32Array, f: { lateral: number; vertical: number }, ...sets: (number[] | undefined)[]) {
  if (!sets.some(points => points?.length)) return sets.map(() => 0);
  const size = .04, hash = new Map<string, number[]>(), outer = outerPoints(mesh, posed, f);
  for (let i = 0; i < outer.length; i += 3) { const k = cellOf(outer[i], outer[i + 1], outer[i + 2], size); (hash.get(k) ?? hash.set(k, []).get(k)!).push(outer[i], outer[i + 1], outer[i + 2], 0); }
  return sets.map(points => {
    if (!points?.length) return 0;
    let sum = 0;
    for (let i = 0; i < points.length; i += 4) sum += Math.max(0, nearest(hash, points[i], points[i + 1], points[i + 2], size, .08).distance - points[i + 3] - .004);
    return sum / (points.length / 4) * 1000;
  });
}
