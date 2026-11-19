// P9: real parameter-to-skin editing on the imported GLB.
// The imported skin is driven by the existing generator through the fitted baseline; the
// procedural skin runs in the real worker, without a DOM or GPU.
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
      if (specifier.endsWith('.js') && existsSync(fileURLToPath(url.href.slice(0, -3) + '.ts'))) specifier = specifier.slice(0, -3) + '.ts';
      else if (!/\.(ts|json)$/.test(specifier) && existsSync(fileURLToPath(url.href + '.ts'))) specifier += '.ts';
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith(prefix) && url.endsWith('.ts')) return { format: 'module', source: transpile(readFileSync(fileURLToPath(url), 'utf8')), shortCircuit: true };
    if (url.startsWith(prefix) && url.endsWith('.json')) return { format: 'module', source: 'export default ' + readFileSync(fileURLToPath(url), 'utf8') + ';', shortCircuit: true };
    return next(url, context);
  }
});

console.log('Testing P9: parameter edits drive the imported skin...');
const { defaults } = await import('../src/anatomy/parameters.ts');
const { normalizeDefinition } = await import('../src/anatomy/definition.ts');
const { AnatomySkinDrive, canonicalAnatomyFactors, sourcePointToCanonical } = await import('../src/anatomy/binding/anatomySkinDrive.ts');

let reply;
globalThis.self = { postMessage: value => { reply = value; } };
await import('../src/anatomy/anatomy.worker.ts');

const LAYERS = ['adipose', 'rectusAbdominis', 'aponeuroses', 'gluteusMaximus', 'pectoralisMajor'];
function generate(parameters) {
  reply = undefined;
  self.onmessage({ data: { id: 1, parameters, layers: LAYERS } });
  assert.ok(reply && !reply.error, reply?.error);
  const skin = reply.meshes.skin[0];
  return {
    positions: new Float32Array(skin.positions),
    normals: new Float32Array(skin.normals),
    indices: new Uint32Array(skin.indices),
  };
}

const HEIGHT_CM = defaults.height;
const baseline = generate(defaults);

// The "imported GLB": the same body with its own units, yaw and offset, plus 3 mm of surface detail.
const frame = { yaw: 0.37, scale: 1.837, offset: [0.021, -0.004, 0.013] };
const { lateral, vertical } = canonicalAnatomyFactors(HEIGHT_CM);
const sourceCount = baseline.positions.length / 3;
const rest = new Float32Array(sourceCount * 3);
const canonicalRest = new Float32Array(sourceCount * 3);
const cos = Math.cos(-frame.yaw), sin = Math.sin(-frame.yaw);
for (let i = 0; i < sourceCount; i++) {
  const x = baseline.positions[i * 3] * lateral;
  const y = baseline.positions[i * 3 + 1] * vertical;
  const z = baseline.positions[i * 3 + 2] * lateral;
  // 3 mm of imported detail along the anatomy normal: the drive must keep it at the fitted state.
  const nx = baseline.normals[i * 3], ny = baseline.normals[i * 3 + 1], nz = baseline.normals[i * 3 + 2];
  const cx = x + nx * 0.003, cy = y + ny * 0.003, cz = z + nz * 0.003;
  canonicalRest[i * 3] = cx; canonicalRest[i * 3 + 1] = cy; canonicalRest[i * 3 + 2] = cz;
  rest[i * 3] = ((cos * (cx - frame.offset[0]) + sin * (cz - frame.offset[2])) / frame.scale);
  rest[i * 3 + 1] = (cy - frame.offset[1]) / frame.scale;
  rest[i * 3 + 2] = ((-sin * (cx - frame.offset[0]) + cos * (cz - frame.offset[2])) / frame.scale);
}

const drive = AnatomySkinDrive.build({ name: 'imported-humanoid', restPositions: rest, indices: baseline.indices, normals: baseline.normals, frame }, baseline, HEIGHT_CM);
console.log(`P9: embedded ${sourceCount} vertices, median ${drive.info.medianDistanceMm.toFixed(2)} mm, unmatched ${drive.info.unmatchedVertices}`);
assert.equal(drive.info.unmatchedVertices, 0, 'every imported vertex must find a procedural surface triangle');
assert.ok(drive.info.medianDistanceMm < 4, 'the embedding must land on the skin surface, detail included');

// Check 1: exact identity at the fitted state.
const identity = drive.update(baseline, HEIGHT_CM);
assert.equal(identity.identity, true, 'no edit must leave the imported skin untouched');
assert.equal(identity.positions, rest, 'identity returns the immutable baseline array');
assert.equal(identity.movedVertices, 0);

// Helper: canonical rest coordinate of a vertex, for region assertions.
const canonicalOf = i => [canonicalRest[i * 3], canonicalRest[i * 3 + 1], canonicalRest[i * 3 + 2]];
function movedVertices(update) {
  const set = [];
  for (let i = 0; i < sourceCount; i++) {
    const d = Math.hypot(
      update.positions[i * 3] - rest[i * 3],
      update.positions[i * 3 + 1] - rest[i * 3 + 1],
      update.positions[i * 3 + 2] - rest[i * 3 + 2],
    );
    if (d > 1e-6) set.push(i);
  }
  return set;
}

// Check 2: pelvis width reaches the pelvis and leaves head, hands and feet alone.
const pelvisWidth = defaults.pelvisWidth + 8;
const wide = drive.update(generate({ ...defaults, pelvisWidth }), HEIGHT_CM);
assert.equal(wide.identity, false);
const wideMoved = movedVertices(wide);
console.log(`P9: pelvisWidth +8 -> ${wideMoved.length} vertices, max ${(wide.maxDisplacementMeters * 1000).toFixed(1)} mm`);
assert.ok(wide.maxDisplacementMeters * 1000 > 20, 'a wider pelvis must move the skin by more than 20 mm');
let head = 0, hands = 0, feet = 0, pelvis = 0, outOfBand = 0;
for (const i of wideMoved) {
  const [x, y,] = canonicalOf(i);
  if (y > 1.40) head++;
  else if (y < 0.35) feet++;
  else if (Math.abs(x) > 0.30) hands++;
  else if (y >= 0.45 && y <= 1.25) pelvis++;
  else outOfBand++;
}
assert.equal(head, 0, 'head vertices must not move with the pelvis');
assert.equal(feet, 0, 'feet must not move with the pelvis');
assert.equal(hands, 0);
assert.ok(pelvis / (wideMoved.length || 1) > 0.9, `pelvis edits must stay in the pelvis band (${pelvis}/${wideMoved.length})`);
assert.equal(outOfBand, 0, 'unexpected vertices outside the pelvis band');

// Check 3: a left glute grows on the posterior left side only.
const glute = drive.update(generate({
  ...defaults,
  definition: normalizeDefinition({ version: 1, muscles: { 'gluteus_maximus.L': { volume: 1.6, width: 1.3 } }, bones: {} }),
}), HEIGHT_CM);
const gluteMoved = movedVertices(glute);
console.log(`P9: gluteus_maximus.L -> ${gluteMoved.length} vertices, max ${(glute.maxDisplacementMeters * 1000).toFixed(1)} mm`);
assert.ok(gluteMoved.length > 0, 'individual muscle growth must reach the imported skin');
let posteriorLeft = 0, wrongSide = 0;
for (const i of gluteMoved) {
  const [x, , z] = canonicalOf(i);
  if (z < 0.02 && x < 0) posteriorLeft++;
  if (x > 0.01) wrongSide++;
}
assert.ok(posteriorLeft > gluteMoved.length * 0.6, 'glute growth must stay posterior and on the left');
assert.equal(wrongSide, 0, 'the right side must not follow a left-side muscle');

// Check 4: fat thickens the trunk, not the limbs.
const fat = drive.update(generate({ ...defaults, fat: 26 }), HEIGHT_CM);
const fatMoved = movedVertices(fat);
console.log(`P9: fat -> ${fatMoved.length} vertices, max ${(fat.maxDisplacementMeters * 1000).toFixed(1)} mm`);
assert.ok(fatMoved.length > 0);
let trunk = 0, limbs = 0;
for (const i of fatMoved) {
  const [x, y] = canonicalOf(i);
  if (y > 0.72 && y < 1.45 && Math.abs(x) < 0.30) trunk++;
  else limbs++;
}
assert.ok(trunk > limbs * 4, `fat must read as a trunk change (${trunk} trunk / ${limbs} limb)`);

// Check 5: rectus growth reaches the abdominal wall only.
const rectus = drive.update(generate({ ...defaults, rectus: 1.8 }), HEIGHT_CM);
const rectusMoved = movedVertices(rectus);
let abdomen = 0, elsewhere = 0;
for (const i of rectusMoved) {
  const [x, y, z] = canonicalOf(i);
  if (z > 0 && y > 0.95 && y < 1.35 && Math.abs(x) < 0.20) abdomen++;
  else elsewhere++;
}
console.log(`P9: rectus -> ${rectusMoved.length} vertices (${abdomen} abdomen, ${elsewhere} elsewhere), max ${(rectus.maxDisplacementMeters * 1000).toFixed(1)} mm`);
assert.ok(rectusMoved.length > 0, 'rectus growth must reach the imported skin');
assert.ok(abdomen > elsewhere * 3, 'rectus growth must stay on the abdominal wall');

// Check 6: undo (back to the fitted parameters) restores the imported vertices exactly.
const undone = drive.update(baseline, HEIGHT_CM);
assert.equal(undone.identity, true, 'returning to the fitted parameters restores the baseline');
assert.equal(undone.positions, rest);
const pristine = drive.update(baseline, HEIGHT_CM);
assert.equal(pristine.identity, true, 'repeated rebuilding without changes must not drift');

// Check 7: geometry stays finite and the imported topology is never touched.
for (const update of [wide, glute, fat, rectus]) {
  assert.equal(update.positions.length, rest.length, 'the imported vertex count is stable');
  assert.ok(update.positions.every(Number.isFinite), 'driven positions must stay finite');
  assert.ok(update.normals && update.normals.every(Number.isFinite), 'driven normals must stay finite');
  assert.ok(update.positions.some((value, i) => value !== rest[i]), 'a real edit must change the skin');
}
assert.equal(drive.info.rebinds, 0, 'no topology change was needed, so no rebind');

// Check 8: a source mesh with its own tessellation still binds and follows.
const decimated = [];
for (let t = 0; t < baseline.indices.length; t += 9) {
  decimated.push(baseline.indices[t], baseline.indices[t + 1], baseline.indices[t + 2]);
}
const other = AnatomySkinDrive.build({
  name: 'coarse-import', restPositions: rest, indices: new Uint32Array(decimated), normals: undefined, frame,
}, baseline, HEIGHT_CM);
assert.equal(other.update(baseline, HEIGHT_CM).identity, true, 'a coarser imported mesh is also exact at the fitted state');
const otherWide = other.update(generate({ ...defaults, pelvisWidth }), HEIGHT_CM);
let otherMoved = 0;
for (let i = 0; i < sourceCount; i++) {
  if (Math.hypot(otherWide.positions[i * 3] - rest[i * 3], otherWide.positions[i * 3 + 1] - rest[i * 3 + 1], otherWide.positions[i * 3 + 2] - rest[i * 3 + 2]) > 1e-6) otherMoved++;
}
console.log(`P9: independent source tessellation -> ${otherMoved} vertices moved`);
assert.ok(otherMoved > 0, 'the drive must not depend on the procedural topology');

console.log('P9 checks successfully passed!');
