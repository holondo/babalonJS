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

console.log('Testing P4: Coarse Inverse Fitting on Observable Globals...');
const { snapshotImmutableSource } = await import('../src/anatomy/inference/sourceGLB.ts');
const { analyzeSourceAsset } = await import('../src/anatomy/inference/inputAnalysis.ts');
const { solveObservableParameters } = await import('../src/anatomy/inference/fitSolver.ts');

const glbPath = process.argv[2];
if (glbPath && existsSync(glbPath)) {
  const { NodeIO } = await import('@gltf-transform/core');
  const { KHRMeshQuantization, EXTMeshoptCompression } = await import('@gltf-transform/extensions');
  const { MeshoptDecoder } = await import('meshoptimizer');

  const io = new NodeIO()
    .registerExtensions([KHRMeshQuantization, EXTMeshoptCompression])
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

  const doc = await io.read(glbPath);
  const mesh = doc.getRoot().listMeshes()[0];
  const prim = mesh.listPrimitives()[0];
  const pos = prim.getAttribute('POSITION').getArray();
  const ind = prim.getIndices()?.getArray();

  const sourceAsset = snapshotImmutableSource('dense_humanoid', [{
    id: 'tripo_mesh',
    positions: pos,
    indices: ind,
  }]);

  const analysis = analyzeSourceAsset(sourceAsset);
  console.log('Initial estimated pelvis width:', analysis.estimatedParameters.pelvisWidth);
  console.log('Initial estimated chest width:', analysis.estimatedParameters.chestWidth);

  const t0 = performance.now();
  const fitResult = solveObservableParameters(analysis, 5);
  const elapsed = performance.now() - t0;

  console.log(`P4: Coarse inverse solver completed in ${elapsed.toFixed(1)}ms (${fitResult.iterations} iterations)`);
  console.log('  Initial loss:', fitResult.initialLoss.toFixed(5));
  console.log('  Final loss:  ', fitResult.finalLoss.toFixed(5));
  console.log('  Residual mm: ', fitResult.residualMm.toFixed(2));
  console.log('  Fitted pelvis width:', fitResult.fittedParameters.pelvisWidth);
  console.log('  Fitted chest width: ', fitResult.fittedParameters.chestWidth);

  assert.ok(fitResult.finalLoss <= fitResult.initialLoss + 1e-6, 'Final loss must be <= initial loss');
  assert.ok(fitResult.fittedParameters.pelvisWidth >= 25 && fitResult.fittedParameters.pelvisWidth <= 55);
  assert.ok(fitResult.fittedParameters.chestWidth >= 25 && fitResult.fittedParameters.chestWidth <= 55);
}

console.log('P4 checks successfully passed!');
