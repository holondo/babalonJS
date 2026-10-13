import type { MeshPart } from './parts';

/** Imported glTF and Babylon primitives may use opposite local winding conventions. */
export function normalSign(part: MeshPart) {
  const p = part.attributes!.position, n = part.attributes!.normal;
  if (!n) return 1;
  for (let f = 0; f < part.indices.length; f += 3) {
    const [a, b, c] = part.indices.slice(f, f + 3).map(i => i * 3);
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const dot = (vy * uz - vz * uy) * (n[a] + n[b] + n[c]) + (vz * ux - vx * uz) * (n[a + 1] + n[b + 1] + n[c + 1]) + (vx * uy - vy * ux) * (n[a + 2] + n[b + 2] + n[c + 2]);
    if (Math.abs(dot) > 1e-12) return dot > 0 ? 1 : -1;
  }
  return 1;
}
