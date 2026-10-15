import { USER_TEXTURE_SLOTS, textureStates, applyTextureStates, slotTexture, textureImage } from '../../core/materialTextures';
import type { TextureSlot } from '../../core/materialTextures';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture.js';
import { Download, Layers, Upload, X } from 'lucide';
import { saveAndOfferShare } from '../../core/files';
import { MATERIAL_PRESETS } from '../../core/presets';
import { editControls } from '../editControls';
import { materialToJSON, applyMaterial } from '../../core/state';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { tr } from '../../core/i18n';
import { button, h, hint, iconButton, section, select } from '../dom';
import type { UI } from '../ui';

/** "Bar Chair (Base Color).jpg" → "Bar-Chair-Base-Color" (safe file name, no extension). */
const fileBase = (name: string) => name.replace(/\.\w+$/, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'texture';

/** Objects → Material: Sketchfab-style material editing. */
export class MaterialPanel {
  private readonly ui: UI;

  constructor(ui: UI) {
    this.ui = ui;
  }

  materialIndex = -1;
  /** The Textures block was opened by the user (it starts collapsed). */
  private texturesOpen = false;
  /** Slot whose "from another object" picker is open. */
  private pickerFor: { material: Material; slot: TextureSlot } | null = null;
  /** Small previews of textures, made once per texture (read back from the GPU). */
  private readonly thumbs = new WeakMap<BaseTexture, Promise<string>>();

  private thumb(texture: BaseTexture) {
    let url = this.thumbs.get(texture);
    if (!url) {
      url = textureImage(texture, 96).then((b) => URL.createObjectURL(b));
      this.thumbs.set(texture, url);
    }
    const img = h('img', { alt: '', width: 48, height: 48, class: 'texture-thumb' });
    url.then((u) => (img.src = u)).catch(() => img.classList.add('unreadable'));
    return img;
  }

  /** Every texture in the scene (other objects first), for "from another object". */
  private sceneTextures(target: Material) {
    const ed = this.ui.editor;
    const seen = new Set<BaseTexture>();
    const out: { texture: BaseTexture; label: string; own: boolean }[] = [];
    for (const e of ed.entities) {
      for (const m of ed.materialsOf(e)) {
        for (const { slot, label } of USER_TEXTURE_SLOTS) {
          const t = slotTexture(m, slot);
          if (!t || seen.has(t) || t.isCube) continue;
          seen.add(t);
          out.push({ texture: t, label: `${e.name} · ${tr(label)}`, own: m === target });
        }
      }
    }
    return out.sort((a, b) => Number(a.own) - Number(b.own));
  }

  /** Copies another texture into a slot (as an image, so it's saved with the project and undoable). */
  private useTexture(mat: Material[], slot: TextureSlot, texture: BaseTexture) {
    const ed = this.ui.editor;
    this.pickerFor = null;
    this.ui.run(async () => {
      const blob = await textureImage(texture);
      const name = `${fileBase(texture.name || 'texture')}.png`;
      await ed.setMaterialTexture(mat, slot, new File([blob], name, { type: 'image/png' }));
      this.ui.toast(tr('Texture applied'));
    });
  }

  private saveTexture(texture: BaseTexture, slotLabel: string) {
    this.ui.run(async () => {
      const blob = await textureImage(texture);
      const name = `${fileBase(texture.name || slotLabel)}.png`;
      const share = saveAndOfferShare(blob, name);
      this.ui.toast(tr('Texture saved as {name}', { name }), 'info', share ? { label: tr('Share'), run: share } : undefined, 6000);
    });
  }

  materialPanel() {
    const ed = this.ui.editor;
    const e = ed.selected;
    if (!e || e.kind === 'light') return [hint(tr('Select a model or shape to edit its materials.'))];
    const mats = ed.materialsOf(e);
    if (!mats.length) return [hint(tr('This object has no editable materials.'))];
    if (this.materialIndex >= mats.length) this.materialIndex = -1;
    const targets = this.materialIndex < 0 ? mats : [mats[this.materialIndex]];
    const mat = targets[0];
    const out: (Node | null)[] = [];
    if (mats.length > 1) {
      out.push(
        select(tr('Material'), [{ value: '-1', label: tr('All materials') }, ...mats.map((m, i) => ({ value: String(i), label: m.name || tr('Material {n}', { n: i + 1 }) }))], String(this.materialIndex), (v) => {
          this.materialIndex = +v;
          this.ui.renderPanel();
        }),
      );
    }
    out.push(...this.materialControls(mat, targets));
    return out;
  }

  materialControls(mat: Material, targets: Material[] = [mat]): (Node | null)[] {
    const controls = editControls(this.ui, () => targets.map(materialToJSON), (states) => targets.forEach((m, i) => applyMaterial(m, states[i])));
    const forMaterials = <M extends Material>(accept: (m: Material) => m is M) => {
      const each = <V>(fn: (value: V, mat: M) => void) => (value: V) => targets.filter(accept).forEach((m) => fn(value, m));
      return {
        slider: (label: string, value: number, opts: Parameters<typeof controls.slider>[2], fn: (v: number, mat: M) => void) => controls.slider(label, value, opts, each(fn)),
        colorInput: (label: string, value: string, fn: (v: string, mat: M) => void) => controls.colorInput(label, value, each(fn)),
        toggle: (label: string, value: boolean, fn: (v: boolean, mat: M) => void) => controls.toggle(label, value, each(fn)),
        chips: (options: { value: string; label: string }[], value: string, fn: (v: string, mat: M) => void) => controls.chips(options, value, each(fn)),
      };
    };
    const { slider, toggle } = forMaterials((_m): _m is Material => true);
    const q = (fn: () => void) => this.ui.quiet(fn);
    const common = [
      slider(tr('Opacity'), mat.alpha, { min: 0, max: 1, step: 0.01 }, (v, mat) => {
        mat.alpha = v;
        if (v < 1) mat.transparencyMode = Material.MATERIAL_ALPHABLEND;
      }),
      toggle(tr('Double-sided'), !mat.backFaceCulling, (v, mat) => (mat.backFaceCulling = !v)),
      toggle(tr('Wireframe'), mat.wireframe, (v, mat) => (mat.wireframe = v)),
    ];
    if (mat instanceof PBRMaterial) {
      const { slider, toggle, colorInput, chips } = forMaterials((m): m is PBRMaterial => m instanceof PBRMaterial);
      const meta = (mat.metadata ??= {});
      const hasTex = !!(mat.albedoTexture || meta.stashedAlbedo);
      const isUnlit = !!mat.unlit;
      return [
        section(tr('Material presets'), chips(MATERIAL_PRESETS.map((p) => ({ value: p.id, label: tr(p.label) })), '', (id, mat) => {
          const preset = MATERIAL_PRESETS.find((p) => p.id === id)!;
          const state = materialToJSON(mat);
          applyMaterial(mat, { ...state, alpha: 1, transparencyMode: null, clearCoat: false, clearCoatIntensity: 1, unlit: false, ...preset.values,
            advanced: state.advanced ? { ...state.advanced, refraction: false, sheen: false, iridescence: false, anisotropy: false, linkTransparency: false, ...preset.advanced } : undefined });
        })),
        h('details', { class: 'sec' }, h('summary', {}, tr('Advanced material')),
          toggle(tr('Refraction'), mat.subSurface?.isRefractionEnabled ?? false, (v, mat) => { if (mat.subSurface) mat.subSurface.isRefractionEnabled = v; }),
          slider(tr('Transmission'), mat.subSurface?.refractionIntensity ?? 0, { min: 0, max: 1, step: .01 }, (v, mat) => { if (mat.subSurface) mat.subSurface.refractionIntensity = v; }),
          slider(tr('Index of refraction'), mat.subSurface?.indexOfRefraction ?? 1.5, { min: 1, max: 2.5, step: .01 }, (v, mat) => { if (mat.subSurface) mat.subSurface.indexOfRefraction = v; }),
          toggle(tr('Sheen'), mat.sheen?.isEnabled ?? false, (v, mat) => { if (mat.sheen) mat.sheen.isEnabled = v; }),
          slider(tr('Sheen intensity'), mat.sheen?.intensity ?? 0, { min: 0, max: 1, step: .01 }, (v, mat) => { if (mat.sheen) mat.sheen.intensity = v; }),
          colorInput(tr('Sheen color'), mat.sheen?.color ? mat.sheen.color.toHexString() : '#FFFFFF', (v, mat) => { if (mat.sheen) mat.sheen.color = Color3.FromHexString(v); }),
          toggle(tr('Iridescence'), mat.iridescence?.isEnabled ?? false, (v, mat) => { if (mat.iridescence) mat.iridescence.isEnabled = v; }),
          slider(tr('Iridescence intensity'), mat.iridescence?.intensity ?? 0, { min: 0, max: 1, step: .01 }, (v, mat) => { if (mat.iridescence) mat.iridescence.intensity = v; }),
          slider(tr('Film thickness (nm)'), mat.iridescence?.maximumThickness ?? 400, { min: 100, max: 1000, step: 1 }, (v, mat) => { if (mat.iridescence) { mat.iridescence.maximumThickness = v; mat.iridescence.minimumThickness = Math.min(mat.iridescence.minimumThickness, v); } }),
          toggle(tr('Anisotropy'), mat.anisotropy?.isEnabled ?? false, (v, mat) => { if (mat.anisotropy) mat.anisotropy.isEnabled = v; }),
          slider(tr('Anisotropy intensity'), mat.anisotropy?.intensity ?? 0, { min: 0, max: 1, step: .01 }, (v, mat) => { if (mat.anisotropy) mat.anisotropy.intensity = v; }),
        ),
        section(
          tr('Color'),
          colorInput(hasTex ? tr('Tint (multiplies texture)') : tr('Base color'), mat.albedoColor ? mat.albedoColor.toHexString() : '#FFFFFF', (v, mat) => q(() => (mat.albedoColor = Color3.FromHexString(v)))),
          hasTex
            ? toggle(tr('Show texture'), !!mat.albedoTexture, (v, mat) => {
                const meta = (mat.metadata ??= {});
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
          slider(tr('Metallic'), mat.metallic ?? 1, { min: 0, max: 1, step: 0.01 }, (v, mat) => (mat.metallic = v)),
          slider(tr('Roughness'), mat.roughness ?? 1, { min: 0, max: 1, step: 0.01 }, (v, mat) => (mat.roughness = v)),
          toggle(tr('Clear coat'), mat.clearCoat?.isEnabled ?? false, (v, mat) => { if (mat.clearCoat) mat.clearCoat.isEnabled = v; }),
          slider(tr('Clear coat intensity'), mat.clearCoat?.intensity ?? 1, { min: 0, max: 1, step: 0.01 }, (v, mat) => { if (mat.clearCoat) mat.clearCoat.intensity = v; }),
          toggle(tr('Unlit'), isUnlit, (v, mat) => (mat.unlit = v)),
        ),
        section(
          tr('Emission'),
          colorInput(tr('Emissive color'), mat.emissiveColor ? mat.emissiveColor.toHexString() : '#000000', (v, mat) => (mat.emissiveColor = Color3.FromHexString(v))),
          slider(tr('Intensity'), mat.emissiveIntensity ?? 1, { min: 0, max: 10, step: 0.05 }, (v, mat) => (mat.emissiveIntensity = v)),
        ),
        ...this.textureControls(mat, targets),
        section(tr('General'), ...common),
      ];
    }
    if (mat instanceof StandardMaterial) {
      const { slider, colorInput } = forMaterials((m): m is StandardMaterial => m instanceof StandardMaterial);
      return [
        section(
          tr('Color'),
          colorInput(tr('Diffuse color'), mat.diffuseColor ? mat.diffuseColor.toHexString() : '#FFFFFF', (v, mat) => (mat.diffuseColor = Color3.FromHexString(v))),
          colorInput(tr('Specular color'), mat.specularColor ? mat.specularColor.toHexString() : '#FFFFFF', (v, mat) => (mat.specularColor = Color3.FromHexString(v))),
          slider(tr('Glossiness'), mat.specularPower ?? 64, { min: 1, max: 256, step: 1 }, (v, mat) => (mat.specularPower = v)),
          colorInput(tr('Emissive'), mat.emissiveColor ? mat.emissiveColor.toHexString() : '#000000', (v, mat) => (mat.emissiveColor = Color3.FromHexString(v))),
        ),
        ...this.textureControls(mat, targets),
        section(tr('General'), ...common),
      ];
    }
    return [section(tr('General'), ...common)];
  }
  private textureControls(mat: Material, targets: Material[]) {
    const ed = this.ui.editor;
    const { slider } = editControls(this.ui, () => targets.map(materialToJSON), (states) => targets.forEach((m, i) => applyMaterial(m, states[i])));
    // Advanced: collapsed by default, kept open across re-renders once the user opens it
    const details = h('details', { class: 'sec', open: this.texturesOpen }, h('summary', {}, tr('Textures')));
    // Slots (and their thumbnails, read back from the GPU) are only built while the block is open
    details.addEventListener('toggle', () => { if (this.texturesOpen !== details.open) { this.texturesOpen = details.open; this.ui.renderPanel(); } });
    if (!this.texturesOpen) return [details];
    details.append(...USER_TEXTURE_SLOTS.filter((s) => s.slot !== 'metal' || mat instanceof PBRMaterial).map(({ slot, label }) => {
      const state = textureStates(mat)[slot];
      const current = slotTexture(mat, slot);
      const input = h('input', { type: 'file', accept: '.png,.jpg,.jpeg,.webp,.ktx2', hidden: true });
      input.addEventListener('change', () => {
        const chosen = input.files?.[0];
        if (chosen) this.ui.run(() => ed.setMaterialTexture(targets, slot, chosen));
      });
      const set = (patch: Partial<NonNullable<typeof state>>) => {
        for (const m of targets) {
          const states = textureStates(m);
          if (states[slot]) { states[slot] = { ...states[slot]!, ...patch }; applyTextureStates(m, states); }
        }
      };
      const open = this.pickerFor?.material === mat && this.pickerFor.slot === slot;
      const togglePicker = () => { this.pickerFor = open ? null : { material: mat, slot }; this.ui.renderPanel(); };
      const others = open ? this.sceneTextures(mat).filter((t) => t.texture !== current) : [];
      return h('div', { class: 'texture-slot' },
        h('div', { class: 'texture-slot-head' },
          current ? this.thumb(current) : h('span', { class: 'texture-thumb blank' }),
          h('div', { class: 'texture-slot-title' }, h('h4', {}, tr(label)), h('small', {}, state ? tr('Your texture') : current ? tr('From the model') : tr('None'))),
          current ? iconButton(Download, tr('Save image'), () => this.saveTexture(current, tr(label))) : null),
        input,
        h('div', { class: 'texture-actions' },
          button(state || current ? tr('Replace') : tr('Choose file'), () => input.click(), { icon: Upload, cls: 'small' }),
          button(tr('From an object'), togglePicker, { icon: Layers, cls: `small${open ? ' active' : ''}` }),
          state ? iconButton(X, tr('Restore original'), () => this.ui.run(() => ed.setMaterialTexture(targets, slot, null))) : null),
        open
          ? h('div', { class: 'texture-picker' },
              others.length
                ? h('div', { class: 'texture-picker-grid' }, ...others.map((t) =>
                    h('button', { class: 'texture-pick', title: t.label, onClick: () => this.useTexture(targets, slot, t.texture) },
                      this.thumb(t.texture), h('span', {}, t.label))))
                : hint(tr('No other textures in the scene. Add a textured model first.')))
          : null,
        slot === 'metal' ? hint(tr('Packed map: roughness in green, metal in blue.')) : null,
        state ? slider(tr('Tiling U'), state.u, { min: .1, max: 20, step: .1 }, (v) => set({ u: v })) : null,
        state ? slider(tr('Tiling V'), state.v, { min: .1, max: 20, step: .1 }, (v) => set({ v })) : null,
        state ? slider(tr('Texture rotation'), state.rotation * 180 / Math.PI, { min: 0, max: 360, step: 1 }, (v) => set({ rotation: v * Math.PI / 180 })) : null,
      );
    }));
    return [details];
  }

}
