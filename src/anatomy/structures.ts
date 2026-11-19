import type { AnatomyKey } from './parameters';

/** Stable structure IDs own geometry, visibility and a single editable PBR material. */
export const structures = [
  { id: 'skin', label: 'Skin', group: 'Skin', opacity: 'skinOpacity', color: [.52, .34, .24], tissueType: 0 },
  { id: 'adipose', label: 'Subcutaneous fat', group: 'Fat', opacity: 'adiposeOpacity', color: [.88, .65, .25], tissueType: 8 },
  { id: 'externalOblique', label: 'External oblique', group: 'Muscles', opacity: 'externalObliqueOpacity', color: [.59, .27, .21], tissueType: 1 },
  { id: 'internalOblique', label: 'Internal oblique', group: 'Muscles', opacity: 'internalObliqueOpacity', color: [.51, .23, .18], tissueType: 2 },
  { id: 'transversusAbdominis', label: 'Transversus', group: 'Muscles', opacity: 'transversusAbdominisOpacity', color: [.40, .20, .16], tissueType: 3 },
  { id: 'rectusAbdominis', label: 'Rectus abdominis', group: 'Muscles', opacity: 'rectusAbdominisOpacity', color: [.63, .30, .23], tissueType: 4 },
  { id: 'otherMuscles', label: 'Other muscles', group: 'Muscles', opacity: 'otherMusclesOpacity', color: [.56, .25, .20], tissueType: 4 },
  { id: 'bones', label: 'Bones', group: 'Bones', opacity: 'bonesOpacity', color: [.78, .72, .58], tissueType: 6 },
  { id: 'aponeuroses', label: 'Aponeuroses', group: 'Connective tissue', opacity: 'aponeurosesOpacity', color: [.73, .68, .55], tissueType: 7 },
  { id: 'inguinalLigaments', label: 'Inguinal ligaments', group: 'Connective tissue', opacity: 'inguinalLigamentsOpacity', color: [.35, .62, .57], tissueType: 7 },
] satisfies { id: string; label: string; group: string; opacity: AnatomyKey; color: number[]; tissueType: number }[];
export type StructureId = typeof structures[number]['id'];
