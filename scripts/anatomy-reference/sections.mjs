// Horizontal triangle sections in canonical metres. Each segment stores x/z at both ends.
export function sections(positions, indices, heights) {
  const result = heights.map(() => []);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const min = Math.min(positions[a + 1], positions[b + 1], positions[c + 1]);
    const max = Math.max(positions[a + 1], positions[b + 1], positions[c + 1]);
    if (max <= heights[0] || min > heights.at(-1)) continue;
    for (let station = 0; station < heights.length && heights[station] < max; station++) {
      const y = heights[station];
      if (y < min) continue;
      const cut = result[station];
      for (const [start, end] of [[a, b], [b, c], [c, a]]) {
        const lo = positions[start + 1], hi = positions[end + 1];
        if ((lo <= y) === (hi <= y)) continue;
        const t = (y - lo) / (hi - lo);
        cut.push(positions[start] + t * (positions[end] - positions[start]),
          positions[start + 2] + t * (positions[end + 2] - positions[start + 2]));
      }
    }
  }
  return result;
}

export const heights = Array.from({ length: 23 }, (_, i) => .84 + i * .02);
const probes = Array.from({ length: 17 }, (_, i) => (i - 8) * .02);
const bands = { pelvis: [.84, .98], lowerAbdomen: [.98, 1.10], upperAbdomen: [1.10, 1.29] };

function frontAt(section, x) {
  let front = -Infinity;
  for (let i = 0; i < section.length; i += 4) {
    const [a, az, b, bz] = [section[i], section[i + 1], section[i + 2], section[i + 3]];
    if (x < Math.min(a, b) || x > Math.max(a, b)) continue;
    front = Math.max(front, a === b ? Math.max(az, bz) : az + (x - a) / (b - a) * (bz - az));
  }
  return front;
}

const mm = m => Math.round(m * 10000) / 10;

export function compareSections(target, skin, muscles) {
  const rows = heights.map((y, index) => {
    const samples = probes.map(x => {
      const observed = frontAt(target[index], x);
      const generated = frontAt(skin[index], x);
      const muscle = frontAt(muscles[index], x);
      return { x, observed, generated, muscle };
    });
    return { y, index, samples };
  });
  const summary = {};
  let worst = null;
  for (const [band, [min, max]] of Object.entries(bands)) {
    let matched = 0, missing = 0, absolute = 0, maxError = 0, outside = 0, maxOutside = 0;
    for (const row of rows.filter(({ y }) => y >= min - 1e-8 && y < max - 1e-8)) {
      for (const { x, observed, generated, muscle } of row.samples) {
        if (!Number.isFinite(observed)) continue;
        if (!Number.isFinite(generated)) { missing++; continue; }
        const error = Math.abs(generated - observed);
        absolute += error;
        matched++;
        maxError = Math.max(maxError, error);
        if (!worst || error > worst.error) worst = { index: row.index, y: row.y, x, error };
        const penetration = muscle - generated;
        if (penetration > .002) outside++;
        maxOutside = Math.max(maxOutside, penetration);
      }
    }
    summary[band] = { matched, missing, meanFrontMm: matched ? mm(absolute / matched) : null,
      maxFrontMm: matched ? mm(maxError) : null, muscleOutsideSkinSamples: outside, maxMuscleOutsideSkinMm: mm(maxOutside) };
  }
  if (!worst) throw Error('No matched anterior samples in the abdominal sections.');
  const reliefErrors = [];
  for (let i = 1; i < rows.length - 1; i++) {
    if (rows[i].y < 1.039 || rows[i].y > 1.241) continue;
    for (const [j, { x }] of rows[i].samples.entries()) {
      if (Math.abs(x) > .10) continue;
      const delta = [i - 1, i, i + 1].map(row => {
        const { generated, observed } = rows[row].samples[j];
        return generated - observed;
      });
      if (delta.every(Number.isFinite)) reliefErrors.push(Math.abs(delta[1] - (delta[0] + delta[2]) / 2));
    }
  }
  const abdominalRelief = { samples: reliefErrors.length,
    meanVerticalReliefErrorMm: reliefErrors.length ? mm(reliefErrors.reduce((sum, value) => sum + value, 0) / reliefErrors.length) : null };
  return { bands: summary, abdominalRelief, worst: { index: worst.index, yMm: mm(worst.y), xMm: mm(worst.x), errorMm: mm(worst.error) } };
}

export function sectionSvg(target, layers, { yMm, xMm, errorMm }) {
  const series = [
    ['GLB', '#20262e', target],
    ...Object.entries(layers).map(([name, lines]) => [name, ({
      skin: '#006ac6', adipose: '#a46700', bones: '#766948', rectusAbdominis: '#c52b35',
      externalOblique: '#972674', internalOblique: '#8c5666', transversusAbdominis: '#686595',
      aponeuroses: '#3a8160', inguinalLigaments: '#177d80',
    })[name], lines]),
  ].filter(([, , lines]) => lines.length);
  const paths = series.map(([, color, lines]) => {
    let path = '';
    for (let i = 0; i < lines.length; i += 4) {
      const point = j => `${(400 + lines[j] * 1400).toFixed(1)} ${(260 - lines[j + 1] * 1400).toFixed(1)}`;
      path += `M${point(i)}L${point(i + 2)}`;
    }
    return `<path d="${path}" stroke="${color}" fill="none" stroke-width="1.6"/>`;
  });
  const legend = series.map(([name, color], i) =>
    `<text x="${16 + (i % 4) * 195}" y="${486 + Math.floor(i / 4) * 20}" fill="${color}">${name}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="545" viewBox="0 0 800 545">
<rect width="800" height="545" fill="white"/>
<text x="16" y="25" font-family="sans-serif">Anterior ↑ · height ${yMm} mm · worst probe x ${xMm} mm · deviation ${errorMm} mm</text>
<defs><clipPath id="plot"><rect x="0" y="35" width="800" height="425"/></clipPath></defs>
<g clip-path="url(#plot)"><path d="M${400 + xMm * 1.4} 35V460" stroke="#999" stroke-dasharray="4 4"/>${paths.join('')}</g>
<g font-family="sans-serif" font-size="14">${legend.join('')}</g>
</svg>`;
}
