import type { AnatomyMesh } from '../contracts';
import type { Vec3M } from '../landmarks';
import { accumulateSkinNormals, buildSkinCorrespondence, sampleSurfaceDelta, computeSmoothNormals, updateDrivenSkinNormals, type SkinCorrespondence } from './skinCorrespondence';

/** Canonical frame of the product: 1.80 m tall, feet at y = 0, +Z forward, +X anatomical right. */
export const CANONICAL_HEIGHT_METERS = 1.8;

/**
 * Maps the imported mesh's own coordinates into canonical meters:
 * `c = scale * R(yaw) * p + offset`. Built from the P2 analysis so source units,
 * yaw and centering never leak into the anatomy generator.
 */
export interface SourceCanonicalFrame {
  yaw: number;
  forwardSign?: 1 | -1;
  scale: number;
  offset: Vec3M;
  zUp?: boolean;
}

export function uprightSource(zUp: boolean | undefined, x: number, y: number, z: number): Vec3M {
  return zUp ? [x, z, -y] : [x, y, z];
}

export const IDENTITY_SOURCE_FRAME: SourceCanonicalFrame = { yaw: 0, scale: 1, offset: [0, 0, 0] };

export function sourceFrameFromAnalysis(analysis: SourceCanonicalFrame): SourceCanonicalFrame {
  return { ...analysis, offset: [...analysis.offset] };
}

export function sourcePointToCanonical(frame: SourceCanonicalFrame, x: number, y: number, z: number): Vec3M {
  if (frame.zUp) [x,y,z] = uprightSource(true,x,y,z);
  const cos = Math.cos(frame.yaw), sin = Math.sin(frame.yaw);
  return [
    (cos * x + sin * z) * frame.scale + frame.offset[0],
    y * frame.scale + frame.offset[1],
    (-sin * x + cos * z) * frame.scale * (frame.forwardSign??1) + frame.offset[2],
  ];
}

/** Inverse of {@link sourcePointToCanonical} for a direction (no translation). */
export function canonicalDeltaToSource(frame: SourceCanonicalFrame, dx: number, dy: number, dz: number): Vec3M {
  const cos = Math.cos(-frame.yaw), sin = Math.sin(-frame.yaw), scale = frame.scale || 1;
  const x = (cos * dx + sin * dz * (frame.forwardSign??1)) / scale;
  const y = dy / scale, z = (-sin * dx + cos * dz * (frame.forwardSign??1)) / scale;
  return frame.zUp ? [x,-z,y] : [x,y,z];
}
export function sourcePointFromCanonical(frame: SourceCanonicalFrame, x: number, y: number, z: number): Vec3M {
  return canonicalDeltaToSource(frame,x-frame.offset[0],y-frame.offset[1],z-frame.offset[2]);
}

/**
 * The generator works in 10 cm units with y scaled by `height / 175`; the imported body is
 * normalized to 1.80 m. This converts one generator vertex into canonical meters.
 */
export function canonicalAnatomyFactors(heightCm: number) {
  const lateral = 0.1 * CANONICAL_HEIGHT_METERS / Math.max(0.01, heightCm / 100);
  // The generator's own body is 17.5 internal units tall (1.75 m) before `height` stretches it.
  const vertical = 0.1 * CANONICAL_HEIGHT_METERS / (17.5 * 0.1);
  return { lateral, vertical };
}

function canonicalizeAnatomySkin(positions: Float32Array, heightCm: number, out: Float32Array) {
  const { lateral, vertical } = canonicalAnatomyFactors(heightCm);
  for (let i = 0; i < positions.length; i += 3) {
    out[i] = positions[i] * lateral;
    out[i + 1] = positions[i + 1] * vertical;
    out[i + 2] = positions[i + 2] * lateral;
  }
}

/** Cheap topology fingerprint: an equal-length index buffer can still be a different mesh. */
function topologyHash(indices: Uint32Array): number {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < indices.length; i++) {
    hash ^= indices[i];
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

export interface SkinDriveSource {
  /** Neutral analysis copy, separate from the immutable original skin. */
  analysisPositions?: Float32Array;
  inversePoseRotations?: Float32Array;
  /** Inverse fitted-pose skinning differentials, mapping local edits back to bind vertices. */
  inverseSkinning?: Float32Array;
  name: string;
  /** Immutable snapshot of the imported vertices in source-local units. */
  restPositions: Float32Array;
  indices?: Uint32Array;
  normals?: Float32Array;
  frame: SourceCanonicalFrame;
}

export interface SkinDriveUpdate {
  /** True when the anatomy did not change: the imported skin keeps its baseline vertices. */
  identity: boolean;
  /** New source-local positions (the rest array itself while identity). */
  positions: Float32Array;
  normals?: Float32Array;
  movedVertices: number;
  maxDisplacementMeters: number;
  /** The procedural skin topology changed, so the embedding was rebuilt at the current state. */
  rebound: boolean;
  elapsedMs: number;
}

export interface SkinDriveStatus {  targetName: string;
  enabled: boolean;
  unmatchedVertices: number;
  medianDistanceMm: number;
  maxDistanceMm: number;
  baselineHeightCm: number;
  rebinds: number;
}

/**
 * Drives the imported GLB skin from the procedural anatomy, relative to the fitted baseline.
 *
 * `v(theta) = v(theta0) + sum_k w_k * (C_k(theta) - C_k(theta0))`
 *
 * so the result is exactly the imported geometry at the fitted state, whatever the residual
 * difference between the procedural surface and the imported one.
 */
export class AnatomySkinDrive {
  private projectBaseline: Float32Array;
  private projectBlob?: Blob;
  readonly source: SkinDriveSource;
  private baselineSurface: Float32Array;
  private baselineIndices: Uint32Array;
  private baselineTopology: number;
  private correspondence: SkinCorrespondence;
  private current: Float32Array;
  private smoothing: Float32Array;
  private neighbors: Uint32Array[];
  private readonly delta: Float32Array;
  private readonly out: Float32Array;
  private readonly normals: Float32Array;
  private readonly movedMask: Uint8Array;
  private restNormalSums?: Float32Array;
  private rebinds = 0;
  private status: SkinDriveStatus;

  private constructor(source: SkinDriveSource, anatomySkin: AnatomyMesh, heightCm: number) {
    this.projectBaseline = anatomySkin.positions;
    this.source = source;
    this.baselineIndices = new Uint32Array(anatomySkin.indices);
    this.baselineTopology = topologyHash(this.baselineIndices);
    this.baselineSurface = new Float32Array(anatomySkin.positions.length);
    canonicalizeAnatomySkin(anatomySkin.positions, heightCm, this.baselineSurface);
    this.current = new Float32Array(this.baselineSurface.length);
    this.smoothing = new Float32Array(this.current.length);
    this.neighbors = this.buildNeighbors();
    this.correspondence = this.embed();
    this.delta = new Float32Array(source.restPositions.length);
    this.out = new Float32Array(source.restPositions.length);
    this.normals = source.indices ? new Float32Array(source.restPositions.length) : new Float32Array(0);
    this.movedMask = new Uint8Array(source.restPositions.length / 3);
    this.status = {
      targetName: source.name,
      enabled: true,
      unmatchedVertices: this.correspondence.unmatched + this.correspondence.clamped.reduce((sum,value,index)=>sum+(value && this.correspondence.triangle[index]>=0?1:0),0),
      medianDistanceMm: this.correspondence.medianDistance * 1000,
      maxDistanceMm: this.correspondence.maxDistance * 1000,
      baselineHeightCm: heightCm,
      rebinds: 0,
    };
  }

  static build(source: SkinDriveSource, anatomySkin: AnatomyMesh, heightCm: number): AnatomySkinDrive {
    return new AnatomySkinDrive(source, anatomySkin, heightCm);
  }

  private embed(): SkinCorrespondence {
    if(this.source.analysisPositions) return buildSkinCorrespondence(this.source.analysisPositions,this.baselineSurface,this.baselineIndices);
    const canonicalSource = new Float32Array(this.source.restPositions.length);
    for (let i = 0; i < canonicalSource.length; i += 3) {
      const [x, y, z] = sourcePointToCanonical(this.source.frame, this.source.restPositions[i], this.source.restPositions[i + 1], this.source.restPositions[i + 2]);
      canonicalSource[i] = x; canonicalSource[i + 1] = y; canonicalSource[i + 2] = z;
    }
    return buildSkinCorrespondence(canonicalSource, this.baselineSurface, this.baselineIndices);
  }

  private buildNeighbors(): Uint32Array[] {
    const neighbors = Array.from({ length: this.baselineSurface.length / 3 }, () => new Set<number>());
    for (let i = 0; i < this.baselineIndices.length; i += 3) {
      for (let edge = 0; edge < 3; edge++) {
        const a = this.baselineIndices[i + edge], b = this.baselineIndices[i + (edge + 1) % 3];
        if (a === b) continue;
        neighbors[a].add(b);
        neighbors[b].add(a);
      }
    }
    return neighbors.map(set => Uint32Array.from(set));
  }

  /** Smooth displacement on the small driver mesh, preserving source detail. */
  private smoothDisplacement() {
    for (let pass = 0; pass < 2; pass++) {
      for (let vertex = 0; vertex < this.neighbors.length; vertex++) {
        const neighbors = this.neighbors[vertex], offset = vertex * 3;
        for (let axis = 0; axis < 3; axis++) {
          const index = offset + axis;
          let sum = 0;
          for (const neighbor of neighbors) {
            const other = neighbor * 3 + axis;
            sum += (this.current[other] - this.baselineSurface[other]) - (this.current[index] - this.baselineSurface[index]);
          }
          this.smoothing[index] = this.current[index] + .25 * sum / Math.max(1, neighbors.length);
        }
      }
      [this.current, this.smoothing] = [this.smoothing, this.current];
    }
  }

  get info(): SkinDriveStatus { return { ...this.status, rebinds: this.rebinds }; }

  /** Keep the embedding used by a Fit even if a later edit changes skin topology. */
  captureBaseline() {
    const baseline = {
      projectBaseline: this.projectBaseline, projectBlob: this.projectBlob,
      baselineIndices: this.baselineIndices, baselineSurface: this.baselineSurface,
      baselineTopology: this.baselineTopology, neighbors: this.neighbors,
      correspondence: this.correspondence, rebinds: this.rebinds,
    };
    const status = this.info;
    return () => {
      Object.assign(this, baseline);
      this.status = { ...status };
      if (this.current.length !== baseline.baselineSurface.length) {
        this.current = new Float32Array(baseline.baselineSurface.length);
        this.smoothing = new Float32Array(this.current.length);
      }
    };
  }

  projectBinding() {
    const buffers = [this.projectBaseline, this.baselineIndices, this.source.analysisPositions,
      this.source.inversePoseRotations, this.source.inverseSkinning];
    return {
      frame: this.source.frame, height: this.status.baselineHeightCm,
      lengths: buffers.map(buffer => buffer?.length ?? 0),
      blob: this.projectBlob ??= new Blob(buffers.flatMap(buffer => buffer ? [buffer.slice().buffer] : [])),
    };
  }

  setEnabled(enabled: boolean) { this.status.enabled = enabled; }
  get enabled() { return this.status.enabled; }

  /** Re-embeds at the current anatomy state, so a topology change keeps the displayed skin. */
  private rebind(skin: AnatomyMesh, heightCm: number) {
    this.projectBaseline = skin.positions;
    this.projectBlob = undefined;
    this.baselineIndices = new Uint32Array(skin.indices);
    this.baselineTopology = topologyHash(this.baselineIndices);
    this.baselineSurface = new Float32Array(skin.positions.length);
    canonicalizeAnatomySkin(skin.positions, heightCm, this.baselineSurface);
    this.current = new Float32Array(this.baselineSurface.length);
    this.smoothing = new Float32Array(this.current.length);
    this.neighbors = this.buildNeighbors();
    this.correspondence = this.embed();
    this.rebinds++;
    this.status.unmatchedVertices = this.correspondence.unmatched + this.correspondence.clamped.reduce((sum,value,index)=>sum+(value && this.correspondence.triangle[index]>=0?1:0),0);
    this.status.medianDistanceMm = this.correspondence.medianDistance * 1000;
    this.status.maxDistanceMm = this.correspondence.maxDistance * 1000;
    this.status.baselineHeightCm = heightCm;
  }

  update(skin: AnatomyMesh, heightCm: number): SkinDriveUpdate {
    const start = performance.now();
    const identity = (rebound: boolean): SkinDriveUpdate => ({
      identity: true, positions: this.source.restPositions, normals: this.source.normals,
      movedVertices: 0, maxDisplacementMeters: 0, rebound, elapsedMs: performance.now() - start,
    });
    if (!this.status.enabled) return identity(false);
    if (skin.indices.length !== this.baselineIndices.length || skin.positions.length !== this.baselineSurface.length || topologyHash(skin.indices) !== this.baselineTopology) {
      this.rebind(skin, heightCm);
      return identity(true);
    }
    canonicalizeAnatomySkin(skin.positions, heightCm, this.current);
    this.smoothDisplacement();
    if (!sampleSurfaceDelta(this.correspondence, this.baselineIndices, this.baselineSurface, this.current, this.delta)) return identity(false);

    const frame = this.source.frame;
    const [xx, xy, xz] = canonicalDeltaToSource(frame, 1, 0, 0);
    const [yx, yy, yz] = canonicalDeltaToSource(frame, 0, 1, 0);
    const [zx, zy, zz] = canonicalDeltaToSource(frame, 0, 0, 1);
    let moved = 0, maxMeters = 0;
    for (let i = 0; i < this.source.restPositions.length; i += 3) {
      let dx = this.delta[i], dy = this.delta[i + 1], dz = this.delta[i + 2];
      if (dx === 0 && dy === 0 && dz === 0) {
        this.movedMask[i / 3] = 0;
        this.out[i] = this.source.restPositions[i];
        this.out[i + 1] = this.source.restPositions[i + 1];
        this.out[i + 2] = this.source.restPositions[i + 2];
        continue;
      }
      const rotations=this.source.inversePoseRotations;
      if(rotations) {
        const j=i*3,x=dx,y=dy,z=dz;
        dx=rotations[j]*x+rotations[j+1]*y+rotations[j+2]*z;
        dy=rotations[j+3]*x+rotations[j+4]*y+rotations[j+5]*z;
        dz=rotations[j+6]*x+rotations[j+7]*y+rotations[j+8]*z;
      }
      let lx = xx*dx + yx*dy + zx*dz, ly = xy*dx + yy*dy + zy*dz, lz = xz*dx + yz*dy + zz*dz;
      const inverse=this.source.inverseSkinning;
      if(inverse) {
        const j=i*3,x=lx,y=ly,z=lz;
        lx=inverse[j]*x+inverse[j+1]*y+inverse[j+2]*z;
        ly=inverse[j+3]*x+inverse[j+4]*y+inverse[j+5]*z;
        lz=inverse[j+6]*x+inverse[j+7]*y+inverse[j+8]*z;
      }
      this.out[i] = this.source.restPositions[i] + lx;
      this.out[i + 1] = this.source.restPositions[i + 1] + ly;
      this.out[i + 2] = this.source.restPositions[i + 2] + lz;
      this.movedMask[i / 3] = 1;
      moved++;
      const length = Math.hypot(dx, dy, dz);
      if (length > maxMeters) maxMeters = length;
    }
    if (this.normals.length && this.source.indices) {
      const { normals, restPositions, indices } = this.source;
      if (normals?.length === this.normals.length) {
        if (!this.restNormalSums) {
          this.restNormalSums = new Float32Array(restPositions.length);
          accumulateSkinNormals(restPositions, indices, this.restNormalSums);
        }
        updateDrivenSkinNormals(this.out, indices, restPositions, this.movedMask, this.restNormalSums, normals, this.normals);
      } else computeSmoothNormals(this.out, indices, this.normals);
    }
    return {
      identity: false,
      positions: this.out,
      normals: this.normals.length ? this.normals : undefined,
      movedVertices: moved,
      maxDisplacementMeters: maxMeters,
      rebound: false,
      elapsedMs: performance.now() - start,
    };
  }
}
