/**
 * Body landmarks of a standing humanoid, read from horizontal sections of its surface.
 *
 * Input points are in the character's frame: `u` = across (its right), `v` = height above the
 * feet, `w` = forward. All distances scale with `height`, so the result doesn't depend on the
 * model's size, name or file.
 */

interface Section {
  /** Extent across (robust: ignores the few outermost points). */
  lo: number;
  hi: number;
  /** Middle of the section front to back. */
  depth: number;
}

export interface LegJunction {
  /** Height where the two legs join into one section. */
  split: number;
  /** Root of the skeleton (Hips joint), in the trunk above the hip pivots. */
  hips: { u: number; v: number; w: number };
  /** Hip pivot of each leg. */
  left: { u: number; v: number; w: number };
  right: { u: number; v: number; w: number };
}

/** Value at a fraction of the sorted values (sorts in place). */
function quantile(values: number[], fraction: number) {
  values.sort((a, b) => a - b);
  return values[Math.min(values.length - 1, Math.floor((values.length - 1) * fraction))];
}

/**
 * Where the legs join the trunk: the leg split, the hip pivots and the skeleton root above them.
 * The trunk's width profile above the split finds the hip line and the waist.
 */
export function findLegJunction(u: number[], v: number[], w: number[], height: number): LegJunction {
  const band = height * 0.009;

  /** Section of the body at a height (`side` ±1: only that leg, skipping a hand hanging next to it). */
  const section = (y: number, side = 0): Section | null => {
    let ids: number[] = [];
    for (let i = 0; i < u.length; i++) {
      if (Math.abs(v[i] - y) < band && Math.abs(u[i]) < height * 0.19 && (!side || u[i] * side > height * 0.01)) ids.push(i);
    }
    if (ids.length < 8) return null;
    if (side) {
      // Split the side into separate pieces across and keep the innermost one (the leg)
      ids.sort((a, b) => u[a] - u[b]);
      const pieces: number[][] = [];
      let start = 0;
      for (let j = 1; j <= ids.length; j++) {
        if (j === ids.length || u[ids[j]] - u[ids[j - 1]] > height * 0.012) {
          const piece = ids.slice(start, j);
          if (piece.length >= 8 && u[piece[piece.length - 1]] - u[piece[0]] > height * 0.015) pieces.push(piece);
          start = j;
        }
      }
      const center = (p: number[]) => Math.abs(u[p[0]] + u[p[p.length - 1]]);
      if (pieces.length) ids = pieces.reduce((a, b) => (center(a) < center(b) ? a : b));
    }
    return {
      lo: quantile(ids.map((i) => u[i]), 0.04),
      hi: quantile(ids.map((i) => u[i]), 0.96),
      depth: (quantile(ids.map((i) => w[i]), 0.1) + quantile(ids.map((i) => w[i]), 0.9)) / 2,
    };
  };

  // Leg split: the first height where the body bridges the middle line in several consecutive
  // sections (a single central vertex or a small surface detail doesn't count)
  let split = height * 0.44;
  let run = 0;
  for (let y = height * 0.3; y < height * 0.61; y += band) {
    const s = section(y);
    let central = 0;
    for (let i = 0; i < u.length; i++) if (Math.abs(v[i] - y) < band && Math.abs(u[i]) < height * 0.012) central++;
    run = s && s.lo < -height * 0.025 && s.hi > height * 0.025 && central >= 4 ? run + 1 : 0;
    if (run === 3) {
      split = y - 2 * band;
      break;
    }
  }

  // Width profile of the trunk above the split: widest at the hip line, then narrower at the waist
  const profile: { y: number; width: number; depth: number }[] = [];
  for (let y = split + height * 0.025; y < Math.min(height * 0.66, split + height * 0.2); y += band) {
    const s = section(y);
    if (s) profile.push({ y, width: s.hi - s.lo, depth: s.depth });
  }
  const lower = profile.filter((s) => s.y < split + height * 0.105);
  const widest = lower.reduce<(typeof profile)[number] | null>((best, s) => (!best || s.width > best.width ? s : best), null);
  const waist = widest
    ? profile.filter((s) => s.y > widest.y + height * 0.025).reduce<(typeof profile)[number] | null>((best, s) => (!best || s.width < best.width ? s : best), null)
    : null;

  // The widest section can be the surface just above the split: use it for height, not as the pivot
  const legHeight = Math.max(split + height * 0.065, Math.min(widest?.y ?? split + height * 0.075, split + height * 0.1));
  const hipsHeight = Math.max(legHeight + height * 0.025, widest && waist && waist.width < widest.width * 0.92 ? waist.y - height * 0.015 : split + height * 0.105);
  const pivotHeight = Math.max(legHeight, hipsHeight - height * 0.035);

  // Each leg: middle of its upper-thigh sections
  const leg = (side: number) => {
    const samples = [split - height * 0.035, split - height * 0.06, split - height * 0.085].map((y) => section(y, side)).filter((s): s is Section => s !== null);
    const across = samples.length ? samples.map((s) => (s.lo + s.hi) / 2) : [side * height * 0.055];
    const depth = samples.length ? samples.map((s) => s.depth) : [0];
    return { u: quantile(across, 0.5), v: pivotHeight, w: quantile(depth, 0.5) };
  };
  const hipsDepth = section(hipsHeight)?.depth ?? widest?.depth ?? 0;
  return { split, hips: { u: 0, v: hipsHeight, w: hipsDepth }, left: leg(-1), right: leg(1) };
}
