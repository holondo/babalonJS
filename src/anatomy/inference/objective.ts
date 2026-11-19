import type { Vec3M } from '../landmarks';
import type { SurfaceBVH } from './observationProxy';
import type { LandmarkObservation } from './inputAnalysis';

/** Huber robust loss function. */
export function huberLoss(d: number, delta = 0.05): number {
  const absD = Math.abs(d);
  if (absD <= delta) {
    return 0.5 * absD * absD;
  }
  return delta * (absD - 0.5 * delta);
}

export interface ObjectiveEvaluation {
  totalLoss: number;
  surfaceDistanceMm: number;
  landmarkErrorMm: number;
}

/**
 * Evaluates the bidirectional surface distance and landmark alignment loss.
 */
export function evaluateFitObjective(
  generatedSamples: Float32Array,
  targetBVH: SurfaceBVH,
  targetSamples: Float32Array,
  generatedBVH: SurfaceBVH,
  landmarksPredicted: Record<string, Vec3M>,
  landmarksObserved: Record<string, LandmarkObservation>,
  landmarkWeight = 2.0
): ObjectiveEvaluation {
  // 1. Generated -> Target distance
  const nGen = generatedSamples.length / 3;
  let sumGenDist = 0;
  let rawGenDistance = 0;
  for (let i = 0; i < nGen; i++) {
    const p: Vec3M = [generatedSamples[i * 3], generatedSamples[i * 3 + 1], generatedSamples[i * 3 + 2]];
    const q = targetBVH.queryClosestPoint(p);
    const d = Math.sqrt(q.distanceSq);
    rawGenDistance += d;
    sumGenDist += huberLoss(d);
  }
  const meanGenLoss = sumGenDist / Math.max(1, nGen);

  // 2. Target -> Generated distance
  const nTgt = targetSamples.length / 3;
  let sumTgtDist = 0;
  let rawTgtDistance = 0;
  for (let i = 0; i < nTgt; i++) {
    const p: Vec3M = [targetSamples[i * 3], targetSamples[i * 3 + 1], targetSamples[i * 3 + 2]];
    const q = generatedBVH.queryClosestPoint(p);
    const d = Math.sqrt(q.distanceSq);
    rawTgtDistance += d;
    sumTgtDist += huberLoss(d);
  }
  const meanTgtLoss = sumTgtDist / Math.max(1, nTgt);

  // 3. Landmark loss
  let landmarkLoss = 0;
  let landmarkCount = 0;
  let sumMmError = 0;

  for (const [key, obs] of Object.entries(landmarksObserved)) {
    if (obs.source === 'prior' || obs.confidence < 0.5) continue;
    const pred = landmarksPredicted[key];
    if (!pred) continue;

    const dx = pred[0] - obs.positionMeters[0];
    const dy = pred[1] - obs.positionMeters[1];
    const dz = pred[2] - obs.positionMeters[2];
    const dist = Math.hypot(dx, dy, dz);

    landmarkLoss += huberLoss(dist) * obs.confidence;
    sumMmError += dist * 1000;
    landmarkCount++;
  }

  const meanLandmarkLoss = landmarkCount > 0 ? landmarkLoss / landmarkCount : 0;
  const meanLandmarkMm = landmarkCount > 0 ? sumMmError / landmarkCount : 0;

  const totalLoss = meanGenLoss + meanTgtLoss + landmarkWeight * meanLandmarkLoss;
  const meanSurfaceDistMm = (rawGenDistance/Math.max(1,nGen)+rawTgtDistance/Math.max(1,nTgt))*.5*1000;

  return {
    totalLoss,
    surfaceDistanceMm: meanSurfaceDistMm,
    landmarkErrorMm: meanLandmarkMm,
  };
}
