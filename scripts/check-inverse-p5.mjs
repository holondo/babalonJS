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

console.log('Testing P5: Subject-Specific Rigid Skeleton & Attachments...');
const { CANONICAL_LANDMARKS } = await import('../src/anatomy/landmarks.ts');
const { createRegistrationV2 } = await import('../src/anatomy/fitting/registrationV2.ts');
const { snapshotImmutableSource } = await import('../src/anatomy/inference/sourceGLB.ts');
const { analyzeSourceAsset } = await import('../src/anatomy/inference/inputAnalysis.ts');

const targetLandmarks = structuredClone(CANONICAL_LANDMARKS);
// Alter target landmarks (wider pelvis, longer legs)
targetLandmarks.pubis = [0, 0.85, 0.08];
targetLandmarks.hipJoint_L = [-0.14, 0.88, -0.02];
targetLandmarks.knee_L = [-0.14, 0.45, 0.01];

const regV2 = createRegistrationV2(CANONICAL_LANDMARKS, targetLandmarks);

// 1. Check bone rigidity: distance between two points on femur must scale uniformly along length
const pA = CANONICAL_LANDMARKS.hipJoint_L;
const pB = CANONICAL_LANDMARKS.knee_L;
const warpedA = regV2.warpBone('femur_L', pA);
const warpedB = regV2.warpBone('femur_L', pB);

const expectedLen = Math.hypot(targetLandmarks.knee_L[0] - targetLandmarks.hipJoint_L[0], targetLandmarks.knee_L[1] - targetLandmarks.hipJoint_L[1], targetLandmarks.knee_L[2] - targetLandmarks.hipJoint_L[2]);
const actualLen = Math.hypot(warpedB[0] - warpedA[0], warpedB[1] - warpedA[1], warpedB[2] - warpedA[2]);
assert.ok(Math.abs(expectedLen - actualLen) < 1e-5, 'Rigid bone endpoints match exactly');

// 2. Check attachments with the supplied GLB
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
  const humanoidLandmarks = structuredClone(CANONICAL_LANDMARKS);
  for (const [k, obs] of Object.entries(analysis.landmarks)) {
    humanoidLandmarks[k] = obs.positionMeters;
  }

  const humanoidReg = createRegistrationV2(CANONICAL_LANDMARKS, humanoidLandmarks);
  assert.ok(humanoidReg.boneTransforms.has('pelvis'));
  assert.ok(humanoidReg.boneTransforms.has('femur_R'));
  assert.ok(humanoidReg.boneTransforms.has('humerus_R'));

  const warpedPubis = humanoidReg.warpBone('pelvis', CANONICAL_LANDMARKS.pubis);
  assert.ok(Math.abs(warpedPubis[1] - humanoidLandmarks.pubis[1]) < 0.02, 'Pubis attachment aligns with target bone');
  console.log('P5: Verified rigid bone registration against the supplied GLB landmarks.');
}

console.log('P5 checks successfully passed!');
