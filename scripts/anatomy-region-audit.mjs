import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { compareSections, heights, sectionSvg } from './anatomy-reference/sections.mjs';

const [mode, input, output, candidate] = process.argv.slice(2);
assert.ok(input && output && (mode === 'capture' && !candidate || mode === 'replay'),
  'Usage: node scripts/anatomy-region-audit.mjs capture <model.glb> <output-dir>\n' +
  '       node scripts/anatomy-region-audit.mjs replay <snapshot.json> <output-dir> [candidate.json]');
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const saved = mode === 'replay' ? await readJson(input) : undefined;
if (saved) {
  assert.equal(saved.version, 1, 'Unsupported regional snapshot version');
  assert.deepEqual(saved.heights, heights, 'Snapshot stations differ. Capture a fresh baseline.');
  assert.ok(saved.target.length === heights.length && saved.target.every(row =>
    Array.isArray(row) && row.length % 4 === 0 && row.every(Number.isFinite)), 'Invalid target sections');
}
const parameters = candidate ? await readJson(candidate) : saved?.parameters;
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
// Parallel captures must not compete to replace Vite's optimized dependency cache.
const cacheDir = await mkdtemp(join(root, 'node_modules', '.vite-anatomy-audit-'));
let server;
let browser;
try {
  server = await createServer({ root, cacheDir, server: { host: '127.0.0.1', port: 0, hmr: false } });
  await server.listen();
  const { port } = server.httpServer.address();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/scripts/fixtures/anatomy-priority.html`, { timeout: 90000 });
  await page.waitForFunction(() => window.anatomyTest);
  await page.evaluate(async () => {
    const { editor, ui } = window.anatomyTest;
    const entity = await editor.addAnatomy();
    editor.select(entity);
    ui.openPart('objects', 'anatomy-fit');
    window.regionAudit = { entity, body: entity.anatomyBody };
  });
  let baseline = saved;
  let fitMs;
  let stageMs;
  if (mode === 'capture') {
    await page.exposeFunction('reportRegionalFitStage', stage => process.stderr.write(`Fitting: ${stage}\n`));
    await page.getByRole('tab', { name: 'From a model', exact: true }).click();
    await page.locator('input[type=file][accept=".glb"]').setInputFiles(resolve(input));
    await page.waitForFunction(() => anatomyTest.editor.entities.some(e => !e.anatomy && e.kind === 'model'));
    await page.evaluate(() => {
      const audit = window.regionAudit;
      const adapt = audit.body.adaptToTargetMesh.bind(audit.body);
      audit.body.adaptToTargetMesh = async options => {
        audit.started ??= performance.now();
        audit.source = options.mesh;
        try {
          const result = await adapt({ ...options, onProgress: (stage, fraction) => {
            options.onProgress?.(stage, fraction);
            if (stage !== audit.stage) {
              audit.stage = stage;
              (audit.stages ??= []).push({ stage, at: performance.now() - audit.started });
              void window.reportRegionalFitStage(stage);
            }
          } });
          if (options.autoRefine || options.softOnly) audit.fitMs = performance.now() - audit.started;
          return result;
        } catch (error) {
          audit.error = error.message;
          throw error;
        }
      };
    });
    await page.getByLabel('What covers the body?', { exact: true }).selectOption('skin', { force: true });
    await page.getByRole('button', { name: 'Fit only', exact: true }).click();
    await page.waitForFunction(() => regionAudit.fitMs || regionAudit.error, {}, { timeout: 600000 });
    baseline = await page.evaluate(async heights => {
      const { body, source, error } = window.regionAudit;
      if (error) throw Error(error);
      if (!body.fitEvidence.volumeFit || body.skinDrive?.bound) throw Error('Expected a refined Fit only result.');
      const analysis = body.poseObservation?.observation.analysis;
      if (!analysis) throw Error('The fit did not retain its aligned observation.');
      const { sourcePointToCanonical } = await import('/src/anatomy/binding/anatomySkinDrive.ts');
      const { sections } = await import('/scripts/anatomy-reference/sections.mjs');
      const frame = { yaw: analysis.yawCorrection, forwardSign: analysis.forwardSign, zUp: analysis.zUp,
        scale: analysis.scaleCorrection, offset: analysis.offsetCorrection };
      const raw = source.skeleton ? source.getPositionData(true, true) : source.getVerticesData('position');
      const positions = new Float32Array(raw.length);
      for (let i = 0; i < raw.length; i += 3) {
        positions.set(sourcePointToCanonical(frame, raw[i], raw[i + 1], raw[i + 2]), i);
      }
      return { version: 1, heights, target: sections(positions, source.getIndices(), heights),
        parameters: body.exportParameters(), evidence: {
          abdominal: body.fitEvidence.volumeFit.abdominalValidation,
          divisions: body.fitEvidence.volumeFit.rectusDivisions,
          wholeBodySkin: body.fitEvidence.volumeFit.skin,
          abdominalCovering: body.fitEvidence.volumeFit.abdominalCovering,
          abdominalDetails: body.fitEvidence.volumeFit.abdominalDetails,
          pectoralSkin: body.fitEvidence.volumeFit.pectoralSkin,
        } };
    }, heights);
    fitMs = Math.round(await page.evaluate(() => regionAudit.fitMs));
    // Time spent in each reported stage, merged across the fit and the automatic refinement.
    stageMs = await page.evaluate(() => {
      const { stages = [], fitMs } = regionAudit, totals = {};
      stages.forEach(({ stage, at }, i) => {
        totals[stage] = Math.round((totals[stage] ?? 0) + (stages[i + 1]?.at ?? fitMs) - at);
      });
      return totals;
    });
  }

  const result = await page.evaluate(async ({ heights, target, parameters, baselineEvidence, withAxilla }) => {
    const { sections, compareSections, sectionSvg } = await import('/scripts/anatomy-reference/sections.mjs');
    const { entity, body } = window.regionAudit;
    const layers = ['skin', 'adipose', 'bones', 'rectusAbdominis', 'externalOblique', 'internalOblique',
      'transversusAbdominis', 'aponeuroses', 'inguinalLigaments'];
    if (parameters) body.importParameters(parameters);
    const scale = 180 / body.parameters.height;
    const enabled = Object.fromEntries(layers.map(layer => [layer + 'Opacity', 1]));
    const scan = async patch => {
      const start = performance.now();
      body.patch(patch);
      await body.ready();
      const regenerationMs = Math.round(performance.now() - start);
      const measurementStart = performance.now();
      const cuts = Object.fromEntries(layers.map(layer => [layer, heights.map(() => [])]));
      for (const mesh of entity.meshes) {
        const layer = mesh.metadata?.anatomyLayer;
        if (!Object.hasOwn(cuts, layer)) continue;
        const positions = Float32Array.from(mesh.getVerticesData('position'), value => value * scale);
        sections(positions, mesh.getIndices(), heights).forEach((row, i) => {
          for (const value of row) cuts[layer][i].push(value);
        });
      }
      const muscleLayers = ['rectusAbdominis', 'externalOblique', 'internalOblique', 'transversusAbdominis'];
      const muscleCuts = heights.map((_, i) => muscleLayers.flatMap(layer => cuts[layer][i]));
      const metrics = compareSections(target, cuts.skin, muscleCuts);
      const worst = Object.fromEntries(layers.map(layer => [layer, cuts[layer][metrics.worst.index]]));
      return { metrics, regenerationMs, measurementMs: Math.round(performance.now() - measurementStart),
        attachments: body.attachmentMetrics.filter(item => /inguinal|rectus|oblique/i.test(item.id)),
        contacts: body.contactMetrics, svg: sectionSvg(target[metrics.worst.index], worst, metrics.worst) };
    };
    const final = await scan(withAxilla ? { ...enabled, otherMusclesOpacity: 1 } : enabled);
    let axilla, foldFaces;
    if (withAxilla) {
      const { SurfaceBVH } = await import('/src/anatomy/inference/observationProxy.ts');
      const { denseFoldFaceSamples, foldViews, foldViewDepth, inFoldContactBand } = await import('/src/anatomy/foldFaceContact.ts');
      const { bentElbowBand, bentElbowMuscle } = await import('/src/anatomy/axillaryContact.ts');
      const { auditFoldFaces } = await import('/scripts/anatomy-reference/foldContact.mjs');
      const skin = entity.meshes.find(mesh => mesh.metadata?.anatomyLayer === 'skin');
      const posed = mesh => Float32Array.from(mesh.getVerticesData('position'), value => value * scale);
      const bvh = new SurfaceBVH({ positions: posed(skin), indices: skin.getIndices() });
      const authored = mesh => Float32Array.from(mesh.getVerticesData('position'),
        (value, index) => value * (index % 3 === 1 ? 1750 / body.parameters.height : 10));
      const foldCovering = new SurfaceBVH({ positions: authored(skin), indices: skin.getIndices() });
      const exposure = point => foldViews.map(view => foldViewDepth(foldCovering, point, view));
      const orientation = Math.sign(bvh.queryClosestPoint([0, 1.30, .4]).normal[2]) || 1;
      const elbowBand = bentElbowBand(body.parameters);
      axilla = {};
      foldFaces = {};
      for (const mesh of entity.meshes) {
        const name = mesh.metadata?.anatomicalName ?? '';
        const group = /^(pectoralis_major|latissimus_dorsi|teres_major|serratus_anterior|(?:external|internal)_intercostals|deltoid|triceps_brachii)/.exec(name)?.[1];
        if (group || /^trapezius_descending_/.test(name)) {
          const faces = auditFoldFaces(authored(mesh), mesh.getIndices(), denseFoldFaceSamples, inFoldContactBand, exposure);
          if (faces.faces) foldFaces[name] = faces;
        }
        if (!group && !bentElbowMuscle.test(name)) continue;
        const vertices = posed(mesh);
        for (let i = 0; i < vertices.length; i += 3) {
          const point = Array.from(vertices.subarray(i, i + 3)), [x, y] = point;
          const bands = [];
          if (group && Math.abs(x) >= .135 && Math.abs(x) <= .375 && y >= 1.188 && y <= 1.486) bands.push(group);
          if (bentElbowMuscle.test(name) && elbowBand(...point) > .5)
            bands.push('elbow:' + name);
          if (!bands.length) continue;
          const hit = bvh.queryClosestPoint(point);
          const depth = orientation * hit.normal.reduce((sum, n, k) => sum + n * (point[k] - hit.point[k]), 0) * 1000;
          for (const band of bands) {
            const count = axilla[band] ??= { samples: 0, outside2mm: 0, maxMm: 0 };
            count.samples++;
            if (depth > 2) count.outside2mm++;
            count.maxMm = Math.max(count.maxMm, Math.round(depth * 10) / 10);
          }
        }
      }
    }
    const procedural = await scan({ skinFit: undefined });
    return { final, procedural, baselineEvidence, axilla, foldFaces };
  }, { heights, target: baseline.target, parameters, baselineEvidence: baseline.evidence, withAxilla: !!process.env.AXILLA_AUDIT });
  assert.deepEqual(errors, []);
  await mkdir(output, { recursive: true });
  if (mode === 'capture') {
    await writeFile(join(output, 'snapshot.json'), JSON.stringify(baseline));
  }
  for (const key of ['final', 'procedural']) {
    const { svg } = result[key];
    await writeFile(join(output, `worst-${key}.svg`), svg);
    delete result[key].svg;
  }
  const report = { mode, input, candidate, fitMs, stageMs, ...result };
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ mode, fitMs, stageMs, final: result.final.metrics, procedural: result.procedural.metrics,
    replayMs: result.final.regenerationMs + result.procedural.regenerationMs, output: resolve(output) }));
} finally {
  try {
    try { await browser?.close(); } finally { await server?.close(); }
  } finally {
    await rm(cacheDir, { recursive: true, force: true, maxRetries: 3 });
  }
}
