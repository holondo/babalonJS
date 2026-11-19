// Actual anatomy kernels and worker protocol, without a DOM or GPU.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const transpile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText;
const { registerHooks } = await import('node:module');
const { fileURLToPath } = await import('node:url');
const { existsSync } = await import('node:fs');
const prefix = new URL('../src/anatomy/', import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.startsWith(prefix) && specifier.startsWith('.')) {
      const url = new URL(specifier, context.parentURL);
      if (specifier.endsWith('.js') && existsSync(fileURLToPath(url.href.slice(0, -3) + '.ts'))) specifier = specifier.slice(0, -3) + '.ts';
      else if (!/\.(ts|json)$/.test(specifier) && existsSync(fileURLToPath(url.href + '.ts'))) specifier += '.ts';
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith(prefix) && url.endsWith('.ts')) return { format: 'module', source: transpile(readFileSync(fileURLToPath(url), 'utf8')), shortCircuit: true };
    if (url.startsWith(prefix) && url.endsWith('.json')) return { format: 'module', source: 'export default '+readFileSync(fileURLToPath(url), 'utf8')+';', shortCircuit: true };
    return next(url, context);
  }
});
const { defaults } = await import('../src/anatomy/parameters.ts');
const catalogue = JSON.parse(read('../src/anatomy/catalogue.json'));
assert.equal(catalogue.controls.length, 102);
assert.deepEqual(new Set(catalogue.controls.map(c => c.key)), new Set(Object.keys(defaults).filter(k => k !== 'skinModel' && k !== 'abdominalModel' && k !== 'pelvisModel')));
assert.equal(catalogue.layers.length, 10);
const { layoutKeys } = await import('../src/anatomy/bodyLayout.ts');
const placed = layoutKeys(), geometryKeys = catalogue.controls.filter(c => c.kind === 'geometry').map(c => c.key);
assert.equal(new Set(placed).size, placed.length, 'Body layout places each control once');
assert.deepEqual(new Set(placed), new Set(geometryKeys), 'Body layout covers every geometry control');
let reply;
globalThis.self = { postMessage: value => { reply = value; } };
await import('../src/anatomy/anatomy.worker.ts');
function generate(parameters, layers) {
  reply = undefined;
  self.onmessage({ data: { id: 1, parameters, layers } });
  assert.ok(reply && !reply.error, reply?.error);
  for (const list of Object.values(reply.meshes)) for (const m of list) {
    assert.ok(m.positions.every(Number.isFinite));
    assert.ok(m.normals.every(Number.isFinite));
    assert.equal(m.positions.length, m.normals.length);
    assert.ok(m.indices.every(i => i < m.positions.length / 3));
  }
  return reply;
}
// Focused arm regression can run independently of the older trunk-contact check below.
if (process.argv.includes('--support-cache')) {
  const { anatomySupportCache: cache, SupportCache, supportParameterKey } = await import('../src/anatomy/supportCache.ts');
  const bounded = new SupportCache(128, 2);
  for (const key of ['a', 'b']) bounded.getOrCreate(key, () => key, () => 40);
  bounded.getOrCreate('a', () => { throw Error('Expected cache hit'); }, () => 40);
  bounded.getOrCreate('c', () => 'c', () => 40);
  assert.equal(bounded.stats.evictions, 1); assert.ok(bounded.stats.bytes <= 128);
  bounded.getOrCreate('b', () => 'new b', () => 40); assert.equal(bounded.stats.misses, 4);
  const key = supportParameterKey(defaults);
  assert.equal(key, supportParameterKey({ ...defaults, roughness: .8, skinOpacity: 0, definition: { version: 1, muscles: { 'rectus_abdominis.L': { volume: 2 } }, bones: {} } }));
  assert.notEqual(key, supportParameterKey({ ...defaults, rectWidth: 6 }));
  assert.notEqual(key, supportParameterKey({ ...defaults, definition: { version: 1, muscles: {}, bones: {}, interaction: { supportDetail: 2 } } }));
  // Mimic real worker ownership transfer. Cached recipes must survive detached replies.
  self.postMessage = (value, transfer) => { reply = structuredClone(value, { transfer }); };
  const all = ['bones', 'inguinalLigaments', 'rectusAbdominis', 'aponeuroses', 'externalOblique', 'internalOblique', 'transversusAbdominis', 'otherMuscles'];
  const custom = [{ position: .7, angle: 10, curvature: .1, width: 1, depth: .5, extent: 1 }];
  const cases = [
    ['forearm', { forearm: 1.2 }, all], ['rectus', { rectus: 2 }, all],
    ['individual-volume', { definition: { version: 1, muscles: { 'rectus_abdominis.L': { width: 1.5, volume: 2 } }, bones: {} } }, all],
    ['width', { rectWidth: 6 }, ['rectusAbdominis', 'aponeuroses']],
    ['custom-inscriptions', { definition: { version: 1, muscles: { 'rectus_abdominis.L': { intersections: custom } }, bones: {} } }, ['rectusAbdominis', 'aponeuroses']],
    ['pelvic-genes', { definition: { version: 1, muscles: {}, bones: { 'hip_bone.L': { width: 1.1 } } } }, all],
    ['contact', { definition: { version: 1, muscles: {}, bones: {}, interaction: { attachments: true, contact: true, skinFollows: true, clearanceMm: 1, supportDetail: 2 } } }, all],
    ['original', { abdominalModel: 2, rectus: 2 }, ['rectusAbdominis', 'aponeuroses']],
    ['alternate-skin', { skinModel: 1, rectus: 2 }, ['rectusAbdominis', 'aponeuroses']],
  ];
  for (const [name, patch, layers] of cases) {
    const p = { ...defaults, ...patch };
    cache.enabled = false; cache.clear();
    const start = performance.now(), expected = generate(p, layers), uncachedMs = performance.now() - start;
    cache.enabled = true; cache.clear(); generate({ ...defaults }, layers);
    const cachedStart = performance.now(), actual = generate(p, layers), cachedMs = performance.now() - cachedStart;
    assert.deepEqual(actual.meshes, expected.meshes, `${name}: cache must preserve every mesh byte and metadata`);
    assert.deepEqual(actual.anatomyMetrics, expected.anatomyMetrics);
    assert.deepEqual(actual.attachments, expected.attachments); assert.deepEqual(actual.contacts, expected.contacts);
    actual.meshes.skin[0].positions.fill(0);
    const repeated = generate(p, layers);
    assert.deepEqual(repeated.meshes, expected.meshes, `${name}: returned meshes cannot contaminate cached recipes`);
    assert.ok(cache.stats.bytes <= cache.maxBytes && cache.stats.entries <= cache.maxEntries);
    console.log(JSON.stringify({ name, uncachedMs: Math.round(uncachedMs), cachedMs: Math.round(cachedMs), cache: cache.stats }));
  }
  cache.enabled = true; cache.clear();
  console.log('PASS: bounded support cache, recipe invalidation, transfer ownership and exact cached/uncached geometry');
  process.exit(0);
}
if (process.argv.includes('--rectus-maxima')) {
  const { AnteriorSurface } = await import('../src/anatomy/tissueContact.ts');
  const { rectusGrowthExposure, buildRegionalSurface } = await import('../src/anatomy/geometry.ts');
  const layers = ['otherMuscles', 'rectusAbdominis', 'aponeuroses'];
  for (const skinModel of [0, 1]) for (const genetics of [false, true]) {
    const p = { ...defaults, skinModel, rectWidth: 9, rectus: 3, individualGrowth: { rectus_abdominis: 3 }, definition: genetics ? { version: 1, muscles: Object.fromEntries(['L', 'R'].map(side => [`rectus_abdominis.${side}`, { width: 1.5, volume: 2 }])), bones: {} } : undefined };
    const old = generate({ ...p, abdominalModel: 2 }, layers), current = generate({ ...p, abdominalModel: 1 }, layers);
    const width = result => { const xs = result.meshes.rectusAbdominis.flatMap(m => Array.from(m.positions).filter((_, i) => i % 3 === 0)); return (Math.max(...xs) - Math.min(...xs)) * 100; };
    const currentParameters = { ...p, abdominalModel: 1 }, skin = new AnteriorSurface(current.meshes.skin); let penetrationMm = 0, exposedMm = 0, worst;
    for (const mesh of current.meshes.rectusAbdominis) for (let i = 0; i < mesh.positions.length; i += 3) {
      const [x, y, z] = mesh.positions.slice(i, i + 3), bounds = skin.bounds(x, y);
      if (bounds) { const d = (z - bounds[1]) * 100; if(d > penetrationMm) worst = {x,y,z,front:bounds[1],name:mesh.anatomicalName}; penetrationMm = Math.max(penetrationMm, d); if (rectusGrowthExposure(currentParameters, x, y) === 1) exposedMm = Math.max(exposedMm, d); }
    }
    for (const mesh of current.meshes.rectusAbdominis) for (let face = 0; face < mesh.indices.length; face += 3) {
      const point = [0, 1, 2].map(axis => [0, 1, 2].reduce((sum, k) => sum + mesh.positions[mesh.indices[face + k] * 3 + axis], 0) / 3);
      const bounds = skin.bounds(point[0], point[1]);
      if (bounds) penetrationMm = Math.max(penetrationMm, (point[2] - bounds[1]) * 100);
    }
    console.log(JSON.stringify({ skinModel, genetics, originalWidthMm: width(old), currentWidthMm: width(current), penetrationMm, exposedMm, worst, error: Math.max(0, ...current.anatomyMetrics.map(m => m.error)) }));
    assert.ok(Math.abs(width(current) - width(old)) < 1, 'Current maximum width must retain the original envelope within 1 mm');
    assert.ok(penetrationMm < .1, 'Opaque skin must cover maximum rectus growth within 0.1 mm');
    assert.ok(current.anatomyMetrics.every(m => m.error < .02), 'Maximum morphology retains its requested volume');
    const grooves = current.meshes.aponeuroses.filter(m => /^tendinous_intersection_R_/.test(m.anatomicalName ?? '')).map(mesh => {
      const { rows, cols } = mesh.surfaceGrid, vertex = Math.floor(rows / 2) * (cols + 1) + Math.floor(cols / 2), x = mesh.positions[vertex * 3], y = mesh.positions[vertex * 3 + 1];
      const center = skin.bounds(x, y), above = skin.bounds(x, y + .16), below = skin.bounds(x, y - .16);
      return center && above && below ? (Math.min(above[1], below[1]) - center[1]) * 100 : 0;
    });
    console.log(JSON.stringify({ skinModel, genetics, inscriptionReliefMm: grooves }));
    assert.ok(grooves.at(-1) > 1, 'The inferior tendinous division remains visible through maximum skin growth');
    const neutral = generate({ ...currentParameters, rectus: 1, individualGrowth: { rectus_abdominis: 1 } }, layers);
    const chest = result => result.meshes.otherMuscles.filter(m => /^pectoralis_/.test(m.anatomicalName ?? '')).map(m => m.positions);
    assert.deepEqual(chest(current), chest(neutral), 'Maximum rectus growth must not deform pectoral muscles');
    const a = neutral.meshes.skin[0].positions, b = current.meshes.skin[0].positions, source = buildRegionalSurface(currentParameters).positions;
    assert.equal(a.length, b.length, 'Rectus growth retains skin topology for protected vertex comparisons');
    assert.equal(source.length, b.length);
    for (let i = 0; i < a.length; i += 3) if (a[i + 2] > .5 && a[i + 1] > 12 && Math.abs(a[i]) < .85 && rectusGrowthExposure(currentParameters, source[i], source[i + 1]) === 0) {
      assert.ok(Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1], a[i + 2] - b[i + 2]) * 100 < .01, 'Chest skin stays independent at maximum growth');
    }
  }
  console.log('PASS: maximum rectus envelope, volume, triangle coverage and chest isolation on both skins');
  process.exit(0);
}
if (process.argv.includes('--abdominal-versions')) {
  const layers = ['otherMuscles', 'rectusAbdominis', 'aponeuroses', 'externalOblique', 'internalOblique', 'transversusAbdominis'];
  const historicalBounds = [
    [-.8087770939,9.1061220169,.8916482925,.8262894750,13.1049175262,1.4053434134],
    [-.9615398645,9.1423635483,.7945805192,.8262894750,13.0851230621,1.4899389744],
    [-.8690254688,8.5950002670,.8089287877,.8690879345,12.8999996185,1.4335442781],
    [-1.0740019083,8.6272659302,.6163786650,.8690879345,12.8822879791,1.7791385651],
  ];
  for (const skinModel of [0, 1]) {
    const shapes = [];
    for (const abdominalModel of [0, 1, 2]) {
      const p = { ...defaults, skinModel, abdominalModel }, rest = generate(p, layers), grown = generate({ ...p, individualGrowth: { rectus_abdominis: 2.5 } }, layers);
      let chestMm = 0;
      for (const [index, m] of rest.meshes.otherMuscles.entries()) if (/^pectoralis_/.test(m.anatomicalName ?? '')) for (let i = 0; i < m.positions.length; i++) chestMm = Math.max(chestMm, Math.abs(m.positions[i] - grown.meshes.otherMuscles[index].positions[i]) * 100);
      if (abdominalModel === 2) assert.ok(chestMm > 1, 'Original mode retains historical abdominal/chest coupling');
      else assert.ok(chestMm < .01, 'Existing modes retain their corrected growth isolation');
      shapes.push(rest.meshes.externalOblique[0].positions.length);
      console.log(JSON.stringify({ skinModel, abdominalModel, chestMm, obliqueVertices: shapes.at(-1) / 3 }));
    }
    assert.notEqual(shapes[0], shapes[1]); assert.equal(shapes[1], shapes[2]);
    for (const custom of [false, true]) {
      const p = { ...defaults, skinModel, abdominalModel: 2, rectus: 2.5, rectWidth: 7, rectGap: .5, rectPattern: .7, oblique: 1.4, individualGrowth: { rectus_abdominis: 1.8 }, definition: custom ? { version: 1, muscles: { 'rectus_abdominis.L': { width: 1.4, depth: 1.2, volume: 1.8 } }, bones: {}, interaction: { attachments: true, skinFollows: false, contact: false, clearanceMm: 1, supportDetail: 1 } } : undefined };
      const result = generate(p, layers), positions = result.meshes.rectusAbdominis.flatMap(m => Array.from(m.positions)), bounds = [];
      for (let axis = 0; axis < 3; axis++) { const values = positions.filter((_, i) => i % 3 === axis); bounds[axis] = Math.min(...values); bounds[axis + 3] = Math.max(...values); }
      const reference = historicalBounds[skinModel * 2 + Number(custom)];
      assert.ok(bounds.every((value, i) => Math.abs(value - reference[i]) * 100 < .001), 'Original fans retain the measured 9619032 bounds');
      assert.ok(result.anatomyMetrics.every(m => m.error < .02));
    }
  }
  console.log('PASS: three distinct abdominal modes, preserved current/sheets behavior and original historical fan behavior');
  process.exit(0);
}
if (process.argv.includes('--rectus-seam')) {
  const { buildRegionalSurface } = await import('../src/anatomy/geometry.ts');
  const rest = buildRegionalSurface(defaults).positions;
  const centers = [], neighbours = [];
  for (let i = 0; i < rest.length; i += 3) {
    if (rest[i + 1] < 10.2 || rest[i + 1] > 11.8 || rest[i + 2] < .8) continue;
    if (Math.abs(rest[i]) < .00001) centers.push(i);
    else if (Math.abs(rest[i]) > .01 && Math.abs(rest[i]) < .12) neighbours.push(i);
  }
  for (const rectus of [.2, 2.5, 3]) {
    const grown = buildRegionalSurface({ ...defaults, rectus }).positions;
    let maxJumpMm = 0, pairs = 0;
    for (const i of centers) for (const j of neighbours) {
      if (Math.abs(rest[i + 1] - rest[j + 1]) > .025 || Math.abs(rest[i + 2] - rest[j + 2]) > .10) continue;
      const jump = Math.abs((grown[i + 2] - rest[i + 2]) - (grown[j + 2] - rest[j + 2])) * 100;
      maxJumpMm = Math.max(maxJumpMm, jump); pairs++;
    }
    assert.ok(pairs > 20 && maxJumpMm < 5, `Midline inflation discontinuity: ${maxJumpMm} mm (${pairs} pairs)`);
    console.log(JSON.stringify({ rectus, maxJumpMm, pairs }));
  }
  for (const skinModel of [0, 1]) for (const rectus of [1, 2.5]) {
    const data = [];
    for (const rectPattern of [-1, 0, 1]) {
      const result = generate({ ...defaults, skinModel, rectus, rectPattern }, ['rectusAbdominis', 'aponeuroses']);
      const height = side => { const m = result.meshes.aponeuroses.find(m => m.anatomicalName === `tendinous_intersection_${side}_1`); const y = Array.from(m.positions).filter((_, i) => i % 3 === 1); return y.reduce((a, b) => a + b, 0) / y.length; };
      data.push({ rectPattern, staggerMm: (height('R') - height('L')) * 100, positions: result.meshes.skin[0].positions });
    }
    assert.ok(Math.abs(data[1].staggerMm) < .01 && data[0].staggerMm < -5 && data[2].staggerMm > 5, 'Stagger must be neutral at zero and reverse with its parameter');
    const profile = positions => { const bins = new Map(); for (let i = 0; i < positions.length; i += 3) { const x = Math.abs(positions[i]), y = positions[i + 1], z = positions[i + 2]; if (x > 1 || y < 10 || y > 12.6 || z < .5) continue; const key = `${Math.round(x * 20)}:${Math.round(y * 20)}`; bins.set(key, Math.max(z, bins.get(key) ?? -Infinity)); } return bins; };
    const reference = profile(data[1].positions);
    const deltas = [0, 2].map(k => { let delta = 0; for (const [key, z] of profile(data[k].positions)) if (reference.has(key)) delta = Math.max(delta, Math.abs(reference.get(key) - z) * 100); return delta; });
    assert.ok(deltas.every(delta => delta > .5), 'Stagger must deform the skin as well as the internal bands');
    console.log(JSON.stringify({ skinModel, rectus, staggerMm: data.map(d => d.staggerMm), skinDeltaMm: deltas }));
  }
  console.log('PASS: continuous rectus midline and reversible parameter-driven stagger on muscles and skin');
  process.exit(0);
}
if (process.argv.includes('--rectus-controls')) {
  const { applySurfaceFollowers } = await import('../src/anatomy/connective.ts');
  const { posedPositions, normalizePose } = await import('../src/anatomy/pose.ts');
  for (const skinModel of [0, 1]) for (const attachments of [false, true]) {
    const results = [];
    for (const width of [.65, 1, 1.5]) {
      const p = { ...defaults, skinModel, rectGap: .1, rectus: 2.5, individualGrowth: { rectus_abdominis: 2.5 }, definition: { version: 1, muscles: { 'rectus_abdominis.L': { width, volume: 1.8 } }, bones: {}, interaction: { attachments, skinFollows: true, contact: false, clearanceMm: 1, supportDetail: 1 } } };
      const result = generate(p, ['rectusAbdominis', 'aponeuroses']);
      assert.ok(result.anatomyMetrics.every(m => m.error < .02));
      const muscle = result.meshes.rectusAbdominis.find(m => m.anatomicalName.includes('_L_segment_2'));
      const cols = muscle.surfaceGrid.cols + 1, row = Math.floor(muscle.surfaceGrid.rows / 2), center = vertex => (muscle.positions[vertex * 3] + muscle.positions[(vertex + muscle.shellPairs) * 3]) * .5;
      const medial = -center(row * cols), lateral = -center(row * cols + cols - 1);
      assert.ok(medial > 0 && medial * 20 < .3, 'Minimum separation must remain narrow without crossing the midline');
      const raw = Object.values(result.meshes).flat(), posed = new Map(raw.map(mesh => [mesh, posedPositions(mesh, p, normalizePose({}))]));
      applySurfaceFollowers(raw, posed);
      const tendons = result.meshes.aponeuroses.filter(m => /^tendinous_intersection_L_/.test(m.anatomicalName));
      for (const mesh of tendons) for (let i = 0; i < mesh.positions.length; i++) assert.ok(Math.abs(mesh.positions[i] - posed.get(mesh)[i]) < .0001, 'Neutral renderer must retain the rest inscription');
      results.push({ width, gapCm: medial * 20, widthCm: (lateral - medial) * 10, y: tendons.map(mesh => Array.from(mesh.positions).filter((_, i) => i % 3 === 1)) });
    }
    assert.ok(results[0].widthCm < results[1].widthCm && results[1].widthCm < results[2].widthCm && results[2].widthCm - results[0].widthCm > 1, 'Genetic width must have a clear independent effect');
    for (const result of results) {
      assert.ok(Math.abs(result.gapCm - results[1].gapCm) < .01, 'Width must not change separation');
      for (let band = 0; band < result.y.length; band++) for (let i = 0; i < result.y[band].length; i++) assert.ok(Math.abs(result.y[band][i] - results[1].y[band][i]) * 100 < .01, 'Width must not bend a straight inscription');
    }
    console.log(JSON.stringify({ skinModel, attachments, controls: results.map(({ y, ...values }) => values) }));
  }
  console.log('PASS: rectus width/separation independence, minimum gap, stable inscriptions and neutral posed followers');
  process.exit(0);
}
if (process.argv.includes('--rectus-distribution')) {
  const { rectusGrowthExposure } = await import('../src/anatomy/geometry.ts');
  const { normalizeDefinition } = await import('../src/anatomy/definition.ts');
  const intersections = [.75, .6].map(position => ({ position, angle: 0, curvature: 0, width: 1, depth: .55, extent: 1 }));
  const custom = normalizeDefinition({ version: 1, muscles: Object.fromEntries(['L', 'R'].map(side => ['rectus_abdominis.' + side, { intersections }])), bones: {} });
  for (const skinModel of [0, 1]) for (const definition of [undefined, custom]) {
    const p = { ...defaults, skinModel, rectusSegmentCount: 4, definition }, wanted = ['otherMuscles', 'rectusAbdominis', 'aponeuroses'];
    const rest = generate(p, wanted);
    for (const patch of [{ individualGrowth: { rectus_abdominis: 2.5 } }, ...(skinModel === 0 ? [{ rectus: 2.5 }] : [])]) {
      const grown = generate({ ...p, ...patch }, wanted), a = rest.meshes.skin[0].positions, b = grown.meshes.skin[0].positions;
      assert.equal(a.length, b.length);
      let lowerMm = 0, coveredMm = 0, samples = 0;
      for (let i = 0; i < a.length; i += 3) {
        const x = a[i], y = a[i + 1], z = a[i + 2];
        if (z < .5 || Math.abs(x) > .85 || y < 9.5 || y > 14) continue;
        const delta = Math.hypot(...[0, 1, 2].map(k => a[i + k] - b[i + k])) * 100;
        if (y > 9.8 && y < 10.7 && Math.abs(x) > .2) lowerMm = Math.max(lowerMm, delta);
        if (y > 12 && rectusGrowthExposure(p, x, y) === 0) { coveredMm = Math.max(coveredMm, delta); samples++; }
      }
      assert.ok(samples > 20 && coveredMm < .01, `Rectus growth leaked through the pectoral covering: ${coveredMm} mm`);
      assert.ok(lowerMm > 1, `Inferior belly must receive growth with two intersections: ${lowerMm} mm`);
      const chest = result => result.meshes.otherMuscles.filter(m => /^pectoralis_/.test(m.anatomicalName ?? '')).map(m => m.positions);
      assert.deepEqual(chest(grown), chest(rest), 'Pectoral geometry retains independent growth');
      assert.notDeepEqual(grown.meshes.rectusAbdominis.map(m => m.positions), rest.meshes.rectusAbdominis.map(m => m.positions));
      console.log(JSON.stringify({ skinModel, custom: !!definition, patch, lowerMm, coveredMm, samples }));
    }
  }
  console.log('PASS: two-intersection inferior hypertrophy and pectoral covering, standard and custom layouts on both skins');
  process.exit(0);
}
if (process.argv.includes('--back-inguinal')) {
  const { normalizeGrowth } = await import('../src/anatomy/atlas.ts');
  const { inspectionData } = await import('../src/anatomy/geometry.ts');
  const wanted = ['otherMuscles', 'rectusAbdominis', 'externalOblique', 'aponeuroses', 'bones', 'inguinalLigaments'];
  const rest = generate(defaults, wanted);
  for (const [key, expectedMm] of [['pectoral', 23.4276309591], ['rectus', 22.9450702667]]) {
    const grown = generate({ ...defaults, [key]: 2.5 }, []), a = rest.meshes.skin[0].positions, b = grown.meshes.skin[0].positions;
    let maxMm = 0;
    for (let i = 0; i < a.length; i += 3) maxMm = Math.max(maxMm, Math.hypot(...[0, 1, 2].map(k => a[i + k] - b[i + k])) * 100);
    assert.ok(Math.abs(maxMm - expectedMm) < .0001, `${key} skin relief changed: ${maxMm}`);
    console.log(JSON.stringify({ key, skinDeltaMm: maxMm }));
  }
  for (const patch of [{ back: 2.5 }, { individualGrowth: { latissimusDorsi: 2.5 } }, { definition: { version: 1, muscles: { 'latissimus_dorsi.L': { volume: 1.8 } }, bones: {} } }]) {
    const grown = generate({ ...defaults, ...patch }, wanted);
    const a = rest.meshes.skin[0].positions, b = grown.meshes.skin[0].positions;
    let posteriorMm = 0, anteriorMm = 0;
    for (let i = 0; i < a.length; i += 3) {
      if (a[i + 1] < 10 || a[i + 1] > 14.1) continue;
      const d = Math.hypot(...[0, 1, 2].map(k => a[i + k] - b[i + k])) * 100;
      if (a[i + 2] < -.4) posteriorMm = Math.max(posteriorMm, d);
      if (a[i + 2] > .5) anteriorMm = Math.max(anteriorMm, d);
    }
    assert.ok(posteriorMm > 1 && anteriorMm < .01, JSON.stringify({ patch, posteriorMm, anteriorMm }));
    for (const layer of ['otherMuscles', 'externalOblique', 'rectusAbdominis', 'bones', 'inguinalLigaments']) for (const [index, mesh] of rest.meshes[layer].entries()) {
      if (layer === 'otherMuscles' && !/^pectoralis_/.test(mesh.anatomicalName ?? '') && (patch.back || /^latissimus_dorsi_/.test(mesh.anatomicalName ?? ''))) continue;
      assert.deepEqual(grown.meshes[layer][index].positions, mesh.positions, `Unrelated tissue changed: ${mesh.anatomicalName ?? layer}`);
    }
    console.log(JSON.stringify({ patch, posteriorMm, anteriorMm }));
  }
  const keys = ['longissimus', 'iliocostalis', 'rhomboidMinor', 'rhomboidMajor'];
  assert.deepEqual(normalizeGrowth(Object.fromEntries(keys.map(key => [key, 2.5]))), Object.fromEntries(keys.map(key => [key, 2.5])));
  for (const skinModel of [0, 1]) {
    const baseline = generate({ ...defaults, skinModel }, ['otherMuscles']);
    for (const key of keys) for (const value of [.3, 3]) {
      const result = generate({ ...defaults, skinModel, individualGrowth: { [key]: value } }, ['otherMuscles']);
      assert.notDeepEqual(result.meshes.otherMuscles.map(m => m.positions), baseline.meshes.otherMuscles.map(m => m.positions), `${key} ${value} must work on skin ${skinModel}`);
    }
    for (const control of catalogue.controls.filter(c => c.kind === 'geometry' && /inguinal|supraInguinal|asis|pubisHeight|tilt|flare/.test(c.key))) for (const value of [control.min, control.max]) {
      const p = { ...defaults, skinModel, [control.key]: value }, result = generate(p, ['inguinalLigaments']);
      const path = inspectionData(p).inspection[2], expected = Math.abs(path.at(-1)[1] - path[0][1]) * p.height / 175 * 10;
      assert.ok(Math.abs(result.inguinalHeight - expected) < 1e-8 && result.inguinalHeight > 0);
      if (skinModel === 0) assert.equal(result.meshes.skin[0].positions.length, baseline.meshes.skin[0].positions.length, 'Authored topology remains unchanged');
      else assert.ok(result.meshes.skin[0].indices.length > 1000, 'Legacy skin keeps its adaptive geometry');
    }
  }
  console.log('PASS: posterior growth ownership, four independent part controls, inguinal ranges and world-space measurements on both skins');
  process.exit(0);
}
if (process.argv.includes('--rectus-boundaries')) {
  const { buildInternals } = await import('../src/anatomy/geometry.ts');
  const raw = buildInternals(defaults, ['rectusAbdominis', 'aponeuroses']);
  for (const fat of [0, 40]) {
    const candidate = buildInternals({ ...defaults, fat }, ['rectusAbdominis', 'aponeuroses']);
    assert.deepEqual(candidate.rectusAbdominis.map(m => m.positions), raw.rectusAbdominis.map(m => m.positions), 'Fat remains a covering control, not raw rectus growth');
  }
  const wanted = ['otherMuscles', 'rectusAbdominis', 'externalOblique', 'internalOblique', 'transversusAbdominis', 'aponeuroses', 'bones', 'inguinalLigaments'];
  const delta = (before, after, accept = () => true) => {
    const old = new Map(Object.entries(before.meshes).flatMap(([layer, list]) => list.map((m, i) => [`${layer}:${m.anatomicalName ?? i}`, m])));
    let max = 0;
    for (const [layer, list] of Object.entries(after.meshes)) for (const [index, m] of list.entries()) {
      if (!accept(layer, m)) continue;
      const a = old.get(`${layer}:${m.anatomicalName ?? index}`); assert.ok(a, m.anatomicalName);
      assert.equal(a.positions.length, m.positions.length);
      for (let i = 0; i < a.positions.length; i += 3) max = Math.max(max, Math.hypot(...[0, 1, 2].map(k => m.positions[i + k] - a.positions[i + k])) * 100);
    }
    return max;
  };
  const chest = (_, m) => /^pectoralis_/.test(m.anatomicalName ?? '');
  const anchors = (layer, m) => layer === 'bones' || layer === 'inguinalLigaments' || /^(costal_cartilage_|clavicle_)/.test(m.anatomicalName ?? '');
  const rectus = layer => layer === 'rectusAbdominis';
  for (const skinModel of [0, 1]) {
    const rest = generate({ ...defaults, skinModel }, wanted);
    for (const patch of [{ rectus: 2.5 }, { individualGrowth: { rectus_abdominis: 2.5 } }]) {
      const grown = generate({ ...defaults, skinModel, ...patch }, wanted);
      const chestMm = delta(rest, grown, chest), anchorMm = delta(rest, grown, anchors), rectusMm = delta(rest, grown, rectus);
      assert.ok(chestMm < .01, `Rectus growth must not grow/reseat the pectoral: ${chestMm} mm`);
      assert.ok(anchorMm < .01, `Rectus growth must not move pelvic/costal anchors: ${anchorMm} mm`);
      assert.ok(rectusMm > 1, 'Rectus growth remains functional');
      console.log(JSON.stringify({ skinModel, patch, chestMm, anchorMm, rectusMm }));
    }
    const pec = generate({ ...defaults, skinModel, pectoral: 2 }, wanted);
    const combined = generate({ ...defaults, skinModel, pectoral: 2, rectus: 2.5, individualGrowth: { rectus_abdominis: 2.5 } }, wanted);
    assert.ok(delta(rest, pec, chest) > 1, 'Independent pectoral hypertrophy must remain functional');
    assert.ok(delta(rest, pec, rectus) < .01, 'Pectoral hypertrophy must not grow the rectus');
    assert.ok(delta(pec, combined, chest) < .01, 'Pectoral growth must remain independent when both controls are used');
    const oblique = generate({ ...defaults, skinModel, oblique: 2.5 }, wanted);
    assert.ok(delta(rest, oblique, chest) < .01 && delta(rest, oblique, rectus) < .01, 'Oblique hypertrophy must not grow pectorals or rectus');
    assert.ok(delta(rest, oblique, layer => layer === 'externalOblique') > 1, 'Oblique hypertrophy remains functional');
  }
  for (const options of [{ abdominalModel: 0 }, { rectusSegmentCount: 8, rectWidth: 6.5, rectGap: 2.1, rectPattern: .3, rectusIntersectionShift: .1 }]) {
    const rest = generate({ ...defaults, ...options }, wanted);
    const grown = generate({ ...defaults, ...options, rectus: 2.5, individualGrowth: { rectus_abdominis: 2.5 } }, wanted);
    assert.ok(delta(rest, grown, chest) < .01, 'Legacy sheets and custom segment/width/gap controls retain growth isolation');
    assert.ok(delta(rest, grown, rectus) > 1, 'Custom rectus geometry retains functional growth');
  }
  for (const interaction of [{ attachments: true, contact: true }, { attachments: true, skinFollows: true }]) {
    const definition = { version: 1, muscles: {}, bones: {}, interaction: { ...interaction, clearanceMm: 1 } };
    const rest = generate({ ...defaults, definition }, wanted);
    const grown = generate({ ...defaults, rectus: 2.5, individualGrowth: { rectus_abdominis: 2.5 }, definition }, wanted);
    assert.ok(delta(rest, grown, chest) < .01, 'Connected/contact modes must not turn rectus growth into pectoral hypertrophy');
    assert.ok(grown.attachments.every(a => a.errorMm < .1), 'Pelvic/costal attachments remain fixed');
    assert.ok(grown.contacts.every(c => c.afterMm < .2), JSON.stringify(grown.contacts));
  }
  console.log('PASS: rectus/chest growth isolation, pelvic/costal anchors, both skins, independent pectoral growth and tissue options');
  process.exit(0);
}
if (process.argv.includes('--contact')) {
  const { coverMuscles } = await import('../src/anatomy/tissueContact.ts');
  // One covering edge intersects the muscle; its neighbour starts behind the inner surface.
  // Smoothing the first correction can move that neighbour into the muscle for the first time.
  const source = { anatomicalName: 'pectoralis_major_test_R', positions: new Float32Array([-.5,10,.9, .5,10,.9, -.5,11,.9, .5,11,.9, -.5,10,1.4, .5,10,1.4, -.5,11,1.4, .5,11,1.4]), indices: new Uint32Array([0,1,2,1,3,2,4,6,5,5,6,7]), normals: new Float32Array(24) };
  const covering = { positions: new Float32Array([-.1,10.3,1, .1,10.3,.6, -.1,10.7,1, .1,10.7,.6]), indices: new Uint32Array([0,1,2,1,3,2]), normals: new Float32Array(12) };
  const synthetic = coverMuscles({ otherMuscles: [source] }, covering, undefined, 1);
  assert.ok(synthetic.every(m => m.afterMm < .02), JSON.stringify(synthetic));
  const outside = { ...covering, positions: new Float32Array([-.1,10.3,.6, .1,10.3,.6, -.1,10.7,.6, .1,10.7,.6]) }, unchanged = outside.positions.slice();
  coverMuscles({ otherMuscles: [source] }, outside, undefined, 1);
  assert.deepEqual(outside.positions, unchanged, 'A disconnected surface must not pull the covering across empty space');
  const actual = generate({ ...defaults, definition: { version: 1, muscles: { 'internal_oblique.L': { depth: 1.5, volume: 1.5 } }, bones: {}, interaction: { attachments: true, contact: true, clearanceMm: 1 } } }, ['adipose']);
  assert.ok(actual.contacts.every(m => m.afterMm < .2), JSON.stringify(actual.contacts));
  console.log(JSON.stringify({ status: 'PASS', synthetic, actual: actual.contacts }));
  process.exit(0);
}
if (process.argv.includes('--coverage')) {
  const { atlas } = await import('../src/anatomy/atlas.ts');
  const { individualMuscles } = await import('../src/anatomy/definition.ts');
  const { bodyLayout } = await import('../src/anatomy/bodyLayout.ts');
  const templates = atlas.muscles.filter(m => !['face', 'head', 'hand', 'foot'].includes(m.region)).map(m => m.id);
  const editable = new Set(individualMuscles), controls = new Set(Object.values(bodyLayout).flatMap(region => region.muscles.flatMap(group => group.individual?.map(part => part.template) ?? [])));
  const result = generate({ ...defaults, definition: { version: 1, muscles: {}, bones: {} } }, ['otherMuscles', 'externalOblique', 'internalOblique', 'transversusAbdominis', 'rectusAbdominis']);
  const meshes = Object.values(result.meshes).flat();
  const missing = templates.filter(id => !editable.has(id) || !controls.has(id) || !['L', 'R'].every(side => meshes.some(m => m.anatomyId === `${id}.${side}` && m.positions.length && m.indices.length)));
  assert.deepEqual(missing, [], 'Every main atlas muscle needs real paired geometry and native controls');
  console.log(JSON.stringify({ status: 'PASS', mainAtlasMuscles: templates.length, generatedMainSides: templates.length * 2, exclusions: ['face', 'head', 'hand', 'foot'] }));
  process.exit(0);
}
if (process.argv.includes('--arms') || process.argv.includes('--regions')) {
  const { forearmMuscles, normalizeDefinition } = await import('../src/anatomy/definition.ts');
  const { normalizeGrowth } = await import('../src/anatomy/atlas.ts');
  const groups = await import('../src/anatomy/muscleGroups.ts');
  const templates = process.argv.includes('--regions') ? groups[process.argv[process.argv.indexOf('--regions') + 1] ?? 'shoulderNeckMuscles'] : ['biceps_brachii_short', 'triceps_brachii_medial', ...forearmMuscles];
  assert.deepEqual(normalizeGrowth({ bicepsShort: 2.5, tricepsMedial: 2.5 }), { bicepsShort: 2.5, tricepsMedial: 2.5 });
  const { posedPositions, normalizePose } = await import('../src/anatomy/pose.ts');
  for (const skinModel of [0, 1]) {
    const rest = generate({ ...defaults, skinModel }, ['otherMuscles']);
    const muscles = Object.fromEntries(templates.map(name => [name + '.L', { volume: 1.8 }]));
    const definition = normalizeDefinition({ version: 1, muscles, bones: {} });
    assert.equal(Object.keys(definition.muscles).length, templates.length, 'New muscle genetics must survive normalization');
    const edited = generate({ ...defaults, skinModel, definition }, ['otherMuscles']);
    assert.equal(edited.anatomyMetrics.length, templates.length);
    assert.ok(edited.anatomyMetrics.every(m => m.error < .02), JSON.stringify(edited.anatomyMetrics));
    for (const template of templates) {
      for (const side of ['L', 'R']) {
        const name = `${template}_${side}`, matches = m => (m.anatomicalName?.startsWith(template + '_') || groups.backMeshTemplate(m.anatomicalName ?? '') === template) && m.anatomicalName.endsWith('_' + side);
        const m = rest.meshes.otherMuscles.find(matches), next = edited.meshes.otherMuscles.find(matches);
        assert.ok(m?.shellPairs, name);
        if (side === 'R') assert.deepEqual(next.positions, m.positions, `${name} must not follow left-side genetics`);
        else assert.notDeepEqual(next.positions, m.positions, `${name} must respond to genetics`);
      }
    }
    if (process.argv.includes('--regions')) for (const upper of [false, true]) {
      const muscles = Object.fromEntries(templates.map(name => [name + '.L', { width: upper ? 1.5 : .65, depth: upper ? 1.5 : .65, volume: upper ? 2 : .5, fullness: upper ? .3 : -.3, profile: 1, activation: 1 }]));
      const extreme = generate({ ...defaults, skinModel, definition: { version: 1, muscles, bones: {} } }, ['otherMuscles']);
      assert.ok(extreme.anatomyMetrics.every(m => m.error < .02), JSON.stringify(extreme.anatomyMetrics.filter(m => m.error >= .02)));
    }
    assert.ok(!rest.meshes.otherMuscles.some(m => /^(brachioradialis|forearmFlexors|forearmExtensors)$/.test(m.anatomicalName ?? '')), 'No duplicate legacy forearm volumes');
    const skin = rest.meshes.skin[0];
    assert.deepEqual(posedPositions(skin, { ...defaults, skinModel }, normalizePose({})), skin.positions, 'Neutral pose must not rotate the arm');
    if (skinModel === 0) {
      // Area centroids of actual triangle/plane intersections avoid vertex-density bias.
      const L = JSON.parse(read('../src/anatomy/reference.json')).landmarks;
      let maximum = 0;
      for (let y = 9.2; y < 13.7; y += .2) {
        const points = [];
        for (let j = 0; j < skin.indices.length; j += 3) for (let k = 0; k < 3; k++) {
          const a = skin.indices[j + k], b = skin.indices[j + (k + 1) % 3], ay = skin.positions[a * 3 + 1], by = skin.positions[b * 3 + 1];
          if (!((ay <= y && by > y) || (by <= y && ay > y))) continue;
          const t = (y - ay) / (by - ay), mix = (a, b) => a * (1 - t) + b * t;
          const x = mix(skin.positions[a * 3], skin.positions[b * 3]);
          if (x > 1.4 && mix(skin.rig[a * 4], skin.rig[b * 4]) > .65) points.push([x, mix(skin.positions[a * 3 + 2], skin.positions[b * 3 + 2])]);
        }
        assert.ok(points.length > 8, 'Actual arm section');
        const center = [0, 1].map(k => points.reduce((sum, p) => sum + p[k], 0) / points.length);
        points.sort((a, b) => Math.atan2(a[1] - center[1], a[0] - center[0]) - Math.atan2(b[1] - center[1], b[0] - center[0]));
        let area = 0, z = 0;
        points.forEach((a, i) => { const b = points[(i + 1) % points.length], cross = a[0] * b[1] - b[0] * a[1]; area += cross; z += (a[1] + b[1]) * cross; });
        const A = y > L.elbow[1] ? L.elbow : L.wrist, B = y > L.elbow[1] ? L.shoulder : L.elbow;
        const axis = A[2] + (B[2] - A[2]) * (y - A[1]) / (B[1] - A[1]);
        maximum = Math.max(maximum, Math.abs(z / (3 * area) - axis));
      }
      assert.ok(maximum < .03, `Neutral sagittal arm deviation ${maximum * 100} mm`);
      console.log(JSON.stringify({ neutralArmDeviationMm: maximum * 100 }));
    }
    console.log(JSON.stringify({ skinModel, editableNewMuscles: edited.anatomyMetrics.length, maximumVolumeError: Math.max(...edited.anatomyMetrics.map(m => m.error)) }));
  }
  console.log('PASS: individual muscles, side isolation, saved controls and neutral arm alignment');
  process.exit(0);
}
const base = generate(defaults, []);
// Both pelvis models generate the pelvic bones.
for (const pelvisModel of [0, 1]) { const pelvis = generate({ ...defaults, pelvisModel }, ['bones']); assert.ok(pelvis.meshes.bones.some(m => m.anatomicalName === 'sacrum'), `sacrum for pelvis model ${pelvisModel}`); }
// Both abdominal wall models generate every abdominal layer.
for (const abdominalModel of [0, 1, 2]) { const wall = generate({ ...defaults, abdominalModel }, ['externalOblique', 'internalOblique', 'transversusAbdominis']); for (const key of ['externalOblique', 'internalOblique', 'transversusAbdominis']) assert.ok(wall.meshes[key]?.length === 2, `${key} for abdominal model ${abdominalModel}`); }
assert.ok(base.meshes.skin[0].indices.length > 1000);
const edited = generate({ ...defaults, chestWidth: 40, oblique: 1.8, biceps: 1.6, externalObliqueOpacity: 1, bonesOpacity: 1 }, ['externalOblique', 'bones']);
assert.notDeepEqual(base.meshes.skin[0].positions, edited.meshes.skin[0].positions);
assert.ok(edited.meshes.externalOblique.length && edited.meshes.bones.length);
assert.equal(edited.inspection.length, 5);
const fatLayer = generate({ ...defaults, adiposeOpacity: 1 }, ['adipose']);
assert.ok(fatLayer.meshes.adipose[0].positions.length > base.meshes.skin[0].positions.length);
const noFat = generate({ ...defaults, fat: 0, adiposeOpacity: 1 }, ['adipose']);
assert.equal(noFat.meshes.adipose.length, 0);
const legacy = generate({ ...defaults, skinModel: 1 }, []);
assert.ok(legacy.meshes.skin[0].indices.length > 1000);
const sixSegments = generate({ ...defaults, rectusSegmentCount: 6 }, ['rectusAbdominis']);
const eightSegments = generate({ ...defaults, rectusSegmentCount: 8 }, ['rectusAbdominis']);
assert.notEqual(sixSegments.meshes.rectusAbdominis.length, eightSegments.meshes.rectusAbdominis.length, 'Abdominal segment count must change real generated bellies');

const allMuscles = generate(defaults, ['otherMuscles']);
for (const name of ['biceps_brachii_long', 'brachialis', 'triceps_brachii_long', 'triceps_brachii_lateral']) {
  const pair = ['L', 'R'].map(side => allMuscles.meshes.otherMuscles.find(m => m.anatomicalName === `${name}_${side}`));
  assert.ok(pair.every(m => m?.shellPairs && m.rigRegion === 'arm' && m.longitudinal && m.tissue), `${name} must use the arm shell and tendon path`);
  assert.equal(pair[0].positions.length, pair[1].positions.length);
  for (let i = 0; i < pair[0].positions.length; i++)
    // Local fitting samples each side of the authored cage; allow less than 0.1 mm of fit asymmetry.
    assert.ok(Math.abs(pair[0].positions[i] - pair[1].positions[i] * (i % 3 === 0 ? -1 : 1)) < .001, `${name} must mirror at rest`);
}
assert.ok(!allMuscles.meshes.otherMuscles.some(m => /^(biceps|brachialis|tricepsLong|tricepsLateral)$/.test(m.anatomicalName ?? '')), 'Arm shells must replace the legacy ellipsoids');
const grownMuscles = generate({ ...defaults, individualGrowth: { trapeziusUpper: 1.8 } }, ['otherMuscles']);
const restTrapezius = allMuscles.meshes.otherMuscles.find(m => m.anatomicalName === 'trapezius_descending_R');
const grownTrapezius = grownMuscles.meshes.otherMuscles.find(m => m.anatomicalName === 'trapezius_descending_R');
assert.ok(restTrapezius && grownTrapezius, 'Generated muscle identity');
assert.notDeepEqual(restTrapezius.positions, grownTrapezius.positions, 'Local growth must affect actual geometry');
const { normalizePose, posedPositions, mirrorAnatomyPose } = await import('../src/anatomy/pose.ts');
const normalizedPose = normalizePose({ rElbow: 95, lKnee: Infinity });
assert.equal(normalizedPose.rightElbowFlexion, 95); assert.equal(normalizedPose.leftKneeFlexion, 0);
assert.deepEqual(mirrorAnatomyPose(mirrorAnatomyPose(normalizedPose)), normalizedPose);
assert.deepEqual(posedPositions(base.meshes.skin[0], defaults, normalizePose({})), base.meshes.skin[0].positions);
assert.notDeepEqual(posedPositions(base.meshes.skin[0], defaults, normalizedPose), base.meshes.skin[0].positions);

const asymmetric = generate({ ...defaults, definition: { version: 1, muscles: { 'rectus_abdominis.L': { width: 1.25, depth: 1.1, volume: 1.4, profile: 1 } }, bones: {} } }, ['rectusAbdominis']);
const left = result => result.meshes.rectusAbdominis.filter(m => m.anatomicalName.includes('_L_'));
const right = result => result.meshes.rectusAbdominis.filter(m => m.anatomicalName.includes('_R_'));
assert.notDeepEqual(left(asymmetric)[0].positions, left(sixSegments)[0].positions, 'Individual rectus must change real geometry');
assert.deepEqual(right(asymmetric)[0].positions, right(sixSegments)[0].positions, 'Individual rectus must preserve the other side');
assert.ok(asymmetric.anatomyMetrics[0].error < .02, 'Individual rectus must meet its volume target');

const { muscleDefaults, individualMuscles, normalizeDefinition } = await import('../src/anatomy/definition.ts');
const layers = {rectus_abdominis:'rectusAbdominis',external_oblique:'externalOblique',internal_oblique:'internalOblique',transversus_abdominis:'transversusAbdominis',pectoralis_major_clavicular:'otherMuscles',pectoralis_major_sternocostal:'otherMuscles'};
for (const name of individualMuscles) layers[name] ??= 'otherMuscles';
for (const skinModel of [0,1]) {
  const muscles = Object.fromEntries(individualMuscles.map(name => [name+'.L', {...muscleDefaults,width:1.15,volume:1.2,activation:.5}]));
  const result = generate({...defaults,skinModel,definition:{version:1,muscles,bones:{'hip_bone.L':{width:1.1,depth:1.1,height:1.05,flare:.1,acetabularAngle:10}}}},[...new Set(Object.values(layers)),'bones','adipose']);
  assert.equal(result.anatomyMetrics.length,individualMuscles.length,'Every individual muscle must be editable on both surfaces');
  for (const metric of result.anatomyMetrics) assert.ok(metric.error<.02,metric.id+' volume error '+metric.error);
}
for (const upper of [false,true]) {
  const muscles=Object.fromEntries(individualMuscles.map(name=>[name+'.L',{...muscleDefaults,width:upper?1.5:.65,depth:upper?1.5:.65,volume:upper?2:.5,fullness:upper?.3:-.3,profile:1,activation:1}]));
  const extremes=generate({...defaults,definition:{version:1,muscles,bones:{}}},[...new Set(Object.values(layers))]);
  for(const metric of extremes.anatomyMetrics) assert.ok(metric.error<.02,metric.id+' extreme volume error '+metric.error);
}
const custom = generate({...defaults,definition:{version:1,muscles:{'rectus_abdominis.L':{...muscleDefaults,intersections:[{position:.65,angle:15,curvature:.05,width:1.1,depth:.7,extent:.8}]}},bones:{}}},['rectusAbdominis','aponeuroses']);
assert.ok(custom.meshes.rectusAbdominis.some(m=>m.anatomicalName==='rectus_abdominis_L_continuous'),'Partial intersections need continuous tissue');
assert.deepEqual(right(custom)[0].positions,right(sixSegments)[0].positions,'Custom intersections preserve opposite side');

const connected = generate({...defaults,definition:{version:1,muscles:{},bones:{},interaction:{attachments:true,contact:false,clearanceMm:1}}},['rectusAbdominis','otherMuscles','bones','aponeuroses']);
assert.ok(connected.attachments?.length>=12,'Priority tissues must resolve anatomical surface-area attachments');
assert.ok(connected.attachments.every(a=>a.errorMm<.1),'Actual attachment centers must remain on their named patches');
assert.ok(connected.meshes.aponeuroses.some(m=>m.followers?.length),'Tendinous tissues must follow their actual rectus surfaces');

const contactBody = generate({...defaults,definition:{version:1,muscles:{'internal_oblique.L':{...muscleDefaults,depth:1.5,volume:1.5}},bones:{},interaction:{attachments:true,contact:true,clearanceMm:1}}},['adipose']);
assert.ok(contactBody.contacts?.length>=4,'Priority contact must compare actual tissue surfaces');
assert.ok(contactBody.contacts.some(pair=>pair.beforeMm>1),'Real body case must reproduce surface penetration');
assert.ok(contactBody.contacts.every(pair=>pair.afterMm<.2),JSON.stringify(contactBody.contacts));

assert.ok(contactBody.attachments.every(a=>a.errorMm<.1),'Contact must preserve attached endpoints');
assert.ok(contactBody.contacts.every(pair=>pair.samples>0),JSON.stringify(contactBody.contacts));
const {samplePatch,patchPoint,applyMeshAttachments,attachmentMetrics}=await import('../src/anatomy/attachmentPatches.ts');
const {solveTissueContact}=await import('../src/anatomy/tissueContact.ts');
const {applySurfaceFollowers}=await import('../src/anatomy/connective.ts');
assert.throws(()=>normalizeDefinition({version:1,interaction:{recipeVersion:99}}),/Unsupported/,'Unknown connection recipes must not silently change saved anatomy');
const refined=generate({...defaults,rectusSegmentCount:8,pubisHeight:.8,chestWidth:40,definition:{version:1,muscles:{},bones:{'hip_bone.L':{width:1.15,height:1.05,flare:.2}},interaction:{attachments:true,contact:true,clearanceMm:1,supportDetail:2}}},[]);
assert.ok(refined.attachments.every(a=>a.errorMm<.1),'Regenerated high-detail supports must keep attachments');
const oldWing=connected.meshes.bones.find(m=>m.anatomicalName==='ilium_wing_L'),newWing=refined.meshes.bones.find(m=>m.anatomicalName==='ilium_wing_L');
assert.notEqual(oldWing.positions.length,newWing.positions.length,'Actual bone topology must change');
assert.throws(()=>patchPoint(newWing,samplePatch(oldWing,.75,.01)),/Stale/,'Old triangle bindings must be rejected');
assert.ok(patchPoint(newWing,samplePatch(newWing,.75,.01)).point.every(Number.isFinite),'Semantic UV must re-resolve');
const pose=normalizePose({rightArmAbduction:75,leftHipFlexion:40,trunkRotation:15});
const actual=[...Object.values(contactBody.meshes).flat(),contactBody.contactLean];
const posed=new Map(actual.map(m=>[m,posedPositions(m,defaults,pose)]));
const surfaces=new Map(actual.filter(m=>m.anatomicalName).map(m=>[m.anatomicalName,m]));
for(const mesh of actual)applyMeshAttachments(mesh,surfaces,posed.get(mesh),posed);
const posedContact=solveTissueContact(contactBody.meshes,contactBody.meshes.skin[0],contactBody.contactLean,1,posed);
assert.ok(attachmentMetrics(actual,posed).every(a=>a.errorMm<.1),'Posed tissues must remain on posed support triangles');
assert.ok(posedContact.every(pair=>pair.afterMm<.2),'Selected pose must meet sampled clearance');
applySurfaceFollowers(actual,posed);const tendon=actual.find(m=>m.followers?.length),once=posed.get(tendon).slice();applySurfaceFollowers(actual,posed);assert.deepEqual(posed.get(tendon),once,'Connective transfer must be idempotent, including during pose replay');
const off=generate({...defaults,definition:{version:1,muscles:{'internal_oblique.L':{...muscleDefaults,depth:1.5,volume:1.5}},bones:{},interaction:{attachments:true,contact:false,clearanceMm:1}}},['adipose']);
const skinBefore=off.meshes.skin[0].positions,skinAfter=contactBody.meshes.skin[0].positions,leanBefore=off.meshes.adipose[0].positions.subarray(skinBefore.length),leanAfter=contactBody.contactLean.positions;
for(let i=0;i<skinBefore.length;i++)assert.ok(Math.abs((skinAfter[i]-skinBefore[i])-(leanAfter[i]-leanBefore[i]))<1e-5,'Contact must not invent fat thickness');
const legacyConnected=generate({...defaults,skinModel:1,definition:{version:1,muscles:{},bones:{},interaction:{attachments:true,contact:true,clearanceMm:1}}},[]);
assert.ok(legacyConnected.attachments.every(a=>a.errorMm<.1),'Procedural skin mode attachments');
assert.ok(legacyConnected.contacts.every(pair=>pair.afterMm<.2),'Procedural skin mode sampled clearance');
console.log(JSON.stringify({ authoredVertices: base.meshes.skin[0].positions.length/3, editedMs: edited.computeMs, legacyVertices: legacy.meshes.skin[0].positions.length/3, attachments:contactBody.attachments.length,contacts:contactBody.contacts,contactMs:contactBody.computeMs,status: 'passed' }));
