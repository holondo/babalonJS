import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const require = createRequire(resolve('package.json'));
const { createServer } = await import(pathToFileURL(require.resolve('vite')));
let playwright;
try { playwright = require('playwright'); }
catch {
  assert.ok(process.env.PLAYWRIGHT_MODULE, 'Install Playwright or set PLAYWRIGHT_MODULE');
  playwright = require(process.env.PLAYWRIGHT_MODULE);
}
const { chromium } = playwright;
const out = process.env.ANATOMY_SCREENSHOTS;
if (out) await mkdir(out, { recursive: true });
assert.ok(process.argv[2], 'Pass an exported fitted anatomy document or regional snapshot');
const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
const doc = input.target && input.parameters ? input.parameters : input;
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false } });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 850 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(
    'http://127.0.0.1:' + server.httpServer.address().port + '/scripts/fixtures/anatomy-priority.html',
    { timeout: 120000 },
  );
  await page.waitForFunction(() => window.anatomyTest);
  await page.evaluate(async (doc) => {
    const { editor } = anatomyTest,
      entity = await editor.addAnatomy(),
      body = entity.anatomyBody;
    window.testFit = { entity, body, doc };
    body.importParameters(doc);
    await body.ready();
    document.body.classList.add('ui-hidden');
    document.querySelector('#test')?.remove();
    document.querySelector('#result')?.remove();
    editor.select(null);
  }, doc);
  const evidence = [];
  {
    await page.evaluate(async () => {
      const { body, doc } = testFit;
      body.importParameters(doc);
      await body.ready();

      body.patch({
        skinOpacity: 1,
        otherMusclesOpacity: 1,
        rectusAbdominisOpacity: 1,
        externalObliqueOpacity: 1,
        bonesOpacity: 0,
        adiposeOpacity: 0,
      });
      await body.ready();
      testFit.fit = JSON.stringify([
        body.parameters.skinFit,
        body.parameters.referencePose,
        body.parameters.definition,
      ]);

      testFit.base = null;
      testFit.ribs = null;
    });
    for (const angle of [0, 15, 30, 15, 0]) {
      const metrics = await page.evaluate(async (angle) => {
        const { body, entity } = testFit;
        const { signedMeshVolume } = await import('/src/anatomy/algorithms/loft.ts');
        body.editPose('rightArmAbduction', angle);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const capture = () => {
          let volume = 0;
          const groups = {};
          for (const m of entity.meshes) {
            const name = m.metadata?.anatomicalName ?? '';
            if (
              !/^(pectoralis_major_|deltoid|latissimus_dorsi_|trapezius_|levator_scapulae_|teres_|subscapularis_|supraspinatus_|infraspinatus_|subclavius_|sternocleidomastoid_)/.test(
                name,
              )
            )
              continue;
            const p = m.getVerticesData('position'),
              v = Math.abs(signedMeshVolume({ positions: p, indices: Uint32Array.from(m.getIndices()) }));
            groups[name] = (groups[name] ?? 0) + v;
            volume += v;
          }
          return { volume, groups };
        };
        const preview = capture();
        body.commit();
        await body.ready();
        const released = capture();
        const skin = entity.meshes
          .find((m) => m.metadata?.anatomyLayer === 'skin')
          .getVerticesData('position');
        testFit.base ??= Array.from(skin);
        const ribs = entity.meshes.filter((mesh) =>
          /^(rib_|costal_cartilage_|sternum$)/.test(mesh.metadata?.anatomicalName ?? ''),
        );
        testFit.ribs ??= ribs.map((mesh) => Array.from(mesh.getVerticesData('position')));
        const ribsFixed = ribs.every((mesh, index) =>
          mesh.getVerticesData('position').every((value, vertex) => value === testFit.ribs[index][vertex]),
        );
        const { SurfaceBVH } = await import('/src/anatomy/inference/observationProxy.ts');
        const skinMesh = entity.meshes.find((m) => m.metadata?.anatomyLayer === 'skin');
        const bvh = new SurfaceBVH({
          positions: Float32Array.from(skin),
          indices: Uint32Array.from(skinMesh.getIndices()),
        });
        const { foldViewDepth, foldViews } = await import('/src/anatomy/foldFaceContact.ts');
        const sign = Math.sign(bvh.queryClosestPoint([0, 1.3, 0.4]).normal[2]) || 1;
        const exposed = {};
        const outside = (q, clearance = 0.002) => {
          if (q[0] < 0.03 || q[0] > 0.34 || q[1] < 1.0 || q[1] > 1.7) return false;
          const h = bvh.queryClosestPoint(q);
          return (
            sign * h.normal.reduce((sum, n, k) => sum + n * (q[k] - h.point[k]), 0) > clearance &&
            foldViews.some((view) => foldViewDepth(bvh, q, view) > 0.0004)
          );
        };
        for (const m of entity.meshes) {
          const name = m.metadata?.anatomicalName ?? '';
          if (
            !/^(externalOblique_|internalOblique_|transversusAbdominis_|pectoralis_major_|deltoid|latissimus_dorsi_|teres_|subclavius_|serratus_anterior_|levator_|sternocleidomastoid_|trapezius_|subscapularis_|supraspinatus_|infraspinatus_)/.test(
              name,
            )
          )
            continue;
          const xyz = m.getVerticesData('position'),
            indices = m.getIndices();
          const clearance = /^(externalOblique_|internalOblique_|transversusAbdominis_)/.test(name)
            ? 0.0005
            : 0.002;
          const samples = [];
          for (let i = 0; i < xyz.length; i += 3)
            if (outside(Array.from(xyz.slice(i, i + 3)), clearance)) samples.push('vertex:' + i / 3);
          for (let i = 0; i < indices.length; i += 3) {
            const face = [indices[i], indices[i + 1], indices[i + 2]];
            for (const weights of [
              [1 / 3, 1 / 3, 1 / 3],
              [0.5, 0.5, 0],
              [0.5, 0, 0.5],
              [0, 0.5, 0.5],
            ]) {
              const q = [0, 0, 0];
              for (let v = 0; v < 3; v++)
                for (let axis = 0; axis < 3; axis++) q[axis] += weights[v] * xyz[face[v] * 3 + axis];
              if (outside(q, clearance)) {
                samples.push('face:' + i / 3);
                break;
              }
            }
          }
          if (samples.length) exposed[name] = samples;
        }
        return {
          angle,
          preview,
          released,
          exposed,
          ribCount: ribs.length,
          ribsFixed,
          pose: body.pose.rightArmAbduction,
          reference: body.parameters.referencePose.enabled,
          fitUnchanged:
            testFit.fit ===
            JSON.stringify([
              body.parameters.skinFit,
              body.parameters.referencePose,
              body.parameters.definition,
            ]),
          resetExact: angle === 0 && testFit.base.every((v, i) => v === skin[i]),
        };
      }, angle);
      evidence.push(metrics);
      assert.equal(metrics.reference, true);
      assert.equal(metrics.fitUnchanged, true);
      assert.equal(metrics.pose, angle);
      assert.ok(metrics.ribCount > 0);
      assert.equal(metrics.ribsFixed, true);
      assert.deepEqual(metrics.preview, metrics.released);
      if (angle === 0) assert.equal(metrics.resetExact, true);
      for (const [name, samples] of Object.entries(metrics.exposed)) {
        const original = new Set(evidence[0].exposed[name] ?? []);
        assert.deepEqual(
          samples.filter((sample) => !original.has(sample)),
          [],
          name + ' has new exposed samples',
        );
      }
      const baseline = evidence[0].released.groups;
      for (const [name, volume] of Object.entries(metrics.released.groups))
        assert.ok(Math.abs(volume / baseline[name] - 1) < 0.001, name + ' volume drift');
      if (angle === 30) {
        const reopened = await page.evaluate(async () => {
          const { body } = testFit,
            document = body.exportParameters(),
            before = JSON.stringify(body.pose),
            fit = JSON.stringify(body.parameters.skinFit);
          body.importParameters(document);
          await body.ready();
          return {
            poseSame: before === JSON.stringify(body.pose),
            fitSame: fit === JSON.stringify(body.parameters.skinFit),
            basis: body.state.poseBasis,
          };
        });
        assert.equal(reopened.poseSame, true);
        assert.equal(reopened.fitSame, true);
        assert.equal(reopened.basis, 'fitted');
      }

      if ((angle !== 30 && angle !== 0) || !out) continue;
      const stage = angle === 30 ? 'raised' : evidence.length === 1 ? 'rest' : 'returned';
      for (const view of ['front', 'three', 'side'])
        for (const skin of [true, false]) {
          await page.evaluate(
            async ({ view, skin }) => {
              const { body } = testFit;
              body.patch({ skinOpacity: skin ? 1 : 0 });
              await body.ready();
              body.frame('torso');
              body.view(view);
              anatomyTest.editor.scene.render();
            },
            { view, skin },
          );
          await page.screenshot({ path: out + '/' + stage + '-' + view + '-' + skin + '.png' });
        }
    }
  }
  await page.evaluate(() => {
    document.body.classList.remove('ui-hidden');
    const { editor, ui } = anatomyTest;
    editor.select(testFit.entity);
    ui.openPart('objects', 'anatomy-pose');
  });
  await page.getByLabel('Joint', { exact: true }).selectOption('arm1-0');
  await page.waitForFunction(() => !!document.querySelector('input[aria-label="Right arm abduction"]'));
  const slider = page.getByRole('slider', { name: 'Right arm abduction', exact: true });
  await slider.fill('15');
  await slider.dispatchEvent('input');
  await slider.dispatchEvent('change');
  await page.waitForFunction(() => testFit.body.pose.rightArmAbduction === 15);
  await page.evaluate(() => testFit.body.commit());
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 375, height: 812 },
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(200);
    const layout = await page.evaluate(() => ({
      overflow: anatomyTest.ui.panel.scrollWidth > anatomyTest.ui.panel.clientWidth + 1,
      fit: testFit.body.parameters.referencePose.enabled,
    }));
    assert.equal(layout.overflow, false);
    assert.equal(layout.fit, true);
  }
  const project = await page.evaluate(async () => {
    const { snapshot, toZip, fromZip, restore } = await import('/src/core/project.ts');
    const { editor } = anatomyTest;
    const before = JSON.stringify(testFit.body.exportParameters().parameters);
    const saved = snapshot(editor, 'Fitted pose regression');
    const missing = await restore(editor, await fromZip(await toZip(saved)));
    const body = editor.entities.find((entity) => entity.anatomyBody).anatomyBody;
    await body.ready();
    return {
      missing,
      pose: body.pose.rightArmAbduction,
      basis: body.state.poseBasis,
      sameFit: before === JSON.stringify(body.exportParameters().parameters),
    };
  });
  assert.deepEqual(project.missing, []);
  assert.equal(project.pose, 15);
  assert.equal(project.basis, 'fitted');
  assert.equal(project.sameFit, true);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      pass: true,
      angles: evidence.map((r) => r.angle),
      previewMatchesRelease: true,
      fitPreserved: true,
      exactReturn: true,
      roundTrip: true,
      projectRoundTrip: true,
      volumeTolerancePercent: 0.1,
      noNewSampledShoulderCrossings: true,
    }),
  );
} finally {
  await browser.close();
  await server.close();
}
