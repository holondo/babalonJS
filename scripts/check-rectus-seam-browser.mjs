// Real UI/worker regression for the midline volume continuity and parameter-driven stagger.
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
      const { editor, ui } = anatomyTest, entity = await editor.addAnatomy(), body = entity.anatomyBody; body.patch({ rectusAbdominisOpacity: 1, aponeurosesOpacity: 1 }); await body.ready();
      const skin = () => Array.from(entity.meshes.find(m => m.metadata.anatomyLayer === 'skin').getVerticesData('position'));
      window.rectusSeamTest = { editor, ui, body, entity, skin, rest: skin() };
      body.region = 'abdomen'; editor.select(entity); ui.openPart('objects', 'anatomy');
    });
    await page.getByRole('tab', { name: 'Muscles', exact: true }).click();
    const edit = async (name, value) => { await page.getByRole('slider', { name, exact: true }).evaluate((input, value) => { input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); }, value); await page.evaluate(() => rectusSeamTest.body.ready()); };
    const volumes = [];
    for (const value of [.2, 2.5, 3]) {
      await edit('Rectus volume', value);
      const result = await page.evaluate(() => {
        const { rest, skin } = rectusSeamTest, grown = skin(), centers = [], neighbours = [];
        for (let i = 0; i < rest.length; i += 3) { if (rest[i + 1] < 1.02 || rest[i + 1] > 1.18 || rest[i + 2] < .08) continue; if (Math.abs(rest[i]) < .000001) centers.push(i); else if (Math.abs(rest[i]) > .001 && Math.abs(rest[i]) < .012) neighbours.push(i); }
        let maxJumpMm = 0, pairs = 0;
        for (const i of centers) for (const j of neighbours) { if (Math.abs(rest[i + 1] - rest[j + 1]) > .0025 || Math.abs(rest[i + 2] - rest[j + 2]) > .01) continue; maxJumpMm = Math.max(maxJumpMm, Math.abs((grown[i + 2] - rest[i + 2]) - (grown[j + 2] - rest[j + 2])) * 1000); pairs++; }
        return { maxJumpMm, pairs };
      });
      assert.ok(result.pairs > 20 && result.maxJumpMm < 5, JSON.stringify(result)); volumes.push({ value, ...result });
    }
    await edit('Rectus volume', 2.5); const staggers = [];
    for (const value of [-1, 0, 1]) {
      await edit('Rectus intersection stagger', value);
      staggers.push(await page.evaluate(value => {
        const { entity, body, skin } = rectusSeamTest;
        const height = side => { const mesh = entity.meshes.find(m => m.metadata.anatomicalName === `tendinous_intersection_${side}_1`), p = mesh.getVerticesData('position'); let sum = 0; for (let i = 1; i < p.length; i += 3) sum += p[i]; return sum / (p.length / 3); };
        return { value, parameter: body.parameters.rectPattern, staggerMm: (height('R') - height('L')) * 1000, skin: skin() };
      }, value));
    }
    assert.ok(staggers[0].staggerMm < -5 && Math.abs(staggers[1].staggerMm) < .01 && staggers[2].staggerMm > 5);
    assert.notDeepEqual(staggers[0].skin, staggers[1].skin); assert.notDeepEqual(staggers[2].skin, staggers[1].skin);
    const restored = await page.evaluate(async () => { const { body, editor } = rectusSeamTest; editor.undo(); await body.ready(); const undone = body.parameters.rectPattern; editor.redo(); await body.ready(); const redone = body.parameters.rectPattern; body.importParameters(body.exportParameters()); await body.ready(); return { undone, redone, reopened: body.parameters.rectPattern }; });
    assert.deepEqual(restored, { undone: 0, redone: 1, reopened: 1 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'PASS', viewport, volumes, staggers: staggers.map(({ skin, ...values }) => values), restored }));
    if (process.env.ANATOMY_SCREENSHOTS) for (const value of [0, 1]) {
      await page.evaluate(async value => { const { body, editor } = rectusSeamTest; body.patch({ rectPattern: value, skinOpacity: 1 }); await body.ready(); editor.select(null); document.body.classList.add('ui-hidden'); editor.camera.alpha = Math.PI / 2; editor.camera.beta = Math.PI / 2; editor.camera.radius = 1.4; editor.camera.target.set(0, 1.15, 0); editor.invalidate(); }, value);
      await page.waitForTimeout(1500); await page.screenshot({ path: `${process.env.ANATOMY_SCREENSHOTS}/rectus-seam-stagger-${value}-${viewport.width}.png` });
    }
    await page.close();
  }
} finally { await browser.close(); }
