import type { AnatomyModel, AnatomyPlacements, MuscleBuild, } from './types.js';
import { inspectMesh } from './diagnostics.js';
import { makeFits } from './fitting.js';
import { loftMuscle } from './loft.js';
import { musclePath } from './paths.js';
import { makeWrapMemory, type WrapMemory } from './wrapping.js';
import { validateModel, AnatomicalDependencies } from './model.js';
export interface AnatomyOptions { samples?:number; radialSegments?:number }
export class AnatomyEngine {
  readonly dependencies:AnatomicalDependencies;
  private readonly memory=new Map<string,WrapMemory>();
  readonly model: AnatomyModel;
  constructor(model:AnatomyModel){this.model=model;validateModel(model);this.dependencies=new AnatomicalDependencies(model);}
  buildMuscle(id:string,placements:AnatomyPlacements={},options:AnatomyOptions={}):MuscleBuild {
    const def=this.model.muscles.find(m=>m.id===id);
    if(!def)throw new Error(`Unknown muscle ${id}`);
    const samples=options.samples??48,radialSegments=options.radialSegments??20;
    if(!Number.isInteger(samples)||samples<3)throw new Error('At least three path samples required');
    const fits=makeFits(this.model,placements);
    let state=this.memory.get(id);if(!state){state=makeWrapMemory();this.memory.set(id,state);}
    const path=musclePath(this.model,def,fits,samples,state);
    const geometry=loftMuscle(path,def.architecture,radialSegments);
    const report=inspectMesh(geometry);
    if(!report.valid)throw new Error(`Invalid geometry for ${id}: ${report.issues.join('; ')}`);
    const warnings:string[]=[];
    const err=Math.abs(report.volume-def.architecture.targetVolume)/def.architecture.targetVolume;
    if(err>0.08)warnings.push(`Realized volume deviates ${(100*err).toFixed(1)}% from target; refine sampling`);
    return {id,path,geometry,volume:report.volume,warnings};
  }
  buildAll(placements:AnatomyPlacements={},options:AnatomyOptions={}):MuscleBuild[] {
    return this.model.muscles.map(m=>this.buildMuscle(m.id,placements,options));
  }
  rebuildAffected(changedBones:readonly string[],placements:AnatomyPlacements={},options:AnatomyOptions={}):MuscleBuild[]{
    return this.dependencies.affectedMuscles(changedBones).map(id=>this.buildMuscle(id,placements,options));
  }
  resetWrapMemory():void{this.memory.clear();}
}
