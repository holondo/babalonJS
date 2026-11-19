// Real UI/worker check: abdominal growth must not become pectoral hypertrophy.
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
      const snapshot = () => Object.fromEntries(entity.meshes.filter(m => m.metadata.anatomyLayer === 'skin' || /^pectoralis_/.test(m.name) || m.metadata.anatomyLayer === 'rectusAbdominis').map(m => [m.name, Array.from(m.getVerticesData('position'))]));
      window.rectusTest = { editor, body, snapshot, before: snapshot() };
      body.region = 'abdomen'; editor.select(entity); ui.openPart('objects', 'anatomy');
    });
    await page.getByRole('tab', { name: 'Muscles', exact: true }).click();
    const slider = page.getByRole('slider', { name: 'Rectus volume', exact: true });
    await slider.evaluate(input => { input.value = '2.5'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
    const evidence = await page.evaluate(async () => {
      const { editor, body, snapshot, before } = rectusTest;
      await body.ready(); const volume = body.parameters.rectus;
      body.setGrowth('rectus_abdominis', 2.5, true); await body.ready();
      const compare = (a, b) => {
        let pectoralMm = 0, abdomenMm = 0, upperChestMm = 0;
        for (const [name, values] of Object.entries(a)) {
          for (let i = 0; i < values.length; i += 3) {
            const d = Math.hypot(...[0, 1, 2].map(k => b[name][i + k] - values[i + k])) * 1000;
            if (name.startsWith('pectoralis_')) pectoralMm = Math.max(pectoralMm, d);
            else if (values[i + 1] > 1.33 && values[i + 1] < 1.46 && Math.abs(values[i]) < .16) upperChestMm = Math.max(upperChestMm, d);
            else if (values[i + 1] > .98 && values[i + 1] < 1.23) abdomenMm = Math.max(abdomenMm, d);
          }
        }
        return { pectoralMm, abdomenMm, upperChestMm };
      };
      const ordinary = compare(before, snapshot());
      editor.undo(); await body.ready(); const undone = body.parameters.individualGrowth?.rectus_abdominis ?? 1;
      editor.redo(); await body.ready(); const redone = body.parameters.individualGrowth.rectus_abdominis;
      const saved = body.exportParameters(); body.importParameters(saved); await body.ready();
      const modes = [];
      for (const contact of [false, true]) {
        body.patch({ rectus: 1, individualGrowth: {} });
        body.setTissueInteraction({ attachments: true, skinFollows: true, contact }); await body.ready();
        const rest = snapshot();
        body.patch({ rectus: 2.5, individualGrowth: { rectus_abdominis: 2.5 } }); await body.ready();
        modes.push({ contact, ...compare(rest, snapshot()), contacts: body.contactMetrics, attachments: body.attachmentMetrics });
      }
      return { volume, ordinary, undone, redone, restored: body.parameters.rectus, modes, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.equal(evidence.volume, 2.5); assert.equal(evidence.undone, 1); assert.equal(evidence.redone, 2.5); assert.equal(evidence.restored, 2.5);
    assert.ok(evidence.ordinary.pectoralMm < .01 && evidence.ordinary.abdomenMm > 1, JSON.stringify(evidence));
    assert.ok(evidence.ordinary.upperChestMm < .01, 'Abdominal growth must not inflate the upper chest skin');
    for (const mode of evidence.modes) {
      assert.ok(mode.pectoralMm < .01, JSON.stringify(mode));
      assert.ok(mode.upperChestMm < 1, 'Connected skin retains only a small local smoothing transition');
      assert.ok(mode.contacts.every(c => c.afterMm < .2), JSON.stringify(mode.contacts));
      assert.ok(mode.attachments.every(a => a.errorMm < .1), JSON.stringify(mode.attachments));
    }
    assert.equal(evidence.overflow, false); assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'PASS', viewport, ...evidence }));
    if (process.env.ANATOMY_SCREENSHOTS) {
      await page.evaluate(() => { document.body.classList.add('ui-hidden'); rectusTest.editor.select(null); });
      await page.waitForTimeout(1500);
      await page.evaluate(() => { const e = rectusTest.editor; e.camera.alpha = Math.PI / 2; e.camera.beta = Math.PI / 2; e.camera.radius = 1.65; e.camera.target.set(0, 1.17, 0); e.invalidate(); });
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${process.env.ANATOMY_SCREENSHOTS}/rectus-boundaries-${viewport.width}.png` });
    }
    await page.close();
  }
} finally { await browser.close(); }
