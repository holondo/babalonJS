import type { MaterialJSON } from './state';
import type { HumanBone } from '../rigging/humanoid';
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

// ---------- Poses and animations for humanoids ----------

type Dir = [number, number, number];

/** Arms down by the sides, legs straight (directions in the character's frame: x right, y up, z forward). */
const RELAXED: Partial<Record<HumanBone, Dir>> = {
  leftUpperArm: [-0.3, -0.95, 0],
  leftLowerArm: [-0.15, -0.95, 0.15],
  rightUpperArm: [0.3, -0.95, 0],
  rightLowerArm: [0.15, -0.95, 0.15],
  leftUpperLeg: [0, -1, 0],
  leftLowerLeg: [0, -1, 0],
  rightUpperLeg: [0, -1, 0],
  rightLowerLeg: [0, -1, 0],
};

/** Left-side directions plus their mirror on the right side. */
function both(left: Partial<Record<HumanBone, Dir>>): Partial<Record<HumanBone, Dir>> {
  const out = { ...left };
  for (const [b, [x, y, z]] of Object.entries(left) as [HumanBone, Dir][]) out[b.replace('left', 'right') as HumanBone] = [-x, y, z];
  return out;
}

export interface PosePreset {
  id: string;
  label: string;
  /** Bone directions (character frame), applied from the rest pose. */
  dirs?: Partial<Record<HumanBone, Dir>>;
  /** Or a frame of a built-in clip (`ANIMATION_LIBRARY` id, time in seconds). */
  clip?: string;
  time?: number;
}

/** Ready poses; any detected humanoid can take them. */
export const POSE_PRESETS: PosePreset[] = [
  { id: 'relaxed', label: 'Relaxed', dirs: RELAXED },
  { id: 'tpose', label: 'T-pose', dirs: { ...RELAXED, ...both({ leftUpperArm: [-1, 0, 0], leftLowerArm: [-1, 0, 0] }) } },
  { id: 'arms-up', label: 'Arms up', dirs: { ...RELAXED, ...both({ leftUpperArm: [-0.55, 0.83, 0], leftLowerArm: [-0.45, 0.89, 0] }) } },
  { id: 'wave', label: 'Wave', dirs: { ...RELAXED, rightUpperArm: [0.8, 0.3, 0.15], rightLowerArm: [0.15, 0.97, 0.1] } },
  { id: 'point', label: 'Pointing', dirs: { ...RELAXED, rightUpperArm: [0.2, 0.05, 0.98], rightLowerArm: [0.1, 0.05, 1] } },
  { id: 'hands-hips', label: 'Hands on hips', dirs: { ...RELAXED, ...both({ leftUpperArm: [-0.4, -0.88, -0.25], leftLowerArm: [0.33, -0.77, 0.54] }) } },
  {
    id: 'think',
    label: 'Thinking',
    dirs: { ...RELAXED, rightUpperArm: [0.25, -0.8, 0.55], rightLowerArm: [-0.35, 0.85, 0.4], leftUpperArm: [-0.15, -0.9, 0.4], leftLowerArm: [0.85, 0.05, 0.5] },
  },
  { id: 'walk', label: 'Walking', clip: 'Walk_Loop', time: 0.33 },
  { id: 'run', label: 'Running', clip: 'Sprint_Loop', time: 0.15 },
  { id: 'jump', label: 'Jumping', clip: 'Jump_Loop', time: 0.4 },
  { id: 'sit', label: 'Sitting', clip: 'Sitting_Idle_Loop', time: 0 },
  { id: 'crouch', label: 'Crouching', clip: 'Crouch_Idle_Loop', time: 0 },
  { id: 'kneel', label: 'Kneeling', clip: 'Fixing_Kneeling', time: 1.5 },
  { id: 'dance', label: 'Dancing', clip: 'Dance_Loop', time: 0.5 },
  { id: 'punch', label: 'Punch', clip: 'Punch_Jab', time: 0.3 },
  { id: 'sword', label: 'Sword', clip: 'Sword_Idle', time: 0 },
  { id: 'aim', label: 'Aiming', clip: 'Pistol_Aim_Neutral', time: 0 },
  { id: 'swim', label: 'Swimming', clip: 'Swim_Fwd_Loop', time: 0.4 },
];

export interface LibraryClip {
  id: string;
  label: string;
  group: 'Everyday' | 'Moving' | 'Sitting' | 'Combat' | 'Action';
}

/** Where the built-in clips come from (shown in the app and stored in projects). */
export const ANIMATION_SOURCE = {
  author: 'Quaternius',
  name: 'Universal Animation Library',
  license: 'CC0 1.0',
  url: 'https://quaternius.com/packs/universalanimationlibrary.html',
};

/**
 * Built-in clips (Universal Animation Library by Quaternius, CC0). Files in
 * public/animations/<id>.glb, made by scripts/build-animation-library.mjs; downloaded on first
 * use and cached for offline. See THIRD_PARTY_LICENSES.md.
 */
export const ANIMATION_LIBRARY: LibraryClip[] = [
  { id: 'Idle_Loop', label: 'Idle', group: 'Everyday' },
  { id: 'Idle_Talking_Loop', label: 'Talking', group: 'Everyday' },
  { id: 'Dance_Loop', label: 'Dance', group: 'Everyday' },
  { id: 'Interact', label: 'Interact', group: 'Everyday' },
  { id: 'PickUp_Table', label: 'Pick up', group: 'Everyday' },
  { id: 'Fixing_Kneeling', label: 'Fixing (kneeling)', group: 'Everyday' },
  { id: 'Idle_Torch_Loop', label: 'Holding a torch', group: 'Everyday' },
  { id: 'Push_Loop', label: 'Push', group: 'Everyday' },
  { id: 'Walk_Loop', label: 'Walk', group: 'Moving' },
  { id: 'Walk_Formal_Loop', label: 'Formal walk', group: 'Moving' },
  { id: 'Jog_Fwd_Loop', label: 'Jog', group: 'Moving' },
  { id: 'Sprint_Loop', label: 'Sprint', group: 'Moving' },
  { id: 'Crouch_Fwd_Loop', label: 'Crouch walk', group: 'Moving' },
  { id: 'Jump_Start', label: 'Jump start', group: 'Moving' },
  { id: 'Jump_Loop', label: 'In the air', group: 'Moving' },
  { id: 'Jump_Land', label: 'Landing', group: 'Moving' },
  { id: 'Roll', label: 'Roll', group: 'Moving' },
  { id: 'Swim_Fwd_Loop', label: 'Swim', group: 'Moving' },
  { id: 'Swim_Idle_Loop', label: 'Tread water', group: 'Moving' },
  { id: 'Sitting_Enter', label: 'Sit down', group: 'Sitting' },
  { id: 'Sitting_Idle_Loop', label: 'Sitting', group: 'Sitting' },
  { id: 'Sitting_Talking_Loop', label: 'Sitting, talking', group: 'Sitting' },
  { id: 'Sitting_Exit', label: 'Stand up', group: 'Sitting' },
  { id: 'Driving_Loop', label: 'Driving', group: 'Sitting' },
  { id: 'Crouch_Idle_Loop', label: 'Crouching', group: 'Sitting' },
  { id: 'Punch_Enter', label: 'Guard up', group: 'Combat' },
  { id: 'Punch_Jab', label: 'Jab', group: 'Combat' },
  { id: 'Punch_Cross', label: 'Cross punch', group: 'Combat' },
  { id: 'Sword_Idle', label: 'Sword ready', group: 'Combat' },
  { id: 'Sword_Attack', label: 'Sword attack', group: 'Combat' },
  { id: 'Pistol_Idle_Loop', label: 'Pistol ready', group: 'Combat' },
  { id: 'Pistol_Aim_Neutral', label: 'Aim', group: 'Combat' },
  { id: 'Pistol_Aim_Up', label: 'Aim up', group: 'Combat' },
  { id: 'Pistol_Aim_Down', label: 'Aim down', group: 'Combat' },
  { id: 'Pistol_Shoot', label: 'Shoot', group: 'Combat' },
  { id: 'Pistol_Reload', label: 'Reload', group: 'Combat' },
  { id: 'Spell_Simple_Enter', label: 'Spell: raise', group: 'Action' },
  { id: 'Spell_Simple_Idle_Loop', label: 'Spell: hold', group: 'Action' },
  { id: 'Spell_Simple_Shoot', label: 'Spell: cast', group: 'Action' },
  { id: 'Spell_Simple_Exit', label: 'Spell: lower', group: 'Action' },
  { id: 'Hit_Chest', label: 'Hit (chest)', group: 'Action' },
  { id: 'Hit_Head', label: 'Hit (head)', group: 'Action' },
  { id: 'Death01', label: 'Fall down', group: 'Action' },
];

export function libraryClipUrl(id: string) {
  return `${import.meta.env.BASE_URL}animations/${id}.glb`;
}

/** Physical looks; base-color textures remain attached. Advanced effects are opt-in. */
export const MATERIAL_PRESETS: { id: string; label: string; values: Partial<MaterialJSON>; advanced?: Partial<NonNullable<MaterialJSON['advanced']>> }[] = [
  { id: 'glass', label: 'Glass', values: { metallic: 0, roughness: .05 }, advanced: { refraction: true, transmission: 1, ior: 1.5 } },
  { id: 'brushed', label: 'Brushed metal', values: { metallic: 1, roughness: .3 }, advanced: { anisotropy: true, anisotropyIntensity: .8 } },
  { id: 'chrome', label: 'Chrome', values: { metallic: 1, roughness: .08 } },
  { id: 'glossy', label: 'Glossy plastic', values: { metallic: 0, roughness: .18 } },
  { id: 'matte', label: 'Matte plastic', values: { metallic: 0, roughness: .65 } },
  { id: 'rubber', label: 'Rubber', values: { metallic: 0, roughness: .95, albedo: '#303030' } },
  { id: 'ceramic', label: 'Ceramic', values: { metallic: 0, roughness: .2, clearCoat: true } },
  { id: 'fabric', label: 'Fabric / velvet', values: { metallic: 0, roughness: .9 }, advanced: { sheen: true, sheenIntensity: 1, sheenRoughness: .7 } },
  { id: 'paint', label: 'Car paint', values: { metallic: .65, roughness: .3, clearCoat: true } },
  { id: 'gold', label: 'Gold', values: { metallic: 1, roughness: .2, albedo: '#FFD073' } },
];
