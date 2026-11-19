import { add, finite, mix, scale, unit, sub, cross, norm, type Vec3 } from './math.js';
import type { AnatomyModel, BoneDefinition, SurfaceAttachment } from './types.js';
import { bonePoint, type BoneFit } from './fitting.js';
export function validateAttachment(bone:BoneDefinition,a:SurfaceAttachment):void {
  if(a.boneId!==bone.id) throw new Error(`Attachment bone mismatch: ${a.boneId}`);
  if(!Number.isInteger(a.triangle)||a.triangle<0||a.triangle>=bone.mesh.indices.length/3)throw new Error(`Invalid triangle on ${bone.id}`);
  const b=a.barycentric;
  if(b.some(x=>!Number.isFinite(x)||x< -1e-7||x>1+1e-7)||Math.abs(b[0]+b[1]+b[2]-1)>1e-5)throw new Error(`Invalid barycentric weights on ${bone.id}`);
}
export function triangleVertices(bone:BoneDefinition,triangle:number):[Vec3,Vec3,Vec3] {
  const {indices,positions}=bone.mesh;
  const get=(k:number):Vec3=>{const vi=indices[triangle*3+k]!;const o=vi*3;if(o+2>=positions.length)throw new Error(`Invalid vertex index on ${bone.id}`);return [positions[o]!,positions[o+1]!,positions[o+2]!];};
  return [get(0),get(1),get(2)];
}
export function resolveAttachment(bone:BoneDefinition,fit:BoneFit,a:SurfaceAttachment):Vec3 {
  validateAttachment(bone,a);
  const [v0,v1,v2]=triangleVertices(bone,a.triangle),b=a.barycentric;
  return bonePoint(fit,add(add(scale(v0,b[0]),scale(v1,b[1])),scale(v2,b[2])));
}
/** Sample a bone triangle normal after a placement, suitable for preview and diagnostics. */
export function attachmentNormal(bone:BoneDefinition,fit:BoneFit,a:SurfaceAttachment):Vec3 {
  validateAttachment(bone,a);const [v0,v1,v2]=triangleVertices(bone,a.triangle).map(v=>bonePoint(fit,v));
  const n=cross(sub(v1!,v0!),sub(v2!,v0!));if(norm(n)<1e-10)throw new Error('Degenerate attachment triangle');return unit(n);
}
export function findBone(model:AnatomyModel,id:string):BoneDefinition {const bone=model.bones.find(b=>b.id===id);if(!bone)throw new Error(`Unknown bone ${id}`);return bone;}
/** Deliberately does not infer attachments from external skin meshes. */
export function attachmentPosition(model:AnatomyModel,fits:ReadonlyMap<string,BoneFit>,a:SurfaceAttachment):Vec3 {
  const bone=findBone(model,a.boneId),fit=fits.get(bone.id);if(!fit)throw new Error(`Missing placement for ${bone.id}`);
  const position=resolveAttachment(bone,fit,a);if(!finite(position))throw new Error(`Non-finite attachment on ${bone.id}`);return position;
}
export function interpolateAttachment(a:Vec3,b:Vec3,t:number):Vec3 {return mix(a,b,t);}
