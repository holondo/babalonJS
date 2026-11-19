import type { SurfaceBVH } from './observationProxy';

/**
 * Surface relief: the small-scale shape that superficial muscles, tendons and
 * fascial grooves leave on the skin, separated from the body's overall form.
 *
 * Anterior depth is sampled on a regular canonical grid and band-passed with a
 * difference of Gaussians. Valleys of the result are candidate fascial
 * boundaries (tendinous intersections, linea alba, linea semilunaris, the
 * inferior pectoral fold); ridges are muscle bellies. The band keeps grooves of
 * roughly one to four centimetres and removes both triangle noise and the
 * torso's curvature, so the same thresholds hold for lean and soft physiques.
 */
export interface ReliefGrid {
  x0: number; y0: number; step: number; nx: number; ny: number;
  /** Anterior depth (canonical z, metres), NaN where the ray missed. */
  depth: Float32Array;
  /** Band-passed relief in millimetres, positive on bellies and negative in grooves. */
  relief: Float32Array;
}

function blur(values: Float32Array, nx: number, ny: number, step: number, sigma: number) {
  const radius = Math.ceil(3 * sigma / step), kernel: number[] = [];
  for (let i = -radius; i <= radius; i++) kernel.push(Math.exp(-.5 * (i * step / sigma) ** 2));
  const pass = (source: Float32Array, dx: number, dy: number) => {
    const out = new Float32Array(source.length).fill(NaN);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      let sum = 0, weight = 0;
      for (let t = -radius; t <= radius; t++) {
        const ii = i + t * dx, jj = j + t * dy;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const value = source[jj * nx + ii];
        if (Number.isNaN(value)) continue;
        sum += value * kernel[t + radius]; weight += kernel[t + radius];
      }
      if (weight > 0) out[j * nx + i] = sum / weight;
    }
    return out;
  };
  return pass(pass(values, 1, 0), 0, 1);
}

/** Front relief of the target between two canonical corners. */
export function anteriorRelief(target: SurfaceBVH, x0: number, x1: number, y0: number, y1: number,
  step = .004, fine = .003, coarse = .02): ReliefGrid {
  const nx = Math.round((x1 - x0) / step) + 1, ny = Math.round((y1 - y0) / step) + 1;
  const depth = new Float32Array(nx * ny).fill(NaN);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const hit = target.queryRay([x0 + i * step, y0 + j * step, .6], [0, 0, -1], .8);
    if (hit) depth[j * nx + i] = hit.point[2];
  }
  const small = blur(depth, nx, ny, step, fine), large = blur(depth, nx, ny, step, coarse);
  const relief = new Float32Array(depth.length);
  for (let i = 0; i < relief.length; i++) relief[i] = (small[i] - large[i]) * 1000;
  return { x0, y0, step, nx, ny, depth, relief };
}

/** Nearest-sample relief in millimetres (NaN outside the grid or off the surface). */
export function reliefAt(grid: ReliefGrid, x: number, y: number) {
  const i = Math.round((x - grid.x0) / grid.step), j = Math.round((y - grid.y0) / grid.step);
  return i < 0 || j < 0 || i >= grid.nx || j >= grid.ny ? NaN : grid.relief[j * grid.nx + i];
}

export interface ReliefValley {
  /** Height of the valley on the mean profile (canonical metres). */
  y: number;
  /** Depth below the lower of its two neighbouring crests (mm). */
  prominence: number;
  /** Fraction of columns with their own local minimum at this height. */
  support: number;
  /** dy/d|x| of the per-column minima (0 when fewer than three columns agree). */
  slope: number;
  /** Signed departure of the middle minimum from the endpoint chord. */
  bow: number;
}

/**
 * Horizontal valleys crossing a set of columns, between y0 and y1 (y1 > y0).
 * A valley must exist in the mean profile; each column then votes for it.
 */
export function horizontalValleys(grid: ReliefGrid, columns: number[], y0: number, y1: number, crest = .04): ReliefValley[] {
  const step = grid.step, ys: number[] = [], mean: number[] = [];
  for (let y = y0; y <= y1 + 1e-9; y += step) {
    let sum = 0, count = 0;
    for (const x of columns) { const v = reliefAt(grid, x, y); if (!Number.isNaN(v)) { sum += v; count++; } }
    ys.push(y); mean.push(count ? sum / count : NaN);
  }
  const reach = Math.round(crest / step), out: ReliefValley[] = [];
  for (let i = 2; i < mean.length - 2; i++) {
    const m = mean[i];
    if (Number.isNaN(m) || !(m <= mean[i - 1] && m <= mean[i + 1] && m < mean[i - 2] && m < mean[i + 2])) continue;
    let above = -Infinity, below = -Infinity;
    for (let k = 1; k <= reach; k++) {
      if (i + k < mean.length && !Number.isNaN(mean[i + k])) above = Math.max(above, mean[i + k]);
      if (i - k >= 0 && !Number.isNaN(mean[i - k])) below = Math.max(below, mean[i - k]);
    }
    const prominence = Math.min(above, below) - m;
    if (!(prominence > 0)) continue;
    const minima: [number, number][] = [];
    for (const x of columns) {
      let offset = 0, lowest = Infinity;
      for (let k = -2; k <= 2; k++) { const v = reliefAt(grid, x, ys[i] + k * step); if (v < lowest) { lowest = v; offset = k; } }
      const a = reliefAt(grid, x, ys[i] + (offset - 3) * step), b = reliefAt(grid, x, ys[i] + (offset + 3) * step);
      if (Math.abs(offset) < 2 && Math.min(a, b) - lowest > .25) minima.push([Math.abs(x), ys[i] + offset * step]);
    }
    let slope = 0, bow = 0;
    if (minima.length >= 3) {
      const mx = minima.reduce((s, p) => s + p[0], 0) / minima.length, my = minima.reduce((s, p) => s + p[1], 0) / minima.length;
      let sxy = 0, sxx = 0;
      for (const [x, y] of minima) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; }
      slope = sxx > 1e-9 ? sxy / sxx : 0;
      if (minima.length >= 4) {
        const [lx, ly] = minima[0], [rx, ry] = minima.at(-1)!;
        bow = minima.slice(1,-1).reduce((sum,[x,y]) => sum + y - (ly + (ry-ly)*(x-lx)/(rx-lx)),0)/(minima.length-2);
      }
    }
    out.push({ y: ys[i], prominence, support: minima.length / columns.length, slope, bow });
  }
  return out.sort((a, b) => b.y - a.y);
}

/** Mean relief across columns at one height (mm). */
export function meanRelief(grid: ReliefGrid, columns: number[], y: number) {
  let sum = 0, count = 0;
  for (const x of columns) { const v = reliefAt(grid, x, y); if (!Number.isNaN(v)) { sum += v; count++; } }
  return count ? sum / count : 0;
}

export interface SequenceModel {
  /** Admissible counts with their log prior (anatomical frequency). */
  counts: { count: number; logPrior: number }[];
  /** Every slot must lie in [bottom, top]. */
  top: number; bottom: number;
  /** Consecutive slot spacing limits and the spread allowed around a regular spacing (metres). */
  gap: { min: number; max: number; prior: number; sigma: number };
  /** Soft anchor of one slot (e.g. the umbilical intersection near the navel). */
  anchor?: (count: number) => { slot: number; y: number; sigma: number } | undefined;
  /** Evidence of a valley, already normalized for physique (dimensionless). */
  gain: (valley: ReliefValley) => number;
  /** Gain of an unobserved slot placed at y; should be lower than a clear valley
   *  and negative on a belly crest, so inferred boundaries fall in flat or concave skin. */
  missing: (y: number) => number;
}

export interface SequenceSlot { y: number; valley?: ReliefValley; gain: number }
export interface SequenceResult { count: number; score: number; slots: SequenceSlot[] }

/**
 * Choose an ordered set of boundaries (top to bottom) from candidate valleys.
 * Every slot is either a measured valley or an inferred position on the
 * regular spacing line through the measured ones. The score adds valley
 * evidence, the anatomical count prior, an optional anchor, and penalizes
 * irregular spacing; so weak valleys are kept only when they agree with the
 * strong ones, and missing boundaries are placed where the anatomy predicts.
 */
export function selectSequence(valleys: ReliefValley[], model: SequenceModel): SequenceResult[] {
  const candidates = valleys.filter(v => v.y <= model.top && v.y >= model.bottom).sort((a, b) => b.y - a.y);
  const results: SequenceResult[] = [];
  for (const { count, logPrior } of model.counts) {
    let best: SequenceResult | undefined;
    const choice: (number | -1)[] = [];
    const evaluate = () => {
      const observed = choice.flatMap((c, slot) => c >= 0 ? [[slot, candidates[c].y]] : []);
      if (!observed.length) return;
      // Regular spacing line y = a - b * slot through the measured slots.
      let a: number, b: number;
      if (observed.length === 1) { b = model.gap.prior; a = observed[0][1] + b * observed[0][0]; }
      else {
        const ms = observed.reduce((s, o) => s + o[0], 0) / observed.length, my = observed.reduce((s, o) => s + o[1], 0) / observed.length;
        let sxy = 0, sxx = 0;
        for (const [slot, y] of observed) { sxy += (slot - ms) * (y - my); sxx += (slot - ms) ** 2; }
        b = -sxy / sxx; a = my + b * ms;
      }
      const ys = choice.map((c, slot) => c >= 0 ? candidates[c].y : a - b * slot);
      if (ys[0] > model.top || ys[ys.length - 1] < model.bottom) return;
      for (let i = 1; i < ys.length; i++) { const gap = ys[i - 1] - ys[i]; if (gap < model.gap.min || gap > model.gap.max) return; }
      let score = logPrior, irregular = 0;
      const slots = choice.map((c, slot) => {
        const valley = c >= 0 ? candidates[c] : undefined, gain = valley ? model.gain(valley) : model.missing(ys[slot]);
        if (valley) irregular += ((valley.y - (a - b * slot)) / model.gap.sigma) ** 2;
        score += gain;
        return { y: ys[slot], valley, gain };
      });
      score -= .5 * irregular;
      const anchor = model.anchor?.(count);
      if (anchor) score -= .5 * ((ys[anchor.slot] - anchor.y) / anchor.sigma) ** 2;
      if (!best || score > best.score) best = { count, score, slots };
    };
    const visit = (slot: number, next: number) => {
      if (slot === count) { evaluate(); return; }
      choice[slot] = -1; visit(slot + 1, next);
      for (let c = next; c < candidates.length; c++) { choice[slot] = c; visit(slot + 1, c + 1); }
    };
    visit(0, 0);
    if (best) results.push(best);
  }
  return results.sort((a, b) => b.score - a.score);
}
