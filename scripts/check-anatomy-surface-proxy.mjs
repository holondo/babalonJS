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


const {connectedSurfaceProxy}=await import('../src/anatomy/inference/surfaceProxy.ts');
const {SurfaceBVH}=await import('../src/anatomy/inference/observationProxy.ts');
const {analyzeHumanoidMesh}=await import('../src/anatomy/fitBody.ts');
let positions,indices;
if(process.argv[2]) {
 const {NodeIO}=await import('@gltf-transform/core');const {KHRMeshQuantization,EXTMeshoptCompression}=await import('@gltf-transform/extensions');const {MeshoptDecoder}=await import('meshoptimizer');
 const io=new NodeIO().registerExtensions([KHRMeshQuantization,EXTMeshoptCompression]).registerDependencies({'meshopt.decoder':MeshoptDecoder});
 const doc=await io.read(process.argv[2]),primitive=doc.getRoot().listMeshes().flatMap(m=>m.listPrimitives()).sort((a,b)=>b.getAttribute('POSITION').getCount()-a.getAttribute('POSITION').getCount())[0];
 positions=analyzeHumanoidMesh(primitive.getAttribute('POSITION').getArray()).neutralPositions;indices=new Uint32Array(primitive.getIndices().getArray());
} else {
 const {defaults}=await import('../src/anatomy/parameters.ts');const {buildRegionalSurface}=await import('../src/anatomy/geometry.ts');const mesh=buildRegionalSurface(defaults);positions=Float32Array.from(mesh.positions,v=>v*.1);indices=mesh.indices;
}
const before=positions.slice(),originalIndices=indices.slice(),start=performance.now(),proxy=await connectedSurfaceProxy(positions,indices),bvh=new SurfaceBVH(proxy);
let maxMm=0;for(let i=0;i<positions.length;i+=3*Math.max(1,Math.floor(positions.length/3/600)))maxMm=Math.max(maxMm,Math.sqrt(bvh.queryClosestPoint([positions[i],positions[i+1],positions[i+2]]).distanceSq)*1000);
assert.deepEqual(positions,before);assert.deepEqual(indices,originalIndices);assert.ok(proxy.evidence.estimatedErrorMm<=2.001);assert.ok(maxMm<8,'sampled proxy distance: '+maxMm);
console.log(JSON.stringify({status:'PASS',...proxy.evidence,sampledMaxMm:maxMm,computeMs:performance.now()-start}));
