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

const { analyzeHumanoidMesh, fitAnatomyToHumanoid } = await import('../src/anatomy/fitBody.ts');
const { CANONICAL_LANDMARKS, getMannequinLandmarks } = await import('../src/anatomy/landmarks.ts');
const { createRegistration } = await import('../src/anatomy/registration.ts');
const { bindSkinToAnatomy, driveSkinPositions } = await import('../src/anatomy/skinBinding.ts');

console.log('Testing Canonical Landmarks & Mannequin Registration...');
const mannequinLandmarks = getMannequinLandmarks();
assert.ok(mannequinLandmarks.headTop[1] > 1.70, 'Mannequin height should be > 1.70m');
assert.ok(mannequinLandmarks.pubis[1] > 0.70 && mannequinLandmarks.pubis[1] < 1.05, 'Mannequin pubis height plausible');
assert.ok(mannequinLandmarks.shoulder_R[0] > 0.15, 'Mannequin shoulder lateral offset positive');
assert.ok(mannequinLandmarks.shoulder_L[0] < -0.15, 'Mannequin shoulder lateral offset negative');

const reg = createRegistration(CANONICAL_LANDMARKS, mannequinLandmarks);
const testHead = reg.warpPoint(CANONICAL_LANDMARKS.headTop);
assert.ok(Math.abs(testHead[1] - mannequinLandmarks.headTop[1]) < 0.05, 'Registration maps headTop correctly');

// Now test with the supplied GLB
const glbPath = process.argv[2];
if (glbPath && existsSync(glbPath)) {
  console.log(`Loading and testing against user GLB: ${glbPath}...`);
  const { NodeIO } = await import('@gltf-transform/core');
  const { KHRMeshQuantization, EXTMeshoptCompression } = await import('@gltf-transform/extensions');
  const { MeshoptDecoder } = await import('meshoptimizer');

  const io = new NodeIO()
    .registerExtensions([KHRMeshQuantization, EXTMeshoptCompression])
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

  const doc = await io.read(glbPath);
  const mesh = doc.getRoot().listMeshes()[0];
  const prim = mesh.listPrimitives()[0];
  const rawPositions = prim.getAttribute('POSITION').getArray();

  // Subsample vertices for rapid numerical verification (e.g. 5,000 vertices)
  const step = Math.max(1, Math.floor(rawPositions.length / (5000 * 3)));
  const sampledPositions = new Float32Array(Math.floor(rawPositions.length / (step * 3)) * 3);
  let dst = 0;
  for (let i = 0; i < rawPositions.length; i += step * 3) {
    if (dst + 2 < sampledPositions.length) {
      sampledPositions[dst] = rawPositions[i];
      sampledPositions[dst + 1] = rawPositions[i + 1];
      sampledPositions[dst + 2] = rawPositions[i + 2];
      dst += 3;
    }
  }

  console.log(`Analyzing sampled mesh: ${sampledPositions.length / 3} vertices...`);
  const analysis = analyzeHumanoidMesh(sampledPositions);

  console.log('Analysis results:');
  console.log('  Yaw correction (deg):', (analysis.yawCorrection * 180 / Math.PI).toFixed(1));
  console.log('  Scale factor:', analysis.scaleCorrection.toFixed(3));
  console.log('  Confidence:', analysis.confidence.toFixed(2));
  console.log('  Estimated Pelvis Width (cm):', analysis.estimatedParameters.pelvisWidth.toFixed(1));
  console.log('  Estimated Chest Width (cm):', analysis.estimatedParameters.chestWidth.toFixed(1));
  console.log('  Pubis Landmark (m):', analysis.detectedLandmarks.pubis.map(v => v.toFixed(3)));
  console.log('  Shoulder Left Landmark (m):', analysis.detectedLandmarks.shoulder_L.map(v => v.toFixed(3)));

  assert.equal(analysis.yawCorrection, -Math.PI / 2, 'Should detect -90 deg yaw rotation due to arms extending along Z');
  assert.ok(analysis.scaleCorrection > 1.6 && analysis.scaleCorrection < 2.0, 'Should detect ~1.8x scale correction for 0.98m mesh');
  assert.ok(analysis.detectedLandmarks.pubis[1] > 0.60 && analysis.detectedLandmarks.pubis[1] < 1.05, 'Detected pubis within human range');

  const fit = fitAnatomyToHumanoid(sampledPositions);
  assert.ok(fit.registration, 'Should create registration warp');

  // Test skin binding & driving
  console.log('Testing Skin Binding & Drive...');
  const mockPectoralRest = {
    name: 'pectoralis_major_sternocostal.R',
    positions: new Float32Array([0.08, 1.30, 0.08, 0.12, 1.32, 0.085, 0.15, 1.35, 0.09]),
  };
  const mockPectoralHypertrophy = {
    name: 'pectoralis_major_sternocostal.R',
    positions: new Float32Array([0.08, 1.30, 0.10, 0.12, 1.32, 0.110, 0.15, 1.35, 0.115]), // Grown +20mm in Z
  };

  const skinBinding = bindSkinToAnatomy(sampledPositions.subarray(0, 300), [mockPectoralRest]);
  assert.equal(skinBinding.bindings.length, 100, 'Should bind all 100 skin vertices');

  const drivenRest = driveSkinPositions(skinBinding, [mockPectoralRest]);
  let driftSum = 0;
  for (let i = 0; i < drivenRest.length; i++) {
    driftSum += Math.abs(drivenRest[i] - sampledPositions[i]);
  }
  assert.ok(driftSum < 1e-5, 'Zero cumulative drift at rest');

  const drivenHypertrophy = driveSkinPositions(skinBinding, [mockPectoralHypertrophy]);
  assert.ok(drivenHypertrophy.some((v, i) => Math.abs(v - sampledPositions[i]) > 1e-4), 'Driven skin moved under muscle hypertrophy');

  console.log('All tests passed for generic humanoid adaptation!');
} else {
  console.log(`Pass a GLB path to include live verification. Synthetic checks passed.`);
}
