import type { Vec3 } from './math.js';
/** Positions of ALL source meshes are in the common, unposed, metre-scale anatomical frame. */
export interface IndexedMesh { positions: Float32Array; indices: Uint32Array }
export interface BoneDefinition { id: string; mesh: IndexedMesh; restStart: Vec3; restEnd: Vec3 }
/** Triangle index, NOT vertex index. Barycentric coordinates address an exact bone surface region. */
export interface SurfaceAttachment { boneId: string; triangle: number; barycentric: readonly [number,number,number] }
export interface BoneBoundPoint { boneId: string; restPoint: Vec3 }
export interface SphereObstacle { kind:'sphere'; id:string; boneId:string; restCenter:Vec3; radius:number }
/** An infinite cylinder; a finite cylinder requires end-cap handling and is not silently approximated. */
export interface CylinderObstacle { kind:'infinite-cylinder'; id:string; boneId:string; restCenter:Vec3; restAxis:Vec3; radius:number }
export type WrapObstacle=SphereObstacle|CylinderObstacle;
export type MuscleKind='fusiform'|'strap';
export interface MuscleArchitecture {
  kind: MuscleKind;
  /** cubic metres in the canonical rest state; not an activation/force estimate */
  targetVolume: number;
  /** Cross-section radius along first RMF normal / radius along binormal. */
  aspectRatio: number;
  /** Minimal fraction of maximal width at tendon ends (0 < taper <= 1). */
  endTaper: number;
}
export interface MuscleDefinition {
  id: string;
  origin: SurfaceAttachment;
  insertion: SurfaceAttachment;
  via?: readonly BoneBoundPoint[];
  obstacles?: readonly WrapObstacle[];
  architecture: MuscleArchitecture;
}
export interface AnatomyModel { bones: BoneDefinition[]; muscles: MuscleDefinition[] }
/** New start/end expressed in the scene's common coordinates. */
export interface BonePlacement { start: Vec3; end: Vec3; radialScale?: number }
export type AnatomyPlacements=Record<string,BonePlacement>;
export interface MeshGeometry extends IndexedMesh { normals: Float32Array }
export interface MuscleBuild { id:string; path:Vec3[]; geometry:MeshGeometry; volume:number; warnings:string[] }
