import type { AnatomyMesh } from '../contracts';
import type { Vec3M } from '../landmarks';
import type { AnatomyParameters } from '../parameters';
import { canonicalAnatomyFactors } from '../binding/anatomySkinDrive';
import { normalizePose, posedPositions } from '../pose';
import { fittedNavelFor, rebuildSkinFeatures } from '../skinFeatures';
import { abdominalFlankGrid, abdominalDepthLimitMm, navelDetailGrid, navelDetailPlane, navelGrid } from '../surfaceFit';
import { SurfaceBVH } from './observationProxy';

const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};
const mm = (value: number) => Math.round(value * 10000) / 10;
const front = (surface: SurfaceBVH, x: number, y: number) => surface.queryRay([x, y, .55], [0, 0, -1], .49)?.point[2];

function findNavel(target: SurfaceBVH, expectedY: number, hint?: Vec3M) {
  let best = .0018, center: { x: number; y: number } | undefined;
  for (let row = -15; row <= 15; row++) for (let col = -12; col <= 12; col++) {
    const x = col * .002, y = expectedY + row * .002, depth = front(target, x, y);
    if (depth === undefined) continue;
    const sides = [-.011, .011].map(d => front(target, x + d, y));
    const levels = [-.009, .009].map(d => front(target, x, y + d));
    if ([...sides, ...levels].some(value => value === undefined)) continue;
    // A midline groove is long, and a tendinous groove is wide. A navel
    // has localized depth contrast in both directions.
    const side = Math.min(sides[0]!, sides[1]!) - depth;
    const vertical = (levels[0]! + levels[1]!) * .5 - depth;
    const score = Math.min(side, vertical) - .045 * Math.abs(x);
    if (score > best) { best = score; center = { x, y }; }
  }
  if (hint) center = { x: hint[0], y: hint[1] };
  if (!center || Math.abs(center.x) > .055 || center.y < .99 || center.y > 1.20) return;
  const { x, y } = center, depth = front(target, x, y);
  if (depth === undefined) return;
  const halfWidth = (dx: number, dy: number) => {
    let distance = .004;
    while (distance < .014) {
      const sample = front(target, x + dx * distance, y + dy * distance);
      if (sample === undefined || sample - depth > Math.max(.0012, best * .55)) break;
      distance += .002;
    }
    return distance;
  };
  const radius = (halfWidth(-1, 0) + halfWidth(1, 0)) * .5;
  const aspect = Math.max(.4, Math.min(1.8, (halfWidth(0, -1) + halfWidth(0, 1)) * .5 / radius));
  return { x, y, radius, aspect };
}

/** Match the flank from lateral rays, and the navel from a separate fine anterior patch. */
export function fitAbdominalDetails(p: AnatomyParameters, skin: AnatomyMesh, muscles: AnatomyMesh[], target: SurfaceBVH,
  expectedNavelY: number, hint?: Vec3M) {
  const field = p.skinFit;
  if (!field || !p.referencePose?.enabled) return;
  const { lateral, vertical } = canonicalAnatomyFactors(p.height), zero = normalizePose({});
  const surface = (mesh: AnatomyMesh) => {
    const positions = posedPositions(mesh, p, zero);
    if (mesh.skinFeatures) rebuildSkinFeatures(mesh, positions, p);
    return new SurfaceBVH({ positions: positions.map((value, i) => value * (i % 3 === 1 ? vertical : lateral)), indices: mesh.indices });
  };
  const internal = muscles.map(surface);
  const { angle, angleStep, y, step, columns, rows } = abdominalFlankGrid;
  const radius = (bvh: SurfaceBVH, sign: number, a: number, h: number) => {
    const dx = sign * Math.sin(a), dz = Math.cos(a);
    const hit = bvh.queryRay([.31 * dx, h, .31 * dz], [-dx, 0, -dz], .22);
    return hit && .31 - hit.distance;
  };
  const before = surface(skin), flankSamples: { sign: number; a: number; h: number; source: number; observed: number; muscle: number }[] = [];
  const flankGrid: number[] = [];
  const flankNodes: { sign: number; a: number; h: number; weight: number; observed: number | undefined; floor: number }[] = [];
  for (const sign of [-1, 1]) for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const a = angle + col * angleStep, h = y + row * step;
    const weight = smooth(Math.min(col, columns - 1 - col) / 3) * smooth(Math.min(row, rows - 1 - row) / 4);
    const source = radius(before, sign, a, h), observed = radius(target, sign, a, h);
    const muscle = Math.max(...internal.map(bvh => radius(bvh, sign, a, h) ?? -Infinity));
    const usable = source !== undefined && observed !== undefined && Math.abs(observed - source) <= .045;
    const floor = source === undefined ? 0 : Math.min(0, (muscle + .001 - source) * 1000);
    const delta = !usable ? 0 :
      Math.max(-abdominalDepthLimitMm, floor,
        Math.min(abdominalDepthLimitMm, (observed - source) * 1000));
    flankNodes.push({ sign, a, h, weight, observed: usable ? observed : undefined, floor });
    flankGrid.push(Math.round(weight * delta * 10) / 10);
    if (row < 2 || row >= rows - 2 || col < 1 || col >= columns - 1) continue;
    const va = a + angleStep * .5, vh = h + step * .5;
    const from = radius(before, sign, va, vh), to = radius(target, sign, va, vh);
    if (from === undefined || to === undefined) continue;
    flankSamples.push({ sign, a: va, h: vh, source: from, observed: to,
      muscle: Math.max(...internal.map(bvh => radius(bvh, sign, va, vh) ?? -Infinity)) });
  }
  let flanks: { samples: number; beforeMm: number; afterMm: number } | undefined;
  const flankError = (trial: SurfaceBVH) => {
    let count = 0, beforeError = 0, afterError = 0, transition = 0, crossings = 0;
    for (const sample of flankSamples) {
      const value = radius(trial, sample.sign, sample.a, sample.h);
      if (value === undefined) continue;
      count++;
      beforeError += Math.abs(sample.observed - sample.source);
      afterError += Math.abs(sample.observed - value);
      if (sample.a < angle + 5 * angleStep) transition += Math.abs(sample.observed - value);
      if (sample.muscle - value > .002 && value < sample.source - .001) crossings++;
    }
    return { count, beforeError, afterError, transition, crossings };
  };
  for (const strength of [1, .65]) {
    const first = flankGrid.map(value => value * strength);
    field.abdominalFlanks = first;
    const trial = surface(skin);
    const initial = flankError(trial);
    if (initial.count >= 300 && !initial.crossings && initial.beforeError - initial.afterError > initial.count * .0002) {
      field.abdominalFlanks = flankNodes.map((node, i) => {
        if (!node.weight || node.observed === undefined) return first[i];
        const fitted = radius(trial, node.sign, node.a, node.h);
        if (fitted === undefined) return first[i];
        const correction = first[i] + .75 * node.weight * (node.observed - fitted) * 1000;
        return Math.round(Math.max(-abdominalDepthLimitMm, node.floor, Math.min(abdominalDepthLimitMm, correction)) * 10) / 10;
      });
      const next = flankError(surface(skin));
      const improved = next.count === initial.count && !next.crossings &&
        next.afterError < initial.afterError && next.transition <= initial.transition;
      if (!improved) field.abdominalFlanks = first;
      const chosen = improved ? next : initial;
      flanks = { samples: chosen.count, beforeMm: mm(chosen.beforeError / chosen.count), afterMm: mm(chosen.afterError / chosen.count) };
      break;
    }
  }
  if (!flanks) delete field.abdominalFlanks;

  const center = findNavel(target, expectedNavelY, hint);
  if (!center) return { flanks };
  const authored = surface(skin), { radius: extent, step: spacing, size, limitMm } = navelGrid;
  field.fittedNavel = { ...center, depth: new Array<number>(size * size).fill(0) };
  if (!fittedNavelFor(p)) {
    delete field.fittedNavel;
    return { flanks };
  }
  const flat = surface(skin);
  field.fittedNavel.depth = field.fittedNavel.depth.map((_, i) => {
    const x = (i % size) * spacing - extent, y = Math.floor(i / size) * spacing - extent;
    const weight = smooth((extent - Math.max(Math.abs(x), Math.abs(y))) / .012);
    const from = front(flat, center.x + x, center.y + y), to = front(target, center.x + x, center.y + y);
    if (from === undefined || to === undefined) return 0;
    return mm(weight * Math.max(-limitMm / 1000, Math.min(limitMm / 1000, to - from)));
  });
  const navelError = (trial: SurfaceBVH) => {
    let samples = 0, beforeError = 0, afterError = 0, crossings = 0;
    for (let row = -6; row < 6; row++) for (let col = -6; col < 6; col++) {
      const x = center.x + (col + .5) * spacing, y = center.y + (row + .5) * spacing;
      const source = front(authored, x, y), observed = front(target, x, y), fitted = front(trial, x, y);
      if (source === undefined || observed === undefined || fitted === undefined) continue;
      samples++;
      beforeError += Math.abs(observed - source);
      afterError += Math.abs(observed - fitted);
      const muscle = Math.max(...internal.map(bvh => front(bvh, x, y) ?? -Infinity));
      if (muscle - fitted > .002 && fitted < source - .001) crossings++;
    }
    return { samples, beforeError, afterError, crossings };
  };
  const trial = surface(skin);
  let { samples, beforeError, afterError, crossings } = navelError(trial);
  if (samples >= 100 && !crossings && beforeError - afterError > samples * .00025) {
    const first = field.fittedNavel.depth;
    field.fittedNavel.depth = first.map((value, i) => {
      const x = (i % size) * spacing - extent, y = Math.floor(i / size) * spacing - extent;
      const weight = smooth((extent - Math.max(Math.abs(x), Math.abs(y))) / .012);
      const from = front(trial, center.x + x, center.y + y), to = front(target, center.x + x, center.y + y);
      if (from === undefined || to === undefined) return value;
      return Math.max(-limitMm, Math.min(limitMm, value + mm(.6 * weight * (to - from))));
    });
    const next = navelError(surface(skin));
    if (next.samples === samples && !next.crossings && next.afterError < afterError) afterError = next.afterError;
    else field.fittedNavel.depth = first;
    const sample = (x: number, y: number) => front(target, center.x + x, center.y + y);
    const plane = navelDetailPlane(sample);
    if (plane) {
      const { radius, size, step, limitMm } = navelDetailGrid;
      const detail = Array.from({ length: size ** 2 }, (_, i) => {
        const x = (i % size) * step - radius, y = Math.floor(i / size) * step - radius;
        const z = sample(x, y);
        return z === undefined ? NaN : mm(z - plane(x, y));
      });
      if (detail.every(value => Number.isFinite(value) && Math.abs(value) <= limitMm)) field.fittedNavel.detail = detail;
    }
    return { flanks, navel: { ...center, samples, beforeMm: mm(beforeError / samples), afterMm: mm(afterError / samples) } };
  }
  delete field.fittedNavel;
  return { flanks };
}
