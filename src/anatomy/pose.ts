import { signedMeshVolume } from './algorithms/loft';
import { armBend, fitArmRadius, referencePoseMapper } from './referencePose';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { SurfaceBVH } from './inference/observationProxy';
import { fatThickness } from './fatDistribution';
import { abdominalDepthAt, abdominalFlankAt, armCoveringAt, navelDepthAt, pectoralDepthAt, sternumSurfaceAt, surfaceFitPoint } from './surfaceFit';
import { applyNavelDetail, fittedNavelFor, flattenAuthoredNavel, offsetNavelCavity, softenNavelTip } from './skinFeatures';
import { isPelvicBone, proportionChain, proportionPoint } from './segmentProportions';
import type { AnatomyParameters } from './parameters';
import type { AnatomyMesh } from './contracts';
import { pelvicPoint } from './regions/pelvis';
import { pectoralCoveringBasis, deltopectoralCoveringBasis } from './pectoralContour';

const jointAxes = [
  { suffix: 'Flexion', label: 'flexion', min: -65, max: 65, unit: '°' },
  { suffix: 'Turn', label: 'turn', min: -45, max: 45, unit: '°' },
  { suffix: 'Tilt', label: 'side tilt', min: -40, max: 40, unit: '°' },
  { suffix: 'ShiftX', label: 'left / right', min: -3, max: 3, unit: 'cm' },
  { suffix: 'ShiftY', label: 'up / down', min: -3, max: 3, unit: 'cm' },
  { suffix: 'ShiftZ', label: 'forward / back', min: -3, max: 3, unit: 'cm' },
] as const;

type LimbJoint = 'Shoulder' | 'Elbow' | 'Wrist' | 'Hip' | 'Knee' | 'Ankle';

const additionalJointControls = (['Shoulder', 'Elbow', 'Wrist', 'Hip', 'Knee', 'Ankle'] as const).flatMap(joint =>
  (['left', 'right'] as const).flatMap(side => jointAxes.filter(axis => {
    if (axis.unit === 'cm' || joint === 'Wrist' || joint === 'Ankle') return true;
    if (axis.suffix === 'Turn') return joint !== 'Shoulder';
    return axis.suffix === 'Tilt' && (joint === 'Elbow' || joint === 'Knee');
  }).map(axis => ({
    ...axis,
    key: `${side}${joint}${axis.suffix}` as const,
    label: `${side === 'left' ? 'Left' : 'Right'} ${joint.toLowerCase()} ${axis.label}`,
  }))));

/** Kinematic preview from FORMA v5; these are visual controls, not physiological limits. */
export const poseControls = [
  { key: 'rightArmAbduction', label: 'Right arm abduction', min: 0, max: 160, alias: 'rArm' },
  { key: 'leftArmAbduction', label: 'Left arm abduction', min: 0, max: 160, alias: 'lArm' },
  { key: 'rightArmFlexion', label: 'Right arm flexion', min: -105, max: 100, alias: 'rForward' },
  { key: 'leftArmFlexion', label: 'Left arm flexion', min: -105, max: 100, alias: 'lForward' },
  { key: 'rightArmTwist', label: 'Right upper arm twist', min: -90, max: 90, alias: 'rArmTwist' },
  { key: 'leftArmTwist', label: 'Left upper arm twist', min: -90, max: 90, alias: 'lArmTwist' },
  { key: 'rightElbowFlexion', label: 'Right elbow flexion', min: -20, max: 145, alias: 'rElbow' },
  { key: 'leftElbowFlexion', label: 'Left elbow flexion', min: -20, max: 145, alias: 'lElbow' },
  { key: 'rightElbowPlane', label: 'Right elbow bend plane', min: -90, max: 90, alias: 'rElbowPlane' },
  { key: 'leftElbowPlane', label: 'Left elbow bend plane', min: -90, max: 90, alias: 'lElbowPlane' },
  { key: 'rightHipAbduction', label: 'Right hip abduction', min: -30, max: 60, alias: 'rHipSide' },
  { key: 'leftHipAbduction', label: 'Left hip abduction', min: -30, max: 60, alias: 'lHipSide' },
  { key: 'rightHipFlexion', label: 'Right hip flexion', min: -40, max: 125, alias: 'rHip' },
  { key: 'leftHipFlexion', label: 'Left hip flexion', min: -40, max: 125, alias: 'lHip' },
  { key: 'rightKneeFlexion', label: 'Right knee flexion', min: 0, max: 145, alias: 'rKnee' },
  { key: 'leftKneeFlexion', label: 'Left knee flexion', min: 0, max: 145, alias: 'lKnee' },
  { key: 'rightKneePlane', label: 'Right knee bend plane', min: -60, max: 60, alias: 'rKneePlane' },
  { key: 'leftKneePlane', label: 'Left knee bend plane', min: -60, max: 60, alias: 'lKneePlane' },
  { key: 'trunkRotation', label: 'Trunk rotation', min: -45, max: 45, alias: 'spine' },
  { key: 'trunkLean', label: 'Trunk lean', min: -35, max: 45, alias: 'trunkLean' },
  { key: 'trunkSideBend', label: 'Trunk side bend', min: -30, max: 30, alias: 'trunkSideBend' },
  { key: 'trunkShiftX', label: 'Trunk left / right', min: -12, max: 12, alias: 'trunkShiftX', unit: 'cm' },
  { key: 'trunkShiftY', label: 'Trunk up / down', min: -8, max: 8, alias: 'trunkShiftY', unit: 'cm' },
  { key: 'trunkShiftZ', label: 'Trunk forward / back', min: -12, max: 12, alias: 'trunkShiftZ', unit: 'cm' },
  { key: 'pelvisTurn', label: 'Pelvis turn', min: -45, max: 45, alias: 'pelvisTurn' },
  { key: 'pelvisTilt', label: 'Pelvis forward / backward tilt', min: -35, max: 35, alias: 'pelvisTilt' },
  { key: 'pelvisSideTilt', label: 'Pelvis side tilt', min: -30, max: 30, alias: 'pelvisSideTilt' },
  { key: 'pelvisShiftX', label: 'Pelvis left / right', min: -12, max: 12, alias: 'pelvisShiftX', unit: 'cm' },
  { key: 'pelvisShiftY', label: 'Pelvis up / down', min: -10, max: 10, alias: 'pelvisShiftY', unit: 'cm' },
  { key: 'pelvisShiftZ', label: 'Pelvis forward / back', min: -12, max: 12, alias: 'pelvisShiftZ', unit: 'cm' },
  { key: 'lumbarTurn', label: 'Lumbar turn', min: -35, max: 35, alias: 'lumbarTurn' },
  { key: 'lumbarBend', label: 'Lumbar forward / backward bend', min: -35, max: 35, alias: 'lumbarBend' },
  { key: 'lumbarSideBend', label: 'Lumbar side bend', min: -30, max: 30, alias: 'lumbarSideBend' },
  { key: 'lumbarShiftX', label: 'Lumbar left / right', min: -6, max: 6, alias: 'lumbarShiftX', unit: 'cm' },
  { key: 'lumbarShiftY', label: 'Lumbar up / down', min: -5, max: 5, alias: 'lumbarShiftY', unit: 'cm' },
  { key: 'lumbarShiftZ', label: 'Lumbar forward / back', min: -6, max: 6, alias: 'lumbarShiftZ', unit: 'cm' },
  { key: 'thoracicTurn', label: 'Thoracic turn', min: -35, max: 35, alias: 'thoracicTurn' },
  { key: 'thoracicBend', label: 'Thoracic forward / backward bend', min: -35, max: 35, alias: 'thoracicBend' },
  { key: 'thoracicSideBend', label: 'Thoracic side bend', min: -30, max: 30, alias: 'thoracicSideBend' },
  { key: 'thoracicShiftX', label: 'Thoracic left / right', min: -6, max: 6, alias: 'thoracicShiftX', unit: 'cm' },
  { key: 'thoracicShiftY', label: 'Thoracic up / down', min: -5, max: 5, alias: 'thoracicShiftY', unit: 'cm' },
  { key: 'thoracicShiftZ', label: 'Thoracic forward / back', min: -6, max: 6, alias: 'thoracicShiftZ', unit: 'cm' },
  { key: 'headTurn', label: 'Head turn', min: -65, max: 65, alias: 'headTurn' },
  { key: 'headTilt', label: 'Head tilt', min: -35, max: 35, alias: 'neck' },
  { key: 'headFlexion', label: 'Head forward / backward tilt', min: -40, max: 45, alias: 'headFlexion' },
  { key: 'headShiftX', label: 'Head left / right', min: -4, max: 4, alias: 'headShiftX', unit: 'cm' },
  { key: 'headShiftY', label: 'Head up / down', min: -3, max: 3, alias: 'headShiftY', unit: 'cm' },
  { key: 'headShiftZ', label: 'Head forward / back', min: -5, max: 5, alias: 'headShiftZ', unit: 'cm' },
  { key: 'neckTurn', label: 'Neck turn', min: -30, max: 30, alias: 'neckTurn' },
  { key: 'neckTilt', label: 'Neck side tilt', min: -25, max: 25, alias: 'neckTilt' },
  { key: 'neckFlexion', label: 'Neck forward / backward tilt', min: -30, max: 30, alias: 'neckFlexion' },
  { key: 'neckShiftX', label: 'Neck left / right', min: -3, max: 3, alias: 'neckShiftX', unit: 'cm' },
  { key: 'neckShiftY', label: 'Neck up / down', min: -3, max: 3, alias: 'neckShiftY', unit: 'cm' },
  { key: 'neckShiftZ', label: 'Neck forward / back', min: -4, max: 4, alias: 'neckShiftZ', unit: 'cm' },
  ...additionalJointControls,
] as const;
export type AnatomyPoseKey = typeof poseControls[number]['key'];
export type AnatomyPose = Record<AnatomyPoseKey, number>;
export function normalizePose(input: unknown): AnatomyPose {
  const values = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  return Object.fromEntries(poseControls.map(c => {
    const value = values[c.key] ?? ('alias' in c ? values[c.alias] : undefined);
    return [c.key, typeof value === 'number' && Number.isFinite(value) && value !== 0 ? Math.max(c.min, Math.min(c.max, value)) : 0];
  })) as AnatomyPose;
}
export const anatomyPosePresets: { label: string; values: Partial<AnatomyPose> }[] = [
  { label: 'Neutral', values: {} },
  { label: 'Relaxed', values: { leftArmFlexion: 5, rightArmFlexion: 5, leftElbowFlexion: 11, rightElbowFlexion: 11,
    leftKneeFlexion: 4, rightKneeFlexion: 4 } },
  { label: 'T-pose', values: { rightArmAbduction: 77, leftArmAbduction: 77 } },
  { label: 'Arms raised', values: { rightArmAbduction: 122, leftArmAbduction: 122, rightElbowFlexion: -7, leftElbowFlexion: -7 } },
  { label: 'Wave', values: { rightArmAbduction: 102, rightElbowFlexion: 105, leftArmAbduction: 8 } },
  { label: 'Pointing', values: { rightArmFlexion: 86, rightArmAbduction: 6, rightElbowFlexion: 8, headTurn: -12 } },
  { label: 'Elbows bent', values: { rightElbowFlexion: 125, leftElbowFlexion: 125 } },
  { label: 'Stride', values: { rightHipFlexion: 30, leftHipFlexion: -24, rightKneeFlexion: 22, leftKneeFlexion: 12, rightArmAbduction: 12, leftArmAbduction: 15 } },
  { label: 'Knee bent', values: { rightHipFlexion: 24, rightKneeFlexion: 112 } },
  { label: 'Squat', values: { rightHipFlexion: 74, leftHipFlexion: 74, rightKneeFlexion: 110, leftKneeFlexion: 110 } },
  { label: 'Sitting', values: { rightHipFlexion: 86, leftHipFlexion: 86, rightKneeFlexion: 88, leftKneeFlexion: 88, trunkLean: 8 } },
  { label: 'Running', values: { rightHipFlexion: 55, leftHipFlexion: -22, rightKneeFlexion: 32, leftKneeFlexion: 108, rightArmFlexion: -28, leftArmFlexion: 45, rightElbowFlexion: 70, leftElbowFlexion: 78, trunkLean: 12 } },
  { label: 'Guard up', values: { leftArmFlexion: 31, rightArmFlexion: 22, leftArmAbduction: 19, rightArmAbduction: 15,
    leftElbowFlexion: 117, rightElbowFlexion: 125, leftHipFlexion: 12, rightHipFlexion: -9,
    leftKneeFlexion: 25, rightKneeFlexion: 30, pelvisTurn: -14, thoracicTurn: 21, headTurn: -7 } },
  { label: 'Reach overhead', values: { rightArmAbduction: 143, rightArmFlexion: 28, rightElbowFlexion: 14,
    leftArmAbduction: 11, lumbarSideBend: -7, thoracicSideBend: -13, neckFlexion: 8, headTurn: 17, headTilt: 12 } },
  { label: 'Look over shoulder', values: { pelvisTurn: -8, lumbarTurn: 10, thoracicTurn: 22,
    neckTurn: 14, headTurn: 23, leftArmAbduction: 10, rightArmAbduction: 14, rightElbowFlexion: 17 } },
  { label: 'Hands on hips', values: { leftArmAbduction: 20, rightArmAbduction: 20, leftArmFlexion: -14, rightArmFlexion: -14,
    leftElbowFlexion: 86, rightElbowFlexion: 86, leftElbowPlane: 18, rightElbowPlane: 18,
    leftWristFlexion: 15, rightWristFlexion: 15, leftHipAbduction: 8, rightHipAbduction: 8 } },
  { label: 'Thinking', values: { rightArmFlexion: 35, rightArmAbduction: 12, rightElbowFlexion: 135, rightElbowPlane: 13,
    leftArmFlexion: 20, leftArmAbduction: 10, leftElbowFlexion: 82, leftElbowPlane: 28,
    thoracicTurn: 7, neckFlexion: 8, headTilt: -8, headTurn: -13 } },
  { label: 'Walking', values: { leftHipFlexion: 28, rightHipFlexion: -18, leftKneeFlexion: 10, rightKneeFlexion: 25,
    leftAnkleFlexion: 8, rightAnkleFlexion: -15, leftArmFlexion: -13, rightArmFlexion: 20,
    leftElbowFlexion: 15, rightElbowFlexion: 23, pelvisTurn: -8, thoracicTurn: 13 } },
  { label: 'Jumping', values: { leftHipFlexion: 34, rightHipFlexion: 25, leftKneeFlexion: 58, rightKneeFlexion: 48,
    leftAnkleFlexion: -20, rightAnkleFlexion: -16, leftArmAbduction: 84, rightArmAbduction: 97,
    leftArmFlexion: 35, rightArmFlexion: 30, leftElbowFlexion: 28, rightElbowFlexion: 23, lumbarBend: -7 } },
  { label: 'Crouching', values: { leftHipFlexion: 80, rightHipFlexion: 71, leftKneeFlexion: 113, rightKneeFlexion: 103,
    leftHipAbduction: 16, rightHipAbduction: 12, leftAnkleFlexion: 15, rightAnkleFlexion: 12,
    trunkLean: 21, thoracicBend: 10, leftArmFlexion: 33, rightArmFlexion: 27, leftElbowFlexion: 42, rightElbowFlexion: 48 } },
  { label: 'Kneeling', values: { leftHipFlexion: 78, rightHipFlexion: 8, leftKneeFlexion: 93, rightKneeFlexion: 102,
    leftHipAbduction: 8, rightHipAbduction: 7, rightAnkleFlexion: -30, pelvisTurn: 8, trunkLean: 12,
    leftArmFlexion: 17, leftElbowFlexion: 34, rightElbowFlexion: 18 } },
  { label: 'Dancing', values: { leftArmAbduction: 27, rightArmAbduction: 16, leftArmFlexion: 28, rightArmFlexion: 20,
    leftElbowFlexion: 59, rightElbowFlexion: 72, leftElbowPlane: 30, rightElbowPlane: 24,
    leftHipFlexion: 8, rightHipFlexion: -5, leftHipAbduction: 9, rightHipAbduction: 6,
    leftKneeFlexion: 12, rightKneeFlexion: 14, pelvisTurn: 9, pelvisSideTilt: 4,
    thoracicTurn: -13, thoracicSideBend: -5, headTurn: 10 } },
  { label: 'Punch', values: { rightArmFlexion: 89, rightArmAbduction: 13, rightElbowFlexion: 13, rightWristFlexion: -8,
    leftArmFlexion: 24, leftArmAbduction: 17, leftElbowFlexion: 111, leftElbowPlane: 22,
    leftHipFlexion: 19, rightHipFlexion: -15, leftKneeFlexion: 19, rightKneeFlexion: 12,
    pelvisTurn: -16, lumbarTurn: -9, thoracicTurn: -22, headTurn: 21 } },
  { label: 'Twist', values: { trunkRotation: 35, rightArmAbduction: 42, leftArmAbduction: 40 } },
];
export function mirrorAnatomyPose(input: AnatomyPose): AnatomyPose {
  const result = { ...input };
  for (const c of poseControls) if (c.key.startsWith('right')) {
    const left = c.key.replace('right', 'left') as AnatomyPoseKey;
    const sign = /ShiftX$|(?:Elbow|Wrist|Hip|Knee|Ankle)Turn$|(?:Wrist|Knee|Ankle)Tilt$/.test(c.key) ? -1 : 1;
    result[c.key] = sign * input[left]; result[left] = sign * input[c.key];
  }
  result.trunkRotation = -input.trunkRotation; result.headTilt = -input.headTilt;
  result.trunkSideBend = -input.trunkSideBend;
  result.trunkShiftX = -input.trunkShiftX;
  result.pelvisTurn = -input.pelvisTurn;
  result.pelvisSideTilt = -input.pelvisSideTilt;
  result.pelvisShiftX = -input.pelvisShiftX;
  for (const region of ['lumbar', 'thoracic'] as const) {
    result[`${region}Turn`] = -input[`${region}Turn`];
    result[`${region}SideBend`] = -input[`${region}SideBend`];
    result[`${region}ShiftX`] = -input[`${region}ShiftX`];
  }
  result.headTurn = -input.headTurn;
  result.headShiftX = -input.headShiftX;
  result.neckTurn = -input.neckTurn;
  result.neckTilt = -input.neckTilt;
  result.neckShiftX = -input.neckShiftX;
  return result;
}
function smooth(a: number, b: number, value: number) {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a))); return t * t * (3 - 2 * t);
}
function axillaryArmWeight(mesh: AnatomyMesh, vertex: number, fallback: number) {
  const name = mesh.anatomicalName ?? '';
  if (/^(serratus_anterior_|(?:external|internal)_intercostals_)/.test(name)) return 0;
  if (name.startsWith('teres_major_') && mesh.armBlend && mesh.longitudinal)
    return smooth(...mesh.armBlend, mesh.longitudinal[vertex]);
  return fallback;
}
/** Everything {@link referencePositions} reads from the parameters, as one comparable string (about
 * 2 kB for a fitted body). Not cached by object: `AnatomyBody.edit` changes parameters in place. */
export function referenceStageKey(parameters: AnatomyParameters): string {
  const muscles = parameters.definition?.muscles, contour = (side: 'L' | 'R') => {
    const c = muscles?.[`pectoralis_major_sternocostal.${side}`]?.pectoralContour;
    return c && [c.covering, c.transitionCovering];
  };
  return JSON.stringify([parameters.height, parameters.fat, parameters.fatDistribution, parameters.referencePose, parameters.skinFit,
    !!fittedNavelFor(parameters), contour('L'), contour('R')]);
}
function referenceCalibration(parameters: AnatomyParameters) {
  const reference=referencePoseMapper(parameters.referencePose),lateral=18/parameters.height,vertical=1.8/17.5;
  const calibrate=(point:number[],kind:'arm'|'leg',side:number)=>{const p=reference([point[0]*lateral,point[1]*vertical,point[2]*lateral],kind,side);return [p[0]/lateral,p[1]/vertical,p[2]/lateral];};
  return { calibrate, lateral, vertical };
}

/** Relax the folds where bent arm segments meet the procedural skin. */
function relaxPosedSkin(mesh: AnatomyMesh, positions: Float32Array, parameters: AnatomyParameters, lateral: number, vertical: number) {
  const arms = parameters.referencePose?.chains.filter(chain => armBend(chain) > .4) ?? [];
  const fittedSternum = parameters.skinFit?.sternumSurface;
  const relaxSternum = fittedSternum || parameters.skinFit?.sternumRelax;
  if (!mesh.skinFeatures || (!arms.length && !relaxSternum)) return;
  const patch = new Map<number, { weight: number; neighbors: Set<number>; depthOnly: boolean; faces: number[] }>();
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]*lateral, y = positions[i+1]*vertical, z = positions[i+2]*lateral;
    const chain = arms.find(arm => x*arm.side > 0);
    const [shoulder, elbow] = chain?.target ?? [[0, 0, 0], [0, 0, 0]];
    const joint = Math.hypot(x-elbow[0],y-elbow[1],z-elbow[2]);
    const armpit = Math.hypot(x-(shoulder[0]+(chain?.side ?? 0)*.022),y-(shoulder[1]-.053),z-shoulder[2]);
    const lowerSternum = relaxSternum
      ? .66 * (1 - smooth(.052, .079, Math.abs(x))) * smooth(1.228, 1.244, y) * (1 - smooth(1.285, 1.315, y))
      : 0;
    const upperSternum = .48 * (1 - smooth(.012, .052, Math.abs(x))) *
      smooth(1.232, 1.273, y) * (1 - smooth(1.43, 1.49, y));
    const sternum = Math.max(lowerSternum, upperSternum) * smooth(.045, .09, z);
    const arm = chain ? Math.max(.54*(1-smooth(.025,.085,joint)),.38*(1-smooth(.028,.094,armpit))) : 0;
    const weight = Math.max(sternum, arm);
    if (weight) patch.set(i/3,{weight,neighbors:new Set(),depthOnly:sternum > arm,faces:[]});
  }
  for (let i = 0; i < mesh.indices.length; i += 3) for (let j = 0; j < 3; j++) {
    const item = patch.get(mesh.indices[i+j]);
    if (!item) continue;
    item.neighbors.add(mesh.indices[i+(j+1)%3]);
    item.neighbors.add(mesh.indices[i+(j+2)%3]);
    if (item.depthOnly && relaxSternum) item.faces.push(i);
  }
  const area = (vertices: Float32Array, face: number) => {
    const a = mesh.indices[face] * 3, b = mesh.indices[face + 1] * 3, c = mesh.indices[face + 2] * 3;
    return (vertices[b] - vertices[a]) * (vertices[c + 1] - vertices[a + 1]) -
      (vertices[b + 1] - vertices[a + 1]) * (vertices[c] - vertices[a]);
  };
  for (let pass = 0; pass < (relaxSternum ? 6 : 3); pass++) {
    const before = positions.slice();
    for (const [vertex,{weight,neighbors,depthOnly,faces}] of patch) {
      if (!neighbors.size) continue;
      if (pass >= 3 && (!faces.length || before[vertex * 3 + 1] * vertical > 1.315)) continue;
      if (faces.length) {
        // Relax the projection of the fold without creating a new inverted face.
        const i = vertex * 3, x = positions[i], y = positions[i + 1];
        let dx = 0, dy = 0;
        for (const n of neighbors) { dx += before[n * 3] - x; dy += before[n * 3 + 1] - y; }
        const minimum = faces.map(face => {
          const sign = Math.sign(area(mesh.positions, face));
          return Math.min(0, sign * area(positions, face));
        });
        const valid = () => faces.every((face, n) => {
          const authoredArea = area(mesh.positions, face);
          const tolerance = Math.min(.001, Math.abs(authoredArea) * .15);
          return Math.sign(authoredArea) * area(positions, face) >= minimum[n] - tolerance;
        });
        let step = weight * .6 / neighbors.size;
        for (let attempt = 0; attempt < 3; attempt++, step /= 2) {
          positions[i] = x + step * dx;
          positions[i + 1] = y + step * dy;
          if (valid()) break;
          positions[i] = x;
          positions[i + 1] = y;
        }
      }
      if (pass >= 3 || (depthOnly && !arms.length && !fittedSternum)) continue;
      for (let k = depthOnly ? 2 : 0; k < 3; k++) {
        const i = vertex*3+k;
        let mean = 0;
        for (const neighbor of neighbors) mean += before[neighbor*3+k];
        positions[i] += weight*Math.max(-.055,Math.min(.055,mean/neighbors.size-before[i]));
      }
    }
  }
  // Reconstruct the narrow midline from both pectoral surfaces. One-ring
  // smoothing alone follows the existing sharp fold instead of bridging it.
  if (!arms.length && !fittedSternum) return;
  const surface = new SurfaceBVH({ positions: positions.slice(), indices: mesh.indices });
  const edge = .051 / lateral;
  const rows = new Map<number, [number, number] | null>();
  for (const [vertex, { weight, depthOnly }] of patch) {
    if (!depthOnly) continue;
    const i = vertex * 3, y = Math.round(positions[i + 1] * 40) / 40;
    if (!rows.has(y)) {
      const left = surface.queryRay([-edge, y, 4], [0, 0, -1], 4);
      const right = surface.queryRay([edge, y, 4], [0, 0, -1], 4);
      rows.set(y, left && right ? [left.point[2], right.point[2]] : null);
    }
    const row = rows.get(y);
    if (!row) continue;
    const u = Math.max(0, Math.min(1, .5 + positions[i] / (2 * edge)));
    const target = row[0] * (1 - u) + row[1] * u - .035 * 4 * u * (1 - u);
    positions[i + 2] += Math.min(1, weight * 2.15) * Math.max(-.16, Math.min(.22, target - positions[i + 2]));
  }
}
/**
 * The parameter-only part of posing: the fitted reference pose, the pectoral covering, the skin
 * fit residual and the fat thickness. It does not depend on the interactive pose, so the anatomy
 * worker computes it once per build (`referencePositions`) instead of the main thread on every
 * pose slider step.
 */
export function referencePositions(mesh: AnatomyMesh, parameters: AnatomyParameters): Float32Array {
  const result = mesh.positions.slice(),{calibrate,lateral,vertical}=referenceCalibration(parameters);
  const armFit = mesh.rigRegion==='arm' && mesh.anatomyId
    ? parameters.referencePose?.chains.filter(chain=>chain.kind==='arm' && chain.radialFit) : undefined;
  if(parameters.referencePose?.enabled)for(let i=0;i<result.length;i+=3){
    const point=Array.from(mesh.positions.subarray(i,i+3)),side=point[0]<0?-1:1,j=i/3*4;
    // Keep the dorsal belly on the trunk until its fibres approach the
    // humerus. A spatial weight alone moves the lateral belly with the arm.
    let arm=mesh.rig?Math.min(1,mesh.rig[j]+mesh.rig[j+2])
      :mesh.rigRegion==='arm'||mesh.rigRegion==='hand'?1:smooth(1.6,2.35,Math.abs(point[0]))*smooth(9.9,12.5,point[1]);
    if (!mesh.rig && mesh.anatomyId?.startsWith('latissimus_dorsi.') && mesh.armBlend && mesh.longitudinal) {
      const u = mesh.longitudinal[i/3];
      const posterior = (1 - smooth(-.45, -.12, point[2])) * (1 - smooth(.72, .95, u));
      arm += (smooth(...mesh.armBlend, u) - arm) * posterior;
    }
    // Serratus digitations and intercostals sit on the ribs. The teres major reaches the
    // humerus only at the end of its fibres.
    arm = axillaryArmWeight(mesh, i / 3, arm);
    const leg=mesh.rig?mesh.rig[j+1]:mesh.rigRegion==='leg'?1:(1-arm)*(1-smooth(8.35,9.5,point[1]))*smooth(.3,.75,Math.abs(point[0]));
    const a=calibrate(point,'arm',side),b=calibrate(point,'leg',side);
    result.set(point.map((v,k)=>v+(a[k]-v)*arm+(b[k]-v)*leg),i);
    const chain = armFit?.find(item=>item.side===side);
    if (chain) {
      const fit=fitArmRadius([result[i]*lateral,result[i+1]*vertical,result[i+2]*lateral],chain);
      result.set([fit[0]/lateral,fit[1]/vertical,fit[2]/lateral],i);
    }
  }
  if (mesh.fitSurface) {
    const muscles = parameters.definition?.muscles;
    const left = muscles?.['pectoralis_major_sternocostal.L']?.pectoralContour;
    const right = muscles?.['pectoralis_major_sternocostal.R']?.pectoralContour;
    if (left?.covering || right?.covering || left?.transitionCovering || right?.transitionCovering) {
      const end = mesh.adiposePairs ? mesh.adiposePairs * 3 : result.length;
      for (let i = 0; i < end; i += 3) {
        const contour = result[i] < 0 ? left : right;
        if (!contour) continue;
        const x = result[i] * lateral, y = result[i+1] * vertical, z = result[i+2] * lateral;
        const base = contour.covering && pectoralCoveringBasis(x,y,z);
        const transition = contour.transitionCovering && y > 1.3 && y < 1.5 && Math.abs(x) < .273 &&
          deltopectoralCoveringBasis(x,y,z);
        const projection = (base ? base.reduce((sum, weight, j) => sum + weight * contour.covering![j], 0) : 0) +
          (transition ? transition.reduce((sum, weight, j) => sum + weight * contour.transitionCovering![j], 0) : 0);
        if (!projection) continue;
        const dz = projection / (1000 * lateral);
        result[i+2] += dz;
        if (mesh.adiposePairs) result[end+i+2] += dz;
      }
    }
  }
  if(parameters.referencePose?.enabled&&parameters.skinFit&&mesh.fitSurface)for(let i=0;i<result.length;i+=3){
    const q=surfaceFitPoint(parameters.skinFit,[result[i]*lateral,result[i+1]*vertical,result[i+2]*lateral]);
    if (parameters.skinFit.abdominalDepth) q[2] += abdominalDepthAt(parameters.skinFit.abdominalDepth, ...q);
    if (parameters.skinFit.abdominalFlanks) {
      const radial = abdominalFlankAt(parameters.skinFit.abdominalFlanks, ...q), r = Math.hypot(q[0], q[2]);
      if (radial && r > .08) { q[0] += radial * q[0] / r; q[2] += radial * q[2] / r; }
    }
    if (parameters.skinFit.pectoralDepth) q[2] += pectoralDepthAt(parameters.skinFit.pectoralDepth, ...q);
    result[i]=q[0]/lateral;result[i+1]=q[1]/vertical;result[i+2]=q[2]/lateral;
  }
  const covering = mesh.fitSurface && mesh.skinFeatures && parameters.skinFit?.armCovering;
  if (covering) for (let i = 0; i < result.length; i += 3) {
    const weight = smooth(1.23,1.27,result[i+1]*vertical)*smooth(.095,.15,Math.abs(result[i]*lateral));
    if (!weight) continue;
    const [x,y,z] = armCoveringAt(covering,result[i]*lateral,result[i+1]*vertical,result[i+2]*lateral);
    result[i] += weight*x/lateral; result[i+1] += weight*y/vertical; result[i+2] += weight*z/lateral;
  }
  if (mesh.fitSurface && parameters.referencePose?.enabled) relaxPosedSkin(mesh, result, parameters, lateral, vertical);
  const sternum = mesh.fitSurface && mesh.skinFeatures && parameters.skinFit?.sternumSurface;
  const nominalPectoral = parameters.pectoral === 1 && parameters.pectoralClavicular === 1 &&
    parameters.pectoralSternal === 1 && parameters.pectoralCostal === 1;
  if (sternum && nominalPectoral) for (let i = 0; i < result.length; i += 3) {
    const x = result[i] * lateral, y = result[i + 1] * vertical, z = result[i + 2] * lateral;
    // Select anterior vertices in the authored mesh. A vertex buried by the
    // fold still belongs to the front and must receive the fitted depth.
    const front = (mesh.materialPositions ?? mesh.positions)[i + 2] * lateral;
    const weight = (1 - smooth(.052, .086, Math.abs(x))) * smooth(1.228, 1.251, y) *
      (1 - smooth(1.437, 1.485, y)) * smooth(.015, .045, front);
    if (!weight) continue;
    const observed = sternumSurfaceAt(sternum, x, y);
    if (observed > .045) result[i + 2] += weight * (observed - z) / lateral;
  }
  const navel = mesh.skinFeatures && fittedNavelFor(parameters);
  if (navel) {
    flattenAuthoredNavel(mesh, result);
    const appliedDetail = mesh.skinFeatures?.refinedNavel && applyNavelDetail(mesh, result, navel, lateral, vertical);
    if (!appliedDetail) {
      for (let i = 0; i < result.length; i += 3)
        result[i + 2] += navelDepthAt(navel, result[i] * lateral, result[i + 1] * vertical, result[i + 2] * lateral) / lateral;
      if (mesh.skinFeatures?.smoothFittedNavelTip) softenNavelTip(mesh, result, navel, lateral, vertical);
    }
    offsetNavelCavity(result, navel, lateral, vertical);
  }
  if(parameters.fatDistribution&&mesh.adiposePairs)for(let vertex=0;vertex<mesh.adiposePairs;vertex++){
    const a=vertex*3,b=(vertex+mesh.adiposePairs)*3,q=[result[a]*lateral,result[a+1]*vertical,result[a+2]*lateral],d=[(result[a]-result[b])*lateral,(result[a+1]-result[b+1])*vertical,(result[a+2]-result[b+2])*lateral],length=Math.hypot(...d);
    if(length<.00001)continue;const thickness=Math.max(0,fatThickness(parameters,q)+(mesh.fatPaintMm?.[vertex]??0))/1000;
    result[b]=result[a]-d[0]/length*thickness/lateral;result[b+1]=result[a+1]-d[1]/length*thickness/vertical;result[b+2]=result[a+2]-d[2]/length*thickness/lateral;
  }
  return result;
}
export type PoseJoints = ReturnType<typeof poseJoints>;
/** Pivots of the interactive pose. They depend only on the parameters: callers that pose every mesh
 * of a build compute them once and pass them to {@link posedPositions}. */
export function poseJoints(parameters: AnatomyParameters) {
  const {calibrate}=referenceCalibration(parameters);
  const hipShift = (parameters.pelvisWidth - 35) / 45 + (parameters.asisDistance - 26) / 70 + parameters.flare * .045;
  const joint=(point:number[])=>{
    if(!parameters.surfaceFit)return point;
    const lateral=18/parameters.height,vertical=1.8/17.5,q=surfaceFitPoint(parameters.surfaceFit,[point[0]*lateral,point[1]*vertical,point[2]*lateral]);return [q[0]/lateral,q[1]/vertical,q[2]/lateral];
  };
  const neutralArms=[-1,1].map(side=>proportionChain(parameters,side,false).target.map(joint));
  const armJoints=neutralArms.map((chain,i)=>chain.map(p=>calibrate(p,'arm',i?1:-1)));

  const neutralLegs=[-1,1].map(side=>proportionChain(parameters,side,true).target.map(joint));
  const legJoints=neutralLegs.map((chain,i)=>chain.map(p=>calibrate(p,'leg',i?1:-1)));

  const hips = [-1, 1].map(side => parameters.definition ? pelvicPoint([side * (1.09389 + hipShift), 9.37992, 0], parameters, parameters.definition) : [side * (1.09389 + hipShift), 9.37992, 0]);
  // Hip pivots are the same for every vertex of a side: resolve them once, not per vertex.
  const neutralHipPivots = hips.map(hip => joint(proportionPoint(parameters, hip as [number, number, number], true)));
  const hipPivots = neutralHipPivots.map((hip, i) => calibrate(hip, 'leg', i ? 1 : -1));
  const spinePivots = { lumbar: joint([0, 9.55, -.61]), thoracic: joint([0, 11.15, -.66]) };
  return { neutralArms, armJoints, neutralLegs, legJoints, neutralHipPivots, hipPivots, spinePivots, referenceKey: referenceStageKey(parameters) };
}
/** Positions stay in the generator's 10 cm units; the scene conversion happens once in body.ts. */
export function posedPositions(mesh: AnatomyMesh, parameters: AnatomyParameters, pose: AnatomyPose, joints?: PoseJoints): Float32Array {
  const result = mesh.referencePositions && mesh.referenceKey === (joints?.referenceKey ?? referenceStageKey(parameters))
    ? mesh.referencePositions.slice() : referencePositions(mesh, parameters);
  if (!poseControls.some(c => pose[c.key])) return result;
  const preserveVolume = !!(parameters.referencePose?.enabled && parameters.skinFit && mesh.shellPairs &&
    /^(pectoralis_major_|latissimus_dorsi_|deltoid)/.test(mesh.anatomicalName ?? ''));
  const referenceVolume = preserveVolume ? Math.abs(signedMeshVolume({ positions: result, indices: mesh.indices })) : 0;
  const radians = Math.PI / 180, { neutralArms, armJoints, neutralLegs, legJoints, hipPivots, spinePivots } = joints ?? poseJoints(parameters);
  const trunkShiftX = pose.trunkShiftX / 10;
  const trunkShiftY = pose.trunkShiftY * 17.5 / parameters.height;
  const trunkShiftZ = pose.trunkShiftZ / 10;
  const pelvisShiftX = pose.pelvisShiftX / 10;
  const pelvisShiftY = pose.pelvisShiftY * 17.5 / parameters.height;
  const pelvisShiftZ = pose.pelvisShiftZ / 10;
  const heightScale = parameters.height / 175;
  // Rotate in rendered proportions so height scaling does not warp rigid pelvic bones.
  const regionalRotation = (turn: number, bend: number, sideBend: number) => turn || bend || sideBend
    ? Matrix.Scaling(1, heightScale, 1)
      .multiply(Matrix.RotationYawPitchRoll(turn * radians, bend * radians, -sideBend * radians))
      .multiply(Matrix.Scaling(1, 1 / heightScale, 1)).m : undefined;
  const pelvisRotation = regionalRotation(pose.pelvisTurn, pose.pelvisTilt, pose.pelvisSideTilt);
  const pelvisPivot = hipPivots[0].map((value, axis) => (value + hipPivots[1][axis]) * .5);
  const movePelvis = pelvisRotation || pelvisShiftX || pelvisShiftY || pelvisShiftZ;
  const spinalMotion = (region: 'lumbar' | 'thoracic') => {
    const turn = pose[`${region}Turn`], bend = pose[`${region}Bend`], sideBend = pose[`${region}SideBend`];
    const x = pose[`${region}ShiftX`] / 10;
    const y = pose[`${region}ShiftY`] / (10 * heightScale);
    const z = pose[`${region}ShiftZ`] / 10;
    if (!(turn || bend || sideBend || x || y || z)) return;
    return { pivot: spinePivots[region], rotation: regionalRotation(turn, bend, sideBend), x, y, z };
  };
  const lumbar = spinalMotion('lumbar'), thoracic = spinalMotion('thoracic');
  const pelvicBone = (movePelvis || lumbar || thoracic) && isPelvicBone(mesh);
  const headShiftX = pose.headShiftX / 10;
  const headShiftY = pose.headShiftY * 17.5 / parameters.height;
  const headShiftZ = pose.headShiftZ / 10;
  const neckShiftX = pose.neckShiftX / 10;
  const neckShiftY = pose.neckShiftY * 17.5 / parameters.height;
  const neckShiftZ = pose.neckShiftZ / 10;
  const limbRotations = ([0, 1] as const).map(index => {
    const prefix = index ? 'right' : 'left', sign = index ? 1 : -1;
    const [shoulder, elbow] = armJoints[index], knee = legJoints[index][1];
    const around = (start: number[], end: number[], angle: number) => {
      const axis = Vector3.FromArray(end).subtract(Vector3.FromArray(start));
      return axis.lengthSquared() > 1e-10 ? Matrix.RotationAxis(axis.normalize(), angle * radians) : Matrix.Identity();
    };
    const twist = pose[`${prefix}ArmTwist`], elbowPlane = pose[`${prefix}ElbowPlane`], kneePlane = pose[`${prefix}KneePlane`];
    const elbowAxis = elbowPlane ? Vector3.TransformNormal(Vector3.Forward(), around(shoulder, elbow, sign * elbowPlane)) : Vector3.Forward();
    const kneeAxis = kneePlane ? Vector3.TransformNormal(Vector3.Right(), around(hipPivots[index], knee, sign * kneePlane)) : Vector3.Right();
    const jointMotion = (joint: LimbJoint, proximal: number[], distal: number[], bendAxis?: Vector3) => {
      const flex = joint === 'Wrist' || joint === 'Ankle' ? pose[`${prefix}${joint}Flexion`] : 0;
      const turn = joint === 'Shoulder' ? 0 : pose[`${prefix}${joint}Turn`];
      const tilt = joint === 'Shoulder' || joint === 'Hip' ? 0 : pose[`${prefix}${joint}Tilt`];
      const shiftX = pose[`${prefix}${joint}ShiftX`] / 10;
      const shiftY = pose[`${prefix}${joint}ShiftY`] * 17.5 / parameters.height;
      const shiftZ = pose[`${prefix}${joint}ShiftZ`] / 10;
      if (!(flex || turn || tilt || shiftX || shiftY || shiftZ)) return;
      const axis = Vector3.FromArray(proximal).subtract(Vector3.FromArray(distal));
      const up = axis.lengthSquared() > 1e-10 ? axis.normalize() : Vector3.Up();
      const forward = Math.abs(up.z) < .95 ? Vector3.Forward() : Vector3.Up();
      const across = Vector3.Cross(up, forward).normalize();
      const front = Vector3.Cross(across, up);
      const sideAxis = bendAxis && (joint === 'Elbow' ? Vector3.Cross(up, bendAxis) : Vector3.Cross(bendAxis, up));
      return {
        flex: flex ? Matrix.RotationAxis(across, flex * radians).m : undefined,
        turn: turn ? Matrix.RotationAxis(up, turn * radians).m : undefined,
        tilt: tilt ? Matrix.RotationAxis(sideAxis && sideAxis.lengthSquared() > 1e-10 ? sideAxis.normalize() : front, tilt * radians).m : undefined,
        shiftX, shiftY, shiftZ,
      };
    };
    return {
      wrist: jointMotion('Wrist', elbow, armJoints[index][2]),
      ankle: jointMotion('Ankle', knee, legJoints[index][2]),
      shoulderOffset: jointMotion('Shoulder', shoulder, elbow),
      elbowOffset: jointMotion('Elbow', elbow, armJoints[index][2], elbowAxis),
      hipOffset: jointMotion('Hip', hipPivots[index], knee),
      kneeOffset: jointMotion('Knee', knee, legJoints[index][2], kneeAxis),
      arm: twist ? around(shoulder, elbow, sign * twist).m : undefined,
      elbow: elbowPlane ? Matrix.RotationAxis(elbowAxis, -sign * pose[`${prefix}ElbowFlexion`] * radians).m : undefined,
      knee: kneePlane ? Matrix.RotationAxis(kneeAxis, pose[`${prefix}KneeFlexion`] * radians).m : undefined,
    };
  });
  const name = mesh.anatomicalName ?? '';
  const fittedMotion = !!(parameters.referencePose?.enabled && parameters.skinFit);
  const clavicle = /^clavicle_/.test(name);
  const scapula = /^scapula(?:_|$)/.test(name);
  const scapularMuscle = /^(supraspinatus|infraspinatus|subscapularis|teres_(major|minor))_/.test(name);
  const broadChest = smooth(.21, .235, parameters.chestWidth / parameters.height);
  const clavicularPectoral = /^pectoralis_major_clav_/.test(name);
  const clavicularMuscle = clavicularPectoral || name === 'deltoidAnterior';
  for (let i = 0; i < result.length; i += 3) {
    const x = mesh.positions[i], y = mesh.positions[i + 1], side = x >= 0 ? 1 : -1;
    const j = i / 3 * 4;
    let arm = mesh.rig ? Math.min(1, mesh.rig[j] + mesh.rig[j + 2]) : 0, leg = mesh.rig ? mesh.rig[j + 1] : 0;
    if (!mesh.rig) {
      arm = mesh.rigRegion === 'arm' || mesh.rigRegion === 'hand' ? 1 : smooth(1.60, 2.35, Math.abs(x)) * smooth(9.9, 12.5, y);
      leg = mesh.rigRegion === 'leg' ? 1 : (1 - arm) * (1 - smooth(8.35, 9.5, y)) * smooth(.3, .75, Math.abs(x));
    }
    arm = axillaryArmWeight(mesh, i / 3, arm);
    if (name.startsWith('transversusAbdominis_')) arm = 0;
    // Abdominal sheets stay attached to the ribs and pelvis when only the
    // humerus moves. Spatial arm weights otherwise lift their lateral edges.
    if (fittedMotion && /^(externalOblique_|internalOblique_|rectus_abdominis_|trapezius_ascending_)/.test(name)) arm = 0;
    if (fittedMotion && /^(rib_|costal_cartilage_|sternum$)/.test(name)) arm = 0;
    if (fittedMotion && /^(pectoralis_major_|latissimus_dorsi_)/.test(name) && mesh.armBlend && mesh.longitudinal)
      arm = smooth(...mesh.armBlend, mesh.longitudinal[i / 3]);
    let px = result[i], py = result[i+1], pz = result[i+2];
    const rotate = (cx: number, cy: number, axis: 'x' | 'y' | 'z', angle: number, weight: number, cz = 0) => {
      if (!angle || !weight) return;
      const a = angle * radians * (fittedMotion ? weight : 1), c = Math.cos(a), s = Math.sin(a), dx = px - cx, dy = py - cy, dz = pz - cz;
      const nx = axis === 'x' ? dx : axis === 'y' ? dx * c + dz * s : dx * c - dy * s;
      const ny = axis === 'x' ? dy * c - dz * s : axis === 'y' ? dy : dx * s + dy * c;
      const nz = axis === 'x' ? dy * s + dz * c : axis === 'y' ? -dx * s + dz * c : dz;
      const blend = fittedMotion ? 1 : weight;
      px += (cx + nx - px) * blend; py += (cy + ny - py) * blend; pz += (cz + nz - pz) * blend;
    };
    const rotateLocal = (matrix: Matrix['m'], pivot: number[], weight: number) => {
      if (!weight) return;
      const [cx, cy, cz] = pivot, dx = px - cx, dy = py - cy, dz = pz - cz;
      px += (cx + dx * matrix[0] + dy * matrix[4] + dz * matrix[8] - px) * weight;
      py += (cy + dx * matrix[1] + dy * matrix[5] + dz * matrix[9] - py) * weight;
      pz += (cz + dx * matrix[2] + dy * matrix[6] + dz * matrix[10] - pz) * weight;
    };
    const index = side > 0 ? 1 : 0, local = limbRotations[index];
    const [shoulder, elbow] = armJoints[index], knee = legJoints[index][1];
    // Apply the hand and foot adjustments before posing the parent limb.
    const moveJoint = (motion: NonNullable<typeof local.wrist>, pivot: number[], weight: number) => {
      if (motion.flex) rotateLocal(motion.flex, pivot, weight);
      if (motion.turn) rotateLocal(motion.turn, pivot, weight);
      if (motion.tilt) rotateLocal(motion.tilt, pivot, weight);
      px += motion.shiftX * weight;
      py += motion.shiftY * weight;
      pz += motion.shiftZ * weight;
    };
    if (local.wrist) {
      const wristY = neutralArms[index][2][1];
      moveJoint(local.wrist, armJoints[index][2], arm * (1 - smooth(wristY, wristY + .35, y)));
    }
    if (local.ankle) {
      const ankleY = neutralLegs[index][2][1];
      moveJoint(local.ankle, legJoints[index][2], leg * (1 - smooth(ankleY, ankleY + .3, y)));
    }
    const elbowY = neutralArms[index][1][1], elbowWeight = arm * (1 - smooth(elbowY - .4, elbowY + .28, y));
    if (local.elbowOffset) moveJoint(local.elbowOffset, elbow, elbowWeight);
    if (local.elbow) rotateLocal(local.elbow, elbow, elbowWeight);
    else rotate(elbow[0], elbow[1], 'z', side > 0 ? -pose.rightElbowFlexion : pose.leftElbowFlexion, elbowWeight, elbow[2]);
    if (local.arm) rotateLocal(local.arm, shoulder, arm);
    rotate(shoulder[0], shoulder[1], 'x', -(side > 0 ? pose.rightArmFlexion : pose.leftArmFlexion), arm, shoulder[2]);
    rotate(shoulder[0], shoulder[1], 'z', side > 0 ? pose.rightArmAbduction : -pose.leftArmAbduction, arm);
    // The shoulder covering follows both sides of the girdle and blends
    // back into the chest and arm. Keep the pad independent of muscle growth.
    const recruitment = smooth(20, 85, side > 0 ? pose.rightArmAbduction : pose.leftArmAbduction);
    if (!fittedMotion && recruitment && (clavicle || scapula || scapularMuscle || clavicularMuscle || mesh.fitSurface)) {
      const z = mesh.positions[i + 2];
      const front = smooth(-.5, .4, z);
      const region = smooth(.65, 1.65, Math.abs(x)) * (1 - smooth(2.1, 3.15, Math.abs(x))) *
        smooth(11.7, 13.25, y) * (1 - smooth(14.3, 14.95, y));
      const proximal = 1 - smooth(.25, .92, mesh.longitudinal?.[i / 3] ?? arm);
      const covering = mesh.fitSurface ? region * (1 - arm) : 0;
      const frontWeight = clavicle ? 1 : clavicularMuscle ? region * proximal : covering * front;
      const rearWeight = scapula ? 1 : scapularMuscle ? region * proximal : covering * (1 - front);
      rotate(side * .42, shoulder[1] + .14, 'z', side * recruitment * 4 * frontWeight, 1);
      rotate(side * 1.04, shoulder[1] - .48, 'z', side * recruitment * 7 * rearWeight, 1);
      // Retain thickness over the anterior and posterior folds as they open.
      pz += recruitment * covering * .25 * (2 * front - 1);
      const fold = mesh.fitSurface ? smooth(1.35, 1.95, Math.abs(x)) *
        (1 - smooth(2.65, 3.45, Math.abs(x))) * smooth(11.5, 12.55, y) *
        (1 - smooth(13.55, 14.55, y)) : 0;
      // Cover the lateral lip even where the skin is fully driven by the arm.
      pz += recruitment * broadChest * fold * .245 * (2 * front - 1);
      px += side * recruitment * broadChest * fold * .10;
      // Blend the front wall into the lateral fold over the pectoral belly.
      const anteriorFold = mesh.fitSurface ? front * smooth(.7, 1.12, Math.abs(x)) *
        (1 - smooth(1.65, 2.25, Math.abs(x))) * smooth(12.4, 13.2, y) *
        (1 - smooth(14.05, 14.65, y)) : 0;
      pz += recruitment * broadChest * anteriorFold * .32;

      // Fill the upper transition from the trapezius into the deltoid.
      py += recruitment * covering * .13 * smooth(13.45, 14.15, y);
    }
    if (local.shoulderOffset) moveJoint(local.shoulderOffset, shoulder, arm);
    const kneeY = neutralLegs[index][1][1], kneeWeight = leg * (1 - smooth(kneeY - .36, kneeY + .35, y));
    if (local.kneeOffset) moveJoint(local.kneeOffset, knee, kneeWeight);
    if (local.knee) rotateLocal(local.knee, knee, kneeWeight);
    else rotate(knee[0], knee[1], 'x', side > 0 ? pose.rightKneeFlexion : pose.leftKneeFlexion, kneeWeight, parameters.boneLengthsCm ? knee[2] : 0);
    const hip = hipPivots[index];
    if (local.hipOffset?.turn) rotateLocal(local.hipOffset.turn, hip, leg);
    rotate(hip[0], hip[1], 'x', -(side > 0 ? pose.rightHipFlexion : pose.leftHipFlexion), leg, hip[2]);
    rotate(hip[0], hip[1], 'z', side > 0 ? pose.rightHipAbduction : -pose.leftHipAbduction, leg, hip[2]);
    if (local.hipOffset) {
      px += local.hipOffset.shiftX * leg;
      py += local.hipOffset.shiftY * leg;
      pz += local.hipOffset.shiftZ * leg;
    }
    // Hanging arms follow the shoulder's trunk motion even below the ribs.
    const trunkHeight = y + arm * (neutralArms[index][0][1] - y);
    const trunk = smooth(9.45, 14.7, trunkHeight) * (1 - leg * .8);
    rotate(0, 9.6, 'y', pose.trunkRotation, trunk);
    const head = smooth(14.95, 15.65, y) * (1 - arm);
    rotate(0, 15.3, 'z', pose.headTilt, head);
    rotate(0, 15.3, 'y', pose.headTurn, head);
    rotate(0, 15.3, 'x', pose.headFlexion, head);
    px += headShiftX * head;
    py += headShiftY * head;
    pz += headShiftZ * head;
    // Carry the head with the neck and blend the neck motion into the upper chest.
    const neck = smooth(14.25, 15.45, y) * (1 - arm);
    rotate(0, 14.65, 'z', pose.neckTilt, neck);
    rotate(0, 14.65, 'y', pose.neckTurn, neck);
    rotate(0, 14.65, 'x', pose.neckFlexion, neck);
    px += neckShiftX * neck;
    py += neckShiftY * neck;
    pz += neckShiftZ * neck;
    rotate(0, 9.6, 'x', pose.trunkLean, trunk);
    rotate(0, 9.6, 'z', -pose.trunkSideBend, trunk);
    px += trunkShiftX * trunk;
    py += trunkShiftY * trunk;
    pz += trunkShiftZ * trunk;
    if ((lumbar || thoracic) && !pelvicBone) {
      const moveSpine = (motion: NonNullable<typeof lumbar>, weight: number) => {
        if (motion.rotation) rotateLocal(motion.rotation, motion.pivot, weight);
        px += motion.x * weight;
        py += motion.y * weight;
        pz += motion.z * weight;
      };
      // The thorax moves relative to the lumbar region, which carries it.
      if (thoracic) moveSpine(thoracic, smooth(11.15, 13.8, trunkHeight));
      if (lumbar) moveSpine(lumbar, smooth(9.65, 11.5, trunkHeight));
    }
    if (movePelvis) {
      // Both legs and the sacrum inherit the full motion. Blend into the upper spine.
      const pelvis = pelvicBone ? 1 : 1 - smooth(10.05, 13.2, trunkHeight);
      if (pelvisRotation) rotateLocal(pelvisRotation, pelvisPivot, pelvis);
      px += pelvisShiftX * pelvis;
      py += pelvisShiftY * pelvis;
      pz += pelvisShiftZ * pelvis;
    }
    result[i] = px; result[i + 1] = py; result[i + 2] = pz;
  }
  const grid = mesh.surfaceGrid, pairs = mesh.shellPairs;
  if (!fittedMotion && clavicularPectoral && grid?.kind === 'shell' && pairs && broadChest) {
    const side = name.endsWith('_R') ? 1 : -1;
    const elevation = side > 0 ? pose.rightArmAbduction : pose.leftArmAbduction;
    const recruitment = smooth(20, 85, elevation) * broadChest;
    const stride = grid.cols + 1;
    if (recruitment) for (let col = 0; col < stride; col++) {
      const origin = col * 3, insertion = (grid.rows * stride + col) * 3;
      const partner = pairs * 3;
      const midpoint = (at: number, axis: number) => (result[at + axis] + result[at + partner + axis]) * .5;
      const rise = Math.max(0, midpoint(insertion, 1) - midpoint(origin, 1));
      const retreat = Math.max(0, midpoint(origin, 2) - midpoint(insertion, 2));
      for (let row = 1; row < grid.rows; row++) {
        const t = row / grid.rows, at = (row * stride + col) * 3;
        const belly = smooth(.08, .315, t) * (1 - smooth(.69, .99, t)) * recruitment;
        const overshoot = Math.max(0, side * (midpoint(at, 0) - midpoint(insertion, 0)));
        // Keep the fibre centreline on the chest side of its humeral
        // attachment. Carry both shell faces together to retain thickness.
        const medial = 1 - smooth(.9, 1.5, Math.abs(midpoint(at, 0)));
        const junction = smooth(1.85, 2.35, Math.abs(midpoint(at, 0)));
        const front = smooth(.17, .5, midpoint(at, 2));
        const wrapX = -junction * (.10 + .034 * front);
        const wrapY = -junction * (.065 + .063 * front);
        const wrapZ = junction * (.132 + .046 * front) - (1 - junction) * .128;
        for (const face of [at, at + partner]) {
          result[face] += side * belly * wrapX;
          result[face + 1] += belly * wrapY;
          result[face + 2] += belly * wrapZ;
          result[face] -= side * overshoot * belly * .16;
          result[face + 1] -= belly * (.371 + .27 * rise + .173 * medial);
          result[face + 2] -= belly * retreat * .014;
        }
      }
    }
  }
  // Preserve the fitted muscle's volume by redistributing thickness around
  // the transported fibre centres. This leaves the attachment centres fixed.
  if (referenceVolume > 1e-9 && mesh.shellPairs) for (let pass = 0; pass < 3; pass++) {
    const volume = Math.abs(signedMeshVolume({ positions: result, indices: mesh.indices }));
    if (volume < 1e-9 || Math.abs(volume - referenceVolume) / referenceVolume < 1e-5) break;
    const gain = referenceVolume / volume, offset = mesh.shellPairs * 3;
    for (let i = 0; i < offset; i++) {
      const center = (result[i] + result[i + offset]) * .5;
      const half = (result[i] - center) * gain;
      result[i] = center + half;
      result[i + offset] = center - half;
    }
  }
  return result;
}

export type PoseLimb = 'arm' | 'leg';

/** Evaluate an endpoint with the same deformation as the corresponding limb. */
export function posedLimbEndpoint(parameters: AnatomyParameters, pose: AnatomyPose, limb: PoseLimb, side: 0 | 1, joints = poseJoints(parameters), joint: 0 | 1 | 2 = 2) {
  const hip = limb === 'leg' && joint === 0;
  return posedPositions({
    positions: Float32Array.from(hip ? joints.neutralHipPivots[side] : (limb === 'arm' ? joints.neutralArms : joints.neutralLegs)[side][joint]),
    referencePositions: Float32Array.from(hip ? joints.hipPivots[side] : (limb === 'arm' ? joints.armJoints : joints.legJoints)[side][joint]),
    referenceKey: joints.referenceKey,
    normals: new Float32Array(3),
    indices: new Uint32Array(),
    rigRegion: limb === 'arm' ? 'hand' : 'leg',
  }, parameters, pose, joints);
}

/** Fit the existing controls for a limb to minimize endpoint error. */
export function solveLimbTarget(parameters: AnatomyParameters, pose: AnatomyPose, limb: PoseLimb, side: 0 | 1, score: (point: Float32Array) => number, joint: 0 | 1 | 2 = 2) {
  const joints = poseJoints(parameters);
  const prefix = side ? 'right' : 'left';
  const axes = limb === 'arm' ? ['ArmAbduction', 'ArmFlexion', 'ElbowFlexion'] : ['HipAbduction', 'HipFlexion', 'KneeFlexion'];
  const part = limb === 'arm' ? 'Shoulder' : 'Hip';
  const controls = poseControls.filter(control => joint === 0
    ? control.key.startsWith(prefix + part) && 'unit' in control && control.unit === 'cm'
    : axes.slice(0, joint === 1 ? 2 : 3).some(axis => control.key === prefix + axis));
  return solvePoseTarget(pose, controls, candidate => score(posedLimbEndpoint(parameters, candidate, limb, side, joints, joint)));
}

export const axialPoseHandles = {
  pelvis: { label: 'Pelvis', height: 9.45 },
  lumbar: { label: 'Lumbar spine', height: 11.05 },
  thoracic: { label: 'Thoracic spine', height: 12.65 },
  trunk: { label: 'Trunk', height: 13.75 },
  neck: { label: 'Neck', height: 15.15 },
  head: { label: 'Head', height: 16.55 },
} as const;
export type AxialPoseHandle = keyof typeof axialPoseHandles;

export function posedAxialHandle(parameters: AnatomyParameters, pose: AnatomyPose, handle: AxialPoseHandle, joints = poseJoints(parameters)) {
  return posedPositions({
    positions: Float32Array.of(0, axialPoseHandles[handle].height, 0),
    normals: new Float32Array(3),
    indices: new Uint32Array(),
  }, parameters, pose, joints);
}

export function solveAxialTarget(parameters: AnatomyParameters, pose: AnatomyPose, handle: AxialPoseHandle, score: (point: Float32Array) => number) {
  const joints = poseJoints(parameters);
  const controls = poseControls.filter(control => control.key.startsWith(handle + 'Shift'));
  return solvePoseTarget(pose, controls, candidate => score(posedAxialHandle(parameters, candidate, handle, joints)));
}

function solvePoseTarget(pose: AnatomyPose, controls: readonly (typeof poseControls)[number][], score: (pose: AnatomyPose) => number) {
  const best = { ...pose };
  const error = () => score(best);
  let distance = error();
  for (const step of [12, 6, 3, 1, .25]) {
    for (let pass = 0; pass < 4; pass++) {
      let improved = false;
      for (const { key, min, max } of controls) {
        const original = best[key];
        let accepted = original;
        for (const sign of [-1, 1]) {
          best[key] = Math.max(min, Math.min(max, original + sign * step));
          const trial = error();
          if (trial + 1e-8 < distance) {
            distance = trial;
            accepted = best[key];
          }
        }
        best[key] = accepted;
        improved ||= accepted !== original;
      }
      if (!improved) break;
    }
  }
  return best;
}
