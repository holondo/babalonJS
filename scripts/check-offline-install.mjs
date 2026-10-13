// Focused regression: interrupted installation must resume, and never report partial success.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../src/core/offline.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { prepareOffline, installedDisplay, OFFLINE_DECODERS } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serviceWorker: { ready: Promise.resolve({}) } } });
globalThis.location = { origin: 'https://app.test' };
globalThis.matchMedia = () => ({ matches: false });
assert.equal(installedDisplay(), false);
globalThis.matchMedia = query => ({ matches: query === '(display-mode: standalone)' });
assert.equal(installedDisplay(), true);
const stores = new Map();
globalThis.caches = {
  async open(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return { match: async url => store.get(String(url))?.clone(), put: async (url, result) => store.set(String(url), result.clone()) };
  },
  async match(url) { for (const store of stores.values()) if (store.has(String(url))) return store.get(String(url)).clone(); },
};
const assets = ['assets/entry.js', 'assets/export.js', 'assets/textures.worker.js', 'assets/basis_encoder.wasm'];
let broken = true;
let manifestOffline = false;
let version = 'assets/entry.js';
const downloads = [];
globalThis.fetch = async input => {
  const url = String(input);
  if (url.includes('offline-assets.json')) {
    if (manifestOffline) throw new Error('Offline');
    return Response.json({ assets, entry: version });
  }
  if (broken && url.endsWith('export.js')) throw new Error('Connection interrupted');
  downloads.push(url);
  return new Response('code', { headers: { Vary: 'Origin' } });
};
const progress = [];
await assert.rejects(prepareOffline('/composer/', p => progress.push(p), version), /interrupted/);
assert.ok(progress.every(p => p < 1));
const retained = [...downloads];
broken = false;
await prepareOffline('/composer/', p => progress.push(p), version);
assert.equal(progress.at(-1), 1);
for (const url of retained) assert.equal(downloads.filter(value => value === url).length, 1, 'Do not redownload completed files');
for (const url of OFFLINE_DECODERS) assert.ok(await caches.match(url), `Missing decoder ${url}`);
for (const file of assets) assert.ok(await caches.match(`https://app.test/composer/${file}`));
manifestOffline = true;
await prepareOffline('/composer/', () => {}, version);
manifestOffline = false;
version = 'assets/new-version.js';
await assert.rejects(prepareOffline('/composer/', () => {}, 'assets/unknown.js'), /another app version/);
const built = JSON.parse(fs.readFileSync(new URL('../dist/offline-assets.json', import.meta.url), 'utf8'));
const files = fs.readdirSync(new URL('../dist/assets/', import.meta.url)).filter(file => /\.(?:js|css|wasm)$/.test(file));
assert.deepEqual(new Set(built.assets), new Set(files.map(file => `assets/${file}`)));
assert.ok(built.assets.some(file => file.includes('projectArchive.worker-')));
assert.ok(built.assets.some(file => file.includes('basis_encoder') && file.endsWith('.wasm')));
const sw = fs.readFileSync(new URL('../dist/sw.js', import.meta.url), 'utf8');
assert.match(sw, /cacheName:"feature-code",matchOptions:\{ignoreVary:!0\}/, 'Module requests must match background downloads despite Vary: Origin');
console.log('Installed display, interrupted download/resume, version isolation, offline recheck and complete worker/WASM manifest pass.');
