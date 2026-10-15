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

// Chunk size for native base64 writes: multiple of 3 so no padding '=' is emitted on intermediate chunks.
const NATIVE_WRITE_CHUNK = 3 * 512 * 1024; // 1.5 MB

async function writeBlobNative(
  Filesystem: typeof import('@capacitor/filesystem').Filesystem,
  directory: import('@capacitor/filesystem').Directory,
  path: string,
  blob: Blob,
): Promise<{ uri: string }> {
  if (blob.size <= NATIVE_WRITE_CHUNK) {
    const data = await blobToBase64(blob);
    return Filesystem.writeFile({ directory, path, data, recursive: true });
  }
  let result: { uri: string } | null = null;
  for (let offset = 0; offset < blob.size; offset += NATIVE_WRITE_CHUNK) {
    const slice = blob.slice(offset, Math.min(offset + NATIVE_WRITE_CHUNK, blob.size));
    const data = await blobToBase64(slice);
    if (offset === 0) {
      result = await Filesystem.writeFile({ directory, path, data, recursive: true });
    } else {
      await Filesystem.appendFile({ directory, path, data });
    }
  }
  return result!;
}

function fallbackSaveFile(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** Saves a file straight to the device (Documents on Android; the browser's download folder elsewhere). */
export async function saveFile(blob: Blob, name: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      await writeBlobNative(Filesystem, Directory.Documents, name, blob);
      return;
    } catch (err) {
      console.warn('Native save failed, falling back to browser download:', err);
      fallbackSaveFile(blob, name);
      return;
    }
  }
  fallbackSaveFile(blob, name);
}

/** True when the system share sheet can take this file (phones, some desktops). */
export function canShareFile(blob: Blob, name: string) {
  if (Capacitor.isNativePlatform()) return true;
  if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare({ files: [new File([blob], name, { type: blob.type })] });
  } catch {
    return false;
  }
}

/** Opens the system share sheet (send to an app, save to the gallery, etc.). */
export async function shareFile(blob: Blob, name: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      const { Share } = await import('@capacitor/share');
      const writeResult = await writeBlobNative(Filesystem, Directory.Cache, name, blob);
      try {
        await Share.share({
          title: name,
          files: [writeResult.uri],
        });
      } finally {
        // Start the grace period only after the share sheet closes.
        setTimeout(() => {
          Filesystem.deleteFile({ directory: Directory.Cache, path: name }).catch(() => {});
        }, 60000);
      }
      return;
    } catch (err) {
      console.warn('Native share failed:', err);
    }
  }
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ files: [new File([blob], name, { type: blob.type })] });
    } catch {
      // User dismissed share dialog or share was cancelled
    }
  }
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
