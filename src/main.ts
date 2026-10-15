import './ui/style.css';
import { Editor } from './core/editor';
import { UI } from './ui/ui';
import { locale, tr } from './core/i18n';
import { registerSW } from 'virtual:pwa-register';
import { setupSystemBars } from './device/systemBars';
import { takeSharedFiles } from './core/files';
import { GyroControl } from './device/gyro';
import { installedDisplay, prepareOffline } from './core/offline';
import { Capacitor } from '@capacitor/core';

document.documentElement.lang = locale();

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const editor = new Editor(canvas);
// Exposed for browser automation and debugging (see AGENTS.md)
(window as unknown as { editor: Editor }).editor = editor;
const ui = new UI(editor, document.querySelector<HTMLElement>('#app')!);
(window as unknown as { ui: UI }).ui = ui;
setupSystemBars(editor);

// Augmented reality (WebXR): offered where supported or in native app container
const registerAR = () => {
  ui.setARLoader(async () => {
    const [{ ARMode }, { ARHud }] = await Promise.all([import('./ar/ar'), import('./ar/arHud')]);
    const ar = new ARMode(editor);
    const arHud = new ARHud(ar);
    await ar.checkSupport();
    ui.setAR(ar, arHud.el);
  });
};

if (navigator.xr) {
  navigator.xr.isSessionSupported('immersive-ar').then((supported) => {
    if (supported) registerAR();
  }).catch(() => {});
} else if (Capacitor.isNativePlatform()) {
  registerAR();
}

// Gyro mode: the phone's orientation turns the camera (any phone, no camera needed)
ui.setGyro(new GyroControl(editor));

// PWA: offline cache + "new version" notice (the update is applied only when the user accepts)
let warmingCode: Promise<void> | null = null;
function cacheUsedCode() {
  if (!('serviceWorker' in navigator) || !('caches' in window)) return Promise.resolve();
  return warmingCode ??= (async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => {
      const finish = () => {
        navigator.serviceWorker.removeEventListener('controllerchange', finish);
        clearTimeout(timer);
        resolve();
      };
      const timer = window.setTimeout(finish, 5000);
      navigator.serviceWorker.addEventListener('controllerchange', finish, { once: true });
    });
    if (!navigator.serviceWorker.controller) return;
    // First-visit shaders can load before the newly installed worker controls this page.
    // Preserve only code already used, fetching from the HTTP cache without evaluating it again.
    const paths = new Set(performance.getEntriesByType('resource').map(entry => entry.name));
    for (const path of paths) {
      const url = new URL(path);
      const localCode = url.origin === location.origin && url.pathname.startsWith(`${import.meta.env.BASE_URL}assets/`) && /\.(?:js|css)$/.test(url.pathname);
      const usedEnvironment = (url.hostname === 'assets.babylonjs.com' || url.origin === location.origin) && /\.env$/.test(url.pathname);
      if (!localCode && !usedEnvironment) continue;
      if (!(await caches.match(path))) await fetch(path, { cache: 'force-cache' });
    }
  })().finally(() => { warmingCode = null; });
}
navigator.serviceWorker?.addEventListener('controllerchange', () => { void cacheUsedCode().catch(() => {}); });
let installedThisSession = false;
let offlinePreparation: Promise<void> | null = null;
function prepareInstalledApp() {
  if (Capacitor.isNativePlatform()) return;
  if ((!installedThisSession && !installedDisplay()) || !('serviceWorker' in navigator) || !('caches' in window)) return;
  return offlinePreparation ??= (async () => {
    const activity = ui.beginActivity(tr('Downloading tools for offline use'));
    try {
      await cacheUsedCode();
      const script = document.querySelector<HTMLScriptElement>('script[type="module"][src]');
      if (!script) throw new Error('App entry not found');
      const entry = new URL(script.src).pathname.slice(import.meta.env.BASE_URL.length);
      await prepareOffline(import.meta.env.BASE_URL, value => activity.update(value), entry);
      ui.toast(tr('All tools are ready to work offline'));
    } catch {
      ui.toast(tr('Offline download incomplete. Reconnect to continue.'), 'error', { label: tr('Try again'), run: () => { void prepareInstalledApp(); } });
    } finally { activity.finish(); }
  })().finally(() => { offlinePreparation = null; });
}
const updateSW = registerSW({
  onNeedRefresh: () => ui.toast(tr('A new version is available'), 'info', { label: tr('Update'), run: () => updateSW(true) }),
  onOfflineReady: () => { void cacheUsedCode().then(() => {
    if (installedThisSession || installedDisplay()) void prepareInstalledApp();
    else ui.toast(tr('Basic editor is ready to work offline'));
  }).catch(() => {}); },
});
if (import.meta.env.PROD) void prepareInstalledApp();
window.addEventListener('online', () => { if (import.meta.env.PROD) void prepareInstalledApp(); });

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  ui.setInstallPrompt(e as unknown as { prompt: () => Promise<unknown> });
});
window.addEventListener('appinstalled', () => {
  ui.setInstallPrompt(null);
  installedThisSession = true;
  if (import.meta.env.PROD) void prepareInstalledApp();
});

// Files shared into the installed app from another app (Android: Share → babalon JS)
takeSharedFiles().then((files) => ui.openFiles(files));

// Installed app opened with a file ("Open with babalon JS")
interface LaunchParams {
  files: { getFile(): Promise<File> }[];
}
const launchQueue = (window as unknown as { launchQueue?: { setConsumer(fn: (p: LaunchParams) => void): void } }).launchQueue;
launchQueue?.setConsumer(async (params) => {
  ui.openFiles(await Promise.all(params.files.map((h) => h.getFile())));
});

// Native Android back button and open-with/share file intents
if (Capacitor.isNativePlatform()) {
  interface InboundBatch { id: string; files: { path: string; name: string; type?: string }[] }
  const nativeApi = (window as unknown as {
    AndroidNative?: { getPendingFiles?: () => string | null; finishInbound?: (id: string) => void };
  }).AndroidNative;
  // Batches opened or being opened; a failed one is removed again so it can be retried.
  const handled = new Set<string>();

  const loadNativeInbound = async (batch: InboundBatch) => {
    if (!batch?.id || !batch.files?.length || handled.has(batch.id)) return;
    handled.add(batch.id);
    try {
      const files = await Promise.all(batch.files.map(async (f) => {
        const res = await fetch(Capacitor.convertFileSrc(f.path));
        if (!res.ok) throw new Error(tr('Could not read shared file {name}.', { name: f.name }));
        const blob = await res.blob();
        return new File([blob], f.name, { type: f.type || blob.type || 'application/octet-stream' });
      }));
      if (!await ui.openFiles(files)) { handled.delete(batch.id); return; }
      nativeApi?.finishInbound?.(batch.id);
    } catch (e) {
      handled.delete(batch.id);
      ui.toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  // 1. Batches delivered while the app is running
  window.addEventListener('nativefilesopen', (e: Event) => {
    void loadNativeInbound((e as CustomEvent<InboundBatch>).detail);
  });
  window.addEventListener('nativefileserror', (e: Event) => {
    ui.toast(tr((e as CustomEvent<string>).detail), 'error');
  });

  // 2. Cold start: the native copy may finish before or after the page is ready
  const consumePending = () => {
    const pending = nativeApi?.getPendingFiles?.();
    if (!pending) return false;
    try {
      void loadNativeInbound(JSON.parse(pending) as InboundBatch);
      return true;
    } catch {
      return false;
    }
  };

  if (!consumePending()) {
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      if (consumePending() || attempts >= 30) clearInterval(interval);
    }, 100);
  }

  // 3. Fallbacks via Capacitor App plugin
  void import('@capacitor/app').then(({ App }) => {
    let lastBackPress = 0;
    App.addListener('backButton', () => {
      if (ui.handleBack()) return;
      const now = Date.now();
      if (now - lastBackPress < 2000) {
        void App.exitApp();
      } else {
        lastBackPress = now;
        ui.toast(tr('Press back again to exit'));
      }
    });

    const handleUrl = async (url: string) => {
      if (!url) return;
      try {
        const { Filesystem } = await import('@capacitor/filesystem');
        const content = await Filesystem.readFile({ path: url });
        let name = url.split('/').pop() || 'imported-model.glb';
        if (!name.includes('.')) name += '.glb';
        let file: File;
        if (typeof content.data === 'string') {
          const byteCharacters = atob(content.data);
          const bytes = new Uint8Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            bytes[i] = byteCharacters.charCodeAt(i);
          }
          file = new File([bytes], name);
        } else {
          file = new File([content.data], name);
        }
        await ui.openFiles([file]);
      } catch (err) {
        console.warn('Could not read opened file intent:', err);
      }
    };

    App.addListener('appUrlOpen', (data) => {
      void handleUrl(data.url);
    });

    App.getLaunchUrl().then((launch) => {
      if (launch?.url) void handleUrl(launch.url);
    }).catch(() => {});
  });
}

// Exposed for debugging from the browser console
Object.assign(window, { editor });
