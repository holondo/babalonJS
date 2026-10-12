import { ArrowDownToLine, Eye, EyeOff, FlipHorizontal2, RotateCcw, Trash2 } from 'lucide';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Entity } from '../../core/editor';
import { locale, tr } from '../../core/i18n';
import { button, h, hint, icon, iconButton, numberInput, row, section, slider, toggle } from '../dom';
import type { Axis } from '../../tools/tools';
import type { UI } from '../ui';
import { KIND_ICON, deg, rad } from '../shared';

/** Objects → Object: the scene list, transform and object settings. */
export class ObjectsPanel {
  private readonly ui: UI;

  constructor(ui: UI) {
    this.ui = ui;
  }

  scenePanel() {
    const ed = this.ui.editor;
    const list = h(
      'ul',
      { class: 'outliner' },
      ...ed.entities.map((e) =>
        h(
          'li',
          { class: e === ed.selected ? 'active' : '', onClick: () => ed.select(e) },
          icon(KIND_ICON[e.kind], 16),
          h('span', {}, e.name),
          iconButton(e.visible ? Eye : EyeOff, e.visible ? tr('Hide') : tr('Show'), () => ed.setVisible(e, !e.visible), { cls: 'mini' }),
        ),
      ),
    );
    list.querySelectorAll('.mini').forEach((b) => b.addEventListener('click', (ev) => ev.stopPropagation()));
    const out: (Node | null)[] = [
      section(tr('Objects in scene'), ed.entities.length ? list : hint(tr('The scene is empty.')), row(button(tr('Clear scene'), () => confirm(tr('Remove everything from the scene?')) && ed.clearScene(), { icon: Trash2, cls: 'ghost' }))),
    ];
    const e = ed.selected;
    if (!e) {
      out.push(hint(tr('Tap an object in the scene to select it. Double-tap to focus.')));
      return out;
    }
    out.push(this.transformSection(e));
    if (e.kind === 'light') out.push(this.ui.lightUI.lightControls(e));
    else out.push(this.objectSection(e));
    return out;
  }

  transformSection(e: Entity) {
    const ed = this.ui.editor;
    const commit = () => this.ui.quiet(() => ed.endTransform());
    const nameInput = h('input', { type: 'text', value: e.name, class: 'name' });
    nameInput.addEventListener('change', () => ed.rename(e, nameInput.value.trim()));
    const euler = ed.getEuler(e);
    const rot = { x: deg(euler.x), y: deg(euler.y), z: deg(euler.z) };
    const setRot = () => ed.editTransform((r) => r.rotationQuaternion!.copyFrom(Quaternion.FromEulerAngles(rad(rot.x), rad(rot.y), rad(rot.z))));
    const angle = { min: -180, max: 180, step: 1, format: (v: number) => `${Math.round(v)}°`, onCommit: commit };
    const turn = (axis: 'x' | 'y' | 'z') => () =>
      ed.editTransform((r) => {
        const axes = { x: Vector3.Right(), y: Vector3.Up(), z: Vector3.Forward() };
        r.rotationQuaternion = Quaternion.RotationAxis(axes[axis], Math.PI / 2).multiply(r.rotationQuaternion!);
      }, true);
    const p = e.root.position;
    return section(
      tr('Transform'),
      nameInput,
      slider(tr('Position X'), p.x, { min: -20, max: 20, step: 0.01, onCommit: commit }, (v) => ed.editTransform((r) => (r.position.x = v))),
      slider(tr('Height'), p.y, { min: -5, max: 20, step: 0.01, onCommit: commit }, (v) => ed.editTransform((r) => (r.position.y = v))),
      slider(tr('Position Z'), p.z, { min: -20, max: 20, step: 0.01, onCommit: commit }, (v) => ed.editTransform((r) => (r.position.z = v))),
      slider(tr('Turn (Y)'), rot.y, angle, (v) => ((rot.y = v), setRot())),
      slider(tr('Tilt (X)'), rot.x, angle, (v) => ((rot.x = v), setRot())),
      slider(tr('Roll (Z)'), rot.z, angle, (v) => ((rot.z = v), setRot())),
      e.kind !== 'light'
        ? slider(
            tr('Scale'),
            Math.abs(e.root.scaling.x),
            {
              min: -2,
              max: 1.3,
              step: 0.005,
              toSlider: (v) => Math.log10(Math.max(v, 0.01)),
              fromSlider: (v) => Math.pow(10, v),
              format: (v) => `${v.toFixed(2)}×`,
              onCommit: commit,
            },
            // Magnitude only: a mirrored axis stays mirrored
            (v) => ed.editTransform((r) => r.scaling.scaleInPlace(v / (Math.abs(r.scaling.x) || 1))),
          )
        : null,
      row(
        button('90° X', turn('x'), { cls: 'small' }),
        button('90° Y', turn('y'), { cls: 'small' }),
        button('90° Z', turn('z'), { cls: 'small' }),
      ),
      row(
        e.kind !== 'light' ? button(tr('Drop to floor'), () => ed.dropToGround(), { icon: ArrowDownToLine, cls: 'small' }) : null,
        button(tr('Reset'), () => ed.resetTransform(), { icon: RotateCcw, cls: 'small' }),
      ),
      e.kind !== 'light' ? this.sizeFields(e) : null,
    );
  }

  /** Changing one size scales the whole object (default) or only that axis. */
  private proportional = true;

  /**
   * Width/height/depth in the chosen unit, along the object's own axes. Proportional by default;
   * a negative value mirrors that axis. Mirror buttons flip the object in place.
   */
  sizeFields(e: Entity) {
    const ed = this.ui.editor;
    const tools = ed.tools;
    const size = ed.objectSize(e);
    const field = (axis: Axis, label: string) =>
      numberInput(label, tools.toUnit(size[axis]), { suffix: tools.unit }, (v) => ed.setDimension(e, axis, tools.fromUnit(v), this.proportional));
    const mirrored = (axis: Axis) => e.root.scaling[axis] < 0;
    return h('div', { class: 'size-fields' },
      h('div', { class: 'dims' }, field('x', tr('Width')), field('y', tr('Height')), field('z', tr('Depth'))),
      toggle(tr('Keep proportions'), this.proportional, (v) => (this.proportional = v)),
      h('div', { class: 'mirror-row' },
        h('span', {}, tr('Mirror')),
        ...(['x', 'y', 'z'] as Axis[]).map((axis) =>
          button(axis.toUpperCase(), () => ed.mirror(axis, [e]), { icon: FlipHorizontal2, cls: `small${mirrored(axis) ? ' active' : ''}` }))),
    );
  }

  objectSection(e: Entity) {
    const ed = this.ui.editor;
    const s = ed.stats(e);
    const nodes: (Node | null)[] = [
      toggle(tr('Casts shadow'), e.castShadows, (v) => ed.setCastShadows(e, v)),
      toggle(tr('Wireframe'), ed.materialsOf(e).some((m) => m.wireframe), (v) => ed.setWireframe(e, v)),
      h('p', { class: 'stats' }, tr('{vertices} vertices · {faces} faces · {materials} materials', { vertices: s.vertices.toLocaleString(locale()), faces: s.faces.toLocaleString(locale()), materials: s.materials })),
    ];
    return section(tr('Object'), ...nodes);
  }
}
