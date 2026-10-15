import { Pause, Play, Repeat, ArrowRightToLine, FileUp, Trash2 } from 'lucide';
import type { Entity } from '../../core/editor';
import type { ClipState } from '../../animation/animation';
import type { MotionSettings, MotionType } from '../../animation/motion';
import { humanoidOf } from '../../rigging/humanoid';
import { ANIMATION_LIBRARY, ANIMATION_SOURCE } from '../../core/presets';
import { tr } from '../../core/i18n';
import { button, chips, h, hint, row, section, slider, toggle } from '../dom';
import type { UI } from '../ui';
import { clipLabel } from '../shared';

/** Objects → Animate: clips, the animation library, imported clips and simple motion. */
export class AnimatePanel {
  private readonly ui: UI;

  constructor(ui: UI) {
    this.ui = ui;
  }

  /** Live scrubber of the selected object's clip (moves while the clip plays). */
  scrubber: { entity: Entity; input: HTMLInputElement; out: HTMLOutputElement; fps: number } | null = null;

  animatePanel(): (Node | null)[] {
    const ed = this.ui.editor;
    const e = ed.selected;
    this.scrubber = null;
    if (!e) return [];
    const out: (Node | null)[] = [];
    const a = ed.anim;
    const clips = a.clips(e);
    const g = a.current(e);
    if (clips.length && g) {
      const st = a.state(e);
      const fps = g.targetedAnimations[0]?.animation.framePerSecond || 60;
      const seconds = (f: number) => `${((f - g.from) / fps).toFixed(2)} s`;
      let before: ClipState | null = null;
      const scrub = slider(
        tr('Frame'),
        st.frame,
        {
          min: g.from,
          max: g.to,
          step: 0.5,
          format: seconds,
          onCommit: () => {
            if (before) this.ui.quiet(() => a.seek(e, a.frame(e), before!));
            before = null;
            this.ui.renderSelbar();
            this.ui.renderPanel();
          },
        },
        (v) => {
          before ??= a.state(e);
          this.ui.quiet(() => a.seek(e, v));
        },
      );
      this.scrubber = { entity: e, input: scrub.querySelector('input')!, out: scrub.querySelector('output')!, fps };
      let speedBefore: ClipState | null = null;
      out.push(
        section(
          tr('Clips'),
          chips(
            clips.map((c, i) => {
              // Library clips show their friendly name
              const from = e.addedClips?.find((x) => x.group === c)?.from;
              const lib = from && 'library' in from ? ANIMATION_LIBRARY.find((l) => l.id === from.library) : undefined;
              return { value: String(i), label: lib ? tr(lib.label) : clipLabel(c.name, i) };
            }),
            String(st.index),
            (v) => a.select(e, +v),
          ),
          row(
            button(st.playing ? tr('Pause') : tr('Play'), () => a.toggle(e), { icon: st.playing ? Pause : Play, cls: 'small primary' }),
            button(st.loop ? tr('Loop') : tr('Once'), () => a.setLoop(e, !st.loop), { icon: st.loop ? Repeat : ArrowRightToLine, cls: 'small' }),
          ),
          scrub,
          slider(
            tr('Speed'),
            st.speed,
            {
              min: 0,
              max: 3,
              step: 0.05,
              format: (v) => `${v.toFixed(2)}×`,
              onCommit: () => {
                if (speedBefore) this.ui.quiet(() => a.setSpeed(e, a.state(e).speed, speedBefore!));
                speedBefore = null;
              },
            },
            (v) => {
              speedBefore ??= a.state(e);
              this.ui.quiet(() => a.setSpeed(e, v));
            },
          ),
          ed.anim.current(e) && e.addedClips?.some((c) => c.group === ed.anim.current(e))
            ? row(button(tr('Remove this clip'), () => ed.clips.remove(e, ed.anim.current(e)!), { icon: Trash2, cls: 'small ghost' }))
            : null,
          hint(tr('Pause or drag the frame to keep a pose: photos, AR and saved projects keep it.')),
        ),
      );
    }
    out.push(...this.librarySections(e), this.motionSection(e));
    return out;
  }

  /** Spin, float, pulse or sway: for any object, no keyframes. */
  motionSection(e: Entity) {
    const mo = this.ui.editor.motions;
    const m = mo.get(e);
    const types: { value: MotionType; label: string }[] = [
      { value: 'none', label: tr('None') },
      { value: 'spin', label: tr('Spin') },
      { value: 'float', label: tr('Float') },
      { value: 'pulse', label: tr('Pulse') },
      { value: 'sway', label: tr('Sway') },
    ];
    let before: MotionSettings | undefined | null = null;
    const live = (patch: Partial<MotionSettings>) => {
      if (before === null) before = e.motion ? { ...e.motion } : undefined;
      this.ui.quiet(() => mo.set(e, { ...mo.get(e), ...patch }, false));
    };
    const commit = () => {
      if (before !== null) mo.commit(e, before);
      before = null;
    };
    const amount =
      m.type === 'float'
        ? { min: 0.02, max: 1, step: 0.01, format: (v: number) => `${Math.round(v * 100)}%` }
        : m.type === 'pulse'
          ? { min: 0.01, max: 0.5, step: 0.01, format: (v: number) => `${Math.round(v * 100)}%` }
          : { min: 1, max: 45, step: 1, format: (v: number) => `${Math.round(v)}°` };
    return section(
      tr('Motion'),
      chips(types, m.type, (v) => mo.choose(e, v)),
      ...(m.type === 'none'
        ? [hint(tr('Simple motion for any object. You can still move it while it plays.'))]
        : [
            row(
              button(m.playing ? tr('Pause') : tr('Play'), () => mo.set(e, { ...m, playing: !m.playing }), { icon: m.playing ? Pause : Play, cls: 'small' }),
            ),
            slider(
              m.type === 'spin' ? tr('Turns per second') : tr('Speed'),
              m.speed,
              { min: 0.05, max: 3, step: 0.05, format: (v) => (m.type === 'spin' ? v.toFixed(2) : `${v.toFixed(2)}×`), onCommit: commit },
              (v) => live({ speed: v }),
            ),
            m.type !== 'spin' ? slider(m.type === 'sway' ? tr('Angle') : tr('Amount'), m.amount, { ...amount, onCommit: commit }, (v) => live({ amount: v })) : null,
          ]),
    );
  }

  /** Built-in clips and imported animation files, for humanoids. */
  librarySections(e: Entity): (Node | null)[] {
    const ed = this.ui.editor;
    const d = e.kind === 'model' ? humanoidOf(e) : null;
    if (!d) {
      return e.kind === 'model' && !e.animationGroups.length
        ? [section(tr('Add animation'), hint(tr('Clips from the library work on characters with a skeleton. Give this model one in Objects → Rig.')))]
        : [];
    }
    if (!d.humanoid) return [section(tr('Add animation'), hint(tr('Clips from the library work on humanoid characters. Map its bones in Objects → Pose.')))];
    if (!d.complete) return [section(tr('Add animation'), hint(tr('Some bones of this skeleton were not recognized. Map them in Objects → Pose.')))];
    const add = (id: string) => this.ui.run(() => ed.clips.add(e, { library: id }, { inPlace: this.inPlace }));
    const groups = [...new Set(ANIMATION_LIBRARY.map((c) => c.group))];
    return [
      section(
        tr('Add animation'),
        toggle(tr('Keep in place'), this.inPlace, (v) => (this.inPlace = v)),
        ...groups.flatMap((g) => [
          h('h4', { class: 'sub' }, tr(g)),
          h(
            'div',
            { class: 'chips' },
            ...ANIMATION_LIBRARY.filter((c) => c.group === g).map((c) => h('button', { class: 'chip', onClick: () => add(c.id) }, tr(c.label))),
          ),
        ]),
        hint(tr('Free animations: {name} by {author} ({license}).', { name: ANIMATION_SOURCE.name, author: ANIMATION_SOURCE.author, license: ANIMATION_SOURCE.license })),
        row(button(tr('Import animation file'), () => this.ui.clipInput.click(), { icon: FileUp, cls: 'small' })),
        hint(tr('GLB, glTF or FBX with clips for a humanoid skeleton (any common bone naming).')),
      ),
    ];
  }

  /** Keep retargeted clips in place (no walking away). */
  inPlace = true;

  async importClips(files: File[]) {
    const ed = this.ui.editor;
    const e = ed.selected;
    if (!e) return;
    const main = files.find((f) => /\.(glb|gltf|fbx)$/i.test(f.name));
    if (!main) return this.ui.toast(tr('Choose a GLB, glTF or FBX file.'), 'error');
    const asset = { id: ed.nextAssetId++, name: main.name.replace(/\.[^.]+$/, ''), main, deps: files.filter((f) => f !== main) };
    await this.ui.run(async () => {
      const added = await ed.clips.add(e, { asset }, { inPlace: this.inPlace });
      this.ui.toast(tr('{n} animations added to {name}', { n: added.length, name: e.name }));
    });
  }

  /** Keeps the frame slider in step with a playing clip (runs only while the scene renders). */
  updateScrubber() {
    const s = this.scrubber;
    if (!s || !s.input.isConnected) return;
    const a = this.ui.editor.anim;
    if (!a.isPlaying(s.entity) || s.input.closest('.dragging')) return;
    const f = a.frame(s.entity);
    const g = a.current(s.entity)!;
    s.input.value = String(f);
    const min = parseFloat(s.input.min);
    const max = parseFloat(s.input.max);
    const pct = ((f - min) / (max - min || 1)) * 100;
    s.input.style.setProperty('--val-pct', `${Math.max(0, Math.min(100, pct))}%`);
    s.out.textContent = `${((f - g.from) / s.fps).toFixed(2)} s`;
  }
}
