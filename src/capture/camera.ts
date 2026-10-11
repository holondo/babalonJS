import { Layer } from '@babylonjs/core/Layers/layer.js';
import { VideoTexture } from '@babylonjs/core/Materials/Textures/videoTexture.js';
// Focused imports: the engine features a video background needs
import '@babylonjs/core/Engines/Extensions/engine.dynamicTexture.js';
import '@babylonjs/core/Engines/Extensions/engine.videoTexture.js';
import '@babylonjs/core/Layers/layerSceneComponent.js';
import type { Editor, EnvSettings } from '../core/editor';

interface ZoomRange { min: number; max: number; step: number }
/** Live video is a scene background, so the photo pipeline and captures include it. */
export class CameraBackdrop {
  private readonly editor: Editor;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private layer: Layer | null = null;
  private texture: VideoTexture | null = null;
  private saved: EnvSettings | null = null;
  private generation = 0;
  private observer: ReturnType<Editor['scene']['onBeforeRenderObservable']['add']> = null;
  devices: MediaDeviceInfo[] = [];
  deviceId = '';
  zoom: ZoomRange | null = null;
  zoomValue = 1;
  constructor(editor: Editor) { this.editor = editor; }
  get active() { return !!this.stream; }

  async start(deviceId?: string) {
    this.releaseStream();
    const generation = ++this.generation;
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } } }); }
    catch (error) { if (generation === this.generation) this.stop(); throw error; }
    if (generation !== this.generation) { stream.getTracks().forEach((t) => t.stop()); return; }
    this.stream = stream;
    try {
      const video = this.video = document.createElement('video');
      video.muted = true; video.playsInline = true; video.srcObject = stream;
      await video.play();
      if (generation !== this.generation) return;
      this.devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      if (generation !== this.generation) return;
      const track = stream.getVideoTracks()[0];
      this.deviceId = track.getSettings().deviceId ?? '';
      this.zoom = (track.getCapabilities() as MediaTrackCapabilities & { zoom?: ZoomRange }).zoom ?? null;
      this.zoomValue = (track.getSettings() as MediaTrackSettings & { zoom?: number }).zoom ?? 1;
      this.saved ??= { ...this.editor.env };
      this.editor.cameraBackground = true;
      this.editor.applyEnv({ skybox: false, ground: 'shadow', grid: false });
      this.texture = new VideoTexture('cameraBackground', video, this.editor.scene, false, false);
      this.layer = new Layer('cameraBackground', null, this.editor.scene, true);
      this.layer.texture = this.texture;
      this.observer = this.editor.scene.onBeforeRenderObservable.add(() => {
        const texture = this.texture;
        if (!texture || !video.videoHeight) return;
        const ratio = this.editor.engine.getRenderWidth() / this.editor.engine.getRenderHeight();
        const source = video.videoWidth / video.videoHeight;
        texture.uScale = Math.min(1, ratio / source); texture.vScale = Math.min(1, source / ratio);
        texture.uOffset = (1 - texture.uScale) / 2; texture.vOffset = (1 - texture.vScale) / 2;
      });
      track.addEventListener('ended', () => { if (this.stream === stream) { this.stop(); this.editor.notify('photo'); } });
      this.editor.invalidate();
    } catch (error) { if (generation === this.generation) this.stop(); throw error; }
  }

  async setZoom(value: number) {
    const track = this.stream?.getVideoTracks()[0];
    if (!track || !this.zoom) return;
    await track.applyConstraints({ advanced: [{ zoom: value } as MediaTrackConstraintSet] });
    this.zoomValue = value;
  }

  private releaseStream() {
    this.editor.scene.onBeforeRenderObservable.remove(this.observer); this.observer = null;
    this.layer?.dispose(); this.layer = null;
    this.texture?.dispose(); this.texture = null;
    this.stream?.getTracks().forEach((t) => t.stop()); this.stream = null;
    if (this.video) { this.video.pause(); this.video.srcObject = null; this.video = null; }
  }

  stop() {
    this.generation++;
    this.releaseStream();
    this.editor.cameraBackground = false;
    if (this.saved) { const saved = this.saved; this.saved = null; this.editor.applyEnv(saved); }
    this.editor.invalidate();
  }
}
