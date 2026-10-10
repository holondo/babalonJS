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
  const track = h('div', { class: 'slider-track' }, input);
  if (matchMedia('(pointer: coarse)').matches) scrollFriendlyRange(track, input);
  return h('div', { class: 'slider' }, h('div', { class: 'slider-head' }, lab, out), track);
}

/**
 * On touch screens a native range jumps to the finger as soon as it lands, so scrolling a panel
 * over a slider changes its value by accident. Here the slider only reacts to a sideways drag
 * (a vertical start is left to the scroll), moves relative to its current value, and ignores taps.
 */
export function scrollFriendlyRange(track: HTMLElement, input: HTMLInputElement) {
  input.style.pointerEvents = 'none';
  track.style.touchAction = 'pan-y';
  let drag: { id: number; x: number; y: number; value: number; active: boolean } | null = null;
  track.addEventListener('pointerdown', (e) => {
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, value: parseFloat(input.value), active: false };
  });
  track.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.active) {
      // Mostly vertical: it's a scroll, let the panel have it
      if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) {
        drag = null;
        return;
      }
      if (Math.abs(dx) < 8) return;
      drag.active = true;
      track.setPointerCapture(e.pointerId);
      track.classList.add('dragging');
    }
    const min = parseFloat(input.min);
    const max = parseFloat(input.max);
    const width = track.clientWidth || 1;
    input.value = String(Math.min(max, Math.max(min, drag.value + (dx / width) * (max - min))));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const end = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.active) input.dispatchEvent(new Event('change', { bubbles: true }));
    track.classList.remove('dragging');
    drag = null;
  };
  track.addEventListener('pointerup', end);
  track.addEventListener('pointercancel', end);
}

/** One-level switch (panel parts like Object | Material, or the Edit / Photo / AR modes). */
export function segmented(options: { id: string; label: string; icon?: IconNode }[], value: string, onPick: (id: string) => void, cls = '') {
  return h(
    'div',
    { class: `segmented ${cls}`, role: 'tablist' },
    ...options.map((o) =>
      h(
        'button',
        { class: o.id === value ? 'active' : '', role: 'tab', 'aria-selected': String(o.id === value), onClick: () => onPick(o.id) },
        o.icon ? icon(o.icon, 16) : null,
        h('span', {}, o.label),
      ),
    ),
  );
}

/** Row of a dropdown menu (project menu, selection "more" menu). */
export function menuItem(node: IconNode, label: string, run: () => void, opts: { kbd?: string; on?: boolean } = {}) {
  return h(
    'button',
    { class: `menu-item ${opts.on ? 'on' : ''}`, onClick: run },
    icon(node, 18),
    h('span', {}, label),
    opts.kbd ? h('kbd', {}, opts.kbd) : opts.on !== undefined ? h('i', { class: 'menu-check' }) : null,
  );
}

/** Big round camera shutter (photo mode and AR). */
export function shutterButton(label: string, onClick: () => void) {
  return h('button', { class: 'shutter', title: label, 'aria-label': label, onClick }, h('i', {}));
}

/** White flash over a container, as feedback for a photo. */
export function flashScreen(parent: HTMLElement) {
  const flash = h('div', { class: 'flash' });
  parent.append(flash);
  setTimeout(() => flash.remove(), 500);
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

/** Number field that commits on Enter/blur. */
export function numberInput(label: string, value: number, opts: { step?: number; suffix?: string }, onCommit: (v: number) => void) {
  const input = h('input', { type: 'number', value: String(+value.toFixed(4)), step: opts.step ? String(opts.step) : 'any', inputmode: 'decimal' });
  input.addEventListener('change', () => {
    const v = parseFloat(input.value.replace(',', '.'));
    if (Number.isFinite(v)) onCommit(v);
  });
  return h('label', { class: 'num' }, h('span', {}, label), h('div', { class: 'num-field' }, input, opts.suffix ? h('em', {}, opts.suffix) : null));
}
