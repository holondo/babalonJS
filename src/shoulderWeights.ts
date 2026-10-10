/** Experimental shoulder treatments, independent of the weight solver and model file. */
export type ShoulderStrategy = 'current' | 'protected' | 'helper';
export const SHOULDER_STRATEGIES: { value: ShoulderStrategy; label: string }[] = [
  { value: 'current', label: 'Direct weights' },
  { value: 'protected', label: 'Trunk protection' },
  { value: 'helper', label: 'Distributed rotation' },
];

export interface ShoulderInput {
  points: Float32Array;
  bones: Float32Array;
  armRoots?: Uint32Array;
  limbRootOf?: Int16Array;
  limbAxes?: Float32Array;
  torsoUp?: Float32Array;
  torsoBones?: Uint32Array;
}

const smooth = (t: number) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

function distanceSquared(bones: Float32Array, bone: number, x: number, y: number, z: number) {
  const k=bone*6, ax=bones[k+3]-bones[k], ay=bones[k+4]-bones[k+1], az=bones[k+5]-bones[k+2];
  const px=x-bones[k], py=y-bones[k+1], pz=z-bones[k+2];
  const t=Math.max(0,Math.min(1,(px*ax+py*ay+pz*az)/(ax*ax+ay*ay+az*az || 1e-8)));
  return (px-t*ax)**2+(py-t*ay)**2+(pz-t*az)**2;
}

/** Keeps the reference intact; helper indices are appended after the canonical bones. */
export function shoulderWeights(dense: Float32Array, input: ShoulderInput, strategy: ShoulderStrategy): Float32Array {
  const { points, bones, armRoots, limbRootOf, limbAxes, torsoUp, torsoBones } = input;
  if (strategy === 'current' || !armRoots || !limbRootOf || !limbAxes || !torsoUp || !torsoBones?.length) return dense;
  const B = bones.length / 6;
  const count = points.length / 3;
  const width = strategy === 'helper' ? B + armRoots.length : B;
  const out = new Float32Array(count * width);
  for (let i = 0; i < count; i++) out.set(dense.subarray(i * B, (i + 1) * B), i * width);
  for (let side = 0; side < armRoots.length; side++) {
    const root = armRoots[side], j = root * 6;
    const length = Math.max(1e-8, Math.hypot(bones[j+3]-bones[j],bones[j+4]-bones[j+1],bones[j+5]-bones[j+2]));
    const chain: number[] = [];
    for (let b = 0; b < B; b++) if (limbRootOf[b] === root) chain.push(b);
    for (let i = 0; i < count; i++) {
      const dx=points[i*3]-bones[j], dy=points[i*3+1]-bones[j+1], dz=points[i*3+2]-bones[j+2];
      const inward=-(dx*limbAxes[root*3]+dy*limbAxes[root*3+1]+dz*limbAxes[root*3+2]);
      const below=-(dx*torsoUp[0]+dy*torsoUp[1]+dz*torsoUp[2]);
      // A sloped boundary protects the lateral trunk below the armpit while leaving the arm outside.
      let fraction = strategy === 'protected'
        ? smooth((inward + Math.max(0,below)*.5)/(length*.12))
        : .7 * (1-smooth(Math.hypot(dx,dy,dz)/(length*.75)));
      if (fraction <= 0) continue;
      let target=torsoBones[0];
      if (strategy === 'protected') {
        const x=points[i*3], y=points[i*3+1], z=points[i*3+2];
        let trunkDistance=Infinity, armDistance=Infinity;
        for (const b of torsoBones) {
          const distance=distanceSquared(bones,b,x,y,z);
          if(distance<trunkDistance) { trunkDistance=distance; target=b; }
        }
        for (const b of chain) armDistance=Math.min(armDistance,distanceSquared(bones,b,x,y,z));
        // A lowered arm can occupy the same sloped region. Keep skin close to its own limb free.
        fraction *= smooth((4*armDistance-trunkDistance)/Math.max(3*armDistance,1e-12));
        if (fraction<=0) continue;
      }
      const row=i*width;
      let removed=0;
      for (const b of chain) { const amount=out[row+b]*fraction; out[row+b]-=amount; removed+=amount; }
      if (strategy === 'helper') { out[row+B+side]+=removed; continue; }
      // Transfer influence rather than just discarding it: even fully arm-weighted trunk gets a valid owner.
      out[row+target]+=removed;
    }
  }
  return out;
}
