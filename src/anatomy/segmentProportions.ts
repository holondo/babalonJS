import type { AnatomyParameters } from './parameters';
import type { AnatomyMesh } from './contracts';
import type { Vec3M } from './landmarks';

export type BoneLengthKey = `${'upperArm' | 'forearm' | 'thigh' | 'shin'}_${'L' | 'R'}`;
export type BoneLengths = Partial<Record<BoneLengthKey, number>>;
export function normalizeBoneLengths(input: unknown): BoneLengths | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const out: BoneLengths = {};
  for (const side of ['L', 'R'] as const) for (const bone of ['upperArm', 'forearm', 'thigh', 'shin'] as const) {
    const key = `${bone}_${side}` as const, value = (input as Record<string, unknown>)[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 8 && value <= 70) out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t);
};
/** Authored neutral joints, shared with the pose preview. Units are 10 cm. */
export function proportionJoints(p: AnatomyParameters, side: number, leg: boolean): Vec3M[] {
  const shift = leg ? (p.pelvisWidth - 35) / 45 + (p.asisDistance - 26) / 70 + p.flare * .045 : (p.shoulderWidth - 43) / 20;
  return leg ? [[side * (1.09389 + shift), 9.37992, -.15776], [side * (1.02998 + shift * .45), 5.11275, .18685], [side * .96658, .75732, .06891]] :
    [[side * (1.87532 + shift), 14.02683, .09386], [side * (2.67656 + shift), 11.62313, .0739], [side * (3.02225 + shift), 9.04309, .0741]];
}
/** Axial stretch only: keep bone radius and carry the distal joint/hand/foot with its parent. */
export function proportionChain(p: AnatomyParameters, side: number, leg: boolean) {
  const source = proportionJoints(p, side, leg), target = [source[0].slice() as Vec3M];
  for (let i = 0; i < 2; i++) {
    const name = (leg ? ['thigh', 'shin'] : ['upperArm', 'forearm'])[i];
    const key = `${name}_${side < 0 ? 'L' : 'R'}` as BoneLengthKey;
    const d = source[i+1].map((x, k) => x - source[i][k]), authoredCm = Math.hypot(d[0], d[1] * p.height / 175, d[2]) * 10;
    const ratio = p.boneLengthsCm?.[key] ? p.boneLengthsCm[key]! / authoredCm : 1;
    target.push(target[i].map((x, k) => x + d[k] * ratio) as Vec3M);
  }
  return { source, target };
}
export function proportionPoint(p: AnatomyParameters, point: Vec3M, leg: boolean, influence = 1): Vec3M {
  if (!p.boneLengthsCm || !influence) return point;
  return warpChain(point, proportionChain(p, point[0] < 0 ? -1 : 1, leg), influence);
}
function warpChain(point: Vec3M, {source, target}: ReturnType<typeof proportionChain>, influence: number): Vec3M {
  // Piecewise linear displacement is continuous at the elbow/knee and constant distal to the wrist/ankle.
  const i = point[1] >= source[1][1] ? 0 : 1;
  const t = Math.max(0, Math.min(1, (source[i][1] - point[1]) / (source[i][1] - source[i+1][1])));
  return point.map((x, k) => x + influence * ((target[i][k] - source[i][k]) * (1-t) + (target[i+1][k] - source[i+1][k]) * t)) as Vec3M;
}
export function isPelvicBone(mesh: AnatomyMesh) {
  return /^(hip_bone|pubic_|ischial_|ilium_|iliac_crest_|acetabular_rim_|sacrum|coccyx)/.test(mesh.anatomicalName ?? '');
}

export function applyBoneProportions(p: AnatomyParameters, mesh: AnatomyMesh) {
  if (!p.boneLengthsCm || isPelvicBone(mesh)) return;
  const pos = mesh.positions;
  const arms = [-1, 1].map(side => proportionChain(p, side, false)), legs = [-1, 1].map(side => proportionChain(p, side, true));
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i+1], j = i / 3 * 4;
    const arm = mesh.rig ? Math.min(1, mesh.rig[j] + mesh.rig[j+2]) : mesh.rigRegion === 'arm' || mesh.rigRegion === 'hand' ? 1 : 0;
    const leg = mesh.rig ? mesh.rig[j+1] : mesh.rigRegion === 'leg' ? 1 : mesh.rigRegion === 'torso' ? 0 : (1-arm) * (1-smooth(8.5, 9.38, y)) * smooth(.3, .75, Math.abs(x));
    let point: Vec3M = [x, y, pos[i+2]];
    const side = x < 0 ? 0 : 1;
    if (arm) point = warpChain(point, arms[side], arm);
    if (leg) point = warpChain(point, legs[side], leg);
    pos.set(point, i);
  }
}
