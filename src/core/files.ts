import { Capacitor } from '@capacitor/core';

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1] ?? dataUrl;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function fallbackSaveFile(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** Saves a file straight to the device (Documents on Android; the browser's download folder elsewhere). */
export function saveFile(blob: Blob, name: string) {
  if (Capacitor.isNativePlatform()) {
    void (async () => {
      try {
        const { Filesystem, Directory } = await import('@capacitor/filesystem');
        const data = await blobToBase64(blob);
        await Filesystem.writeFile({
          directory: Directory.Documents,
          path: name,
          data,
          recursive: true,
        });
      } catch (err) {
        console.warn('Native save failed, falling back to browser download:', err);
        fallbackSaveFile(blob, name);
      }
    })();
    return;
  }
  fallbackSaveFile(blob, name);
}

/** True when the system share sheet can take this file (phones, some desktops). */
export function canShareFile(blob: Blob, name: string) {
  if (Capacitor.isNativePlatform()) return true;
  return !!navigator.canShare?.({ files: [new File([blob], name, { type: blob.type })] });
}

/** Opens the system share sheet (send to an app, save to the gallery, etc.). */
export async function shareFile(blob: Blob, name: string) {
  if (Capacitor.isNativePlatform()) {
    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      const { Share } = await import('@capacitor/share');
      const data = await blobToBase64(blob);
      const writeResult = await Filesystem.writeFile({
        directory: Directory.Cache,
        path: name,
        data,
      });
      await Share.share({
        title: name,
        files: [writeResult.uri],
      });
      return;
    } catch (err) {
      console.warn('Native share failed:', err);
    }
  }
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
