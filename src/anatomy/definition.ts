/** Sparse versioned individual overrides; absence preserves the existing generator. */
import { additionalLegMuscles, axialMuscles, shoulderNeckMuscles } from './muscleGroups';
export type AnatomySide = 'L' | 'R';
/** Muscles with individual per-side (genetic) shape controls; FORMA A template ids. */
export const forearmMuscles = ["brachioradialis","pronator_teres","pronator_quadratus","supinator","flexor_carpi_radialis","flexor_carpi_ulnaris","palmaris_longus","flexor_digitorum_superficialis","flexor_digitorum_profundus","flexor_pollicis_longus","extensor_carpi_radialis_longus","extensor_carpi_radialis_brevis","extensor_carpi_ulnaris","extensor_digitorum","extensor_digiti_minimi","extensor_indicis","abductor_pollicis_longus","extensor_pollicis_longus","extensor_pollicis_brevis"] as const;
export const individualMuscles = ['rectus_abdominis', 'external_oblique', 'internal_oblique', 'transversus_abdominis', 'pectoralis_major_clavicular', 'pectoralis_major_sternocostal', 'deltoid_anterior', 'deltoid_middle', 'deltoid_posterior', 'trapezius_upper', 'trapezius_middle', 'trapezius_lower', 'latissimus_dorsi', 'erector_spinae_longissimus', 'erector_spinae_iliocostalis', 'rhomboid_minor', 'rhomboid_major', 'supraspinatus', 'infraspinatus', 'teres_minor', 'teres_major', 'biceps_brachii_long', 'biceps_brachii_short', 'brachialis', 'triceps_brachii_long', 'triceps_brachii_lateral', 'triceps_brachii_medial', ...forearmMuscles, ...shoulderNeckMuscles, ...additionalLegMuscles, ...axialMuscles, 'gluteus_maximus', 'gluteus_medius', 'gluteus_minimus', 'tensor_fasciae_latae', 'rectus_femoris', 'psoas_major', 'iliacus', 'sartorius', 'pectineus', 'gracilis', 'adductor_brevis', 'vastus_lateralis', 'vastus_medialis', 'adductor_longus', 'adductor_magnus_adductor', 'biceps_femoris_long', 'semitendinosus', 'semimembranosus', 'gastrocnemius_medial', 'gastrocnemius_lateral', 'soleus', 'tibialis_anterior'] as const;
export type MuscleTemplate = typeof individualMuscles[number];
export type MuscleId = `${MuscleTemplate}.${AnatomySide}`;
export type BoneId = `hip_bone.${AnatomySide}`;
export interface TendinousIntersection { position: number; angle: number; curvature: number; width: number; depth: number; extent: number }
export interface MuscleShape {
  width: number; depth: number; volume: number; fullness: number; profile: number; activation: number; balance: number;
  centerlineBend: number; peakOffset: number;
  intersections?: TendinousIntersection[];
  fittedIntersections?: TendinousIntersection[];
  fittedBellies?: { width: number; peak: number; projection: number }[];
  depthProfile?: number[];
  costalDepthProfile?: number[];
  /** Five stations along the free inferior border, in canonical millimetres. */
  pectoralContour?: { lift: number[]; projection: number[]; shoulderProjection?: number[]; axillaryProjection?: number; covering?: number[]; transitionCovering?: number[] };
  widthProfile?: number[];
  fittedWidthProfile?: number[];
  /** Fitted in-plane outline warp in chart units (see `outlineDisplacement`); the costal head of the pectoral has its own. */
  outlineWarp?: number[];
  costalOutlineWarp?: number[];
}
export interface BoneShape { width: number; depth: number; height: number; flare: number; acetabularAngle: number }
/** skinFollows: the covering is pushed out by the superficial muscles instead of limiting them. */
export interface TissueInteraction { recipeVersion: 1; attachments: boolean; contact: boolean; clearanceMm: number; supportDetail: 1 | 2; skinFollows?: boolean }
export const interactionDefaults: TissueInteraction = { recipeVersion: 1, attachments: false, contact: false, clearanceMm: 1, supportDetail: 1 };
export interface AnatomyDefinition { version: 1; muscles: Partial<Record<MuscleId, MuscleShape>>; bones: Partial<Record<BoneId, BoneShape>>; interaction?: TissueInteraction }
export const muscleDefaults: MuscleShape = { width: 1, depth: 1, volume: 1, fullness: 0, profile: .5, activation: 0, balance: 0, centerlineBend: 0, peakOffset: 0 };
export const boneDefaults: BoneShape = { width: 1, depth: 1, height: 1, flare: 0, acetabularAngle: 0 };
export const muscleRanges = { width: [.65, 1.5], depth: [.65, 1.5], volume: [.5, 2], fullness: [-.3, .3], profile: [0, 1], activation: [0, 1], balance: [-1, 1], centerlineBend: [-2, 2], peakOffset: [-.25, .25] } as const;
export const boneRanges = { width: [.8, 1.25], depth: [.8, 1.25], height: [.9, 1.1], flare: [-.3, .3], acetabularAngle: [-20, 20] } as const;
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function bounded(value: unknown, min: number, max: number, fallback: number) { return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback; }
export function normalizeIntersections(value: unknown): TendinousIntersection[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value.slice(0, 5).map(item => {
    const v = object(item);
    return { position: bounded(v.position, .08, .92, .5), angle: bounded(v.angle, -20, 20, 0), curvature: bounded(v.curvature, -.1, .1, 0), width: bounded(v.width, .4, 1.6, 1), depth: bounded(v.depth, 0, 1, .55), extent: bounded(v.extent, .3, 1, 1) };
  }).sort((a, b) => b.position - a.position);
  for (let i = 1; i < result.length; i++) result[i].position = Math.min(result[i].position, result[i - 1].position - .09);
  return result.filter(item => item.position >= .08);
}
export function normalizeDefinition(input: unknown): AnatomyDefinition | undefined {
  if (input === undefined || input === null) return undefined;
  const value = object(input);
  if (value.version !== 1) throw new Error('Unsupported anatomy definition version.');
  const result: AnatomyDefinition = { version: 1, muscles: {}, bones: {} };
  if (value.interaction && typeof value.interaction === 'object') {
    const interaction = object(value.interaction);
    if (interaction.recipeVersion !== undefined && interaction.recipeVersion !== 1) throw new Error('Unsupported anatomy interaction version.');
    result.interaction = { recipeVersion: 1, attachments: interaction.attachments === true, contact: interaction.contact === true, clearanceMm: bounded(interaction.clearanceMm, 0, 3, 1), supportDetail: interaction.supportDetail === 2 ? 2 : 1, ...(interaction.skinFollows === true ? { skinFollows: true } : {}) };
  }
  for (const id of individualMuscles.flatMap(name => [`${name}.L`, `${name}.R`] as MuscleId[])) {
    const raw = object(value.muscles)[id]; if (!raw || typeof raw !== 'object') continue;
    const fields = object(raw), shape = { ...muscleDefaults };
    for (const key of Object.keys(muscleRanges) as (keyof typeof muscleRanges)[]) { const [min, max] = muscleRanges[key]; shape[key] = bounded(fields[key], min, max, muscleDefaults[key]); }
    if (id.startsWith('rectus_abdominis.')) shape.intersections = normalizeIntersections(fields.intersections);
    if (id.startsWith('rectus_abdominis.')) shape.fittedIntersections = normalizeIntersections(fields.fittedIntersections);
    if (id.startsWith('rectus_abdominis.') && Array.isArray(fields.fittedBellies) && fields.fittedBellies.length >= 2 && fields.fittedBellies.length <= 6)
      shape.fittedBellies = fields.fittedBellies.map(value => {
        const belly = object(value);
        return {width:bounded(belly.width,.85,1.3,1),peak:bounded(belly.peak,.32,.68,.5),projection:bounded(belly.projection,0,12,0)};
      });
    for (const key of ['outlineWarp', 'costalOutlineWarp'] as const) {
      const warp = fields[key];
      if (Array.isArray(warp) && warp.length === 6) shape[key] = warp.map((value, i) => bounded(value, i < 2 ? -.2 : -.35, i < 2 ? .2 : .35, 0));
    }
    if(Array.isArray(fields.depthProfile)&&[15,45].includes(fields.depthProfile.length))shape.depthProfile=fields.depthProfile.map(v=>bounded(v,.35,20,1));
    if(id.startsWith('pectoralis_major_sternocostal.')&&Array.isArray(fields.costalDepthProfile)&&fields.costalDepthProfile.length===15)shape.costalDepthProfile=fields.costalDepthProfile.map(v=>bounded(v,.35,20,1));
    if (id.startsWith('pectoralis_major_sternocostal.')) {
      const contour = object(fields.pectoralContour);
      if (Array.isArray(contour.lift) && contour.lift.length === 5 && Array.isArray(contour.projection) && contour.projection.length === 5) {
        shape.pectoralContour = { lift: contour.lift.map(v => bounded(v, -28, 80, 0)), projection: contour.projection.map(v => bounded(v, -8, 24, 0)) };
        if (Array.isArray(contour.shoulderProjection) && contour.shoulderProjection.length === 5)
          shape.pectoralContour.shoulderProjection = contour.shoulderProjection.map(v => bounded(v, -12, 16, 0));
        if (typeof contour.axillaryProjection === 'number')
          shape.pectoralContour.axillaryProjection = bounded(contour.axillaryProjection,-10,16,0);
        if (Array.isArray(contour.covering) && contour.covering.length === 6)
          shape.pectoralContour.covering = contour.covering.map(v => bounded(v, -10, 22, 0));
        if (Array.isArray(contour.transitionCovering) && contour.transitionCovering.length === 2)
          shape.pectoralContour.transitionCovering = [bounded(contour.transitionCovering[0], -24, 0, 0), bounded(contour.transitionCovering[1], 0, 30, 0)];
      }
    }
    if (Array.isArray(fields.widthProfile) && fields.widthProfile.length === 5) shape.widthProfile = fields.widthProfile.map(value => bounded(value, .65, 1.8, 1));
    if (id.startsWith('rectus_abdominis.') && Array.isArray(fields.fittedWidthProfile) && [5,9].includes(fields.fittedWidthProfile.length))
      shape.fittedWidthProfile = fields.fittedWidthProfile.map(value => bounded(value, .75, 2, 1));
    result.muscles[id] = shape;
  }
  for (const id of ['hip_bone.L', 'hip_bone.R'] as BoneId[]) {
    const raw = object(value.bones)[id]; if (!raw || typeof raw !== 'object') continue;
    const fields = object(raw), shape = { ...boneDefaults };
    for (const key of Object.keys(boneRanges) as (keyof BoneShape)[]) { const [min, max] = boneRanges[key]; shape[key] = bounded(fields[key], min, max, boneDefaults[key]); }
    result.bones[id] = shape;
  }
  return result;
}
