import type { AnatomyMesh } from '../contracts';
import type { Vec3M } from '../landmarks';
import type { AnatomyParameters } from '../parameters';
import { canonicalAnatomyFactors } from '../binding/anatomySkinDrive';
import { normalizePose, posedPositions } from '../pose';
import { fittedNippleFor, rebuildSkinFeatures } from '../skinFeatures';
import { armCoveringAt, pectoralDepthGrid, type FittedNipple, type SurfaceFit } from '../surfaceFit';
import { armBend } from '../referencePose';
import { SurfaceBVH } from './observationProxy';

const mm = (value: number) => Math.round(value * 10000) / 10;
const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};
const front = (surface: SurfaceBVH, x: number, y: number) => surface.queryRay([x, y, .55], [0, 0, -1], .495)?.point[2];

/** Opposite points cancel the slope of the pectoral belly. Requiring a
 * compact peak in both axes rejects long creases and the edge of the fold. */
function nippleAt(target: SurfaceBVH, side: number, hint?: Vec3M): FittedNipple | null {
  const peak = (x: number, y: number, r: number) => {
    const z = front(target, x, y), ring = [front(target, x-r, y), front(target, x+r, y),
      front(target, x, y-r), front(target, x, y+r)];
    if (z === undefined || ring.some(value => value === undefined)) return -Infinity;
    return z - Math.max((ring[0]! + ring[1]!) * .5, (ring[2]! + ring[3]!) * .5);
  };
  let best = .0009, center: {x: number; y: number} | undefined;
  if (!hint) for (let row = 0; row <= 68; row++) for (let col = 0; col <= 48; col++) {
    const x = side * (.051 + col * .002), y = 1.266 + row * .002;
    const fine = peak(x, y, .005);
    if (fine < .00065) continue;
    const score = Math.min(fine * 1.5, peak(x,y,.010)) - .015 * Math.abs(Math.abs(x) - .099);
    if (score > best) { best = score; center = { x, y }; }
  }
  if (hint) center = { x: hint[0], y: hint[1] };
  if (!center || center.x * side < .045 || center.x * side > .185 || center.y < 1.26 || center.y > 1.43) return null;
  const fallback = Math.max(0, Math.min(.008, peak(center.x, center.y, .009)));
  let result: FittedNipple = { ...center, radius: fallback > .0025 ? .009 : .007, projection: fallback };
  let bestError = Infinity;
  // Measure relief above the local chest curvature. The search stays near the
  // detected peak or source landmark, away from the lower pectoral crease.
  for (const dx of [-.003, -.0015, 0, .0015, .003]) for (const dy of [-.003, -.0015, 0, .0015, .003]) {
    const x = center.x + dx, y = center.y + dy;
    if (x * side < .045 || x * side > .185 || y < 1.26 || y > 1.43) continue;
    const axis = (ux: number, uy: number) => {
      const near = .012, far = .018;
      const a = front(target, x - near*ux, y - near*uy), b = front(target, x + near*ux, y + near*uy);
      const c = front(target, x - far*ux, y - far*uy), d = front(target, x + far*ux, y + far*uy);
      if (a === undefined || b === undefined || c === undefined || d === undefined) return;
      const curve = (c + d - a - b) / (2 * (far*far - near*near));
      return { curve, base: (a+b)*.5 - curve*near*near, slope: (b-a)/(2*near) };
    };
    const horizontal = axis(1, 0), vertical = axis(0, 1);
    if (!horizontal || !vertical) continue;
    const base = (horizontal.base + vertical.base) * .5;
    const compact = peak(x, y, .009);
    if (compact < .00065) continue;
    const samples: { x: number; y: number; depth: number }[] = [];
    for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) {
      const u = i * .003, v = j * .003, z = front(target, x + u, y + v);
      if (z !== undefined) samples.push({ x: u, y: v, depth: z - base - horizontal.slope*u - vertical.slope*v -
        horizontal.curve*u*u - vertical.curve*v*v });
    }
    if (samples.length < 43 || (front(target, x, y) ?? base) - base < .0007) continue;
    for (const radius of [.005, .0065, .008, .0095, .011, .0125, .014]) for (const aspect of [.65, .82, 1, 1.22, 1.5]) {
      const kernel = samples.map(s => Math.max(0, 1 - (s.x / radius)**2 - (s.y / (radius * aspect))**2)**3);
      const projection = Math.max(0, Math.min(.008, 1.5 * compact, samples.reduce((sum, s, i) => sum + s.depth * kernel[i], 0) /
        kernel.reduce((sum, k) => sum + k*k, 0)));
      if (projection < .00065) continue;
      const error = samples.reduce((sum, s, i) => sum + Math.min(.004, Math.abs(s.depth - projection * kernel[i]))**2, 0) /
        samples.length + .000015 * (dx*dx + dy*dy) + .000000015 * (aspect - 1)**2;
      if (error < bestError) { bestError = error; result = { x, y, radius, aspect, projection }; }
    }
  }
  return result;
}

function foldHeight(surface: SurfaceBVH, x: number, expected: number) {
  let best = .002, height: number | undefined;
  for (let i = -12; i <= 12; i++) {
    const y = expected + i * .004;
    const above = front(surface, x, y + .008), below = front(surface, x, y - .008);
    if (above === undefined || below === undefined) continue;
    const slope = above - below - Math.abs(i) * .00013;
    if (slope > best) { best = slope; height = y; }
  }
  return height;
}

export function fitBentArmCovering(p: AnatomyParameters, skin: AnatomyMesh, target: SurfaceBVH) {
  const field = p.skinFit, arms = p.referencePose?.chains.filter(chain=>armBend(chain)>.4) ?? [];
  if (!field || !arms.length) return;
  const { lateral, vertical } = canonicalAnatomyFactors(p.height);
  const positions = posedPositions(skin,p,normalizePose({}));
  const bins = new Map<string,{ sum: number[]; count: number }>();
  const held: Vec3M[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    const q: Vec3M = [positions[i]*lateral,positions[i+1]*vertical,positions[i+2]*lateral];
    const arm = arms.find(chain=>q[0]*chain.side>.095);
    if (!arm || q[1] < 1.23) continue;
    const [shoulder,elbow] = arm.target;
    const axilla = [shoulder[0]+arm.side*.022,shoulder[1]-.053,shoulder[2]];
    const junction = [shoulder[0] - arm.side * .035, shoulder[1] - .035, shoulder[2] + .054];
    const near = Math.min(...[shoulder, elbow, axilla, junction].map(point=>Math.hypot(q[0]-point[0],q[1]-point[1],q[2]-point[2])));
    if (near >= .104) continue;
    if (i%15===0) { held.push(q); continue; }
    const hit = target.queryClosestPoint(q);
    const distance = Math.sqrt(hit.distanceSq);
    if (distance > .046) continue;
    const weight = Math.min(.85,.030/Math.max(distance,.001))*smooth((.104-near)/.027);
    const key = q.map(value=>Math.floor(value/.026)).join(',');
    const bin = bins.get(key) ?? { sum: [0,0,0,0,0,0], count: 0 };
    for (let k = 0; k < 3; k++) {
      bin.sum[k] += q[k];
      bin.sum[k+3] += (hit.point[k]-q[k])*weight;
    }
    bin.count++;
    bins.set(key,bin);
  }
  const samples = [...bins.values()].sort((a,b)=>b.count-a.count).slice(0,256)
    .map(bin=>bin.sum.map(value=>value/bin.count) as NonNullable<SurfaceFit['armCovering']>[number]);
  const junctionDistance = ([x, y, z]: readonly number[]) => Math.min(...arms.map(arm => {
    const [sx, sy, sz] = arm.target[0];
    return Math.hypot(x - sx + arm.side * .035, y - sy + .035, z - sz - .054);
  }));
  const measure = (trial: typeof samples, points: Vec3M[]) => points.reduce((sum, q) => {
    const delta = armCoveringAt(trial, ...q);
    const weight = smooth((q[1] - 1.23) / .04) * smooth((Math.abs(q[0]) - .095) / .055);
    const moved: Vec3M = [q[0] + weight * delta[0], q[1] + weight * delta[1], q[2] + weight * delta[2]];
    return sum + Math.sqrt(target.queryClosestPoint(moved).distanceSq);
  }, 0);
  if (held.length < 20 || measure(samples, held) >= measure([], held) * .96) return;
  field.armCovering = samples;
  const junction = held.filter(point => junctionDistance(point) < .078);
  if (junction.length < 12) return;
  const refined = samples.map((sample): typeof sample => {
    const [x, y, z, dx, dy, dz] = sample;
    const gain = .65 * (1 - smooth((junctionDistance(sample) - .045) / .043));
    if (!gain) return sample;
    const applied = armCoveringAt(samples, x, y, z);
    const weight = smooth((y - 1.23) / .04) * smooth((Math.abs(x) - .095) / .055);
    const point: Vec3M = [x + weight * applied[0], y + weight * applied[1], z + weight * applied[2]];
    const hit = target.queryClosestPoint(point);
    if (hit.distanceSq > .035 ** 2) return sample;
    const adjust = (value: number, axis: number) => Math.max(-.035, Math.min(.035, value + gain * (hit.point[axis] - point[axis])));
    return [x, y, z, adjust(dx, 0), adjust(dy, 1), adjust(dz, 2)];
  });
  if (measure(refined, junction) < measure(samples, junction) * .98 &&
    measure(refined, held) <= measure(samples, held))
    field.armCovering = refined;
}

export function fitPectoralSkin(p: AnatomyParameters, skin: AnatomyMesh, muscles: AnatomyMesh[], target: SurfaceBVH,
  folds: [number, number], hints: [Vec3M | undefined, Vec3M | undefined]) {
  const field = p.skinFit;
  if (!field || !p.referencePose?.enabled) return;
  const { lateral, vertical } = canonicalAnatomyFactors(p.height), zero = normalizePose({});
  const surface = (mesh: AnatomyMesh, omitNipples = false) => {
    const positions = posedPositions(mesh, p, zero);
    if (mesh.skinFeatures) rebuildSkinFeatures(mesh, positions, p, omitNipples);
    return new SurfaceBVH({ positions: positions.map((value, i) => value * (i % 3 === 1 ? vertical : lateral)), indices: mesh.indices });
  };
  const original = surface(skin), unmarked = surface(skin, true), internal = muscles.map(mesh => surface(mesh));
  field.fittedNipples = [nippleAt(target, -1, hints[0]), nippleAt(target, 1, hints[1])];
  // An areola can be visible in the texture without a measurable geometric peak.
  // Use the opposite landmark and the local fold when only one side is resolved.
  for (const side of [0, 1] as const) {
    const other = field.fittedNipples[1-side];
    if (field.fittedNipples[side] || !other || hints[side]) continue;
    const x = -other.x;
    const shift = Math.max(-.012, Math.min(.012, folds[side]-folds[1-side]));
    const y = Math.max(1.26, Math.min(1.43, other.y + shift));
    if (front(target,x,y) !== undefined) field.fittedNipples[side] = { ...other, x, y, projection: 0 };
  }
  const nipples = [fittedNippleFor(p, 0) ?? null, fittedNippleFor(p, 1) ?? null] as const;
  if (nipples.some(Boolean)) field.fittedNipples = [...nipples];
  else delete field.fittedNipples;

  const muscleDepth = (x: number, y: number) => Math.max(...internal.map(mesh => front(mesh, x, y) ?? -Infinity));
  const { x, y, step, rows, columns, limitMm } = pectoralDepthGrid;
  const nodes = Array.from({ length: rows * columns }, (_, i) => {
    const row = Math.floor(i / columns), col = i % columns, px = x + col * step, py = y + row * step;
    const w = smooth(row / 4) * smooth((rows - 1 - row) / 5) * smooth(Math.min(col, columns - 1 - col) / 5);
    if (!w) return;
    const source = front(unmarked, px, py);
    let observed = front(target, px, py);
    const nipple = nipples[px < 0 ? 0 : 1];
    if (nipple && observed !== undefined) {
      const r = Math.hypot(px - nipple.x, (py - nipple.y) / (nipple.aspect ?? 1)) / nipple.radius;
      if (r < 1) observed -= nipple.projection * (1 - r * r) ** 3;
    }
    if (source === undefined || observed === undefined || Math.abs(observed - source) > .055) return;
    const floor = Math.min(0, (muscleDepth(px, py) + .001 - source) * 1000);
    return { x: px, y: py, w, source, observed, floor };
  });
  const depth = nodes.map(node => node ? Math.round(node.w * Math.max(-limitMm, node.floor,
    Math.min(limitMm, (node.observed - node.source) * 1000)) * 10) / 10 : 0);
  const probes: { x: number; y: number; from: number; to: number; muscle: number }[] = [];
  for (let h = 1.252; h < 1.46; h += .012) for (let u = -.204; u <= .205; u += .012) {
    const from = front(original, u, h), to = front(target, u, h);
    if (from !== undefined && to !== undefined) probes.push({ x: u, y: h, from, to, muscle: muscleDepth(u, h) });
  }
  const foldProbes = [-1, 1].flatMap((side, i) => [.043,.067,.091,.115,.139,.163,.187].flatMap(x => {
    const h = foldHeight(target, x * side, folds[i]);
    if (h === undefined) return [];
    return [-.012, 0, .012].flatMap(delta => {
      const from = front(original, x * side, h + delta), to = front(target, x * side, h + delta);
      return from !== undefined && to !== undefined ? [{ x: x * side, y: h + delta, from, to, muscle: -Infinity }] : [];
    });
  }));
  const error = (trial: SurfaceBVH, points: typeof probes) => {
    let before = 0, after = 0, samples = 0, crossings = 0;
    for (const point of points) {
      const z = front(trial, point.x, point.y);
      if (z === undefined) continue;
      samples++;
      before += Math.abs(point.from - point.to);
      after += Math.abs(z - point.to);
      if (point.muscle - z > .002 && z < point.from - .001) crossings++;
    }
    return { samples, beforeMm: mm(before / Math.max(samples, 1)), afterMm: mm(after / Math.max(samples, 1)), crossings };
  };
  {
    // Frontal samples over the sternum are unobstructed even when the arm
    // occludes the outer chest. Use absolute depth to remove narrow creases
    // that a grid of incremental offsets cannot reconstruct.
    const observed = Array.from({ length: rows * columns }, (_, i) => {
      const px = x + (i % columns) * step, py = y + Math.floor(i / columns) * step;
      if (Math.abs(px) > .091 || py < 1.228 || py > 1.494) return 0;
      return Math.round((front(target, px, py) ?? 0) * 10000) / 10;
    });
    const sternumProbes = probes.filter(point => Math.abs(point.x) < .071 && point.y < 1.44);
    for (let py = 1.236; py < 1.252; py += .008) for (let px = -.054; px <= .055; px += .012) {
      const from = front(original, px, py), to = front(target, px, py);
      if (from !== undefined && to !== undefined)
        sternumProbes.push({ x: px, y: py, from, to, muscle: muscleDepth(px, py) });
    }
    if (observed.every(value => value >= 0 && value <= 250)) {
      field.sternumSurface = observed;
      const central = error(surface(skin), sternumProbes);
      if (central.samples < 90 || central.crossings || central.afterMm + .25 >= central.beforeMm) {
        delete field.sternumSurface;
        // Depth can already match the GLB while faces still overlap in its
        // frontal projection. Try untangling the mesh without replacing depth.
        const overlaps = (mesh: SurfaceBVH) => {
          let count = 0;
          for (let y = 1.232; y < 1.445; y += .002) for (let x = -.074; x < .075; x += .002) {
            const first = front(mesh, x, y);
            if (first === undefined || first <= .05508) continue;
            const origin = first - .00008;
            if (mesh.queryRay([x, y, origin], [0, 0, -1], origin - .055)) count++;
          }
          return count;
        };
        const previous = overlaps(original);
        if (previous) {
          field.sternumRelax = true;
          const trial = surface(skin), relief = error(trial, sternumProbes);
          if (relief.samples !== central.samples || relief.crossings ||
            relief.afterMm > relief.beforeMm + .2 || overlaps(trial) >= previous * .75)
            delete field.sternumRelax;
        }
      }
    }
  }
  for (const strength of [1, .65, .4]) {
    const first = depth.map(value => value * strength);
    field.pectoralDepth = first;
    const trial = surface(skin);
    let covering = error(trial, probes), fold = error(trial, foldProbes);
    if (covering.samples >= 450 && !covering.crossings && covering.afterMm + .2 < covering.beforeMm &&
      fold.samples >= 21 && fold.afterMm < fold.beforeMm) {
      // The sampled field is interpolated onto the skin's triangles. A second
      // residual pass restores the relief lost there, especially at the fold.
      const unmarkedTrial = surface(skin, true);
      field.pectoralDepth = nodes.map((node, i) => {
        if (!node) return first[i];
        const fitted = front(unmarkedTrial, node.x, node.y);
        if (fitted === undefined) return first[i];
        const correction = first[i] + .8 * node.w * (node.observed - fitted) * 1000;
        return Math.round(Math.max(-limitMm, node.floor, Math.min(limitMm, correction)) * 10) / 10;
      });
      const refined = surface(skin), nextCovering = error(refined, probes), nextFold = error(refined, foldProbes);
      if (nextCovering.samples === covering.samples && nextFold.samples === fold.samples &&
        !nextCovering.crossings && nextCovering.afterMm <= covering.afterMm && nextFold.afterMm <= fold.afterMm &&
        nextCovering.afterMm + nextFold.afterMm < covering.afterMm + fold.afterMm) {
        covering = nextCovering;
        fold = nextFold;
      } else field.pectoralDepth = first;
      return { covering, fold, nipples };
    }
  }
  // A raised arm can hide the outer fold from a frontal ray while the
  // pectoral belly remains observable. Validate the belly separately and
  // keep the full correction there when the lateral fold is inconclusive.
  if (p.referencePose.chains.some(chain => armBend(chain) > .4)) {
    const belly = probes.filter(point => Math.abs(point.x) < .165 && point.y > 1.26 && point.y < 1.46);
    for (const strength of [1, .75, .5]) {
      field.pectoralDepth = depth.map((value, i) => {
        const node = nodes[i];
        return node ? value * strength * (1 - smooth((Math.abs(node.x) - .15) / .065)) : 0;
      });
      const trial = surface(skin);
      const covering = error(trial, belly), fold = error(trial, foldProbes);
      if (covering.samples >= 300 && !covering.crossings &&
        covering.afterMm + .35 < covering.beforeMm && fold.afterMm <= fold.beforeMm + .5)
        return { covering, fold, nipples };
    }
  }
  // A folded arm can obscure the lateral fold. Keep the measured correction
  // over the sternum when a full chest correction fails its validation.
  const central = probes.filter(point=>Math.abs(point.x)<.056 && point.y>1.275 && point.y<1.45);
  for (const strength of [.8,.5]) {
    field.pectoralDepth = depth.map((value,i)=>{
      const node = nodes[i];
      if (!node) return 0;
      const mask = (1-smooth((Math.abs(node.x)-.032)/.045))*smooth((node.y-1.25)/.04)*smooth((1.47-node.y)/.04);
      return value*mask*strength;
    });
    const covering = error(surface(skin),central);
    if (covering.samples >= 30 && !covering.crossings && covering.afterMm+.25 < covering.beforeMm)
      return { covering, nipples };
  }
  delete field.pectoralDepth;
  return { nipples };
}
