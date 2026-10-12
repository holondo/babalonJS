import * as dom from './dom';
import type { UI } from './ui';

/** Controls with one shared state boundary and one history entry per gesture. */
export function editControls<T>(ui: UI, capture: () => T, apply: (state: T) => void) {
  const key = Symbol('edit');
  const begin = () => ui.editor.beginEdit(key, capture, apply);
  const commit = () => ui.editor.endEdit(key);
  const input = <V>(fn: (v: V) => void) => (v: V) => {
    begin();
    ui.quiet(() => fn(v));
    ui.editor.invalidate();
  };
  const action = (fn: () => void) => {
    begin();
    ui.quiet(fn);
    commit();
    ui.editor.notify('transform');
  };
  return {
    action,
    slider: ((label, value, opts, fn) => dom.slider(label, value, { ...opts, onCommit: () => { opts.onCommit?.(); commit(); } }, input(fn))) as typeof dom.slider,
    colorInput: ((label, value, fn) => dom.colorInput(label, value, input(fn), commit)) as typeof dom.colorInput,
    toggle: ((label, value, fn) => dom.toggle(label, value, (v) => action(() => fn(v)))) as typeof dom.toggle,
    chips: (<V extends string>(options: { value: V; label: string }[], value: V, fn: (v: V) => void) => dom.chips(options, value, (v) => action(() => fn(v)))) as typeof dom.chips,
  };
}
