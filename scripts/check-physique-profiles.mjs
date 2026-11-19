// Exercise the actual preset cards and generated skin on desktop and phone layouts.
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
const server = await createServer({ cacheDir: resolve('node_modules/.vite-check-physique-profiles'), server: { host: '127.0.0.1', port: 0, hmr: false } });
await server.listen();
const browser = await playwright.chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 850 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/scripts/fixtures/anatomy-priority.html`,
    { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.anatomyTest, undefined, { timeout: 90000 });
  await page.evaluate(() => {
    document.querySelector('#test')?.remove();
    document.querySelector('#result')?.remove();
  });
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Physique studio', exact: true }).click();
  await page.waitForFunction(() => anatomyTest.editor.selected?.anatomyBody);
  await page.evaluate(async () => {
    window.physique = anatomyTest.editor.selected;
    await physique.anatomyBody.ready();
  });
  await page.locator('[data-physique-preset]').first().waitFor({ state: 'visible' });
  const ids = await page.locator('[data-physique-preset]').evaluateAll(nodes => nodes.map(n => n.dataset.physiquePreset));
  assert.ok(ids.length >= 10);
  const evidence = [];
  for (const id of ids) {
    await page.locator(`[data-physique-preset="${id}"]`).click();
    const result = await page.evaluate(async id => {
      const body = physique.anatomyBody;
      await body.ready();
      const { default: catalogue } = await import('/src/anatomy/catalogue.ts');
      const { selectedAbdominalGenetics } = await import('/src/anatomy/abdominalGenetics.ts');
      if (catalogue.bodyPresets[id].abdomen !== selectedAbdominalGenetics(body.parameters))
        throw Error(`Preset did not apply abdominal architecture: ${id}`);
      if (catalogue.bodyPresets[id].genetics !== body.parameters.definition?.genetics?.preset ||
          (catalogue.bodyPresets[id].geneticSeed ?? 0) !== body.parameters.definition?.genetics?.seed)
        throw Error(`Preset did not apply whole-body architecture: ${id}`);
      for (const [key, value] of Object.entries(catalogue.bodyPresets[id].values)) {
        if (body.parameters[key] !== value) throw Error(`Preset parameter was changed: ${id}/${key}`);
      }
      const skin = physique.meshes.find(m => m.metadata?.anatomyLayer === 'skin');
      const positions = skin.getVerticesData('position');
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) {
        const v = positions[i + k];
        if (!Number.isFinite(v)) throw Error(`Non-finite skin in ${id}`);
        min[k] = Math.min(min[k], v); max[k] = Math.max(max[k], v);
      }
      const extent = max.map((v, k) => v - min[k]);
      const dimensions = extent.map(v => v / extent[1]);
      return { id, extent, dimensions, heightCm: body.parameters.height, label: catalogue.bodyPresets[id].label };
    }, id);
    assert.ok(Math.abs(result.extent[1] * 100 - result.heightCm) < .02);
    assert.equal(await page.locator(`[data-physique-preset="${id}"]`).getAttribute('aria-pressed'), 'true');
    evidence.push(result);
    if (output) {
      await page.evaluate(() => {
        document.body.classList.add('ui-hidden');
        const { editor } = anatomyTest, body = physique.anatomyBody;
        editor.select(null); body.frame('body'); body.view('front');
        editor.camera.radius = 3.1;
        editor.camera.target.set(0, .94, 0);
        editor.scene.render();
      });
      await page.screenshot({ path: `${output}/${id}-front.png` });
      await page.evaluate(() => {
        document.body.classList.remove('ui-hidden');
        anatomyTest.editor.select(physique);
        anatomyTest.ui.openPart('objects', 'anatomy');
      });
    }
    console.log(JSON.stringify(result));
  }
  const lookup = Object.fromEntries(evidence.map(e => [e.id, e]));
  assert.ok(lookup.compact.dimensions[0] > lookup.longilinear.dimensions[0] * 1.2, 'Compact frame differs beyond stature');
  assert.ok(lookup.abdominal.dimensions[2] > lookup.longilinear.dimensions[2] * 1.2, 'Central depth differs beyond stature');
  await page.evaluate(async () => {
    const { editor } = anatomyTest, body = physique.anatomyBody;
    const expected = JSON.stringify(body.parameters);
    editor.undo(); await body.ready();
    if (JSON.stringify(body.parameters) === expected) throw Error('Preset undo did not restore previous parameters');
    editor.redo(); await body.ready();
    if (JSON.stringify(body.parameters) !== expected) throw Error('Preset redo did not restore parameters');
  });
  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 812 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => { physique.anatomyBody.region = 'overview'; anatomyTest.ui.renderPanel(); });
    await page.locator('[data-physique-preset]').first().waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (output) await page.screenshot({ path: `${output}/gallery-${viewport.width}.png` });
    await page.evaluate(() => { physique.anatomyBody.region = 'chest'; anatomyTest.ui.renderPanel(); });
    const details = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Left nipple' }) });
    assert.equal(await details.evaluate(n => n.open), false);
    console.log(JSON.stringify({ viewport, galleryAccessible: true, surfaceDetailsCollapsed: true }));
  }
  assert.deepEqual(errors, []);
  if (output) await writeFile(`${output}/report.json`, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ pass: true, presetCards: ids.length, undoRedo: true }));
} finally {
  await browser.close();
  await server.close();
}
