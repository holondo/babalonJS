import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { CreateScreenshotUsingRenderTargetAsync } from '@babylonjs/core/Misc/screenshotTools.js';
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture.js';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Observable } from '@babylonjs/core/Misc/observable.js';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { WebXRDefaultExperience } from '@babylonjs/core/XR/webXRDefaultExperience.js';
import { WebXRFeatureName } from '@babylonjs/core/XR/webXRFeaturesManager.js';
import { WebXRSessionManager } from '@babylonjs/core/XR/webXRSessionManager.js';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture.js';
import { type IWebXRHitResult, WebXRHitTest } from '@babylonjs/core/XR/features/WebXRHitTest.js';
import type { Node } from '@babylonjs/core/node.js';
import type { ShadowLight } from '@babylonjs/core/Lights/shadowLight.js';
import { WebXRRawCameraAccess } from '@babylonjs/core/XR/features/WebXRRawCameraAccess.js';
import '@babylonjs/core/XR/features/WebXRDOMOverlay.js';
import '@babylonjs/core/XR/features/WebXRLightEstimation.js';
import { WebXRAnchorSystem, type IWebXRAnchor } from '@babylonjs/core/XR/features/WebXRAnchorSystem.js';
import { WebXRDepthSensing } from '@babylonjs/core/XR/features/WebXRDepthSensing.js';
import { MultiMaterial } from '@babylonjs/core/Materials/multiMaterial.js';
import type { Material } from '@babylonjs/core/Materials/material.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import type { Measurement } from '../tools/tools';
import { tr } from '../core/i18n';
import { createLight, createShadowGenerator } from '../core/editor';
import type { Editor } from '../core/editor';
import { PHOTO_FILTERS, filterToCanvas, findLightPreset, presetIntensity } from '../core/presets';

export type ARStatus = 'searching' | 'ready' | 'placed';
/** "scene" = the editor's own lights; "room" = estimated by the phone; the rest are presets. */
/** "scene" = the editor's own lights; "room" = estimated by the phone; otherwise a preset id (presets.ts). */
export type ARLighting = string;

interface Saved {
  node: TransformNode;
  parent: Node | null;
  position: Vector3;
  rotation: Quaternion | null;
  euler: Vector3;
  scaling: Vector3;
}

/**
 * Augmented reality through WebXR (Chrome on Android with ARCore): the composed scene is placed
 * on a real surface at real size, with shadows on the real floor and a photo of camera + 3D.
 */
export class ARMode {
  readonly changed = new Observable<void>();
  supported = false;
  active = false;
  status: ARStatus = 'searching';
  /** Scale of the scene relative to real size (1 = 1:1). */
  scale = 1;
  /** Whether the phone gives the camera image to the page (needed for photos). */
  cameraImage = false;

  private readonly editor: Editor;
  private xr: WebXRDefaultExperience | null = null;
  private hitTest: WebXRHitTest | null = null;
  private cameraAccess: WebXRRawCameraAccess | null = null;
  private anchor: TransformNode | null = null;
  private reticle: Mesh | null = null;
  private lastHit: IWebXRHitResult | null = null;
  private saved: Saved[] = [];
  /** Orientation offset so the scene faces the user like it did in the editor. */
  private anchors: WebXRAnchorSystem | null = null;
  private sceneAnchor: IWebXRAnchor | null = null;
  private placementGeneration = 0;
  private sessionGeneration = 0;
  private pointAnchors = new Map<IWebXRAnchor, Vector3>();
  private pendingPoint: Vector3 | null = null;
  private pendingPreview: Measurement | null = null;
  private pendingAnchor: IWebXRAnchor | null = null;
  private pendingGeneration = 0;
  private depth: WebXRDepthSensing | null = null;
  private depthMaterials: { mesh: AbstractMesh; original: Material | null }[] = [];
  private depthClones: Material[] = [];
  requestDepthOnNextSession = false;
  depthSupported = false;
  depthRequested = false;
  occlusion = false;
  measuring = false;
  get measurementPending() { return !!this.pendingPoint; }
  get measurements() { return this.editor.tools.sessionMeasurements.filter((m) => m !== this.pendingPreview); }
  get anchored() { return !!this.sceneAnchor; }
  private baseYaw = 0;
  private yaw = 0;

  constructor(editor: Editor) {
    this.editor = editor;
  }

  async checkSupport() {
    try {
      this.supported = !!navigator.xr && (await WebXRSessionManager.IsSessionSupportedAsync('immersive-ar'));
    } catch {
      this.supported = false;
    }
    this.changed.notifyObservers();
    return this.supported;
  }

  /** Optional extras, all off / cheapest when AR starts. */
  shadows = false;
  lighting: ARLighting = 'scene';
  /** Multiplies every light and the environment (1 = as designed). */
  lightLevel = 1;
  filter = 'none';
  /** Virtual AR: the scene's environment instead of the camera image. */
  virtual = false;

  setVirtual(on: boolean) {
    this.virtual = on;
    this.editor.setARVirtual(on);
    this.changed.notifyObservers();
  }

  private rig: { light: ShadowLight; base: number; gen?: ShadowGenerator }[] = [];
  /** The editor's lights and their intensities, restored when AR ends. */
  private sceneLights: { light: ShadowLight; base: number }[] = [];
  private baseEnvIntensity = 1;
  /** Scene size in anchor space (for presets). */
  private local = { size: 2, height: 1 };

  /** Shadows of the scene on the real floor. */
  setShadows(on: boolean) {
    this.shadows = on;
    this.editor.setShadowsEnabled(on && this.sceneLightsOn());
    for (const r of this.rig) if (r.gen) r.light.shadowEnabled = on;
    this.updateShadowRefresh();
    this.changed.notifyObservers();
  }

  private sceneLightsOn() {
    return this.lighting === 'scene' || this.lighting === 'room';
  }

  /** Switches the AR lighting: the editor's lights, the room's (estimated), or a preset. */
  setLighting(id: ARLighting) {
    if (!this.xr) return;
    const fm = this.xr.baseExperience.featuresManager;
    this.clearRig();
    try {
      if (id === 'room') fm.attachFeature(WebXRFeatureName.LIGHT_ESTIMATION);
      else if (this.lighting === 'room') {
        fm.detachFeature(WebXRFeatureName.LIGHT_ESTIMATION);
        this.editor.restoreEnvironmentTexture();
      }
    } catch (e) {
      this.reportError(e instanceof Error ? e.message : String(e));
    }
    this.lighting = id;
    const sceneOn = this.sceneLightsOn();
    for (const s of this.sceneLights) s.light.setEnabled(sceneOn);
    this.editor.setShadowsEnabled(this.shadows && sceneOn);
    this.baseEnvIntensity = this.editor.env.intensity;
    if (id !== 'scene' && id !== 'room') this.buildRig(id);
    this.applyLightLevel();
    this.updateShadowRefresh();
    this.changed.notifyObservers();
  }

  setLightLevel(level: number) {
    this.lightLevel = level;
    this.applyLightLevel();
  }

  fps() {
    return this.editor.engine.getFps();
  }

  setFilter(id: string) {
    this.filter = id;
    this.changed.notifyObservers();
  }

  private applyLightLevel() {
    for (const s of this.sceneLights) s.light.intensity = s.base * this.lightLevel;
    for (const r of this.rig) r.light.intensity = r.base * this.lightLevel;
    this.editor.scene.environmentIntensity = this.baseEnvIntensity * this.lightLevel;
  }

  private buildRig(id: string) {
    const anchor = this.anchor;
    const preset = findLightPreset(id);
    if (!anchor || !preset) return;
    const scene = this.editor.scene;
    this.baseEnvIntensity = preset.env.intensity ?? this.baseEnvIntensity;
    const k = Math.max(this.local.size, 0.5) / 2;
    const focus = new Vector3(0, this.local.height / 2, 0);
    const casters = this.editor.entities.filter((e) => e.kind !== 'light' && !e.groupMembers && e.visible && e.root.isEnabled()).flatMap((e) => e.meshes);
    for (const def of preset.lights) {
      const pos = new Vector3(...def.pos).scale(k);
      const direction = focus.subtract(pos).normalize();
      const light = createLight(def.type, 'arRig', scene, { position: pos, direction, angle: def.angle, color: Color3.FromHexString(def.color) });
      light.parent = anchor;
      const base = presetIntensity(def, k);
      let gen: ShadowGenerator | undefined;
      if (def.shadows) {
        gen = createShadowGenerator(light, def.type);
        gen.getShadowMap()!.renderList = [...casters];
        light.shadowEnabled = this.shadows;
      }
      this.rig.push({ light, base, gen });
    }
  }

  private clearRig() {
    for (const r of this.rig) {
      r.gen?.dispose();
      r.light.dispose();
    }
    this.rig = [];
  }

  /**
   * Shadow maps are redrawn only when the scene moves (not every frame), unless something is
   * animating. Same image, much less GPU work.
   */
  private updateShadowRefresh() {
    const animating = this.editor.scene.animatables.some((a) => !a.paused);
    const gens = [...this.editor.entities.map((e) => e.shadowGen), ...this.rig.map((r) => r.gen)].filter((g): g is ShadowGenerator => !!g);
    for (const g of gens) {
      const map = g.getShadowMap();
      if (!map) continue;
      map.refreshRate = animating ? RenderTargetTexture.REFRESHRATE_RENDER_ONEVERYFRAME : RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
      map.resetRefreshCounter();
    }
  }

  /** Last error seen during the session (shown in the overlay to help diagnose problems). */
  lastError = '';

  private reportError(text: string) {
    if (!this.active) return;
    this.lastError = text;
    this.changed.notifyObservers();
  }

  /** Starts the AR session. Must be called from a tap (browsers require a user gesture). */
  async enter(overlay: HTMLElement) {
    if (this.active) return;
    this.editor.fusion.cancel();
    this.editor.separator.cancel();
    const scene = this.editor.scene;
    if (!this.xr) {
      this.xr = await WebXRDefaultExperience.CreateAsync(scene, {
        disableDefaultUI: true,
        disableTeleportation: true,
        disablePointerSelection: true,
        disableNearInteraction: true,
        disableHandTracking: true,
        optionalFeatures: false,
      });
      const fm = this.xr.baseExperience.featuresManager;
      // All optional: if the phone lacks one, the others still work
      this.hitTest = fm.enableFeature(WebXRHitTest.Name, 'latest', {}, true, false) as WebXRHitTest;
      fm.enableFeature(WebXRFeatureName.DOM_OVERLAY, 'latest', { element: overlay, supressXRSelectEvents: true }, true, false);
      // Expensive features are requested with the session but stay detached: AR starts as cheap
      // as possible and the user turns them on (room lighting) or they run only when needed (photo).
      fm.enableFeature(WebXRFeatureName.LIGHT_ESTIMATION, 'latest', { setSceneEnvironmentTexture: true, createDirectionalLightSource: false }, false, false);
      this.cameraAccess = fm.enableFeature(WebXRRawCameraAccess.Name, 'latest', {}, false, false) as WebXRRawCameraAccess;

      try {
        this.anchors = fm.enableFeature(WebXRAnchorSystem.Name, 'latest', {}, false, false) as WebXRAnchorSystem;
        this.anchors.onAnchorUpdatedObservable.add((anchor) => {
          if (anchor === this.sceneAnchor && this.anchor) {
            anchor.transformationMatrix.getTranslationToRef(this.anchor.position);
            this.applyTransform();
          }
          const point = this.pointAnchors.get(anchor);
          if (point) anchor.transformationMatrix.getTranslationToRef(point);
        });
      } catch { /* Optional: ordinary placement remains available. */ }
      this.hitTest.onHitTestResultObservable.add((results) => this.onHit(results));
      this.cameraAccess.onTexturesUpdatedObservable.add((t) => {
        if (t.length && !this.cameraImage) {
          this.cameraImage = true;
          this.changed.notifyObservers();
        }
      });
      this.xr.baseExperience.sessionManager.onXRSessionEnded.add(() => this.cleanup());
      window.addEventListener('error', (e) => this.reportError(e.message));
      window.addEventListener('unhandledrejection', (e) => this.reportError(String(e.reason?.message ?? e.reason)));
      this.editor.engine.onContextLostObservable.add(() => this.reportError('WebGL context lost'));

      this.reticle = MeshBuilder.CreateTorus('arReticle', { diameter: 0.3, thickness: 0.012, tessellation: 64 }, scene);
      const mat = new StandardMaterial('arReticle', scene);
      mat.disableLighting = true;
      mat.emissiveColor = Color3.FromHexString('#e9a83b');
      this.reticle.material = mat;
      this.reticle.isPickable = false;
      this.reticle.rotationQuaternion = new Quaternion();
      this.reticle.setEnabled(false);
    }

    const fm = this.xr.baseExperience.featuresManager;
    this.depthRequested = this.requestDepthOnNextSession;
    this.depthSupported = false;
    this.occlusion = false;
    if (this.depthRequested && !this.depth) {
      try {
        this.depth = fm.enableFeature(WebXRDepthSensing.Name, 'latest', {
          usagePreference: ['gpu'], dataFormatPreference: ['float', 'ushort', 'luminance-alpha'],
          useToleranceFactorForDepthSensing: false,
        }, false, false) as WebXRDepthSensing;
      } catch { /* Depth support is optional. */ }
    } else if (!this.depthRequested && this.depth) {
      fm.disableFeature(WebXRDepthSensing.Name);
      this.depth = null;
    }
    this.sessionGeneration++;
    this.editor.setARMode(true);
    this.wrapScene();
    this.status = 'searching';
    this.scale = 1;
    this.lastHit = null;
    this.cameraImage = false;
    this.lastError = '';
    this.shadows = false;
    this.lighting = 'scene';
    this.lightLevel = 1;
    this.filter = 'none';
    this.virtual = false;
    this.baseEnvIntensity = this.editor.env.intensity;
    this.editor.setShadowsEnabled(false);
    this.active = true;
    this.changed.notifyObservers();
    try {
      await this.xr.baseExperience.enterXRAsync('immersive-ar', 'local-floor', this.xr.renderTarget);
      const session = this.xr.baseExperience.sessionManager.session;
      this.depthSupported = !!this.depth && session.depthUsage === 'gpu-optimized' && !!session.depthDataFormat;
      this.setHitTest(true);
      this.changed.notifyObservers();
    } catch (e) {
      this.cleanup();
      throw e;
    }
  }

  async exit() {
    if (!this.active || !this.xr) return;
    await this.xr.baseExperience.exitXRAsync();
  }

  /** Groups every object under one node so the whole composition moves, turns and scales together. */
  private wrapScene() {
    const ed = this.editor;
    const b = ed.sceneBounds();
    const anchor = new TransformNode('arAnchor', ed.scene);
    anchor.rotationQuaternion = Quaternion.Identity();
    anchor.position.set(b ? b.center.x : 0, b ? b.min.y : 0, b ? b.center.z : 0);
    anchor.computeWorldMatrix(true);
    const nodes: TransformNode[] = [...ed.entities.filter(e => !e.groupParent).map((e) => e.root), ed.groundMesh];
    this.saved = nodes.map((node) => ({
      node,
      parent: node.parent,
      position: node.position.clone(),
      rotation: node.rotationQuaternion?.clone() ?? null,
      euler: node.rotation.clone(),
      scaling: node.scaling.clone(),
    }));
    for (const n of nodes) n.setParent(anchor);
    anchor.setEnabled(false);
    this.anchor = anchor;
    this.local = { size: b ? Math.max(b.size.x, b.size.y, b.size.z) : 2, height: b ? b.size.y : 1 };
    this.sceneLights = ed.entities.filter((e) => e.light && e.visible).map((e) => ({ light: e.light!, base: e.light!.intensity }));

    // Keep the side the user was looking at in the editor facing them in AR
    const cam = ed.camera;
    const view = cam.position.subtract(cam.target);
    this.baseYaw = Math.atan2(view.x, view.z);
  }

  /** Puts everything back exactly where it was in the editor. */
  private cleanup() {
    if (!this.active) return;
    this.sessionGeneration++;
    this.clearSceneAnchor();
    this.clearMeasurements();
    this.setOcclusion(false);
    this.measuring = false;
    this.depthSupported = false;
    this.clearRig();
    for (const s of this.sceneLights) {
      s.light.intensity = s.base;
      s.light.setEnabled(true);
    }
    this.sceneLights = [];
    for (const e of this.editor.entities) {
      const map = e.shadowGen?.getShadowMap();
      if (map) map.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONEVERYFRAME;
    }
    if (this.lighting === 'room') {
      try {
        this.xr?.baseExperience.featuresManager.detachFeature(WebXRFeatureName.LIGHT_ESTIMATION);
      } catch {
        // Session already gone
      }
    }
    for (const s of this.saved) {
      s.node.parent = s.parent;
      s.node.position.copyFrom(s.position);
      s.node.rotationQuaternion = s.rotation;
      s.node.rotation.copyFrom(s.euler);
      s.node.scaling.copyFrom(s.scaling);
    }
    this.saved = [];
    this.anchor?.dispose(true);
    this.anchor = null;
    this.reticle?.setEnabled(false);
    this.active = false;
    this.editor.setARMode(false);
    this.changed.notifyObservers();
  }

  private onHit(results: IWebXRHitResult[]) {
    if (!this.reticle) return;
    const hit = results[0] ?? null;
    this.lastHit = hit;
    const showReticle = !!hit && (this.measuring || this.status !== 'placed');
    this.reticle.setEnabled(showReticle);
    if (hit) {
      this.reticle.position.copyFrom(hit.position);
      this.reticle.rotationQuaternion!.copyFrom(hit.rotationQuaternion);
    }
    if (this.status !== 'placed') {
      const next: ARStatus = hit ? 'ready' : 'searching';
      if (next !== this.status) {
        this.status = next;
        this.changed.notifyObservers();
      }
    }
  }

  /** Tap: places (or moves) the scene where the marker is. */
  place() {
    if (!this.lastHit || this.measuring) return false;
    return this.placeAt(this.lastHit.position);
  }

  /**
   * Places the scene on the floor in front of the user, without needing a detected surface
   * (useful in virtual AR, or when the camera can't find the floor).
   */
  placeInFront() {
    if (!this.xr) return false;
    const cam = this.xr.baseExperience.camera;
    const pos = cam.globalPosition;
    const forward = cam.getDirection(Vector3.Forward());
    forward.y = 0;
    if (forward.lengthSquared() < 1e-6) forward.set(0, 0, 1);
    forward.normalize();
    const distance = Math.max(1.2, this.local.size * 1.2);
    // "local-floor" puts the floor at 0; otherwise assume the phone is held ~1.4 m above it
    const floor = pos.y > 0.6 ? 0 : pos.y - 1.4;
    return this.placeAt(new Vector3(pos.x + forward.x * distance, floor, pos.z + forward.z * distance));
  }

  private placeAt(point: Vector3) {
    if (!this.anchor || !this.xr) return false;
    this.clearSceneAnchor();
    this.anchor.position.copyFrom(point);
    const cam = this.xr.baseExperience.camera.globalPosition;
    const toUser = cam.subtract(point);
    this.yaw = Math.atan2(toUser.x, toUser.z) - this.baseYaw;
    this.applyTransform();
    this.anchor.setEnabled(true);
    this.status = 'placed';
    this.reticle?.setEnabled(false);
    // Surface detection runs every frame; it's only needed while looking for a spot
    this.setHitTest(this.measuring);
    const generation = this.placementGeneration;
    void this.createTrackedPoint(point).then((anchor) => {
      if (!anchor) return;
      if (generation !== this.placementGeneration || !this.active) { anchor.remove(); return; }
      this.sceneAnchor = anchor;
      this.changed.notifyObservers();
    });
    this.updateShadowRefresh();
    this.changed.notifyObservers();
    return true;
  }

  /** Shows the marker again so the scene can be moved to another spot. */
  replace() {
    this.setMeasuring(false);
    this.clearSceneAnchor();
    this.lastHit = null;
    this.setHitTest(true);
    this.status = 'searching';
    this.changed.notifyObservers();
  }

  private clearSceneAnchor() {
    this.placementGeneration++;
    this.sceneAnchor?.remove();
    this.sceneAnchor = null;
  }

  /** Queue creation for the next XR frame: UI taps do not run inside a native XR frame. */
  private async createTrackedPoint(point: Vector3) {
    const feature = this.anchors;
    if (!feature || !this.xr || !this.active) return null;
    const session = this.sessionGeneration;
    try {
      if (!feature.attached && !feature.attach()) return null;
      const anchor = await feature.addAnchorAtPositionAndRotationAsync(point.clone(), Quaternion.Identity());
      if (!this.active || session !== this.sessionGeneration) { anchor.remove(); return null; }
      return anchor;
    } catch { return null; }
  }

  setMeasuring(on: boolean) {
    this.measuring = on;
    this.cancelMeasurementPoint();
    this.lastHit = null;
    this.reticle?.setEnabled(false);
    this.setHitTest(on || this.status !== 'placed');
    this.changed.notifyObservers();
  }

  cancelMeasurementPoint() {
    this.pendingGeneration++;
    if (this.pendingAnchor) {
      this.pointAnchors.delete(this.pendingAnchor);
      this.pendingAnchor.remove();
    }
    if (this.pendingPreview) this.editor.tools.removeSessionMeasurement(this.pendingPreview);
    this.pendingPreview = null;
    this.pendingPoint = null;
    this.pendingAnchor = null;
  }

  measurePoint() {
    if (!this.measuring || !this.lastHit) return false;
    const point = this.lastHit.position.clone();
    if (!this.pendingPoint) {
      this.pendingPreview = this.editor.tools.addSessionMeasurement(point, point);
      this.pendingPoint = this.pendingPreview.a.local;
      const generation = ++this.pendingGeneration;
      void this.createTrackedPoint(point).then((anchor) => {
        if (!anchor) return;
        if (generation !== this.pendingGeneration) { anchor.remove(); return; }
        this.pendingAnchor = anchor;
        this.pointAnchors.set(anchor, this.pendingPoint!);
      });
    } else {
      const first = this.pendingPoint;
      const firstAnchor = this.pendingAnchor;
      if (this.pendingPreview) this.editor.tools.removeSessionMeasurement(this.pendingPreview);
      this.pendingPreview = null;
      this.pendingGeneration++;
      this.pendingPoint = null;
      this.pendingAnchor = null;
      const measurement = this.editor.tools.addSessionMeasurement(first, point);
      if (firstAnchor) this.pointAnchors.set(firstAnchor, measurement.a.local);
      else this.trackMeasurementPoint(measurement, measurement.a.local);
      this.trackMeasurementPoint(measurement, measurement.b.local);
    }
    this.changed.notifyObservers();
    return true;
  }

  private trackMeasurementPoint(measurement: Measurement, point: Vector3) {
    void this.createTrackedPoint(point).then((anchor) => {
      if (!anchor) return;
      if (!this.measurements.includes(measurement)) { anchor.remove(); return; }
      this.pointAnchors.set(anchor, point);
    });
  }

  clearMeasurements() {
    this.cancelMeasurementPoint();
    for (const anchor of this.pointAnchors.keys()) anchor.remove();
    this.pointAnchors.clear();
    for (const m of [...this.measurements]) this.editor.tools.removeSessionMeasurement(m);
    this.changed.notifyObservers();
  }

  measurementLabel(m: Measurement, width: number, height: number) {
    const camera = this.xr?.baseExperience.camera;
    if (!camera) return null;
    const view = camera.rigCameras[0] ?? camera;
    const point = this.editor.tools.labelPoint(m);
    const screen = Vector3.Project(point, Matrix.Identity(), view.getTransformationMatrix(), view.viewport.toGlobal(width, height));
    const visible = screen.z >= 0 && screen.z <= 1 && screen.x >= 0 && screen.x <= width && screen.y >= 0 && screen.y <= height;
    return { x: screen.x, y: screen.y, visible, text: this.editor.tools.format(m.length) };
  }

  onFrame(update: () => void) {
    this.editor.scene.onAfterRenderObservable.add(update);
  }

  setDepthRequest(on: boolean) {
    this.requestDepthOnNextSession = on;
    this.changed.notifyObservers();
  }

  /** GPU occlusion uses temporary materials because Babylon registers plugins on material creation. */
  setOcclusion(on: boolean) {
    if (on === this.occlusion) return;
    if (on && (!this.depthSupported || !this.depth || !this.active)) return;
    if (on) {
      try {
        const clones = new Map<Material, Material>();
        const cloneMaterial = (original: Material): Material => {
          const existing = clones.get(original);
          if (existing) return existing;
          const clone = original.clone(`${original.name}-arDepth`);
          if (!clone) throw new Error(tr('Depth occlusion is unavailable for this material.'));
          clones.set(original, clone);
          this.depthClones.push(clone);
          if (original instanceof MultiMaterial && clone instanceof MultiMaterial) {
            clone.subMaterials = original.subMaterials.map((material) => material ? cloneMaterial(material) : null);
          }
          return clone;
        };
        for (const entity of this.editor.entities.filter(e => !e.groupMembers)) for (const mesh of entity.meshes) {
          const original = mesh.material;
          if (!original) continue;
          const clone = cloneMaterial(original);
          this.depthMaterials.push({ mesh, original });
          mesh.material = clone;
        }
        if (!this.depth!.attach()) throw new Error(tr('Depth occlusion is unavailable in this session.'));
        this.occlusion = true;
      } catch (error) {
        this.restoreDepthMaterials();
        this.depth?.detach();
        this.reportError(error instanceof Error ? error.message : String(error));
      }
    } else {
      this.depth?.detach();
      this.restoreDepthMaterials();
      this.occlusion = false;
    }
    this.changed.notifyObservers();
  }

  private restoreDepthMaterials() {
    for (const { mesh, original } of this.depthMaterials) if (!mesh.isDisposed()) mesh.material = original;
    this.depthMaterials = [];
    for (const clone of this.depthClones) clone.dispose(false, false);
    this.depthClones = [];
  }

  private setHitTest(on: boolean) {
    const fm = this.xr?.baseExperience.featuresManager;
    if (!fm) return;
    try {
      if (on) fm.attachFeature(WebXRFeatureName.HIT_TEST);
      else fm.detachFeature(WebXRFeatureName.HIT_TEST);
    } catch {
      // Not available: keep it as it is
    }
  }

  rotateBy(radians: number) {
    this.yaw += radians;
    this.applyTransform();
  }

  scaleBy(factor: number) {
    this.scale = Math.min(20, Math.max(0.02, this.scale * factor));
    this.applyTransform();
    this.changed.notifyObservers();
  }

  resetScale() {
    this.scale = 1;
    this.applyTransform();
    this.changed.notifyObservers();
  }

  private applyTransform() {
    if (!this.anchor) return;
    Quaternion.RotationYawPitchRollToRef(this.yaw, 0, 0, this.anchor.rotationQuaternion!);
    this.anchor.scaling.setAll(this.scale);
    // The scene moved: redraw shadows once
    for (const g of [...this.editor.entities.map((e) => e.shadowGen), ...this.rig.map((r) => r.gen)]) g?.getShadowMap()?.resetRefreshCounter();
  }

  /**
   * Photo of the camera image with the 3D scene on top. Returns null when the phone doesn't give
   * the camera image to the page (then only a system screenshot can include it).
   */
  async capture(): Promise<Blob | null> {
    if (!this.xr || !this.cameraAccess) return null;
    // Camera image access only runs for the photo (it costs a texture copy every frame)
    const fm = this.xr.baseExperience.featuresManager;
    try {
      fm.attachFeature(WebXRFeatureName.RAW_CAMERA_ACCESS);
    } catch {
      return null;
    }
    const camera = await this.cameraFrame();
    fm.detachFeature(WebXRFeatureName.RAW_CAMERA_ACCESS);
    if (!camera) return null;
    const engine = this.editor.engine;
    const xrCamera = this.xr.baseExperience.camera;
    const view = xrCamera.rigCameras[0] ?? xrCamera;
    const width = camera.width;
    const height = camera.height;
    // 3D layer with a transparent background
    this.reticle?.setEnabled(false);
    const layer = await CreateScreenshotUsingRenderTargetAsync(engine, view, { width, height }, 'image/png', 4, true);
    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const ctx = out.getContext('2d')!;
    ctx.drawImage(camera, 0, 0);
    const img = new Image();
    img.src = layer;
    await img.decode();
    ctx.drawImage(img, 0, 0, width, height);
    const final = applyPhotoFilter(out, filterToCanvas(PHOTO_FILTERS.find((f) => f.id === this.filter)?.values ?? {}));
    return new Promise((resolve) => final.toBlob((b) => resolve(b), 'image/jpeg', 0.92));
  }

  /** Copies the current camera image (only readable during an XR frame, so wait for the next one). */
  private cameraFrame(): Promise<HTMLCanvasElement | null> {
    const access = this.cameraAccess!;
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        access.onTexturesUpdatedObservable.remove(observer);
        resolve(null);
      }, 1500);
      const observer = access.onTexturesUpdatedObservable.add(async (textures: BaseTexture[]) => {
        access.onTexturesUpdatedObservable.remove(observer);
        clearTimeout(timeout);
        const tex = textures[0];
        if (!tex) return resolve(null);
        try {
          const size = tex.getSize();
          const pixels = await tex.readPixels();
          if (!pixels) return resolve(null);
          const c = document.createElement('canvas');
          c.width = size.width;
          c.height = size.height;
          const ctx = c.getContext('2d')!;
          const data = new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, size.width * size.height * 4);
          // WebGL rows come bottom-up: flip
          const flipped = new ImageData(size.width, size.height);
          const row = size.width * 4;
          for (let y = 0; y < size.height; y++) flipped.data.set(data.subarray(y * row, y * row + row), (size.height - 1 - y) * row);
          ctx.putImageData(flipped, 0, 0);
          resolve(c);
        } catch {
          resolve(null);
        }
      });
    });
  }
}

/** Color filter + vignette + grain on a finished photo (2D canvas, only when saving). */
function applyPhotoFilter(src: HTMLCanvasElement, f: { css: string; vignette: number; grain: number }) {
  if (f.css === 'none' && !f.vignette && !f.grain) return src;
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext('2d')!;
  ctx.filter = f.css;
  ctx.drawImage(src, 0, 0);
  ctx.filter = 'none';
  const w = out.width;
  const h = out.height;
  if (f.vignette) {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) / 2);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${f.vignette})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  if (f.grain) {
    // Small noise tile repeated over the photo
    const tile = document.createElement('canvas');
    tile.width = tile.height = 128;
    const t = tile.getContext('2d')!;
    const img = t.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255 * f.grain;
    }
    t.putImageData(img, 0, 0);
    ctx.fillStyle = ctx.createPattern(tile, 'repeat')!;
    ctx.globalCompositeOperation = 'overlay';
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }
  return out;
}
