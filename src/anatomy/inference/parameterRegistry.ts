import catalogue from '../catalogue.json';
import { defaults } from '../parameters';

export type SemanticClass =
  | 'anthropometry'
  | 'skeletal_bone'
  | 'muscle_group_volume'
  | 'individual_muscle'
  | 'tendon_intersections'
  | 'fat_distribution'
  | 'superficial_detail'
  | 'discrete_generator'
  | 'pose'
  | 'render_only';

export type Observability =
  | 'observable'          // Can be directly estimated from exterior surface & landmarks
  | 'conditioned_prior'   // Coupled with other variables (e.g. fat vs muscle); requires joint prior
  | 'latent_prior'        // Internal geometry not identifiable from outer skin alone
  | 'discrete'            // Finite categorical choice
  | 'render_only';        // Material / lighting / visibility; excluded from inverse fitting

export type UnitType = 'cm' | 'm' | '10cm' | 'deg' | 'percent' | 'scalar' | 'discrete';

export interface ParameterMetadata {
  key: string;
  label: string;
  semanticClass: SemanticClass;
  observability: Observability;
  unit: UnitType;
  min: number;
  max: number;
  defaultVal: number;
  invalidates: readonly string[];
}

// Invalidation mapping: which anatomical compartments are affected when this parameter changes
const DEPENDENCY_MAP: Record<string, readonly string[]> = {
  height: ['skeleton', 'allMuscles', 'adiposeEnvelope', 'skinCage'],
  pelvisWidth: ['pelvis', 'hipJoint', 'gluteals', 'rectusAbdominis', 'adiposeEnvelope', 'skinCage'],
  pelvisDepth: ['pelvis', 'hipJoint', 'gluteals', 'psoasMajor', 'adiposeEnvelope', 'skinCage'],
  asisDistance: ['pelvis', 'inguinalLigaments', 'abdominalWall', 'skinCage'],
  asisHeight: ['pelvis', 'inguinalLigaments', 'abdominalWall', 'skinCage'],
  flare: ['pelvis', 'obliques', 'adiposeEnvelope', 'skinCage'],
  tilt: ['pelvis', 'sacrum', 'hipJoint', 'pose', 'skinCage'],
  iliacWing: ['pelvis', 'gluteals', 'internalOblique', 'skinCage'],
  acetabularRim: ['pelvis', 'hipJoint'],
  pubisHeight: ['pelvis', 'rectusAbdominis', 'pubicSheath', 'skinCage'],
  iliacCrestRelief: ['pelvis', 'externalOblique', 'skinCage'],

  shoulderWidth: ['clavicle', 'scapula', 'shoulderJoint', 'pectoralisMajor', 'deltoid', 'skinCage'],
  chestWidth: ['ribcage', 'pectoralisMajor', 'intercostales', 'serratus', 'skinCage'],
  chestDepth: ['ribcage', 'pectoralisMajor', 'erectorSpinae', 'skinCage'],
  waistWidth: ['abdominalWall', 'rectusAbdominis', 'obliques', 'transversus', 'skinCage'],
  waistDepth: ['abdominalWall', 'psoasMajor', 'erectorSpinae', 'skinCage'],
  thighGirth: ['femur', 'quadriceps', 'hamstrings', 'adductors', 'skinCage'],
  proximalThigh: ['femur', 'adductors', 'gluteals', 'skinCage'],

  pectoral: ['pectoralisMajor', 'skinCage'],
  pectoralClavicular: ['pectoralisMajor', 'skinCage'],
  pectoralSternal: ['pectoralisMajor', 'skinCage'],
  pectoralCostal: ['pectoralisMajor', 'skinCage'],
  pectoralSeparation: ['pectoralisMajor', 'skinCage'],
  pectoralTendonWidth: ['pectoralisMajor'],
  pectoralFiberConvergence: ['pectoralisMajor'],
  pecSpread: ['pectoralisMajor'],
  pecUpper: ['pectoralisMajor'],

  rectus: ['rectusAbdominis', 'skinCage'],
  rectusBellyProfile: ['rectusAbdominis', 'skinCage'],
  rectusSegmentCount: ['rectusAbdominis', 'aponeuroses', 'skinCage'],
  rectusSegmentDefinition: ['rectusAbdominis', 'skinCage'],
  rectusIntersectionShift: ['rectusAbdominis', 'skinCage'],
  lineaAlbaDefinition: ['rectusAbdominis', 'aponeuroses', 'skinCage'],
  abdominalProjection: ['abdominalWall', 'rectusAbdominis', 'transversus', 'skinCage'],

  oblique: ['externalOblique', 'internalOblique', 'skinCage'],
  obliqueFlesh: ['externalOblique', 'skinCage'],
  back: ['trapezius', 'latissimusDorsi', 'rhomboids', 'erectorSpinae', 'skinCage'],
  deltoid: ['deltoid', 'skinCage'],
  biceps: ['bicepsBrachii', 'brachialis', 'skinCage'],
  triceps: ['tricepsBrachii', 'skinCage'],
  forearm: ['forearmFlexors', 'forearmExtensors', 'skinCage'],
  gluteMax: ['gluteusMaximus', 'skinCage'],
  gluteMed: ['gluteusMedius', 'gluteusMinimus', 'skinCage'],
  quadriceps: ['rectusFemoris', 'vastusLateralis', 'vastusMedialis', 'vastusIntermedius', 'skinCage'],
  adductors: ['adductorMagnus', 'adductorLongus', 'gracilis', 'skinCage'],
  hamstrings: ['bicepsFemoris', 'semitendinosus', 'semimembranosus', 'skinCage'],
  calves: ['gastrocnemius', 'soleus', 'skinCage'],
  shin: ['tibialisAnterior', 'skinCage'],

  fat: ['adiposeEnvelope', 'skinCage'],
  lowerFat: ['adiposeEnvelope', 'skinCage'],
  flankFat: ['adiposeEnvelope', 'skinCage'],
  armFat: ['adiposeEnvelope', 'skinCage'],
  gluteFat: ['adiposeEnvelope', 'skinCage'],
  thighFat: ['adiposeEnvelope', 'skinCage'],
  lowerAbdominalFat: ['adiposeEnvelope', 'skinCage'],
  flankFullness: ['adiposeEnvelope', 'skinCage'],
  suprapubicFat: ['adiposeEnvelope', 'skinCage'],
  pubicFat: ['adiposeEnvelope', 'skinCage'],

  skinModel: ['skinMesh', 'allLayers'],
  abdominalModel: ['abdominalWall', 'externalOblique', 'internalOblique', 'transversus'],
  pelvisModel: ['pelvis', 'hipJoint', 'muscleOrigins'],
};

// Classify semantic class and observability for each parameter
function classifyParameter(key: string, kind: string, unitLabel: string): { semantic: SemanticClass; observability: Observability; unit: UnitType } {
  if (kind === 'material' || kind === 'light' || key.endsWith('Opacity')) {
    return { semantic: 'render_only', observability: 'render_only', unit: unitLabel === '%' ? 'percent' : 'scalar' };
  }
  if (['skinModel', 'abdominalModel', 'pelvisModel'].includes(key)) {
    return { semantic: 'discrete_generator', observability: 'discrete', unit: 'discrete' };
  }
  if (['height', 'chestWidth', 'chestDepth', 'shoulderWidth', 'waistWidth', 'waistDepth', 'pelvisWidth', 'pelvisDepth', 'thighGirth', 'proximalThigh'].includes(key)) {
    return { semantic: 'anthropometry', observability: 'observable', unit: 'cm' };
  }
  if (['flare', 'tilt', 'iliacWing', 'acetabularRim', 'asisHeight', 'pubisHeight', 'iliacCrestRelief'].includes(key)) {
    return { semantic: 'skeletal_bone', observability: 'conditioned_prior', unit: 'scalar' };
  }
  if (key.includes('Fat') || key === 'fat' || key === 'flankFullness') {
    return { semantic: 'fat_distribution', observability: 'conditioned_prior', unit: unitLabel === '%' ? 'percent' : 'scalar' };
  }
  if (key.startsWith('rectusSegment') || key.startsWith('rectusIntersection') || key === 'lineaAlbaDefinition' || key === 'rectPattern') {
    return { semantic: 'tendon_intersections', observability: 'conditioned_prior', unit: key === 'rectusSegmentCount' ? 'discrete' : 'scalar' };
  }
  if (key.startsWith('inguinal') || key.startsWith('navel')) {
    return { semantic: 'superficial_detail', observability: 'observable', unit: unitLabel === '°' ? 'deg' : 'scalar' };
  }
  // Muscle volume & hypertrophy
  if (['pectoral', 'deltoid', 'biceps', 'triceps', 'forearm', 'back', 'rectus', 'oblique', 'gluteMax', 'gluteMed', 'quadriceps', 'adductors', 'hamstrings', 'calves', 'shin'].includes(key)) {
    return { semantic: 'muscle_group_volume', observability: 'conditioned_prior', unit: 'scalar' };
  }
  return { semantic: 'muscle_group_volume', observability: 'latent_prior', unit: 'scalar' };
}

/** Complete registry of all anatomical parameters. */
export class ParameterRegistry {
  private readonly records = new Map<string, ParameterMetadata>();

  constructor() {
    for (const c of catalogue.controls) {
      const defaultVal = (defaults as Record<string, number>)[c.key] ?? c.min;
      const { semantic, observability, unit } = classifyParameter(c.key, c.kind, c.unitLabel);
      const invalidates = DEPENDENCY_MAP[c.key] ?? ['skinCage'];
      this.records.set(c.key, {
        key: c.key,
        label: c.label,
        semanticClass: semantic,
        observability,
        unit,
        min: c.min,
        max: c.max,
        defaultVal,
        invalidates,
      });
    }

    // Register discrete generator models if not in catalogue controls
    for (const discreteKey of ['skinModel', 'abdominalModel', 'pelvisModel'] as const) {
      if (!this.records.has(discreteKey)) {
        this.records.set(discreteKey, {
          key: discreteKey,
          label: discreteKey,
          semanticClass: 'discrete_generator',
          observability: 'discrete',
          unit: 'discrete',
          min: 0,
          max: 2,
          defaultVal: defaults[discreteKey],
          invalidates: DEPENDENCY_MAP[discreteKey] ?? ['allLayers'],
        });
      }
    }
  }

  get(key: string): ParameterMetadata | undefined {
    return this.records.get(key);
  }

  getAll(): ParameterMetadata[] {
    return Array.from(this.records.values());
  }

  getBySemanticClass(cls: SemanticClass): ParameterMetadata[] {
    return this.getAll().filter(m => m.semanticClass === cls);
  }

  getByObservability(obs: Observability): ParameterMetadata[] {
    return this.getAll().filter(m => m.observability === obs);
  }

  /**
   * Converts parameter value from storage/UI units to canonical metric meters.
   */
  toCanonicalMeters(key: string, value: number): number {
    const meta = this.get(key);
    if (!meta) return value;
    if (meta.unit === 'cm') return value * 0.01;
    if (meta.unit === '10cm') return value * 0.10;
    return value;
  }

  /**
   * Converts canonical metric meters to storage/UI parameter units.
   */
  fromCanonicalMeters(key: string, meters: number): number {
    const meta = this.get(key);
    if (!meta) return meters;
    if (meta.unit === 'cm') return meters * 100;
    if (meta.unit === '10cm') return meters * 10;
    return meters;
  }

  /**
   * Computes the list of anatomical structures invalidated by changes to a given parameter set.
   */
  getInvalidatedStructures(changedKeys: string[]): Set<string> {
    const invalidated = new Set<string>();
    for (const key of changedKeys) {
      const meta = this.get(key);
      if (meta) {
        for (const item of meta.invalidates) invalidated.add(item);
      }
    }
    return invalidated;
  }

  /**
   * Produces a machine-readable coverage and audit report.
   */
  generateCoverageReport(): {
    totalRegistered: number;
    observableCount: number;
    conditionedPriorCount: number;
    latentPriorCount: number;
    discreteCount: number;
    renderOnlyCount: number;
  } {
    const all = this.getAll();
    return {
      totalRegistered: all.length,
      observableCount: all.filter(p => p.observability === 'observable').length,
      conditionedPriorCount: all.filter(p => p.observability === 'conditioned_prior').length,
      latentPriorCount: all.filter(p => p.observability === 'latent_prior').length,
      discreteCount: all.filter(p => p.observability === 'discrete').length,
      renderOnlyCount: all.filter(p => p.observability === 'render_only').length,
    };
  }
}

export const parameterRegistry = new ParameterRegistry();
