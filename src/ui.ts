import {
  Aperture,
  ArrowDownToLine,
  Box,
  Camera,
  Copy,
  Crosshair,
  Download,
  FilePlus,
  FolderOpen,
  Save,
  Eye,
  EyeOff,
  Focus,
  Layers,
  Lightbulb,
  Magnet,
  Maximize,
  Mountain,
  Move3d,
  Palette,
  Pause,
  Play,
  Plus,
  Redo2,
  Rotate3d,
  RotateCcw,
  Scale3d,
  Scan,
  SlidersHorizontal,
  Sun,
  Trash2,
  Undo2,
  Upload,
  X,
} from 'lucide';
import type { IconNode } from 'lucide';
import { Color3, Material, PBRMaterial, Quaternion, StandardMaterial, Vector3 } from '@babylonjs/core';
import type { SpotLight, PointLight } from '@babylonjs/core';
import {
  ASPECTS,
  DEFAULT_PHOTO,
  ENV_PRESETS,
  MODEL_EXTENSIONS,
  SAMPLE_MODELS,
  aspectRect,
} from './editor';
import type { Editor, Entity, GroundMode, LightType, PhotoSettings, PrimitiveType, Tool } from './editor';
import { PROJECT_EXT, fromZip, loadAutosave, restore, saveAutosave, snapshot, toZip } from './project';
import type { ProjectSnapshot } from './project';
import { LANGS, getLang, locale, setLang, tr } from './i18n';
import type { Lang } from './i18n';
import { button, chips, colorInput, h, hint, icon, iconButton, row, section, select, slider, toggle } from './dom';

type Tab = 'add' | 'scene' | 'material' | 'lights' | 'env' | 'photo';

const TABS: { id: Tab; label: string; icon: IconNode }[] = [
  { id: 'add', label: 'Add', icon: Plus },
  { id: 'scene', label: 'Scene', icon: Layers },
  { id: 'material', label: 'Material', icon: Palette },
  { id: 'lights', label: 'Lights', icon: Lightbulb },
  { id: 'env', label: 'Environment', icon: Mountain },
  { id: 'photo', label: 'Photo', icon: Aperture },
];

const FILTERS: { id: string; label: string; values: Partial<PhotoSettings> }[] = [
  { id: 'none', label: 'Original', values: {} },
  { id: 'cinema', label: 'Cinema', values: { contrast: 1.25, saturation: 10, temperature: 10, vignette: 0.7, grain: 6, aspect: '2.39' } },
  { id: 'bw', label: 'B&W', values: { saturation: -100, contrast: 1.35, grain: 12, vignette: 0.6 } },
  { id: 'vintage', label: 'Vintage', values: { saturation: -35, temperature: 45, contrast: 0.95, vignette: 1.1, grain: 18 } },
  { id: 'neon', label: 'Neon', values: { saturation: 40, bloom: 0.8, bloomThreshold: 0.45, chromatic: 8, vignette: 0.8 } },
  { id: 'dream', label: 'Dream', values: { exposure: 1.2, contrast: 0.9, bloom: 0.6, bloomThreshold: 0.3, temperature: 15 } },
  { id: 'cold', label: 'Cold', values: { temperature: -40, contrast: 1.15, saturation: -10 } },
];

const LIGHT_PRESETS = [
  { id: 'studio', label: 'Studio' },
  { id: 'daylight', label: 'Daylight' },
  { id: 'sunset', label: 'Sunset' },
  { id: 'neon', label: 'Neon' },
  { id: 'dramatic', label: 'Dramatic' },
];

const KIND_ICON: Record<Entity['kind'], IconNode> = { model: Box, primitive: Box, light: Lightbulb };
const deg = (r: number) => (r * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;

export class UI {
  private tab: Tab | null = null;
  private busy = false;
  private materialIndex = 0;
  private photoPanel = false;
  private projectName = tr('my-scene');
  private menuOpen = false;
  /** Autosaved session found when the app opens (offered to continue). */
  private autosaved: ProjectSnapshot | null = null;
  private autosaveTimer = 0;
  private restoring = false;
  private readonly menu = h('div', { class: 'menu' });
  private readonly projectInput = h('input', { type: 'file', accept: `${PROJECT_EXT},.zip`, hidden: true });

  private readonly topbar = h('header', { class: 'topbar' });
  private readonly dock = h('nav', { class: 'dock' });
  private readonly panel = h('aside', { class: 'panel' });
  private readonly selbar = h('div', { class: 'selbar' });
  private readonly photoHud = h('div', { class: 'photo-hud' });
  private readonly frame = h('div', { class: 'frame' });
  private readonly empty = h('div', { class: 'empty' });
  private readonly loader = h('div', { class: 'loader' });
  private readonly toasts = h('div', { class: 'toasts' });
  private readonly dropzone = h('div', { class: 'dropzone' }, icon(Upload, 40), h('p', {}, tr('Drop your 3D files here')));
  private readonly fileInput = h('input', {
    type: 'file',
    multiple: true,
    accept: MODEL_EXTENSIONS.map((e) => '.' + e).join(',') + ',.bin,.png,.jpg,.jpeg,.webp,.ktx2,.mtl',
    hidden: true,
  });

  private readonly editor: Editor;
  private readonly root: HTMLElement;

  constructor(editor: Editor, root: HTMLElement) {
    this.editor = editor;
    this.root = root;
    root.append(this.menu, this.projectInput);
    this.projectInput.addEventListener('change', () => {
      const file = this.projectInput.files?.[0];
      this.projectInput.value = '';
      if (file) this.openProjectFile(file);
    });
    document.addEventListener('pointerdown', (e) => {
      if (this.menuOpen && !this.menu.contains(e.target as Node) && !(e.target as Element).closest?.('.project-btn')) this.toggleMenu(false);
    });
    this.setupAutosave();
    root.append(this.frame, this.topbar, this.selbar, this.panel, this.dock, this.photoHud, this.empty, this.loader, this.toasts, this.dropzone, this.fileInput);
    this.fileInput.addEventListener('change', () => {
      const files = [...(this.fileInput.files ?? [])];
      this.fileInput.value = '';
      if (files.length) this.loadFiles(files);
    });
    this.setupDragDrop();
    this.setupKeys();

    editor.changed.add((kind) => {
      if (kind === 'history') return this.renderTopbar();
      if (kind === 'photo') return this.renderAll();
      if (kind === 'tool') return this.renderSelbar();
      if (kind === 'env' && editor.photoMode) {
        this.renderPhotoHud();
        this.renderFrame();
      }
      if (this.busy) return;
      if (kind === 'env' && this.tab !== 'env' && this.tab !== 'photo' && this.tab !== 'lights') return;
      this.renderAll();
    });
    editor.loading.add((l) => {
      this.loader.classList.toggle('show', !!l);
      if (l) this.loader.replaceChildren(h('div', { class: 'spinner' }), h('span', {}, tr('Loading {name}… {pct}%', { name: l.name, pct: Math.round(l.progress * 100) })));
    });
    new ResizeObserver(() => this.renderFrame()).observe(root);
    this.renderAll();
  }

  /** Runs a UI action without triggering a re-render (avoids losing the slider being dragged). */
  private quiet(fn: () => void) {
    this.busy = true;
    try {
      fn();
    } finally {
      this.busy = false;
    }
  }

  toast(text: string, kind: 'info' | 'error' = 'info') {
    const t = h('div', { class: `toast ${kind}` }, text);
    this.toasts.append(t);
    setTimeout(() => t.classList.add('out'), 3200);
    setTimeout(() => t.remove(), 3700);
  }

  private async loadFiles(files: File[]) {
    const project = files.find((f) => f.name.toLowerCase().endsWith(PROJECT_EXT));
    if (project) return this.openProjectFile(project);
    try {
      await this.editor.addFiles(files);
    } catch (e) {
      this.toast(errorMessage(e), 'error');
    }
  }

  private setupDragDrop() {
    let depth = 0;
    window.addEventListener('dragenter', (e) => {
      e.preventDefault();
      depth++;
      this.dropzone.classList.add('show');
    });
    window.addEventListener('dragleave', () => {
      if (--depth <= 0) this.dropzone.classList.remove('show');
    });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      depth = 0;
      this.dropzone.classList.remove('show');
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) this.loadFiles(files);
    });
  }

  private setupKeys() {
    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement;
      if (target.matches('input[type=text], input:not([type]), textarea, select')) return;
      const ed = this.editor;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? ed.redo() : ed.undo();
      } else if (ctrl && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        ed.redo();
      } else if (ctrl && e.key.toLowerCase() === 's') {
        e.preventDefault();
        this.saveProject();
      } else if (ctrl && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        this.projectInput.click();
      } else if (ctrl && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        ed.duplicate();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        ed.remove();
      } else if (e.key === 'Escape') {
        if (ed.photoMode) ed.setPhotoMode(false);
        else ed.select(null);
      } else if (e.key === 'w' || e.key === 'g') ed.setTool('move');
      else if (e.key === 'e' || e.key === 'r') ed.setTool('rotate');
      else if (e.key === 's') ed.setTool('scale');
      else if (e.key === 'f') ed.selected ? ed.focus() : ed.frameAll();
      else if (e.key === 'p') ed.setPhotoMode(!ed.photoMode);
    });
  }

  private renderAll() {
    document.body.classList.toggle('photo', this.editor.photoMode);
    this.renderTopbar();
    this.renderDock();
    this.renderSelbar();
    this.renderPanel();
    this.renderPhotoHud();
    this.renderFrame();
    const hasObjects = this.editor.entities.some((e) => e.kind !== 'light');
    this.empty.classList.toggle('show', !hasObjects && !this.editor.photoMode);
    const saved = this.autosaved;
    this.empty.replaceChildren(
      h('h2', {}, tr('Build your scene')),
      ...(saved
        ? [
            button(tr('Continue where you left off'), () => this.loadSnapshot(saved), { icon: RotateCcw, cls: 'primary' }),
            h('small', { class: 'saved-at' }, tr('Last edited {date}', { date: new Date(saved.json.savedAt).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' }) })),
          ]
        : []),
      h('p', {}, tr('Drag GLB, glTF, OBJ, FBX, STL… files here or')),
      button(tr('Choose files'), () => this.fileInput.click(), { icon: Upload, cls: saved ? '' : 'primary' }),
      button(tr('Open project'), () => this.projectInput.click(), { icon: FolderOpen, cls: 'ghost' }),
      button(tr('Browse sample models'), () => this.openTab('add'), { cls: 'ghost' }),
    );
  }

  private renderTopbar() {
    const ed = this.editor;
    this.topbar.replaceChildren(
      h('div', { class: 'brand' }, h('b', {}, 'babalon'), h('span', {}, 'JS')),
      h(
        'div',
        { class: 'top-actions' },
        iconButton(Undo2, tr('Undo (Ctrl+Z)'), () => ed.undo(), { disabled: !ed.canUndo }),
        iconButton(Redo2, tr('Redo (Ctrl+Y)'), () => ed.redo(), { disabled: !ed.canRedo }),
        iconButton(Scan, tr('Frame all (F)'), () => ed.frameAll()),
        iconButton(FolderOpen, tr('Project: open, save, export'), () => this.toggleMenu(), { cls: 'project-btn', active: this.menuOpen }),
        iconButton(Maximize, tr('Fullscreen'), () => toggleFullscreen()),
        iconButton(Camera, tr('Photo mode (P)'), () => ed.setPhotoMode(true), { cls: 'accent' }),
      ),
    );
  }

  // ---------- Project ----------

  private hasContent() {
    return this.editor.entities.some((e) => e.kind !== 'light');
  }

  private toggleMenu(open = !this.menuOpen) {
    this.menuOpen = open;
    this.menu.classList.toggle('show', open);
    this.renderTopbar();
    if (!open) return;
    const name = h('input', { type: 'text', class: 'name', value: this.projectName, 'aria-label': tr('Project name') });
    name.addEventListener('change', () => (this.projectName = name.value.trim() || tr('my-scene')));
    const item = (node: IconNode, label: string, kbd: string, fn: () => void) =>
      h('button', { class: 'menu-item', onClick: () => (this.toggleMenu(false), fn()) }, icon(node, 18), h('span', {}, label), kbd ? h('kbd', {}, kbd) : null);
    this.menu.replaceChildren(
      h('label', { class: 'menu-name' }, h('span', {}, tr('Project name')), name),
      h('div', { class: 'menu-name' }, h('span', {}, getLang() === 'en' ? 'Language' : `${tr('Language')} · Language`), chips(LANGS, getLang(), (v) => this.setLanguage(v))),
      item(FilePlus, tr('New project'), '', () => this.newProject()),
      item(FolderOpen, tr('Open project…'), 'Ctrl+O', () => this.projectInput.click()),
      item(Save, tr('Save project'), 'Ctrl+S', () => this.saveProject()),
      item(Download, tr('Export scene .glb'), '', () => this.exportGLB()),
      h('p', { class: 'hint' }, tr('The project ({ext}) stores models, materials, lights, environment, effects and camera. The scene is also saved automatically in this browser.', { ext: PROJECT_EXT })),
    );
  }

  private setLanguage(value: Lang) {
    setLang(value);
    this.renderAll();
    this.toggleMenu(true);
  }

  private async saveProject() {
    try {
      const blob = await toZip(snapshot(this.editor, this.projectName));
      await this.deliver(blob, fileSafe(this.projectName) + PROJECT_EXT);
      this.toast(tr('Project saved'));
    } catch (e) {
      this.toast(errorMessage(e), 'error');
    }
  }

  private async openProjectFile(file: File) {
    if (this.hasContent() && !confirm(tr('Opening the project will replace the current scene. Continue?'))) return;
    try {
      const snap = await fromZip(file);
      if (!snap.json.name) snap.json.name = file.name.replace(/\.[^.]+$/, '');
      await this.loadSnapshot(snap);
    } catch (e) {
      this.toast(errorMessage(e), 'error');
    }
  }

  private async loadSnapshot(snap: ProjectSnapshot) {
    this.restoring = true;
    clearTimeout(this.autosaveTimer);
    try {
      const missing = await restore(this.editor, snap);
      this.projectName = snap.json.name || tr('my-scene');
      if (missing.length) this.toast(tr('Could not load: {names}', { names: missing.join(', ') }), 'error');
      else this.toast(tr('Project opened'));
    } finally {
      this.restoring = false;
      this.autosaved = null;
      this.renderAll();
      this.scheduleAutosave();
    }
  }

  private newProject() {
    if (this.hasContent() && !confirm(tr('Start a new project? The current scene will be discarded.'))) return;
    this.editor.newScene();
    this.projectName = tr('my-scene');
    this.autosaved = null;
    this.scheduleAutosave();
  }

  private setupAutosave() {
    this.editor.changed.add((kind) => {
      if (kind === 'entities' || kind === 'transform' || kind === 'env' || kind === 'history') this.scheduleAutosave();
    });
    // Material tweaks and the like don't emit editor events: save when a control is released
    this.panel.addEventListener('change', () => this.scheduleAutosave());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && this.autosaveTimer) this.autosaveNow();
    });
    loadAutosave().then((snap) => {
      if (snap && !this.hasContent() && snap.json.entities.some((e) => e.kind !== 'light')) {
        this.autosaved = snap;
        this.renderAll();
      }
    });
  }

  private scheduleAutosave() {
    if (this.restoring) return;
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => this.autosaveNow(), 1500);
  }

  private autosaveNow() {
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = 0;
    if (this.restoring) return;
    // The first write replaces the previous session, so it is no longer offered
    this.autosaved = null;
    saveAutosave(snapshot(this.editor, this.projectName)).catch((e) => console.warn('Autosave failed', e));
  }

  /** Hands a file to the user: share sheet on phones (when possible) or download. */
  private async deliver(blob: Blob, name: string) {
    const file = new File([blob], name, { type: blob.type });
    if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] }).catch(() => {});
      return;
    }
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  private async exportGLB() {
    try {
      await this.editor.exportGLB();
      this.toast(tr('Scene exported as scene.glb'));
    } catch (e) {
      this.toast(errorMessage(e), 'error');
    }
  }

  private openTab(tab: Tab | null) {
    this.tab = this.tab === tab ? null : tab;
    this.renderDock();
    this.renderPanel();
  }

  private renderDock() {
    this.dock.replaceChildren(
      ...TABS.map((t) =>
        h(
          'button',
          { class: `tab ${this.tab === t.id ? 'active' : ''}`, onClick: () => this.openTab(t.id) },
          icon(t.icon, 22),
          h('span', {}, tr(t.label)),
        ),
      ),
    );
  }

  private renderSelbar() {
    const ed = this.editor;
    const e = ed.selected;
    this.selbar.classList.toggle('show', !!e && !ed.photoMode);
    if (!e) return this.selbar.replaceChildren();
    const toolBtn = (t: Tool, node: IconNode, label: string) =>
      iconButton(node, label, () => ed.setTool(t), { active: ed.tool === t, label, cls: 'tool' });
    this.selbar.replaceChildren(
      h('div', { class: 'sel-name' }, icon(KIND_ICON[e.kind], 16), h('span', {}, e.name)),
      h(
        'div',
        { class: 'sel-tools' },
        toolBtn('move', Move3d, tr('Move')),
        toolBtn('rotate', Rotate3d, tr('Rotate')),
        e.kind !== 'light' ? toolBtn('scale', Scale3d, tr('Scale')) : null,
        h('span', { class: 'sep' }),
        iconButton(Magnet, tr('Snap to grid'), () => ed.setSnap(!ed.snap), { active: ed.snap }),
        iconButton(Focus, tr('Focus camera'), () => ed.focus()),
        iconButton(Copy, tr('Duplicate (Ctrl+D)'), () => ed.duplicate()),
        iconButton(Trash2, tr('Delete (Del)'), () => ed.remove(), { cls: 'danger' }),
        iconButton(X, tr('Deselect'), () => ed.select(null)),
      ),
    );
  }

  private renderPanel() {
    const ed = this.editor;
    const tab: Tab | null = ed.photoMode ? (this.photoPanel ? 'photo' : null) : this.tab;
    this.panel.classList.toggle('show', !!tab);
    document.body.classList.toggle('panel-open', !!tab);
    if (!tab) return this.panel.replaceChildren();
    const title = tr(TABS.find((t) => t.id === tab)!.label);
    const scroll = this.panel.querySelector('.panel-body')?.scrollTop ?? 0;
    const body = h('div', { class: 'panel-body' }, ...this.panelContent(tab));
    this.panel.replaceChildren(
      h(
        'div',
        { class: 'panel-head' },
        h('h2', {}, title),
        iconButton(X, tr('Close'), () => (ed.photoMode ? ((this.photoPanel = false), this.renderAll()) : this.openTab(null))),
      ),
      body,
    );
    body.scrollTop = scroll;
  }

  private panelContent(tab: Tab): (Node | null)[] {
    switch (tab) {
      case 'add':
        return this.addPanel();
      case 'scene':
        return this.scenePanel();
      case 'material':
        return this.materialPanel();
      case 'lights':
        return this.lightsPanel();
      case 'env':
        return this.envPanel();
      case 'photo':
        return this.photoPanelContent();
    }
  }

  // ---------- Add ----------

  private addPanel() {
    const ed = this.editor;
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
          { class: 'upload', onClick: () => this.fileInput.click() },
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
                  this.toast(errorMessage(e), 'error');
                }
              },
            }, tr(m.label)),
          ),
        ),
      ),
      section(tr('Shapes'), h('div', { class: 'grid' }, ...prims.map((p) => h('button', { class: 'card', onClick: () => ed.addPrimitive(p.id) }, p.label)))),
      section(tr('Lights'), h('div', { class: 'grid' }, ...lights.map((l) => h('button', { class: 'card', onClick: () => ed.addLight(l.id) }, l.label)))),
    ];
  }

  // ---------- Scene ----------

  private scenePanel() {
    const ed = this.editor;
    const list = h(
      'ul',
      { class: 'outliner' },
      ...ed.entities.map((e) =>
        h(
          'li',
          { class: e === ed.selected ? 'active' : '', onClick: () => ed.select(e) },
          icon(KIND_ICON[e.kind], 16),
          h('span', {}, e.name),
          iconButton(e.visible ? Eye : EyeOff, e.visible ? tr('Hide') : tr('Show'), () => ed.setVisible(e, !e.visible), { cls: 'mini' }),
        ),
      ),
    );
    list.querySelectorAll('.mini').forEach((b) => b.addEventListener('click', (ev) => ev.stopPropagation()));
    const out: (Node | null)[] = [
      section(tr('Objects in scene'), ed.entities.length ? list : hint(tr('The scene is empty.')), row(button(tr('Clear scene'), () => confirm(tr('Remove everything from the scene?')) && ed.clearScene(), { icon: Trash2, cls: 'ghost' }))),
    ];
    const e = ed.selected;
    if (!e) {
      out.push(hint(tr('Tap an object in the scene to select it. Double-tap to focus.')));
      return out;
    }
    out.push(this.transformSection(e));
    if (e.kind === 'light') out.push(this.lightControls(e));
    else out.push(this.objectSection(e));
    return out;
  }

  private transformSection(e: Entity) {
    const ed = this.editor;
    const commit = () => this.quiet(() => ed.endTransform());
    const nameInput = h('input', { type: 'text', value: e.name, class: 'name' });
    nameInput.addEventListener('change', () => ed.rename(e, nameInput.value.trim()));
    const euler = ed.getEuler(e);
    const rot = { x: deg(euler.x), y: deg(euler.y), z: deg(euler.z) };
    const setRot = () => ed.editTransform((r) => r.rotationQuaternion!.copyFrom(Quaternion.FromEulerAngles(rad(rot.x), rad(rot.y), rad(rot.z))));
    const angle = { min: -180, max: 180, step: 1, format: (v: number) => `${Math.round(v)}°`, onCommit: commit };
    const turn = (axis: 'x' | 'y' | 'z') => () =>
      ed.editTransform((r) => {
        const axes = { x: Vector3.Right(), y: Vector3.Up(), z: Vector3.Forward() };
        r.rotationQuaternion = Quaternion.RotationAxis(axes[axis], Math.PI / 2).multiply(r.rotationQuaternion!);
      }, true);
    const p = e.root.position;
    return section(
      tr('Transform'),
      nameInput,
      slider(tr('Position X'), p.x, { min: -20, max: 20, step: 0.01, onCommit: commit }, (v) => ed.editTransform((r) => (r.position.x = v))),
      slider(tr('Height'), p.y, { min: -5, max: 20, step: 0.01, onCommit: commit }, (v) => ed.editTransform((r) => (r.position.y = v))),
      slider(tr('Position Z'), p.z, { min: -20, max: 20, step: 0.01, onCommit: commit }, (v) => ed.editTransform((r) => (r.position.z = v))),
      slider(tr('Turn (Y)'), rot.y, angle, (v) => ((rot.y = v), setRot())),
      slider(tr('Tilt (X)'), rot.x, angle, (v) => ((rot.x = v), setRot())),
      slider(tr('Roll (Z)'), rot.z, angle, (v) => ((rot.z = v), setRot())),
      e.kind !== 'light'
        ? slider(
            tr('Scale'),
            e.root.scaling.x,
            {
              min: -2,
              max: 1.3,
              step: 0.005,
              toSlider: (v) => Math.log10(Math.max(v, 0.01)),
              fromSlider: (v) => Math.pow(10, v),
              format: (v) => `${v.toFixed(2)}×`,
              onCommit: commit,
            },
            (v) => ed.editTransform((r) => r.scaling.scaleInPlace(v / (r.scaling.x || 1))),
          )
        : null,
      row(
        button('90° X', turn('x'), { cls: 'small' }),
        button('90° Y', turn('y'), { cls: 'small' }),
        button('90° Z', turn('z'), { cls: 'small' }),
      ),
      row(
        e.kind !== 'light' ? button(tr('Drop to floor'), () => ed.dropToGround(), { icon: ArrowDownToLine, cls: 'small' }) : null,
        button(tr('Reset'), () => ed.resetTransform(), { icon: RotateCcw, cls: 'small' }),
      ),
    );
  }

  private objectSection(e: Entity) {
    const ed = this.editor;
    const s = ed.stats(e);
    const nodes: (Node | null)[] = [
      toggle(tr('Casts shadow'), e.castShadows, (v) => ed.setCastShadows(e, v)),
      toggle(tr('Wireframe'), ed.materialsOf(e).some((m) => m.wireframe), (v) => ed.setWireframe(e, v)),
      h('p', { class: 'stats' }, tr('{vertices} vertices · {faces} faces · {materials} materials', { vertices: s.vertices.toLocaleString(locale()), faces: s.faces.toLocaleString(locale()), materials: s.materials })),
    ];
    if (e.animationGroups.length) {
      const playing = e.animationGroups.find((a) => a.isPlaying);
      const current = playing ?? e.animationGroups[0];
      nodes.push(
        select(
          tr('Animation'),
          e.animationGroups.map((a, i) => ({ value: String(i), label: a.name || tr('Animation {n}', { n: i + 1 }) })),
          String(e.animationGroups.indexOf(current)),
          (v) => {
            e.animationGroups.forEach((a) => a.stop());
            e.animationGroups[+v].start(true);
            this.renderPanel();
          },
        ),
        row(
          button(playing ? tr('Pause') : tr('Play'), () => {
            if (playing) playing.pause();
            else current.play(true);
            this.renderPanel();
          }, { icon: playing ? Pause : Play, cls: 'small' }),
        ),
        slider(tr('Speed'), current.speedRatio, { min: 0, max: 3, step: 0.05, format: (v) => `${v.toFixed(2)}×` }, (v) => e.animationGroups.forEach((a) => (a.speedRatio = v))),
      );
    }
    return section(tr('Object'), ...nodes);
  }

  // ---------- Material ----------

  private materialPanel() {
    const ed = this.editor;
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
          this.renderPanel();
        }),
      );
    }
    out.push(...this.materialControls(mat));
    return out;
  }

  private materialControls(mat: Material): (Node | null)[] {
    const q = (fn: () => void) => this.quiet(fn);
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

  // ---------- Lights ----------

  private lightsPanel() {
    const ed = this.editor;
    const lights = ed.entities.filter((e) => e.kind === 'light');
    const out: (Node | null)[] = [
      section(
        tr('Lighting presets'),
        h('div', { class: 'chips' }, ...LIGHT_PRESETS.map((p) => h('button', { class: 'chip', onClick: () => ed.applyLightPreset(p.id) }, tr(p.label)))),
        hint(tr('Replaces the current lights. Everything can be tweaked afterwards.')),
      ),
      section(
        tr('Add light'),
        row(
          button(tr('Point'), () => ed.addLight('point'), { icon: Lightbulb, cls: 'small' }),
          button(tr('Spotlight'), () => ed.addLight('spot'), { icon: Crosshair, cls: 'small' }),
          button(tr('Sun'), () => ed.addLight('directional'), { icon: Sun, cls: 'small' }),
        ),
      ),
      section(
        tr('Lights in scene'),
        lights.length
          ? h(
              'ul',
              { class: 'outliner' },
              ...lights.map((l) =>
                h('li', { class: l === ed.selected ? 'active' : '', onClick: () => ed.select(l) }, icon(Lightbulb, 16), h('span', {}, l.name), h('i', { class: 'swatch', style: `background:${l.light!.diffuse.toHexString()}` })),
              ),
            )
          : hint(tr('No lights — only the environment lights the scene.')),
      ),
    ];
    const sel = ed.selected;
    if (sel?.kind === 'light') out.push(this.lightControls(sel));
    else if (lights.length) out.push(hint(tr('Tap a light (in the list or in the scene) to adjust it. Drag it or use the gizmos to place it.')));
    return out;
  }

  private lightControls(e: Entity) {
    const ed = this.editor;
    const light = e.light!;
    const max = e.lightType === 'directional' ? 10 : 300;
    const targets = ed.entities.filter((x) => x.kind !== 'light');
    let aimId = '';
    return section(
      tr('Selected light'),
      colorInput(tr('Color'), light.diffuse.toHexString(), (v) => {
        const c = Color3.FromHexString(v);
        light.diffuse = c;
        light.specular = c;
        e.root.getChildMeshes().forEach((m) => ((m.material as StandardMaterial).emissiveColor = c));
        if (this.tab === 'lights') this.root.querySelector<HTMLElement>('.outliner li.active .swatch')?.style.setProperty('background', v);
      }),
      slider(tr('Intensity'), light.intensity, { min: 0, max, step: max / 300 }, (v) => (light.intensity = v)),
      e.lightType === 'spot'
        ? slider(tr('Cone angle'), deg((light as SpotLight).angle), { min: 5, max: 160, step: 1, format: (v) => `${Math.round(v)}°` }, (v) => ((light as SpotLight).angle = rad(v)))
        : null,
      e.lightType === 'spot'
        ? slider(tr('Edge softness'), (light as SpotLight).exponent, { min: 0, max: 50, step: 0.5 }, (v) => ((light as SpotLight).exponent = v))
        : null,
      e.lightType !== 'directional'
        ? slider(tr('Range'), Math.min((light as PointLight).range, 100), { min: 0.5, max: 100, step: 0.5 }, (v) => ((light as PointLight).range = v))
        : null,
      toggle(tr('Casts shadows'), !!e.shadowGen, (v) => ed.setLightShadows(e, v)),
      select(tr('Aim at'), [{ value: '', label: tr('Camera center') }, ...targets.map((t) => ({ value: String(t.id), label: t.name }))], '', (v) => (aimId = v)),
      row(
        button(tr('Aim'), () => ed.aimLightAtSelection(e, targets.find((t) => String(t.id) === aimId) ?? null), { icon: Crosshair, cls: 'small' }),
        button(tr('Delete light'), () => ed.remove(e), { icon: Trash2, cls: 'small danger' }),
      ),
    );
  }

  // ---------- Environment ----------

  private envPanel() {
    const ed = this.editor;
    const env = ed.env;
    const set = (p: Partial<typeof env>) => this.quiet(() => ed.applyEnv(p));
    return [
      section(
        tr('Environment lighting (HDR)'),
        chips(Object.entries(ENV_PRESETS).map(([value, p]) => ({ value, label: tr(p.label) })), env.preset, (v) => ed.applyEnv({ preset: v })),
        slider(tr('Intensity'), env.intensity, { min: 0, max: 3, step: 0.01 }, (v) => set({ intensity: v })),
        slider(tr('Rotation'), deg(env.rotation), { min: 0, max: 360, step: 1, format: (v) => `${Math.round(v)}°` }, (v) => set({ rotation: rad(v) })),
        slider(tr('Extra ambient light'), env.ambient, { min: 0, max: 2, step: 0.01 }, (v) => set({ ambient: v })),
      ),
      section(
        tr('Background'),
        toggle(tr('Show environment as background'), env.skybox, (v) => set({ skybox: v })),
        slider(tr('Background blur'), env.skyboxBlur, { min: 0, max: 1, step: 0.01 }, (v) => set({ skyboxBlur: v })),
        colorInput(tr('Solid color (no environment)'), env.background, (v) => set({ background: v })),
      ),
      section(
        tr('Floor'),
        chips<GroundMode>(
          [
            { value: 'shadow', label: tr('Shadow only') },
            { value: 'solid', label: tr('Solid') },
            { value: 'none', label: tr('None') },
          ],
          env.ground,
          (v) => ed.applyEnv({ ground: v }),
        ),
        env.ground === 'solid' ? colorInput(tr('Floor color'), env.groundColor, (v) => set({ groundColor: v })) : null,
        toggle(tr('Reference grid'), env.grid, (v) => set({ grid: v })),
      ),
    ];
  }

  // ---------- Photo ----------

  private photoPanelContent() {
    const ed = this.editor;
    const p = ed.photo;
    const set = (v: Partial<PhotoSettings>) => this.quiet(() => ed.setPhoto(v));
    const pct = (v: number) => `${Math.round(v)}`;
    return [
      ed.photoMode ? null : row(button(tr('Enter photo mode'), () => ed.setPhotoMode(true), { icon: Camera, cls: 'primary wide' })),
      section(tr('Filters'), chips(FILTERS.map((f) => ({ value: f.id, label: tr(f.label) })), '', (id) => ed.setPhoto({ ...DEFAULT_PHOTO, fov: p.fov, focusDistance: p.focusDistance, ...FILTERS.find((f) => f.id === id)!.values }))),
      section(
        tr('Camera'),
        slider(tr('Field of view'), p.fov, { min: 10, max: 110, step: 1, format: (v) => `${Math.round(v)}°` }, (v) => set({ fov: v })),
        chips(Object.entries(ASPECTS).map(([value, a]) => ({ value, label: tr(a.label) })), p.aspect, (v) => ed.setPhoto({ aspect: v })),
      ),
      section(
        tr('Light & color'),
        slider(tr('Exposure'), p.exposure, { min: 0.1, max: 3, step: 0.01 }, (v) => set({ exposure: v })),
        slider(tr('Contrast'), p.contrast, { min: 0.5, max: 2, step: 0.01 }, (v) => set({ contrast: v })),
        slider(tr('Saturation'), p.saturation, { min: -100, max: 100, step: 1, format: pct }, (v) => set({ saturation: v })),
        slider(tr('Temperature'), p.temperature, { min: -100, max: 100, step: 1, format: pct }, (v) => set({ temperature: v })),
        slider(tr('Vignette'), p.vignette, { min: 0, max: 2, step: 0.01 }, (v) => set({ vignette: v })),
      ),
      section(
        tr('Effects'),
        slider(tr('Bloom'), p.bloom, { min: 0, max: 2, step: 0.01 }, (v) => set({ bloom: v })),
        slider(tr('Bloom threshold'), p.bloomThreshold, { min: 0, max: 1.5, step: 0.01 }, (v) => set({ bloomThreshold: v })),
        slider(tr('Grain'), p.grain, { min: 0, max: 50, step: 0.5, format: pct }, (v) => set({ grain: v })),
        slider(tr('Chromatic aberration'), p.chromatic, { min: 0, max: 100, step: 1, format: pct }, (v) => set({ chromatic: v })),
        slider(tr('Sharpen'), p.sharpen, { min: 0, max: 1, step: 0.01 }, (v) => set({ sharpen: v })),
      ),
      section(
        tr('Depth of field'),
        toggle(tr('Blur background'), p.dof, (v) => ed.setPhoto({ dof: v })),
        p.dof ? slider(tr('Aperture (f)'), p.fStop, { min: 0.8, max: 16, step: 0.1, format: (v) => `f/${v.toFixed(1)}` }, (v) => set({ fStop: v })) : null,
        p.dof ? slider(tr('Focus distance'), p.focusDistance, { min: 0.2, max: 50, step: 0.05, format: (v) => `${v.toFixed(2)} m` }, (v) => set({ focusDistance: v })) : null,
        p.dof ? hint(tr('In photo mode, tap an object to focus on it.')) : null,
      ),
      row(button(tr('Reset to defaults'), () => ed.setPhoto({ ...DEFAULT_PHOTO }), { icon: RotateCcw, cls: 'ghost' })),
    ];
  }

  private renderPhotoHud() {
    const ed = this.editor;
    if (!ed.photoMode) return this.photoHud.replaceChildren();
    this.photoHud.replaceChildren(
      iconButton(X, tr('Exit photo mode'), () => ed.setPhotoMode(false), { cls: 'hud-exit' }),
      h(
        'div',
        { class: 'hud-bottom' },
        chips(Object.entries(ASPECTS).map(([value, a]) => ({ value, label: tr(a.label) })), ed.photo.aspect, (v) => ed.setPhoto({ aspect: v })),
        h(
          'div',
          { class: 'hud-row' },
          iconButton(SlidersHorizontal, tr('Adjustments'), () => {
            this.photoPanel = !this.photoPanel;
            this.renderPanel();
          }, { active: this.photoPanel }),
          h('button', { class: 'shutter', title: tr('Take photo'), 'aria-label': tr('Take photo'), onClick: () => this.capture() }, h('i', {})),
          iconButton(Scan, tr('Frame all'), () => ed.frameAll()),
        ),
      ),
    );
  }

  private async capture() {
    const flash = h('div', { class: 'flash' });
    this.root.append(flash);
    setTimeout(() => flash.remove(), 500);
    try {
      const blob = await this.editor.capture(2);
      const name = `babalon-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`;
      await this.deliver(blob, name);
      this.toast(tr('Photo saved!'));
    } catch (e) {
      this.toast(errorMessage(e), 'error');
    }
  }

  /** Photo aspect frame (dark bars + rule of thirds). */
  private renderFrame() {
    const ed = this.editor;
    const show = ed.photoMode;
    this.frame.classList.toggle('show', show);
    if (!show) return;
    const w = this.root.clientWidth;
    const hgt = this.root.clientHeight;
    const r = aspectRect(w, hgt, ed.photo.aspect);
    this.frame.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`;
  }
}

function fileSafe(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, '-').trim() || tr('my-scene');
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

function errorMessage(e: unknown) {
  if (e instanceof Error) return e.message;
  return String(e);
}
