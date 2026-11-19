import type { AnatomyParameters } from './parameters';
import { muscleDefaults, type MuscleShape, type MuscleTemplate } from './definition';
import { abdominalGeneticsParameters } from './abdominalGenetics';

type Region = 'chest' | 'shoulders' | 'back' | 'arms' | 'pelvis' | 'legs' | 'calves';
type Trait = 'balanced' | 'long' | 'compact' | 'broad' | 'deep' | 'high' | 'low';
interface Architecture { label: string; abdomen: string; frame: Partial<AnatomyParameters>; traits: Record<Region, Trait> }
const traits = (changes: Partial<Record<Region, Trait>>): Record<Region, Trait> => ({
  chest: 'balanced', shoulders: 'balanced', back: 'balanced', arms: 'balanced', pelvis: 'balanced', legs: 'balanced', calves: 'balanced', ...changes,
});

/** Coordinated illustrative shape recipes. No body-fat or hypertrophy values belong here. */
export const bodyGenetics: Record<string, Architecture> = {
  balanced: { label: 'Balanced architecture', abdomen: 'balanced',
    frame: { legBalance: 0, shoulderWidth: 43, shoulderSlope: 0, chestWidth: 34, chestDepth: 24, chestRoundness: 0, waistWidth: 29, waistDepth: 22, pelvisWidth: 35, pelvisDepth: 26, asisDistance: 26, thighGirth: 55, pecSpread: 0, pecUpper: 0, armBelly: 0, gluteFullness: 0, thighSweep: 0, calfBelly: 0 }, traits: traits({}) },
  long: { label: 'Long muscle bellies', abdomen: 'elongated',
    frame: { legBalance: .55, shoulderWidth: 40, shoulderSlope: .2, chestWidth: 32, chestDepth: 23, waistWidth: 27, waistDepth: 21, pelvisWidth: 34, pelvisDepth: 25, asisDistance: 25, thighGirth: 51, pecSpread: -.2, pecUpper: .15, armBelly: -.25, gluteFullness: -.2, thighSweep: -.1, calfBelly: -.25 }, traits: traits({ chest: 'long', shoulders: 'long', back: 'long', arms: 'long', pelvis: 'deep', legs: 'long', calves: 'long' }) },
  compact: { label: 'Compact muscle bellies', abdomen: 'compact',
    frame: { legBalance: -.45, shoulderWidth: 46, shoulderSlope: -.1, chestWidth: 38, chestDepth: 27, waistWidth: 31, waistDepth: 24, pelvisWidth: 37, pelvisDepth: 27, asisDistance: 27.5, thighGirth: 58, pecSpread: .3, pecUpper: -.15, armBelly: .3, gluteFullness: .2, thighSweep: .15, calfBelly: .3 }, traits: traits({ chest: 'broad', shoulders: 'compact', back: 'broad', arms: 'compact', pelvis: 'broad', legs: 'compact', calves: 'high' }) },
  shoulders: { label: 'Broad shoulder frame', abdomen: 'staggered',
    frame: { legBalance: .1, shoulderWidth: 50, shoulderSlope: -.25, chestWidth: 39, chestDepth: 25, waistWidth: 27.5, waistDepth: 21.5, pelvisWidth: 34, pelvisDepth: 25, asisDistance: 25, thighGirth: 54, pecSpread: .4, pecUpper: .2, armBelly: .15, gluteFullness: -.1, thighSweep: -.1, calfBelly: .1 }, traits: traits({ chest: 'broad', shoulders: 'broad', back: 'broad', arms: 'high', pelvis: 'long', legs: 'long', calves: 'high' }) },
  deep: { label: 'Deep torso frame', abdomen: 'separated',
    frame: { legBalance: -.2, shoulderWidth: 43, shoulderSlope: .15, chestWidth: 35, chestDepth: 30, chestRoundness: .35, waistWidth: 30, waistDepth: 24, pelvisWidth: 35.5, pelvisDepth: 29, asisDistance: 26, thighGirth: 55, pecSpread: -.25, pecUpper: -.1, armBelly: -.15, gluteFullness: .3, thighSweep: 0, calfBelly: -.2 }, traits: traits({ chest: 'deep', shoulders: 'deep', back: 'deep', arms: 'long', pelvis: 'deep', legs: 'deep', calves: 'low' }) },
  pelvis: { label: 'Broad pelvic frame', abdomen: 'arched',
    frame: { legBalance: .2, shoulderWidth: 40, shoulderSlope: .25, chestWidth: 32, chestDepth: 23, waistWidth: 28.5, waistDepth: 22.5, pelvisWidth: 41, pelvisDepth: 28, asisDistance: 29, thighGirth: 59, pecSpread: -.1, pecUpper: 0, armBelly: -.1, gluteFullness: .1, thighSweep: .15, calfBelly: -.1 }, traits: traits({ chest: 'long', shoulders: 'long', back: 'deep', arms: 'long', pelvis: 'broad', legs: 'broad', calves: 'long' }) },
  tapered: { label: 'Tapered frame and peaked bellies', abdomen: 'narrow',
    frame: { legBalance: .35, shoulderWidth: 47, shoulderSlope: -.15, chestWidth: 37, chestDepth: 25, waistWidth: 26, waistDepth: 20.5, pelvisWidth: 33, pelvisDepth: 25, asisDistance: 24.5, thighGirth: 53, pecSpread: .2, pecUpper: .3, armBelly: .3, gluteFullness: -.1, thighSweep: 0, calfBelly: .35 }, traits: traits({ chest: 'high', shoulders: 'broad', back: 'broad', arms: 'high', pelvis: 'deep', legs: 'deep', calves: 'high' }) },
  sweep: { label: 'Sweeping leg contours', abdomen: 'broad',
    frame: { legBalance: .2, shoulderWidth: 44, shoulderSlope: .1, chestWidth: 35, chestDepth: 24, waistWidth: 29, waistDepth: 22, pelvisWidth: 38, pelvisDepth: 27.5, asisDistance: 27.5, thighGirth: 60, pecSpread: 0, pecUpper: -.1, armBelly: 0, gluteFullness: .3, thighSweep: .3, calfBelly: -.3 }, traits: traits({ chest: 'balanced', shoulders: 'deep', back: 'long', arms: 'compact', pelvis: 'deep', legs: 'broad', calves: 'low' }) },
};

const regions: Record<Region, MuscleTemplate[]> = {
  chest: ['pectoralis_major_clavicular', 'pectoralis_major_sternocostal'],
  shoulders: ['deltoid_anterior', 'deltoid_middle', 'deltoid_posterior', 'trapezius_upper', 'sternocleidomastoid', 'levator_scapulae'],
  back: ['latissimus_dorsi', 'trapezius_middle', 'trapezius_lower', 'erector_spinae_longissimus', 'erector_spinae_iliocostalis', 'teres_major', 'infraspinatus'],
  arms: ['biceps_brachii_long', 'biceps_brachii_short', 'brachialis', 'triceps_brachii_long', 'triceps_brachii_lateral', 'triceps_brachii_medial', 'brachioradialis', 'flexor_carpi_radialis', 'extensor_carpi_radialis_longus'],
  pelvis: ['gluteus_maximus', 'gluteus_medius', 'gluteus_minimus', 'tensor_fasciae_latae'],
  legs: ['rectus_femoris', 'vastus_lateralis', 'vastus_medialis', 'vastus_intermedius', 'adductor_longus', 'adductor_magnus_adductor', 'biceps_femoris_long', 'semitendinosus', 'semimembranosus'],
  calves: ['gastrocnemius_medial', 'gastrocnemius_lateral', 'soleus', 'tibialis_anterior'],
};
const profiles: Record<Trait, Partial<MuscleShape>> = {
  balanced: { width: 1, depth: 1, profile: .25, fullness: 0, peakOffset: 0, widthProfile: [1, 1, 1, 1, 1] },
  long: { width: .9, depth: 1.1, profile: .4, fullness: -.08, peakOffset: -.04, widthProfile: [1, 1.08, 1.06, 1.02, 1], bellySpan: [.04, .96] },
  compact: { width: 1.12, depth: .94, profile: .65, fullness: .06, peakOffset: .04, widthProfile: [1, .92, 1.16, .92, 1], bellySpan: [.2, .8] },
  broad: { width: 1.18, depth: .9, profile: .35, fullness: -.04, peakOffset: -.03, widthProfile: [1, 1.12, 1.2, 1.08, 1], bellySpan: [.1, .9] },
  deep: { width: .9, depth: 1.16, profile: .5, fullness: .02, peakOffset: 0, widthProfile: [1, .96, 1.04, .98, 1], bellySpan: [.1, .9] },
  high: { width: 1.02, depth: 1.04, profile: .65, fullness: .16, peakOffset: .1, widthProfile: [1, .88, 1, 1.18, 1], bellySpan: [.27, .94] },
  low: { width: 1.06, depth: 1, profile: .55, fullness: -.15, peakOffset: -.1, widthProfile: [1, 1.16, 1.04, .9, 1], bellySpan: [.04, .73] },
};
const fusiformRegions = new Set<Region>(['arms', 'legs', 'calves']);
const frameKeys = Object.keys(bodyGenetics.balanced.frame) as (keyof AnatomyParameters)[];
function random(seed: number) {
  let value = seed >>> 0;
  return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296 - .5; };
}
function architectureFrame(recipe: Architecture, variation: () => number) {
  const frame: Partial<AnatomyParameters> = { ...bodyGenetics.balanced.frame, ...recipe.frame };
  for (const key of frameKeys) {
    const value = frame[key];
    if (typeof value !== 'number') continue;
    const delta = variation();
    (frame as Record<string, unknown>)[key] = value + (Math.abs(value) > 10 ? value * .035 * delta : .08 * delta);
  }
  return frame;
}
export function bodyGeneticsFrame(key: string, seed = 0): Partial<AnatomyParameters> {
  const recipe = bodyGenetics[key];
  if (!recipe) return {};
  const rng = random(seed || 1);
  return architectureFrame(recipe, () => seed ? rng() : 0);
}

/** Apply an explicit architecture while retaining skin/materials, pose and training controls. */
export function bodyGeneticsParameters(p: AnatomyParameters, key: string, seed = 0): Partial<AnatomyParameters> {
  const recipe = bodyGenetics[key];
  if (!recipe) return {};
  seed = Number.isFinite(seed) ? Math.max(0, Math.min(2147483647, Math.floor(seed))) : 0;
  const rng = random(seed || 1), variation = () => seed ? rng() : 0;
  const frame = architectureFrame(recipe, variation);
  const abdominal = abdominalGeneticsParameters(p, recipe.abdomen);
  const definition = abdominal.definition!;
  definition.genetics = { version: 1, preset: key, seed };
  for (const [region, templates] of Object.entries(regions) as [Region, MuscleTemplate[]][]) {
    const alternatives = Object.keys(profiles) as Trait[];
    const trait = seed && rng() > .18 ? alternatives[Math.floor((rng()+.5)*alternatives.length)] : recipe.traits[region];
    const traits = profiles[trait];
    for (const template of templates) {
      // Paired muscles share a recipe; variations do not introduce accidental asymmetry.
      const shape: MuscleShape = { ...muscleDefaults, ...structuredClone(traits) };
      shape.width += variation() * .08;
      shape.depth += variation() * .06;
      shape.fullness += variation() * .08;
      shape.peakOffset += variation() * .04;
      if (template.startsWith('deltoid_')) {
        // The three heads share a curved cap. Keep genetic redistribution
        // modest there so existing hypertrophy cannot amplify a fan seam.
        shape.width = 1 + (shape.width - 1) * .35;
        shape.depth = 1 + (shape.depth - 1) * .35;
        shape.profile *= .35;
        shape.fullness *= .5; shape.peakOffset *= .5;
        shape.widthProfile = shape.widthProfile?.map(value => 1 + (value - 1) * .35);
      }
      shape.volume = 1 / (shape.width * shape.depth);
      if (!fusiformRegions.has(region)) delete shape.bellySpan;
      if (template === 'pectoralis_major_clavicular') shape.balance = .12;
      if (template === 'pectoralis_major_sternocostal') shape.balance = recipe.traits.chest === 'high' ? .3 : recipe.traits.chest === 'deep' ? -.25 : 0;
      for (const side of ['L', 'R'] as const) definition.muscles[`${template}.${side}`] = structuredClone(shape);
    }
  }
  return { ...frame, ...abdominal, definition };
}

/** Shared application path for the quick cards and scripted physique construction. */
export function physiquePresetParameters(p: AnatomyParameters, preset: {
  values: Partial<AnatomyParameters>; genetics?: string; geneticSeed?: number; abdomen?: string;
}): Partial<AnatomyParameters> {
  const values = { ...(preset.genetics ? bodyGeneticsParameters(p, preset.genetics, preset.geneticSeed) : {}), ...preset.values };
  if (preset.abdomen) Object.assign(values, abdominalGeneticsParameters({ ...p, ...values }, preset.abdomen));
  return values;
}
