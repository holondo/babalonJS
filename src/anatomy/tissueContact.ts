import type { AnatomyMesh } from './contracts';
import { calculateNormals, signedMeshVolume } from './algorithms/loft';

export interface ContactMetric { pair: string; samples: number; protectedSamples: number; beforeMm: number; afterMm: number; moved: number; method: 'radial_surface_samples'; }
const angularStep = .08, heightStep = .12;
/** Broad phase only: clearance below is calculated against actual triangles, not spheres or centerlines. */
export class RadialSurface {
  private bins = new Map<string, { positions: Float32Array; a: number; b: number; c: number }[]>();
  constructor(meshes: AnatomyMesh[], posed?: Map<AnatomyMesh, Float32Array>) {
    for (const mesh of meshes) {
      const p = posed?.get(mesh) ?? mesh.positions;
      for (let triangle = 0; triangle < mesh.indices.length; triangle += 3) {
        const a = mesh.indices[triangle] * 3, b = mesh.indices[triangle + 1] * 3, c = mesh.indices[triangle + 2] * 3;
        const angles = [a, b, c].map(i => Math.atan2(p[i], p[i + 2]));
        const lo = Math.min(...angles), hi = Math.max(...angles);
        if (hi - lo > Math.PI) continue; // The torso seam is outside the supported anterior/lateral regions.
        const y0 = Math.min(p[a + 1], p[b + 1], p[c + 1]), y1 = Math.max(p[a + 1], p[b + 1], p[c + 1]);
        const face = { positions: p, a, b, c };
        for (let x = Math.floor(lo / angularStep); x <= Math.floor(hi / angularStep); x++) for (let y = Math.floor(y0 / heightStep); y <= Math.floor(y1 / heightStep); y++) {
          const key = `${x},${y}`, list = this.bins.get(key) ?? []; list.push(face); this.bins.set(key, list);
        }
      }
    }
  }
  bounds(x: number, y: number, z: number): [number, number] | undefined {
    const radius = Math.hypot(x, z); if (radius < .01) return;
    const dx = x / radius, dz = z / radius, theta = Math.atan2(x, z);
    const faces = this.bins.get(`${Math.floor(theta / angularStep)},${Math.floor(y / heightStep)}`);
    let min = Infinity, max = -Infinity;
    for (const face of faces ?? []) {
      const { positions: p, a, b, c } = face;
      const ex = p[b] - p[a], ey = p[b + 1] - p[a + 1], ez = p[b + 2] - p[a + 2];
      const fx = p[c] - p[a], fy = p[c + 1] - p[a + 1], fz = p[c + 2] - p[a + 2];
      const hx = -dz * fy, hy = dz * fx - dx * fz, hz = dx * fy, det = ex * hx + ey * hy + ez * hz;
      if (Math.abs(det) < 1e-10) continue;
      const sx = -p[a], sy = y - p[a + 1], sz = -p[a + 2];
      const u = (sx * hx + sy * hy + sz * hz) / det; if (u < -1e-6 || u > 1 + 1e-6) continue;
      const qx = sy * ez - sz * ey, qy = sz * ex - sx * ez, qz = sx * ey - sy * ex;
      const v = (dx * qx + dz * qz) / det; if (v < -1e-6 || u + v > 1 + 1e-6) continue;
      const t = (fx * qx + fy * qy + fz * qz) / det;
      if (t > .01) { min = Math.min(min, t); max = Math.max(max, t); }
    }
    return Number.isFinite(min) ? [min, max] : undefined;
  }
}
/** Keep posterior muscle bellies under the fascia wherever the sheet covers
 * them. Only the outer shell moves, so the deep seat stays on the trunk. */
export function seatLumbarMuscles(muscles: AnatomyMesh[], fascia: AnatomyMesh[], posed: Map<AnatomyMesh, Float32Array>) {
  const surface = new RadialSurface(fascia,posed);
  for (const mesh of muscles) {
    if (!mesh.shellPairs || !/^(latissimus_dorsi_|erector_|externalOblique_)/.test(mesh.anatomicalName ?? '')) continue;
    const positions = posed.get(mesh);
    if (!positions) continue;
    for (let vertex=0; vertex<mesh.shellPairs; vertex++) {
      const i=vertex*3, j=(vertex+mesh.shellPairs)*3;
      const x=positions[i], y=positions[i+1], z=positions[i+2];
      if (z>=0 || y<9.1 || y>11.7) continue;
      const hit=surface.bounds(x,y,z);
      if (!hit) continue;
      const outer=Math.hypot(x,z), inner=Math.hypot(positions[j],positions[j+2]);
      const room=Math.max(0,(outer-inner)*.65);
      const band=Math.min(1,(y-9.1)/.3,(11.7-y)/.3);
      const depth=Math.min(.085,room,Math.max(0,outer-hit[0]+.008))*band;
      if (depth<=0) continue;
      positions[i]-=x*depth/outer;
      positions[i+2]-=z*depth/outer;
    }
  }
}
/** Resolve the actual covering triangles too: vertex-only outward projection can
 * miss a narrow, highly grown belly between the skin's samples. */
export function coverRectusTriangles(rectus: AnatomyMesh[], skin: AnatomyMesh, clearanceMm: number, exposure: (x: number, y: number) => number, coveringWeights?: Float32Array) {
  const surface = new AnteriorSurface([skin]), p = skin.positions, gap = clearanceMm / 100;
  const original = p.slice(), groups = new Int32Array(p.length / 3), muscles = rectus.map(mesh => new AnteriorSurface([mesh]));
  const weights = coveringWeights ?? Float32Array.from({ length: p.length / 3 }, (_, v) => exposure(p[v * 3], p[v * 3 + 1]));
  for (let v = 0; v < groups.length; v++) {
    if (p[v * 3 + 2] <= 0) continue;
    let outer = -Infinity;
    muscles.forEach((muscle, index) => {
      const hit = muscle.bounds(p[v * 3], p[v * 3 + 1]);
      if (hit && hit[1] > outer) { outer = hit[1]; groups[v] = index + 1; }
    });
  }
  for (let iteration = 0; iteration < 8; iteration++) {
    let max = 0;
    for (const mesh of rectus) for (let i = 0; i < mesh.positions.length; i += 3) {
      const x = mesh.positions[i], y = mesh.positions[i + 1], z = mesh.positions[i + 2];
      if (exposure(x, y) < 1) continue;
      const hit: { vertices?: number[] } = {}, bounds = surface.bounds(x, y, hit);
      if (!bounds || !hit.vertices) continue;
      const delta = z + gap - bounds[1]; if (delta <= .00001) continue;
      if (hit.vertices.every(vertex => weights[vertex] < .001)) continue;
      max = Math.max(max, delta);
      for (const vertex of hit.vertices) {
        const j = vertex * 3;
        p[j + 2] += delta * weights[vertex];
      }
    }
    smoothCovering(skin, p, original, groups, weights, true);
    if (max < .0002) break;
  }
}
function protectedVertex(mesh: AnatomyMesh, vertex: number) {
  const grid = mesh.surfaceGrid;
  if (!grid || !mesh.attachments?.length || !mesh.shellPairs) return false;
  const row = Math.floor(vertex / (grid.cols + 1));
  return mesh.attachments.some(binding => binding.end === 'start' ? row === 0 : row === grid.rows);
}
function separate(source: AnatomyMesh[], targets: AnatomyMesh[], gap: number, pair: string, inward: boolean, apply: boolean, posed?: Map<AnatomyMesh, Float32Array>, accept?: (mesh: AnatomyMesh, vertex: number) => boolean, allowDetached = false): ContactMetric {
  const surface = new RadialSurface(source, posed);
  const metric: ContactMetric = { pair, samples: 0, protectedSamples: 0, beforeMm: 0, afterMm: 0, moved: 0, method: 'radial_surface_samples' };
  for (const mesh of targets) {
    const p = posed?.get(mesh) ?? mesh.positions, count = mesh.shellPairs ?? p.length / 3;
    for (let vertex = 0; vertex < count; vertex++) {
      if (protectedVertex(mesh, vertex)) { metric.protectedSamples++; continue; }
      if (mesh.rig && mesh.rig[vertex * 4] + mesh.rig[vertex * 4 + 2] > .5) continue;
      if (accept && !accept(mesh, vertex)) continue;
      let i = vertex * 3;
      if (mesh.shellPairs) {
        const j = (vertex + mesh.shellPairs) * 3;
        const a = Math.hypot(p[i], p[i + 2]), b = Math.hypot(p[j], p[j + 2]);
        if (inward ? b > a : b < a) i = j;
      }
      const x = p[i], y = p[i + 1], z = p[i + 2], radius = Math.hypot(x, z);
      if (y < 7.8 || y > 14.5 || radius < .1) continue;
      const bounds = surface.bounds(x, y, z); if (!bounds) continue;
      // Pushing out only resolves a muscle that crosses this surface. A muscle that starts beyond it along the
      // ray (the deltoid seen through the armpit) belongs to another part and must not pull the skin across.
      if (!inward && !allowDetached && bounds[0] > radius + gap) continue;
      metric.samples++;
      const penetration = Math.max(0, inward ? radius - bounds[0] + gap : bounds[1] + gap - radius);
      metric.beforeMm = Math.max(metric.beforeMm, penetration * 100);
      if (!apply || penetration <= 1e-7) continue;
      // Do not cross the torso axis when an unsupported shape exceeds the radial model.
      const distance = inward ? -Math.min(penetration, radius - .05) : penetration;
      const dx = x / radius * distance, dz = z / radius * distance;
      p[vertex * 3] += dx; p[vertex * 3 + 2] += dz;
      if (mesh.shellPairs) { p[(vertex + mesh.shellPairs) * 3] += dx; p[(vertex + mesh.shellPairs) * 3 + 2] += dz; }
      metric.moved++;
    }
  }
  return metric;
}
/** A limited torso surface solve. It does not claim full-body collision, continuous collision detection or FEM. */
export function solveTissueContact(inside: Record<string, AnatomyMesh[]>, skin: AnatomyMesh, lean: AnatomyMesh | undefined, clearanceMm: number, posed?: Map<AnatomyMesh, Float32Array>, preserveDivisions = false): ContactMetric[] {
  const gap = clearanceMm / 100;
  const pectorals = (inside.otherMuscles ?? []).filter(m => m.anatomicalName?.startsWith('pectoralis_major_'));
  // Resolve the upper wall from superficial to deep first. Pushing rectus
  // outward from transversus and inward from pectoralis creates a cyclic solve.
  const pairs = [
    { source: pectorals, target: inside.rectusAbdominis ?? [], id: 'rectus/pectoralis', inward: true },
    { source: inside.rectusAbdominis ?? [], target: inside.transversusAbdominis ?? [], id: 'transversus/rectus', inward: true },
    { source: inside.transversusAbdominis ?? [], target: inside.internalOblique ?? [], id: 'transversus/internal_oblique', inward: false },
    { source: inside.internalOblique ?? [], target: inside.externalOblique ?? [], id: 'internal_oblique/external_oblique', inward: false },
  ].filter(pair => pair.source.length && pair.target.length);
  const before = pairs.map(pair => separate(pair.source, pair.target, gap, pair.id, pair.inward, false, posed));
  let metrics = before;
  for (let iteration = 0; iteration < 3; iteration++) {
    for (const pair of pairs) {
      const result = separate(pair.source, pair.target, gap, pair.id, pair.inward, true, posed);
      before.find(metric => metric.pair === pair.id)!.moved += result.moved;
    }
    metrics = pairs.map((pair, i) => ({ ...before[i], afterMm: separate(pair.source, pair.target, gap, pair.id, pair.inward, false, posed).beforeMm }));
    if (metrics.every(metric => metric.afterMm < .02)) break;
  }
  metrics.push(...coverMuscles(inside, skin, lean, clearanceMm, posed, preserveDivisions));
  if (!posed) for (const mesh of new Set(pairs.flatMap(pair => pair.target))) mesh.normals = calculateNormals(mesh.positions, mesh.indices);
  return metrics;
}
/** Each covering vertex is pushed by its own penetration, so neighbours move by very different amounts and the
 * skin turns lumpy over the chest. Dilate then blur the radial push over the mesh (as restOnThorax does for
 * muscles), keeping at least each vertex's own push. */
function smoothCovering(mesh: AnatomyMesh, p: Float32Array, original: Float32Array, groups?: Int32Array, detail?: Float32Array, depthOnly = false) {
  const count = p.length / 3, need = new Float32Array(count), neighbours: number[][] = Array.from({ length: count }, () => []);
  let moved = false;
  for (let v = 0; v < count; v++) {
    const i = v * 3, r0 = depthOnly ? original[i + 2] : Math.hypot(original[i], original[i + 2]), r1 = depthOnly ? p[i + 2] : Math.hypot(p[i], p[i + 2]);
    need[v] = Math.max(0, r1 - r0);
    if (need[v] > 0) moved = true;
  }
  if (!moved) return;
  // Seams duplicate vertices (the skin's midline); weld them by position so the push spreads across.
  const canonical = new Int32Array(count), seen = new Map<string, number>();
  for (let v = 0; v < count; v++) {
    const key = `${Math.round(original[v * 3] * 1e4)},${Math.round(original[v * 3 + 1] * 1e4)},${Math.round(original[v * 3 + 2] * 1e4)}`;
    canonical[v] = seen.get(key) ?? (seen.set(key, v), v);
  }
  for (let t = 0; t < mesh.indices.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = canonical[mesh.indices[t + k]];
      for (const offset of [1, 2]) { const b = canonical[mesh.indices[t + (k + offset) % 3]]; if (!groups || groups[a] === groups[b]) neighbours[a].push(b); }
    }
  for (let v = 0; v < count; v++) if (canonical[v] !== v) need[canonical[v]] = Math.max(need[canonical[v]], need[v]);
  let push = need.slice();
  const pass = (combine: (own: number, values: number[]) => number) => { const next = new Float32Array(count); for (let v = 0; v < count; v++) next[v] = combine(push[v], neighbours[v].map(u => push[u])); push = next; };
  for (let k = 0; k < 3; k++) pass((own, values) => Math.max(own, ...values));
  for (let k = 0; k < 6; k++) pass((own, values) => (own + values.reduce((sum, value) => sum + value, 0)) / (1 + values.length));
  for (let v = 0; v < count; v++) {
    const i = v * 3, r0 = Math.hypot(original[i], original[i + 2]), d = Math.max(need[canonical[v]], need[canonical[v]] + (push[canonical[v]] - need[canonical[v]]) * (detail?.[canonical[v]] ?? 1));
    if (r0 < .1 || d <= 0) continue;
    if (depthOnly) { p[i + 2] = original[i + 2] + d; continue; }
    p[i] = original[i] * (r0 + d) / r0; p[i + 2] = original[i + 2] * (r0 + d) / r0;
  }
}
/** Pushes the covering (lean boundary, then skin) out until it clears the superficial muscles. */
export function coverMuscles(inside: Record<string, AnatomyMesh[]>, skin: AnatomyMesh, lean: AnatomyMesh | undefined, clearanceMm: number, posed?: Map<AnatomyMesh, Float32Array>, preserveDivisions = false): ContactMetric[] {
  const gap = clearanceMm / 100, metrics: ContactMetric[] = [];
  const others = inside.otherMuscles ?? [], trunk = [...(inside.externalOblique ?? []), ...(inside.rectusAbdominis ?? []), ...others.filter(m => /^pectoralis_major_/.test(m.anatomicalName ?? ''))];
  // The deltoid hangs beside the chest wall: along a ray from the trunk axis it would drag the chest skin over
  // the arm. It covers only the shoulder skin that already follows the arm in part (rig weight).
  const deltoids = others.filter(m => /^deltoid/.test(m.anatomicalName ?? '')), shoulder = (mesh: AnatomyMesh, vertex: number) => !mesh.rig || mesh.rig[vertex * 4] > .15;
  const boundary = lean ?? skin, boundaryPositions = posed?.get(boundary) ?? boundary.positions, original = boundaryPositions.slice();
  // Smoothing follows actual muscle ownership and the generated inscription paths.
  // It can spread a covering correction within a belly, but not erase its divisions.
  let groups: Int32Array | undefined, detail: Float32Array | undefined;
  if (preserveDivisions) {
    const rectus = (inside.rectusAbdominis ?? []).map(mesh => new RadialSurface([mesh], posed));
    const covering = new RadialSurface(trunk, posed);
    const paths = (inside.aponeuroses ?? []).filter(mesh => /^tendinous_intersection_/.test(mesh.anatomicalName ?? '') && mesh.surfaceGrid).map(mesh => {
      const p = posed?.get(mesh) ?? mesh.positions, { rows, cols } = mesh.surfaceGrid!, path: number[][] = [];
      for (let col = 0; col <= cols; col++) {
        const a = col * 3, b = (rows * (cols + 1) + col) * 3;
        path.push([Math.atan2(p[a], p[a + 2]), (p[a + 1] + p[b + 1]) * .5, Math.abs(p[b + 1] - p[a + 1]) * .5 + .08]);
      }
      return path.sort((a, b) => a[0] - b[0]);
    });
    const count = boundaryPositions.length / 3;
    groups = new Int32Array(count); detail = new Float32Array(count).fill(1);
    for (let vertex = 0; vertex < count; vertex++) {
      const i = vertex * 3, x = original[i], y = original[i + 1], z = original[i + 2], theta = Math.atan2(x, z);
      if (z <= 0 || y < 8 || y > 14) continue;
      const outer = covering.bounds(x, y, z); if (!outer) continue;
      for (let muscle = 0; muscle < rectus.length; muscle++) {
        const hit = rectus[muscle].bounds(x, y, z);
        if (hit && Math.abs(hit[1] - outer[1]) < .01) groups[vertex] = muscle + 1;
      }
      for (const path of paths) {
        if (theta < path[0][0] || theta > path.at(-1)![0]) continue;
        for (let j = 1; j < path.length; j++) if (theta <= path[j][0]) {
          const a = path[j - 1], b = path[j], t = (theta - a[0]) / Math.max(.000001, b[0] - a[0]), center = a[1] + t * (b[1] - a[1]), radius = a[2] + t * (b[2] - a[2]);
          const u = Math.min(1, Math.abs(y - center) / Math.max(.001, radius));
          detail[vertex] = Math.min(detail[vertex], u * u * (3 - 2 * u)); break;
        }
      }
    }
  }
  if (trunk.length || deltoids.length) {
    // The automatic rectus-only covering must also catch a belly entirely in
    // front of the skin at extreme growth. Other regions keep the no-crossing guard.
    const rectusOnly = preserveDivisions && trunk.every(mesh => inside.rectusAbdominis?.includes(mesh));
    const correction = separate(trunk, [boundary], gap, 'muscle/covering', false, false, posed, undefined, rectusOnly);
    // Smoothing can carry a previously disconnected neighbour into a muscle. Resolve those
    // newly crossing rays too; every pass still preserves the original no-crossing guard.
    for (let iteration = 0; iteration < 4; iteration++) {
      correction.moved += separate(trunk, [boundary], gap, correction.pair, false, true, posed, undefined, rectusOnly).moved;
      if (deltoids.length) correction.moved += separate(deltoids, [boundary], gap, correction.pair, false, true, posed, shoulder).moved;
      smoothCovering(boundary, boundaryPositions, original, groups, detail);
      correction.afterMm = Math.max(separate(trunk, [boundary], gap, correction.pair, false, false, posed, undefined, rectusOnly).beforeMm, deltoids.length ? separate(deltoids, [boundary], gap, correction.pair, false, false, posed, shoulder).beforeMm : 0);
      if (correction.afterMm < .02) break;
    }
    metrics.push(correction);
  }
  if (lean) {
    const skinPositions = posed?.get(skin) ?? skin.positions;
    if (skinPositions.length === boundaryPositions.length && skin.indices.length === lean.indices.length) {
      for (let i = 0; i < skinPositions.length; i++) skinPositions[i] += boundaryPositions[i] - original[i];
    } else {
      // Marching-cubes covered/lean skins have different topology. Preserve
      // radial covering thickness via the two actual surfaces, not vertex IDs.
      const beforeSurface = new RadialSurface([{ ...lean, positions: original }]);
      const afterSurface = new RadialSurface([{ ...lean, positions: boundaryPositions }]);
      for (let i = 0; i < skinPositions.length; i += 3) {
        const x = skinPositions[i], y = skinPositions[i + 1], z = skinPositions[i + 2], radius = Math.hypot(x, z);
        const before = beforeSurface.bounds(x, y, z), after = afterSurface.bounds(x, y, z);
        if (!before || !after || radius < .1) continue;
        const delta = Math.max(0, after[1] - before[1]);
        skinPositions[i] += x / radius * delta; skinPositions[i + 2] += z / radius * delta;
      }
    }
  }
  if (!posed) for (const mesh of [skin, ...(lean ? [lean] : [])]) mesh.normals = calculateNormals(mesh.positions, mesh.indices);
  return metrics;
}

/** Front/back depth at fixed X/Y, for width-preserving anatomical seats. */
export class AnteriorSurface {
  private bins = new Map<string, { p: Float32Array; a: number; b: number; c: number }[]>();
  constructor(meshes: AnatomyMesh[]) {
    for (const mesh of meshes) for (let i = 0; i < mesh.indices.length; i += 3) {
      const p = mesh.positions, [a, b, c] = [0, 1, 2].map(k => mesh.indices[i + k] * 3), face = { p, a, b, c };
      for (let x = Math.floor(Math.min(p[a], p[b], p[c]) / heightStep); x <= Math.floor(Math.max(p[a], p[b], p[c]) / heightStep); x++)
        for (let y = Math.floor(Math.min(p[a + 1], p[b + 1], p[c + 1]) / heightStep); y <= Math.floor(Math.max(p[a + 1], p[b + 1], p[c + 1]) / heightStep); y++) {
          const key = `${x}:${y}`, list = this.bins.get(key) ?? []; list.push(face); this.bins.set(key, list);
        }
    }
  }
  bounds(x: number, y: number, hit?: { vertices?: number[] }): [number, number] | undefined {
    let low = Infinity, high = -Infinity;
    for (const { p, a, b, c } of this.bins.get(`${Math.floor(x / heightStep)}:${Math.floor(y / heightStep)}`) ?? []) {
      const det = (p[b + 1] - p[c + 1]) * (p[a] - p[c]) + (p[c] - p[b]) * (p[a + 1] - p[c + 1]);
      if (Math.abs(det) < 1e-10) continue;
      const u = ((p[b + 1] - p[c + 1]) * (x - p[c]) + (p[c] - p[b]) * (y - p[c + 1])) / det;
      const v = ((p[c + 1] - p[a + 1]) * (x - p[c]) + (p[a] - p[c]) * (y - p[c + 1])) / det, w = 1 - u - v;
      if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
      const z = u * p[a + 2] + v * p[b + 2] + w * p[c + 2]; low = Math.min(low, z);
      if (z > high) { high = z; if (hit) hit.vertices = [a / 3, b / 3, c / 3]; }
    }
    return Number.isFinite(low) ? [low, high] : undefined;
  }
}
/** Fit the superior rectus behind its covering without changing its authored width. */
export function seatRectusUnderPectorals(inside: Record<string, AnatomyMesh[]>, skin: AnatomyMesh, clearanceMm: number, exposure: (x: number, y: number) => number) {
  const pectorals = new AnteriorSurface((inside.otherMuscles ?? []).filter(m => /^pectoralis_major_/.test(m.anatomicalName ?? ''))), covering = new AnteriorSurface([skin]);
  const groups = new Map<string, AnatomyMesh[]>();
  for (const mesh of inside.rectusAbdominis ?? []) {
    const key = mesh.anatomyId ?? (mesh.anatomicalName?.includes('_L_') ? 'L' : 'R');
    const list = groups.get(key) ?? []; list.push(mesh); groups.set(key, list);
  }
  const volume = (meshes: AnatomyMesh[]) => meshes.reduce((sum, mesh) => sum + Math.abs(signedMeshVolume(mesh)), 0);
  const targets = new Map([...groups].map(([key, meshes]) => [key, volume(meshes)]));
  for (const mesh of inside.rectusAbdominis ?? []) {
    const p = mesh.positions, count = mesh.shellPairs ?? p.length / 3, shifts = new Float32Array(count); let moved = false;
    for (let vertex = 0; vertex < count; vertex++) {
      if (protectedVertex(mesh, vertex)) continue;
      const pair = mesh.shellPairs ? [vertex, vertex + mesh.shellPairs] : [vertex]; let shift = 0;
      for (const index of pair) {
        const i = index * 3, boneCover = pectorals.bounds(p[i], p[i + 1]), skinCover = !boneCover && exposure(p[i], p[i + 1]) < 1 ? covering.bounds(p[i], p[i + 1]) : undefined;
        const limit = boneCover?.[0] ?? skinCover?.[1];
        if (limit !== undefined) shift = Math.max(shift, p[i + 2] - limit + clearanceMm / 100);
      }
      shifts[vertex] = shift;
    }
    // Seat a transverse fiber row together. Independent column caps imprint the
    // individual pectoral fan triangles as jagged ridges in the rectus belly.
    if (mesh.surfaceGrid) {
      const stride = mesh.surfaceGrid.cols + 1, rows = mesh.surfaceGrid.rows + 1, need = new Float32Array(rows);
      for (let row = 0; row < rows; row++) for (let col = 0; col < stride; col++) need[row] = Math.max(need[row], shifts[row * stride + col]);
      let smooth = need.slice();
      for (let pass = 0; pass < 12; pass++) {
        const next = smooth.slice();
        for (let row = 1; row < rows - 1; row++) next[row] = Math.max(need[row], (smooth[row - 1] + 2 * smooth[row] + smooth[row + 1]) / 4);
        smooth = next;
      }
      for (let row = 0; row < rows; row++) for (let col = 0; col < stride; col++) {
        const vertex = row * stride + col;
        if (!protectedVertex(mesh, vertex)) shifts[vertex] = smooth[row];
      }
    }
    for (let vertex = 0; vertex < count; vertex++) {
      if (shifts[vertex] <= 0) continue;
      p[vertex * 3 + 2] -= shifts[vertex];
      if (mesh.shellPairs) p[(vertex + mesh.shellPairs) * 3 + 2] -= shifts[vertex];
      moved = true;
    }
    if (moved) mesh.normals = calculateNormals(mesh.positions, mesh.indices);
  }
  // Seating must not discard the requested volume. Redistribute its small volume
  // difference through exposed belly thickness, keeping width and covered chest fixed.
  for (const [key, meshes] of groups) {
    const target = targets.get(key)!;
    if (target <= 0 || Math.abs(volume(meshes) - target) / target < .00001) continue;
    const original = meshes.map(mesh => mesh.positions.slice());
    const set = (gain: number) => meshes.forEach((mesh, index) => {
      const source = original[index], pairs = mesh.shellPairs; if (!pairs) return;
      for (let vertex = 0; vertex < pairs; vertex++) {
        if (protectedVertex(mesh, vertex)) continue;
        const i = vertex * 3, j = (vertex + pairs) * 3, center = (source[i + 2] + source[j + 2]) * .5;
        const weight = exposure((source[i] + source[j]) * .5, (source[i + 1] + source[j + 1]) * .5);
        const scale = 1 + (gain - 1) * weight;
        mesh.positions[i + 2] = center + (source[i + 2] - center) * scale;
        mesh.positions[j + 2] = center + (source[j + 2] - center) * scale;
      }
    });
    let low = .001, high = 2; set(high);
    while (volume(meshes) < target && high < 64) { high *= 2; set(high); }
    for (let iteration = 0; iteration < 22; iteration++) {
      const mid = (low + high) * .5; set(mid);
      if (volume(meshes) < target) low = mid; else high = mid;
    }
    set((low + high) * .5);
    for (const mesh of meshes) mesh.normals = calculateNormals(mesh.positions, mesh.indices);
  }
}
