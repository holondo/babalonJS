import type { HumanoidMeshAnalysis } from '../fitBody';
import type { connectedSurfaceProxy } from './surfaceProxy';

/** Small posed reference reused between the initial fit and fixed-bone refinement. */
export interface PoseObservation {
  signature: string;
  proxy: Awaited<ReturnType<typeof connectedSurfaceProxy>>;
  analysis: Omit<HumanoidMeshAnalysis, 'neutralPositions' | 'inversePoseRotations' | 'estimatedParameters'>;
}
