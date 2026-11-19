import type { AnatomyParameters } from './parameters';
import { defaults } from './parameters';

/** 3D Vector in meters [x, y, z]. +X is anatomical right, -X is anatomical left, +Y is up, +Z is forward. */
export type Vec3M = [number, number, number];

export type LandmarkName =
  | 'headTop'
  | 'head'
  | 'sellion'
  | 'inion'
  | 'c7'
  | 'jugularNotch'
  | 'xiphoid'
  | 't12'
  | 'waist'
  | 'pubis'
  | 'sacrum'
  | 'coccyx'
  // Bilateral pelvis & hips
  | 'asis_L'
  | 'asis_R'
  | 'psis_L'
  | 'psis_R'
  | 'crest_L'
  | 'crest_R'
  | 'ischialTuberosity_L'
  | 'ischialTuberosity_R'
  | 'hipJoint_L'
  | 'hipJoint_R'
  | 'greaterTrochanter_L'
  | 'greaterTrochanter_R'
  // Bilateral thorax & shoulder girdle
  | 'clavicleMedial_L'
  | 'clavicleMedial_R'
  | 'acromion_L'
  | 'acromion_R'
  | 'shoulder_L'
  | 'shoulder_R'
  | 'scapulaInf_L'
  | 'scapulaInf_R'
  | 'rib10_L'
  | 'rib10_R'
  // Bilateral upper limbs
  | 'elbow_L'
  | 'elbow_R'
  | 'wrist_L'
  | 'wrist_R'
  | 'handTip_L'
  | 'handTip_R'
  // Bilateral lower limbs
  | 'knee_L'
  | 'knee_R'
  | 'patella_L'
  | 'patella_R'
  | 'ankle_L'
  | 'ankle_R'
  | 'heel_L'
  | 'heel_R'
  | 'toes_L'
  | 'toes_R'
  | 'toeTip_L'
  | 'toeTip_R';

export type Landmarks = Record<LandmarkName, Vec3M>;

/** Canonical standard adult humanoid landmarks (1.80m tall, T-pose, metric). */
export const CANONICAL_LANDMARKS: Landmarks = {
  headTop: [0, 1.800, -0.016],
  head: [0, 1.568, -0.016],
  sellion: [0, 1.620, 0.082],
  inion: [0, 1.615, -0.088],
  c7: [0, 1.485, -0.075],
  jugularNotch: [0, 1.425, 0.052],
  xiphoid: [0, 1.215, 0.088],
  t12: [0, 1.120, -0.045],
  waist: [0, 1.045, 0.012],
  pubis: [0, 0.880, 0.084],
  sacrum: [0, 0.945, -0.072],
  coccyx: [0, 0.825, -0.065],

  // Left side (-X)
  asis_L: [-0.125, 0.965, 0.062],
  asis_R: [0.125, 0.965, 0.062],
  psis_L: [-0.070, 0.985, -0.078],
  psis_R: [0.070, 0.985, -0.078],
  crest_L: [-0.145, 1.025, -0.010],
  crest_R: [0.145, 1.025, -0.010],
  ischialTuberosity_L: [-0.065, 0.785, -0.058],
  ischialTuberosity_R: [0.065, 0.785, -0.058],
  hipJoint_L: [-0.092, 0.916, -0.019],
  hipJoint_R: [0.092, 0.916, -0.019],
  greaterTrochanter_L: [-0.170, 0.885, -0.022],
  greaterTrochanter_R: [0.170, 0.885, -0.022],

  clavicleMedial_L: [-0.025, 1.430, 0.055],
  clavicleMedial_R: [0.025, 1.430, 0.055],
  acromion_L: [-0.195, 1.455, -0.025],
  acromion_R: [0.195, 1.455, -0.025],
  shoulder_L: [-0.205, 1.440, -0.035],
  shoulder_R: [0.205, 1.440, -0.035],
  scapulaInf_L: [-0.120, 1.250, -0.085],
  scapulaInf_R: [0.120, 1.250, -0.085],
  rib10_L: [-0.135, 1.110, 0.045],
  rib10_R: [0.135, 1.110, 0.045],

  elbow_L: [-0.470, 1.440, -0.038],
  elbow_R: [0.470, 1.440, -0.038],
  wrist_L: [-0.740, 1.440, -0.035],
  wrist_R: [0.740, 1.440, -0.035],
  handTip_L: [-0.940, 1.440, -0.035],
  handTip_R: [0.940, 1.440, -0.035],

  knee_L: [-0.092, 0.515, 0.005],
  knee_R: [0.092, 0.515, 0.005],
  patella_L: [-0.092, 0.525, 0.058],
  patella_R: [0.092, 0.525, 0.058],
  ankle_L: [-0.092, 0.095, -0.025],
  ankle_R: [0.092, 0.095, -0.025],
  heel_L: [-0.092, 0.065, -0.095],
  heel_R: [0.092, 0.065, -0.095],
  toes_L: [-0.092, 0.025, 0.115],
  toes_R: [0.092, 0.025, 0.115],
  toeTip_L: [-0.092, 0.020, 0.185],
  toeTip_R: [0.092, 0.020, 0.185],
};

/** Compute the landmark set for the parametric mannequin at given parameters. */
export function getMannequinLandmarks(p: AnatomyParameters = defaults): Landmarks {
  // Convert internal 10 cm units from geometry.ts into meters (scale 0.10)
  const shoulder = p.shoulderWidth / 20 - 0.57;
  const asis = Math.max(0.65, (p.asisDistance / 20 + p.flare / 10 * 0.65) * p.inguinalOpening);
  const crest = 9.8 + p.asisHeight / 10;
  const pubis = Math.max(7.45, Math.min(9.05, Math.min(crest - 0.12 - 0.55, crest - 0.12 - p.inguinalHeight / 10 + p.pubisHeight / 10)));

  const hipX = 0.82 + (p.pelvisWidth - 35) / 60 + (asis - 1.3) * 0.16;
  const hipY = 8.85 + p.asisHeight / 40;
  const hipZ = -0.04;

  const kneeY = 4.95;
  const ankleY = 0.93;

  return {
    headTop: [0, 1.820, -0.016],
    head: [0, 1.585, -0.016],
    sellion: [0, 1.635, 0.082],
    inion: [0, 1.625, -0.088],
    c7: [0, 1.495, -0.075],
    jugularNotch: [0, 1.425, 0.052],
    xiphoid: [0, 1.220, 0.088],
    t12: [0, 1.125, -0.045],
    waist: [0, 1.050, 0.012],
    pubis: [0, pubis * 0.1, 0.084],
    sacrum: [0, (crest - 0.35) * 0.1, -0.072],
    coccyx: [0, (pubis - 0.55) * 0.1, -0.065],

    asis_L: [-asis * 0.1, (crest - 0.12) * 0.1, 0.062],
    asis_R: [asis * 0.1, (crest - 0.12) * 0.1, 0.062],
    psis_L: [-0.070, (crest - 0.05) * 0.1, -0.078],
    psis_R: [0.070, (crest - 0.05) * 0.1, -0.078],
    crest_L: [-(asis + p.flare / 10) * 0.1, crest * 0.1, -0.010],
    crest_R: [(asis + p.flare / 10) * 0.1, crest * 0.1, -0.010],
    ischialTuberosity_L: [-0.065, (hipY - 1.0) * 0.1, -0.058],
    ischialTuberosity_R: [0.065, (hipY - 1.0) * 0.1, -0.058],
    hipJoint_L: [-hipX * 0.1, hipY * 0.1, hipZ * 0.1],
    hipJoint_R: [hipX * 0.1, hipY * 0.1, hipZ * 0.1],
    greaterTrochanter_L: [-(hipX + 0.5) * 0.1, (hipY - 0.3) * 0.1, hipZ * 0.1],
    greaterTrochanter_R: [(hipX + 0.5) * 0.1, (hipY - 0.3) * 0.1, hipZ * 0.1],

    clavicleMedial_L: [-0.025, 1.430, 0.055],
    clavicleMedial_R: [0.025, 1.430, 0.055],
    acromion_L: [-shoulder * 0.1, 14.15 * 0.1, -0.025],
    acromion_R: [shoulder * 0.1, 14.15 * 0.1, -0.025],
    shoulder_L: [-shoulder * 0.1, 13.95 * 0.1, -0.030],
    shoulder_R: [shoulder * 0.1, 13.95 * 0.1, -0.030],
    scapulaInf_L: [-0.120, 1.250, -0.085],
    scapulaInf_R: [0.120, 1.250, -0.085],
    rib10_L: [-0.135, 1.110, 0.045],
    rib10_R: [0.135, 1.110, 0.045],

    elbow_L: [-(shoulder + 0.95) * 0.1, 11.15 * 0.1, 0.015 * 0.1],
    elbow_R: [(shoulder + 0.95) * 0.1, 11.15 * 0.1, 0.015 * 0.1],
    wrist_L: [-(shoulder + 1.30) * 0.1, 8.86 * 0.1, 0.030 * 0.1],
    wrist_R: [(shoulder + 1.30) * 0.1, 8.86 * 0.1, 0.030 * 0.1],
    handTip_L: [-(shoulder + 1.50) * 0.1, 6.80 * 0.1, 0.035 * 0.1],
    handTip_R: [(shoulder + 1.50) * 0.1, 6.80 * 0.1, 0.035 * 0.1],

    knee_L: [-0.86 * 0.1, kneeY * 0.1, 0.045 * 0.1],
    knee_R: [0.86 * 0.1, kneeY * 0.1, 0.045 * 0.1],
    patella_L: [-0.86 * 0.1, (kneeY + 0.1) * 0.1, 0.058],
    patella_R: [0.86 * 0.1, (kneeY + 0.1) * 0.1, 0.058],
    ankle_L: [-0.90 * 0.1, ankleY * 0.1, -0.040 * 0.1],
    ankle_R: [0.90 * 0.1, ankleY * 0.1, -0.040 * 0.1],
    heel_L: [-0.90 * 0.1, (ankleY - 0.3) * 0.1, -0.095],
    heel_R: [0.90 * 0.1, (ankleY - 0.3) * 0.1, -0.095],
    toes_L: [-0.90 * 0.1, 0.025, 0.115],
    toes_R: [0.90 * 0.1, 0.025, 0.115],
    toeTip_L: [-0.90 * 0.1, 0.020, 0.185],
    toeTip_R: [0.90 * 0.1, 0.020, 0.185],
  };
}
