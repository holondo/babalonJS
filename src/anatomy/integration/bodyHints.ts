import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { Editor, Entity } from '../../core/editor';
import { humanoidOf, jointPosition, type HumanBone } from '../../rigging/humanoid';
import type { LandmarkName } from '../landmarks';
import type { BodyHints } from '../inference/bodyEvidence';

/** Reuse mapped rig joints and the user's current placement handles in mesh-local space. */
export function collectBodyHints(editor: Editor, entity: Entity, mesh: Mesh): BodyHints {
  const inverse=Matrix.Invert(mesh.computeWorldMatrix(true)),landmarks: BodyHints['landmarks']={};
  const map=humanoidOf(entity)?.map;
  const names: Partial<Record<HumanBone,LandmarkName>>={head:'head',neck:'c7',hips:'sacrum',
    leftUpperArm:'shoulder_L',leftLowerArm:'elbow_L',leftHand:'wrist_L',rightUpperArm:'shoulder_R',rightLowerArm:'elbow_R',rightHand:'wrist_R',
    leftUpperLeg:'hipJoint_L',leftLowerLeg:'knee_L',leftFoot:'ankle_L',rightUpperLeg:'hipJoint_R',rightLowerLeg:'knee_R',rightFoot:'ankle_R'};
  for(const [bone,name] of Object.entries(names) as [HumanBone,LandmarkName][]) {
    const placed=editor.rigger.entity===entity && editor.rigger.joints.has(bone) ? editor.rigger.jointWorld(bone) : undefined;
    const point=placed ?? (map?.[bone]?jointPosition(map[bone]!):undefined);
    if(point) { const p=Vector3.TransformCoordinates(point,inverse);landmarks[name]=[p.x,p.y,p.z]; }
  }
  let vertexBones: Uint8Array | undefined;
  const indices=mesh.getVerticesData('matricesIndices'),weights=mesh.getVerticesData('matricesWeights');
  if(mesh.skeleton && map && indices && weights) {
    const ids: Partial<Record<HumanBone,number>>={leftUpperArm:1,leftLowerArm:2,leftHand:2,rightUpperArm:3,rightLowerArm:4,rightHand:4,leftUpperLeg:5,leftLowerLeg:6,leftFoot:6,rightUpperLeg:7,rightLowerLeg:8,rightFoot:8};
    const nodes=new Map(Object.entries(ids).flatMap(([bone,id])=>map[bone as HumanBone]?[[map[bone as HumanBone]!,id] as const]:[]));
    const labels=mesh.skeleton.bones.map(bone=>{
      let node=bone.getTransformNode();
      while(node) { const id=nodes.get(node);if(id)return id;node=node.parent as typeof node; }
      return 0;
    });
    vertexBones=new Uint8Array(mesh.getTotalVertices());
    const extraIndices=mesh.getVerticesData('matricesIndicesExtra'),extraWeights=mesh.getVerticesData('matricesWeightsExtra');
    for(let v=0;v<vertexBones.length;v++) {
      const sums=new Float32Array(9);
      for(let k=0;k<4;k++) {
        sums[labels[indices[v*4+k]] ?? 0]+=weights[v*4+k];
        if(extraIndices && extraWeights) sums[labels[extraIndices[v*4+k]] ?? 0]+=extraWeights[v*4+k];
      }
      let best=0;for(let k=1;k<9;k++)if(sums[k]>sums[best])best=k;
      vertexBones[v]=best;
    }
  }
  let direction=editor.rigger.entity===entity?Vector3.TransformNormal(editor.rigger.facingWorld,inverse).normalize():undefined;
  if(!direction&&map?.rightUpperArm&&map.leftUpperArm&&map.hips&&(map.neck||map.head)){
    const right=jointPosition(map.rightUpperArm).subtract(jointPosition(map.leftUpperArm)),up=jointPosition((map.neck??map.head)!).subtract(jointPosition(map.hips));
    const forward=Vector3.Cross(right,up);if(forward.lengthSquared()>1e-8)direction=Vector3.TransformNormal(forward.normalize(),inverse).normalize();
  }
  const up = Vector3.TransformNormal(Vector3.Up(), inverse).normalize();
  return {landmarks,vertexBones,zUp:up.z > .9,forward:direction?[direction.x,direction.y,direction.z]:undefined,jointSource:editor.rigger.entity===entity?'manual':'rig'};
}

/** Restore saved mesh-local hints into the existing root-local rig placement UI. */
export function restoreBodyHints(editor:Editor,entity:Entity,mesh:Mesh,hints:BodyHints) {
  if(editor.rigger.entity!==entity)return;
  const map={shoulder_L:'leftUpperArm',elbow_L:'leftLowerArm',wrist_L:'leftHand',shoulder_R:'rightUpperArm',elbow_R:'rightLowerArm',wrist_R:'rightHand',hipJoint_L:'leftUpperLeg',knee_L:'leftLowerLeg',ankle_L:'leftFoot',hipJoint_R:'rightUpperLeg',knee_R:'rightLowerLeg',ankle_R:'rightFoot',head:'head',c7:'neck',sacrum:'hips'} as const;
  const local=mesh.computeWorldMatrix(true).multiply(Matrix.Invert(entity.root.computeWorldMatrix(true)));
  if(hints.forward){const f=Vector3.TransformNormal(new Vector3(...hints.forward),local).normalize();editor.rigger.yaw=Math.atan2(f.x,f.z);}
  for(const [name,joint] of Object.entries(map)) {
    const point=hints.landmarks?.[name as LandmarkName];if(point)editor.rigger.joints.get(joint)?.copyFrom(Vector3.TransformCoordinates(new Vector3(...point),local));
  }
  editor.rigger.refreshPlacement();editor.rigger.frontView();
}
