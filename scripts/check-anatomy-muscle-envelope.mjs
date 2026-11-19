import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import ts from 'typescript';

const transpile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext }
}).outputText;

const { registerHooks } = await import('node:module');
const { fileURLToPath } = await import('node:url');
const prefix = new URL('../src/anatomy/', import.meta.url).href;

registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.startsWith(prefix) && specifier.startsWith('.')) {
      const url = new URL(specifier, context.parentURL);
      if (specifier.endsWith('.js') && existsSync(fileURLToPath(url.href.slice(0, -3) + '.ts'))) {
        specifier = specifier.slice(0, -3) + '.ts';
      } else if (!/\.(ts|json)$/.test(specifier) && existsSync(fileURLToPath(url.href + '.ts'))) {
        specifier += '.ts';
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith(prefix) && url.endsWith('.ts')) {
      return { format: 'module', source: transpile(readFileSync(fileURLToPath(url), 'utf8')), shortCircuit: true };
    }
    if (url.startsWith(prefix) && url.endsWith('.json')) {
      return { format: 'module', source: 'export default ' + readFileSync(fileURLToPath(url), 'utf8') + ';', shortCircuit: true };
    }
    return next(url, context);
  }
});


const{generateAnatomy}=await import('../src/anatomy/generation.ts');
const{defaults}=await import('../src/anatomy/parameters.ts');
const{muscleDefaults,interactionDefaults,normalizeDefinition}=await import('../src/anatomy/definition.ts');
const{applyMuscleEnvelope,growFittedShell}=await import('../src/anatomy/muscleEnvelope.ts');
const{shapeMuscle}=await import('../src/anatomy/regions/abdomen.ts');
const{posedPositions,normalizePose}=await import('../src/anatomy/pose.ts');
const{fatThickness,fatRegions}=await import('../src/anatomy/fatDistribution.ts');
const{SurfaceBVH}=await import('../src/anatomy/inference/observationProxy.ts');
const layers=['bones','otherMuscles','rectusAbdominis','inguinalLigaments','adipose'];
const p={...defaults,definition:{version:1,muscles:{'pectoralis_major_sternocostal.L':{...muscleDefaults},'pectoralis_major_sternocostal.R':{...muscleDefaults},'rectus_abdominis.L':{...muscleDefaults}},bones:{},interaction:{...interactionDefaults,attachments:true}}};
const base=generateAnatomy(p,layers),muscle=base.meshes.otherMuscles.find(m=>m.anatomyId==='pectoralis_major_sternocostal.L'&&m.shellPairs);
const clavicularId = 'pectoralis_major_clavicular.R';
const clavicular = base.meshes.otherMuscles.find(mesh => mesh.anatomyId === clavicularId);
assert.ok(clavicular?.shellPairs);
const neutralClavicular = structuredClone(clavicular), grownClavicular = structuredClone(clavicular);
const neutralVolume = shapeMuscle([neutralClavicular], clavicularId, muscleDefaults, p).metric.actualCm3;
const grownVolume = shapeMuscle([grownClavicular], clavicularId, { ...muscleDefaults, depth: 1.5 }, p).metric.actualCm3;
const shellStride = clavicular.shellPairs * 3;
for (let i = 0; i < shellStride; i++) {
  const neutral = neutralClavicular.positions[i] + neutralClavicular.positions[i + shellStride];
  const grown = grownClavicular.positions[i] + grownClavicular.positions[i + shellStride];
  assert.ok(Math.abs(grown - neutral) < 1e-5, 'clavicular depth preserves the paired mid-surface');
}
assert.ok(Math.abs(grownVolume / neutralVolume - 1.5) < .001, 'clavicular depth grows the target volume');
for (const name of ['deltoidMiddle', 'latissimus_dorsi_R']) {
  const reference = base.meshes.otherMuscles.find(mesh => mesh.anatomicalName === name);
  assert.ok(reference?.surfaceGrid && reference.shellPairs);
  const grown = structuredClone(reference), { rows, cols } = reference.surfaceGrid;
  growFittedShell(grown, 3, .53, .22);
  let bellyGrowth = 0;
  for (let v = 0; v < reference.shellPairs; v++) {
    const row = Math.floor(v / (cols + 1));
    for (const vertex of [v, v + reference.shellPairs]) {
      const i = vertex * 3;
      const shift = Math.hypot(...[0, 1, 2].map(k => grown.positions[i + k] - reference.positions[i + k]));
      if (row === 0 || row === rows) assert.equal(shift, 0);
      else bellyGrowth = Math.max(bellyGrowth, shift);
    }
  }
  assert.ok(bellyGrowth > .01, 'growth fills the fitted belly while preserving attachment rows');
}
assert.ok(muscle);const clone=structuredClone(muscle),original=clone.positions.slice();
applyMuscleEnvelope(clone,{...muscleDefaults,depthProfile:new Array(15).fill(1)},p.height);assert.deepEqual(clone.positions,original,'neutral envelope preserves the authored shape');
applyMuscleEnvelope(clone,{...muscleDefaults,depthProfile:new Array(15).fill(2.5)},p.height);
assert.deepEqual(clone.positions.subarray(muscle.shellPairs*3),original.subarray(muscle.shellPairs*3),'deep shell stays fixed');
let outerMoved=0;for(let i=0;i<muscle.shellPairs*3;i++)outerMoved=Math.max(outerMoved,Math.abs(clone.positions[i]-original[i]));assert.ok(outerMoved>.001);
const q=structuredClone(p);q.definition.muscles['pectoralis_major_sternocostal.L'].depthProfile=new Array(15).fill(2.5);
const fitted=generateAnatomy(q,layers);assert.deepEqual(fitted.meshes.bones.map(m=>m.positions),base.meshes.bones.map(m=>m.positions),'genes preserve all bone buffers');
const right=meshes=>meshes.otherMuscles.filter(m=>m.anatomyId==='pectoralis_major_sternocostal.R').map(m=>m.positions);
const sculpt=structuredClone(p);
Object.assign(sculpt.definition.muscles['pectoralis_major_sternocostal.L'],{
  widthProfile:[1,1.2,1.45,1,1],centerlineBend:1.1,peakOffset:.1,
});
const sculpted=generateAnatomy(sculpt,layers);
const sculptedMuscle=sculpted.meshes.otherMuscles.find(m=>m.anatomicalName===muscle.anatomicalName);
assert.ok(sculptedMuscle.positions.some((value,i)=>Math.abs(value-muscle.positions[i])>.01),'local width, peak and curvature reshape the belly');
assert.deepEqual(sculpted.meshes.bones.map(m=>m.positions),base.meshes.bones.map(m=>m.positions),'genetic profiles preserve bone buffers');
assert.ok(sculpted.attachments.every(item=>item.errorMm<.1),'genetic profiles preserve the fitted attachment areas');
assert.deepEqual(right(sculpted.meshes),right(base.meshes),'local shaping stays on the edited side');
const contourParams=structuredClone(p);
contourParams.definition.muscles['pectoralis_major_sternocostal.L'].pectoralContour={
  lift:[0,-8,-14,-9,0],projection:[0,6,12,8,0],
};
const contour=generateAnatomy(contourParams,layers);
assert.deepEqual(contour.meshes.bones.map(m=>m.positions),base.meshes.bones.map(m=>m.positions));
assert.deepEqual(contour.meshes.rectusAbdominis.map(m=>m.positions),base.meshes.rectusAbdominis.map(m=>m.positions));
assert.deepEqual(right(contour.meshes),right(base.meshes));
const costal=meshes=>meshes.otherMuscles.find(m=>m.anatomicalName==='pectoralis_major_cost_L');
assert.ok(costal(contour.meshes).positions.some((value,i)=>Math.abs(value-costal(base.meshes).positions[i])>.02));
assert.ok(contour.attachments.every(item=>item.errorMm<.1),'pectoral contour preserves attachment areas');
const shoulderParams = structuredClone(contourParams);
const shoulderProjection = [0, 0, 2, 8, 12];
shoulderParams.definition.muscles['pectoralis_major_sternocostal.L'].pectoralContour.shoulderProjection = shoulderProjection;
const shoulder = generateAnatomy(shoulderParams, layers);
const byName = (result, name) => result.meshes.otherMuscles.find(mesh => mesh.anatomicalName === name);
assert.notDeepEqual(byName(shoulder, 'pectoralis_major_clav_L').positions, byName(contour, 'pectoralis_major_clav_L').positions);
assert.deepEqual(shoulder.meshes.bones.map(m=>m.positions), contour.meshes.bones.map(m=>m.positions));
assert.deepEqual(shoulder.meshes.rectusAbdominis.map(m=>m.positions), contour.meshes.rectusAbdominis.map(m=>m.positions));
assert.deepEqual(normalizeDefinition(shoulderParams.definition).muscles['pectoralis_major_sternocostal.L'].pectoralContour.shoulderProjection, shoulderProjection);
const coveringParams = structuredClone(shoulderParams);
coveringParams.definition.muscles['pectoralis_major_sternocostal.L'].pectoralContour.covering = [8, 12, 10, 14, 6, 8];
assert.deepEqual(normalizeDefinition(coveringParams.definition).muscles['pectoralis_major_sternocostal.L'].pectoralContour.covering, [8, 12, 10, 14, 6, 8]);
const coveringSkin = shoulder.meshes.skin[0], neutralPose = normalizePose({});
const skinWithoutCovering = posedPositions(coveringSkin, shoulderParams, neutralPose);
const skinWithCovering = posedPositions(coveringSkin, coveringParams, neutralPose);
let coveringMoved = 0;
for (let i = 0; i < skinWithoutCovering.length; i += 3) {
  if (skinWithoutCovering[i] >= 0 || skinWithoutCovering[i + 1] * 1.8 / 17.5 <= 1.25)
    assert.deepEqual(skinWithCovering.subarray(i, i + 3), skinWithoutCovering.subarray(i, i + 3));
  coveringMoved = Math.max(coveringMoved, skinWithCovering[i + 2] - skinWithoutCovering[i + 2]);
}
assert.ok(coveringMoved > .03, 'pectoral covering changes the ipsilateral chest even without skinFit');
const {rebuildSkinFeatures}=await import('../src/anatomy/skinFeatures.ts');
const featureParams={...p,navelOffsetX:8,navelOffsetY:12,nippleLeftRadius:13,nippleRightProjection:5};
const featureSkin=generateAnatomy(featureParams,[]).meshes.skin[0];
const grownSkin=generateAnatomy({...featureParams,pectoral:2.2,rectus:2.3},[]).meshes.skin[0];
assert.deepEqual(featureSkin.skinFeatures,grownSkin.skinFeatures,'growth keeps the same skin attachments');
const featureFrames=rebuildSkinFeatures(featureSkin,posedPositions(featureSkin,featureParams,normalizePose({})));
const grownFrames=rebuildSkinFeatures(grownSkin,posedPositions(grownSkin,featureParams,normalizePose({trunkRotation:22})));
assert.ok(featureFrames.every(Boolean)&&grownFrames.every(Boolean));
assert.deepEqual(featureFrames.map(f=>f.radius),grownFrames.map(f=>f.radius));
const {deltopectoralCoveringBasis}=await import('../src/anatomy/pectoralContour.ts');
assert.deepEqual(deltopectoralCoveringBasis(.205,1.365,.1), [1,0]);
assert.deepEqual(deltopectoralCoveringBasis(.156,1.445,.1), [0,1]);
assert.deepEqual(deltopectoralCoveringBasis(.18,1.24,.1), [0,0]);
assert.deepEqual(deltopectoralCoveringBasis(.18,1.42,-.1), [0,0]);
coveringParams.definition.muscles['pectoralis_major_sternocostal.L'].pectoralContour.transitionCovering = [-16,24];
assert.deepEqual(normalizeDefinition(coveringParams.definition).muscles['pectoralis_major_sternocostal.L'].pectoralContour.transitionCovering, [-16,24]);
const maxDelta=(a,b)=>Math.max(0,...a.flatMap((array,j)=>Array.from(array,(v,i)=>Math.abs(v-b[j][i]))));const oppositeDrift=maxDelta(right(fitted.meshes),right(base.meshes));assert.ok(oppositeDrift<1e-5,'opposite muscle is isolated');
let skinMoved=0;for(let i=0;i<base.meshes.skin[0].positions.length;i++)skinMoved=Math.max(skinMoved,Math.abs(fitted.meshes.skin[0].positions[i]-base.meshes.skin[0].positions[i]));assert.ok(skinMoved>.001,'skin follows the new genetic profile');
const rectus=structuredClone(p);rectus.definition.muscles['rectus_abdominis.L'].depthProfile=new Array(15).fill(2.5);const abdominal=generateAnatomy(rectus,layers);
const pecs=meshes=>meshes.otherMuscles.filter(m=>m.anatomyId?.startsWith('pectoralis_')).map(m=>m.positions);
const pectoralDrift=maxDelta(pecs(abdominal.meshes),pecs(base.meshes));assert.ok(pectoralDrift<1e-5,'rectus depth genes do not move pectoral meshes');
const adipose=base.meshes.adipose[0],fatP={...p,fatDistribution:{chest:6,shoulders:5,abdomen:10,inguinal:14}},pos=posedPositions(adipose,fatP,normalizePose({})),f=[18/p.height,1.8/17.5,18/p.height];
let fatError=0;for(let vertex=0;vertex<adipose.adiposePairs;vertex+=101){const a=vertex*3,b=(vertex+adipose.adiposePairs)*3,point=[pos[a]*f[0],pos[a+1]*f[1],pos[a+2]*f[2]],distance=Math.hypot(...[0,1,2].map(k=>(pos[a+k]-pos[b+k])*f[k]))*1000;fatError=Math.max(fatError,Math.abs(distance-fatThickness(fatP,point)));}assert.ok(fatError<.001,'regional fat shell matches its explicit thickness');
const normalized=normalizeDefinition(JSON.parse(JSON.stringify(q.definition)));assert.deepEqual(normalized.muscles['pectoralis_major_sternocostal.L'].depthProfile,new Array(15).fill(2.5));
const fittedRectus = structuredClone(p.definition);
fittedRectus.muscles['rectus_abdominis.L'].fittedWidthProfile = [.96, 1.02, 1.16, 1.12, 1];
for (const abdominalModel of [0, 1, 2]) {
  const max = { ...p, abdominalModel, rectWidth: 9, rectus: 3 };
  const visible = ['rectusAbdominis', 'bones', 'inguinalLigaments'];
  const a = generateAnatomy(max, visible).meshes;
  const b = generateAnatomy({ ...max, definition: fittedRectus }, visible).meshes;
  const buffers = (meshes, key) => meshes[key].map(mesh => mesh.positions);
  assert.deepEqual(buffers(a, 'bones'), buffers(b, 'bones'));
  assert.deepEqual(buffers(a, 'inguinalLigaments'), buffers(b, 'inguinalLigaments'));
  assert.ok(buffers(b, 'rectusAbdominis').every(array => array.every(Number.isFinite)));
  const sameRectus = a.rectusAbdominis.every((mesh, j) => mesh.positions.every((value, i) => value === b.rectusAbdominis[j].positions[i]));
  assert.equal(sameRectus, abdominalModel !== 1, 'only the current mode uses the fitted width');
}
assert.equal(fatRegions.length,4);
const grooves=structuredClone(p);
grooves.definition.muscles['rectus_abdominis.L'].fittedIntersections=[.8,.6].map(position=>({position,angle:0,curvature:0,width:1,depth:.4,extent:.86}));
const grooved=generateAnatomy(grooves,layers);
assert.deepEqual(grooved.meshes.bones.map(m=>m.positions),base.meshes.bones.map(m=>m.positions));
assert.ok(grooved.meshes.rectusAbdominis.some(m=>m.anatomicalName==='rectus_abdominis_L_continuous'));
const bellyShape=grooves.definition.muscles['rectus_abdominis.L'];
bellyShape.fittedBellies=Array.from({length:3},()=>({width:1.2,peak:.58,projection:7}));
const belled=generateAnatomy(grooves,layers);
assert.deepEqual(belled.meshes.bones.map(m=>m.positions),grooved.meshes.bones.map(m=>m.positions));
assert.notDeepEqual(belled.meshes.rectusAbdominis.map(m=>m.positions),grooved.meshes.rectusAbdominis.map(m=>m.positions));
assert.deepEqual(normalizeDefinition(grooves.definition).muscles['rectus_abdominis.L'].fittedBellies,bellyShape.fittedBellies);
const {paintFat,normalizeFatPaint}=await import('../src/anatomy/fatPaint.ts');
const field = {};
paintFat(field, [0, 10.5, .9], 45, 6, 'add');
assert.equal(field['0,70,6'], 6);
paintFat(field, [0, 10.5, .9], 45, 2, 'remove');
assert.equal(field['0,70,6'], 4);
paintFat(field, [0, 10.5, .9], 45, 6, 'smooth');
assert.ok(field['0,70,6'] < 4);
assert.deepEqual(normalizeFatPaint(JSON.parse(JSON.stringify(field))), field);
for(const indices of [new Uint32Array([0,1,2]),new Uint32Array([2,1,0])]){const bvh=new SurfaceBVH({positions:new Float32Array([-1,-1,1,1,-1,1,0,1,1]),indices});const hit=bvh.queryRay([0,0,0],[0,0,1],2);assert.ok(hit&&Math.abs(hit.distance-1)<1e-9,'ray intersections survive reflected winding');}
console.log(JSON.stringify({status:'PASS',outerMoved,skinMoved,oppositeDrift,pectoralDrift,fatError,checks:'deep support, fixed bones, side isolation, skin following, rectus/chest isolation, regional fat, serialization and two-sided rays'}));
