import { Observable } from '@babylonjs/core/Misc/observable.js';
import { Capacitor } from '@capacitor/core';
import type { Editor } from '../core/editor';

/**
 * Gyro mode: turning and tilting the phone orbits the editor camera around its center.
 * It adds to touch (drag, pinch and pan keep working). Uses only the orientation sensors,
 * so it works on any phone, including iPhone (which asks for permission first).
 */
export class GyroControl {
  readonly changed = new Observable<void>();
  active = false;
  private prev: { yaw: number; pitch: number } | null = null;
  private readonly editor: Editor;
  private readonly onOrientation = (e: DeviceOrientationEvent) => this.update(e);

  constructor(editor: Editor) {
    this.editor = editor;
  }

  /** Phones and tablets with orientation sensors. */
  get available() {
    return 'DeviceOrientationEvent' in window && (Capacitor.isNativePlatform() || matchMedia('(pointer: coarse)').matches);
  }

  /** Must be called from a tap: iPhone asks for permission to use the sensors. */
  async enable(): Promise<boolean> {
    const request = (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission;
    if (request) {
      try {
        if ((await request()) !== 'granted') return false;
      } catch {
        return false;
      }
    }
    this.prev = null;
    window.addEventListener('deviceorientation', this.onOrientation);
    this.active = true;
    this.changed.notifyObservers();

    // On native platforms, keep active so it responds when the device/emulator tilts
    if (Capacitor.isNativePlatform()) return true;

    // No reading after a moment: the device has no usable sensor
    const ok = await new Promise<boolean>((resolve) => {
      const start = performance.now();
      const check = () => (this.prev ? resolve(true) : performance.now() - start > 4000 ? resolve(false) : setTimeout(check, 100));
      check();
    });
    if (!ok) this.disable();
    return ok;
  }

  disable() {
    window.removeEventListener('deviceorientation', this.onOrientation);
    this.active = false;
    this.prev = null;
    this.changed.notifyObservers();
  }

  private update(e: DeviceOrientationEvent) {
    if (e.alpha === null || e.beta === null || e.gamma === null || this.editor.arMode) return;
    const { yaw, pitch } = orientationToYawPitch(e.alpha, e.beta, e.gamma);
    const prev = this.prev;
    this.prev = { yaw, pitch };
    if (!prev) return;
    let dYaw = yaw - prev.yaw;
    if (dYaw > Math.PI) dYaw -= 2 * Math.PI;
    if (dYaw < -Math.PI) dYaw += 2 * Math.PI;
    const dPitch = pitch - prev.pitch;
    // Ignore sensor jumps (e.g. passing straight up/down)
    if (Math.abs(dYaw) > 0.5 || Math.abs(dPitch) > 0.5) return;
    const cam = this.editor.camera;
    // Horizontal direction confirmed on a real phone (the first version felt reversed);
    // tilting up looks up at the model
    cam.alpha -= dYaw;
    const lower = cam.lowerBetaLimit ?? 0.01;
    const upper = cam.upperBetaLimit ?? Math.PI - 0.01;
    cam.beta = Math.min(upper, Math.max(lower, cam.beta + dPitch));
  }
}

/**
 * Heading and elevation of the direction the back of the phone points to (W3C device
 * orientation: R = Rz(alpha)·Rx(beta)·Ry(gamma), the back camera looks along −Z).
 * The screen's rotation doesn't change that direction, so portrait/landscape don't matter.
 */
function orientationToYawPitch(alphaDeg: number, betaDeg: number, gammaDeg: number) {
  const d = Math.PI / 180;
  const [a, b, g] = [alphaDeg * d, betaDeg * d, gammaDeg * d];
  const [cA, sA, cB, sB, cG, sG] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(g), Math.sin(g)];
  const fx = -(cG * sA * sB + cA * sG);
  const fy = -(sA * sG - cA * cG * sB);
  const fz = -cB * cG;
  return { yaw: Math.atan2(fx, fy), pitch: Math.asin(Math.max(-1, Math.min(1, fz))) };
}
