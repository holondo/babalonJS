import {
  ArrowDownToLine,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  Ruler,
  Eye,
  EyeOff,
  Spline,
  Trash2,
} from 'lucide';
import type { IconNode } from 'lucide';
import { tr } from '../../core/i18n';
import { button, chips, h, hint, icon, iconButton, numberInput, row, section, toggle } from '../dom';
import { UNITS } from '../../tools/tools';
import type { Axis, Edge, Guide, Measurement, Unit } from '../../tools/tools';
import type { UI } from '../ui';

/** Tools panel: measurements, guides and alignment. */
export class ToolsPanel {
  private readonly ui: UI;

  constructor(ui: UI) {
    this.ui = ui;
  }

  toolsPanel() {
    const ed = this.ui.editor;
    const tools = ed.tools;
    const q = (fn: () => void) => this.ui.quiet(fn);
    const units = (Object.keys(UNITS) as Unit[]).map((u) => ({ value: u, label: u }));
    const out: (Node | null)[] = [
      section(
        tr('Measure'),
        toggle(tr('Lines and points'), tools.measurementDisplay.lines, (v) => tools.setMeasurementDisplay('lines', v)),
        toggle(tr('Distances'), tools.measurementDisplay.distances, (v) => tools.setMeasurementDisplay('distances', v)),
        toggle(tr('Angles'), tools.measurementDisplay.angles, (v) => tools.setMeasurementDisplay('angles', v)),
        button(tools.measurementsVisible ? tr('Hide all measurements') : tr('Restore measurement visibility'),
          () => tools.setMeasurementsVisible(!tools.measurementsVisible), { icon: tools.measurementsVisible ? EyeOff : Eye, cls: 'small ghost' }),
        !tools.measurementsVisible ? hint(tr('All measurements are hidden. Restore visibility to apply your choices.')) : null,
        button(tools.measureMode ? tr('Stop measuring') : tr('Measure distance'), () => tools.setMeasureMode(!tools.measureMode), {
          icon: Ruler,
          cls: `wide ${tools.measureMode ? 'primary' : ''}`,
        }),
        hint(tr('Tap two points: on a model they stick to its surface, elsewhere they land on the floor. Drag the points to adjust.')),
        hint(tr('Tap an existing endpoint to reuse it. Angles appear automatically at shared endpoints, following the paths locally.')),
        toggle(tr('Follow the surface'), tools.surfaceDefault, (v) => tools.edit(() => (tools.surfaceDefault = v))),
        toggle(tr('Snap to vertices'), tools.snapVertices, (v) => tools.edit(() => (tools.snapVertices = v))),
        chips(units, tools.unit, (v) => tools.setUnit(v)),
        tools.measurements.length
          ? h('ul', { class: 'outliner' }, ...tools.measurements.map((m, i) => this.measurementRow(m, i)))
          : null,
        tools.measurements.length ? row(button(tr('Clear measurements'), () => tools.clearMeasurements(), { icon: Trash2, cls: 'small ghost' })) : null,
        tools.measurements.length ? hint(tr('Each eye controls one item. Hiding a measurement keeps its angles visible. Global switches preserve individual choices.')) : null,
        ...this.angleRows(),
      ),
      section(
        tr('Guides'),
        toggle(tr('Smart guides (snap while moving)'), tools.smartGuides, (v) => q(() => tools.setSmartGuides(v))),
        row(
          button(tr('Height'), () => tools.addGuide('y'), { icon: AlignVerticalDistributeCenter, cls: 'small' }),
          button('X', () => tools.addGuide('x'), { icon: AlignHorizontalDistributeCenter, cls: 'small' }),
          button('Z', () => tools.addGuide('z'), { icon: AlignHorizontalDistributeCenter, cls: 'small' }),
        ),
        tools.guides.length ? null : hint(tr('Guides are planes you can align objects to. With an object selected, a new guide starts at its top (height) or center (X/Z).')),
        ...tools.guides.map((g) => this.guideRow(g)),
      ),
      this.alignSection(),
    ];
    return out;
  }

  measurementRow(m: Measurement, i: number) {
    const tools = this.ui.editor.tools;
    const row = h(
      'li',
      { class: m === tools.active ? 'active' : '', onClick: () => tools.setActive(m) },
      icon(m.path ? Spline : Ruler, 16),
      h('span', {}, `${i + 1}. ${tools.format(m.length)}${m.surfaceFailed ? ' · ' + tr('straight') : ''}`),
      iconButton(m.visible ? Eye : EyeOff, tr(m.visible ? 'Hide measurement {number}' : 'Show measurement {number}', { number: i + 1 }),
        () => tools.setMeasurementVisible(m, !m.visible), { cls: 'mini', active: m.visible }),
      iconButton(Spline, tr('Follow the surface'), () => tools.setSurface(m, !m.surface), { cls: 'mini', active: m.surface }),
      iconButton(Trash2, tr('Delete'), () => tools.removeMeasurement(m), { cls: 'mini' }),
    );
    row.querySelectorAll('.mini').forEach((b) => b.addEventListener('click', (ev) => ev.stopPropagation()));
    return row;
  }

  private angleRows() {
    const tools = this.ui.editor.tools;
    const angles = tools.measurementAngles();
    if (!angles.length) return [];
    return [h('h3', {}, tr('Angles')), h('ul', { class: 'outliner' }, ...angles.map(angle => {
      const name = tr('Between {first} and {second}', {
        first: tools.measurements.indexOf(angle.first) + 1,
        second: tools.measurements.indexOf(angle.second) + 1,
      });
      const visible = !tools.hiddenAngles.has(angle.key);
      return h('li', {}, h('span', {}, `${name} · ${angle.degrees.toFixed(1)}°`),
        iconButton(visible ? Eye : EyeOff, tr(visible ? 'Hide angle: {name}' : 'Show angle: {name}', { name }),
          () => tools.setAngleVisible(angle.key, !visible), { cls: 'mini', active: visible }));
    }))];
  }

  guideRow(g: Guide) {
    const ed = this.ui.editor;
    const tools = ed.tools;
    const name = g.axis === 'y' ? tr('Height') : g.axis.toUpperCase();
    const sel = ed.selected && ed.selected.kind !== 'light';
    const edge = (label: string, e: Edge) => button(label, () => tools.guideToSelection(g, e), { cls: 'small' });
    return h(
      'div',
      { class: 'guide' },
      h(
        'div',
        { class: 'guide-head' },
        numberInput(tr('Guide {name}', { name }), tools.toUnit(g.value), { suffix: tools.unit }, (v) => {
          tools.edit(() => tools.setGuideValue(g, tools.fromUnit(v)));
          tools.changed.notifyObservers();
        }),
        iconButton(Trash2, tr('Delete'), () => tools.removeGuide(g), { cls: 'mini' }),
      ),
      sel
        ? row(
            edge(g.axis === 'y' ? tr('Bottom') : tr('Min'), 'min'),
            edge(tr('Center'), 'center'),
            edge(g.axis === 'y' ? tr('Top') : tr('Max'), 'max'),
          )
        : null,
    );
  }

  alignSection() {
    const ed = this.ui.editor;
    const tools = ed.tools;
    const items = ed.selection.filter((e) => e.kind !== 'light');
    if (items.length < 2) return this.ui.multiSelectHint(tr('Align & match'), tr('Select 2 or more objects (multi-select button or Shift+click). The first one selected is the reference.'));
    const a = (node: IconNode, label: string, axis: Axis, edge: Edge) => iconButton(node, label, () => tools.align(axis, edge), { cls: 'boxed' });
    return section(
      tr('Align & match'),
      h('p', { class: 'stats' }, tr('Reference: {name}', { name: items[0].name })),
      h('div', { class: 'align-grid' },
        h('span', {}, 'X'),
        a(AlignStartVertical, tr('Align left'), 'x', 'min'),
        a(AlignCenterVertical, tr('Align centers'), 'x', 'center'),
        a(AlignEndVertical, tr('Align right'), 'x', 'max'),
        h('span', {}, tr('Height')),
        a(AlignEndHorizontal, tr('Align bottoms'), 'y', 'min'),
        a(AlignCenterHorizontal, tr('Align middles'), 'y', 'center'),
        a(AlignStartHorizontal, tr('Align tops'), 'y', 'max'),
        h('span', {}, 'Z'),
        a(AlignStartVertical, tr('Align backs'), 'z', 'min'),
        a(AlignCenterVertical, tr('Align centers'), 'z', 'center'),
        a(AlignEndVertical, tr('Align fronts'), 'z', 'max'),
      ),
      h('h4', {}, tr('Match the reference')),
      row(
        button(tr('Height'), () => tools.matchSize('y'), { cls: 'small' }),
        button(tr('Width'), () => tools.matchSize('x'), { cls: 'small' }),
        button(tr('Depth'), () => tools.matchSize('z'), { cls: 'small' }),
        button(tr('Scale'), () => tools.matchScale(), { cls: 'small' }),
      ),
      row(
        button(tr('Stack on top'), () => tools.stackOnTop(), { icon: AlignEndHorizontal, cls: 'small' }),
        button(tr('Drop to floor'), () => tools.dropToFloor(), { icon: ArrowDownToLine, cls: 'small' }),
      ),
      items.length >= 3
        ? row(
            button(tr('Distribute X'), () => tools.distribute('x'), { icon: AlignHorizontalDistributeCenter, cls: 'small' }),
            button(tr('Distribute Z'), () => tools.distribute('z'), { icon: AlignHorizontalDistributeCenter, cls: 'small' }),
          )
        : null,
    );
  }
}
