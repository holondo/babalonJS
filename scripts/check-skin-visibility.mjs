// Focused regression: an arm close to the hip must not pull it through the air gap.
// Run with node scripts/check-skin-visibility.mjs; uses the actual envelope and worker solver.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const moduleUrl = (file, imports = {}) => {
  let source = readFileSync(new URL(file, import.meta.url), 'utf8');
  for (const [name, url] of Object.entries(imports)) source = source.replaceAll(`'${name}'`, JSON.stringify(url));
  return `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText).toString('base64')}`;
};
const math = moduleUrl('../src/skinMath.ts');
const visibility = moduleUrl('../src/skinVisibility.ts', { './skinMath': math });
const { visibleBoneDistances } = await import(visibility);
const imports = { './skinMath': math, './skinVisibility': visibility };
const weightsModule = moduleUrl('../src/weights.ts', imports);
const { envelopeWeights, strongest } = await import(weightsModule);
let heatResult;
globalThis.self = { postMessage: (m) => { if (m.type !== 'progress') heatResult = m; } };
await import(moduleUrl('../src/weights.worker.ts', { ...imports, './weights': weightsModule }));

const vertices = [], triangles = [];
function box(min, max, steps = 10) {
  for (let axis = 0; axis < 3; axis++) for (const side of [0, 1]) {
    const u = (axis + 1) % 3, v = (axis + 2) % 3;
    const base = vertices.length / 3;
    for (let j = 0; j <= steps; j++) for (let i = 0; i <= steps; i++) {
      const p = [...min];
      p[axis] = side ? max[axis] : min[axis];
      p[u] += (max[u] - min[u]) * i / steps;
      p[v] += (max[v] - min[v]) * j / steps;
      vertices.push(...p);
    }
    for (let j = 0; j < steps; j++) for (let i = 0; i < steps; i++) {
      const a = base + j * (steps + 1) + i, b = a + 1, c = a + steps + 1, d = c + 1;
      triangles.push(...(side ? [a, b, d, a, d, c] : [a, d, b, a, c, d]));
    }
  }
}
box([-.3, -.5, -.25], [.3, .5, .25]);
const torsoCount = vertices.length / 3;
box([.35, -.25, .15], [.45, .25, .25]);
const input = {
  points: new Float32Array(vertices), triangles: new Uint32Array(triangles),
  bones: new Float32Array([0, -.4, 0, 0, .4, 0, .4, -.2, .2, .4, .2, .2]),
};
let failed = false;
for (const method of ['envelope', 'heat', 'heat proxy']) {
  let result;
  if (method === 'envelope') result = envelopeWeights(input);
  else {
    self.onmessage({ data: { ...input, limit: method === 'heat proxy' ? 250 : 15000 } });
    assert.equal(heatResult.type, 'done', heatResult.message);
    result = heatResult;
  }
  const skin = result.indices ? result : strongest(result.dense, result.map, 2);
  let maxArm = 0;
  for (let i = 0; i < torsoCount; i++) {
    let arm = 0;
    for (let k = 0; k < 4; k++) if (skin.indices[i * 4 + k] === 1) arm += skin.weights[i * 4 + k];
    maxArm = Math.max(maxArm, arm);
  }
  console.log(`${method}: maximum arm influence on separated torso = ${(100 * maxArm).toFixed(3)}%`);
  try { assert.ok(maxArm < .01, `${method}: raising the arm moves the torso through the gap`); }
  catch (error) { console.error(error.message); failed = true; }
}
assert.ok(!failed, 'Skin visibility regression');

// A manually placed end bone can sit just outside the skin. Rejecting it entirely makes
// fingers abruptly follow the forearm instead, even though the hand bone is far closer.
const handInput = {
  points: input.points.subarray(torsoCount * 3),
  triangles: new Uint32Array([...input.triangles].filter(i => i >= torsoCount).map(i => i - torsoCount)),
  bones: new Float32Array([.4, -.2, .2, .4, 0, .2, .4, .1, .251, .4, .25, .251]),
};
const handResult = envelopeWeights(handInput);
const handSkin = strongest(handResult.dense, handResult.map, 2);
let tip = -1;
for (let i = 0; i < handInput.points.length / 3; i++) if (Math.abs(handInput.points[i * 3] - .4) < 1e-6 && Math.abs(handInput.points[i * 3 + 1] - .2) < 1e-6 && Math.abs(handInput.points[i * 3 + 2] - .25) < 1e-6) tip = i;
assert.ok(tip >= 0);
let handWeight = 0;
for (let k = 0; k < 4; k++) if (handSkin.indices[tip * 4 + k] === 1) handWeight += handSkin.weights[tip * 4 + k];
console.log(`slightly exterior hand joint: hand influence = ${(100 * handWeight).toFixed(3)}%`);
assert.ok(handWeight > .5, 'The fingers must primarily follow the nearby hand, even with a slightly exterior joint');
const handDistances = new Float64Array(2);
visibleBoneDistances(handInput.points, handInput.triangles)(.4, .2, .25, 0, 0, 1, handInput.bones, undefined, handDistances);
assert.ok(handDistances[1] < handDistances[0], 'The nearby hand must remain closer than the forearm after visibility penalties');
