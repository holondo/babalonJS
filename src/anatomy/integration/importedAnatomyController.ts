import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import type { Editor } from '../../core/editor';
import { tr } from '../../core/i18n';
import type { AnatomyMesh } from '../contracts';
import { AnatomySkinDrive, type SkinDriveStatus, type SourceCanonicalFrame } from '../binding/anatomySkinDrive';

export interface SkinDriveReport {
  targetName: string;
  /** The imported skin is embedded in the fitted anatomy and follows parameter edits. */
  bound: boolean;
  enabled: boolean;
  /** Why the skin is not driven (skinned target, missing geometry, no baseline). */
  reason: string;
  status: SkinDriveStatus | null;
  movedVertices: number;
  maxDisplacementMm: number;
  lastUpdateMs: number;
}

export interface SkinDriveTarget {
  analysisPositions?: Float32Array;
  inversePoseRotations?: Float32Array;
  inverseSkinning?: Float32Array;
  mesh: Mesh;
  name: string;
  positions: Float32Array;
  indices?: Uint32Array;
  normals?: Float32Array;
}

/** Keep the existing rig: convert fitted-pose deltas back into its bind-coordinate buffers. */
export function inverseSkinningDifferentials(mesh: Mesh): Float32Array | undefined {
  if(!mesh.skeleton) return undefined;
  const indices=mesh.getVerticesData(VertexBuffer.MatricesIndicesKind),weights=mesh.getVerticesData(VertexBuffer.MatricesWeightsKind);
  if(!indices || !weights) throw Error(tr('The rig has no usable skin weights.'));
  const extraIndices=mesh.getVerticesData(VertexBuffer.MatricesIndicesExtraKind),extraWeights=mesh.getVerticesData(VertexBuffer.MatricesWeightsExtraKind);
  const transforms=mesh.skeleton.getTransformMatrices(mesh),out=new Float32Array(mesh.getTotalVertices()*9);
  for(let v=0;v<mesh.getTotalVertices();v++) {
    const m=new Float64Array(9);
    for(let k=0;k<(extraIndices && extraWeights?8:4);k++) {
      const j=v*4+k%4,weight=k<4?weights[j]:extraWeights![j],bone=k<4?indices[j]:extraIndices![j];
      if(!weight) continue;
      for(let row=0;row<3;row++)for(let col=0;col<3;col++)m[row*3+col]+=transforms[bone*16+col*4+row]*weight;
    }
    const [a,b,c,d,e,f,g,h,i]=m,det=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);
    if(!Number.isFinite(det) || Math.abs(det)<1e-8) throw Error(tr('The fitted pose has singular skinning transforms.'));
    out.set([(e*i-f*h)/det,(c*h-b*i)/det,(b*f-c*e)/det,(f*g-d*i)/det,(a*i-c*g)/det,(c*d-a*f)/det,(d*h-e*g)/det,(b*g-a*h)/det,(a*e-b*d)/det],v*9);
  }
  return out;
}

/**
 * Binds one imported skin mesh to a fitted `AnatomyBody` and keeps it deformed from that baseline.
 *
 * The imported vertices are never re-generated: every update is a delta from the fitted state, so
 * the original geometry, UVs, materials and vertex order survive unchanged.
 */
export class ImportedAnatomyController {
  private readonly editor: Editor;
  private drive: AnatomySkinDrive | null = null;
  private mesh: Mesh | null = null;
  private deformed = false;
  private enabled = true;
  private reason = '';
  private moved = 0;
  private maxMillimeters = 0;
  private lastUpdateMs = 0;

  constructor(editor: Editor) { this.editor = editor; }

  projectBinding() { return this.drive?.projectBinding(); }

  captureBinding() {
    const { drive, mesh, enabled, lastUpdateMs } = this;
    if (!drive || !mesh) return;
    const restoreBaseline = drive.captureBaseline();
    const restoreDisplay = this.captureDisplay();
    return () => {
      if (mesh.isDisposed()) return null;
      restoreBaseline();
      this.drive = drive;
      this.mesh = mesh;
      this.enabled = enabled;
      this.lastUpdateMs = lastUpdateMs;
      this.deformed = false;
      this.moved = 0;
      this.maxMillimeters = 0;
      restoreDisplay?.();
      return this;
    };
  }

  get report(): SkinDriveReport {
    return {
      targetName: this.drive?.source.name ?? this.mesh?.name ?? '',
      bound: !!this.drive,
      enabled: this.enabled && !!this.drive,
      reason: this.reason,
      status: this.drive?.info ?? null,
      movedVertices: this.moved,
      maxDisplacementMm: this.maxMillimeters,
      lastUpdateMs: this.lastUpdateMs,
    };
  }

  /** Embeds the imported mesh in the procedural skin generated at the fitted state. */
  bind(target: SkinDriveTarget, frame: SourceCanonicalFrame, anatomySkin: AnatomyMesh, heightCm: number): SkinDriveReport {
    this.detach(true);
    this.mesh = target.mesh;
    if (target.mesh.skeleton && !target.analysisPositions) {
      this.reason = tr('Analyze the rig pose before binding its anatomical skin.');
      return this.report;
    }
    if (!target.indices?.length || !target.positions.length) {
      this.reason = tr('The model has no indexed triangles to bind.');
      return this.report;
    }
    const drive = AnatomySkinDrive.build({
      name: target.name,
      restPositions: new Float32Array(target.positions),
      indices: new Uint32Array(target.indices),
      normals: target.normals ? new Float32Array(target.normals) : undefined,
      frame,
      analysisPositions: target.analysisPositions,
      inversePoseRotations: target.inversePoseRotations,
      inverseSkinning: target.inverseSkinning ?? inverseSkinningDifferentials(target.mesh),
    }, anatomySkin, heightCm);
    this.makeUpdatable(target.mesh, VertexBuffer.PositionKind, target.positions);
    if (target.normals) this.makeUpdatable(target.mesh, VertexBuffer.NormalKind, target.normals);
    this.drive = drive;
    this.reason = '';
    this.enabled = true;
    return this.report;
  }

  /**
   * Loaded models keep static vertex buffers, and Babylon ignores updates to those without a word.
   * Recreating them once as dynamic makes every later parameter edit reach the GPU.
   */
  private makeUpdatable(mesh: Mesh, kind: string, data: Float32Array) {
    const buffer = mesh.getVertexBuffer(kind);
    if (buffer?.isUpdatable()) return;
    mesh.setVerticesData(kind, new Float32Array(data), true, buffer?.getSize() ?? 3);
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.drive?.setEnabled(enabled);
    if (!enabled) this.revert();
  }

  /** Pushes the fitted anatomy delta into the imported vertices. */
  apply(anatomySkin: AnatomyMesh, heightCm: number): SkinDriveReport {
    this.previewBuffers = undefined;
    const drive = this.drive, mesh = this.mesh;
    if (!drive || !mesh || !this.enabled) return this.report;
    const update = drive.update(anatomySkin, heightCm);
    this.lastUpdateMs = update.elapsedMs;
    this.moved = update.movedVertices;
    this.maxMillimeters = update.maxDisplacementMeters * 1000;
    if (update.identity && !this.deformed) return this.report;
    mesh.updateVerticesData(VertexBuffer.PositionKind, update.positions, false, false);
    if (update.normals) mesh.updateVerticesData(VertexBuffer.NormalKind, update.normals, false, false);
    mesh.refreshBoundingInfo(true);
    this.deformed = !update.identity;
    this.editor.refreshShadows();
    this.editor.invalidate();
    return this.report;
  }

  private previewBuffers?: {
    base: Float32Array; positions: Float32Array;
    baseNormals?: Float32Array; normals?: Float32Array;
  };

  buildPreviewDelta(base: AnatomyMesh, sample: AnatomyMesh, beforeHeight: number, afterHeight: number): SkinPreviewDelta | undefined {
    const drive = this.drive, mesh = this.mesh;
    if (!drive || !mesh || !this.enabled) return;
    const before = drive.update(base, beforeHeight);
    if (before.rebound) return;
    const positions = before.positions.slice(), normals = before.normals?.slice();
    const after = drive.update(sample, afterHeight);
    if (after.rebound) return;
    const moved: number[] = [];
    for (let i = 0; i < positions.length; i += 3) {
      for (let k = i; k < i + 3; k++) {
        positions[k] = after.positions[k] - positions[k];
        if (normals && after.normals) normals[k] = after.normals[k] - normals[k];
      }
      const positionChange = Math.max(Math.abs(positions[i]), Math.abs(positions[i + 1]), Math.abs(positions[i + 2]));
      const normalChange = normals ? Math.max(Math.abs(normals[i]), Math.abs(normals[i + 1]), Math.abs(normals[i + 2])) : 0;
      if (positionChange * Math.abs(drive.source.frame.scale) > 1e-5 || normalChange > 1e-4) moved.push(i);
    }
    const compact = (values: Float32Array) => {
      const output = new Float32Array(moved.length * 3);
      for (let i = 0; i < moved.length; i++) {
        const j = moved[i];
        output[i * 3] = values[j]; output[i * 3 + 1] = values[j + 1]; output[i * 3 + 2] = values[j + 2];
      }
      return output;
    };
    // Split at the largest gaps in vertex order. A spatial patch can occupy
    // many disjoint runs after mesh optimization.
    const ranges: [number, number][] = [];
    if (moved.length) {
      const gaps: { index: number; length: number }[] = [];
      for (let i = 1; i < moved.length; i++) {
        const length = moved[i] - moved[i - 1] - 3;
        if (length >= 768) gaps.push({ index: i, length });
      }
      const cuts = gaps.sort((a, b) => b.length - a.length).slice(0, 31).map(gap => gap.index).sort((a, b) => a - b);
      let start = 0;
      for (const end of [...cuts, moved.length]) {
        ranges.push([moved[start], moved[end - 1] + 3]);
        start = end;
      }
    }
    const covered = ranges.reduce((sum, [start, end]) => sum + end - start, 0);
    return {
      mesh, vertices: Uint32Array.from(moved), positions: compact(positions),
      normals: normals && after.normals ? compact(normals) : undefined,
      ranges: covered < positions.length * .75 ? ranges : [],
    };
  }

  preview(delta: SkinPreviewDelta, fraction: number) {
    const mesh = this.mesh;
    if (!this.enabled || !mesh || mesh !== delta.mesh || !delta.vertices.length) return 0;
    if (!this.previewBuffers) {
      const current = mesh.getVerticesData(VertexBuffer.PositionKind);
      if (!current) return 0;
      const normalData = delta.normals && mesh.getVerticesData(VertexBuffer.NormalKind);
      const gather = (source: ArrayLike<number>) => {
        const values = new Float32Array(delta.vertices.length * 3);
        for (let i = 0; i < delta.vertices.length; i++) {
          const offset = delta.vertices[i];
          for (let axis = 0; axis < 3; axis++) values[i * 3 + axis] = source[offset + axis];
        }
        return values;
      };
      this.previewBuffers = {
        base: gather(current), positions: new Float32Array(current),
        baseNormals: normalData ? gather(normalData) : undefined,
        normals: normalData ? new Float32Array(normalData) : undefined,
      };
    }
    const { base, positions, baseNormals, normals } = this.previewBuffers;
    for (let i = 0; i < delta.vertices.length; i++) {
      const offset = delta.vertices[i];
      for (let axis = 0; axis < 3; axis++) {
        const j = offset + axis, k = i * 3 + axis;
        positions[j] = base[k] + delta.positions[k] * fraction;
        if (normals && baseNormals && delta.normals) normals[j] = baseNormals[k] + delta.normals[k] * fraction;
      }
    }
    const upload = (kind: string, data: Float32Array) => {
      const buffer = mesh.getVertexBuffer(kind), gpu = buffer?.getBuffer();
      if (delta.ranges.length && gpu && buffer?.getData() === data && buffer.byteOffset === 0 && buffer.byteStride === 12) {
        // Keep Babylon's CPU copy backed by the same array while updating only
        // the corresponding slices of the already installed GPU buffer.
        for (const [start, end] of delta.ranges) mesh.getEngine().updateDynamicVertexBuffer(gpu, data.subarray(start, end), start * 4);
        if (kind === VertexBuffer.PositionKind) mesh.geometry?._resetPointsArrayCache();
        return delta.ranges.reduce((bytes, [start, end]) => bytes + (end - start) * 4, 0);
      }
      mesh.updateVerticesData(kind, data, false, false);
      return data.byteLength;
    };
    const bytes = upload(VertexBuffer.PositionKind, positions) + (normals ? upload(VertexBuffer.NormalKind, normals) : 0);
    this.deformed = true;
    return bytes;
  }

  /** Analyze the original skin while retaining an exact, cancellable display snapshot. */
  prepareForFitting():()=>void {
    const restore = this.captureDisplay();
    if (!restore) return () => {};
    this.revert();
    return restore;
  }

  private captureDisplay() {
    if(!this.mesh||!this.deformed)return;
    const mesh=this.mesh,positions=new Float32Array(mesh.getVerticesData(VertexBuffer.PositionKind)!),normalData=mesh.getVerticesData(VertexBuffer.NormalKind),normals=normalData?new Float32Array(normalData):undefined,moved=this.moved,max=this.maxMillimeters;
    return ()=>{if(this.mesh!==mesh)return;mesh.updateVerticesData(VertexBuffer.PositionKind,positions,false,false);if(normals)mesh.updateVerticesData(VertexBuffer.NormalKind,normals,false,false);mesh.refreshBoundingInfo(true);this.deformed=true;this.moved=moved;this.maxMillimeters=max;this.editor.refreshShadows();this.editor.invalidate();};
  }

  /** Returns the imported vertices to their fitted baseline (reversible at any time). */
  revert() {
    this.previewBuffers = undefined;
    if (!this.drive || !this.mesh || !this.deformed) return;
    this.mesh.updateVerticesData(VertexBuffer.PositionKind, this.drive.source.restPositions, false, false);
    if (this.drive.source.normals) this.mesh.updateVerticesData(VertexBuffer.NormalKind, this.drive.source.normals, false, false);
    this.mesh.refreshBoundingInfo(true);
    this.deformed = false;
    this.moved = 0;
    this.maxMillimeters = 0;
    this.editor.refreshShadows();
    this.editor.invalidate();
  }

  detach(revert: boolean) {
    if (revert) this.revert();
    this.drive = null;
    this.previewBuffers = undefined;
    this.mesh = null;
    this.deformed = false;
    this.reason = '';
  }

  get targetMesh() { return this.mesh; }
}
export interface SkinPreviewDelta {
  mesh: Mesh;
  vertices: Uint32Array;
  positions: Float32Array;
  normals?: Float32Array;
  ranges: [number, number][];
}
