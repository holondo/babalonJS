import type { Matrix } from '@babylonjs/core/Maths/math.vector.js';
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { FaceSelection } from './selection';

export interface ScreenPoint { x: number; y: number }

function inside(x: number, y: number, polygon: ScreenPoint[]) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}

/** Vertices as shown (pose and morphs applied) → CSS pixels and view depth. */
function project(mesh: Mesh, viewProjection: Matrix, width: number, height: number) {
  const positions = mesh.getPositionData(true, true) ?? mesh.getVerticesData('position')!;
  const m = mesh.computeWorldMatrix(true).multiply(viewProjection).m;
  const n = positions.length / 3;
  const screen = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    const w = x * m[3] + y * m[7] + z * m[11] + m[15];
    const cx = x * m[0] + y * m[4] + z * m[8] + m[12];
    const cy = x * m[1] + y * m[5] + z * m[9] + m[13];
    screen[i * 3] = (cx / w * 0.5 + 0.5) * width;
    screen[i * 3 + 1] = (1 - (cy / w * 0.5 + 0.5)) * height;
    // w is the distance along the view direction; ≤ 0 means behind the camera
    screen[i * 3 + 2] = w;
  }
  return screen;
}

/**
 * Lasso (closed shape) or brush (stroke with a radius), in CSS pixels over the canvas.
 * Without "through", only faces visible from the camera count: a small software depth buffer
 * of the model is drawn once per stroke (much cheaper than a ray per face on dense meshes).
 */
export function selectScreen(selection: FaceSelection, points: ScreenPoint[], radius: number | null, through: boolean, add: boolean) {
  const editor = selection.editor;
  const canvas = editor.engine.getRenderingCanvas()!;
  const width = canvas.clientWidth, height = canvas.clientHeight;
  const viewProjection = editor.scene.getTransformMatrix();
  const meshes = [...selection.faces.keys()];
  const projected = new Map(meshes.map((mesh) => [mesh, project(mesh, viewProjection, width, height)]));

  // Region bounds, to skip most faces quickly
  const pad = radius ?? 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) { minX = Math.min(minX, p.x - pad); maxX = Math.max(maxX, p.x + pad); minY = Math.min(minY, p.y - pad); maxY = Math.max(maxY, p.y + pad); }
  const r2 = pad * pad;
  const hits = (x: number, y: number) => {
    if (x < minX || x > maxX || y < minY || y > maxY) return false;
    if (radius === null) return inside(x, y, points);
    for (const p of points) if ((p.x - x) ** 2 + (p.y - y) ** 2 <= r2) return true;
    return false;
  };

  // Depth buffer at half resolution
  const scale = 0.5;
  const bw = Math.max(1, Math.ceil(width * scale)), bh = Math.max(1, Math.ceil(height * scale));
  let depth: Float32Array | null = null;
  if (!through) {
    depth = new Float32Array(bw * bh).fill(Infinity);
    for (const mesh of meshes) {
      if (!mesh.isEnabled() || !mesh.isVisible) continue;
      const s = projected.get(mesh)!;
      const indices = mesh.getIndices()!;
      for (let t = 0; t < indices.length; t += 3) {
        const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
        const za = s[a + 2], zb = s[b + 2], zc = s[c + 2];
        if (za <= 0 || zb <= 0 || zc <= 0) continue;
        const ax = s[a] * scale, ay = s[a + 1] * scale, bx = s[b] * scale, by = s[b + 1] * scale, cx = s[c] * scale, cy = s[c + 1] * scale;
        const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(bw - 1, Math.ceil(Math.max(ax, bx, cx)));
        const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(bh - 1, Math.ceil(Math.max(ay, by, cy)));
        if (x0 > x1 || y0 > y1) continue;
        const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
        if (Math.abs(area) < 1e-12) {
          // Sub-pixel triangle: one sample
          const i = Math.min(bh - 1, Math.max(0, Math.round(ay))) * bw + Math.min(bw - 1, Math.max(0, Math.round(ax)));
          depth[i] = Math.min(depth[i], Math.min(za, zb, zc));
          continue;
        }
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const px = x + 0.5, py = y + 0.5;
          const w0 = ((bx - px) * (cy - py) - (cx - px) * (by - py)) / area;
          const w1 = ((cx - px) * (ay - py) - (ax - px) * (cy - py)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < -0.01 || w1 < -0.01 || w2 < -0.01) continue;
          const z = w0 * za + w1 * zb + w2 * zc;
          const i = y * bw + x;
          if (z < depth[i]) depth[i] = z;
        }
      }
    }
  }

  for (const mesh of meshes) {
    const s = projected.get(mesh)!;
    const indices = mesh.getIndices()!;
    const selected: number[] = [];
    for (let f = 0; f < indices.length / 3; f++) {
      const a = indices[f * 3] * 3, b = indices[f * 3 + 1] * 3, c = indices[f * 3 + 2] * 3;
      const z = (s[a + 2] + s[b + 2] + s[c + 2]) / 3;
      if (z <= 0) continue;
      const x = (s[a] + s[b] + s[c]) / 3, y = (s[a + 1] + s[b + 1] + s[c + 1]) / 3;
      if (!hits(x, y)) continue;
      if (depth) {
        // Visible when nothing is in front of the face's center (small tolerance for the coarser buffer)
        const bx = Math.min(bw - 1, Math.max(0, Math.floor(x * scale))), by = Math.min(bh - 1, Math.max(0, Math.floor(y * scale)));
        const front = depth[by * bw + bx];
        if (z > front * 1.01 + 1e-4) continue;
      }
      selected.push(f);
    }
    selection.apply(mesh, selected, add);
  }
  selection.refresh();
}

