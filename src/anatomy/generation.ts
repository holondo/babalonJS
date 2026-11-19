import { applyTissueFit } from './tissueFit';
import { applyMuscleEnvelope, applyOutlineWarp, growFittedShell, isCostalEnvelope } from './muscleEnvelope';
import { applyPectoralContour, blendAdjacentShellEdges, easeDeltopectoralGroove } from './pectoralContour';
import { applySurfaceFit } from './surfaceFit';
import { applyBoneProportions } from './segmentProportions';
import { buildRegionalSurface, applyRegionalInternals, buildInternals, buildHumanVolumeLayers, warpMesh, inspectionData, rectusGrowthExposure } from './geometry';
import type { AnatomyMesh, AnatomyResult } from './contracts';
import type { AnatomyParameters } from './parameters';
import { defaults } from './parameters';
import { buildAdipose } from './fat';
import { applyPriorityAnatomy, priorityLayers,transferSurface } from './priority';
import type { SurfaceChange } from './regions/abdomen';
import { posteriorMuscles } from './muscleGroups';
import { applyOrderedAttachments, attachmentMetrics, seatInguinalEdges } from './attachmentPatches';
import { coverMuscles, solveTissueContact, seatRectusUnderPectorals, coverRectusTriangles } from './tissueContact';
import { signedMeshVolume, calculateNormals } from './algorithms/loft';
import { applySurfaceFollowers } from './connective';
import { applyLowerPelvisProjection } from './regions/pelvis';
import { applyFatPaint } from './fatPaint';
import { bindSkinFeatures } from './skinFeatures';
import { coverGeneticMuscles } from './bodyGeneticCovering';
import { refineNavelPatch } from './navelPatch';

const featureCharts = new Map<number, { mesh: AnatomyMesh; navel: number[] }>();

/** One geometry path for rendering and inverse fitting. No DOM or worker ownership. */
export function generateAnatomy(parameters: AnatomyParameters, requestedLayers: string[]): Omit<AnatomyResult, 'id' | 'computeMs'> {
  const data = { parameters, layers: requestedLayers };
    const p = data.parameters.boneLengthsCm || data.parameters.surfaceFit || data.parameters.tissueFit || data.parameters.skinFit ? { ...data.parameters, boneLengthsCm: undefined,surfaceFit:undefined,skinFit:undefined,tissueFit:undefined,referencePose:undefined } : data.parameters;
    const skin: AnatomyMesh = buildRegionalSurface(p);
    const rectusExposure = p.abdominalModel === 1 ? Float32Array.from({ length: skin.positions.length / 3 }, (_, vertex) => rectusGrowthExposure(p, skin.positions[vertex * 3], skin.positions[vertex * 3 + 1])) : undefined;
    const requested = new Set([...data.layers.filter(key => key !== 'adipose'), ...priorityLayers(p)]);
    const layers = [...requested];
    const lumbarContact = !!data.parameters.referencePose?.enabled && layers.includes('otherMuscles') &&
      !!(p.definition?.muscles['latissimus_dorsi.L']?.depthProfile || p.definition?.muscles['latissimus_dorsi.R']?.depthProfile);
    if (lumbarContact && !layers.includes('aponeuroses')) layers.push('aponeuroses');
    if (p.abdominalModel === 1) layers.push('rectusAbdominis', 'aponeuroses', 'abdominalCovering');
    if (layers.includes('aponeuroses') && !layers.includes('inguinalLigaments')) layers.push('inguinalLigaments');
    const fitted = data.parameters.referencePose?.enabled && data.parameters.skinFit;
    const fittedPectoral = fitted &&
      Math.max(p.pectoral, p.pectoralClavicular, p.pectoralSternal, p.pectoralCostal) > 1;
    const fittedDeltoid = fitted && p.deltoid > 1;
    const fittedLatissimus = fitted && p.skinModel === 0 && p.back > 1;
    // A fitted outline and depth profile describe the reference shell. Build
    // that shell first, then apply any increase beyond its nominal size.
    const pectoralRecipe = fittedPectoral ? { ...p, pectoral: Math.min(1, p.pectoral),
      pectoralClavicular: Math.min(1, p.pectoralClavicular), pectoralSternal: Math.min(1, p.pectoralSternal),
      pectoralCostal: Math.min(1, p.pectoralCostal) } : p;
    const inside: Record<string, AnatomyMesh[]> = p.skinModel === 1
      ? buildInternals(fittedDeltoid ? { ...pectoralRecipe, deltoid: 1 } : pectoralRecipe, layers)
      : buildHumanVolumeLayers(pectoralRecipe, layers, { deltoid: !!fittedDeltoid, latissimus: !!fittedLatissimus });
    if (p.skinModel === 1) for (const list of Object.values(inside)) for (const mesh of list) warpMesh(p, mesh);
    applyRegionalInternals(p, inside);
    if (!p.definition?.interaction?.attachments) seatInguinalEdges(inside);
    const lean = p.definition && (data.layers.includes('adipose') || p.definition.interaction?.contact || p.definition.interaction?.skinFollows) ? buildRegionalSurface({ ...p, fat: 0, lowerAbdominalFat: 0, flankFullness: 0, suprapubicFat: 0 }) : undefined;
    const anatomyMetrics = applyPriorityAnatomy(p, inside, skin, lean);
    if (p.abdominalModel === 1) seatRectusUnderPectorals(inside, skin, 1, (x, y) => rectusGrowthExposure(p, x, y));
    const interaction = p.definition?.interaction;
    const contacts = interaction?.contact ? solveTissueContact(inside, skin, lean, interaction.clearanceMm, undefined, p.abdominalModel === 1) : interaction?.skinFollows && !p.definition?.genetics ? coverMuscles(inside, skin, lean, interaction.clearanceMm, undefined, p.abdominalModel === 1) : [];
    if (p.definition?.genetics) {
      const boundary = lean ?? skin, before = boundary.positions.slice();
      coverGeneticMuscles(boundary, inside.otherMuscles ?? []);
      if (lean && skin.positions.length === before.length) {
        for (let i = 0; i < before.length; i++) skin.positions[i] += lean.positions[i] - before[i];
        skin.normals = calculateNormals(skin.positions, skin.indices);
      }
    }
    applySurfaceFollowers(Object.values(inside).flat());
    if (p.abdominalModel === 1) {
      const original = skin.positions.slice();
      coverMuscles({ rectusAbdominis: inside.rectusAbdominis, aponeuroses: inside.aponeuroses }, skin, undefined, 1, undefined, true);
      for (let i = 0; i < skin.positions.length; i += 3) {
        const weight = rectusExposure![i / 3];
        for (let k = 0; k < 3; k++) skin.positions[i + k] = original[i + k] + (skin.positions[i + k] - original[i + k]) * weight;
      }
      coverRectusTriangles(inside.rectusAbdominis ?? [], skin, 1, (x, y) => rectusGrowthExposure(p, x, y), rectusExposure);
    }
    if (p.abdominalModel === 1) skin.normals = calculateNormals(skin.positions, skin.indices);
    const originalPositions = skin.positions.length, originalIndices = skin.indices.length;
    const navel = data.parameters.referencePose?.enabled ? data.parameters.skinFit?.fittedNavel : undefined;
    const refinedNavel = !!(navel?.detail && refineNavelPatch(skin, lean, navel, p.height));
    const displayed = Object.fromEntries(Object.entries(inside).map(([layer, list]) =>
      [layer, (p.abdominalModel === 1 || layer === 'inguinalLigaments' || lumbarContact && layer === 'aponeuroses') && !requested.has(layer) ? [] : list]));
    const meshes = { ...displayed, ...(data.layers.includes('adipose') ? { adipose: buildAdipose(p, skin, lean) } : {}), skin: [skin] };
    const lumbarFascia = lumbarContact ? inside.aponeuroses?.filter(mesh=>mesh.anatomicalName?.startsWith('thoracolumbar_fascia_')) : undefined;
    const fittedMeshes = new Set([...Object.values(meshes).flat(), ...(lean ? [lean] : []), ...(lumbarFascia ?? [])]);
    skin.fitSurface=true;for(const mesh of meshes.adipose??[])mesh.fitSurface=true;
    skin.materialPositions=skin.positions.slice();
    if (data.parameters.boneLengthsCm) {
      for (const mesh of fittedMeshes) {
        applyBoneProportions(data.parameters, mesh);
        mesh.normals = calculateNormals(mesh.positions, mesh.indices);
      }
    }
    if(data.parameters.surfaceFit) for(const mesh of fittedMeshes) {
      applySurfaceFit(mesh,data.parameters.surfaceFit,data.parameters.height);mesh.normals=calculateNormals(mesh.positions,mesh.indices);
    }
    if(data.parameters.tissueFit) for(const [layer,list] of Object.entries(meshes)) {
      if(layer==='bones'||layer==='inguinalLigaments')continue;
      for(const mesh of list){applyTissueFit(mesh,data.parameters.tissueFit,data.parameters.height);mesh.normals=calculateNormals(mesh.positions,mesh.indices);}
    }
    if(data.parameters.tissueFit&&lean){applyTissueFit(lean,data.parameters.tissueFit,data.parameters.height);lean.normals=calculateNormals(lean.positions,lean.indices);}
    if (data.parameters.tissueFit && !requested.has('aponeuroses')) for (const mesh of lumbarFascia ?? []) {
      applyTissueFit(mesh,data.parameters.tissueFit,data.parameters.height);
      mesh.normals=calculateNormals(mesh.positions,mesh.indices);
    }
    const envelopeVolumes=new Map<string,{before:number;after:number}>();
    const envelopeChanges:SurfaceChange[]=[];
    for(const list of Object.values(inside))for(const mesh of list){
      const shape=mesh.anatomyId?p.definition?.muscles[mesh.anatomyId as keyof NonNullable<typeof p.definition>['muscles']]:undefined;
      const warp=shape&&(isCostalEnvelope(mesh)?shape.costalOutlineWarp:shape.outlineWarp);
      if (!shape || !(warp || shape.depthProfile || shape.costalDepthProfile)) continue;
      const id = mesh.anatomyId!, volume = envelopeVolumes.get(id) ?? { before: 0, after: 0 };
      volume.before += Math.abs(signedMeshVolume(mesh));
      const source = mesh.positions.slice(), normals = mesh.normals;
      if (warp) applyOutlineWarp(mesh, warp);
      const rectus = id.startsWith('rectus_abdominis.');
      applyMuscleEnvelope(mesh, shape, p.height, p.abdominalModel === 1 && rectus ? (x, y) => rectusGrowthExposure(p, x, y) : undefined);
      volume.after += Math.abs(signedMeshVolume(mesh));
      envelopeVolumes.set(id, volume);
      envelopeChanges.push({ source, target: mesh.positions, normals, posterior: posteriorMuscles.has(id.slice(0, -2)), rectus });
    }
    for (const mesh of inside.otherMuscles ?? []) {
      const name = mesh.anatomicalName ?? '';
      const deltoid = fittedDeltoid && /^deltoid/.test(name);
      const latissimus = fittedLatissimus && /^latissimus_dorsi_/.test(name);
      if (!deltoid && !latissimus) continue;
      if (!envelopeChanges.some(change => change.target === mesh.positions))
        envelopeChanges.push({ source: mesh.positions.slice(), target: mesh.positions, normals: mesh.normals, posterior: !!latissimus });
      if (deltoid) growFittedShell(mesh, p.deltoid, .54, .26);
      else growFittedShell(mesh, p.back, .48, .22);
    }
    for (const side of ['L', 'R'] as const) {
      const heads = ['anterior','middle','posterior'] as const;
      const deltoids = heads.map(head => inside.otherMuscles?.find(mesh => mesh.anatomyId === `deltoid_${head}.${side}`));
      const fittedDeltoids = heads.some(head => {
        const shape = p.definition?.muscles[`deltoid_${head}.${side}`];
        return shape?.outlineWarp || shape?.depthProfile;
      });
      if (fittedDeltoids) {
        if (deltoids[0] && deltoids[1]) blendAdjacentShellEdges(deltoids[0],deltoids[1]);
        if (deltoids[1] && deltoids[2]) blendAdjacentShellEdges(deltoids[1],deltoids[2]);
      }
      const contour = p.definition?.muscles[`pectoralis_major_sternocostal.${side}`]?.pectoralContour;
      if (!contour) continue;
      const fan = ['cost', 'stern', 'clav'].map(head => inside.otherMuscles?.find(mesh => mesh.anatomicalName === `pectoralis_major_${head}_${side}`));
      for (const mesh of fan) {
        if (!mesh) continue;
        if (!envelopeChanges.some(change => change.target === mesh.positions)) {
          envelopeChanges.push({ source: mesh.positions.slice(), target: mesh.positions, normals: mesh.normals });
        }
        applyPectoralContour(mesh, contour, p.height);
      }
      if (fan[0] && fan[1]) blendAdjacentShellEdges(fan[0], fan[1]);
      if (fan[1] && fan[2]) blendAdjacentShellEdges(fan[1], fan[2]);
      const deltoid = deltoids[0];
      if (fan[2] && deltoid) easeDeltopectoralGroove(fan[2], deltoid, contour.shoulderProjection, p.height);
    }
    if (fittedPectoral) {
      for (const mesh of inside.otherMuscles ?? []) {
        const head = /^pectoralis_major_(clav|stern|cost)_/.exec(mesh.anatomicalName ?? '')?.[1];
        if (!head) continue;
        const portion = head === 'clav' ? 'pectoralClavicular' : head === 'stern' ? 'pectoralSternal' : 'pectoralCostal';
        const gain = p.pectoral / pectoralRecipe.pectoral * (p[portion] / pectoralRecipe[portion]);
        if (gain <= 1) continue;
        if (!envelopeChanges.some(change => change.target === mesh.positions))
          envelopeChanges.push({ source: mesh.positions.slice(), target: mesh.positions, normals: mesh.normals });
        growFittedShell(mesh, gain);
      }
    }
    if(envelopeChanges.length){
      const before=skin.positions.slice(),leanBefore=lean?.positions.slice();transferSurface(skin,envelopeChanges,p,true);if(lean)transferSurface(lean,envelopeChanges,p,true);skin.normals=calculateNormals(skin.positions,skin.indices);
      for(const mesh of meshes.adipose??[]){for(let i=0;i<before.length;i++)mesh.positions[i]+=skin.positions[i]-before[i];if(lean&&leanBefore)for(let i=0;i<leanBefore.length;i++)mesh.positions[before.length+i]+=lean.positions[i]-leanBefore[i];mesh.normals=calculateNormals(mesh.positions,mesh.indices);}
    }
    if ((data.parameters.boneLengthsCm || data.parameters.surfaceFit || data.parameters.tissueFit || Object.values(p.definition?.muscles??{}).some(s=>s?.depthProfile||s?.costalDepthProfile||s?.outlineWarp||s?.costalOutlineWarp)) && p.definition?.interaction?.attachments) {
      // Axial proportion changes have different tissue blend weights. Resolve
      // semantic insertion patches on the final bones, not the pre-scaled bones.
      const all=Object.values(inside).flat(),surfaces=new Map(all.filter(m=>m.anatomicalName).map(m=>[m.anatomicalName!,m]));
      applyOrderedAttachments(all, surfaces);
      for (const mesh of all) if(mesh.attachments?.length) mesh.normals=calculateNormals(mesh.positions,mesh.indices);
      applySurfaceFollowers(all);
    }
    for (const metric of anatomyMetrics) {
      const volume=envelopeVolumes.get(metric.id);if(volume?.before)metric.targetCm3*=volume.after/volume.before;
      metric.actualCm3 = Object.values(inside).flat().filter(mesh => mesh.anatomyId === metric.id).reduce((sum, mesh) => sum + Math.abs(signedMeshVolume(mesh)), 0) * 1000 * p.height / 175;
      metric.error = Math.abs(metric.actualCm3 - metric.targetCm3) / metric.targetCm3;
    }
    applyLowerPelvisProjection(skin, p);
    if (lean) applyLowerPelvisProjection(lean, p);
    for (const mesh of meshes.adipose ?? []) applyLowerPelvisProjection(mesh, p);
    applyFatPaint(skin, meshes.adipose?.[0], p);
    const inspection = inspectionData(p);
    let chart = featureCharts.get(p.skinModel);
    if (!chart) {
      const neutral = { ...defaults, skinModel: p.skinModel };
      chart = { mesh: buildRegionalSurface(neutral), navel: inspectionData(neutral).navel };
      featureCharts.set(p.skinModel, chart);
    }
    const sameTopology = chart.mesh.positions.length === originalPositions && chart.mesh.indices.length === originalIndices;
    skin.skinFeatures = bindSkinFeatures(sameTopology ? chart.mesh : skin, p, sameTopology ? chart.navel : inspection.navel);
    skin.skinFeatures.smoothFittedNavelTip = !!data.parameters.skinFit?.fittedNavel;
    skin.skinFeatures.refinedNavel = refinedNavel;
    return { meshes, anatomyMetrics, attachments: attachmentMetrics(Object.values(inside).flat()), contacts, contactLean: interaction?.contact ? lean : undefined, lumbarFascia, ...inspection };
}
