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

console.log('Testing P2: Surface BVH and Area Sampling...');
const { SurfaceBVH } = await import('../src/anatomy/inference/observationProxy.ts');
const { snapshotImmutableSource } = await import('../src/anatomy/inference/sourceGLB.ts');
const { analyzeSourceAsset } = await import('../src/anatomy/inference/inputAnalysis.ts');

// Create a simple box mesh with 12 triangles
const boxPositions = new Float32Array([
  -0.5, -0.5, -0.5,   0.5, -0.5, -0.5,   0.5,  0.5, -0.5,  -0.5,  0.5, -0.5,
  -0.5, -0.5,  0.5,   0.5, -0.5,  0.5,   0.5,  0.5,  0.5,  -0.5,  0.5,  0.5,
]);
const boxIndices = new Uint32Array([
  0, 2, 1, 0, 3, 2,  4, 5, 6, 4, 6, 7,
  0, 1, 5, 0, 5, 4,  1, 2, 6, 1, 6, 5,
  2, 3, 7, 2, 7, 6,  3, 0, 4, 3, 4, 7,
]);

const bvh = new SurfaceBVH({ positions: boxPositions, indices: boxIndices });
const query = bvh.queryClosestPoint([0, 0, 1.0]);
assert.ok(Math.abs(query.point[2] - 0.5) < 1e-4, 'Closest point on box front face z=0.5');
assert.ok(Math.abs(Math.sqrt(query.distanceSq) - 0.5) < 1e-4, 'Distance to box front face should be 0.5');

const samples = bvh.sampleSurface(100);
assert.equal(samples.points.length, 300);
assert.equal(samples.normals.length, 300);
assert.equal(samples.areas.length, 100);

// Test on real the supplied GLB
const glbPath = process.argv[2];
if (glbPath && existsSync(glbPath)) {
  console.log('Testing P2 with high-density the supplied GLB (1.92M tris)...');
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

  const t0 = performance.now();
  const analysis = analyzeSourceAsset(sourceAsset);
  const elapsed = performance.now() - t0;
  console.log(`P2: Analysis completed in ${elapsed.toFixed(1)}ms`);
  console.log('  Proxy vertices:', analysis.proxyPositions.length / 3);
  console.log('  Yaw correction (deg):', (analysis.yawCorrectionRad * 180 / Math.PI).toFixed(1));
  console.log('  Scale factor:', analysis.scaleCorrection.toFixed(3));
  console.log('  Confidence:', analysis.overallConfidence.toFixed(2));
  console.log('  Pubis landmark:', analysis.landmarks.pubis.positionMeters.map(v => v.toFixed(3)));
  console.log('  Pubis confidence:', analysis.landmarks.pubis.confidence.toFixed(2));

  assert.equal(analysis.yawCorrectionRad, -Math.PI / 2);
  assert.ok(analysis.scaleCorrection > 1.6 && analysis.scaleCorrection < 2.0);
  assert.ok(analysis.overallConfidence >= 0.7);

  // Measure BVH query speed on the proxy
  const tQ0 = performance.now();
  const queryResult = analysis.bvh.queryClosestPoint([0, 1.2, 0.5]);
  const qElapsed = performance.now() - tQ0;
  console.log(`P2: BVH closest point query took ${qElapsed.toFixed(3)}ms`);
  assert.ok(Number.isFinite(queryResult.distanceSq));
}

console.log('P2 checks successfully passed!');
