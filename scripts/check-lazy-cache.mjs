// Run after npm run build: optional feature entries must stay out of the initial graph/cache.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gzipSync } from 'node:zlib';

const manifest = JSON.parse(fs.readFileSync(new URL('../dist/.vite/manifest.json', import.meta.url), 'utf8'));
const startup = new Set();
function visit(key) {
  const chunk = manifest[key];
  if (!chunk || startup.has(chunk.file)) return;
  startup.add(chunk.file);
  chunk.imports?.forEach(visit);
}
visit('index.html');
const sw = fs.readFileSync(new URL('../dist/sw.js', import.meta.url), 'utf8');
const cached = new Set([...sw.matchAll(/url:"([^"]+)"/g)].map(match => match[1]));
for (const key of ['src/ui/panels/rig.ts', 'src/ui/panels/optimize.ts', 'src/ui/panels/separate.ts', 'src/ui/panels/modify.ts', 'src/edit/planeCut.ts', 'src/ar/ar.ts', 'src/optimize/export.ts', 'src/core/projectArchive.ts']) {
  const chunk = manifest[key];
  assert.ok(chunk, `Missing build entry: ${key}`);
  assert.ok(!startup.has(chunk.file), `${key} must not be imported at startup`);
  assert.ok(!cached.has(chunk.file), `${key} must be cached on demand`);
}
assert.ok([...cached].every(file => !/\.(?:worker)[^/]*\.js$/.test(file)), 'Worker scripts must remain on demand');
for (const file of startup) assert.ok(cached.has(file), `Core dependency missing offline: ${file}`);
const buffers = [...startup].map(file => fs.readFileSync(new URL(`../dist/${file}`, import.meta.url)));
console.log(JSON.stringify({ startupChunks: startup.size, startupBytes: buffers.reduce((sum, data) => sum + data.length, 0), startupGzipBytes: buffers.reduce((sum, data) => sum + gzipSync(data).length, 0), precacheEntries: cached.size }));
console.log('Lazy feature boundaries and offline core cache pass.');

for (const [key, chunk] of Object.entries(manifest)) {
  if (key.includes('/Shaders/') || (/\/materials\/.*\.(?:vertex|fragment)\.js$/.test(key) && !key.includes('/wgsl/')) || key.endsWith('/Gizmos/gizmoManager.js') || key.endsWith('/Textures/Loaders/envTextureLoader.js')) assert.ok(cached.has(chunk.file), `Shader missing offline: ${key}`);
}
