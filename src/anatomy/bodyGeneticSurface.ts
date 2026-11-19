import type { AnatomyMesh } from './contracts';
import type { SurfaceChange } from './regions/abdomen';
import { calculateNormals } from './algorithms/loft';

interface Cell { x: number; y: number; z: number; nx: number; ny: number; nz: number; dx: number; dy: number; dz: number; count: number }

/** Opt-in full-surface transfer for authored body genetics. Opposite shell walls never share a bin. */
export function transferGeneticSurface(skin: AnatomyMesh, changes: SurfaceChange[]) {
  if (!changes.length) return;
  const size = .25, radius = .55, cells = new Map<string, Cell>();
  const key = (x: number, y: number, z: number, bin: number) => `${x},${y},${z},${bin}`;
  for (const change of changes) for (let i = 0; i < change.source.length; i += 3) {
    const dx = change.target[i] - change.source[i], dy = change.target[i+1] - change.source[i+1], dz = change.target[i+2] - change.source[i+2];
    if (Math.hypot(dx, dy, dz) < 1e-7) continue;
    const nx = change.normals[i], ny = change.normals[i+1], nz = change.normals[i+2];
    const axis = Math.abs(nx) >= Math.abs(ny) && Math.abs(nx) >= Math.abs(nz) ? 0 : Math.abs(ny) >= Math.abs(nz) ? 1 : 2;
    const bin = axis * 2 + (change.normals[i+axis] < 0 ? 1 : 0);
    const x = change.source[i], y = change.source[i+1], z = change.source[i+2];
    const id = key(Math.floor(x/size), Math.floor(y/size), Math.floor(z/size), bin);
    let cell = cells.get(id);
    if (!cell) { cell = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, dx: 0, dy: 0, dz: 0, count: 0 }; cells.set(id, cell); }
    cell.x += x; cell.y += y; cell.z += z; cell.nx += nx; cell.ny += ny; cell.nz += nz;
    cell.dx += dx; cell.dy += dy; cell.dz += dz; cell.count++;
  }
  if (!cells.size) return;
  for (const cell of cells.values()) {
    for (const axis of ['x','y','z','dx','dy','dz'] as const) cell[axis] /= cell.count;
    const length = Math.hypot(cell.nx, cell.ny, cell.nz) || 1;
    cell.nx /= length; cell.ny /= length; cell.nz /= length;
  }
  const neighbourhoods = new Map<string, Cell[]>();
  for (let i = 0; i < skin.positions.length; i += 3) {
    const vertex = i / 3;
    const fixed = skin.rig ? Math.min(1, skin.rig[vertex*4+2] + (skin.positions[i+1] > 15.1 ? skin.rig[vertex*4+3] : 0)) : 0;
    if (fixed > .999) continue;
    const x = skin.positions[i], y = skin.positions[i+1], z = skin.positions[i+2];
    const bx = Math.floor(x/size), by = Math.floor(y/size), bz = Math.floor(z/size), voxel = `${bx},${by},${bz}`;
    let nearby = neighbourhoods.get(voxel);
    if (!nearby) {
      nearby = [];
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (let c = -2; c <= 2; c++) for (let bin = 0; bin < 6; bin++) {
        const cell = cells.get(key(bx+a, by+b, bz+c, bin));
        if (cell) nearby.push(cell);
      }
      neighbourhoods.set(voxel, nearby);
    }
    let dx = 0, dy = 0, dz = 0, weight = 0;
    for (const cell of nearby) {
      if (Math.abs(x) > .05 && x * cell.x < 0) continue;
      const alignment = skin.normals[i]*cell.nx + skin.normals[i+1]*cell.ny + skin.normals[i+2]*cell.nz;
      if (alignment <= .25) continue;
      const distance = Math.hypot(x-cell.x, y-cell.y, z-cell.z);
      if (distance >= radius) continue;
      const w = (1-distance/radius)**2 * alignment**2;
      dx += cell.dx*w; dy += cell.dy*w; dz += cell.dz*w; weight += w;
    }
    if (!weight) continue;
    const scale = (1-fixed) / Math.max(1, weight);
    const limit = Math.min(1, .16 / (Math.hypot(dx,dy,dz)*scale || 1));
    skin.positions[i] += dx*scale*limit; skin.positions[i+1] += dy*scale*limit; skin.positions[i+2] += dz*scale*limit;
  }
  skin.normals = calculateNormals(skin.positions, skin.indices);
}
