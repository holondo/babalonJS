/** Adapter designed for Babylon Mesh.setVerticesData / setIndices.
 * Deliberately never touches the input skin mesh, skeleton, UVs or animation groups.
 * Instantiate a separate Babylon Mesh in the host editor and pass it here.
 */
import type { MuscleBuild, MeshGeometry } from './types.js';
export interface BabylonGeometryTarget {
  setVerticesData(kind:string,data:Float32Array,updatable?:boolean):unknown;
  setIndices(indices:Uint32Array):unknown;
}
export function writeGeneratedGeometry(target:BabylonGeometryTarget,geometry:MeshGeometry):void {
  target.setVerticesData('position',geometry.positions,true);
  target.setVerticesData('normal',geometry.normals,true);
  target.setIndices(geometry.indices);
}
export function writeGeneratedMuscle(target:BabylonGeometryTarget,muscle:MuscleBuild):void {
  writeGeneratedGeometry(target,muscle.geometry);
}
