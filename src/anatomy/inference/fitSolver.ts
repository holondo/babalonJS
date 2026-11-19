import { proportionChain } from '../segmentProportions';
import type { AnatomyParameters } from '../parameters';
import { getMannequinLandmarks } from '../landmarks';
import type { SourceBodyAnalysis } from './inputAnalysis';
import { evaluateFitObjective } from './objective';
import { SurfaceBVH } from './observationProxy';
import { buildRegionalSurface } from '../geometry';
import { canonicalAnatomyFactors } from '../binding/anatomySkinDrive';
import catalogue from '../catalogue.json';

export interface SolverResult {
  fittedParameters: AnatomyParameters;
  initialLoss: number;
  finalLoss: number;
  residualMm: number;
  iterations: number;
}

/**
 * Coarse inverse fitting of observable global anthropometric parameters.
 * Minimizes surface and landmark loss using coordinate descent with trust bounds.
 */
export function solveObservableParameters(
  analysis: SourceBodyAnalysis,
  maxIterations = 5
): SolverResult {
  const currentParams: AnatomyParameters = { ...analysis.estimatedParameters };

  // Generate target samples from analysis proxy
  const random = () => { let seed = 1729; return () => { seed = (Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296; }; };
  const targetSamples = analysis.bvh.sampleSurface(220,random());
  const locked = new Set(Object.keys(analysis.hints?.parameters ?? {}));
  const geometryControls = catalogue.controls.filter(c=>c.kind==='geometry');
  // Explicit hints are constraints. Rendering controls never enter this solve.
  for(const control of geometryControls) {
    const hinted=analysis.hints?.parameters?.[control.key as keyof AnatomyParameters];
    const value=typeof hinted==='number'?hinted:(currentParams as unknown as Record<string,number>)[control.key];
    if(Number.isFinite(value)) (currentParams as unknown as Record<string,number>)[control.key]=Math.max(control.min,Math.min(control.max,value));
  }

  // Observable keys to refine with their search step and bounds
  const keysToTune = [
    { key: 'pelvisWidth' as const, step: 2.0, min: 25, max: 55 },
    { key: 'pelvisDepth' as const, step: 1.5, min: 18, max: 40 },
    { key: 'chestWidth' as const, step: 2.0, min: 25, max: 55 },
    { key: 'chestDepth' as const, step: 1.5, min: 18, max: 40 },
    { key: 'waistWidth' as const, step: 1.5, min: 20, max: 48 },
    { key: 'waistDepth' as const, step: 1.2, min: 16, max: 36 },
    { key: 'shoulderWidth' as const, step: 1.0, min: 28, max: 60 },
    { key: 'asisDistance' as const, step: 1.0, min: 16, max: 38 },
    { key: 'fat' as const, step: 2.0, min: 0, max: 45 },
    { key: 'pectoral' as const, step: .15, min: .3, max: 3 },
    { key: 'rectus' as const, step: .15, min: .3, max: 3 },
    { key: 'gluteMax' as const, step: .15, min: .3, max: 3 },
    { key: 'quadriceps' as const, step: .15, min: .3, max: 3 },
    { key: 'lowerFat' as const, step: .15, min: .2, max: 3 },
    { key: 'armFat' as const, step: .15, min: .2, max: 3 },
    { key: 'thighFat' as const, step: .15, min: .2, max: 3 },
    { key: 'gluteFat' as const, step: .15, min: .2, max: 3 },
    { key: 'flankFat' as const, step: .15, min: .2, max: 3 },
  ].map(item=>{const control=geometryControls.find(c=>c.key===item.key)!;return {...item,min:control.min,max:control.max};});

  // Helper to build a lightweight proxy for generated surface
  const evalCurrent = (p: AnatomyParameters) => {
    const surface = buildRegionalSurface(p), factors=canonicalAnatomyFactors(p.height);
    const positions = new Float32Array(surface.positions.length);
    for(let i=0;i<positions.length;i+=3) {
      positions[i]=surface.positions[i]*factors.lateral;
      positions[i+1]=surface.positions[i+1]*factors.vertical;
      positions[i+2]=surface.positions[i+2]*factors.lateral;
    }
    const genBVH = new SurfaceBVH({positions,indices:surface.indices});
    const lmk=getMannequinLandmarks(p);
    for(const side of ['L','R'] as const)for(const leg of [false,true]) {
      const chain=proportionChain(p,side==='L'?-1:1,leg),names=leg?['hipJoint','knee','ankle']:['shoulder','elbow','wrist'];
      names.forEach((name,i)=>{lmk[`${name}_${side}` as keyof typeof lmk]=chain.target[i].map(v=>v*.1) as [number,number,number];});
    }
    for(const point of Object.values(lmk)) { point[0]*=factors.lateral*10;point[1]*=factors.vertical*10;point[2]*=factors.lateral*10; }
    const result = evaluateFitObjective(
      genBVH.sampleSurface(220,random()).points,
      analysis.bvh,
      targetSamples.points,
      genBVH,
      lmk,
      analysis.landmarks
    );
    // Normalize priors by useful parameter scales; muscle/fat ambiguity must not
    // be resolved by unbounded tissue growth or by changing the skeleton.
    let prior=0;
    for(const item of keysToTune) {
      const scale=item.key==='fat'?12:item.max<=3?.8:8;
      prior+=((p[item.key]-analysis.estimatedParameters[item.key])/scale)**2;
    }
    return {...result,totalLoss:result.totalLoss+prior*.00002};
  };

  let bestEval = evalCurrent(currentParams);
  const initialLoss = bestEval.totalLoss;

  let it = 0;
  for (it = 0; it < maxIterations; it++) {
    let improved = false;
    for (const item of keysToTune) {
      if(locked.has(item.key) || analysis.hints?.surface==='clothed' && (item.key.toLowerCase().includes('fat') || ['pectoral','rectus','gluteMax','quadriceps'].includes(item.key))) continue;
      const origVal = currentParams[item.key];
      const candidates = [origVal - item.step, origVal + item.step];

      for (const cand of candidates) {
        if (cand < item.min || cand > item.max) continue;
        currentParams[item.key] = cand;
        const res = evalCurrent(currentParams);
        if (res.totalLoss < bestEval.totalLoss - 1e-8) {
          bestEval = res;
          improved = true;
          break;
        } else {
          currentParams[item.key] = origVal; // revert
        }
      }
    }
    if (!improved) break;
  }

  return {
    fittedParameters: currentParams,
    initialLoss,
    finalLoss: bestEval.totalLoss,
    residualMm: bestEval.surfaceDistanceMm,
    iterations: it + 1,
  };
}
