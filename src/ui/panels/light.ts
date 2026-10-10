import { Crosshair, Lightbulb, Sun, Trash2 } from 'lucide';
import { Color3, StandardMaterial } from '@babylonjs/core';
import type { SpotLight, PointLight } from '@babylonjs/core';
import { ENV_PRESETS } from '../../core/editor';
import type { Entity, GroundMode } from '../../core/editor';
import { LIGHT_PRESETS } from '../../core/presets';
import { tr } from '../../core/i18n';
import { button, chips, colorInput, h, hint, icon, row, section, select, slider, toggle } from '../dom';
import type { UI } from '../ui';
import { deg, rad } from '../shared';

/** Light panel: lights and environment. */
export class LightPanel {
  private readonly ui: UI;

  constructor(ui: UI) {
    this.ui = ui;
  }

  lightsPanel() {
    const ed = this.ui.editor;
    const lights = ed.entities.filter((e) => e.kind === 'light');
    const out: (Node | null)[] = [
      section(
        tr('Lighting presets'),
        h('div', { class: 'chips' }, ...LIGHT_PRESETS.map((p) => h('button', { class: 'chip', onClick: () => ed.applyLightPreset(p.id) }, tr(p.label)))),
        hint(tr('Replaces the current lights. Everything can be tweaked afterwards.')),
      ),
      section(
        tr('Add light'),
        row(
          button(tr('Point'), () => ed.addLight('point'), { icon: Lightbulb, cls: 'small' }),
          button(tr('Spotlight'), () => ed.addLight('spot'), { icon: Crosshair, cls: 'small' }),
          button(tr('Sun'), () => ed.addLight('directional'), { icon: Sun, cls: 'small' }),
        ),
      ),
      section(
        tr('Lights in scene'),
        lights.length
          ? h(
              'ul',
              { class: 'outliner' },
              ...lights.map((l) =>
                h('li', { class: l === ed.selected ? 'active' : '', onClick: () => ed.select(l) }, icon(Lightbulb, 16), h('span', {}, l.name), h('i', { class: 'swatch', style: `background:${l.light!.diffuse.toHexString()}` })),
              ),
            )
          : hint(tr('No lights — only the environment lights the scene.')),
      ),
    ];
    const sel = ed.selected;
    if (sel?.kind === 'light') out.push(this.lightControls(sel));
    else if (lights.length) out.push(hint(tr('Tap a light (in the list or in the scene) to adjust it. Drag it or use the gizmos to place it.')));
    return out;
  }

  lightControls(e: Entity) {
    const ed = this.ui.editor;
    const light = e.light!;
    const max = e.lightType === 'directional' ? 10 : 300;
    const targets = ed.entities.filter((x) => x.kind !== 'light');
    let aimId = '';
    return section(
      tr('Selected light'),
      colorInput(tr('Color'), light.diffuse.toHexString(), (v) => {
        const c = Color3.FromHexString(v);
        light.diffuse = c;
        light.specular = c;
        e.root.getChildMeshes().forEach((m) => ((m.material as StandardMaterial).emissiveColor = c));
        if (this.ui.tab === 'light') this.ui.root.querySelector<HTMLElement>('.outliner li.active .swatch')?.style.setProperty('background', v);
      }),
      slider(tr('Intensity'), light.intensity, { min: 0, max, step: max / 300 }, (v) => (light.intensity = v)),
      e.lightType === 'spot'
        ? slider(tr('Cone angle'), deg((light as SpotLight).angle), { min: 5, max: 160, step: 1, format: (v) => `${Math.round(v)}°` }, (v) => ((light as SpotLight).angle = rad(v)))
        : null,
      e.lightType === 'spot'
        ? slider(tr('Edge softness'), (light as SpotLight).exponent, { min: 0, max: 50, step: 0.5 }, (v) => ((light as SpotLight).exponent = v))
        : null,
      e.lightType !== 'directional'
        ? slider(tr('Range'), Math.min((light as PointLight).range, 100), { min: 0.5, max: 100, step: 0.5 }, (v) => ((light as PointLight).range = v))
        : null,
      toggle(tr('Casts shadows'), !!e.shadowGen, (v) => ed.setLightShadows(e, v)),
      select(tr('Aim at'), [{ value: '', label: tr('Camera center') }, ...targets.map((t) => ({ value: String(t.id), label: t.name }))], '', (v) => (aimId = v)),
      row(
        button(tr('Aim'), () => ed.aimLightAtSelection(e, targets.find((t) => String(t.id) === aimId) ?? null), { icon: Crosshair, cls: 'small' }),
        button(tr('Delete light'), () => ed.remove(e), { icon: Trash2, cls: 'small danger' }),
      ),
    );
  }

  envPanel() {
    const ed = this.ui.editor;
    const env = ed.env;
    const set = (p: Partial<typeof env>) => this.ui.quiet(() => ed.applyEnv(p));
    return [
      section(
        tr('Environment lighting (HDR)'),
        chips(Object.entries(ENV_PRESETS).map(([value, p]) => ({ value, label: tr(p.label) })), env.preset, (v) => ed.applyEnv({ preset: v })),
        slider(tr('Intensity'), env.intensity, { min: 0, max: 3, step: 0.01 }, (v) => set({ intensity: v })),
        slider(tr('Rotation'), deg(env.rotation), { min: 0, max: 360, step: 1, format: (v) => `${Math.round(v)}°` }, (v) => set({ rotation: rad(v) })),
        slider(tr('Extra ambient light'), env.ambient, { min: 0, max: 2, step: 0.01 }, (v) => set({ ambient: v })),
      ),
      section(
        tr('Background'),
        toggle(tr('Show environment as background'), env.skybox, (v) => set({ skybox: v })),
        slider(tr('Background blur'), env.skyboxBlur, { min: 0, max: 1, step: 0.01 }, (v) => set({ skyboxBlur: v })),
        colorInput(tr('Solid color (no environment)'), env.background, (v) => set({ background: v })),
      ),
      section(
        tr('Floor'),
        chips<GroundMode>(
          [
            { value: 'shadow', label: tr('Shadow only') },
            { value: 'solid', label: tr('Solid') },
            { value: 'none', label: tr('None') },
          ],
          env.ground,
          (v) => ed.applyEnv({ ground: v }),
        ),
        env.ground === 'solid' ? colorInput(tr('Floor color'), env.groundColor, (v) => set({ groundColor: v })) : null,
        toggle(tr('Reference grid'), env.grid, (v) => set({ grid: v })),
      ),
    ];
  }
}
