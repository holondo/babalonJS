import { tr } from '../core/i18n';

export type LibraryKind = 'model' | 'hdri';
export interface LibraryAttribution {
  provider: 'Poly Haven';
  source: string;
  license: 'CC0';
  authors: string[];
  assetId: string;
  resolution: string;
}
export interface LibraryItem {
  id: string;
  name: string;
  categories: string[];
  tags: string[];
  authors: Record<string, string>;
  thumbnail_url: string;
}
interface RemoteFile { url: string; size: number; include?: Record<string, RemoteFile> }
export interface LibraryVariant { resolution: string; bytes: number; file: RemoteFile }
const API = 'https://api.polyhaven.com';
const CACHE = 'babalon-polyhaven-v1';
const HOSTS = new Set(['api.polyhaven.com', 'dl.polyhaven.org', 'cdn.polyhaven.com']);

/** Restrict provider-controlled URLs before following them, including thumbnail URLs. */
export function libraryURL(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !HOSTS.has(url.hostname) || url.username || url.password) {
    throw new Error(tr('Invalid library download.'));
  }
  return url.href;
}

/** Cache selected downloads for reuse; projects also embed their files independently. */
async function request(url: string, signal?: AbortSignal, refresh = false): Promise<Response> {
  url = libraryURL(url);
  const cache = await caches.open(CACHE).catch(() => null);
  const cached = await cache?.match(url);
  signal?.throwIfAborted();
  if (cached && (!refresh || !navigator.onLine)) return cached;
  try {
    const response = await fetch(url, {
      signal, credentials: 'omit', redirect: 'error', referrer: `${location.origin}/babalon-js/`, referrerPolicy: 'unsafe-url',
    });
    if (!response.ok) throw new Error(`${tr('Could not download library item.')} (${response.status})`);
    libraryURL(response.url);
    await cache?.put(url, response.clone()).catch(() => {});
    signal?.throwIfAborted();
    return response;
  } catch (error) {
    signal?.throwIfAborted();
    if (cached) return cached;
    throw error;
  }
}

export async function libraryIndex(kind: LibraryKind, signal?: AbortSignal) {
  const response = await request(`${API}/assets?t=${kind === 'model' ? 'models' : 'hdris'}`, signal, true);
  const data = await response.json() as Record<string, Omit<LibraryItem, 'id'>>;
  return Object.entries(data).map(([id, item]) => ({ ...item, id })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function libraryVariants(id: string, kind: LibraryKind, signal?: AbortSignal): Promise<LibraryVariant[]> {
  const response = await request(`${API}/files/${encodeURIComponent(id)}`, signal);
  const data = await response.json() as Record<string, Record<string, Record<string, RemoteFile>>>;
  return Object.entries(data[kind === 'model' ? 'gltf' : 'hdri'] ?? {}).flatMap(([resolution, formats]) => {
    const file = formats[kind === 'model' ? 'gltf' : 'hdr'];
    return file ? [{ resolution, file, bytes: file.size + Object.values(file.include ?? {}).reduce((n, f) => n + f.size, 0) }] : [];
  }).sort((a, b) => parseInt(a.resolution) - parseInt(b.resolution));
}

export async function downloadLibraryItem(
  item: LibraryItem, kind: LibraryKind, variant: LibraryVariant, signal: AbortSignal,
  progress: (done: number, total: number) => void = () => {},
): Promise<{ files: File[]; attribution: LibraryAttribution }> {
  const response = await request(variant.file.url, signal);
  const main = await response.blob();
  const files: File[] = [];
  let done = main.size;
  progress(done, variant.bytes);
  const prefix = `${item.id}_${variant.resolution}`;
  if (kind === 'model') {
    const gltf = JSON.parse(await main.text()) as { buffers?: { uri?: string }[]; images?: { uri?: string }[] };
    const dependencies = new Map<string, string>();
    for (const entry of [...(gltf.buffers ?? []), ...(gltf.images ?? [])]) {
      if (!entry.uri || entry.uri.startsWith('data:')) continue;
      const uri = entry.uri;
      if (!dependencies.has(uri)) {
        const remote = variant.file.include?.[uri];
        if (!remote) throw new Error(tr('Missing library dependency.'));
        const blob = await (await request(remote.url, signal)).blob();
        const extension = new URL(remote.url).pathname.split('.').pop()!.replace(/[^a-z0-9]/gi, '');
        const name = `${prefix}_${dependencies.size}.${extension}`;
        dependencies.set(uri, name);
        files.push(new File([blob], name, { type: blob.type }));
        done += blob.size;
        progress(done, variant.bytes);
      }
      entry.uri = dependencies.get(uri)!;
    }
    files.unshift(new File([JSON.stringify(gltf)], `${prefix}.gltf`, { type: 'model/gltf+json' }));
  } else files.push(new File([main], `${prefix}.hdr`, { type: main.type }));
  signal.throwIfAborted();
  return { files, attribution: {
    provider: 'Poly Haven', source: `https://polyhaven.com/a/${encodeURIComponent(item.id)}`, license: 'CC0',
    authors: Object.keys(item.authors ?? {}), assetId: item.id, resolution: variant.resolution,
  } };
}
