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
const {proportionChain,proportionPoint,applyBoneProportions,normalizeBoneLengths}=await import('../src/anatomy/segmentProportions.ts');
const {buildInternals}=await import('../src/anatomy/geometry.ts');
const p={...defaults,boneLengthsCm:{upperArm_L:33,forearm_L:27,thigh_L:45,shin_L:43,upperArm_R:32,forearm_R:26,thigh_R:44,shin_R:42}};
for(const side of [-1,1])for(const leg of [false,true]) {
  const {source,target}=proportionChain(p,side,leg);
  for(let i=0;i<2;i++) {
    const bone=(leg?['thigh','shin']:['upperArm','forearm'])[i],wanted=p.boneLengthsCm[bone+'_'+(side<0?'L':'R')];
    const d=target[i+1].map((v,k)=>v-target[i][k]);
    assert.ok(Math.abs(Math.hypot(d[0],d[1]*p.height/175,d[2])*10-wanted)<1e-6);
    assert.deepEqual(proportionPoint(p,source[i+1],leg),target[i+1]);
  }
  const distal=source[2].map((v,k)=>v+(k===1?-.5:0));
  assert.ok(Math.abs(proportionPoint(p,distal,leg)[1]-distal[1]-(target[2][1]-source[2][1]))<1e-6);
}
const inside=buildInternals(defaults,['bones']);
const bone=inside.bones.find(m=>m.anatomicalName==='humerus_L');assert.ok(bone,'actual procedural humerus');
const original=bone.positions.slice();applyBoneProportions(defaults,bone);assert.deepEqual(bone.positions,original);
applyBoneProportions(p,bone);assert.ok(bone.positions.some((v,i)=>Math.abs(v-original[i])>.01),'estimated lengths change generated bone vertices');
assert.deepEqual(normalizeBoneLengths({upperArm_L:NaN,shin_R:43,forearm_R:-2}),{shin_R:43});
console.log('PASS: bilateral bone lengths reach targets, joint continuity, distal transport, actual procedural bone deformation and unchanged defaults');

const pelvis=inside.bones.find(m=>/^hip_bone/.test(m.anatomicalName??''));assert.ok(pelvis);
const pelvisOriginal=pelvis.positions.slice();applyBoneProportions(p,pelvis);assert.deepEqual(pelvis.positions,pelvisOriginal,'long-bone lengths preserve the pelvic anchor');
