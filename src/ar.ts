import {
  Color3,
  CreateScreenshotUsingRenderTargetAsync,
  DirectionalLight,
  PointLight,
  RenderTargetTexture,
  ShadowGenerator,
  SpotLight,
  Mesh,
  MeshBuilder,
  Observable,
  Quaternion,
  StandardMaterial,
  TransformNode,
  Vector3,
  WebXRDefaultExperience,
  WebXRFeatureName,
  WebXRSessionManager,
} from '@babylonjs/core';
import type { BaseTexture, IWebXRHitResult, Node, ShadowLight, WebXRHitTest, WebXRRawCameraAccess } from '@babylonjs/core';
import type { Editor } from './editor';

export type ARStatus = 'searching' | 'ready' | 'placed';
/** "scene" = the editor's own lights; "room" = estimated by the phone; the rest are presets. */
export type ARLighting = 'scene' | 'room' | 'studio' | 'daylight' | 'sunset' | 'neon' | 'dramatic';

type RigLight = { type: 'directional' | 'point' | 'spot'; pos: [number, number, number]; intensity: number; color: string; shadows?: boolean; angle?: number };

/**
 * Light presets for AR, like the editor's: positions are for a ~2 m scene and scale with it.
 * They live under the AR anchor, so they move with the scene and vanish when AR ends.
 */
const AR_RIGS: Record<Exclude<ARLighting, 'scene' | 'room'>, { env: number; lights: RigLight[] }> = {
  studio: {
    env: 0.7,
    lights: [
      { type: 'directional', pos: [-3, 5, -3], intensity: 2.6, color: '#fff2e0', shadows: true },
      { type: 'point', pos: [3, 2, -2], intensity: 12, color: '#dbe8ff' },
      { type: 'spot', pos: [0, 3, 4], intensity: 45, color: '#ffffff' },
    ],
  },
  daylight: { env: 1, lights: [{ type: 'directional', pos: [4, 8, 3], intensity: 3, color: '#fff8ec', shadows: true }] },
  sunset: {
    env: 0.35,
    lights: [
      { type: 'directional', pos: [-6, 1.6, -3], intensity: 3.5, color: '#ff8a3d', shadows: true },
      { type: 'point', pos: [3, 2.5, 3], intensity: 15, color: '#5b7cff' },
    ],
  },
  neon: {
    env: 0.08,
    lights: [
      { type: 'point', pos: [-2, 1.5, -1], intensity: 40, color: '#ff2fd6', shadows: true },
      { type: 'point', pos: [2, 1.5, 1], intensity: 40, color: '#20e3ff' },
      { type: 'spot', pos: [0, 4, 0.1], intensity: 30, color: '#b388ff' },
    ],
  },
  dramatic: { env: 0.05, lights: [{ type: 'spot', pos: [0.5, 5, 1], intensity: 120, color: '#fff5e8', angle: Math.PI / 6, shadows: true }] },
};

/** Photo filters, applied only to the saved AR photo (free while the camera is open). */
export const AR_FILTERS: Record<string, { label: string; css: string; vignette: number; grain: number }> = {
  none: { label: 'Original', css: 'none', vignette: 0, grain: 0 },
  cinema: { label: 'Cinema', css: 'contrast(1.2) saturate(1.1) sepia(0.12)', vignette: 0.35, grain: 0.04 },
  bw: { label: 'B&W', css: 'grayscale(1) contrast(1.3)', vignette: 0.3, grain: 0.08 },
  vintage: { label: 'Vintage', css: 'sepia(0.45) saturate(0.75) contrast(0.95)', vignette: 0.45, grain: 0.1 },
  neon: { label: 'Neon', css: 'saturate(1.5) contrast(1.1)', vignette: 0.3, grain: 0 },
  dream: { label: 'Dream', css: 'brightness(1.12) contrast(0.92) saturate(1.1)', vignette: 0.15, grain: 0 },
  cold: { label: 'Cold', css: 'hue-rotate(-12deg) saturate(0.9) contrast(1.1)', vignette: 0.2, grain: 0 },
};

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

  private buildRig(id: keyof typeof AR_RIGS) {
    const anchor = this.anchor;
    if (!anchor) return;
    const scene = this.editor.scene;
    const preset = AR_RIGS[id];
    this.baseEnvIntensity = preset.env;
    const k = Math.max(this.local.size, 0.5) / 2;
    const focus = new Vector3(0, this.local.height / 2, 0);
    const casters = this.editor.entities.filter((e) => e.kind !== 'light' && e.visible).flatMap((e) => e.meshes);
    for (const def of preset.lights) {
      const pos = new Vector3(...def.pos).scale(k);
      const dir = focus.subtract(pos).normalize();
      let light: ShadowLight;
      if (def.type === 'directional') light = new DirectionalLight('arRig', dir, scene);
      else if (def.type === 'spot') light = new SpotLight('arRig', pos, dir, def.angle ?? Math.PI / 4, 2, scene);
      else light = new PointLight('arRig', pos, scene);
      light.position.copyFrom(pos);
      light.parent = anchor;
      light.diffuse = Color3.FromHexString(def.color);
      light.specular = light.diffuse.clone();
      // Point/spot fall off with distance: scale with the scene like the editor presets
      const base = def.type === 'directional' ? def.intensity : def.intensity * k * k;
      let gen: ShadowGenerator | undefined;
      if (def.shadows) {
        gen = new ShadowGenerator(1024, light);
        if (def.type === 'point') gen.usePoissonSampling = true;
        else {
          gen.usePercentageCloserFiltering = true;
          gen.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
        }
        gen.bias = 0.0008;
        gen.normalBias = 0.015;
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
      this.hitTest = fm.enableFeature(WebXRFeatureName.HIT_TEST, 'latest', {}, true, false) as WebXRHitTest;
      fm.enableFeature(WebXRFeatureName.DOM_OVERLAY, 'latest', { element: overlay, supressXRSelectEvents: true }, true, false);
      // Expensive features are requested with the session but stay detached: AR starts as cheap
      // as possible and the user turns them on (room lighting) or they run only when needed (photo).
      fm.enableFeature(WebXRFeatureName.LIGHT_ESTIMATION, 'latest', { setSceneEnvironmentTexture: true, createDirectionalLightSource: false }, false, false);
      this.cameraAccess = fm.enableFeature(WebXRFeatureName.RAW_CAMERA_ACCESS, 'latest', {}, false, false) as WebXRRawCameraAccess;

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
    this.baseEnvIntensity = this.editor.env.intensity;
    this.editor.setShadowsEnabled(false);
    this.active = true;
    this.changed.notifyObservers();
    try {
      await this.xr.baseExperience.enterXRAsync('immersive-ar', 'local-floor', this.xr.renderTarget);
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
    const nodes: TransformNode[] = [...ed.entities.map((e) => e.root), ed.groundMesh];
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
    const showReticle = !!hit && this.status !== 'placed';
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
    if (!this.lastHit || !this.anchor || !this.xr) return false;
    this.anchor.position.copyFrom(this.lastHit.position);
    const cam = this.xr.baseExperience.camera.globalPosition;
    const toUser = cam.subtract(this.lastHit.position);
    this.yaw = Math.atan2(toUser.x, toUser.z) - this.baseYaw;
    this.applyTransform();
    this.anchor.setEnabled(true);
    this.status = 'placed';
    this.reticle?.setEnabled(false);
    // Surface detection runs every frame; it's only needed while looking for a spot
    this.setHitTest(false);
    this.updateShadowRefresh();
    this.changed.notifyObservers();
    return true;
  }

  /** Shows the marker again so the scene can be moved to another spot. */
  replace() {
    this.lastHit = null;
    this.setHitTest(true);
    this.status = 'searching';
    this.changed.notifyObservers();
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
    const final = applyPhotoFilter(out, AR_FILTERS[this.filter] ?? AR_FILTERS.none);
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
