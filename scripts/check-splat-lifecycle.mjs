// Real IndexedDB autosave/reopen, selection and movement regression in an isolated profile.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.BABALON_PLAYWRIGHT_PATH ? pathToFileURL(process.env.BABALON_PLAYWRIGHT_PATH).href : 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: process.env.BABALON_TEST_PHONE ? { width: 375, height: 812 } : { width: 640, height: 480 } });
  page.on('console', m => { if (m.text().startsWith('LIFECYCLE ')) console.log(m.text()); });
  await page.addInitScript(() => {
    const Original = Worker;
    window.workerStats = { alive: 0, created: 0, sorts: 0, posts: {} };
    window.Worker = class extends Original {
      constructor(...args) { super(...args); this.alive = true; window.workerStats.alive++; window.workerStats.created++; this.addEventListener('message', e => { if (e.data.command === 'sorted') window.workerStats.resultFrame = window.editor?.scene.getFrameId(); }); }
      postMessage(data, ...rest) { if (data?.command === 'sort') { window.workerStats.sorts++; const key = data.cameraId; window.workerStats.posts[key] = (window.workerStats.posts[key] ?? 0) + 1; if (window.workerStats.delay) { const delay = window.workerStats.delay; window.workerStats.delay = 0; setTimeout(() => super.postMessage(data, ...rest), delay); return; } } return super.postMessage(data, ...rest); }
      terminate() { if (this.alive) { this.alive = false; window.workerStats.alive--; } return super.terminate(); }
    };
  });
  await page.goto(process.env.BABALON_TEST_URL ?? 'http://localhost:5174/');
  await page.waitForFunction(() => window.ui && window.editor);
  assert.ok(process.env.BABALON_TEST_SPZ, 'Set BABALON_TEST_SPZ to the real scan');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose files', exact: true }).click();
  await (await chooser).setFiles(process.env.BABALON_TEST_SPZ);
  await page.waitForFunction(() => window.editor.entities.some(e => e.kind === 'model'), null, { timeout: 60000 });
  const results = await page.evaluate(async () => {
    const ed = window.editor, ui = window.ui;
    clearTimeout(ui.autosaveTimer); ui.autosaveTimer = 0;
    const { loadProject } = await import('/src/core/project.ts');
    const mesh = () => ed.entities.flatMap(e => e.meshes).find(m => m.getClassName().includes('GaussianSplatting'));
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const settle = async () => { ed.invalidate(4000); await sleep(1500); };
    const state = () => ({ ...window.workerStats, posts: { ...window.workerStats.posts }, meshes: ed.scene.meshes.length, textures: ed.engine._internalTexturesCache.length, cameraObservers: ed.scene.onCameraRemovedObservable.observers.length, views: mesh()._cameraViewInfos.size, alpha: mesh().material.alpha, compensation: mesh().material.compensation, kernelSize: mesh().material.kernelSize, degree: mesh().shDegree, sourceEnabled: mesh().source?.isEnabled() });
    const orbit = async () => {
      const times = []; let last = performance.now();
      const beginSorts = window.workerStats.sorts;
      for (let i = 0; i < 60; i++) {
        ed.camera.alpha += Math.PI / 60;
        ed.invalidate(); await new Promise(requestAnimationFrame);
        const now = performance.now(); times.push(now - last); last = now;
      }
      return { mean: Math.round(times.reduce((a,b) => a+b) / times.length), max: Math.round(Math.max(...times)), sorts: window.workerStats.sorts - beginSorts };
    };
    const move = async () => {
      const entity = ed.entities.find(e => e.kind === 'model');
      ed.select(entity); ed.setTool('move'); await ed.gizmoLoad;
      if (!mesh().showBoundingBox || ed.outline.hasMesh(mesh())) throw new Error('Splat selection uses the incompatible generic outline');
      ed.photoMode = true; ed.applyCleanView();
      if (mesh().showBoundingBox) throw new Error('Selection bounds leaked into clean view');
      ed.photoMode = false; ed.applyCleanView();
      ed.beginTransform(); ed.startFollow();
      const times = []; let last = performance.now();
      for (let i = 0; i < 60; i++) {
        const position = entity.root.position.clone(); position.x += 0.005;
        ed.moveTo(entity, position, { x: true, y: false, z: false });
        await new Promise(requestAnimationFrame);
        const now = performance.now(); times.push(now - last); last = now;
      }
      ed.endTransform();
      return { mean: Math.round(times.reduce((a,b) => a+b) / times.length), max: Math.round(Math.max(...times)), x: entity.root.position.x };
    };
    const runs = [];
    await settle();
    runs.push({ stage: 'import', ...state(), orbit: await orbit() });
    for (let i = 0; i < 3; i++) {
      ui.lastThumbnail = -Infinity;
      const start = performance.now(); await ui.autosaveNow(); const saveMs = Math.round(performance.now() - start);
      await settle();
      runs.push({ stage: `autosave${i}`, saveMs, ...state(), orbit: await orbit() });
      const snap = await loadProject(ui.projectId);
      await ui.loadSnapshot(snap, ui.projectId); clearTimeout(ui.autosaveTimer);
      await settle();
      runs.push({ stage: `reopen${i}`, ...state(), orbit: await orbit(), move: await move() });
      console.log('LIFECYCLE ' + JSON.stringify(runs.slice(-2)));
    }
    clearTimeout(ui.autosaveTimer); await sleep(2000);
    window.workerStats.delay = 1800;
    ed.camera.alpha += 0.3; ed.invalidate();
    await sleep(3000);
    if (ed.scene.getFrameId() <= window.workerStats.resultFrame) throw new Error('Late sort result did not wake the idle renderer');
    console.log('LIFECYCLE ' + JSON.stringify({ lateSortRendered: true, resultFrame: window.workerStats.resultFrame, renderedFrame: ed.scene.getFrameId() }));
    return runs;
  });
  const baseline = results[0];
  for (const run of results) {
    assert.equal(run.textures, baseline.textures, `GPU texture leak after ${run.stage}`);
    assert.equal(run.cameraObservers, baseline.cameraObservers, `Camera observer leak after ${run.stage}`);
    assert.equal(run.alive, baseline.alive, `Worker leak after ${run.stage}`);
    if (run.move) assert.ok(run.move.mean < 50, `Movement stalled after ${run.stage}: ${run.move.mean} ms/frame`);
  }
  console.log(JSON.stringify(results));
} finally { await browser.close(); }
