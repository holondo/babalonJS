import type { EnvSettings, LightType, PhotoSettings } from './editor';

/**
 * Lighting presets, used by the editor (as real lights) and by AR (as temporary lights that move
 * with the scene). Positions are for a ~2 m scene and are scaled to the actual scene size.
 */
export interface PresetLight {
  type: LightType;
  pos: [number, number, number];
  /** Directional: as is. Point/spot: multiplied by the scene scale squared (light falls off with distance). */
  intensity: number;
  color: string;
  shadows: boolean;
  angle?: number;
}

export interface LightPreset {
  id: string;
  label: string;
  /** Environment changes; bright presets start from the editor's default sky and floor. */
  env: Partial<EnvSettings> & { bright?: boolean };
  /** Look applied in the editor's photo pipeline. */
  photo?: Partial<PhotoSettings>;
  lights: PresetLight[];
}

export const LIGHT_PRESETS: LightPreset[] = [
  {
    id: 'studio',
    label: 'Studio',
    env: { bright: true, preset: 'studio', intensity: 0.7, skyboxBlur: 0.7 },
    lights: [
      { type: 'directional', pos: [-3, 5, -3], intensity: 2.6, color: '#fff2e0', shadows: true },
      { type: 'point', pos: [3, 2, -2], intensity: 12, color: '#dbe8ff', shadows: false },
      { type: 'spot', pos: [0, 3, 4], intensity: 45, color: '#ffffff', shadows: false },
    ],
  },
  {
    id: 'daylight',
    label: 'Daylight',
    env: { bright: true, preset: 'country', intensity: 1, skyboxBlur: 0.2 },
    lights: [{ type: 'directional', pos: [4, 8, 3], intensity: 3, color: '#fff8ec', shadows: true }],
  },
  {
    id: 'sunset',
    label: 'Sunset',
    env: { bright: true, preset: 'country', intensity: 0.35, skyboxBlur: 0.4 },
    photo: { temperature: 30, bloom: 0.3, vignette: 0.6 },
    lights: [
      { type: 'directional', pos: [-6, 1.6, -3], intensity: 3.5, color: '#ff8a3d', shadows: true },
      { type: 'point', pos: [3, 2.5, 3], intensity: 15, color: '#5b7cff', shadows: false },
    ],
  },
  {
    id: 'neon',
    label: 'Neon',
    env: { intensity: 0.08, background: '#07070c', skybox: false, ground: 'solid', groundColor: '#101018' },
    photo: { bloom: 0.8, bloomThreshold: 0.5, saturation: 30, chromatic: 6, vignette: 1 },
    lights: [
      { type: 'point', pos: [-2, 1.5, -1], intensity: 40, color: '#ff2fd6', shadows: true },
      { type: 'point', pos: [2, 1.5, 1], intensity: 40, color: '#20e3ff', shadows: false },
      { type: 'spot', pos: [0, 4, 0.1], intensity: 30, color: '#b388ff', shadows: false },
    ],
  },
  {
    id: 'dramatic',
    label: 'Dramatic',
    env: { intensity: 0.05, background: '#050505', skybox: false, ground: 'solid', groundColor: '#121212' },
    photo: { contrast: 1.4, vignette: 1.2 },
    lights: [{ type: 'spot', pos: [0.5, 5, 1], intensity: 120, color: '#fff5e8', shadows: true, angle: Math.PI / 6 }],
  },
];

export function findLightPreset(id: string) {
  return LIGHT_PRESETS.find((p) => p.id === id);
}

/** Intensity of a preset light for a scene scaled by `k` (relative to the ~2 m design size). */
export function presetIntensity(light: PresetLight, k: number) {
  return light.type === 'directional' ? light.intensity : light.intensity * k * k;
}

/** Photo filters: one definition for photo mode (post-processing) and the AR photo (2D filter). */
export const PHOTO_FILTERS: { id: string; label: string; values: Partial<PhotoSettings> }[] = [
  { id: 'none', label: 'Original', values: {} },
  { id: 'cinema', label: 'Cinema', values: { contrast: 1.25, saturation: 10, temperature: 10, vignette: 0.7, grain: 6, aspect: '2.39' } },
  { id: 'bw', label: 'B&W', values: { saturation: -100, contrast: 1.35, grain: 12, vignette: 0.6 } },
  { id: 'vintage', label: 'Vintage', values: { saturation: -35, temperature: 45, contrast: 0.95, vignette: 1.1, grain: 18 } },
  { id: 'neon', label: 'Neon', values: { saturation: 40, bloom: 0.8, bloomThreshold: 0.45, chromatic: 8, vignette: 0.8 } },
  { id: 'dream', label: 'Dream', values: { exposure: 1.2, contrast: 0.9, bloom: 0.6, bloomThreshold: 0.3, temperature: 15 } },
  { id: 'cold', label: 'Cold', values: { temperature: -40, contrast: 1.15, saturation: -10 } },
];

/**
 * The same filter values as a 2D canvas filter (for photos that don't go through the 3D
 * post-processing, like AR). Bloom and chromatic aberration have no 2D equivalent and are skipped.
 */
export function filterToCanvas(values: Partial<PhotoSettings>) {
  const parts: string[] = [];
  if (values.exposure !== undefined && values.exposure !== 1) parts.push(`brightness(${values.exposure})`);
  if (values.contrast !== undefined && values.contrast !== 1) parts.push(`contrast(${values.contrast})`);
  if (values.saturation) parts.push(`saturate(${Math.max(0, 1 + values.saturation / 100)})`);
  if (values.temperature) {
    // Warm: a touch of sepia; cold: shift hues toward blue
    if (values.temperature > 0) parts.push(`sepia(${Math.min(0.6, values.temperature / 100)})`);
    else parts.push(`hue-rotate(${values.temperature * 0.3}deg)`);
  }
  return {
    css: parts.join(' ') || 'none',
    vignette: Math.min(0.6, (values.vignette ?? 0) * 0.45),
    grain: Math.min(0.15, (values.grain ?? 0) / 150),
  };
}
