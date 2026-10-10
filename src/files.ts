/** Saves a file straight to the device (Downloads on Android; the browser's download folder elsewhere). */
export function saveFile(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** True when the system share sheet can take this file (phones, some desktops). */
export function canShareFile(blob: Blob, name: string) {
  return !!navigator.canShare?.({ files: [new File([blob], name, { type: blob.type })] });
}

/** Opens the system share sheet (send to an app, save to the gallery, etc.). */
export async function shareFile(blob: Blob, name: string) {
  await navigator.share({ files: [new File([blob], name, { type: blob.type })] }).catch(() => {});
}

/** Saves the file right away and returns how to share it (null when the device can't share files). */
export function saveAndOfferShare(blob: Blob, name: string): (() => void) | null {
  saveFile(blob, name);
  return canShareFile(blob, name) ? () => void shareFile(blob, name) : null;
}

/** File name with the date and time, e.g. babalon-2026-10-10T14-03-22.png */
export function timestampedName(prefix: string, ext: string) {
  return `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.${ext}`;
}

/** Files shared into the installed app from another app (Android "Share" → babalon JS). */
export async function takeSharedFiles(): Promise<File[]> {
  const params = new URLSearchParams(location.search);
  if (!params.has('shared') || !('caches' in window)) return [];
  // Remove the marker so a reload doesn't open the files again
  params.delete('shared');
  history.replaceState(null, '', location.pathname + (params.size ? `?${params}` : '') + location.hash);
  const cache = await caches.open('babalon-shared');
  const index = await cache.match(new URL('shared/index', document.baseURI).href);
  if (!index) return [];
  const keys: string[] = await index.json();
  const files: File[] = [];
  for (const key of keys) {
    const res = await cache.match(key);
    if (!res) continue;
    const name = decodeURIComponent(res.headers.get('x-name') ?? 'shared-file');
    files.push(new File([await res.blob()], name, { type: res.headers.get('content-type') ?? '' }));
  }
  await caches.delete('babalon-shared');
  return files;
}
