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

console.log('Testing P3: Canonical FORMA Baseline & Identity Registration...');
const { CANONICAL_LANDMARKS, getMannequinLandmarks } = await import('../src/anatomy/landmarks.ts');
const { createRegistration } = await import('../src/anatomy/registration.ts');

const selfReg = createRegistration(CANONICAL_LANDMARKS, CANONICAL_LANDMARKS);

const testPoints = [
  [0, 1.80, 0],
  [0, 1.45, 0.05],
  [-0.20, 1.44, -0.03],
  [0.20, 1.44, -0.03],
  [0, 0.88, 0.08],
  [-0.09, 0.51, 0.01],
  [0.09, 0.09, -0.02],
  [0.15, 1.25, -0.04],
];

for (const p of testPoints) {
  const warped = selfReg.warpPoint(p);
  const err = Math.hypot(warped[0] - p[0], warped[1] - p[1], warped[2] - p[2]);
  assert.ok(err < 1e-5, `Self-registration must be exact identity (error was ${err} at point ${p})`);
}

// Test mesh warp identity
const testPositions = new Float32Array(testPoints.flat());
const warpedMesh = selfReg.warpMesh(testPositions);
for (let i = 0; i < testPositions.length; i++) {
  assert.ok(Math.abs(warpedMesh.positions[i] - testPositions[i]) < 1e-5, 'WarpMesh identity check');
}

console.log('P3 checks successfully passed!');
