import './style.css';
import { Editor } from './editor';
import { UI } from './ui';
import { locale, tr } from './i18n';
import { registerSW } from 'virtual:pwa-register';
import { setupSystemBars } from './systemBars';
import { ARMode } from './ar';
import { ARHud } from './arHud';
import { takeSharedFiles } from './files';

document.documentElement.lang = locale();

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const editor = new Editor(canvas);
const ui = new UI(editor, document.querySelector<HTMLElement>('#app')!);
setupSystemBars(editor);

// Augmented reality (WebXR): only offered where the browser supports it (Android Chrome + ARCore)
const ar = new ARMode(editor);
const arHud = new ARHud(ar);
ar.checkSupport().then(() => ui.setAR(ar, arHud.el));

// PWA: offline cache + "new version" notice (the update is applied only when the user accepts)
const updateSW = registerSW({
  onNeedRefresh: () => ui.toast(tr('A new version is available'), 'info', { label: tr('Update'), run: () => updateSW(true) }),
  onOfflineReady: () => ui.toast(tr('Ready to work offline')),
});

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  ui.setInstallPrompt(e as unknown as { prompt: () => Promise<unknown> });
});
window.addEventListener('appinstalled', () => ui.setInstallPrompt(null));

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

// Exposed for debugging from the browser console
Object.assign(window, { editor });
