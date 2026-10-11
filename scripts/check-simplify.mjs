// Focused check of the simplification worker (meshoptimizer): run with node scripts/check-simplify.mjs.
// A UV sphere with a texture seam and an open grid: the result must reach the target, reuse
// the original vertices, never bridge the seam (texture tear) and keep open edges in place.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/optimize/simplify.worker.ts', import.meta.url), 'utf8').replace(`'meshoptimizer'`, JSON.stringify(import.meta.resolve('meshoptimizer')));
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText;
let reply;
globalThis.self = { postMessage: (m) => { if (m.type !== 'progress') reply = m; } };
await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
async function simplify(meshes, ratios, lockBorder) {
  reply = null;
  await self.onmessage({ data: { meshes, ratios, lockBorder } });
  while (!reply) await new Promise((r) => setTimeout(r, 10));
  if (reply.type === 'error') throw new Error(reply.message);
  return reply.levels;
}

// UV sphere: the u = 0 / u = 1 column is duplicated (a seam, like any textured model)
function sphere(rings, segments) {
  const positions = [], normals = [], uvs = [], indices = [];
  for (let r = 0; r <= rings; r++) for (let s = 0; s <= segments; s++) {
    const theta = (Math.PI * r) / rings, phi = (2 * Math.PI * s) / segments;
    const p = [Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)];
    positions.push(...p); normals.push(...p); uvs.push(s / segments, r / rings);
  }
  const at = (r, s) => r * (segments + 1) + s;
  for (let r = 0; r < rings; r++) for (let s = 0; s < segments; s++) indices.push(at(r, s), at(r + 1, s), at(r, s + 1), at(r, s + 1), at(r + 1, s), at(r + 1, s + 1));
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: new Uint32Array(indices) };
}

const ball = sphere(96, 192);
const [high, low] = await simplify([ball], [0.5, 0.05], true);
const triangles = ball.indices.length / 3;
for (const [level, ratio] of [[high, 0.5], [low, 0.05]]) {
  const out = level.indices[0];
  assert.ok(out.length / 3 <= triangles * ratio * 1.05, `target ${ratio} reached`);
  assert.ok(out.every((i) => i < ball.positions.length / 3), 'only original vertices are used');
  for (let t = 0; t < out.length; t += 3) {
    const u = [0, 1, 2].map((k) => ball.uvs[out[t + k] * 2]);
    assert.ok(Math.max(...u) - Math.min(...u) < 0.5, 'no triangle bridges the texture seam');
  }
  assert.ok(level.error < 0.02, `error ${level.error} stays small`);
}

// Open grid: with "keep open edges", the border keeps every vertex
const n = 64, grid = { positions: [], indices: [] };
for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) grid.positions.push(x / n, Math.sin(x / 5) * 0.02, y / n);
for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
  const a = y * (n + 1) + x;
  grid.indices.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
}
const flat = { positions: new Float32Array(grid.positions), indices: new Uint32Array(grid.indices) };
const used = (indices) => new Set(indices);
const border = [...Array((n + 1) ** 2).keys()].filter((i) => i % (n + 1) === 0 || i % (n + 1) === n || i <= n || i >= n * (n + 1));
const [locked] = await simplify([flat], [0.1], true);
assert.ok(border.every((i) => used(locked.indices[0]).has(i)), 'open edges are kept');
const [free] = await simplify([flat], [0.1], false);
assert.ok(border.some((i) => !used(free.indices[0]).has(i)), 'without the option the border can be simplified');

console.log(`Simplify: targets, original vertices, UV seam, error (${(low.error * 100).toFixed(2)}% at 5%) and open edges pass`);
