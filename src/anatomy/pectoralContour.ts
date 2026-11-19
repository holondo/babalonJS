import type { AnatomyMesh } from './contracts';
import type { MuscleShape } from './definition';
import { calculateNormals } from './algorithms/loft';

export const pectoralStations = [.18, .34, .50, .66, .82];
const smooth = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
export function pectoralCoveringBasis(x: number, y: number, z: number) {
  const lateral = Math.abs(x);
  const mask = smooth((lateral - .015) / .045) * (1 - smooth((lateral - .195) / .052)) *
    smooth((y - 1.25) / .065) * (1 - smooth((y - 1.43) / .055)) * smooth((z - .018) / .045);
  if (!mask) return;
  const u = smooth((lateral - .075) / .115), v = smooth((y - 1.315) / .09);
  const a = 1 - v, b = 2 * v * a, c = v * v;
  return [a*a*(1-u), a*a*u, b*(1-u), b*u, c*(1-u), c*u].map(weight => weight * mask);
}

/** Two separate, bounded corrections for the lateral wall and upper shelf. */
export function deltopectoralCoveringBasis(x: number, y: number, z: number) {
  const lateral = Math.abs(x);
  const front = smooth((z - .02) / .045);
  const bump = (value: number, center: number, radius: number) => smooth(1 - Math.abs(value - center) / radius);
  return [
    front * bump(lateral, .205, .068) * bump(y, 1.365, .061),
    front * bump(lateral, .156, .105) * bump(y, 1.445, .05),
  ];
}
const endWeight = (t: number) => smooth(t / .18) * smooth((1 - t) / .18);
export function axillaryProjectionWeight(u: number, v: number) {
  return smooth((u-.48)/.22) * endWeight(u) * Math.sin(Math.PI*v)**2;
}

function stationValue(values: number[], t: number) {
  const x = Math.max(0, Math.min(3.999999, (t - pectoralStations[0]) / .16));
  const i = Math.floor(x), w = smooth(x - i);
  return values[i] * (1 - w) + values[i + 1] * w;
}

/** One smooth correction across the inferior fan. Fixed endpoints preserve the
 * clavicular/sternal origins and the common humeral insertion. */
export function applyPectoralContour(mesh: AnatomyMesh, contour: NonNullable<MuscleShape['pectoralContour']>, height: number) {
  const name = mesh.anatomicalName ?? '', costal = name.startsWith('pectoralis_major_cost_');
  if (!costal && !name.startsWith('pectoralis_major_stern_')) return;
  const grid = mesh.surfaceGrid, pairs = mesh.shellPairs;
  if (!grid || !pairs) return;
  for (let row = 1; row < grid.rows; row++) {
    const t = row / grid.rows, w = endWeight(t);
    const first = row * (grid.cols + 1), last = first + grid.cols;
    const gap = Math.abs(mesh.positions[last * 3 + 1] - mesh.positions[first * 3 + 1]);
    const requestedLift = stationValue(contour.lift, t) * w / (1000 * 1.8 / 17.5);
    const lift = Math.min(gap * .8, requestedLift);
    const depth = stationValue(contour.projection, t) * w * height / 18000;
    for (let col = 0; col <= grid.cols; col++) {
      const v = col / grid.cols, vertex = row * (grid.cols + 1) + col;
      // Identical projection at the costal/sternal shared edge.
      const profile = costal ? .55 + .45 * smooth(v) : 1 - smooth(v / .7);
      const front = vertex * 3 + 2, back = (vertex + pairs) * 3 + 2;
      const axillary = costal ? 0 : (contour.axillaryProjection ?? 0) * height / 18000 * axillaryProjectionWeight(t,v);
      mesh.positions[front] += Math.max(-.35 * Math.max(0, mesh.positions[front] - mesh.positions[back]), depth * profile + axillary);
      if (costal) for (const i of [vertex, vertex + pairs]) mesh.positions[i * 3 + 1] += lift * (1 - smooth(v));
    }
  }
  mesh.normals = calculateNormals(mesh.positions, mesh.indices);
}

/** Reconcile the internal fan seams only where the two patches are neighbours.
 * Fade into the adjacent columns and leave the attachment rows intact. */
export function blendAdjacentShellEdges(inferior: AnatomyMesh, superior: AnatomyMesh) {
  const a = inferior.surfaceGrid, b = superior.surfaceGrid;
  const ap = inferior.shellPairs, bp = superior.shellPairs;
  if (!a || !b || !ap || !bp || a.rows !== b.rows) return;
  for (let row = 1; row < a.rows; row++) {
    const weight = endWeight(row / a.rows);
    for (let layer = 0; layer < 2; layer++) {
      const ai = row * (a.cols + 1) + a.cols + layer * ap, bi = row * (b.cols + 1) + layer * bp;
      const difference = [0, 1, 2].map(k => superior.positions[bi * 3 + k] - inferior.positions[ai * 3 + k]);
      if (Math.hypot(...difference) > .25) continue;
      for (let step = 0; step <= 3; step++) {
        const blend = weight * (1 - smooth(step / 4)) * .5;
        for (let k = 0; k < 3; k++) {
          inferior.positions[(ai - step) * 3 + k] += difference[k] * blend;
          superior.positions[(bi + step) * 3 + k] -= difference[k] * blend;
        }
      }
    }
  }
  inferior.normals = calculateNormals(inferior.positions, inferior.indices);
  superior.normals = calculateNormals(superior.positions, superior.indices);
}

/** Ease the clavicular edge toward the adjacent deltoid, retaining a groove
 * between them and leaving the attachment rows fixed. */
export function easeDeltopectoralGroove(pectoral: AnatomyMesh, deltoid: AnatomyMesh, projection?: number[], height = 180) {
  const a = pectoral.surfaceGrid, b = deltoid.surfaceGrid, pairs = pectoral.shellPairs;
  if (!a || !b || !pairs) return;
  for (let row = Math.ceil(a.rows * .52); row < a.rows; row++) {
    const edge = row * (a.cols + 1) + a.cols;
    const x = pectoral.positions[edge * 3], y = pectoral.positions[edge * 3 + 1];
    let nearby = 0, target = 0, targetX = 0, targetY = 0;
    for (let j = 1; j < b.rows; j++) {
      const i = j * (b.cols + 1) * 3;
      const distance = Math.hypot(x - deltoid.positions[i], y - deltoid.positions[i + 1]);
      const weight = (1 - smooth(distance / .42)) ** 2;
      nearby += weight;
      target += (deltoid.positions[i + 2] - .025) * weight;
      targetX += deltoid.positions[i] * weight;
      targetY += deltoid.positions[i + 1] * weight;
    }
    const t = row / a.rows;
    const delta = nearby ? Math.max(-.075, Math.min(.075, target / nearby - pectoral.positions[edge * 3 + 2])) : 0;
    const correction = projection ? stationValue(projection, t) * height / 18000 : 0;
    const transition = smooth((t - .52) / .18) * endWeight(t);
    const moveEdge = (delta * .45 * smooth(nearby) + correction) * transition;
    const dx = nearby ? targetX / nearby - x : 0, dy = nearby ? targetY / nearby - y : 0;
    const gap = Math.hypot(dx,dy);
    const slide = gap ? Math.min(.12,Math.max(0,gap-.035)*.4)/gap * smooth(nearby) * transition : 0;
    const columns = Math.max(1, Math.round(a.cols * .4));
    for (let step = 0; step <= columns; step++) {
      const front = (edge - step) * 3 + 2, back = front + pairs * 3;
      const weight = 1 - smooth(step / columns);
      const move = moveEdge * weight;
      for (const vertex of [front,back]) {
        pectoral.positions[vertex-2] += dx * slide * weight;
        pectoral.positions[vertex-1] += dy * slide * weight;
      }
      pectoral.positions[front] += Math.max(move, -.3 * Math.max(0, pectoral.positions[front] - pectoral.positions[back]));
    }
  }
  pectoral.normals = calculateNormals(pectoral.positions, pectoral.indices);
}
