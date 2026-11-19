import { registerTissueHints } from './tissueRegistration';
import { fitVolumes } from './volumeFit';
import { createReferencePose } from '../referencePose';
import { sourcePointToCanonical, type SourceCanonicalFrame } from '../binding/anatomySkinDrive';
import { generateAnatomy } from '../generation';
import { normalizePose,posedPositions } from '../pose';
import { proportionChain } from '../segmentProportions';
import { canonicalAnatomyFactors } from '../binding/anatomySkinDrive';
import { registerSurface } from './surfaceRegistration';
import { SurfaceBVH } from './observationProxy';
import { connectedSurfaceProxy } from './surfaceProxy';
import { fitTrunk } from './trunkFit';
import { fitAnatomyToHumanoid } from '../fitBody';
import { hashBuffer, snapshotImmutableSource } from './sourceGLB';
import type { PoseObservation } from './poseObservation';
import { analysisFromFit } from './inputAnalysis';
import { solveObservableParameters } from './fitSolver';
import type { BodyHints } from './bodyEvidence';

function canonicalSurface(positions: Float32Array, indices: Uint32Array, frame: SourceCanonicalFrame) {
  const original = new Float32Array(positions.length);
  for (let i = 0; i < original.length; i += 3) {
    original.set(sourcePointToCanonical(frame, positions[i], positions[i + 1], positions[i + 2]), i);
  }
  return { positions: original, indices };
}

self.onmessage = async ({data}: MessageEvent<{positions:Float32Array;indices?:Uint32Array;hints:BodyHints;observation?:PoseObservation;softOnly?:boolean;autoRefine?:boolean;refineTissues?:boolean;matchPose?:boolean}>) => {
  try {
    const progress=(stage:string,fraction:number)=>self.postMessage({progress:{stage,fraction}});
    const report=(stage:string,fraction:number)=>progress(stage,data.autoRefine?fraction*.4:fraction);
    const {landmarks,forward,yawRad,heightCm,zUp,vertexBones}=data.hints;
    const signature=data.indices&&data.matchPose
      ? [hashBuffer(data.positions),hashBuffer(data.indices),JSON.stringify({landmarks,forward,yawRad,heightCm,zUp}),vertexBones&&hashBuffer(vertexBones)].join(':')
      : undefined;
    const cached=data.observation&&signature===data.observation.signature?data.observation:undefined;
    if(data.softOnly&&cached&&data.hints.priorParameters?.referencePose?.enabled){
      const a=cached.analysis,frame={yaw:a.yawCorrection,scale:a.scaleCorrection,offset:a.offsetCorrection,forwardSign:a.forwardSign,zUp:a.zUp};
      const refined=fitVolumes(data.hints.priorParameters,new SurfaceBVH(cached.proxy),data.hints,frame,(stage,fraction)=>progress(stage,.1+fraction*.75),
        data.indices ? () => new SurfaceBVH(canonicalSurface(data.positions,data.indices!,frame)) : undefined);
      const evidence={...a.evidence,volumeFit:{...refined.evidence,reusedReferenceSurface:true},poseFit:{meanMm:refined.evidence.skin.afterMm,p95Mm:refined.evidence.skin.p95Mm}};
      self.postMessage({parameters:refined.parameters,analysis:{...a,evidence,estimatedParameters:refined.parameters,neutralPositions:new Float32Array(),inversePoseRotations:new Float32Array()}});
      return;
    }
    report('Measuring neutral body',.05);
    const fit=fitAnatomyToHumanoid(data.positions,data.hints);
    if(data.softOnly){
      if(!data.indices?.length||!data.hints.priorParameters?.referencePose)throw Error('Fit the body and review its joints before refining tissues.');
      if(!data.hints.priorParameters.referencePose.enabled)throw Error('Enable the reference pose before refining tissues.');
      const frame={yaw:fit.analysis.yawCorrection,scale:fit.analysis.scaleCorrection,offset:fit.analysis.offsetCorrection,forwardSign:fit.analysis.forwardSign,zUp:fit.analysis.zUp};
      const original=canonicalSurface(data.positions,data.indices,frame);
      const proxy=await connectedSurfaceProxy(original.positions,original.indices),refined=fitVolumes(data.hints.priorParameters,new SurfaceBVH(proxy),data.hints,frame,(stage,fraction)=>progress(stage,.1+fraction*.75),
        () => new SurfaceBVH(original));
      fit.parameters=refined.parameters;fit.analysis.estimatedParameters=refined.parameters;fit.analysis.evidence.volumeFit=refined.evidence;
      fit.analysis.evidence.poseFit={meanMm:refined.evidence.skin.afterMm,p95Mm:refined.evidence.skin.p95Mm};
      self.postMessage({parameters:fit.parameters,analysis:fit.analysis},[fit.analysis.neutralPositions.buffer,fit.analysis.inversePoseRotations.buffer]);return;
    }
    let residualMm: number | undefined;
    let observation: PoseObservation | undefined;
    if(data.indices?.length) {
      const source=snapshotImmutableSource('fit',[{id:'skin',positions:fit.analysis.neutralPositions,indices:data.indices}]);
      report('Building body surface',.12);
      const proxy=await connectedSurfaceProxy(fit.analysis.neutralPositions,data.indices);
      fit.analysis.evidence.surfaceProxy=proxy.evidence;
      const analysis=analysisFromFit(source.assetId,source.fingerprint,fit.analysis,proxy,data.hints);
      report('Fitting body proportions',.2);
      const solved=solveObservableParameters(analysis,2);
      if(data.refineTissues) {
        report('Refining muscle shapes',.35);
        const trunk=fitTrunk(analysis,solved.fittedParameters,(fraction)=>report('Refining muscle shapes',.35+fraction*.25));
        solved.fittedParameters=trunk.parameters;fit.analysis.evidence.trunkFit=trunk.evidence;
      }
      report('Matching body silhouette',.6);
      const anchors:{source:number[];target:number[];weight:number}[]=[],factors=canonicalAnatomyFactors(solved.fittedParameters.height);
      for(const side of ['L','R'] as const)for(const leg of [false,true]){
        const chain=proportionChain(solved.fittedParameters,side==='L'?-1:1,leg),names=leg?['hipJoint','knee','ankle']:['shoulder','elbow','wrist'];
        names.forEach((name,i)=>{const observation=analysis.landmarks[`${name}_${side}` as keyof typeof analysis.landmarks];if(observation?.locked)anchors.push({source:chain.target[i].map((v,k)=>v*(k===1?factors.vertical:factors.lateral)),target:observation.positionMeters,weight:15});});
      }
      const registration=registerSurface(solved.fittedParameters,new SurfaceBVH(proxy),fraction=>report('Matching body silhouette',.6+fraction*.25),anchors);
      solved.fittedParameters.surfaceFit=registration.field;fit.analysis.evidence.surfaceRegistration=registration.evidence;
      if(Object.keys(data.hints.tissues??{}).length){
        report('Fitting surface landmarks',.84);
        const p=solved.fittedParameters,geometry=generateAnatomy({...p,tissueFit:undefined},[]);
        const fitted=registerTissueHints(p,geometry,{yaw:fit.analysis.yawCorrection,scale:fit.analysis.scaleCorrection,offset:fit.analysis.offsetCorrection,forwardSign:fit.analysis.forwardSign,zUp:fit.analysis.zUp},data.hints);
        p.tissueFit=fitted.field;fit.analysis.evidence.tissueFit=fitted.evidence;
      }
      if(data.matchPose){
        report('Validating reference pose',.85);
        const p=solved.fittedParameters,frame={yaw:fit.analysis.yawCorrection,scale:fit.analysis.scaleCorrection,offset:fit.analysis.offsetCorrection,forwardSign:fit.analysis.forwardSign,zUp:fit.analysis.zUp};
        p.referencePose=createReferencePose(p,frame,data.hints);
        const original=canonicalSurface(data.positions,data.indices,frame);
        const observed=await connectedSurfaceProxy(original.positions,original.indices),target=new SurfaceBVH(observed),mesh=generateAnatomy(p,[]).meshes.skin[0],positions=posedPositions(mesh,p,normalizePose({})),f=canonicalAnatomyFactors(p.height);
        for(let i=0;i<positions.length;i++)positions[i]*=i%3===1?f.vertical:f.lateral;
        const generated=new SurfaceBVH({positions,indices:mesh.indices}),distances:number[]=[],reverse=target.sampleSurface(1800).points;
        let forwardTotal=0,forwardCount=0,reverseTotal=0;
        for(let i=0;i<positions.length;i+=3*Math.max(1,Math.floor(positions.length/3/4000))){const d=Math.sqrt(target.queryClosestPoint([positions[i],positions[i+1],positions[i+2]]).distanceSq)*1000;distances.push(d);forwardTotal+=d;forwardCount++;}
        for(let i=0;i<reverse.length;i+=3){const d=Math.sqrt(generated.queryClosestPoint([reverse[i],reverse[i+1],reverse[i+2]]).distanceSq)*1000;distances.push(d);reverseTotal+=d;}
        distances.sort((a,b)=>a-b);fit.analysis.evidence.poseFit={meanMm:(forwardTotal/forwardCount+reverseTotal/(reverse.length/3))*.5,p95Mm:distances[Math.floor(distances.length*.95)]};
        if(data.autoRefine && p.referencePose?.enabled) {
          const refined=fitVolumes(p,target,data.hints,frame,(stage,fraction)=>progress(stage,.4+fraction*.45),
            () => new SurfaceBVH(original));
          solved.fittedParameters=refined.parameters;
          fit.analysis.evidence.volumeFit={...refined.evidence,reusedReferenceSurface:true};
          fit.analysis.evidence.poseFit={meanMm:refined.evidence.skin.afterMm,p95Mm:refined.evidence.skin.p95Mm};
        }
        if(signature){
          const {neutralPositions,inversePoseRotations,estimatedParameters,...analysis}=fit.analysis;
          observation={signature,proxy:observed,analysis};
        }
      }
      fit.parameters=solved.fittedParameters; fit.analysis.estimatedParameters=solved.fittedParameters;
      residualMm=solved.residualMm;
      fit.analysis.evidence.composition.fatMm=solved.fittedParameters.fat;
      fit.analysis.evidence.composition.muscleScale=(solved.fittedParameters.pectoral+solved.fittedParameters.rectus+solved.fittedParameters.gluteMax+solved.fittedParameters.quadriceps)/4;
      if(data.hints.parameters?.fat===undefined) {
        const composition=fit.analysis.evidence.composition;
        composition.source='conditioned-prior';composition.confidence=.35;
        composition.fatRangeMm=[Math.max(0,composition.fatMm-8),composition.fatMm+12];
      }
    }
    self.postMessage({parameters:fit.parameters,analysis:fit.analysis,residualMm,observation},[fit.analysis.neutralPositions.buffer,fit.analysis.inversePoseRotations.buffer]);
  } catch(error) { self.postMessage({error:error instanceof Error?error.message:String(error)}); }
};
