// Actual abdominal architecture selection, skin/muscle generation and persistence.
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
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false } });
await server.listen();
const browser = await playwright.chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 850, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/scripts/fixtures/anatomy-priority.html`,
    { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.anatomyTest, undefined, { timeout: 90000 });
  const ids = await page.evaluate(async () => {
    const { editor, ui } = anatomyTest;
    const entity = await editor.addAnatomy(), body = entity.anatomyBody;
    await body.ready();
    body.patch({ fat: 8, rectus: 1.2, rectusAbdominisOpacity: 1, externalObliqueOpacity: 1, azimuth: -65, fill: .3 });
    await body.ready();
    window.genetics = { entity, body, samples: [], baseline: body.exportParameters(),
      skin: entity.meshes.find(m => m.metadata?.anatomyLayer === 'skin').getVerticesData('position').slice() };
    body.region = 'abdomen'; ui.openPart('objects', 'anatomy');
    document.querySelector('#test')?.remove(); document.querySelector('#result')?.remove();
    return Object.keys((await import('/src/anatomy/abdominalGenetics.ts')).abdominalGenetics);
  });
  const evidence = [];
  for (const id of ids) {
    await page.getByRole('combobox', { name: 'Abdominal genetics', exact: true }).selectOption(id);
    const result = await page.evaluate(async id => {
      const { body, entity, samples } = genetics;
      await body.ready();
      const { selectedAbdominalGenetics } = await import('/src/anatomy/abdominalGenetics.ts');
      if (selectedAbdominalGenetics(body.parameters) !== id) throw Error(`Layout was not applied: ${id}`);
      if (body.parameters.fat !== 8 || body.parameters.rectus !== 1.2) throw Error('Architecture changed fat or hypertrophy');
      const positions = entity.meshes.find(m => m.metadata?.anatomyLayer === 'skin').getVerticesData('position');
      const sample = [];
      for (let i = 0; i < positions.length; i += 3) {
        if (![positions[i], positions[i+1], positions[i+2]].every(Number.isFinite)) throw Error('Non-finite skin');
        if (genetics.skin[i+2] > .015 && genetics.skin[i+1] > .9 && genetics.skin[i+1] < 1.3 && Math.abs(genetics.skin[i]) < .14)
          sample.push(positions[i], positions[i+1], positions[i+2]);
      }
      const differences = samples.map(other => {
        let sum = 0, maximum = 0, changed = 0;
        for (let i = 0; i < sample.length; i += 3) {
          const d = Math.hypot(sample[i] - other.values[i], sample[i+1] - other.values[i+1], sample[i+2] - other.values[i+2]);
          sum += d * d; maximum = Math.max(maximum, d);
          if (d > .0002) changed++;
        }
        return { id: other.id, rmsMm: Math.sqrt(sum / (sample.length / 3)) * 1000,
          maximumMm: maximum * 1000, changedFraction: changed / (sample.length / 3) };
      });
      samples.push({ id, values: sample });
      return { id, differences, leftRows: body.parameters.definition.muscles['rectus_abdominis.L'].intersections.length,
        rightRows: body.parameters.definition.muscles['rectus_abdominis.R'].intersections.length };
    }, id);
    // Intersections are local features: do not dilute them into one whole-abdomen average.
    assert.ok(result.differences.every(d => d.maximumMm > 1.5 && d.changedFraction > .05),
      `Abdominal layouts are too similar: ${JSON.stringify(result)}`);
    assert.equal(await page.getByRole('combobox', { name: 'Abdominal genetics', exact: true }).inputValue(), id);
    evidence.push(result);
    if (output) {
      for (const [view, skin] of [['front', true], ['front', false], ['three', true]]) {
        await page.evaluate(async ({ view, skin }) => {
          const { body } = genetics;
          body.patch({ skinOpacity: skin ? 1 : 0 }); await body.ready();
          document.body.classList.add('ui-hidden'); anatomyTest.editor.select(null);
          body.frame('torso'); body.view(view);
          anatomyTest.editor.camera.radius = 1.2;
          anatomyTest.editor.camera.target.set(0, 1.08, 0);
          anatomyTest.editor.scene.render();
        }, { view, skin });
        await page.screenshot({ path: `${output}/${id}-${view}-${skin ? 'skin' : 'muscles'}.png` });
      }
      await page.evaluate(() => {
        document.body.classList.remove('ui-hidden'); anatomyTest.editor.select(genetics.entity);
        anatomyTest.ui.openPart('objects', 'anatomy');
      });
    }
    console.log(JSON.stringify(result));
  }
  const persistence = await page.evaluate(async () => {
    const { editor } = anatomyTest, { body } = genetics;
    const { selectedAbdominalGenetics } = await import('/src/anatomy/abdominalGenetics.ts');
    const { supportParameterKey } = await import('/src/anatomy/supportCache.ts');
    const { abdominalGeneticsParameters } = await import('/src/anatomy/abdominalGenetics.ts');
    const { normalizeDefinition } = await import('/src/anatomy/definition.ts');
    const before = body.exportParameters();
    const key = supportParameterKey(body.parameters), changed = structuredClone(body.parameters);
    changed.definition.muscles['rectus_abdominis.L'].bellies[0].projection += 1;
    if (key === supportParameterKey(changed)) throw Error('Belly edits did not invalidate the support cache');
    const editable = structuredClone(body.parameters.definition);
    editable.muscles['rectus_abdominis.L'].intersections.pop();
    const resized = normalizeDefinition(editable).muscles['rectus_abdominis.L'];
    if (resized.bellies.length !== resized.intersections.length + 1) throw Error('Removing an intersection lost the belly layout');
    editable.muscles['rectus_abdominis.L'].intersections = [];
    if (normalizeDefinition(editable).muscles['rectus_abdominis.L'].bellies.length !== 1) throw Error('A continuous belly was not retained');
    delete editable.muscles['rectus_abdominis.L'].intersections;
    if (normalizeDefinition(editable).muscles['rectus_abdominis.L'].bellies) throw Error('Global segmentation retained a custom belly layout');
    const old = structuredClone(body.parameters);
    old.definition.muscles['pectoralis_major_clavicular.L'] = { ...old.definition.muscles['rectus_abdominis.L'], width: 1.2 };
    const candidate = abdominalGeneticsParameters(old, 'broad');
    if (JSON.stringify(candidate.definition.muscles['pectoralis_major_clavicular.L']) !== JSON.stringify(old.definition.muscles['pectoralis_major_clavicular.L']))
      throw Error('Architecture modified another muscle');
    body.patch(abdominalGeneticsParameters(body.parameters, 'elongated')); await body.ready();
    editor.undo(); await body.ready();
    if (selectedAbdominalGenetics(body.parameters) !== 'separated') throw Error('Architecture undo failed');
    editor.redo(); await body.ready();
    if (selectedAbdominalGenetics(body.parameters) !== 'elongated') throw Error('Architecture redo failed');
    body.importParameters(genetics.baseline); await body.ready();
    const skin = genetics.entity.meshes.find(m => m.metadata?.anatomyLayer === 'skin').getVerticesData('position');
    if (skin.some((v, i) => v !== genetics.skin[i])) throw Error('Restoring the original layout changed the baseline skin');
    body.importParameters(before); await body.ready();
    if (selectedAbdominalGenetics(body.parameters) !== 'separated') throw Error('Parameter round-trip lost architecture');
    const { snapshot, toZip, fromZip, restore } = await import('/src/core/project.ts');
    const project = await fromZip(await toZip(snapshot(editor, 'Abdominal architecture check')));
    await restore(editor, project);
    const restored = editor.entities.find(e => e.anatomyBody)?.anatomyBody;
    await restored.ready();
    if (selectedAbdominalGenetics(restored.parameters) !== 'separated') throw Error('Project round-trip lost architecture');
    return { undoRedo: true, parameterRoundTrip: true, projectRoundTrip: true, baselineExact: true, cacheInvalidation: true };
  });
  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 812 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => {
      const { editor, ui } = anatomyTest, entity = editor.entities.find(e => e.anatomyBody);
      entity.anatomyBody.region = 'abdomen'; editor.select(entity); ui.openPart('objects', 'anatomy');
    });
    await page.getByRole('combobox', { name: 'Abdominal genetics', exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (output) await page.screenshot({ path: `${output}/controls-${viewport.width}.png` });
  }
  assert.deepEqual(errors, []);
  if (output) await writeFile(`${output}/report.json`, JSON.stringify({ evidence, persistence }, null, 2));
  console.log(JSON.stringify({ pass: true, architectures: ids.length, ...persistence }));
} finally {
  await browser.close();
  await server.close();
}
