import { normalSign } from './normals';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Editor } from '../core/editor';
import type { FaceSelection } from './selection';
import { borders } from './holes';
import { openEdges } from './faceTopology';
import { applyPart, capturePart, compactFaces } from './parts';
import type { MeshPart } from './parts';
import { copyMesh, cloneMaterial, spawnComposite, staticMeshBlocker, disposeMeshCopy } from './combine';
import { tr } from '../core/i18n';

/** Bridge two selected closed contours, retaining each border's original vertices. */
export function bridgePart(selection: FaceSelection, reverse = false, offset = 0) {
  const entity = selection.entity, reason = staticMeshBlocker(entity); if (reason) throw new Error(reason);
  const loops: { points: Vector3[]; mesh: Mesh; face: number }[] = [];
  const inv = entity.root.computeWorldMatrix(true).clone().invert();
  for (const [mesh, faces] of selection.faces) {
    if (!faces.size) continue;
    const part = capturePart(mesh, true), world = mesh.computeWorldMatrix(true).multiply(inv);
    // Borders are found among the faces along open edges only (a small local part)
    const topology = selection.neighbors(mesh), { faces: edge, open } = openEdges(topology, part.indices);
    if (!edge.length) continue;
    const { local, globalOf } = compactFaces(part, edge);
    for (const loop of borders(local, (f, j) => open(edge[f], j), Uint32Array.from(globalOf, (v) => topology.weld[v]))) if (loop.faces.some(f => faces.has(edge[f]))) {
      const points = loop.vertices.map(i => Vector3.TransformCoordinates(Vector3.FromArray(local.attributes!.position, i * 3), world));
      if (world.determinant() < 0) points.reverse();
      loops.push({ mesh, face: edge[loop.faces[0]], points });
    }
  }
  if (loops.length !== 2) throw new Error(tr('Select faces next to exactly two open borders.'));
  const a = loops[0].points, b = [...loops[1].points].reverse();
  if (reverse) b.reverse();
  // Start at the closest pair, with an explicit offset available for twisted correspondences.
  let ia = 0, ib = 0, closest = Infinity;
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) { const d = Vector3.DistanceSquared(a[i], b[j]); if (d < closest) { closest = d; ia = i; ib = j; } }
  const aa = [...a.slice(ia), ...a.slice(0, ia)]; ib = (ib + offset % b.length + b.length) % b.length;
  const bb = [...b.slice(ib), ...b.slice(0, ib)];
  const parameters = (p: Vector3[]) => { const t = [0]; for (let i = 0; i < p.length; i++) t.push(t[i] + Vector3.Distance(p[i], p[(i + 1) % p.length])); if (t[t.length - 1] < 1e-8) throw new Error(tr('The opening is too small to fill.')); return t.map(x => x / t[t.length - 1]); };
  const ta = parameters(aa), tb = parameters(bb);
  const part: MeshPart & { indices: number[]; attributes: Record<string, number[]> } = { indices: [], materials: [], attributes: { position: [...aa, ...bb].flatMap(v => v.asArray()), normal: Array((aa.length + bb.length) * 3).fill(0), uv: [...aa.map((_, i) => [ta[i], 0]), ...bb.map((_, i) => [tb[i], 1])].flat() } };
  const nextA = (i: number) => i % aa.length, nextB = (j: number) => aa.length + j % bb.length;
  let i = 0, j = 0;
  while (i < aa.length || j < bb.length) {
    if (j === bb.length || i < aa.length && ta[i + 1] <= tb[j + 1]) { part.indices.push(nextA(i + 1), nextA(i), nextB(j)); i++; }
    else { part.indices.push(nextA(i), nextB(j), nextB(j + 1)); j++; }
  }
  // Reject collapsed triangles rather than publish a broken seam.
  const p = part.attributes!.position;
  const winding = normalSign(capturePart(loops[0].mesh, true));
  for (let f = 0; f < part.indices.length; f += 3) {
    const ids = Array.from(part.indices.slice(f, f + 3)), pts = ids.map((k) => Vector3.FromArray(p, k * 3));
    const normal = Vector3.Cross(pts[2].subtract(pts[0]), pts[1].subtract(pts[0])).scale(winding);
    if (normal.lengthSquared() < 1e-18) throw new Error(tr('The borders overlap or create collapsed faces. Reposition them.'));
    for (const k of ids) { const normals = part.attributes!.normal; normals[k * 3] += normal.x; normals[k * 3 + 1] += normal.y; normals[k * 3 + 2] += normal.z; }
  }
  for (let k = 0; k < p.length; k += 3) Vector3.FromArray(part.attributes!.normal, k).normalize().toArray(part.attributes!.normal, k);
  const material = loops[0].mesh.subMeshes.find(s => loops[0].face * 3 >= s.indexStart && loops[0].face * 3 < s.indexStart + s.indexCount)?.materialIndex ?? 0;
  part.materials = [{ material, start: 0, count: part.indices.length }];
  return { part, mesh: loops[0].mesh };
}

export function connectBorders(editor: Editor, selection: FaceSelection, reverse = false, offset = 0) {
  const source = selection.entity, bridge = bridgePart(selection, reverse, offset);
  const inv = source.root.computeWorldMatrix(true).clone().invert();
  const meshes: Mesh[] = [];
  try {
    for (const m of source.meshes) meshes.push(copyMesh(m as Mesh, m.computeWorldMatrix(true).multiply(inv)));
    const seam = new Mesh(tr('Connection'), editor.scene);
    seam.overrideMaterialSideOrientation = bridge.mesh.overrideMaterialSideOrientation;
    applyPart(seam, bridge.part); if (bridge.mesh.material) seam.material = cloneMaterial(bridge.mesh.material);
    meshes.push(seam);
    const origins = source.meshes.map((_, i) => source.composite?.origins[i] ?? { asset: source.source?.asset, primitive: source.primitive, mesh: i });
    origins.push(origins[source.meshes.indexOf(bridge.mesh)]);
    const result = spawnComposite(editor, source.name, meshes, origins);
    result.root.position.copyFrom(source.root.position); result.root.rotationQuaternion!.copyFrom(source.root.rotationQuaternion!); result.root.scaling.copyFrom(source.root.scaling);
    editor.group(() => { editor.remove(source); editor.publishSeparated(result); });
    editor.select(result);
    return result;
  } catch (error) { meshes.forEach(disposeMeshCopy); throw error; }
}
