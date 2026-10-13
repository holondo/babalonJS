import { tr } from '../core/i18n';

/** Mobile panel sizing stays independent of panel content rebuilds. */
export class PanelSheet {
  readonly handle = document.createElement('button');
  private level = 1;
  private drag: { id: number; y: number; height: number; heights: number[] } | null = null;
  private heightFrame = 0;
  private layoutFrame = 0;
  private viewportFrame = 0;
  private pendingHeight = 0;

  private panel: HTMLElement;
  private layout: () => void;

  constructor(panel: HTMLElement, layout: () => void) {
    this.panel = panel;
    this.layout = layout;
    this.handle.className = 'panel-grip';
    this.handle.type = 'button';
    this.handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || window.innerWidth > 760) return;
      this.drag = { id: event.pointerId, y: event.clientY, height: panel.offsetHeight, heights: this.heights() };
      this.pendingHeight = this.drag.height;
      this.handle.setPointerCapture(event.pointerId);
      panel.classList.add('sheet-dragging');
    });
    this.handle.addEventListener('pointermove', (event) => {
      if (!this.drag || event.pointerId !== this.drag.id) return;
      const heights = this.drag.heights;
      this.pendingHeight = Math.max(heights[0], Math.min(heights[2], this.drag.height + this.drag.y - event.clientY));
      if (!this.heightFrame) this.heightFrame = requestAnimationFrame(() => { this.heightFrame = 0; this.setHeight(this.pendingHeight); });
    });
    const finish = (event: PointerEvent) => {
      if (!this.drag || event.pointerId !== this.drag.id) return;
      const moved = Math.abs(event.clientY - this.drag.y) > 6;
      const heights = this.drag.heights;
      cancelAnimationFrame(this.heightFrame); this.heightFrame = 0;
      this.drag = null;
      panel.classList.remove('sheet-dragging');
      if (this.handle.hasPointerCapture(event.pointerId)) this.handle.releasePointerCapture(event.pointerId);
      if (moved) {
        const height = this.pendingHeight;
        this.level = heights.reduce((best, value, index, values) => Math.abs(value - height) < Math.abs(values[best] - height) ? index : best, 0);
      }
      this.update();
      // A drag must not also cycle the snap position through the following click.
      if (moved) this.suppressClick = true;
    };
    this.handle.addEventListener('pointerup', finish);
    this.handle.addEventListener('pointercancel', () => { cancelAnimationFrame(this.heightFrame); this.heightFrame = 0; this.drag = null; panel.classList.remove('sheet-dragging'); this.update(); });
    this.handle.addEventListener('click', () => {
      if (this.suppressClick) { this.suppressClick = false; return; }
      this.level = (this.level + 1) % 3;
      this.update();
    });
    this.handle.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      this.level = Math.max(0, Math.min(2, this.level + (event.key === 'ArrowUp' ? 1 : -1)));
      this.update();
    });
    window.addEventListener('resize', () => this.update());
    const viewportChanged = () => {
      if (this.viewportFrame) return;
      this.viewportFrame = requestAnimationFrame(() => {
        this.viewportFrame = 0;
        const viewport = window.visualViewport;
        const inset = viewport && viewport.scale === 1 ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
        document.body.style.setProperty('--keyboard-inset', `${inset}px`);
        this.update(); this.scheduleLayout();
      });
    };
    window.visualViewport?.addEventListener('resize', viewportChanged);
    window.visualViewport?.addEventListener('scroll', viewportChanged);
    new ResizeObserver(() => this.scheduleLayout()).observe(panel);
    panel.addEventListener('transitionend', () => this.scheduleLayout());
  }

  private suppressClick = false;

  scheduleLayout() {
    if (!this.layoutFrame) this.layoutFrame = requestAnimationFrame(() => { this.layoutFrame = 0; this.layout(); });
  }

  private heights() {
    const style = getComputedStyle(this.panel);
    const bottom = parseFloat(style.bottom) || 0;
    const header = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 64;
    const contextMax = parseFloat(getComputedStyle(document.body).getPropertyValue('--ctx-panel-max'));
    const viewport = window.visualViewport;
    const top = Math.max(header, viewport?.offsetTop ?? 0);
    const max = Math.max(0, Math.min(window.innerHeight - bottom - top - 16, Number.isFinite(contextMax) ? contextMax : Infinity));
    return [Math.min(220, max), Math.min((viewport?.height ?? window.innerHeight) * 0.48, max), max];
  }

  private setHeight(height: number) {
    this.panel.style.setProperty('--sheet-height', `${height}px`);
  }

  update() {
    this.handle.setAttribute('aria-label', tr('Resize panel'));
    this.handle.setAttribute('aria-description', tr(['Panel reduced', 'Panel half expanded', 'Panel expanded'][this.level]));
    this.handle.title = tr('Drag to resize, tap to change height');
    if (window.innerWidth <= 760) this.setHeight(this.heights()[this.level]);
    else this.panel.style.removeProperty('--sheet-height');
  }
}
