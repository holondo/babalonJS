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


const {defaults}=await import('../src/anatomy/parameters.ts');
const {generateAnatomy}=await import('../src/anatomy/generation.ts');
const {muscleDefaults,interactionDefaults}=await import('../src/anatomy/definition.ts');
const {buildRegionalSurface}=await import('../src/anatomy/geometry.ts');
const {snapshotImmutableSource}=await import('../src/anatomy/inference/sourceGLB.ts');
const {analyzeSourceAsset}=await import('../src/anatomy/inference/inputAnalysis.ts');
const {fitTrunk}=await import('../src/anatomy/inference/trunkFit.ts');
const layers=['bones','aponeuroses','rectusAbdominis','externalOblique','internalOblique','transversusAbdominis','otherMuscles','inguinalLigaments'];
const p={...defaults,definition:{version:1,muscles:{'rectus_abdominis.L':{...muscleDefaults},'rectus_abdominis.R':{...muscleDefaults}},bones:{},interaction:{...interactionDefaults,attachments:true}}};
const baseline=generateAnatomy(p,layers);
assert.equal(baseline.attachments.filter(a=>a.id.startsWith('pectoralis.cost.sheath')).length,2,'costal pectorals use structural rectus sheath');
assert.ok(Math.max(...baseline.attachments.map(a=>a.errorMm))<.01);
const lengths={...p,boneLengthsCm:{upperArm_L:33,upperArm_R:31,forearm_L:26,forearm_R:25,thigh_L:44,thigh_R:42,shin_L:43,shin_R:41}};
const scaled=generateAnatomy(lengths,layers),attachmentMax=Math.max(...scaled.attachments.map(a=>a.errorMm));
assert.ok(attachmentMax<.05,'final proportion changes retain semantic attachments: '+attachmentMax);
const grown=generateAnatomy({...p,rectus:2.5},layers);
const before=new Map(baseline.meshes.otherMuscles.filter(m=>m.anatomicalName?.startsWith('pectoralis_major_')).map(m=>[m.anatomicalName,m]));
let pecMax=0,chestMax=0,abdomenMax=0;
for(const mesh of grown.meshes.otherMuscles)if(before.has(mesh.anatomicalName))for(let i=0;i<mesh.positions.length;i++)pecMax=Math.max(pecMax,Math.abs(mesh.positions[i]-before.get(mesh.anatomicalName).positions[i])*100);
const a=baseline.meshes.skin[0].positions,b=grown.meshes.skin[0].positions;
for(let i=0;i<a.length;i+=3){const d=Math.hypot(b[i]-a[i],b[i+1]-a[i+1],b[i+2]-a[i+2])*100;if(a[i+1]>12.9)chestMax=Math.max(chestMax,d);if(a[i+1]>9&&a[i+1]<12)abdomenMax=Math.max(abdomenMax,d);}
assert.ok(pecMax<.1,'rectus growth cannot inflate pectoral muscles: '+pecMax);
assert.ok(chestMax<.5,'rectus growth is isolated below the chest: '+chestMax);assert.ok(abdomenMax>1);
const genetic=structuredClone(p);genetic.definition.muscles['rectus_abdominis.L'].volume=1.8;
const shaped=generateAnatomy(genetic,layers),metric=shaped.anatomyMetrics.find(m=>m.id==='rectus_abdominis.L');
assert.ok(metric.actualCm3>metric.baselineCm3*1.5);assert.ok(metric.error<.05);
for(const mesh of shaped.meshes.otherMuscles)if(before.has(mesh.anatomicalName))for(let i=0;i<mesh.positions.length;i++)assert.ok(Math.abs(mesh.positions[i]-before.get(mesh.anatomicalName).positions[i])*100<.1,'individual rectus volume cannot inflate the pectoral mesh');
const geneticSkin=shaped.meshes.skin[0].positions;for(let i=0;i<a.length;i+=3)if(a[i+1]>12.9)assert.ok(Math.hypot(...[0,1,2].map(k=>geneticSkin[i+k]-a[i+k]))*100<.5,'individual rectus volume stays below the chest');

const rightA=baseline.meshes.rectusAbdominis.filter(m=>m.anatomicalName.includes('_R_'));
const rightB=shaped.meshes.rectusAbdominis.filter(m=>m.anatomicalName.includes('_R_'));
assert.ok(rightA.length>0&&rightA.length===rightB.length);
for(let i=0;i<rightA.length;i++)assert.deepEqual(rightA[i].positions,rightB[i].positions,'opposite side isolated');
// Exercise the real solver path on procedural surface input with explicit locks.
// Clothed input must not invent genetics or alter the observed constraints.
const surface=buildRegionalSurface(defaults),source=snapshotImmutableSource('trunk-locked',[{id:'skin',positions:surface.positions,indices:surface.indices}]);
const analysis=analyzeSourceAsset(source,{surface:'clothed',parameters:{rectWidth:defaults.rectWidth,rectGap:defaults.rectGap},priorParameters:p});
const result=fitTrunk(analysis,p);assert.deepEqual(result.evidence.accepted,[]);assert.equal(result.parameters.rectWidth,p.rectWidth);assert.deepEqual(JSON.parse(JSON.stringify(result.parameters.definition.muscles)),p.definition.muscles);
console.log(JSON.stringify({status:'PASS',attachmentMaxMm:attachmentMax,pectoralDriftMm:pecMax,chestDriftMm:chestMax,abdomenGrowthMm:abdomenMax,geneticVolumeError:metric.error,clothedLocked:true}));
