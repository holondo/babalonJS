import { MATERIAL_PRESETS } from '../../core/presets';
import { editControls } from '../editControls';
import { materialToJSON, applyMaterial } from '../../core/state';
import { Color3, Material, PBRMaterial, StandardMaterial } from '@babylonjs/core';
import { tr } from '../../core/i18n';
import { h, hint, section, select } from '../dom';
import type { UI } from '../ui';

/** Objects → Material: Sketchfab-style material editing. */
export class MaterialPanel {
  private readonly ui: UI;

  constructor(ui: UI) {
    this.ui = ui;
  }

  materialIndex = 0;

  materialPanel() {
    const ed = this.ui.editor;
    const e = ed.selected;
    if (!e || e.kind === 'light') return [hint(tr('Select a model or shape to edit its materials.'))];
    const mats = ed.materialsOf(e);
    if (!mats.length) return [hint(tr('This object has no editable materials.'))];
    if (this.materialIndex >= mats.length) this.materialIndex = 0;
    const mat = mats[this.materialIndex];
    const out: (Node | null)[] = [];
    if (mats.length > 1) {
      out.push(
        select(tr('Material'), mats.map((m, i) => ({ value: String(i), label: m.name || tr('Material {n}', { n: i + 1 }) })), String(this.materialIndex), (v) => {
          this.materialIndex = +v;
          this.ui.renderPanel();
        }),
      );
    }
    out.push(...this.materialControls(mat));
    return out;
  }

  materialControls(mat: Material): (Node | null)[] {
    const { slider, colorInput, toggle, chips } = editControls(this.ui, () => materialToJSON(mat), (s) => applyMaterial(mat, s));
    const q = (fn: () => void) => this.ui.quiet(fn);
    const common = [
      slider(tr('Opacity'), mat.alpha, { min: 0, max: 1, step: 0.01 }, (v) => {
        mat.alpha = v;
        if (v < 1) mat.transparencyMode = Material.MATERIAL_ALPHABLEND;
      }),
      toggle(tr('Double-sided'), !mat.backFaceCulling, (v) => (mat.backFaceCulling = !v)),
      toggle(tr('Wireframe'), mat.wireframe, (v) => (mat.wireframe = v)),
    ];
    if (mat instanceof PBRMaterial) {
      const meta = (mat.metadata ??= {});
      const hasTex = !!(mat.albedoTexture || meta.stashedAlbedo);
      return [
        section(tr('Material presets'), chips(MATERIAL_PRESETS.map((p) => ({ value: p.id, label: tr(p.label) })), '', (id) => {
          const preset = MATERIAL_PRESETS.find((p) => p.id === id)!;
          const state = materialToJSON(mat);
          applyMaterial(mat, { ...state, alpha: 1, transparencyMode: null, clearCoat: false, clearCoatIntensity: 1, unlit: false, ...preset.values,
            advanced: { ...state.advanced!, refraction: false, sheen: false, iridescence: false, anisotropy: false, linkTransparency: false, ...preset.advanced } });
        })),
        h('details', { class: 'sec' }, h('summary', {}, tr('Advanced material')),
          toggle(tr('Refraction'), mat.subSurface.isRefractionEnabled, (v) => { mat.subSurface.isRefractionEnabled = v; }),
          slider(tr('Transmission'), mat.subSurface.refractionIntensity, { min: 0, max: 1, step: .01 }, (v) => { mat.subSurface.refractionIntensity = v; }),
          slider(tr('Index of refraction'), mat.subSurface.indexOfRefraction, { min: 1, max: 2.5, step: .01 }, (v) => { mat.subSurface.indexOfRefraction = v; }),
          toggle(tr('Sheen'), mat.sheen.isEnabled, (v) => { mat.sheen.isEnabled = v; }),
          slider(tr('Sheen intensity'), mat.sheen.intensity, { min: 0, max: 1, step: .01 }, (v) => { mat.sheen.intensity = v; }),
          colorInput(tr('Sheen color'), mat.sheen.color.toHexString(), (v) => { mat.sheen.color = Color3.FromHexString(v); }),
          toggle(tr('Iridescence'), mat.iridescence.isEnabled, (v) => { mat.iridescence.isEnabled = v; }),
          slider(tr('Iridescence intensity'), mat.iridescence.intensity, { min: 0, max: 1, step: .01 }, (v) => { mat.iridescence.intensity = v; }),
          slider(tr('Film thickness (nm)'), mat.iridescence.maximumThickness, { min: 100, max: 1000, step: 1 }, (v) => { mat.iridescence.maximumThickness = v; mat.iridescence.minimumThickness = Math.min(mat.iridescence.minimumThickness, v); }),
          toggle(tr('Anisotropy'), mat.anisotropy.isEnabled, (v) => { mat.anisotropy.isEnabled = v; }),
          slider(tr('Anisotropy intensity'), mat.anisotropy.intensity, { min: 0, max: 1, step: .01 }, (v) => { mat.anisotropy.intensity = v; }),
        ),
        section(
          tr('Color'),
          colorInput(hasTex ? tr('Tint (multiplies texture)') : tr('Base color'), mat.albedoColor.toHexString(), (v) => q(() => (mat.albedoColor = Color3.FromHexString(v)))),
          hasTex
            ? toggle(tr('Show texture'), !!mat.albedoTexture, (v) => {
                if (v && meta.stashedAlbedo) {
                  mat.albedoTexture = meta.stashedAlbedo;
                  meta.stashedAlbedo = null;
                } else if (!v && mat.albedoTexture) {
                  meta.stashedAlbedo = mat.albedoTexture;
                  mat.albedoTexture = null;
                }
              })
            : null,
        ),
        section(
          tr('Surface'),
          slider(tr('Metallic'), mat.metallic ?? 1, { min: 0, max: 1, step: 0.01 }, (v) => (mat.metallic = v)),
          slider(tr('Roughness'), mat.roughness ?? 1, { min: 0, max: 1, step: 0.01 }, (v) => (mat.roughness = v)),
          toggle(tr('Clear coat'), mat.clearCoat.isEnabled, (v) => (mat.clearCoat.isEnabled = v)),
          slider(tr('Clear coat intensity'), mat.clearCoat.intensity, { min: 0, max: 1, step: 0.01 }, (v) => (mat.clearCoat.intensity = v)),
          toggle(tr('Unlit'), mat.unlit, (v) => (mat.unlit = v)),
        ),
        section(
          tr('Emission'),
          colorInput(tr('Emissive color'), mat.emissiveColor.toHexString(), (v) => (mat.emissiveColor = Color3.FromHexString(v))),
          slider(tr('Intensity'), mat.emissiveIntensity, { min: 0, max: 10, step: 0.05 }, (v) => (mat.emissiveIntensity = v)),
        ),
        section(tr('General'), ...common),
      ];
    }
    if (mat instanceof StandardMaterial) {
      return [
        section(
          tr('Color'),
          colorInput(tr('Diffuse color'), mat.diffuseColor.toHexString(), (v) => (mat.diffuseColor = Color3.FromHexString(v))),
          colorInput(tr('Specular color'), mat.specularColor.toHexString(), (v) => (mat.specularColor = Color3.FromHexString(v))),
          slider(tr('Glossiness'), mat.specularPower, { min: 1, max: 256, step: 1 }, (v) => (mat.specularPower = v)),
          colorInput(tr('Emissive'), mat.emissiveColor.toHexString(), (v) => (mat.emissiveColor = Color3.FromHexString(v))),
        ),
        section(tr('General'), ...common),
      ];
    }
    return [section(tr('General'), ...common)];
  }
}
