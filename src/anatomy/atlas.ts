import data from './atlas.json';

export interface AtlasEntry {
  id: string; name: string; region?: string; architecture?: string; type?: string;
  origin?: string[]; insertion?: string[]; joints?: string[]; landmarks?: string[];
  profile?: number[]; volume_cm3?: number | null; seed_cm3?: number | null; source?: string;
}
export const atlas = data as unknown as {
  version: string; muscles: AtlasEntry[]; bones: AtlasEntry[]; joints: AtlasEntry[];
  legacy: Record<string, string[]>;
};
/** Growth keys their generators and skin relief apply directly (the other keys map to legacy procedural muscles). */
export const directGrowthKeys = new Set(['pectoralis_major_clavicular', 'pectoralis_major_sternocostal', 'rectus_abdominis']);
export const growthKeys = new Set([...Object.keys(atlas.legacy), ...directGrowthKeys]);
export function growthTarget(entry: AtlasEntry) {
  if (directGrowthKeys.has(entry.id)) return { key: entry.id, aggregate: false };
  const mapping = Object.entries(atlas.legacy).find(([, ids]) => ids.includes(entry.id));
  return mapping ? { key: mapping[0], aggregate: mapping[1].length > 1 } : null;
}
export function normalizeGrowth(input: unknown): Record<string, number> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return Object.fromEntries(Object.entries(input).filter(([key, value]) => growthKeys.has(key) && typeof value === 'number' && Number.isFinite(value))
    .map(([key, value]) => [key, Math.max(.3, Math.min(3, value as number))]));
}
