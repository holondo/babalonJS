// @ts-nocheck
import { applyBoneProportions } from './segmentProportions';
// Numerical kernels adapted from the authored anatomy study and FORMA v5 update.
// Only the module worker imports the reference mesh and these kernels.
import HUMAN_DATA from "./reference.json";
import PELVIS from "./data/pelvisReference.json";
import PECTORAL from "./data/pectoralReference.json";
import { defaults, isOriginalAbdomen } from "./parameters";
import { priorityProfile } from "./dataBridge";
import { snapPectorals } from "./attachmentPatches";
import { atlas, directGrowthKeys } from "./atlas";
import { backMeshTemplate, posteriorMuscles } from './muscleGroups';
import { anatomySupportCache, supportParameterKey, supportMeshBytes } from './supportCache';
const PI = Math.PI;
const HUMAN_REST = defaults;
let LEGACY_SKIN_CACHE = null, HUMAN_BIND_ROWS = null, HUMAN_UNBIND_ROWS = null, HUMAN_BIND_PROFILE = null;
const HUMAN_INGUINAL_CACHE = new WeakMap();
function pelvicLoftDistance(section, x, z) { let center = mix(section.centerBack, section.centerFront, smooth(-.35, .55, z)), eps = .0001 + .025 * smooth(.05, .25, center), c = Math.hypot(center, eps), rx = Math.max(.18, Math.hypot(section.outer, eps) - c), rz = z >= section.z ? section.front : section.back, qx = (Math.hypot(x, eps) - c) / rx, qz = (z - section.z) / rz; return (Math.hypot(qx, qz) - 1) * Math.min(rx, rz); }
function buildLegacySurface(p) { let ignored = ['roughness', 'shine', 'texture', 'skinTone', 'azimuth', 'elevation', 'intensity', 'fill', 'rim', 'exposure', 'height'], key = JSON.stringify(Object.fromEntries(Object.entries(p).filter(([k]) => !k.endsWith('Opacity') && !ignored.includes(k)))); if (!LEGACY_SKIN_CACHE || LEGACY_SKIN_CACHE.key !== key)
    LEGACY_SKIN_CACHE = { key, mesh: warpMesh(p, polygonize(makeField(p), .10)) }; let m = LEGACY_SKIN_CACHE.mesh; return { positions: m.positions.slice(), normals: m.normals.slice(), indices: m.indices.slice() }; }
function makeField(p) {
    let a = anatomy(p), shapes = [], upper = upperMuscles(p, 1), lower = lowerMuscles(p, 1), pecCache = new Map(), ankleTendons = lower.filter(m => ['tibialisAnterior', 'fibularisLongus', 'extensorDigitorum'].includes(m.name)).map(m => ({ A: m.c.map((v, k) => v + m.axes[1][k] * m.r[1]), B: m.insertion }));
    for (let m of [...upper, ...lower]) {
        let region = m.lower ? (m.name.startsWith('gluteus') ? p.gluteFat || 0 : m.c[1] > 5.3 ? p.thighFat || 0 : 1) : m.c[1] < 13 ? p.armFat || 0 : 1, cov = .055 + p.fat / 220 * region;
        m.deep = ['rhomboids', 'infraspinatus', 'supraspinatus', 'teresMinor', 'subscapularis', 'pectoralisMinor', 'subclavius', 'gluteusMinimus', 'piriformis', 'obturatorInternus', 'quadratusFemoris', 'iliacus', 'adductorBrevis', 'popliteus', 'levatorScapulae'].includes(m.name);
        m.coveredR = m.r.map((r, i) => r + (i === 1 ? .035 : cov * (m.deep ? .4 : 1)));
        m.bounds = [0, 1, 2].map(k => m.coveredR.reduce((sum, r, i) => sum + Math.abs(m.axes[i][k]) * r, 0) + .22);
    }
    function ell(c, r, k = .18) { shapes.push({ c, r, inv: r.map(v => 1 / v), k }); }
    function chain(points, radii, k = .18) { for (let i = 0; i < points.length; i++)
        ell(points[i], radii[i], k); }
    ell([0, 15.1, -.01], [.53, .79, .51], .30);
    ell([0, 16.5, -.09], [.75, 1.0, .92], .18);
    ell([0, 15.95, .12], [.60, .54, .70], .20);
    // Anterior pubic soft tissue sits in front of the recessed perineal bridge.
    // Its placement follows the pubis; adipose changes thickness rather than moving the crotch roof.
    ell([0, a.pubis + .30, .34], [.42 + p.fat * p.pubicFat / 650, .52, .55 + p.fat * p.pubicFat / 850], .14);
    for (let side of [-1, 1]) {
        let S = v => [side * v[0], v[1], v[2]], hip = .85 + (p.pelvisWidth - 35) / 65 + (a.asis - 1.3) * .2 + p.flare / 100, thigh = p.thighGirth / (20 * PI), sh = a.shoulder;
        // Gluteal mass is supplied by the shared gluteus maximus/medius descriptors.
        // Thin envelopes over the same patellar/elbow landmarks used by the skeleton.
        let jointCover = .035 + p.fat / 850;
        ell([side * a.knee[0], a.knee[1], .35], [.13 + jointCover, .17 + jointCover, .075 + jointCover], .055);
        ell([side * a.elbow[0], a.elbow[1], a.elbow[2] - .25], [.13 + jointCover, .18 + jointCover, .10 + jointCover], .055);
        ell([side * .90, .36, .36], [.47, .34, 1.16], .18);
        ell([side * .90, .55, -.24], [.35, .45, .52], .15);
        // The deltoid envelope is generated from its three anatomical portions below.
        ell([side * (sh + 1.36), 8.35, .04], [.32, .59, .18], .18);
    }
    let profiles = [];
    for (let y = 6.0; y < 14.91; y += .035)
        profiles.push(profile(p, y));
    let thigh = p.thighGirth / (20 * PI), hip = .85 + (p.pelvisWidth - 35) / 65 + (a.asis - 1.3) * .2 + p.flare / 100;
    let legProfile = [[.5, .27, .30, .90, -.04], [1.05, .30, .33, .90, -.04], [1.8, .32, .35, .91, -.04], [2.6, .28, .29, .92, -.07], [3.6, .30, .31, .92, -.06], [4.35, .33, .33, .88, -.01], [4.95, .36, .37, .86, .04], [5.7, .43, .46, .85, .02], [6.7, thigh * .56, thigh * .57, .85, 0], [7.6, thigh * .61, thigh * .60, hip, .02], [8.25, thigh * .76, thigh * .75, hip, .04], [8.8 + p.asisHeight / 25, thigh * .77, thigh * .84 + .10 * p.proximalThigh, hip, .10 * p.proximalThigh], [9.5, .37, .48 + .04 * p.proximalThigh, hip, .02 * p.proximalThigh]];
    let sh = a.shoulder, armProfile = [[8.45, .23, .23, sh + 1.34, .03], [8.9, .23, .25, sh + 1.30, .03], [9.55, .30, .31, sh + 1.21, .03], [10.3, .25, .24, sh + 1.10, .02], [11.15, .31, .32, sh + .95, .015], [11.9, .27, .25, sh + .83, 0], [12.7, .29, .27, sh + .66, 0], [13.5, .34, .31, sh + .24, -.015], [14.15, .32, .33, sh, -.02]];
    const loftLow = a.pubis - 1.30, loftHigh = a.crest + .38, loftSamples = [];
    for (let y = loftLow - .1; y <= loftHigh + .12; y += .025)
        loftSamples.push(pelvicLoftProfile(p, y));
    const legSamples = [], armSamples = [];
    for (let y = .5; y <= 9.51; y += .025)
        legSamples.push(interpolate(legProfile, y));
    for (let y = 8.45; y <= 14.16; y += .025)
        armSamples.push(interpolate(armProfile, y));
    function limb(x, y, z, samples, low, high) { let ii = clamp((y - low) / .025, 0, samples.length - 1), i = Math.floor(ii), pr = samples[i], nx = samples[Math.min(i + 1, samples.length - 1)], t = ii - i, rx = mix(pr[0], nx[0], t), rz = mix(pr[1], nx[1], t), cx = mix(pr[2], nx[2], t), cz = mix(pr[3], nx[3], t); return Math.max((Math.hypot((Math.abs(x) - cx) / rx, (z - cz) / rz) - 1) * Math.min(rx, rz), low - y, y - high); }
    const field = function field(x, y, z) {
        let origY = y;
        if (y > 7.15 && y < 12.1 && p.tilt) {
            let v = unpelvic(p, x, y, z);
            x = v[0];
            y = v[1];
            z = v[2];
        }
        let d = 100;
        if (y > 6.0 && y < 15.4) {
            let ii = clamp((y - 6.0) / .035, 0, profiles.length - 1), i = Math.floor(ii), t = ii - i, pr = profiles[i], n = profiles[Math.min(i + 1, profiles.length - 1)], rx = mix(pr[0], n[0], t), rz = z >= 0 ? mix(pr[1], n[1], t) : mix(pr[2], n[2], t);
            let exponent = torsoExponent(y, p), rad = (Math.abs(x / rx) ** exponent + Math.abs(z / rz) ** exponent) ** (1 / exponent);
            d = Math.max((rad - 1) * Math.min(rx, rz), 8.0 + (a.pubis - 8.55) - y, y - 14.9);
            if (rad > .5 && Math.abs(x) < rx + .1)
                d -= relief(p, x, y, z);
        }
        if (y > .1 && y < 10.0)
            d = smin(d, limb(x, y, z, legSamples, .5, 9.5), .14 + .17 * G(y - 8.6, .9) * (.35 + .65 * smooth(.35, 1.1, Math.abs(x))));
        if (y > loftLow && y < loftHigh) {
            let sample = clamp((y - (loftLow - .1)) / .025, 0, loftSamples.length - 1), j = Math.floor(sample), u = sample - j, A = loftSamples[j], B = loftSamples[Math.min(j + 1, loftSamples.length - 1)], section = {};
            for (let key of ['center', 'centerFront', 'centerBack', 'outer', 'front', 'back', 'z'])
                section[key] = mix(A[key], B[key], u);
            let core = pelvicLoftDistance(section, x, z);
            core -= relief(p, x, y, z) * smooth(a.pubis - .25, a.pubis + .25, y);
            let weight = smooth(loftLow, loftLow + .40, y) * (1 - smooth(loftHigh - .42, loftHigh, y));
            d = mix(d, core, weight);
        }
        if (y > 8.0 && y < 14.65)
            d = smin(d, limb(x, y, z, armSamples, 8.45, 14.15), .22 - .13 * G(y - 12.85, .65));
        // The same fan and oriented bellies used by the internal meshes displace skin.
        if (y > 11.9 && y < 14.35) {
            let rawU = (Math.abs(x) - .10) / (a.shoulder + .33);
            if (rawU > -.5 && rawU < 1.5) {
                let u = clamp(rawU, 0, 1), key = Math.abs(x), c = pecCache.get(key);
                if (!c) {
                    c = pectoralSection(p, u);
                    c.base = pectoralBase(p, c.x, c.y);
                    c.bases = new Map();
                    pecCache.set(key, c);
                }
                let cz = c.bases.get(y);
                if (cz === undefined) {
                    cz = c.z + (pectoralBase(p, c.x, y) - c.base) * (1 - smooth(.7, 1, u));
                    c.bases.set(y, cz);
                }
                let cover = .055 + p.fat / 180, ry = c.ry + cover, rz = c.rz + cover, fan = (Math.hypot((y - c.y) / ry, (z - cz) / rz) - 1) * Math.min(ry, rz);
                fan = Math.max(fan, .07 - Math.abs(x), Math.abs(x) - (a.shoulder + .44));
                d = smin(d, fan, mix(.17, .065, smooth(.55, 1, u)));
            }
        }
        if (y > 8.5 && y < 16.1) {
            for (let m of upper) {
                let dx = Math.abs(x) - m.c[0], dy = y - m.c[1], dz = z - m.c[2];
                if (Math.abs(dy) > m.bounds[1] || Math.abs(dx) > m.bounds[0] || Math.abs(dz) > m.bounds[2])
                    continue;
                d = smin(d, muscleDistance(m, dx, dy, dz), attachmentBlend(m, dx, dy, dz, p));
            }
        }
        if (y > .7 && y < 10.6) {
            for (let m of lower) {
                let dx = Math.abs(x) - m.c[0], dy = y - m.c[1], dz = z - m.c[2];
                if (Math.abs(dy) > m.bounds[1] || Math.abs(dx) > m.bounds[0] || Math.abs(dz) > m.bounds[2])
                    continue;
                d = smin(d, muscleDistance(m, dx, dy, dz), attachmentBlend(m, dx, dy, dz, p));
            }
        }
        if (y > .25 && y < 2.4) {
            for (let tendon of ankleTendons) {
                let ax = Math.abs(x) - tendon.A[0], ay = y - tendon.A[1], az = z - tendon.A[2], vx = tendon.B[0] - tendon.A[0], vy = tendon.B[1] - tendon.A[1], vz = tendon.B[2] - tendon.A[2], t = clamp((ax * vx + ay * vy + az * vz) / (vx * vx + vy * vy + vz * vz), 0, 1), v = Math.hypot(ax - t * vx, ay - t * vy, az - t * vz) - (.13 + p.fat / 650);
                d = smin(d, v, .25);
            }
        }
        for (let s of shapes) {
            let dy = y - s.c[1];
            if (Math.abs(dy) > s.r[1] + .6)
                continue;
            let dx = (x - s.c[0]) * s.inv[0], yy = dy * s.inv[1], zz = (z - s.c[2]) * s.inv[2], k0 = Math.hypot(dx, yy, zz), k1 = Math.hypot(dx * s.inv[0], yy * s.inv[1], zz * s.inv[2]);
            let v = k0 * (k0 - 1) / (k1 || 1);
            d = smin(d, v, s.k);
        }
        d -= thighRelief(p, x, y, z);
        let posterior = smooth(.20, .75, -z) * Math.exp(-p.fat / 30);
        d += posterior * (.085 * G(x, .12) * G(y - 8.66, .64) + .023 * G(y - (7.99 + .16 * (Math.abs(x) - .8) + .10 * (p.gluteMax - 1)), .16) * G(Math.abs(x) - .72, .44));
        return d;
    };
    field.xExtent = Math.max(4.15, a.shoulder + 2.05, Math.max(p.chestWidth, p.waistWidth, p.pelvisWidth) / 20 + Math.max(0, a.asis - 1.3) * .72 + Math.max(0, p.fat * p.flankFat / 100 - .12) * 1.10 + .5);
    field.zExtent = Math.max(2.02, p.waistDepth / 20 + Math.max(0, p.fat * p.lowerFat / 100 - .12) * 1.75 + .45, p.pelvisDepth / 20 + Math.max(0, p.fat * p.flankFat / 100 - .12) * .55 + .45, p.pelvisDepth / 20 + Math.max(0, p.fat * p.pubicFat / 100 - .12) * .90 + .45);
    return field;
}
function polygonize(field, step = .10, sampleCache = null, updateRange = null) {
    let xExt = field.xExtent || 4.15, zExt = field.zExtent || 2.02;
    if (!field.box)
        step = Math.max(step, Math.ceil(Math.cbrt((2 * xExt) * (2 * zExt) * 18.1 / 1500000) / .005) * .005);
    let ext = Math.max(2.02, Math.ceil(zExt / step) * step), lo = field.box ? field.box.lo : [-xExt, -.24, -ext], hi = field.box ? field.box.hi : [xExt, 17.82, ext + .02], nx = Math.ceil((hi[0] - lo[0]) / step) + 1, ny = Math.ceil((hi[1] - lo[1]) / step) + 1, nz = Math.ceil((hi[2] - lo[2]) / step) + 1, N = nx * ny * nz, spec = [step, nx, ny, nz, ...lo].join(','), sameGrid = sampleCache?.spec === spec && sampleCache?.F?.length === N, F = sameGrid ? sampleCache.F : new Float32Array(N), stride = nx * ny;
    if (!sameGrid)
        updateRange = null;
    const index = (x, y, z) => x + nx * y + stride * z;
    let jStart = updateRange ? Math.max(0, Math.floor((updateRange[0] - lo[1]) / step) - 1) : 0, jEnd = updateRange ? Math.min(ny, Math.ceil((updateRange[1] - lo[1]) / step) + 2) : ny;
    for (let k = 0; k < nz; k++)
        for (let j = jStart; j < jEnd; j++)
            for (let i = 0; i < nx; i++)
                F[index(i, j, k)] = field(lo[0] + i * step, lo[1] + j * step, lo[2] + k * step);
    if (sampleCache) {
        sampleCache.F = F;
        sampleCache.spec = spec;
        sampleCache.reused = !!updateRange;
    }
    let pos = [], normal = [], idx = [], cache = new Map();
    function point(id) { let k = Math.floor(id / stride), r = id - k * stride, j = Math.floor(r / nx), i = r - j * nx; return [lo[0] + i * step, lo[1] + j * step, lo[2] + k * step]; }
    function grad(id) { let k = Math.floor(id / stride), r = id - k * stride, j = Math.floor(r / nx), i = r - j * nx; return [F[id + (i < nx - 1 ? 1 : 0)] - F[id - (i > 0 ? 1 : 0)], F[id + (j < ny - 1 ? nx : 0)] - F[id - (j > 0 ? nx : 0)], F[id + (k < nz - 1 ? stride : 0)] - F[id - (k > 0 ? stride : 0)]]; }
    function edge(a, b) { if (a > b)
        [a, b] = [b, a]; let key = a * N + b; if (cache.has(key))
        return cache.get(key); let t = F[a] / (F[a] - F[b]), A = point(a), B = point(b), gA = grad(a), gB = grad(b), id = pos.length / 3; pos.push(...A.map((v, i) => mix(v, B[i], t))); normal.push(...unit(gA.map((v, i) => mix(v, gB[i], t)))); cache.set(key, id); return id; }
    function triangle(a, b, c) { let A = pos.slice(a * 3, a * 3 + 3), B = pos.slice(b * 3, b * 3 + 3), C = pos.slice(c * 3, c * 3 + 3), n = normal.slice(a * 3, a * 3 + 3); if (dot(cross(sub(B, A), sub(C, A)), n) < 0)
        [b, c] = [c, b]; idx.push(a, b, c); }
    let tets = [[0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6]];
    for (let k = 0; k < nz - 1; k++)
        for (let j = 0; j < ny - 1; j++)
            for (let i = 0; i < nx - 1; i++) {
                let b = index(i, j, k), vs = [b, b + 1, b + 1 + nx, b + nx, b + stride, b + stride + 1, b + stride + 1 + nx, b + stride + nx], neg = 0;
                for (let v of vs)
                    if (F[v] < 0)
                        neg++;
                if (neg === 0 || neg === 8)
                    continue;
                for (let tet of tets) {
                    let inside = [], outside = [];
                    for (let v of tet)
                        (F[vs[v]] < 0 ? inside : outside).push(vs[v]);
                    if (inside.length === 0 || inside.length === 4)
                        continue;
                    if (inside.length === 1 || inside.length === 3) {
                        if (inside.length === 3)
                            [inside, outside] = [outside, inside];
                        triangle(edge(inside[0], outside[0]), edge(inside[0], outside[1]), edge(inside[0], outside[2]));
                    }
                    else {
                        let a = edge(inside[0], outside[0]), b = edge(inside[0], outside[1]), c = edge(inside[1], outside[1]), d = edge(inside[1], outside[0]);
                        triangle(a, b, c);
                        triangle(a, c, d);
                    }
                }
            }
    return { positions: new Float32Array(pos), normals: new Float32Array(normal), indices: new Uint32Array(idx) };
}
const smin = (a, b, k) => { let h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * .25; };
function thighRelief(p, x, y, z) {
    if (y < 7.25 || y > 9.9 || z < .05)
        return 0;
    let a = Math.abs(x), fade = smooth(7.25, 7.65, y) * (1 - smooth(9.5, 9.9, y)) * smooth(.10, .65, z), fat = Math.exp(-p.fat / 18), asis = anatomy(p).asis, along = clamp((y - 5.1) / (9.68 + p.asisHeight / 10 - 5.1), 0, 1), sartorius = mix(.62, asis, along);
    return fade * fat * (.033 * G(a - sartorius, .095) + .042 * G(a - (asis + .18), .18) * G(y - 8.85, .56) + .040 * G(a - .39, .23) * G(y - 7.9, .75) + .065 * p.proximalThigh * G(a - .88, .27) * G(y - 8.35, .8));
}
function muscleDistance(m, dx, dy, dz) { let co = m.axes.map(ax => dx * ax[0] + dy * ax[1] + dz * ax[2]), r = m.coveredR, n = m.name === 'gluteusMaximus' ? 2.15 : m.name.startsWith('deltoid') ? 2.2 : 2; if (m.name === 'gluteusMaximus') {
    let t = clamp(co[1] / r[1], -1, 1);
    r = [r[0] * (1 + .05 * t), r[1], r[2] * (1 - .04 * t)];
} let v = co.map((c, i) => Math.abs(c / r[i])), rad = (v[0] ** n + v[1] ** n + v[2] ** n) ** (1 / n), grad = Math.hypot(v[0] ** (n - 1) / r[0], v[1] ** (n - 1) / r[1], v[2] ** (n - 1) / r[2]); return (rad - 1) * rad ** (n - 1) / (grad || 1); }
function attachmentBlend(m, dx, dy, dz, p) { let t = Math.abs((dx * m.axes[1][0] + dy * m.axes[1][1] + dz * m.axes[1][2]) / m.coveredR[1]), belly = 1 - smooth(.55, 1, t), base = m.deep ? .025 : m.name.startsWith('gluteus') ? .12 : m.name.startsWith('deltoid') ? .10 : .085, fat = clamp(p.fat / 45, 0, 1); return base * mix(.38, 1, belly) * mix(.80, 1.35, fat); }
function bodyWarp(p, v) { return [v[0], bodyWarpY(p, v[0], v[1]), v[2]]; }
function inverseBodyWarp(p, v) { let y = v[1]; for (let i = 0; i < 6; i++) {
    let residual = bodyWarpY(p, v[0], y) - v[1], derivative = (bodyWarpY(p, v[0], y + .001) - bodyWarpY(p, v[0], y - .001)) / .002;
    y -= residual / Math.max(.3, derivative);
} return [v[0], y, v[2]]; }
function warpMesh(p, m) { if (!(p.legBalance || p.shoulderSlope))
    return m; for (let i = 0; i < m.positions.length; i += 3) {
    let x = m.positions[i], y = m.positions[i + 1], dy = (bodyWarpY(p, x, y + .001) - bodyWarpY(p, x, y - .001)) / .002, dx = (bodyWarpY(p, x + .001, y) - bodyWarpY(p, x - .001, y)) / .002, ny = m.normals[i + 1] / dy, n = unit([m.normals[i] - ny * dx, ny, m.normals[i + 2]]);
    m.positions[i + 1] = bodyWarpY(p, x, y);
    m.normals.set(n, i);
} return m; }
function spindle(path, r) { return tube(curve(path, 42), t => .024 + r * Math.sin(PI * t) ** .70, 22); }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mix = (a, b, t) => a + (b - a) * t;
const G = (x, s) => Math.exp(-((x / s) ** 2));
const smooth = (a, b, x) => { let t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const mul = (a, s) => a.map(v => v * s);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = v => mul(v, 1 / (Math.hypot(...v) || 1));
function anatomy(p) { let f = p.fat / 100, hip = p.pelvisWidth / 20, shoulder = p.shoulderWidth / 20 - .57, asis = Math.max(.65, (p.asisDistance / 20 + p.flare / 10 * .65) * p.inguinalOpening), crest = 9.8 + p.asisHeight / 10, pubis = clamp(crest - .12 - p.inguinalHeight / 10 + p.pubisHeight / 10, 7.45, Math.min(9.05, crest - .12 - .55)); return { f, hip, shoulder, asis, crest, pubis, hipJoint: [.82 + (p.pelvisWidth - 35) / 60 + (asis - 1.3) * .16, 8.85 + p.asisHeight / 40, -.04], shoulderJoint: [shoulder, 13.95, -.03], elbow: [shoulder + .95, 11.15, .015], wrist: [shoulder + 1.30, 8.86, .03], knee: [.86, 4.95, .045], ankle: [.90, .93, -.04] }; }
function inguinalLandmarks(p, side = 1) { let a = anatomy(p), sideFactor = 1; let h = a.crest - .12 - a.pubis; return { bottom: [side * .12, a.pubis, .84], top: [side * a.asis * sideFactor, a.crest - .12, .62], curve: p.inguinalCurvature, wrap: p.inguinalLateralWrap - .35, sag: clamp(.07 * p.inguinalCurvature, -h * .12, h * .12), fold: Math.min(p.inguinalFoldOffset / 10, h * .20) }; }
function inguinalPathPoint(p, t, side = 1, fold = false) { let m = inguinalLandmarks(p, side), sn = Math.sin(PI * t), x = mix(Math.abs(m.bottom[0]), Math.abs(m.top[0]), t) + (.18 * m.curve + .09 * m.wrap) * sn, y = mix(m.bottom[1], m.top[1], t) - m.sag * sn, z = mix(m.bottom[2], m.top[2], t) + (.075 - .12 * m.wrap) * sn; if (fold)
    y -= m.fold * (.45 + .55 * sn); return [side * x, y, z]; }
function inguinalLocalThickness(p, t) { return p.fat * (.30 + .35 * p.lowerFat * G(t - .45, .5) + .40 * p.flankFat * t * t + .65 * p.pubicFat * (1 - t) ** 2); }
function inguinalRelief(p, x, y) {
    let side = x < 0 ? -1 : 1, m = inguinalLandmarks(p, side), h = m.top[1] - m.bottom[1], raw = (y - m.bottom[1] + m.fold * .7) / h;
    if (raw < -.15 || raw > 1.15)
        return 0;
    let t = clamp(raw, 0, 1);
    for (let i = 0; i < 2; i++) {
        let sn = Math.sin(PI * t), cs = Math.cos(PI * t), py = mix(m.bottom[1], m.top[1], t) - m.sag * sn - m.fold * (.45 + .55 * sn), der = h - (m.sag + m.fold * .55) * PI * cs;
        t = clamp(t - (py - y) / der, 0, 1);
    }
    let sn = Math.sin(PI * t), cs = Math.cos(PI * t), cx = mix(Math.abs(m.bottom[0]), Math.abs(m.top[0]), t) + (.18 * m.curve + .09 * m.wrap) * sn, dx = Math.abs(m.top[0]) - Math.abs(m.bottom[0]) + (.18 * m.curve + .09 * m.wrap) * PI * cs, dy = h - (m.sag + m.fold * .55) * PI * cs, d = (Math.abs(x) - cx) / Math.sqrt(1 + (dx / dy) ** 2), coverage = inguinalLocalThickness(p, t), atten = Math.exp(-coverage / 15), width = .045 + .08 * (1 - p.inguinalGrooveSharpness) + coverage * .0016;
    let endFade = smooth(-.03, .07, raw) * (1 - smooth(.93, 1.04, raw)), depth = p.inguinalDefinition * (.035 + .085 * p.inguinalGrooveSharpness) * atten, ridge = p.supraInguinalVolume * (.025 + .055 * p.oblique) * atten * (1 + side * p.asym);
    return endFade * (ridge * G(d + .105, .13 + coverage * .0018) - depth * G(d, width) + ridge * .22 * G(d - .16, .20));
}
function bodyWarpY(p, x, y) { let leg = (p.legBalance || 0) * .65 * smooth(.9, 8.85, y) * (1 - smooth(8.85, 16, y)), shoulder = -(p.shoulderSlope || 0) * .22 * smooth(.35, p.shoulderWidth / 20 + .63, Math.abs(x)) * G(y - 14, 1.05); return y + leg + shoulder; }
function interpolate(points, y) { let i = 0; while (i < points.length - 2 && y > points[i + 1][0])
    i++; let A = points[i], B = points[i + 1], P = points[Math.max(0, i - 1)], Q = points[Math.min(points.length - 1, i + 2)], h = B[0] - A[0], t = clamp((y - A[0]) / h, 0, 1), out = []; for (let k = 1; k < A.length; k++) {
    let m0 = (B[k] - P[k]) / (B[0] - P[0]), m1 = (Q[k] - A[k]) / (Q[0] - A[0]);
    out.push((2 * t * t * t - 3 * t * t + 1) * A[k] + (t * t * t - 2 * t * t + t) * h * m0 + (-2 * t * t * t + 3 * t * t) * B[k] + (t * t * t - t * t) * h * m1);
} return out; }
function pelvic(p, v) { let a = p.tilt * PI / 180, w = 1 - smooth(10, 12, v[1]); if (v[1] < 8.1)
    w *= smooth(7.1, 8.1, v[1]); a *= w; let y = v[1] - 8.85, z = v[2]; return [v[0], 8.85 + y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)]; }
function unpelvic(p, x, y, z) { let a = -p.tilt * PI / 180 * (1 - smooth(10, 12, y)); if (y < 8.1)
    a *= smooth(7.1, 8.1, y); let yy = y - 8.85; return [x, 8.85 + yy * Math.cos(a) - z * Math.sin(a), yy * Math.sin(a) + z * Math.cos(a)]; }
function profile(p, y) {
    let a = anatomy(p);
    let points = [[8.0 + (a.pubis - 8.55), .28, .45, .61], [8.4 + (a.pubis - 8.55) * 2 / 3, .68, .79, .94], [8.8 + (a.pubis - 8.55) * .4, a.hip * .78, p.pelvisDepth / 20 * .77, p.pelvisDepth / 20 * .92], [9.25 + p.asisHeight / 18, a.hip * .95, p.pelvisDepth / 20 * .92, p.pelvisDepth / 20], [9.75 + p.asisHeight / 10, a.hip * .94, 1.13, 1.10], [10.45, p.waistWidth / 20, p.waistDepth / 20, p.waistDepth / 20 * .94], [11.15, p.waistWidth / 20 + .05, p.waistDepth / 20 * .99, p.waistDepth / 20 * .98], [12.15, p.chestWidth / 20 * .96, p.chestDepth / 20 * .99, p.chestDepth / 20 * .96], [12.85, p.chestWidth / 20, p.chestDepth / 20, p.chestDepth / 20], [13.5, p.chestWidth / 20 * .99, p.chestDepth / 20 * .92, p.chestDepth / 20 * .95], [14.05, a.shoulder * .89, .86, .91], [14.6, .70, .58, .60], [14.9, .52, .49, .50]];
    let [rx, front, back] = interpolate(points, y);
    rx += .16 * (p.ribFlare || 0) * G(y - 11.95, .60);
    front += .075 * (p.ribFlare || 0) * G(y - 12.0, .65);
    let adip = p.fat / 100, delta = (p.fat - 12) / 100;
    rx += ((a.asis - 1.3) * .72 + p.flare / 10 * .85) * G(y - (a.crest - .10), .70);
    front += (a.asis - 1.3) * .12 * G(y - a.crest, .6);
    // Absolute deposits remain effective at the reference thickness of 12 mm.
    rx += delta * .36 * G(y - 10.7, 1.5) + (adip * p.flankFat - .12) * 1.10 * G(y - 9.85, .78);
    front += delta * .40 * G(y - 10.8, 1.6) + (adip * p.lowerFat - .12) * 1.75 * G(y - 9.72, .72) + (adip * p.pubicFat - .12) * .90 * G(y - (a.pubis + .28), .42);
    back -= .09 * G(y - 8.82, .64);
    back += delta * .25 * G(y - 10.3, 1.5) + (adip * p.flankFat - .12) * .55 * G(y - 9.75, .85);
    rx += (.07 * (p.oblique - 1) + .025 * (p.rectWidth - 5)) * G(y - 10.6, 1.35);
    front += (.07 * (p.rectus - 1) + .035 * (p.oblique - 1)) * G(y - 10.65, 1.45);
    return [Math.max(.18, rx), Math.max(.18, front), Math.max(.18, back)];
}
function relief(p, x, y, z) {
    if (y < 7.6 || y > 14.15)
        return 0;
    let a = Math.abs(x), front = smooth(.1, .8, z), back = smooth(.1, .8, -z), localFat = p.fat * (1 + (p.lowerFat - 1) * .55 * G(y - 9.75, .85) + (p.flankFat - 1) * .45 * G(a - 1.1, .45) * G(y - 10, 1)), fat = Math.exp(-localFat / 17), window = smooth(anatomy(p).pubis + .1, anatomy(p).pubis + .82, y) * (1 - smooth(12.4, 12.9, y));
    let r = 0;
    if (front) {
        let wall = abdominalLayout(p, y), width = wall.width, center = wall.inner + width * .48;
        let rectusAbdominis = G(a - center, width * .51) * window, ins = 0;
        for (let level of rectusBands(p, x))
            ins += G(y - level + .025 * Math.cos(x * 6), .07);
        r += fat * (.13 * p.rectus * rectusAbdominis - .041 * p.tendon * ins * rectusAbdominis - .030 * G(x, .052) * window);
        let semilunar = wall.outer + .025;
        r -= fat * .029 * G(a - semilunar, .075) * window;
        let obCenter = wall.eoInner + .22, obWindow = smooth(9.35 + p.asisHeight / 10, 9.85 + p.asisHeight / 10, y) * (1 - smooth(12.35, 12.85, y));
        r += fat * .13 * p.oblique * G(a - obCenter, .32) * obWindow;
        // Semilunar and iliac transitions follow the landmarks rather than fixed grooves.
        r -= fat * .025 * G(a - (.70 + .20 * smooth(9.5, 12.2, y)), .09) * obWindow;
        r += fat * .052 * G(a - (anatomy(p).asis + p.flare / 10), .20) * G(y - (9.78 + p.asisHeight / 10), .19);
        let archY = 11.95 - .46 * smooth(.25, 1.3, a);
        r -= fat * .022 * G(y - archY, .095) * G(a - .85, .6);
        for (let i = 0; i < 4; i++)
            r += fat * .014 * G(y - (12.05 + i * .22) + a * .32, .065) * G(a - 1.16, .23);
        r += fat * .035 * G(a - anatomy(p).asis, .15) * G(y - (9.68 + p.asisHeight / 10), .17);
        r -= fat * .015 * G(y - (12.40 + .43 * smooth(.2, 1.4, a)), .09) * G(a - .8, .65);
        r -= .02 * G(a, .09) * G(y - 13.3, .8);
        r += .013 * G(a - .86, .045) * G(y - 12.78, .04);
        r += wall.sheathProjection * G(a - wall.outer, .24) + inguinalRelief(p, x, y);
        r *= front;
    }
    r += back * (.045 * p.back * G(a - .35, .21) * G(y - 11, 1.5) - .025 * G(x, .06) * G(y - 11.8, 1.7));
    return r;
}
function abdominalLayout(p, y) { let a = anatomy(p), v = clamp((y - a.pubis) / (13.05 - a.pubis), 0, 1), lower = smooth(a.pubis + .08, a.pubis + .95, y), inner = p.rectGap / 20 + .035 * Math.sin(PI * v) * (isOriginalAbdomen(p) ? 1 : Math.min(1, p.rectGap / 1.5)), width = Math.max(.10, Math.min(p.rectWidth / 10 * (.56 + .44 * smooth(0, .65, v)) * (1 + .16 * (p.rectus - 1)), Math.min(p.waistWidth, p.chestWidth) / 20 * .84 - inner)), outer = inner + width, eoInner = outer + .20 - .04 * (p.oblique - 1) - .12 * (p.obliqueFlesh || 0), sheathProjection = (.028 * (p.rectus - 1) + .023 * (p.oblique - 1)) * G(y - 10.4, 1.45); return { inner, width, outer, eoInner, lower, v, sheathProjection }; }
// Narrow tendon on the pubic crest and symphysis; the lateral fibers rise slightly along the crest.
function rectusOrigin(p, side, u) { let a = anatomy(p); return pelvic(p, [side * (.035 + .21 * u), a.pubis + .045 + .045 * u * u, .84 + .015 * Math.sin(PI * u)]); }
function aiisPoint(p, side = 1) { let a = anatomy(p); return pelvic(p, [side * (a.asis - .18), a.crest - .50, .52]); }
function customIntersections(p, side) {
    const shape = p.definition?.muscles?.['rectus_abdominis.' + (side < 0 ? 'L' : 'R')];
    return shape?.intersections ?? (p.abdominalModel === 1 ? shape?.fittedIntersections : undefined);
}
// The rectus rises to the xiphoid medially and the fifth costal cartilage laterally (u: 0 medial, 1 lateral).
function rectusTop(u) { return 12.62 + .28 * u; }
function rectusSegmentShape(p, side, y, x = side * .4) {
    const shape = p.definition?.muscles?.['rectus_abdominis.' + (side < 0 ? 'L' : 'R')];
    const profiles = shape?.bellies ?? (p.abdominalModel === 1 ? shape?.fittedBellies : undefined);
    const divisions = customIntersections(p, side);
    // One belly above each fitted intersection and one below the last.
    if (!profiles || !divisions || profiles.length !== divisions.length + 1) return;
    // Authored bellies follow angled/arched inscriptions at the sampled lateral
    // position. Keep the established fitted-chart path unchanged.
    const sampleX = shape?.bellies ? x : side * .4;
    const u = shape?.bellies ? clamp((Math.abs(x) - abdominalLayout(p, y).inner) / Math.max(.01, abdominalLayout(p, y).width), 0, 1) : .5;
    const levels = [rectusTop(u), ...divisions.map(item => intersectionY(p, item, sampleX)), anatomy(p).pubis + .045];
    const i = levels.findIndex((top, i) => i < profiles.length && y <= top && y >= levels[i+1]);
    if (i < 0) return;
    const t = clamp((y-levels[i+1])/Math.max(.01,levels[i]-levels[i+1]),0,1);
    return { ...profiles[i], weight: Math.sin(PI*t)**2 };
}
/** Template height of the continuous rectus shell at chart (u across, v up). */
export function rectusChartY(p, u, v) { return mix(anatomy(p).pubis + .045, rectusTop(u), v); }
export function rectusIntersectionPosition(p, y) {
    const start = anatomy(p).pubis + .045;
    return (y - start) / (13.05 - start);
}
function rectusBellyProjection(belly, u) {
    const phase = u < belly.peak ? .5 * u / belly.peak : .5 + .5 * (u-belly.peak)/(1-belly.peak);
    return belly.projection / 100 * belly.weight * Math.sin(PI*phase)**2;
}
// Upper abdominal muscle passes deep to the inferior border of pectoralis major.
function rectusTuck(y) { return .06 * smooth(12.20, 12.75, y); }
function intersectionY(p, item, x) {
    const a = anatomy(p), center = a.pubis + .045 + item.position * (13.05 - a.pubis - .045), w = abdominalLayout(p, center);
    const u = clamp((Math.abs(x) - w.inner) / Math.max(.01, w.width), 0, 1);
    return center + Math.tan(item.angle * PI / 180) * (u - .5) * w.width + item.curvature * 4 * u * (1 - u);
}
/** Resolve the fitted inscription in the continuous rectus shell chart. */
export function fittedRectusTendonChart(p, side, index, across, strip) {
    const shape = p.definition?.muscles?.['rectus_abdominis.' + (side < 0 ? 'L' : 'R')];
    const item = !shape?.intersections && shape?.fittedIntersections?.[index];
    if (!item) return;
    const u = .5 + (across - .5) * item.extent;
    const offset = (strip - .5) * .045 * (.45 + .6 * p.tendon) * item.width;
    let y = rectusChartY(p, u, item.position);
    for (let step = 0; step < 3; step++) {
        const layout = abdominalLayout(p, y), belly = rectusSegmentShape(p, side, y);
        const width = layout.width * (belly ? 1 + (belly.width - 1) * belly.weight : 1);
        y = intersectionY(p, item, side * (layout.inner + u * width)) + offset;
    }
    const bottom = rectusChartY(p, u, 0);
    return [u, (y - bottom) / (rectusChartY(p, u, 1) - bottom)];
}
function rectusBands(p, x) {
    const custom = customIntersections(p, x);
    if (custom) return custom.map(item => intersectionY(p, item, x));
    const count = clamp(Math.round((p.rectusSegmentCount || 6) / 2), 2, 4);
    return [11.92, 11.25, 10.58, 9.88].slice(0, count).map((level, i) => level +
        (p.rectPattern || 0) * (.09 + .025 * i) * Math.tanh(x * 9) * (i % 2 ? -1 : 1) + (p.rectusIntersectionShift || 0) * .14);
}
function pectoralSection(p, u) { let a = anatomy(p), t = clamp(u, 0, 1), x = mix(.10, a.shoulder + .43, t), y = mix(13.18, 13.33, t) + (.035 + .12 * (p.pecUpper || 0)) * Math.sin(PI * t), ry = (.84 * (1 - t) ** .62 + .035) * (1 + .20 * (p.pecSpread || 0) * Math.sin(PI * t)) * (.76 + .24 * Math.sqrt(p.pectoralClavicular || 1)), pr = profile(p, y), n = torsoExponent(y, p), base = pr[1] * Math.max(.01, 1 - Math.min(.999, (x / pr[0]) ** n)) ** (1 / n), z = mix(base - .13, .25, smooth(.70, 1, t)), rz = (.025 + (.11 + .16 * p.pectoral) * Math.sin(PI * t) ** .8) / (1 + .20 * (p.pecSpread || 0) * Math.sin(PI * t)) * (.76 + .11 * Math.sqrt(p.pectoralSternal || 1) + .08 * Math.sqrt(p.pectoralCostal || 1) + .05 * Math.sqrt(p.pectoralClavicular || 1)); return { x, y, z, ry, rz }; }
function pectoralBase(p, x, y) { let pr = profile(p, y), n = torsoExponent(y, p); return pr[1] * Math.max(.01, 1 - Math.min(.999, (Math.abs(x) / pr[0]) ** n)) ** (1 / n); }
function upperMuscles(p, side = 1) {
    let a = anatomy(p), sh = a.shoulder, S = v => [side * v[0], v[1], v[2]], out = [];
    function muscle(name, origin, insertion, r1, r2, volume, bias = .5) { volume *= p.individualGrowth?.[name] ?? 1; let A = S(origin), B = S(insertion), axis = unit(sub(B, A)), across = unit(cross(axis, [0, 0, 1])), depth = unit(cross(across, axis)), center = A.map((v, k) => mix(v, B[k], bias)), length = Math.hypot(...sub(B, A)), scale = Math.sqrt(volume); if (name === 'tricepsLong')
        center[0] += side * .23; if (name === 'biceps')
        center[0] += side * .07; if (['biceps', 'tricepsLong', 'tricepsLateral', 'brachialis'].includes(name))
        center = center.map((v, k) => v + axis[k] * .16 * (p.armBelly || 0)); let axialLength = length * .46, shapeScale = 1; if (['biceps', 'tricepsLong', 'tricepsLateral', 'brachialis'].includes(name) && (p.armBelly || 0)) {
        let limit = .96 * Math.max(.10, Math.min(dot(sub(center, A), axis), dot(sub(B, center), axis)));
        axialLength = Math.min(axialLength * (1 - .18 * Math.abs(p.armBelly)), limit);
        shapeScale = Math.sqrt(length * .46 / axialLength);
    } out.push({ name, origin: A, insertion: B, c: center, axes: [across, axis, depth], r: [r1 * scale * shapeScale, axialLength, r2 * scale * shapeScale] }); }
    let tip = [sh + .64, 12.53, .015];
    muscle('deltoidAnterior', [sh - .27, 14.03, .26], tip, .30, .26, p.deltoid, .40);
    muscle('deltoidMiddle', [sh + .10, 14.10, -.02], tip, .40, .36, p.deltoid, .32);
    muscle('deltoidPosterior', [sh - .16, 13.96, -.39], tip, .31, .26, p.deltoid, .40);
    muscle('biceps', [sh + .17, 13.53, .19], [sh + 1.0, 10.94, .15], .26, .26, p.biceps, .48);
    muscle('bicepsShort', [sh - .08, 13.94, .18], [sh + .94, 11.00, .15], .16, .22, p.biceps, .48);
    muscle('brachialis', [sh + .57, 12.68, .04], [sh + .95, 11.02, .04], .28, .20, .55 + .45 * p.biceps, .50);
    muscle('tricepsLong', [sh - .08, 13.61, -.26], [sh + .95, 11.13, -.16], .28, .27, p.triceps, .43);
    muscle('tricepsLateral', [sh + .41, 13.28, -.13], [sh + .95, 11.13, -.16], .27, .25, p.triceps, .44);
    muscle('tricepsMedial', [sh + .40, 13.18, -.08], [sh + .95, 11.06, -.16], .20, .16, p.triceps, .5);
    muscle('brachioradialis', [sh + .85, 11.47, .11], [sh + 1.39, 9.05, .13], .23, .22, p.forearm, .38);
    muscle('forearmFlexors', [sh + .83, 11.0, .17], [sh + 1.26, 8.85, .08], .22, .23, p.forearm, .35);
    muscle('forearmExtensors', [sh + 1.02, 11.03, -.14], [sh + 1.35, 8.88, -.05], .23, .20, p.forearm, .38);
    muscle('sternocleidomastoid', [.20, 14.05, .52], [.41, 15.76, -.12], .085, .10, 1, .50);
    muscle('levatorScapulae', [.32, 15.15, -.35], [sh - .45, 13.80, -.55], .10, .11, p.back, .54);
    muscle('trapeziusUpper', [.10, 15.08, -.48], [sh - .10, 14.05, -.40], .18, .10, p.back, .55);
    muscle('trapeziusMiddle', [.10, 13.65, -.85], [sh - .20, 13.83, -.49], .37, .10, p.back, .54);
    muscle('trapeziusLower', [.12, 11.30, -.82], [sh - .22, 13.76, -.49], .26, .11, p.back, .48);
    muscle('rhomboids', [.17, 13.52, -.69], [sh - .45, 12.84, -.52], .24, .10, p.back, .52);
    muscle('infraspinatus', [.55, 13.13, -.70], [sh + .03, 13.79, -.19], .27, .14, p.back, .53);
    muscle('supraspinatus', [.55, 13.86, -.60], [sh + .03, 13.95, -.10], .15, .12, p.deltoid, .52);
    muscle('teresMinor', [.90, 12.98, -.62], [sh + .10, 13.71, -.22], .11, .12, p.back, .56);
    muscle('teresMajor', [.82, 12.66, -.65], [sh + .28, 13.35, -.08], .18, .15, p.back, .57);
    muscle('subscapularis', [.65, 13.23, -.39], [sh + .06, 13.73, .09], .25, .12, p.back, .54);
    muscle('pectoralisMinor', [.67, 12.73, .79], [sh - .17, 13.77, .22], .20, .10, p.pectoral, .52);
    muscle('subclavius', [.18, 13.86, .68], [sh - .24, 14.0, .27], .07, .07, 1, .50);
    return out;
}
function musclePoint(m, t, ang) { let axial = clamp(t, -1, 1), n = m.name === 'gluteusMaximus' ? 2.15 : m.name.startsWith('deltoid') ? 2.2 : 2, rad = Math.max(0, 1 - Math.abs(axial) ** n) ** (1 / n), w = m.r[0] * rad, d = m.r[2] * rad; if (m.name === 'gluteusMaximus') {
    w *= 1 + .05 * axial;
    d *= 1 - .04 * axial;
} return m.c.map((x, k) => x + m.axes[1][k] * axial * m.r[1] + m.axes[0][k] * w * Math.cos(ang) + m.axes[2][k] * d * Math.sin(ang)); }
function orientedMuscleMesh(m) {
    let rows = 32, cols = 20, pts = [], idx = [], fibers = [], tissue = [];
    for (let j = 0; j <= rows; j++) {
        let v = j / rows, t = clamp((v - .10) / .80, 0, 1) * 2 - 1;
        for (let i = 0; i <= cols; i++) {
            let angle = i / cols * 2 * PI, point = musclePoint(m, t, angle);
            if (v < .10) {
                let blend = smooth(0, .10, v), radius = .015 * (1 - blend);
                point = m.origin.map((x, k) => mix(x, point[k], blend) + radius * (m.axes[0][k] * Math.cos(angle) + m.axes[2][k] * Math.sin(angle)));
            }
            else if (v > .90) {
                let blend = smooth(.90, 1, v), radius = .014 * blend;
                point = point.map((x, k) => mix(x, m.insertion[k], blend) + radius * (m.axes[0][k] * Math.cos(angle) + m.axes[2][k] * Math.sin(angle)));
            }
            pts.push(point);
            fibers.push(angle * 28);
            tissue.push(.10 + .90 * smooth(.04, .19, v) * (1 - smooth(.81, .96, v)));
        }
    }
    for (let j = 0; j < rows; j++)
        for (let i = 0; i < cols; i++) {
            let a = j * (cols + 1) + i, b = a + cols + 1;
            idx.push(a, a + 1, b, a + 1, b + 1, b);
        }
    let A = pts.length;
    pts.push(m.origin, m.insertion);
    fibers.push(0, 0);
    tissue.push(.05, .05);
    for (let i = 0; i < cols; i++) {
        idx.push(A, i + 1, i, A + 1, rows * (cols + 1) + i, rows * (cols + 1) + i + 1);
    }
    let result = mesh(pts, idx);
    result.fibers = new Float32Array(fibers);
    result.tissue = new Float32Array(tissue);
    result.anatomicalName = m.name;
    result.rigRegion = m.lower ? 'leg' : /^(deltoid|biceps|triceps|brachialis|brachioradialis|forearm)/.test(m.name) ? 'arm' : 'torso';
    return result;
}
function lowerMuscles(p, side = 1) {
    let a = anatomy(p), hip = .85 + (p.pelvisWidth - 35) / 65 + (a.asis - 1.3) * .20 + p.flare / 100, ts = p.thighGirth / 55, out = [], S = v => [side * v[0], v[1], v[2]], ky = a.knee[1], prox = Math.sqrt(p.proximalThigh), hipDepth = (p.pelvisDepth - 26) / 40;
    function addMuscle(name, origin, insertion, center, radii, volume) { volume *= p.individualGrowth?.[name] ?? 1; let A = S(origin), B = S(insertion), axis = unit(sub(B, A)), right = unit(cross(axis, [0, 0, 1])), depth = unit(cross(right, axis)), scale = Math.sqrt(volume), c = S(center), r = [radii[0] * scale, radii[1], radii[2] * scale]; if (name.startsWith('gluteus'))
        c[1] += .16 * (p.gluteFullness || 0); if (name === 'vastusLateralis' || name === 'vastusMedialis') {
        let factor = Math.sqrt(1 + (name === 'vastusLateralis' ? .25 : -.25) * (p.thighSweep || 0));
        r[0] *= factor;
        r[2] *= factor;
    } if (name.startsWith('gastrocnemius')) {
        let lengthFactor = 1 - .14 * (p.calfBelly || 0);
        c[1] += .22 * (p.calfBelly || 0);
        r[1] *= lengthFactor;
        r[0] /= Math.sqrt(lengthFactor);
        r[2] /= Math.sqrt(lengthFactor);
    } if ((name.startsWith('gluteus') && (p.gluteFullness || 0)) || (name.startsWith('gastrocnemius') && (p.calfBelly || 0))) {
        let limit = .96 * Math.max(.10, Math.min(dot(sub(c, A), axis), dot(sub(B, c), axis))), previous = r[1];
        r[1] = Math.min(r[1], limit);
        let factor = Math.sqrt(previous / r[1]);
        r[0] *= factor;
        r[2] *= factor;
    } out.push({ name, origin: A, insertion: B, c, axes: [right, axis, depth], r, lower: true }); }
    // Origins sit on the drawn pelvic bones: ischial tuberosity, pubic body and rami.
    const tuber = ischialTuberosity(p);
    addMuscle('gluteusMaximus', [.28, a.crest - .05, -.76 - hipDepth], [hip + .24, 8.05, -.12], [hip * .94, 8.78, -.64 - hipDepth], [.56 + (p.pelvisWidth - 35) / 85, .88, .53], p.gluteMax);
    addMuscle('gluteusMedius', [a.asis * .92, a.crest - .04, -.20], [hip + .32, 8.66, -.09], [hip + .18, 9.16, -.29], [.40, .58, .38], p.gluteMed);
    addMuscle('iliopsoas', [.30, 11.60, spineZ(11.6) + .05], [hip - .12, 8.12, .18], [hip * .80, 8.83, .25], [.24 * ts, .73, .28 * ts], .65 + .35 * p.proximalThigh);
    addMuscle('rectusFemoris', [a.asis - .18, a.crest - .50, .52], [.86, ky + .12, .35], [mix(hip, .86, .45), 7.64, .37 + .08 * (p.proximalThigh - 1)], [.30 * ts * prox, 1.73, .36 * ts * prox], p.quadriceps);
    addMuscle('vastusLateralis', [hip + .30, 8.63, .04], [.98, ky + .10, .29], [mix(hip, .86, .55) + .27, 6.99, .12], [.32 * ts, 1.65, .40 * ts], p.quadriceps);
    addMuscle('vastusMedialis', [hip - .10, 8.45, .10], [.77, ky + .08, .31], [mix(hip, .86, .55) - .23, 6.66, .18], [.29 * ts, 1.53, .38 * ts], p.quadriceps);
    addMuscle('vastusIntermedius', [hip, 8.38, .0], [.86, ky + .14, .22], [mix(hip, .86, .55), 7.05, .03], [.30 * ts, 1.43, .30 * ts], p.quadriceps);
    addMuscle('adductorLongus', [.23, a.pubis + .05, .60], [.75, 6.10, .0], [mix(.47, hip * .68, .5), 7.65, .16], [.27 * ts, 1.04, .33 * ts], p.adductors);
    addMuscle('adductorMagnus', [.62, tuber[1] + .06, -.22], [.66, ky + .26, -.05], [mix(.48, hip * .65, .5), 6.94, -.16], [.29 * ts, 1.40, .34 * ts], p.adductors);
    addMuscle('pectineus', [.42, a.pubis + .14, .62], [hip - .10, 7.88, .02], [hip * .66, 8.31, .21], [.22 * ts, .52, .24 * ts], p.adductors);
    addMuscle('gracilis', [.22, a.pubis - .22, .56], [.62, ky - .07, .15], [.45, 6.87, .10], [.10 * ts, 1.50, .11 * ts], p.adductors);
    addMuscle('bicepsFemoris', [tuber[0] + .02, tuber[1] - .04, tuber[2] - .06], [1.07, ky - .04, -.08], [mix(hip, .86, .55) + .17, 6.95, -.35], [.28 * ts, 1.49, .32 * ts], p.hamstrings);
    addMuscle('semitendinosus', [tuber[0] - .04, tuber[1] - .04, tuber[2] - .08], [.64, ky - .12, -.03], [mix(hip, .86, .55) - .19, 6.94, -.37], [.23 * ts, 1.43, .30 * ts], p.hamstrings);
    addMuscle('semimembranosus', [tuber[0] - .02, tuber[1] + .05, tuber[2] + .02], [.67, ky + .01, -.17], [mix(hip, .86, .55) - .12, 7.12, -.28], [.24 * ts, 1.40, .26 * ts], p.hamstrings);
    addMuscle('tensorFasciaeLatae', [a.asis, a.crest - .13, .43], [hip + .42, 7.84, .07], [hip + .38, 8.70, .13], [.16 * ts, .60, .19 * ts], .65 + .35 * p.gluteMed);
    addMuscle('gastrocnemiusMedial', [.73, ky + .07, -.15], [.90, 1.52, -.34], [.74, 3.62, -.32], [.27, 1.12, .34], p.calves);
    addMuscle('gastrocnemiusLateral', [1.01, ky + .05, -.14], [.90, 1.52, -.34], [1.06, 3.80, -.29], [.22, 1.02, .31], p.calves);
    addMuscle('soleus', [.93, 4.37, -.08], [.90, 1.17, -.30], [.92, 2.83, -.22], [.29, 1.07, .24], p.calves);
    addMuscle('tibialisAnterior', [.73, 4.67, .19], [.73, .40, .58], [.74, 3.20, .19], [.14, 1.30, .18], p.shin);
    addMuscle('gluteusMinimus', [a.asis * .88, a.crest - .17, -.09], [hip + .22, 8.66, .03], [hip + .12, 9.03, -.12], [.30, .48, .24], p.gluteMed);
    addMuscle('piriformis', [.20, 9.08, -.48], [hip + .21, 8.72, -.19], [hip * .66, 8.92, -.35], [.14, .45, .16], p.gluteMax);
    addMuscle('obturatorInternus', [.37, a.pubis + .03, -.30], [hip + .18, 8.59, -.17], [hip * .72, 8.65, -.22], [.13, .36, .14], p.adductors);
    addMuscle('quadratusFemoris', [.48, 8.38, -.37], [hip + .14, 8.28, -.12], [hip * .79, 8.34, -.24], [.15, .30, .15], p.gluteMax);
    addMuscle('iliacus', [a.asis * .70, a.crest - .22, .16], [hip - .13, 8.14, .18], [hip * .80, 9.0, .20], [.30 * ts, .56, .20], .65 + .35 * p.proximalThigh);
    addMuscle('adductorBrevis', [.30, a.pubis - .15, .45], [hip - .14, 7.65, .04], [hip * .66, 8.02, .12], [.21 * ts, .55, .23 * ts], p.adductors);
    // Sartorius has its own strap mesh; this axis only carries its hypertrophy field.
    addMuscle('sartorius', [a.asis, a.crest - .12, .62], [.66, 4.89, .23], [.85, 6.8, .58], [.16, 1.9, .14], 1);
    addMuscle('popliteus', [1.01, 5.01, -.12], [.68, 4.55, -.13], [.86, 4.78, -.15], [.12, .24, .11], 1);
    addMuscle('fibularisLongus', [1.10, 4.58, -.02], [1.08, .98, .04], [1.14, 3.25, -.01], [.12, 1.27, .17], p.calves);
    addMuscle('extensorDigitorum', [.98, 4.55, .14], [1.0, .84, .24], [1.02, 3.08, .17], [.11, 1.24, .14], p.shin);
    return out;
}
// Trapezius: one fan over the neck and upper back, measured against the reference écorché. s runs along the
// origin from the occiput down the nuchal ligament and spinous processes to T12; each part is a span of s and
// they share edges. Descending fibers insert on the lateral clavicle, transverse on the acromion and scapular
// spine, ascending converge on the root of the spine. t runs from origin to insertion.
// Vertebral column depth (anterior +z) along the authored height, with lordosis and kyphosis.
function spineZ(y) { let z = -.70 - .17 * G(y - 12.4, 1.0) + .18 * G(y - 10.3, .9); return mix(z, -.20, smooth(14.0, 15.4, y)); }
// Shared builder for flat and fan muscles laid on the trunk. s runs along the origin and t from origin to
// insertion; a muscle's parts are spans of s that share edges. place(x, y, z, t, s) returns the surface point
// (already on the given side) and its outward normal for an origin→insertion interpolation (x, y, z on +x).
function fanMuscle(p, side, o) {
    const [s0, s1] = o.span ?? [0, 1], rows = o.rows ?? 26, cols = o.cols ?? 18;
    const frame = (t, s) => { let a = o.origin(s), b = o.insertion(s), e = o.ease ? o.ease(t, s) : t * t * (3 - 2 * t); return o.place(mix(a[0], b[0], e), mix(a[1], b[1], e), mix(a[2], b[2], e), t, s); };
    const m = shell((t, v) => {
        let s = mix(s0, s1, v), f = frame(t, s), th = o.thickness(t, s);
        return { point: add(f.point, mul(f.normal, .5 * th)), normal: f.normal };
    }, (t, v) => o.thickness(t, mix(s0, s1, v)), rows, cols, o.tissue ? (t, v) => o.tissue(t, mix(s0, s1, v)) : null);
    m.anatomicalName = o.name + '_' + (side > 0 ? 'R' : 'L');
    if (o.armBlend)
        m.armBlend = o.armBlend;
    setShellFibers(m, (t, v) => mix(s0, s1, v) * (o.fiberScale ?? 30));
    m.longitudinal = new Float32Array(m.positions.length / 3);
    for (let layer = 0; layer < 2; layer++)
        for (let j = 0; j <= rows; j++)
            for (let i = 0; i <= cols; i++)
                m.longitudinal[layer * (rows + 1) * (cols + 1) + j * (cols + 1) + i] = j / rows;
    return m;
}
// Back surface at depth `inset`; the end of each fiber blends onto its bony insertion.
function onBack(p, side, inset) {
    return (x, y, z, t) => {
        let yy = Math.min(y, 14.9), pr = profile(p, yy), theta = side * (PI - Math.asin(clamp(x / pr[0], 0, .98))), surface = torsoSurface(p, yy, theta, inset);
        return { point: [side * x, y, mix(surface.point[2], z, smooth(.72, 1, t))], normal: surface.normal };
    };
}
// Upper-arm attachment spans and belly proportions compared with the reference humerus.
// Keep the legacy axes in upperMuscles: they also drive the skin's volume fields.
function anatomicalArmMuscles(p, side) {
    const sh = anatomy(p).shoulder;
    const parts = [
        { name: 'biceps_brachii_long', key: 'biceps', A: [sh + .06, 14.10, .12], B: [sh + 1.00, 10.90, .15], width: .25, depth: .38, z: .17, front: 1 },
        { name: 'biceps_brachii_short', key: 'bicepsShort', A: [sh - .08, 13.94, .18], B: [sh + .94, 11.00, .15], width: .16, depth: .22, z: .15, front: 1 },
        { name: 'brachialis', key: 'brachialis', A: [sh + .44, 12.93, .015], B: [sh + .97, 10.91, .04], width: .29, depth: .23, z: .015, front: 1 },
        { name: 'triceps_brachii_long', key: 'tricepsLong', A: [sh - .08, 13.72, -.31], B: [sh + .96, 11.12, -.19], width: .25, depth: .35, z: -.23, front: -1 },
        { name: 'triceps_brachii_lateral', key: 'tricepsLateral', A: [sh + .34, 13.67, -.16], B: [sh + .98, 11.12, -.19], width: .24, depth: .30, z: -.18, front: -1 },
        { name: 'triceps_brachii_medial', key: 'tricepsMedial', A: [sh + .40, 13.18, -.08], B: [sh + .95, 11.06, -.16], width: .20, depth: .16, z: -.035, front: -1 },
        // Forearm paths end at the wrist/palm boundary; digital tendon routing is separate.
        { name: 'brachioradialis', key: 'brachioradialis', group: 'forearm', A: [sh + .91, 12.02, .08], B: [sh + 1.48, 8.94, .10], width: .14, depth: .16, z: .02, front: 1 },
        { name: 'pronator_teres', key: 'forearmFlexors', group: 'forearm', A: [sh + .73, 11.24, .10], B: [sh + 1.36, 10.02, .16], width: .10, depth: .12, z: .04, front: 1 },
        { name: 'pronator_quadratus', key: 'forearmFlexors', group: 'forearm', A: [sh + 1.12, 9.42, .09], B: [sh + 1.47, 9.00, .12], width: .12, depth: .055, z: 0, front: 1 },
        { name: 'supinator', key: 'forearmExtensors', group: 'forearm', A: [sh + 1.02, 11.17, -.06], B: [sh + 1.25, 10.12, -.035], width: .13, depth: .08, z: -.015, front: -1 },
        { name: 'flexor_carpi_radialis', key: 'forearmFlexors', group: 'forearm', A: [sh + .80, 11.17, .18], B: [sh + 1.44, 8.76, .15], width: .09, depth: .11, z: .075, front: 1 },
        { name: 'flexor_carpi_ulnaris', key: 'forearmFlexors', group: 'forearm', A: [sh + .75, 11.12, .06], B: [sh + 1.13, 8.78, .09], width: .10, depth: .12, z: .025, front: 1 },
        { name: 'palmaris_longus', key: 'forearmFlexors', group: 'forearm', A: [sh + .85, 11.16, .22], B: [sh + 1.30, 8.71, .17], width: .055, depth: .07, z: .08, front: 1 },
        { name: 'flexor_digitorum_superficialis', key: 'forearmFlexors', group: 'forearm', A: [sh + .90, 11.08, .14], B: [sh + 1.28, 8.72, .12], width: .14, depth: .13, z: .04, front: 1 },
        { name: 'flexor_digitorum_profundus', key: 'forearmFlexors', group: 'forearm', A: [sh + 1.00, 10.91, .045], B: [sh + 1.25, 8.74, .06], width: .13, depth: .09, z: .015, front: 1 },
        { name: 'flexor_pollicis_longus', key: 'forearmFlexors', group: 'forearm', A: [sh + 1.21, 10.69, .08], B: [sh + 1.49, 8.76, .11], width: .075, depth: .08, z: .015, front: 1 },
        { name: 'extensor_carpi_radialis_longus', key: 'forearmExtensors', group: 'forearm', A: [sh + 1.08, 11.62, -.10], B: [sh + 1.46, 8.76, -.07], width: .085, depth: .10, z: -.035, front: -1 },
        { name: 'extensor_carpi_radialis_brevis', key: 'forearmExtensors', group: 'forearm', A: [sh + 1.10, 11.28, -.15], B: [sh + 1.40, 8.74, -.10], width: .075, depth: .10, z: -.04, front: -1 },
        { name: 'extensor_carpi_ulnaris', key: 'forearmExtensors', group: 'forearm', A: [sh + .86, 11.13, -.14], B: [sh + 1.12, 8.76, -.07], width: .075, depth: .10, z: -.04, front: -1 },
        { name: 'extensor_digitorum', key: 'forearmExtensors', group: 'forearm', A: [sh + 1.00, 11.14, -.22], B: [sh + 1.30, 8.71, -.15], width: .12, depth: .12, z: -.045, front: -1 },
        { name: 'extensor_digiti_minimi', key: 'forearmExtensors', group: 'forearm', A: [sh + .90, 11.05, -.20], B: [sh + 1.18, 8.72, -.12], width: .04, depth: .055, z: -.03, front: -1 },
        { name: 'extensor_indicis', key: 'forearmExtensors', group: 'forearm', A: [sh + 1.17, 10.25, -.08], B: [sh + 1.39, 8.72, -.08], width: .045, depth: .055, z: -.02, front: -1 },
        { name: 'abductor_pollicis_longus', key: 'forearmExtensors', group: 'forearm', A: [sh + 1.16, 10.50, -.035], B: [sh + 1.55, 8.78, .025], width: .075, depth: .075, z: -.015, front: -1 },
        { name: 'extensor_pollicis_longus', key: 'forearmExtensors', group: 'forearm', A: [sh + 1.05, 10.24, -.10], B: [sh + 1.50, 8.73, -.015], width: .055, depth: .06, z: -.02, front: -1 },
        { name: 'extensor_pollicis_brevis', key: 'forearmExtensors', group: 'forearm', A: [sh + 1.23, 9.92, -.045], B: [sh + 1.53, 8.77, .015], width: .045, depth: .055, z: -.015, front: -1 },
    ];
    return parts.map(o => spindleMuscle(p, side, { ...o, group: o.group ?? (o.front > 0 ? 'biceps' : 'triceps'), bellyShift: o.group ? .20 : .12 * (p.armBelly || 0), region: 'arm' }));
}
// Shared paired shell for fusiform and strap muscles, with fixed attachment ends.
function spindleMuscle(p, side, o) {
        const axis = unit(sub(o.B, o.A)), across = unit([ -axis[1], axis[0], 0 ]);
        const volume = Math.max(.2, (o.group ? p[o.group] : 1) * (p.individualGrowth?.[o.key] ?? 1));
        // Belly position changes without moving the bony attachments.
        const belly = t => Math.sin(PI * clamp(t / (o.bellyEnd ?? 1) + (o.bellyShift ?? 0) * Math.sin(PI * t), 0, 1)) ** .8;
        const m = fanMuscle(p, side, { name: o.name, rows: 36, cols: 20, ease: t => t,
            origin: () => o.A, insertion: () => o.B,
            place: (x, y, z, t, s) => {
                const width = ((o.tendonWidth ?? .018) + o.width * belly(t)) * (2 * s - 1) * Math.sqrt(volume);
                const bend = o.center?.map((v, k) => v - (o.A[k] + o.B[k]) / 2) ?? [0, 0, o.z ?? 0], w = Math.sin(PI * t);
                return { point: [side * (x + across[0] * width + bend[0] * w), y + across[1] * width + bend[1] * w, z + bend[2] * w], normal: [0, 0, o.front] };
            },
            thickness: (t, s) => (o.tendonThickness ?? .008) + o.depth * belly(t) * Math.sqrt(Math.max(0, 1 - (2 * s - 1) ** 2)) * Math.sqrt(volume),
            tissue: t => smooth(0, .03, t / (o.bellyEnd ?? 1)) * (1 - smooth(.97, 1, t / (o.bellyEnd ?? 1))), fiberScale: 24,
        });
        m.rigRegion = o.region ?? 'torso';
        if (o.armBlend) m.armBlend = o.armBlend;
        if (o.bellyEnd) for (let i = 0; i < m.longitudinal.length; i++) m.longitudinal[i] = Math.min(1, m.longitudinal[i] / o.bellyEnd);
        return m;
}
// Shoulder girdle and neck: clavicle/ribs/scapula attachments stay separate from the humeral bellies.
function shoulderNeckRecipes(p) {
    const sh = anatomy(p).shoulder;
    return [
        { name: 'sternocleidomastoid', key: 'sternocleidomastoid', A: [.20, 14.05, .52], B: [.41, 15.76, -.12], width: .085, depth: .13, front: 1 },
        { name: 'levator_scapulae', key: 'levatorScapulae', group: 'back', A: [.32, 15.15, -.35], B: [sh - .45, 13.80, -.55], width: .10, depth: .14, front: -1 },
        { name: 'scalenus_anterior', key: 'scalenus_anterior', A: [.23, 15.00, .03], B: [.52, 14.12, .12], width: .065, depth: .065, front: 1 },
        { name: 'scalenus_medius', key: 'scalenus_medius', A: [.25, 15.25, -.08], B: [.55, 14.17, -.02], width: .075, depth: .07, front: 1 },
        { name: 'scalenus_posterior', key: 'scalenus_posterior', A: [.27, 14.90, -.20], B: [.70, 14.13, -.12], width: .065, depth: .06, front: -1 },
        { name: 'splenius_capitis', key: 'splenius_capitis', A: [.08, 13.75, -.55], B: [.47, 15.72, -.35], width: .13, depth: .10, front: -1 },
        { name: 'platysma', key: 'platysma', A: [.45, 14.10, .52], B: [.30, 15.55, .36], width: .20, depth: .022, front: 1, z: .03 },
        { name: 'pectoralis_minor', key: 'pectoralisMinor', group: 'pectoral', A: [.72, 12.65, .68], B: [sh - .17, 13.77, .22], width: .23, depth: .09, front: 1 },
        { name: 'subclavius', key: 'subclavius', A: [.25, 13.83, .57], B: [sh - .24, 14.00, .27], width: .06, depth: .06, front: 1 },
        { name: 'subscapularis', key: 'subscapularis', group: 'back', A: [.65, 13.14, -.39], B: [sh + .06, 13.73, .09], width: .26, depth: .08, front: 1, armBlend: [.70, .95] },
        { name: 'serratus_anterior', key: 'serratus_anterior', A: [1.05, 12.05, .22], B: [sh - .60, 13.40, -.58], width: .30, depth: .10, front: 1, axisOnly: true },
        { name: 'coracobrachialis', key: 'coracobrachialis', A: [sh - .12, 13.78, .13], B: [sh + .55, 12.50, .06], width: .09, depth: .12, front: 1, region: 'arm' },
        { name: 'anconeus', key: 'anconeus', A: [sh + 1.04, 11.20, -.16], B: [sh + .99, 10.43, -.13], width: .09, depth: .07, front: -1, region: 'arm' },
    ];
}
function legMuscleRecipes(p) {
    const a = anatomy(p), hip = .85 + (p.pelvisWidth - 35) / 65 + (a.asis - 1.3) * .20 + p.flare / 100, tuber = ischialTuberosity(p), ky = a.knee[1];
    return [
        { name: 'biceps_femoris_short', key: 'bicepsFemorisShort', group: 'hamstrings', A: [hip + .23, 7.30, -.02], B: [1.07, ky - .04, -.08], center: [1.08, 6.23, -.20], width: .15, depth: .22, front: -1 },
        { name: 'adductor_magnus_hamstring', key: 'adductorMagnusHamstring', group: 'adductors', A: [tuber[0], tuber[1], tuber[2]], B: [.72, ky + .18, -.04], center: [.62, 6.75, -.17], width: .15, depth: .22, front: -1 },
        { name: 'plantaris', key: 'plantaris', group: 'calves', A: [1.03, ky + .02, -.13], B: [.87, 1.15, -.31], width: .055, depth: .075, front: -1, bellyEnd: .35, tendonWidth: .005, tendonThickness: .002 },
        { name: 'tibialis_posterior', key: 'tibialis_posterior', group: 'calves', A: [.91, 4.35, -.045], B: [.72, .42, .38], center: [.87, 2.80, -.08], width: .115, depth: .15, front: -1 },
        { name: 'fibularis_brevis', key: 'fibularis_brevis', group: 'calves', A: [1.10, 2.75, -.04], B: [1.12, .43, .36], center: [1.15, 1.80, -.045], width: .07, depth: .11, front: -1 },
        { name: 'fibularis_tertius', key: 'fibularis_tertius', group: 'shin', A: [1.08, 1.73, .09], B: [1.12, .36, .48], width: .05, depth: .07, front: 1 },
        { name: 'extensor_hallucis_longus', key: 'extensor_hallucis_longus', group: 'shin', A: [.87, 3.24, .11], B: [.76, .39, .62], center: [.86, 2.30, .15], width: .055, depth: .085, front: 1 },
        { name: 'flexor_digitorum_longus', key: 'flexor_digitorum_longus', group: 'calves', A: [.80, 4.10, -.08], B: [.73, .40, .29], center: [.78, 2.70, -.14], width: .07, depth: .10, front: -1 },
        { name: 'flexor_hallucis_longus', key: 'flexor_hallucis_longus', group: 'calves', A: [1.04, 3.75, -.10], B: [.81, .34, .34], center: [.99, 2.60, -.18], width: .08, depth: .11, front: -1 },
    ].map(o => ({ tendonWidth: .005, tendonThickness: .002, ...o, region: 'leg' }));
}
function lowerAttachmentMuscle(p, side, m) {
    const positive = v => [side * v[0], v[1], v[2]];
    return pelvicMuscle(p, spindleMuscle(p, side, { name: atlas.legacy[m.name][0], key: '',
        A: positive(m.origin), B: positive(m.insertion), center: positive(m.c), width: m.r[0], depth: 2 * m.r[2],
        front: m.c[2] < 0 ? -1 : 1, region: 'leg' }));
}
function axialMuscleRecipes(p) {
    const a = anatomy(p), hip = .85 + (p.pelvisWidth - 35) / 65 + (a.asis - 1.3) * .20 + p.flare / 100;
    return [
        { name: 'serratus_posterior_superior', key: 'serratus_posterior_superior', group: 'back', A: [.08, 14.10, -.65], B: [1.00, 13.35, -.70], span: .80, width: .12, depth: .045, sheet: true },
        { name: 'serratus_posterior_inferior', key: 'serratus_posterior_inferior', group: 'back', A: [.08, 10.75, -.62], B: [1.08, 11.45, -.60], span: .85, width: .12, depth: .045, sheet: true },
        { name: 'spinalis', key: 'erectorSpinae', group: 'back', A: [.11, 10.10, -.60], B: [.08, 14.10, -.45], span: .10, width: .06, depth: .085, sheet: true },
        { name: 'multifidus', key: 'multifidus', group: 'back', A: [.18, a.crest - .35, -.60], B: [.10, 15.10, -.25], span: .13, width: .07, depth: .10, sheet: true },
        { name: 'quadratus_lumborum', key: 'quadratus_lumborum', group: 'back', A: [.55, a.crest - .70, -.40], B: [.62, 11.14, -.60], width: .19, depth: .16, front: -1 },
        { name: 'pyramidalis', key: 'pyramidalis', A: [.12, a.pubis + .05, .60], B: [.05, a.pubis + .85, .70], width: .10, depth: .03, axisOnly: true },
        { name: 'external_intercostals', key: 'external_intercostals', A: [.90, 11.50, 0], B: [.90, 13.60, 0], width: .28, depth: .05, axisOnly: true },
        { name: 'internal_intercostals', key: 'internal_intercostals', A: [.90, 11.50, 0], B: [.90, 13.60, 0], width: .25, depth: .04, axisOnly: true },
        { name: 'diaphragm', key: 'diaphragm', A: [.70, 11.20, 0], B: [.30, 12.10, 0], width: .35, depth: .05, axisOnly: true },
        { name: 'obturator_externus', key: 'obturator_externus', group: 'adductors', A: [.38, a.pubis + .03, -.02], B: [hip + .16, 8.60, -.10], width: .11, depth: .12, front: -1, region: 'leg' },
        { name: 'gemellus_superior', key: 'gemellus_superior', group: 'gluteMax', A: [.55, 8.70, -.30], B: [hip + .17, 8.67, -.12], width: .055, depth: .07, front: -1, region: 'leg' },
        { name: 'gemellus_inferior', key: 'gemellus_inferior', group: 'gluteMax', A: [.62, 8.48, -.33], B: [hip + .17, 8.53, -.13], width: .055, depth: .07, front: -1, region: 'leg' },
    ];
}
function axialMuscleMeshes(p, side) {
    return axialMuscleRecipes(p).filter(o => !o.axisOnly).map(o => {
        if (!o.sheet) {
            const m = spindleMuscle(p, side, o);
            return o.region === 'leg' ? pelvicMuscle(p, m) : m;
        }
        const growth = Math.sqrt(p.back * (p.individualGrowth?.[o.key] ?? 1));
        const m = fanMuscle(p, side, { name: o.name, origin: s => [o.A[0] + (o.name === 'spinalis' || o.name === 'multifidus' ? (s - .5) * o.span : 0), o.A[1] + (o.span > .2 ? (s - .5) * o.span : 0), o.A[2]],
            insertion: s => [o.B[0] + (s - .5) * Math.min(.10, o.span), o.B[1] + (o.span > .2 ? (s - .5) * o.span * .6 : 0), o.B[2]],
            place: onBack(p, side, anatomy(p).f + .18),
            thickness: (t, s) => .002 + o.depth * Math.sin(PI * t) ** .8 * Math.sin(PI * s) ** .5 * growth,
            tissue: t => smooth(0, .03, t) * (1 - smooth(.97, 1, t)), rows: 32, cols: 12, fiberScale: 22 });
        m.rigRegion = 'torso';
        return m;
    });
}
function diaphragmMuscle(p, side) {
    // Costal half-ring converges on a raised central tendon. This is a static shape, not breathing physics.
    const growth = Math.sqrt(p.individualGrowth?.diaphragm ?? 1);
    const m = fanMuscle(p, side, { name: 'diaphragm',
        origin: s => [.02 + 1.12 * Math.sin(PI * s), 11.35 - .15 * Math.sin(PI * s), .78 * Math.cos(PI * s)],
        insertion: s => [.02 + .24 * Math.sin(PI * s), 12.02 + (side > 0 ? .08 : 0), .08 + .20 * Math.cos(PI * s)],
        place: (x, y, z, t) => ({ point: [side * x, y + .16 * Math.sin(PI * t), z], normal: [0, 1, 0] }),
        thickness: (t, s) => .003 + .025 * Math.sin(PI * t) ** .8 * Math.sin(PI * s) ** .5 * growth, rows: 20, cols: 24 });
    m.rigRegion = 'torso';
    return m;
}
function supplementalMuscleAxes(p, side) {
    const existing = new Set([...upperMuscles(p, side), ...lowerMuscles(p, side), ...backMuscleAxes(p, side)].map(m => m.name));
    return [...shoulderNeckRecipes(p), ...legMuscleRecipes(p), ...axialMuscleRecipes(p)].filter(o => !existing.has(o.key)).map(o => ({ name: o.key,
        origin: [side * o.A[0], o.A[1], o.A[2]], insertion: [side * o.B[0], o.B[1], o.B[2]],
        r: [o.width, 0, o.depth / 2], rigRegion: o.region ?? 'torso', lower: o.region === 'leg' }));
}
/** Origin/insertion axes of back muscles that have no procedural ellipsoid, for volume fields. */
function backMuscleAxes(p, side) {
    const sh = anatomy(p).shoulder, S = v => [side * v[0], v[1], v[2]];
    return [{ name: 'latissimusDorsi', origin: S([.75, 10.5, -.95]), insertion: S([sh + .24, 13.32, .10]), r: [.45, 0, .22] },
        { name: 'erectorSpinae', origin: S([.40, 9.2, -.95]), insertion: S([.45, 13.7, -.85]), r: [.35, 0, .22] },
        ...[['longissimus', .30, 9.2, 14.1, .22], ['iliocostalis', .65, 9.6, 13.6, .22], ['rhomboidMinor', .30, 13.6, 14.3, .22], ['rhomboidMajor', .40, 12.8, 13.7, .30]].map(([name, x, y0, y1, radius]) => ({ name, origin: S([x, y0, -.85]), insertion: S([x + .12, y1, -.75]), r: [radius, 0, .12] }))];
}
// Back and scapular muscles measured against the reference écorché (see the consolidated plan's method).
function anatomicalBackMuscles(p, side) {
    const a = anatomy(p), sh = a.shoulder, growth = key => Math.max(.2, p.back * (p.individualGrowth?.[key] ?? 1));
    const spine = y => [.03, y, spineZ(y) - .36], lerp = (A, B, t) => A.map((v, k) => mix(v, B[k], t));
    const tubercle = [sh + .10, 13.88, -.13], groove = [sh + .24, 13.32, .10];
    const belly = (t, base, gain, key, end = .86) => (base + gain * Math.sqrt(growth(key)) * Math.sin(PI * Math.min(1, t * 1.1)) ** .7 * (1 - smooth(end, 1, t)));
    const edges = s => (.35 + .65 * smooth(0, .12, s)) * (.35 + .65 * (1 - smooth(.88, 1, s)));
    const out = [];
    // Rhomboids (deep to the trapezius): spinous processes C6–T5 → medial border of the scapula.
    const rhomboid = { origin: s => spine(mix(14.45, 12.93, s)), insertion: s => lerp([.50, 13.62, -.84], [.80, 12.52, -.88], s), place: onBack(p, side, a.f + .11), thickness: (t, s) => belly(t, .010, .055, 'rhomboids') * edges(s) };
    out.push(fanMuscle(p, side, { ...rhomboid, thickness: (t, s) => rhomboid.thickness(t, s) * Math.sqrt(p.individualGrowth?.rhomboidMinor ?? 1), name: 'rhomboid_minor', span: [0, .28], cols: 8 }), fanMuscle(p, side, { ...rhomboid, thickness: (t, s) => rhomboid.thickness(t, s) * Math.sqrt(p.individualGrowth?.rhomboidMajor ?? 1), name: 'rhomboid_major', span: [.28, 1], cols: 16 }));
    // Supraspinatus: supraspinous fossa (under the trapezius) → top of the greater tubercle.
    out.push(fanMuscle(p, side, { name: 'supraspinatus', origin: s => lerp([.58, 13.88, -.72], [sh - .32, 14.00, -.50], s), insertion: () => [sh + .08, 14.02, -.08], place: onBack(p, side, a.f + .10), thickness: (t, s) => belly(t, .010, .065, 'supraspinatus') * edges(s), armBlend: [.60, .95], cols: 12 }));
    // Infraspinatus fills the fossa below the spine; teres minor along the lateral border; both to the greater tubercle.
    out.push(fanMuscle(p, side, { name: 'infraspinatus', origin: s => lerp([.62, 13.55, -.80], [.82, 12.62, -.86], s), insertion: s => lerp(tubercle, [sh + .10, 13.78, -.15], s), place: onBack(p, side, a.f + .06), thickness: (t, s) => belly(t, .012, .085, 'infraspinatus') * edges(s), armBlend: [.60, .95] }));
    out.push(fanMuscle(p, side, { name: 'teres_minor', origin: s => lerp([sh - .62, 13.25, -.66], [sh - .48, 13.50, -.58], s), insertion: () => [sh + .10, 13.70, -.16], place: onBack(p, side, a.f + .05), thickness: (t, s) => belly(t, .010, .055, 'teresMinor') * edges(s), armBlend: [.60, .95], cols: 8 }));
    // Teres major: inferior angle → medial lip of the intertubercular groove, with the latissimus.
    out.push(fanMuscle(p, side, { name: 'teres_major', origin: s => lerp([.80, 12.62, -.86], [.98, 12.86, -.80], s), insertion: s => lerp(groove, [sh + .22, 13.42, .06], s), place: onBack(p, side, a.f + .05), thickness: (t, s) => belly(t, .012, .075, 'teresMajor') * edges(s), armBlend: [.60, .95], cols: 10 }));
    // Erector spinae (deep to the thoracolumbar fascia): sacrum and iliac crest → ribs and upper thoracic
    // vertebrae. Longissimus is the medial part, iliocostalis the lateral; thick lumbar columns either side
    // of the spinous processes give the divided lower back.
    const deepBack = onBack(p, side, a.f + .16), erector = { origin: s => lerp([.08, 8.60, -.80], [.72, a.crest - .15, -.78], s), insertion: s => lerp([.18, 14.30, -.70], [.78, 13.60, -.82], s),
        // Stays on the back surface along its whole length (no blend onto a single bony point).
        place: (x, y, z) => deepBack(x, y, z, 0), rows: 30, fiberScale: 26, ease: t => t,
        thickness: (t, s) => (.012 + .30 * Math.sqrt(growth('erectorSpinae')) * (1 - .72 * smooth(.15, .95, t)) * smooth(0, .06, t) * (1 - smooth(.92, 1, t))) * (.35 + .65 * Math.sin(PI * (s < .55 ? s / .55 : (s - .55) / .45)) ** .6) * (.45 + .55 * smooth(0, .10, s)) };
    out.push(fanMuscle(p, side, { ...erector, thickness: (t, s) => erector.thickness(t, s) * Math.sqrt(p.individualGrowth?.longissimus ?? 1), name: 'erector_longissimus', span: [0, .55], cols: 10 }), fanMuscle(p, side, { ...erector, thickness: (t, s) => erector.thickness(t, s) * Math.sqrt(p.individualGrowth?.iliocostalis ?? 1), name: 'erector_iliocostalis', span: [.55, 1], cols: 8 }));
    // Latissimus dorsi: spinous processes T7–sacrum (via the thoracolumbar fascia), posterior iliac crest and lower ribs → intertubercular
    // groove, twisted (lowest fibers insert highest). Aponeurotic (thoracolumbar fascia) medially and at the crest.
    const latOrigin = s => s < .55 ? spine(mix(12.43, 8.85, s / .55)) : s < .80 ? lerp([.25, a.crest - .25, -.92], [.95, a.crest - .05, -.70], (s - .55) / .25) : lerp([1.12, 10.35, -.55], [1.20, 11.25, -.45], (s - .80) / .20);
    out.push(fanMuscle(p, side, {
        name: 'latissimus_dorsi', origin: latOrigin, insertion: s => lerp(groove, [sh + .22, 13.48, .06], s), place: onBack(p, side, a.f + .05), rows: 30, cols: 28, armBlend: [.62, .95], fiberScale: 36,
        // Fibers rise laterally first; the medial sheet stays on the back before converging to the axilla.
        ease: (t, s) => { let e = t * t * (3 - 2 * t); return mix(e, e ** 1.4, 1 - smooth(.5, .9, s)); },
        thickness: (t, s) => (.006 + .075 * Math.sqrt(growth('latissimusDorsi')) * smooth(.22, .55, t) * (1 - smooth(.88, 1, t))) * (.4 + .6 * smooth(0, .08, s)) * (.5 + .5 * (1 - smooth(.9, 1, s))),
        tissue: (t, s) => 1 - .85 * (1 - smooth(.22, .40, t)) * (1 - smooth(.70, .82, s)),
    }));
    return out;
}
// Buttock and hip surface at depth `inset`: the pelvic loft section around the hip, which already meets
// the trunk above the iliac crest. Both ends of each fiber blend onto bone: the origin on the pelvis, the end on its insertion.
function onButtock(p, side, inset) {
    const a = anatomy(p);
    return (x, y, z, t) => {
        let q = pelvicLoftProfile(p, clamp(y, a.pubis - 1.25, a.crest + .30)), c = mix(q.centerBack, q.centerFront, smooth(-.35, .55, z)), rx = Math.max(.2, q.outer - c), rz = z >= q.z ? q.front : q.back;
        // Like onBack, x is kept and the section gives the depth, so the surface never folds where its centre moves.
        let u = Math.asin(clamp((x - c) / rx, -.98, .98)), theta = z < q.z ? PI - u : u, n = unit([Math.sin(theta) / rx, 0, Math.cos(theta) / rz]);
        let point = pelvic(p, [c + rx * Math.sin(theta) - n[0] * inset, y, mix(q.z + rz * Math.cos(theta) - n[2] * inset, z, Math.max(smooth(.80, 1, t), 1 - smooth(0, .22, t)))]);
        return { point: [side * point[0], point[1], point[2]], normal: [side * n[0], 0, n[2]] };
    };
}
// Gluteal muscles measured against the reference écorché. The maximus reaches the sacrum and coccyx at the
// midline, lies behind the sacrum and descends to the gluteal fold; its upper fibers insert into the iliotibial
// tract, its lower ones on the gluteal tuberosity. Medius and minimus fan from the iliac wing to the greater
// trochanter beneath it; the tensor fasciae latae runs from the ASIS into the iliotibial tract.
function anatomicalGluteals(p, side) {
    const a = anatomy(p), hip = .85 + (p.pelvisWidth - 35) / 65 + (a.asis - 1.3) * .20 + p.flare / 100, hipDepth = (p.pelvisDepth - 26) / 40;
    const growth = (base, key) => Math.max(.2, base * (p.individualGrowth?.[key] ?? 1)), lerp = (A, B, t) => A.map((v, k) => mix(v, B[k], t));
    const path = (points, s) => { let u = clamp(s, 0, 1) * (points.length - 1), i = Math.min(points.length - 2, Math.floor(u)); return lerp(points[i], points[i + 1], u - i); };
    const edges = (s, lo = .10, hi = .90) => (.35 + .65 * smooth(0, lo, s)) * (.35 + .65 * (1 - smooth(hi, 1, s)));
    const belly = (t, gain, value, end = .86) => .010 + gain * Math.sqrt(value) * Math.sin(PI * Math.min(1, t * 1.06)) ** .6 * (1 - smooth(end, 1, t));
    // Maximus: posterior iliac crest → PSIS → sacrum → coccyx; upper half into the IT tract, lower half on the femur.
    const maxOrigin = [[.78, a.crest - .12, -.78 - hipDepth], [.30, 9.55, -.92 - hipDepth], [.18, 8.95, -.88 - hipDepth], [.14, 8.45, -.72 - hipDepth]];
    const maxInsertion = [[hip + .42, 8.68, -.04], [hip + .36, 8.10, -.14], [hip + .14, 7.72, -.26]];
    return [
        fanMuscle(p, side, { name: 'gluteus_maximus', origin: s => path(maxOrigin, s), insertion: s => path(maxInsertion, s), place: onButtock(p, side, .02 + a.f), rows: 30, cols: 26, fiberScale: 34,
            // Thick over the buttock, thinning toward the sacrum and coccyx where the cleft skin is close.
            thickness: (t, s) => belly(t, .34 * (.55 + .45 * smooth(.15, .55, s)) * (1 - .55 * smooth(.62, 1, s) * (1 - smooth(.35, .75, t))), growth(p.gluteMax, 'gluteusMaximus')) * edges(s, .08, .92) }),
        // Medius: iliac crest from the ASIS back → greater trochanter; its anterior part is superficial.
        fanMuscle(p, side, { name: 'gluteus_medius', origin: s => lerp([a.asis * .96, a.crest - .10, .30], [.82, a.crest - .08, -.68 - hipDepth], s), insertion: s => lerp([hip + .38, 8.66, -.02], [hip + .30, 8.58, -.16], s), place: onButtock(p, side, .07 + a.f), cols: 20, fiberScale: 30,
            thickness: (t, s) => belly(t, .20, growth(p.gluteMed, 'gluteusMedius'), .84) * edges(s) }),
        // Minimus: beneath the medius, from the outer iliac wing to the anterior greater trochanter.
        fanMuscle(p, side, { name: 'gluteus_minimus', origin: s => lerp([a.asis * .90, a.crest - .22, .20], [.95, a.crest - .25, -.55 - hipDepth], s), insertion: s => lerp([hip + .28, 8.80, .04], [hip + .22, 8.76, -.08], s), place: onButtock(p, side, .15 + a.f), cols: 14, fiberScale: 26,
            thickness: (t, s) => belly(t, .12, growth(p.gluteMed, 'gluteusMinimus'), .84) * edges(s) }),
        // Tensor fasciae latae: ASIS and the front of the crest → iliotibial tract below the trochanter.
        fanMuscle(p, side, { name: 'tensor_fasciae_latae', origin: s => lerp([a.asis, a.crest - .13, .45], [a.asis + .06, a.crest - .08, .30], s), insertion: s => lerp([hip + .44, 7.95, .10], [hip + .46, 7.95, .02], s), place: onButtock(p, side, .03 + a.f), cols: 8, fiberScale: 20, ease: t => t,
            thickness: (t, s) => belly(t, .13, growth(.65 + .35 * p.gluteMed, 'tensorFasciaeLatae')) * edges(s, .2, .8) }),
    ];
}
// Psoas major: the leg's link to the core. From the bodies of T12–L4 beside the vertebral column, down along
// the pelvic brim and under the inguinal ligament (lateral to its midpoint) to the lesser trochanter, where it
// meets the iliacus. Measured against the reference écorché (top at T12, about 1.17 m there).
function psoasMajor(p, side) {
    const a = anatomy(p), hip = .85 + (p.pelvisWidth - 35) / 65 + (a.asis - 1.3) * .20 + p.flare / 100, gain = Math.sqrt(Math.max(.2, p.individualGrowth?.iliopsoas ?? 1));
    const ligament = inguinalPathPoint(p, .55, 1), S = v => pelvic(p, [side * v[0], v[1], v[2]]);
    const path = curve([[.26, 11.70, spineZ(11.7) + .06], [.36, 10.90, spineZ(10.9) + .12], [.48, 10.05, spineZ(10.05) + .16], [.62, a.crest - .35, -.12], [ligament[0] - .06, ligament[1] - .12, ligament[2] - .30], [hip - .12, 8.12, .18]].map(S), 48);
    // Thin at T12, full over L4–L5, narrowing at the brim to a tendon on the lesser trochanter.
    const m = tube(path, t => (.07 + .16 * gain * Math.sin(PI * Math.min(1, t * 1.25)) ** .7 * (1 - .45 * smooth(.55, .80, t))) * (1 - .55 * smooth(.85, 1, t)), 14);
    m.anatomicalName = 'psoas_major_' + (side > 0 ? 'R' : 'L');
    return m;
}
function anatomicalTrapezius(p, side, part) {
    const a = anatomy(p), sh = a.shoulder, spans = { descending: [0, .36], transverse: [.36, .56], ascending: [.56, 1] }, [s0, s1] = spans[part];
    const back = y => spineZ(y) - .36;
    // Origin: occiput (15.80) → C7 (14.18) → T3 (13.43) → T12 (10.92), on the spinous processes.
    const origin = s => {
        // Medial third of the superior nuchal line (horizontal), then down the nuchal ligament and spinous processes.
        let y = s < .12 ? 15.80 : s < .36 ? mix(15.80, 14.18, (s - .12) / .24) : s < .56 ? mix(14.18, 13.43, (s - .36) / .20) : mix(13.43, 10.92, (s - .56) / .44);
        return [s < .12 ? mix(.30, .03, s / .12) : .03, y, y > 15.0 ? mix(back(15.0), -.62, smooth(15.0, 15.8, y)) : back(y)];
    };
    const clavicle = [sh - .36, 14.07, .30], acromion = [sh + .10, 14.12, -.02], spineMid = [sh - .16, 13.98, -.39], spineRoot = [.58, 13.62, -.78];
    const insertion = s => s < .36 ? clavicle.map((v, k) => mix(v, acromion[k], s / .36)) : s < .56 ? acromion.map((v, k) => mix(v, spineMid[k], (s - .36) / .20)) : spineMid.map((v, k) => mix(v, spineRoot[k], smooth(0, 1, (s - .56) / .44)));
    const growth = s => Math.max(.2, p.back * mix(mix(p.individualGrowth?.trapeziusUpper ?? 1, p.individualGrowth?.trapeziusMiddle ?? 1, smooth(.28, .44, s)), p.individualGrowth?.trapeziusLower ?? 1, smooth(.48, .64, s)));
    function frame(t, s) {
        // Neck fibers descend along the back and sides of the neck, staying on it until shoulder level.
        let o = origin(s), ins = insertion(s), e = t * t * (3 - 2 * t), neck = 1 - smooth(.20, .40, s), y = mix(o[1], ins[1], mix(e, t ** .75, neck)), x = mix(o[0], ins[0], mix(e, e ** 1.3, neck));
        x = mix(x, Math.min(x, .9 * profile(p, Math.min(y, 14.9))[0]), smooth(14.2, 14.7, y));
        // Lie on the back surface; the neck part follows the neck, the end blends onto the bone insertion.
        // The anterior (clavicular) fibres wrap round the side of the neck to the lateral clavicle, filling
        // the neck-shoulder slope; staying on the back contour left the lateral neck base empty.
        let pr = profile(p, Math.min(y, 14.9)), back = PI - Math.asin(clamp(x / pr[0], 0, .98)), wrap = (1 - smooth(.20, .36, s)) * smooth(.10, .80, t);
        let theta = side * mix(back, Math.min(back, PI * .44), wrap), surface = torsoSurface(p, Math.min(y, 14.9), theta, a.f + .035);
        x = mix(x, Math.abs(surface.point[0]), wrap);
        // On the trunk the origin rides the spinous processes; on the neck the muscle follows the neck surface.
        let z = mix(mix(Math.min(surface.point[2], o[2] + .02 * (1 - t)), surface.point[2], smooth(14.3, 14.8, y)), surface.point[2], wrap);
        let point = [x, y, mix(z, ins[2], smooth(.78, 1, t))], normal = surface.normal;
        if (part === 'descending') {
            // The shoulder shelf slopes into the neck. Its outward normal
            // has an upward component even though a torso slice is horizontal.
            const height = Math.min(y, 14.87);
            const lo = torsoSurface(p, height - .03, theta, a.f + .035).point;
            const hi = torsoSurface(p, height + .03, theta, a.f + .035).point;
            const slope = -(normal[0] * (hi[0] - lo[0]) + normal[2] * (hi[2] - lo[2])) / .06;
            const shelf = smooth(14.04, 14.35, y) * (1 - smooth(14.78, 15.14, y)) * smooth(.1, .35, t) * (1 - smooth(.8, 1, t));
            normal = unit([normal[0], clamp(slope, 0, .8) * shelf, normal[2]]);
        }
        return { point: [side * point[0], point[1], point[2]], normal };
    }
    // Thick descending part on the neck and over the shoulder, thin sheet below; tendinous at the C7 diamond.
    const thickness = (t, s) => (.010 + .095 * Math.sqrt(growth(s)) * (1 - .55 * smooth(.30, .60, s)) * Math.sin(PI * Math.min(1, t * 1.1)) ** .7 * (1 - smooth(.88, 1, t))) * (.35 + .65 * smooth(0, .10, s)) * (.25 + .75 * (1 - smooth(.86, 1, s)));
    const m = shell((t, v) => {
        let s = mix(s0, s1, v), f = frame(t, s), th = thickness(t, s);
        return { point: add(f.point, mul(f.normal, .5 * th)), normal: f.normal };
    }, (t, v) => thickness(t, mix(s0, s1, v)), 30, 22, (t, v) => { let s = mix(s0, s1, v); return 1 - .85 * (1 - smooth(.08, .22, t)) * smooth(.28, .36, s) * (1 - smooth(.50, .58, s)); });
    m.anatomicalName = 'trapezius_' + part + '_' + (side > 0 ? 'R' : 'L');
    setShellFibers(m, (t, v) => mix(s0, s1, v) * 45);
    return m;
}
function pelvicMuscle(p, result) {
    let positions = result.positions;
    for (let i = 0; i < positions.length; i += 3) {
        let pt = pelvic(p, [positions[i], positions[i + 1], positions[i + 2]]);
        positions.set(pt, i);
    } // Recompute normals after the continuous pelvic deformation.
    let pts = Array.from({ length: positions.length / 3 }, (_, i) => Array.from(positions.subarray(i * 3, i * 3 + 3))), norm = mesh(pts, result.indices).normals;
    result.normals = norm;
    return result;
}
// Anterior outer surface of the generated ribs and costal cartilages at (x, y), in body units.
function ribCageFront(p, x, y) { let rib = clamp((13.75 - .15 - y) / .19, 0, 11), yy = 13.75 - rib * .19, rx = (1.10 + .42 * Math.sin((rib + 1) / 14 * PI)) * (p.chestWidth / 34) + .12 * (p.ribFlare || 0) * G(yy - 11.95, .60), rz = (.92 + .10 * Math.sin(rib / 12 * PI)) * (p.chestDepth / 24) + .06 * (p.ribFlare || 0) * G(yy - 12.0, .65), n = torsoExponent(yy, p), q = Math.min(.999, Math.abs(x / rx) ** n); return Math.max(rz * (1 - q) ** (1 / n), .88 * (1 - smooth(.10, .40, Math.abs(x)))) + .045; }
function ribReach(rib) { return rib < 6 ? 2.94 : rib < 7 ? mix(2.94, 2.68, rib - 6) : rib < 9 ? 2.68 : rib < 10 ? mix(2.68, 2.15, rib - 9) : 2.15; }
function torsoExponent(y, p) { return 2.06 + .42 * (p?.chestRoundness || 0) * G(y - 12.6, 1.3) + .18 * G(y - 12.6, 1.15) + .08 * G(y - 9.4, .8); }
function torsoAngle(p, y, x) { let rx = profile(p, y)[0], v = clamp(x / rx, -.99, .99); return Math.asin(Math.sign(v) * Math.abs(v) ** (torsoExponent(y, p) / 2)); }
function torsoSurface(p, y, theta, inset = 0) { let pr = profile(p, y), rx = pr[0], rz = Math.cos(theta) > 0 ? pr[1] : pr[2], exponent = torsoExponent(y, p), si = Math.sin(theta), co = Math.cos(theta), x = rx * Math.sign(si) * Math.abs(si) ** (2 / exponent), z = rz * Math.sign(co) * Math.abs(co) ** (2 / exponent), n = unit([Math.sign(x) * Math.abs(x / rx) ** (exponent - 1) / rx, 0, Math.sign(z) * Math.abs(z / rz) ** (exponent - 1) / rz]), r = relief(p, x, y, z); return { point: pelvic(p, sub([x, y, z + Math.sign(z) * r], mul(n, inset))), normal: n }; }
function buildInternals(p, wanted: string[] | null = null) {
    const has = key => !wanted || wanted.includes(key), cageOnly = !!wanted?.includes('thoracicCage'), named = (m, name, side) => { m.anatomicalName = name + (side ? '_' + (side < 0 ? 'L' : 'R') : ''); return m; };
    p = { ...p, fat: 12, lowerFat: 1, flankFat: 1, pubicFat: 1, inguinalDefinition: .65, inguinalGrooveSharpness: .55, supraInguinalVolume: .65, inguinalFoldOffset: .8 };
    // Keep the normalized construction surface, but do not bake oblique volume into
    // the rectus and its tendons when sampling the legacy skin's shared relief.
    const rectusParameters = isOriginalAbdomen(p) || p.oblique === 1 ? p : { ...p, oblique: 1 };
    let a = anatomy(p), out = { bones: [], inguinalLigaments: [], externalOblique: [], internalOblique: [], transversusAbdominis: [], rectusAbdominis: [], otherMuscles: [], aponeuroses: [] }, bones = out.bones, otherMuscles = out.otherMuscles;
    const pel = v => pelvic(p, v), B = (path, r = .07, rigRegion = null, name = null) => { if (has('bones') || cageOnly && /^(clavicle|humerus)_/.test(name ?? '')) {
        let m = tube(curve(path, name && p.definition?.interaction?.supportDetail === 2 ? 60 : 30), r);
        m.rigRegion = rigRegion;
        if (name) m.anatomicalName = name;
        bones.push(m);
    } }, M = (c, r) => has('otherMuscles') && otherMuscles.push(sphere(c, r));
    // Anatomical vertebral column, with lumbar lordosis and thoracic kyphosis.
    for (let i = 0; i < 24; i++) {
        let y = i < 5 ? 9.45 + i * .37 : i < 17 ? 11.18 + (i - 5) * .25 : 14.18 + (i - 17) * .245, z = spineZ(y), w = i < 5 ? .19 : i < 17 ? .15 : .11;
        has('bones') && bones.push(sphere([0, y, z], [w, .10, .16], 10, 16));
        has('bones') && bones.push(tube([[0, y, z - .10], [0, y - .05, z - .33]], .045, 8));
        for (let s of [-1, 1])
            has('bones') && bones.push(tube([[0, y, z], [s * (w + .10), y - .025, z - .13]], .04, 8));
    }
    // pelvisModel 1 (default): the measured pelvis; 0: the legacy primitives below.
    const useMeasuredPelvis = p.pelvisModel !== 0;
    if (useMeasuredPelvis && has('bones'))
        bones.push(...measuredPelvis(p));
    // Sacrum: a curved wedge whose alae reach the iliac auricular surfaces, tapering into the coccyx.
    !useMeasuredPelvis && has('bones') && bones.push(named(shell((v, u) => { let x = mix(-1, 1, u), half = mix(.64, .13, v ** .8); return { point: pel([x * half, mix(9.52, 8.42, v), -.70 - .24 * Math.sin(v * PI * .85) + .12 * x * x * (1 - v) + .05 * (1 - Math.abs(x)) * (1 - v)]), normal: [0, -.25 * v, -1] }; }, (v, u) => (.22 - .14 * v) * (.55 + .45 * Math.sin(PI * u) ** .5), 22, 22), 'sacrum'));
    !useMeasuredPelvis && has('bones') && bones.push(named(tube(curve([pel([0, 8.46, -.71]), pel([0, 8.24, -.62]), pel([0, 8.08, -.47])], 10), t => .065 - .035 * t, 8), 'coccyx'));
    for (let side of [-1, 1]) {
        let S = v => [side * v[0], v[1], v[2]], hip = pel(S(a.hipJoint)), crestX = a.asis + p.flare / 10 + .045 * (p.iliacCrestRelief || 0), crestY = a.crest + .017 * (p.iliacCrestRelief || 0);
        // A curved iliac plate with cortical thickness, a continuous crest and pubic ring.
        if (!useMeasuredPelvis && has('bones')) {
            bones.push(anatomicalIliacWing(p, side));
            bones.push(...anatomicalPelvicRidges(p, side));
        }
        !useMeasuredPelvis && has('bones') && bones.push(sphere(hip, [.18, .18, .18], 16, 22));
        !useMeasuredPelvis && has('bones') && bones.push(sphere(aiisPoint(p, side), [.065, .09, .07], 12, 16));
        !useMeasuredPelvis && B([pel([side * 1.02, 9.10, -.21]), pel([side * .95, 8.72, .35]), pel([side * .48, a.pubis + .13, .82]), pel([side * .11, a.pubis, .84])], .09, null, 'pubic_ramus_' + (side < 0 ? 'L' : 'R'));
        !useMeasuredPelvis && B([pel([side * .11, a.pubis, .84]), pel([side * .43, 8.18 + (a.pubis - 8.55) * .65, .35]), pel([side * .85, 8.28 + (a.pubis - 8.55) * .35, -.35]), pel([side * 1.02, 9.10, -.21])], .095);
        !useMeasuredPelvis && has('bones') && bones.push(sphere(pel([0, a.pubis, .84]), [.12, .15, .08], 12, 16));
        // Ischial body and tuberosity close the posterior obturator ring below the acetabulum.
        let tuber = pel([side * .78, 8.12 + (a.pubis - 8.55) * .35, -.42]);
        !useMeasuredPelvis && B([pel([side * 1.0, 8.85, -.30]), tuber], .10);
        !useMeasuredPelvis && has('bones') && bones.push(named(sphere(tuber, [.13, .19, .15], 12, 16), 'ischial_tuberosity', side));
        !useMeasuredPelvis && has('bones') && bones.push(named(sphere(pel([side * .09, a.pubis + .02, .80]), [.11, .17, .11], 12, 16), 'pubic_body', side));
        // Twelve ribs connect to the spine and sweep around a genuinely deep thorax.
        // Continuous in rib (0 = first rib): intercostal sheets interpolate between the same curves.
        const ribPoint = (rib, t, scale = 1) => {
            let yy = 13.75 - rib * .19, rx = (1.10 + .42 * Math.sin((rib + 1) / 14 * PI)) * (p.chestWidth / 34), rz = (.92 + .10 * Math.sin(rib / 12 * PI)) * (p.chestDepth / 24);
            rx += .12 * (p.ribFlare || 0) * G(yy - 11.95, .60);
            rz += .06 * (p.ribFlare || 0) * G(yy - 12.0, .65);
            let ang = .12 + t * ribReach(rib), n = torsoExponent(yy, p), si = Math.sin(ang), co = Math.cos(ang);
            return [side * scale * rx * Math.sign(si) * Math.abs(si) ** (2 / n), yy - .20 * Math.sin(t * PI) - .15 * t, -scale * rz * Math.sign(co) * Math.abs(co) ** (2 / n)];
        };
        if (has('otherMuscles')) {
            // Intercostal muscles close the thoracic wall between ribs 1-11, slightly deep to the ribs.
            for (const [name, scale, thickness] of [['external_intercostals', .975, .022], ['internal_intercostals', .950, .018]]) {
                const growth = Math.sqrt(p.individualGrowth?.[name] ?? 1);
                let sheet = shell((v, u) => { let rib = v * 10.6, t = mix(.02, .98, u) * Math.min(1, ribReach(rib + .4) / ribReach(rib)), q = ribPoint(rib, t, scale); return { point: q, normal: unit([q[0], 0, q[2]]) }; }, (v, u) => thickness * Math.sin(PI * u) ** .3 * growth, 32, 40, () => 1);
                sheet.rigRegion = 'torso';
                otherMuscles.push(setShellFibers(named(sheet, name, side), (v, u) => (name === 'external_intercostals' ? u : 1 - u) * 32));
            }
            otherMuscles.push(diaphragmMuscle(p, side));
        }
        for (let rib = 0; rib < 12; rib++) {
            let path = [];
            for (let k = 0; k <= 46; k++)
                path.push(ribPoint(rib, k / 46));
            let yy = 13.75 - rib * .19;
            (has('bones') || cageOnly) && bones.push(named(tube(path, .035 + (rib < 3 ? .005 : 0), 9), 'rib_' + (rib + 1), side));
            if (rib < 7) {
                let end = path.at(-1);
                (has('aponeuroses') || cageOnly) && out.aponeuroses.push(named(tube(curve([end, [side * .28, yy - .14, .85], [side * .10, yy - .12, .88]], 12), .038, 8), 'costal_cartilage_' + (rib + 1), side));
            }
            else if (rib < 10) {
                // Ribs 8-10 join the cartilage above, building the costal margin that frames the upper abdomen.
                let end = path.at(-1), seventh = ribPoint(6, 1), join = [mix(seventh[0], side * .28, [.62, .38, .14][rib - 7]), mix(seventh[1], 13.75 - 6 * .19 - .14, [.62, .38, .14][rib - 7]) + .02, mix(seventh[2], .85, [.62, .38, .14][rib - 7])], bow = add(mul(add(end, join), .5), [side * .05, -.03, .05]);
                (has('aponeuroses') || cageOnly) && out.aponeuroses.push(named(tube(curve([end, bow, join], 12), .034, 8), 'costal_cartilage_' + (rib + 1), side));
            }
        }
        B([S([.10, 14.0, p.chestDepth / 24 * .70]), S([a.shoulder * .39, 14.12, .63]), S([a.shoulder - .27, 14.03, .26]), S([a.shoulder + .10, 14.10, -.02])], .065, null, 'clavicle_' + (side < 0 ? 'L' : 'R'));
        B([S([a.shoulder - .16, 13.96, -.39]), S([a.shoulder + .10, 14.10, -.02])], .08);
        has('bones') && bones.push(named(shell((v, u) => { let top = [side * (a.shoulder - .16), 13.96, -.39], inner = [side * .47, 13.55, -.87 * p.chestDepth / 24], tip = [side * .85, 12.24, -.88 * p.chestDepth / 24]; let aa = mix(top[0], inner[0], u), yy = mix(top[1], inner[1], u), zz = mix(top[2], inner[2], u); return { point: [mix(aa, tip[0], v), mix(yy, tip[1], v), mix(zz, tip[2], v)], normal: [0, 0, -1] }; }, .055, 18, 20), 'scapula', side));
        let shoulder = S(a.shoulderJoint), elbow = S(a.elbow), wrist = S(a.wrist), knee = S(a.knee), ankle = S(a.ankle);
        for (let [c, owner] of [[shoulder, 'arm'], [elbow, 'arm'], [knee, null]])
            if (has('bones')) {
                let m = sphere(c, [.15, .15, .15], 12, 18);
                m.rigRegion = owner;
                bones.push(m);
            }
        B([shoulder, S([a.shoulder + .66, 12.6, -.03]), elbow], t => .065 + .045 * Math.abs(2 * t - 1) ** 4, 'arm', 'humerus_' + (side < 0 ? 'L' : 'R'));
        for (let sign of [-1, 1])
            B([[elbow[0] + sign * .08, elbow[1] - .10, elbow[2]], [wrist[0] + sign * .085, wrist[1], wrist[2]]], .044, 'arm');
        B([hip, pel(S([1.13, 8.52, -.08])), S([.98, 7.5, -.06]), knee], t => .075 + .055 * Math.abs(2 * t - 1) ** 5);
        B([[knee[0], knee[1] - .12, .025], [ankle[0], ankle[1], ankle[2]]], .075);
        B([[knee[0] + side * .14, knee[1] - .1, -.08], [ankle[0] + side * .12, ankle[1], -.07]], .034);
        has('bones') && bones.push(sphere([knee[0], knee[1], .35], [.13, .17, .075], 12, 18));
        for (let k = 0; k < 5; k++)
            B([[ankle[0] + (k - 2) * .11, .65, .03], [ankle[0] + (k - 2) * .14, .23, 1.1 - (k * .07)]], .035);
        for (let k = 0; k < 4; k++)
            B([[wrist[0] + (k - 1.5) * .1, 8.68, .03], [wrist[0] + (k - 1.5) * .12, 7.92, .03]], .025, 'hand');
        has('inguinalLigaments') && out.inguinalLigaments.push(named(tube(Array.from({ length: 49 }, (_, i) => pel(inguinalPathPoint(p, i / 48, side))), .023, 10), 'inguinal_ligament', side));
        // Abdominal sheets use measured resting thicknesses (dm): EO .0555, IO .087, TA .0415.
        for (let [key, th, inset] of [['externalOblique', .0555, a.f + .045], ['internalOblique', .087, a.f + .12], ['transversusAbdominis', .0415, a.f + .19]]) {
            let thick = th * p.oblique * (1 + side * p.asym);
            // abdominalModel 1 (default): measured fans; 0: the legacy sheets below.
            if (p.abdominalModel !== 0) {
                has(key) && out[key].push(anatomicalAbdominalWall(p, side, key, thick, key === 'externalOblique' ? inset + .03 : inset + thick * .5));
                continue;
            }
            if (key === 'externalOblique') {
                has(key) && out[key].push(named(externalObliqueMesh(p, side, thick, inset), key, side));
                continue;
            }
            has(key) && out[key].push(named(shell((v, u) => { let low = key === 'externalOblique' ? a.crest - .24 + .16 * Math.sin(PI * u) : a.crest - .42 + .14 * Math.sin(PI * u), high = key === 'externalOblique' ? 12.66 - 1.28 * u + .11 * Math.sin(PI * 8 * u) ** 2 : 12.35 + .40 * Math.sin(PI * u) - .52 * u, y = mix(low, high, v), wall = abdominalLayout(p, y), border = key === 'externalOblique' ? wall.eoInner : wall.outer + .08, inner = torsoAngle(p, y, border) + .09 * (1 - v) ** 2, theta = side * mix(inner, 2.50, u), point = torsoSurface(p, y, theta, inset + rectusTuck(y) * (1 - smooth(.25, .55, u))), belly = .024 * p.oblique * Math.sin(PI * u) ** .65 * Math.sin(PI * v) ** .7; point.point = add(point.point, mul(point.normal, belly)); return point; }, (v, u) => thick * (.025 + .975 * Math.sin(PI * v) ** .55) * (.06 + .94 * Math.sin(PI * u) ** .45), 36, 44, key === 'externalOblique' ? (v, u) => smooth(0, .12, u) * (.55 + .45 * smooth(0, .12, v)) : null), key, side));
        }
        if (has('rectusAbdominis'))
            out.rectusAbdominis.push(...anatomicalRectusMeshes(rectusParameters, side));
        // Pyramidalis: small triangle in front of the lower rectus, from the pubis to the linea alba.
        if (has('otherMuscles')) {
        const pyramidalis = setShellFibers(named(shell((v, u) => {
            let y = mix(a.pubis + .05, a.pubis + .85, v), x = side * mix(.02, mix(.17, .02, v ** .8), u), r = torsoSurface(p, y, torsoAngle(p, y, x), a.f + .025), anchor = rectusOrigin(p, side, u * mix(.6, .05, v));
            r.point = r.point.map((val, i) => mix(anchor[i], val, smooth(0, .18, v)));
            return r;
        }, (v, u) => .004 + .022 * (1 - v) * Math.sin(PI * u) ** .5, 14, 8), 'pyramidalis', side), (v, u) => u * 14);
        // The triangular belly is broad near the pubis: genetic profile coordinates follow that belly.
        pyramidalis.longitudinal = Float32Array.from({ length: pyramidalis.positions.length / 3 }, (_, i) => Math.sqrt(Math.floor((i % pyramidalis.shellPairs) / 9) / 14));
        otherMuscles.push(pyramidalis);
        }

        if (has('aponeuroses'))
            out.aponeuroses.push(...anatomicalRectusTendons(rectusParameters, side));
        // Lower anterior rectus sheath: below the arcuate line the aponeuroses pass in front of the rectus and
        // close over the pubic symphysis, so the lower abdomen ends in one rounded U from one inguinal ligament
        // to the other instead of a V that leaves the pubis bare. Measured abdominal wall only.
        has('aponeuroses') && p.abdominalModel !== 0 && out.aponeuroses.push(named(pubicSheath(p, side), 'pubic_sheath', side));
        if (has('aponeuroses') && p.definition?.interaction?.attachments) out.aponeuroses.push(named(superiorRectusSheath(p, side), 'superior_rectus_sheath', side));
        has('aponeuroses') && out.aponeuroses.push(named(shell((v, u) => { let boundary = inguinalPathPoint(p, u, side), y = mix(boundary[1], 12.65, v), bellyV = clamp((y - (a.crest - .24)) / (12.81 - (a.crest - .24)), 0, 1), wall = abdominalLayout(p, y), edge = p.abdominalModel !== 0 ? eoMuscleBorder(p, y, side) : torsoAngle(p, y, wall.eoInner) + .09 * (1 - bellyV) ** 2, thetaBottom = torsoAngle(p, boundary[1], boundary[0]), theta = mix(thetaBottom, side * mix(torsoAngle(p, y, wall.outer - .05), Math.max(edge, torsoAngle(p, y, wall.outer + .02)), u), smooth(0, .30, v)), res = torsoSurface(p, y, theta, a.f + .018 + .027 * smooth(.6, 1, u)), anchor = pel(boundary), blend = smooth(0, .16, v); res.point = res.point.map((x, k) => mix(anchor[k], x, blend)); return res; }, (v, u) => .010 * (.3 + .7 * Math.sin(PI * u)), 32, 24), 'abdominal_aponeurosis', side));
        // Serratus anterior: pointed digitations on the lateral ribs that widen and converge backwards
        // towards the scapula's medial border; the lower ones interdigitate with the external oblique.
        for (let tooth = 0; tooth < 8; tooth++)
            has('otherMuscles') && otherMuscles.push(setShellFibers(named(shell((v, u) => {
                let tipY = 13.30 - tooth * .20, backY = 13.45 - tooth * .11, width = mix(.21, .13, u) * (.25 + .75 * smooth(0, .16, u));
                let y = mix(tipY, backY, u) + (v - .5) * width, theta = side * mix(.92 + .035 * tooth, 2.05, u);
                return torsoSurface(p, y, theta, a.f + .058);
            }, (v, u) => .006 + .05 * Math.sin(PI * v) ** .5 * smooth(0, .30, u) * (1 - .4 * smooth(.7, 1, u)), 8, 28), 'serratus_anterior_' + (tooth + 1), side), (v, u) => v * 22));
        // Pectoral fan, deltoid, arm, gluteal and leg muscle bellies.
        // Two contiguous fan regions converge on one humeral tendon. Thickness tapers at origin/insertion.
        if (has('otherMuscles') || wanted?.includes('abdominalCovering'))
            for (let head of ['clav', 'stern', 'cost'])
                otherMuscles.push(anatomicalPectoralFan(p, side, head));
        let pc = pectoralSection(p, 1);
        has('aponeuroses') && out.aponeuroses.push(tube([[side * (pc.x - .14), pc.y, .30], [side * pc.x, pc.y, .25], [side * (pc.x + .025), pc.y - .13, .17]], .035));
        for (let m of upperMuscles(p, side))
            if (!/^(trapezius|deltoid|rhomboids|supraspinatus|infraspinatus|teresMinor|teresMajor|biceps|brachialis$|triceps|brachioradialis$|forearm|sternocleidomastoid$|levatorScapulae$|subscapularis$|pectoralisMinor$|subclavius$)/.test(m.name))
                has('otherMuscles') && otherMuscles.push(orientedMuscleMesh(m));
        has('otherMuscles') && otherMuscles.push(...anatomicalArmMuscles(p, side));
        has('otherMuscles') && otherMuscles.push(...shoulderNeckRecipes(p).filter(o => !o.axisOnly).map(o => spindleMuscle(p, side, o)));
        if (has('otherMuscles'))
            for (let head of ['deltoidAnterior', 'deltoidMiddle', 'deltoidPosterior'])
                otherMuscles.push(anatomicalDeltoid(p, side, head));
        if (has('otherMuscles'))
            for (let part of ['descending', 'transverse', 'ascending'])
                otherMuscles.push(anatomicalTrapezius(p, side, part));
        for (let m of lowerMuscles(p, side))
            if (!/^(gluteusMaximus|gluteusMedius|gluteusMinimus|tensorFasciaeLatae|iliopsoas|sartorius)$/.test(m.name))
                has('otherMuscles') && otherMuscles.push(lowerAttachmentMuscle(p, side, m));
        has('otherMuscles') && otherMuscles.push(...legMuscleRecipes(p).map(o => pelvicMuscle(p, spindleMuscle(p, side, o))));
        has('otherMuscles') && otherMuscles.push(...axialMuscleMeshes(p, side));
        has('otherMuscles') && otherMuscles.push(...anatomicalGluteals(p, side), psoasMajor(p, side));
        // Sartorius forms a continuous oblique strap from ASIS to medial proximal tibia.
        let sartorius = curve([[side * a.asis, a.crest - .12, .62], [side * (.85 + (p.pelvisWidth - 35) / 65), 8.3, .72], [side * .85, 6.6, .56], [side * .66, 4.89, .23]], 54);
        has('otherMuscles') && otherMuscles.push(setShellFibers(named(shell((v, u) => { let i = Math.min(sartorius.length - 2, Math.floor(v * (sartorius.length - 1))), t = v * (sartorius.length - 1) - i, c = sartorius[i].map((x, k) => mix(x, sartorius[i + 1][k], t)); c[0] += side * (u - .5) * .13 * Math.sin(PI * v) ** .3; return { point: pel(c), normal: [0, 0, 1] }; }, (v, u) => .015 + .05 * Math.sin(PI * u) ** .5 * (1 - .5 * smooth(.85, 1, v)), 54, 12), 'sartorius', side), (v, u) => u * 8));
        // Iliotibial tract (from where the tensor fasciae latae and gluteus maximus join it, below the
        // trochanter), patellar tendon and Achilles preserve visible bony transitions.
        let lateral = .85 + (p.pelvisWidth - 35) / 65 + .40;
        has('aponeuroses') && out.aponeuroses.push(tube(curve([pel([side * (lateral + .02), 8.45, .02]), pel([side * lateral, 8.0, .03]), [side * 1.23, 6.7, .04], [side * 1.10, 4.88, .13]], 40), .035));
        has('aponeuroses') && out.aponeuroses.push(tube([[side * .86, 5.17, .34], [side * .86, 4.78, .36], [side * .86, 4.51, .26]], .052));
        has('aponeuroses') && out.aponeuroses.push(tube(curve([[side * .90, 2.69, -.39], [side * .90, 1.62, -.34], [side * .90, .63, -.30]], 28), t => .044 + .022 * (1 - t)));
        has('otherMuscles') && otherMuscles.push(...anatomicalBackMuscles(p, side));
        // Thoracolumbar fascia: the white tendinous diamond over the erector spinae, from T10 to the sacrum,
        // reaching the latissimus' muscular border. Its fibers run from the spinous processes outwards.
        has('aponeuroses') && out.aponeuroses.push(fanMuscle(p, side, { name: 'thoracolumbar_fascia', origin: s => [.03, mix(11.70, 8.90, s), -.80],
            insertion: s => [.18 + .40 * Math.sin(PI * s) ** .8, mix(11.55, 9.05, s), -.80], place: (x, y, z) => onBack(p, side, a.f + .03)(x, y, z, 0), thickness: () => .006, rows: 12, cols: 24, fiberScale: 0 }));
        for (let k = 0; k < 2; k++)
            M([side * (.22 + k * .18), 11.15, -.88], [.16, 1.40, .13]);
    }
    // Sternum: broad manubrium, narrower body and a thin xiphoid process, flattened front to back.
    (has('bones') || cageOnly) && bones.push(named(tube(curve([[0, 14.02, .86], [0, 13.72, .94], [0, 13.20, 1.0], [0, 12.62, .93], [0, 12.30, .82]], p.definition?.interaction?.supportDetail === 2 ? 60 : 30), t => [t < .22 ? mix(.27, .19, smooth(.10, .22, t)) : t < .82 ? .19 - .03 * smooth(.6, .82, t) : mix(.16, .05, smooth(.82, 1, t)), t < .82 ? .065 : mix(.06, .025, smooth(.82, 1, t))], 14), 'sternum'));
    has('bones') && bones.push(sphere([0, 16.5, -.09], [.66, .89, .80], 24, 32));
    has('bones') && bones.push(sphere([0, 15.95, .16], [.49, .36, .55], 16, 22));
    return out;
}
function pelvicLoftProfile(p, y) {
    let a = anatomy(p), hip = .85 + (p.pelvisWidth - 35) / 65 + (a.asis - 1.3) * .20 + p.flare / 100, thigh = p.thighGirth / (20 * PI), lo = a.pubis - 1.30, hi = a.crest + .38, neutral = { ...p, fat: 12, lowerFat: 1, flankFat: 1, pubicFat: 1 }, pr = profile(p, y), base = profile(neutral, y), top = profile(neutral, hi), lower = lo + .60, mid = a.pubis + .20, upper = a.crest - .40;
    let iliac = profile(neutral, upper), boneDelta = ((a.asis - 1.3) * .72 + p.flare / 10 * .85) * G(mid - (a.crest - .1), .70);
    let points = [[lo, hip + thigh * .59, thigh * .59, thigh * .61, .015], [lower, hip + thigh * .73, thigh * .72 + .025 + .04 * (p.proximalThigh - 1), thigh * .73, .025], [mid, hip + thigh * .82 + boneDelta, p.pelvisDepth / 20 * .70 + .065 + .10 * (p.proximalThigh - 1), p.pelvisDepth / 20 * .87, .025], [upper, iliac[0], iliac[1], iliac[2], .01], [hi, top[0], top[1], top[2], 0]];
    // Monotone Hermite sections keep a shared tangent without overshoot or horizontal plateaus.
    let index = 0;
    while (index < points.length - 2 && y > points[index + 1][0])
        index++;
    let A = points[index], B = points[index + 1], h = B[0] - A[0], t = clamp((y - A[0]) / h, 0, 1);
    function tangent(i, k) { let j = Math.max(0, i - 1), l = Math.min(points.length - 1, i + 1); if (i === 0)
        return (points[1][k] - points[0][k]) / (points[1][0] - points[0][0]); if (i === points.length - 1)
        return (points[i][k] - points[j][k]) / (points[i][0] - points[j][0]); let h0 = points[i][0] - points[j][0], h1 = points[l][0] - points[i][0], d0 = (points[i][k] - points[j][k]) / h0, d1 = (points[l][k] - points[i][k]) / h1; if (d0 * d1 <= 0)
        return 0; let w0 = 2 * h1 + h0, w1 = h1 + 2 * h0; return (w0 + w1) / (w0 / d0 + w1 / d1); }
    let values = A.slice(1).map((v, k) => (2 * t ** 3 - 3 * t * t + 1) * v + (t ** 3 - 2 * t * t + t) * h * tangent(index, k + 1) + (-2 * t ** 3 + 3 * t * t) * B[k + 1] + (t ** 3 - t * t) * h * tangent(index + 1, k + 1)), center = hip * (1 - smooth(lower, hi - .18, y)), outer = Math.max(center + .20, values[0] + pr[0] - base[0]), front = Math.max(.2, values[1] + pr[1] - base[1]), back = Math.max(.2, values[2] + pr[2] - base[2]);
    return { center, centerFront: hip * (1 - smooth(a.pubis - .06, a.pubis + .68, y)), centerBack: hip * (1 - smooth(a.pubis - .48, a.pubis + .45, y)), outer, front, back, z: values[3], lo, hi };
}
function humanBindY(y) { if (!HUMAN_BIND_ROWS) {
    let L = HUMAN_DATA.landmarks;
    HUMAN_BIND_ROWS = [[0, 0], [.93, L.ankle[1]], [4.95, L.knee[1]], [8.85, L.hip[1]], [10.25, L.navel[1]], [13.95, L.shoulder[1]], [15.3, 15.3], [17.5, 17.5]];
} return interpolate(HUMAN_BIND_ROWS, y)[0]; }
function humanUnbindY(y) {
    if (!HUMAN_UNBIND_ROWS) {
        humanBindY(0);
        HUMAN_UNBIND_ROWS = HUMAN_BIND_ROWS.map(([source, target]) => [target, source]);
    }
    return interpolate(HUMAN_UNBIND_ROWS, y)[0];
}
function humanRestSection(y) { if (!HUMAN_BIND_PROFILE)
    HUMAN_BIND_PROFILE = Array.from({ length: 301 }, (_, i) => { let y = 7.5 + i * .025, pr = profile(HUMAN_REST, y), a = anatomy(HUMAN_REST), lo = a.pubis - 1.3, hi = a.crest + .38; if (y > lo && y < hi) {
        let q = pelvicLoftProfile(HUMAN_REST, y), w = smooth(lo, lo + .4, y) * (1 - smooth(hi - .42, hi, y));
        pr = [mix(pr[0], q.outer, w), mix(pr[1], q.front, w), mix(pr[2], q.back, w)];
    } return pr; }); let t = clamp((y - 7.5) / .025, 0, 300), i = Math.floor(t), a = HUMAN_BIND_PROFILE[i], b = HUMAN_BIND_PROFILE[Math.min(i + 1, 300)]; return a.map((v, k) => mix(v, b[k], t - i)); }
function humanSection(y) { let rows = HUMAN_DATA.sections, t = clamp((y - rows[0][0]) / .105, 0, rows.length - 1), i = Math.floor(t), a = rows[i], b = rows[Math.min(i + 1, rows.length - 1)]; return [1, 2, 3].map(k => mix(a[k], b[k], t - i)); }
function humanBindTorso(x, y, z) { let yy = humanBindY(y), old = humanRestSection(y), target = humanSection(yy), w = smooth(7.9, 8.6, y) * (1 - smooth(13.6, 14.6, y)); return [x * mix(1, target[0] / old[0], w), yy, z * mix(1, (z >= 0 ? target[1] / old[1] : target[2] / old[2]), w)]; }
function humanSegmentPoint(v, A, B, C, D) { let ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], ul = Math.hypot(ux, uy, uz), vx = D[0] - C[0], vy = D[1] - C[1], vz = D[2] - C[2], vl = Math.hypot(vx, vy, vz), t = ((v[0] - A[0]) * ux + (v[1] - A[1]) * uy + (v[2] - A[2]) * uz) / (ul * ul), nx = v[0] - A[0] - ux * t, ny = v[1] - A[1] - uy * t, nz = v[2] - A[2] - uz * t, ax = ux / ul, ay = uy / ul, az = uz / ul, bx = vx / vl, by = vy / vl, bz = vz / vl, kx = ay * bz - az * by, ky = az * bx - ax * bz, kz = ax * by - ay * bx, c = ax * bx + ay * by + az * bz, qx = ky * nz - kz * ny, qy = kz * nx - kx * nz, qz = kx * ny - ky * nx; return [C[0] + vx * t + nx + qx + (ky * qz - kz * qy) / (1 + c), C[1] + vy * t + ny + qy + (kz * qx - kx * qz) / (1 + c), C[2] + vz * t + nz + qz + (kx * qy - ky * qx) / (1 + c)]; }
function humanBindPoint(x, y, z, owner = null) { let side = x < 0 ? -1 : 1, v = [Math.abs(x), y, z], L = HUMAN_DATA.landmarks, result = humanBindTorso(v[0], y, z), leg = Math.max(1 - smooth(8, 9.1, y), G(Math.hypot(v[0] - .82, y - 8.85, z + .04), .42)) * smooth(.15, .65, v[0]), arm = Math.max(smooth(1.25, 2.2, v[0]) * Math.max(smooth(10.5, 12.3, y), smooth(2.05, 2.5, v[0])), G(Math.hypot(v[0] - 1.58, y - 13.95, z + .03), .42)); if (owner?.arm === 1) {
    leg = 0;
    arm = 1;
} if (leg > .00001) {
    let upper = humanSegmentPoint(v, [.82, 8.85, -.04], [.86, 4.95, .045], L.hip, L.knee), lower = humanSegmentPoint(v, [.86, 4.95, .045], [.90, .93, -.04], L.knee, L.ankle), blend = smooth(4.55, 5.35, y);
    for (let k = 0; k < 3; k++)
        result[k] = mix(result[k], mix(lower[k], upper[k], blend), leg);
} if (arm > .00001) {
    let upper = humanSegmentPoint(v, [1.58, 13.95, -.03], [2.53, 11.15, .015], L.shoulder, L.elbow), lower = humanSegmentPoint(v, [2.53, 11.15, .015], [2.88, 8.86, .03], L.elbow, L.wrist), blend = smooth(10.8, 11.5, y);
    for (let k = 0; k < 3; k++)
        result[k] = mix(result[k], mix(lower[k], upper[k], blend), arm);
} result[0] *= side; return result; }
function humanInguinalContext(p) { let key = [p.inguinalOpening, p.inguinalCurvature, p.inguinalLateralWrap, p.inguinalFoldOffset].join(','), c = HUMAN_INGUINAL_CACHE.get(p); if (c && c.key === key)
    return c; let base = { ...HUMAN_REST, inguinalOpening: p.inguinalOpening, inguinalCurvature: p.inguinalCurvature, inguinalLateralWrap: p.inguinalLateralWrap, inguinalFoldOffset: p.inguinalFoldOffset }, reference = { ...HUMAN_REST, inguinalFoldOffset: p.inguinalFoldOffset }, make = (q, fold) => Array.from({ length: 65 }, (_, i) => humanBindTorso(...inguinalPathPoint(q, i / 64, 1, fold))); c = { key, path: make(base, false), fold: make(base, true), reference: make(reference, true) }; HUMAN_INGUINAL_CACHE.set(p, c); return c; }
function humanPathSample(points, t, side = 1) { let u = clamp(t, 0, 1) * 64, i = Math.floor(u), A = points[i], B = points[Math.min(i + 1, 64)], v = A.map((q, k) => mix(q, B[k], u - i)); v[0] *= side; return v; }
function humanInguinalPath(p, t, side = 1, fold = false) { let c = humanInguinalContext(p); return humanPathSample(fold ? c.fold : c.path, t, side); }
function humanInguinalWorldPoint(p, t, side = 1, fold = false) { if (p.skinModel === 1)
    return bodyWarp(p, inguinalPathPoint(p, t, side, fold)); return humanDimensions(p, ...humanInguinalPath(p, t, side, fold)); }
function humanInternalParams(p) { let base = { ...p }; for (let key of ['chestWidth', 'chestDepth', 'waistWidth', 'waistDepth', 'pelvisWidth', 'pelvisDepth', 'shoulderWidth', 'thighGirth', 'asisDistance', 'asisHeight', 'pubisHeight', 'flare', 'tilt', 'inguinalOpening', 'inguinalHeight', 'inguinalCurvature', 'inguinalLateralWrap', 'inguinalFoldOffset', 'legBalance', 'shoulderSlope'])
    base[key] = HUMAN_REST[key]; return base; }
function humanInternalPoint(p, v, owner = null) { if (p.skinModel === 1)
    return bodyWarp(p, v); return humanDimensions(p, ...humanInguinalWarp(p, ...humanBindPoint(...v, owner), owner), owner); }
function registerHumanInternal(p, m) { let owner = m.rigRegion === 'arm' || m.rigRegion === 'hand' ? { arm: 1, leg: 0, head: 0, hand: m.rigRegion === 'hand' ? 1 : 0 } : null; for (let i = 0; i < m.positions.length; i += 3) {
    let source = Array.from(m.positions.subarray(i, i + 3)), v = humanInternalPoint(p, source, owner);
    // Muscles crossing the shoulder blend from the trunk mapping (origin) to the arm mapping (insertion),
    // so each end reaches the bone that mapping carries. armBlend is the longitudinal span of that change.
    if (m.armBlend) {
        let w = smooth(m.armBlend[0], m.armBlend[1], m.longitudinal?.[i / 3] ?? 0);
        let trunk = humanInternalPoint(p, source, null), arm = humanInternalPoint(p, source, { arm: 1, leg: 0, head: 0, hand: 0 });
        v = trunk.map((q, k) => mix(q, arm[k], w));
    }
    m.positions.set(v, i);
} m.normals = humanNormals(m.positions, m.indices); return m; }
// Generators mirror points with side * x, which reverses triangle winding on the left. Every mesh is
// oriented here, once, so normals point outward regardless of how its points were produced.
function mesh(pts, indices) { let volume = 0; for (let i = 0; i < indices.length; i += 3)
    volume += dot(pts[indices[i]], cross(pts[indices[i + 1]], pts[indices[i + 2]])); if (volume < 0)
    for (let i = 0; i < indices.length; i += 3)
        [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]]; let ns = pts.map(() => [0, 0, 0]); for (let i = 0; i < indices.length; i += 3) {
    let a = indices[i], b = indices[i + 1], c = indices[i + 2], n = cross(sub(pts[b], pts[a]), sub(pts[c], pts[a]));
    for (let v of [a, b, c])
        ns[v] = add(ns[v], n);
} return { positions: new Float32Array(pts.flat()), normals: new Float32Array(ns.flatMap(unit)), indices: new Uint32Array(indices) }; }
function surface(fn, rows = 30, cols = 32) { let pts = [], idx = []; for (let j = 0; j <= rows; j++)
    for (let i = 0; i <= cols; i++)
        pts.push(fn(j / rows, i / cols)); for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
        let a = j * (cols + 1) + i, b = a + cols + 1;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
    } return mesh(pts, idx); }
function sphere(c, r, rows = 18, cols = 26) { return surface((v, u) => { let a = u * 2 * PI, b = v * PI; return [c[0] + r[0] * Math.sin(b) * Math.cos(a), c[1] + r[1] * Math.cos(b), c[2] + r[2] * Math.sin(b) * Math.sin(a)]; }, rows, cols); }
function curve(ctrl, n = 32) { let path = []; for (let j = 0; j <= n; j++) {
    let t = j / n * (ctrl.length - 1), i = Math.min(ctrl.length - 2, Math.floor(t)), f = t - i, A = ctrl[Math.max(0, i - 1)], B = ctrl[i], C = ctrl[i + 1], D = ctrl[Math.min(ctrl.length - 1, i + 2)];
    path.push([0, 1, 2].map(k => .5 * (2 * B[k] + (-A[k] + C[k]) * f + (2 * A[k] - 5 * B[k] + 4 * C[k] - D[k]) * f * f + (-A[k] + 3 * B[k] - 3 * C[k] + D[k]) * f * f * f)));
} return path; }
function tube(path, r, sides = 12) { let pts = [], idx = []; for (let j = 0; j < path.length; j++) {
    let t = unit(sub(path[Math.min(j + 1, path.length - 1)], path[Math.max(0, j - 1)])), right = unit(cross(t, Math.abs(t[2]) < .8 ? [0, 0, 1] : [0, 1, 0])), up = cross(t, right), radius = typeof r === 'function' ? r(j / (path.length - 1)) : r, [rw, rd] = Array.isArray(radius) ? radius : [radius, radius];
    for (let k = 0; k < sides; k++) {
        let a = k / sides * 2 * PI;
        pts.push(add(path[j], add(mul(right, Math.cos(a) * rw), mul(up, Math.sin(a) * rd))));
    }
} for (let j = 0; j < path.length - 1; j++)
    for (let k = 0; k < sides; k++) {
        let a = j * sides + k, b = j * sides + (k + 1) % sides, c = a + sides, d = b + sides;
        idx.push(a, c, b, b, c, d);
    } let a = pts.length; pts.push(path[0], path.at(-1)); for (let k = 0; k < sides; k++)
    idx.push(a, k, (k + 1) % sides, a + 1, (path.length - 1) * sides + (k + 1) % sides, (path.length - 1) * sides + k); const result = mesh(pts, idx); result.surfaceGrid = { rows: path.length - 1, cols: sides, kind: 'tube' }; return result; }
function shell(fn, thickness, rows = 35, cols = 32, tissueFn = null) { let pts = [], idx = []; for (let layer = 0; layer < 2; layer++)
    for (let j = 0; j <= rows; j++)
        for (let i = 0; i <= cols; i++) {
            let v = j / rows, u = i / cols, res = fn(v, u), n = res.normal, th = typeof thickness === 'function' ? thickness(v, u) : thickness;
            pts.push(add(res.point, mul(n, (layer === 0 ? .5 : -.5) * th)));
        } let count = (rows + 1) * (cols + 1); for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
        let a = j * (cols + 1) + i, b = a + cols + 1;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
        idx.push(count + a, count + b, count + a + 1, count + a + 1, count + b, count + b + 1);
    } let border = []; for (let i = 0; i <= cols; i++)
    border.push(i); for (let j = 1; j <= rows; j++)
    border.push(j * (cols + 1) + cols); for (let i = cols - 1; i >= 0; i--)
    border.push(rows * (cols + 1) + i); for (let j = rows - 1; j > 0; j--)
    border.push(j * (cols + 1)); for (let k = 0; k < border.length; k++) {
    let a = border[k], b = border[(k + 1) % border.length];
    idx.push(a, a + count, b, b, a + count, b + count);
} let result = mesh(pts, idx); result.shellPairs = count; result.surfaceGrid = { rows, cols, kind: 'shell' }; if (tissueFn) {
    let tissue = [];
    for (let layer = 0; layer < 2; layer++)
        for (let j = 0; j <= rows; j++)
            for (let i = 0; i <= cols; i++)
                tissue.push(tissueFn(j / rows, i / cols));
    result.tissue = new Float32Array(tissue);
} return result; }
function humanNormals(positions, indices) { let normals = new Float32Array(positions.length); for (let i = 0; i < indices.length; i += 3) {
    let a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3, ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2], vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2], nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    normals[a] += nx; normals[a + 1] += ny; normals[a + 2] += nz;
    normals[b] += nx; normals[b + 1] += ny; normals[b + 2] += nz;
    normals[c] += nx; normals[c + 1] += ny; normals[c + 2] += nz;
} for (let i = 0; i < normals.length; i += 3) {
    let len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= len;
    normals[i + 1] /= len;
    normals[i + 2] /= len;
} return normals; }
function humanRigRegion(i) { let j = i / 3 * 4, arm = HUMAN_DATA.rig[j], leg = HUMAN_DATA.rig[j + 1], hand = HUMAN_DATA.rig[j + 2], head = HUMAN_DATA.rig[j + 3]; if (arm > .99999)
    arm = 1; if (hand > .99999)
    hand = 1; if (head > .99999)
    head = 1; leg = Math.min(leg, Math.max(0, 1 - arm - head)); return { arm, leg, hand, head }; }
function humanRegion(x, y, z, owner = null) { let ax = Math.abs(x), front = smooth(-.2, .6, z); if (owner)
    return { ...owner, ax, front }; let arm = smooth(1.6, 2.55, ax) * smooth(6.7, 8.5, y), leg = (1 - arm) * (1 - smooth(8.15, 9.25, y)); return { ax, arm, leg, hand: 0, head: 0, front }; }
function humanMuscle(p, x, y, z, owner = null) { let r = humanRegion(x, y, z, owner), front = r.front, arm = r.arm, leg = r.leg, upper = G(y - 12.9, .95), abd = G(y - 10.7, 1.45), thigh = G(y - 6.9, 1.6), calf = G(y - 3.3, 1.35), glute = G(y - 8.85, .7) * (1 - front), medial = 1 - smooth(.45, 1.05, r.ax), torso = mix(p.back, p.pectoral, front) * upper + mix(p.oblique, p.rectus, 1 - smooth(.55, 1.05, r.ax)) * abd, tw = upper + abd, vol = tw > 0 ? torso / tw : 1; vol = mix(vol, mix(mix(p.forearm, mix(p.triceps, p.biceps, front), smooth(10.4, 11.7, y)), p.deltoid, smooth(12.8, 13.8, y)), arm); let lv = mix(mix(p.hamstrings, p.quadriceps, front), p.adductors, medial * .65), gv = mix(p.gluteMax, p.gluteMed, smooth(8.6, 9.6, y)); lv = mix(lv, mix(p.calves, p.shin, front), 1 - smooth(4.5, 5.6, y)); lv = mix(lv, gv, clamp(glute, 0, 1)); vol = mix(vol, lv, leg); return mix(clamp(.40 + .43 * (vol - 1), -.12, 1.25), .40, Math.max(r.hand, r.head)); }
function humanFat(p, x, y, z, owner = null) { let r = humanRegion(x, y, z, owner), lower = G(y - 9.8, .9) * r.front, flank = G(y - 10.15, 1.05) * smooth(.7, 1.4, r.ax), pubic = G(y - 8.65, .55) * G(x, .55) * r.front, regional = (1 + lower * (p.lowerFat - 1) + flank * (p.flankFat - 1) + pubic * (p.pubicFat - 1)); regional = mix(regional, p.armFat, r.arm); regional = mix(regional, mix(p.thighFat, p.gluteFat, (1 - r.front) * smooth(7.7, 8.8, y)), r.leg * smooth(4.4, 6, y)); return clamp((p.fat * regional - 12) / 50, -.24, 2.4); }
function humanDimensions(p, x, y, z, owner = null) {
    let r = humanRegion(x, y, z, owner), chest = G(y - 12.8, 1.05), waist = G(y - 10.65, 1.0), hip = G(y - 8.95, .85), sum = chest + waist + hip + .00001, wx = (chest * (p.chestWidth / 34 - 1) + waist * (p.waistWidth / 29 - 1) + hip * (p.pelvisWidth / 35 - 1)) / sum, wz = (chest * (p.chestDepth / 24 - 1) + waist * (p.waistDepth / 22 - 1) + hip * (p.pelvisDepth / 26 - 1)) / sum, torso = (1 - r.arm - r.head) * smooth(7.5, 9, y) * (1 - smooth(14, 15, y)), dx = x * wx * torso, dz = z * wz * torso;
    // Move an entire arm with the shoulder; change girth around the leg axis, not the midline.
    dx += Math.sign(x) * (p.shoulderWidth - 43) / 20 * r.arm;
    let thigh = G(y - 6.9, 1.4) * r.leg, center = 1.03 + .10 * smooth(7.1, 8.7, y), girth = p.thighGirth / 55 - 1;
    dx += (x - Math.sign(x) * center) * girth * thigh;
    dz += z * girth * thigh;
    // The hip frame carries the proximal femur; width is not only a torso scaling.
    let hipShift = (p.pelvisWidth - 35) / 45 + (p.asisDistance - 26) / 70 + p.flare * .045;
    dx += Math.sign(x) * hipShift * r.leg * smooth(5.0, 8.1, y);
    let pelvic = G(y - humanBindY(9.4), .85) * (1 - r.arm), crest = (p.asisDistance - 26) / 20 + .06 * p.flare;
    dx += Math.sign(x) * crest * smooth(.45, 1.45, r.ax) * pelvic;
    // The anterior crest height lifts the pelvis region. It fades over long spans (longer above the crest) so
    // the skin between crest and navel, or over the hips when lowered, is not squeezed into a horizontal crease.
    let crestY = humanBindY(9.65), lift = G(y - crestY, y > crestY ? 1.4 : .9);
    let yy = y + (p.asisHeight / 10) * lift * (1 - r.arm) + (anatomy(p).pubis - 8.55) * G(y - humanBindY(8.55), .72) * G(x, .65) * (1 - r.arm - r.head);
    let xx = x + dx, zz = z + dz;
    if (p.tilt) {
        let w = G(y - 9, .95) * (1 - r.arm), a = p.tilt * PI / 180 * w, dy = yy - 9;
        yy = 9 + dy * Math.cos(a) - zz * Math.sin(a);
        zz = dy * Math.sin(a) + zz * Math.cos(a);
    }
    let L = HUMAN_DATA.landmarks, shoulderY = bodyWarpY(p, L.shoulder[0] + (p.shoulderWidth - 43) / 20, L.shoulder[1]) - L.shoulder[1], bodyY = bodyWarpY(p, xx, yy);
    return [xx, mix(bodyY, yy + shoulderY, r.arm), zz];
}
function humanWall(p, y) { let a = anatomy(p), v = smooth(humanBindY(a.pubis) + .05, 12.9, y), inner = p.rectGap / 20, width = p.rectWidth / 10 * (.58 + .42 * v) * (1 + .13 * (p.rectus - 1)); return { inner, width, outer: inner + width, eoInner: inner + width + .12 - .045 * (p.oblique - 1) - .08 * p.obliqueFlesh }; }
function humanInguinalRelief(p, x, y) { if (y < 8.3 || y > 11.3 || Math.abs(x) > 2.5)
    return 0; let side = x < 0 ? -1 : 1, A = humanInguinalPath(p, 0, side, true), B = humanInguinalPath(p, 1, side, true), raw = (y - A[1]) / (B[1] - A[1]); if (raw < -.15 || raw > 1.15)
    return 0; let t = clamp(raw, 0, 1); for (let k = 0; k < 3; k++) {
    let P = humanInguinalPath(p, t, side, true), lo = humanInguinalPath(p, clamp(t - .005, 0, 1), side, true), hi = humanInguinalPath(p, clamp(t + .005, 0, 1), side, true), dy = (hi[1] - lo[1]) / (Math.min(1, t + .005) - Math.max(0, t - .005));
    t = clamp(t - (P[1] - y) / (dy || 1), 0, 1);
} let P = humanInguinalPath(p, t, side, true), lo = humanInguinalPath(p, Math.max(0, t - .005), side, true), hi = humanInguinalPath(p, Math.min(1, t + .005), side, true), slope = (hi[0] - lo[0]) / (hi[1] - lo[1] || 1), d = (x - P[0]) / Math.sqrt(1 + slope * slope), coverage = inguinalLocalThickness(p, t), atten = Math.exp(-coverage / 15), width = .055 + .08 * (1 - p.inguinalGrooveSharpness) + coverage * .0016, depth = p.inguinalDefinition * (.07 + .16 * p.inguinalGrooveSharpness) * atten, ridge = p.supraInguinalVolume * (.045 + .065 * p.oblique) * atten, end = smooth(-.03, .32, raw) * (1 - smooth(.93, 1.04, raw)); return end * (ridge * G(d + side * .105, .16 + coverage * .0018) - depth * G(d, width)); }
function humanShape(p, x, y, z, owner = null) {
    let r = humanRegion(x, y, z, owner), ax = r.ax, front = r.front, arm = r.arm, leg = r.leg, cover = Math.exp(-p.fat / 34), dx = 0, dy = 0, dz = 0;
    // Broad envelopes redistribute fullness without drawing separate round muscle pieces.
    let chest = G(y - (12.9 + .15 * p.pecUpper), .65) * G(ax - (.85 + .12 * p.pecSpread), .65) * (1 - arm) * front;
    dz += .08 * (p.pectoral - 1) * chest + .065 * p.pecUpper * G(y - 13.35, .40) * G(ax - .85, .65) * front;
    dx += Math.sign(x) * .08 * p.pecSpread * chest;
    dx += Math.sign(x) * .055 * p.chestRoundness * G(y - 12.7, 1) * (1 - arm);
    dz += .08 * p.chestRoundness * G(y - 12.7, 1) * front * (1 - arm);
    dx += Math.sign(x) * .12 * p.ribFlare * G(y - 11.85, .50) * smooth(.5, 1.3, ax) * (1 - arm);
    let shift = .18 * p.armBelly, upper = G(y - (12 + shift), .8) * arm * (1 - r.hand);
    dz += .08 * p.armBelly * upper * front;
    dx += Math.sign(x) * .045 * p.armBelly * upper;
    let glute = G(y - (8.8 + .18 * p.gluteFullness), .58) * (1 - front) * (1 - arm);
    dz -= .12 * p.gluteFullness * glute;
    dx += Math.sign(x) * .05 * p.gluteFullness * glute;
    dx += Math.sign(x) * .10 * p.thighSweep * G(y - 6.75, 1.05) * smooth(.8, 1.4, ax) * leg;
    dy += .14 * p.calfBelly * G(y - 3.45, 1.05) * leg;
    dz -= .07 * p.calfBelly * G(y - 3.7, .7) * (1 - front) * leg;
    dz += .085 * (p.proximalThigh - 1.15) * G(y - 8.05, .75) * G(ax - 1.05, .55) * front * leg;
    let abdomen = (1 - arm) * smooth(8.7, 9.4, y) * (1 - smooth(12.7, 13.25, y)) * front, wall = humanWall(p, y), width = wall.width, gap = wall.inner, rectusAbdominis = G(ax - (gap + width * .5), Math.max(.12, width * .42)), bands = 0, levels = rectusBands(p, x).map(humanBindY), centers = levels.map((level, i) => ((i === 0 ? humanBindY(13.05) : levels[i - 1]) + level) * .5);
    for (let center of centers)
        bands += G(y - center, .24);
    let intersections = levels.reduce((sum, level) => sum + G(y - level, .075), 0);
    const authoredShape = p.definition?.muscles?.['rectus_abdominis.' + (x < 0 ? 'L' : 'R')];
    if (authoredShape?.bellies) {
        // The skin and the muscle use the same intervals and per-belly shape.
        // Do not superimpose a fixed six-pack on a different authored architecture.
        const belly = rectusSegmentShape(p, x < 0 ? -1 : 1, humanUnbindY(y), x);
        if (belly) {
            const bellyWidth = width * (1 + (belly.width - 1) * belly.weight);
            const u = clamp((ax - gap) / Math.max(.01, bellyWidth), 0, 1);
            const phase = u < belly.peak ? .5 * u / belly.peak : .5 + .5 * (u - belly.peak) / (1 - belly.peak);
            dz += cover * abdomen * (.08 * Math.sqrt(p.rectus) + .75 * belly.projection / 100) * belly.weight * Math.sin(PI * phase) ** 2;
        }
    } else dz += cover * abdomen * (.115 * p.rectus * rectusAbdominis * (.35 + .65 * clamp(bands, 0, 1)) - .045 * p.tendon * rectusAbdominis * intersections);
    dz += cover * .13 * (p.oblique - 1 + .45 * p.obliqueFlesh) * G(ax - (wall.eoInner + .27), .34) * G(y - 10.55, 1.05) * front * (1 - arm);
    dx += Math.sign(x) * .05 * p.obliqueFlesh * G(y - 10.4, .9) * smooth(.7, 1.3, ax) * (1 - arm);
    dz += humanInguinalRelief(p, x, y) * front * (1 - arm);
    // Mons pubis: the authored surface recedes into a wedge between the thighs above the crotch (y 8.6). A
    // rounded pad keeps the midline forward and curves it under, scaled by the pubic fat control.
    dz += (.75 + .25 * p.pubicFat) * G(x, .30) * (.16 * G(y - 8.66, .12) + .07 * G(y - 8.85, .22)) * front * (1 - arm);
    dz += p.asym * x * .14 * G(y - 11.3, 1.8) * front * (1 - arm - r.head);
    // Regional adipose thickness supplements the authored weight morph, in decimetres.
    let fatAmount = humanFat(p, x, y, z, owner) * .30, axis = mix(0, 1.04, leg);
    axis = mix(axis, 2.75, arm);
    let localX = x - Math.sign(x) * axis, length = Math.hypot(localX, z - .04) || 1, soft = smooth(.8, 2.0, y) * (1 - smooth(13.8, 15, y)) * mix(1, smooth(8.7, 10, y), arm);
    dx += fatAmount * localX / length * soft;
    dz += fatAmount * (z - .04) / length * soft;
    return [x + dx, y + dy, z + dz];
}
function humanInguinalWarp(p, x, y, z, owner = null) { if (owner && owner.arm === 1)
    return [x, y, z]; if (y < 8.3 || y > 11.3 || Math.abs(x) > 2.5 || z < .15)
    return [x, y, z]; let side = x < 0 ? -1 : 1, reference = humanInguinalContext(p).reference, lo = humanPathSample(reference, 0, side), hi = humanPathSample(reference, 1, side); if (y < lo[1] - .45 || y > hi[1] + .45 || Math.abs(x) > 2.0 || z < .15)
    return [x, y, z]; let t = clamp((y - lo[1]) / (hi[1] - lo[1]), 0, 1), A = humanPathSample(reference, t, side), B = humanInguinalPath(p, t, side, true), w = G(x - A[0], .30) * G(y - A[1], .38) * smooth(.15, .65, z) * (1 - (owner?.arm || 0)); return [x + (B[0] - A[0]) * w, y + (B[1] - A[1]) * w, z + (B[2] - A[2]) * w * .45]; }
function humanVertex(p, i) { let base = humanVolumeBase(p); return humanVolumeWarp(humanReferenceVertex(base, i), humanVolumeFields(p), humanRigRegion(i)); }
function humanNavel(p) { if (p.skinModel === 1)
    return bodyWarp(p, [0, 10.25, 1]); return humanVertex(p, HUMAN_DATA.navel * 3); }
function buildHumanSurface(p, originalFitting = false) { let skin = buildHumanReferenceSurface(humanVolumeBase(p)), fields = humanVolumeFields(p, originalFitting); for (let i = 0; i < skin.positions.length; i += 3)
    skin.positions.set(humanVolumeWarp(Array.from(skin.positions.subarray(i, i + 3)), fields, humanRigRegion(i)), i); skin.normals = humanNormals(skin.positions, skin.indices); return skin; }
function buildHumanLayers(p, wanted) { let out = { bones: [], inguinalLigaments: [], externalOblique: [], internalOblique: [], transversusAbdominis: [], rectusAbdominis: [], otherMuscles: [], aponeuroses: [] }; if (!wanted.length)
    return out; out = buildInternals(humanInternalParams(p), wanted); for (let list of Object.values(out))
    for (let m of list)
        registerHumanInternal(p, m); if (wanted.includes('bones')) {
    out.bones = out.bones.filter(m => m.rigRegion !== 'hand');
    let owner = { arm: 1, leg: 0, head: 0, hand: 1 };
    for (let side of [-1, 1])
        for (let chain of Object.values(HUMAN_DATA.landmarks.fingers)) {
            let points = [HUMAN_DATA.landmarks.wrist, ...chain].map(q => humanDimensions(p, side * q[0], q[1], q[2], owner));
            let m = tube(points, .018, 8);
            m.rigRegion = 'hand';
            out.bones.push(m);
        }
} if (wanted.includes('inguinalLigaments'))
    out.inguinalLigaments = [-1, 1].map(side => { const m = tube(Array.from({ length: 49 }, (_, i) => humanInguinalWorldPoint(p, i / 48, side)), .023, 10); m.anatomicalName = 'inguinal_ligament_' + (side < 0 ? 'L' : 'R'); return m; }); return out; }
function humanFitCage(p, skin) {
    let step = .07, groups = {};
    function group(x, y, arm, leg, head) { return head > .5 ? 'head' : arm > .65 ? (x < 0 ? 'leftArm' : 'rightArm') : leg > .65 && y < 9.25 ? (x < 0 ? 'leftLeg' : 'rightLeg') : 'torso'; }
    let pos = skin.positions, ids = skin.indices;
    for (let j = 0; j < ids.length; j += 3) {
        let vs = [ids[j], ids[j + 1], ids[j + 2]], a = vs.map(i => Array.from(pos.subarray(i * 3, i * 3 + 3))), r = vs.map(i => humanRigRegion(i * 3)), x = a.reduce((s, v) => s + v[0], 0) / 3, y = a.reduce((s, v) => s + v[1], 0) / 3, key = group(x, y, r.reduce((s, v) => s + v.arm, 0) / 3, r.reduce((s, v) => s + v.leg, 0) / 3, r.reduce((s, v) => s + v.head, 0) / 3), bins = groups[key] || (groups[key] = []), lo = Math.ceil(Math.min(...a.map(v => v[1])) / step), hi = Math.floor(Math.max(...a.map(v => v[1])) / step);
        for (let b = lo; b <= hi; b++) {
            let yy = b * step, points = [];
            for (let k = 0; k < 3; k++) {
                let A = a[k], B = a[(k + 1) % 3];
                if ((A[1] <= yy && B[1] > yy) || (B[1] <= yy && A[1] > yy)) {
                    let t = (yy - A[1]) / (B[1] - A[1]);
                    points.push([mix(A[0], B[0], t), mix(A[2], B[2], t)]);
                }
            }
            if (points.length === 2) {
                (bins[b] || (bins[b] = [])).push(points);
                if (key === 'torso' && yy < 9.8 && Math.abs(x) > .3) {
                    let legKey = x < 0 ? 'leftLeg' : 'rightLeg', legBins = groups[legKey] || (groups[legKey] = []);
                    (legBins[b] || (legBins[b] = [])).push(points);
                }
            }
        }
    }
    let L = HUMAN_DATA.landmarks, centers = {};
    function axis(key, y) { let edges = groups[key]?.[Math.round(y / step)]; if (edges?.length && (key !== 'torso')) {
        let id = key + ':' + Math.round(y / step);
        if (centers[id])
            return centers[id];
        let pts = edges.flat();
        return centers[id] = [(Math.min(...pts.map(v => v[0])) + Math.max(...pts.map(v => v[0]))) / 2, (Math.min(...pts.map(v => v[1])) + Math.max(...pts.map(v => v[1]))) / 2];
    } if (key === 'torso')
        return [0, 0]; if (key === 'head')
        return [0, .03]; let side = key.startsWith('left') ? -1 : 1, arm = key.endsWith('Arm'), A = arm ? L.shoulder : L.hip, B = arm ? L.elbow : L.knee, C = arm ? L.wrist : L.ankle, owner = arm ? { arm: 1, leg: 0, head: 0, hand: 0 } : { arm: 0, leg: 1, head: 0, hand: 0 }, pts = [A, B, C].map(v => humanDimensions(p, side * v[0], v[1], v[2], owner)), u = y > pts[1][1] ? pts[0] : pts[1], v = y > pts[1][1] ? pts[1] : pts[2], t = clamp((y - u[1]) / (v[1] - u[1]), 0, 1); return [mix(u[0], v[0], t), mix(u[2], v[2], t)]; }
    // Index each section once, lazily. Sectors only select candidates; the exact
    // segment/ray intersection below remains unchanged, including edge order.
    const sectors = 96, angleStep = 2 * PI / sectors, angularSections = new Map();
    const sector = angle => ((Math.floor(angle / angleStep) % sectors) + sectors) % sectors;
    function candidates(key, b, edges, c, dx, dz) {
        const id = key + ':' + b;
        let indexed = angularSections.get(id);
        if (!indexed) {
            indexed = new Array(sectors);
            for (const edge of edges) {
                const ax = edge[0][0] - c[0], az = edge[0][1] - c[1], bx = edge[1][0] - c[0], bz = edge[1][1] - c[1];
                let a = Math.atan2(az, ax), z = Math.atan2(bz, bx);
                while (z - a > PI) z -= 2 * PI;
                while (z - a < -PI) z += 2 * PI;
                // Segments touching/crossing the axis need every direction.
                if (ax * ax + az * az < 1e-16 || bx * bx + bz * bz < 1e-16 || Math.abs(z - a) > PI - 1e-8) {
                    for (let s = 0; s < sectors; s++) (indexed[s] ??= []).push(edge);
                } else {
                    // A sector of padding at each end keeps boundary/rounding
                    // cases conservative, including the -PI/PI seam.
                    const lo = Math.floor(Math.min(a, z) / angleStep) - 1, hi = Math.floor(Math.max(a, z) / angleStep) + 1;
                    for (let s = lo; s <= hi; s++) (indexed[((s % sectors) + sectors) % sectors] ??= []).push(edge);
                }
            }
            angularSections.set(id, indexed);
        }
        return indexed[sector(Math.atan2(dz, dx))] ?? [];
    }
    function radius(key, y, dx, dz) { let bins = groups[key], b = Math.round(y / step), edges = bins?.[b]; if (!edges)
        return null; let c = axis(key, b * step), best = 0; for (let [A, B] of candidates(key, b, edges, c, dx, dz)) {
        let ex = B[0] - A[0], ez = B[1] - A[1], ax = A[0] - c[0], az = A[1] - c[1], den = dx * ez - dz * ex;
        if (Math.abs(den) < 1e-9)
            continue;
        let t = (ax * ez - az * ex) / den, u = (ax * dz - az * dx) / den;
        if (t > 0 && u >= 0 && u <= 1)
            best = Math.max(best, t);
    } return best > 0 ? best : null; }
    return { groups, axis, radius, step };
}
// Pulls in only the vertices outside the body. Around the hips a point may lie in the trunk's or a leg's
// section, so it is inside when any of them contains it; otherwise it moves to the closest containing one.
function capToSkin(m, cage, margin) {
    const a = m.positions;
    for (let i = 0; i < a.length; i += 3) {
        let best = null;
        // The likeliest section first: most vertices are inside it and stop there.
        for (const key of a[i + 1] > 9.25 ? ['torso', 'leftLeg', 'rightLeg'] : a[i] < 0 ? ['leftLeg', 'torso', 'rightLeg'] : ['rightLeg', 'torso', 'leftLeg']) {
            const c = cage.axis(key, a[i + 1]), dx = a[i] - c[0], dz = a[i + 2] - c[1], r = Math.hypot(dx, dz), limit = r > 1e-5 ? cage.radius(key, a[i + 1], dx / r, dz / r) : null;
            if (limit === null)
                continue;
            const allowed = Math.max(.001, limit - Math.min(margin, limit * .2));
            if (r <= allowed) {
                best = null;
                break;
            }
            if (!best || allowed / r > best.k)
                best = { k: allowed / r, c, dx, dz };
        }
        if (best) {
            a[i] = best.c[0] + best.dx * best.k;
            a[i + 2] = best.c[1] + best.dz * best.k;
        }
    }
    m.normals = humanNormals(a, m.indices);
}
function fitHumanInternal(m, key, cage, margin = .035, local = false) {
    let a = m.positions, ratios = [], samples = 0;
    for (let i = 0; i < a.length; i += 3) {
        let c = cage.axis(key, a[i + 1]), dx = a[i] - c[0], dz = a[i + 2] - c[1], r = Math.hypot(dx, dz);
        if (r < .001)
            continue;
        let limit = cage.radius(key, a[i + 1], dx / r, dz / r);
        if (limit !== null) {
            ratios.push(Math.max(.00001, limit - Math.min(margin, limit * .2)) / r);
            samples++;
        }
    }
    // A single continuous radial transform retains each muscle's belly and tendons.
    ratios.sort((a, b) => a - b);
    let scale = Math.min(1, ratios[0] ?? 1);
    for (let i = 0; i < a.length; i += 3) {
        let c = cage.axis(key, a[i + 1]), dx = a[i] - c[0], dz = a[i + 2] - c[1], r = Math.hypot(dx, dz), s = scale;
        if (local && r > .00001) {
            let lim = cage.radius(key, a[i + 1], dx / r, dz / r);
            s = 1;
            if (lim !== null) {
                let R = lim - Math.min(margin, lim * .2), u = r / R;
                s = u < .65 ? 1 : (.65 + .35 * Math.tanh((u - .65) / .35)) / u;
            }
        }
        a[i] = c[0] + dx * s;
        a[i + 2] = c[1] + dz * s;
    }
    m.fit = { region: key, scale, samples };
    m.normals = humanNormals(a, m.indices);
    return m;
}
// Soft local fit applied only towards the insertion, so the belly keeps its thickness.
function fitTendonEnd(m, key, cage, margin) {
    let a = m.positions;
    for (let i = 0; i < a.length; i += 3) {
        let w = smooth(.45, .85, m.longitudinal?.[i / 3] ?? 1), c = cage.axis(key, a[i + 1]), dx = a[i] - c[0], dz = a[i + 2] - c[1], r = Math.hypot(dx, dz);
        if (w <= 0 || r < 1e-5)
            continue;
        let lim = cage.radius(key, a[i + 1], dx / r, dz / r);
        if (lim === null)
            continue;
        let R = lim - Math.min(margin, lim * .2), u = r / R, s = u < .65 ? 1 : (.65 + .35 * Math.tanh((u - .65) / .35)) / u;
        s = mix(1, s, w);
        a[i] = c[0] + dx * s;
        a[i + 2] = c[1] + dz * s;
    }
    m.fit = { region: key, scale: 1, samples: 0 };
    m.normals = humanNormals(a, m.indices);
}
// Pelvic bones lie just under thin covering at the pubis and crest; local compression flattens them into
// ribbons, so they are fitted as wholes and keep their sections.
function rigidPelvicBone(m) { return /^(pubic_|ischial_|ilium_|iliac_crest_|acetabular_rim_|hip_bone_)/.test(m.anatomicalName ?? ''); }
function fitHumanLayers(p, out, cage) { for (let [layer, list] of Object.entries(out))
    for (let m of list) {
        if (m.rigRegion === 'hand')
            continue;
        let a = m.positions, x = 0, y = 0;
        for (let i = 0; i < a.length; i += 3) {
            x += a[i];
            y += a[i + 1];
        }
        x /= a.length / 3;
        y /= a.length / 3;
        let key = m.rigRegion === 'arm' ? (x < 0 ? 'leftArm' : 'rightArm') : (m.rigRegion === 'leg' || y < 8.85 && Math.abs(x) > .35 || /^(gluteus_|tensor_fasciae)/.test(m.anatomicalName ?? '')) ? (x < 0 ? 'leftLeg' : 'rightLeg') : y > 15 ? 'head' : 'torso';
        // The psoas lies deep beside the spine and pelvic brim; a whole-mesh shrink toward the trunk axis would
        // collapse it. The measured pelvis is already mapped onto the body's landmarks: only what passes the
        // skin is pulled in (local fit).
        if (/^psoas_major_/.test(m.anatomicalName ?? ''))
            continue;
        if (m.landmarkMapped) {
            capToSkin(m, cage, .065);
            continue;
        }
        // Pectoral fans are placed by restOnThorax; a whole-muscle shrink would cancel their hypertrophy.
        if (/^pectoralis_major_/.test(m.anatomicalName ?? '')) {
            fitTendonEnd(m, key, cage, .045);
            continue;
        }
        // Wrapping abdominal sheets would be shrunk inside the ribs by one whole-muscle scale; fit them locally.
        // The deltoid cap wraps the shoulder; a whole-muscle shrink would flatten it like the abdominal sheets.
        const local = (m.shellPairs && m.rigRegion || ['bones', 'inguinalLigaments', 'externalOblique', 'internalOblique', 'transversusAbdominis'].includes(layer) || /^(deltoid|trapezius|latissimus|rhomboid|supraspinatus|infraspinatus|teres|erector_|thoracolumbar_fascia|gluteus_|tensor_fasciae)/.test(m.anatomicalName ?? '')) && !rigidPelvicBone(m);
        fitHumanInternal(m, key, cage, layer === 'bones' || layer === 'inguinalLigaments' ? .07 : .045, local);
    } return out; }
// Fitting scales each muscle as a whole while bones compress locally, which can sink broad thoracic (pectoral, trapezius)
// muscles into the ribs. Lift each shell column so its deep surface clears the fitted cage and upper abdominal wall.
// Linea alba and tendinous intersections sit just below the domes of the fitted rectus bellies, in the
// grooves between them, whatever separate scale the fitting gave each mesh.
function seatInRectusGrooves(aponeuroses, rectus) {
    const step = .04, sectors = 360, top = new Map(), key = (b, s) => b * sectors + s, sector = (x, z) => Math.floor((Math.atan2(x, z) / (2 * PI) + .5) * sectors);
    for (let m of rectus)
        for (let i = 0; i < (m.shellPairs ?? m.positions.length / 3) * 3; i += 3) {
            let a = m.positions, k = key(Math.round(a[i + 1] / step), sector(a[i], a[i + 2])), r = Math.hypot(a[i], a[i + 2]);
            if (!(top.get(k) >= r))
                top.set(k, r);
        }
    for (let m of aponeuroses) {
        let name = m.anatomicalName ?? '', linea = name.startsWith('linea_alba_');
        if (!m.shellPairs || !(linea || name.startsWith('tendinous_intersection_')))
            continue;
        // The linea alba follows the medial rectus edges; intersections follow the nearby belly surface.
        let a = m.positions, n = m.shellPairs, spread = linea ? 6 : 1, recess = linea ? .006 : .012;
        for (let v = 0; v < n; v++) {
            let o = v * 3, b = Math.round(a[o + 1] / step), s = sector(a[o], a[o + 2]), surface = linea ? Infinity : 0;
            for (let db = -1; db <= 1; db++)
                for (let ds = -spread; ds <= spread; ds++) {
                    let r = top.get(key(b + db, s + ds));
                    if (r !== undefined)
                        surface = linea ? Math.min(surface, r) : Math.max(surface, r);
                }
            if (surface === Infinity)
                surface = 0;
            let r = Math.hypot(a[o], a[o + 2]);
            if (!surface || r < 1e-6)
                continue;
            let scale = (surface - recess) / r, i = (v + n) * 3, ri = Math.hypot(a[i], a[i + 2]), target = ri + (surface - recess - r);
            a[o] *= scale;
            a[o + 2] *= scale;
            if (ri > 1e-6) {
                a[i] *= target / ri;
                a[i + 2] *= target / ri;
            }
        }
        m.normals = humanNormals(a, m.indices);
    }
}
// The trunk registration scales each height by the scanned body's section, which ripples broad sheets that
// cross many heights (the gluteals). Relax each shell layer over its grid, keeping the border rows and columns.
function relaxShell(m, passes) {
    const n = m.shellPairs, cols = m.surfaceGrid.cols + 1, rows = n / cols, a = m.positions;
    for (let k = 0; k < passes; k++)
        for (let layer = 0; layer < 2; layer++) {
            const base = layer * n, copy = a.slice(base * 3, (base + n) * 3);
            for (let r = 1; r < rows - 1; r++)
                for (let c = 1; c < cols - 1; c++)
                    for (let d = 0; d < 3; d++) {
                        const at = (rr, cc) => copy[(rr * cols + cc) * 3 + d];
                        a[(base + r * cols + c) * 3 + d] = .5 * at(r, c) + .125 * (at(r - 1, c) + at(r + 1, c) + at(r, c - 1) + at(r, c + 1));
                    }
        }
    m.normals = humanNormals(a, m.indices);
}
function restOnThorax(muscles, cage, skinCage = null, clearance = .015, skinMargin = .03) {
    const step = .05, sectors = 96, floor = new Map(), key = (b, s) => b * sectors + ((s % sectors) + sectors) % sectors, sector = (x, z) => Math.floor((Math.atan2(x, z) / (2 * PI) + .5) * sectors);
    for (let m of cage)
        if (/^(rib_|costal_cartilage_|sternum|scapula|rectus_abdominis_|externalOblique|erector_|latissimus)/.test(m.anatomicalName ?? ''))
            for (let i = 0; i < m.positions.length; i += 3) {
                let a = m.positions, k = key(Math.round(a[i + 1] / step), sector(a[i], a[i + 2])), r = Math.hypot(a[i], a[i + 2]);
                if (!(floor.get(k) >= r))
                    floor.set(k, r);
            }
    if (!floor.size)
        return;
    for (let m of muscles) {
        if (!m.shellPairs || !/^(pectoralis_major_|trapezius_|latissimus|rhomboid|supraspinatus|infraspinatus|teres|erector_|thoracolumbar_fascia)/.test(m.anatomicalName ?? ''))
            continue;
        let a = m.positions, n = m.shellPairs, cols = m.surfaceGrid.cols + 1, rows = n / cols, need = new Float32Array(n);
        for (let v = 0; v < n; v++) {
            let i = (v + n) * 3, b = Math.round(a[i + 1] / step), s = sector(a[i], a[i + 2]), limit = 0;
            for (let db = -1; db <= 1; db++)
                for (let ds = -1; ds <= 1; ds++)
                    limit = Math.max(limit, floor.get(key(b + db, s + ds)) ?? 0);
            if (limit)
                need[v] = Math.max(0, limit + clearance - Math.hypot(a[i], a[i + 2]));
        }
        // Binned floors are stepped; dilate then blur the lift so the belly stays smooth.
        let lift = need.slice();
        const pass = (fn) => { let next = new Float32Array(n); for (let r = 0; r < rows; r++)
            for (let c = 0; c < cols; c++) {
                let acc = [];
                for (let dr = -1; dr <= 1; dr++)
                    for (let dc = -1; dc <= 1; dc++) {
                        let rr = r + dr, cc = c + dc;
                        if (rr >= 0 && rr < rows && cc >= 0 && cc < cols)
                            acc.push(lift[rr * cols + cc]);
                    }
                next[r * cols + c] = fn(acc);
            } lift = next; };
        for (let k = 0; k < 2; k++)
            pass(acc => Math.max(...acc));
        for (let k = 0; k < 4; k++)
            pass(acc => acc.reduce((x, y) => x + y, 0) / acc.length);
        for (let v = 0; v < n; v++) {
            let d = Math.max(lift[v], need[v], 0), i = (v + n) * 3, o = v * 3, r = Math.hypot(a[i], a[i + 2]), ro = Math.hypot(a[o], a[o + 2]);
            if (r < 1e-6 || ro < 1e-6)
                continue;
            // Near subcutaneous bone the muscle thins under the skin rather than passing through it.
            let skin = skinCage?.radius('torso', a[o + 1], a[o] / ro, a[o + 2] / ro), outerR = ro + d, innerR = r + d;
            // Above the shoulders the neck/head skin bounds the muscle, measured from that group's own centre.
            if (!skin && skinCage) {
                const c = skinCage.axis('head', a[o + 1]), hx = a[o] - c[0], hz = a[o + 2] - c[1], hd = Math.hypot(hx, hz), limit = hd > 1e-6 ? skinCage.radius('head', a[o + 1], hx / hd, hz / hd) : null;
                if (limit && hd > limit - skinMargin) {
                    const k = (limit - skinMargin) / hd, ix = a[i] - c[0], iz = a[i + 2] - c[1];
                    a[o] = c[0] + hx * k; a[o + 2] = c[1] + hz * k;
                    a[i] = c[0] + ix * Math.min(1, k * .97); a[i + 2] = c[1] + iz * Math.min(1, k * .97);
                }
                continue;
            }
            // Tendons running into the arm are exempt only while they are actually inside the arm's skin.
            let cap = 1 - smooth(.60, .85, m.longitudinal?.[v] ?? 0);
            if (cap < 1 && skinCage) {
                const arm = a[o] < 0 ? 'leftArm' : 'rightArm', c = skinCage.axis(arm, a[o + 1]), dx = a[o] - c[0], dz = a[o + 2] - c[1], dist = Math.hypot(dx, dz), limit = dist > 1e-6 ? skinCage.radius(arm, a[o + 1], dx / dist, dz / dist) : null;
                if (!limit || dist > limit - .02)
                    cap = 1;
            }
            if (skin && cap > 0) {
                outerR = mix(outerR, Math.min(outerR, skin - skinMargin), cap);
                innerR = Math.min(innerR, outerR - .006);
            }
            for (let [j, target, q] of [[o, outerR, ro], [i, innerR, r]]) {
                a[j] *= target / q;
                a[j + 2] *= target / q;
            }
        }
        m.normals = humanNormals(a, m.indices);
    }
}
// Cross-section area centroids of the default authored skin at 4 cm intervals (10 cm units).
// The skin's elbow was 12 mm forward of the bone axis and its upper arm curved backwards.
// Translate sections onto the skeletal rest axes; preserve section shape, hands and shoulder attachment.
const ARM_REST_SECTIONS = [[9.2, 3.00734, .08433], [9.6, 2.94589, .08507], [10, 2.88217, .08620], [10.4, 2.81489, .09468], [10.8, 2.75135, .11717], [11.2, 2.70167, .14282], [11.6, 2.63711, .19091], [12, 2.48639, .16037], [12.4, 2.34576, .10495], [12.8, 2.18453, .04431], [13.2, 2.04067, .00675], [13.6, 1.95977, .06547]];
let ARM_REST_OFFSETS = null;
function humanArmRestOffset(y) {
    const L = HUMAN_DATA.landmarks;
    if (!ARM_REST_OFFSETS) ARM_REST_OFFSETS = [[L.wrist[1], 0, 0], ...ARM_REST_SECTIONS.map(([y, x, z]) => {
        const A = y > L.elbow[1] ? L.elbow : L.wrist, B = y > L.elbow[1] ? L.shoulder : L.elbow, t = (y - A[1]) / (B[1] - A[1]);
        return [y, mix(A[0], B[0], t) - x, mix(A[2], B[2], t) - z];
    }), [L.shoulder[1], 0, 0]];
    return interpolate(ARM_REST_OFFSETS, y);
}
function humanReferenceVertex(p, i) { let x = HUMAN_DATA.positions[i], y = HUMAN_DATA.positions[i + 1], z = HUMAN_DATA.positions[i + 2], r = humanRigRegion(i), mu = humanMuscle(p, x, y, z, r), fa = humanFat(p, x, y, z, r), a = [x, y, z].map((v, k) => v + mu * HUMAN_DATA.muscle[i + k] + fa * HUMAN_DATA.fat[i + k]);
    if (p.definition?.muscles?.['rectus_abdominis.' + (x < 0 ? 'L' : 'R')]?.bellies) {
        const navel = HUMAN_DATA.navel * 3;
        const preserveNavel = 1 - G(x - HUMAN_DATA.positions[navel], .18) * G(y - HUMAN_DATA.positions[navel + 1], .18);
        const abdomen = smooth(8.9, 9.45, y) * (1 - smooth(12.65, 13.1, y)) *
            (1 - smooth(.95, 1.25, Math.abs(x))) * smooth(.15, .65, z) * (1 - r.arm - r.head) * preserveNavel;
        a[2] -= mu * HUMAN_DATA.muscle[i + 2] * abdomen;
    }
    const offset = humanArmRestOffset(y);
    a[0] += Math.sign(x) * offset[0] * r.arm;
    a[2] += offset[1] * r.arm;
    a = humanInguinalWarp(p, ...a, r); a = humanShape(p, ...a, r); return humanDimensions(p, ...a, r); }
function buildHumanReferenceSurface(p) { let positions = new Float32Array(HUMAN_DATA.positions.length), indices = Uint32Array.from(HUMAN_DATA.indices); for (let i = 0; i < positions.length; i += 3)
    positions.set(humanReferenceVertex(p, i), i); return { positions, normals: humanNormals(positions, indices), indices }; }
// Muscles are generated at neutral volume; volume fields then grow muscles and skin together. Per-part growth
// follows the same rule, except the keys whose generators and skin relief apply growth directly.
function humanVolumeBase(p) { let q = { ...p }; for (let k of ['biceps', 'triceps', 'deltoid', 'forearm', 'pectoral', 'back', 'rectus', 'oblique', 'gluteMax', 'gluteMed', 'quadriceps', 'hamstrings', 'adductors', 'calves', 'shin'])
    q[k] = 1; if (p.individualGrowth)
    q.individualGrowth = Object.fromEntries(Object.entries(p.individualGrowth).filter(([key]) => directGrowthKeys.has(key))); return q; }
function humanVolumeFields(p, originalFitting = false) {
    let L = HUMAN_DATA.landmarks, fields = [];
    function field(key, A, B, dir, region, radius, gain = .75, value = p[key]) { if (value === 1)
        return; let axis = sub(B, A), len = Math.hypot(...axis); fields.push({ key, A, side: Math.sign(A[0]), axis: mul(axis, 1 / len), len, dir, region, radius, gain: gain * (Math.sqrt(value) - 1) }); }
    // Per-part hypertrophy: one field per procedural muscle, along its own origin → insertion.
    const growth = Object.entries(p.individualGrowth ?? {}).filter(([key, value]) => value !== 1 && !directGrowthKeys.has(key));
    if (growth.length) {
        const neutral = { ...humanInternalParams(p), individualGrowth: {} }, wanted = new Map(growth);
        for (let side of [-1, 1])
            for (let m of [...upperMuscles(neutral, side), ...lowerMuscles(neutral, side), ...backMuscleAxes(neutral, side), ...supplementalMuscleAxes(neutral, side)]) {
                if (!wanted.has(m.name))
                    continue;
                const arm = !m.lower && (m.rigRegion === 'arm' || /^(deltoid|biceps|triceps|brachialis|brachioradialis|forearm)/.test(m.name)), owner = m.lower ? { arm: 0, leg: 1, head: 0, hand: 0 } : arm ? { arm: 1, leg: 0, head: 0, hand: 0 } : null;
                const posterior = atlas.legacy[m.name]?.some(id => posteriorMuscles.has(id));
                field(m.name, humanInternalPoint(p, m.origin, owner), humanInternalPoint(p, m.insertion, owner), null, m.lower ? (m.name.startsWith('gluteus') ? 'pelvis' : 'leg') : arm ? 'arm' : posterior ? 'back' : 'torso', 2.2 * Math.max(m.r[0], m.r[2]), .75, wanted.get(m.name));
            }
    }
    for (let side of [-1, 1]) {
        let arm = { arm: 1, leg: 0, head: 0, hand: 0 }, leg = { arm: 0, leg: 1, head: 0, hand: 0 }, map = (v, r) => humanDimensions(p, side * v[0], v[1], v[2], r), S = map(L.shoulder, arm), E = map(L.elbow, arm), W = map(L.wrist, arm), H = map(L.hip, leg), K = map(L.knee, leg), N = map(L.ankle, leg);
        field('biceps', S, E, [0, 0, 1], 'arm', 1.25);
        field('triceps', S, E, [0, 0, -1], 'arm', 1.25);
        field('deltoid', add(S, mul(sub(S, E), .12)), add(S, mul(sub(E, S), .52)), [side, 0, 0], 'arm', 1.3, .9);
        field('forearm', E, W, null, 'arm', .95);
        field('quadriceps', H, K, [0, 0, 1], 'leg', 1.55);
        field('hamstrings', H, K, [0, 0, -1], 'leg', 1.55);
        field('adductors', H, K, [-side, 0, 0], 'leg', 1.55);
        field('calves', K, N, [0, 0, -1], 'leg', 1);
        field('shin', K, N, [0, 0, 1], 'leg', 1, .6);
        let pelvis = map([L.hip[0], 9.85, -.20], leg), bottom = map([L.hip[0], 7.95, -.20], leg);
        field('gluteMax', pelvis, bottom, [0, 0, -1], 'pelvis', 1.6, .65);
        field('gluteMed', map([L.hip[0], 10.0, -.1], leg), map([L.hip[0], 8.55, -.1], leg), [side, 0, 0], 'pelvis', 1.6, .85);
        let T = (x, y, z) => humanDimensions(p, side * x, y, z, { arm: 0, leg: 0, head: 0, hand: 0 });
        field('pectoral', T(.72, 13.95, 0), T(.72, 12.0, 0), [0, 0, 1], 'torso', 1.7, .35);
        field('back', T(.68, 14.05, 0), T(.68, 10.25, 0), [0, 0, -1], originalFitting ? 'torso' : 'back', 1.9, .35);
        field('rectus', T(.38, 12.95, 0), T(.38, humanBindY(8.55), 0), [0, 0, 1], 'rectusAbdominis', 1.6, .25);
        if (fields[fields.length - 1]?.key === 'rectus') fields[fields.length - 1].rectusExposure = (x, y) => rectusGrowthExposure(p, x, y);
        field('oblique', T(1.12, 12.65, 0), T(1.12, 9.55, 0), [side * .65, 0, .75], 'oblique', 1.65, .7);
    }
    return fields;
}
const sidedVolumeRegions = new Set(['arm', 'leg', 'pelvis', 'back']);
/** Axis-aligned bounds of a field's influence cylinder. Points outside it receive no displacement. */
function volumeFieldBox(f) {
    if (f.box) return f.box;
    const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], margin = f.radius + 1e-6;
    for (let k = 0; k < 3; k++) {
        const end = f.A[k] + f.axis[k] * f.len;
        box[k] = Math.min(f.A[k], end) - margin;
        box[k + 3] = Math.max(f.A[k], end) + margin;
    }
    f.sided = sidedVolumeRegions.has(f.region);
    return f.box = box;
}
function humanVolumeStep(v, fields, owner = null, step = 1) {
    let dx = 0, dy = 0, dz = 0, x = v[0], y = v[1], z = v[2], r;
    for (let f of fields) {
        const box = volumeFieldBox(f);
        if (x < box[0] || y < box[1] || z < box[2] || x > box[3] || y > box[4] || z > box[5])
            continue;
        if (f.sided && x * f.side <= 0)
            continue;
        if (!r) {
            r = humanRegion(x, y, z, owner);
            if (r.hand > .95 || r.head > .95)
                return v;
        }
        let mask = f.region === 'arm' ? r.arm * (1 - r.hand) : f.region === 'leg' ? r.leg : f.region === 'pelvis' ? (1 - r.arm - r.head) : 1 - r.arm - r.leg - r.head;
        if (f.region === 'back') mask *= 1 - smooth(-.05, .15, z);
        if (mask <= .0001)
            continue;
        let qx = x - f.A[0], qy = y - f.A[1], qz = z - f.A[2], ax = f.axis[0], ay = f.axis[1], az = f.axis[2], u = qx * ax + qy * ay + qz * az, t = u / f.len;
        if (t <= 0 || t >= 1)
            continue;
        let rx = qx - ax * u, ry = qy - ay * u, rz = qz - az * u, rho = Math.hypot(rx, ry, rz);
        if (rho < .00001 || rho >= f.radius)
            continue;
        let angular = f.dir ? smooth(-.25, .75, (rx * f.dir[0] + ry * f.dir[1] + rz * f.dir[2]) / rho) : 1;
        let belly = Math.sin(Math.PI * t) ** 2, sideFade = f.sided ? smooth(0, .2, x * f.side) : 1, fall = 1 - smooth(f.radius * .72, f.radius, rho), w = mask * belly * angular * fall * f.gain * sideFade;
        if (f.region === 'rectusAbdominis')
            w *= (1 - smooth(.65, .95, Math.abs(x))) * f.rectusExposure(x, y);
        if (f.region === 'oblique')
            w *= smooth(.55, .9, Math.abs(x));
        dx += rx * w;
        dy += ry * w;
        dz += rz * w;
    }
    return [x + dx * step, y + dy * step, z + dz * step];
}
function humanVolumeWarp(v, fields, owner = null) { if (!fields.length)
    return v; for (let i = 0; i < 6; i++)
    v = humanVolumeStep(v, fields, owner, 1 / 6); return v; }
// Abdominal/pectoral growth belongs to its own belly and covering. Neighbours respond through
// the optional attachment/contact solver, not by inheriting another muscle's volume field.
function followsRectus(layer, m) {
    return layer === 'rectusAbdominis' || layer === 'aponeuroses' && /^(linea_alba_|tendinous_intersection_|abdominal_aponeurosis_|pubic_sheath_)/.test(m.anatomicalName ?? '');
}
function followsPectoral(layer, m) {
    return layer === 'otherMuscles' && /^pectoralis_(major|minor)_/.test(m.anatomicalName ?? '');
}
function followsOblique(layer, m) {
    return ['externalOblique', 'internalOblique', 'transversusAbdominis'].includes(layer) || layer === 'aponeuroses' && /^(abdominal_aponeurosis_|pubic_sheath_)/.test(m.anatomicalName ?? '');
}
const cageBytes = cage => Object.values(cage.groups).reduce((sum: number, bins: any[]) => sum + bins.reduce((n, edges) => n + (edges?.length ?? 0) * 192 + 800, 0), 0);
function cachedHumanSkinCage(p, originalFitting = false) {
    return anatomySupportCache.getOrCreate('skin-cage:' + originalFitting + ':' + supportParameterKey(p),
        () => { const parameters = structuredClone(p); return humanFitCage(parameters, buildHumanSurface(parameters, originalFitting)); }, cageBytes);
}
function cachedThoracicSupport(p) {
    // These meshes are only sampled as supports, never edited or returned to the main thread.
    return anatomySupportCache.getOrCreate('thoracic:' + supportParameterKey(p),
        () => buildHumanVolumeLayers(p, ['thoracicCage', 'rectusAbdominis', 'externalOblique']), supportMeshBytes);
}
/** Support layers whose build does not read fitted rectus intersections or bellies. */
const grooveIndependentLayers = new Set(['bones', 'otherMuscles', 'inguinalLigaments', 'abdominalCovering']);
function buildHumanVolumeLayers(p, wanted, deferredGrowth?: { deltoid: boolean; latissimus: boolean }): Record<string, import('./contracts').AnatomyMesh[]> {
    const base = humanVolumeBase(p), recipe = { ...base, pectoralMuscle: p.pectoral }, recipeKey = supportParameterKey(recipe);
    const hasFittedIntersections = Object.values(base.definition?.muscles ?? {}).some(shape => shape?.fittedIntersections || shape?.fittedBellies);
    const supportBase = hasFittedIntersections ? {
        ...base,
        definition: { ...base.definition, muscles: Object.fromEntries(Object.entries(base.definition.muscles)
            .map(([id, shape]) => [id, shape ? { ...shape, fittedIntersections: undefined, fittedBellies: undefined } : shape])) },
    } : base;
    // Fitted rectus grooves only shape the abdominal wall. Layers away from it are built from the
    // groove-free recipe, like the reference cage, so refitting the grooves reuses them.
    const supportRecipe = supportBase === base ? recipe : { ...supportBase, pectoralMuscle: p.pectoral };
    let supportRecipeKey: string | undefined;
    const build = (layers: string[]) => {
        const grooveFree = supportBase !== base && layers.every(layer => grooveIndependentLayers.has(layer));
        const source = grooveFree ? supportBase : base, layerRecipe = grooveFree ? supportRecipe : recipe;
        const key = grooveFree ? supportRecipeKey ??= supportParameterKey(supportRecipe) : recipeKey;
        return anatomySupportCache.getOrCreate('fitted:' + layers.join(',') + ':' + key, () => {
        const cage = anatomySupportCache.getOrCreate('reference-cage:' + supportParameterKey(supportBase), () => humanFitCage(supportBase, buildHumanReferenceSurface(supportBase)), cageBytes);
        const out = fitHumanLayers(source, buildHumanLayers(layerRecipe, layers), cage);
        if (out.bones.length || out.inguinalLigaments.length) {
            let minimum = { ...supportBase };
            for (let k of ['biceps', 'triceps', 'deltoid', 'forearm', 'pectoral', 'back', 'rectus', 'oblique', 'gluteMax', 'gluteMed', 'quadriceps', 'hamstrings', 'adductors', 'calves', 'shin'])
                minimum[k] = .2;
            let cage = cachedHumanSkinCage(minimum, isOriginalAbdomen(p));
            for (let m of [...out.bones, ...out.inguinalLigaments])
                if (m.fit)
                    fitHumanInternal(m, m.fit.region, cage, .085, !rigidPelvicBone(m));
        }
        return out;
        }, supportMeshBytes);
    };
    // One cache entry per layer: every mesh is fitted to the reference skin on its own, so showing
    // another layer builds only that layer. The thoracic support keeps one combined build (its
    // cage-only bones are part of that recipe). Copy before growth, seating and worker transfer:
    // cached buffers must remain intact.
    const unique = [...new Set(wanted as string[])].sort();
    // A layer built alone can also add the named meshes it depends on (the pectoral fans come with
    // the rectus): those are identical in every part, so a named mesh is taken once.
    // A list takes its own layer's part first, which keeps the order of a combined build.
    const combined = unique.includes('thoracicCage') || unique.length < 2;
    const parts = combined ? [build(unique)] : unique.map(layer => build([layer]));
    const merged: Record<string, import('./contracts').AnatomyMesh[]> = {};
    if (!combined) for (const layer of ['bones', 'inguinalLigaments', 'externalOblique', 'internalOblique', 'transversusAbdominis', 'rectusAbdominis', 'otherMuscles', 'aponeuroses']) {
        const own = unique.indexOf(layer), into = merged[layer] = [], names = new Set<string>();
        for (const part of own < 0 ? parts : [parts[own], ...parts.filter((_, i) => i !== own)]) {
            const list = (part[layer] ?? []).filter(m => !m.anatomicalName || !names.has(m.anatomicalName));
            for (const m of list) { if (m.anatomicalName) names.add(m.anatomicalName); into.push(m); }
        }
    }
    const out = structuredClone(combined ? parts[0] : merged);
    const fields = humanVolumeFields(p);
    for (let [layer, list] of Object.entries(out)) {
    if (layer === 'bones' || layer === 'inguinalLigaments')
        continue;
    for (let m of list) {
        // Pectoral fans already carry their own hypertrophy; only the covering takes the pectoral field.
        let owner = m.rigRegion === 'arm' ? { arm: 1, leg: 0, hand: 0, head: 0 } : m.rigRegion === 'leg' ? { arm: 0, leg: 1, hand: 0, head: 0 } : null, own = /^pectoralis_major_/.test(m.anatomicalName ?? '') ? fields.filter(f => f.key !== 'pectoral') : fields;
        if (!isOriginalAbdomen(p) && !followsRectus(layer, m)) own = own.filter(f => f.region !== 'rectusAbdominis');
        if (!isOriginalAbdomen(p) && !followsPectoral(layer, m)) own = own.filter(f => f.key !== 'pectoral');
        if (!isOriginalAbdomen(p) && !followsOblique(layer, m)) own = own.filter(f => f.region !== 'oblique');
        const name = m.anatomicalName ?? '';
        if (deferredGrowth?.deltoid && name.startsWith('deltoid')) own = own.filter(f => f.key !== 'deltoid');
        if (deferredGrowth?.latissimus && name.startsWith('latissimus_dorsi_')) own = own.filter(f => f.key !== 'back');
        own = own.filter(f => f.region !== 'back' || /^thoracolumbar_fascia_/.test(m.anatomicalName ?? '') || (f.key === 'back' ? !!backMeshTemplate(m.anatomicalName ?? '') : atlas.legacy[f.key]?.includes(backMeshTemplate(m.anatomicalName ?? ''))));
        if (!own.length) continue;
        for (let i = 0; i < m.positions.length; i += 3) {
            const w = m.tissue ? smooth(.11, .35, m.tissue[i / 3]) : 1;
            if (w === 0) continue;
            let v = Array.from(m.positions.subarray(i, i + 3)), next = humanVolumeWarp(v, own, owner);
            m.positions.set(v.map((a, k) => mix(a, next[k], w)), i);
        }
        m.normals = humanNormals(m.positions, m.indices);
    }
} if (out.rectusAbdominis.length)
    seatInRectusGrooves(out.aponeuroses, out.rectusAbdominis); if (out.otherMuscles.length) {
    // The thoracic cage is needed even when bones are hidden, so muscle shape never depends on layer visibility.
    // Pectoralis major is superficial to the ribs, the upper rectus and the external oblique.
    let needed = ['bones', 'aponeuroses', 'rectusAbdominis', 'externalOblique'], cage = needed.every(k => wanted.includes(k)) ? out : cachedThoracicSupport(p);
    // Seat the pectoral ends on their bones first, so resting and the skin limit apply to the final shape.
    if (!p.definition?.interaction?.attachments)
        snapPectorals(out.otherMuscles, [...cage.bones, ...cage.aponeuroses]);
    for (const m of out.otherMuscles)
        if (/^(gluteus_|tensor_fasciae)/.test(m.anatomicalName ?? ''))
            relaxShell(m, 12);
    const support = [...cage.bones, ...cage.aponeuroses, ...cage.rectusAbdominis, ...cage.externalOblique], skinCage = p.definition?.interaction?.skinFollows && !p.definition?.genetics ? null : cachedHumanSkinCage(p);
    const deep = out.otherMuscles.filter(m => /^erector_/.test(m.anatomicalName ?? ''));
    // A part may release its own skin limit, never a neighbour's authored thickness.
    const backKeys = Object.keys(p.individualGrowth ?? {}).filter(key => p.individualGrowth[key] !== 1 && atlas.legacy[key]?.some(id => posteriorMuscles.has(id)));
    const backCages = new Map();
    function seatOwned(muscles, floor, clearance = .015, margin = .03) {
        const groups = new Map();
        for (const m of muscles) {
            const template = backMeshTemplate(m.anatomicalName ?? '');
            const removed = template ? backKeys.filter(key => !atlas.legacy[key].includes(template)) : [];
            const key = removed.join('|');
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(m);
        }
        for (const [key, meshes] of groups) {
            let limit = skinCage;
            if (limit && key) {
                if (!backCages.has(key)) {
                    const growth = { ...p.individualGrowth };
                    for (const removed of key.split('|')) delete growth[removed];
                    const parameters = { ...p, individualGrowth: growth };
                    backCages.set(key, cachedHumanSkinCage(parameters));
                }
                limit = backCages.get(key);
            }
            restOnThorax(meshes, floor, limit, clearance, margin);
        }
    }
    // Deep muscles stay further from the skin, leaving room for the superficial layer over them.
    seatOwned(deep, support, .015, .11);
    // The superficial layer rests on the deep muscles, and the thoracolumbar fascia on top of both.
    const fascia = out.aponeuroses.filter(m => /^thoracolumbar_fascia/.test(m.anatomicalName ?? '')), superficial = out.otherMuscles.filter(m => !deep.includes(m));
    const pectorals = superficial.filter(m => /^pectoralis_major_/.test(m.anatomicalName ?? ''));
    if (!isOriginalAbdomen(p) && (p.rectus !== 1 || p.oblique !== 1 || p.back !== 1 || backKeys.length || (p.individualGrowth?.rectus_abdominis ?? 1) !== 1)) {
        // Preserve the authored thoracic seat when abdominal or posterior volume changes. Actual overlap is
        // resolved on the rectus side by solveTissueContact, while the pectoral stays on its ribs.
        const neutralGrowth = { ...p.individualGrowth, rectus_abdominis: 1 };
        for (const key of backKeys) delete neutralGrowth[key];
        const neutralParameters = { ...p, rectus: 1, oblique: 1, back: 1, individualGrowth: neutralGrowth };
        const neutral = cachedThoracicSupport(neutralParameters);
        const neutralSkin = skinCage ? cachedHumanSkinCage(neutralParameters) : null;
        restOnThorax(pectorals, [...neutral.bones, ...neutral.aponeuroses, ...neutral.rectusAbdominis, ...neutral.externalOblique], neutralSkin);
        seatOwned(superficial.filter(m => !pectorals.includes(m)), [...support, ...deep]);
    } else seatOwned(superficial, [...support, ...deep]);
    restOnThorax(fascia, [...support, ...deep, ...superficial.filter(m => /^latissimus/.test(m.anatomicalName ?? ''))], skinCage, .012, .02);
} return out; }
export { buildRegionalSurface, applyRegionalInternals, buildLegacySurface, buildHumanSurface, buildInternals, buildHumanVolumeLayers, warpMesh, humanFitCage, rectusGrowthExposure };
/** Visible crease references are distinct from the deep inguinal ligament. */
export function superficialLandmarks(p) {
    return { navel: humanNavel(p), inguinal: [-1, 1].map(side => [.12, .5, .9].map(t => humanInguinalWorldPoint(p, t, side, true))) };
}
/** Inspection paths share the exact deformation used by the generated tissues. */
export function inspectionData(p) {
    const inspection = [];
    for (const side of [-1, 1]) {
        inspection.push(Array.from({ length: 35 }, (_, i) => humanInguinalWorldPoint(p, i / 34, side)));
        const ip = humanInternalParams(p);
        inspection.push(Array.from({ length: 30 }, (_, j) => { const y = mix(anatomy(ip).pubis + .85, 12.5, j / 29), wall = abdominalLayout(ip, y); return humanInternalPoint(p, torsoSurface(ip, y, torsoAngle(ip, y, side * wall.outer), .015).point); }));
    }
    inspection.push([humanInternalPoint(p, rectusOrigin(humanInternalParams(p), 1, .5))]);
    const path = inspection[2], start = path[0], end = path[path.length - 1];
    const rise = Math.abs(end[1] - start[1]) * p.height / 175;
    return { navel: humanNavel(p), inspection, inguinalAngle: 2 * Math.atan2(Math.abs(end[0] - start[0]), rise) * 180 / PI, inguinalHeight: rise * 10 };
}

function anatomicalGrowth(p, key) { return Math.max(.3, Math.min(3, p.individualGrowth?.[key] || 1)); }

function anatomicalProfile(key, t) { return Math.max(.025, priorityProfile(key, t)); }

// Deltoid: one cap over the humeral head. u runs along the origin from the lateral third of the clavicle,
// over the acromion, along the scapular spine; t runs to the deltoid tuberosity. Each head is a span of u,
// so the heads share edges and the cap overlaps the lateral pectoral like the deltopectoral groove.
function anatomicalDeltoid(p, side, head) {
    const a = anatomy(p), sh = a.shoulder, spans = { deltoidAnterior: [0, .36], deltoidMiddle: [.36, .64], deltoidPosterior: [.64, 1] }, [u0, u1] = spans[head];
    const cd = p.chestDepth / 24, path = curve([[mix(.10, sh + .10, .40), 14.06, mix(.70 * cd, -.02, .40) + .04], [sh - .02, 14.13, .20], [sh + .14, 14.13, -.04], [sh - .02, 14.05, -.36], [sh - .52, 13.93, -.60]], 64);
    const origin = u => { let x = clamp(u, 0, 1) * 64, i = Math.min(63, Math.floor(x)); return path[i].map((q, k) => mix(q, path[i + 1][k], x - i)); };
    const H = [sh, 13.95, -.03], T = [sh + .64, 12.53, .015], axis = unit(sub(T, H)), length = Math.hypot(...sub(T, H));
    const growth = u => Math.max(.2, p.deltoid * mix(mix(p.individualGrowth?.deltoidAnterior ?? 1, p.individualGrowth?.deltoidMiddle ?? 1, smooth(.28, .44, u)), p.individualGrowth?.deltoidPosterior ?? 1, smooth(.56, .72, u)));
    function frame(t, u) {
        let o = origin(u), e = t * t * (3 - 2 * t), P = o.map((q, k) => mix(q, T[k], e));
        // Wrap around the humeral head: keep at least the cap radius from the humeral axis.
        let along = clamp(dot(sub(P, H), axis), 0, length), Q = add(H, mul(axis, along)), off = sub(P, Q), d = Math.hypot(...off);
        let dir = d > 1e-6 ? mul(off, 1 / d) : unit(cross(axis, [0, 0, 1])), R = mix(.22, .07, smooth(.15, 1, t)) + .05 * Math.sin(PI * t) * (1 - smooth(.7, 1, t));
        return { mid: add(Q, mul(dir, Math.max(d, R))), dir };
    }
    const thickness = (t, u) => (.012 + .15 * Math.sqrt(growth(u)) * Math.sin(PI * Math.min(1, t * 1.15)) ** .7 * (1 - smooth(.82, 1, t))) * (.35 + .65 * smooth(0, .12, u)) * (.45 + .55 * (1 - smooth(.86, 1, u)));
    const m = shell((t, v) => {
        let u = mix(u0, u1, v), f = frame(t, u), th = thickness(t, u);
        return { point: [side * (f.mid[0] + f.dir[0] * th * .5), f.mid[1] + f.dir[1] * th * .5, f.mid[2] + f.dir[2] * th * .5], normal: [side * f.dir[0], f.dir[1], f.dir[2]] };
    }, (t, v) => thickness(t, mix(u0, u1, v)), 30, 20, (t, v) => .20 + .80 * smooth(.05, .22, t) * (1 - smooth(.80, .98, t)));
    m.anatomicalName = head;
    m.rigRegion = 'arm';
    // Origins stay with the trunk mapping (clavicle, acromion, spine); the belly and tendon follow the arm.
    m.armBlend = [.08, .45];
    setShellFibers(m, (t, v) => mix(u0, u1, v) * 36);
    m.longitudinal = new Float32Array(m.positions.length / 3);
    for (let layer = 0; layer < 2; layer++)
        for (let j = 0; j <= 30; j++)
            for (let i = 0; i <= 20; i++)
                m.longitudinal[layer * 31 * 21 + j * 21 + i] = j / 30;
    return m;
}
// Pectoralis major thickness measured on the reference écorché, in sternum lengths from the jugular
// notch (see data/pectoralReference.json). Missing cells read as zero so the borders taper. The optional
// development map (from hypertrophied reference bodies) redistributes the same volume as it grows.
function pectoralReferenceThickness(x, y, development = 0) {
    const F = PECTORAL.frame, xs = PECTORAL.xs, ys = PECTORAL.ys, X = Math.abs(x) / F.sternumLength, Y = (y - F.jugularY) / F.sternumLength;
    const fx = (X - xs[0]) / (xs[1] - xs[0]), fy = (ys[0] - Y) / (ys[0] - ys[1]);
    if (fx < -1 || fy < -1 || fx > xs.length || fy > ys.length) return 0;
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
    const cell = (grid, jj, ii, missing) => grid?.[jj]?.[ii] ?? missing;
    const sample = (grid, missing) => cell(grid, j, i, missing) * (1 - tx) * (1 - ty) + cell(grid, j, i + 1, missing) * tx * (1 - ty) + cell(grid, j + 1, i, missing) * (1 - tx) * ty + cell(grid, j + 1, i + 1, missing) * tx * ty;
    const base = sample(PECTORAL.thickness, 0), shape = PECTORAL.development ? sample(PECTORAL.development, 1) : 1;
    // In the upper-lateral corner (toward the axilla) the measured value includes the heads converging on
    // the tendon of an arms-down body; there the muscle flattens toward the humerus. The belly's mass
    // above the fold, lower and more medial, is kept.
    const tendon = 1 - .65 * smooth(.78, 1.05, X) * smooth(-.70, -.40, Y);
    return base * tendon * mix(1, shape, clamp(development, 0, 1)) * F.sternumLength * PECTORAL.defaultScale;
}
function anatomicalPectoralFan(p, side, head) {
    // One continuous fan: s runs along the origin from the lateral clavicle, down the sternum, to the
    // sixth/seventh cartilages and rectus sheath. Each head is a span of s, so neighbouring heads share
    // an edge and the muscle reads as one belly. t runs from origin to the humeral insertion; v runs
    // against s (medial-to-lateral clavicle, inferior-to-superior sternum) to match the attachment locators.
    const a = anatomy(p), spans = { clav: [0, .27], stern: [.27, .80], cost: [.80, 1] }, [s0, s1] = spans[head];
    const tendonWidth = p.pectoralTendonWidth ?? .8, emergence = p.pectoralFiberConvergence ?? .6, spread = p.pecSpread || 0;
    // Head gains blend across the shared edges so individual edits never open a step between heads.
    const gain = s => {
        let clav = p.pectoralClavicular * anatomicalGrowth(p, 'pectoralis_major_clavicular'), stern = p.pectoralSternal * anatomicalGrowth(p, 'pectoralis_major_sternocostal'), cost = p.pectoralCostal * anatomicalGrowth(p, 'pectoralis_major_sternocostal');
        let g = mix(mix(clav, stern, smooth(.20, .34, s)), cost, smooth(.74, .86, s));
        return Math.max(.15, (p.pectoralMuscle ?? p.pectoral) * g);
    };
    function origin(s) {
        let clavX = Math.max(.42, a.shoulder * .52), x, y;
        if (s < .27) { let u = s / .27; x = mix(clavX, .15, u); y = mix(13.92, 13.90, u) - .03 * Math.sin(PI * u); }
        else if (s < .80) { let u = (s - .27) / .53; x = .14 + .02 * Math.sin(PI * u); y = mix(13.86, 12.66, u); }
        // Abdominal part: arises from the anterior rectus sheath, reaching well below the xiphoid.
        else { let u = (s - .80) / .20; x = mix(.16, .58 + .10 * spread, u); y = mix(12.62, 11.44 - .08 * spread, u ** .8); }
        return [x, y];
    }
    function insertion(s) {
        // Twisted (trilaminar) tendon: clavicular fibers insert lowest and most superficial, the costal
        // fibers fold behind them and insert highest on the lateral lip of the bicipital groove.
        return [a.shoulder + .16 + .13 * tendonWidth, 13.12 + .30 * tendonWidth * s, mix(.24, .07, s)];
    }
    function mid(t, s) {
        let o = origin(s), ins = insertion(s), bend = t * t * (3 - 2 * t), convergence = Math.pow(bend, .75 + .9 * emergence);
        let x = mix(o[0], ins[0], convergence), y = mix(o[1], ins[1], bend);
        // Lower fibers sweep upwards along the anterior axillary fold; upper fibers run nearly horizontal.
        y -= .10 * Math.sin(PI * t) * smooth(.55, 1, s);
        x += .08 * Math.sin(PI * t) * (1 - .4 * s);
        // The deep surface lies on the ribs and cartilages; thickness then grows outward from the cage.
        let cage = ribCageFront(p, x, y) + .012;
        return [x, y, mix(cage, Math.min(cage, ins[2] + .5 * (cage - ins[2]) * (1 - t)), smooth(.72, 1, t))];
    }
    function thickness(t, s) {
        // Over the chest, thickness is read from the écorché map at the fibre's position: about 1 cm along
        // the sternum, fullest centro-laterally above the fold, thin over the abdominal part. Growth scales
        // it and shifts the distribution toward the developed map. Beyond the anterior axillary fold the
        // fibres follow the arm, which the arms-down reference cannot describe: there the tuned converging
        // belly and tendon profile is kept.
        let raw = gain(s), g = Math.pow(raw, .85), c = mid(t, s), upper = 1 + .25 * (p.pecUpper || 0) * (1 - smooth(.2, .45, s));
        // The lateral clavicular fibres form the free border against the deltoid: keep it thin.
        let lateralBorder = .30 + .70 * smooth(0, .14, s);
        // The sternal and costal origins are fleshy (about 1 cm thick right at the bone); the clavicular
        // origin lies under thin skin on the clavicle, so it stays tendinous.
        let origin = smooth(0, mix(.30, .08, smooth(.20, .34, s)), t);
        let measured = pectoralReferenceThickness(c[0], c[1], (raw - 1) / 1.2) * g * upper * lateralBorder * origin;
        let longitudinal = anatomicalProfile(s < .27 ? 'pectoralis_major_clavicular' : 'pectoralis_major_sternocostal', t);
        let border = lateralBorder * (.12 + .88 * (1 - smooth(.62, 1, s)));
        let tendon = (.045 + .12 * g * longitudinal) * border * (.70 + .55 * G(t - .52, .26)) * upper * smooth(0, .30, t);
        // The fibres converge early, so "beyond the fold" is judged by position as well as along the fibre.
        let beyondFold = Math.max(smooth(.55, .80, t), smooth(.80, 1.0, Math.abs(c[0]) / PECTORAL.frame.sternumLength));
        return .010 + mix(measured, tendon, beyondFold) * (1 - smooth(.86, .995, t));
    }
    function datum(t, v) {
        let s = mix(s1, s0, v), c = mid(t, s), h = .004, ds = mid(t, Math.min(1, s + h)), dt = mid(Math.min(1, t + h), s), n = unit(cross(sub(ds, c), sub(dt, c)));
        if (n[2] < 0) n = mul(n, -1);
        // Half the thickness lies outside the support surface, so growth bulges outward rather than into the ribs.
        let th = thickness(t, s), lift = .5 * th;
        return { point: add([side * c[0], c[1], c[2]], [side * n[0] * lift, n[1] * lift, n[2] * lift]), normal: [side * n[0], n[1], n[2]] };
    }
    let m = shell(datum, (t, v) => thickness(t, mix(s1, s0, v)), 36, 28, (t, v) => .20 + .80 * smooth(.04, .25, t) * (1 - smooth(.75, .98, t)));
    m.anatomicalName = 'pectoralis_major_' + head + '_' + (side > 0 ? 'R' : 'L');
    m.armBlend = [.60, .95];
    // Fibers run from origin to insertion, so the stripe phase changes only across the fan.
    setShellFibers(m, (t, v) => mix(s1, s0, v) * 48);
    m.longitudinal = new Float32Array(m.positions.length / 3);
    for (let layer = 0; layer < 2; layer++)
        for (let j = 0; j <= 36; j++)
            for (let i = 0; i <= 28; i++)
                m.longitudinal[layer * 37 * 29 + j * 29 + i] = j / 36;
    return m;
}

// External oblique: a fleshy lateral belly whose upper border digitates with serratus anterior on ribs
// 5-12, whose medial muscular border runs down the flank and curves towards the ASIS (aponeurosis lies
// medial to it), and which bulges over the iliac crest. v: crest (0) to ribs (1); u: medial (0) to posterior.
// Trunk surface in angular coordinates: fanMuscle interpolates (theta, y, extra inset), so fibers wrap
// around the flank on the surface instead of cutting across it. theta is 0 at the front, PI at the back.
function onTrunk(p, side, inset) {
    return (theta, y, extra) => torsoSurface(p, y, side * theta, inset + extra);
}
// Structural costal attachment surface, independent of rectus hypertrophy. A thin
// anterior sheath supports the abdominal pectoral origin without transferring a belly bulge into the chest.
function superiorRectusSheath(p, side) {
    const q = { ...p, rectus: 1, oblique: 1 };
    return shell((v, u) => {
        const y = mix(11.35, 13.12, v), wall = abdominalLayout(q, y), x = wall.inner + u * wall.width;
        return torsoSurface(q, y, side * torsoAngle(q, y, x), anatomy(q).f + .035);
    }, () => .008, 18, 24);
}
function pubicSheath(p, side) {
    const a = anatomy(p), reach = .55, tubercle = inguinalPathPoint(p, 0, 1);
    // u from the midline (0) out to where the sheath meets the abdominal aponeurosis (1); v from the pubic
    // crest and inguinal ligament (0) up to the rounded upper border (1).
    return shell((v, u) => {
        const x = u * reach, bottom = x < tubercle[0] ? a.pubis - .30 + .30 * smooth(0, tubercle[0] * 1.6, x) : inguinalPathPoint(p, clamp((x - tubercle[0]) / (reach * 1.6), 0, 1), 1)[1];
        const top = a.pubis + .62 + .38 * (x / reach) ** 2, y = mix(bottom, top, v), inset = a.f - .022 - .006 * Math.sin(PI * v);
        return torsoSurface(p, y, side * torsoAngle(p, y, Math.max(.002, x)), inset);
    }, (v, u) => .008 * (.35 + .65 * Math.sin(PI * Math.min(1, v * 1.15)) ** .5) * (1 - .6 * smooth(.8, 1, u)), 16, 18);
}
// Muscular border of the external oblique (angle on the trunk, one side) at height y: vertical beside the
// rectus sheath, then sweeping laterally down to the ASIS. Medial and below it lies the aponeurosis, which
// forms the inguinal ligament. The measured fans and the abdominal aponeurosis share this one border.
function eoMuscleBorder(p, y, side) {
    const a = anatomy(p), wall = abdominalLayout(p, y), bellyV = clamp((y - (a.crest - .24)) / (12.81 - (a.crest - .24)), 0, 1), asis = inguinalPathPoint(p, 1, 1);
    const belly = rectusSegmentShape(p, side, y);
    const shift = belly ? wall.width * (belly.width - 1) * belly.weight : 0;
    const base = torsoAngle(p, y, wall.eoInner + shift) + .09 * (1 - bellyV) ** 2;
    return mix(base, Math.max(base, torsoAngle(p, asis[1], asis[0])), 1 - smooth(asis[1], asis[1] + .90, y));
}
// Abdominal wall measured against the reference écorché, as fans with real attachments. The muscular parts
// end at the same borders as the legacy sheets (external oblique at eoInner, internal oblique and transversus
// at the semilunar line), so the aponeurosis, rectus sheath, inguinal ligament and tissue contact are shared.
// The inguinal region emerges from the layers: the external oblique's lowest fibers reach the inguinal
// ligament, the internal oblique and transversus arch over it from its lateral half to the pubic crest.
function anatomicalAbdominalWall(p, side, key, thick, inset) {
    const a = anatomy(p), lerp = (A, B, t) => A.map((v, k) => mix(v, B[k], t)), gain = Math.sqrt(Math.max(.2, p.oblique));
    const border = (y, x) => torsoAngle(p, y, x), ing = t => { const q = inguinalPathPoint(p, t, 1); return [border(q[1], q[0]), q[1], 0]; };
    const path = (points, s) => { let u = clamp(s, 0, 1) * (points.length - 1), i = Math.min(points.length - 2, Math.floor(u)); return lerp(points[i], points[i + 1], u - i); };
    const edges = (s, lo = .06, hi = .94) => (.30 + .70 * smooth(0, lo, s)) * (.30 + .70 * (1 - smooth(hi, 1, s)));
    if (key === 'externalOblique') {
        // Eight digitations on ribs 5–12 (interlocking with the serratus), from the front of the chest down
        // to the free posterior border by the latissimus. Upper fibers end in the aponeurosis at eoInner,
        // middle ones at the ASIS and inguinal ligament, the posterior ones on the anterior iliac crest.
        const tooth = s => Math.max(0, Math.sin(PI * 8 * s)) ** 1.6;
        const origin = s => [mix(border(12.72, abdominalLayout(p, 12.72).eoInner + .10), 2.55, s), mix(12.72, a.crest + .55, s ** .9) + .10 * tooth(s) * (1 - .5 * s), 0];
        // Upper and middle fibers end on the aponeurosis at the muscular border, down to the ASIS; the
        // aponeurosis carries them on to the linea alba and the inguinal ligament.
        const asisY = inguinalPathPoint(p, 1, 1)[1];
        const insertion = s => s < .62 ? (y => [eoMuscleBorder(p, y, side), y, 0])(mix(12.30, asisY, s / .62)) : path([ing(1), [border(a.crest - .08, a.asis + .25), a.crest - .10, 0], [2.30, a.crest + .02, 0]], (s - .62) / .38);
        const bulge = (t, s) => gain * .10 * Math.sin(PI * t) ** .7 * smooth(.25, .55, s) * (1 - smooth(.85, 1, s));
        return fanMuscle(p, side, { name: key, origin, insertion, place: onTrunk(p, side, inset), rows: 30, cols: 40, fiberScale: 40, ease: t => t,
            thickness: (t, s) => (thick * (.25 + .75 * Math.sin(PI * Math.min(1, t * 1.1)) ** .5) + bulge(t, s)) * edges(s) * (.35 + .65 * (1 - smooth(.9, 1, t))),
            tissue: (t, s) => 1 - .85 * smooth(.88, 1, t) * (1 - smooth(.58, .64, s)) });
    }
    if (key === 'internalOblique') {
        // Lateral half of the inguinal ligament, the iliac crest and the thoracolumbar fascia; fibers fan
        // upwards and medially. The lowest arch over the cord to the pubic crest (conjoint tendon), the middle
        // ones end in the aponeurosis at the semilunar line, the posterior ones on the costal margin and rib 12.
        const origin = s => s < .30 ? ing(mix(.45, 1, s / .30)) : path([ing(1), [border(a.crest - .08, a.asis + .25), a.crest - .10, 0], [2.55, a.crest + .05, 0]], (s - .30) / .70);
        const semilunar = y => [border(y, abdominalLayout(p, y).outer + .08), y, 0];
        const insertion = s => s < .20 ? lerp([border(a.pubis + .18, .30), a.pubis + .18, 0], semilunar(a.pubis + .70), s / .20) : s < .62 ? semilunar(mix(a.pubis + .70, 12.10, (s - .20) / .42)) : lerp([border(12.10, abdominalLayout(p, 12.10).outer + .30), 12.15, 0], [2.30, 11.05, 0], (s - .62) / .38);
        return fanMuscle(p, side, { name: key, origin, insertion, place: onTrunk(p, side, inset), rows: 26, cols: 36, fiberScale: 36, ease: t => t,
            thickness: (t, s) => thick * (.25 + .75 * Math.sin(PI * Math.min(1, t * 1.1)) ** .55) * edges(s) * (.35 + .65 * (1 - smooth(.9, 1, t))),
            tissue: (t, s) => 1 - .85 * smooth(.88, 1, t) * smooth(.10, .20, s) * (1 - smooth(.56, .64, s)) });
    }
    // Transversus: horizontal fibers from the thoracolumbar fascia (back), the inner costal cartilages,
    // the iliac crest and the lateral third of the inguinal ligament, to the aponeurosis at the semilunar line.
    const origin = s => s < .25 ? ing(mix(.55, 1, s / .25)) : s < .40 ? lerp([border(a.crest - .08, a.asis + .25), a.crest - .10, 0], [2.65, a.crest + .05, 0], (s - .25) / .15) : [2.65, mix(a.crest + .05, 12.45, (s - .40) / .60), 0];
    const insertion = s => { let y = s < .25 ? mix(a.pubis + .20, a.pubis + .55, s / .25) : mix(a.pubis + .55, 12.45, (s - .25) / .75); return [border(y, abdominalLayout(p, y).outer + .04), y, 0]; };
    return fanMuscle(p, side, { name: key, origin, insertion, place: onTrunk(p, side, inset), rows: 24, cols: 32, fiberScale: 34, ease: t => t,
        thickness: (t, s) => thick * (.25 + .75 * Math.sin(PI * Math.min(1, t * 1.1)) ** .55) * edges(s) * (.35 + .65 * (1 - smooth(.9, 1, t))),
        tissue: t => 1 - .85 * smooth(.88, 1, t) });
}
function externalObliqueMesh(p, side, thick, inset) {
    const a = anatomy(p), teeth = 8, gain = Math.sqrt(Math.max(.2, p.oblique));
    const frame = (v, u) => {
        let low = a.crest - .24 + .16 * Math.sin(PI * u), tooth = Math.max(0, Math.sin(PI * teeth * u)) ** 1.6, high = 12.72 - .95 * u + .26 * tooth * (1 - .5 * u), y = mix(low, high, v), wall = abdominalLayout(p, y);
        // Muscular border: vertical above, sweeping laterally towards the ASIS below.
        let inner = torsoAngle(p, y, wall.eoInner) + .09 * (1 - v) ** 2 + .30 * (1 - smooth(.05, .50, v));
        return { y, theta: side * mix(inner, 2.35, u) };
    };
    const bulge = (v, u) => gain * (.11 * Math.sin(PI * Math.min(1, u * 1.6)) ** .8 * Math.sin(PI * v) ** .6 + .12 * G(v - .16, .16) * smooth(.15, .45, u) * (1 - smooth(.75, 1, u)));
    const thickness = (v, u) => thick * (.025 + .975 * Math.sin(PI * v) ** .55) * (.06 + .94 * Math.sin(PI * u) ** .45) + bulge(v, u) * smooth(0, .32, u) * smooth(0, .06, v) * (1 - smooth(.94, 1, v));
    return shell((v, u) => {
        let f = frame(v, u), point = torsoSurface(p, f.y, f.theta, inset + rectusTuck(f.y) * (1 - smooth(.25, .55, u)));
        // Grow outwards: the deep surface stays on the internal oblique.
        point.point = add(point.point, mul(point.normal, .5 * (thickness(v, u) - thick * .5)));
        return point;
    }, thickness, 40, 64, (v, u) => smooth(0, .07, u) * (.55 + .45 * smooth(0, .12, v)));
}
// Fiber phase for the anatomy shader on a shell grid: stripes follow lines of constant phase(row, col).
function setShellFibers(m, phase) {
    let { rows, cols } = m.surfaceGrid;
    m.fibers = new Float32Array(m.positions.length / 3);
    for (let layer = 0; layer < 2; layer++)
        for (let j = 0; j <= rows; j++)
            for (let i = 0; i <= cols; i++)
                m.fibers[layer * (rows + 1) * (cols + 1) + j * (cols + 1) + i] = phase(j / rows, i / cols);
    return m;
}
function anatomicalRectusMeshes(p, side) {
    const custom = customIntersections(p, side);
    if (custom) {
        const a = anatomy(p), lower = a.pubis + .045;
        const m = shell((v, u) => {
            const y = mix(lower, rectusTop(u), v), w = abdominalLayout(p, y), belly = rectusSegmentShape(p, side, y, side * (w.inner + u * w.width)), x = side * (w.inner + u * w.width * (1 + (belly ? (belly.width - 1) * belly.weight : 0))), r = torsoSurface(p, y, torsoAngle(p, y, x), a.f + .052 + rectusTuck(y)), anchor = rectusOrigin(p, side, u);
            r.point = r.point.map((val, i) => mix(anchor[i], val, w.lower));
            if (belly) r.point = add(r.point, mul(r.normal, rectusBellyProjection(belly, u) * .5));
            return r;
        }, (v, u) => {
            const y = mix(lower, rectusTop(u), v), w = abdominalLayout(p, y), belly = rectusSegmentShape(p, side, y, side * (w.inner + u * w.width)), x = side * (w.inner + u * w.width * (1 + (belly ? (belly.width - 1) * belly.weight : 0)));
            let groove = 0;
            for (const item of custom) {
                const lateral = 1 - smooth(item.extent * .5 - .1, item.extent * .5, Math.abs(u - .5));
                groove = Math.max(groove, item.depth * lateral * G(y - intersectionY(p, item, x), .06 * item.width));
            }
            const individual = anatomicalGrowth(p, 'rectus_abdominis'), exposure = p.abdominalModel !== 0 || p.rectus === 1 && individual === 1 ? 1 : rectusGrowthExposure(p, ...humanInternalPoint(p, [x, y, 0]).slice(0, 2));
            return (.017 + .102 * (1 + (p.rectus - 1) * exposure) * (1 + (Math.sqrt(individual) - 1) * exposure)) * (.19 + .81 * Math.sin(PI * u) ** .62) * (.2 + .8 * Math.sin(PI * v) ** .5) * (1 - .85 * groove) + (belly ? rectusBellyProjection(belly, u) : 0);
        }, 100, 24, (v, u) => smooth(0, .1, v) * (1 - smooth(.9, 1, v)));
        m.anatomicalName = 'rectus_abdominis_' + (side > 0 ? 'R' : 'L') + '_continuous';
        return [m];
    }
    const a = anatomy(p), upper = rectusTop(.5), lower = a.pubis + .045, bands = rectusBands(p, side * (p.rectGap / 20 + .28)), levels = [upper, ...bands, lower], segmentGain = p.rectusBellyProfile ?? 1, individual = anatomicalGrowth(p, 'rectus_abdominis'), out = [];
    // One physically separate belly per tendinous interval; the lower pyramid
    // is a taper, not an additional highly visible 'pack'.
    for (let k = 0; k < levels.length - 1; k++) {
        const top = levels[k], bottom = levels[k + 1];
        if (top - bottom < .13)
            continue;
        let isInfra = k === levels.length - 2;
        const m = shell((v, u) => {
            let y = mix(bottom, k === 0 ? rectusTop(u) : top, v), w = abdominalLayout(p, y);
            const infraTaper = isInfra ? mix(.42, 1, smooth(0, .75, v)) : 1;
            const capsuleWidth = (.90 + .10 * Math.sin(PI * v) ** .7) * infraTaper;
            let x = side * (p.abdominalModel !== 0 ? w.inner + w.width * .5 + (u - .5) * w.width * capsuleWidth : w.inner + u * w.width * capsuleWidth), theta = torsoAngle(p, y, x), res = torsoSurface(p, y, theta, a.f + .052 + rectusTuck(y)), blend = w.lower, anchor = rectusOrigin(p, side, u);
            res.point = res.point.map((val, i) => mix(anchor[i], val, blend));
            // Inscriptions follow the actual segment ends, including side asymmetry.
            let inset = .045 * p.tendon * (G(y - top, .085) + G(y - bottom, .085));
            res.point[2] -= inset * blend;
            return res;
        }, (v, u) => {
            // Domed bellies: a broad plateau that rounds off quickly into the grooves at each edge.
            let cross = .22 + .78 * (1 - Math.abs(2 * u - 1) ** 2.6);
            let capsule = .30 + .70 * (1 - Math.abs(2 * v - 1) ** (2.2 + .6 * segmentGain));
            let infra = isInfra ? (.35 + .60 * smooth(0, .60, v)) : .95;
            const y = mix(bottom, k === 0 ? rectusTop(u) : top, v), wall = abdominalLayout(p, y), x = side * (wall.inner + u * wall.width);
            const exposure = p.abdominalModel !== 0 || p.rectus === 1 && individual === 1 ? 1 : rectusGrowthExposure(p, ...humanInternalPoint(p, [x, y, 0]).slice(0, 2)) * Math.sin(PI * v) ** .7;
            return (.020 + .135 * (1 + (p.rectus - 1) * exposure) * (1 + (Math.sqrt(individual) - 1) * exposure)) * cross * capsule * infra * (.68 + .32 * segmentGain);
        }, 22, 20, (v, u) => smooth(0, .10, v) * (1 - smooth(.90, 1, v)));
        m.anatomicalName = 'rectus_abdominis_' + (side > 0 ? 'R' : 'L') + '_segment_' + (k + 1);
        out.push(m);
    }
    return out;
}

function anatomicalRectusTendons(p, side) {
    const a = anatomy(p), out = [];
    let bandIndex = 0;
    const custom = customIntersections(p, side);
    for (let level of rectusBands(p, side * .40)) {
        let band = shell((v, u) => {
            const item = custom?.[bandIndex], extent = item?.extent ?? 1, lateral = .5 + (u - .5) * extent;
            let w = abdominalLayout(p, level), x = side * (w.inner + lateral * w.width), y = (item ? intersectionY(p, item, x) : level) + (v - .5) * .045 * (.45 + .6 * p.tendon) * (item?.width ?? 1), theta = torsoAngle(p, y, x), r = torsoSurface(p, y, theta, a.f + .045);
            let anchor = rectusOrigin(p, side, u);
            r.point = r.point.map((val, i) => mix(anchor[i], val, w.lower));
            return r;
        }, (v, u) => .0065 + .013 * p.tendon * (.3 + .7 * Math.sin(PI * u)), 3, 16);
        band.anatomicalName = 'tendinous_intersection_' + (side > 0 ? 'R' : 'L') + '_' + (++bandIndex);
        out.push(band);
    }
    // Linea alba: thin aponeurosis recessed in the groove between the bellies, not a raised cord.
    let linea = shell((v, u) => {
        let y = mix(a.pubis + .15, 13.03, v), x = side * mix(.012, p.rectGap / 20 * .82, u), r = torsoSurface(p, y, torsoAngle(p, y, x), a.f + .072);
        return r;
    }, (v, u) => .005 + .005 * p.lineaAlbaDefinition, 35, 4);
    linea.anatomicalName = 'linea_alba_' + (side > 0 ? 'R' : 'L');
    out.push(linea);
    return out;
}

// Measured pelvis: control points from the reference écorché (data/pelvisReference.json), mapped onto this
// body's own landmarks (hip joint, ASIS, pubic tubercle, PSIS) so the skin, the inguinal region and every
// muscle attached to those landmarks stay where they are while the bone takes the reference's shape.
// x scales from the midline; (y, z) is an exact affine map of the four landmarks, with a term in x.
function pelvisMap(p) {
    const a = anatomy(p), L = PELVIS.landmarks;
    // The inguinal ligament ends near the surface; the bony tubercle lies behind and above that end, close to the
    // ASIS plane as in the reference, so the lower abdominal wall and its sheath pass in front of the pubis.
    const pairs = [[a.hipJoint, L.hip], [[a.asis, a.crest - .12, .62], L.asis], [[.12, a.pubis + .10, .72], L.pubicTubercle], [[.72, a.crest - .18, -.87], L.psis]];
    let num = 0, den = 0;
    for (const [o, r] of pairs) {
        num += o[0] * r[0];
        den += r[0] * r[0];
    }
    const sx = num / den, rows = pairs.map(([, r]) => [r[1], r[2], r[0], 1]), cy = solveLinear(rows, pairs.map(([o]) => o[1])), cz = solveLinear(rows, pairs.map(([o]) => o[2]));
    const affine = r => [sx * r[0], cy[0] * r[1] + cy[1] * r[2] + cy[2] * r[0] + cy[3], cz[0] * r[1] + cz[1] * r[2] + cz[2] * r[0] + cz[3]];
    // Above the ASIS the ilium is compressed so its crest top sits just above the crest line where the
    // obliques, gluteals and erector attach (anatomy's crest), keeping the crest under those muscles.
    const asisY = a.crest - .12, crestTop = Math.max(...PELVIS.crest.map(r => affine(r)[1])), k = Math.min(1, (a.crest + .10 - asisY) / (crestTop - asisY));
    const map = r => { const q = affine(r); if (q[1] > asisY) q[1] = asisY + (q[1] - asisY) * k; return q; };
    return { map, scale: Math.cbrt(Math.abs(sx * (cy[0] * cz[1] - cy[1] * cz[0]))), landmark: key => map(L[key]) };
}
function solveLinear(A, b) {
    const n = b.length, M = A.map((row, i) => [...row, b[i]]);
    for (let i = 0; i < n; i++) {
        let best = i;
        for (let k = i + 1; k < n; k++)
            if (Math.abs(M[k][i]) > Math.abs(M[best][i]))
                best = k;
        [M[i], M[best]] = [M[best], M[i]];
        for (let k = 0; k < n; k++)
            if (k !== i) {
                const f = M[k][i] / M[i][i];
                for (let j = i; j <= n; j++)
                    M[k][j] -= f * M[i][j];
            }
    }
    return M.map((row, i) => row[n] / row[i]);
}
// Signed distance primitives for the measured bones: tapered capsules and thick triangles (sheets).
function segmentDistance(q, a, b) { const ab = sub(b, a), h = clamp(dot(sub(q, a), ab) / (dot(ab, ab) || 1), 0, 1); return [Math.hypot(...sub(q, add(a, mul(ab, h)))), h]; }
function triangleDistance(q, a, b, c) {
    const ab = sub(b, a), ac = sub(c, a), ap = sub(q, a), d1 = dot(ab, ap), d2 = dot(ac, ap);
    if (d1 <= 0 && d2 <= 0) return Math.hypot(...ap);
    const bp = sub(q, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) return Math.hypot(...bp);
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) return Math.hypot(...sub(q, add(a, mul(ab, d1 / (d1 - d3)))));
    const cp = sub(q, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
    if (d6 >= 0 && d5 <= d6) return Math.hypot(...cp);
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) return Math.hypot(...sub(q, add(a, mul(ac, d2 / (d2 - d6)))));
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return Math.hypot(...sub(q, add(b, mul(sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6))))));
    const den = 1 / (va + vb + vc);
    return Math.hypot(...sub(q, add(a, add(mul(ab, vb * den), mul(ac, vc * den)))));
}
// Meshes a smooth union of primitives over their own box. Each primitive is { d: q => distance, lo, hi }.
function primitiveBone(prims, step, blend) {
    const lo = [0, 1, 2].map(k => Math.min(...prims.map(q => q.lo[k])) - 2 * step), hi = [0, 1, 2].map(k => Math.max(...prims.map(q => q.hi[k])) + 2 * step), cell = .25, buckets = new Map(), key = (i, j, k) => i + ',' + j + ',' + k;
    for (const prim of prims) {
        const a = prim.lo.map((v, k) => Math.floor((v - blend - step - lo[k]) / cell)), b = prim.hi.map((v, k) => Math.floor((v + blend + step - lo[k]) / cell));
        for (let i = a[0]; i <= b[0]; i++)
            for (let j = a[1]; j <= b[1]; j++)
                for (let k = a[2]; k <= b[2]; k++)
                    (buckets.get(key(i, j, k)) ?? buckets.set(key(i, j, k), []).get(key(i, j, k))).push(prim);
    }
    const field = (x, y, z) => {
        const list = buckets.get(key(Math.floor((x - lo[0]) / cell), Math.floor((y - lo[1]) / cell), Math.floor((z - lo[2]) / cell)));
        if (!list) return step * 3;
        // Blending only the two nearest primitives gives the same smooth joins at a fraction of the cost.
        let d1 = step * 3, d2 = step * 3;
        for (const prim of list) {
            const d = prim.d([x, y, z]);
            if (d < d1) { d2 = d1; d1 = d; }
            else if (d < d2) d2 = d;
        }
        return smin(d1, d2, blend);
    };
    field.box = { lo, hi };
    return polygonize(field, step);
}
const capsulePrim = (a, b, ra, rb = ra) => ({ d: q => { const [d, h] = segmentDistance(q, a, b); return d - mix(ra, rb, h); }, lo: [0, 1, 2].map(k => Math.min(a[k], b[k]) - Math.max(ra, rb)), hi: [0, 1, 2].map(k => Math.max(a[k], b[k]) + Math.max(ra, rb)) });
const sheetPrim = (a, b, c, t) => ({ d: q => triangleDistance(q, a, b, c) - t, lo: [0, 1, 2].map(k => Math.min(a[k], b[k], c[k]) - t), hi: [0, 1, 2].map(k => Math.max(a[k], b[k], c[k]) + t) });
// One continuous hip bone: ilium sheet and crest, acetabular cup, pubic body and rami, ischium and tuberosity,
// with the obturator foramen left open between them.
function measuredHipBone(p, side) {
    const P = pelvisMap(p), s = P.scale, M = r => P.map(r), L = PELVIS.landmarks, prims = [], pel = v => pelvic(p, [side * v[0], v[1], v[2]]);
    const chain = (points, r0, r1 = r0) => { for (let i = 0; i + 1 < points.length; i++) prims.push(capsulePrim(M(points[i]), M(points[i + 1]), s * mix(r0, r1, i / (points.length - 1)), s * mix(r0, r1, (i + 1) / (points.length - 1)))); };
    // Ilium: a thick sheet through the measured mid-surface, with the crest as a rounded rim.
    // Thickness is averaged over neighbouring cells: the measured spread is noisy on a sparse reference mesh.
    const il = PELVIS.ilium, thick = (i, j) => { let sum = 0, n = 0; for (let a = i - 1; a <= i + 2; a++) for (let b = j - 1; b <= j + 2; b++) if (il[a]?.[b]) { sum += il[a][b][3]; n++; } return s * (Math.max(1.8 * sum / n, .004) + .0015); };
    for (let i = 0; i + 1 < il.length; i++)
        for (let j = 0; j + 1 < il[i].length; j++) {
            const q = [il[i][j], il[i][j + 1], il[i + 1][j], il[i + 1][j + 1]], t = thick(i, j);
            prims.push(sheetPrim(M(q[0]), M(q[1]), M(q[2]), t), sheetPrim(M(q[2]), M(q[1]), M(q[3]), t));
        }
    chain(PELVIS.crest, .0055);
    // Acetabulum: a cup around the femoral head, open laterally, inferiorly and slightly forward.
    const ac = PELVIS.acetabulum, open = unit(ac.opening), centre = M(L.hip), axis = unit(sub(M(add(L.hip, open)), centre)), inner = s * (ac.radius + .0015), outer = s * ac.rim;
    prims.push({ d: q => { const v = sub(q, centre), r = Math.hypot(...v); return Math.max(r - outer, inner - r, dot(v, axis) - .25 * outer); }, lo: centre.map(v => v - outer), hi: centre.map(v => v + outer) });
    // Pubis: superior ramus from the acetabulum to the tubercle, the body at the symphysis.
    chain([[L.hip[0] - .022, -.004, .018], [.045, -.010, .040], L.pubicTubercle], .0085, .0075);
    chain([L.symphysisTop, L.symphysisBottom], .0095);
    // Obturator ring (inferior pubic ramus, ischial ramus, ischium), measured as a centreline with radii.
    const ring = PELVIS.obturatorRing, n = ring.length, radius = i => { let sum = 0; for (let k = -2; k <= 2; k++) sum += ring[(i + k + n) % n][3]; return Math.max(1.4 * sum / 5, .0065) + .002; };
    for (let i = 0; i < n; i++)
        prims.push(capsulePrim(M(ring[i]), M(ring[(i + 1) % n]), s * radius(i), s * radius((i + 1) % n)));
    // Ischial body down to the tuberosity, and the anterior inferior iliac spine (the crest ends at the ASIS).
    chain([[L.hip[0] - .004, -.022, -.022], ring[10], ring[9]], .012, .011);
    chain([L.ischialBack, L.ischialLow], .012, .010);
    prims.push(capsulePrim(M(L.aiis), M(L.aiis), s * .007));
    const detail = p.definition?.interaction?.supportDetail === 2 ? 2 : 1, raw = primitiveBone(prims, .045 / Math.sqrt(detail), s * .006), pts = [];
    for (let i = 0; i < raw.positions.length; i += 3)
        pts.push(pel([raw.positions[i], raw.positions[i + 1], raw.positions[i + 2]]));
    const m = mesh(pts, Array.from(raw.indices));
    m.anatomicalName = 'hip_bone_' + (side > 0 ? 'R' : 'L');
    m.landmarkMapped = true;
    // Gridded supports for attachment patches, inside the bone: the measured ilium mid-surface (v from the crest
    // down, u from PSIS to ASIS) and the superior pubic ramus ending at the tubercle.
    const grid = (v, u) => { const i = (1 - v) * (il.length - 1), j = u * (il[0].length - 1), i0 = Math.min(il.length - 2, Math.floor(i)), j0 = Math.min(il[0].length - 2, Math.floor(j)), fi = i - i0, fj = j - j0, at = (a, b) => il[a][b]; return [0, 1, 2].map(k => mix(mix(at(i0, j0)[k], at(i0, j0 + 1)[k], fj), mix(at(i0 + 1, j0)[k], at(i0 + 1, j0 + 1)[k], fj), fi)); };
    const wing = shell((v, u) => ({ point: pel(M(grid(v, u))), normal: [side, 0, 0] }), .01, 12 * detail, 12 * detail);
    wing.anatomicalName = 'ilium_wing_' + (side > 0 ? 'R' : 'L');
    wing.landmarkMapped = true;
    const ramus = tube(curve([[L.hip[0] - .022, -.004, .018], [.045, -.010, .040], L.pubicTubercle].map(r => pel(M(r))), 12), s * .004, 6);
    ramus.anatomicalName = 'pubic_ramus_' + (side > 0 ? 'R' : 'L');
    ramus.landmarkMapped = true;
    return [m, wing, ramus];
}
// Centre of the ischial tuberosity (right side, before tilt) on whichever pelvis is drawn, for the
// hamstring and adductor origins.
function ischialTuberosity(p) {
    const a = anatomy(p);
    if (p.pelvisModel === 0)
        return [.78, 8.12 + (a.pubis - 8.55) * .35, -.42];
    const P = pelvisMap(p), L = PELVIS.landmarks;
    return P.map(L.ischialLow.map((v, k) => mix(v, L.ischialBack[k], .4)));
}
// The measured pelvis depends only on the pelvic landmarks, the tilt and the support detail: it is rebuilt
// when those change and copied otherwise (later stages move vertices in place).
let MEASURED_PELVIS_CACHE = null;
function measuredPelvis(p) {
    const a = anatomy(p), key = [a.asis, a.crest, a.pubis, ...a.hipJoint, p.tilt, p.definition?.interaction?.supportDetail].join(',');
    if (MEASURED_PELVIS_CACHE?.key !== key)
        MEASURED_PELVIS_CACHE = { key, meshes: [...measuredSacrum(p), ...measuredHipBone(p, -1), ...measuredHipBone(p, 1)] };
    return MEASURED_PELVIS_CACHE.meshes.map(m => ({ ...m, positions: m.positions.slice(), normals: m.normals.slice(), indices: m.indices.slice() }));
}
// Sacrum (both halves from the measured right half) and a coccyx curving forward from its apex.
function measuredSacrum(p) {
    const P = pelvisMap(p), s = P.scale, rows = PELVIS.sacrum, prims = [];
    const half = t => s * Math.min(.011, Math.max(.006, .8 * t));
    for (const side of [-1, 1])
        for (let i = 0; i + 1 < rows.length; i++)
            for (let j = 0; j + 1 < rows[i].length; j++) {
                const q = [rows[i][j], rows[i][j + 1], rows[i + 1][j], rows[i + 1][j + 1]].map(r => { const m = P.map(r); return [side * m[0], m[1], m[2]]; }), t = half((rows[i][j][3] + rows[i][j + 1][3] + rows[i + 1][j][3] + rows[i + 1][j + 1][3]) / 4);
                prims.push(sheetPrim(q[0], q[1], q[2], t), sheetPrim(q[2], q[1], q[3], t));
            }
    const raw = primitiveBone(prims, .055, s * .006), pts = [];
    for (let i = 0; i < raw.positions.length; i += 3)
        pts.push(pelvic(p, [raw.positions[i], raw.positions[i + 1], raw.positions[i + 2]]));
    const sacrum = mesh(pts, Array.from(raw.indices));
    sacrum.anatomicalName = 'sacrum';
    sacrum.landmarkMapped = true;
    const apex = rows[0][0], coccyx = tube(curve([[0, apex[1], apex[2]], [0, apex[1] - .016, apex[2] + .004], [0, apex[1] - .028, apex[2] + .016]].map(r => pelvic(p, P.map(r))), 10), t => s * (.0065 - .003 * t), 8);
    coccyx.anatomicalName = 'coccyx';
    coccyx.landmarkMapped = true;
    return [sacrum, coccyx];
}
function anatomicalIliacWing(p, side) {
    let a = anatomy(p), crestX = a.asis + p.flare / 10 + .045 * (p.iliacCrestRelief || 0), wing = Math.max(.65, Math.min(1.45, p.iliacWing ?? 1));
    // u traverses the curved crest from PSIS (posterior) to ASIS (anterior);
    // v goes inferiorly towards the acetabulum.  Real ilium is a broad
    // concave plate, NOT a rectangular wall between pubis and ASIS.
    function crest(u) {
        let x = mix(.72, crestX, u) + .26 * wing * Math.sin(PI * u), y = a.crest - .18 + .18 * Math.sin(PI * u) + .06 * u, z = mix(-.87, .62, u) - .19 * Math.sin(PI * u);
        return [x, y, z];
    }
    let m = shell((v, u) => {
        let c = crest(u), socket = a.hipJoint, spread = Math.pow(v, .88), xx = mix(c[0], socket[0] + .085 * Math.cos(2 * PI * u), spread), yy = mix(c[1], socket[1] + .065 * Math.sin(PI * u), spread), zz = mix(c[2], socket[2] - .12 * Math.sin(PI * u), spread);
        // Medial concavity = iliac fossa, near the central wing.
        xx -= .18 * wing * Math.sin(PI * u) * Math.sin(PI * v);
        zz -= .055 * Math.sin(PI * u) * Math.sin(PI * v);
        return { point: pelvic(p, [side * xx, yy, zz]), normal: unit([side * .75, .25, -.56]) };
    }, (v, u) => .055 + .025 * wing * Math.sin(PI * u) * Math.sin(PI * v), p.definition?.interaction?.supportDetail === 2 ? 48 : 24, p.definition?.interaction?.supportDetail === 2 ? 80 : 40);
    m.anatomicalName = 'ilium_wing_' + (side > 0 ? 'R' : 'L');
    return m;
}

function anatomicalPelvicRidges(p, side) {
    let a = anatomy(p), wing = p.iliacWing ?? 1, crestX = a.asis + p.flare / 10 + .045 * (p.iliacCrestRelief || 0), crest = [], rim = [];
    for (let k = 0; k <= 36; k++) {
        let u = k / 36;
        crest.push(pelvic(p, [side * (mix(.72, crestX, u) + .26 * wing * Math.sin(PI * u)), a.crest - .18 + .18 * Math.sin(PI * u) + .06 * u, mix(-.87, .62, u) - .19 * Math.sin(PI * u)]));
    }
    let aCenter = a.hipJoint, depth = p.acetabularRim ?? 1;
    for (let k = 0; k <= 40; k++) {
        let t = 2 * PI * k / 40;
        rim.push(pelvic(p, [side * (aCenter[0] + .07 * depth * Math.cos(t)), aCenter[1] + .195 * Math.sin(t), aCenter[2] + .19 * Math.cos(t)]));
    }
    let ridge = tube(crest, .042, 9), socket = tube(rim, .045 * depth, 9);
    ridge.anatomicalName = 'iliac_crest_' + (side > 0 ? 'R' : 'L');
    socket.anatomicalName = 'acetabular_rim_' + (side > 0 ? 'R' : 'L');
    return [ridge, socket];
}

// The superior rectus passes behind the costal pectoral fan. Its resting shape
// remains intact; added abdominal volume fades before reaching that covering.
const RECTUS_EXPOSURE = new WeakMap();
function rectusGrowthExposure(p, x, y) {
    if (isOriginalAbdomen(p)) return 1;
    let border = RECTUS_EXPOSURE.get(p);
    if (!border) {
        const authored = p.skinModel === 1 ? p : humanInternalParams(p);
        const m = anatomicalPectoralFan({ ...authored, rectus: 1, pectoral: 1 }, 1, 'cost');
        registerHumanInternal(p, m);
        const { rows, cols } = m.surfaceGrid, indices = [];
        for (let col = 0; col <= cols; col++) indices.push(col);
        for (let row = 1; row <= rows; row++) indices.push(row * (cols + 1));
        border = indices.map(vertex => {
            const a = vertex * 3, b = (vertex + m.shellPairs) * 3;
            return [(m.positions[a] + m.positions[b]) * .5, (m.positions[a + 1] + m.positions[b + 1]) * .5];
        }).sort((a, b) => a[0] - b[0]);
        RECTUS_EXPOSURE.set(p, border);
    }
    const edge = interpolate(border, Math.abs(x))[0];
    return 1 - smooth(edge - .30, edge, y);
}
function rectusGrowthSegments(p, x, y) {
    const wall = abdominalLayout(p, y), u = clamp((Math.abs(x) - wall.inner) / Math.max(.01, wall.width), 0, 1);
    const source = [rectusTop(u), ...rectusBands(p, x), anatomy(p).pubis + .045];
    const levels = p.skinModel === 1 ? source : source.map(humanBindY);
    let gain = 0;
    for (let i = 1; i < levels.length; i++) {
        const top = levels[i - 1], bottom = levels[i];
        if (y <= bottom || y >= top || top - bottom < .13) continue;
        const v = (y - bottom) / (top - bottom);
        gain = .30 + .70 * (1 - Math.abs(2 * v - 1) ** (2.2 + .6 * (p.rectusBellyProfile ?? 1)));
    }
    return gain * rectusGrowthExposure(p, x, y);
}

const restRectus = new WeakMap();
/** Default band layout of the same body. Other fields read through to the live parameters. */
function restRectusParameters(p) {
    let rest = restRectus.get(p);
    if (!rest) {
        rest = Object.assign(Object.create(p), { rectusSegmentCount: 6, rectusIntersectionShift: 0, rectPattern: 0 });
        if (Object.values(p.definition?.muscles ?? {}).some(shape => shape?.bellies)) {
            rest.definition = { ...p.definition, muscles: { ...p.definition.muscles } };
            for (const side of ['L', 'R']) {
                const key = 'rectus_abdominis.' + side;
                rest.definition.muscles[key] = { ...rest.definition.muscles[key], intersections: undefined, fittedIntersections: undefined, bellies: undefined, fittedBellies: undefined };
            }
        }
        restRectus.set(p, rest);
    }
    return rest;
}
function regionalEnvelopeDelta(p, x, y, z, rectusInfluence = 1, pectoralInfluence = 1) {
    const ax = Math.abs(x), side = x < 0 ? -1 : 1;
    const forward = smooth(-.10, .70, z), torso = smooth(8.00, 8.75, y) * (1 - smooth(14.05, 14.75, y));
    const on = forward * torso;
    if (torso < .0001)
        return [0, 0, 0];
    const pec = smooth(11.92, 12.30, y) * (1 - smooth(13.88, 14.25, y)) * G(ax - .88, .74);
    // Two-head fan distribution and inferior costal border.
    const clav = Math.sqrt((p.pectoralClavicular || 1) * anatomicalGrowth(p, 'pectoralis_major_clavicular')) - 1, stern = Math.sqrt((p.pectoralSternal || 1) * anatomicalGrowth(p, 'pectoralis_major_sternocostal')) - 1, cost = Math.sqrt((p.pectoralCostal || 1) * anatomicalGrowth(p, 'pectoralis_major_sternocostal')) - 1;
    let dz = pectoralInfluence * on * pec * (.23 * clav * G(y - 13.52, .35) + .24 * stern * G(y - 12.96, .54) + .20 * cost * G(y - 12.42, .35));
    dz -= pectoralInfluence * on * .10 * (p.pectoralSeparation || 0) * G(ax - .19, .18) * G(y - 13.12, .63);
    // Abdominal segments are generated from the same bands used by the rectus meshes.
    const bandMask = smooth(9.05, 9.42, y) * (1 - smooth(12.75, 13.05, y));
    // The band terms are costly per vertex and vanish exactly outside the abdominal front.
    const rectusGate = rectusInfluence * on * bandMask;
    if (rectusGate !== 0 && !p.definition?.muscles?.['rectus_abdominis.' + (x < 0 ? 'L' : 'R')]?.bellies) {
        const rg = p.rectGap / 20 + .04, rw = p.rectWidth / 10, rc = rg + rw * .47;
        let seg = 0;
        const bands = rectusBands(p, x), top = 12.95;
        for (let i = 0; i < bands.length; i++) {
            let upper = i ? bands[i - 1] : top, lower = bands[i];
            if (lower >= upper)
                continue;
            let center = (upper + lower) * .5, radius = Math.max(.14, (upper - lower) * .36);
            seg += G(y - center, radius);
        }
        const restBands = rectusBands(restRectusParameters(p), x);
        let baseSeg = 0;
        for (let i = 0; i < restBands.length; i++) {
            let upper = i ? restBands[i - 1] : top, lower = restBands[i];
            baseSeg += G(y - (upper + lower) * .5, Math.max(.14, (upper - lower) * .36));
        }
        const rectusAbdominis = G(ax - rc, Math.max(.12, rw * .51));
        const rectGrowth = Math.sqrt(anatomicalGrowth(p, 'rectus_abdominis')) - 1, growthSeg = isOriginalAbdomen(p) ? seg : rectGrowth ? rectusGrowthSegments(p, x, y) : 0;
        dz += rectusGate * rectusAbdominis * (.105 * (p.rectusSegmentDefinition - .55) * seg + .085 * .55 * (seg - baseSeg) + .105 * rectGrowth * growthSeg);
    }
    // Muscular inter-head emphasis remains bounded in both skin representations.
    dz *= 1 - .22 * clamp((p.fat - 12) / 42, 0, 1);
    dz -= rectusGate * .060 * (p.lineaAlbaDefinition - .5) * G(ax, .085);
    // Different fat compartments: visceral is broad; subcutaneous lower pouch is local;
    // love handles are posterolateral and produce lateral width, not an anterior lump.
    const visc = p.abdominalProjection || 0, pouch = p.lowerAbdominalFat || 0, handle = p.flankFullness || 0;
    dz += on * .25 * visc * G(y - 10.39, 1.13) * G(ax, .99);
    dz += on * .27 * pouch * G(y - 9.55, .57) * G(ax, .77);
    let dx = side * .23 * handle * G(y - 9.86, .72) * G(ax - 1.30, .52) * G(z + .15, .85) * smooth(.35, .85, ax) * torso;
    dz += on * .035 * handle * G(y - 9.75, .7) * G(ax - 1.18, .5);
    // Iliac crest, inguinal transition and pubic pad (separate from the ligament).
    dx += side * .10 * (p.iliacCrestRelief || 0) * G(y - 9.77, .26) * G(ax - 1.31, .34) * torso;
    dz += on * .11 * (p.iliacCrestRelief || 0) * G(y - 9.75, .25) * G(ax - 1.19, .28);
    dz += on * .20 * (p.suprapubicFat || 0) * G(y - 8.72, .35) * G(ax, .40);
    // Mons pubis: a low rounded mound over the symphysis, placed from the pubic landmark rather than the
    // mannequin so it can follow other bodies. It joins the faded inguinal grooves instead of a flat edge.
    const pubisY = p.skinModel === 1 ? anatomy(p).pubis : humanBindY(anatomy(p).pubis);
    dz += forward * smooth(pubisY - .55, pubisY - .15, y) * .075 * (1 + .5 * ((p.pubicFat ?? 1) - 1)) * G(y - (pubisY + .10), .30) * G(ax, .42);
    // Prevent local over-expansion where the torso joins the legs.
    return [clamp(dx, -.26, .26), 0, clamp(dz, -.35, .35)];
}

function applyRegionalSkin(p, skin) {
    let pos = skin.positions, moved = 0, max = 0;
    for (let i = 0; i < pos.length; i += 3) {
        let d = regionalEnvelopeDelta(p, pos[i], pos[i + 1], pos[i + 2]);
        if (!d[0] && !d[2])
            continue;
        pos[i] += d[0];
        pos[i + 2] += d[2];
        moved++;
        max = Math.max(max, Math.hypot(d[0], d[2]));
    }
    if (moved)
        skin.normals = humanNormals(pos, skin.indices);
    return skin;
}

function applyRegionalInternals(p, inside) {
    // Internal belly volumes take a portion of the SAME envelope deformation.
    // Skeletal structures and inguinal ligament retain their anatomical anchors.
    for (let [layer, list] of Object.entries(inside)) {
        if (layer === 'bones' || layer === 'inguinalLigaments')
            continue;
        for (let m of list) {
            let moved = false;
            let pos = m.positions, rectusInfluence = isOriginalAbdomen(p) || followsRectus(layer, m) ? 1 : 0, pectoralInfluence = isOriginalAbdomen(p) || /^pectoralis_major_/.test(m.anatomicalName ?? '') ? 1 : 0;
            for (let i = 0; i < pos.length; i += 3) {
                let d = regionalEnvelopeDelta(p, pos[i], pos[i + 1], pos[i + 2], rectusInfluence, pectoralInfluence), w = layer === 'aponeuroses' ? .52 : .64;
                moved ||= d[0] !== 0 || d[2] !== 0;
                pos[i] += d[0] * w;
                pos[i + 2] += d[2] * w;
            }
            if (moved) m.normals = humanNormals(pos, m.indices);
        }
    }
    return inside;
}

function buildRegionalSurface(p) {
    // Current rectus skin follows its actual bellies below. Keep the implicit
    // skin's broad master-growth field from changing chest depth or topology.
    const legacy = p.abdominalModel === 1 ? { ...p, rectus: 1 } : p;
    const skin = applyRegionalSkin(p, p.skinModel === 1 ? buildLegacySurface(legacy) : buildHumanSurface(p));
    if (p.skinModel !== 1) skin.rig = new Float32Array(HUMAN_DATA.rig);
    if (p.boneLengthsCm) { applyBoneProportions(p, skin); skin.normals = humanNormals(skin.positions, skin.indices); }
    return skin;
}
