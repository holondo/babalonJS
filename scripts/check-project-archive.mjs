// Real worker-thread regression: new archives remain compatible with existing ZIP files.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Worker as Thread } from 'node:worker_threads';
import { zipSync, unzipSync } from 'fflate';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const compile = file => ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
}).outputText;
const workerCode = compile('../src/core/projectArchive.worker.ts')
  .replace("from 'fflate'", `from '${pathToFileURL(require.resolve('fflate')).href}'`);
const workerURL = new URL(`data:text/javascript;base64,${Buffer.from(`
import { parentPort } from 'node:worker_threads';
globalThis.self = { postMessage: (data, buffers) => parentPort.postMessage(data, buffers) };
${workerCode}
parentPort.on('message', data => self.onmessage({ data }));
`).toString('base64')}`);
globalThis.Worker = class {
  constructor() {
    this.thread = new Thread(workerURL);
    this.thread.on('message', data => this.onmessage?.({ data }));
    this.thread.on('error', error => this.onerror?.({ message: error.message }));
  }
  postMessage(data, buffers) { this.thread.postMessage(data, buffers); }
  terminate() { void this.thread.terminate(); }
};
const wrapper = compile('../src/core/projectArchive.ts')
  .replace("new URL('./projectArchive.worker.ts', import.meta.url)", "'worker-test'");
const { zipProject, unzipProject } = await import(`data:text/javascript;base64,${Buffer.from(wrapper).toString('base64')}`);
const json = new TextEncoder().encode('{"name":"café","version":1}');
const binary = new Uint8Array(4 * 1024 * 1024);
for (let i = 0; i < binary.length; i++) binary[i] = i % 251;
const reference = binary.slice();
const legacy = zipSync({ 'project.json': json, 'assets/model.bin': binary });
assert.deepEqual((await unzipProject(legacy))['assets/model.bin'], reference);
let ticks = 0;
const heartbeat = setInterval(() => ticks++, 1);
try {
  const archive = await zipProject({ 'project.json': [json, { level: 6 }], 'assets/model.bin': [binary, { level: 0 }] }, [json.buffer, binary.buffer]);
  assert.equal(binary.byteLength, 0, 'Owned buffers must transfer, rather than be copied to the worker');
  const decoded = unzipSync(archive);
  assert.deepEqual(decoded['assets/model.bin'], reference);
  assert.equal(new TextDecoder().decode(decoded['project.json']), '{"name":"café","version":1}');
  assert.ok(ticks > 0, 'The main event loop must remain responsive');
} finally { clearInterval(heartbeat); }
await assert.rejects(unzipProject(new Uint8Array([1, 2, 3])));
console.log('Project archive: legacy compatibility, byte preservation, transfer and worker errors pass.');
