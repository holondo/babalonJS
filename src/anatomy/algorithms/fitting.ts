import { add, dot, finite, norm, rotateFromTo, scale, sub, unit, type Vec3 } from './math.js';
import type { BoneDefinition, AnatomyModel, AnatomyPlacements, BonePlacement } from './types.js';
export interface BoneFit { id:string; restStart:Vec3;targetStart:Vec3;restAxis:Vec3;targetAxis:Vec3; longitudinalScale:number;radialScale:number }
/** Affine segment fit: rigid reorientation + separate length and radial scaling. */
export function fitBone(bone:BoneDefinition,target:BonePlacement):BoneFit {
  const reference=sub(bone.restEnd,bone.restStart),desired=sub(target.end,target.start);
  const oldLength=norm(reference),newLength=norm(desired),radialScale=target.radialScale??1;
  if(oldLength<1e-7||newLength<1e-7)throw new Error(`Zero-length segment: ${bone.id}`);
  if(![...target.start,...target.end,radialScale].every(Number.isFinite)||radialScale<=0)throw new Error(`Invalid placement for ${bone.id}`);
  return {id:bone.id,restStart:bone.restStart,targetStart:target.start,restAxis:unit(reference),targetAxis:unit(desired),longitudinalScale:newLength/oldLength,radialScale};
}
/** A reference world-space point transformed to the new bone frame. */
export function bonePoint(fit:BoneFit,p:Vec3):Vec3 {
  if(!finite(p))throw new Error('Invalid source bone point');
  const rel=sub(p,fit.restStart),axial=dot(rel,fit.restAxis),radial=sub(rel,scale(fit.restAxis,axial));
  return add(add(fit.targetStart,scale(fit.targetAxis,axial*fit.longitudinalScale)),scale(rotateFromTo(radial,fit.restAxis,fit.targetAxis),fit.radialScale));
}
/** Transform a direction that is attached to a bone, without translation. */
export function boneDirection(fit:BoneFit,direction:Vec3):Vec3 {return rotateFromTo(direction,fit.restAxis,fit.targetAxis);}
export function makeFits(model:AnatomyModel,placements:AnatomyPlacements):Map<string,BoneFit> {
  const result=new Map<string,BoneFit>();
  for(const bone of model.bones) {
    const pos=placements[bone.id]??{start:bone.restStart,end:bone.restEnd};
    result.set(bone.id,fitBone(bone,pos));
  }
  return result;
}
