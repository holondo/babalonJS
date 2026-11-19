import type { AnatomyMesh } from './contracts';
import type { AnatomyParameters } from './parameters';
import { fatThickness } from './fatDistribution';
import { calculateNormals } from './algorithms/loft';

export type FatBrushMode = 'add' | 'remove' | 'smooth';
export type FatPaint = Record<string, number>;
const cell = .15;
const limit = 16000;
const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
const bound = (v: number) => Math.max(-24, Math.min(30, v));

export function normalizeFatPaint(value: unknown): FatPaint | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const entries = Object.entries(value);
  if (!entries.length || entries.length > limit) return;
  const clean: FatPaint = {};
  for (const [id, mm] of entries) {
    if (!/^-?\d{1,3},-?\d{1,3},-?\d{1,3}$/.test(id) || !Number.isFinite(mm)) continue;
    if (Math.abs(mm) >= .01) clean[id] = bound(mm);
  }
  return Object.keys(clean).length ? clean : undefined;
}

export function paintFat(field: FatPaint, point: readonly number[], radiusMm: number, strengthMm: number, mode: FatBrushMode) {
  const radius = radiusMm / 100, [cx, cy, cz] = point;
  const updates: [string, number][] = [];
  for (let x = Math.ceil((cx - radius) / cell); x <= (cx + radius) / cell; x++)
    for (let y = Math.ceil((cy - radius) / cell); y <= (cy + radius) / cell; y++)
      for (let z = Math.ceil((cz - radius) / cell); z <= (cz + radius) / cell; z++) {
        const t = Math.hypot(x * cell - cx, y * cell - cy, z * cell - cz) / radius;
        if (t >= 1) continue;
        const w = (1 - t * t) ** 2, id = key(x, y, z), old = field[id] ?? 0;
        const average = mode === 'smooth' ? (
          (field[key(x-1,y,z)] ?? 0) + (field[key(x+1,y,z)] ?? 0) +
          (field[key(x,y-1,z)] ?? 0) + (field[key(x,y+1,z)] ?? 0) +
          (field[key(x,y,z-1)] ?? 0) + (field[key(x,y,z+1)] ?? 0)
        ) / 6 : 0;
        const next = mode === 'smooth' ? old + (average - old) * w * Math.min(1, strengthMm / 6) : old + w * strengthMm * (mode === 'add' ? 1 : -1);
        updates.push([id, bound(next)]);
      }
  let count = Object.keys(field).length;
  for (const [id, mm] of updates) {
    if (Math.abs(mm) < .01) {
      if (id in field) { delete field[id]; count--; }
    } else if (id in field || count < limit) {
      if (!(id in field)) count++;
      field[id] = mm;
    }
  }
}

export function applyFatPaint(skin: AnatomyMesh, adipose: AnatomyMesh | undefined, p: AnatomyParameters) {
  if (!p.fatPaint) return;
  const rest = skin.materialPositions ?? skin.positions;
  const offsets = adipose ? new Float32Array(rest.length / 3) : undefined;
  const lateral = 18 / p.height;
  for (let i = 0; i < rest.length; i += 3) {
    const x = rest[i] / cell, y = rest[i+1] / cell, z = rest[i+2] / cell;
    const a = Math.floor(x), b = Math.floor(y), c = Math.floor(z);
    let mm = 0;
    for (let u=0;u<=1;u++) for(let v=0;v<=1;v++) for(let w=0;w<=1;w++)
      mm += (p.fatPaint[key(a+u,b+v,c+w)] ?? 0) * (1-Math.abs(x-a-u)) * (1-Math.abs(y-b-v)) * (1-Math.abs(z-c-w));
    if (!mm) continue;
    const available = fatThickness(p, [skin.positions[i]*lateral, skin.positions[i+1]*1.8/17.5, skin.positions[i+2]*lateral]);
    mm = Math.max(-available * .9, mm);
    if (offsets) offsets[i/3] = mm;
    for(let k=0;k<3;k++){
      const delta = skin.normals[i+k] * mm / 100;
      skin.positions[i+k] += delta;
      if (adipose) adipose.positions[i+k] += delta;
    }
  }
  skin.normals = calculateNormals(skin.positions, skin.indices);
  if (adipose) {
    adipose.fatPaintMm = offsets;
    adipose.normals = calculateNormals(adipose.positions, adipose.indices);
  }
}
