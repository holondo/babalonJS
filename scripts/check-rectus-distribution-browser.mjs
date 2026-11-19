// Real UI/worker regression for the two-intersection hypertrophy distribution.
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
    await page.addInitScript(() => { window.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 16); });
    await page.goto(base + '/scripts/fixtures/anatomy-priority.html');
    await page.waitForFunction(() => window.anatomyTest);
    await page.evaluate(async () => {
      document.querySelector('#test').hidden = true; document.querySelector('#result').hidden = true;
      const { editor, ui } = anatomyTest, entity = await editor.addAnatomy(), body = entity.anatomyBody;
      body.patch({ otherMusclesOpacity: 1, rectusAbdominisOpacity: 1 }); await body.ready();
      const skin = () => Array.from(entity.meshes.find(m => m.metadata.anatomyLayer === 'skin').getVerticesData('position'));
      window.rectusDistribution = { editor, body, skin, ui, entity };
      body.region = 'abdomen'; editor.select(entity); ui.openPart('objects', 'anatomy');
    });
    await page.getByRole('tab', { name: 'Muscles', exact: true }).click();
    const setSlider = async (label, value) => page.getByRole('slider', { name: label, exact: true }).evaluate((input, value) => {
      input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
    await setSlider('Abdominal segments', 4);
    await page.evaluate(async () => { await rectusDistribution.body.ready(); rectusDistribution.rest = rectusDistribution.skin(); });
    for (const [label, key] of [['Rectus abdominis', 'rectus_abdominis'], ['Rectus volume', 'rectus']]) {
      await setSlider(label, 2.5);
      const evidence = await page.evaluate(async key => {
        const { editor, body, skin, rest } = rectusDistribution; await body.ready();
        const { rectusGrowthExposure } = await import('/src/anatomy/geometry.ts');
        const grown = skin(); let lowerMm = 0, coveredMm = 0, samples = 0;
        for (let i = 0; i < rest.length; i += 3) {
          const x = rest[i] * 10, y = rest[i + 1] * 10, z = rest[i + 2] * 10;
          if (z < .5 || Math.abs(x) > .85 || y < 9.5 || y > 14) continue;
          const d = Math.hypot(...[0, 1, 2].map(k => rest[i + k] - grown[i + k])) * 1000;
          if (y > 9.8 && y < 10.7 && Math.abs(x) > .2) lowerMm = Math.max(lowerMm, d);
          if (y > 12 && rectusGrowthExposure(body.parameters, x, y) === 0) { coveredMm = Math.max(coveredMm, d); samples++; }
        }
        const value = () => key === 'rectus' ? body.parameters.rectus : body.parameters.individualGrowth?.[key] ?? 1;
        const applied = value(); editor.undo(); await body.ready(); const undone = value(); editor.redo(); await body.ready(); const redone = value();
        body.importParameters(body.exportParameters()); await body.ready();
        return { key, lowerMm, coveredMm, samples, applied, undone, redone, restored: value(), segments: body.parameters.rectusSegmentCount };
      }, key);
      assert.equal(evidence.segments, 4); assert.equal(evidence.applied, 2.5); assert.equal(evidence.undone, 1); assert.equal(evidence.redone, 2.5); assert.equal(evidence.restored, 2.5);
      assert.ok(evidence.samples > 20 && evidence.coveredMm < .01 && evidence.lowerMm > 1, JSON.stringify(evidence));
      console.log(JSON.stringify({ status: 'PASS', viewport, ...evidence }));
      if (process.env.ANATOMY_SCREENSHOTS && key === 'rectus_abdominis') {
        await page.evaluate(async () => {
          const { editor, body } = rectusDistribution; editor.select(null); document.body.classList.add('ui-hidden');
          body.patch({ skinOpacity: 1 }); await body.ready();
          editor.camera.alpha = Math.PI / 2; editor.camera.beta = Math.PI / 2; editor.camera.radius = 1.35; editor.camera.target.set(0, 1.16, 0); editor.invalidate();
        });
        await page.waitForTimeout(1500);
        await page.screenshot({ path: `${process.env.ANATOMY_SCREENSHOTS}/rectus-two-intersections-${viewport.width}.png` });
        await page.evaluate(async () => { rectusDistribution.body.patch({ skinOpacity: 0 }); await rectusDistribution.body.ready(); });
        await page.screenshot({ path: `${process.env.ANATOMY_SCREENSHOTS}/rectus-two-intersections-internals-${viewport.width}.png` });
        await page.evaluate(async () => { rectusDistribution.body.patch({ skinOpacity: 1 }); await rectusDistribution.body.ready(); });
        await page.evaluate(() => { const { editor, ui, entity } = rectusDistribution; document.body.classList.remove('ui-hidden'); editor.select(entity); ui.openPart('objects', 'anatomy'); });
      }
      await setSlider(label, 1); await page.evaluate(() => rectusDistribution.body.ready());
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []); await page.close();
  }
} finally { await browser.close(); }
