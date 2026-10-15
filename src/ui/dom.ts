import { ChevronLeft, ChevronRight, createElement } from 'lucide';
import type { IconNode } from 'lucide';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { tr } from '../core/i18n';

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
      onClick: () => {
        haptic('light');
        onClick();
      },
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
  return h(
    'button',
    {
      class: `btn ${opts.cls ?? ''} ${opts.active ? 'active' : ''}`,
      onClick: () => {
        haptic('light');
        onClick();
      },
    },
    opts.icon ? icon(opts.icon, 18) : null,
    h('span', {}, label),
  );
}

/** Tactile micro-haptic on mobile (Android Capacitor / PWA). */
export function haptic(type: 'light' | 'selection' | 'medium' = 'light') {
  const fallback = () => {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        if (type === 'light') navigator.vibrate(25);
        else if (type === 'selection') navigator.vibrate(35);
        else if (type === 'medium') navigator.vibrate(50);
      }
    } catch { /* Ignore if device blocks vibration */ }
  };
  try {
    if (Capacitor.isNativePlatform()) {
      const p = type === 'selection'
        ? Haptics.selectionChanged()
        : Haptics.impact({ style: type === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light });
      p.catch(() => fallback());
      return;
    }
    fallback();
  } catch {
    fallback();
  }
}

export function chips<T extends string>(options: { value: T; label: string }[], value: T, onPick: (v: T) => void) {
  const el = h('div', { class: 'chips' });
  el.append(...options.map((o) => h('button', {
    class: `chip ${o.value === value ? 'active' : ''}`,
    'aria-pressed': String(o.value === value),
    onClick: (event: Event) => {
      haptic('light');
      // Some controls change only transient tool state, so they don't rebuild their panel.
      for (const button of el.querySelectorAll('button')) {
        const active = button === event.currentTarget;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      }
      onPick(o.value);
    },
  }, o.label)));
  return el;
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
    'aria-label': label,
  });
  const updateFill = () => {
    const min = parseFloat(input.min);
    const max = parseFloat(input.max);
    const pct = ((parseFloat(input.value) - min) / (max - min || 1)) * 100;
    input.style.setProperty('--val-pct', `${Math.max(0, Math.min(100, pct))}%`);
  };
  const update = () => {
    updateFill();
    const v = from(parseFloat(input.value));
    out.textContent = fmt(v);
    onInput(v);
  };
  input.addEventListener('input', update);
  input.addEventListener('change', () => opts.onCommit?.());
  updateFill();
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
      try { track.setPointerCapture(e.pointerId); } catch { /* ignore if already released */ }
      track.classList.add('dragging');
      haptic('light');
    }
    const min = parseFloat(input.min);
    const max = parseFloat(input.max);
    const step = parseFloat(input.step);
    const width = track.clientWidth || 1;
    let val = Math.min(max, Math.max(min, drag.value + (dx / width) * (max - min)));
    if (Number.isFinite(step) && step > 0) {
      val = Math.round((val - min) / step) * step + min;
    }
    input.value = String(+val.toFixed(6));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const end = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.active) input.dispatchEvent(new Event('change', { bubbles: true }));
    track.classList.remove('dragging');
    if (track.hasPointerCapture(e.pointerId)) {
      try { track.releasePointerCapture(e.pointerId); } catch { /* ignore if already released */ }
    }
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
        {
          class: o.id === value ? 'active' : '',
          role: 'tab',
          'aria-selected': String(o.id === value),
          onClick: () => {
            haptic('light');
            onPick(o.id);
          },
        },
        o.icon ? icon(o.icon, 16) : null,
        h('span', {}, o.label),
      ),
    ),
  );
}

/** Panel tabs keep explicit scroll controls whenever some tabs are outside the visible row. */
export function scrollableSegmented(options: { id: string; label: string; icon?: IconNode }[], value: string, onPick: (id: string) => void) {
  const track = segmented(options, value, onPick);
  const move = (direction: number) => track.scrollBy({
    left: direction * Math.max(96, track.clientWidth * .75),
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  });
  const previous = iconButton(ChevronLeft, tr('Previous tabs'), () => move(-1), { cls: 'tab-scroll-button' });
  const next = iconButton(ChevronRight, tr('More tabs'), () => move(1), { cls: 'tab-scroll-button' });
  previous.hidden = next.hidden = true;
  const el = h('div', { class: 'tab-scroll' }, previous, track, next);
  const update = () => {
    const overflow = track.scrollWidth > el.clientWidth + 1;
    previous.hidden = next.hidden = !overflow;
    previous.disabled = track.scrollLeft <= 1;
    next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 1;
  };
  track.addEventListener('scroll', update, { passive: true });
  const observer = new ResizeObserver(() => {
    if (!el.isConnected) observer.disconnect(); else update();
  });
  observer.observe(el);
  requestAnimationFrame(() => {
    if (!el.isConnected) { observer.disconnect(); return; }
    update();
    const selected = track.querySelector('[aria-selected="true"]')?.getBoundingClientRect();
    const bounds = track.getBoundingClientRect();
    if (selected) {
      if (selected.right > bounds.right - 3) track.scrollLeft += Math.ceil(selected.right - bounds.right + 3);
      else if (selected.left < bounds.left + 3) track.scrollLeft -= Math.ceil(bounds.left + 3 - selected.left);
    }
    update();
  });
  return el;
}

/** Row of a dropdown menu (project menu, selection "more" menu). */
export function menuItem(node: IconNode, label: string, run: () => void, opts: { kbd?: string; on?: boolean; description?: string } = {}) {
  return h(
    'button',
    {
      class: `menu-item ${opts.on ? 'on' : ''} ${opts.description ? 'described' : ''}`,
      onClick: () => {
        haptic('light');
        run();
      },
    },
    icon(node, 18),
    h('span', {}, label, opts.description ? h('small', {}, opts.description) : null),
    opts.kbd ? h('kbd', {}, opts.kbd) : opts.on !== undefined ? h('i', { class: 'menu-check' }) : null,
  );
}

/** Big round camera shutter (photo mode and AR). */
export function shutterButton(label: string, onClick: () => void) {
  return h(
    'button',
    {
      class: 'shutter',
      title: label,
      'aria-label': label,
      onClick: () => {
        haptic('medium');
        onClick();
      },
    },
    h('i', {}),
  );
}

/** White flash over a container, as feedback for a photo. */
export function flashScreen(parent: HTMLElement) {
  const flash = h('div', { class: 'flash' });
  parent.append(flash);
  setTimeout(() => flash.remove(), 500);
}

export function colorInput(label: string, value: string, onInput: (hex: string) => void, onCommit?: () => void) {
  const input = h('input', { type: 'color', value, 'aria-label': label });
  input.addEventListener('input', () => onInput(input.value));
  input.addEventListener('change', () => onCommit?.());
  return h('label', { class: 'color' }, h('span', {}, label), input);
}

export function toggle(label: string, value: boolean, onChange: (v: boolean) => void) {
  const input = h('input', { type: 'checkbox', checked: value });
  input.addEventListener('change', () => {
    haptic('selection');
    onChange(input.checked);
  });
  return h('label', { class: 'toggle' }, h('span', {}, label), input, h('i', {}));
}

export function select(label: string, options: { value: string; label: string }[], value: string, onChange: (v: string) => void) {
  const sel = h('select', { 'aria-label': label }, ...options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)));
  sel.addEventListener('change', () => onChange(sel.value));
  return h('label', { class: 'select' }, h('span', {}, label), sel);
}

export function hint(text: string) {
  return h('p', { class: 'hint' }, text);
}

/** Number field with quick decrement/increment stepper buttons. */
export function numberInput(label: string, value: number, opts: { step?: number; suffix?: string }, onCommit: (v: number) => void) {
  const step = opts.step ?? 1;
  const input = h('input', { type: 'number', value: String(+value.toFixed(4)), step: String(step), inputmode: 'decimal', 'aria-label': label });
  let lastCommitted: number | null = Number.isFinite(value) ? +value.toFixed(4) : null;
  const commit = (delta?: number, vibrate = true) => {
    let v = parseFloat(input.value.replace(',', '.'));
    if (delta !== undefined) {
      v = +(v + delta).toFixed(4);
      input.value = String(v);
    }
    if (Number.isFinite(v) && v !== lastCommitted) {
      lastCommitted = v;
      onCommit(v);
      if (vibrate) haptic('light');
    }
  };
  input.addEventListener('change', () => commit(undefined, false));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      commit(undefined, true);
      input.blur();
    }
  });
  const btnMinus = h('button', {
    type: 'button',
    class: 'num-step minus',
    title: tr('Decrease'),
    'aria-label': tr('Decrease'),
    onClick: (e: Event) => { e.preventDefault(); e.stopPropagation(); commit(-step, true); },
  }, '−');
  const btnPlus = h('button', {
    type: 'button',
    class: 'num-step plus',
    title: tr('Increase'),
    'aria-label': tr('Increase'),
    onClick: (e: Event) => { e.preventDefault(); e.stopPropagation(); commit(step, true); },
  }, '+');
  const lab = h('span', { class: 'num-label', title: tr('Drag to adjust, tap to edit') }, label);
  let scrub: { x: number; val: number; active: boolean } | null = null;
  lab.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    scrub = { x: e.clientX, val: parseFloat(input.value.replace(',', '.')) || 0, active: false };
  });
  lab.addEventListener('pointermove', (e) => {
    if (!scrub) return;
    const dx = e.clientX - scrub.x;
    if (!scrub.active) {
      if (Math.abs(dx) < 6) return;
      scrub.active = true;
      try { lab.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      haptic('light');
    }
    const delta = dx * step * 0.05;
    const next = +(scrub.val + delta).toFixed(4);
    input.value = String(next);
  });
  const endScrub = (e: PointerEvent) => {
    if (!scrub) return;
    if (scrub.active) {
      commit(undefined, false);
      try {
        if (lab.hasPointerCapture(e.pointerId)) {
          lab.releasePointerCapture(e.pointerId);
        }
      } catch { /* ignore */ }
      haptic('light');
    }
    scrub = null;
  };
  lab.addEventListener('pointerup', endScrub);
  lab.addEventListener('pointercancel', endScrub);
  return h('label', { class: 'num' }, lab, h('div', { class: 'num-field' }, btnMinus, input, opts.suffix ? h('em', {}, opts.suffix) : null, btnPlus));
}

/** Progress of a long task (0–1), with its message. */
export function progressBar(fraction: number | null, label: string) {
  return h(
    'div',
    { class: `progress${fraction === null ? ' indeterminate' : ''}`, role: 'progressbar', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': '100', ...(fraction === null ? {} : { 'aria-valuenow': String(Math.round(fraction * 100)) }) },
    h('i', { style: `width: ${Math.round(Math.max(0, Math.min(1, fraction ?? 1)) * 100)}%` }),
    h('span', {}, label),
  );
}

/**
 * Numbered steps of a process. Steps up to `reachable` (index) can be picked; the current one is
 * highlighted and earlier ones are marked done.
 */
export function stepper(labels: string[], current: number, onPick: (index: number) => void, reachable = current) {
  return h(
    'ol',
    { class: 'stepper' },
    ...labels.map((label, i) =>
      h(
        'li',
        { class: i === current ? 'active' : i < current ? 'done' : '' },
        h(
          'button',
          { disabled: i === current || i > reachable, 'aria-current': i === current ? 'step' : undefined, onClick: () => onPick(i) },
          h('b', {}, String(i + 1)),
          h('span', {}, label),
        ),
      ),
    ),
  );
}
