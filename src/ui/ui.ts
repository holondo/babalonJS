import { ProjectGallery } from './projectGallery';
import {
  Camera,
  ChevronDown,
  Copy,
  Ellipsis,
  Download,
  Group,
  Orbit,
  MonitorDown,
  Ruler,
  FilePlus,
  FolderOpen,
  Save,
  Eye,
  EyeOff,
  Focus,
  Layers,
  Lightbulb,
  Magnet,
  Expand,
  Move3d,
  Pause,
  Play,
  PersonStanding,
  Plus,
  Redo2,
  Rotate3d,
  Scale3d,
  Shrink,
  Smartphone,
  Scan,
  Trash2,
  Undo2,
  Upload,
  View,
  X,
} from 'lucide';
import type { IconNode } from 'lucide';
import { MODEL_EXTENSIONS } from '../core/editor';
import type { Editor, Tool } from '../core/editor';
import { PROJECT_EXT, fromZip, listProjects, loadProject, restore, saveProject, snapshot, toZip } from '../core/project';
import type { ProjectSnapshot } from '../core/project';
import { JointOverlay } from './jointOverlay';
import { skeletonsOf } from '../rigging/humanoid';
import type { ARMode } from '../ar/ar';
import type { GyroControl } from '../device/gyro';
import { saveAndOfferShare, timestampedName } from '../core/files';
import { LANGS, getLang, setLang, tr } from '../core/i18n';
import type { Lang } from '../core/i18n';
import { button, chips, h, icon, iconButton, menuItem, segmented } from './dom';
import { AddPanel } from './panels/add';
import { ObjectsPanel } from './panels/objects';
import { MaterialPanel } from './panels/material';
import { AnimatePanel } from './panels/animate';
import { PosePanel } from './panels/pose';
import { RigPanel } from './panels/rig';
import { ToolsPanel } from './panels/tools';
import { OptimizePanel } from './panels/optimize';
import { analyzeScene, deviceBudget, formatBytes, overBudget } from '../optimize/analysis';
import { DEFAULT_OPTIMIZE } from '../optimize/optimizer';
import type { Observer } from '@babylonjs/core/Misc/observable.js';
import { LightPanel } from './panels/light';
import { PhotoMode } from './photo';
import { MeasureLabels } from './measureLabels';
import { KIND_ICON, fileSafe, toggleFullscreen, errorMessage } from './shared';
import type { Tab } from './shared';

/** Dock tabs. Photo isn't a tab: it's a mode, with its own panel inside photo mode. */
const TABS: { id: Exclude<Tab, 'photo'>; label: string; icon: IconNode }[] = [
  { id: 'add', label: 'Add', icon: Plus },
  { id: 'objects', label: 'Objects', icon: Layers },
  { id: 'light', label: 'Light', icon: Lightbulb },
  { id: 'tools', label: 'Tools', icon: Ruler },
];

const PANEL_TITLES: Record<Tab, string> = { add: 'Add', objects: 'Objects', light: 'Light', tools: 'Tools', photo: 'Photo' };

export class UI {
  // Panels and modes, each in its own module
  readonly addUI = new AddPanel(this);
  readonly objectsUI = new ObjectsPanel(this);
  readonly materialUI = new MaterialPanel(this);
  readonly animateUI = new AnimatePanel(this);
  readonly poseUI = new PosePanel(this);
  readonly rigUI = new RigPanel(this);
  readonly toolsUI = new ToolsPanel(this);
  readonly lightUI = new LightPanel(this);
  readonly optimizeUI = new OptimizePanel(this);
  readonly photoUI = new PhotoMode(this);
  readonly labelsUI = new MeasureLabels(this);

  tab: Tab | null = null;
  private busy = false;
  photoPanel = false;
  /** Selected part of each panel (e.g. Object | Material), remembered per tab. */
  segment: Partial<Record<Tab, string>> = {};
  private projectName = tr('my-scene');
  private menuOpen = false;
  /** Autosaved session found when the app opens (offered to continue). */
  private projectId: string | null = null;
  private lastThumbnail = -Infinity;
  private writeQueue: Promise<void> = Promise.resolve();
  private gallery!: ProjectGallery;
  private autosaveTimer = 0;
  private restoring = false;
  private readonly menu = h('div', { class: 'menu' });
  /** Secondary actions of the selection ("⋯" in the selection bar). */
  private readonly selMenu = h('div', { class: 'menu selmenu' });
  private selMenuOpen = false;
  /** Floating viewport controls: frame all, gyro, fullscreen, hide interface. */
  private readonly viewStack = h('div', { class: 'viewstack' });
  /** Everything hidden except this button (any screen). */
  private uiHidden = false;
  private readonly uiRestore = h('button', { class: 'ibtn round ui-restore' });
  private readonly projectInput = h('input', { type: 'file', accept: `${PROJECT_EXT},.zip`, hidden: true });

  private readonly topbar = h('header', { class: 'topbar' });
  private readonly dock = h('nav', { class: 'dock' });
  readonly panel = h('aside', { class: 'panel' });
  readonly selbar = h('div', { class: 'selbar' });
  readonly photoHud = h('div', { class: 'photo-hud' });
  readonly frame = h('div', { class: 'frame' });
  private readonly empty = h('div', { class: 'empty' });
  private readonly loader = h('div', { class: 'loader' });
  private readonly toasts = h('div', { class: 'toasts' });
  readonly labels = h('div', { class: 'mlabels' });
  /** Joint handles while posing (and rigging). */
  readonly jointOverlay: JointOverlay;
  /** Animation files to apply to the selected character. */
  readonly clipInput = h('input', { type: 'file', accept: '.glb,.gltf,.fbx,.bin', multiple: true, hidden: true });
  private readonly dropzone = h('div', { class: 'dropzone' }, icon(Upload, 40), h('p', {}, tr('Drop your 3D files here')));
  readonly fileInput = h('input', {
    type: 'file',
    multiple: true,
    accept: MODEL_EXTENSIONS.map((e) => '.' + e).join(',') + ',.bin,.png,.jpg,.jpeg,.webp,.ktx2,.mtl',
    hidden: true,
  });

  readonly editor: Editor;
  readonly root: HTMLElement;

  constructor(editor: Editor, root: HTMLElement) {
    this.editor = editor;
    this.root = root;
    this.jointOverlay = new JointOverlay(editor);
    this.clipInput.addEventListener('change', () => {
      const files = [...(this.clipInput.files ?? [])];
      this.clipInput.value = '';
      if (files.length) this.animateUI.importClips(files);
    });
    root.append(h('div', { class: 'titlebar-drag' }), this.menu, this.selMenu, this.projectInput);
    this.uiRestore.append(icon(Eye));
    this.uiRestore.addEventListener('click', () => this.setUiHidden(false));
    this.projectInput.addEventListener('change', () => {
      const file = this.projectInput.files?.[0];
      this.projectInput.value = '';
      if (file) this.openProjectFile(file);
    });
    document.addEventListener('pointerdown', (e) => {
      if (this.menuOpen && !this.menu.contains(e.target as Node) && !(e.target as Element).closest?.('.project-btn')) this.toggleMenu(false);
      if (this.selMenuOpen && !this.selMenu.contains(e.target as Node) && !(e.target as Element).closest?.('.more-btn')) this.toggleSelMenu(false);
    });
    this.gallery = new ProjectGallery(this);
    this.setupAutosave();
    document.addEventListener('fullscreenchange', () => this.renderViewStack());
    root.append(this.clipInput);
    root.append(this.labels, this.jointOverlay.el, this.frame, this.topbar, this.selbar, this.viewStack, this.panel, this.dock, this.uiRestore, this.photoHud, this.empty, this.loader, this.toasts, this.dropzone, this.fileInput);
    this.fileInput.addEventListener('change', () => {
      const files = [...(this.fileInput.files ?? [])];
      this.fileInput.value = '';
      if (files.length) this.loadFiles(files);
    });
    this.setupDragDrop();
    this.setupKeys();

    editor.changed.add((kind) => {
      if (kind === 'history') return this.renderTopbar();
      if (kind === 'photo') {
        this.labelsUI.buildLabels();
        return this.renderAll();
      }
      if (kind === 'tool') return this.renderSelbar();
      if (kind === 'optimize') {
        if (this.tab === 'objects') this.renderPanel();
        return;
      }
      if (kind === 'animation' || kind === 'pose' || kind === 'rig') {
        if (editor.rigger.fellBack) {
          editor.rigger.fellBack = false;
          this.toast(tr('Heat diffusion failed on this mesh: envelope weights were used.'), 'error');
        }
        this.renderSelbar();
        this.poseUI.renderPoseOverlay();
        if (kind === 'rig') this.renderTopbar();
        if (!this.busy && this.tab === 'objects') this.renderPanel();
        return;
      }
      if (kind === 'env' && editor.photoMode) {
        this.photoUI.renderPhotoHud();
        this.photoUI.renderFrame();
      }
      if (this.busy) return;
      if (kind === 'env' && this.tab !== 'light') return;
      if (kind === 'entities') this.labelsUI.buildLabels();
      this.renderAll();
    });
    editor.tools.changed.add(() => {
      this.labelsUI.buildLabels();
      this.renderSelbar();
      this.scheduleAutosave();
      if (!this.busy && (this.tab === 'tools' || this.tab === 'objects')) this.renderPanel();
    });
    editor.scene.onAfterRenderObservable.add(() => {
      this.labelsUI.updateLabels();
      this.animateUI.updateScrubber();
      this.jointOverlay.update();
    });
    editor.loading.add((l) => {
      this.loader.classList.toggle('show', !!l);
      if (l) this.loader.replaceChildren(h('div', { class: 'spinner' }), h('span', {}, tr('Loading {name}… {pct}%', { name: l.name, pct: Math.round(l.progress * 100) })));
    });
    new ResizeObserver(() => this.photoUI.renderFrame()).observe(root);
    this.renderAll();
  }

  /** Runs a UI action without triggering a re-render (avoids losing the slider being dragged). */
  quiet(fn: () => void) {
    this.busy = true;
    try {
      fn();
    } finally {
      this.busy = false;
    }
  }

  toast(text: string, kind: 'info' | 'error' = 'info', action?: { label: string; run: () => void }, timeout?: number) {
    const t = h(
      'div',
      { class: `toast ${kind} ${action ? 'with-action' : ''}` },
      h('span', {}, text),
      action ? h('button', { class: 'chip active', onClick: () => (t.remove(), action.run()) }, action.label) : null,
    );
    this.toasts.append(t);
    // Toasts with an action stay until used (e.g. "update available") unless a timeout is given
    const life = timeout ?? (action ? 0 : 3200);
    if (!life) return;
    setTimeout(() => t.classList.add('out'), life);
    setTimeout(() => t.remove(), life + 500);
  }

  /** Files opened from outside: the OS ("Open with" on an installed PWA) or drag and drop. */
  openFiles(files: File[]) {
    if (files.length) this.loadFiles(files);
  }

  private gyro: GyroControl | null = null;

  /** Gyro mode: moving the phone turns the camera (button only on devices with sensors). */
  setGyro(gyro: GyroControl) {
    this.gyro = gyro;
    gyro.changed.add(() => {
      this.renderViewStack();
      this.photoUI.renderPhotoHud();
    });
    this.renderViewStack();
  }

  gyroButton(round = false) {
    const g = this.gyro;
    if (!g?.available) return null;
    return iconButton(Smartphone, tr('Gyro mode: move the phone to look around'), () => this.toggleGyro(), { active: g.active, cls: round ? 'round' : '' });
  }

  private async toggleGyro() {
    const g = this.gyro;
    if (!g) return;
    if (g.active) return g.disable();
    if (await g.enable()) this.toast(tr('Gyro mode on: turn and tilt the phone'));
    else this.toast(tr('Orientation sensors are not available'), 'error');
  }

  private ar: ARMode | null = null;
  private arOverlay: HTMLElement | null = null;

  /** Augmented reality: shows the AR button when the device supports it. */
  setAR(ar: ARMode, overlay: HTMLElement) {
    this.ar = ar;
    this.arOverlay = overlay;
    ar.changed.add(() => this.renderTopbar());
    this.renderTopbar();
  }

  private async enterAR() {
    if (!this.ar || !this.arOverlay) return;
    if (!this.arRestore && (await this.lightenForAR())) return;
    try {
      await this.ar.enter(this.arOverlay);
    } catch (e) {
      this.toast(tr('Could not start AR: {error}', { error: errorMessage(e) }), 'error');
    }
  }

  /** Puts back the models lightened for the current AR session. */
  private arRestore: (() => void) | null = null;

  /**
   * A scene too heavy for this device is offered a lighter copy for AR (the project isn't
   * changed). True when the user must tap again to start AR: the browser asks for a fresh tap.
   */
  private async lightenForAR() {
    const ed = this.editor;
    const cost = analyzeScene(ed);
    const budget = deviceBudget();
    if (!overBudget(cost, budget)) return false;
    const models = ed.entities.filter((e) => e.kind === 'model' && e.visible && !e.optimization && !ed.optimizer.blocker(e));
    if (!models.length || !confirm(tr('This scene is heavy for this device and AR may stutter. Use a lighter copy in AR? Your project stays as it is.'))) return false;
    const ratio = Math.min(0.5, Math.max(0.02, (budget.triangles / Math.max(1, cost.triangles)) * 0.9));
    let restore: (() => void) | null = null;
    await this.run(async () => {
      restore = await ed.optimizer.applyForSession(models, { ...DEFAULT_OPTIMIZE, ratio });
    });
    if (!restore) return false;
    this.arRestore = restore;
    let entered = false;
    const watch = this.ar!.changed.add(() => {
      if (this.ar!.active) entered = true;
      else if (entered) this.endLightAR(watch);
    });
    this.toast(tr('Lighter copy ready.'), 'info', { label: tr('Start AR'), run: () => this.enterAR() }, 15000);
    // Not entered after all: back to the full models
    setTimeout(() => {
      if (!entered) this.endLightAR(watch);
    }, 16000);
    return true;
  }

  private endLightAR(watch: Observer<void> | null) {
    this.ar?.changed.remove(watch);
    this.arRestore?.();
    this.arRestore = null;
  }

  /** Install prompt saved from `beforeinstallprompt` (Chrome/Edge/Android). */
  private installPrompt: { prompt: () => Promise<unknown> } | null = null;

  setInstallPrompt(prompt: { prompt: () => Promise<unknown> } | null) {
    this.installPrompt = prompt;
    if (this.menuOpen) this.toggleMenu(true);
  }

  private async loadFiles(files: File[]) {
    const project = files.find((f) => f.name.toLowerCase().endsWith(PROJECT_EXT));
    if (project) return this.openProjectFile(project);
    try {
      await this.editor.addFiles(files);
      this.optimizeUI.checkHeavy(this.editor.selected);
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
      if (this.editor.recording) { if (e.key === 'Escape') this.photoUI.cancelRecording(); return; }
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
        else if (ed.tools.pending) ed.tools.cancelPending();
        else if (ed.tools.measureMode) ed.tools.setMeasureMode(false);
        else ed.select(null);
      } else if (e.key === 'm') {
        ed.tools.setMeasureMode(!ed.tools.measureMode);
      } else if (e.key === 'w' || e.key === 'g') ed.setTool('move');
      else if (e.key === 'e' || e.key === 'r') ed.setTool('rotate');
      else if (e.key === 's') ed.setTool('scale');
      else if (e.key === 'f') ed.selected ? ed.focus() : ed.frameAll();
      else if (e.key === 'o') ed.orbitAround();
      else if (e.key === 'p') ed.setPhotoMode(!ed.photoMode);
      else if (e.key === 'h') this.setUiHidden(!this.uiHidden);
    });
  }

  private renderAll() {
    document.body.classList.toggle('photo', this.editor.photoMode);
    this.renderTopbar();
    this.renderDock();
    this.renderSelbar();
    this.poseUI.renderPoseOverlay();
    this.renderViewStack();
    this.renderPanel();
    this.photoUI.renderPhotoHud();
    this.photoUI.renderFrame();
    this.uiRestore.title = this.uiRestore.ariaLabel = tr('Show interface');
    const hasObjects = this.editor.entities.some((e) => e.kind !== 'light');
    this.empty.classList.toggle('show', !hasObjects && !this.editor.photoMode);
    const saved = false;
    this.empty.replaceChildren(
      h('h2', {}, tr('Build your scene')),
      button(tr('All projects'), () => this.run(() => this.gallery.show()), { icon: FolderOpen, cls: 'primary' }),
      h('p', {}, tr('Drag GLB, glTF, OBJ, FBX, STL… files here or')),
      button(tr('Choose files'), () => this.fileInput.click(), { icon: Upload, cls: saved ? '' : 'primary' }),
      button(tr('Open project'), () => this.projectInput.click(), { icon: FolderOpen, cls: 'ghost' }),
      button(tr('Browse sample models'), () => this.openTab('add'), { cls: 'ghost' }),
    );
  }

  private renderTopbar() {
    const ed = this.editor;
    const base = import.meta.env.BASE_URL;
    this.topbar.replaceChildren(
      // The logo opens the project menu (new, open, save, export, language, install)
      h(
        'button',
        { class: `brand project-btn ${this.menuOpen ? 'open' : ''}`, title: tr('Project'), 'aria-label': tr('Project'), onClick: () => this.toggleMenu() },
        h('img', { class: 'brand-lettering', src: `${base}brand/lettering.webp`, alt: 'babalon JS', width: 94, height: 32, draggable: false }),
        h('img', { class: 'brand-icon', src: `${base}icons/icon-192.png`, alt: 'babalon JS', width: 28, height: 28, draggable: false }),
        icon(ChevronDown, 16),
      ),
      h(
        'div',
        { class: 'top-actions' },
        iconButton(Undo2, tr('Undo (Ctrl+Z)'), () => ed.undo(), { disabled: !ed.canUndo }),
        iconButton(Redo2, tr('Redo (Ctrl+Y)'), () => ed.redo(), { disabled: !ed.canRedo }),
        h('span', { class: 'sep' }),
        segmented(
          [
            { id: 'edit', label: tr('Edit'), icon: Move3d },
            { id: 'photo', label: tr('Photo'), icon: Camera },
            ...(this.ar?.supported ? [{ id: 'ar', label: 'AR', icon: View }] : []),
          ],
          this.ar?.active ? 'ar' : ed.photoMode ? 'photo' : 'edit',
          (id) => (id === 'ar' ? this.enterAR() : ed.setPhotoMode(id === 'photo')),
          'modes',
        ),
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
    name.addEventListener('change', () => { this.projectName = name.value.trim() || tr('my-scene'); this.scheduleAutosave(); });
    const item = (node: IconNode, label: string, kbd: string, fn: () => void) => menuItem(node, label, () => (this.toggleMenu(false), fn()), { kbd: kbd || undefined });
    this.menu.replaceChildren(
      h('label', { class: 'menu-name' }, h('span', {}, tr('Project name')), name),
      h('div', { class: 'menu-name' }, h('span', {}, getLang() === 'en' ? 'Language' : `${tr('Language')} · Language`), chips(LANGS, getLang(), (v) => this.setLanguage(v))),
      item(FolderOpen, tr('All projects'), '', () => this.run(() => this.gallery.show())),
      item(FilePlus, tr('New project'), '', () => this.run(() => this.newProject())),
      item(FolderOpen, tr('Open project…'), 'Ctrl+O', () => this.projectInput.click()),
      item(Save, tr('Save project'), 'Ctrl+S', () => this.saveProject()),
      item(Download, tr('Export scene .glb'), '', () => this.exportGLB(false)),
      item(Download, tr('Export compact .glb'), '', () => this.exportGLB(true)),
      ...(this.installPrompt
        ? [
            item(MonitorDown, tr('Install app'), '', () => {
              this.installPrompt?.prompt();
              this.installPrompt = null;
            }),
          ]
        : []),
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
      this.deliver(blob, fileSafe(this.projectName) + PROJECT_EXT, tr('Project saved'));
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

  private async loadSnapshot(snap: ProjectSnapshot, id: string = crypto.randomUUID()) {
    await this.flushProject();
    this.restoring = true;
    this.projectId = id;
    this.lastThumbnail = -Infinity;
    clearTimeout(this.autosaveTimer);
    try {
      const missing = await restore(this.editor, snap);
      this.projectName = snap.json.name || tr('my-scene');
      if (missing.length) this.toast(tr('Could not load: {names}', { names: missing.join(', ') }), 'error');
      else this.toast(tr('Project opened'));
    } finally {
      this.restoring = false;
      this.renderAll();
      this.scheduleAutosave();
    }
  }

  async newProject() {
    await this.flushProject();
    this.restoring = true;
    try {
      this.editor.newScene();
      this.projectName = tr('my-scene');
      this.projectId = crypto.randomUUID();
      this.lastThumbnail = -Infinity;
    } finally { this.restoring = false; }
    this.scheduleAutosave();
  }

  async openStoredProject(id: string) {
    const snap = await loadProject(id);
    if (!snap) throw new Error(tr('Project no longer exists.'));
    await this.loadSnapshot(snap, id);
  }

  projectRenamed(id: string, name: string) { if (this.projectId === id) this.projectName = name; }
  projectDeleted(id: string) {
    if (this.projectId !== id) return;
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = 0;
    this.projectId = null;
    this.restoring = true;
    try { this.editor.newScene(); this.projectName = tr('my-scene'); }
    finally { this.restoring = false; }
  }

  async flushProject() {
    this.editor.commitEdits();
    if (this.projectId || this.hasContent()) await this.autosaveNow();
    else await this.writeQueue;
  }

  private setupAutosave() {
    this.editor.changed.add((kind) => {
      if (kind === 'entities' || kind === 'transform' || kind === 'env' || kind === 'history' || kind === 'animation' || kind === 'pose' || kind === 'rig' || kind === 'optimize') this.scheduleAutosave();
    });
    // Material tweaks and the like don't emit editor events: save when a control is released
    this.panel.addEventListener('change', () => this.scheduleAutosave());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && this.autosaveTimer) this.autosaveNow().catch((e) => this.toast(errorMessage(e), 'error'));
    });
    listProjects().then((projects) => {
      if (projects.length && !this.hasContent() && !this.projectId) return this.gallery.show();
    }).catch((e) => this.toast(errorMessage(e), 'error'));
  }

  private scheduleAutosave() {
    // During AR the environment is temporarily changed: don't save that state
    if (this.restoring || this.editor.arMode || this.editor.recording) return;
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => this.autosaveNow().catch(() => this.toast(tr('Could not save in this browser. Export your project to keep it.'), 'error')), 1500);
  }

  private async autosaveNow() {
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = 0;
    if (this.restoring || this.editor.arMode || this.editor.recording) return;
    const id = this.projectId ??= crypto.randomUUID();
    const snap = snapshot(this.editor, this.projectName);
    // Serialize writes so a slow thumbnail never overwrites a newer snapshot or another project.
    const write = this.writeQueue.catch(() => {}).then(async () => {
      let thumbnail: Blob | undefined;
      if (id === this.projectId && performance.now() - this.lastThumbnail > 30000) {
        try { thumbnail = await this.editor.captureThumbnail(); this.lastThumbnail = performance.now(); }
        catch { /* A thumbnail failure must not lose the scene. */ }
      }
      await saveProject(id, snap, thumbnail);
    });
    this.writeQueue = write;
    await write;
  }

  /** Hands a file to the user: share sheet on phones (when possible) or download. */
  /** Saves the file to the device right away, and offers sharing it for a few seconds. */
  deliver(blob: Blob, name: string, message: string) {
    const share = saveAndOfferShare(blob, name);
    this.toast(message, 'info', share ? { label: tr('Share'), run: share } : undefined, 7000);
  }

  /** Compact: optimized models, compressed geometry and textures (smaller file, same look). */
  private async exportGLB(compact: boolean) {
    await this.run(async () => {
      const blob = await this.editor.exportGLB(compact);
      const name = timestampedName(compact ? 'scene-compact' : 'scene', 'glb');
      this.deliver(blob, name, tr('Scene exported as {name} ({size})', { name, size: formatBytes(blob.size) }));
    });
  }

  openTab(tab: Tab | null) {
    this.tab = this.tab === tab ? null : tab;
    this.renderDock();
    this.renderPanel();
    this.labelsUI.buildLabels();
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

  renderSelbar() {
    const ed = this.editor;
    const e = ed.selected;
    if (ed.tools.measureMode && !ed.photoMode) {
      this.selbar.classList.add('show');
      return this.selbar.replaceChildren(
        h('div', { class: 'sel-name measure' }, icon(Ruler, 16), h('span', {}, ed.tools.pending ? tr('Tap the second point') : tr('Tap the first point'))),
        h('div', { class: 'sel-tools' }, button(tr('Done'), () => ed.tools.setMeasureMode(false), { cls: 'small primary' })),
      );
    }
    if (ed.rigger.active && !ed.photoMode) return this.rigUI.renderRigBar();
    if (ed.pose.active && !ed.photoMode) return this.poseUI.renderPoseBar();
    const multi = iconButton(Group, tr('Multi-select (or Shift+click)'), () => ed.setMultiSelect(!ed.multiSelect), { active: ed.multiSelect });
    this.selbar.classList.toggle('show', (!!e || ed.multiSelect) && !ed.photoMode);
    if (!e) return this.selbar.replaceChildren(h('div', { class: 'sel-name wide' }, h('span', {}, tr('Tap objects to select'))), h('div', { class: 'sel-tools' }, multi));
    const toolBtn = (t: Tool, node: IconNode, label: string) =>
      iconButton(node, label, () => ed.setTool(t), { active: ed.tool === t, label, cls: 'tool' });
    const count = ed.selection.length;
    // Only the most used actions stay visible; the rest live in the "⋯" menu
    this.selbar.replaceChildren(
      h('div', { class: 'sel-name' }, icon(KIND_ICON[e.kind], 16), h('span', {}, count > 1 ? tr('{n} selected', { n: count }) : e.name)),
      h(
        'div',
        { class: 'sel-tools' },
        toolBtn('move', Move3d, tr('Move')),
        toolBtn('rotate', Rotate3d, tr('Rotate')),
        e.kind !== 'light' ? toolBtn('scale', Scale3d, tr('Scale')) : null,
        count === 1 && e.animationGroups.length
          ? ed.anim.isPlaying(e)
            ? iconButton(Pause, tr('Pause animation'), () => ed.anim.pause(e), { cls: 'play-btn' })
            : iconButton(Play, tr('Play animation'), () => ed.anim.play(e), { cls: 'play-btn' })
          : null,
        h('span', { class: 'sep' }),
        iconButton(Trash2, tr('Delete (Del)'), () => ed.remove(), { cls: 'danger' }),
        iconButton(Ellipsis, tr('More'), () => this.toggleSelMenu(), { cls: 'more-btn', active: this.selMenuOpen }),
        iconButton(X, tr('Deselect (Esc)'), () => ed.select(null)),
      ),
    );
    if (this.selMenuOpen) this.toggleSelMenu(true);
  }

  /** Secondary selection actions, one level deep. */
  private toggleSelMenu(open = !this.selMenuOpen) {
    const ed = this.editor;
    const e = ed.selected;
    this.selMenuOpen = open && !!e;
    this.selMenu.classList.toggle('show', this.selMenuOpen);
    this.selbar.querySelector('.more-btn')?.classList.toggle('active', this.selMenuOpen);
    if (!this.selMenuOpen || !e) return;
    const item = (node: IconNode, label: string, run: () => void, opts: { on?: boolean; keep?: boolean; kbd?: string } = {}) =>
      menuItem(node, label, () => (opts.keep ? null : this.toggleSelMenu(false), run()), opts);
    this.selMenu.replaceChildren(
      item(Copy, tr('Duplicate'), () => ed.duplicate(), { kbd: 'Ctrl+D' }),
      item(Focus, tr('Focus camera'), () => ed.focus(), { kbd: 'F' }),
      item(Orbit, tr('Orbit around this object'), () => {
        ed.orbitAround();
        this.toast(tr('Orbiting around {name}', { name: e.name }));
      }, { on: ed.orbitEntity === e, kbd: 'O' }),
      ...(e.animationGroups.length && ed.selection.length === 1
        ? [ed.anim.isPlaying(e) ? item(Pause, tr('Pause animation'), () => ed.anim.pause(e)) : item(Play, tr('Play animation'), () => ed.anim.play(e))]
        : []),
      ...(skeletonsOf(e).length ? [item(PersonStanding, tr('Pose joints'), () => this.poseUI.startPosing(e))] : []),
      item(Group, tr('Multi-select'), () => (ed.setMultiSelect(!ed.multiSelect), this.toggleSelMenu(true)), { on: ed.multiSelect, keep: true }),
      item(Magnet, tr('Snap to grid'), () => (ed.setSnap(!ed.snap), this.toggleSelMenu(true)), { on: ed.snap, keep: true }),
    );
  }

  /** Viewport controls float in a corner, apart from the editing tools. */
  private renderViewStack() {
    const ed = this.editor;
    const buttons: (HTMLElement | null)[] = [
      iconButton(Scan, tr('Frame all (F)'), () => ed.frameAll()),
      this.gyroButton(),
      document.fullscreenEnabled
        ? document.fullscreenElement
          ? iconButton(Shrink, tr('Exit fullscreen'), () => toggleFullscreen())
          : iconButton(Expand, tr('Fullscreen'), () => toggleFullscreen())
        : null,
      iconButton(EyeOff, tr('Hide interface (H)'), () => this.setUiHidden(true)),
    ];
    this.viewStack.replaceChildren(...buttons.filter((b): b is HTMLElement => !!b));
  }

  /** Hides every control (any screen); a faint button brings them back. Gestures keep working. */
  setUiHidden(on: boolean) {
    this.uiHidden = on;
    document.body.classList.toggle('ui-hidden', on);
    if (on) {
      this.toggleMenu(false);
      this.toggleSelMenu(false);
    }
  }

  renderPanel() {
    const ed = this.editor;
    const tab: Tab | null = ed.photoMode ? (this.photoPanel ? 'photo' : null) : this.tab;
    this.panel.classList.toggle('show', !!tab);
    document.body.classList.toggle('panel-open', !!tab);
    if (!tab) {
      this.panel.replaceChildren();
      if (ed.rigger.active) this.renderSelbar();
      return;
    }
    const title = tr(PANEL_TITLES[tab]);
    const scroll = this.panel.querySelector('.panel-body')?.scrollTop ?? 0;
    const parts = this.panelParts(tab);
    const current = parts?.find((p) => p.id === this.segment[tab]) ? this.segment[tab]! : parts?.[0].id ?? '';
    const body = h('div', { class: 'panel-body' }, ...this.panelContent(tab, current));
    const rigging = tab === 'objects' && current === 'rig' && ed.rigger.active && ed.rigger.entity === ed.selected;
    this.panel.replaceChildren(
      h(
        'div',
        { class: 'panel-head' },
        h('h2', {}, title),
        iconButton(X, tr('Close'), () => (ed.photoMode ? ((this.photoPanel = false), this.renderAll()) : this.openTab(null))),
      ),
      ...(parts
        ? [
            segmented(parts, current, (id) => {
              this.segment[tab] = id;
              this.panel.querySelector('.panel-body')!.scrollTop = 0;
              this.renderPanel();
              this.labelsUI.buildLabels();
            }),
          ]
        : []),
      ...(rigging ? [this.rigUI.rigStepper()] : []),
      body,
      ...(rigging ? [this.rigUI.rigFooter()] : []),
    );
    body.scrollTop = scroll;
    if (ed.rigger.active) this.renderSelbar();
  }

  /** Parts of a panel, switched at its top (one level: no nested menus). */
  private panelParts(tab: Tab): { id: string; label: string }[] | null {
    switch (tab) {
      case 'objects': {
        const e = this.editor.selected;
        if (!e || e.kind === 'light') return null;
        return [
          { id: 'object', label: tr('Object') },
          ...(this.editor.materialsOf(e).length ? [{ id: 'material', label: tr('Material') }] : []),
          { id: 'animate', label: tr('Animate') },
          ...(this.editor.rigger.active && this.editor.rigger.entity === e
            ? [{ id: 'rig', label: tr('Rig') }]
            : skeletonsOf(e).length ? [{ id: 'pose', label: tr('Pose') }] : this.editor.rigger.canRig(e) ? [{ id: 'rig', label: tr('Rig') }] : []),
          ...(e.kind === 'model' ? [{ id: 'optimize', label: tr('Optimize') }] : []),
        ];
      }
      case 'light':
        return [
          { id: 'lights', label: tr('Lights') },
          { id: 'environment', label: tr('Environment') },
        ];
      case 'tools':
        return [
          { id: 'measure', label: tr('Measure') },
          { id: 'guides', label: tr('Guides') },
          { id: 'align', label: tr('Align') },
        ];
      case 'photo':
        return [
          { id: 'style', label: tr('Style') },
          { id: 'camera', label: tr('Camera') },
        ];
    }
    return null;
  }

  private panelContent(tab: Tab, part: string): (Node | null)[] {
    switch (tab) {
      case 'add':
        return this.addUI.addPanel();
      case 'objects':
        if (part === 'material') return this.materialUI.materialPanel();
        if (part === 'animate') return this.animateUI.animatePanel();
        if (part === 'pose') return this.poseUI.posePanel();
        if (part === 'rig') return this.rigUI.rigPanel();
        if (part === 'optimize') return this.optimizeUI.optimizePanel();
        return this.objectsUI.scenePanel();
      case 'light':
        return part === 'environment' ? this.lightUI.envPanel() : this.lightUI.lightsPanel();
      case 'photo': {
        // [enter, filters, camera, light & color, effects, depth of field, reset]
        const all = this.photoUI.photoPanelContent();
        return part === 'camera' ? [all[2], all[5]] : [all[0], all[1], all[3], all[4], all[6]];
      }
      case 'tools': {
        const [measure, guides, align] = this.toolsUI.toolsPanel();
        return [part === 'guides' ? guides : part === 'align' ? align : measure];
      }
    }
  }

  /** Runs an action that may fail with a message for the user. */
  async run(fn: () => unknown) {
    try {
      await fn();
    } catch (err) {
      this.toast(err instanceof Error ? err.message : String(err), 'error');
    }
  }
}
