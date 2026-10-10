import { Eye, EyeOff, Move, Ruler, SlidersHorizontal, X } from 'lucide';
import type { ARMode } from './ar';
import { chips, flashScreen, h, iconButton, shutterButton, slider, toggle } from '../ui/dom';
import { saveAndOfferShare, timestampedName } from '../core/files';
import { tr } from '../core/i18n';
import { LIGHT_PRESETS, PHOTO_FILTERS } from '../core/presets';

/**
 * Interface shown over the camera during AR (WebXR "DOM overlay": only this element is visible).
 * Built from the same components as the editor panels. Gestures: tap places the scene,
 * one finger turns it, two fingers resize and turn.
 */
export class ARHud {
  readonly el = h('div', { class: 'ar-hud' });
  private message = '';
  private settingsOpen = false;
  /** Everything hidden except a small button to bring it back (gestures keep working). */
  private uiHidden = false;
  private showFps = false;
  private fpsTimer = 0;
  /** Share action for the last photo, offered for a few seconds after it's saved. */
  private share: (() => void) | null = null;
  private messageTimer = 0;
  private readonly ar: ARMode;

  constructor(ar: ARMode) {
    this.ar = ar;
    document.body.append(this.el);
    ar.changed.add(() => this.render());
    this.setupGestures();
    this.render();
  }

  private flash(text: string) {
    this.message = text;
    clearTimeout(this.messageTimer);
    this.messageTimer = window.setTimeout(() => {
      this.message = '';
      this.share = null;
      this.render();
    }, 6000);
    this.render();
  }

  private render() {
    const ar = this.ar;
    this.el.classList.toggle('show', ar.active);
    if (!ar.active) {
      this.uiHidden = false;
      this.settingsOpen = false;
      // Stop the counter directly (setFps would render again and loop)
      this.showFps = false;
      clearInterval(this.fpsTimer);
      return this.el.replaceChildren();
    }
    if (this.uiHidden) {
      return this.el.replaceChildren(iconButton(Eye, tr('Show interface'), () => ((this.uiHidden = false), this.render()), { cls: 'round ar-show-ui' }));
    }
    const scroll = this.el.querySelector('.ar-options')?.scrollTop ?? 0;
    const hint =
      (ar.lastError && `⚠ ${ar.lastError}`) ||
      this.message ||
      (ar.status === 'searching'
        ? tr('Move the phone slowly to find the floor')
        : ar.status === 'ready'
          ? tr('Tap to place the scene')
          : tr('Drag to turn · pinch to resize'));
    this.el.replaceChildren(
      iconButton(X, tr('Exit AR'), () => ar.exit(), { cls: 'round ar-exit' }),
      h(
        'div',
        { class: 'ar-hint', style: this.settingsOpen ? 'display:none' : undefined },
        h('span', {}, hint),
        this.message && this.share ? h('button', { class: 'chip active', onClick: () => this.share?.() }, tr('Share')) : null,
      ),
      h(
        'div',
        { class: 'ar-top-right' },
        iconButton(EyeOff, tr('Hide interface'), () => ((this.uiHidden = true), (this.settingsOpen = false), this.render()), { cls: 'round' }),
        iconButton(SlidersHorizontal, tr('AR options'), () => ((this.settingsOpen = !this.settingsOpen), this.render()), { cls: 'round', active: this.settingsOpen }),
      ),
      ...(this.showFps ? [h('div', { class: 'ar-fps' }, '— fps')] : []),
      ...(this.settingsOpen ? [this.optionsPanel()] : []),
      ...(ar.status !== 'placed'
        ? [h('div', { class: 'ar-bottom' }, h('button', { class: 'btn primary', onClick: () => ar.placeInFront() }, tr('Place in front of me')))]
        : [
            h(
              'div',
              { class: 'ar-bottom' },
              iconButton(Move, tr('Move the scene'), () => ar.replace(), { cls: 'round' }),
              shutterButton(tr('Take photo'), () => this.capture()),
              ar.scale === 1
                ? iconButton(Ruler, tr('Real size (1:1)'), () => ar.resetScale(), { cls: 'round' })
                : h('button', { class: 'ibtn round', title: tr('Real size (1:1)'), onClick: () => ar.resetScale() }, `${Math.round(ar.scale * 100)}%`),
            ),
          ]),
    );
    const panel = this.el.querySelector('.ar-options');
    if (panel) panel.scrollTop = scroll;
  }

  /** Options panel: everything optional, cheapest settings by default. */
  private optionsPanel() {
    const ar = this.ar;
    const lights = [
      { value: 'scene', label: tr('Scene') },
      { value: 'room', label: tr('Real room') },
      ...LIGHT_PRESETS.map((p) => ({ value: p.id, label: tr(p.label) })),
    ];
    return h(
      'div',
      { class: 'ar-options' },
      toggle(tr('Camera background'), !ar.virtual, (v) => ar.setVirtual(!v)),
      ar.virtual ? h('p', { class: 'ar-note' }, tr('Virtual AR: walk around the scene in its own environment.')) : null,
      h('h4', {}, tr('Lighting')),
      chips(lights, ar.lighting, (v) => ar.setLighting(v)),
      ar.lighting === 'room' ? h('p', { class: 'ar-note' }, tr('Heavier: uses the phone to estimate the room light.')) : null,
      slider(tr('Light intensity'), ar.lightLevel, { min: 0.2, max: 2.5, step: 0.05, format: (v) => `${Math.round(v * 100)}%` }, (v) => ar.setLightLevel(v)),
      toggle(tr('Shadows on the floor'), ar.shadows, (v) => ar.setShadows(v)),
      h('h4', {}, tr('Photo filter')),
      chips(
        PHOTO_FILTERS.map((f) => ({ value: f.id, label: tr(f.label) })),
        ar.filter,
        (v) => ar.setFilter(v),
      ),
      toggle(tr('Show FPS'), this.showFps, (v) => this.setFps(v)),
    );
  }

  private setFps(on: boolean) {
    this.showFps = on;
    clearInterval(this.fpsTimer);
    if (on) {
      this.fpsTimer = window.setInterval(() => {
        const el = this.el.querySelector('.ar-fps');
        if (el) el.textContent = `${Math.round(this.ar.fps())} fps`;
      }, 500);
    }
    this.render();
  }

  private async capture() {
    flashScreen(this.el);
    try {
      const blob = await this.ar.capture();
      if (!blob) {
        this.flash(tr("This phone doesn't share the camera image with the browser. Use the system screenshot."));
        return;
      }
      this.share = saveAndOfferShare(blob, timestampedName('babalon-ar', 'jpg'));
      this.flash(tr('Photo saved!'));
    } catch (e) {
      this.flash(e instanceof Error ? e.message : String(e));
    }
  }

  private setupGestures() {
    const pointers = new Map<number, { x: number; y: number }>();
    let start = { x: 0, y: 0, t: 0 };
    let moved = false;
    let pinch: { dist: number; angle: number } | null = null;
    const pair = () => {
      const [a, b] = [...pointers.values()];
      return { dist: Math.hypot(b.x - a.x, b.y - a.y), angle: Math.atan2(b.y - a.y, b.x - a.x) };
    };

    this.el.addEventListener('pointerdown', (ev) => {
      if ((ev.target as Element).closest('button, input, label, .ar-options')) return;
      this.el.setPointerCapture(ev.pointerId);
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pointers.size === 1) {
        start = { x: ev.clientX, y: ev.clientY, t: performance.now() };
        moved = false;
      } else if (pointers.size === 2) {
        pinch = pair();
        moved = true;
      }
    });
    this.el.addEventListener('pointermove', (ev) => {
      const p = pointers.get(ev.pointerId);
      if (!p) return;
      const dx = ev.clientX - p.x;
      p.x = ev.clientX;
      p.y = ev.clientY;
      if (this.ar.status !== 'placed') return;
      if (pointers.size === 2 && pinch) {
        const now = pair();
        if (pinch.dist > 0) this.ar.scaleBy(now.dist / pinch.dist);
        // Twisting two fingers turns the scene the same way (clockwise on screen = clockwise from above)
        this.ar.rotateBy(now.angle - pinch.angle);
        pinch = now;
      } else if (pointers.size === 1) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 8) moved = true;
        // The front of the scene follows the finger (dragging right turns it counterclockwise from above)
        if (moved) this.ar.rotateBy(-dx * 0.01);
      }
    });
    const end = (ev: PointerEvent) => {
      if (!pointers.has(ev.pointerId)) return;
      pointers.delete(ev.pointerId);
      if (pointers.size < 2) pinch = null;
      // A quick tap without movement places (or moves) the scene at the marker
      if (pointers.size === 0 && !moved && performance.now() - start.t < 400 && this.ar.status !== 'placed') {
        // No surface found: in virtual AR place it in front of the user
        if (!this.ar.place() && !(this.ar.virtual && this.ar.placeInFront())) this.flash(tr('Move the phone slowly to find the floor'));
      }
    };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
  }
}
