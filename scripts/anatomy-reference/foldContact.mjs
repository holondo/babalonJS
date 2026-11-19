// Positions are in authored anatomy units. A point is exposed if a camera
// ray from outside the body encounters it before reaching the skin.
export function auditFoldFaces(positions, indices, samples, inBand, exposure) {
  const depths = new Array(positions.length / 3);
  for (let v = 0; v < depths.length; v++) {
    const i = v * 3;
    if (inBand(positions[i], positions[i + 1])) depths[v] = exposure(positions.subarray(i, i + 3));
  }
  const tolerance = .02;
  const counts = { faces: 0, exposedFaces: 0, betweenVertices: 0, outsideSilhouetteFaces: 0, maxProjectedMm: 0 };
  for (let i = 0; i < indices.length; i += 3) {
    const face = [indices[i], indices[i + 1], indices[i + 2]];
    if (!face.some(v => depths[v])) continue;
    counts.faces++;
    let outside = false, between = false, silhouette = false;
    for (const weights of samples) {
      const point = [0, 1, 2].map(axis => face.reduce((sum, v, j) => sum + weights[j] * positions[v * 3 + axis], 0));
      if (!inBand(point[0], point[1])) continue;
      exposure(point).forEach((depth, view) => {
        if (depth <= tolerance) return;
        outside = true;
        if (face.every(v => depths[v] && depths[v][view] <= tolerance)) between = true;
        if (Number.isFinite(depth)) counts.maxProjectedMm = Math.max(counts.maxProjectedMm, Math.round(depth * 1000) / 10);
        else silhouette = true;
      });
    }
    if (outside) counts.exposedFaces++;
    if (between) counts.betweenVertices++;
    if (silhouette) counts.outsideSilhouetteFaces++;
  }
  return counts;
}
