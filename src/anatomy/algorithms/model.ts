import type { AnatomyModel, AnatomyPlacements } from './types.js';
import { findBone,validateAttachment } from './attachments.js';
import { makeFits } from './fitting.js';
/** Validate semantic dependencies and units without assuming anatomy from naming conventions. */
export function validateModel(model:AnatomyModel):void {
  const boneIds=new Set<string>(),muscleIds=new Set<string>();
  for(const bone of model.bones){
    if(!bone.id||boneIds.has(bone.id))throw new Error(`Duplicate/empty bone id ${bone.id}`);boneIds.add(bone.id);
    if(bone.mesh.positions.length%3||bone.mesh.indices.length%3||bone.mesh.indices.length<3)throw new Error(`Bad mesh for ${bone.id}`);
    if([...bone.mesh.positions].some(x=>!Number.isFinite(x)))throw new Error(`Non-finite bone mesh ${bone.id}`);
    for(const i of bone.mesh.indices)if(i>=bone.mesh.positions.length/3)throw new Error(`Bad bone mesh index ${bone.id}`);
  }
  for(const m of model.muscles){
    if(!m.id||muscleIds.has(m.id))throw new Error(`Duplicate/empty muscle id ${m.id}`);muscleIds.add(m.id);
    for(const a of [m.origin,m.insertion])validateAttachment(findBone(model,a.boneId),a);
    for(const v of m.via??[])findBone(model,v.boneId);
    const obstacles=new Set<string>();for(const o of m.obstacles??[]){findBone(model,o.boneId);if(obstacles.has(o.id))throw new Error(`Duplicate wrapping id ${o.id}`);obstacles.add(o.id);}
  }
}
export class AnatomicalDependencies {
  private readonly muscleByBone=new Map<string,Set<string>>();
  constructor(model:AnatomyModel){
    validateModel(model);
    for(const m of model.muscles){
      const ids=new Set([m.origin.boneId,m.insertion.boneId,...(m.via??[]).map(v=>v.boneId),...(m.obstacles??[]).map(o=>o.boneId)]);
      for(const id of ids){let affected=this.muscleByBone.get(id);if(!affected){affected=new Set();this.muscleByBone.set(id,affected);}affected.add(m.id);}
    }
  }
  affectedMuscles(changedBoneIds:readonly string[]):string[]{
    const ids=new Set<string>();for(const b of changedBoneIds)for(const m of this.muscleByBone.get(b)??[])ids.add(m);
    return [...ids].sort();
  }
}
/** Anatomical fitting is deterministic given a complete placement map. */
export function placementDiagnostics(model:AnatomyModel,placements:AnatomyPlacements):Record<string,{longitudinalScale:number;radialScale:number}>{
  const fitted=makeFits(model,placements),result:Record<string,{longitudinalScale:number;radialScale:number}>={};
  for(const [id,fit] of fitted)result[id]={longitudinalScale:fit.longitudinalScale,radialScale:fit.radialScale};
  return result;
}
