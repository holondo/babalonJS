import type { Vector3 } from '@babylonjs/core';
import type { Editor } from './editor';
import { h } from './dom';

/**
 * Joint handles drawn over the 3D view (posing and rigging): a dot per joint, lines from each
 * joint to its parent, tap to pick, optional drag. Sized in screen pixels so they stay easy to
 * hit with a finger at any zoom; positions follow the scene only when it renders.
 */

export interface OverlayJoint {
  id: string;
  /** Current world position. */
  position: () => Vector3;
  parent?: string;
  label: string;
  /** Extra class: `active`, `ik`, `side`… */
  cls?: string;
}

export interface OverlayHandlers {
  onPick?: (id: string) => void;
  /** Dragging a handle (screen position in CSS pixels relative to the canvas). */
  onDragStart?: (id: string) => void;
  onDrag?: (id: string, x: number, y: number) => void;
  onDragEnd?: (id: string) => void;
}

const SVG = 'http://www.w3.org/2000/svg';

export class JointOverlay {
  readonly el = h('div', { class: 'joint-layer' });
  private readonly svg = document.createElementNS(SVG, 'svg');
  private joints: OverlayJoint[] = [];
  private dots = new Map<string, HTMLElement>();
  private lines: { line: SVGLineElement; a: string; b: string }[] = [];
  private readonly editor: Editor;
  private handlers: OverlayHandlers = {};

  constructor(editor: Editor) {
    this.editor = editor;
    this.el.append(this.svg);
  }

  /** Replaces the handles (empty list hides the overlay). */
  set(joints: OverlayJoint[], handlers: OverlayHandlers = {}) {
    this.joints = joints;
    this.handlers = handlers;
    this.dots.clear();
    this.lines = [];
    this.svg.replaceChildren();
    this.el.replaceChildren(this.svg);
    const ids = new Set(joints.map((j) => j.id));
    for (const j of joints) {
      if (j.parent && ids.has(j.parent)) {
        const line = document.createElementNS(SVG, 'line');
        this.svg.append(line);
        this.lines.push({ line, a: j.parent, b: j.id });
      }
      const dot = h('button', { class: `joint ${j.cls ?? ''}`, title: j.label, 'aria-label': j.label });
      this.bind(dot, j.id);
      this.el.append(dot);
      this.dots.set(j.id, dot);
    }
    this.el.classList.toggle('show', joints.length > 0);
    this.update();
  }

  clear() {
    if (this.joints.length) this.set([]);
  }

  /** Moves the handles to where their joints are on screen. */
  update() {
    if (!this.joints.length) return;
    const pos = new Map<string, { x: number; y: number; visible: boolean }>();
    for (const j of this.joints) {
      const s = this.editor.toScreen(j.position());
      // A canvas without size (hidden, resizing) gives no position: hide instead of drawing NaN
      if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) s.visible = false;
      pos.set(j.id, s);
      const dot = this.dots.get(j.id)!;
      dot.style.display = s.visible ? '' : 'none';
      dot.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -50%)`;
    }
    for (const { line, a, b } of this.lines) {
      const p = pos.get(a)!;
      const q = pos.get(b)!;
      line.style.display = p.visible && q.visible ? '' : 'none';
      if (!p.visible || !q.visible) continue;
      line.setAttribute('x1', String(p.x));
      line.setAttribute('y1', String(p.y));
      line.setAttribute('x2', String(q.x));
      line.setAttribute('y2', String(q.y));
    }
  }

  /** Tap picks; with drag handlers, moving the finger/mouse drags the joint. */
  private bind(dot: HTMLElement, id: string) {
    let drag: { pointer: number; x: number; y: number; moved: boolean } | null = null;
    dot.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      drag = { pointer: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
      dot.setPointerCapture(e.pointerId);
    });
    dot.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.pointer || !this.handlers.onDrag) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
      if (!drag.moved) {
        drag.moved = true;
        dot.classList.add('dragging');
        this.handlers.onDragStart?.(id);
      }
      const r = this.el.getBoundingClientRect();
      this.handlers.onDrag(id, e.clientX - r.left, e.clientY - r.top);
      this.editor.invalidate();
    });
    const end = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.pointer) return;
      const moved = drag.moved;
      drag = null;
      dot.classList.remove('dragging');
      if (moved) this.handlers.onDragEnd?.(id);
      else this.handlers.onPick?.(id);
    };
    dot.addEventListener('pointerup', end);
    dot.addEventListener('pointercancel', end);
  }
}
