import { Brush, Focus, Lasso, MousePointer2, MousePointerClick, Move3d, Rotate3d, Scale3d, Scissors, Triangle, Wand } from 'lucide';
import { MultiMaterial } from '@babylonjs/core/Materials/multiMaterial.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { Entity, PrimitiveType } from '../../core/editor';
import { QUICK_SHAPES, shapeLabel } from '../quickShapes';
import { tr } from '../../core/i18n';
import type { SelectTool } from '../../edit/separate';
import type { ScreenPoint } from '../../edit/lasso';
import { button, chips, h, hint, iconButton, row, section, segmented, slider, toggle, select } from '../dom';
import type { UI } from '../ui';

/**
 * Mesh mode (Tab, or Object | Mesh in the selection bar): choose faces of a model (its own parts,
 * a tapped piece, the magic wand, a lasso or a brush), move / rotate / scale them with the same
 * tools as objects, sculpt the surface, and modify it (cut, separate, repair, connect).
 */
export class SeparatePanel {
  private readonly ui: UI;
  /** Shows the stroke being drawn (it never takes touches: strokes are read on the canvas). */
  private readonly layer = h('div', { class: 'stroke-layer' });
  private readonly svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  private readonly path = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  private readonly cursor = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  private brushPoint: ScreenPoint | null = null;
  private listening = false;
  private resetStroke: (() => void) | null = null;
  /** Part of the panel: selecting faces, sculpting, or changing the mesh. */
  private part: 'select' | 'sculpt' | 'modify' = 'select';

  constructor(ui: UI) {
    this.ui = ui;
    for (const cls of ['brush-outline-back', 'brush-outline']) {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('class', cls);
      this.cursor.append(circle);
    }
    this.cursor.style.display = 'none';
    this.svg.append(this.path, this.cursor);
    this.layer.append(this.svg);
    document.body.append(this.layer);
  }

  start(e: Entity) {
    const ed = this.ui.editor;
    if (e.kind === 'primitive') { this.ui.run(() => this.start(ed.editableModel(e))); return; }
    if (e.optimization) {
      this.ui.run(async () => {
        await ed.prepareGeometryEdit([e]);
        this.ui.toast(tr('The optimized version is now the model, so it can be edited. Undo to go back.'), 'info', undefined, 6000);
        this.start(e);
      });
      return;
    }
    const reason = ed.separator.blocker(e);
    if (reason) return this.ui.toast(reason, 'error');
    // Panels are created before the editor: listen to the canvas on first use
    if (!this.listening) {
      this.listening = true;
      this.setupStrokes();
    }
    ed.select(e);
    ed.separator.start(e);
    this.part = 'select';
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
    if (!on) this.resetStroke?.();
    this.layer.classList.toggle('on', on);
    document.body.classList.toggle('drawing', on);
    this.cameraButtons(on);
    this.layer.classList.toggle('brush', s.tool === 'brush' || s.mode === 'surface');
    if (!this.brushing()) this.cursor.style.display = 'none';
  }

  bar() {
    const ed = this.ui.editor, s = ed.separator;
    const count = s.selection?.count ?? 0;
    const render = () => { this.sync(); this.ui.renderSelbar(); if (this.ui.tab === 'objects') this.ui.renderPanel(); };
    // Move / Rotate / Scale act on the selected faces, like on objects in Object mode
    const tool = (t: 'move' | 'rotate' | 'scale', node: typeof Move3d, label: string) => iconButton(node, t === 'move' ? label : tr('{tool} (tap again for a slider)', { tool: label }), () => this.ui.run(() => {
      // Tapping the active Scale or Rotate again opens or closes its slider bar
      if (s.mode === 'transform' && ed.tool === t && t !== 'move') return this.ui.transformBar.toggle();
      if (s.mode !== 'transform') s.setMode('transform');
      ed.setTool(t); render();
    }), { active: s.mode === 'transform' && ed.tool === t, label, cls: 'tool' });
    this.ui.selbar.classList.add('show');
    const mode = this.ui.modeSwitch();
    this.ui.renderContextParts([
      { id: 'mode', icon: Triangle, label: tr('Object / Mesh'), content: mode ? [mode] : [] },
      { id: 'tools', icon: MousePointer2, label: count ? tr('{n} faces', { n: count.toLocaleString() }) : tr('Choose faces'), content: [
        iconButton(MousePointer2, tr('Select faces'), () => this.ui.run(() => { s.setMode('select'); if (this.part === 'sculpt') this.part = 'select'; render(); }), { active: s.mode === 'select', label: tr('Select'), cls: 'tool' }),
        tool('move', Move3d, tr('Move')), tool('rotate', Rotate3d, tr('Rotate')), tool('scale', Scale3d, tr('Scale')),
      ] },
      { id: 'view', icon: Focus, label: tr('Camera and actions'), content: this.ui.contextCameraControls() },
    ]);
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
    const target = meshes.find(m => sel.faces.get(m)?.size) ?? meshes[0];
    const materials = target?.material instanceof MultiMaterial ? target.material.subMaterials : [target?.material];
    const materialPicker = () => select(tr('New faces material'), materials.map((m, i) => ({ value: String(i), label: m?.name || tr('Material {n}', { n: i + 1 }) })), String(cut ? cut.capMaterial : s.repairMaterial), v => { if (cut) { cut.capMaterial = +v; if (cut.cap) this.ui.run(() => cut.preview()); } else s.repairMaterial = +v; });
    const selectContent = [
      section(
        tr('Select'),
        segmented(tools, s.tool, (id) => this.ui.run(() => { s.setTool(id as SelectTool); if (s.mode !== 'select') s.setMode('select'); this.sync(); this.ui.renderSelbar(); })),
        hint(hints[s.tool]),
        chips([{ value: 'add', label: tr('Add') }, { value: 'remove', label: tr('Remove') }], s.add ? 'add' : 'remove', (v) => s.set({ add: v === 'add' })),
        s.tool === 'smart' ? slider(tr('Tolerance'), s.tolerance * 100, { min: 0, max: 100, step: 1, format: (v) => `${Math.round(v)}%` }, (v) => s.set({ tolerance: v / 100 })) : null,
        s.tool === 'brush' ? this.brushSizeControl() : null,
        s.tool === 'lasso' || s.tool === 'brush' ? toggle(tr('Also hidden faces behind'), s.through, (v) => s.set({ through: v })) : null,
        row(
          button(tr('All'), () => s.edit((x) => x.all())),
          button(tr('None'), () => s.edit((x) => x.clear())),
          button(tr('Invert'), () => s.edit((x) => x.all(true))),
        ),
        row(button(tr('Grow'), () => s.ring(true)), button(tr('Shrink'), () => s.ring(false))),
        hint(tr('Shift+tap adds, Ctrl+tap removes, a tap on empty space clears. Keys: A all, Alt+A none, Ctrl+I invert, Ctrl +/− grow or shrink.')),
      ),
      section(
        tr('Move, rotate and scale faces'),
        hint(tr('Use Move, Rotate and Scale in the bar above: they change only the selected faces.')),
        slider(tr('Soft selection radius'), s.softRadius, { min: 0, max: Math.max(...ed.boundsOf(sel.entity).size.asArray()), step: .01 }, v => s.setSoftRadius(v)),
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
    ];
    const part = s.mode === 'surface' ? 'sculpt' : this.part === 'sculpt' ? 'select' : this.part;
    const tabs = segmented([{ id: 'select', label: tr('Select') }, { id: 'sculpt', label: tr('Sculpt') }, { id: 'modify', label: tr('Modify') }], part, (id) => this.ui.run(() => {
      if (id === 'sculpt') s.setMode('surface');
      else if (s.mode === 'surface') s.setMode('select');
      this.part = id as typeof this.part;
      this.sync(); this.ui.renderSelbar(); this.ui.renderPanel();
    }));
    const done = button(tr('Done'), () => this.cancel());
    if (part === 'select') return [tabs, ...selectContent, done];
    if (part === 'sculpt') return [tabs, section(tr('Surface brushes'),
      chips([{ value: 'off', label: tr('Off') }, { value: 'pull', label: tr('Pull') }, { value: 'inflate', label: tr('Inflate') }, { value: 'smooth', label: tr('Smooth') }, { value: 'flatten', label: tr('Flatten') }], s.surfaceBrush ?? 'off', v => { s.surfaceBrush = v === 'off' ? null : v as NonNullable<typeof s.surfaceBrush>; this.sync(); }),
      this.brushSizeControl(),
      slider(tr('Strength'), s.brushStrength, { min: .01, max: 1, step: .01 }, v => { s.brushStrength = v; }),
      toggle(tr('Only selected region'), s.brushSelected, v => { s.brushSelected = v; }),
      hint(tr('One finger edits; two fingers move the view. Brushes change existing faces.'))), done];
    return [tabs,
      section(
        tr('Cut with a plane'),
        hint(tr('For pieces that touch: place the plane between them. The gold side becomes the new object.')),
        toggle(tr('Cutting plane'), !!cut || s.cutLoading, v => { void this.ui.run(async () => { await s.setCut(v); this.sync(); }); }),
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
        cut?.exact ? toggle(tr('Close cut surfaces'), cut.cap, v => { cut.cap = v; this.ui.run(() => cut.preview()); }) : null,
        cut?.error ? hint(cut.error) : null,
        cut?.cap ? materialPicker() : null,
        cut && sel.count ? toggle(tr('Cut only the selected faces'), cut.limited, (v) => ((cut.limited = v), ed.invalidate())) : null,
      ),
      row(button(tr('Separate'), () => this.separate(), { icon: Scissors, cls: 'primary' })),
      section(tr('Shrinkwrap to a shape'),
        hint(tr('Adds a shape fitted to the selected faces and wraps only these faces onto it, live: shape it freely (Scale X / Y / Z for an oval), then Apply (Shift+A).')),
        chips(QUICK_SHAPES.map((t) => ({ value: t, label: shapeLabel(t) })), '' as PrimitiveType, (t) => this.ui.addShape(t))),
      section(tr('Repair surface'), hint(tr('Select faces next to the opening, then close it.')), materialPicker(), button(tr('Close opening'), () => this.ui.run(() => { const r = s.fillHoles(); this.ui.toast(r.skipped ? tr('{closed} closed; {skipped} curved or irregular openings were left open.', { closed: r.closed, skipped: r.skipped }) : tr('Opening closed')); }), { cls: 'primary' })),
      section(tr('Connect borders'), hint(tr('Select faces beside two openings. Preview the seam before applying.')),
        toggle(tr('Reverse connection'), s.bridgeReverse, v => { s.bridgeReverse = v; s.clearBridge(); }),
        slider(tr('Border offset'), s.bridgeOffset, { min: 0, max: 100, step: 1 }, v => { s.bridgeOffset = v; s.clearBridge(); }),
        row(button(tr('Preview'), () => this.ui.run(() => s.previewBridge())), button(tr('Apply connection'), () => this.ui.run(() => { s.connect(); this.sync(); this.ui.renderPanel(); })), button(tr('Cancel'), () => s.clearBridge()))),
      done];
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

  /** After leaving mesh mode from outside the panel. */
  refresh() { this.after(); }

  private after() {
    this.sync();
    this.ui.segment.objects = 'object';
    this.ui.renderSelbar();
    if (this.ui.tab === 'objects') this.ui.renderPanel();
  }

  /** Lasso and brush are drawing tools: true while one of them should take one-finger / left-button drags. */
  private drawing() {
    const s = this.ui.editor.separator;
    return s.active && !s.cut && (s.mode === 'surface' ? !!s.surfaceBrush : s.mode === 'select' && (s.tool === 'lasso' || s.tool === 'brush'));
  }

  private brushing() {
    const s = this.ui.editor.separator;
    return this.drawing() && (s.mode === 'surface' || s.tool === 'brush');
  }

  /** Both brushes use a radius in CSS pixels; the panel swatch is scaled to fit. */
  private brushSizeControl() {
    const s = this.ui.editor.separator;
    const dot = h('span', { class: 'brush-size-dot' });
    const dimensions = h('span', { class: 'brush-size-dimensions' });
    const update = (radius: number) => {
      dot.style.width = dot.style.height = `${radius * 2 / 5}px`;
      dimensions.textContent = tr('Radius {r} px · Diameter {d} px', { r: Math.round(radius), d: Math.round(radius * 2) });
    };
    update(s.radius);
    return h('div', { class: 'brush-size-control' },
      slider(tr('Brush size'), s.radius, { min: 8, max: 120, step: 1, format: v => `${Math.round(v)} px` }, v => {
        s.radius = v;
        update(v);
        const rect = this.ui.editor.engine.getRenderingCanvas()!.getBoundingClientRect();
        this.previewBrush(this.brushPoint ?? { x: rect.width / 2, y: rect.height / 2 });
      }),
      h('div', { class: 'brush-size-preview' }, h('span', { class: 'brush-size-swatch', 'aria-hidden': 'true' }, dot), dimensions));
  }

  private previewBrush(point: ScreenPoint) {
    this.brushPoint = point;
    if (!this.brushing()) return;
    const rect = this.ui.editor.engine.getRenderingCanvas()!.getBoundingClientRect();
    this.cursor.setAttribute('transform', `translate(${point.x + rect.left} ${point.y + rect.top})`);
    for (const circle of this.cursor.children) circle.setAttribute('r', String(this.ui.editor.separator.radius));
    this.cursor.style.display = '';
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
    const sculpting = () => this.ui.editor.separator.mode === 'surface';
    const draw = () => {
      const s = this.ui.editor.separator;
      // Brushes show their effect on the model itself: no stroke line
      const points = sculpting() ? [] : stroke?.points ?? [];
      this.path.setAttribute('points', points.map((p) => `${p.x},${p.y}`).join(' ') + (s.mode === 'select' && s.tool === 'lasso' && points.length ? ` ${points[0].x},${points[0].y}` : ''));
      this.path.style.strokeWidth = (s.tool === 'brush' || s.mode === 'surface') ? `${s.radius * 2}px` : '';
    };
    this.resetStroke = () => {
      const pointer = stroke?.id;
      stroke = null;
      passed.clear();
      if (pointer !== undefined && canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
      draw();
    };
    const swallow = (ev: Event) => {
      ev.stopImmediatePropagation();
      ev.preventDefault();
    };
    canvas.addEventListener('pointerdown', (ev) => {
      if (replayed.has(ev)) return;
      if (!this.drawing()) return;
      // Mouse: only the left button draws (others turn or pan the view)
      if (ev.pointerType === 'mouse' && ev.button !== 0) { this.cursor.style.display = 'none'; return; }
      if (stroke) {
        // Second finger: this is a camera gesture, not a stroke (a brush keeps what it did so far)
        if (sculpting()) this.ui.run(() => this.ui.editor.separator.brushUp());
        const first = stroke.first;
        this.cursor.style.display = 'none';
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
      const start = local(ev);
      this.previewBrush(start);
      // A brush only starts on the model; elsewhere one finger turns the view as usual
      if (sculpting()) {
        let onModel = false;
        this.ui.run(() => { onModel = this.ui.editor.separator.brushDown(start.x, start.y); });
        if (!onModel) return;
      }
      swallow(ev);
      stroke = { id: ev.pointerId, points: [start], first: ev };
      canvas.setPointerCapture?.(ev.pointerId);
      draw();
    }, true);
    canvas.addEventListener('pointerleave', () => { this.cursor.style.display = 'none'; });
    canvas.addEventListener('pointermove', (ev) => {
      if (!passed.size && (stroke?.id === ev.pointerId || (ev.pointerType === 'mouse' && ev.buttons === 0))) this.previewBrush(local(ev));
      if (!stroke || ev.pointerId !== stroke.id) return;
      swallow(ev);
      const p = local(ev), last = stroke.points[stroke.points.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) < 3) return;
      stroke.points.push(p);
      if (sculpting()) this.ui.run(() => this.ui.editor.separator.brushMove(p.x, p.y));
      draw();
    }, true);
    const end = (ev: PointerEvent) => {
      passed.delete(ev.pointerId);
      if (ev.pointerType !== 'mouse' || ev.type === 'pointercancel') this.cursor.style.display = 'none';
      if (!stroke || ev.pointerId !== stroke.id) return;
      swallow(ev);
      const points = stroke.points;
      stroke = null;
      draw();
      if (sculpting()) this.ui.run(() => this.ui.editor.separator.brushUp());
      else if (ev.type === 'pointerup') this.ui.run(() => this.ui.editor.separator.stroke(points));
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
