import { Move, Ruler, X } from 'lucide';
import type { ARMode } from './ar';
import { h, icon } from './dom';
import { tr } from './i18n';

/**
 * Interface shown over the camera during AR (WebXR "DOM overlay": only this element is visible).
 * Gestures: tap places the scene, one finger turns it, two fingers resize and turn.
 */
export class ARHud {
  readonly el = h('div', { class: 'ar-hud' });
  private message = '';
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
      this.render();
    }, 3500);
    this.render();
  }

  private render() {
    const ar = this.ar;
    this.el.classList.toggle('show', ar.active);
    if (!ar.active) return this.el.replaceChildren();
    const hint =
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
      h('div', { class: 'ar-hint' }, hint),
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
      const a = h('a', { href: URL.createObjectURL(blob), download: name });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
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
      if ((ev.target as Element).closest('button')) return;
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
        if (!this.ar.place()) this.flash(tr('Move the phone slowly to find the floor'));
      }
    };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
  }
}
