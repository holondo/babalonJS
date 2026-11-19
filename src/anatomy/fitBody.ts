import { proportionJoints } from './segmentProportions';
import { normalizeDefinition } from './definition';
import type { Landmarks, Vec3M } from './landmarks';
import { CANONICAL_LANDMARKS } from './landmarks';
import type { AnatomyParameters } from './parameters';
import { defaults } from './parameters';
import catalogue from './catalogue.json';
import { createRegistration, type AnatomyRegistration } from './registration';
import { neutralizeForMeasurement, type BodyHints, type BodyEvidence } from './inference/bodyEvidence';
import { uprightSource } from './binding/anatomySkinDrive';

export interface SurfaceSection {
  y: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  width: number;
  depth: number;
  centerX: number;
  centerZ: number;
  vertexCount: number;
}

export interface HumanoidMeshAnalysis {
  vertexCount: number;
  bounds: { min: Vec3M; max: Vec3M; size: Vec3M };
  /** Suggested rotation around Y (in radians) to align +Z forward and +X lateral. */
  yawCorrection: number;
  forwardSign:1|-1;
  zUp?: boolean;
  /** Suggested uniform scale to bring to adult metric height (~1.75m). */
  scaleCorrection: number;
  /** Suggested translation to place feet at y = 0 and center in X/Z. */
  offsetCorrection: Vec3M;
  detectedLandmarks: Landmarks;
  estimatedParameters: AnatomyParameters;
  confidence: number;
  /** Neutral analysis copy; the imported positions remain untouched. */
  neutralPositions: Float32Array;
  inversePoseRotations: Float32Array;
  evidence: BodyEvidence;
}

/** Value at a fraction of sorted numbers. */
function quantile(values: number[], fraction: number): number {
  if (!values.length) return 0;
  const idx = Math.min(values.length - 1, Math.max(0, Math.floor(values.length * fraction)));
  return values[idx];
}

/**
 * Analyze an arbitrary humanoid vertex buffer (Float32Array of XYZ coordinates).
 * Detects orientation, height, proportions, and computes target anatomical landmarks.
 */
export function analyzeHumanoidMesh(positions: Float32Array, hints: BodyHints = {}): HumanoidMeshAnalysis {
  const n = positions.length / 3;
  if (n < 50) throw new Error('Humanoid mesh too sparse for anatomical fitting (less than 50 vertices).');
  if (positions.length % 3 || !positions.every(Number.isFinite)) throw Error('Invalid humanoid positions.');
  if (hints.heightCm !== undefined && (!Number.isFinite(hints.heightCm) || hints.heightCm < 50 || hints.heightCm > 260)) throw Error('Invalid stature hint.');
  if (hints.yawRad !== undefined && !Number.isFinite(hints.yawRad)) throw Error('Invalid orientation hint.');
  const zUp = hints.zUp;
  if (zUp) {
    const upright = new Float32Array(positions.length);
    for (let i = 0; i < positions.length; i += 3) upright.set(uprightSource(true, positions[i], positions[i+1], positions[i+2]), i);
    positions = upright;
    const landmarks: BodyHints['landmarks'] = {};
    for (const key of Object.keys(hints.landmarks ?? {}) as (keyof NonNullable<BodyHints['landmarks']>)[]) {
      const point = hints.landmarks?.[key];
      if (point) landmarks[key] = uprightSource(true, ...point);
    }
    hints = { ...hints, landmarks, forward: hints.forward && uprightSource(true, ...hints.forward) };
  }

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (let i = 0; i < n; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const spanZ = maxZ - minZ;

  // Determine facing direction:
  // Usually, height is along Y. If spanZ > spanX significantly at chest/arm level (for a different authored vertical axis),
  // the model is oriented sideways (arms along Z instead of X).
  let yawCorrection = 0;
  if (spanZ > spanX * 1.6) {
    // Model arms extend along Z -> rotate -90 degrees around Y so arms lie along X
    yawCorrection = -Math.PI / 2;
  }
  yawCorrection = hints.yawRad ?? yawCorrection;
  if(hints.yawRad===undefined && hints.landmarks?.shoulder_L && hints.landmarks.shoulder_R) {
    const l=hints.landmarks.shoulder_L,r=hints.landmarks.shoulder_R;
    yawCorrection=Math.atan2(r[2]-l[2],r[0]-l[0]);
  }

  // Pre-rotate and transform positions to test frame where +Y is up, +X is lateral, +Z is forward
  const testX = new Float64Array(n);
  const testY = new Float64Array(n);
  const testZ = new Float64Array(n);

  const cosY = Math.cos(yawCorrection);
  const sinY = Math.sin(yawCorrection);
  const forwardSign:1|-1=hints.forward && -sinY*hints.forward[0]+cosY*hints.forward[2]<0?-1:1;

  let rMinX = Infinity, rMaxX = -Infinity;
  let rMinY = Infinity, rMaxY = -Infinity;
  let rMinZ = Infinity, rMaxZ = -Infinity;

  for (let i = 0; i < n; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];

    const rx = cosY * x + sinY * z;
    const ry = y;
    const rz = (-sinY * x + cosY * z)*forwardSign;

    testX[i] = rx;
    testY[i] = ry;
    testZ[i] = rz;

    if (rx < rMinX) rMinX = rx;
    if (rx > rMaxX) rMaxX = rx;
    if (ry < rMinY) rMinY = ry;
    if (ry > rMaxY) rMaxY = ry;
    if (rz < rMinZ) rMinZ = rz;
    if (rz > rMaxZ) rMaxZ = rz;
  }

  const rawHeight = rMaxY - rMinY;
  const targetHeight = 1.80; // Standard adult template height in meters
  let scaleCorrection = rawHeight > 0.05 ? targetHeight / rawHeight : 1;

  const centerHint = hints.landmarks?.hipJoint_L && hints.landmarks.hipJoint_R
    ? hints.landmarks.hipJoint_L.map((v,k)=>(v+hints.landmarks!.hipJoint_R![k])*.5) : undefined;
  const centerX = centerHint ? cosY*centerHint[0]+sinY*centerHint[2] : (rMinX + rMaxX) / 2;
  const centerZ = centerHint ? (-sinY*centerHint[0]+cosY*centerHint[2])*forwardSign : (rMinZ + rMaxZ) / 2;
  const offsetCorrection: Vec3M = [-centerX * scaleCorrection, -rMinY * scaleCorrection, -centerZ * scaleCorrection];

  // Pose correction precedes every proportion/section measurement. Bounds above
  // only initialize a coordinate frame, never a fitted body shape.
  const prepared = neutralizeForMeasurement(positions, { yaw: yawCorrection, forwardSign, scale: scaleCorrection, offset: offsetCorrection }, hints);
  let neutralLow = Infinity, neutralHigh = -Infinity;
  for (let i=1;i<prepared.positions.length;i+=3) { neutralLow=Math.min(neutralLow,prepared.positions[i]);neutralHigh=Math.max(neutralHigh,prepared.positions[i]); }
  const unposeScale = targetHeight / Math.max(.05, neutralHigh-neutralLow);
  for(let i=0;i<prepared.positions.length;i+=3) {
    prepared.positions[i] *= unposeScale;
    prepared.positions[i+1] = (prepared.positions[i+1]-neutralLow)*unposeScale;
    prepared.positions[i+2] *= unposeScale;
  }
  for(const point of Object.values(prepared.joints)) { point[0]*=unposeScale;point[1]=(point[1]-neutralLow)*unposeScale;point[2]*=unposeScale; }
  for(const key of Object.keys(prepared.boneLengthsCm) as (keyof typeof prepared.boneLengthsCm)[]) prepared.boneLengthsCm[key]! *= unposeScale;
  scaleCorrection *= unposeScale;
  offsetCorrection[0] *= unposeScale; offsetCorrection[1] = (offsetCorrection[1]-neutralLow)*unposeScale;offsetCorrection[2]*=unposeScale;

  // Scale and center points
  for (let i = 0; i < n; i++) {
    testX[i] = prepared.positions[i*3];
    testY[i] = prepared.positions[i*3+1];
    testZ[i] = prepared.positions[i*3+2];
  }

  // Slice analysis along height (H = 1.80m)
  const H = targetHeight;
  const band = H * 0.015;
  const numSlices = 40;
  const slices: SurfaceSection[] = [];
  const bins = Array.from({ length: numSlices }, () => ({ xs: [] as number[], zs: [] as number[] }));
  for (let i = 0; i < n; i++) {
    const slice = Math.floor(testY[i] * numSlices / H);
    for (let s = Math.max(1, slice - 1); s <= Math.min(numSlices - 1, slice + 1); s++) {
      const y = s / numSlices * H;
      if (Math.abs(testY[i] - y) >= band || (prepared.limbMask[i] && y > H * .45 && y < H * .80)) continue;
      bins[s].xs.push(testX[i]);
      bins[s].zs.push(testZ[i]);
    }
  }

  for (let s = 1; s < numSlices; s++) {
    const yVal = (s / numSlices) * H;
    const { xs, zs } = bins[s];
    if (xs.length >= 8) {
      xs.sort((a, b) => a - b);
      zs.sort((a, b) => a - b);
      const qMinX = quantile(xs, 0.05);
      const qMaxX = quantile(xs, 0.95);
      const qMinZ = quantile(zs, 0.05);
      const qMaxZ = quantile(zs, 0.95);
      slices.push({
        y: yVal,
        minX: qMinX,
        maxX: qMaxX,
        minZ: qMinZ,
        maxZ: qMaxZ,
        width: qMaxX - qMinX,
        depth: qMaxZ - qMinZ,
        centerX: (qMinX + qMaxX) / 2,
        centerZ: (qMinZ + qMaxZ) / 2,
        vertexCount: xs.length,
      });
    }
  }

  // Find leg split (crotch): where middle X is bridged
  let crotchY = H * 0.45;
  for (let y = H * 0.35; y < H * 0.58; y += band) {
    let midCount = 0;
    for (let i = 0; i < n; i++) {
      if (Math.abs(testY[i] - y) < band && Math.abs(testX[i]) < H * 0.02) {
        midCount++;
      }
    }
    if (midCount >= 10) {
      crotchY = y;
      break;
    }
  }

  // Torso slices: from crotchY to H * 0.80
  const torsoSlices = slices.filter(s => s.y > crotchY && s.y < H * 0.82);
  const hipLevel=prepared.joints.hipJoint_L&&prepared.joints.hipJoint_R?(prepared.joints.hipJoint_L[1]+prepared.joints.hipJoint_R[1])*.5:undefined;
  // Touching muscular thighs are not a pelvic-width observation. With joint
  // hints, measure above the hip pivots rather than above the first skin bridge.
  const hipSlice = torsoSlices.filter(s => hipLevel!==undefined?s.y>=hipLevel+.025&&s.y<=hipLevel+.12:s.y<crotchY+H*.12).reduce<SurfaceSection | null>((best, s) => (!best || s.width > best.width ? s : best), null);
  const waistSlice = torsoSlices.filter(s => s.y > (hipSlice?.y ?? crotchY + H * 0.05) && s.y < H * 0.68).reduce<SurfaceSection | null>((best, s) => (!best || s.width < best.width ? s : best), null);
  const chestSlice = torsoSlices.filter(s => s.y > (waistSlice?.y ?? H * 0.58) && s.y < H * 0.78).reduce<SurfaceSection | null>((best, s) => (!best || s.width > best.width ? s : best), null);

  // Neck slice: narrowest piece between H * 0.78 and H * 0.88
  const neckSlices = slices.filter(s => s.y >= H * 0.78 && s.y <= H * 0.88);
  const neckSlice = neckSlices.reduce<SurfaceSection | null>((best, s) => (!best || s.width < best.width ? s : best), null);

  // Compute detected landmarks by adapting CANONICAL_LANDMARKS to measured proportions
  const landmarks: Landmarks = structuredClone(CANONICAL_LANDMARKS);

  const pubicY = crotchY + 0.03;
  landmarks.pubis = [0, pubicY, hipSlice ? hipSlice.maxZ * 0.9 : 0.084];
  landmarks.waist = [0, waistSlice ? waistSlice.y : 1.05, waistSlice ? waistSlice.centerZ : 0.012];
  landmarks.xiphoid = [0, chestSlice ? chestSlice.y - 0.05 : 1.22, chestSlice ? chestSlice.maxZ * 0.88 : 0.088];
  landmarks.jugularNotch = [0, neckSlice ? neckSlice.y - 0.04 : 1.425, neckSlice ? neckSlice.maxZ * 0.85 : 0.052];
  landmarks.c7 = [0, neckSlice ? neckSlice.y + 0.01 : 1.495, neckSlice ? neckSlice.minZ * 0.85 : -0.075];

  const hipWidthHalf = hipSlice ? hipSlice.width * 0.40 : 0.145;
  landmarks.crest_L = [-hipWidthHalf, (hipSlice?.y ?? 0.95) + 0.08, 0];
  landmarks.crest_R = [hipWidthHalf, (hipSlice?.y ?? 0.95) + 0.08, 0];
  landmarks.asis_L = [-hipWidthHalf * 0.85, (hipSlice?.y ?? 0.95) + 0.03, hipSlice ? hipSlice.maxZ * 0.75 : 0.062];
  landmarks.asis_R = [hipWidthHalf * 0.85, (hipSlice?.y ?? 0.95) + 0.03, hipSlice ? hipSlice.maxZ * 0.75 : 0.062];

  const chestWidthHalf = chestSlice ? chestSlice.width * 0.48 : 0.195;
  landmarks.shoulder_L = [-chestWidthHalf * 1.15, (neckSlice?.y ?? 1.45) - 0.02, chestSlice ? chestSlice.centerZ : -0.03];
  landmarks.shoulder_R = [chestWidthHalf * 1.15, (neckSlice?.y ?? 1.45) - 0.02, chestSlice ? chestSlice.centerZ : -0.03];
  landmarks.acromion_L = [-chestWidthHalf * 1.12, (neckSlice?.y ?? 1.45), (chestSlice ? chestSlice.centerZ : -0.03) + 0.01];
  landmarks.acromion_R = [chestWidthHalf * 1.12, (neckSlice?.y ?? 1.45), (chestSlice ? chestSlice.centerZ : -0.03) + 0.01];

  // Arms: check lateral reach
  let maxLeftX = -Infinity, maxRightX = -Infinity;
  for (let i = 0; i < n; i++) {
    if (testY[i] > pubicY) {
      if (testX[i] < maxLeftX) maxLeftX = testX[i];
      if (testX[i] > maxRightX) maxRightX = testX[i];
    }
  }

  // Derive parameters
  const params: AnatomyParameters = { ...defaults, ...hints.priorParameters };
  params.height = hints.heightCm ?? 180;
  if (hipSlice) {
    params.pelvisWidth = Math.max(25, Math.min(55, hipSlice.width * 100));
    params.pelvisDepth = Math.max(18, Math.min(40, hipSlice.depth * 100));
  }
  if (chestSlice) {
    params.chestWidth = Math.max(25, Math.min(55, chestSlice.width * 100));
    params.chestDepth = Math.max(18, Math.min(40, chestSlice.depth * 100));
  }
  if (waistSlice) {
    params.waistWidth = Math.max(20, Math.min(48, waistSlice.width * 100));
    params.waistDepth = Math.max(16, Math.min(36, waistSlice.depth * 100));
  }
  const stature = params.height / 180;
  for(const key of ['pelvisWidth','pelvisDepth','chestWidth','chestDepth','waistWidth','waistDepth'] as const) params[key] *= stature;
  const hinted = prepared.joints;
  if (hinted.shoulder_L && hinted.shoulder_R) {
    const observed=Math.abs(hinted.shoulder_R[0]-hinted.shoulder_L[0])*100*stature;
    const predicted=proportionJoints(params,1,false)[0][0]*20;
    params.shoulderWidth+=observed-predicted;
  }
  if (hinted.asis_L && hinted.asis_R) params.asisDistance = Math.abs(hinted.asis_R[0]-hinted.asis_L[0])*100*stature;
  // A hip joint does not determine the ASIS. Keep this independent bony landmark
  // as a prior unless it was supplied; the old primitive inverse created iliac wings.

  for(const [key,point] of Object.entries(hinted)) landmarks[key as keyof Landmarks] = point;
  // Surface appearance cannot uniquely separate muscle and fat. These are
  // conditioned priors until the procedural composition pass or a user constraint.
  for(const control of catalogue.controls) {
    const value=hints.parameters?.[control.key as keyof AnatomyParameters];
    if(control.kind!=='geometry' || value===undefined) continue;
    if(typeof value!=='number' || !Number.isFinite(value)) throw Error('Invalid anatomical parameter hint.');
    (params as unknown as Record<string,number>)[control.key]=Math.max(control.min,Math.min(control.max,value));
  }
  if (hints.parameters?.definition !== undefined) params.definition=normalizeDefinition(hints.parameters.definition);
  const muscleKeys = ['pectoral','rectus','oblique','gluteMax','quadriceps','hamstrings','biceps','triceps'] as const;
  const hasBoneHints=Object.keys(prepared.boneLengthsCm).length>0;
  for(const side of ['L','R'] as const) for(const [name,a,b] of [['upperArm','shoulder','elbow'],['forearm','elbow','wrist'],['thigh','hipJoint','knee'],['shin','knee','ankle']] as const) {
    const key=`${name}_${side}` as keyof typeof prepared.boneLengthsCm;
    if(prepared.boneLengthsCm[key]===undefined) {
      const start=landmarks[`${a}_${side}`],end=landmarks[`${b}_${side}`];
      prepared.boneLengthsCm[key]=Math.hypot(...start.map((v,k)=>v-end[k]))*100*stature;
    }
  }
  if (hasBoneHints) params.boneLengthsCm = { ...prepared.boneLengthsCm };
  const evidence: BodyEvidence = {
    boneSource: hasBoneHints?'joint-hints':'template-prior',
    pose: prepared.pose, boneLengthsCm: prepared.boneLengthsCm,
    composition: { fatMm: params.fat, muscleScale: muscleKeys.reduce((sum,key)=>sum+params[key],0)/muscleKeys.length,
      confidence: hints.parameters?.fat !== undefined ? .85 : .25, source: hints.parameters?.fat !== undefined ? 'hint' : 'prior',
      fatRangeMm: hints.parameters?.fat !== undefined ? [params.fat,params.fat] : [Math.max(0,params.fat-8),params.fat+12] },
    warnings: [...(hints.heightCm ? [] : ['Stature is a scale hypothesis; supply a height hint for physical measurements.']),
      ...(prepared.pose.method === 'surface-estimate' ? ['Pose estimated from the surface; joint hints improve bent or overlapping limbs.'] : []),
      'Bone lengths are joint-conditioned estimates; muscle and fat composition are not identifiable from the outer surface alone.',
      ...(hints.surface === 'clothed' ? ['Clothing is not the body surface; inferred tissue proportions have low confidence.'] : [])],
  };

  const confidence = Math.min(prepared.pose.confidence+.25, Math.min(1, Math.max(0.4, (slices.length / 30) * (slices.some(s => s.width > 0.2) ? 1 : 0.6)))) * (hints.surface==='clothed'?.6:1);

  return {
    vertexCount: n,
    bounds: {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
      size: [spanX, spanY, spanZ],
    },
    yawCorrection,forwardSign,zUp,
    scaleCorrection,
    offsetCorrection,
    detectedLandmarks: landmarks,
    estimatedParameters: params,
    confidence,
    neutralPositions: prepared.positions,
    inversePoseRotations: prepared.inverseRotations,
    evidence,
  };
}

/**
 * Fits the procedural anatomy into a target humanoid mesh.
 * Returns the registration warp and matched parameters.
 */
export function fitAnatomyToHumanoid(positions: Float32Array, hints: BodyHints = {}): {
  analysis: HumanoidMeshAnalysis;
  registration: AnatomyRegistration;
  parameters: AnatomyParameters;
} {
  const analysis = analyzeHumanoidMesh(positions, hints);
  const registration = createRegistration(CANONICAL_LANDMARKS, analysis.detectedLandmarks);
  return {
    analysis,
    registration,
    parameters: analysis.estimatedParameters,
  };
}
