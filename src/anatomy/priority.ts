import { isOriginalAbdomen, type AnatomyParameters } from './parameters';
import type { AnatomyMesh } from './contracts';
import { transferGeneticSurface } from './bodyGeneticSurface';
import { forearmMuscles, individualMuscles, normalizeDefinition, type MuscleId, type MuscleTemplate } from './definition';
import { shapeMuscle, type AnatomyMetric, type SurfaceChange } from './regions/abdomen';
import { calculateNormals } from './algorithms/loft';
import { deformPelvis } from './regions/pelvis';
import { attachPriorityTissues } from './attachmentPatches';
import { bindRectusFollowers } from './connective';
import { backMeshTemplate, posteriorMuscles } from './muscleGroups';
import { rectusGrowthExposure } from './geometry';

export function priorityLayers(p: AnatomyParameters): string[] {
  const definition = normalizeDefinition(p.definition); if (!definition) return [];
  const layers = new Set<string>();
  if (definition.interaction?.skinFollows) for (const layer of ['rectusAbdominis', 'externalOblique', 'otherMuscles']) layers.add(layer);
  if (definition.interaction?.attachments || definition.interaction?.contact) for (const layer of ['bones', 'aponeuroses', 'inguinalLigaments', 'rectusAbdominis', 'externalOblique', 'internalOblique', 'transversusAbdominis', 'otherMuscles']) layers.add(layer);
  if (Object.keys(definition.bones).length) layers.add('bones');
  for (const id of Object.keys(definition.muscles)) {
    if (id.startsWith('rectus_abdominis.')) layers.add('rectusAbdominis');
    else if (id.startsWith('external_oblique.')) layers.add('externalOblique');
    else if (id.startsWith('internal_oblique.')) layers.add('internalOblique');
    else if (id.startsWith('transversus_abdominis.')) layers.add('transversusAbdominis');
    else layers.add('otherMuscles');
  }
  return [...layers];
}
const layerTemplates: Record<string, MuscleTemplate> = { rectusAbdominis: 'rectus_abdominis', externalOblique: 'external_oblique', internalOblique: 'internal_oblique', transversusAbdominis: 'transversus_abdominis' };
/** Generated mesh name → individual muscle template. */
const meshTemplates: [RegExp, MuscleTemplate][] = [
  [/^pectoralis_major_clav_/, 'pectoralis_major_clavicular'], [/^pectoralis_major_(stern|cost)_/, 'pectoralis_major_sternocostal'],
  [/^deltoidAnterior$/, 'deltoid_anterior'],
  [/^deltoidMiddle$/, 'deltoid_middle'],
  [/^deltoidPosterior$/, 'deltoid_posterior'],
  [/^(biceps$|biceps_brachii_long_)/, 'biceps_brachii_long'],
  [/^biceps_brachii_short_/, 'biceps_brachii_short'],
  [/^brachialis($|_)/, 'brachialis'],
  [/^(tricepsLong$|triceps_brachii_long_)/, 'triceps_brachii_long'],
  [/^(tricepsLateral$|triceps_brachii_lateral_)/, 'triceps_brachii_lateral'],
  [/^triceps_brachii_medial_/, 'triceps_brachii_medial'],
  ...forearmMuscles.map(template => [new RegExp(`^${template}_[LR]$`), template] as [RegExp, MuscleTemplate]),
  [/^gluteus_maximus_/, 'gluteus_maximus'],
  [/^gluteus_medius_/, 'gluteus_medius'],
  [/^gluteus_minimus_/, 'gluteus_minimus'],
  [/^tensor_fasciae_latae_/, 'tensor_fasciae_latae'],
  [/^rectusFemoris$/, 'rectus_femoris'],
  [/^psoas_major_/, 'psoas_major'],
  [/^iliacus$/, 'iliacus'],
  [/^sartorius_/, 'sartorius'],
  [/^pectineus$/, 'pectineus'],
  [/^gracilis$/, 'gracilis'],
  [/^adductorBrevis$/, 'adductor_brevis'],
  [/^vastusLateralis$/, 'vastus_lateralis'],
  [/^vastusMedialis$/, 'vastus_medialis'],
  [/^adductorLongus$/, 'adductor_longus'],
  [/^adductorMagnus$/, 'adductor_magnus_adductor'],
  [/^bicepsFemoris$/, 'biceps_femoris_long'],
  [/^semitendinosus$/, 'semitendinosus'],
  [/^semimembranosus$/, 'semimembranosus'],
  [/^gastrocnemiusMedial$/, 'gastrocnemius_medial'],
  [/^gastrocnemiusLateral$/, 'gastrocnemius_lateral'],
  [/^soleus$/, 'soleus'],
  [/^tibialisAnterior$/, 'tibialis_anterior'],
];
const namedMuscleTemplates = [...individualMuscles].sort((a, b) => b.length - a.length);
function meshId(layer: string, mesh: AnatomyMesh): MuscleId | undefined {
  const name = mesh.anatomicalName ?? '';
  let x = 0; for (let i = 0; i < mesh.positions.length; i += 3) x += mesh.positions[i];
  const side = x < 0 ? 'L' : 'R';
  const template = layerTemplates[layer] ?? (backMeshTemplate(name) as MuscleTemplate | undefined) ?? meshTemplates.find(([pattern]) => pattern.test(name))?.[1] ?? namedMuscleTemplates.find(template => name.startsWith(template + '_'));
  return template ? `${template}.${side}` : undefined;
}
/** A bounded rest-space transfer; contact-aware tissue support is a later independent stage. */
export function transferSurface(skin: AnatomyMesh, changes: SurfaceChange[], p: AnatomyParameters, blendSternum = false) {
  type Cell = { x: number; y: number; z: number; dx: number; dy: number; dz: number; posterior: boolean; rectus: boolean; count: number };
  const size = .5, radius = .75, grid = new Map<string, Cell>();
  const original = isOriginalAbdomen(p);
  const posteriorGrid: typeof grid = new Map(), rectusGrid: typeof grid = new Map(), grids = [grid, posteriorGrid, rectusGrid];
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  for (const change of changes) for (let i = 0; i < change.source.length; i += 3) {
    if (change.normals[i + 2] * (change.posterior && !original ? -1 : 1) < .25) continue;
    const x = change.source[i], y = change.source[i + 1], z = change.source[i + 2];
    const id = key(Math.floor(x / size), Math.floor(y / size), Math.floor(z / size));
    const cells = original ? grid : change.posterior ? posteriorGrid : change.rectus ? rectusGrid : grid;
    let cell = cells.get(id); if (!cell) { cell = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0, posterior: !original && !!change.posterior, rectus: !original && !!change.rectus, count: 0 }; cells.set(id, cell); }
    cell.x += x; cell.y += y; cell.z += z; cell.dx += change.target[i] - x; cell.dy += change.target[i + 1] - y; cell.dz += change.target[i + 2] - z; cell.count++;
  }
  for (const cells of grids) for (const cell of cells.values()) for (const axis of ['x', 'y', 'z', 'dx', 'dy', 'dz'] as const) cell[axis] /= cell.count;
  const active = grids.filter(cells => cells.size > 0);
  if (!active.length) {
    if (changes.length) skin.normals = calculateNormals(skin.positions, skin.indices);
    return;
  }
  const neighbourhoods = new Map<string, Cell[]>();
  const smooth = (a: number, b: number, v: number) => {
    const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  for (let i = 0; i < skin.positions.length; i += 3) {
    const x = skin.positions[i], y = skin.positions[i + 1], z = skin.positions[i + 2];
    const bx = Math.floor(x / size), by = Math.floor(y / size), bz = Math.floor(z / size);
    const voxel = key(bx, by, bz);
    let candidates = neighbourhoods.get(voxel);
    if (!candidates) {
      candidates = [];
      for (const cells of active) for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        const cell = cells.get(key(bx + a, by + b, bz + c));
        if (cell) candidates.push(cell);
      }
      neighbourhoods.set(voxel, candidates);
    }
    let dx = 0, dy = 0, dz = 0, weight = 0;
    // The fitted pectoral heads can move in opposite directions. Blend
    // their skin influence across the sternum instead of switching at x=0.
    const sternum = blendSternum && Math.abs(x) < .25 && z > .5
      ? smooth(12.2, 12.55, y) * (1 - smooth(14.25, 14.65, y)) * smooth(.5, .8, z) : 0;
    for (const cell of candidates) {
      if (cell.posterior && skin.normals[i + 2] >= 0) continue;
      const sameSide = x * cell.x > 0;
      const blend = !cell.posterior && !cell.rectus ? sternum : 0;
      const side = (sameSide ? 1 - blend : 0) + blend * smooth(-.25, .25, x * Math.sign(cell.x));
      if (!side) continue;
      const distance = Math.hypot(x - cell.x, y - cell.y, z - cell.z); if (distance >= radius) continue;
      const w = side * (1 - distance / radius) ** 2 * (cell.rectus ? rectusGrowthExposure(p, x, y) : 1);
      dx += cell.dx * w; dy += cell.dy * w; dz += cell.dz * w; weight += w;
    }
    if (!weight) continue;
    const norm = Math.max(1, weight), scale = Math.min(1, .25 / (Math.hypot(dx, dy, dz) / norm || 1));
    skin.positions[i] += dx / norm * scale; skin.positions[i + 1] += dy / norm * scale; skin.positions[i + 2] += dz / norm * scale;
  }
  if (changes.length) skin.normals = calculateNormals(skin.positions, skin.indices);
}
export function applyPriorityAnatomy(p: AnatomyParameters, inside: Record<string, AnatomyMesh[]>, skin: AnatomyMesh, lean?: AnatomyMesh): AnatomyMetric[] {
  if (p.abdominalModel === 1) bindRectusFollowers(inside, false, p);
  const definition = normalizeDefinition(p.definition); if (!definition) return [];
  if (Object.keys(definition.bones).length) {
    for (const meshes of Object.values(inside)) for (const mesh of meshes) deformPelvis(mesh, p, definition);
    deformPelvis(skin, p, definition);
    if (lean) deformPelvis(lean, p, definition);
  }
  const originals = new Map<AnatomyMesh, { positions: Float32Array; normals: Float32Array }>();
  if (definition.interaction?.attachments) {
    if (p.abdominalModel !== 1) bindRectusFollowers(inside, isOriginalAbdomen(p));
    for (const [layer, meshes] of Object.entries(inside)) if (layer !== 'bones') for (const mesh of meshes) originals.set(mesh, { positions: mesh.positions.slice(), normals: mesh.normals });
    attachPriorityTissues(inside);
    for (const mesh of originals.keys()) if (mesh.attachments) mesh.normals = calculateNormals(mesh.positions, mesh.indices);
  }
  const groups = new Map<MuscleId, AnatomyMesh[]>();
  for (const [layer, meshes] of Object.entries(inside)) for (const mesh of meshes) {
    const id = meshId(layer, mesh); if (!id) continue;
    mesh.anatomyId = id;
    if (!definition.muscles[id]) continue;
    const group = groups.get(id) ?? []; group.push(mesh); groups.set(id, group);
  }
  const metrics: AnatomyMetric[] = [], changes: SurfaceChange[] = [];
  for (const [id, meshes] of groups) { const result = shapeMuscle(meshes, id, definition.muscles[id]!, p); metrics.push(result.metric); changes.push(...result.changes); }
  if (originals.size) {
    changes.length = 0;
    for (const [mesh, original] of originals) if (mesh.attachments || mesh.anatomyId) changes.push({ source: original.positions, target: mesh.positions, normals: original.normals, posterior: posteriorMuscles.has(mesh.anatomyId?.slice(0, -2) ?? ''), rectus: mesh.anatomyId?.startsWith('rectus_abdominis.') });
  }
  if (definition.genetics) {
    const rectus = changes.filter(change => change.rectus), body = changes.filter(change => !change.rectus);
    transferSurface(skin, rectus, p);
    transferGeneticSurface(skin, body);
    if (lean) { transferSurface(lean, rectus, p); transferGeneticSurface(lean, body); }
  } else {
    transferSurface(skin, changes, p);
    if (lean) transferSurface(lean, changes, p);
  }
  return metrics;
}
