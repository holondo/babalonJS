// JavaScript-only browser regression. No Computer/Browser Use tools are needed.
// Run with a dev server URL; PLAYWRIGHT_MODULE can point to a bundled runtime package.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(process.env.PLAYWRIGHT_MODULE); }
const browser = await playwright.chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL ?? 'chrome' });
const base = process.argv[2] ?? 'http://127.0.0.1:5194';
const screenshotDirectory = process.env.ANATOMY_SCREENSHOTS;
let sharp;
if (screenshotDirectory) {
  await mkdir(screenshotDirectory, { recursive: true });
  try { sharp = require('sharp'); } catch { sharp = require(join(dirname(process.env.PLAYWRIGHT_MODULE), 'sharp')); }
}
try {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 812 }]) {
    const errors = [];
    const page = await browser.newPage({ viewport });
    // Keep the fixture's frame-based UI ticks running when the browser is backgrounded.
    await page.addInitScript(() => { window.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 16); });
    page.on('requestfailed', request => errors.push(`${request.failure()?.errorText}: ${request.url()}`));
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    if (process.argv.includes('--production')) {
      await page.goto(base, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => window.editor);
      const evidence = await page.evaluate(async (priority) => {
        const editor = window.editor, entity = await editor.addAnatomy(), body = entity.anatomyBody;
        const material = body.materialFor('skin');material.metallic=.8;material.roughness=.3;
        body.patch({chestWidth:38,adiposeOpacity:.4,skinOpacity:.2,externalObliqueOpacity:1});await body.ready();
        const rest = Array.from(entity.meshes.find(mesh=>mesh.metadata.anatomyLayer==='skin').getVerticesData('position'));
        body.editPose('rightElbowFlexion',95);body.commit();
        if(body.pose.rightElbowFlexion!==95||!entity.meshes.find(mesh=>mesh.metadata.anatomyLayer==='skin').getVerticesData('position').some((value,i)=>Math.abs(value-rest[i])>.001))throw Error('Compiled pose deformation');
        await Promise.all(entity.meshes.map(mesh=>mesh.material.forceCompilationAsync(mesh)));
        if(material!==body.materialFor('skin')||material.metallic!==.8||material.roughness!==.3)throw Error('Compiled material persistence');
        if(!entity.meshes.some(mesh=>mesh.metadata.anatomyLayer==='adipose'&&mesh.isEnabled()))throw Error('Compiled fat worker');
        if (priority) {
          body.editIndividual('rectus_abdominis.L','volume',1.4);body.commit();
          body.editIndividual('hip_bone.L','width',1.1);body.commit();
          body.editIndividual('pectoralis_major_sternocostal.L','activation',.5);body.commit();await body.ready();
          if(body.anatomyMetrics.length!==2||body.anatomyMetrics.some(m=>m.error>.02))throw Error('Compiled individual volume path');
          if(!entity.meshes.some(m=>m.metadata.anatomyId==='hip_bone.L'))throw Error('Compiled pelvic identity');
          body.setTissueInteraction({attachments:true,contact:true});await body.ready();body.setPose({rightArmAbduction:75,leftHipFlexion:35});
          if(body.attachmentMetrics.length<12||body.attachmentMetrics.some(m=>m.errorMm>.1))throw Error('Compiled attachment areas');
          if(body.contactMetrics.length<4||body.contactMetrics.some(m=>m.afterMm>.2))throw Error('Compiled tissue contact');
          await Promise.all(entity.meshes.map(mesh=>mesh.material.forceCompilationAsync(mesh)));
        }
        return {material:material.getClassName(),structures:[...new Set(entity.meshes.map(mesh=>mesh.metadata.anatomyLayer))],metrics:body.anatomyMetrics,attachmentAreas:body.attachmentMetrics.length,contactPairs:body.contactMetrics.length};
      }, process.argv.includes('--priority'));
      assert.deepEqual(errors, [], JSON.stringify(errors.map(e=>e.slice(0,900))));
      console.log(JSON.stringify({status:'PASS',production:true,viewport,evidence,runtimeErrors:errors.length}));await page.close();continue;
    }
    if (process.argv.includes('--priority')) {
      await page.goto(base+'/scripts/fixtures/anatomy-priority.html', {waitUntil:'networkidle'});
      await page.getByRole('button',{name:'Test priority anatomy',exact:true}).click();
      await page.waitForFunction(()=>/PASS|FAIL/.test(document.querySelector('#result').textContent),null,{timeout:120000});
      const result=await page.locator('#result').innerText();assert.ok(result.includes('PASS'),result);
      const layout=await page.evaluate(()=>{document.querySelector('#test').hidden=true;document.querySelector('#result').hidden=true;return {pageOverflow:document.documentElement.scrollWidth>innerWidth,inspector:!!document.querySelector('[data-individual-anatomy]')};});
      assert.equal(layout.pageOverflow,false,'Horizontal overflow');assert.equal(layout.inspector,true,'Inspector after reopen');
      if(sharp){const path=join(screenshotDirectory,'priority-'+viewport.width+'.jpg');await sharp(await page.screenshot()).resize({width:Math.min(640,viewport.width)}).jpeg({quality:55}).toFile(path);console.log(JSON.stringify({screenshot:path}));
        for(const angle of ['front','side']){await page.waitForTimeout(600);await page.evaluate(angle=>{document.body.classList.add('ui-hidden');const {editor}=window.anatomyTest;editor.select(null);const body=editor.entities.find(e=>e.anatomyBody).anatomyBody;body.setPose({});body.frame('torso');body.view(angle);editor.scene.render();},angle);const detail=join(screenshotDirectory,'priority-'+angle+'-'+viewport.width+'.jpg');await sharp(await page.screenshot()).resize({width:Math.min(640,viewport.width)}).jpeg({quality:55}).toFile(detail);console.log(JSON.stringify({screenshot:detail}));}
      }
      assert.deepEqual(errors,[]);console.log(JSON.stringify({viewport,result:JSON.parse(result),layout,runtimeErrors:errors.length}));await page.close();continue;
    }
    await page.goto(`${base}/scripts/fixtures/anatomy.html`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Test anatomy', exact: true }).click();
    await page.waitForFunction(() => /PASS|FAIL/.test(document.querySelector('#result').textContent), undefined, { timeout: 90000 });
    const result = await page.locator('#result').innerText();
    assert.ok(result.includes('PASS'), result);
    await page.evaluate(() => {
      document.querySelector('#result').hidden = true;
      document.querySelector('#test').hidden = true;
      const { editor, ui } = window.anatomyTest;
      editor.select(editor.entities[0]); ui.openPart('objects', 'material');
      const preset = [...document.querySelectorAll('button.chip')].find(b => b.textContent.trim() === 'Gold');
      if (!preset) throw Error('Native Gold preset is missing');
      preset.click();
      const body = editor.selected.anatomyBody, mat = body.materialFor('skin');
      if (mat.metallic !== 1 || mat.roughness !== .2) throw Error('Native PBR preset did not apply');
      const roughness = document.querySelector('input[type=range][aria-label=Roughness]');
      roughness.value = '.35'; roughness.dispatchEvent(new Event('input', { bubbles: true })); roughness.dispatchEvent(new Event('change', { bubbles: true }));
      if (mat.roughness !== .35) throw Error('Standard roughness slider did not apply');
    });
    const materialEvidence = await page.evaluate(async () => {
      const { editor } = window.anatomyTest, body = editor.selected.anatomyBody;
      const material = body.materialFor('skin');
      body.edit('chestWidth', 38); body.commit(); await body.ready();
      if (body.materialFor('skin') !== material || material.metallic !== 1 || material.roughness !== .35) throw Error('Native preset was lost on regeneration');
      await Promise.all(editor.selected.meshes.map(m => m.material.forceCompilationAsync(m)));
      return { metallic: material.metallic, roughness: material.roughness, stableMaterial: true };
    });
    const capture = async label => {
      if (!sharp) return;
      const path = join(screenshotDirectory, `${label}-${viewport.width}.jpg`);
      await sharp(await page.screenshot()).resize({ width: Math.min(640, viewport.width) }).jpeg({ quality: 55 }).toFile(path);
      console.log(JSON.stringify({ screenshot: path }));
    };
    await capture('material');
    await page.evaluate(() => { const { ui } = window.anatomyTest; ui.openPart('objects', 'anatomy-layers'); });
    await page.evaluate(async () => {
      const { editor } = window.anatomyTest;
      const button = [...document.querySelectorAll('.panel-body button.chip')].find(b => b.textContent.trim() === 'Fat');
      if (!button) throw Error('Fat visibility preset is missing');
      button.click(); await editor.selected.anatomyBody.ready();
      const body = editor.selected.anatomyBody;
      if (body.parameters.adiposeOpacity !== 1 || body.parameters.skinOpacity !== 0) throw Error('Fat cannot be isolated');
      if (!editor.selected.meshes.some(m => m.metadata.anatomyLayer === 'adipose' && m.isEnabled())) throw Error('Independent fat mesh is missing');
      await Promise.all(editor.selected.meshes.map(m => m.material.forceCompilationAsync(m)));
      body.selectStructure('adipose');
    });
    await capture('fat-layers');
    const layout = await page.evaluate(() => ({ pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      cards: [...document.querySelectorAll('.anatomy-profile')].every(el => el.scrollHeight <= el.clientHeight) }));
    assert.equal(layout.pageOverflow, false, JSON.stringify(layout));
    assert.deepEqual(errors, [], JSON.stringify(errors.map(e => e.slice(0, 900))));
    console.log(JSON.stringify({ status: 'PASS', viewport, materialEvidence, layout, runtimeErrors: errors.length }));
    await page.close();
  }
} finally { await browser.close(); }
