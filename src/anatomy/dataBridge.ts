import data from './data/priorityRegions.json';
import type { MuscleTemplate } from './definition';

/** Coefficients are explicitly visual seeds, not measured anatomical section curves. */
export function priorityProfile(id: MuscleTemplate, u: number): number {
  const profile = data.profiles[id];
  u = Math.max(0, Math.min(1, u));
  for (let i = 1; i < profile.u.length; i++) if (u <= profile.u[i]) {
    let t = (u - profile.u[i - 1]) / (profile.u[i] - profile.u[i - 1]); t *= t * (3 - 2 * t);
    return profile.area[i - 1] + (profile.area[i] - profile.area[i - 1]) * t;
  }
  return profile.area.at(-1)!;
}
export const priorityDataVersion = data.version;
