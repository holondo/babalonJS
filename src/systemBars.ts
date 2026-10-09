import type { Editor } from './editor';

/**
 * Integration with the system bars around the app:
 * - the Android status bar and the desktop PWA title bar take the color of the top of the scene;
 * - on phones, photo mode goes fullscreen (hides the status bar) and leaves it on exit.
 */
export function setupSystemBars(editor: Editor) {
  syncThemeColor(editor);
  fullscreenInPhotoMode(editor);
}

/** Where the theme color is visible: installed app, desktop title bar overlay, or a phone browser. */
function themeColorMatters() {
  return matchMedia('(display-mode: standalone), (display-mode: window-controls-overlay), (display-mode: fullscreen), (pointer: coarse)').matches;
}

/**
 * Status/title bars can't be transparent in a PWA, but they follow `theme-color` live, so we paint
 * them with the color of the scene right below them.
 */
function syncThemeColor(editor: Editor) {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta || !themeColorMatters()) return;
  const canvas = editor.engine.getRenderingCanvas()!;
  const probe = document.createElement('canvas');
  probe.width = 32;
  probe.height = 1;
  const ctx = probe.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  let last = '';
  let lastTime = 0;
  // Reading pixels back makes the GPU wait, so sample rarely: only after a new frame was drawn,
  // once the camera has settled, and at most once a second.
  editor.scene.onAfterRenderObservable.add(() => {
    const now = performance.now();
    if (now - lastTime < 1000 || now - editor.lastCameraMoveTime < 300 || document.hidden || !canvas.width) return;
    lastTime = now;
    // Sample a thin strip along the top of the scene (the canvas keeps its buffer, so this is safe)
    const strip = Math.max(1, Math.round(canvas.height * 0.02));
    ctx.drawImage(canvas, 0, 0, canvas.width, strip, 0, 0, probe.width, 1);
    const data = ctx.getImageData(0, 0, probe.width, 1).data;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    const n = data.length / 4;
    const hex = '#' + [r, g, b].map((v) => Math.round(v / n).toString(16).padStart(2, '0')).join('');
    if (hex !== last) {
      last = hex;
      meta.content = hex;
    }
  });
}

function fullscreenInPhotoMode(editor: Editor) {
  const root = document.documentElement;
  if (!root.requestFullscreen) return; // iPhone Safari has no fullscreen for pages
  let entered = false;
  editor.changed.add((kind) => {
    if (kind !== 'photo' || !matchMedia('(pointer: coarse)').matches) return;
    if (editor.photoMode && !document.fullscreenElement) {
      // Runs inside the tap that opened photo mode, which the browser requires
      root
        .requestFullscreen({ navigationUI: 'hide' })
        .then(() => (entered = true))
        .catch(() => {});
    } else if (!editor.photoMode && entered) {
      entered = false;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }
  });
}
