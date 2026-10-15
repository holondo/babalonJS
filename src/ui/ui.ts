import type { LibraryAttribution, LibraryKind } from '../library/polyhaven';
import type { LibraryPanel } from './panels/library';
import { ProjectGallery } from './projectGallery';
import {
  Box,
  Bone,
  SquaresUnite,
  Video,
  Camera,
  Triangle,
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
import type { Editor, Entity, PrimitiveType, Tool } from '../core/editor';
import { PROJECT_EXT, fromZip, loadProject, restore, saveProject, snapshot, toZip } from '../core/project';
import type { ProjectSnapshot } from '../core/project';
import { JointOverlay } from './jointOverlay';
import { skeletonsOf } from '../rigging/humanoid';
import type { ARMode } from '../ar/ar';
import type { GyroControl } from '../device/gyro';
import { saveAndOfferShare, timestampedName } from '../core/files';
import { LANGS, getLang, setLang, tr } from '../core/i18n';
import type { Lang } from '../core/i18n';
import { button, chips, h, haptic, hint, icon, iconButton, menuItem, progressBar, row, section, segmented, scrollableSegmented } from './dom';
import { AddPanel } from './panels/add';
import { ObjectsPanel } from './panels/objects';
import { MaterialPanel } from './panels/material';
import { AnimatePanel } from './panels/animate';
import { PosePanel } from './panels/pose';
import type { RigPanel } from './panels/rig';
import { ToolsPanel } from './panels/tools';
import type { OptimizePanel } from './panels/optimize';
import type { SeparatePanel } from './panels/separate';
import { TransformBar } from './transformBar';
import { ContextBar } from './contextBar';
import { PanelSheet } from './panelSheet';
import type { UIContext } from './contextBar';
import { ModalTransform } from './modalTransform';
import type { ModifyPanel } from './panels/modify';
import { QUICK_SHAPES, shapeLabel } from './quickShapes';
import { analyzeEntity, analyzeScene, deviceBudget, formatBytes, overBudget } from '../optimize/analysis';
import { DEFAULT_OPTIMIZE } from '../optimize/optimizer';
import type { Observer } from '@babylonjs/core/Misc/observable.js';
import { LightPanel } from './panels/light';
import { PhotoMode } from './photo';
import { MeasureLabels } from './measureLabels';
import { KIND_ICON, fileSafe, toggleFullscreen, isFullscreen, isFullscreenAvailable, errorMessage } from './shared';
import type { Tab } from './shared';
import { Capacitor } from '@capacitor/core';

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
  rigUI: RigPanel | null = null;
  readonly toolsUI = new ToolsPanel(this);
  readonly lightUI = new LightPanel(this);
  optimizeUI: OptimizePanel | null = null;
  separateUI: SeparatePanel | null = null;
  readonly transformBar = new TransformBar(this);
  /** Context bubbles; created once the selection bar exists. */
  private contextBar!: ContextBar;
  private panelSheet!: PanelSheet;
  modifyUI: ModifyPanel | null = null;
  private readonly featureLoads = new Map<string, Promise<void>>();
  private readonly featureErrors = new Map<string, string>();
  /** G / R / S from the keyboard (created with the keys, once the canvas exists). */
  private modal!: ModalTransform;
  readonly photoUI = new PhotoMode(this);
  readonly labelsUI = new MeasureLabels(this);

  tab: Tab | null = null;
  private busy = false;
  private nativeAR = false;
  private activityId = 0;
  private activityState = '';
  private readonly activities = new Map<string, { label: string; icon: IconNode; progress: number | null; cancel?: () => void }>();
  private loadingActivity: ReturnType<UI['beginActivity']> | null = null;
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
  private contextPart = 'tools';
  private readonly contextParts = new Map<string, { el: HTMLDivElement; trigger: HTMLButtonElement; controls: HTMLDivElement }>();
  /** Floating viewport controls: frame all, gyro, fullscreen, hide interface. */
  readonly viewStack = h('div', { class: 'viewstack' });
  /** Everything hidden except this button (any screen). */
  private uiHidden = false;
  private readonly uiRestore = h('button', { class: 'ibtn round ui-restore' });
  private readonly projectInput = h('input', { type: 'file', accept: `${PROJECT_EXT},.zip`, hidden: true });

  readonly topbar = h('header', { class: 'topbar' });
  readonly dock = h('nav', { class: 'dock' });
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
    window.addEventListener('nativefullscreenchange', () => this.renderViewStack());
    root.append(this.clipInput);
    this.contextBar = new ContextBar(this);
    this.panelSheet = new PanelSheet(this.panel, () => this.contextBar.layout(false), () => this.openTab(null));
    this.panel.addEventListener('scroll', () => {
      if (this.panel.scrollTop !== 0) this.panel.scrollTop = 0;
      if (this.panel.scrollLeft !== 0) this.panel.scrollLeft = 0;
    }, { passive: true });
    root.append(this.labels, this.jointOverlay.el, this.frame, this.topbar, this.contextBar.el, this.viewStack, this.panel, this.dock, this.uiRestore, this.photoHud, this.empty, this.loader, this.toasts, this.dropzone, this.fileInput);
    this.fileInput.addEventListener('change', () => {
      const files = [...(this.fileInput.files ?? [])];
      this.fileInput.value = '';
      if (files.length) this.loadFiles(files);
    });
    this.setupDragDrop();
    this.setupKeys();

    editor.changed.add((kind) => {
      if (kind === 'activity') {
        if (editor.gizmoError) { this.toast(editor.gizmoError, 'error'); editor.gizmoError = null; }
        const state = `${editor.optimizer.busy}:${editor.textureOptimizer.busy}:${editor.rigger.progress !== null}:${editor.rigger.comparing}`;
        const changed = state !== this.activityState;
        this.activityState = state;
        this.renderSelbar();
        if (changed && this.tab === 'objects') this.renderPanel();
        else this.updateOperationProgress();
        return;
      }
      // Separate mode belongs to one model: leave it if that model is no longer the selection
      const separating = editor.separator.selection?.entity;
      if (separating && (kind === 'selection' || kind === 'entities' || kind === 'photo') && (editor.selected !== separating || !editor.entities.includes(separating) || editor.photoMode)) this.leaveMesh();
      if (kind === 'history') return this.renderTopbar();
      if (kind === 'photo') {
        this.labelsUI.buildLabels();
        return this.renderAll();
      }
      if (kind === 'tool') {
        this.renderSelbar();
        if (this.tab === 'objects' && !this.busy && (editor.separator.active || this.segment.objects === 'object')) this.renderPanel();
        return;
      }
      if (kind === 'optimize') {
        this.renderSelbar();
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
      if (l) {
        this.loadingActivity ??= this.beginActivity(tr('Loading…'), Upload);
        this.loadingActivity.update(l.progress || null, tr('Loading {name}', { name: l.name }));
      } else {
        this.loadingActivity?.finish();
        this.loadingActivity = null;
      }
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

  /** Registers work that continues independently of whichever panel is on screen. */
  beginActivity(label: string, node: IconNode = Download, cancel?: () => void) {
    const id = `activity-${++this.activityId}`;
    const activity = { label, icon: node, progress: null as number | null, cancel };
    this.activities.set(id, activity);
    this.renderSelbar();
    return {
      update: (progress: number | null, nextLabel = activity.label) => {
        if (!this.activities.has(id)) return;
        if (nextLabel === activity.label && (progress === null ? activity.progress === null : activity.progress !== null && Math.round(progress * 100) === Math.round(activity.progress * 100))) return;
        activity.progress = progress;
        activity.label = nextLabel;
        this.renderSelbar();
      },
      finish: () => {
        if (this.activities.delete(id)) this.renderSelbar();
      },
    };
  }

  private activityContext(id: string, node: IconNode, label: string, progress: number | null, cancel?: () => void): UIContext {
    const status = progress === null ? label : `${label} · ${Math.round(progress * 100)}%`;
    return { id, icon: node, label: status, busy: true, progress, render: () => this.selbar.replaceChildren(
      this.activitySummary(node, label, progress),
      ...(cancel ? [button(tr('Cancel'), cancel, { cls: 'small' })] : []),
    ) };
  }

  /** Shared compact progress layout for background work and mode-specific controls. */
  activitySummary(node: IconNode, label: string, progress: number | null) {
    const meter = progressBar(progress, label);
    meter.classList.add('compact');
    return h('div', { class: 'ctx-activity' }, icon(node, 18),
      h('div', { class: 'ctx-activity-copy' },
        h('div', { class: 'ctx-activity-heading' }, h('span', { title: label }, label),
          h('span', { class: 'ctx-percent' }, progress === null ? tr('Working…') : `${Math.round(progress * 100)}%`)), meter));
  }

  operationProgress(kind: 'geometry' | 'textures' | 'rig', progress: number) {
    const label = tr(kind === 'rig' ? 'Computing weights… {pct}%' : 'Optimizing… {pct}%', { pct: Math.round(progress * 100) });
    const element = progressBar(progress, label);
    element.dataset.operationProgress = kind;
    return element;
  }

  private updateOperationProgress() {
    for (const element of this.panel.querySelectorAll<HTMLElement>('[data-operation-progress]')) {
      const kind = element.dataset.operationProgress;
      const progress = (kind === 'geometry' ? this.editor.optimizer.progress : kind === 'textures' ? this.editor.textureOptimizer.progress : this.editor.rigger.progress) ?? 0;
      const percent = Math.round(progress * 100);
      const label = tr(kind === 'rig' ? 'Computing weights… {pct}%' : 'Optimizing… {pct}%', { pct: percent });
      element.setAttribute('aria-valuenow', String(percent));
      element.setAttribute('aria-label', label);
      element.querySelector('i')!.style.width = `${percent}%`;
      element.querySelector('span')!.textContent = label;
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

  /** Files opened from outside: the OS ("Open with" on an installed PWA) or drag and drop. Resolves whether they were opened. */
  async openFiles(files: File[], attribution?: LibraryAttribution): Promise<boolean> {
    const environment = files.find((f) => /\.(hdr|exr|env)$/i.test(f.name));
    if (environment) {
      await this.editor.importEnvironment(environment);
      if (attribution) this.editor.applyEnv({ attribution });
      return true;
    }
    return files.length ? this.loadFiles(files, attribution) : true;
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
  private arLoader: (() => Promise<void>) | null = null;
  private arLoading: Promise<void> | null = null;
  private arPreparing = false;

  setARLoader(loader: () => Promise<void>) {
    this.arLoader = loader;
    this.renderTopbar();
  }

  /** Augmented reality: shows the AR button when the device supports it. */
  setAR(ar: ARMode, overlay: HTMLElement) {
    this.ar = ar;
    this.arOverlay = overlay;
    ar.changed.add(() => this.renderTopbar());
    this.renderTopbar();
  }

  private async enterAR() {
    if (this.arPreparing || this.nativeAR || this.ar?.active) return;
    this.arPreparing = true;
    try {
      await this.prepareAndEnterAR();
    } catch (error) {
      this.toast(tr('Could not start AR: {error}', { error: errorMessage(error) }), 'error');
    } finally {
      this.arPreparing = false;
    }
  }

  private async prepareAndEnterAR() {
    if (Capacitor.isNativePlatform()) {
      if (this.nativeAR) return;
      this.nativeAR = true;
      const restoreCamera = this.photoUI.suspendCamera();
      if (this.editor.separator.active) this.leaveMesh();
      const activity = this.beginActivity(tr('Preparing AR…'), View);
      interface NativeBridge {
        startArTransfer?: (title: string, placement: string) => void;
        appendArChunk?: (base64Chunk: string) => boolean;
        finishArTransfer?: () => void;
        cancelArTransfer?: () => void;
        launchArWithData?: (data: string, title: string, placement: string) => void;
      }
      const nativeBridge = (window as unknown as { AndroidNative?: NativeBridge }).AndroidNative;
      try {
        if (!nativeBridge) throw new Error(tr('Native AR bridge unavailable'));
        const restoreModels = await this.prepareLightAR();
        let blob: Blob | null;
        try {
          blob = await this.editor.exportGLB(false, true);
        } finally {
          // Native AR uses the exported copy; restore the editor immediately,
          // including when export fails.
          restoreModels?.();
        }
        if (!blob) throw new Error(tr('Failed to export 3D scene for AR'));

        const bounds = this.editor.sceneBounds();
        const view = this.editor.camera.position.subtract(this.editor.camera.target);
        const { nativeARStrings } = await import('../ar/nativeStrings');
        const { nativeAnimationName } = await import('../ar/nativeScene');
        const placement = JSON.stringify({
          strings: nativeARStrings(),
          language: getLang(),
          // Babylon is left-handed; glTF and ARCore are right-handed.
          // Babylon GLTF2Export converts left-handed to right-handed by negating X (x_gltf = -x_babylon, z_gltf = z_babylon).
          origin: bounds ? [-bounds.center.x, bounds.min.y, bounds.center.z] : [0, 0, 0],
          baseYaw: Math.atan2(-view.x, view.z),
          animations: this.editor.entities.filter(e => e.visible && this.editor.anim.isPlaying(e)).map(e => {
            const clip = this.editor.anim.current(e)!;
            return { name: nativeAnimationName(e), speed: clip.speedRatio, loop: clip.loopAnimation };
          }),
          lighting: 'room',
          lightLevel: this.editor.env.intensity || 1.0,
        });

        const projectTitle = this.projectName || 'Babalon AR';

        if (nativeBridge.startArTransfer && nativeBridge.appendArChunk && nativeBridge.finishArTransfer) {
          nativeBridge.startArTransfer(projectTitle, placement);
          const CHUNK_SIZE = 1024 * 1024;
          const totalSize = blob.size;
          let offset = 0;

          while (offset < totalSize) {
            const slice = blob.slice(offset, Math.min(offset + CHUNK_SIZE, totalSize));
            const chunkBase64 = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                const res = reader.result as string;
                resolve(res.includes(',') ? res.split(',')[1] : res);
              };
              reader.onerror = reject;
              reader.readAsDataURL(slice);
            });

            const ok = nativeBridge.appendArChunk(chunkBase64);
            if (!ok) {
              nativeBridge.cancelArTransfer?.();
              throw new Error(tr('Failed to transfer 3D model to native AR'));
            }
            offset += CHUNK_SIZE;
          }

          // Dereference blob immediately before AR opens so JS GC can free memory
          blob = null;

          await new Promise<void>((resolve, reject) => {
            const stateChanged = (event: Event) => {
              const state = (event as CustomEvent<string>).detail;
              if (state === 'started') {
                this.editor.pauseRendering();
                activity.finish();
                return;
              }
              window.removeEventListener('nativearstate', stateChanged);
              this.editor.resumeRendering();
              if (state === 'closed') resolve();
              else reject(new Error(tr(state)));
            };
            window.addEventListener('nativearstate', stateChanged);
            try {
              nativeBridge.finishArTransfer!();
            } catch (error) {
              this.editor.resumeRendering();
              window.removeEventListener('nativearstate', stateChanged);
              reject(error);
            }
          });
        } else if (nativeBridge.launchArWithData) {
          const reader = new FileReader();
          const base64Promise = new Promise<string>((resolve, reject) => {
            reader.onload = () => {
              const res = reader.result as string;
              resolve(res.includes(',') ? res.split(',')[1] : res);
            };
            reader.onerror = reject;
          });
          reader.readAsDataURL(blob);
          const base64 = await base64Promise;
          blob = null;

          await new Promise<void>((resolve, reject) => {
            const stateChanged = (event: Event) => {
              const state = (event as CustomEvent<string>).detail;
              if (state === 'started') {
                this.editor.pauseRendering();
                activity.finish();
                return;
              }
              window.removeEventListener('nativearstate', stateChanged);
              this.editor.resumeRendering();
              if (state === 'closed') resolve();
              else reject(new Error(tr(state)));
            };
            window.addEventListener('nativearstate', stateChanged);
            try { nativeBridge.launchArWithData!(base64, projectTitle, placement); }
            catch (error) {
              this.editor.resumeRendering();
              window.removeEventListener('nativearstate', stateChanged);
              reject(error);
            }
          });
        } else {
          throw new Error(tr('Native AR bridge unavailable'));
        }
      } catch (e) {
        nativeBridge?.cancelArTransfer?.();
        this.toast(tr('Could not start AR: {error}', { error: errorMessage(e) }), 'error');
      } finally {
        this.editor.resumeRendering();
        this.nativeAR = false;
        activity.finish();
        await restoreCamera().catch(e => this.toast(errorMessage(e), 'error'));
        this.scheduleAutosave();
      }
      return;
    }

    if (!this.ar && this.arLoader) {
      const activity = this.beginActivity(tr('Preparing AR…'), View);
      try {
        await (this.arLoading ??= this.arLoader());
      } catch (error) {
        this.arLoading = null;
        this.toast(errorMessage(error), 'error');
        return;
      } finally { activity.finish(); }
      // A slow first download can outlive transient user activation needed by WebXR.
      if (navigator.userActivation && !navigator.userActivation.isActive) {
        this.toast(tr('AR is ready. Tap AR to start.'));
        return;
      }
    }
    if (!this.ar || !this.arOverlay) return;
    if (!this.ar.supported) {
      this.toast(tr('WebXR AR requires Chrome on Android. WebView does not support WebXR.'), 'error');
      return;
    }
    if (this.editor.separator.active) this.leaveMesh();
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
    const restore = await this.prepareLightAR();
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

  /** Shared opt-in geometry reduction; callers own the temporary copy's lifetime. */
  private async prepareLightAR(): Promise<(() => void) | null> {
    const ed = this.editor;
    const cost = analyzeScene(ed);
    const budget = deviceBudget();
    if (!overBudget(cost, budget)) return null;
    const models = ed.entities.filter((e) => e.kind === 'model' && e.visible && !e.optimization && !ed.optimizer.blocker(e));
    if (!models.length || !confirm(tr('This scene is heavy for this device and AR may stutter. Use a lighter copy in AR? Your project stays as it is.'))) return null;
    const ratio = Math.min(0.5, Math.max(0.02, (budget.triangles / Math.max(1, cost.triangles)) * 0.9));
    return ed.optimizer.applyForSession(models, { ...DEFAULT_OPTIMIZE, ratio });
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

  private async loadFiles(files: File[], attribution?: LibraryAttribution): Promise<boolean> {
    const project = files.find((f) => f.name.toLowerCase().endsWith(PROJECT_EXT));
    if (project) return this.openProjectFile(project);
    try {
      await this.editor.addFiles(files, attribution);
      const entity = this.editor.selected, budget = deviceBudget();
      if (entity?.kind === 'model' && overBudget(analyzeEntity(this.editor, entity), budget)) this.toast(
        tr(budget.phone ? 'This model is heavy for this phone and may run slowly. You can optimize it.' : 'This model is very heavy. You can optimize it.'),
        'info', { label: tr('Optimize'), run: () => this.openPart('objects', 'optimize') }, 9000);
      return true;
    } catch (e) {
      this.toast(errorMessage(e), 'error');
      return false;
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
    this.modal = new ModalTransform(this);
    // Shift while dragging the scale gizmo keeps the proportions
    const shift = (e: KeyboardEvent) => { this.editor.proportional = e.shiftKey; };
    window.addEventListener('keyup', shift);
    window.addEventListener('blur', () => { this.editor.proportional = false; });
    window.addEventListener('keydown', (e) => {
      shift(e);
      if (this.editor.recording) { if (e.key === 'Escape') this.photoUI.cancelRecording(); return; }
      const target = e.target as HTMLElement;
      if (target.isContentEditable || target.matches('input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea, select')) return;
      const ed = this.editor;
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      // Mesh mode: Blender's selection keys
      const faces = ed.separator.active && ed.separator.mode !== 'surface' ? ed.separator : null;
      if (e.key === 'Tab' && !ctrl && !e.altKey) {
        e.preventDefault();
        if (ed.separator.active) this.leaveMesh();
        else if (ed.selected) this.startMesh(ed.selected);
        return;
      }
      if (e.shiftKey && !ctrl && key === 'a') { e.preventDefault(); this.showShapeMenu(); return; }
      if (faces && !ctrl && key === 'a') { e.preventDefault(); faces.edit((x) => (e.altKey ? x.clear() : x.all())); return; }
      if (faces && ctrl && key === 'i') { e.preventDefault(); faces.edit((x) => x.all(true)); return; }
      if (faces && ctrl && (e.key === '+' || e.key === '=' || e.key === '-')) { e.preventDefault(); faces.ring(e.key !== '-'); return; }
      if (!faces && !ed.separator.active && !ctrl && key === 'a') { e.preventDefault(); e.altKey ? ed.select(null) : ed.selectAll(); return; }
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
        // Mesh mode never deletes the whole object from the keyboard
        if (!ed.separator.active) ed.remove();
      } else if (e.key === 'Escape') {
        if (ed.photoMode) ed.setPhotoMode(false);
        else if (ed.tools.pending) ed.tools.cancelPending();
        else if (ed.tools.measureMode) ed.tools.setMeasureMode(false);
        else ed.select(null);
      } else if (e.key === 'm') {
        ed.tools.setMeasureMode(!ed.tools.measureMode);
      } else if (e.key === 'g' || e.key === 'r' || e.key === 's') {
        // Blender: transform with the mouse; away from the view (or nothing to move) it picks the gizmo tool
        const kind = e.key === 'g' ? 'move' : e.key === 'r' ? 'rotate' : 'scale';
        if (!this.modal.begin(kind)) ed.setTool(kind);
      } else if (e.key === 'w') ed.setTool('move');
      else if (e.key === 'e') ed.setTool('rotate');
      else if (e.key === 'f') ed.selected ? ed.focus() : ed.frameAll();
      else if (e.key === 'o') ed.orbitAround();
      else if (e.key === 'p') ed.setPhotoMode(!ed.photoMode);
      else if (e.key === 'h') this.setUiHidden(!this.uiHidden);
    });
  }

  renderAll() {
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
    // Start card: add something right away, or continue a recent project (the canvas stays usable)
    this.empty.replaceChildren(
      h('h2', {}, tr('Build your scene')),
      h('p', {}, tr('Drag GLB, glTF, OBJ, FBX, STL… files here or')),
      button(tr('Choose files'), () => this.fileInput.click(), { icon: Upload, cls: 'primary' }),
      h('div', { class: 'empty-row' },
        button(tr('Samples'), () => this.openTab('add'), { cls: 'ghost' }),
        button(tr('Projects'), () => this.run(() => this.gallery.show()), { icon: FolderOpen, cls: 'ghost' })),
      ...[this.gallery?.recentList()].filter((n): n is HTMLElement => !!n),
    );
  }

  private renderTopbar() {
    const ed = this.editor;
    const scroll = this.topbar.querySelector('.top-actions')?.scrollLeft ?? 0;
    const base = import.meta.env.BASE_URL;
    this.topbar.replaceChildren(
      // The logo opens the project menu (new, open, save, export, language, install)
      h(
        'button',
        { class: `brand project-btn ${this.menuOpen ? 'open' : ''}`, title: tr('Project'), 'aria-label': tr('Project'), onClick: () => this.toggleMenu() },
        h('img', { class: 'brand-lettering', src: `${base}brand/lettering.webp`, alt: 'babalon JS', width: 105, height: 32, draggable: false }),
        h('img', { class: 'brand-icon', src: `${base}brand/logo.webp`, alt: 'babalon JS', width: 28, height: 28, draggable: false }),
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
            ...(this.ar?.supported || this.arLoader ? [{ id: 'ar', label: 'AR', icon: View }] : []),
          ],
          this.ar?.active ? 'ar' : ed.photoMode ? 'photo' : 'edit',
          (id) => (id === 'ar' ? this.enterAR() : ed.setPhotoMode(id === 'photo')),
          'modes',
        ),
      ),
    );
    this.topbar.style.setProperty('--brand-width', `${this.topbar.querySelector<HTMLElement>('.brand')!.offsetWidth}px`);
    this.topbar.querySelector('.top-actions')!.scrollLeft = scroll;
    requestAnimationFrame(() => this.contextBar?.layout());
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
    const item = (node: IconNode, label: string, kbd: string, fn: () => void, description?: string) => menuItem(node, label, () => (this.toggleMenu(false), fn()), { kbd: kbd || undefined, description });
    this.menu.replaceChildren(
      h('label', { class: 'menu-name' }, h('span', {}, tr('Project name')), name),
      h('div', { class: 'menu-name' }, h('span', {}, getLang() === 'en' ? 'Language' : `${tr('Language')} · Language`), chips(LANGS, getLang(), (v) => this.setLanguage(v))),
      item(FolderOpen, tr('All projects'), '', () => this.run(() => this.gallery.show())),
      item(FilePlus, tr('New project'), '', () => this.run(() => this.newProject())),
      item(FolderOpen, tr('Open project…'), 'Ctrl+O', () => this.projectInput.click()),
      item(Save, tr('Save project'), 'Ctrl+S', () => this.saveProject()),
      item(Download, tr('Export scene .glb'), '', () => this.exportGLB(false), tr('Original geometry and textures, before optimization. Best for compatibility.')),
      item(Download, tr('Export compact .glb'), '', () => this.exportGLB(true), tr('Uses applied optimizations and compresses geometry. Smaller file; requires a compatible viewer.')),
      h('p', { class: 'hint' }, tr('Compact does not automatically reduce triangles or texture resolution. Apply Optimize first if you want those reductions.')),
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
    const activity = this.beginActivity(tr('Preparing project download'), Save);
    try {
      const blob = await toZip(snapshot(this.editor, this.projectName));
      this.deliver(blob, fileSafe(this.projectName) + PROJECT_EXT, tr('Project saved'));
    } catch (e) {
      this.toast(errorMessage(e), 'error');
    } finally {
      activity.finish();
    }
  }

  /** Resolves `false` only when the file could not be read; declining the replace prompt counts as handled. */
  private async openProjectFile(file: File): Promise<boolean> {
    if (this.hasContent() && !confirm(tr('Opening the project will replace the current scene. Continue?'))) return true;
    const activity = this.beginActivity(tr('Opening project: {name}', { name: file.name }), Upload);
    try {
      const snap = await fromZip(file);
      if (!snap.json.name) snap.json.name = file.name.replace(/\.[^.]+$/, '');
      await this.loadSnapshot(snap);
      return true;
    } catch (e) {
      this.toast(errorMessage(e), 'error');
      return false;
    } finally {
      activity.finish();
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
    await this.gallery.refresh();
  }

  async openStoredProject(id: string) {
    await this.flushProject();
    if (id === this.projectId) return;
    const snap = await loadProject(id);
    if (!snap) throw new Error(tr('Project no longer exists.'));
    await this.loadSnapshot(snap, id);
  }

  get currentProjectId() { return this.projectId; }

  /** Optimized models in the selection become their optimized version before a geometry edit. */
  /** Objects → Modify: quick shapes, boolean operations and shrinkwrap. */
  openModify() {
    this.segment.objects = 'modify';
    if (this.tab !== 'objects') this.openTab('objects'); else this.renderPanel();
  }

  /** Adds a quick shape on the selection; with a target it opens Modify, ready for Boolean or Shrinkwrap. */
  addShape(type: PrimitiveType) {
    this.run(() => {
      const ed = this.editor, mesh = ed.separator.active;
      const shape = ed.addShapeOnSelection(type);
      if (mesh) {
        // From selected faces: wrap them onto the shape at once (Blender's Shrinkwrap on a vertex group)
        this.separateUI?.refresh();
        const target = ed.separator.lastFaces?.entity;
        if (target && target !== shape) ed.wrap.start([target, shape], ed.separator.lastFaces!.masks);
      }
      if (ed.selection.length > 1 || ed.wrap.active) this.openModify();
    });
  }

  /** Shift+A: the quick shapes, in the menu under the selection bar. */
  showShapeMenu() {
    this.selMenuOpen = true;
    this.selMenu.classList.add('show');
    this.placeMenu();
    this.selMenu.replaceChildren(...QUICK_SHAPES.map((t) => menuItem(Plus, shapeLabel(t), () => { this.toggleSelMenu(false); this.addShape(t); })));
  }

  /** The bubble's menu opens beside the context bar: above it when the bar is low, below when high. */
  private placeMenu() {
    const r = this.contextBar.el.getBoundingClientRect(), m = this.selMenu, vw = window.innerWidth, vh = window.innerHeight;
    m.style.transform = 'none';
    m.style.left = `${Math.min(Math.max(10, r.left + r.width / 2 - 140), vw - 290)}px`;
    if (r.top > vh / 2) {
      m.style.top = 'auto'; m.style.bottom = `${vh - r.top + 8}px`;
      m.style.maxHeight = `${Math.max(48, r.top - this.topbar.getBoundingClientRect().bottom - 16)}px`;
    } else {
      m.style.bottom = 'auto'; m.style.top = `${r.bottom + 8}px`;
      m.style.maxHeight = `${Math.max(48, vh - r.bottom - 18)}px`;
    }
  }

  /** A section that needs two or more selected objects: how to select them. */
  multiSelectHint(title: string, text: string) {
    const ed = this.editor;
    return section(title, hint(text),
      row(button(tr('Multi-select'), () => ed.setMultiSelect(!ed.multiSelect), { icon: Group, cls: `small ${ed.multiSelect ? 'primary' : ''}` })));
  }

  async freezeForEdit() {
    if (await this.editor.prepareGeometryEdit(this.editor.selection)) this.toast(tr('The optimized version is now the model, so it can be edited. Undo to go back.'), 'info', undefined, 6000);
  }
  openProjectPicker() { this.projectInput.click(); }

  projectRenamed(id: string, name: string) { if (this.projectId === id) this.projectName = name; }
  projectDeleted(id: string) {
    if (this.projectId !== id) return;
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = 0;
    this.projectId = null;
    this.restoring = true;
    try { this.editor.newScene(); this.projectName = tr('my-scene'); }
    finally { this.restoring = false; }
    void this.gallery.refresh();
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
    // The canvas is ready right away: saved projects are offered on the start card, not in a dialog
    this.gallery.refresh().catch((e) => this.toast(errorMessage(e), 'error'));
  }

  private scheduleAutosave() {
    // During AR the environment is temporarily changed: don't save that state
    if (this.restoring || this.nativeAR || this.editor.arMode || this.editor.recording || this.editor.cameraBackground) return;
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => this.autosaveNow().catch((e) => {
      // The reason (quota, private window, blocked storage…) is what tells the user and us what to do
      console.error('Autosave failed', e);
      this.toast(`${tr('Could not save in this browser. Export your project to keep it.')} (${e instanceof DOMException ? e.name : errorMessage(e)})`, 'error');
    }), 1500);
  }

  private async autosaveNow() {
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = 0;
    if (this.restoring || this.nativeAR || this.editor.arMode || this.editor.recording || this.editor.cameraBackground) return;
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
      const activity = this.beginActivity(tr(compact ? 'Preparing compact GLB' : 'Preparing scene GLB'));
      try {
        // Let the browser paint the activity before serialization starts.
        await new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
        const blob = await this.editor.exportGLB(compact);
        const name = timestampedName(compact ? 'scene-compact' : 'scene', 'glb');
        this.deliver(blob, name, tr('Scene exported as {name} ({size})', { name, size: formatBytes(blob.size) }));
      } finally { activity.finish(); }
    });
  }

  openTab(tab: Tab | null) {
    this.tab = this.tab === tab ? null : tab;
    haptic(this.tab ? 'selection' : 'light');
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

  /** Renders the context bubbles (the focused one shows its controls in `selbar`). */
  get focusedContext() { return this.contextBar.focusedId; }

  renderSelbar() {
    // Scene reset can end Mesh mode directly, without going through the panel's Cancel.
    if (this.separateUI && !this.editor.separator.active) {
      this.separateUI.sync();
      if (this.segment.objects && ['separate', 'select', 'sculpt'].includes(this.segment.objects)) this.segment.objects = 'object';
    }
    const previous = this.focusedContext;
    this.contextBar.render(this.contexts());
    if (previous !== this.focusedContext) this.toggleSelMenu(false);
    this.transformBar.render();
    this.contextBar.layout();
  }

  refreshContextMenu() { if (this.selMenuOpen) this.placeMenu(); }

  /** One expanded group with finger-sized controls; the other groups remain reachable circles. */
  renderContextParts(parts: { id: string; icon: IconNode; label: string; content: Node[] }[]) {
    if (!parts.some((p) => p.id === this.contextPart)) this.contextPart = 'tools';
    this.selbar.classList.add('ctx-sections');
    this.selbar.dataset.part = this.contextPart;
    const nodes = parts.map((p) => {
      let b = this.contextParts.get(p.id);
      if (!b) {
        const controls = h('div', { class: 'ctx-sub-controls' });
        const trigger = h('button', { class: 'ctx-sub-trigger', onClick: () => { this.contextPart = p.id; this.toggleSelMenu(false); this.renderSelbar(); } });
        const el = h('div', { class: 'ctx-sub', 'data-part': p.id }, trigger, controls);
        b = { el, trigger, controls };
        this.contextParts.set(p.id, b);
      }
      const expanded = this.contextPart === p.id;
      b.el.classList.toggle('expanded', expanded);
      b.trigger.hidden = expanded;
      b.controls.hidden = !expanded;
      b.trigger.title = p.label;
      b.trigger.setAttribute('aria-label', p.label);
      b.trigger.setAttribute('aria-expanded', String(expanded));
      b.trigger.replaceChildren(icon(p.icon));
      b.controls.replaceChildren(...p.content);
      return b.el;
    });
    this.selbar.replaceChildren(...nodes);
  }

  contextCameraControls() {
    const ed = this.editor;
    return [
      iconButton(Focus, tr('Focus camera'), () => ed.focus(), { label: tr('Focus camera'), cls: 'tool' }),
      iconButton(Orbit, tr('Orbit around this object'), () => ed.orbitAround(), { label: tr('Orbit'), cls: 'tool', active: ed.orbitEntity === ed.selected }),
      iconButton(Ellipsis, tr('More'), () => this.toggleSelMenu(), { label: tr('More'), cls: 'tool more-btn', active: this.selMenuOpen }),
    ];
  }

  /** Opens a part of a dock panel (a context's full settings). */
  private openPart(tab: Tab, part?: string) {
    if (part) this.segment[tab] = part;
    if (this.tab !== tab) this.openTab(tab); else this.renderPanel();
  }

  /**
   * Everything going on that has controls, most specific first: a recording, rigging, posing,
   * Mesh mode, measuring, the selection, then running operations (they keep going while the tool
   * object is shaped).
   */
  private contexts(): UIContext[] {
    const ed = this.editor, out: UIContext[] = [];
    if (ed.gizmoLoading) out.push(this.activityContext('transform-loading', Move3d, tr('Loading transform controls…'), null));
    if (ed.separator.cutLoading) out.push(this.activityContext('cut-loading', Triangle, tr('Loading cutting plane…'), null, () => { void this.run(() => ed.separator.setCut(false)); }));
    for (const [id, activity] of this.activities) out.push(this.activityContext(id, activity.icon, activity.label, activity.progress, activity.cancel));
    if (ed.optimizer.busy) out.push(this.activityContext('optimize-model', Triangle,
      tr(ed.optimizer.phase === 'bake' ? 'Baking surface detail: {name}' : 'Optimizing model: {name}', { name: ed.optimizer.entity?.name ?? tr('Scene') }), ed.optimizer.progress, () => ed.optimizer.cancel()));
    if (ed.textureOptimizer.busy) out.push(this.activityContext('optimize-textures', Layers,
      tr('Optimizing textures: {name}', { name: ed.textureOptimizer.entity?.name ?? tr('Scene') }), ed.textureOptimizer.progress, () => ed.textureOptimizer.cancel()));
    const selection = ed.separator.selection;
    if (selection?.topologyProgress != null) out.push(this.activityContext('mesh-topology', Triangle,
      tr('Preparing mesh: {name}', { name: selection.entity.name }), selection.topologyProgress, () => selection.cancelPrefetch()));
    if (ed.recording) out.push({ id: 'recording', icon: Video, label: tr('Recording…'), busy: true, render: () => this.selbar.replaceChildren(
      this.activitySummary(Video, tr('Recording…'), null),
      h('div', { class: 'sel-tools' }, button(tr('Cancel'), () => this.photoUI.cancelRecording(), { cls: 'small' })),
    ) });
    if (ed.rigger.active && (!ed.photoMode || ed.rigger.progress !== null || ed.rigger.comparing)) out.push({ id: 'rig', icon: Bone,
      label: ed.rigger.progress !== null ? tr('Rigging {name}: {pct}%', { name: ed.rigger.entity!.name, pct: Math.round(ed.rigger.progress * 100) }) : tr('Rig'),
      busy: ed.rigger.progress !== null || ed.rigger.comparing, progress: ed.rigger.progress,
      render: () => this.renderFeatureContext('rig', () => this.rigUI!.renderRigBar()), expand: () => this.openPart('objects', 'rig') });
    if (ed.photoMode) return out;
    if (ed.pose.active) out.push({ id: 'pose', icon: PersonStanding, label: tr('Pose'), render: () => this.poseUI.renderPoseBar(), expand: () => this.openPart('objects', 'pose') });
    if (ed.separator.active) {
      const n = ed.separator.selection?.count ?? 0;
      out.push({ id: 'mesh', icon: Triangle, label: n ? tr('{n} faces', { n: n.toLocaleString() }) : tr('Mesh'), render: () => this.renderFeatureContext('separate', () => this.separateUI!.bar()), expand: () => this.openPart('objects', this.separateUI?.getPart() ?? 'select') });
    }
    if (ed.tools.measureMode) out.push({ id: 'measure', icon: Ruler, label: tr('Measure'), render: () => this.selbar.replaceChildren(
      h('div', { class: 'sel-name measure always' }, icon(Ruler, 16), h('span', {}, ed.tools.pending ? tr('Tap the second point') : tr('Tap the first point'))),
      h('div', { class: 'sel-tools' }, button(tr('Done'), () => ed.tools.setMeasureMode(false), { cls: 'small primary' })),
    ), expand: () => this.openPart('tools', 'measure') });
    if ((ed.selected || ed.multiSelect) && !ed.separator.active && !ed.rigger.active && !ed.pose.active) {
      const e = ed.selected, n = ed.selection.length;
      out.push({ id: 'selection', icon: e ? KIND_ICON[e.kind] : Group, label: !e ? tr('Select') : n > 1 ? tr('{n} selected', { n }) : e.name, render: () => this.renderSelectionBar(), expand: e ? () => this.openPart('objects', 'object') : undefined });
    }
    const fusion = ed.fusion;
    if (fusion.busy || fusion.preview) out.push({ id: 'boolean', icon: SquaresUnite, label: tr('Boolean'), busy: fusion.busy, render: () => this.selbar.replaceChildren(
      fusion.busy ? this.activitySummary(SquaresUnite, tr('Building the new surface…'), null) : h('div', { class: 'sel-name always' }, icon(SquaresUnite, 16), h('span', {}, tr('Boolean'))),
      h('div', { class: 'sel-tools' },
        fusion.preview ? button(tr('Apply'), () => { fusion.apply(); this.renderAll(); }, { cls: 'small primary' }) : null,
        button(tr('Cancel'), () => { fusion.cancel(); this.renderAll(); }, { cls: 'small' })),
    ), expand: () => this.openPart('objects', 'modify') });
    const wrap = ed.wrap;
    if (wrap.active) out.push({ id: 'wrap', icon: Magnet, label: tr('Shrinkwrap'), render: () => this.selbar.replaceChildren(
      h('div', { class: 'sel-name always' }, icon(Magnet, 16), h('span', {}, tr('{target} onto {tool}', { target: wrap.target!.name, tool: wrap.tools.map((t) => t.name).join(', ') }))),
      h('div', { class: 'sel-tools' },
        button(tr('Apply'), () => { const n = wrap.apply(); this.toast(n ? tr('Surface wrapped onto the tool.') : tr('Nothing changed: move the tool over the surface.')); this.renderAll(); }, { cls: 'small primary' }),
        button(tr('Cancel'), () => { wrap.cancel(); this.renderAll(); }, { cls: 'small' })),
    ), expand: () => this.openPart('objects', 'modify') });
    return out;
  }

  /**
   * Object | Mesh, like Blender's Tab: the same Move / Rotate / Scale then work on the object or
   * on the selected faces. Only for one model or shape.
   */
  modeSwitch() {
    const ed = this.editor, e = ed.selected;
    const mesh = ed.separator.active;
    if (!mesh && (!e || e.kind === 'light' || e.groupMembers || ed.selection.length > 1)) return null;
    return h('span', { class: 'objmode' },
      iconButton(Box, tr('Object mode (Tab)'), () => { if (mesh) this.leaveMesh(); }, { active: !mesh, label: tr('Object'), cls: 'tool' }),
      iconButton(Triangle, tr('Mesh mode (Tab)'), () => { if (!mesh && e) this.startMesh(e); }, { active: mesh, label: tr('Mesh'), cls: 'tool' }),
    );
  }

  /** The selection's bubble: mode, Move / Rotate / Scale, Delete, More, Deselect. */
  private renderSelectionBar() {
    const ed = this.editor;
    const e = ed.selected;
    const multi = iconButton(Group, tr('Multi-select (or Shift+click)'), () => ed.setMultiSelect(!ed.multiSelect), { active: ed.multiSelect });
    if (!e) return this.selbar.replaceChildren(h('div', { class: 'sel-name wide' }, h('span', {}, tr('Tap objects to select'))), h('div', { class: 'sel-tools' }, multi));
    // Tapping the active Scale or Rotate again opens or closes its slider bar
    const toolBtn = (t: Tool, node: IconNode, label: string) =>
      iconButton(node, t === 'move' ? label : tr('{tool} (tap again for a slider)', { tool: label }), () => (ed.tool === t && t !== 'move' ? this.transformBar.toggle() : ed.setTool(t)), { active: ed.tool === t, label, cls: 'tool' });
    const mode = this.modeSwitch();
    this.renderContextParts([
      ...(mode ? [{ id: 'mode', icon: Box, label: tr('Object / Mesh'), content: [mode] }] : []),
      { id: 'tools', icon: Move3d, label: tr('Transform'), content: [
        toolBtn('move', Move3d, tr('Move')), toolBtn('rotate', Rotate3d, tr('Rotate')),
        ...(e.kind !== 'light' ? [toolBtn('scale', Scale3d, tr('Scale'))] : []),
      ] },
      { id: 'view', icon: Focus, label: tr('Camera and actions'), content: this.contextCameraControls() },
    ]);
    if (this.selMenuOpen) this.toggleSelMenu(true);
  }

  /** Secondary selection actions, one level deep. */
  private toggleSelMenu(open = !this.selMenuOpen) {
    const ed = this.editor;
    const e = ed.selected;
    this.selMenuOpen = open && !!e;
    this.selMenu.classList.toggle('show', this.selMenuOpen);
    this.placeMenu();
    this.selbar.querySelector('.more-btn')?.classList.toggle('active', this.selMenuOpen);
    if (!this.selMenuOpen || !e) return;
    const item = (node: IconNode, label: string, run: () => void, opts: { on?: boolean; keep?: boolean; kbd?: string } = {}) =>
      menuItem(node, label, () => (opts.keep ? null : this.toggleSelMenu(false), run()), opts);
    if (ed.separator.active) {
      const s = ed.separator;
      this.selMenu.replaceChildren(
        item(Focus, tr('Focus camera'), () => ed.focus(), { kbd: 'F' }),
        item(Orbit, tr('Orbit around this object'), () => ed.orbitAround(), { on: ed.orbitEntity === e, kbd: 'O' }),
        item(Undo2, s.mode === 'select' ? tr('Undo selection') : tr('Undo'), () => s.mode === 'select' ? s.edit((sel) => sel.undo()) : ed.undo()),
        item(X, tr('Done (Tab)'), () => this.leaveMesh()),
      );
      return;
    }
    this.selMenu.replaceChildren(
      ...(e.groupMembers ? [item(Group, tr('Ungroup'), () => ed.ungroup(e))] : []),
      item(Plus, tr('Add shape here'), () => this.showShapeMenu(), { kbd: 'Shift+A', keep: true }),
      ...(ed.selection.length > 1 ? [item(Group, tr('Boolean, shrinkwrap, combine…'), () => this.openModify())] : []),
      item(Copy, tr('Duplicate'), () => ed.duplicate(), { kbd: 'Ctrl+D' }),
      item(Trash2, tr('Delete (Del)'), () => ed.remove()),
      item(X, tr('Deselect (Esc)'), () => ed.select(null)),
      item(Focus, tr('Focus camera'), () => ed.focus(), { kbd: 'F' }),
      item(Orbit, tr('Orbit around this object'), () => {
        ed.orbitAround();
        this.toast(tr('Orbiting around {name}', { name: e.name }));
      }, { on: ed.orbitEntity === e, kbd: 'O' }),
      ...(e.animationGroups.length && ed.selection.length === 1
        ? [ed.anim.isPlaying(e) ? item(Pause, tr('Pause animation'), () => ed.anim.pause(e)) : item(Play, tr('Play animation'), () => ed.anim.play(e))]
        : []),
      ...(!e.groupMembers && skeletonsOf(e).length ? [item(PersonStanding, tr('Pose joints'), () => this.poseUI.startPosing(e))] : []),
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
      isFullscreenAvailable()
        ? isFullscreen()
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
    this.contextBar.setHidden(on);
    if (on) {
      this.toggleMenu(false);
      this.toggleSelMenu(false);
    }
  }

  /**
   * Hierarchical back button handler for Android navigation.
   * Returns true if a modal, menu, panel, or sub-mode was closed; false if already at root.
   */
  handleBack(): boolean {
    const dialog = document.querySelector('dialog[open]') as HTMLDialogElement | null;
    if (dialog) {
      dialog.close();
      return true;
    }
    if (this.menuOpen) {
      this.toggleMenu(false);
      return true;
    }
    if (this.selMenuOpen) {
      this.toggleSelMenu(false);
      return true;
    }
    if (this.uiHidden) {
      this.setUiHidden(false);
      return true;
    }
    if (this.editor.photoMode) {
      if (this.photoPanel) {
        this.photoPanel = false;
        this.renderAll();
        return true;
      }
      this.editor.setPhotoMode(false);
      return true;
    }
    if (this.ar?.active) {
      void this.ar.exit();
      return true;
    }
    if (this.tab !== null) {
      this.openTab(null);
      return true;
    }
    if (this.editor.separator.active) {
      this.leaveMesh();
      return true;
    }
    if (this.editor.rigger.active) {
      this.editor.rigger.cancel();
      return true;
    }
    if (this.editor.pose.active) {
      this.editor.pose.stop();
      return true;
    }
    if (this.editor.tools.pending) {
      this.editor.tools.cancelPending();
      return true;
    }
    if (this.editor.tools.measureMode) {
      this.editor.tools.setMeasureMode(false);
      return true;
    }
    if (this.editor.selected || this.editor.multiSelect) {
      this.editor.select(null);
      return true;
    }
    return false;
  }

  private panelCloseTimer = 0;

  renderPanel() {
    const ed = this.editor;
    const tab: Tab | null = ed.photoMode ? (this.photoPanel ? 'photo' : null) : this.tab;
    this.panel.classList.toggle('show', !!tab);
    document.body.classList.toggle('panel-open', !!tab);
    this.panelSheet.scheduleLayout();
    if (!tab) {
      window.clearTimeout(this.panelCloseTimer);
      this.panelCloseTimer = window.setTimeout(() => {
        if (!this.tab && (!this.editor.photoMode || !this.photoPanel)) {
          this.panel.replaceChildren();
        }
      }, 280);
      if (ed.rigger.active) this.renderSelbar();
      return;
    }
    window.clearTimeout(this.panelCloseTimer);
    const title = this.editor.separator.active && tab === 'objects' ? tr('Mesh') : tr(PANEL_TITLES[tab]);
    const scroll = this.panel.querySelector('.panel-body')?.scrollTop ?? 0;
    const parts = this.panelParts(tab);
    const current = parts?.find((p) => p.id === this.segment[tab]) ? this.segment[tab]! : parts?.[0].id ?? '';
    let content: (Node | null)[];
    try {
      content = this.panelContent(tab, current);
    } catch (e) {
      console.error('Error rendering panel content:', e);
      content = [hint(tr('An error occurred while displaying this panel.')), button(tr('Try again'), () => this.renderPanel())];
    }
    const body = h('div', { class: 'panel-body' }, ...content);
    const rigging = tab === 'objects' && current === 'rig' && ed.rigger.active && ed.rigger.entity === ed.selected;
    const meshActive = tab === 'objects' && ed.separator.active;
    this.panel.replaceChildren(
      this.panelSheet.handle,
      h(
        'div',
        { class: 'panel-head' },
        h('h2', {}, title),
        iconButton(X, tr('Close'), () => (ed.photoMode ? ((this.photoPanel = false), this.renderAll()) : this.openTab(null))),
      ),
      ...(parts && parts.length > 1
        ? [
            scrollableSegmented(parts, current, (id) => {
              this.segment[tab] = id;
              if (this.editor.separator.active && this.separateUI) {
                this.separateUI.setPart(id as 'select' | 'sculpt' | 'modify');
              }
              this.panel.querySelector('.panel-body')!.scrollTop = 0;
              this.renderPanel();
              this.labelsUI.buildLabels();
            }),
          ]
        : []),
      ...(rigging && this.rigUI ? [this.rigUI.rigStepper()] : []),
      body,
      ...(rigging && this.rigUI ? [this.rigUI.rigFooter()] : []),
      ...(meshActive && this.separateUI ? [this.separateUI.footer()] : []),
    );
    this.panel.scrollTop = 0;
    this.panel.scrollLeft = 0;
    body.scrollTop = scroll;
    this.panelSheet.update();
    if (ed.rigger.active) this.renderSelbar();
  }

  /** Parts of a panel, switched at its top (one level: no nested menus). */
  private panelParts(tab: Tab): { id: string; label: string }[] | null {
    switch (tab) {
      case 'add': return [{ id: 'add', label: tr('Add') }, { id: 'library', label: tr('Library') }];
      case 'objects': {
        const e = this.editor.selected;
        if (!e || e.kind === 'light') return null;
        if (this.editor.separator.active) {
          return [
            { id: 'select', label: tr('Select') },
            { id: 'sculpt', label: tr('Sculpt') },
            { id: 'modify', label: tr('Modify') },
          ];
        }
        if (e.groupMembers) return [{ id: 'object', label: tr('Object') }, { id: 'material', label: tr('Material') }, { id: 'modify', label: tr('Modify') }];
        return [
          { id: 'object', label: tr('Object') },
          ...(this.editor.materialsOf(e).length ? [{ id: 'material', label: tr('Material') }] : []),
          { id: 'animate', label: tr('Animate') },
          ...(this.editor.rigger.active && this.editor.rigger.entity === e
            ? [{ id: 'rig', label: tr('Rig') }]
            : skeletonsOf(e).length ? [{ id: 'pose', label: tr('Pose') }] : this.editor.rigger.canRig(e) ? [{ id: 'rig', label: tr('Rig') }] : []),
          ...(e.kind === 'model' ? [{ id: 'optimize', label: tr('Optimize') }] : []),
          { id: 'modify', label: tr('Modify') },
        ];
      }
      case 'light':
        return [
          { id: 'lights', label: tr('Lights') },
          { id: 'environment', label: tr('Environment') },
          { id: 'library', label: tr('Library') },
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

  private library: LibraryPanel | null = null;
  loadRigUI() { return this.ensureFeature('rig'); }

  private ensureFeature(name: 'rig' | 'optimize' | 'separate' | 'modify'): Promise<void> {
    const ready = { rig: this.rigUI, optimize: this.optimizeUI, separate: this.separateUI, modify: this.modifyUI }[name];
    if (ready) return Promise.resolve();
    const pending = this.featureLoads.get(name);
    if (pending) return pending;
    // Register the promise before rendering its activity, to avoid reentrant duplicate loads.
    const load = Promise.resolve().then(async () => {
      const activity = this.beginActivity(tr('Loading {name}', { name: tr({ rig: 'Rig', optimize: 'Optimize', separate: 'Mesh', modify: 'Modify' }[name]) }), Layers);
      try {
        if (name === 'rig') this.rigUI = new (await import('./panels/rig')).RigPanel(this);
        if (name === 'optimize') this.optimizeUI = new (await import('./panels/optimize')).OptimizePanel(this);
        if (name === 'separate') this.separateUI = new (await import('./panels/separate')).SeparatePanel(this);
        if (name === 'modify') this.modifyUI = new (await import('./panels/modify')).ModifyPanel(this);
        this.featureErrors.delete(name);
      } catch (error) {
        this.featureErrors.set(name, errorMessage(error));
        throw error;
      } finally {
        this.featureLoads.delete(name);
        activity.finish();
        this.renderAll();
      }
    });
    this.featureLoads.set(name, load);
    return load;
  }

  private featureContent(name: 'rig' | 'optimize' | 'separate' | 'modify', render: () => (Node | null)[]): (Node | null)[] {
    if ({ rig: this.rigUI, optimize: this.optimizeUI, separate: this.separateUI, modify: this.modifyUI }[name]) return render();
    const error = this.featureErrors.get(name);
    if (error) return [hint(error), button(tr('Try again'), () => { this.featureErrors.delete(name); void this.run(() => this.ensureFeature(name)); this.renderPanel(); })];
    void this.ensureFeature(name).catch(() => {});
    return [hint(tr('Loading…'))];
  }

  private renderFeatureContext(name: 'rig' | 'separate', render: () => void) {
    if (name === 'rig' ? this.rigUI : this.separateUI) { render(); return; }
    this.selbar.replaceChildren(...this.featureContent(name, () => []).filter((node): node is Node => node !== null));
  }

  private startMesh(entity: Entity) {
    void this.run(async () => {
      await this.ensureFeature('separate');
      if (this.editor.selected === entity && this.editor.entities.includes(entity)) this.separateUI!.start(entity);
    });
  }

  private leaveMesh() {
    if (this.separateUI) this.separateUI.cancel();
    else { this.editor.separator.cancel(); this.renderAll(); }
  }
  private libraryLoading: Promise<void> | null = null;
  private libraryContent(kind: LibraryKind): Node[] {
    if (this.library) return [this.library.content(kind)];
    this.libraryLoading ??= import('./panels/library').then(({ LibraryPanel }) => {
      this.library = new LibraryPanel(this);
      this.renderPanel();
    }).catch((e) => { this.libraryLoading = null; this.toast(errorMessage(e), 'error'); });
    return [h('p', { role: 'status' }, tr('Loading…'))];
  }

  private panelContent(tab: Tab, part: string): (Node | null)[] {
    switch (tab) {
      case 'add':
        return part === 'library' ? this.libraryContent('model') : this.addUI.addPanel();
      case 'objects': {
        // An operation in progress stays on top of every part until Apply or Cancel
        const operation = part === 'modify' ? null : this.modifyUI?.operation();
        const content = this.objectsPart(part);
        return operation ? [operation, ...content] : content;
      }
      case 'light':
        return part === 'library' ? this.libraryContent('hdri') : part === 'environment' ? this.lightUI.envPanel() : this.lightUI.lightsPanel();
      case 'photo': {
        // [enter, filters, camera, light & color, effects, depth of field, reset]
        const all = this.photoUI.photoPanelContent();
        return part === 'camera' ? [all[2], all[5], all[6]] : [all[0], all[1], all[3], all[4], all[7]];
      }
      case 'tools': {
        const [measure, guides, align] = this.toolsUI.toolsPanel();
        return [part === 'guides' ? guides : part === 'align' ? align : measure];
      }
    }
  }

  private objectsPart(part: string): (Node | null)[] {
    if (this.editor.separator.active) {
      return this.featureContent('separate', () => this.separateUI!.panel(part as 'select' | 'sculpt' | 'modify'));
    }
    if (part === 'material') return this.materialUI.materialPanel();
    if (part === 'animate') return this.animateUI.animatePanel();
    if (part === 'pose') return this.poseUI.posePanel();
    if (part === 'rig') return this.featureContent('rig', () => this.rigUI!.rigPanel());
    if (part === 'optimize') return this.featureContent('optimize', () => this.optimizeUI!.optimizePanel());
    if (part === 'separate') return this.featureContent('separate', () => this.separateUI!.panel());
    if (part === 'modify') return this.featureContent('modify', () => this.modifyUI!.panel());
    return this.objectsUI.scenePanel();
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
