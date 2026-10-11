import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { aspectRect } from '../core/editor';
import type { Editor } from '../core/editor';
import { tr } from '../core/i18n';

export interface VideoOptions { duration: number; height: number; path: 'scene' | 'object' | 'sway'; signal?: AbortSignal; progress?: (value: number) => void }
export function videoType() {
  if (typeof MediaRecorder === 'undefined') return null;
  return ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/mp4', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

/** Realtime recording uses elapsed time, so missed frames never accelerate the motion. */
export async function recordVideo(editor: Editor, options: VideoOptions): Promise<Blob> {
  const mimeType = videoType();
  if (!mimeType) throw new Error(tr('Video recording is not supported by this browser.'));
  if (editor.recording) throw new Error(tr('A recording is already running.'));
  const { camera } = editor;
  const selected = editor.selected;
  if (options.path === 'object' && !selected) throw new Error(tr('Select an object first.'));
  const previous = { alpha: camera.alpha, beta: camera.beta, radius: camera.radius, target: camera.target.clone(), photo: editor.photoMode, rotation: selected?.root.rotationQuaternion?.clone() };
  const source = editor.engine.getRenderingCanvas()!;
  const rect = aspectRect(source.width, source.height, editor.photo.aspect);
  const canvas = document.createElement('canvas');
  canvas.height = options.height;
  canvas.width = Math.max(2, Math.round(options.height * rect.w / rect.h / 2) * 2);
  const ctx = canvas.getContext('2d')!;
  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: options.height >= 1080 ? 8_000_000 : 4_000_000 });
  const chunks: Blob[] = [];
  let timer = 0;
  let started = 0;
  let aborted = false;
  const stop = () => { if (recorder.state !== 'inactive') recorder.stop(); };
  const abort = () => { aborted = true; stop(); };
  editor.recording = true;
  editor.setPhotoMode(true);
  camera.detachControl();
  const before = editor.scene.onBeforeRenderObservable.add(() => {
    if (!started) return;
    const t = Math.min(1, (performance.now() - started) / (options.duration * 1000));
    if (options.path === 'object' && selected && previous.rotation) selected.root.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), t * Math.PI * 2).multiply(previous.rotation);
    else camera.alpha = previous.alpha + (options.path === 'sway' ? Math.sin(t * Math.PI * 2) * .25 : t * Math.PI * 2);
    options.progress?.(t);
  });
  const after = editor.scene.onAfterRenderObservable.add(() => {
    const r = aspectRect(source.width, source.height, editor.photo.aspect);
    ctx.drawImage(source, r.x, r.y, r.w, r.h, 0, 0, canvas.width, canvas.height);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      recorder.onerror = () => reject(new Error(tr('Video recording failed.')));
      recorder.onstop = () => resolve();
      recorder.start(250);
      started = performance.now();
      options.signal?.addEventListener('abort', abort, { once: true });
      timer = window.setTimeout(stop, options.duration * 1000);
      if (options.signal?.aborted) abort();
    });
    if (aborted) throw new DOMException('Cancelled', 'AbortError');
    return new Blob(chunks, { type: mimeType.split(';')[0] });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    stop();
    stream.getTracks().forEach((t) => t.stop());
    editor.scene.onBeforeRenderObservable.remove(before);
    editor.scene.onAfterRenderObservable.remove(after);
    camera.alpha = previous.alpha; camera.beta = previous.beta; camera.radius = previous.radius; camera.setTarget(previous.target);
    if (selected && previous.rotation) selected.root.rotationQuaternion = previous.rotation;
    camera.attachControl(true);
    editor.recording = false;
    editor.setPhotoMode(previous.photo);
    editor.invalidate();
  }
}
