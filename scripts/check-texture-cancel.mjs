// A terminated texture worker must reject its pending operation, not leave it hanging.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = ts.transpileModule(fs.readFileSync(new URL('../src/optimize/textures.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
}).outputText
  .replace(/from '(@babylonjs[^']+|ktx-parse)'/g, (_, specifier) => `from '${pathToFileURL(require.resolve(specifier)).href}'`)
  .replace("import { tr } from '../core/i18n';", 'const tr = s => s;')
  .replace("import { deviceBudget, textureBytes, textureWorkerLimit } from './analysis';", 'const textureBytes = () => 0;')
  .replace("new URL('./textures.worker.ts', import.meta.url)", "'worker-test'");
const { TextureOptimizer } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
let terminated = 0;
globalThis.Worker = class {
  postMessage() {}
  terminate() { terminated++; }
};
const optimizer = new TextureOptimizer({});
const pending = Array.from({ length: 3 }, () => optimizer.run({ pixels: new Uint8Array(4), width: 1, height: 1 }));
const settled = Promise.all(pending.map(job => job.then(() => 'resolved', error => error.name)));
optimizer.cancel();
assert.deepEqual(await Promise.race([settled, new Promise(resolve => setTimeout(() => resolve('pending'), 100))]), ['AbortError', 'AbortError', 'AbortError']);
assert.equal(terminated, 3);
assert.equal(optimizer.workers.size, 0);
await assert.rejects(optimizer.run({ pixels: new Uint8Array(4), width: 1, height: 1 }), { name: 'AbortError' });
console.log('Texture cancellation settles and prevents further workers.');

const analysis = ts.transpileModule(fs.readFileSync(new URL('../src/optimize/analysis.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
}).outputText;
const { textureWorkerLimit } = await import(`data:text/javascript;base64,${Buffer.from(analysis).toString('base64')}`);
assert.equal(textureWorkerLimit(4096, 4096, 16, 8, false), 3);
assert.equal(textureWorkerLimit(4096, 4096, 16, 4, false), 1);
assert.equal(textureWorkerLimit(4096, 4096, 16, 8, true), 1);
assert.equal(textureWorkerLimit(4096, 4096, 8, undefined, false), 2);
assert.equal(textureWorkerLimit(4096, 4096, 2, 8, false), 1);
assert.equal(textureWorkerLimit(16384, 16384, 32, 8, false), 1);
console.log('Texture worker budget respects CPU, memory, touch devices and image size.');
