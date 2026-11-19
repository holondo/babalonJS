import type { AnatomyKey } from './parameters';
import { forearmMuscles, type MuscleTemplate } from './definition';
import { atlas } from './atlas';

/** Anatomical regions of the Body page. Each region separates surface shape, muscles and bones. */
export type BodyRegion = 'overview' | 'chest' | 'abdomen' | 'pelvis' | 'back' | 'arms' | 'legs' | 'fat';
export type RegionPart = 'shape' | 'muscles' | 'bones';

export interface ControlGroup { label?: string; keys: AnatomyKey[]; inguinalPresets?: boolean }
/**
 * A muscle (or muscle group) the user picks. `keys` shape it on both sides; `growth` is chronic hypertrophy per
 * part (individualGrowth keys, both sides); `individual` adds per-side genetic shape (width, depth, belly…).
 */
export interface MuscleGroup { id: string; label: string; keys: AnatomyKey[]; growth?: { key: string; label: string }[]; individual?: { template: MuscleTemplate; label: string }[] }
export interface RegionLayout { label: string; shape: ControlGroup[]; muscles: MuscleGroup[]; bones: ControlGroup[]; hipBone?: boolean }

/** New groups reuse the translated growth/genetics controls of the priority regions. */
function anatomicalGroup(id: string, label: string, templates: MuscleTemplate[]): MuscleGroup {
  const parts = templates.map(template => ({ template, label: atlas.muscles.find(m => m.id === template)!.name }));
  return { id, label, keys: [], individual: parts, growth: parts.map(part => ({
    key: Object.entries(atlas.legacy).find(([, ids]) => ids.includes(part.template))?.[0] ?? part.template, label: part.label,
  })).filter((part, i, all) => all.findIndex(p => p.key === part.key) === i) };
}

export const bodyLayout: Record<BodyRegion, RegionLayout> = {
  overview: { label: 'Overview', shape: [{ keys: ['height', 'legBalance', 'asym'] }], muscles: [], bones: [] },
  chest: {
    label: 'Chest',
    shape: [{ keys: ['chestWidth', 'chestDepth', 'chestRoundness'] },
      { label: 'Left nipple', keys: ['nippleLeftX', 'nippleLeftY', 'nippleLeftRadius', 'nippleLeftProjection'] },
      { label: 'Right nipple', keys: ['nippleRightX', 'nippleRightY', 'nippleRightRadius', 'nippleRightProjection'] }],
    muscles: [{
      id: 'pectoralis', label: 'Pectoralis major',
      keys: ['pectoral', 'pectoralClavicular', 'pectoralSternal', 'pectoralCostal', 'pectoralSeparation', 'pecSpread', 'pecUpper', 'pectoralFiberConvergence', 'pectoralTendonWidth'],
      growth: [{ key: 'pectoralis_major_clavicular', label: 'Clavicular portion' }, { key: 'pectoralis_major_sternocostal', label: 'Sternocostal portion' }],
      individual: [{ template: 'pectoralis_major_clavicular', label: 'Clavicular portion' }, { template: 'pectoralis_major_sternocostal', label: 'Sternocostal portion' }],
    }, anatomicalGroup('shoulderGirdle', 'Shoulder girdle', ['pectoralis_minor', 'subclavius', 'serratus_anterior']),
    anatomicalGroup('thoracicWall', 'Thoracic wall', ['external_intercostals', 'internal_intercostals', 'diaphragm'])],
    bones: [{ keys: ['ribFlare'] }],
  },
  abdomen: {
    label: 'Abdomen',
    shape: [{ keys: ['waistWidth', 'waistDepth'] }, { label: 'Navel', keys: ['navelOffsetX', 'navelOffsetY', 'navelDepth', 'navelSize', 'navelAspect'] }],
    muscles: [
      { id: 'rectus', label: 'Rectus abdominis', keys: ['rectus', 'rectWidth', 'rectGap', 'rectusBellyProfile', 'rectusSegmentCount', 'rectusSegmentDefinition', 'tendon', 'rectPattern', 'rectusIntersectionShift', 'lineaAlbaDefinition'], growth: [{ key: 'rectus_abdominis', label: 'Rectus abdominis' }], individual: [{ template: 'rectus_abdominis', label: 'Rectus abdominis' }] },
      { id: 'obliques', label: 'Obliques', keys: ['oblique', 'obliqueFlesh', 'fiberAngle'], individual: [{ template: 'external_oblique', label: 'External oblique' }, { template: 'internal_oblique', label: 'Internal oblique' }] },
      { id: 'transversus', label: 'Transversus abdominis', keys: [], individual: [{ template: 'transversus_abdominis', label: 'Transversus abdominis' }] },
      anatomicalGroup('deepAbdomen', 'Deep abdominal support', ['quadratus_lumborum', 'pyramidalis']),
    ],
    bones: [],
  },
  pelvis: {
    label: 'Pelvis',
    shape: [{ keys: ['pelvisWidth', 'pelvisDepth', 'tilt'] }, { keys: ['lowerPelvisFrontDepth', 'lowerPelvisBackDepth'] }, { label: 'Inguinal region', inguinalPresets: true, keys: ['inguinalOpening', 'inguinalHeight', 'inguinalCurvature', 'inguinalLateralWrap', 'inguinalDefinition', 'inguinalGrooveSharpness', 'supraInguinalVolume', 'inguinalFoldOffset'] }],
    muscles: [],
    bones: [{ keys: ['asisDistance', 'asisHeight', 'pubisHeight', 'flare', 'iliacWing', 'iliacCrestRelief', 'acetabularRim'] }],
    hipBone: true,
  },
  back: {
    label: 'Back', shape: [], bones: [],
    muscles: [
      { id: 'trapezius', label: 'Trapezius', keys: ['back'],
        growth: [{ key: 'trapeziusUpper', label: 'Descending part' }, { key: 'trapeziusMiddle', label: 'Transverse part' }, { key: 'trapeziusLower', label: 'Ascending part' }],
        individual: [{ template: 'trapezius_upper', label: 'Descending part' }, { template: 'trapezius_middle', label: 'Transverse part' }, { template: 'trapezius_lower', label: 'Ascending part' }] },
      { id: 'latissimus', label: 'Latissimus dorsi', keys: [], growth: [{ key: 'latissimusDorsi', label: 'Latissimus dorsi' }, { key: 'teresMajor', label: 'Teres major' }],
        individual: [{ template: 'latissimus_dorsi', label: 'Latissimus dorsi' }, { template: 'teres_major', label: 'Teres major' }] },
      { id: 'erector', label: 'Erector spinae', keys: [], growth: [{ key: 'erectorSpinae', label: 'Erector spinae' }, { key: 'longissimus', label: 'Longissimus' }, { key: 'iliocostalis', label: 'Iliocostalis' }],
        individual: [{ template: 'erector_spinae_longissimus', label: 'Longissimus' }, { template: 'erector_spinae_iliocostalis', label: 'Iliocostalis' }] },
      { id: 'rhomboids', label: 'Rhomboids', keys: [], growth: [{ key: 'rhomboids', label: 'Rhomboids' }, { key: 'rhomboidMinor', label: 'Rhomboid minor' }, { key: 'rhomboidMajor', label: 'Rhomboid major' }],
        individual: [{ template: 'rhomboid_minor', label: 'Rhomboid minor' }, { template: 'rhomboid_major', label: 'Rhomboid major' }] },
      { id: 'rotatorCuff', label: 'Rotator cuff', keys: [],
        growth: [{ key: 'supraspinatus', label: 'Supraspinatus' }, { key: 'infraspinatus', label: 'Infraspinatus' }, { key: 'teresMinor', label: 'Teres minor' }, { key: 'subscapularis', label: 'Subscapularis' }],
        individual: [{ template: 'supraspinatus', label: 'Supraspinatus' }, { template: 'infraspinatus', label: 'Infraspinatus' }, { template: 'teres_minor', label: 'Teres minor' }, { template: 'subscapularis', label: 'Subscapularis' }] },
      anatomicalGroup('neck', 'Neck', ['sternocleidomastoid', 'levator_scapulae', 'scalenus_anterior', 'scalenus_medius', 'scalenus_posterior', 'splenius_capitis', 'platysma']),
      anatomicalGroup('deepBack', 'Deep back', ['spinalis', 'multifidus', 'serratus_posterior_superior', 'serratus_posterior_inferior']),
    ],
  },
  arms: {
    label: 'Arms',
    shape: [{ keys: ['shoulderWidth', 'shoulderSlope', 'armBelly'] }],
    muscles: [
      { id: 'deltoid', label: 'Deltoid', keys: ['deltoid'],
        growth: [{ key: 'deltoidAnterior', label: 'Anterior part' }, { key: 'deltoidMiddle', label: 'Middle part' }, { key: 'deltoidPosterior', label: 'Posterior part' }],
        individual: [{ template: 'deltoid_anterior', label: 'Anterior part' }, { template: 'deltoid_middle', label: 'Middle part' }, { template: 'deltoid_posterior', label: 'Posterior part' }] },
      { id: 'biceps', label: 'Biceps', keys: ['biceps'],
        growth: [{ key: 'biceps', label: 'Long head' }, { key: 'bicepsShort', label: 'Biceps brachii short head' }, { key: 'brachialis', label: 'Brachialis' }],
        individual: [{ template: 'biceps_brachii_long', label: 'Long head' }, { template: 'biceps_brachii_short', label: 'Biceps brachii short head' }, { template: 'brachialis', label: 'Brachialis' }] },
      { id: 'triceps', label: 'Triceps', keys: ['triceps'],
        growth: [{ key: 'tricepsLong', label: 'Long head' }, { key: 'tricepsLateral', label: 'Lateral head' }, { key: 'tricepsMedial', label: 'Triceps brachii medial head' }],
        individual: [{ template: 'triceps_brachii_long', label: 'Long head' }, { template: 'triceps_brachii_lateral', label: 'Lateral head' }, { template: 'triceps_brachii_medial', label: 'Triceps brachii medial head' }] },
      { id: 'forearm', label: 'Forearm', keys: ['forearm'],
        growth: [{ key: 'brachioradialis', label: 'Brachioradialis' }, { key: 'forearmFlexors', label: 'Flexors' }, { key: 'forearmExtensors', label: 'Extensors' }],
        individual: forearmMuscles.map(template => ({ template, label: atlas.muscles.find(m => m.id === template)!.name })) },
      anatomicalGroup('armStabilizers', 'Arm stabilizers', ['coracobrachialis', 'anconeus']),
    ],
    bones: [],
  },
  legs: {
    label: 'Legs',
    shape: [{ keys: ['thighGirth'] }],
    muscles: [
      { id: 'gluteal', label: 'Gluteal muscles', keys: ['gluteMax', 'gluteMed', 'gluteFullness'],
        growth: [{ key: 'gluteusMaximus', label: 'Gluteus maximus' }, { key: 'gluteusMedius', label: 'Gluteus medius' }, { key: 'gluteusMinimus', label: 'Gluteus minimus' }, { key: 'tensorFasciaeLatae', label: 'Tensor fasciae latae' }],
        individual: [{ template: 'gluteus_maximus', label: 'Gluteus maximus' }, { template: 'gluteus_medius', label: 'Gluteus medius' }, { template: 'gluteus_minimus', label: 'Gluteus minimus' }, { template: 'tensor_fasciae_latae', label: 'Tensor fasciae latae' }] },
      { id: 'hipFlexors', label: 'Hip flexors', keys: [], growth: [{ key: 'iliopsoas', label: 'Psoas major' }, { key: 'iliacus', label: 'Iliacus' }, { key: 'sartorius', label: 'Sartorius' }],
        individual: [{ template: 'psoas_major', label: 'Psoas major' }, { template: 'iliacus', label: 'Iliacus' }, { template: 'sartorius', label: 'Sartorius' }] },
      { id: 'quadriceps', label: 'Quadriceps', keys: ['quadriceps', 'proximalThigh', 'thighSweep'],
        growth: [{ key: 'rectusFemoris', label: 'Rectus femoris' }, { key: 'vastusLateralis', label: 'Vastus lateralis' }, { key: 'vastusMedialis', label: 'Vastus medialis' }, { key: 'vastusIntermedius', label: 'Vastus intermedius' }],
        individual: [{ template: 'rectus_femoris', label: 'Rectus femoris' }, { template: 'vastus_lateralis', label: 'Vastus lateralis' }, { template: 'vastus_medialis', label: 'Vastus medialis' }, { template: 'vastus_intermedius', label: 'Vastus intermedius' }] },
      { id: 'adductors', label: 'Adductors', keys: ['adductors'],
        growth: [{ key: 'adductorLongus', label: 'Adductor longus' }, { key: 'adductorMagnus', label: 'Adductor magnus' }, { key: 'adductorMagnusHamstring', label: 'Hamstring part' }, { key: 'adductorBrevis', label: 'Adductor brevis' }, { key: 'gracilis', label: 'Gracilis' }, { key: 'pectineus', label: 'Pectineus' }],
        individual: [{ template: 'adductor_longus', label: 'Adductor longus' }, { template: 'adductor_magnus_adductor', label: 'Adductor magnus' }, { template: 'adductor_brevis', label: 'Adductor brevis' }, { template: 'gracilis', label: 'Gracilis' }, { template: 'pectineus', label: 'Pectineus' }, { template: 'adductor_magnus_hamstring', label: 'Hamstring part' }] },
      { id: 'hamstrings', label: 'Hamstrings', keys: ['hamstrings'],
        growth: [{ key: 'bicepsFemoris', label: 'Biceps femoris' }, { key: 'bicepsFemorisShort', label: 'Biceps femoris short head' }, { key: 'semitendinosus', label: 'Semitendinosus' }, { key: 'semimembranosus', label: 'Semimembranosus' }],
        individual: [{ template: 'biceps_femoris_long', label: 'Biceps femoris' }, { template: 'semitendinosus', label: 'Semitendinosus' }, { template: 'semimembranosus', label: 'Semimembranosus' }, { template: 'biceps_femoris_short', label: 'Biceps femoris short head' }] },
      { id: 'calves', label: 'Calves', keys: ['calves', 'calfBelly'],
        growth: [{ key: 'gastrocnemiusMedial', label: 'Medial gastrocnemius' }, { key: 'gastrocnemiusLateral', label: 'Lateral gastrocnemius' }, { key: 'soleus', label: 'Soleus' }],
        individual: [{ template: 'gastrocnemius_medial', label: 'Medial gastrocnemius' }, { template: 'gastrocnemius_lateral', label: 'Lateral gastrocnemius' }, { template: 'soleus', label: 'Soleus' }] },
      { ...anatomicalGroup('shin', 'Anterior lower leg', ['tibialis_anterior', 'fibularis_longus', 'fibularis_brevis', 'fibularis_tertius', 'extensor_digitorum_longus', 'extensor_hallucis_longus']), keys: ['shin'] },
      anatomicalGroup('deepLowerLeg', 'Deep lower leg', ['popliteus', 'plantaris', 'tibialis_posterior', 'flexor_digitorum_longus', 'flexor_hallucis_longus']),
      anatomicalGroup('hipRotators', 'Hip rotators', ['piriformis', 'obturator_internus', 'obturator_externus', 'gemellus_superior', 'gemellus_inferior', 'quadratus_femoris']),
    ],
    bones: [],
  },
  fat: {
    label: 'Fat',
    shape: [
      { keys: ['fat'] },
      // Thickness multiplies the subcutaneous layer; deposits add localized shapes on top of it.
      { label: 'Regional thickness', keys: ['lowerFat', 'flankFat', 'pubicFat', 'armFat', 'gluteFat', 'thighFat'] },
      { label: 'Fat deposits', keys: ['abdominalProjection', 'lowerAbdominalFat', 'flankFullness', 'suprapubicFat'] },
    ],
    muscles: [],
    bones: [],
  },
};

/** Every control key placed in the layout, for coverage checks. */
export function layoutKeys(): AnatomyKey[] {
  return Object.values(bodyLayout).flatMap(region => [...region.shape, ...region.bones].flatMap(group => group.keys).concat(region.muscles.flatMap(muscle => muscle.keys)));
}
