import data from './catalogue.json';
import type { AnatomyKey, AnatomyParameters } from './parameters';

export interface AnatomyControl {
  key: AnatomyKey; label: string; min: number; max: number; step: number;
  unitLabel: string; kind: 'geometry' | 'material' | 'light';
}
interface Profile { label: string; description?: string; abdomen?: string; genetics?: string; geneticSeed?: number; values: Partial<AnatomyParameters>; }
interface AnatomyCatalogue {
  controls: AnatomyControl[];
  layers: [AnatomyKey, string, string][];
  bodyPresets: Record<string, Profile>;
  profileComponents: Record<string, Record<string, Profile>>;
  inguinalPresetFields: AnatomyKey[];
  inguinalPresets: Record<string, Partial<AnatomyParameters> & { label: string }>;
  shapeRegions: Partial<Record<AnatomyKey, string>>;
}
export default data as unknown as AnatomyCatalogue;
