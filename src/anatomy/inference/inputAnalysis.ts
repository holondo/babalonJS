import type { LandmarkName, Vec3M } from '../landmarks';
import type { AnatomyParameters } from '../parameters';
import { fitAnatomyToHumanoid, type HumanoidMeshAnalysis } from '../fitBody';
import type { BodyHints, BodyEvidence } from './bodyEvidence';
import type { ImmutableSourceAsset } from './sourceGLB';
import { SurfaceBVH } from './observationProxy';

export interface LandmarkObservation {
  id: LandmarkName;
  positionMeters: Vec3M;
  source: 'geometry' | 'prior' | 'manual' | 'rig';
  confidence: number;
  uncertaintyMeters: number;
  locked: boolean;
}
export interface SourceBodyAnalysis {
  assetId: string;
  fingerprint: string;
  rawBounds: { min: Vec3M; max: Vec3M; size: Vec3M };
  bvh: SurfaceBVH;
  proxyPositions: Float32Array;
  proxyIndices: Uint32Array;
  yawCorrectionRad: number;
  scaleCorrection: number;
  offsetCorrectionMeters: Vec3M;
  landmarks: Record<LandmarkName, LandmarkObservation>;
  estimatedParameters: AnatomyParameters;
  overallConfidence: number;
  warnings: string[];
  evidence?: BodyEvidence;
  hints?: BodyHints;
}

/** Sample real triangles, never synthesize faces between unrelated sampled vertices. */
export function createAnalysisProxy(source: ImmutableSourceAsset, targetMaxVertices = 15000) {
  const triangles = source.submeshes.reduce((n, sub) => n + Math.floor((sub.indices?.length ?? sub.positions.length/3)/3),0);
  const stride = Math.max(1,Math.ceil(triangles/Math.max(1,Math.floor(targetMaxVertices/3))));
  const positions: number[] = [], indices: number[] = [], sourceVertexIndices: number[] = [];
  let triangle = 0, vertexOffset=0;
  for(const sub of source.submeshes) {
    const remap = new Map<number,number>(), count = sub.indices?.length ?? sub.positions.length/3;
    for(let face=0;face+2<count;face+=3,triangle++) {
      if(triangle%stride) continue;
      const ids = [0,1,2].map(k=>sub.indices?.[face+k] ?? face+k);
      if(ids.some(id=>id<0 || id*3+2>=sub.positions.length)) continue;
      for(const id of ids) {
        let mapped = remap.get(id);
        if(mapped===undefined) {
          mapped=positions.length/3;remap.set(id,mapped);
          sourceVertexIndices.push(vertexOffset+id);
          const x=sub.positions[id*3],y=sub.positions[id*3+1],z=sub.positions[id*3+2],m=sub.worldMatrix;
          if(m) {
            const w=m[3]*x+m[7]*y+m[11]*z+m[15];
            positions.push((m[0]*x+m[4]*y+m[8]*z+m[12])/w,(m[1]*x+m[5]*y+m[9]*z+m[13])/w,(m[2]*x+m[6]*y+m[10]*z+m[14])/w);
          } else positions.push(x,y,z);
        }
        indices.push(mapped);
      }
    }
    vertexOffset+=sub.positions.length/3;
  }
  if(!indices.length) throw Error('No source triangles available for anatomical fitting.');
  return {positions:new Float32Array(positions),indices:new Uint32Array(indices),sourceVertexIndices:new Uint32Array(sourceVertexIndices)};
}

/** Observations and the objective share one aligned, neutral coordinate space. */
export function analysisFromFit(assetId: string, fingerprint: string, fit: HumanoidMeshAnalysis, proxy: {positions:Float32Array;indices:Uint32Array}, hints: BodyHints = {}): SourceBodyAnalysis {
  const landmarks = {} as Record<LandmarkName,LandmarkObservation>;
  // A skin-section heuristic does not observe an ASIS, pubic bone or xiphoid.
  const observed = new Set<LandmarkName>(['waist']);
  for(const [id,point] of Object.entries(fit.detectedLandmarks) as [LandmarkName,Vec3M][]) {
    const manual=!!hints.landmarks?.[id], measured=observed.has(id);
    landmarks[id]={id,positionMeters:point,source:manual?(hints.jointSource==='rig'?'rig':'manual'):measured?'geometry':'prior',confidence:manual ? .95:measured ? .65:.2,uncertaintyMeters:manual ? .008:measured ? .025:.07,locked:manual};
  }
  return {assetId,fingerprint,rawBounds:fit.bounds,bvh:new SurfaceBVH(proxy),proxyPositions:proxy.positions,proxyIndices:proxy.indices,
    yawCorrectionRad:fit.yawCorrection,scaleCorrection:fit.scaleCorrection,offsetCorrectionMeters:fit.offsetCorrection,
    landmarks,estimatedParameters:fit.estimatedParameters,overallConfidence:Math.min(fit.confidence,fit.evidence.pose.confidence+.25),
    warnings:fit.evidence.warnings,evidence:fit.evidence,hints};
}

export function analyzeSourceAsset(source: ImmutableSourceAsset, hints: BodyHints = {}): SourceBodyAnalysis {
  const sourceProxy=createAnalysisProxy(source);
  const proxyHints={...hints,vertexBones:hints.vertexBones ? Uint8Array.from(sourceProxy.sourceVertexIndices,id=>hints.vertexBones![id]) : undefined};
  const {analysis:fit}=fitAnatomyToHumanoid(sourceProxy.positions,proxyHints);
  return analysisFromFit(source.assetId,source.fingerprint,fit,{positions:fit.neutralPositions,indices:sourceProxy.indices},proxyHints);
}
