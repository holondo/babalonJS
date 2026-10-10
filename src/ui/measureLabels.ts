import { MoveHorizontal, MoveVertical, Spline, X } from 'lucide';
import { tr } from '../core/i18n';
import { h, icon, iconButton } from './dom';
import type { Guide, Measurement } from '../tools/tools';
import type { UI } from './ui';

/** Measurement and guide labels drawn over the 3D view. */
export class MeasureLabels {
  private readonly ui: UI;

  constructor(ui: UI) {
    this.ui = ui;
  }

  labelEls = new Map<Measurement, HTMLElement>();

  guideEls = new Map<Guide, HTMLElement>();

  draggingGuide: Guide | null = null;

  /** Recreates the floating labels (one per measurement); positions are updated every frame. */
  buildLabels() {
    const tools = this.ui.editor.tools;
    // Don't rebuild under the finger while a guide is being dragged
    if (this.draggingGuide) return;
    this.ui.labels.replaceChildren();
    this.labelEls.clear();
    this.guideEls.clear();
    if (this.ui.editor.photoMode) return;
    // Guide handles only matter while editing guides: show them with the Tools tab open
    const guides = this.ui.tab === 'tools' ? tools.guides : [];
    for (const g of guides) {
      const active = g === tools.activeGuide;
      const el = h(
        'div',
        { class: `glabel ${active ? 'active' : ''}`, title: tr('Drag to move the guide') },
        icon(g.axis === 'y' ? MoveVertical : MoveHorizontal, 14),
        h('span', { class: 'gtext' }),
        active ? iconButton(X, tr('Delete'), () => tools.removeGuide(g), { cls: 'mini' }) : null,
      );
      el.querySelectorAll('.mini').forEach((b) => b.addEventListener('pointerdown', (ev) => ev.stopPropagation()));
      this.makeGuideDraggable(g, el);
      this.ui.labels.append(el);
      this.guideEls.set(g, el);
    }
    for (const m of tools.measurements) {
      const active = m === tools.active;
      const el = h(
        'div',
        { class: `mlabel ${active ? 'active' : ''}`, onClick: () => tools.setActive(active ? null : m) },
        h('span', { class: 'mtext' }),
        active ? iconButton(Spline, tr('Follow the surface'), () => tools.setSurface(m, !m.surface), { cls: 'mini', active: m.surface }) : null,
        active ? iconButton(X, tr('Delete'), () => tools.removeMeasurement(m), { cls: 'mini' }) : null,
      );
      el.querySelectorAll('.mini').forEach((b) => b.addEventListener('click', (ev) => ev.stopPropagation()));
      this.ui.labels.append(el);
      this.labelEls.set(m, el);
    }
  }

  /** Dragging the chip moves the guide along its axis (works with mouse and touch). */
  makeGuideDraggable(g: Guide, el: HTMLElement) {
    const tools = this.ui.editor.tools;
    let offset = { x: 0, y: 0 };
    let start = { x: 0, y: 0 };
    let moved = false;
    el.addEventListener('pointerdown', (ev) => {
      start = { x: ev.clientX, y: ev.clientY };
      moved = false;
      ev.preventDefault();
      ev.stopPropagation();
      el.setPointerCapture(ev.pointerId);
      const rect = this.ui.editor.engine.getRenderingCanvas()!.getBoundingClientRect();
      const handle = this.ui.editor.toScreen(tools.guideHandle(g));
      offset = { x: ev.clientX - rect.left - handle.x, y: ev.clientY - rect.top - handle.y };
      this.draggingGuide = g;
      el.classList.add('dragging');
    });
    el.addEventListener('pointermove', (ev) => {
      if (this.draggingGuide !== g) return;
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 4) return;
      moved = true;
      const rect = this.ui.editor.engine.getRenderingCanvas()!.getBoundingClientRect();
      tools.dragGuide(g, ev.clientX - rect.left - offset.x, ev.clientY - rect.top - offset.y);
    });
    const end = () => {
      if (this.draggingGuide !== g) return;
      this.draggingGuide = null;
      el.classList.remove('dragging');
      // A tap (no drag) expands/collapses the chip
      if (!moved) tools.setActiveGuide(tools.activeGuide === g ? null : g);
      else tools.changed.notifyObservers();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  updateLabels() {
    const ed = this.ui.editor;
    const tools = ed.tools;
    // Keep guide chips inside the free area of the screen (not under bars or the panel)
    const canvas = ed.engine.getRenderingCanvas()!;
    const panelOpen = this.ui.panel.classList.contains('show') && canvas.clientWidth > 760;
    const minX = 80;
    const maxX = canvas.clientWidth - (panelOpen ? 360 + 80 : 80);
    const minY = 130;
    const maxY = canvas.clientHeight - (canvas.clientWidth > 760 ? 110 : this.ui.panel.classList.contains('show') ? canvas.clientHeight * 0.55 : 110);
    for (const [g, el] of this.guideEls) {
      const s = ed.toScreen(tools.guideHandle(g));
      const x = Math.min(Math.max(s.x, minX), Math.max(minX, maxX));
      const y = Math.min(Math.max(s.y, minY), Math.max(minY, maxY));
      el.style.display = s.visible || this.draggingGuide === g ? '' : 'none';
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      const text = `${g.axis === 'y' ? tr('Height') : g.axis.toUpperCase()} ${tools.format(g.value)}`;
      const span = el.querySelector('.gtext') as HTMLElement;
      if (span.textContent !== text) span.textContent = text;
    }
    for (const [m, el] of this.labelEls) {
      const alive = (!m.a.entity || ed.entities.includes(m.a.entity)) && (!m.b.entity || ed.entities.includes(m.b.entity));
      const s = ed.toScreen(tools.labelPoint(m));
      el.style.display = alive && s.visible ? '' : 'none';
      el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -150%)`;
      const text = tools.format(m.length) + (m.surfaceFailed ? ` · ${tr('straight')}` : m.path ? ` · ${tr('surface')}` : '');
      const span = el.firstElementChild as HTMLElement;
      if (span.textContent !== text) span.textContent = text;
    }
  }
}
