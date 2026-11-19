// Real editor/worker/UI smoke for the main-muscle continuation. Uses the same optional runtime as the other browser check.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(process.env.PLAYWRIGHT_MODULE); }
const browser = await playwright.chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL ?? 'chrome' });
const base = process.argv[2] ?? 'http://127.0.0.1:5199';
const group = process.argv[3] ?? 'shoulderNeckMuscles';
try {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 812 }]) {
    const page = await browser.newPage({ viewport }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { window.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 16); });
    await page.goto(base + '/scripts/fixtures/anatomy-priority.html');
    await page.waitForFunction(() => window.anatomyTest);
    const evidence = await page.evaluate(async group => {
      document.querySelector('#test').hidden = true; document.querySelector('#result').hidden = true;
      const { editor, ui } = window.anatomyTest, templates = (await import('/src/anatomy/muscleGroups.ts'))[group];
      const { atlas } = await import('/src/anatomy/atlas.ts');
      const entity = await editor.addAnatomy(), body = entity.anatomyBody;
      window.regionTest = { editor, ui, entity, body };
      body.patch({ otherMusclesOpacity: 1, bonesOpacity: 1 }); await body.ready();
      const { backMeshTemplate } = await import('/src/anatomy/muscleGroups.ts');
      const matches = mesh => templates.some(name => mesh.metadata.anatomicalName?.startsWith(name + '_') || backMeshTemplate(mesh.metadata.anatomicalName ?? '') === name);
      const snapshot = () => Object.fromEntries(entity.meshes.filter(matches).map(mesh => [mesh.metadata.anatomicalName, Array.from(mesh.getVerticesData('position'))]));
      const before = snapshot(), bounds = entity.meshes.filter(mesh => matches(mesh) && mesh.name.endsWith('_R')).map(mesh => ({ name: mesh.name, min: mesh.getBoundingInfo().boundingBox.minimum.asArray(), max: mesh.getBoundingInfo().boundingBox.maximum.asArray() }));
      for (const template of templates) { body.editIndividual(template + '.L', 'volume', 1.8); body.commit(); }
      await body.ready();
      const after = snapshot(), metrics = body.anatomyMetrics;
      const rightUnchanged = Object.entries(before).filter(([name]) => name.endsWith('_R')).every(([name, values]) => values.every((v, i) => v === after[name][i]));
      const thickness = values => { const n = values.length / 6; let sum = 0; for (let i = 0; i < n; i++) sum += Math.hypot(...[0, 1, 2].map(k => values[i * 3 + k] - values[(i + n) * 3 + k])); return sum / n * 1000; };
      const genetics = Object.entries(before).filter(([name]) => name.endsWith('_L')).map(([name, values]) => ({ name, beforeMm: thickness(values), afterMm: thickness(after[name]) }));
      const parameters = body.exportParameters(); body.importParameters(parameters); await body.ready();
      const savedIds = Object.keys(body.parameters.definition.muscles);
      const skin = () => Array.from(entity.meshes.find(mesh => mesh.metadata.anatomyLayer === 'skin').getVerticesData('position'));
      const rest = skin(), growth = {};
      for (const template of templates) growth[Object.entries(atlas.legacy).find(([, ids]) => ids.includes(template))?.[0] ?? template] = 2.5;
      body.patch({ individualGrowth: growth }); await body.ready();
      const grown = skin(); let skinDeltaMm = 0;
      for (let i = 0; i < rest.length; i += 3) skinDeltaMm = Math.max(skinDeltaMm, Math.hypot(...[0, 1, 2].map(k => grown[i + k] - rest[i + k])) * 1000);
      body.patch({ individualGrowth: {} }); await body.ready();
      body.region = group === 'shoulderNeckMuscles' ? 'chest' : ['axialMuscles', 'backMuscles'].includes(group) ? 'back' : 'legs'; editor.select(entity); ui.openPart('objects', 'anatomy');
      return { templates, rightUnchanged, metrics, genetics, skinDeltaMm, savedIds, bounds };
    }, group);
    assert.equal(evidence.metrics.length, evidence.templates.length);
    assert.ok(evidence.metrics.every(metric => metric.error < .02), JSON.stringify(evidence.metrics));
    assert.ok(evidence.rightUnchanged, 'Opposite-side geometry changed');
    assert.ok(evidence.templates.every(id => evidence.savedIds.includes(id + '.L')), 'JSON round-trip lost muscle IDs');
    assert.ok(evidence.skinDeltaMm > .01, 'Growth must move real skin');
    const musclesTab = page.getByRole('tab', { name: 'Muscles', exact: true });
    if (await musclesTab.count()) await musclesTab.click();
    if (group === 'shoulderNeckMuscles') await page.getByRole('button', { name: 'Shoulder girdle', exact: true }).click();
    if (group === 'legMuscles') await page.getByRole('button', { name: 'Deep lower leg', exact: true }).click();
    if (group === 'backMuscles') await page.getByRole('button', { name: 'Latissimus dorsi', exact: true }).click();
    if (group === 'axialMuscles') await page.getByRole('button', { name: 'Deep back', exact: true }).click();
    await page.waitForSelector('[data-individual-anatomy]');
    if (group === 'backMuscles') {
      for (const [button, labels] of [['Erector spinae', ['Longissimus', 'Iliocostalis']], ['Rhomboids', ['Rhomboid minor', 'Rhomboid major']]]) {
        await page.getByRole('button', { name: button, exact: true }).click();
        for (const label of labels) {
          const control = page.getByRole('slider', { name: label, exact: true });
          assert.equal(await control.getAttribute('min'), '0.3');
          assert.equal(await control.getAttribute('max'), '3');
          await control.evaluate(input => { input.value = '2.5'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
          await page.evaluate(() => regionTest.body.ready());
        }
      }
      const saved = await page.evaluate(() => regionTest.body.exportParameters());
      for (const key of ['longissimus', 'iliocostalis', 'rhomboidMinor', 'rhomboidMajor']) assert.equal(saved.parameters.individualGrowth[key], 2.5);
      await page.evaluate(async () => { const { body, ui } = regionTest; body.region = 'pelvis'; ui.openPart('objects', 'anatomy'); await body.ready(); });
      const shape = page.getByRole('tab', { name: 'Shape', exact: true }); if (await shape.count()) await shape.click();
      const height = page.getByRole('slider', { name: 'Nominal inguinal height', exact: true });
      for (const value of ['6', '22']) {
        await height.evaluate((input, value) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); }, value);
        const metrics = await page.evaluate(async () => { await regionTest.body.ready(); return regionTest.body.inguinalMetrics; });
        assert.ok(metrics.height > 0 && metrics.angle > 0 && metrics.angle < 180);
      }
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Horizontal overflow');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'PASS', viewport, group, ...evidence }));
    if (process.env.ANATOMY_SCREENSHOTS) {
      await page.evaluate(async () => { const { editor, body } = regionTest; document.body.classList.add('ui-hidden'); editor.select(null); body.patch({ skinOpacity: 0 }); await body.ready(); });
      await page.waitForTimeout(1800);
      await page.screenshot({ path: `${process.env.ANATOMY_SCREENSHOTS}/${group}-${viewport.width}.png` });
      if (group === 'backMuscles') for (const [view, alpha, back] of [['posterior-rest', -Math.PI / 2, 1], ['posterior-grown', -Math.PI / 2, 2.5], ['inguinal-rest', Math.PI / 2, 1]]) {
        await page.evaluate(async ({ alpha, back }) => {
          const { editor, body } = regionTest, { defaults } = await import('/src/anatomy/parameters.ts');
          body.patch({ ...defaults, back, individualGrowth: {}, definition: { version: 1, muscles: {}, bones: {} }, skinOpacity: 1, otherMusclesOpacity: 1 }); await body.ready();
          editor.camera.alpha = alpha; editor.camera.beta = Math.PI / 2; editor.camera.radius = 1.6; editor.camera.target.set(0, 1.12, 0); editor.invalidate();
        }, { alpha, back });
        await page.waitForTimeout(1200);
        await page.screenshot({ path: `${process.env.ANATOMY_SCREENSHOTS}/${view}-${viewport.width}.png` });
      }
    }
    await page.close();
  }
} finally { await browser.close(); }
