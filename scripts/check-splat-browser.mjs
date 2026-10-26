// Run against a fresh Vite port. Optional: BABALON_TEST_SPZ=/absolute/model.spz.
// Set BABALON_PLAYWRIGHT_PATH when Playwright is provided by an external runtime.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.BABALON_PLAYWRIGHT_PATH ? pathToFileURL(process.env.BABALON_PLAYWRIGHT_PATH).href : 'playwright');
const browser = await chromium.launch({ headless: true, channel: process.env.BABALON_BROWSER_CHANNEL ?? 'chrome' });
try {
  const viewport = process.env.BABALON_TEST_PHONE ? { width: 375, height: 812 } : { width: 1280, height: 900 };
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(process.env.BABALON_TEST_URL ?? 'http://localhost:5174/');
  await page.waitForFunction(() => !!window.editor && !!window.ui);
  await page.evaluate(() => { window.ui.scheduleAutosave = () => {}; });
  if (process.env.BABALON_TEST_SPZ) {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Choose files', exact: true }).click();
    await (await chooser).setFiles(process.env.BABALON_TEST_SPZ);
    await page.waitForFunction(() => window.editor.entities.some(e => e.kind === 'model'), null, { timeout: 60000 });
  } else {
    await page.evaluate(async () => {
      const data = new ArrayBuffer(64), f = new Float32Array(data), b = new Uint8Array(data);
      for (let i = 0; i < 2; i++) {
        f.set([i * 0.5 - 0.2, 0.5, 0.3, 0.1, 0.15, 0.3], i * 8);
        b.set([255, 180, 80, 255, 255, 128, 128, 128], i * 32 + 24);
      }
      await window.editor.addFiles([new File([data], 'regression.splat')]);
    });
  }
  page.setDefaultTimeout(120000);
  const result = await page.evaluate(async () => {
    const { snapshot, restore, toZip, fromZip } = await import('/src/core/project.ts');
    const { materialToJSON } = await import('/src/core/state.ts');
    const { worldMatrix } = await import('/src/rigging/humanoid.ts');
    const { analyzeEntity } = await import('/src/optimize/analysis.ts');
    const ed = window.editor;
    const splat = () => ed.entities.flatMap(e => e.meshes).find(m => m.getClassName().includes('GaussianSplatting'));
    const m = splat();
    const ui = window.ui;
    ui.segment.objects = 'material'; ui.openTab('objects');
    const kernelControl = [...ui.panel.querySelectorAll('.slider')].find(e => e.querySelector('label')?.textContent === 'Kernel size')?.querySelector('input');
    if (!kernelControl) throw new Error('Gaussian material controls missing');
    const initialKernel = m.material.kernelSize;
    kernelControl.value = '0.47'; kernelControl.dispatchEvent(new Event('input', {bubbles:true})); kernelControl.dispatchEvent(new Event('change',{bubbles:true}));
    if (m.material.kernelSize !== 0.47) throw new Error('Kernel control did not edit the Gaussian material');
    ed.undo(); if (m.material.kernelSize !== initialKernel) throw new Error('Gaussian control undo failed');
    ed.redo(); if (m.material.kernelSize !== 0.47) throw new Error('Gaussian control redo failed');
    ed.undo(); ui.openTab(null);
    const digest = async m => {
      const buffers = [m.splatsData, ...(m.shData ?? []).map(a => a.subarray(0, m.getTotalVertices() * 16))];
      return Promise.all(buffers.map(async data => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data))).join(',')));
    };
    const hashes = await digest(m);
    m.shDegree = Math.min(m.shDegree, 1);
    const before = { count: m.getTotalVertices(), bytes: m.splatsData?.byteLength, degree: m.shDegree, maxDegree: m._maxShDegree };
    if (!before.bytes) throw new Error(`Imported clone lost CPU splat data: ${JSON.stringify({ class: m.getClassName(), source: m.source?.getClassName(), sourceBytes: m.source?.splatsData?.byteLength, containers: ed.selected.source.container.meshes.map(m => ({ class: m.getClassName(), bytes: m.splatsData?.byteLength })) })}`);
    m.material.kernelSize = 0.17;
    m.material.compensation = true;
    const appearance = materialToJSON(m.material);
    ed.selected.root.position.set(1.2, 0.3, -0.4);
    const { Matrix, Quaternion } = await import('/node_modules/@babylonjs/core/Maths/math.vector.js');
    ed.selected.root.rotationQuaternion = Quaternion.RotationYawPitchRoll(0.3, 0.2, -0.1);
    ed.selected.root.scaling.set(-1, 0.8, 1.1);
    ed.selected.root.setPreTransformMatrix(Matrix.FromArray([1,0,0.2,0, 0.1,1,0,0, 0,0.15,1,0, 0,0,0,1]));
    ed.duplicate();
    const saved = snapshot(ed, 'Splats');
    const zip = await toZip(saved);
    const decoded = await fromZip(new File([zip], 'splats.babalon'));
    await restore(ed, decoded);
    const restored = splat();
    const after = { count: restored.getTotalVertices(), bytes: restored.splatsData?.byteLength, degree: restored.shDegree, maxDegree: restored._maxShDegree };
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(`Project lost splat data: ${JSON.stringify({before, after})}`);
    if (JSON.stringify(hashes) !== JSON.stringify(await digest(restored))) throw new Error('Project changed packed splat bytes');
    if (JSON.stringify(materialToJSON(restored.material)) !== JSON.stringify(appearance)) throw new Error('Project lost splat appearance');
    const models = ed.entities.filter(e => e.kind === 'model');
    if (models.length !== 2 || Math.abs(models[0].root.position.x - 1.2) > 1e-6) throw new Error('Project lost duplicate or transform');
    const cost = analyzeEntity(ed, models[0]);
    if (cost.triangles !== 0 || cost.vertices !== 0 || cost.splats !== before.count || !cost.textureBytes) throw new Error('Splat costs include billboard geometry or omit GPU textures');
    const { Vector3 } = await import('/node_modules/@babylonjs/core/Maths/math.vector.js');
    const points = meshes => meshes.filter(m => m.getClassName().includes('GaussianSplatting')).map(m => {
      const f = new Float32Array(m.splatsData);
      const point = new Vector3(f[0], f[1] * (m._flipY ? -1 : 1), f[2]);
      return Vector3.TransformCoordinates(point, worldMatrix(m)).asArray();
    }).sort((a,b) => a[0]-b[0]);
    const expectedPoints = points(models.flatMap(e => e.meshes));
    ed.addPrimitive('box');
    const glb = await ed.exportGLB();
    const container = await ed.loadAsset({ id: 999, name: 'GLB test', main: new File([glb], 'splats.glb') });
    const actualPoints = points(container.meshes);
    if (actualPoints.length !== expectedPoints.length || actualPoints.some((p,i) => p.some((n,c) => Math.abs(n-expectedPoints[i][c]) > 1e-4))) throw new Error(`GLB changed splat transforms: ${JSON.stringify({expectedPoints, actualPoints})}`);
    container.dispose();
    const compact = await ed.exportGLB(true);
    ed.newScene();
    await ed.addFiles([new File([glb], 'splats.glb')]);
    const reimported = splat();
    if (!reimported || reimported.getTotalVertices() !== before.count) throw new Error('GLB lost Gaussian splats');
    if (JSON.stringify(hashes) !== JSON.stringify(await digest(reimported))) throw new Error('GLB changed packed splat bytes');
    if (reimported.shDegree !== before.degree || reimported._maxShDegree !== before.maxDegree) throw new Error('GLB changed active or maximum harmonic degree');
    if (compact.size !== glb.size) throw new Error('Compact export discarded splat payloads');
    const { ARMode } = await import('/src/ar/ar.ts');
    const ar = new ARMode(ed);
    const light = ed.addLight('directional', { shadows: true });
    light.light.shadowEnabled = false;
    light.light.setEnabled(false);
    light.shadowGen.getShadowMap().refreshRate = 2;
    const baseline = snapshot(ed, 'AR').json;
    const originalMaterials = ed.entities.flatMap(e => e.meshes).map(m => [m, m.material]);
    ed.setARMode(true); ar.wrapScene(); ar.active = true; ar.anchor.setEnabled(true);
    ar.depthSupported = true; ar.depth = { attach: () => true, detach() {} };
    ar.setOcclusion(true);
    for (const [mesh, original] of originalMaterials) {
      if (mesh.material === original) throw new Error('AR occlusion did not clone the material');
      if (mesh.getClassName().includes('GaussianSplatting') && mesh.material.getSourceMesh() !== mesh) throw new Error('AR clone lost its splat source');
    }
    ar.xr = { baseExperience: { featuresManager: { attachFeature() {}, detachFeature() {} } } };
    ar.setLighting('neon'); ar.setShadows(true); ar.setLightLevel(0.7);
    ar.cleanup();
    for (const [mesh, original] of originalMaterials) if (mesh.material !== original) throw new Error('AR did not restore the original material');
    const final = snapshot(ed, 'AR').json;
    if (JSON.stringify(baseline.entities) !== JSON.stringify(final.entities) || JSON.stringify(baseline.env) !== JSON.stringify(final.env)) throw new Error('AR changed saved scene state');
    if (light.light.isEnabled(false) || light.light.shadowEnabled || light.shadowGen.getShadowMap().refreshRate !== 2) throw new Error('AR changed light or shadow settings');
    const { FreeCamera } = await import('/node_modules/@babylonjs/core/Cameras/freeCamera.js');
    const camera = new FreeCamera('XR camera switch', ed.camera.position.clone(), ed.scene);
    camera.setTarget(ed.camera.target);
    ed.scene.activeCamera = camera;
    ed.invalidate(8000);
    const deadline = performance.now() + 8000;
    while (!reimported._cameraViewInfos.get(camera.uniqueId)?.splatIndexBufferSet && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    if (!reimported._cameraViewInfos.get(camera.uniqueId)?.splatIndexBufferSet) throw new Error('Splats did not sort for the new AR camera');
    ed.scene.activeCamera = ed.camera; camera.dispose(); ed.invalidate();
    const standard = await ed.exportGLB(false, false, true);
    const standardBytes = await standard.arrayBuffer(), view = new DataView(standardBytes);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(standardBytes, 20, view.getUint32(12, true))));
    if (!json.extensionsUsed.includes('KHR_gaussian_splatting') || json.extensionsUsed.includes('BABALON_gaussian_splatting')) throw new Error('Standard export contains app-specific splat payload');
    const primitives = json.meshes.flatMap(m => m.primitives).filter(p => p.extensions?.KHR_gaussian_splatting);
    for (const p of primitives) {
      const attributes = p.attributes;
      for (const suffix of ['ROTATION', 'SCALE', 'OPACITY', 'SH_DEGREE_0_COEF_0']) if (attributes[`KHR_gaussian_splatting:${suffix}`] === undefined) throw new Error(`Missing standard ${suffix}`);
      for (const index of Object.values(attributes)) if (json.accessors[index].count !== before.count) throw new Error('Standard attribute count changed');
    }
    const standardFile = new File([standard], 'standard.glb');
    const expectedStandardPoints = points(ed.entities.flatMap(e => e.meshes));
    const standardContainer = await ed.loadAsset({id: 1000, name:'Standard GLB', main:standardFile});
    const actualStandardPoints = points(standardContainer.meshes);
    if (actualStandardPoints.length !== expectedStandardPoints.length || actualStandardPoints.some((p,i)=>p.some((n,c)=>Math.abs(n-expectedStandardPoints[i][c])>1e-4))) throw new Error('Standard GLB changed world positions');
    const standardMesh = standardContainer.meshes.find(m => m.getClassName().includes('GaussianSplatting'));
    if (!standardMesh?.splatsData || standardMesh._maxShDegree !== Math.min(3,before.maxDegree)) throw new Error('Standard import lost retained data or harmonics');
    // Vite may serve timestamped and direct module URLs as separate class identities.
    if (standardMesh.constructor.name !== 'EditorSplatMesh') throw new Error('Standard importer bypassed managed lifecycle');
    standardContainer.dispose();
    const { registerGLTFExtension } = await import('/node_modules/@babylonjs/loaders/glTF/2.0/glTFLoaderExtensionRegistry.js');
    const { KHR_gaussian_splatting } = await import('/node_modules/@babylonjs/loaders/glTF/2.0/Extensions/KHR_gaussian_splatting.pure.js');
    const { createStandardSplatExtension } = await import('/src/core/splatStandardLoader.ts');
    const observers = new Set(ed.scene.onCameraRemovedObservable.observers);
    registerGLTFExtension('BABALON_standard_gaussian_loader',false,()=>({name:'BABALON_standard_gaussian_loader',enabled:false,dispose(){}}));
    registerGLTFExtension('KHR_gaussian_splatting',true,loader=>new KHR_gaussian_splatting(loader));
    try {
      const independent = await ed.loadAsset({id:1001,name:'Upstream loader',main:standardFile});
      const loaded = independent.meshes.filter(m=>m.getClassName().includes('GaussianSplatting'));
      if (loaded.length !== expectedStandardPoints.length || loaded.some(m=>m.getTotalVertices()!==before.count)) throw new Error('Upstream Gaussian loader could not read the exported file');
      independent.dispose();
    } finally {
      registerGLTFExtension('BABALON_standard_gaussian_loader',false,createStandardSplatExtension);
      ed.scene.onCameraRemovedObservable.observers.filter(o=>!observers.has(o)).forEach(o=>ed.scene.onCameraRemovedObservable.remove(o));
    }
    return { before, after, cost: { splats: cost.splats, triangles: cost.triangles, textureBytes: cost.textureBytes }, zipBytes: zip.size, glbBytes: glb.size, standardGlbBytes:standard.size, models: models.length, arRestored: true };
  });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ...result, viewport }));
} finally {
  await browser.close();
}
