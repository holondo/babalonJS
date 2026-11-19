import catalogue from './catalogue.json';
import type { AnatomyParameters } from './parameters';

const appearance = new Set(catalogue.controls.filter(control => control.kind !== 'geometry').map(control => control.key));
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
/** Recipe dependencies only. Individual shape/bone edits run after these supports;
 * custom rectus inscriptions and support resolution are part of the recipe. Regional fat
 * thickness and painted fat are applied after the supports (fatPaint, posing). */
export function supportParameterKey(parameters: AnatomyParameters): string {
  const recipe: Record<string, unknown> = Object.fromEntries(Object.entries(parameters).filter(([key]) => !appearance.has(key) && !key.endsWith('Opacity') && !/^(navel|nipple)/.test(key) && !['definition', 'individualGrowth', 'fatPaint', 'fatDistribution', 'fatPriorDistribution', 'lowerPelvisFrontDepth', 'lowerPelvisBackDepth'].includes(key)));
  recipe.individualGrowth = Object.fromEntries(Object.entries(parameters.individualGrowth ?? {}).filter(([, value]) => value !== 1));
  recipe.definition = {
    left: parameters.definition?.muscles?.['rectus_abdominis.L']?.intersections,
    right: parameters.definition?.muscles?.['rectus_abdominis.R']?.intersections,
    fittedLeft: parameters.definition?.muscles?.['rectus_abdominis.L']?.fittedIntersections,
    fittedRight: parameters.definition?.muscles?.['rectus_abdominis.R']?.fittedIntersections,
    belliesLeft: parameters.definition?.muscles?.['rectus_abdominis.L']?.fittedBellies,
    belliesRight: parameters.definition?.muscles?.['rectus_abdominis.R']?.fittedBellies,
    authoredBelliesLeft: parameters.definition?.muscles?.['rectus_abdominis.L']?.bellies,
    authoredBelliesRight: parameters.definition?.muscles?.['rectus_abdominis.R']?.bellies,
    supportDetail: parameters.definition?.interaction?.supportDetail === 2 ? 2 : 1,
  };
  return JSON.stringify(canonical(recipe));
}

/** Worker-local, bounded LRU. Values are private immutable recipes or read-only
 * spatial supports. Never transfer their buffers: copy mesh recipes before editing. */
export class SupportCache {
  enabled = true;
  private entries = new Map<string, { value: unknown; bytes: number }>();
  private bytes = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  readonly maxBytes: number;
  readonly maxEntries: number;
  constructor(maxBytes = 48 * 1024 * 1024, maxEntries = 12) { this.maxBytes = maxBytes; this.maxEntries = maxEntries; }
  get stats() { return { entries: this.entries.size, bytes: this.bytes, hits: this.hits, misses: this.misses, evictions: this.evictions }; }
  clear() { this.entries.clear(); this.bytes = this.hits = this.misses = this.evictions = 0; }
  getOrCreate<T>(key: string, create: () => T, size: (value: T) => number): T {
    const entry = this.enabled ? this.entries.get(key) : undefined;
    if (entry) {
      this.hits++; this.entries.delete(key); this.entries.set(key, entry);
      return entry.value as T;
    }
    this.misses++;
    const value = create();
    if (!this.enabled) return value;
    const bytes = Math.max(0, size(value)) + key.length * 2;
    if (!Number.isFinite(bytes) || bytes > this.maxBytes || this.maxEntries < 1) return value;
    while (this.entries.size && (this.bytes + bytes > this.maxBytes || this.entries.size >= this.maxEntries)) {
      const oldest = this.entries.keys().next().value!;
      this.bytes -= this.entries.get(oldest)!.bytes; this.entries.delete(oldest); this.evictions++;
    }
    this.entries.set(key, { value, bytes }); this.bytes += bytes;
    return value;
  }
}
/** One fitted body needs about 55 MB of supports per build (default bodies need less). The budget
 * must hold at least one complete build, or the LRU evicts an entry the same build needs again and
 * every rebuild, even with unchanged parameters, starts from scratch. Low-memory devices keep one
 * build; others also keep the previous one, so undo and A/B comparison hit as well. */
const deviceMemory = (globalThis.navigator as { deviceMemory?: number } | undefined)?.deviceMemory ?? 8;
export const anatomySupportCache = new SupportCache((deviceMemory <= 4 ? 96 : 192) * 1024 * 1024, 24);

/** Typed storage is counted once, including buffers shared by several meshes. */
export function supportMeshBytes(layers: Record<string, object[]>): number {
  const buffers = new Set<ArrayBufferLike>();
  for (const mesh of Object.values(layers).flat()) for (const value of Object.values(mesh)) if (ArrayBuffer.isView(value)) buffers.add(value.buffer);
  return [...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0);
}
