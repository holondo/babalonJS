import { Magnet, SquaresIntersect, SquaresSubtract, SquaresUnite } from 'lucide';
import { tr } from '../../core/i18n';
import type { PrimitiveType } from '../../core/editor';
import { button, chips, h, hint, progressBar, row, section, slider, toggle } from '../dom';
import type { UI } from '../ui';

import { QUICK_SHAPES, shapeLabel } from '../quickShapes';

/** Objects → Modify: quick shapes and operations between the selected objects. */
export class ModifyPanel {
  private readonly ui: UI;
  constructor(ui: UI) { this.ui = ui; }

  /**
   * The operation in progress (Boolean preview or live Shrinkwrap): pinned at the top of the
   * Objects panel whatever is selected, so the tool can be selected and shaped on its own.
   */
  operation(): HTMLElement | null {
    const ed = this.ui.editor, fusion = ed.fusion, wrap = ed.wrap;
    const render = () => this.ui.renderPanel();
    if (fusion.busy || fusion.preview) {
      return section(tr('Boolean'),
        fusion.busy ? progressBar(null, tr('Building the new surface…')) : hint(tr('Review the result. Texture mapping along the new edges may change. Originals are kept until Apply.')),
        row(fusion.preview ? button(tr('Apply'), () => { fusion.apply(); render(); }, { cls: 'primary' }) : null, button(tr('Cancel'), () => { fusion.cancel(); render(); })));
    }
    if (wrap.active) {
      const modes = [{ value: 'outside' as const, label: tr('Outside') }, { value: 'inside' as const, label: tr('Inside') }, { value: 'surface' as const, label: tr('On surface') }];
      const explain = { outside: tr('Outside: parts inside the tool move out to its surface (fills grooves).'), inside: tr('Inside: parts sticking out move in to the tool (flattens bumps).'), surface: tr('On surface: the surface near the tool snaps onto it.') };
      const faces = ed.separator.lastFaces;
      return section(tr('Shrinkwrap'),
        h('p', { class: 'stats' }, tr('{target} onto {tool}', { target: wrap.target!.name, tool: wrap.tools.map((t) => t.name).join(', ') })),
        hint(tr('Select the tool alone and shape it freely (Scale X / Y / Z for an oval): the target follows live. This card stays until Apply or Cancel.')),
        chips(modes, wrap.mode, (v) => { wrap.mode = v; wrap.changed(); render(); }),
        hint(explain[wrap.mode]),
        slider(tr('Strength'), wrap.strength, { min: .05, max: 1, step: .01, format: (v) => `${Math.round(v * 100)}%` }, (v) => { wrap.strength = v; wrap.changed(); }),
        faces && faces.entity === wrap.target ? toggle(tr('Only the faces selected in Mesh mode'), !!wrap.limit, (v) => { wrap.limit = v ? faces.masks : null; wrap.changed(); }) : null,
        slider(tr('Falloff'), wrap.falloff, { min: 0, max: 1, step: .01, format: (v) => `${Math.round(v * 100)}%` }, (v) => { wrap.falloff = v; wrap.changed(); }),
        row(button(tr('Apply'), () => { const n = wrap.apply(); this.ui.toast(n ? tr('Surface wrapped onto the tool.') : tr('Nothing changed: move the tool over the surface.')); render(); }, { cls: 'primary' }),
          button(tr('Cancel'), () => { wrap.cancel(); render(); })));
    }
    return null;
  }

  /**
   * Operations between objects, like Figma's boolean groups and Blender's Shrinkwrap: the first
   * selected object is the target, the others are tools, moved and sized with the usual gizmo.
   */
  panel(): (Node | null)[] {
    const ed = this.ui.editor, fusion = ed.fusion, wrap = ed.wrap;
    const operation = this.operation();
    if (operation) return [operation];
    const render = () => this.ui.renderPanel();
    const items = ed.selection.filter((e) => e.kind !== 'light');
    const title = tr('Boolean & shrinkwrap');
    const quick = section(tr('Quick shapes'),
      hint(items.length ? tr('Added on the selected object, both selected (Shift+A).') : tr('Added in view (Shift+A).')),
      chips(QUICK_SHAPES.map((t) => ({ value: t, label: shapeLabel(t) })), '' as PrimitiveType, (t) => this.ui.addShape(t)));
    if (items.length < 2) return [quick, this.ui.multiSelectHint(title, tr('Select the target first, then one or more tools (multi-select button or Shift+click). Any object can be a tool: add a quick shape, or use another model.'))];
    const boolean = (operation: 'union' | 'subtract' | 'intersect') => this.ui.run(async () => { await this.ui.freezeForEdit(); const run = fusion.start(items, operation); render(); await run; render(); });
    return [quick, section(title,
      h('p', { class: 'stats' }, tr('Target: {name} · Tools: {tools}', { name: items[0].name, tools: items.slice(1).map((e) => e.name).join(', ') })),
      h('h4', {}, tr('Boolean')),
      row(
        button(tr('Union'), () => boolean('union'), { icon: SquaresUnite, cls: 'small' }),
        button(tr('Subtract'), () => boolean('subtract'), { icon: SquaresSubtract, cls: 'small' }),
        button(tr('Intersect'), () => boolean('intersect'), { icon: SquaresIntersect, cls: 'small' }),
      ),
      hint(tr("Makes one new object from closed surfaces. Rigged or animated models can't be used.")),
      h('h4', {}, tr('Shrinkwrap')),
      button(tr('Shrinkwrap target onto tools'), () => this.ui.run(async () => {
        await this.ui.freezeForEdit();
        const faces = ed.separator.lastFaces;
        wrap.start(items, faces?.entity === items[0] ? faces.masks : null);
        render();
      }), { icon: Magnet, cls: 'small' }),
      hint(tr("Moves the target's own surface where it touches the tools. Texture, UVs and rig are kept.")),
      h('h4', {}, tr('Join')),
      row(
        button(tr('Combine'), () => this.ui.run(async () => { await this.ui.freezeForEdit(); ed.combine(); }), { cls: 'small' }),
        button(tr('Group'), () => this.ui.run(() => { ed.groupObjects(); }), { cls: 'small' }),
      ),
    )];
  }
}
