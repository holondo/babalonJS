// Run against a dev server. PLAYWRIGHT_MODULE may point to the bundled package.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(process.env.PLAYWRIGHT_MODULE); }
const browser = await playwright.chromium.launch({ headless: true, channel: 'chrome' });
try {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 812 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.argv[2] ?? 'http://127.0.0.1:5198', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForFunction(() => window.editor, undefined, { timeout: 90000 });
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('button', { name: 'Anatomy algorithm demo', exact: true }).click();
    await page.waitForFunction(() => window.editor.entities.some(e => e.name === 'Anatomy algorithm demo'));
    const result = await page.evaluate(async () => {
      const editor = window.editor;
      const check = (value, message) => { if (!value) throw Error(message); };
      const entity = editor.selected;
      check(entity?.name === 'Anatomy algorithm demo', 'Demo selected');
      const meshes = entity.meshes.filter(m => m.getTotalVertices() > 0);
      check(meshes.length === 4, 'Three bones and one muscle imported');
      check(meshes.every(m => m.getVerticesData('position').every(Number.isFinite)), 'Finite positions');
      await Promise.all(meshes.map(m => m.material.forceCompilationAsync(m)));
      editor.scene.render();
      const triangles = meshes.reduce((sum, m) => sum + m.getTotalIndices() / 3, 0);
      check(triangles > 1000, 'Generated muscle geometry');
      editor.undo();
      check(!editor.entities.includes(entity), 'Undo addition');
      editor.redo();
      check(editor.entities.includes(entity), 'Redo addition');
      const { snapshot, toZip, fromZip, restore } = await import('/src/core/project.ts');
      const file = await toZip(snapshot(editor, 'Anatomy demo check'));
      const saved = await fromZip(file);
      const warnings = await restore(editor, saved);
      check(warnings.length === 0, `Restore warnings: ${warnings}`);
      const restored = editor.entities.find(e => e.name === 'Anatomy algorithm demo');
      check(restored?.meshes.filter(m => m.getTotalVertices() > 0).length === 4, 'Project restores all structures');
      const glb = await editor.exportGLB(false);
      check(glb.size > 1000, 'Re-export GLB');
      return { meshes: meshes.length, triangles, projectBytes: file.size, exportBytes: glb.size };
    });
    assert.deepEqual(errors, []);
    if (process.env.ANATOMY_SCREENSHOTS) {
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await page.locator('body').evaluate(body => body.classList.contains('panel-open') ? Promise.reject(Error('Panel did not close')) : undefined);
      await page.screenshot({ path: `${process.env.ANATOMY_SCREENSHOTS}/anatomy-demo-${viewport.width}.png` });
    }
    console.log(JSON.stringify({ status: 'PASS', viewport, ...result }));
    await page.close();
  }
} finally {
  await browser.close();
}
