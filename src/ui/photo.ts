import { editControls } from './editControls';
import { Camera, EyeOff, RotateCcw, Scan, SlidersHorizontal, X } from 'lucide';
import { ASPECTS, DEFAULT_PHOTO, aspectRect } from '../core/editor';
import type { PhotoSettings } from '../core/editor';
import { timestampedName } from '../core/files';
import { PHOTO_FILTERS } from '../core/presets';
import { tr } from '../core/i18n';
import { button, flashScreen, h, hint, iconButton, row, section, select, shutterButton } from './dom';
import type { UI } from './ui';
import { errorMessage } from './shared';

/** Photo mode: its panel, on-screen controls, aspect frame and capture. */
export class PhotoMode {
  private readonly ui: UI;

  constructor(ui: UI) {
    this.ui = ui;
  }

  private videoDuration = 8;
  private videoHeight = 720;
  private videoPath: 'scene' | 'object' | 'sway' = 'scene';
  private videoAbort: AbortController | null = null;

  cancelRecording() { this.videoAbort?.abort(); }

  photoPanelContent() {
    const ed = this.ui.editor;
    const { slider, toggle, chips, action } = editControls(this.ui, () => ({ ...ed.photo }), (s) => ed.setPhoto(s));
    const p = ed.photo;
    const set = (v: Partial<PhotoSettings>) => this.ui.quiet(() => ed.setPhoto(v));
    const pct = (v: number) => `${Math.round(v)}`;
    return [
      ed.photoMode ? null : row(button(tr('Enter photo mode'), () => ed.setPhotoMode(true), { icon: Camera, cls: 'primary wide' })),
      section(tr('Filters'), chips(PHOTO_FILTERS.map((f) => ({ value: f.id, label: tr(f.label) })), '', (id) => ed.setPhoto({ ...DEFAULT_PHOTO, fov: p.fov, focusDistance: p.focusDistance, ...PHOTO_FILTERS.find((f) => f.id === id)!.values }))),
      section(
        tr('Camera'),
        slider(tr('Field of view'), p.fov, { min: 10, max: 110, step: 1, format: (v) => `${Math.round(v)}°` }, (v) => set({ fov: v })),
        chips(Object.entries(ASPECTS).map(([value, a]) => ({ value, label: tr(a.label) })), p.aspect, (v) => ed.setPhoto({ aspect: v })),
      ),
      section(
        tr('Light & color'),
        slider(tr('Exposure'), p.exposure, { min: 0.1, max: 3, step: 0.01 }, (v) => set({ exposure: v })),
        slider(tr('Contrast'), p.contrast, { min: 0.5, max: 2, step: 0.01 }, (v) => set({ contrast: v })),
        slider(tr('Saturation'), p.saturation, { min: -100, max: 100, step: 1, format: pct }, (v) => set({ saturation: v })),
        slider(tr('Temperature'), p.temperature, { min: -100, max: 100, step: 1, format: pct }, (v) => set({ temperature: v })),
        slider(tr('Vignette'), p.vignette, { min: 0, max: 2, step: 0.01 }, (v) => set({ vignette: v })),
      ),
      section(
        tr('Effects'),
        slider(tr('Bloom'), p.bloom, { min: 0, max: 2, step: 0.01 }, (v) => set({ bloom: v })),
        slider(tr('Bloom threshold'), p.bloomThreshold, { min: 0, max: 1.5, step: 0.01 }, (v) => set({ bloomThreshold: v })),
        slider(tr('Grain'), p.grain, { min: 0, max: 50, step: 0.5, format: pct }, (v) => set({ grain: v })),
        slider(tr('Chromatic aberration'), p.chromatic, { min: 0, max: 100, step: 1, format: pct }, (v) => set({ chromatic: v })),
        slider(tr('Sharpen'), p.sharpen, { min: 0, max: 1, step: 0.01 }, (v) => set({ sharpen: v })),
      ),
      section(
        tr('Depth of field'),
        toggle(tr('Blur background'), p.dof, (v) => ed.setPhoto({ dof: v })),
        p.dof ? slider(tr('Aperture (f)'), p.fStop, { min: 0.8, max: 16, step: 0.1, format: (v) => `f/${v.toFixed(1)}` }, (v) => set({ fStop: v })) : null,
        p.dof ? slider(tr('Focus distance'), p.focusDistance, { min: 0.2, max: 50, step: 0.05, format: (v) => `${v.toFixed(2)} m` }, (v) => set({ focusDistance: v })) : null,
        p.dof ? hint(tr('In photo mode, tap an object to focus on it.')) : null,
      ),
      section(tr('Video'),
        select(tr('Movement'), [{ value: 'scene', label: tr('Scene turntable') }, { value: 'object', label: tr('Object turntable') }, { value: 'sway', label: tr('Gentle sway') }], this.videoPath, (v) => { this.videoPath = v as typeof this.videoPath; }),
        select(tr('Duration'), [4, 8, 12].map((v) => ({ value: String(v), label: `${v} s` })), String(this.videoDuration), (v) => { this.videoDuration = +v; }),
        select(tr('Video height'), [720, 1080].map((v) => ({ value: String(v), label: `${v}p` })), String(this.videoHeight), (v) => { this.videoHeight = +v; }),
        button(tr('Record video'), () => this.record(), { cls: 'primary' }),
      ),
      row(button(tr('Reset to defaults'), () => action(() => ed.setPhoto({ ...DEFAULT_PHOTO })), { icon: RotateCcw, cls: 'ghost' })),
    ];
  }

  renderPhotoHud() {
    const ed = this.ui.editor;
    const { chips } = editControls(this.ui, () => ({ ...ed.photo }), (s) => ed.setPhoto(s));
    if (!ed.photoMode) return this.ui.photoHud.replaceChildren();
    this.ui.photoHud.replaceChildren(
      iconButton(X, tr('Exit photo mode'), () => ed.setPhotoMode(false), { cls: 'round hud-exit' }),
      iconButton(EyeOff, tr('Hide interface (H)'), () => this.ui.setUiHidden(true), { cls: 'round hud-hide' }),
      h(
        'div',
        { class: 'hud-bottom' },
        chips(Object.entries(ASPECTS).map(([value, a]) => ({ value, label: tr(a.label) })), ed.photo.aspect, (v) => ed.setPhoto({ aspect: v })),
        h(
          'div',
          { class: 'hud-row' },
          iconButton(SlidersHorizontal, tr('Adjustments'), () => {
            this.ui.photoPanel = !this.ui.photoPanel;
            this.ui.renderPanel();
          }, { active: this.ui.photoPanel, cls: 'round' }),
          shutterButton(tr('Take photo'), () => this.capture()),
          this.ui.gyroButton(true) ?? iconButton(Scan, tr('Frame all'), () => ed.frameAll(), { cls: 'round' }),
        ),
      ),
    );
  }

  private async record() {
    const controller = this.videoAbort = new AbortController();
    const status = h('p', { role: 'status' }, tr('Recording…'));
    const dialog = h('dialog', { class: 'project-gallery', 'aria-label': tr('Record video') }, status, button(tr('Cancel'), () => controller.abort()));
    dialog.addEventListener('cancel', () => controller.abort());
    this.ui.root.append(dialog);
    dialog.showModal();
    try {
      const { recordVideo } = await import('../capture/video');
      const blob = await recordVideo(this.ui.editor, { duration: this.videoDuration, height: this.videoHeight, path: this.videoPath, signal: controller.signal, progress: (v) => { status.textContent = tr('Recording…') + ` ${Math.round(v * 100)}%`; } });
      this.ui.deliver(blob, timestampedName('babalon', blob.type.includes('mp4') ? 'mp4' : 'webm'), tr('Video saved'));
    } catch (e) { if (!(e instanceof DOMException && e.name === 'AbortError')) this.ui.toast(errorMessage(e), 'error'); }
    finally { this.videoAbort = null; dialog.remove(); }
  }

  async capture() {
    flashScreen(this.ui.root);
    try {
      const blob = await this.ui.editor.capture(2);
      this.ui.deliver(blob, timestampedName('babalon', 'png'), tr('Photo saved!'));
    } catch (e) {
      this.ui.toast(errorMessage(e), 'error');
    }
  }

  /** Photo aspect frame (dark bars + rule of thirds). */
  renderFrame() {
    const ed = this.ui.editor;
    const show = ed.photoMode;
    this.ui.frame.classList.toggle('show', show);
    if (!show) return;
    const w = this.ui.root.clientWidth;
    const hgt = this.ui.root.clientHeight;
    const r = aspectRect(w, hgt, ed.photo.aspect);
    this.ui.frame.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`;
  }
}
