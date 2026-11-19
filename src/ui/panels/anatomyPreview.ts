import { defaults } from '../../anatomy/parameters';
import type { AnatomyParameters } from '../../anatomy/parameters';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Illustrative silhouettes at a shared scale, including muscle and soft-tissue distribution. */
export function bodyIcon(values: Partial<AnatomyParameters>) {
  const p = { ...defaults, ...values };
  const fat = (p.fat - 12) / 16;
  const shoulder = clamp(p.shoulderWidth / 3.4 + (p.deltoid - 1), 9, 20);
  const chest = clamp(p.chestWidth / 3.6 + (p.pectoral - 1) * 1.5 + fat * .5, 7, 17);
  const waist = clamp(p.waistWidth / 4 + fat * p.flankFat, 5, 15);
  const hip = clamp(p.pelvisWidth / 3.5 + fat * .6, 8, 16);
  const thigh = clamp(p.thighGirth / 13 + (p.quadriceps - 1) * .8 + fat * p.thighFat * .3, 3, 7);
  const arm = clamp(2 + (p.biceps + p.triceps - 2) * .65 + fat * p.armFat * .3, 1.5, 4.5);
  const hipY = 49 - 5 * p.legBalance;
  const shoulderY = 20 + 2 * p.shoulderSlope;
  const chestDepth = p.chestDepth / 3.8 + (p.pectoral - 1) + fat * .3;
  const waistDepth = p.waistDepth / 4 + fat * p.lowerFat;
  const hipDepth = p.pelvisDepth / 4 + (p.gluteMax - 1) * .7 + fat * p.gluteFat * .3;
  const heightScale = p.height / 190;
  // A single shared scale keeps stature and limb proportions visible between cards.
  return `<svg viewBox="0 0 100 90" aria-hidden="true"><g transform="translate(0 ${85 * (1 - heightScale)}) scale(1 ${heightScale})">
    <circle cx="27" cy="8" r="6"/>
    <path d="M23 15 L${27 - shoulder} ${shoulderY}
      Q${24 - shoulder - arm} 33 ${25 - shoulder - arm} 48
      L${28 - shoulder} 49 L${30 - shoulder + arm} 29
      Q${27 - chest} 30 ${27 - waist} 39 L${27 - hip} ${hipY}
      Q${22 - thigh} 61 ${21 - thigh * .5} 79 L23 80 L27 57
      L31 80 L${33 + thigh * .5} 79 Q${32 + thigh} 61 ${27 + hip} ${hipY}
      L${27 + waist} 39 Q${27 + chest} 30 ${24 + shoulder - arm} 29
      L${26 + shoulder} 49 L${29 + shoulder + arm} 48
      Q${30 + shoulder + arm} 33 ${27 + shoulder} ${shoulderY} L31 15 Z"/>
    <g opacity=".65"><ellipse cx="77" cy="8" rx="5" ry="6"/>
      <path d="M74 14 Q${75 - chestDepth} 20 ${77 - chestDepth} 26
        Q${76 - chestDepth} 32 ${77 - waistDepth} 39 L${77 - hipDepth} ${hipY}
        Q${72 - thigh * .5} 63 72 79 L77 80 L80 57 L84 80 L89 79
        L${81 + hipDepth} ${hipY} Q${83 + waistDepth} 37 ${81 + chestDepth} 25 L80 14 Z"/>
    </g></g></svg>`;
}
