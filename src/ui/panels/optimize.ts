import { Layers, RotateCcw, Wand, X } from 'lucide';
import type { Entity } from '../../core/editor';
import { tr } from '../../core/i18n';
import { analyzeEntity, deviceBudget, formatBytes, overBudget } from '../../optimize/analysis';
import { DEFAULT_OPTIMIZE, OPTIMIZE_PRESETS } from '../../optimize/optimizer';
import type { OptimizeSettings } from '../../optimize/optimizer';
import { BAKE_SIZES } from '../../optimize/bake';
import { DEFAULT_TEXTURES } from '../../optimize/textures';
import type { TextureSettings } from '../../optimize/textures';
import { button, chips, h, hint, row, section, select, slider, toggle } from '../dom';
import type { UI } from '../ui';

/**
 * Objects → Optimize: what the model costs, fewer triangles with the same look (optional levels
 * of detail and a baked normal map), lighter textures; everything reversible.
 */
export class OptimizePanel {
  private readonly ui: UI;
  /** Settings being prepared (applied with "Optimize"). */
  private geometry: OptimizeSettings = { ...DEFAULT_OPTIMIZE };
  private textures: TextureSettings = { ...DEFAULT_TEXTURES };
  /** Showing the original while holding the compare button. */
  private comparing = false;

  constructor(ui: UI) {
    this.ui = ui;
  }

  optimizePanel(): (Node | null)[] {
    const ed = this.ui.editor;
    const e = ed.selected;
    if (!e) return [];
    return [this.costSection(e), this.geometrySection(e), this.textureSection(e)];
  }

  /** After a model is added: a heavy one gets a notice with a shortcut here. */
  private costSection(e: Entity) {
    const ed = this.ui.editor;
    const cost = analyzeEntity(ed, e);
    const budget = deviceBudget();
    const heavy = overBudget(cost, budget);
    const line = (label: string, value: string) => h('li', {}, h('span', {}, label), h('b', {}, value));
    return section(
      tr('Cost'),
      h(
        'ul',
        { class: 'readout' },
        line(tr('Triangles'), cost.triangles.toLocaleString()),
        line(tr('Vertices'), cost.vertices.toLocaleString()),
        cost.splats ? line(tr('Gaussian splats'), cost.splats.toLocaleString()) : null,
        line(tr('Texture memory'), cost.textures.length ? `${formatBytes(cost.textureBytes)} · ${cost.textures.length}` : '—'),
      ),
      hint(
        heavy
          ? tr(budget.phone ? 'Heavy for this phone: optimizing will make it smoother, especially in AR.' : 'Very heavy: optimizing will make the scene smoother.')
          : tr('Fits this device.'),
      ),
      cost.morphMeshes ? hint(tr('Parts with blend shapes are kept as they are.')) : null,
      cost.splats ? hint(tr('Triangle optimization does not reduce Gaussian splats.')) : null,
    );
  }

  private geometrySection(e: Entity) {
    const ed = this.ui.editor;
    const opt = ed.optimizer;
    const o = e.optimization;
    const blocker = opt.blocker(e);
    const busy = opt.busy;
    const s = this.geometry;
    const preset = OPTIMIZE_PRESETS.find((p) => Math.abs(p.ratio - s.ratio) < 1e-6)?.value ?? 'custom';
    const result = o
      ? h(
          'ul',
          { class: 'readout' },
          h('li', {}, h('span', {}, tr('Triangles')), h('b', {}, `${o.before.triangles.toLocaleString()} → ${o.after.triangles.toLocaleString()}`)),
          h('li', {}, h('span', {}, tr('Largest deviation')), h('b', {}, tr('{n}% of the size', { n: (o.error * 100).toFixed(2) }))),
        )
      : null;
    const compare = h('button', { class: 'btn small', title: tr('Hold to see the original') }, h('span', {}, tr('Hold to compare')));
    const hold = (on: boolean) => {
      if (this.comparing === on || !e.optimization) return;
      this.comparing = on;
      opt.preview(e, on);
    };
    compare.addEventListener('pointerdown', () => hold(true));
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) compare.addEventListener(ev, () => hold(false));
    return section(
      tr('Geometry'),
      hint(tr('Fewer triangles with the same look: textures, animations and poses keep working.')),
      chips(
        [...OPTIMIZE_PRESETS.map((p) => ({ value: p.value as string, label: tr(p.label) })), ...(preset === 'custom' ? [{ value: 'custom', label: tr('Custom') }] : [])],
        preset,
        (v) => {
          const p = OPTIMIZE_PRESETS.find((x) => x.value === v);
          if (p) this.geometry = { ...s, ratio: p.ratio };
          this.ui.renderPanel();
        },
      ),
      slider(tr('Triangles kept'), s.ratio * 100, { min: 1, max: 90, step: 1, format: (v) => `${Math.round(v)}%`, onCommit: () => this.ui.renderPanel() }, (v) => (this.geometry = { ...this.geometry, ratio: v / 100 })),
      toggle(tr('Levels of detail (lighter when small on screen)'), s.lods, (v) => (this.geometry = { ...this.geometry, lods: v })),
      toggle(tr('Bake surface detail (normal map)'), !!s.bakeSize, (v) => ((this.geometry = { ...this.geometry, bakeSize: v ? 2048 : null }), this.ui.renderPanel())),
      s.bakeSize
        ? select(
            tr('Detail map size'),
            BAKE_SIZES.map((n) => ({ value: String(n), label: `${n} px` })),
            String(s.bakeSize),
            (v) => (this.geometry = { ...this.geometry, bakeSize: +v }),
          )
        : null,
      toggle(tr('Keep open edges in place'), s.lockBorder, (v) => (this.geometry = { ...this.geometry, lockBorder: v })),
      busy ? this.ui.operationProgress('geometry', opt.progress ?? 0) : null,
      blocker ? hint(blocker) : null,
      result,
      row(
        busy
          ? button(tr('Stop'), () => opt.cancel(), { icon: X, cls: 'small' })
          : button(tr(o ? 'Optimize again' : 'Optimize'), () => this.applyGeometry(e), { icon: Wand, cls: 'small primary' }),
        o && !busy ? compare : null,
        o && !busy ? button(tr('Original'), () => this.ui.run(() => opt.revert(e)), { icon: RotateCcw, cls: 'small ghost' }) : null,
      ),
    );
  }

  private textureSection(e: Entity) {
    const ed = this.ui.editor;
    const opt = ed.textureOptimizer;
    const o = e.textureOptimization;
    const busy = opt.busy;
    const s = this.textures;
    const sizes = [
      { value: '', label: tr('Keep resolution') },
      ...[4096, 2048, 1024, 512].map((n) => ({ value: String(n), label: tr('At most {n} px', { n }) })),
    ];
    return section(
      tr('Textures'),
      hint(tr('Compressed textures use 4 to 8 times less graphics memory with practically the same image. Reducing the size is optional and loses detail.')),
      toggle(tr('Compress (KTX2)'), s.compress, (v) => (this.textures = { ...this.textures, compress: v })),
      select(tr('Size'), sizes, s.maxSize ? String(s.maxSize) : '', (v) => (this.textures = { ...this.textures, maxSize: v ? +v : null })),
      busy ? this.ui.operationProgress('textures', opt.progress ?? 0) : null,
      o
        ? h('ul', { class: 'readout' }, h('li', {}, h('span', {}, tr('Texture memory')), h('b', {}, `${formatBytes(o.before)} → ${formatBytes(o.after)}`)))
        : null,
      row(
        busy
          ? button(tr('Stop'), () => opt.cancel(), { icon: X, cls: 'small' })
          : button(tr(o ? 'Optimize again' : 'Optimize textures'), () => this.applyTextures(e), { icon: Layers, cls: 'small primary' }),
        o && !busy ? button(tr('Original'), () => this.ui.run(() => opt.revert(e)), { icon: RotateCcw, cls: 'small ghost' }) : null,
      ),
    );
  }

  private applyGeometry(e: Entity) {
    const opt = this.ui.editor.optimizer;
    return this.ui.run(async () => {
      try {
        const o = await opt.apply(e, this.geometry);
        this.ui.toast(tr('Optimized: {from} → {to} triangles.', { from: o.before.triangles.toLocaleString(), to: o.after.triangles.toLocaleString() }));
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) throw err;
      }
    });
  }

  private applyTextures(e: Entity) {
    const opt = this.ui.editor.textureOptimizer;
    return this.ui.run(async () => {
      try {
        const o = await opt.apply(e, this.textures);
        this.ui.toast(tr('Textures optimized: {from} → {to} of graphics memory.', { from: formatBytes(o.before), to: formatBytes(o.after) }), 'info', undefined, 6000);
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) throw err;
      }
    });
  }
}
