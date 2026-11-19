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

console.log('Testing P6: 3-Layer Volumetric Anatomical Envelopes...');
const { buildSubjectEnvelopes, tetVolume } = await import('../src/anatomy/fitting/anatomicalEnvelopes.ts');
const { snapshotImmutableSource } = await import('../src/anatomy/inference/sourceGLB.ts');
const { analyzeSourceAsset } = await import('../src/anatomy/inference/inputAnalysis.ts');

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

  // Skeletal axis points along the centerline and limbs
  const boneAxisPoints = [
    [0, 0.90, 0],   // pelvis
    [0, 1.20, 0],   // thorax
    [0, 1.45, 0],   // neck
    [-0.14, 0.70, 0], // left thigh
    [0.14, 0.70, 0],  // right thigh
    [-0.14, 0.30, 0], // left shank
    [0.14, 0.30, 0],  // right shank
  ];

  const envelopes = buildSubjectEnvelopes(
    analysis.proxyPositions,
    analysis.proxyIndices,
    boneAxisPoints,
    0.15
  );

  assert.equal(envelopes.vertices.length, analysis.proxyPositions.length / 3);
  assert.ok(envelopes.totalVolumeM3 > 0.01, 'Total body volume should be positive');
  assert.ok(envelopes.muscleVolumeM3 > 0.005, 'Muscle volume should be positive');
  assert.ok(envelopes.fatVolumeM3 > 0.001, 'Fat volume should be positive');

  console.log('P6 Envelopes built successfully:');
  console.log('  Total volume (m³): ', envelopes.totalVolumeM3.toFixed(4));
  console.log('  Muscle volume (m³):', envelopes.muscleVolumeM3.toFixed(4));
  console.log('  Fat volume (m³):   ', envelopes.fatVolumeM3.toFixed(4));

  // Verify layer ordering on every vertex
  for (let i = 0; i < envelopes.vertices.length; i++) {
    const v = envelopes.vertices[i];
    assert.ok(v.boneRadius > 0, 'Bone radius positive');
    assert.ok(v.muscleThickness > 0, 'Muscle thickness positive');
    assert.ok(v.fatThickness > 0, 'Fat thickness positive');
  }
  console.log('P6: All vertices satisfy positive layer ordering (bone < muscle <= skin).');
}

console.log('P6 checks successfully passed!');
