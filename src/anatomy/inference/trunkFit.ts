import type { AnatomyParameters, AnatomyKey } from '../parameters';
import type { MuscleId, MuscleTemplate } from '../definition';
import { interactionDefaults, muscleDefaults, muscleRanges, boneDefaults, boneRanges, normalizeDefinition } from '../definition';
import { generateAnatomy } from '../generation';
import { canonicalAnatomyFactors } from '../binding/anatomySkinDrive';
import { SurfaceBVH } from './observationProxy';
import { huberLoss } from './objective';
import type { SourceBodyAnalysis } from './inputAnalysis';
import catalogue from '../catalogue.json';
import { patchPoint, samplePatch } from '../attachmentPatches';

type Region = 'chest' | 'abdomen' | 'pelvis';
export interface TrunkFitEvidence {
  method: 'regularized-procedural-surface';
  initialMm: number;
  finalMm: number;
  validationBeforeMm: number;
  validationAfterMm: number;
  landmarkMaxMm: number;
  regions: Record<Region, { beforeMm: number; afterMm: number; samples: number }>;
  attachmentMaxMm: number;
  evaluations: number;
  accepted: string[];
  supportSource: 'hint-conditioned' | 'anatomical-prior';
  warnings: string[];
}
const regions: Region[] = ['chest', 'abdomen', 'pelvis'];
function region(x: number, y: number): Region | undefined {
  // Canonical metres. Exclude arms, legs, neck and head; include the back so an
  // anterior fit cannot silently flatten the posterior trunk.
  if (Math.abs(x) > .245 || y < .82 || y > 1.44) return;
  return y > 1.23 ? 'chest' : y > 1.02 ? 'abdomen' : 'pelvis';
}
function samples(positions: Float32Array, cap = 64, offset = 0) {
  const groups = Object.fromEntries(regions.map(r => [r, [] as number[]])) as Record<Region, number[]>;
  for (let i = 0; i < positions.length; i += 3) {
    const r = region(positions[i], positions[i+1]); if (r) groups[r].push(i);
  }
  return Object.fromEntries(regions.map(r => [r, groups[r].filter((_, i) => {const step=Math.max(1,Math.ceil(groups[r].length/cap));return i%step===Math.floor(step*offset);})])) as Record<Region, number[]>;
}
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
interface Evaluation { loss: number; mm: number; regionMm: Record<Region, number>; counts: Record<Region, number>; attachmentMm: number; landmarkMm: number; }

/** Fit observable trunk shape while keeping hidden tissue properties as bounded priors.
 * Every accepted candidate goes through the same attachments, genetics and covering
 * path as the displayed anatomy. No per-vertex source offsets are optimized here.
 */
export function fitTrunk(analysis: SourceBodyAnalysis, parameters: AnatomyParameters, progress?:(fraction:number)=>void): { parameters: AnatomyParameters; evidence: TrunkFitEvidence } {
  const initial = structuredClone(parameters), current = structuredClone(parameters);
  const definition = normalizeDefinition(current.definition) ?? { version: 1 as const, muscles: {}, bones: {} };
  definition.interaction ??= { ...interactionDefaults, attachments: true };
  current.definition = definition;
  // Preserve existing per-side differences. Shared parameter increments are a symmetry
  // prior; a static surface is insufficient evidence to invent hidden asymmetry.
  const templates: MuscleTemplate[] = ['rectus_abdominis', 'pectoralis_major_sternocostal', 'pectoralis_major_clavicular', 'external_oblique'];
  const lockedDefinition = analysis.hints?.parameters?.definition !== undefined || !!analysis.hints?.lockMuscleShape;
  if (!lockedDefinition && analysis.hints?.surface !== 'clothed') for (const template of templates) for (const side of ['L', 'R'] as const) {
    const id: MuscleId = `${template}.${side}`;
    definition.muscles[id] ??= { ...muscleDefaults };
  }
  const targetSamples = samples(analysis.proxyPositions), targetValidation = samples(analysis.proxyPositions,64,.5);
  const prepared=structuredClone(current);
  let generatedSamples: ReturnType<typeof samples> | undefined, generatedValidation: ReturnType<typeof samples> | undefined;
  let evaluations = 0;
  const evaluate = (p: AnatomyParameters, validation = false): Evaluation => {
    evaluations++;progress?.(Math.min(.95,evaluations/38));
    const generated = generateAnatomy(p, ['bones', 'aponeuroses', 'rectusAbdominis', 'externalOblique', 'internalOblique', 'transversusAbdominis', 'otherMuscles', 'inguinalLigaments']);
    const skin = generated.meshes.skin[0], factors = canonicalAnatomyFactors(p.height), pos = new Float32Array(skin.positions.length);
    for (let i=0;i<pos.length;i+=3) { pos[i]=skin.positions[i]*factors.lateral; pos[i+1]=skin.positions[i+1]*factors.vertical; pos[i+2]=skin.positions[i+2]*factors.lateral; }
    const bvh = new SurfaceBVH({ positions: pos, indices: skin.indices });
    generatedSamples ??= samples(pos);generatedValidation ??= samples(pos,64,.5);
    const selected=validation?generatedValidation:generatedSamples, target=validation?targetValidation:targetSamples;
    const regionMm = {} as Record<Region, number>, counts = {} as Record<Region, number>, losses: number[] = [];
    for (const r of regions) {
      const forward = selected[r].map(i => Math.sqrt(analysis.bvh.queryClosestPoint([pos[i],pos[i+1],pos[i+2]]).distanceSq));
      const reverse = target[r].map(i => Math.sqrt(bvh.queryClosestPoint([analysis.proxyPositions[i],analysis.proxyPositions[i+1],analysis.proxyPositions[i+2]]).distanceSq));
      // Equal regional/directional weights, independent of mesh sampling density.
      regionMm[r]=(mean(forward)+mean(reverse))*.5*1000; counts[r]=forward.length+reverse.length;
      if (forward.length && reverse.length) losses.push((mean(forward.map(d=>huberLoss(d,.02)))+mean(reverse.map(d=>huberLoss(d,.02))))*.5);
    }
    const attachmentMm = Math.max(0, ...(generated.attachments ?? []).map(a => a.errorMm));
    const surfaces=new Map(Object.values(generated.meshes).flat().filter(m=>m.anatomicalName).map(m=>[m.anatomicalName!,m]));
    const anchorErrors: number[]=[];
    for(const side of ['L','R'] as const) {
      const id=`asis_${side}` as const, observation=analysis.landmarks[id], support=surfaces.get(`ilium_wing_${side}`);
      if (!support?.surfaceGrid || !observation?.locked) continue;
      const point=patchPoint(support,samplePatch(support,.99,.015)).point;
      anchorErrors.push(Math.hypot(point[0]*factors.lateral-observation.positionMeters[0],point[1]*factors.vertical-observation.positionMeters[1],point[2]*factors.lateral-observation.positionMeters[2]));
    }
    for(const [id,surfaceId,v] of [['pubis','pubic_ramus_L',.97],['xiphoid','sternum',.99]] as const) {
      const observation=analysis.landmarks[id], support=surfaces.get(surfaceId);
      if(!support?.surfaceGrid || !observation?.locked)continue;
      const point=patchPoint(support,samplePatch(support,.25,v)).point;
      // Pubis observation is the symphysis; the ramus patch lies just beside it.
      anchorErrors.push(Math.hypot((id==='pubis'?0:point[0])*factors.lateral-observation.positionMeters[0],point[1]*factors.vertical-observation.positionMeters[1],point[2]*factors.lateral-observation.positionMeters[2]));
    }
    const landmarkMm=Math.max(0,...anchorErrors)*1000;
    return { loss: mean(anchorErrors.map(d=>huberLoss(d,.02)))*2 + mean(losses) + (attachmentMm/1000)**2 * 4, mm: mean(regions.map(r=>regionMm[r])), regionMm, counts, attachmentMm, landmarkMm };
  };
  let best = evaluate(current), bestScore = best.loss;
  const baseline = best, accepted: string[] = [];
  const tryCandidate = (candidate: AnatomyParameters, name: string) => {
    const result = evaluate(candidate);
    // A small total gain cannot hide a large regional regression or broken insertion.
    let priorCost=0;
    for (const {key,step} of supportControls) priorCost+=((candidate[key]-initial[key])/step)**2 * .000002;
    for (const template of templates) for (const side of ['L','R'] as const) {
      const id: MuscleId=`${template}.${side}`, prior=initial.definition?.muscles[id] ?? muscleDefaults, shape=candidate.definition?.muscles[id] ?? muscleDefaults;
      for (const field of ['width','depth'] as const) priorCost+=((shape[field]-prior[field])/.15)**2 * .000002;
    }
    for (const side of ['L','R'] as const) {
      const id=`hip_bone.${side}` as const, prior=initial.definition?.bones[id] ?? boneDefaults, shape=candidate.definition?.bones[id] ?? boneDefaults;
      for (const field of ['width','depth','height'] as const) priorCost+=((shape[field]-prior[field])/.05)**2 * .000004;
    }
    if (result.loss + priorCost >= bestScore - 1e-8 || result.landmarkMm > baseline.landmarkMm + 1 || result.attachmentMm > Math.max(2, baseline.attachmentMm + .25) || regions.some(r=>result.regionMm[r] > baseline.regionMm[r] + 2)) return false;
    Object.assign(current, candidate); best = result; bestScore=result.loss+priorCost; accepted.push(name); return true;
  };
  // First: costal/pelvic support and wall layout. Keep fat and aggregate muscle
  // volume fixed throughout this pass so tissue cannot compensate for support errors.
  const supportControls: { key: AnatomyKey; step: number }[] = [
    {key:'chestRoundness',step:.12}, {key:'ribFlare',step:.12},
    {key:'asisHeight',step:.6}, {key:'pubisHeight',step:.6},
    {key:'rectWidth',step:.4}, {key:'rectGap',step:.2}, {key:'pectoralSeparation',step:.1},
  ];
  if (analysis.hints?.surface !== 'clothed') for (const {key,step} of supportControls) {
    if (analysis.hints?.parameters?.[key] !== undefined || analysis.hints?.lockMuscleShape && ['rectWidth','rectGap','pectoralSeparation'].includes(key)) continue;
    const control = catalogue.controls.find(c=>c.key===key)!;
    for (const sign of [-1,1]) {
      const candidate=structuredClone(current), value=current[key]+step*sign;
      if(value<control.min || value>control.max || Math.abs(value-initial[key]) > step*2) continue;
      candidate[key]=value;
      if(tryCandidate(candidate, key)) break;
    }
  }
  // Pelvic bone genetics need independent landmark evidence; outer contour alone
  // cannot distinguish a wider bone from thicker gluteal or adipose tissue.
  if (!lockedDefinition && analysis.hints?.surface !== 'clothed' && Object.keys(analysis.hints?.landmarks ?? {}).some(k=>/asis|crest/.test(k))) {
    for (const field of ['width','depth','height'] as const) for (const sign of [-1,1]) {
      const candidate=structuredClone(current);
      for (const side of ['L','R'] as const) {
        const id=`hip_bone.${side}` as const, prior=initial.definition?.bones[id] ?? boneDefaults;
        const shape=candidate.definition!.bones[id] ??= {...boneDefaults}, range=boneRanges[field];
        shape[field]=Math.max(range[0],Math.min(range[1],Math.max(prior[field]*.95,Math.min(prior[field]*1.05,shape[field]+sign*.025))));
      }
      if(tryCandidate(candidate,`hip_bone.${field}`)) break;
    }
  }
  const geometryBaseline = structuredClone(current);
  if (!lockedDefinition && analysis.hints?.surface !== 'clothed') for (const template of templates) {
    const master = template.startsWith('pectoralis')?'pectoral':template==='rectus_abdominis'?'rectus':'oblique';
    if (analysis.hints?.parameters?.[master] !== undefined) continue;
    for (const field of ['width', 'depth'] as const) for (const sign of [-1,1]) {
      const candidate=structuredClone(current);
      for (const side of ['L','R'] as const) {
        const id: MuscleId=`${template}.${side}`, shape=candidate.definition!.muscles[id]!, prior=geometryBaseline.definition!.muscles[id]!;
        const range=muscleRanges[field], value=shape[field]+sign*.06;
        shape[field]=Math.max(range[0],Math.min(range[1],Math.max(prior[field]*.85,Math.min(prior[field]*1.15,value))));
      }
      if(tryCandidate(candidate,`${template}.${field}`)) break;
    }
  }
  const validationBefore=evaluate(prepared,true),validationAfter=evaluate(current,true);
  const valid=validationAfter.mm<=validationBefore.mm+.25 && regions.every(r=>validationAfter.regionMm[r]<=validationBefore.regionMm[r]+1);
  if(!valid){Object.assign(current,prepared);best=baseline;accepted.length=0;}
  return { parameters: current, evidence: {
    method:'regularized-procedural-surface',initialMm:baseline.mm,finalMm:best.mm,validationBeforeMm:validationBefore.mm,validationAfterMm:valid?validationAfter.mm:validationBefore.mm,landmarkMaxMm:best.landmarkMm,
    regions:Object.fromEntries(regions.map(r=>[r,{beforeMm:baseline.regionMm[r],afterMm:best.regionMm[r],samples:best.counts[r]}])) as TrunkFitEvidence['regions'],
    attachmentMaxMm:best.attachmentMm,evaluations,accepted,
    supportSource:Object.keys(analysis.hints?.landmarks ?? {}).some(k=>/asis|crest|pubis|xiphoid|rib/.test(k))?'hint-conditioned':'anatomical-prior',
    warnings:['Internal insertions and muscle/fat separation remain prior-dependent; surface agreement is not anatomical ground truth.',
      ...(!valid?['Trunk candidates reverted because held-out surface samples did not validate the improvement.']:[]),
      ...(analysis.hints?.surface==='clothed'?['Trunk refinement skipped for clothed input.']:[])],
  }};
}
