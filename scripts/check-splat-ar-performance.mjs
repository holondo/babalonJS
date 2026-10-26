// Translation-only tracked-camera motion must not sort/upload every Gaussian again.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.BABALON_PLAYWRIGHT_PATH ? pathToFileURL(process.env.BABALON_PLAYWRIGHT_PATH).href : 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => {
    const Original = Worker;
    window.sortPosts = 0;
    window.Worker = class extends Original {
      postMessage(data, ...args) { if (data?.command === 'sort') window.sortPosts++; return super.postMessage(data, ...args); }
    };
  });
  await page.goto(process.env.BABALON_TEST_URL ?? 'http://localhost:5175/');
  await page.waitForFunction(() => window.editor && window.ui);
  await page.evaluate(() => { window.ui.scheduleAutosave = () => {}; clearTimeout(window.ui.autosaveTimer); });
  if (process.env.BABALON_TEST_SPZ) {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Choose files', exact: true }).click();
    await (await chooser).setFiles(process.env.BABALON_TEST_SPZ);
    await page.waitForFunction(() => window.editor.entities.some(e => e.kind === 'model'), null, { timeout: 60000 });
  } else await page.evaluate(async () => {
    const count = 8192, data = new ArrayBuffer(count * 32), f = new Float32Array(data), b = new Uint8Array(data);
    for (let i = 0; i < count; i++) {
      f.set([(i % 32) / 32 - .5, Math.floor(i / 32) % 32 / 32, Math.floor(i / 1024) / 16, .02, .01, .03], i * 8);
      b.set([i % 255, 128, 180, 190, 255, 128, 128, 128], i * 32 + 24);
    }
    await editor.addFiles([new File([data], 'ar-performance.splat')]);
  });
  const result = await page.evaluate(async () => {
    const ed = editor;
    const { FreeCamera } = await import('/node_modules/@babylonjs/core/Cameras/freeCamera.js');
    const { ARMode } = await import('/src/ar/ar.ts');
    const { snapshot } = await import('/src/core/project.ts');
    const mesh = ed.entities.flatMap(e => e.meshes).find(m => m.getClassName().includes('GaussianSplatting'));
    ed.cameraTween = null; ed.select(null);
    const camera = new FreeCamera('Tracked pose regression', ed.camera.position.clone(), ed.scene);
    camera.setTarget(ed.camera.target);
    const start = camera.position.clone();
    const baseline = snapshot(ed, 'AR').json;
    const ar = new ARMode(ed);
    ed.setARMode(true); ar.wrapScene(); ar.active = true; ar.anchor.setEnabled(true);
    ed.scene.activeCamera = camera;
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const settle = async () => {
      ed.invalidate(8000); await wait(300);
      const deadline = performance.now() + 5000;
      while (!mesh._isDepthSortSettled && performance.now() < deadline) await wait(20);
      await new Promise(requestAnimationFrame);
    };
    await settle();
    const phase = async (reuse, rotation = false) => {
      mesh.reuseTranslationSorts = reuse; await settle();
      const begin = window.sortPosts, times = []; let previous = performance.now();
      for (let i = 0; i < 45; i++) {
        if (rotation) camera.rotation.y += .003;
        else camera.position.x += .002;
        await new Promise(requestAnimationFrame);
        const now = performance.now(); times.push(now-previous); previous = now;
      }
      await settle();
      return { posts: window.sortPosts-begin, meanMs: +(times.reduce((a,b)=>a+b)/times.length).toFixed(2) };
    };
    const before = await phase(false);
    const pixels = () => {
      const canvas = document.createElement('canvas'), source = ed.engine.getRenderingCanvas();
      canvas.width = source.width; canvas.height = source.height;
      const context = canvas.getContext('2d'); context.drawImage(source, 0, 0);
      return context.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const originalPixels = pixels();
    camera.position.copyFrom(start); await settle();
    const after = await phase(true);
    const optimizedPixels = pixels();
    let difference = 0;
    for (let i = 0; i < originalPixels.length; i++) difference += Math.abs(originalPixels[i] - optimizedPixels[i]);
    difference /= originalPixels.length;
    if (difference > 0.5) throw new Error(`Translation reuse changed rendered pixels: ${difference}`);
    const rotation = await phase(true, true);
    if (before.posts < 10 || after.posts !== 0 || rotation.posts < 10) throw new Error(`Unexpected sort work ${JSON.stringify({before,after,rotation})}`);
    const transformStart = window.sortPosts;
    const { Quaternion } = await import('/node_modules/@babylonjs/core/Maths/math.vector.js');
    const originalRotation = mesh.rotationQuaternion?.clone() ?? null;
    mesh.rotationQuaternion = Quaternion.RotationYawPitchRoll(.2, .1, .05);
    await settle();
    if (window.sortPosts === transformStart) throw new Error('Object transform did not invalidate sorting');
    mesh.rotationQuaternion = originalRotation;
    const nextCamera = new FreeCamera('Second XR view', camera.position.clone(), ed.scene);
    nextCamera.setTarget(camera.getTarget()); ed.scene.activeCamera = nextCamera; await settle();
    if (!mesh._cameraViewInfos.get(nextCamera.uniqueId)?.sortAppliedId) throw new Error('New XR camera did not receive an initial sort');
    ed.scene.activeCamera = camera; nextCamera.dispose(); await settle();
    const originalDegree = mesh.shDegree, originalMaterial = mesh.material, originalMin = originalMaterial.minPixelSize;
    const { ARHud } = await import('/src/ar/arHud.ts');
    const hud = new ARHud(ar);
    hud.el.querySelector('button[title="AR options"]').click();
    const toggle = [...hud.el.querySelectorAll('label')].find(e => e.textContent === 'Faster splats')?.querySelector('input');
    if (!toggle) throw new Error('AR performance control is missing');
    toggle.checked = true; toggle.dispatchEvent(new Event('change', { bubbles: true }));
    if (!ar.splatPerformance) throw new Error('AR performance control did not apply');
    ar.setSplatPerformance(false);
    hud.el.remove();
    ar.setSplatPerformance(true);
    if (mesh.shDegree !== 0 || mesh.material.minPixelSize < 2) throw new Error('Performance mode did not apply');
    ar.depthSupported = true; ar.depth = { attach: () => true, detach() {} };
    ar.setOcclusion(true);
    if (mesh.material === originalMaterial || mesh.material.minPixelSize < 2) throw new Error('Occlusion lost performance settings');
    ar.setSplatPerformance(false);
    if (mesh.shDegree !== originalDegree || mesh.material.minPixelSize !== originalMin || originalMaterial.minPixelSize !== originalMin) throw new Error('Performance mode restoration failed with occlusion enabled');
    ar.setSplatPerformance(true); ar.setOcclusion(false);
    if (mesh.material !== originalMaterial || mesh.material.minPixelSize < 2) throw new Error('Disabling depth lost the active performance mode');
    ar.setSplatPerformance(false);
    if (mesh.material.minPixelSize !== originalMin || mesh.shDegree !== originalDegree) throw new Error('Depth-first toggle order did not restore quality');
    ar.setSplatPerformance(true); ar.cleanup();
    ed.scene.activeCamera = ed.camera; camera.dispose();
    if (ar.splatPerformance || mesh.material !== originalMaterial || mesh.shDegree !== originalDegree || originalMaterial.minPixelSize !== originalMin) throw new Error('Exit changed Gaussian quality');
    const final = snapshot(ed, 'AR').json;
    if (JSON.stringify(baseline.entities) !== JSON.stringify(final.entities) || JSON.stringify(baseline.env) !== JSON.stringify(final.env)) throw new Error('AR performance settings changed the project');
    return { splats: mesh.getTotalVertices(), before, after, rotation, meanPixelDifference: +difference.toFixed(4), qualityRestored: true };
  });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
