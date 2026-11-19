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

console.log('Testing P7: Muscle/Fat Inference & Fit Report...');
const { parameterRegistry } = await import('../src/anatomy/inference/parameterRegistry.ts');
const { buildFitReport } = await import('../src/anatomy/inference/fitReport.ts');
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
  const solverRes = solveObservableParameters(analysis, 5);

  const report = buildFitReport(
    analysis.assetId,
    analysis.fingerprint,
    solverRes.fittedParameters,
    analysis.landmarks,
    parameterRegistry,
    solverRes.residualMm,
    { total: 60.4, muscle: 32.2, fat: 28.2 },
    analysis.warnings
  );

  assert.equal(report.parameters.pelvisWidth.status, 'estimated');
  assert.equal(report.parameters.pectoral.status, 'prior');
  assert.equal(report.parameters.skinTone.status, 'unobservable');

  console.log('P7 Fit Report generated:');
  console.log('  Overall confidence:', report.overallConfidence);
  console.log('  Observed pelvisWidth:', report.parameters.pelvisWidth.value, `(${report.parameters.pelvisWidth.status})`);
  console.log('  Prior pectoral volume:', report.parameters.pectoral.value, `(${report.parameters.pectoral.status})`);
  console.log('  Tissue volumes (L):', report.tissueVolumes);
}

console.log('P7 checks successfully passed!');
