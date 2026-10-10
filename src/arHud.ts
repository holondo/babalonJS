import { Eye, EyeOff, Move, Ruler, SlidersHorizontal, X } from 'lucide';
import { AR_FILTERS } from './ar';
import type { ARLighting, ARMode } from './ar';
import { h, icon } from './dom';
import { canShareFile, saveFile, shareFile } from './files';
import { tr } from './i18n';

/**
 * Interface shown over the camera during AR (WebXR "DOM overlay": only this element is visible).
 * Gestures: tap places the scene, one finger turns it, two fingers resize and turn.
 */
export class ARHud {
  readonly el = h('div', { class: 'ar-hud' });
  private message = '';
  private settingsOpen = false;
  /** Everything hidden except a small button to bring it back (gestures keep working). */
  private uiHidden = false;
  private showFps = false;
  private fpsTimer = 0;
  /** Last photo, offered for sharing for a few seconds after it's saved. */
  private lastPhoto: { blob: Blob; name: string } | null = null;
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
      this.lastPhoto = null;
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
      return this.el.replaceChildren(
        h('button', { class: 'ar-btn ar-show-ui', 'aria-label': tr('Show interface'), onClick: (ev: Event) => (ev.stopPropagation(), (this.uiHidden = false), this.render()) }, icon(Eye)),
      );
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
    const stop = (fn: () => void) => (ev: Event) => {
      ev.stopPropagation();
      fn();
    };
    this.el.replaceChildren(
      h('button', { class: 'ar-btn ar-exit', 'aria-label': tr('Exit AR'), onClick: stop(() => ar.exit()) }, icon(X)),
      h(
        'div',
        { class: 'ar-hint', style: this.settingsOpen ? 'display:none' : undefined },
        h('span', {}, hint),
        this.message && this.lastPhoto && canShareFile(this.lastPhoto.blob, this.lastPhoto.name)
          ? h('button', { class: 'chip active', onClick: stop(() => this.lastPhoto && shareFile(this.lastPhoto.blob, this.lastPhoto.name)) }, tr('Share'))
          : null,
      ),
      h(
        'div',
        { class: 'ar-top-right' },
        h('button', { class: 'ar-btn', 'aria-label': tr('Hide interface'), onClick: stop(() => ((this.uiHidden = true), (this.settingsOpen = false), this.render())) }, icon(EyeOff)),
        h(
          'button',
          { class: `ar-btn ${this.settingsOpen ? 'active' : ''}`, 'aria-label': tr('AR options'), onClick: stop(() => ((this.settingsOpen = !this.settingsOpen), this.render())) },
          icon(SlidersHorizontal),
        ),
      ),
      ...(this.showFps ? [h('div', { class: 'ar-fps' }, '— fps')] : []),
      ...(this.settingsOpen ? [this.optionsPanel()] : []),
      ...(ar.status !== 'placed'
        ? [
            h(
              'div',
              { class: 'ar-bottom' },
              h('button', { class: 'btn primary', onClick: stop(() => ar.placeInFront()) }, tr('Place in front of me')),
            ),
          ]
        : []),
      ...(ar.status === 'placed'
        ? [h(
            'div',
            { class: 'ar-bottom' },
            h('button', { class: 'ar-btn', 'aria-label': tr('Move the scene'), onClick: stop(() => ar.replace()) }, icon(Move)),
            h('button', { class: 'shutter', 'aria-label': tr('Take photo'), onClick: stop(() => this.capture()) }, h('i', {})),
            h(
              'button',
              { class: 'ar-btn ar-scale', 'aria-label': tr('Real size (1:1)'), onClick: stop(() => ar.resetScale()) },
              ar.scale === 1 ? icon(Ruler) : h('span', {}, `${Math.round(ar.scale * 100)}%`),
            ),
          )]
        : []),
    );
    const panel = this.el.querySelector('.ar-options');
    if (panel) panel.scrollTop = scroll;
  }

  /** Options panel: everything optional, cheapest settings by default. */
  private optionsPanel() {
    const ar = this.ar;
    const lights: { id: ARLighting; label: string }[] = [
      { id: 'scene', label: tr('Scene') },
      { id: 'room', label: tr('Real room') },
      { id: 'studio', label: tr('Studio') },
      { id: 'daylight', label: tr('Daylight') },
      { id: 'sunset', label: tr('Sunset') },
      { id: 'neon', label: tr('Neon') },
      { id: 'dramatic', label: tr('Dramatic') },
    ];
    const chips = <T extends string>(items: { id: T; label: string }[], value: T, pick: (v: T) => void) =>
      h(
        'div',
        { class: 'ar-chips' },
        ...items.map((it) => h('button', { class: `chip ${it.id === value ? 'active' : ''}`, onClick: (ev: Event) => (ev.stopPropagation(), pick(it.id)) }, it.label)),
      );
    const level = h('input', { type: 'range', min: '0.2', max: '2.5', step: '0.05', value: String(ar.lightLevel) });
    level.addEventListener('input', () => ar.setLightLevel(parseFloat(level.value)));
    const panel = h(
      'div',
      { class: 'ar-options' },
      this.option(tr('Camera background'), !ar.virtual, (v) => ar.setVirtual(!v)),
      ar.virtual ? h('p', { class: 'ar-note' }, tr('Virtual AR: walk around the scene in its own environment.')) : null,
      h('h4', {}, tr('Lighting')),
      chips(lights, ar.lighting, (v) => ar.setLighting(v)),
      ar.lighting === 'room' ? h('p', { class: 'ar-note' }, tr('Heavier: uses the phone to estimate the room light.')) : null,
      h('label', { class: 'ar-slider' }, h('span', {}, tr('Light intensity')), level),
      this.option(tr('Shadows on the floor'), ar.shadows, (v) => ar.setShadows(v)),
      h('h4', {}, tr('Photo filter')),
      chips(
        Object.entries(AR_FILTERS).map(([id, f]) => ({ id, label: tr(f.label) })),
        ar.filter,
        (v) => ar.setFilter(v),
      ),
      this.option(tr('Show FPS'), this.showFps, (v) => this.setFps(v)),
    );
    return panel;
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

  private option(label: string, value: boolean, onChange: (v: boolean) => void) {
    return h(
      'button',
      {
        class: `ar-option ${value ? 'on' : ''}`,
        onClick: (ev: Event) => {
          ev.stopPropagation();
          onChange(!value);
        },
      },
      h('span', {}, label),
      h('i', {}),
    );
  }

  private async capture() {
    const flash = h('div', { class: 'flash' });
    this.el.append(flash);
    setTimeout(() => flash.remove(), 500);
    try {
      const blob = await this.ar.capture();
      if (!blob) {
        this.flash(tr("This phone doesn't share the camera image with the browser. Use the system screenshot."));
        return;
      }
      const name = `babalon-ar-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.jpg`;
      saveFile(blob, name);
      this.lastPhoto = { blob, name };
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
      if ((ev.target as Element).closest('button, .ar-options')) return;
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
        this.ar.rotateBy(-(now.angle - pinch.angle));
        pinch = now;
      } else if (pointers.size === 1) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 8) moved = true;
        if (moved) this.ar.rotateBy(dx * 0.01);
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
