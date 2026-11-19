// Real worker/rendering path at simultaneous abdominal maxima, on both skins.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(process.env.PLAYWRIGHT_MODULE); }
const browser = await playwright.chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL ?? 'chrome' });
const base = process.argv[2] ?? 'http://127.0.0.1:5173';
try {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 812 }]) {
    const page = await browser.newPage({ viewport }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { window.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 16); });
    await page.goto(base + '/scripts/fixtures/anatomy-priority.html');
    await page.waitForFunction(() => window.anatomyTest);
    await page.evaluate(async () => {
      const { editor } = anatomyTest, entity = await editor.addAnatomy(), body = entity.anatomyBody;
      window.rectusMaxTest = { editor, entity, body };
      document.querySelector('#test').hidden = true; document.querySelector('#result').hidden = true;
      editor.select(null);
      const hidden = Object.fromEntries(Object.keys(body.parameters).filter(key => key.endsWith('Opacity')).map(key => [key, 0]));
      body.patch({ ...hidden, skinOpacity: 1 }); await body.ready();
    });
    const visibility = await page.evaluate(async () => {
      const { entity, body } = rectusMaxTest, count = () => entity.meshes.filter(mesh => mesh.metadata.anatomyLayer === 'otherMuscles').length;
      const hidden = count(); body.patch({ otherMusclesOpacity: 1 }); await body.ready();
      return { hidden, shown: count() };
    });
    assert.equal(visibility.hidden, 0, 'Automatic covering support stays internal');
    assert.ok(visibility.shown > 100, 'Showing muscles loads the full layer after skin-only generation');
    for (const skinModel of [0, 1]) {
      const widths = [];
      for (const abdominalModel of [2, 1]) {
        const result = await page.evaluate(async ({ skinModel, abdominalModel }) => {
          const { body, entity, editor } = rectusMaxTest;
          body.patch({ skinModel, abdominalModel, rectWidth: 9, rectus: 3, individualGrowth: { rectus_abdominis: 3 }, definition: { version: 1, muscles: Object.fromEntries(['L', 'R'].map(side => [`rectus_abdominis.${side}`, { width: 1.5, volume: 2 }])), bones: {} }, skinOpacity: 1, rectusAbdominisOpacity: 1, aponeurosesOpacity: 1 });
          await body.ready();
          const rectus = () => entity.meshes.filter(mesh => mesh.metadata.anatomyLayer === 'rectusAbdominis');
          const positions = rectus().map(mesh => Array.from(mesh.getVerticesData('position')));
          const widthMm = (Math.max(...rectus().map(mesh => mesh.getBoundingInfo().boundingBox.maximum.x)) - Math.min(...rectus().map(mesh => mesh.getBoundingInfo().boundingBox.minimum.x))) * 1000;
          body.patch({ skinOpacity: 0 }); await body.ready();
          const stable = JSON.stringify(positions) === JSON.stringify(rectus().map(mesh => Array.from(mesh.getVerticesData('position'))));
          body.patch({ skinOpacity: 1 }); await body.ready();
          editor.camera.alpha = Math.PI / 2; editor.camera.beta = Math.PI / 2; editor.camera.radius = 1.4; editor.camera.target.set(0, 1.14, 0); editor.invalidate();
          return { widthMm, stable };
        }, { skinModel, abdominalModel });
        assert.ok(result.stable, 'Skin visibility must not change internal geometry');
        widths.push(result.widthMm);
        if (process.env.ANATOMY_SCREENSHOTS) {
          await page.waitForTimeout(300);
          await page.screenshot({ path: `${process.env.ANATOMY_SCREENSHOTS}/rectus-max-${viewport.width}-${skinModel}-${abdominalModel}.png` });
        }
      }
      assert.ok(Math.abs(widths[1] - widths[0]) < 1);
      console.log(JSON.stringify({ status: 'PASS', viewport, skinModel, originalWidthMm: widths[0], currentWidthMm: widths[1] }));
    }
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.close();
  }
} finally { await browser.close(); }
