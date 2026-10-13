import { normalSign } from './normals';
import earcut, { deviation } from 'earcut';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { weld } from '../rigging/skinMath';
import type { FaceLookup, MeshPart } from './parts';
import { growable } from './parts';
import { tr } from '../core/i18n';

export interface Border { vertices: number[]; faces: number[] }
/** Positional topology detects real holes while leaving UV seams as separate vertices. */
/**
 * `open(face, edge)`: for a local part cut out of a larger mesh, says whether an edge is open in
 * the whole mesh (the local part's own outline isn't an opening).
 */
export function borders(part: MeshPart, open?: (face: number, edge: number) => boolean, welded?: ArrayLike<number>): Border[] {
  const p = part.attributes?.position; if (!p) return [];
  // `welded`: the whole mesh's weld for a local part (a weld of the small part alone uses another tolerance)
  const map = welded ?? weld(Float32Array.from(p)).map;
  const edges = new Map<string, { a: number; b: number; face: number; edge: number }[]>();
  for (let f = 0; f < part.indices.length / 3; f++) for (let j = 0; j < 3; j++) {
    if (new Set(part.indices.slice(f * 3, f * 3 + 3).map(i => map[i])).size < 3) continue;
    const a = part.indices[f * 3 + j], b = part.indices[f * 3 + (j + 1) % 3];
    if (map[a] === map[b]) continue;
    const key = map[a] < map[b] ? `${map[a]},${map[b]}` : `${map[b]},${map[a]}`;
    const list = edges.get(key) ?? []; list.push({ a, b, face: f, edge: j }); edges.set(key, list);
  }
  // Real models often have a few edges shared by 3+ faces (touching pieces): those aren't
  // openings, so they are skipped instead of refusing the whole mesh
  const singles = [...edges.values()].filter(e => e.length === 1 && (!open || open(e[0].face, e[0].edge))).map(e => e[0]);
  // Several openings can meet at one vertex: keep every outgoing edge and walk unused ones
  const outgoing = new Map<number, typeof singles>();
  for (const e of singles) {
    const list = outgoing.get(map[e.a]) ?? [];
    list.push(e); outgoing.set(map[e.a], list);
  }
  const used = new Set<typeof singles[number]>();
  const loops: Border[] = [];
  for (const first of singles) {
    if (used.has(first)) continue;
    const vertices: number[] = [], faces: number[] = [];
    let edge: typeof first | undefined = first, closed = false;
    while (edge && !used.has(edge)) {
      used.add(edge); vertices.push(edge.a); faces.push(edge.face);
      if (map[edge.b] === map[first.a]) { closed = true; break; }
      edge = outgoing.get(map[edge.b])?.find(e => !used.has(e));
    }
    // Open chains (e.g. a torn edge) aren't fillable openings: leave them out
    if (closed && vertices.length >= 3) loops.push({ vertices, faces });
  }
  return loops;
}

const inside = (x: number, y: number, ring: number[]) => {
  let hit = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) if ((ring[i + 1] > y) !== (ring[j + 1] > y) && x < (ring[j] - ring[i]) * (y - ring[i + 1]) / (ring[j + 1] - ring[i + 1]) + ring[i]) hit = !hit;
  return hit;
};

/** Append caps only to selected simple planar loops, preserving every original attribute. */
/**
 * `shown`: vertex positions as displayed, when they differ from the stored ones (a skeleton from the
 * file stores vertices in its bind pose). Flatness, projection and triangle order are decided on
 * what the user sees; the new faces still use the stored positions and skin weights.
 */
export function fillHoles(source: MeshPart, selected?: FaceLookup, material = 0, plane?: { origin: Vector3; normal: Vector3; tolerance: number }, shown?: ArrayLike<number>, report?: { closed: number; skipped: number }, open?: (face: number, edge: number) => boolean, welded?: ArrayLike<number>): MeshPart {
  const winding = normalSign(source);
  const part = growable(source), attrs = part.attributes!, p = shown ?? attrs.position;
  const loops = borders(part, open, welded).filter(l => (!selected || l.faces.some(f => selected.has(f))) && (!plane || l.vertices.every(i => Math.abs(Vector3.Dot(Vector3.FromArray(p, i * 3).subtract(plane.origin), plane.normal)) <= plane.tolerance)));
  if (!loops.length) { if (plane) return source; throw new Error(tr('Select faces next to an open border.')); }
  const points = (loop: Border) => loop.vertices.map(i => Vector3.FromArray(p, i * 3));
  // Openings that can't be capped safely (curved, degenerate) are skipped, not fatal: a selection
  // often touches a model's own openings next to the one the user means
  let firstError: Error | null = null, skipped = 0;
  const frames = loops.flatMap(loop => {
    const pts = points(loop), origin = pts[0], n = new Vector3();
    for (let i = 0; i < pts.length; i++) n.addInPlace(Vector3.Cross(pts[i].subtract(origin), pts[(i + 1) % pts.length].subtract(origin)));
    const size = Math.max(...pts.map(x => Vector3.Distance(x, origin)), 1e-6);
    let reason: string | null = null;
    if (n.lengthSquared() < 1e-18) reason = tr('The opening is too small to fill.');
    else {
      n.normalize();
      if (pts.some(x => Math.abs(Vector3.Dot(x.subtract(origin), n)) > size * .005)) reason = tr('Only near-planar openings can be filled.');
    }
    if (reason) { firstError ??= new Error(reason); skipped++; return []; }
    const u = pts[1].subtract(origin).normalize(), v = Vector3.Cross(n, u).normalize();
    return [{ loop, origin, n, u, v, size }];
  });
  if (!frames.length) { if (plane) return source; throw firstError ?? new Error(tr('Select faces next to an open border.')); }
  /** New cap vertex → the border vertex it copies (to read its displayed position). */
  const sourceOf = new Map<number, number>();
  const done = new Set<Border>(); const initialCount = p.length / 3, capStart = part.indices.length;
  for (const frame of frames) {
    if (done.has(frame.loop)) continue;
    const coplanar = frames.filter(f => !done.has(f.loop) && Math.abs(Vector3.Dot(frame.n, f.n)) > .999 && points(f.loop).every(x => Math.abs(Vector3.Dot(x.subtract(frame.origin), frame.n)) < frame.size * .005));
    const project = (loop: Border) => points(loop).flatMap(x => { const d = x.subtract(frame.origin); return [Vector3.Dot(d, frame.u), Vector3.Dot(d, frame.v)]; });
    const projected = coplanar.map(f => ({ f, xy: project(f.loop) }));
    // Largest enclosing contour first; nested contours become holes rather than overlapping caps.
    const area = (xy: number[]) => Math.abs(xy.reduce((sum, _, i) => i % 2 ? sum : sum + xy[i] * xy[(i + 3) % xy.length] - xy[(i + 2) % xy.length] * xy[i + 1], 0));
    projected.sort((a, b) => area(b.xy) - area(a.xy));
    for (const outer of projected) {
      if (done.has(outer.f.loop)) continue;
      const nested = projected.filter(x => x !== outer && !done.has(x.f.loop) && inside(x.xy[0], x.xy[1], outer.xy));
      const rings = [outer, ...nested]; const flat = rings.flatMap(x => x.xy), holes: number[] = [];
      let cursor = outer.xy.length / 2; for (const ring of nested) { holes.push(cursor); cursor += ring.xy.length / 2; }
      const triangles = earcut(flat, holes, 2);
      if (!triangles.length || deviation(flat, holes, 2, triangles) > 1e-5) {
        rings.forEach((ring) => done.add(ring.f.loop));
        firstError ??= new Error(tr('The opening cannot be triangulated safely.'));
        skipped += rings.length;
        continue;
      }
      const ids: number[] = [];
      for (const ring of rings) {
        done.add(ring.f.loop);
        for (const [j, original] of ring.f.loop.vertices.entries()) {
          const index = attrs.position.length / 3; ids.push(index); sourceOf.set(index, original);
          for (const [kind, values] of Object.entries(attrs)) {
            const stride = source.attributes![kind].length / initialCount;
            const valuesAt = source.attributes![kind].slice(original * stride, original * stride + stride);
            if (kind === 'normal') outer.f.n.scale(winding).toArray(valuesAt);
            if (kind === 'uv') { valuesAt[0] = ring.xy[j * 2] / frame.size; valuesAt[1] = ring.xy[j * 2 + 1] / frame.size; }
            values.push(...valuesAt);
          }
        }
      }
      for (let i = 0; i < triangles.length; i += 3) {
        const tri = triangles.slice(i, i + 3).map(t => ids[t]);
        // Ensure each cap's boundary runs against the existing surface winding.
        const at = (k: number) => Vector3.FromArray(p, (shown ? sourceOf.get(k)! : k) * 3);
        const a = at(tri[0]), b = at(tri[1]), c = at(tri[2]);
        if (Vector3.Dot(Vector3.Cross(b.subtract(a), c.subtract(a)), outer.f.n) > 0) [tri[1], tri[2]] = [tri[2], tri[1]];
        part.indices.push(...tri);
      }
    }
  }
  if (part.indices.length === capStart) { if (plane) return source; throw firstError ?? new Error(tr('Select faces next to an open border.')); }
  if (report) { report.closed += loops.length - skipped; report.skipped += skipped; }
  part.materials.push({ material, start: capStart, count: part.indices.length - capStart });
  delete attrs.tangent;
  return part;
}
