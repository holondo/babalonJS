import type { AnatomyParameters } from '../parameters';
import type { LandmarkName, Vec3M } from '../landmarks';
import type { LandmarkObservation } from './inputAnalysis';
import type { ParameterRegistry } from './parameterRegistry';
import { getMannequinLandmarks } from '../landmarks';
import { canonicalAnatomyFactors } from '../binding/anatomySkinDrive';

export interface ParameterInferenceRecord {
  id: string;
  value: number;
  status: 'estimated' | 'prior' | 'locked' | 'unobservable';
  confidence: number;
  uncertainty: number;
  sourceDescription: string;
}

export interface FitReport {
  assetId: string;
  fingerprint: string;
  timestamp: string;
  overallConfidence: number;
  residualSurfaceErrorMm: number;
  landmarkMedianErrorMm: number;
  parameters: Record<string, ParameterInferenceRecord>;
  landmarks: Record<LandmarkName, {
    positionMeters: Vec3M;
    confidence: number;
    uncertaintyMm: number;
    source: string;
  }>;
  tissueVolumes: {
    totalVolumeLiters: number;
    muscleVolumeLiters: number;
    fatVolumeLiters: number;
  };
  warnings: string[];
}

/**
 * Builds a comprehensive, transparent FitReport distinguishing observed facts from latent priors.
 */
export function buildFitReport(
  assetId: string,
  fingerprint: string,
  fittedParameters: AnatomyParameters,
  landmarks: Record<LandmarkName, LandmarkObservation>,
  registry: ParameterRegistry,
  residualSurfaceMm: number,
  tissueVolumesLiters: { total: number; muscle: number; fat: number },
  warnings: string[] = [],
  constraints: Partial<AnatomyParameters> = {}
): FitReport {
  const paramRecords: Record<string, ParameterInferenceRecord> = {};

  const errors: number[] = [], observed = Object.values(landmarks).filter(obs=>obs.source!=='prior' && obs.confidence>=.5);
  const predicted=getMannequinLandmarks(fittedParameters),factors=canonicalAnatomyFactors(fittedParameters.height);
  const confidence = observed.length ? observed.reduce((sum,obs)=>sum+obs.confidence,0)/observed.length*Math.exp(-residualSurfaceMm/50) : 0;
  const lmkSummary: FitReport['landmarks'] = {} as any;

  for (const [key, obs] of Object.entries(landmarks)) {
    lmkSummary[key as LandmarkName] = {
      positionMeters: obs.positionMeters,
      confidence: obs.confidence,
      uncertaintyMm: obs.uncertaintyMeters * 1000,
      source: obs.source,
    };
    if(obs.source!=='prior' && obs.confidence>=.5) {
      const p=predicted[key as LandmarkName];
      errors.push(Math.hypot(p[0]*factors.lateral*10-obs.positionMeters[0],p[1]*factors.vertical*10-obs.positionMeters[1],p[2]*factors.lateral*10-obs.positionMeters[2])*1000);
    }
  }

  for (const meta of registry.getAll()) {
    const rawVal = (fittedParameters as unknown as Record<string, unknown>)[meta.key];
    const val = typeof rawVal === 'number' ? rawVal : meta.defaultVal;
    let status: ParameterInferenceRecord['status'] = 'prior';
    let conf = 0.25;
    let desc = 'Derived from anatomical template prior';

    if (meta.observability === 'observable') {
      status = 'estimated';
      conf = confidence;
      desc = 'Directly measured from mesh silhouette & cross-sections';
    } else if (meta.observability === 'conditioned_prior') {
      status = 'prior';
      conf = 0.35;
      desc = 'Estimated under joint muscle/fat volumetric prior';
    } else if (meta.observability === 'render_only') {
      status = 'unobservable';
      conf = 1.0;
      desc = 'Render-only setting; preserved from imported asset';
    }
    if(constraints[meta.key as keyof AnatomyParameters]!==undefined && meta.observability!=='render_only') {
      status='locked';conf=1;desc='Explicit user fitting constraint';
    }

    paramRecords[meta.key] = {
      id: meta.key,
      value: val,
      status,
      confidence: conf,
      uncertainty: meta.max - meta.min > 0 ? (meta.max - meta.min) * (1 - conf) : 0,
      sourceDescription: desc,
    };
  }

  return {
    assetId,
    fingerprint,
    timestamp: new Date().toISOString(),
    overallConfidence: confidence,
    residualSurfaceErrorMm: residualSurfaceMm,
    landmarkMedianErrorMm: errors.length ? errors.sort((a,b)=>a-b)[Math.floor(errors.length/2)] : 0,
    parameters: paramRecords,
    landmarks: lmkSummary,
    tissueVolumes: {
      totalVolumeLiters: tissueVolumesLiters.total,
      muscleVolumeLiters: tissueVolumesLiters.muscle,
      fatVolumeLiters: tissueVolumesLiters.fat,
    },
    warnings,
  };
}
