import type { AnatomyParameters } from './parameters';

export interface AnatomyMesh {
  /** Only the outer skin/fat follow the final reference-pose surface residual. */
  fitSurface?: boolean;
  adiposePairs?: number;
  fatPaintMm?: Float32Array;
  /** Material coordinates before final fitting and posing, in authored units. */
  materialPositions?: Float32Array;
  skinFeatures?: import('./skinFeatures').SkinFeatureBindings;
  positions: Float32Array;
  /** `positions` after the parameter-only posing stage (see `referencePositions` in pose.ts), and the
   * `referenceStageKey` of the parameters it was computed with. Filled by the anatomy worker. */
  referencePositions?: Float32Array;
  referenceKey?: string;
  normals: Float32Array;
  indices: Uint32Array;
  fibers?: Float32Array;
  longitudinal?: Float32Array;
  /** Interval along the fibres where a torso-to-arm muscle follows the arm. */
  armBlend?: readonly [number, number];
  shellPairs?: number;
  surfaceGrid?: { rows: number; cols: number; kind: 'shell' | 'tube' };
  attachments?: import('./attachmentPatches').MeshAttachment[];
  followers?: import('./connective').SurfaceFollower[];
  tissue?: Float32Array;
  rig?: Float32Array;
  rigRegion?: string;
  anatomicalName?: string;
  anatomyId?: string;
}
export interface AnatomyJob { id: number; parameters: AnatomyParameters; layers: string[]; }
export interface AnatomyResult {
  id: number;
  meshes: Record<string, AnatomyMesh[]>;
  navel: number[];
  inspection: number[][][];
  computeMs: number;
  inguinalAngle: number;
  inguinalHeight: number;
  error?: string;
  anatomyMetrics?: import('./regions/abdomen').AnatomyMetric[];
  attachments?: import('./attachmentPatches').AttachmentMetric[];
  contacts?: import('./tissueContact').ContactMetric[];
  contactLean?: AnatomyMesh;
  lumbarFascia?: AnatomyMesh[];
}
