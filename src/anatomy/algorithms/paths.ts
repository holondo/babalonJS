import { boneDirection, bonePoint, type BoneFit } from './fitting.js';
import { catmullRom, resamplePolyline, type Vec3 } from './math.js';
import { attachmentPosition } from './attachments.js';
import type { AnatomyModel, MuscleDefinition, WrapObstacle } from './types.js';
import { makeWrapMemory, routePolyline, type WorldObstacle, type WrapMemory } from './wrapping.js';
export function placeObstacle(obstacle:WrapObstacle,fit:BoneFit):WorldObstacle {
  const base={id:obstacle.id,center:bonePoint(fit,obstacle.restCenter),radius:obstacle.radius*fit.radialScale};
  return obstacle.kind==='sphere'?{...base,kind:'sphere'}:{...base,kind:'infinite-cylinder',axis:boneDirection(fit,obstacle.restAxis)};
}
/** Solve paths in common world coordinates. Smoothing never crosses a wrap surface afterward. */
export function musclePath(model:AnatomyModel,definition:MuscleDefinition,fits:ReadonlyMap<string,BoneFit>,resolution=48,memory:WrapMemory=makeWrapMemory()):Vec3[] {
  const anchors:Vec3[]=[attachmentPosition(model,fits,definition.origin)];
  for(const v of definition.via??[]){const fit=fits.get(v.boneId);if(!fit)throw new Error(`Unknown waypoint bone ${v.boneId}`);anchors.push(bonePoint(fit,v.restPoint));}
  anchors.push(attachmentPosition(model,fits,definition.insertion));
  const obstacles=(definition.obstacles??[]).map(o=>{const f=fits.get(o.boneId);if(!f)throw new Error(`Unknown wrapping bone ${o.boneId}`);return placeObstacle(o,f);});
  // Interpolating a wrapped trajectory may reintroduce penetration, so only smooth open paths.
  const working=obstacles.length?anchors:catmullRom(anchors);
  const routed=obstacles.length?routePolyline(working,obstacles,memory,Math.max(48,resolution*2)):working;
  // Resampling a wrapped arc may cut its corners: preserve its original obstacle samples.
  return obstacles.length&&routed.length>=3?routed:resamplePolyline(routed,resolution);
}
