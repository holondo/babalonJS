import { tr } from '../core/i18n';

/** Mobile panel sizing stays independent of panel content rebuilds. */
export class PanelSheet {
  readonly handle = document.createElement('button');
  private level = 1;
  private drag: { id: number; y: number; height: number } | null = null;

  private panel: HTMLElement;
  private layout: () => void;

  constructor(panel: HTMLElement, layout: () => void) {
    this.panel = panel;
    this.layout = layout;
    this.handle.className = 'panel-grip';
    this.handle.type = 'button';
    this.handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || window.innerWidth > 760) return;
      this.drag = { id: event.pointerId, y: event.clientY, height: panel.offsetHeight };
      this.handle.setPointerCapture(event.pointerId);
      panel.classList.add('sheet-dragging');
    });
    this.handle.addEventListener('pointermove', (event) => {
      if (!this.drag || event.pointerId !== this.drag.id) return;
      const heights = this.heights();
      this.setHeight(Math.max(heights[0], Math.min(heights[2], this.drag.height + this.drag.y - event.clientY)));
    });
    const finish = (event: PointerEvent) => {
      if (!this.drag || event.pointerId !== this.drag.id) return;
      const moved = Math.abs(event.clientY - this.drag.y) > 6;
      this.drag = null;
      panel.classList.remove('sheet-dragging');
      if (this.handle.hasPointerCapture(event.pointerId)) this.handle.releasePointerCapture(event.pointerId);
      if (moved) {
        const height = panel.offsetHeight;
        this.level = this.heights().reduce((best, value, index, values) => Math.abs(value - height) < Math.abs(values[best] - height) ? index : best, 0);
      }
      this.update();
      // A drag must not also cycle the snap position through the following click.
      if (moved) this.suppressClick = true;
    };
    this.handle.addEventListener('pointerup', finish);
    this.handle.addEventListener('pointercancel', () => { this.drag = null; panel.classList.remove('sheet-dragging'); this.update(); });
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
    new ResizeObserver(() => this.layout()).observe(panel);
  }

  private suppressClick = false;

  private heights() {
    const style = getComputedStyle(this.panel);
    const bottom = parseFloat(style.bottom) || 0;
    const header = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 64;
    const contextMax = parseFloat(getComputedStyle(document.body).getPropertyValue('--ctx-panel-max'));
    const max = Math.max(120, Math.min(window.innerHeight - bottom - header - 16, Number.isFinite(contextMax) ? contextMax : Infinity));
    return [Math.min(220, max), Math.min(window.innerHeight * 0.48, max), max];
  }

  private setHeight(height: number) {
    this.panel.style.setProperty('--sheet-height', `${height}px`);
  }

  update() {
    this.handle.setAttribute('aria-label', tr('Resize panel'));
    this.handle.title = tr('Drag to resize, tap to change height');
    if (window.innerWidth <= 760) this.setHeight(this.heights()[this.level]);
    else this.panel.style.removeProperty('--sheet-height');
  }
}
