import { Brush, Lasso, MousePointerClick, Scissors, Undo2, Wand, X } from 'lucide';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { Entity } from '../../core/editor';
import { tr } from '../../core/i18n';
import type { SelectTool } from '../../edit/separate';
import type { ScreenPoint } from '../../edit/lasso';
import { button, chips, h, hint, icon, iconButton, row, section, segmented, slider, toggle } from '../dom';
import type { UI } from '../ui';

/**
 * Separate mode (More → Separate parts…): choose faces of a model, by its own parts, by tapping
 * a piece, with the magic wand, a lasso or a brush, or cut it with a plane; then make them a new object.
 */
export class SeparatePanel {
  private readonly ui: UI;
  /** Shows the stroke being drawn (it never takes touches: strokes are read on the canvas). */
  private readonly layer = h('div', { class: 'stroke-layer' });
  private readonly svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  private readonly path = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  private listening = false;

  constructor(ui: UI) {
    this.ui = ui;
    this.svg.append(this.path);
    this.layer.append(this.svg);
    document.body.append(this.layer);
  }

  start(e: Entity) {
    const ed = this.ui.editor;
    const reason = ed.separator.blocker(e);
    if (reason) return this.ui.toast(reason, 'error');
    // Panels are created before the editor: listen to the canvas on first use
    if (!this.listening) {
      this.listening = true;
      this.setupStrokes();
    }
    ed.select(e);
    ed.separator.start(e);
    ed.setTool('move');
    this.ui.segment.objects = 'separate';
    if (this.ui.tab !== 'objects') this.ui.openTab('objects');
    else this.ui.renderPanel();
    this.ui.renderSelbar();
    this.sync();
  }

  /** Shows the stroke layer only while the lasso or the brush is the tool. */
  sync() {
    const s = this.ui.editor.separator;
    const on = this.drawing();
    this.layer.classList.toggle('on', on);
    document.body.classList.toggle('drawing', on);
    this.cameraButtons(on);
    this.layer.classList.toggle('brush', s.tool === 'brush');
  }

  bar() {
    const s = this.ui.editor.separator;
    const count = s.selection?.count ?? 0;
    this.ui.selbar.classList.add('show');
    this.ui.selbar.replaceChildren(
      h('div', { class: 'sel-name always' }, icon(Scissors, 16), h('span', {}, s.cut ? tr('Place the plane') : count ? tr('{n} faces', { n: count.toLocaleString() }) : tr('Choose faces'))),
      h(
        'div',
        { class: 'sel-tools' },
        iconButton(Undo2, tr('Undo selection'), () => s.edit((sel) => sel.undo())),
        button(tr('Separate'), () => this.separate(), { cls: 'small primary' }),
        iconButton(X, tr('Cancel'), () => this.cancel()),
      ),
    );
  }

  panel(): (Node | null)[] {
    const ed = this.ui.editor;
    const s = ed.separator;
    const sel = s.selection;
    if (!sel) return [];
    const tools: { id: SelectTool; label: string; icon: typeof Lasso }[] = [
      { id: 'piece', label: tr('Piece'), icon: MousePointerClick },
      { id: 'smart', label: tr('Wand'), icon: Wand },
      { id: 'lasso', label: tr('Lasso'), icon: Lasso },
      { id: 'brush', label: tr('Brush'), icon: Brush },
    ];
    const hints: Record<SelectTool, string> = {
      piece: tr('Tap the model: selects the whole connected piece.'),
      smart: tr('Tap the model: selects a region up to creases, texture seams and narrow parts.'),
      lasso: tr('Draw around what you want with one finger. Two fingers (or the right mouse button) move the view.'),
      brush: tr('Paint over what you want with one finger. Two fingers (or the right mouse button) move the view.'),
    };
    const meshes = [...sel.faces.keys()];
    const cut = s.cut;
    return [
      section(
        tr('Select'),
        segmented(tools, s.tool, (id) => (s.setTool(id as SelectTool), this.sync())),
        hint(hints[s.tool]),
        chips([{ value: 'add', label: tr('Add') }, { value: 'remove', label: tr('Remove') }], s.add ? 'add' : 'remove', (v) => s.set({ add: v === 'add' })),
        s.tool === 'smart' ? slider(tr('Tolerance'), s.tolerance * 100, { min: 0, max: 100, step: 1, format: (v) => `${Math.round(v)}%` }, (v) => s.set({ tolerance: v / 100 })) : null,
        s.tool === 'brush' ? slider(tr('Brush size'), s.radius, { min: 8, max: 120, step: 1, format: (v) => `${Math.round(v)} px` }, (v) => s.set({ radius: v })) : null,
        s.tool === 'lasso' || s.tool === 'brush' ? toggle(tr('Also hidden faces behind'), s.through, (v) => s.set({ through: v })) : null,
        row(
          button(tr('All'), () => s.edit((x) => x.all())),
          button(tr('None'), () => s.edit((x) => x.clear())),
          button(tr('Invert'), () => s.edit((x) => x.all(true))),
        ),
        row(button(tr('Grow'), () => s.ring(true)), button(tr('Shrink'), () => s.ring(false))),
      ),
      meshes.length > 1
        ? section(
            tr('Parts of the file'),
            ...meshes.map((m) => {
              const faces = sel.faces.get(m)!;
              const total = m.getTotalIndices() / 3;
              return toggle(`${m.name} · ${Math.round(total).toLocaleString()}`, faces.size === total, (v) => s.edit((x) => x.mesh(m as Mesh, v)));
            }),
          )
        : null,
      section(
        tr('Cut with a plane'),
        hint(tr('For pieces that touch: place the plane between them. The gold side becomes the new object.')),
        toggle(tr('Cutting plane'), !!cut, (v) => (s.setCut(v), this.sync())),
        cut
          ? chips(
              [
                { value: 'horizontal', label: tr('Horizontal') },
                { value: 'vertical', label: tr('Vertical') },
                { value: 'camera', label: tr('Facing me') },
                { value: 'center', label: tr('Centered') },
              ],
              '',
              (v) => (v === 'center' ? cut.center() : cut.snap(v as 'horizontal' | 'vertical' | 'camera')),
            )
          : null,
        cut
          ? chips(
              [
                { value: 'whole', label: tr('Keep triangles whole') },
                { value: 'exact', label: tr('Exact cut') },
              ],
              cut.exact ? 'exact' : 'whole',
              (v) => ((cut.exact = v === 'exact'), ed.invalidate(), this.ui.renderPanel()),
            )
          : null,
        cut && sel.count ? toggle(tr('Cut only the selected faces'), cut.limited, (v) => ((cut.limited = v), ed.invalidate())) : null,
      ),
      row(button(tr('Separate'), () => this.separate(), { icon: Scissors, cls: 'primary' }), button(tr('Cancel'), () => this.cancel(), { cls: 'ghost' })),
    ];
  }

  private separate() {
    const ed = this.ui.editor;
    this.ui.run(() => {
      const copy = ed.separator.separate();
      if (!copy) return;
      this.after();
      this.ui.toast(tr('Separated: {name} is now its own object.', { name: copy.name }));
    });
  }

  cancel() {
    this.ui.editor.separator.cancel();
    this.after();
  }

  private after() {
    this.sync();
    this.ui.segment.objects = 'object';
    this.ui.renderSelbar();
    if (this.ui.tab === 'objects') this.ui.renderPanel();
  }

  /** Lasso and brush are drawing tools: true while one of them should take one-finger / left-button drags. */
  private drawing() {
    const s = this.ui.editor.separator;
    return s.active && !s.cut && (s.tool === 'lasso' || s.tool === 'brush');
  }

  /**
   * Strokes are read on the 3D view itself (buttons and panels above it keep working):
   * - touch: one finger draws; a second finger cancels the stroke and the gesture goes to the camera;
   * - mouse: left button draws; right button turns the view, middle button pans, wheel zooms.
   * The camera never sees a drawing pointer; when a stroke turns into a gesture, its first
   * pointerdown is replayed so the camera gets the whole two-finger gesture.
   */
  private setupStrokes() {
    const canvas = this.ui.editor.engine.getRenderingCanvas()!;
    const replayed = new WeakSet<Event>();
    let stroke: { id: number; points: ScreenPoint[]; first: PointerEvent } | null = null;
    /** Pointers given to the camera (until they are all released). */
    const passed = new Set<number>();
    const local = (ev: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    };
    const draw = () => {
      const s = this.ui.editor.separator;
      const points = stroke?.points ?? [];
      this.path.setAttribute('points', points.map((p) => `${p.x},${p.y}`).join(' ') + (s.tool === 'lasso' && points.length ? ` ${points[0].x},${points[0].y}` : ''));
      this.path.style.strokeWidth = s.tool === 'brush' ? `${s.radius * 2}px` : '';
    };
    const swallow = (ev: Event) => {
      ev.stopImmediatePropagation();
      ev.preventDefault();
    };
    canvas.addEventListener('pointerdown', (ev) => {
      if (replayed.has(ev)) return;
      if (!this.drawing()) return;
      // Mouse: only the left button draws (others turn or pan the view)
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      if (stroke) {
        // Second finger: this is a camera gesture, not a stroke
        const first = stroke.first;
        passed.add(stroke.id);
        stroke = null;
        draw();
        const again = new PointerEvent('pointerdown', first);
        replayed.add(again);
        canvas.dispatchEvent(again);
        passed.add(ev.pointerId);
        return;
      }
      if (passed.size) {
        passed.add(ev.pointerId);
        return;
      }
      swallow(ev);
      stroke = { id: ev.pointerId, points: [local(ev)], first: ev };
      canvas.setPointerCapture?.(ev.pointerId);
      draw();
    }, true);
    canvas.addEventListener('pointermove', (ev) => {
      if (!stroke || ev.pointerId !== stroke.id) return;
      swallow(ev);
      const p = local(ev), last = stroke.points[stroke.points.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) < 3) return;
      stroke.points.push(p);
      draw();
    }, true);
    const end = (ev: PointerEvent) => {
      passed.delete(ev.pointerId);
      if (!stroke || ev.pointerId !== stroke.id) return;
      swallow(ev);
      const points = stroke.points;
      stroke = null;
      draw();
      if (ev.type === 'pointerup') this.ui.run(() => this.ui.editor.separator.stroke(points));
    };
    canvas.addEventListener('pointerup', end, true);
    canvas.addEventListener('pointercancel', end, true);
  }

  /** While drawing with a mouse, the right button turns the view and the middle one pans (left draws). */
  private cameraButtons(drawing: boolean) {
    type Entry = { source: string; button?: number; modifiers?: object; interaction: string };
    const input = (this.ui.editor.camera as unknown as { movement: { input: { inputMap: Entry[] } } }).movement.input;
    const plain = (e: Entry) => e.source === 'pointer' && !e.modifiers;
    const rotate = input.inputMap.find((e) => plain(e) && e.interaction === 'rotate');
    const pan = input.inputMap.find((e) => plain(e) && e.interaction === 'pan');
    if (rotate) rotate.button = drawing ? 2 : 0;
    if (pan) pan.button = drawing ? 1 : 2;
  }

}
