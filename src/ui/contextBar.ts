import { PanelRightOpen } from 'lucide';
import type { IconNode } from 'lucide';
import { tr } from '../core/i18n';
import { h, icon, iconButton } from './dom';
import type { UI } from './ui';

/** Something going on that has its own controls: a selection, a mode, an operation, a recording. */
export interface UIContext {
  id: string;
  icon: IconNode;
  /** Accessible name and status for the collapsed circle (e.g. "4,504 faces"). */
  label: string;
  busy?: boolean;
  /** Fills the bubble (the UI's `selbar`) with the context's controls. */
  render: () => void;
  /** Opens the context's full settings where the dock's panels open. */
  expand?: () => void;
}

const SAVED = 'babalon.ctxbar';

/** Where the bar is docked: never floating, never under the dock. */
type Slot = 'bottom' | 'top';
type Bubble = { el: HTMLDivElement; trigger: HTMLButtonElement; controls: HTMLDivElement };

/**
 * Context bubbles, like the iPhone's Dynamic Island: every context going on at once is its own
 * bubble; the focused one is expanded with its controls, the others are circles (tapping one focuses
 * it; the panel button opens the full settings in the dock's panel). The bar is always docked: at the
 * bottom beside the dock like a taskbar (above it when both don't fit), or at the top under the top
 * bar. Dragging the indicator line at its bottom (like the iOS / Android home indicator) moves it, and
 * it snaps to the nearest slot on release.
 */
export class ContextBar {
  readonly el = h('div', { class: 'ctxbar' });
  private readonly handle = h('button', { class: 'ctx-handle', title: tr('Drag to the top or the bottom'), 'aria-label': tr('Drag to the top or the bottom') });
  private readonly bubbles = new Map<string, Bubble>();
  private history: string[] = [];
  private before = new Map<string, DOMRect>();
  private animateNext = false;
  private dockHeight = 0;
  private beforeBar: DOMRect | null = null;
  private placement = '';
  private readonly motions = new Map<HTMLElement, Animation>();
  /** The context the user tapped; otherwise the first one by priority. */
  private focused: string | null = null;
  private current: UIContext | null = null;
  private slot: Slot = 'bottom';
  /** Pointer height during a drag; previews one of the two docked slots. */
  private dragging: number | null = null;
  private readonly ui: UI;

  constructor(ui: UI) {
    this.ui = ui;
    try { this.slot = localStorage.getItem(SAVED) === 'top' ? 'top' : 'bottom'; } catch { this.slot = 'bottom'; }
    this.el.append(ui.transformBar.el);
    this.setupDrag();
    window.addEventListener('resize', () => this.layout(false));
  }

  /** Re-renders from the active contexts, in priority order. */
  render(contexts: UIContext[]) {
    this.ui.selbar.classList.remove('ctx-sections');
    delete this.ui.selbar.dataset.part;
    const ids = new Set(contexts.map((c) => c.id));
    const added = contexts.find((c) => !this.bubbles.has(c.id));
    const id = added?.id ?? (ids.has(this.focused ?? '') ? this.focused : this.history.find((c) => ids.has(c)));
    const focus = contexts.find((c) => c.id === id) ?? contexts[0] ?? null;
    const changed = focus?.id !== this.current?.id || contexts.length !== this.bubbles.size;
    if (changed) {
      this.beforeBar = this.el.getBoundingClientRect();
      this.before = new Map([...this.bubbles].map(([id, b]) => [id, b.el.getBoundingClientRect()]));
      for (const b of this.bubbles.values()) {
        b.el.getAnimations().forEach((a) => a.cancel());
        b.controls.getAnimations().forEach((a) => a.cancel());
      }
      this.animateNext = true;
    }
    this.focused = focus?.id ?? null;
    if (focus) this.history = [focus.id, ...this.history.filter((id) => id !== focus.id && ids.has(id))];
    this.current = focus;
    this.el.classList.toggle('show', !!focus);
    for (const c of contexts) {
      let b = this.bubbles.get(c.id);
      if (!b) {
        const controls = h('div', { class: 'ctx-controls', id: `ctx-${c.id}` });
        const trigger = h('button', { class: 'ctx-trigger', onClick: () => { this.focus(c.id); this.ui.renderSelbar(); } });
        const el = h('div', { class: 'ctx-bubble', 'data-context': c.id }, trigger, controls);
        b = { el, trigger, controls };
        this.bubbles.set(c.id, b);
        this.el.append(el);
      }
      b.trigger.replaceChildren(icon(c.icon, 20));
      b.trigger.title = c.label;
      b.trigger.setAttribute('aria-label', c.label);
      b.trigger.setAttribute('aria-controls', b.controls.id);
      b.trigger.setAttribute('aria-expanded', String(c === focus));
      b.el.classList.toggle('expanded', c === focus);
      b.el.classList.toggle('busy', !!c.busy);
      b.el.setAttribute('aria-label', c.label);
      b.controls.hidden = c !== focus;
      b.trigger.hidden = c === focus;
    }
    if (focus) {
      this.bubbles.get(focus.id)!.controls.append(this.ui.selbar);
      focus.render();
      const container = this.bubbles.get(focus.id)!.el;
      container.classList.toggle('has-parts', this.ui.selbar.classList.contains('ctx-sections'));
      (this.ui.selbar.querySelector('.ctx-sub.expanded') ?? container).append(this.handle);
      this.ui.selbar.classList.add('show');
      this.ui.selbar.querySelector('.ctx-expand')?.remove();
      if (focus.expand && !container.classList.contains('has-parts')) this.ui.selbar.append(iconButton(PanelRightOpen, tr('Open its settings'), focus.expand, { cls: 'ctx-expand' }));
    } else this.ui.selbar.replaceChildren();
    for (const [id, b] of this.bubbles) {
      if (!ids.has(id)) { b.el.remove(); this.bubbles.delete(id); }
    }
    this.ui.editor.tools.setMeasurePaused(!!this.ui.editor.tools.measureMode && focus?.id !== 'measure');
    requestAnimationFrame(() => this.layout());
  }

  /** Focuses a context (e.g. one that just started). */
  focus(id: string) { this.focused = id; }

  get focusedId() { return this.current?.id ?? null; }

  /** Hidden elements have no measurable geometry. Resume from the docked slot, never zero boxes. */
  setHidden(hidden: boolean) {
    for (const animation of this.motions.values()) animation.cancel();
    this.motions.clear();
    for (const animation of this.el.getAnimations({ subtree: true })) animation.cancel();
    this.before.clear();
    this.beforeBar = null;
    this.animateNext = false;
    if (!hidden) {
      this.layout(false);
      // Width changes at a breakpoint must restore at their final size, too.
      for (const animation of this.el.getAnimations({ subtree: true })) animation.cancel();
    }
  }

  /**
   * Docks the bar. Bottom: beside the dock as a taskbar (the two centered together), or above the
   * dock (above an open panel on phones) when they don't fit. Top: under the top bar, centered in the
   * space left by an open side panel.
   */
  layout(animate = true) {
    const el = this.el, body = document.body, dock = this.ui.dock;
    if (body.classList.contains('ui-hidden')) return;
    const logo = this.ui.topbar.querySelector<HTMLElement>('.brand');
    // The logo changes from lettering to its compact icon at the phone breakpoint.
    if (logo?.offsetWidth) this.ui.topbar.style.setProperty('--brand-width', `${logo.offsetWidth}px`);
    const previousBar = el.getBoundingClientRect(), previousDock = dock.getBoundingClientRect();
    // Phone navigation fills the row; discard the desktop taskbar's inline horizontal position.
    if (window.innerWidth <= 760) dock.style.left = '';
    const show = el.classList.contains('show');
    el.classList.remove('beside', 'at-top', 'at-header');
    body.style.setProperty('--ctx-lift', '0px');
    // Move the dock only after computing the complete row, so it can never cover a bubble.
    let dockLeft = '';
    const done = () => {
      if (dock.style.left !== dockLeft) dock.style.left = dockLeft;
      const placement = `${el.style.left}/${el.style.top}/${el.style.width}/${el.style.getPropertyValue('--ctx-height')}/${dockLeft}/${show}`;
      const moved = placement !== this.placement;
      if (moved) {
        this.motions.get(el)?.cancel();
        this.motions.get(dock)?.cancel();
      }
      this.avoidViewControls();
      this.ui.refreshContextMenu();
      this.animateBubbles();
      if (moved) {
        this.placement = placement;
        if (animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          const nextDock = dock.getBoundingClientRect();
          const opensLane = nextDock.left < previousDock.left - 1;
          const followsBar = show && previousBar.width > 0 && nextDock.left > previousDock.left + 1;
          this.animatePlacement(dock, previousDock, followsBar ? 100 : 0, true);
          if (show && previousBar.width) this.animatePlacement(el, previousBar, opensLane ? 100 : 0);
          else if (show && opensLane) {
            const reveal = el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, delay: 220, fill: 'backwards' });
            this.motions.set(el, reveal);
            reveal.onfinish = () => { if (this.motions.get(el) === reveal) this.motions.delete(el); };
          }
        }
      }
    };
    const vw = window.innerWidth, vh = window.innerHeight;
    const d = dock.getBoundingClientRect(), gap = 12;
    if (d.height) this.dockHeight = d.height;
    let height = this.dockHeight || parseFloat(getComputedStyle(body).getPropertyValue('--dock-h'));
    const photo = this.ui.editor.photoMode;
    const headerBottom = photo
      ? this.ui.photoHud.querySelector('.hud-exit')?.getBoundingClientRect().bottom ?? 0
      : this.ui.topbar.getBoundingClientRect().bottom;
    const extra = this.ui.transformBar.el.classList.contains('show') ? this.ui.transformBar.el.offsetHeight + 8 : 0;
    // On short phones the panel yields height, keeping both the global controls and bubbles usable.
    if (show && vw <= 760 && !photo) body.style.setProperty('--ctx-panel-max', `${Math.max(0, d.top - 6 - headerBottom - 8 - height - 18 - extra)}px`);
    else body.style.removeProperty('--ctx-panel-max');
    if (!show) return done();
    const panel = this.ui.panel.getBoundingClientRect();
    const panelOpen = body.classList.contains('panel-open');
    const sidePanel = panelOpen && panel.left > vw / 2;
    const slot = this.dragging === null ? this.slot : this.dragging < vh / 2 ? 'top' : 'bottom';
    const header = this.ui.topbar.getBoundingClientRect();
    const brand = this.ui.topbar.querySelector('.brand')?.getBoundingClientRect();
    const actions = this.ui.topbar.querySelector('.top-actions')?.getBoundingClientRect();
    const partsCount = this.ui.selbar.querySelectorAll('.ctx-sub').length;
    const inlineLeft = (brand?.right ?? 0) + 12;
    const inlineRight = Math.min((actions?.left ?? vw) - 12, sidePanel ? panel.left - 8 : vw);
    // A usable middle lane wins over a second row. Scroll only its focused controls when needed.
    const inline = slot === 'top' && !photo && header.height >= 48 && inlineRight - inlineLeft >= Math.max(220, (this.bubbles.size - 1 + Math.max(0, partsCount - 1)) * 56 + 120);
    const space = inline ? inlineRight - inlineLeft + 16 : sidePanel ? panel.left : vw;
    if (inline) {
      height = header.height;
      el.classList.add('at-header');
      if (vw <= 760) body.style.setProperty('--ctx-panel-max', `${Math.max(0, d.top - 6 - headerBottom - 8 - (extra ? extra + 18 : 0))}px`);
    }
    el.style.maxWidth = `${Math.max(0, space - 16)}px`;
    el.style.setProperty('--ctx-height', `${height}px`);
    const circle = 48, bubbleGap = 8;
    const siblings = (this.bubbles.size - 1) * (circle + bubbleGap);
    // Keep every collapsed context reachable; only the focused controls scroll on small screens.
    const active = this.current && this.bubbles.get(this.current.id);
    if (active) {
      const parts = [...this.ui.selbar.querySelectorAll<HTMLElement>('.ctx-sub')];
      const partSpace = (parts.length - 1) * (circle + bubbleGap);
      for (const part of parts) {
        const expanded = part.classList.contains('expanded');
        const natural = part.querySelector<HTMLElement>('.ctx-sub-controls')!.scrollWidth + 14;
        part.style.width = `${expanded ? Math.max(circle, Math.min(natural, space - 16 - siblings - partSpace)) : circle}px`;
      }
      const natural = parts.length ? parts.reduce((sum, p) => sum + parseFloat(p.style.width), 0) + (parts.length - 1) * bubbleGap : this.ui.selbar.scrollWidth + 2;
      const width = Math.max(48, Math.min(natural, space - 16 - siblings));
      active.el.style.width = `${width}px`;
      for (const b of this.bubbles.values()) if (b !== active) b.el.style.width = `${circle}px`;
      el.style.width = `${Math.min(space - 16, width + siblings)}px`;
      let left = 0;
      for (const b of this.bubbles.values()) {
        b.el.style.left = `${left}px`;
        left += (b === active ? width : circle) + bubbleGap;
      }
    }
    const w = el.offsetWidth, hgt = el.offsetHeight;
    if (slot === 'top') {
      el.classList.add('at-top');
      el.style.left = inline ? `${inlineLeft + (inlineRight - inlineLeft - w) / 2}px` : `${Math.max(8, (space - w) / 2)}px`;
      el.style.top = inline ? `${header.top}px` : `${headerBottom + 8}px`;
      return done();
    }
    if (photo) {
      const controlsTop = this.ui.photoHud.querySelector('.hud-bottom')?.getBoundingClientRect().top ?? vh;
      el.style.left = `${Math.max(8, (space - w) / 2)}px`;
      el.style.top = `${Math.max(headerBottom + 8, controlsTop - hgt - 18)}px`;
      return done();
    }
    // Width and height of the dock don't change when it slides; only its place does
    if (d.width + gap + w <= space - 20) {
      // Wide screen: dock and bubbles side by side, centered as one taskbar
      const left = (space - (d.width + gap + w)) / 2;
      dockLeft = `${left + d.width / 2}px`;
      el.classList.add('beside');
      el.style.left = `${left + d.width + gap}px`;
      el.style.top = `${d.bottom - hgt}px`;
      return done();
    }
    // Narrow: above the dock, or above the panel when it covers the bottom
    el.style.left = `${Math.max(8, (space - w) / 2)}px`;
    el.style.top = `${(panelOpen && !sidePanel ? panel.top : d.top) - hgt - 18}px`;
    body.style.setProperty('--ctx-lift', `${hgt + 18 + extra}px`);
    done();
  }

  /** Retarget from the visible position, including an interrupted move; never scale the contents. */
  private animatePlacement(el: HTMLElement, previous: DOMRect, delay: number, dock = false) {
    const next = el.getBoundingClientRect();
    const dx = previous.left - next.left, dy = previous.top - next.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    const base = dock && window.innerWidth > 760 ? 'translateX(-50%)' : '';
    const animation = el.animate([
      { transform: `translate(${dx}px, ${dy}px) ${base}` },
      { transform: `translate(0, 0) ${base}` },
    ], { duration: dock ? 220 : 320, delay, fill: 'backwards', easing: 'cubic-bezier(.22, 1, .36, 1)' });
    this.motions.set(el, animation);
    animation.onfinish = () => { if (this.motions.get(el) === animation) this.motions.delete(el); };
  }

  /** View controls yield vertically when they share the bubbles' horizontal space. */
  private avoidViewControls() {
    const view = this.ui.viewStack;
    view.style.bottom = '';
    if (!this.el.classList.contains('show') || !view.offsetHeight) return;
    const b = this.el.getBoundingClientRect(), v = view.getBoundingClientRect();
    if (b.left < v.right + 8 && b.right > v.left - 8 && b.top < v.bottom + 8 && b.bottom > v.top - 8) {
      view.style.bottom = `${window.innerHeight - b.top + 12}px`;
    }
  }

  /** Animate real widths, so icons and text never stretch. Repeated renders don't restart motion. */
  private animateBubbles() {
    if (!this.animateNext) return;
    this.animateNext = false;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const [id, b] of this.bubbles) {
      const previous = this.before.get(id), next = b.el.getBoundingClientRect();
      const dx = previous ? previous.left - (this.beforeBar?.left ?? 0) - (next.left - this.el.getBoundingClientRect().left) : 0;
      b.el.animate(previous ? [
        { width: `${previous.width}px`, height: `${previous.height}px`, transform: `translate(${dx}px, -50%)` },
        { width: `${next.width}px`, height: `${next.height}px`, transform: 'translate(0, -50%)' },
      ] : [{ opacity: 0 }, { opacity: 1 }],
      { duration: 260, easing: 'cubic-bezier(.22, 1, .36, 1)' });
      if (b.el.classList.contains('expanded')) b.controls.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, delay: 80, fill: 'backwards' });
    }
    this.before.clear();
    this.beforeBar = null;
  }

  private setupDrag() {
    const line = this.handle;
    line.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault();
      this.slot = this.slot === 'top' ? 'bottom' : 'top';
      try { localStorage.setItem(SAVED, this.slot); } catch { /* private mode */ }
      this.layout();
    });
    let startY = 0, moved = false, pointer: number | null = null;
    line.addEventListener('pointerdown', (ev) => {
      startY = ev.clientY; moved = false; pointer = ev.pointerId;
      try { line.setPointerCapture(ev.pointerId); } catch { /* moves still arrive over the line */ }
      ev.preventDefault(); ev.stopPropagation();
    });
    window.addEventListener('pointermove', (ev) => {
      if (ev.pointerId !== pointer) return;
      if (!moved && Math.abs(ev.clientY - startY) < 6) return;
      moved = true;
      this.dragging = ev.clientY;
      this.el.classList.add('dragging');
      this.layout();
    });
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== pointer) return;
      pointer = null;
      // Snap to the nearest slot; a tap without moving switches slots
      const y = moved ? ev.clientY : this.slot === 'top' ? window.innerHeight : 0;
      this.slot = y < window.innerHeight / 2 ? 'top' : 'bottom';
      this.dragging = null;
      this.el.classList.remove('dragging');
      try { localStorage.setItem(SAVED, this.slot); } catch { /* private mode: just for this visit */ }
      this.layout();
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', (ev) => {
      if (ev.pointerId !== pointer) return;
      pointer = null;
      this.dragging = null;
      this.el.classList.remove('dragging');
      this.layout();
    });
  }
}
