import type { AnatomyMesh } from './contracts';
import type { Vec3M } from './landmarks';
import { SurfaceBVH } from './inference/observationProxy';
import { armBend } from './referencePose';
import type { AnatomyParameters } from './parameters';
import { inFoldContactBand, seatFoldFaces } from './foldFaceContact';

const folds = /^(pectoralis_major_|latissimus_dorsi_|teres_major_|serratus_anterior_|(?:external|internal)_intercostals_|deltoid|triceps_brachii_)/;
const neck = /^(sternocleidomastoid_|splenius_capitis_|levator_scapulae_|scalenus_|platysma_|trapezius_descending_)/;
const shoulder = /^(trapezius_(?:descending|transverse)_|deltoid|infraspinatus_|supraspinatus_|pectoralis_minor_|coracobrachialis_|triceps_brachii_|latissimus_dorsi_)/;
const lumbar = /^(latissimus_dorsi_|erector_|spinalis_|multifidus_|serratus_posterior_inferior_|quadratus_lumborum_|trapezius_ascending_|externalOblique_|thoracolumbar_fascia_|gluteus_maximus_)/;
const anteriorJunction = /^(pectoralis_major_|deltoid(?:Anterior|_anterior))/;
const rearShoulder = /^(deltoid|triceps_brachii_|latissimus_dorsi_)/;
const smooth = (a: number, b: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const bentElbowMuscle = /^(biceps_brachii_|brachialis|brachioradialis|triceps_brachii_|pronator_teres|flexor_|extensor_)/;

export function bentElbowBand(parameters: AnatomyParameters) {
  const arms = parameters.referencePose?.chains.filter(arm => armBend(arm) > .4) ?? [];
  return (x: number, y: number, z: number) => {
    const elbow = arms.find(arm => x * arm.side > 0)?.target[1];
    return elbow ? 1 - smooth(.052, .105, Math.hypot(x - elbow[0], y - elbow[1], z - elbow[2])) : 0;
  };
}

function nearestArmAxis(point: Vec3M, axis: Vec3M[]): Vec3M {
  let closest = axis[1], distance = Infinity;
  for (let segment = 0; segment < 2; segment++) {
    const start = axis[segment], end = axis[segment + 1];
    const direction = end.map((value, k) => value - start[k]);
    const lengthSq = direction.reduce((sum, value) => sum + value * value, 0);
    if (!lengthSq) continue;
    const fraction = Math.max(0, Math.min(1, direction.reduce((sum, value, k) =>
      sum + value * (point[k] - start[k]), 0) / lengthSq));
    const candidate = start.map((value, k) => value + direction[k] * fraction) as Vec3M;
    const error = Math.hypot(...candidate.map((value, k) => value - point[k]));
    if (error < distance) {
      closest = candidate;
      distance = error;
    }
  }
  return closest;
}

/** Seat the posed folds inside the fitted skin. A shell pair receives the
 * same displacement on both faces, preserving the local thickness. */
export function seatAxillaryMuscles(muscles: AnatomyMesh[], skin: AnatomyMesh, posed: Map<AnatomyMesh, Float32Array>, posterior: AnatomyMesh[], parameters: AnatomyParameters) {
  const covering = posed.get(skin);
  if (!covering) return;
  const surface = new SurfaceBVH({ positions: covering, indices: skin.indices });
  const orientation = Math.sign(surface.queryClosestPoint([0, 12.6, 3]).normal[2]) || 1;
  const clearance = .009, lateral = 18 / parameters.height;
  const elbowBand = bentElbowBand(parameters);
  const raisedArms = parameters.referencePose?.chains.filter(chain => armBend(chain) > .4) ?? [];
  const vertical = 1.8 / 17.5;
  const junctionWeight = (x: number, y: number, z: number) => {
    const arm = raisedArms.find(chain => x * chain.side > 0);
    if (!arm) return 0;
    const [sx, sy, sz] = arm.target[0];
    return 1 - smooth(.042, .110, Math.hypot(x * lateral - sx + arm.side * .026,
      y * vertical - sy + .037, z * lateral - sz - .047));
  };
  for (const mesh of muscles) {
    const count = mesh.shellPairs, grid = mesh.surfaceGrid, positions = posed.get(mesh);
    const name = mesh.anatomicalName ?? '', fold = folds.test(name), elbow = bentElbowMuscle.test(name);
    if (!count || !grid || grid.kind !== 'shell' || !positions || (!fold && !elbow)) continue;
    const stride = grid.cols + 1;
    const junctionMuscle = anteriorJunction.test(name);
    const addedJunction = new Uint8Array(count);
    const weights = Float32Array.from({ length: count }, (_, i) => {
      const [x, y] = [Math.abs(positions[i * 3]), positions[i * 3 + 1]];
      const row = Math.floor(i / stride);
      const start = mesh.attachments?.some(a => a.end === 'start');
      const end = mesh.attachments?.some(a => a.end === 'end');
      const tether = (start ? smooth(0, 2, row) : 1) * (end ? smooth(0, 2, grid.rows - row) : 1);
      const axilla = fold ? smooth(1.15, 1.55, x) * (1 - smooth(3.65, 4.25, x)) *
        smooth(11.05, 11.85, y) * (1 - smooth(14.45, 14.95, y)) : 0;
      const bend = elbow ? elbowBand(positions[i * 3] * lateral, y * 1.8 / 17.5, positions[i * 3 + 2] * lateral) : 0;
      // The anterior fold moves with the raised shoulder. Use the detected
      // joint to seat the paired shells where they meet the fitted covering.
      const junction = junctionMuscle ? junctionWeight(positions[i * 3], y, positions[i * 3 + 2]) : 0;
      if (junction > 0 && axilla < .1 && bend < .1) addedJunction[i] = 1;
      return tether * Math.max(axilla, bend, junction);
    });
    if (!weights.some(Boolean)) continue;
    const offset = new Float32Array(count * 3);
    for (let pass = 0; pass < 5; pass++) {
      let moved = false;
      const correction = new Float32Array(count * 3);
      const penetration = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        if (weights[i] === 0) continue;
        let worst = 0;
        for (const vertex of [i, i + count]) {
          const j = vertex * 3;
          const point: Vec3M = [positions[j], positions[j + 1], positions[j + 2]];
          const hit = surface.queryClosestPoint(point);
          const distance = orientation * hit.normal.reduce((sum, value, k) => sum + value * (point[k] - hit.point[k]), 0);
          if (distance <= worst) continue;
          worst = distance;
          const length = Math.sqrt(hit.distanceSq);
          const scale = Math.min(.22, length + clearance) / length;
          for (let k = 0; k < 3; k++) correction[i * 3 + k] = (hit.point[k] - point[k]) * scale;
          moved = true;
        }
        penetration[i] = worst;
      }
      if (!moved) break;
      // Spread part of the correction to neighboring fibres so individual
      // sampled triangles do not leave dents or pointed folds.
      for (let i = 0; i < count; i++) {
        if (!weights[i]) continue;
        const row = Math.floor(i / stride), col = i % stride, j = i * 3;
        const neighbors = [];
        if (col > 0) neighbors.push(i - 1);
        if (col < grid.cols) neighbors.push(i + 1);
        if (row > 0) neighbors.push(i - stride);
        if (row < grid.rows) neighbors.push(i + stride);
        const delta: Vec3M = [0, 0, 0];
        for (let k = 0; k < 3; k++) {
          const spread = neighbors.reduce((sum, n) => sum + correction[n * 3 + k], 0) / neighbors.length;
          const desired = offset[j + k] + weights[i] * (.76 * correction[j + k] + .24 * spread);
          const limit = addedJunction[i] ? .12 : .58;
          delta[k] = Math.max(-limit, Math.min(limit, desired)) - offset[j + k];
        }
        if (!delta.some(Boolean)) continue;
        // A closest-point correction on one face can send its partner
        // across the opposite wall of the narrow axillary recess.
        let worst = 0;
        for (const start of [j, j + count * 3]) {
          const point: Vec3M = [positions[start] + delta[0], positions[start + 1] + delta[1], positions[start + 2] + delta[2]];
          const hit = surface.queryClosestPoint(point);
          worst = Math.max(worst, orientation * hit.normal.reduce((sum, n, k) => sum + n * (point[k] - hit.point[k]), 0));
        }
        if (worst > penetration[i] + .001) continue;
        for (let k = 0; k < 3; k++) {
          offset[j + k] += delta[k];
          positions[j + k] += delta[k];
          positions[j + count * 3 + k] += delta[k];
        }
      }
    }
  }
  const bentArms = raisedArms;
  const factors: Vec3M = [lateral, vertical, lateral];
  const elbowSkin = bentArms.length ? new SurfaceBVH({
    positions: Float32Array.from(covering, (value, i) => value * factors[i % 3]),
    indices: skin.indices,
  }) : undefined;
  const elbowOrientation = Math.sign(elbowSkin?.queryClosestPoint([0, 1.30, .4]).normal[2] ?? 0) || 1;
  const elbowClearance = .001;
  const depth = (q: Vec3M, hit: ReturnType<SurfaceBVH['queryClosestPoint']>) =>
    elbowOrientation * hit.normal.reduce((sum, n, axis) => sum + n * (q[axis] - hit.point[axis]), 0);
  // The paired pass can stall when moving one face inward would expose its
  // partner across the crease. Trim just the exposed face in that case.
  for (const mesh of muscles) {
    if (!/^(brachialis|brachioradialis)_/.test(mesh.anatomicalName ?? '')) continue;
    const positions = posed.get(mesh);
    if (!positions || !elbowSkin) continue;
    for (let i = 0; i < positions.length; i += 3) {
      let point: Vec3M = [positions[i] * lateral, positions[i + 1] * vertical, positions[i + 2] * lateral];
      const band = elbowBand(...point);
      const weight = smooth(.15, .5, band);
      if (!weight) continue;
      for (let pass = 0; pass < 4; pass++) {
        const hit = elbowSkin.queryClosestPoint(point);
        const outside = depth(point, hit);
        if (outside <= .0002) break;
        const next = point.map((value, axis) =>
          value + weight * (hit.point[axis] - elbowOrientation * elbowClearance * hit.normal[axis] - value)) as Vec3M;
        if (depth(next, elbowSkin.queryClosestPoint(next)) >= outside) break;
        point = next;
      }
      // At the crease the nearest skin triangle may belong to the opposite
      // wall. Search toward the fitted arm axis for the first interior point.
      if (weight === 1 && depth(point, elbowSkin.queryClosestPoint(point)) > .0002) {
        const arm = bentArms.find(chain => point[0] * chain.side > 0);
        if (arm) {
          const center = nearestArmAxis(point, arm.target);
          let outside = point;
          for (let step = 1; step <= 12; step++) {
            let inside = point.map((v, k) => v + (center[k] - v) * step / 12) as Vec3M;
            if (depth(inside, elbowSkin.queryClosestPoint(inside)) > -elbowClearance) {
              outside = inside;
              continue;
            }
            for (let refine = 0; refine < 6; refine++) {
              const middle = outside.map((v, k) => (v + inside[k]) / 2) as Vec3M;
              if (depth(middle, elbowSkin.queryClosestPoint(middle)) > -elbowClearance) outside = middle;
              else inside = middle;
            }
            point = inside;
            break;
          }
        }
      }
      if (weight === 1) {
        const hit = elbowSkin.queryClosestPoint(point);
        if (depth(point, hit) > .0002) {
          // Probe either wall when the crease normal changes across an edge.
          let closest: Vec3M | undefined;
          let distance = Infinity;
          for (const radius of [.0012, .0035, .0075]) {
            for (let axis = 0; axis < 3; axis++) for (const side of [-1, 1]) {
              const candidate: Vec3M = [...hit.point];
              candidate[axis] += side * radius;
              const error = Math.hypot(...candidate.map((value, k) => value - point[k]));
              if (error >= distance || depth(candidate, elbowSkin.queryClosestPoint(candidate)) > -elbowClearance) continue;
              distance = error;
              closest = candidate;
            }
          }
          if (closest) point = closest;
        }
      }
      for (let axis = 0; axis < 3; axis++) positions[i + axis] = point[axis] / factors[axis];
    }
  }
  seatPosteriorShells(new Set([...muscles, ...posterior]), surface, orientation, posed);
  for (const muscle of muscles) {
    const name = muscle.anatomicalName ?? '';
    if (folds.test(name) || /^trapezius_descending_/.test(name))
      seatFoldFaces(muscle, posed.get(muscle), surface, orientation,
        anteriorJunction.test(name) && raisedArms.length
          ? (x, y, z) => inFoldContactBand(x, y) || junctionWeight(x, y, z) > .5
          : undefined);
  }
}

/** Keep the lateral neck, shoulder girdle and lumbar sheets under the same
 * covering. Rear rays distinguish a lumbar breakthrough from a nearby flank
 * or folded skin triangle with a misleading nearest normal. */
function seatPosteriorShells(meshes: Set<AnatomyMesh>, surface: SurfaceBVH, orientation: number, posed: Map<AnatomyMesh, Float32Array>) {
  for (const mesh of meshes) {
    const name = mesh.anatomicalName ?? '';
    const upperNeck = neck.test(name), upperShoulder = shoulder.test(name), lowerBack = lumbar.test(name);
    const rearGirdle = rearShoulder.test(name);
    const count = mesh.shellPairs, grid = mesh.surfaceGrid, positions = posed.get(mesh);
    if ((!upperNeck && !upperShoulder && !lowerBack) || !count || grid?.kind !== 'shell' || !positions) continue;
    const stride = grid.cols + 1;
    const rear = new Uint8Array(count);
    const influence = Float32Array.from({ length: count }, (_, vertex) => {
      const i = vertex * 3, x = Math.abs(positions[i]), y = positions[i + 1], z = positions[i + 2];
      const waist = lowerBack ? smooth(9.25, 9.65, y) * (1 - smooth(11.8, 12.25, y)) * smooth(.1, .3, -z) : 0;
      const cervical = upperNeck ? smooth(14.05, 14.6, y) * (1 - smooth(1.08, 1.5, x)) : 0;
      const girdle = upperShoulder ? smooth(12.8, 13.2, y) * (1 - smooth(3.6, 4.2, x)) : 0;
      rear[vertex] = waist > 0 || (rearGirdle && girdle > 0 && z < -.45 && y < 14.6) ? 1 : 0;
      return Math.max(waist, cervical, girdle);
    });
    if (!influence.some(Boolean)) continue;

    const sample = (i: number, delta: Vec3M, fromBack: boolean): { depth: number; inward: Vec3M } => {
      const point: Vec3M = [positions[i] + delta[0], positions[i + 1] + delta[1], positions[i + 2] + delta[2]];
      if (fromBack) {
        const hit = surface.queryRay([point[0], point[1], -5], [0, 0, 1], 5);
        return { depth: hit ? hit.point[2] - point[2] + .032 : -Infinity, inward: [0, 0, 1] };
      }
      const hit = surface.queryClosestPoint(point);
      const depth = orientation * hit.normal.reduce((sum, n, k) => sum + n * (point[k] - hit.point[k]), 0) + .018;
      return { depth, inward: hit.normal.map(n => -orientation * n) as Vec3M };
    };
    const zero: Vec3M = [0, 0, 0];
    for (let pass = 0; pass < 5; pass++) {
      const corrections: (Vec3M | undefined)[] = new Array(count);
      const depth = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        if (!influence[i]) continue;
        const outer = sample(i * 3, zero, !!rear[i]), inner = sample((i + count) * 3, zero, !!rear[i]);
        const worst = outer.depth > inner.depth ? outer : inner;
        depth[i] = worst.depth;
        if (worst.depth <= 0) continue;
        const distance = Math.min(.35, worst.depth + .018) * influence[i];
        corrections[i] = worst.inward.map(n => n * distance) as Vec3M;
      }
      if (!corrections.some(Boolean)) break;
      for (let i = 0; i < count; i++) {
        if (!influence[i]) continue;
        const row = Math.floor(i / stride), col = i % stride;
        const neighbors = [col > 0 ? i - 1 : -1, col < grid.cols ? i + 1 : -1,
          row > 0 ? i - stride : -1, row < grid.rows ? i + stride : -1];
        const attached = mesh.attachments?.some(a => a.end === 'start' ? row === 0 : row === grid.rows);
        const correction = corrections[i];
        const delta: Vec3M = correction ? [...correction] : [0, 0, 0];
        // Move an attachment row only when that row itself pierces the skin.
        if (!attached) for (const n of neighbors) {
          const neighbor = corrections[n];
          if (neighbor) for (let k = 0; k < 3; k++) delta[k] += neighbor[k] * .13 * influence[i];
        }
        if (!delta.some(Boolean)) continue;
        const j = i * 3, paired = (i + count) * 3;
        if (Math.max(sample(j, delta, !!rear[i]).depth, sample(paired, delta, !!rear[i]).depth) > Math.max(0, depth[i]) + .001) continue;
        for (let k = 0; k < 3; k++) {
          positions[j + k] += delta[k];
          positions[paired + k] += delta[k];
        }
      }
    }
  }
}
