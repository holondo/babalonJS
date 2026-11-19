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

console.log('Testing P0: Source GLB Immutable Asset Wrapping...');
const { snapshotImmutableSource, assertSourceUnchanged, hashBuffer } = await import('../src/anatomy/inference/sourceGLB.ts');

const mockPositions = new Float32Array([
  0, 0, 0,
  1, 0, 0,
  0, 1, 0,
  1, 1, 0
]);
const mockNormals = new Float32Array([
  0, 0, 1,
  0, 0, 1,
  0, 0, 1,
  0, 0, 1
]);
const mockIndices = new Uint32Array([0, 1, 2, 1, 3, 2]);

const snapshot = snapshotImmutableSource('test_asset', [{
  id: 'mesh_0',
  positions: mockPositions,
  normals: mockNormals,
  indices: mockIndices,
}]);

assert.equal(snapshot.assetId, 'test_asset');
assert.equal(snapshot.totalVertices, 4);
assert.equal(snapshot.totalTriangles, 2);
assert.ok(snapshot.fingerprint.length > 10, 'Fingerprint generated');
assert.ok(assertSourceUnchanged(snapshot), 'Source confirmed unchanged');

// Verify that original array mutation does NOT alter snapshot
mockPositions[0] = 999;
assert.equal(snapshot.submeshes[0].positions[0], 0, 'Snapshot must be immutable and isolated from source mutations');

// Check live with the supplied GLB if available
const glbPath = process.argv[2];
if (glbPath && existsSync(glbPath)) {
  console.log('Testing P0 with the supplied GLB...');
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
  const norm = prim.getAttribute('NORMAL')?.getArray();
  const ind = prim.getIndices()?.getArray();

  const glbSnapshot = snapshotImmutableSource('humanoid_glb', [{
    id: 'tripo_prim',
    positions: pos,
    normals: norm,
    indices: ind,
  }]);

  assert.equal(glbSnapshot.totalVertices, pos.length / 3);
  assert.ok(assertSourceUnchanged(glbSnapshot));
  console.log(`P0: Preserved the supplied GLB immutable snapshot with ${glbSnapshot.totalVertices} vertices and ${glbSnapshot.totalTriangles} triangles.`);
}

console.log('Testing P1: Parameter Registry, Observability & Invalidation...');
const { parameterRegistry } = await import('../src/anatomy/inference/parameterRegistry.ts');

const report = parameterRegistry.generateCoverageReport();
console.log('Parameter Registry Coverage:', report);
assert.ok(report.totalRegistered >= 102, 'All catalogue controls registered');
assert.ok(report.observableCount >= 10, 'Anthropometry parameters observable');
assert.ok(report.conditionedPriorCount >= 20, 'Muscle & fat priors classified');

// Unit conversions
const chestWidthMeters = parameterRegistry.toCanonicalMeters('chestWidth', 34);
assert.equal(chestWidthMeters, 0.34, 'cm -> meters conversion exact');
const chestWidthCm = parameterRegistry.fromCanonicalMeters('chestWidth', 0.34);
assert.equal(chestWidthCm, 34, 'meters -> cm conversion exact');

// Dependency invalidation
const pelvisInvalidated = parameterRegistry.getInvalidatedStructures(['pelvisWidth']);
assert.ok(pelvisInvalidated.has('pelvis'));
assert.ok(pelvisInvalidated.has('hipJoint'));
assert.ok(pelvisInvalidated.has('gluteals'));
assert.ok(pelvisInvalidated.has('skinCage'));

console.log('P0 and P1 checks successfully passed!');
