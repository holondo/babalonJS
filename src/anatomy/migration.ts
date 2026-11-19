/** Original FORMA / early babalon fields are accepted only when reading saved data. */
export const legacyParameters: Record<string, string> = {
  "packCount": "rectusSegmentCount",
  "packDefinition": "rectusSegmentDefinition",
  "rectBellyProfile": "rectusBellyProfile",
  "rectShift": "rectusIntersectionShift",
  "lineaAlba": "lineaAlbaDefinition",
  "pecClavicular": "pectoralClavicular",
  "pecSternal": "pectoralSternal",
  "pecCostal": "pectoralCostal",
  "pecSeparation": "pectoralSeparation",
  "pecFiberConvergence": "pectoralFiberConvergence",
  "pecTendonWidth": "pectoralTendonWidth",
  "visceralFat": "abdominalProjection",
  "lowerPooch": "lowerAbdominalFat",
  "loveHandles": "flankFullness",
  "iliacCrest": "iliacCrestRelief",
  "pubicPad": "suprapubicFat",
  "vOpening": "inguinalOpening",
  "vLength": "inguinalHeight",
  "vCurve": "inguinalCurvature",
  "vWrap": "inguinalLateralWrap",
  "vSharpness": "inguinalGrooveSharpness",
  "vRidge": "supraInguinalVolume",
  "vFoldOffset": "inguinalFoldOffset",
  "groove": "inguinalDefinition",
  "skinAlpha": "skinOpacity",
  "eoAlpha": "externalObliqueOpacity",
  "ioAlpha": "internalObliqueOpacity",
  "taAlpha": "transversusAbdominisOpacity",
  "rectAlpha": "rectusAbdominisOpacity",
  "otherAlpha": "otherMusclesOpacity",
  "fasciaAlpha": "aponeurosesOpacity",
  "boneAlpha": "bonesOpacity",
  "ligAlpha": "inguinalLigamentsOpacity"
};
export function migrateParameters(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object') return {};
  const out = { ...(input as Record<string, unknown>) };
  for (const [oldKey, key] of Object.entries(legacyParameters)) if (!(key in out) && oldKey in out) out[key] = out[oldKey];
  return out;
}
