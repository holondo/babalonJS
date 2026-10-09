import {
  Color3,
  CreateScreenshotUsingRenderTargetAsync,
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
import type { BaseTexture, IWebXRHitResult, Node, WebXRHitTest, WebXRRawCameraAccess } from '@babylonjs/core';
import type { Editor } from './editor';

export type ARStatus = 'searching' | 'ready' | 'placed';

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

  /** Optional, heavier extras (off when AR starts). */
  shadows = false;
  roomLight = false;

  /** Shadows of the scene on the real floor. */
  setShadows(on: boolean) {
    this.shadows = on;
    this.editor.setShadowsEnabled(on);
    this.changed.notifyObservers();
  }

  /** Real-world lighting estimated by the phone (reflections and light of the room). */
  setRoomLight(on: boolean) {
    if (!this.xr) return;
    const fm = this.xr.baseExperience.featuresManager;
    try {
      if (on) fm.attachFeature(WebXRFeatureName.LIGHT_ESTIMATION);
      else {
        fm.detachFeature(WebXRFeatureName.LIGHT_ESTIMATION);
        this.editor.restoreEnvironmentTexture();
      }
      this.roomLight = on;
    } catch (e) {
      this.reportError(e instanceof Error ? e.message : String(e));
    }
    this.changed.notifyObservers();
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
    this.roomLight = false;
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

    // Keep the side the user was looking at in the editor facing them in AR
    const cam = ed.camera;
    const view = cam.position.subtract(cam.target);
    this.baseYaw = Math.atan2(view.x, view.z);
  }

  /** Puts everything back exactly where it was in the editor. */
  private cleanup() {
    if (!this.active) return;
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
    this.changed.notifyObservers();
    return true;
  }

  /** Shows the marker again so the scene can be moved to another spot. */
  replace() {
    this.status = this.lastHit ? 'ready' : 'searching';
    this.changed.notifyObservers();
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
    return new Promise((resolve) => out.toBlob((b) => resolve(b), 'image/jpeg', 0.92));
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
