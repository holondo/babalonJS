import { createElement } from 'lucide';
import type { IconNode } from 'lucide';
import { tr } from './i18n';

type Child = Node | string | null | undefined | false;
type Props = Record<string, unknown> & { class?: string; style?: string };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k in el && typeof v !== 'string') (el as any)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

export function icon(node: IconNode, size = 20) {
  return createElement(node, { width: size, height: size, 'stroke-width': 1.8 });
}

export function iconButton(node: IconNode, title: string, onClick: () => void, opts: { active?: boolean; label?: string; cls?: string; disabled?: boolean } = {}) {
  return h(
    'button',
    {
      class: `ibtn ${opts.cls ?? ''} ${opts.active ? 'active' : ''}`,
      title,
      'aria-label': title,
      disabled: opts.disabled,
      onClick,
    },
    icon(node),
    opts.label ? h('span', {}, opts.label) : null,
  );
}

export function section(title: string, ...children: Child[]) {
  return h('section', { class: 'sec' }, h('h3', {}, title), ...children);
}

export function row(...children: Child[]) {
  return h('div', { class: 'row' }, ...children);
}

export function button(label: string, onClick: () => void, opts: { icon?: IconNode; cls?: string; active?: boolean } = {}) {
  return h('button', { class: `btn ${opts.cls ?? ''} ${opts.active ? 'active' : ''}`, onClick }, opts.icon ? icon(opts.icon, 18) : null, h('span', {}, label));
}

export function chips<T extends string>(options: { value: T; label: string }[], value: T, onPick: (v: T) => void) {
  return h(
    'div',
    { class: 'chips' },
    ...options.map((o) => h('button', { class: `chip ${o.value === value ? 'active' : ''}`, onClick: () => onPick(o.value) }, o.label)),
  );
}

export interface SliderOpts {
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  /** Converts the displayed/stored value to the slider position (e.g. log scale). */
  toSlider?: (v: number) => number;
  fromSlider?: (v: number) => number;
  onCommit?: () => void;
}

export function slider(label: string, value: number, opts: SliderOpts, onInput: (v: number) => void) {
  const to = opts.toSlider ?? ((v: number) => v);
  const from = opts.fromSlider ?? ((v: number) => v);
  const fmt = opts.format ?? ((v: number) => (Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(2)));
  const out = h('output', {}, fmt(value));
  const input = h('input', {
    type: 'range',
    min: String(opts.min),
    max: String(opts.max),
    step: String(opts.step ?? (opts.max - opts.min) / 200),
    value: String(to(value)),
  });
  const update = () => {
    const v = from(parseFloat(input.value));
    out.textContent = fmt(v);
    onInput(v);
  };
  input.addEventListener('input', update);
  input.addEventListener('change', () => opts.onCommit?.());
  // Double-click/double-tap the label to restore the initial value
  const initial = value;
  const lab = h('label', {
    title: tr('Double-tap to reset'),
    onDblclick: () => {
      input.value = String(to(initial));
      update();
      opts.onCommit?.();
    },
  }, label);
  return h('div', { class: 'slider' }, h('div', { class: 'slider-head' }, lab, out), input);
}

export function colorInput(label: string, value: string, onInput: (hex: string) => void) {
  const input = h('input', { type: 'color', value });
  input.addEventListener('input', () => onInput(input.value));
  return h('label', { class: 'color' }, h('span', {}, label), input);
}

export function toggle(label: string, value: boolean, onChange: (v: boolean) => void) {
  const input = h('input', { type: 'checkbox', checked: value });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'toggle' }, h('span', {}, label), input, h('i', {}));
}

export function select(label: string, options: { value: string; label: string }[], value: string, onChange: (v: string) => void) {
  const sel = h('select', {}, ...options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)));
  sel.addEventListener('change', () => onChange(sel.value));
  return h('label', { class: 'select' }, h('span', {}, label), sel);
}

export function hint(text: string) {
  return h('p', { class: 'hint' }, text);
}
