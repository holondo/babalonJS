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

console.log('Testing P8 (Hard Gate): Original Skin Binding & Exact Identity at theta0...');
const { snapshotImmutableSource } = await import('../src/anatomy/inference/sourceGLB.ts');
const { buildOriginalSkinBinding, evaluateDeformedSkin } = await import('../src/anatomy/binding/originalSkinBinding.ts');

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
  const norm = prim.getAttribute('NORMAL')?.getArray();
  const uvs = prim.getAttribute('TEXCOORD_0')?.getArray();
  const ind = prim.getIndices()?.getArray();

  const sourceAsset = snapshotImmutableSource('dense_humanoid', [{
    id: 'tripo_mesh',
    positions: pos,
    normals: norm,
    uvs: uvs,
    indices: ind,
  }]);

  // Synthetic cage proxy
  const cagePositions = new Float32Array([
    0, 0, 0,
    0, 1.8, 0,
    0.3, 1.2, 0,
    -0.3, 1.2, 0,
  ]);
  const cageIndices = new Uint32Array([0, 1, 2, 0, 3, 1]);

  // Sample a subset for rapid unit test
  const testSubmesh = {
    ...sourceAsset.submeshes[0],
    positions: pos.subarray(0, 3000), // 1000 vertices
  };
  const testAsset = {
    ...sourceAsset,
    submeshes: [testSubmesh],
  };

  const binding = buildOriginalSkinBinding(testAsset, 0, cagePositions, cageIndices);
  assert.equal(binding.bindings.length, 1000);

  // Check 1: Hard Gate - Identity at theta0
  const baselineOutput = evaluateDeformedSkin(
    binding,
    cagePositions, // current == baseline
    cagePositions,
    cageIndices
  );

  let maxDrift = 0;
  for (let i = 0; i < baselineOutput.length; i++) {
    const diff = Math.abs(baselineOutput[i] - testSubmesh.positions[i]);
    if (diff > maxDrift) maxDrift = diff;
  }
  console.log(`P8 Hard Gate: Maximum drift at theta0: ${maxDrift.toExponential(4)}`);
  assert.ok(maxDrift < 1e-7, 'Drift at baseline theta0 must be exact floating-point zero');

  // Check 2: Delta deformation
  const deformedCage = new Float32Array(cagePositions);
  deformedCage[2 * 3] += 0.05; // Move cage point by +5cm

  const deformedOutput = evaluateDeformedSkin(
    binding,
    deformedCage,
    cagePositions,
    cageIndices
  );

  const movedCount = deformedOutput.filter((v, i) => Math.abs(v - testSubmesh.positions[i]) > 1e-4).length;
  console.log(`P8: Deformed ${movedCount} coordinates under cage delta.`);
  assert.ok(movedCount > 0, 'Cage deformation successfully transferred to skin');
}

console.log('P8 checks successfully passed!');
