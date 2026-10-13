import { Upload } from 'lucide';
import { MODEL_EXTENSIONS, SAMPLE_MODELS } from '../../core/editor';
import type { LightType, PrimitiveType } from '../../core/editor';
import { tr } from '../../core/i18n';
import { h, hint, icon, section } from '../dom';
import type { UI } from '../ui';
import { errorMessage } from '../shared';

/** Add panel: files, samples, shapes and lights. */
export class AddPanel {
  private readonly ui: UI;

  constructor(ui: UI) {
    this.ui = ui;
  }

  addPanel() {
    const ed = this.ui.editor;
    const prims: { id: PrimitiveType; label: string }[] = [
      { id: 'box', label: tr('Cube') },
      { id: 'sphere', label: tr('Sphere') },
      { id: 'cylinder', label: tr('Cylinder') },
      { id: 'cone', label: tr('Cone') },
      { id: 'torus', label: tr('Torus') },
      { id: 'plane', label: tr('Plane') },
    ];
    const lights: { id: LightType; label: string }[] = [
      { id: 'point', label: tr('Point') },
      { id: 'spot', label: tr('Spotlight') },
      { id: 'directional', label: tr('Sun') },
    ];
    return [
      section(
        tr('Your files'),
        h(
          'button',
          { class: 'upload', onClick: () => this.ui.fileInput.click() },
          icon(Upload, 28),
          h('b', {}, tr('Choose files')),
          h('small', {}, MODEL_EXTENSIONS.map((e) => e.toUpperCase()).join(' · ')),
        ),
        hint(tr('For .gltf with separate textures, select the .gltf together with its .bin and images.')),
      ),
      section(
        tr('Sample models'),
        h(
          'div',
          { class: 'grid' },
          ...SAMPLE_MODELS.map((m) =>
            h('button', {
              class: 'card',
              onClick: async () => {
                try {
                  await ed.addFromUrl(m.url, tr(m.label));
                } catch (e) {
                  this.ui.toast(errorMessage(e), 'error');
                }
              },
            }, tr(m.label)),
          ),
        ),
      ),
      section(tr('Shapes'), h('div', { class: 'grid' }, ...prims.map((p) => h('button', { class: 'card', onClick: () => this.ui.addShape(p.id) }, p.label)))),
      section(tr('Lights'), h('div', { class: 'grid' }, ...lights.map((l) => h('button', { class: 'card', onClick: () => ed.addLight(l.id) }, l.label)))),
    ];
  }
}
