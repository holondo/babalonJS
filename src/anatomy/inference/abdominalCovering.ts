import type { AnatomyMesh } from '../contracts';
import type { AnatomyParameters } from '../parameters';
import { canonicalAnatomyFactors } from '../binding/anatomySkinDrive';
import { normalizePose, posedPositions } from '../pose';
import { abdominalDepthGrid, abdominalDepthLimitMm } from '../surfaceFit';
import { SurfaceBVH } from './observationProxy';
import { anteriorRelief } from './surfaceRelief';

const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

/** Fit the visible belly in its posed frame, after the low-resolution skin registration. */
export function fitAbdominalCovering(p: AnatomyParameters, skin: AnatomyMesh, muscles: AnatomyMesh[], target: SurfaceBVH) {
  const field = p.skinFit;
  if (!field || !p.referencePose?.enabled) return;
  const { lateral, vertical } = canonicalAnatomyFactors(p.height);
  const zero = normalizePose({});
  const surface = (mesh: AnatomyMesh) => new SurfaceBVH({
    positions: posedPositions(mesh, p, zero).map((value, i) => value * (i % 3 === 1 ? vertical : lateral)),
    indices: mesh.indices,
  });
  const before = surface(skin), internal = muscles.map(surface);
  const anterior = (bvh: SurfaceBVH, x: number, y: number) =>
    bvh.queryRay([x, y, .6], [0, 0, -1], .545)?.point[2];
  const muscleDepth = (x: number, y: number) => Math.max(...internal.map(bvh => anterior(bvh, x, y) ?? -Infinity));
  const { x, y, step, columns, rows } = abdominalDepthGrid;
  const grid = Array.from({ length: columns * rows }, (_, i) => {
    const col = i % columns, row = Math.floor(i / columns), px = x + col * step, py = y + row * step;
    const weight = smooth(Math.min(col, columns - 1 - col) / 4) * smooth((row - 1) / 4) *
      smooth((rows - 1 - row) / 4);
    if (!weight) return 0;
    const source = anterior(before, px, py), observed = anterior(target, px, py);
    if (source === undefined || observed === undefined || Math.abs(observed - source) > .045) return 0;
    const lowerBound = Math.min(0, (muscleDepth(px, py) + .001 - source) * 1000);
    const correction = Math.max(-abdominalDepthLimitMm, lowerBound,
      Math.min(abdominalDepthLimitMm, (observed - source) * 1000));
    return Math.round(weight * correction * 10) / 10;
  });

  // Validate against the actual tessellated skin at locations between the
  // fitted nodes. Check relief separately so improving bulk alone cannot pass.
  const validation = (mesh: SurfaceBVH) => anteriorRelief(mesh, -.125, .125, 1.045, 1.245, .01, .005, .019);
  const observed = validation(target), original = validation(before);
  const exposed = Array.from(observed.depth, (_, i) =>
    muscleDepth(observed.x0 + i % observed.nx * observed.step, observed.y0 + Math.floor(i / observed.nx) * observed.step));
  const scores = (after: ReturnType<typeof validation>) => {
    let count = 0, beforeDepth = 0, afterDepth = 0, beforeRelief = 0, afterRelief = 0, crossings = 0;
    for (let i = 0; i < observed.depth.length; i++) {
      if (![observed.depth[i], original.depth[i], after.depth[i]].every(Number.isFinite)) continue;
      count++;
      beforeDepth += Math.abs(observed.depth[i] - original.depth[i]) * 1000;
      afterDepth += Math.abs(observed.depth[i] - after.depth[i]) * 1000;
      beforeRelief += Math.abs(observed.relief[i] - original.relief[i]);
      afterRelief += Math.abs(observed.relief[i] - after.relief[i]);
      if (exposed[i] - after.depth[i] > .002 && after.depth[i] < original.depth[i] - .001) crossings++;
    }
    const n = Math.max(1, count);
    return { samples: count, beforeDepthMm: beforeDepth / n, afterDepthMm: afterDepth / n,
      beforeReliefMm: beforeRelief / n, afterReliefMm: afterRelief / n, crossings };
  };
  for (const strength of [1, .65]) {
    field.abdominalDepth = grid.map(value => value * strength);
    const result = scores(validation(surface(skin)));
    if (result.samples >= 400 && !result.crossings && result.afterDepthMm + .2 < result.beforeDepthMm &&
      result.afterReliefMm + .05 < result.beforeReliefMm) return result;
  }
  delete field.abdominalDepth;
}
