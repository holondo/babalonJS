/** Main movement/contour muscles added after the original priority regions. */
export const shoulderNeckMuscles = ['sternocleidomastoid', 'levator_scapulae', 'scalenus_anterior', 'scalenus_medius', 'scalenus_posterior', 'splenius_capitis', 'platysma', 'pectoralis_minor', 'subclavius', 'subscapularis', 'serratus_anterior', 'coracobrachialis', 'anconeus'] as const;
export const additionalLegMuscles = ['vastus_intermedius', 'adductor_magnus_hamstring', 'biceps_femoris_short', 'popliteus', 'plantaris', 'tibialis_posterior', 'fibularis_longus', 'fibularis_brevis', 'fibularis_tertius', 'extensor_digitorum_longus', 'extensor_hallucis_longus', 'flexor_digitorum_longus', 'flexor_hallucis_longus'] as const;
export const legMuscles = ['iliacus', 'rectus_femoris', 'vastus_lateralis', 'vastus_medialis', 'adductor_longus', 'adductor_brevis', 'adductor_magnus_adductor', 'pectineus', 'gracilis', 'biceps_femoris_long', 'semitendinosus', 'semimembranosus', 'gastrocnemius_medial', 'gastrocnemius_lateral', 'soleus', 'tibialis_anterior', ...additionalLegMuscles] as const;
export const axialMuscles = ['serratus_posterior_superior', 'serratus_posterior_inferior', 'spinalis', 'multifidus', 'quadratus_lumborum', 'pyramidalis', 'external_intercostals', 'internal_intercostals', 'diaphragm', 'piriformis', 'obturator_internus', 'obturator_externus', 'gemellus_superior', 'gemellus_inferior', 'quadratus_femoris'] as const;
export const backMuscles = ['trapezius_upper', 'trapezius_middle', 'trapezius_lower', 'latissimus_dorsi', 'erector_spinae_longissimus', 'erector_spinae_iliocostalis', 'rhomboid_minor', 'rhomboid_major', 'supraspinatus', 'infraspinatus', 'teres_minor', 'teres_major', 'spinalis', 'multifidus', 'serratus_posterior_superior', 'serratus_posterior_inferior', 'quadratus_lumborum', 'levator_scapulae', 'splenius_capitis'] as const;
export const posteriorMuscles = new Set<string>(backMuscles);
const backAliases: Record<string, string> = { trapezius_descending: 'trapezius_upper', trapezius_transverse: 'trapezius_middle', trapezius_ascending: 'trapezius_lower', erector_longissimus: 'erector_spinae_longissimus', erector_iliocostalis: 'erector_spinae_iliocostalis' };
/** Shared identity for posterior growth, genetics and skin transfer. */
export function backMeshTemplate(name: string) {
  const stem = name.replace(/_[LR](?:_.*)?$/, ''), template = backAliases[stem] ?? stem;
  return posteriorMuscles.has(template) ? template : undefined;
}
