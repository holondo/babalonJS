import type { AnatomyParameters } from './parameters';
import { muscleDefaults, type MuscleShape, type TendinousIntersection } from './definition';

interface AbdominalGenetics {
  label: string;
  width: number;
  gap: number;
  levels: number[];
  rightOffset?: number;
  angle?: number;
  curvature?: number;
  extent?: number;
  peak?: number;
  projection?: number;
}

/** Illustrative anatomical architectures, independent of training, stature and fat thickness. */
export const abdominalGenetics: Record<string, AbdominalGenetics> = {
  balanced: { label: 'Balanced abdominal rows', width: 5, gap: 1.5, levels: [.76, .59, .42], projection: 4 },
  elongated: { label: 'Long abdominal bellies', width: 4.8, gap: 1.1, levels: [.66, .34], peak: .55, projection: 5 },
  broad: { label: 'Broad abdominal bellies', width: 6.3, gap: .9, levels: [.77, .51], peak: .48, projection: 7 },
  compact: { label: 'Short abdominal bellies', width: 5.5, gap: 1.2, levels: [.82, .67, .52, .37], peak: .5, projection: 5 },
  staggered: { label: 'Staggered abdominal rows', width: 5.2, gap: 1.3, levels: [.78, .57, .36], rightOffset: -.04, angle: 7, projection: 6 },
  arched: { label: 'Arched abdominal intersections', width: 5.6, gap: 1.2, levels: [.76, .54, .33], curvature: .08, extent: .78, projection: 5 },
  narrow: { label: 'Narrow abdominal columns', width: 3.8, gap: 1, levels: [.78, .56, .34], peak: .6, projection: 5 },
  separated: { label: 'Wide abdominal separation', width: 4.8, gap: 3.2, levels: [.75, .52, .29], projection: 5 },
};

function segmentShapes(recipe: AbdominalGenetics, side: 'L' | 'R') {
  const intersections: TendinousIntersection[] = recipe.levels.map((position, i) => ({
    position: position + (side === 'R' ? recipe.rightOffset ?? 0 : 0),
    angle: (recipe.angle ?? 0) * (side === 'L' ? 1 : -1),
    curvature: recipe.curvature ?? 0, width: .9, depth: .65,
    extent: i === recipe.levels.length - 1 ? recipe.extent ?? 1 : 1,
  }));
  const bellies = Array.from({ length: intersections.length + 1 }, (_, i) => ({
    width: i === intersections.length ? .9 : i === 0 ? .95 : 1.06,
    peak: recipe.peak ?? .5,
    projection: i === intersections.length ? 2 : recipe.projection ?? 5,
  }));
  return { intersections, bellies };
}

/** Replace only the rectus architecture; preserve other muscles, pose, fitting and appearance. */
export function abdominalGeneticsParameters(p: AnatomyParameters, key: string): Partial<AnatomyParameters> {
  const recipe = abdominalGenetics[key];
  if (!recipe) return {};
  const definition = structuredClone(p.definition ?? { version: 1 as const, muscles: {}, bones: {} });
  for (const side of ['L', 'R'] as const) {
    const id = `rectus_abdominis.${side}` as const;
    const shape: MuscleShape = { ...muscleDefaults, ...definition.muscles[id] };
    Object.assign(shape, segmentShapes(recipe, side));
    delete shape.fittedIntersections;
    delete shape.fittedBellies;
    delete shape.fittedWidthProfile;
    definition.muscles[id] = shape;
  }
  return { definition, rectWidth: recipe.width, rectGap: recipe.gap };
}

export function selectedAbdominalGenetics(p: AnatomyParameters): string {
  return Object.entries(abdominalGenetics).find(([, recipe]) => {
    return p.rectWidth === recipe.width && p.rectGap === recipe.gap &&
      (['L', 'R'] as const).every(side => {
        const id = `rectus_abdominis.${side}` as const;
        const expected = segmentShapes(recipe, side);
        return JSON.stringify(p.definition?.muscles[id]?.intersections) === JSON.stringify(expected.intersections) &&
          JSON.stringify(p.definition?.muscles[id]?.bellies) === JSON.stringify(expected.bellies);
      });
  })?.[0] ?? '';
}
