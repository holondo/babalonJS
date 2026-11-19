import type { AnatomyMesh } from './contracts';
import { calculateNormals } from './algorithms/loft';

type Point = [number, number, number];
export interface PatchSample {
  surfaceId: string;
  revision: string;
  triangle: number;
  barycentric: Point;
  u: number;
  v: number;
}
export interface MeshAttachment {
  id: string;
  end: 'start' | 'end';
  samples: PatchSample[];
  offsets: number[];
  signs: number[];
}
export interface AttachmentMetric { id: string; surfaceId: string; errorMm: number; samples: number; quality: 'procedural'; }
export function surfaceRevision(mesh: AnatomyMesh) {
  const grid = mesh.surfaceGrid;
  if (!grid) throw new Error('Attachment surface has no procedural grid.');
  return `grid1:${grid.kind}:${grid.rows}:${grid.cols}:${mesh.positions.length}:${mesh.indices.length}`;
}
/** Semantic UV locators are resolved on the current named recipe, never on skin or a global nearest bone. */
export function samplePatch(mesh: AnatomyMesh, u: number, v: number): PatchSample {
  const grid = mesh.surfaceGrid;
  if (!grid || !mesh.anatomicalName) throw new Error('Missing named anatomical support surface.');
  u = Math.max(0, Math.min(1 - 1e-8, u)); v = Math.max(0, Math.min(1 - 1e-8, v));
  const x = u * grid.cols, y = v * grid.rows, col = Math.floor(x), row = Math.floor(y), a = x - col, b = y - row;
  const second = a + b > 1;
  const triangle = (row * grid.cols + col) * (grid.kind === 'shell' ? 4 : 2) + (second ? 1 : 0);
  const barycentric: Point = grid.kind === 'shell'
    ? second ? [1 - b, a + b - 1, 1 - a] : [1 - a - b, a, b]
    : second ? [1 - b, 1 - a, a + b - 1] : [1 - a - b, b, a];
  return { surfaceId: mesh.anatomicalName, revision: surfaceRevision(mesh), triangle, barycentric, u, v };
}
export function patchPoint(mesh: AnatomyMesh, sample: PatchSample, positions = mesh.positions): { point: Point; normal: Point } {
  if (sample.surfaceId !== mesh.anatomicalName || sample.revision !== surfaceRevision(mesh)) throw new Error('Stale anatomical surface attachment.');
  const vertices = [0, 1, 2].map(k => mesh.indices[sample.triangle * 3 + k] * 3);
  const point: Point = [0, 0, 0];
  for (let k = 0; k < 3; k++) for (let axis = 0; axis < 3; axis++) point[axis] += positions[vertices[k] + axis] * sample.barycentric[k];
  const a = vertices[0], b = vertices[1], c = vertices[2];
  const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
  const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
  const normal: Point = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx], length = Math.hypot(...normal);
  if (length < 1e-10) throw new Error('Degenerate anatomical attachment surface.');
  for (let axis = 0; axis < 3; axis++) normal[axis] /= length;
  return { point, normal };
}
function boundaryCenter(mesh: AnatomyMesh, positions: Float32Array, end: MeshAttachment['end'], col: number): Point {
  const grid = mesh.surfaceGrid!, row = end === 'start' ? 0 : grid.rows;
  if (grid.kind === 'tube') {
    const point: Point = [0, 0, 0];
    for (let u = 0; u < grid.cols; u++) for (let axis = 0; axis < 3; axis++) point[axis] += positions[(row * grid.cols + u) * 3 + axis] / grid.cols;
    return point;
  }
  const i = row * (grid.cols + 1) + col, pair = mesh.shellPairs!;
  return [0, 1, 2].map(axis => (positions[i * 3 + axis] + positions[(i + pair) * 3 + axis]) * .5) as Point;
}
/** Used in rest and again after the existing pose fields, against the actual posed support triangles. */
export function applyMeshAttachments(mesh: AnatomyMesh, surfaces: Map<string, AnatomyMesh>, positions = mesh.positions, posed?: Map<AnatomyMesh, Float32Array>) {
  const grid = mesh.surfaceGrid;
  if (!grid || !mesh.attachments?.length) return;
  const stride = grid.kind === 'shell' ? grid.cols + 1 : grid.cols;
  for (const binding of mesh.attachments) {
    const deltas = binding.samples.map((sample, col) => {
      const support = surfaces.get(sample.surfaceId);
      if (!support) throw new Error(`Unresolved anatomical support: ${sample.surfaceId}`);
      const { point, normal } = patchPoint(support, sample, posed?.get(support));
      const center = boundaryCenter(mesh, positions, binding.end, col);
      return point.map((value, axis) => value + normal[axis] * binding.offsets[col] * binding.signs[col] - center[axis]);
    });
    for (let row = 0; row <= grid.rows; row++) {
      const t = row / grid.rows, weight = (binding.end === 'start' ? 1 - t : t) ** 4;
      for (let col = 0; col < stride; col++) {
        const delta = deltas[grid.kind === 'tube' ? 0 : col], vertex = row * stride + col;
        for (let axis = 0; axis < 3; axis++) {
          positions[vertex * 3 + axis] += delta[axis] * weight;
          if (mesh.shellPairs) positions[(vertex + mesh.shellPairs) * 3 + axis] += delta[axis] * weight;
        }
      }
    }
    if (grid.kind === 'tube') for (let cap = 0; cap < 2; cap++) {
      if ((binding.end === 'start') !== (cap === 0)) continue;
      const vertex = (grid.rows + 1) * stride + cap;
      for (let axis = 0; axis < 3; axis++) positions[vertex * 3 + axis] += deltas[0][axis];
    }
  }
}
export function attachmentMetrics(meshes: AnatomyMesh[], posed?: Map<AnatomyMesh, Float32Array>): AttachmentMetric[] {
  const surfaces = new Map(meshes.filter(m => m.anatomicalName).map(m => [m.anatomicalName!, m]));
  return meshes.flatMap(mesh => (mesh.attachments ?? []).map(binding => {
    let error = 0;
    binding.samples.forEach((sample, col) => {
      const support = surfaces.get(sample.surfaceId)!;
      const { point, normal } = patchPoint(support, sample, posed?.get(support));
      const center = boundaryCenter(mesh, posed?.get(mesh) ?? mesh.positions, binding.end, col);
      error = Math.max(error, Math.hypot(...point.map((value, axis) => value + normal[axis] * binding.offsets[col] * binding.signs[col] - center[axis])) * 100);
    });
    return { id: binding.id, surfaceId: binding.samples[0].surfaceId, errorMm: error, samples: binding.samples.length, quality: 'procedural' as const };
  }));
}
function attacher(surfaces: Map<string, AnatomyMesh>) {
  return (mesh: AnatomyMesh, end: MeshAttachment['end'], id: string, locator: (u: number) => [string, number, number]) => {
    const grid = mesh.surfaceGrid; if (!grid) return;
    const samples: PatchSample[] = [], offsets: number[] = [], signs: number[] = [];
    const count = grid.kind === 'shell' ? grid.cols + 1 : 1;
    for (let col = 0; col < count; col++) {
      const [surfaceId, u, v] = locator(count === 1 ? .5 : col / (count - 1)), support = surfaces.get(surfaceId);
      if (!support) throw new Error(`Missing named attachment surface: ${surfaceId}`);
      const sample = samplePatch(support, u, v), { point, normal } = patchPoint(support, sample), center = boundaryCenter(mesh, mesh.positions, end, col);
      samples.push(sample); signs.push(normal.reduce((sum, value, axis) => sum + value * (center[axis] - point[axis]), 0) >= 0 ? 1 : -1);
      const vertex = (end === 'start' ? 0 : grid.rows) * (grid.cols + 1) + col;
      const thickness = mesh.shellPairs ? Math.hypot(...[0, 1, 2].map(axis => mesh.positions[vertex * 3 + axis] - mesh.positions[(vertex + mesh.shellPairs!) * 3 + axis])) : .04;
      offsets.push(thickness * .5 + .005);
    }
    (mesh.attachments ??= []).push({ id, end, samples, offsets, signs });
  };
}
function attachPectorals(surfaces: Map<string, AnatomyMesh>, side: string) {
  const attach = attacher(surfaces);
  for (const head of ['clav', 'stern', 'cost']) {
    const mesh = surfaces.get(`pectoralis_major_${head}_${side}`); if (!mesh) continue;
    // Costal origins use the named structural sheath; other heads use bony patches.
    if (head !== 'cost') attach(mesh, 'start', `pectoralis.${head}.origin.${side}`, u => head === 'clav' ? [`clavicle_${side}`, .25, .04 + .29 * u] : ['sternum', .25, .95 - .85 * u]);
    if (head === 'cost') {
      const sheath = surfaces.get(`superior_rectus_sheath_${side}`);
      if (sheath?.surfaceGrid) attach(mesh, 'start', `pectoralis.cost.sheath.${side}`, u => {
        const grid = mesh.surfaceGrid!, col = Math.round(u * grid.cols), center = boundaryCenter(mesh, mesh.positions, 'start', col);
        const supportGrid = sheath.surfaceGrid!; let best = Infinity, vertex = 0;
        for (let i = 0; i < (sheath.shellPairs ?? sheath.positions.length / 3); i++) {
          const d = [0, 1, 2].reduce((sum, k) => sum + (sheath.positions[i*3+k] - center[k]) ** 2, 0);
          if (d < best) { best = d; vertex = i; }
        }
        let bestU=vertex % (supportGrid.cols + 1) / supportGrid.cols, bestV=Math.floor(vertex / (supportGrid.cols + 1)) / supportGrid.rows;
        for(let refinement=0;refinement<6;refinement++) {
          const du=1/supportGrid.cols/2**refinement,dv=1/supportGrid.rows/2**refinement,originU=bestU,originV=bestV;
          for(const dx of [-1,0,1])for(const dy of [-1,0,1]) {
            const u=Math.max(0,Math.min(1,originU+dx*du)),v=Math.max(0,Math.min(1,originV+dy*dv));
            const q=patchPoint(sheath,samplePatch(sheath,u,v)).point,d=q.reduce((sum,x,k)=>sum+(x-center[k])**2,0);
            if(d<best){best=d;bestU=u;bestV=v;}
          }
        }
        return [sheath.anatomicalName!,bestU,bestV];
      });
    }
    attach(mesh, 'end', `pectoralis.${head}.humerus.${side}`, u => [`humerus_${side}`, .18 + .14 * u, .13 + .04 * u]);
  }
}
/** Default rest placement: pectoral ends meet the generated clavicle, sternum, cartilages and humerus once. */
export function snapPectorals(muscles: AnatomyMesh[], supports: AnatomyMesh[]) {
  const pectorals = muscles.filter(m => m.anatomicalName?.startsWith('pectoralis_major_'));
  if (!pectorals.length) return;
  const surfaces = new Map([...supports, ...pectorals].filter(m => m.anatomicalName).map(m => [m.anatomicalName!, m]));
  if (!['sternum', 'clavicle_L', 'clavicle_R', 'humerus_L', 'humerus_R'].every(id => surfaces.has(id))) return;
  for (const side of ['L', 'R']) attachPectorals(surfaces, side);
  for (const mesh of pectorals) { applyMeshAttachments(mesh, surfaces); delete mesh.attachments; mesh.normals = calculateNormals(mesh.positions, mesh.indices); }
}
function attachInguinalEdge(surfaces: Map<string, AnatomyMesh>, side: string) {
  const ligament = surfaces.get(`inguinal_ligament_${side}`);
  const aponeurosis = surfaces.get(`abdominal_aponeurosis_${side}`);
  if (!ligament?.surfaceGrid || !aponeurosis?.surfaceGrid) return;
  const tube = ligament.surfaceGrid, sheet = aponeurosis.surfaceGrid;
  // Select the face looking into the sheet on each ring. A fixed angular
  // rail can roll away from the aponeurosis as the fitted tube curves.
  attacher(surfaces)(aponeurosis, 'start', `aponeurosis.inguinal.${side}`,
    u => {
      const col = Math.round(u*sheet.cols), ring = Math.round(u*tube.rows);
      const edge = boundaryCenter(aponeurosis,aponeurosis.positions,'start',col);
      const next = ((sheet.cols+1)*3 + col*3);
      const direction = edge.map((value,axis)=>aponeurosis.positions[next+axis]-value);
      let rail = 0, best = -Infinity;
      for (let i=0;i<tube.cols;i++) {
        const index = (ring*tube.cols+i)*3;
        const score = direction.reduce((sum,value,axis)=>sum+value*ligament.positions[index+axis],0);
        if(score>best){best=score;rail=i;}
      }
      return [`inguinal_ligament_${side}`,rail/tube.cols,u];
    });
  const edge = aponeurosis.attachments?.at(-1);
  if (edge) {
    edge.signs.fill(1);
    edge.offsets = edge.offsets.map(offset => Math.max(0,offset-.009));
  }
  return aponeurosis;
}

/** Seat the sheath on the actual fitted ligament even without a GLB or the
 * optional live attachment solver. The baked mesh has no hidden dependency. */
export function seatInguinalEdges(inside: Record<string, AnatomyMesh[]>) {
  const surfaces = new Map([...(inside.inguinalLigaments ?? []), ...(inside.aponeuroses ?? [])]
    .filter(mesh => mesh.anatomicalName).map(mesh => [mesh.anatomicalName!, mesh]));
  for (const side of ['L', 'R']) {
    const mesh = attachInguinalEdge(surfaces, side);
    if (!mesh) continue;
    applyMeshAttachments(mesh, surfaces);
    delete mesh.attachments;
    mesh.normals = calculateNormals(mesh.positions, mesh.indices);
  }
}

/** Resolve the bony endpoints of the ligament before seating its follower. */
export function applyOrderedAttachments(meshes: AnatomyMesh[], surfaces: Map<string, AnatomyMesh>, posed?: Map<AnatomyMesh, Float32Array>) {
  const followLigament = (mesh: AnatomyMesh) => mesh.attachments?.some(binding => binding.id.startsWith('aponeurosis.inguinal.'));
  for (const mesh of meshes) if (!followLigament(mesh)) applyMeshAttachments(mesh, surfaces, posed?.get(mesh), posed);
  for (const mesh of meshes) if (followLigament(mesh)) applyMeshAttachments(mesh, surfaces, posed?.get(mesh), posed);
}

export function attachPriorityTissues(inside: Record<string, AnatomyMesh[]>) {
  const all = Object.values(inside).flat(), surfaces = new Map(all.filter(m => m.anatomicalName).map(m => [m.anatomicalName!, m])), attach = attacher(surfaces);
  for (const side of ['L', 'R']) {
    const rectus = (inside.rectusAbdominis ?? []).filter(m => m.anatomicalName?.includes(`_${side}_`));
    const sorted = [...rectus].sort((a, b) => Math.max(...a.positions.filter((_, i) => i % 3 === 1)) - Math.max(...b.positions.filter((_, i) => i % 3 === 1)));
    if (sorted.length) {
      attach(sorted[0], 'start', `rectus.pubis.${side}`, u => [`pubic_ramus_${side}`, .25, .88 + u * .11]);
      attach(sorted.at(-1)!, 'end', `rectus.costal.${side}`, u => u < .12 ? ['sternum', .25, .99] : [`costal_cartilage_${u < .4 ? 5 : u < .7 ? 6 : 7}_${side}`, .25, .9 - .55 * u]);
    }
    for (const layer of ['externalOblique', 'internalOblique', 'transversusAbdominis']) {
      const mesh = surfaces.get(`${layer}_${side}`);
      if (mesh) {
        attach(mesh, 'start', `${layer}.crest.${side}`, u => [`ilium_wing_${side}`, .98 - .96 * u, .015]);
        attach(mesh, 'end', `${layer}.costal.${side}`, u => [`rib_${Math.min(12, (layer === 'externalOblique' ? 6 : 7) + Math.floor(u * (layer === 'externalOblique' ? 7 : 6)))}_${side}`, layer === 'transversusAbdominis' ? .75 : .25, .94 - .72 * u]);
      }
    }
    attachPectorals(surfaces, side);
    const ligament = surfaces.get(`inguinal_ligament_${side}`);
    if (ligament) {
      attach(ligament, 'start', `inguinal.pubis.${side}`, () => [`pubic_ramus_${side}`, .25, .97]);
      attach(ligament, 'end', `inguinal.asis.${side}`, () => [`ilium_wing_${side}`, .99, .015]);
    }
    attachInguinalEdge(surfaces, side);
  }
  applyOrderedAttachments(all, surfaces);
}
