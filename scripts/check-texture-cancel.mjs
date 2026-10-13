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
  .replace("import { textureBytes } from './analysis';", 'const textureBytes = () => 0;')
  .replace("new URL('./textures.worker.ts', import.meta.url)", "'worker-test'");
const { TextureOptimizer } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
let terminated = 0;
globalThis.Worker = class {
  postMessage() {}
  terminate() { terminated++; }
};
const optimizer = new TextureOptimizer({});
const pending = optimizer.run({ pixels: new Uint8Array(4), width: 1, height: 1 });
const settled = pending.then(() => 'resolved', error => error.name);
optimizer.cancel();
assert.equal(await Promise.race([settled, new Promise(resolve => setTimeout(() => resolve('pending'), 100))]), 'AbortError');
assert.equal(terminated, 1);
assert.equal(optimizer.workers.size, 0);
await assert.rejects(optimizer.run({ pixels: new Uint8Array(4), width: 1, height: 1 }), { name: 'AbortError' });
console.log('Texture cancellation settles and prevents further workers.');
