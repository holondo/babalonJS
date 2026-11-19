import { generateAnatomy } from '../generation';
import { muscleDefaults,interactionDefaults, type MuscleId, type MuscleTemplate } from '../definition';
import { posedPositions, normalizePose } from '../pose';
import { envelopeBasis, envelopeWeight, shiftedEnvelopeU, isCostalEnvelope, envelopeTravelLimit } from '../muscleEnvelope';
import { canonicalAnatomyFactors,sourcePointToCanonical,type SourceCanonicalFrame } from '../binding/anatomySkinDrive';
import type { AnatomyParameters } from '../parameters';
import type { BodyHints } from './bodyEvidence';
import type { Vec3M } from '../landmarks';
import { SurfaceBVH } from './observationProxy';
import { registerSurface } from './surfaceRegistration';
import { fatThickness, fatRegions, fatRegionWeights } from '../fatDistribution';
import { superficialLandmarks,rectusGrowthExposure,rectusIntersectionPosition,rectusChartY } from '../geometry';
import type { TissueHintName } from '../tissueFit';
import { axillaryProjectionWeight, pectoralStations, pectoralCoveringBasis, deltopectoralCoveringBasis } from '../pectoralContour';
import { armSections, fitArmSilhouette } from './armSections';
import { skinFeatureCoordinates } from '../skinFeatures';
import { segmentRectus, type RectusSegmentation } from './rectusSegmentation';
import { fitAbdominalCovering } from './abdominalCovering';
import { fitAbdominalDetails } from './abdominalDetails';
import { fitBentArmCovering, fitPectoralSkin } from './pectoralSkinFit';
import { coverageGaps, coverageSetup, facesObservedEnvelope, outlineKey, outlineMeshes, outlineMisfit, outlineMoves, outlineSamples, outlineStretch, type OutlineFitEntry } from './outlineFit';

// Superficial muscles whose outer shell faces the skin. Deep muscles under
// them (brachialis, triceps medial head, most forearm bellies) would read the
// covering muscle as their own available space, so they keep their prior.
// The middle trapezius is a thin sheet over rhomboids and erectors: its rays
// gave asymmetric gains without held-out improvement, so it is left out.
const templates:MuscleTemplate[]=['pectoralis_major_clavicular','pectoralis_major_sternocostal','deltoid_anterior','deltoid_middle','deltoid_posterior','rectus_abdominis','external_oblique',
  'trapezius_upper','latissimus_dorsi','biceps_brachii_long','biceps_brachii_short','triceps_brachii_long','triceps_brachii_lateral','brachioradialis'];
function anteriorDepth(surface: SurfaceBVH, x: number, y: number) {
  return surface.queryRay([x, y, .6], [0, 0, -1], .65)?.point[2];
}
export interface VolumeFitEvidence {
  abdominalCovering?: ReturnType<typeof fitAbdominalCovering>;
  abdominalDetails?: ReturnType<typeof fitAbdominalDetails>;
  pectoralSkin?: ReturnType<typeof fitPectoralSkin>;
  rectusDivisions?: Record<string, { observedY: number; reliefMm: number; support: number; authoredY: number; observed: boolean; confidence: number }[]>;
  rectusSegmentation?: RectusSegmentation;
  abdominalValidation?: Record<string, { samples: number; beforeMm: number; afterMm: number; outsideReserve: number; beyondSkinRay: number }>;
  /** Held-out envelope error for every fitted superficial muscle (every fifth sampled vertex). */
  outlineFit?: Record<string, OutlineFitEntry>;
  resolutionStudy?: Record<string, { coarseMm: number; fineMm: number; nearestMm: number; samples: number }>;
  muscleValidation?: Record<string, { samples: number; beforeMm: number; afterMm: number; outsideReserve: number; beyondSkinRay: number;
    /** Error budget: the 5x3 depth profile cannot represent the target; growth caps; later stages moving the shell. */
    profileMm?: number; capMm?: number; pipelineMm?: number }>;
  pectoralContours?: Partial<Record<'L' | 'R', { lift: number[]; projection: number[]; shoulderProjection?: number[]; axillaryProjection?: number; covering?: number[]; transitionCovering?: number[] }>>;
  axillaryFit?: Partial<Record<'L' | 'R', { samples: number; beforeMm: number; afterMm: number; accepted: boolean }>>;
  armSilhouette?: ReturnType<typeof fitArmSilhouette>;
  reusedReferenceSurface?: boolean;
  method:'fixed-skeleton-muscle-envelope';muscles:number;samples:number;
  fatReserveMm:number;envelopeBeforeMm:number;envelopeAfterMm:number;
  fatDistribution:NonNullable<AnatomyParameters['fatDistribution']>;fatPriorMm:NonNullable<AnatomyParameters['fatDistribution']>;
  regions:Record<string,{beforeMm:number;afterMm:number}>;
  skin:ReturnType<typeof registerSurface>['evidence'];
  profiles:Record<string,number[]>;
}
/** Linear least-squares profile estimation from directional skin intersections.
 * It fits available muscle space below an explicit fat prior, rather than
 * confusing nearest skin distance with observable internal anatomy. */
export function fitVolumes(parameters:AnatomyParameters,target:SurfaceBVH,hints:BodyHints,frame:SourceCanonicalFrame,progress?:(stage:string,fraction:number)=>void, originalSurface?:()=>SurfaceBVH){
  const p=structuredClone(parameters),f=canonicalAnatomyFactors(p.height),zero=normalizePose({});
  p.skinFit=undefined;
  const unlocked=!hints.lockMuscleShape&&hints.surface!=='clothed';
  if(unlocked){
    for(const chain of p.referencePose?.chains ?? [])delete chain.radialFit;
    p.definition??={version:1,muscles:{},bones:{}};
    p.definition.interaction??={...interactionDefaults,attachments:true};
    for(const template of templates)for(const side of ['L','R'] as const){
      const id:MuscleId=`${template}.${side}`;
      const shape = p.definition.muscles[id] ??= { ...muscleDefaults };
      if(template==='rectus_abdominis'&&shape.width===1&&!shape.widthProfile){
        shape.width=Math.max(.9,Math.min(1.35,p.waistWidth*175/p.height/29));
      }
      shape.depthProfile = undefined;
      shape.outlineWarp = undefined;
      shape.costalOutlineWarp = undefined;
      shape.costalDepthProfile = undefined;
      shape.pectoralContour = undefined;
      if (template === 'rectus_abdominis' && p.abdominalModel === 1) shape.fittedWidthProfile = undefined;
    }
  }
  progress?.('Measuring muscle envelopes',.08);
  const baselineSkin=generateAnatomy(parameters,[]).meshes.skin[0],baselinePositions=posedPositions(baselineSkin,parameters,zero);
  const layers=['bones','otherMuscles','rectusAbdominis','externalOblique','inguinalLigaments'];
  let generated=generateAnatomy(p,layers);
  const rectusDivisions: NonNullable<VolumeFitEvidence['rectusDivisions']> = {};
  let rectusSegmentation: RectusSegmentation | undefined;
  const reliefTarget = unlocked && p.abdominalModel === 1 ? originalSurface?.() ?? target : target;
  if (unlocked && p.abdominalModel === 1) {
    const navel = hints.tissues?.navel;
    // Tendinous grooves can be shallower than the simplification tolerance.
    rectusSegmentation = segmentRectus(reliefTarget, navel?.length === 3 ? sourcePointToCanonical(frame, navel[0], navel[1], navel[2]) : undefined);
    // Map observed heights through the rectus's own continuous shell: it is
    // registered to the body separately from the skin, so the skin chart
    // would misplace its grooves by centimetres.
    const probe = structuredClone(p);
    for (const side of ['L','R'] as const) probe.definition!.muscles[`rectus_abdominis.${side}`]!.fittedIntersections = [{position:.5,angle:0,curvature:0,width:1,depth:0,extent:.86}];
    const shells = generateAnatomy(probe,['rectusAbdominis']).meshes.rectusAbdominis ?? [];
    for (const side of ['L','R'] as const) {
      const id = `rectus_abdominis.${side}` as const, shape = p.definition!.muscles[id]!, found = rectusSegmentation.sides[side];
      const shell = shells.find(mesh => mesh.anatomyId === id && mesh.surfaceGrid && mesh.anatomicalName?.endsWith('_continuous'));
      if (shape.intersections || !found || !shell) continue;
      const { rows, cols } = shell.surfaceGrid!, column = Math.round(cols * .4), posedShell = posedPositions(shell,probe,zero);
      const heights = Array.from({length:rows+1},(_,j)=>posedShell[(j*(cols+1)+column)*3+1]*f.vertical);
      const detected = found.intersections.map(item => {
        let authoredY = NaN;
        for (let j = 0; j < rows; j++) {
          const a = heights[j], b = heights[j+1];
          if ((a - item.y) * (b - item.y) > 0 || a === b) continue;
          authoredY = rectusChartY(p, column / cols, (j + (item.y - a) / (b - a)) / rows);
          break;
        }
        return {observedY:item.y,reliefMm:item.prominenceMm,support:item.support,authoredY,observed:item.observed,confidence:item.confidence};
      });
      if (detected.some(g=>!Number.isFinite(g.authoredY))) continue;
      const positions=detected.map(g=>rectusIntersectionPosition(p,g.authoredY));
      if (positions.some(v=>v<.08||v>.92)||positions.some((v,i)=>i>0&&positions[i-1]-v<.05)) continue;
      // Measured grooves set their own depth and slant; inferred ones stay shallow and level.
      shape.fittedIntersections=positions.map((_,i)=>{
        const item=found.intersections[i];
        const angle = item.angleDeg * Math.min(1, item.support / .8);
        // The inversion samples column .4; the authored line pivots at .5.
        const halfWidth = found.width * .1 / f.lateral;
        const curvature = Math.max(-.065, Math.min(.065,item.bow/f.vertical));
        const center = rectusIntersectionPosition(p, detected[i].authoredY + Math.tan(angle * Math.PI / 180) * halfWidth - .96*curvature);
        return {position:Math.max(.08,Math.min(.92,center)),angle,curvature,width:1,
          depth:item.observed?Math.max(.18,Math.min(.7,.15+.12*item.prominenceMm)):.22,extent:.86};
      });
      rectusDivisions[side]=detected;
    }
  }
  if (Object.keys(rectusDivisions).length) generated=generateAnatomy(p,layers);
  if (Object.keys(rectusDivisions).length) {
    const skin=generated.meshes.skin[0], posed=posedPositions(skin,p,zero);
    const reference=new SurfaceBVH({positions:posed.map((value,i)=>value*(i%3===1?f.vertical:f.lateral)),indices:skin.indices});
    for (const side of ['L','R'] as const) {
      const shape=p.definition!.muscles[`rectus_abdominis.${side}`]!, divisions=rectusDivisions[side];
      if (!divisions?.length || shape.intersections) continue;
      const found=rectusSegmentation?.sides[side], navelY=rectusSegmentation?.navel.y??1.09;
      const levels=[Math.min(found?Math.min(...found.fold)-.004:1.305,divisions[0].observedY+.07),...divisions.map(d=>d.observedY),Math.min(divisions.at(-1)!.observedY-.04,navelY-.055)];
      const sign=side==='L'?-1:1;
      shape.fittedBellies=levels.slice(0,-1).map((top,i)=>{
        const rows:{width:number;peak:number;projection:number}[]=[];
        for(const t of [.3,.5,.7]){
          const y=levels[i+1]+(top-levels[i+1])*t;
          const border = found?.border.reduce<[number,number] | undefined>((nearest, row) =>
            !nearest || Math.abs(row[0]-y)<Math.abs(nearest[0]-y) ? row : nearest, undefined);
          const limit = border && Math.abs(border[0]-y)<.035 ? border[1] : found?.width ?? .102;
          const x=Array.from({length:16},(_,j)=>.012+j*(limit-.012)/15);
          const depths=x.map(v=>anteriorDepth(reliefTarget,sign*v,y));
          if(depths.some(v=>v===undefined))continue;
          const z=depths as number[], relief=z.map((v,j)=>v-(z[0]+(z.at(-1)!-z[0])*j/(z.length-1)));
          const peak=relief.indexOf(Math.max(...relief));
          if(peak<2||peak>11||relief[peak]<.0015)continue;
          let edge=peak;
          while(edge+1<z.length&&relief[edge+1]>relief[peak]*.28)edge++;
          const generatedDepth=anteriorDepth(reference,sign*x[peak],y);
          if(generatedDepth===undefined)continue;
          const width=x[edge]-x[0];
          // The section profile follows the semilunaris. The belly profile
          // describes the local dome inside that margin.
          rows.push({width:Math.max(.85,Math.min(1.18,1+.65*(width/Math.max(.02,limit-.012)-.72))),
            peak:Math.max(.32,Math.min(.68,(x[peak]-x[0])/Math.max(.02,width))),
            projection:Math.max(0,Math.min(12,(z[peak]-generatedDepth)*1000*(i===levels.length-2?.55:.8)))});
        }
        const mean=(key:'width'|'peak'|'projection',fallback:number)=>rows.length>=2?rows.reduce((sum,row)=>sum+row[key],0)/rows.length:fallback;
        return {width:mean('width',1),peak:mean('peak',.5),projection:mean('projection',0)};
      });
    }
    generated=generateAnatomy(p,layers);
  }
  // Fit the rectus margin before measuring envelopes, so depth observations
  // and their validation refer to the final section width.
  if (unlocked && p.abdominalModel === 1) {
    const skin = generated.meshes.skin[0];
    const positions = posedPositions(skin, p, zero);
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] *= f.lateral;
      positions[i + 1] *= f.vertical;
      positions[i + 2] *= f.lateral;
    }
    const procedural = new SurfaceBVH({ positions, indices: skin.indices });
    for (const side of ['L', 'R'] as const) {
      const id = `rectus_abdominis.${side}` as const;
      const shape = p.definition!.muscles[id]!;
      let low = Infinity, high = -Infinity;
      const points: number[] = [];
      for (const mesh of generated.meshes.rectusAbdominis) if (mesh.anatomyId === id) {
        const posed = posedPositions(mesh, p, zero);
        for (let i = 0; i < posed.length; i += 3) {
          low = Math.min(low, posed[i + 1] * f.vertical);
          high = Math.max(high, posed[i + 1] * f.vertical);
          points.push(Math.abs(posed[i] * f.lateral), posed[i + 1] * f.vertical);
        }
      }
      if (!(high > low)) continue;
      const sign = side === 'L' ? -1 : 1, border = rectusSegmentation?.sides[side]?.border ?? [];
      // The linea semilunaris is the rectus margin itself. Each measured row
      // gives the scale that brings the generated lateral edge to the groove
      // (the fleshy edge lies about a centimetre medial to the groove centre).
      const ratios = border.flatMap(([y, x]) => {
        let medial = Infinity, lateral = 0;
        for (let i = 0; i < points.length; i += 2) if (Math.abs(points[i + 1] - y) < .01) { medial = Math.min(medial, points[i]); lateral = Math.max(lateral, points[i]); }
        return lateral - medial > .015 ? [[y, Math.max(.85, Math.min(2, (x - .012 - medial) / (lateral - medial)))]] : [];
      });
      const measuredScale = (y: number) => {
        if (!ratios.length) return;
        // Above the highest visible groove the rectus runs under the costal
        // margin and pectoral at its full width: keep that ratio up to its top.
        // The highest groove rows can follow the costal margin inward, so use
        // the widest ratio of the top 6 cm.
        const highest = ratios.reduce((best, row) => row[0] > best[0] ? row : best);
        if (y >= highest[0]) return Math.max(...ratios.filter(row => row[0] >= highest[0] - .06).map(row => row[1]));
        const [height, ratio] = ratios.reduce((best, row) => Math.abs(row[0] - y) < Math.abs(best[0] - y) ? row : best);
        // Below the navel the rectus keeps most of its width down to the pubic tendon.
        const fade = Math.max(0, 1 - Math.max(0, Math.abs(height - y) - .02) / .2);
        return fade > 0 ? 1 + (ratio - 1) * fade : undefined;
      };
      const stations = ratios.length ? 9 : 5;
      const profile = Array.from({ length: stations }, (_, station) => {
        const y = low + (high - low) * station / (stations - 1);
        const measured = measuredScale(y);
        if (measured !== undefined) return measured;
        if (y < .94 || y > 1.23) return 1;
        const ratios: number[] = [];
        for (const z of [-.045, -.015, .015, .045, .075]) {
          const origin: Vec3M = [sign * .42, y, z], direction: Vec3M = [-sign, 0, 0];
          const a = procedural.queryRay(origin, direction, .36), b = target.queryRay(origin, direction, .36);
          if (!a || !b || Math.abs(b.point[0] - a.point[0]) > .055) continue;
          ratios.push(b.point[0] / a.point[0]);
        }
        if (ratios.length < 3) return 1;
        ratios.sort((a, b) => a - b);
        // External width is a weak prior for the rectus margin. The obliques
        // and subcutaneous fat also contribute to the observed silhouette.
        return Math.max(.92, Math.min(1.16, 1 + .6 * (ratios[Math.floor(ratios.length / 2)] - 1)));
      });
      // Silhouette ratios are noisy and get smoothed; measured margins are kept.
      shape.fittedWidthProfile = ratios.length ? profile : profile.map((value, i) => (2 * value + (profile[i - 1] ?? value) + (profile[i + 1] ?? value)) / 4);
    }
    generated=generateAnatomy(p,layers);
  }
  // Move superficial footprints to where the skin shows them, then fit thickness.
  // Coordinate search: every regeneration tries one move on all muscles at
  // once (their skin rays are independent); each keeps it only if its own
  // held-out thickness error drops.
  const outlineFit: Record<string, OutlineFitEntry> = {};
  if (unlocked) {
    const field = (key: string) => key.endsWith(':costal') ? 'costalOutlineWarp' as const : 'outlineWarp' as const;
    const shapeOf = (key: string) => p.definition!.muscles[key.split(':')[0] as MuscleId];
    // Score: held-out thickness error plus half the coverage gap of the skin
    // assigned to the muscle (assignment fixed from the template position).
    const coverage = coverageSetup(outlineMeshes(generated.meshes),p,zero,target,f);
    const lumbarCoverage = new Map<string,number[]>();
    for (const [key, points] of coverage) {
      if (!key.startsWith('latissimus_dorsi.')) continue;
      const lower: number[] = [];
      for (let i=0;i<points.length;i+=4) {
        const x=Math.abs(points[i]), y=points[i+1];
        if (x>=.04 && x<=.2 && y>=.93 && y<=1.17) lower.push(...points.slice(i,i+4));
      }
      if (lower.length>=32) lumbarCoverage.set(key,lower);
    }
    const score = (meshes: typeof generated.meshes) => new Map(outlineMeshes(meshes).map(mesh => {
      const posed = posedPositions(mesh,p,zero), key = outlineKey(mesh)!;
      const samples = outlineSamples(mesh,p,posed,target,f);
      const [gap, lumbar] = coverageGaps(mesh,posed,f,coverage.get(key),lumbarCoverage.get(key));
      return [key, { misfit: outlineMisfit(samples) + .5 * gap + lumbar, gap, lumbar, samples: samples.length, stretch: outlineStretch(mesh) }] as const;
    }));
    const best = new Map<string, { coefficients: number[]; misfit: number }>(), baseStretch = new Map<string, number>();
    const gaps = new Map<string, number>(), lumbarBaseline = new Map<string,number>();
    for (const [key, { misfit, samples, stretch, gap, lumbar }] of score(generated.meshes)) {
      if (!Number.isFinite(misfit) || !shapeOf(key)) continue;
      baseStretch.set(key, stretch); gaps.set(key, gap);
      if (lumbarCoverage.has(key)) lumbarBaseline.set(key,lumbar);
      best.set(key, { coefficients: [0,0,0,0,0,0], misfit });
      outlineFit[key] = { coefficients: [0,0,0,0,0,0], beforeMm: misfit, afterMm: misfit, samples, coverageBeforeMm: gap, coverageAfterMm: gap };
      if (lumbarCoverage.has(key)) outlineFit[key].lumbarBeforeMm = outlineFit[key].lumbarAfterMm = lumbar;
    }
    const shearMoves = [.09,.04].flatMap(step => [4,5].flatMap(index => [{index,step},{index,step:-step}]));
    const moves = [...outlineMoves,...shearMoves];
    const canShear = /^(deltoid_|trapezius_upper\.|latissimus_dorsi\.)/;
    for (const [m, move] of moves.entries()) {
      if (!best.size) break;
      progress?.('Fitting muscle outlines',.08+.1*m/moves.length);
      for (const [key, state] of best) {
        const trial = state.coefficients.slice();
        if (move.index < 4 || canShear.test(key)) trial[move.index] += move.step;
        shapeOf(key)![field(key)] = trial.map((value,i)=>Math.max(i<2?-.2:-.35,Math.min(i<2?.2:.35,value)));
      }
      const scored = score(generateAnatomy(p,layers).meshes);
      for (const [key, state] of best) {
        if (move.index >= 4 && !canShear.test(key)) continue;
        const result = scored.get(key), misfit = result?.misfit ?? Infinity;
        // A tearing warp (stretched triangles, a flap off the body) is never kept.
        if (!result || result.stretch > baseStretch.get(key)! * 1.3) continue;
        if (lumbarBaseline.has(key) && result.lumbar > lumbarBaseline.get(key)! + .35) continue;
        if (canShear.test(key) && result.gap > (outlineFit[key].coverageBeforeMm ?? 0) + .5) continue;
        if (misfit < state.misfit - .05) {
          best.set(key, { coefficients: shapeOf(key)![field(key)]!.slice(), misfit }); gaps.set(key, result.gap);
          if (lumbarCoverage.has(key)) outlineFit[key].lumbarAfterMm = result.lumbar;
        }
      }
    }
    for (const [key, state] of best) {
      const changed = state.coefficients.some(Boolean);
      shapeOf(key)![field(key)] = changed ? state.coefficients : undefined;
      outlineFit[key].coefficients = state.coefficients; outlineFit[key].afterMm = state.misfit; outlineFit[key].coverageAfterMm = gaps.get(key);
    }
    if (best.size) generated = generateAnatomy(p,layers);
  }
  const groups=new Map<string,{id:MuscleId;costal:boolean;a:number[][];b:number[];count:number}>(),fat=Math.max(2,Math.min(35,hints.parameters?.fat??p.fat));
  if(!p.fatDistribution||hints.parameters?.fat!==undefined)p.fatDistribution=Object.fromEntries(fatRegions.map(key=>[key,fat])) as NonNullable<AnatomyParameters['fatDistribution']>;
  const observations:{groupKey:string;id:MuscleId;name:string|undefined;vertex:number;u:number;v:number;desired:Vec3M;inner:Vec3M;normal:Vec3M;thickness:number;w:number;basis:number[];availableMm:number;fatWeights:number[];weight:number;validation:boolean}[]=[];
  const fatPrior=structuredClone(hints.parameters?.fat!==undefined?p.fatDistribution:p.fatPriorDistribution??p.fatDistribution);
  p.fatDistribution=structuredClone(fatPrior);p.fatPriorDistribution=structuredClone(fatPrior);
  // Read both superficial abdominal muscles in the same transverse sections.
  // Near their boundary the same skin evidence is shared, not counted twice.
  const section = (y: number) => Math.round(y / .025);
  const margins = { L: new Map<number, number>(), R: new Map<number, number>() };
  if (unlocked) for (const mesh of generated.meshes.rectusAbdominis ?? []) {
    if (!mesh.shellPairs || !mesh.anatomyId) continue;
    const side = mesh.anatomyId.endsWith('.L') ? 'L' : 'R', posed = posedPositions(mesh,p,zero);
    for (let i=0;i<mesh.shellPairs*3;i+=3) {
      const row = section(posed[i+1]*f.vertical);
      margins[side].set(row,Math.max(margins[side].get(row)??0,Math.abs(posed[i]*f.lateral)));
    }
  }
  let before=0,samples=0;
  const armDepth = armSections(p,target);
  if(unlocked)for(const list of Object.values(generated.meshes))for(const mesh of list){
    const id=mesh.anatomyId as MuscleId|undefined;if(!id||!templates.some(t=>id===`${t}.L`||id===`${t}.R`)||!mesh.shellPairs||!mesh.surfaceGrid)continue;
    const costal=isCostalEnvelope(mesh),groupKey=costal?id+":costal":id;
    const limb = /^(biceps_brachii_|triceps_brachii_|brachioradialis\.)/.test(id);
    const size = limb || /^(rectus_abdominis|external_oblique)\./.test(id) ? 45 : 15;
    const{rows,cols}=mesh.surfaceGrid,n=mesh.shellPairs,posed=posedPositions(mesh,p,zero),group=groups.get(groupKey)??{id,costal,a:Array.from({length:size},()=>new Array(size).fill(0)),b:new Array(size).fill(0),count:0};groups.set(groupKey,group);
    for(let vertex=0;vertex<n;vertex+=2){
      const u=Math.floor(vertex/(cols+1))/rows,v=vertex%(cols+1)/cols,w=envelopeWeight(mesh,u)*(p.abdominalModel===1&&id.startsWith('rectus_abdominis.')?rectusGrowthExposure(p,mesh.positions[vertex*3],mesh.positions[vertex*3+1]):1);if(w<.2||v<.08||v>.92)continue;
      const a=vertex*3,b=(vertex+n)*3,outer=[posed[a]*f.lateral,posed[a+1]*f.vertical,posed[a+2]*f.lateral] as Vec3M,inner=[posed[b]*f.lateral,posed[b+1]*f.vertical,posed[b+2]*f.lateral] as Vec3M;
      if(id.startsWith('rectus')&&(outer[1]>1.235||outer[1]<.9))continue;
      const rectus = id.startsWith('rectus_abdominis.'), oblique = id.startsWith('external_oblique.');
      if(oblique&&(outer[1]>1.24||Math.abs(outer[0])<.045))continue;
      const margin = (rectus || oblique) ? margins[id.endsWith('.L')?'L':'R'].get(section(outer[1])) : undefined;
      const t = margin === undefined ? 0 : Math.max(0,Math.min(1,(Math.abs(outer[0])-margin+.025)/.05));
      const lateralShare = t*t*(3-2*t);
      const share = margin === undefined ? 1 : rectus ? 1-lateralShare : lateralShare;
      if (share < .02) continue;
      const delta=outer.map((x,k)=>x-inner[k]),thickness=Math.hypot(...delta);if(thickness<.001||thickness>.06)continue;
      const normal=delta.map(x=>x/thickness) as Vec3M;
      // The lateral fan also wraps toward the arm. Only its posterior
      // surface can be matched to the visible back with these rays.
      if (!facesObservedEnvelope(id,outer,normal)) continue;
      const origin=inner.map((x,k)=>x-normal[k]*.006) as Vec3M,hit=target.queryRay(origin,normal,.20);if(!hit)continue;
      if ((rectus || oblique) && Math.abs(hit.point[1]-outer[1]) > .03) continue;
      let skinDistance=hit.distance-.006;
      if (limb) {
        const depth = armDepth(id.endsWith('.L')?-1:1,id.startsWith('brachioradialis.'),outer,normal,thickness);
        if (depth!==undefined && Math.abs(depth-skinDistance)<.035) skinDistance=.25*skinDistance+.75*depth;
      }
      // Keep front-facing belly measurements on the same chest/abdomen
      // cross-section. Oblique rays can jump across an infrapectoral fold.
      if(normal[2]>.75&&(id.startsWith('pectoralis')||id.startsWith('rectus'))){
        const depth=anteriorDepth(target,outer[0],outer[1]);
        if(depth!==undefined){
          const projected=thickness+(depth-outer[2])/normal[2];
          if(Math.abs(projected-skinDistance)<.04)skinDistance=.25*skinDistance+.75*projected;
        }
      }
      const available=skinDistance-fatThickness(p,outer)/1000;if(available<-.02||available>.10)continue;
      const basis=new Array(size).fill(0);envelopeBasis(shiftedEnvelopeU(u, p.definition?.muscles[id]?.peakOffset),v,(j,x)=>basis[j]=x,size);
      const weight=Math.max(.15,Math.min(1,thickness/.008))*w*w*share;
      const validation = vertex % 5 === 0;
      if (!validation) group.count++;
      samples++;before+=Math.abs(available-thickness)*1000;
      observations.push({groupKey,id,name:mesh.anatomicalName,vertex,u:shiftedEnvelopeU(u, p.definition?.muscles[id]?.peakOffset),v,desired:inner.map((x,k)=>x+normal[k]*available) as Vec3M,inner,normal,thickness,w,basis,availableMm:(skinDistance-thickness)*1000,fatWeights:fatRegionWeights(outer),weight,validation});
    }
  }
  progress?.('Fitting muscle profiles',.25);
  const profiles:Record<string,number[]>={};
  const solve=(matrix:number[][],rhs:number[])=>{
    const size=rhs.length,a=matrix.map((row,j)=>[...row,rhs[j]]);
    for(let j=0;j<size;j++){let pivot=j;for(let r=j+1;r<size;r++)if(Math.abs(a[r][j])>Math.abs(a[pivot][j]))pivot=r;[a[j],a[pivot]]=[a[pivot],a[j]];const divisor=a[j][j];if(Math.abs(divisor)<1e-9)continue;for(let k=j;k<=size;k++)a[j][k]/=divisor;for(let r=0;r<size;r++)if(r!==j){const q=a[r][j];for(let k=j;k<=size;k++)a[r][k]-=a[j][k]*q;}}return a.map(row=>row[size]);
  };
  const training = observations.filter(o => !o.validation);
  // Alternate two small regularized linear solves over cached real ray hits.
  // There is no expensive full-generator evaluation per parameter trial.
  for(let iteration=0;iteration<8;iteration++){
    for(const g of groups.values()){g.a.forEach(row=>row.fill(0));g.b.fill(0);}
    for(const o of training){const g=groups.get(o.groupKey)!,mask=o.fatWeights.reduce((s,w)=>s+w,0),reserved=(1-mask)*fat+o.fatWeights.reduce((s,w,i)=>s+w*p.fatDistribution![fatRegions[i]],0),y=o.availableMm-reserved,coeff=o.basis.map(v=>v*o.thickness*1000*o.w);for(let j=0;j<g.b.length;j++){g.b[j]+=coeff[j]*y*o.weight;for(let k=0;k<g.b.length;k++)g.a[j][k]+=coeff[j]*coeff[k]*o.weight;}}
    for (const [groupKey,g] of groups) {
      if (g.count < 12) continue;
      const columns = g.b.length === 45 ? 5 : 3;
      const shoulder = g.id.startsWith('deltoid_');
      const regularity = Math.max(1,g.count*(shoulder ? .85 : g.b.length === 45 ? .16 : .5));
      for (let j = 0; j < g.b.length; j++) {
        g.a[j][j] += shoulder ? Math.max(.2,g.count*.018) : .2;
        for (const k of [j%columns<columns-1?j+1:-1,j+columns<g.b.length?j+columns:-1]) if (k >= 0) {
          g.a[j][j] += regularity; g.a[k][k] += regularity;
          g.a[j][k] -= regularity; g.a[k][j] -= regularity;
        }
      }
      const profile = solve(g.a,g.b).map(v=>Math.max(.35,Math.min(20,1+v)));
      p.definition!.muscles[g.id]![g.costal?'costalDepthProfile':'depthProfile'] = profile;
      profiles[groupKey] = profile;
    }
    if(hints.parameters?.fat!==undefined)continue;
    const a=Array.from({length:4},()=>new Array(4).fill(0)),b=new Array(4).fill(0),counts=new Array(4).fill(0);
    for(const o of training){const profile=profiles[o.groupKey];if(!profile)continue;const gain=o.basis.reduce((s,w,i)=>s+w*(profile[i]-1),0),mask=o.fatWeights.reduce((s,w)=>s+w,0),y=o.availableMm-gain*o.thickness*1000*o.w-(1-mask)*fat;for(let j=0;j<4;j++){counts[j]+=o.fatWeights[j]*o.weight;b[j]+=o.fatWeights[j]*y*o.weight;for(let k=0;k<4;k++)a[j][k]+=o.fatWeights[j]*o.fatWeights[k]*o.weight;}}
    for(let j=0;j<4;j++){const regularity=1+counts[j]*2;a[j][j]+=regularity;b[j]+=regularity*fatPrior[fatRegions[j]];}
    solve(a,b).forEach((value,i)=>{const key=fatRegions[i],prior=fatPrior[key];p.fatDistribution![key]=Math.max(2,Math.min(35,Math.max(prior-6,Math.min(prior+6,value))));});
  }
  // Evaluate the same correspondences under the final fat allocation.
  before=0;
  for(const o of observations){const mask=o.fatWeights.reduce((s,w)=>s+w,0),reserved=(1-mask)*fat+o.fatWeights.reduce((s,w,i)=>s+w*p.fatDistribution![fatRegions[i]],0),desired=o.thickness+(o.availableMm-reserved)/1000;o.desired=o.inner.map((v,k)=>v+o.normal[k]*desired) as Vec3M;before+=Math.abs(desired-o.thickness)*1000;}

  let fitted=generateAnatomy(p,layers);
  const pectoralContours: NonNullable<VolumeFitEvidence['pectoralContours']> = {};
  const foldSamples = new Map<'L' | 'R', { lift: (number | undefined)[]; projection: number[] }>();
  if (unlocked) for (const side of ['L','R'] as const) {
    const muscle = fitted.meshes.otherMuscles?.find(mesh => mesh.anatomicalName === `pectoralis_major_cost_${side}`);
    if (!muscle?.surfaceGrid || !muscle.shellPairs) continue;
    const positions = posedPositions(muscle,p,zero), { rows, cols } = muscle.surfaceGrid;
    const lift: (number | undefined)[] = [], projection: number[] = [];
    for (const t of pectoralStations) {
      const offset = Math.round(t * rows) * (cols + 1) * 3;
      const x = positions[offset] * f.lateral, y = positions[offset + 1] * f.vertical;
      let edge = y, best = .0025;
      // The inferior fold is a rise in anterior depth followed by a flatter
      // belly. Search only near the predicted border, below the axilla.
      if (Math.abs(x) < .25 && t <= .82) for (let shift = -.04; shift <= .041; shift += .004) {
        const h = y + shift;
        if (h < 1.18 || h > 1.36) continue;
        const a = anteriorDepth(reliefTarget,x,h-.012), b = anteriorDepth(reliefTarget,x,h+.006), c = anteriorDepth(reliefTarget,x,h+.024);
        if (a===undefined || b===undefined || c===undefined || Math.abs(b-positions[offset+2]*f.lateral)>.055) continue;
        const score = (b-a) - Math.max(0,c-b) - .055*Math.abs(shift);
        if (score > best) { best=score; edge=h; }
      }
      const shift = Math.max(-.028, Math.min(.028, edge-y));
      // Over the rectus the relief measures the fold itself (the costal
      // head's inferior border); it overrides the local depth heuristic and
      // may lift further, since templates can hang centimetres below it.
      const fold = rectusSegmentation?.sides[side];
      if (fold && Math.abs(x) < fold.width + .02) {
        const x0 = .008 + .2 * (fold.width - .008), x1 = .008 + .8 * (fold.width - .008), t = Math.max(0, Math.min(1, (Math.abs(x) - x0) / (x1 - x0)));
        lift.push(Math.max(-28, Math.min(80, (fold.fold[0] + (fold.fold[1] - fold.fold[0]) * t - .004 - y) * 1000)));
      } else lift.push(best > .0025 ? shift * 1000 : undefined);
      const belly = offset + Math.round(cols*.67)*3;
      const q: Vec3M = [positions[belly]*f.lateral,positions[belly+1]*f.vertical+shift*.35,positions[belly+2]*f.lateral];
      const depth = anteriorDepth(target,q[0],q[1]);
      // Near the humeral insertion, an anterior ray can hit the deltoid
      // or upper arm. Fade positive belly growth into the tendon there.
      const delta = depth === undefined ? 0 : (depth - q[2]) * 1000 - fatThickness(p,q);
      const lateral = Math.max(0, Math.min(1, (.22 - Math.abs(q[0])) / .065));
      const tendon = Math.max(0, Math.min(1, (.90 - t) / .28));
      const gain = lateral * tendon;
      projection.push(Math.max(-8, Math.min(24, delta)) * (delta > 0 ? gain : 1));
    }
    foldSamples.set(side, { lift, projection });
  }
  for (const [side, samples] of foldSamples) {
    const opposite = foldSamples.get(side === 'L' ? 'R' : 'L');
    const reliable = samples.lift.filter(value => value !== undefined).length >= 2;
    if (!reliable && (opposite?.lift.filter(value => value !== undefined).length ?? 0) < 2) continue;
    // Borrow only unobserved heights. Anterior projection is always measured
    // on this side, so asymmetry in the target remains possible.
    const lift = samples.lift.map((value, i) => value ?? (opposite?.lift[i] ?? 0) * .65);
    const smooth = (values: number[]) => values.map((value,i)=>(2*value+(values[i-1]??value)+(values[i+1]??value))/4);
    const clavicular = fitted.meshes.otherMuscles?.find(mesh => mesh.anatomicalName === `pectoralis_major_clav_${side}`);
    let shoulderProjection: number[] | undefined;
    if (clavicular?.surfaceGrid) {
      const { rows, cols } = clavicular.surfaceGrid;
      const positions = posedPositions(clavicular, p, zero);
      const corrections = pectoralStations.map(t => {
        if (t < .5) return 0;
        const samples: number[] = [];
        for (const offset of [-1, 0, 1]) for (const v of [.72, .84, .94]) {
          const i = ((Math.round(rows * t) + offset) * (cols + 1) + Math.round(cols * v)) * 3;
          const q: Vec3M = [positions[i] * f.lateral, positions[i + 1] * f.vertical, positions[i + 2] * f.lateral];
          if (Math.abs(q[0]) > .24 || q[1] < 1.27) continue;
          const depth = anteriorDepth(reliefTarget, q[0], q[1]);
          if (depth === undefined || Math.abs(depth - q[2]) > .055) continue;
          samples.push((depth - q[2]) * 1000 - fatThickness(p, q));
        }
        samples.sort((a, b) => a - b);
        return samples.length >= 3 ? Math.max(-12, Math.min(16, samples[Math.floor(samples.length / 2)])) : 0;
      });
      if (corrections.some(Boolean)) shoulderProjection = smooth(corrections);
    }
    const contour = { lift:smooth(lift), projection:smooth(samples.projection), shoulderProjection };
    p.definition!.muscles[`pectoralis_major_sternocostal.${side}`]!.pectoralContour=contour;
    pectoralContours[side]=contour;
  }
  if (Object.keys(pectoralContours).length) fitted=generateAnatomy(p,layers);
  const axillaryFit: NonNullable<VolumeFitEvidence['axillaryFit']> = {};
  const axillaryTrials = new Map<'L'|'R', {index:number; depth:number; desired:number; before:number}[]>();
  for (const [side, contour] of Object.entries(pectoralContours) as ['L'|'R', NonNullable<VolumeFitEvidence['pectoralContours']>['L']][]) {
    const mesh = fitted.meshes.otherMuscles.find(item=>item.anatomicalName===`pectoralis_major_stern_${side}`);
    if (!mesh?.surfaceGrid || !contour) continue;
    const {rows,cols} = mesh.surfaceGrid, posed = posedPositions(mesh,p,zero);
    const held = [];
    let cross = 0, square = 0;
    for (let row=1; row<rows; row++) for (let col=1; col<cols; col+=2) {
      const weight = axillaryProjectionWeight(row/rows,col/cols);
      if (weight<.25) continue;
      const index = (row*(cols+1)+col)*3;
      const q: Vec3M = [posed[index]*f.lateral,posed[index+1]*f.vertical,posed[index+2]*f.lateral];
      if (Math.abs(q[0])<.14 || Math.abs(q[0])>.26 || q[1]<1.24 || q[1]>1.45 || q[2]<.02) continue;
      const hit = anteriorDepth(reliefTarget,q[0],q[1]);
      if (hit===undefined || Math.abs(hit-q[2])>.035) continue;
      const depth=hit*1000, desired=depth-fatThickness(p,q), before=q[2]*1000;
      if (row%4===0) held.push({index,depth,desired,before});
      else { cross+=weight*(desired-before); square+=weight*weight; }
    }
    if (held.length<8 || square<1) continue;
    const gain = Math.max(-10,Math.min(16,cross/(square+2)));
    if (Math.abs(gain)<1) continue;
    contour.axillaryProjection = gain;
    axillaryTrials.set(side,held);
  }
  if (axillaryTrials.size) {
    const trial = generateAnatomy(p,layers);
    for (const [side, held] of axillaryTrials) {
      const mesh = trial.meshes.otherMuscles.find(item=>item.anatomicalName===`pectoralis_major_stern_${side}`)!;
      const posed = posedPositions(mesh,p,zero);
      let before=0, after=0, outsideBefore=0, outsideAfter=0;
      for (const sample of held) {
        const depth=posed[sample.index+2]*f.lateral*1000;
        before+=Math.abs(sample.before-sample.desired); after+=Math.abs(depth-sample.desired);
        if(sample.before>sample.depth+2)outsideBefore++;
        if(depth>sample.depth+2)outsideAfter++;
      }
      const accepted = after < before-.35*held.length && outsideAfter<=outsideBefore;
      axillaryFit[side]={samples:held.length,beforeMm:before/held.length,afterMm:after/held.length,accepted};
      if(!accepted)delete pectoralContours[side]!.axillaryProjection;
    }
    fitted=Object.values(axillaryFit).every(entry=>entry.accepted)?trial:generateAnatomy(p,layers);
  }
  const armSilhouette=unlocked ? fitArmSilhouette(p,fitted.meshes.otherMuscles,target) : undefined;
  const muscleValidation: NonNullable<VolumeFitEvidence["muscleValidation"]> = {};
  let after=0,count=0;
  for(const list of Object.values(fitted.meshes))for(const mesh of list){
    if(!mesh.anatomyId||!profiles[isCostalEnvelope(mesh)?mesh.anatomyId+":costal":mesh.anatomyId]||!mesh.shellPairs)continue;
    const positions=posedPositions(mesh,p,zero);
    for(const observation of observations){if(observation.id!==mesh.anatomyId||observation.name!==mesh.anatomicalName)continue;const a=observation.vertex*3,q=[positions[a]*f.lateral,positions[a+1]*f.vertical,positions[a+2]*f.lateral];after+=Math.hypot(...q.map((v,k)=>v-observation.desired[k]))*1000;count++;
      if (observation.validation) {
        const id = observation.id;
        const entry = muscleValidation[id] ??= {samples:0,beforeMm:0,afterMm:0,outsideReserve:0,beyondSkinRay:0,profileMm:0,capMm:0,pipelineMm:0};
        const projection = (point: readonly number[]) => point.reduce((sum,v,k)=>sum+(v-observation.desired[k])*observation.normal[k],0)*1000;
        const original = observation.inner.map((v,k)=>v+observation.normal[k]*observation.thickness);
        const error = projection(q);
        entry.samples++;
        entry.beforeMm += Math.abs(projection(original));
        entry.afterMm += Math.abs(error);
        if (error > 2) entry.outsideReserve++;
        const reserve = observation.availableMm + observation.thickness*1000 + projection(observation.inner);
        if (error > reserve + 2) entry.beyondSkinRay++;
        // Same law as applyMuscleEnvelope: depth along the shell normal.
        const profile = profiles[observation.groupKey];
        if (profile) {
          const gain = observation.basis.reduce((sum,w,i)=>sum+w*profile[i],0);
          const change = (gain-1)*observation.w, limited = Math.max(-.65,Math.min(19,gain-1))*observation.w;
          const cap = Math.min(1,envelopeTravelLimit(id)/Math.max(.00001,Math.abs(limited)*observation.thickness));
          const desired = projection(observation.inner) * -1 / 1000;
          const ideal = observation.thickness*(1+change), predicted = observation.thickness*(1+limited*cap);
          entry.profileMm! += Math.abs(desired-ideal)*1000;
          entry.capMm! += Math.abs(ideal-predicted)*1000;
          entry.pipelineMm! += Math.abs((projection(q)-projection(observation.inner))/1000-predicted)*1000;
        }
      }}
  }
  // Diagnostic only: would a finer depth profile on the same template fit the
  // held-out samples? Nearest training sample bounds what the data itself allows.
  const resolutionStudy: Record<string, { coarseMm: number; fineMm: number; nearestMm: number; samples: number }> = {};
  for (const [groupKey, group] of groups) {
    if (group.b.length !== 15) continue;
    const train = training.filter(o => o.groupKey === groupKey), held = observations.filter(o => o.validation && o.groupKey === groupKey);
    if (train.length < 40 || held.length < 8) continue;
    const reserve = (o: typeof observations[number]) => { const mask=o.fatWeights.reduce((s,w)=>s+w,0); return (1-mask)*fat+o.fatWeights.reduce((s,w,i)=>s+w*p.fatDistribution![fatRegions[i]],0); };
    const target = (o: typeof observations[number]) => (o.availableMm - reserve(o)) / 1000;
    const R = 9, C = 5, size = R * C, A = Array.from({length:size},()=>new Array(size).fill(0)), b = new Array(size).fill(0);
    const basis = (o: typeof observations[number]) => {
      const out = new Array(size).fill(0), x = Math.max(0,Math.min(C-1-1e-6,o.v*(C-1))), y = Math.max(0,Math.min(R-1-1e-6,o.u*(R-1))), i = Math.floor(x), j = Math.floor(y), tx = x-i, ty = y-j;
      out[j*C+i] += (1-tx)*(1-ty); out[j*C+i+1] += tx*(1-ty); out[(j+1)*C+i] += (1-tx)*ty; out[(j+1)*C+i+1] += tx*ty;
      return out.map(value => value * o.thickness * o.w);
    };
    for (const o of train) { const c = basis(o), y = target(o); for (let j=0;j<size;j++){ b[j]+=c[j]*y*o.weight; for (let k=0;k<size;k++) A[j][k]+=c[j]*c[k]*o.weight; } }
    const smooth = Math.max(1e-7, train.length * 1e-6);
    for (let j=0;j<size;j++) { A[j][j]+=1e-7; for (const k of [j%C<C-1?j+1:-1, j<size-C?j+C:-1]) if (k>=0) { A[j][j]+=smooth; A[k][k]+=smooth; A[j][k]-=smooth; A[k][j]-=smooth; } }
    const fine = solve(A, b), coarse = profiles[groupKey];
    let coarseMm = 0, fineMm = 0, nearestMm = 0;
    for (const o of held) {
      const y = target(o), c = basis(o), predicted = c.reduce((sum,v,i)=>sum+v*fine[i],0);
      const gain = coarse ? o.basis.reduce((sum,w,i)=>sum+w*coarse[i],0) : 1;
      coarseMm += Math.abs(y - o.thickness*o.w*(gain-1)) * 1000; fineMm += Math.abs(y - predicted) * 1000;
      let best = Infinity, near = 0;
      for (const t of train) { const d = (t.u-o.u)**2 + (t.v-o.v)**2; if (d < best) { best = d; near = target(t); } }
      nearestMm += Math.abs(y - near) * 1000;
    }
    resolutionStudy[groupKey] = { coarseMm: coarseMm/held.length, fineMm: fineMm/held.length, nearestMm: nearestMm/held.length, samples: held.length };
  }
  progress?.('Refining posed skin',.4);
  let skin=fitted.meshes.skin[0];
  if (Object.keys(pectoralContours).length) {
    const positions = posedPositions(skin,p,zero);
    for (let i = 0; i < positions.length; i++) positions[i] *= i % 3 === 1 ? f.vertical : f.lateral;
    const covering = new SurfaceBVH({positions, indices:skin.indices});
    for (const side of ['L', 'R'] as const) {
      const contour = pectoralContours[side];
      if (!contour) continue;
      const a = Array.from({length:6}, (_,j) => Array.from({length:6}, (_,k) => j === k ? 2 : 0));
      const b = new Array<number>(6).fill(0);
      let count = 0;
      for (let y = 1.27; y < 1.46; y += .012) for (let lateral = .035; lateral < .225; lateral += .012) {
        const x = side === 'L' ? -lateral : lateral;
        const source = anteriorDepth(covering,x,y), observed = anteriorDepth(target,x,y);
        if (source === undefined || observed === undefined || Math.abs(observed-source) > .055) continue;
        const basis = pectoralCoveringBasis(x,y,source);
        if (!basis) continue;
        const error = (observed - source) * 1000;
        count++;
        for (let j = 0; j < 6; j++) {
          b[j] += basis[j] * error;
          for (let k = 0; k < 6; k++) a[j][k] += basis[j] * basis[k];
        }
      }
      if (count >= 24) contour.covering = solve(a,b).map(value => Math.max(-10,Math.min(22,value)));
    }
  }
  let base={...skin,positions:posedPositions(skin,p,zero)};
  if (Object.values(pectoralContours).some(contour => contour?.covering)) {
    const positions = base.positions.map((value,i) => value * (i % 3 === 1 ? f.vertical : f.lateral));
    const covered = new SurfaceBVH({positions, indices:skin.indices});
    for (const side of ['L','R'] as const) {
      const contour = pectoralContours[side];
      if (!contour?.covering) continue;
      const sums = [0,0], weights = [2,2], heldOut: { basis: number[]; residual: number }[] = [];
      for (let row=0;row<16;row++) for (let col=0;col<19;col++) {
        const x = (.075 + col * .009) * (side === 'L' ? -1 : 1), y = 1.32 + row * .01;
        const source = anteriorDepth(covered,x,y), observed = anteriorDepth(target,x,y);
        if (source === undefined || observed === undefined || Math.abs(observed-source) > .05) continue;
        const residual = (observed-source)*1000, basis = deltopectoralCoveringBasis(x,y,source);
        if (basis[0] + basis[1] < .04) continue;
        if ((row+col)%3 === 0) { heldOut.push({basis,residual}); continue; }
        for (let j=0;j<2;j++) { sums[j] += basis[j]*residual; weights[j] += basis[j]**2; }
      }
      const candidate = [Math.max(-24,Math.min(0,sums[0]/weights[0])), Math.min(30,Math.max(0,sums[1]/weights[1]))];
      const gain = heldOut.reduce((sum,{basis,residual}) => sum + Math.abs(residual) -
        Math.abs(residual - basis[0]*candidate[0] - basis[1]*candidate[1]), 0);
      if (heldOut.length >= 12 && gain > heldOut.length * .25) contour.transitionCovering = candidate;
    }
    base={...skin,positions:posedPositions(skin,p,zero)};
  }
  const semantic=superficialLandmarks(p),material=skin.materialPositions??skin.positions,anchors:{source:number[];target:number[];weight:number}[]=[],pairs=new Map<string,{source:number[];target:number[]}>();
  const details = skinFeatureCoordinates(p, semantic.navel);
  if(hints.surface!=='clothed'){
    const sections=new Set<string>();
    for(let i=0;i<base.positions.length;i+=3){
      const x=base.positions[i]*f.lateral,y=base.positions[i+1]*f.vertical,z=base.positions[i+2]*f.lateral;
      if(Math.abs(x)>.19||y<1.04||y>1.42||z<.045||skin.normals[i+2]<.55)continue;
      const key=Math.floor(x/.024)+':'+Math.floor(y/.024);
      if(sections.has(key))continue;
      const depth=anteriorDepth(target,x,y);
      if(depth===undefined||Math.abs(depth-z)>.045)continue;
      sections.add(key);anchors.push({source:[x,y,z],target:[x,y,depth],weight:6});
    }
  }
  for(const[name,point]of Object.entries(hints.tissues??{})){
    let expected:number[]|undefined;
    if(name==='navel')expected=details[0];
    else if(name==='nipple_L'||name==='nipple_R')expected=details[name==='nipple_L'?1:2];
    else{const match=/^inguinal_([LR])_(inner|middle|outer)$/.exec(name);if(match)expected=semantic.inguinal[match[1]==='L'?0:1][['inner','middle','outer'].indexOf(match[2])];}
    if(!expected||!point)continue;let best=Infinity,vertex=0;
    for(let i=0;i<material.length;i+=3){if(material[i+2]<.2)continue;const d=(material[i]-expected[0])**2+(material[i+1]-expected[1])**2;if(d<best){best=d;vertex=i;}}
    const source=[base.positions[vertex]*f.lateral,base.positions[vertex+1]*f.vertical,base.positions[vertex+2]*f.lateral],observed=sourcePointToCanonical(frame,...point);
    const inguinal = name.startsWith('inguinal_');
    const separation = Math.hypot(...source.map((value, k) => value - observed[k]));
    if (inguinal && separation > .065) continue;
    anchors.push({source,target:observed,weight:inguinal ? 60 * Math.max(.15, 1 - separation / .065) : 60});
    pairs.set(name,{source,target:observed});
  }
  if (unlocked) for (const [side, path] of [['L', semantic.inguinal[0]], ['R', semantic.inguinal[1]]] as const) {
    // Look for a crease transverse to the expected diagonal in a narrow
    // corridor. Keep the deep ligament on its pelvic attachments.
    const creaseStep = .006;
    const candidates = path.flatMap((expected, index) => {
      const name = `inguinal_${side}_${(['inner', 'middle', 'outer'] as const)[index]}` as TissueHintName;
      if (hints.tissues?.[name]) return [];
      let bestDistance = Infinity, vertex = -1;
      for (let i = 0; i < material.length; i += 3) {
        if (material[i + 2] < .2) continue;
        const distance = (material[i] - expected[0]) ** 2 + (material[i + 1] - expected[1]) ** 2;
        if (distance < bestDistance) { bestDistance = distance; vertex = i; }
      }
      if (vertex < 0) return [];
      const source: Vec3M = [base.positions[vertex] * f.lateral, base.positions[vertex + 1] * f.vertical, base.positions[vertex + 2] * f.lateral];
      const [x, y, z] = source;
      let best = .002, crease: Vec3M | undefined;
      for (let step=-6; step<=6; step++) {
        const offset = step*creaseStep, h = y + offset, depth = anteriorDepth(reliefTarget, x, h);
        const upper = anteriorDepth(reliefTarget, x, h + .012), lower = anteriorDepth(reliefTarget, x, h - .012);
        if (depth === undefined || upper === undefined || lower === undefined || Math.abs(depth - z) > .038) continue;
        // Remove the depth gradient of the sloping abdominal wall. A
        // crease may still descend in raw depth toward the upper thigh.
        const score = (upper + lower) * .5 - depth - .055 * Math.abs(offset);
        if (score > best) { best = score; crease = [x, h, depth]; }
      }
      return crease ? [{ name, index, source, target: crease }] : [];
    });
    for (const candidate of candidates) {
      const shift = candidate.target[1] - candidate.source[1];
      if (!candidates.some(other => Math.abs(other.index - candidate.index) === 1 &&
        Math.abs(other.target[1] - other.source[1] - shift) <= .018 + creaseStep*.5)) continue;
      const {name, source, target: observed} = candidate;
      pairs.set(name, {source, target: observed});
      anchors.push({source, target: observed, weight: 14});
    }
  }
  // A fold is a curve constraint, not three unrelated attractive points.
  for(const side of ['L','R'])for(const segment of [['inner','middle'],['middle','outer']]){
    const a=pairs.get(`inguinal_${side}_${segment[0]}` as TissueHintName),b=pairs.get(`inguinal_${side}_${segment[1]}` as TissueHintName);if(!a||!b)continue;
    for(let j=1;j<5;j++){const t=j/5,source=a.source.map((v,k)=>v*(1-t)+b.source[k]*t),desired=a.target.map((v,k)=>v*(1-t)+b.target[k]*t) as Vec3M;anchors.push({source,target:target.queryClosestPoint(desired).point,weight:10});}
  }
  if (unlocked && hints.parameters?.inguinalCurvature === undefined) {
    // Estimate only the curvature shared by the ligament and its aponeurotic
    // follower. The endpoints still come from their pelvic attachments.
    const trial = superficialLandmarks({...p, inguinalCurvature:p.inguinalCurvature+.1}).inguinal;
    let cross = 0, square = 0;
    for (const [index, side] of ['L','R'].entries()) {
      const middle = pairs.get(`inguinal_${side}_middle` as TissueHintName);
      const innerPair = pairs.get(`inguinal_${side}_inner` as TissueHintName);
      const outerPair = pairs.get(`inguinal_${side}_outer` as TissueHintName);
      if (!middle || (!innerPair && !outerPair)) continue;
      const [inner, center, outer] = semantic.inguinal[index];
      if (Math.abs(outer[0]-inner[0])<.01) continue;
      const slope = (outer[1]-inner[1])*f.vertical/((outer[0]-inner[0])*f.lateral);
      const moved = trial[index][1];
      const derivative = ((moved[1]-center[1])*f.vertical-slope*(moved[0]-center[0])*f.lateral)/.1;
      const normalShift = (pair: typeof middle) => pair.target[1]-pair.source[1]-slope*(pair.target[0]-pair.source[0]);
      // A common translation of the three surface points is not curvature.
      const endpointShift = (normalShift(innerPair ?? outerPair!) + normalShift(outerPair ?? innerPair!))*.5;
      const residual = normalShift(middle)-endpointShift;
      cross += derivative*residual;
      square += derivative*derivative;
    }
    const correction = Math.max(-.45,Math.min(.45,cross/(square+.0001)));
    if (Math.abs(correction) >= .04) {
      p.inguinalCurvature = Math.max(-1.3,Math.min(1.3,p.inguinalCurvature+correction));
      skin = generateAnatomy(p,layers).meshes.skin[0];
      base = {...skin,positions:posedPositions(skin,p,zero)};
    }
  }
  if (unlocked) {
    // Follow the underside of the pubic covering at the same lateral position
    // and depth. Closest-point matches near the leg split can jump sideways
    // onto either thigh and leave the anterior midline too high.
    const generated = new SurfaceBVH({
      positions: Float32Array.from(base.positions, (value, index) => value * (index % 3 === 1 ? f.vertical : f.lateral)),
      indices: base.indices,
    });
    const underside = (surface: SurfaceBVH, x: number, z: number) =>
      surface.queryRay([x, .76, z], [0, 1, 0], .18)?.point;
    for (const z of [.04, .06, .08, .10, .12, .14]) {
      const matches = [-.006, 0, .006].flatMap(x => {
        const source = underside(generated, x, z), observed = underside(reliefTarget, x, z);
        if (!source || !observed || Math.min(source[1], observed[1]) < .79 ||
          Math.abs(observed[1] - source[1]) > .055) return [];
        return [{ source, target: observed, weight: 90 }];
      });
      // An isolated hit may be the inner thigh or a hole in the scan.
      if (matches.length !== 3 || ['source', 'target'].some(key => {
        const heights = matches.map(match => match[key as 'source' | 'target'][1]);
        return Math.max(...heights) - Math.min(...heights) > .012;
      })) continue;
      anchors.push(...matches);
    }
  }
  // This residual is explicitly skin-only. It cannot move a joint or any bone.
  const registered=registerSurface(p,target,fraction=>progress?.('Refining posed skin',.4+fraction*.58),anchors,base);
  p.skinFit=registered.field;
  const abdominalMuscles = [...(fitted.meshes.rectusAbdominis ?? []), ...(fitted.meshes.externalOblique ?? [])];
  const abdominalCovering = unlocked && p.abdominalModel === 1 ? fitAbdominalCovering(p, skin, abdominalMuscles, reliefTarget) : undefined;
  const navelHint = hints.tissues?.navel;
  const abdominalDetails = rectusSegmentation ? fitAbdominalDetails(p, skin, abdominalMuscles, reliefTarget,
    rectusSegmentation.navel.y, navelHint && sourcePointToCanonical(frame, ...navelHint)) : undefined;
  if (unlocked) fitBentArmCovering(p, skin, reliefTarget);
  const pectoralSkin = unlocked ? fitPectoralSkin(p, skin,
    (fitted.meshes.otherMuscles ?? []).filter(mesh => /^(pectoralis_major|deltoid)/.test(mesh.anatomicalName ?? '')),
    reliefTarget, [rectusSegmentation?.sides.L?.fold[0] ?? 1.28, rectusSegmentation?.sides.R?.fold[0] ?? 1.28],
    ['nipple_L', 'nipple_R'].map(name => {
      const point = hints.tissues?.[name as TissueHintName];
      return point && sourcePointToCanonical(frame, ...point);
    }) as [Vec3M | undefined, Vec3M | undefined]) : undefined;
  const finalPositions=posedPositions(skin,p,zero),region=(q:readonly number[])=>q[1]>1.25&&q[1]<1.5&&Math.abs(q[0])>.17&&Math.abs(q[0])<.34?'shoulders':Math.abs(q[0])<.2&&q[1]>1.24&&q[1]<1.46?'chest':Math.abs(q[0])<.19&&q[1]>1.02&&q[1]<=1.24?'abdomen':Math.abs(q[0])<.22&&q[1]>.84&&q[1]<=1.02?'inguinal':undefined;
  const regional=(positions:Float32Array)=>{const values:Record<string,number[]>={chest:[],shoulders:[],abdomen:[],inguinal:[]};for(let i=0;i<positions.length;i+=6){const q=[positions[i]*f.lateral,positions[i+1]*f.vertical,positions[i+2]*f.lateral],key=region(q);if(key)values[key].push(Math.sqrt(target.queryClosestPoint(q as Vec3M).distanceSq)*1000);}return Object.fromEntries(Object.entries(values).map(([key,v])=>[key,v.reduce((s,x)=>s+x,0)/Math.max(1,v.length)]));};
  const regionBefore=regional(baselinePositions),regionAfter=regional(finalPositions),regions=Object.fromEntries(Object.keys(regionBefore).map(key=>[key,{beforeMm:regionBefore[key],afterMm:regionAfter[key]}]));
  for (const entry of Object.values(muscleValidation)) { entry.beforeMm/=entry.samples; entry.afterMm/=entry.samples; entry.profileMm!/=entry.samples; entry.capMm!/=entry.samples; entry.pipelineMm!/=entry.samples; }
  const abdominalValidation = Object.fromEntries(Object.entries(muscleValidation).filter(([id]) => /^(rectus_abdominis|external_oblique)\./.test(id)));
  return{parameters:p,evidence:{method:'fixed-skeleton-muscle-envelope',muscles:new Set([...groups].filter(([key])=>profiles[key]).map(([,group])=>group.id)).size,samples,fatReserveMm:fat,fatDistribution:p.fatDistribution,fatPriorMm:fatPrior,regions,envelopeBeforeMm:before/Math.max(1,samples),envelopeAfterMm:after/Math.max(1,count),skin:registered.evidence,profiles,pectoralContours,axillaryFit,armSilhouette,abdominalValidation,muscleValidation,resolutionStudy,outlineFit,rectusDivisions,rectusSegmentation,abdominalCovering,abdominalDetails,pectoralSkin} satisfies VolumeFitEvidence};
}
