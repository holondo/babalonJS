// Regression: changing context must preserve selection and a half-finished measurement.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Observable } from '@babylonjs/core/Misc/observable.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents.js';
import '@babylonjs/core/Culling/ray.js';

const require = createRequire(import.meta.url);
const source = ts.transpileModule(fs.readFileSync(new URL('../src/tools/tools.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
}).outputText.replace(/from '(@babylonjs[^']+)'/g, (_, specifier) => `from '${pathToFileURL(require.resolve(specifier)).href}'`);
const { Tools } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const engine = new NullEngine({ renderWidth: 512, renderHeight: 512 });
const scene = new Scene(engine);
const camera = new ArcRotateCamera('camera', Math.PI / 4, Math.PI / 4, 5, Vector3.Zero(), scene);
const selected = { root: MeshBuilder.CreateBox('selected', {}, scene) };
// Only the Editor boundary is supplied here; picking, rays, meshes and measurement logic are real.
const editor = {
  scene, camera, changed: new Observable(), selected, selection: [selected], cleanView: false, overlays: new Set(),
  select(entity) { this.selected = entity; this.selection = entity ? [entity] : []; },
  refreshTool() {}, invalidate() {}, pickSurface() { return null; },
};
try {
  const tools = new Tools(editor);
  tools.setMeasureMode(true);
  assert.ok(editor.selected === selected, 'Starting Measure must keep the selected object context');
  assert.ok(editor.selection.length === 1 && editor.selection[0] === selected);
  scene.pointerX = 256; scene.pointerY = 256;
  const tap = { type: PointerEventTypes.POINTERTAP };
  assert.equal(tools.handlePointer(tap), true);
  const pending = tools.pending;
  assert.ok(pending, 'The real scene ray must place a first measurement point');
  tools.setMeasurePaused(true);
  assert.equal(tools.handlePointer(tap), false, 'A collapsed Measure must release taps to the focused tool');
  assert.equal(tools.pending, pending, 'Switching context must keep the first point');
  assert.equal(tools.measureMode, true, 'Switching context must not finish Measure');
  tools.setMeasurePaused(false);
  assert.equal(tools.measuring, true);
  assert.equal(tools.pending, pending, 'Returning to Measure must resume the same pending point');
  tools.setMeasureMode(false);
  assert.equal(tools.pending, null, 'Finishing Measure must remove the pending point');
  assert.ok(editor.selected === selected);
  console.log('Measure context: selection preserved, real first point, pause/resume and finish pass');
} finally {
  scene.dispose(); engine.dispose();
}
