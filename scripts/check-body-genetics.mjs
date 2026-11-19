// Real whole-body architecture selection, regional geometry and persistence.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const require = createRequire(resolve('package.json'));
let playwright;
try { playwright = require('playwright'); }
catch {
  assert.ok(process.env.PLAYWRIGHT_MODULE, 'Install Playwright or set PLAYWRIGHT_MODULE');
  playwright = require(process.env.PLAYWRIGHT_MODULE);
}
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
const output = process.env.ANATOMY_SCREENSHOTS;
if (output) await mkdir(output, { recursive: true });
const server = await createServer({ cacheDir: resolve('node_modules/.vite-check-body-genetics'), server: { host: '127.0.0.1', port: 0, hmr: false } });
await server.listen();
const browser = await playwright.chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/scripts/fixtures/anatomy-priority.html`,
    { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.anatomyTest, undefined, { timeout: 90000 });
  // Material/shadow variants compile asynchronously after layer changes. A
  // screenshot of the first frame can show an obsolete shadow map.
  const settle = () => page.evaluate(() => new Promise((resolve, reject) => {
    const scene = anatomyTest.editor.scene, start = performance.now();
    let ready = 0;
    const draw = () => {
      scene.render(); ready = scene.isReady() ? ready + 1 : 0;
      if (ready >= 3 && performance.now() - start > 250) resolve(true);
      else if (performance.now() - start > 15000) reject(Error('Anatomy rendering did not settle'));
      else requestAnimationFrame(draw);
    };
    draw();
  }));
  const ids = await page.evaluate(async () => {
    const { editor, ui } = anatomyTest, entity = await editor.addAnatomy(), body = entity.anatomyBody;
    body.patch({ fat: 10, otherMusclesOpacity: 1, rectusAbdominisOpacity: 1, externalObliqueOpacity: 1 });
    await body.ready();
    window.bodyGenes = { entity, body, baseline: body.exportParameters(),
      skin: entity.meshes.find(m => m.metadata?.anatomyLayer === 'skin').getVerticesData('position').slice() };
    body.region = 'overview'; ui.openPart('objects', 'anatomy');
    document.querySelector('#test')?.remove(); document.querySelector('#result')?.remove();
    return Object.keys((await import('/src/anatomy/bodyGenetics.ts')).bodyGenetics);
  });
  const evidence = [];
  for (const id of ids) {
    const start = performance.now();
    await page.getByRole('combobox', { name: 'Body architecture', exact: true }).selectOption(id);
    const result = await page.evaluate(async id => {
      const { body, entity } = bodyGenes; await body.ready();
      if (body.parameters.definition.genetics.preset !== id) throw Error('Wrong architecture');
      const p = body.parameters;
      if (p.height !== 175 || p.fat !== 10 || p.pectoral !== 1 || p.biceps !== 1 || p.quadriceps !== 1) throw Error('Architecture changed stature, fat or training');
      let vertices = 0;
      for (const m of entity.meshes) for (const v of m.getVerticesData('position') ?? []) { if (!Number.isFinite(v)) throw Error('Non-finite geometry'); vertices++; }
      const maxVolumeError = Math.max(...body.anatomyMetrics.map(m => m.error));
      const definition = body.parameters.definition;
      for (const [key, value] of Object.entries(definition.muscles)) {
        if (!key.endsWith('.L') || key.startsWith('rectus_abdominis')) continue;
        if (JSON.stringify(value) !== JSON.stringify(definition.muscles[key.slice(0,-1)+'R'])) throw Error('Unintended left/right shape mismatch');
      }
      return { id, vertices: vertices/3, muscles: body.anatomyMetrics.length, maxVolumeError };
    }, id);
    assert.ok(result.maxVolumeError < .001, `Lost volume: ${JSON.stringify(result)}`);
    assert.equal(await page.getByRole('combobox', { name: 'Body architecture', exact: true }).inputValue(), id);
    if (output) {
      for (const [view, skin] of [['front', true], ['back', true], ['side', true], ['three', false]]) {
        await page.evaluate(async ({ view, skin }) => {
          const { body } = bodyGenes; body.patch({ skinOpacity: skin ? 1 : 0 }); await body.ready();
          document.body.classList.add('ui-hidden'); anatomyTest.editor.select(null);
          body.frame('body'); body.view(view); anatomyTest.editor.camera.radius = 3.1;
          anatomyTest.editor.camera.target.set(0,.94,0); anatomyTest.editor.scene.render();
        }, { view, skin });
        await settle();
        await page.screenshot({ path: `${output}/${id}-${view}-${skin ? 'skin' : 'muscles'}.png` });
      }
      await page.evaluate(() => {
        document.body.classList.remove('ui-hidden'); anatomyTest.editor.select(bodyGenes.entity);
        anatomyTest.ui.openPart('objects', 'anatomy');
      });
    }
    evidence.push({ ...result, elapsedMs: performance.now()-start });
    console.log(JSON.stringify(result));
  }
  const regional = await page.evaluate(async () => {
    const { body, entity } = bodyGenes;
    const { defaults } = await import('/src/anatomy/parameters.ts');
    const { bodyGeneticsParameters, bodyGeneticsFrame } = await import('/src/anatomy/bodyGenetics.ts');
    const samples = [];
    for (const id of ['long','compact']) {
      body.patch({ ...bodyGeneticsParameters(defaults,id), ...bodyGeneticsFrame('balanced') }); await body.ready();
      samples.push(entity.meshes.find(m => m.metadata?.anatomyLayer === 'skin').getVerticesData('position').slice());
    }
    const report = {};
    for (let i = 0; i < samples[0].length; i += 3) {
      const [x,y,z] = bodyGenes.skin.slice(i,i+3), ax = Math.abs(x);
      const groups = [
        y > 1.2 && y < 1.36 && ax < .22 && z > 0 ? 'chest' : '',
        y > 1.34 && y < 1.49 ? 'shouldersNeck' : '',
        y > .95 && y < 1.4 && ax < .25 && z < 0 ? 'back' : '',
        ax > .23 && y > .92 && y < 1.32 ? 'arms' : '',
        y > .84 && y < .98 && z < 0 ? 'gluteal' : '',
        y > .5 && y < .83 ? 'thighs' : '',
        y > .12 && y < .48 ? 'calves' : '',
      ].filter(Boolean);
      const delta = Math.hypot(samples[0][i]-samples[1][i],samples[0][i+1]-samples[1][i+1],samples[0][i+2]-samples[1][i+2])*1000;
      for (const region of groups) {
        const row = report[region] ??= { samples: 0, maxMm: 0, sumSquared: 0 };
        row.samples++; row.maxMm = Math.max(row.maxMm,delta); row.sumSquared += delta*delta;
      }
    }
    for (const row of Object.values(report)) row.rmsMm = Math.sqrt(row.sumSquared/row.samples);
    const state = body.exportParameters();
    body.setPose({ rightArmAbduction: 30 }); await body.ready();
    for (const m of entity.meshes) if (m.getVerticesData('position').some(v => !Number.isFinite(v))) throw Error('Pose created non-finite geometry');
    body.setPose({}); await body.ready();
    const returned = entity.meshes.find(m => m.metadata?.anatomyLayer === 'skin').getVerticesData('position');
    if (returned.some((v,i) => v !== samples[1][i])) throw Error('Pose return changed the fitted genetic skin');
    body.importParameters(state); await body.ready();
    return report;
  });
  for (const [region, row] of Object.entries(regional)) assert.ok(row.samples && row.maxMm > .5, `No independent ${region} shape change: ${JSON.stringify(row)}`);
  await page.evaluate(() => { bodyGenes.body.region = 'overview'; anatomyTest.ui.renderPanel(); });
  await page.getByRole('button', { name: 'New genetic variation', exact: true }).click();
  const reproducible = await page.evaluate(async () => {
    const { body } = bodyGenes; await body.ready();
    const { bodyGeneticsParameters } = await import('/src/anatomy/bodyGenetics.ts');
    const p = body.parameters, gene = p.definition.genetics;
    if (gene.seed !== 1) throw Error('Variation did not advance seed');
    const first = bodyGeneticsParameters(p, gene.preset, gene.seed), second = bodyGeneticsParameters(p, gene.preset, gene.seed);
    if (JSON.stringify(first) !== JSON.stringify(second)) throw Error('Variation is not reproducible');
    return true;
  });
  const persistence = await page.evaluate(async () => {
    const { editor } = anatomyTest, { body } = bodyGenes, doc = body.exportParameters();
    editor.undo(); await body.ready();
    if (body.parameters.definition.genetics.seed !== 0) throw Error('Variation undo failed');
    editor.redo(); await body.ready();
    if (body.parameters.definition.genetics.seed !== 1) throw Error('Variation redo failed');
    body.importParameters(bodyGenes.baseline); await body.ready();
    const skin = bodyGenes.entity.meshes.find(m => m.metadata?.anatomyLayer === 'skin').getVerticesData('position');
    if (skin.some((v,i) => v !== bodyGenes.skin[i])) throw Error('Original anatomy was not restored exactly');
    body.importParameters(doc); await body.ready();
    if (JSON.stringify(body.parameters.definition) !== JSON.stringify(doc.parameters.definition)) throw Error('Parameter round-trip lost genetics');
    const { snapshot, toZip, fromZip, restore } = await import('/src/core/project.ts');
    const saved = await fromZip(await toZip(snapshot(editor, 'Body architecture check')));
    await restore(editor, saved);
    const restored = editor.entities.find(e => e.anatomyBody).anatomyBody; await restored.ready();
    if (JSON.stringify(restored.parameters.definition) !== JSON.stringify(doc.parameters.definition)) throw Error('Project round-trip lost genetics');
    return { baselineExact: true, undoRedo: true, parameterRoundTrip: true, projectRoundTrip: true };
  });
  const hypertrophy = await page.evaluate(async () => {
    const { editor } = anatomyTest, entity = editor.entities.find(e => e.anatomyBody), body = entity.anatomyBody;
    const { bodyGeneticsParameters } = await import('/src/anatomy/bodyGenetics.ts');
    body.patch({ ...bodyGeneticsParameters(body.parameters, 'shoulders'), deltoid: 3, skinOpacity: 1 });
    await body.ready();
    for (const mesh of entity.meshes) if (mesh.getVerticesData('position').some(v => !Number.isFinite(v))) throw Error('Hypertrophy created non-finite geometry');
    if (entity.meshes.some(mesh => !mesh.receiveShadows)) throw Error('Regenerated anatomy lost shadow reception');
    for (const light of editor.entities.filter(e => e.shadowGen)) {
      const casters = light.shadowGen.getShadowMap().renderList.filter(mesh => entity.meshes.includes(mesh));
      if (!casters.length || casters.some(mesh => mesh.metadata?.anatomyLayer !== 'skin')) throw Error('Internal shadows leak through opaque anatomical skin');
    }
    body.patch({ skinOpacity: 0 }); await body.ready();
    for (const light of editor.entities.filter(e => e.shadowGen)) {
      const casters = light.shadowGen.getShadowMap().renderList;
      if (!entity.meshes.some(mesh => mesh.isEnabled() && mesh.metadata?.anatomyLayer === 'otherMuscles' && casters.includes(mesh))) throw Error('Exposed muscles lost shadow casting');
    }
    body.patch({ skinOpacity: 1 }); await body.ready();
    return { deltoid: body.parameters.deltoid, maxVolumeError: Math.max(...body.anatomyMetrics.map(metric => metric.error)) };
  });
  assert.ok(hypertrophy.maxVolumeError < .001);
  if (output) {
    for (const [view, skin] of [['front', true], ['three', false]]) {
      await page.evaluate(async ({ view, skin }) => {
        const { editor } = anatomyTest, entity = editor.entities.find(e => e.anatomyBody), body = entity.anatomyBody;
        body.patch({ skinOpacity: skin ? 1 : 0 }); await body.ready();
        document.body.classList.add('ui-hidden'); editor.select(null);
        body.frame('body'); body.view(view); editor.camera.radius = 3.1; editor.scene.render();
      }, { view, skin });
      await settle();
      await page.screenshot({ path: `${output}/deltoid-3x-${view}-${skin ? 'skin' : 'muscles'}.png` });
    }
    await page.evaluate(() => document.body.classList.remove('ui-hidden'));
  }
  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 812 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => {
      const { editor, ui } = anatomyTest, entity = editor.entities.find(e => e.anatomyBody);
      editor.select(entity); entity.anatomyBody.region = 'overview'; ui.openPart('objects', 'anatomy');
    });
    await page.getByRole('combobox', { name: 'Body architecture', exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (output) await page.screenshot({ path: `${output}/controls-${viewport.width}.png` });
  }
  assert.deepEqual(errors, []);
  if (output) await writeFile(`${output}/report.json`, JSON.stringify({ evidence, regional, persistence, hypertrophy }, null, 2));
  console.log(JSON.stringify({ pass: true, architectures: ids.length, regional, reproducible, hypertrophy, ...persistence }));
} finally {
  await browser.close();
  await server.close();
}
