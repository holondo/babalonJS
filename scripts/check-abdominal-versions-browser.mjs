// Real UI/worker regression for the three abdominal versions and their project persistence.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(process.env.PLAYWRIGHT_MODULE); }
const browser = await playwright.chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL ?? 'chrome' });
const base = process.argv[2] ?? 'http://127.0.0.1:5201';
try {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 812 }]) {
    const page = await browser.newPage({ viewport }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { window.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 16); });
    await page.goto(base + '/scripts/fixtures/anatomy-priority.html'); await page.waitForFunction(() => window.anatomyTest);
    await page.evaluate(async () => {
      document.querySelector('#test').hidden = true; document.querySelector('#result').hidden = true;
      const { editor, ui } = anatomyTest, entity = await editor.addAnatomy(), body = entity.anatomyBody;
      body.patch({ rectus: 2.5, rectWidth: 7, rectGap: .5, rectPattern: .7, individualGrowth: { rectus_abdominis: 1.8 }, otherMusclesOpacity: 1, rectusAbdominisOpacity: 1, externalObliqueOpacity: 1, aponeurosesOpacity: 1 }); await body.ready();
      window.abdominalVersionTest = { editor, ui, entity, body }; body.region = 'abdomen'; editor.select(entity); ui.openPart('objects', 'anatomy');
    });
    await page.getByRole('tab', { name: 'Muscles', exact: true }).click();
    const selector = page.getByRole('combobox', { name: 'Abdominal wall', exact: true });
    assert.deepEqual(await selector.locator('option').evaluateAll(options => options.map(option => [option.value, option.textContent])), [['2', 'Original version'], ['1', 'Current version'], ['0', 'Legacy sheets']]);
    assert.equal(await selector.inputValue(), '1'); const results = [];
    for (const mode of [2, 1, 0]) {
      await selector.selectOption(String(mode));
      results.push(await page.evaluate(async () => {
        const { body, entity } = abdominalVersionTest; await body.ready();
        const p = body.parameters, rectus = entity.meshes.find(m => m.metadata.anatomicalName === 'rectus_abdominis_R_segment_2'), oblique = entity.meshes.find(m => m.metadata.anatomyLayer === 'externalOblique');
        const positions = Array.from(rectus.getVerticesData('position'));
        return { mode: p.abdominalModel, rectus: p.rectus, rectWidth: p.rectWidth, rectGap: p.rectGap, stagger: p.rectPattern, growth: p.individualGrowth.rectus_abdominis, obliqueVertices: oblique.getTotalVertices(), positions };
      }));
    }
    for (const [index, mode] of [2, 1, 0].entries()) { const r = results[index]; assert.equal(r.mode, mode); assert.equal(r.rectus, 2.5); assert.equal(r.rectWidth, 7); assert.equal(r.rectGap, .5); assert.equal(r.stagger, .7); assert.equal(r.growth, 1.8); }
    assert.notDeepEqual(results[0].positions, results[1].positions); assert.notEqual(results[1].obliqueVertices, results[2].obliqueVertices);
    await selector.selectOption('2');
    const saved = await page.evaluate(async () => {
      const { body, editor } = abdominalVersionTest; await body.ready(); editor.undo(); await body.ready(); const undone = body.parameters.abdominalModel; editor.redo(); await body.ready(); const redone = body.parameters.abdominalModel;
      const saved = body.exportParameters(); body.importParameters(saved); await body.ready(); const reopened = body.parameters.abdominalModel;
      const old = structuredClone(saved); delete old.parameters.abdominalModel; body.importParameters(old); await body.ready(); const olderDefault = body.parameters.abdominalModel; body.importParameters(saved); await body.ready();
      const { normalizeParameters } = await import('/src/anatomy/body.ts'); const normalized = [0,1,2,3].map(abdominalModel => normalizeParameters({ abdominalModel }).abdominalModel);
      const { snapshot, toZip, fromZip, restore } = await import('/src/core/project.ts'); const decoded = await fromZip(await toZip(await snapshot(editor, 'Abdominal versions'))); editor.resetScene(); await restore(editor, decoded);
      const entity = editor.entities.find(e => e.anatomyBody), restored = entity.anatomyBody; await restored.ready(); Object.assign(abdominalVersionTest, { entity, body: restored });
      return { undone, redone, reopened, olderDefault, normalized, zipMode: restored.parameters.abdominalModel };
    });
    assert.deepEqual(saved, { undone: 0, redone: 2, reopened: 2, olderDefault: 1, normalized: [0,1,2,1], zipMode: 2 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'PASS', viewport, modes: results.map(({ positions, ...values }) => values), saved }));
    await page.close();
  }
} finally { await browser.close(); }
