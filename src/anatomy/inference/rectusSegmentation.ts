import type { SurfaceBVH } from './observationProxy';
import type { Vec3M } from '../landmarks';
import { anteriorRelief, horizontalValleys, meanRelief, reliefAt, selectSequence, type ReliefGrid, type ReliefValley, type SequenceResult } from './surfaceRelief';

/**
 * Locate the rectus abdominis segmentation on a skin surface.
 *
 * Landmarks first, then grooves, then an anatomical sequence:
 * 1. Navel: the deepest midline pit (or the user's navel hint).
 * 2. Linea semilunaris: the first lateral groove, giving each rectus width.
 * 3. Inferior pectoral fold: found on columns lateral to the rectus, where the
 *    pectoral is the only belly, then followed medially. It is the upper limit
 *    of the visible rectus and is never taken as a tendinous intersection.
 * 4. Tendinous intersections: horizontal valleys across the rectus columns,
 *    chosen as an ordered sequence of two to four (three is the usual count)
 *    with regular spacing and the lowest above-umbilical one near the navel.
 *    Weak valleys survive when they agree with the strong ones; boundaries
 *    without a visible valley are inferred on the spacing line, never on a
 *    belly crest.
 *
 * Evidence is normalized by the relief of the abdomen itself, so a lean,
 * hypertrophied abdomen and a smoother one are judged by contrast, not by
 * millimetres. A smooth abdomen gives low gains: the sequence then follows the
 * anatomical prior and the reported confidence is low.
 */
export interface RectusSideSegmentation {
  /** Lateral rectus border (linea semilunaris) from the midline, canonical metres. */
  width: number;
  /** Measured lateral border [height, distance from the midline] between the navel and the fold. */
  border: [number, number][];
  /** Inferior pectoral fold height at the medial and lateral rectus columns. */
  fold: [number, number];
  intersections: { y: number; observed: boolean; prominenceMm: number; support: number; angleDeg: number; bow: number; confidence: number }[];
  candidates: { y: number; prominenceMm: number; support: number }[];
  score: number;
}
export interface RectusSegmentation {
  navel: { y: number; source: 'hint' | 'relief' | 'prior'; depthMm: number };
  reliefScaleMm: number;
  sides: Partial<Record<'L' | 'R', RectusSideSegmentation>>;
}

const countPrior = [{ count: 2, logPrior: -.8 }, { count: 3, logPrior: 0 }, { count: 4, logPrior: -1.2 }];

function findNavel(grid: ReliefGrid, hint?: Vec3M): RectusSegmentation['navel'] {
  if (hint) return { y: hint[1], source: 'hint', depthMm: reliefAt(grid, hint[0], hint[1]) };
  let best = { y: 1.09, depth: 0 };
  for (let y = .95; y <= 1.2; y += grid.step) {
    const depth = Math.min(reliefAt(grid, -.004, y), reliefAt(grid, 0, y), reliefAt(grid, .004, y));
    if (depth < best.depth) best = { y, depth };
  }
  return best.depth < -2.5 ? { y: best.y, source: 'relief', depthMm: best.depth } : { y: 1.09, source: 'prior', depthMm: best.depth };
}

function median(values: number[], fallback: number) {
  if (!values.length) return fallback;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

/** The first clear vertical groove lateral to the rectus belly at one height. */
function semilunaris(grid: ReliefGrid, side: number, y: number) {
  for (let x = .06; x <= .14; x += grid.step) {
    const v = reliefAt(grid, side * x, y);
    if (v < reliefAt(grid, side * (x - grid.step), y) && v <= reliefAt(grid, side * (x + grid.step), y) &&
      Math.min(reliefAt(grid, side * (x - .016), y), reliefAt(grid, side * (x + .016), y)) - v > .8) return x;
  }
}

function rectusWidth(grid: ReliefGrid, side: number, navel: number) {
  const found: number[] = [];
  for (let y = navel - .03; y <= navel + .10; y += .008) { const x = semilunaris(grid, side, y); if (x !== undefined) found.push(x); }
  return Math.max(.06, Math.min(.13, median(found, .085)));
}

/** Lateral border by height, smoothed over 2 cm bands; rows without a groove are skipped. */
function rectusBorder(grid: ReliefGrid, side: number, from: number, to: number): [number, number][] {
  const out: [number, number][] = [];
  for (let y = from; y <= to; y += .02) {
    const found: number[] = [];
    for (let t = y - .008; t <= y + .008; t += grid.step) { const x = semilunaris(grid, side, t); if (x !== undefined) found.push(x); }
    if (found.length >= 3) out.push([y, median(found, 0)]);
  }
  // Reject isolated rows where the first minimum jumped to a different
  // groove, commonly the costal margin near the top of the abdomen.
  return out.filter(([y, x], i) => out.some(([otherY, otherX], j) => {
    const gap = Math.abs(otherY - y);
    return i !== j && gap <= .045 && Math.abs(otherX - x) <= .008 + .6 * gap;
  }));
}

function pectoralFold(grid: ReliefGrid, side: number, navel: number, columns: number[]): [number, number] {
  const lateral = [.10, .115, .13].map(x => {
    let peak = -Infinity, y = navel + .2;
    for (let t = navel + .14; t <= navel + .32; t += grid.step) { const v = reliefAt(grid, side * x, t); if (v > peak) { peak = v; y = t; } }
    while (y > navel + .08 && reliefAt(grid, side * x, y - grid.step) <= reliefAt(grid, side * x, y) + .15) y -= grid.step;
    return y;
  });
  const start = median(lateral, navel + .17);
  const folds = columns.map(x => {
    let lowest = Infinity, y = start;
    for (let t = start - .005; t <= start + .05; t += grid.step) { const v = reliefAt(grid, x, t); if (v < lowest) { lowest = v; y = t; } }
    return y;
  });
  return [folds[0], folds[folds.length - 1]];
}

export function segmentRectus(target: SurfaceBVH, navelHint?: Vec3M): RectusSegmentation {
  const grid = anteriorRelief(target, -.17, .17, .9, 1.42);
  const navel = findNavel(grid, navelHint);
  const sides: RectusSegmentation['sides'] = {};
  const perSide: { key: 'L' | 'R'; side: number; width: number; fold: [number, number]; columns: number[]; valleys: ReliefValley[]; results: SequenceResult[] }[] = [];
  const scales: number[] = [];
  for (const [key, side] of [['L', -1], ['R', 1]] as const) {
    const width = rectusWidth(grid, side, navel.y);
    const columns = [.2, .35, .5, .65, .8].map(f => side * (.008 + f * (width - .008)));
    const fold = pectoralFold(grid, side, navel.y, columns);
    const top = Math.min(...fold) - .012;
    const valleys = horizontalValleys(grid, columns, navel.y - .08, Math.min(...fold))
      .filter(valley => valley.support > 0);
    for (let y = navel.y - .06; y <= top; y += grid.step) scales.push(Math.abs(meanRelief(grid, columns, y)));
    perSide.push({ key, side, width, fold, columns, valleys, results: [] });
  }
  // Physique normalization: the typical relief amplitude of this abdomen.
  const scale = Math.max(.8, median(scales, 1.5));
  for (const s of perSide) {
    const top = Math.min(...s.fold) - .012, ruler = navel.y;
    s.results = selectSequence(s.valleys, {
      counts: countPrior, top, bottom: navel.y - .065,
      gap: { min: .03, max: .085, prior: Math.max(.04, Math.min(.065, (top - navel.y) / 3)), sigma: .012 },
      anchor: count => ({ slot: count === 4 ? 2 : count - 1, y: ruler + .015, sigma: .025 }),
      gain: valley => Math.min(3, valley.prominence / (.45 * scale)) * (.25 + .75 * valley.support),
      // An inferred boundary costs less in a flat or concave band than on a belly crest.
      missing: y => .35 - Math.max(0, meanRelief(grid, s.columns, y)) / scale,
    });
  }
  // Both sides usually share the count; pick the count with the best joint score.
  const joint = new Map<number, number>();
  for (const s of perSide) for (const r of s.results) joint.set(r.count, (joint.get(r.count) ?? 0) + r.score);
  const counts = [...joint].filter(([count]) => perSide.every(s => s.results.some(r => r.count === count)));
  const shared = counts.sort((a, b) => b[1] - a[1])[0]?.[0];
  for (const s of perSide) {
    const result = s.results.find(r => r.count === shared) ?? s.results[0];
    if (!result) continue;
    sides[s.key] = {
      width: s.width, fold: s.fold, score: result.score,
      // Below the navel the first lateral groove is the inguinal region, not the rectus border.
      border: rectusBorder(grid, s.side, navel.y - .04, Math.min(...s.fold) - .02),
      candidates: s.valleys.map(v => ({ y: v.y, prominenceMm: v.prominence, support: v.support })),
      intersections: result.slots.map(slot => ({
        y: slot.y, observed: !!slot.valley, prominenceMm: slot.valley?.prominence ?? 0, support: slot.valley?.support ?? 0,
        angleDeg: slot.valley && slot.valley.support >= .6 ? Math.max(-12, Math.min(12, Math.atan(slot.valley.slope) * 180 / Math.PI)) : 0,
        bow: slot.valley?.bow ?? 0,
        confidence: slot.valley ? Math.max(0, Math.min(1, slot.gain / 2)) : 0,
      })),
    };
  }
  return { navel, reliefScaleMm: scale, sides };
}
