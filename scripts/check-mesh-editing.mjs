// Focused topology regressions: UV seams, concave caps, nested openings and cut-plane filtering.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const cache = new Map();
function moduleUrl(file) {
  const url = new URL(file, import.meta.url);
  if (cache.has(url.href)) return cache.get(url.href);
  let source = ts.transpileModule(fs.readFileSync(url, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText;
  source = source.replace(/(from|import) ['"]([^'"]+)['"]/g, (_, kw, name) => `${kw} ${JSON.stringify(name.startsWith('.') ? moduleUrl(new URL(name + '.ts', url).href) : import.meta.resolve(name))}`);
  const encoded = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  cache.set(url.href, encoded); return encoded;
}
const { fillHoles, borders } = await import(moduleUrl('../src/edit/holes.ts'));
const { Vector3 } = await import('@babylonjs/core/Maths/math.vector.js');
function walls(rings) {
  const position = [], indices = [];
  for (const ring of rings) {
    const start = position.length / 3, count = ring.length;
    for (const z of [0, 1]) for (const p of ring) position.push(...p, z);
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      indices.push(start + i, start + j, start + count + j, start + i, start + count + j, start + count + i);
    }
  }
  return { indices, materials: [{ material: 0, start: 0, count: indices.length }], attributes: { position, normal: position.map(() => 0), uv: Array(position.length / 3 * 2).fill(0) } };
}
function capArea(part, start) {
  let area = 0;
  for (let i = start; i < part.indices.length; i += 3) {
    const [a, b, c] = part.indices.slice(i, i + 3).map(k => Vector3.FromArray(part.attributes.position, k * 3));
    area += Vector3.Cross(b.subtract(a), c.subtract(a)).length() / 2;
  }
  return area;
}
const concave = walls([[[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]]]);
const capped = fillHoles(concave);
assert.equal(borders(capped).length, 0);
assert.ok(Math.abs(capArea(capped, concave.indices.length) - 6) < 1e-8);
assert.deepEqual(capped.attributes.position.slice(0, concave.attributes.position.length), concave.attributes.position);
const tube = walls([[[-2, -2], [2, -2], [2, 2], [-2, 2]], [[-1, -1], [-1, 1], [1, 1], [1, -1]]]);
assert.equal(borders(tube).length, 4);
const filled = fillHoles(tube);
assert.equal(borders(filled).length, 0);
assert.ok(Math.abs(capArea(filled, tube.indices.length) - 24) < 1e-8, 'Nested openings must not fill the interior hole');
const topOnly = fillHoles(tube, undefined, 0, { origin: new Vector3(0, 0, 1), normal: new Vector3(0, 0, 1), tolerance: 1e-6 });
assert.equal(borders(topOnly).length, 2, 'A plane cut must not fill unrelated existing openings');
assert.ok(Math.abs(capArea(topOnly, tube.indices.length) - 12) < 1e-8);
console.log('Mesh editing: concave caps, nested holes, unchanged attributes and cut-plane filtering pass');
