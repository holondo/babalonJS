import type { AnatomyMesh } from './contracts';
import type { MuscleShape } from './definition';
import { calculateNormals } from './algorithms/loft';

export function envelopeBasis(u:number,v:number,visit:(index:number,weight:number)=>void,size=15){
  const [rows,cols]=size===45?[9,5]:[5,3];
  const x=Math.max(0,Math.min(cols-1.000001,v*(cols-1))),y=Math.max(0,Math.min(rows-1.000001,u*(rows-1))),a=Math.floor(x),b=Math.floor(y);
  const smooth=(t:number)=>t*t*(3-2*t),tx=smooth(x-a),ty=smooth(y-b);
  for(let j=0;j<2;j++)for(let i=0;i<2;i++)visit((b+j)*cols+a+i,(i?tx:1-tx)*(j?ty:1-ty));
}
export function envelopeWeight(mesh:AnatomyMesh,u:number){
  if(!mesh.attachments?.length)return u<=.000001||u>=.999999?0:Math.sin(Math.PI*u)**.7;
  let w=1;
  for(const a of mesh.attachments??[])w*=a.end==='start'?1-(1-u)**4:1-u**4;
  return w;
}
export function shiftedEnvelopeU(u: number, offset = 0) {
  return u - offset * Math.sin(Math.PI * u);
}
export function isCostalEnvelope(mesh: AnatomyMesh) {
  return mesh.anatomicalName?.startsWith('pectoralis_major_cost_') === true;
}
export function envelopeTravelLimit(id?: string) {
  return id?.startsWith('external_oblique.') ? .06 : .04;
}
/** Chart displacement of the outline warp at (u, v). Coefficients, in chart
 * units: [shift u, shift v, stretch u, stretch v, u-shift across v, v-shift along u].
 * Origin and insertion stay on their bones (whether or not the mesh carries
 * attachment patches): the warp fades toward u = 0 and u = 1, so only the
 * belly is reshaped. */
export function outlineDisplacement(c: readonly number[], u: number, v: number): [number, number] {
  const fade = Math.sqrt(Math.max(0, Math.sin(Math.PI * u)));
  return [(c[0] + c[2] * (u - .5) + c[4] * (v - .5)) * fade, (c[1] + c[3] * (v - .5) + c[5] * (u - .5)) * fade];
}
/** Slide a muscle over its own deep surface without changing its thickness.
 * Each vertex keeps its thickness and moves to the deep surface at the
 * displaced chart coordinate; beyond the template edge that surface is
 * extended a little (softly limited). The outline thus moves to where the skin shows the
 * muscle, and the thickness fit afterwards works on the right footprint. */
export function applyOutlineWarp(mesh: AnatomyMesh, warp: readonly number[]) {
  if (!mesh.shellPairs || !mesh.surfaceGrid || mesh.positions.length !== mesh.shellPairs * 6) return;
  const { rows, cols } = mesh.surfaceGrid, n = mesh.shellPairs, stride = cols + 1, source = mesh.positions.slice();
  // A straight extension leaves a curved deep surface quickly, so reading past
  // the template edge saturates softly at 5% of the chart.
  const soft = (t: number) => t < 0 ? -.05 * Math.tanh(-t / .05) : t > 1 ? 1 + .05 * Math.tanh((t - 1) / .05) : t;
  const sample = (layer: number, uRaw: number, vRaw: number, k: number) => {
    const u = soft(uRaw), v = soft(vRaw), x = v * cols, y = u * rows, i = Math.max(0, Math.min(cols - 1, Math.floor(x))), j = Math.max(0, Math.min(rows - 1, Math.floor(y))), tx = x - i, ty = y - j;
    const at = (jj: number, ii: number) => source[((jj * stride + ii) + layer * n) * 3 + k];
    return at(j, i) * (1 - tx) * (1 - ty) + at(j, i + 1) * tx * (1 - ty) + at(j + 1, i) * (1 - tx) * ty + at(j + 1, i + 1) * tx * ty;
  };
  for (let vertex = 0; vertex < n; vertex++) {
    const u = Math.floor(vertex / stride) / rows, v = (vertex % stride) / cols;
    const [du, dv] = outlineDisplacement(warp, u, v);
    if (Math.abs(du) < 1e-6 && Math.abs(dv) < 1e-6) continue;
    const a = vertex * 3, b = (vertex + n) * 3;
    const inner = [0, 1, 2].map(k => sample(1, u + du, v + dv, k)), outer = [0, 1, 2].map(k => sample(0, u + du, v + dv, k));
    const direction = outer.map((value, k) => value - inner[k]), length = Math.hypot(...direction);
    const thickness = Math.hypot(source[a] - source[b], source[a + 1] - source[b + 1], source[a + 2] - source[b + 2]);
    for (let k = 0; k < 3; k++) {
      mesh.positions[b + k] = inner[k];
      mesh.positions[a + k] = inner[k] + (length > 1e-9 ? direction[k] / length * thickness : source[a + k] - source[b + k]);
    }
  }
  mesh.normals = calculateNormals(mesh.positions, mesh.indices);
}

/** Grow the fitted belly along its paired thickness vectors. Taper out at
 * both attachment rows and bound the added thickness in tight recesses. */
export function growFittedShell(mesh: AnatomyMesh, gain: number, rate = .53, limit = .20) {
  const pairs = mesh.shellPairs, grid = mesh.surfaceGrid;
  if (!pairs || grid?.kind !== 'shell' || gain <= 1) return;
  const growth = rate * Math.log(gain), p = mesh.positions;
  for (let v = 0; v < pairs; v++) {
    const row = Math.floor(v / (grid.cols + 1));
    if (row === 0 || row === grid.rows) continue;
    const a = v * 3, b = (v + pairs) * 3;
    const thickness = Math.hypot(p[a] - p[b], p[a + 1] - p[b + 1], p[a + 2] - p[b + 2]);
    const taper = Math.sin(Math.PI * row / grid.rows) ** 1.1;
    const factor = taper * Math.min(growth, limit / Math.max(thickness, 1e-6));
    for (let k = 0; k < 3; k++) {
      const change = (p[a + k] - p[b + k]) * factor;
      p[a + k] += change * .7;
      p[b + k] -= change * .3;
    }
  }
  mesh.normals = calculateNormals(p, mesh.indices);
}
/** The deep shell and insertion borders are fixed. Extra volume is added along
 * each paired shell normal, rather than translating/scaling the entire muscle. */
export function applyMuscleEnvelope(mesh:AnatomyMesh,shape:MuscleShape,height:number,exposure?:(x:number,y:number)=>number){
  const profile = isCostalEnvelope(mesh) ? shape.costalDepthProfile ?? shape.depthProfile : shape.depthProfile;
  if(!profile||!mesh.shellPairs||!mesh.surfaceGrid)return;
  const {rows,cols}=mesh.surfaceGrid,n=mesh.shellPairs,f=[18/height,1.8/17.5,18/height];
  for(let vertex=0;vertex<n;vertex++){
    const u=Math.floor(vertex/(cols+1))/rows,v=(vertex%(cols+1))/cols;
    let gain=0;envelopeBasis(shiftedEnvelopeU(u, shape.peakOffset),v,(i,w)=>gain+=profile[i]*w,profile.length);
    const a=vertex*3,b=(vertex+n)*3,delta=[0,1,2].map(k=>(mesh.positions[a+k]-mesh.positions[b+k])*f[k]);
    const thickness=Math.hypot(...delta),change=Math.max(-.65,Math.min(19,gain-1))*envelopeWeight(mesh,u)*(exposure?.(mesh.positions[a],mesh.positions[a+1])??1),cap=Math.min(1,envelopeTravelLimit(mesh.anatomyId)/Math.max(.00001,Math.abs(change)*thickness));
    for(let k=0;k<3;k++)mesh.positions[a+k]+=delta[k]*change*cap/f[k];
  }
  mesh.normals=calculateNormals(mesh.positions,mesh.indices);
}
