// Real UI/worker regression for the independent rectus shape controls and tendon direction.
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
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { window.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 16); });
    await page.goto(base + '/scripts/fixtures/anatomy-priority.html'); await page.waitForFunction(() => window.anatomyTest);
    await page.evaluate(async () => {
      document.querySelector('#test').hidden = true; document.querySelector('#result').hidden = true;
      const { editor, ui } = anatomyTest, entity = await editor.addAnatomy(), body = entity.anatomyBody;
      body.patch({ rectus: 2.5, rectGap: .1, individualGrowth: { rectus_abdominis: 2.5 }, otherMusclesOpacity: 1, rectusAbdominisOpacity: 1, aponeurosesOpacity: 1 });
      body.setTissueInteraction({ attachments: true, skinFollows: true }); body.editIndividual('rectus_abdominis.L', 'volume', 1.8); body.commit(); await body.ready();
      window.rectusControlTest = { editor, ui, body, entity };
      body.region = 'abdomen'; editor.select(entity); ui.openPart('objects', 'anatomy');
    });
    await page.getByRole('tab', { name: 'Muscles', exact: true }).click();
    await page.getByRole('tab', { name: 'Left', exact: true }).click();
    const edit = async (name, value) => { await page.getByRole('slider', { name, exact: true }).evaluate((input, value) => { input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); }, value); await page.evaluate(() => rectusControlTest.body.ready()); };
    const snapshot = () => page.evaluate(() => {
      const { entity } = rectusControlTest, muscle = entity.meshes.find(m => m.metadata.anatomicalName === 'rectus_abdominis_L_segment_2'), p = muscle.getVerticesData('position'), pairs = p.length / 6, cols = 21, row = Math.floor((pairs / cols - 1) / 2), mid = v => -(p[v * 3] + p[(v + pairs) * 3]) / 2;
      const medial = mid(row * cols), lateral = mid(row * cols + cols - 1);
      return { gapMm: medial * 2000, widthMm: (lateral - medial) * 1000, y: entity.meshes.filter(m => /^tendinous_intersection_L_/.test(m.metadata.anatomicalName ?? '')).map(m => Array.from(m.getVerticesData('position')).filter((_, i) => i % 3 === 1)) };
    });
    const samples = [];
    for (const width of [.65, 1, 1.5]) { await edit('Individual width', width); samples.push({ width, ...await snapshot() }); }
    assert.ok(samples[0].widthMm < samples[1].widthMm && samples[1].widthMm < samples[2].widthMm && samples[2].widthMm - samples[0].widthMm > 10);
    for (const sample of samples) {
      assert.ok(sample.gapMm > 0 && sample.gapMm < 3 && Math.abs(sample.gapMm - samples[1].gapMm) < .1);
      for (let band = 0; band < sample.y.length; band++) for (let i = 0; i < sample.y[band].length; i++) assert.ok(Math.abs(sample.y[band][i] - samples[1].y[band][i]) * 1000 < .01);
    }
    await edit('Rectus separation', 2); const wideGap = await snapshot(); assert.ok(wideGap.gapMm > samples[2].gapMm + 10);
    await edit('Rectus separation', .1); await edit('Rectus width', 2); const narrow = await snapshot(); await edit('Rectus width', 9); const wide = await snapshot(); assert.ok(wide.widthMm > narrow.widthMm * 2);
    const saved = await page.evaluate(async () => { const { body, editor } = rectusControlTest; const saved = body.exportParameters(); body.importParameters(saved); await body.ready(); editor.undo(); await body.ready(); editor.redo(); await body.ready(); return { rectWidth: body.parameters.rectWidth, gap: body.parameters.rectGap }; });
    assert.equal(saved.rectWidth, 9); assert.equal(saved.gap, .1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'PASS', viewport, samples: samples.map(({ y, ...values }) => values), wideGapMm: wideGap.gapMm, globalWidthMm: [narrow.widthMm, wide.widthMm] }));
    if (process.env.ANATOMY_SCREENSHOTS) {
      await page.evaluate(async () => { const { body, editor } = rectusControlTest; body.patch({ rectWidth: 5, skinOpacity: .12 }); await body.ready(); editor.select(null); document.body.classList.add('ui-hidden'); editor.camera.alpha = Math.PI * .35; editor.camera.beta = Math.PI / 2; editor.camera.radius = 1.45; editor.camera.target.set(0, 1.15, 0); editor.invalidate(); });
      await page.waitForTimeout(1500); await page.screenshot({ path: `${process.env.ANATOMY_SCREENSHOTS}/rectus-controls-${viewport.width}.png` });
    }
    await page.close();
  }
} finally { await browser.close(); }
