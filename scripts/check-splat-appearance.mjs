// Compare the loader's original Gaussian renderer with the editor instance at fixed angles.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const module = process.env.BABALON_PLAYWRIGHT_PATH;
const { chromium } = await import(module ? pathToFileURL(module).href : 'playwright');
const require = createRequire(module ? pathToFileURL(module) : import.meta.url);
const sharp = require('sharp');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  await page.goto(process.env.BABALON_TEST_URL ?? 'http://localhost:5174/');
  await page.waitForFunction(() => window.ui && window.editor);
  await page.evaluate(() => { window.ui.scheduleAutosave = () => {}; });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose files', exact: true }).click();
  await (await chooser).setFiles(process.env.BABALON_TEST_SPZ);
  await page.waitForFunction(() => window.editor.entities.some(e => e.kind === 'model'), null, { timeout: 60000 });
  if (process.env.BABALON_TEST_REOPEN) await page.evaluate(async () => {
    const ui = window.ui;
    await ui.autosaveNow();
    const { loadProject } = await import('/src/core/project.ts');
    await ui.loadSnapshot(await loadProject(ui.projectId), ui.projectId);
    window.editor.select(window.editor.entities.find(e => e.kind === 'model'));
  });
  await page.evaluate(async () => {
    const ed = window.editor, entity = ed.selected;
    const original = entity.source.container.meshes.find(m => m.getClassName().includes('GaussianSplatting'));
    const instance = entity.meshes[0];
    entity.source.container.addAllToScene();
    original.parent = instance.parent;
    original.setEnabled(false);
    window.splatComparison = { original, instance };
    document.body.classList.add('ui-hidden');
    ed.setPhotoMode(true); ed.setShadowsEnabled(false);
    ed.cameraTween = null;
    await ed.scene.whenReadyAsync();
  });
  const comparisons = [], images = [];
  for (const angle of [-2.4, -1.2, 0, 1.2, 2.4]) {
    const pair = [];
    for (const original of [true, false]) {
      await page.evaluate(async ({ angle, original }) => {
        const ed = window.editor, pair = window.splatComparison;
        pair.original.setEnabled(original); pair.instance.setEnabled(!original);
        ed.camera.alpha = angle; ed.camera.beta = 1.15; ed.invalidate(3000);
        // Force the new view/transform to submit its sort before checking the gate.
        ed.scene.render();
        const active = original ? pair.original : pair.instance;
        const deadline = performance.now() + 5000;
        while ((!active._hasRenderedOnce || !active._isDepthSortSettled) && performance.now() < deadline) await new Promise(r => setTimeout(r, 20));
        await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
        await new Promise(r => setTimeout(r, 100));
      }, { angle, original });
      pair.push(await page.screenshot());
    }
    const a = await sharp(pair[0]).removeAlpha().raw().toBuffer();
    const b = await sharp(pair[1]).removeAlpha().raw().toBuffer();
    let difference = 0; for (let i = 0; i < a.length; i++) difference += Math.abs(a[i] - b[i]);
    comparisons.push({ angle, meanPixelDifference: +(difference / a.length).toFixed(4) });
    images.push(...pair);
  }
  if (process.env.BABALON_COMPARISON_IMAGE) await sharp({ create: { width: 1280, height: 480 * comparisons.length, channels: 3, background: 'black' } }).composite(images.map((input,i) => ({ input, left: i % 2 * 640, top: Math.floor(i / 2) * 480 }))).resize({ width: 640 }).png().toFile(process.env.BABALON_COMPARISON_IMAGE);
  console.log(JSON.stringify(comparisons));
  assert.ok(comparisons.every(c => c.meanPixelDifference < 0.5), 'Editor splat rendering differs from the loader original');
} finally { await browser.close(); }
