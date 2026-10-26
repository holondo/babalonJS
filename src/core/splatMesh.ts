import { GaussianSplattingMesh } from '@babylonjs/core/Meshes/GaussianSplatting/gaussianSplattingMesh.js';
import { GaussianSplattingMeshBase } from '@babylonjs/core/Meshes/GaussianSplatting/gaussianSplattingMeshBase.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { Camera } from '@babylonjs/core/Cameras/camera.js';
import type { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import '@babylonjs/core/Rendering/boundingBoxRenderer.js';
import { materialToJSON, applyMaterial } from './state';
import { recordSplatClone } from './splats';

/** Avoid Babylon 9.30's DeepCopy of read-only texture getters when cloning splats. */
export class EditorSplatMesh extends GaussianSplattingMesh {
  /** A/B switch for the depth-order regression; does not change rendered quality. */
  reuseTranslationSorts = true;
  /** Rendering activity only: sorting must not schedule autosave or scene edits. */
  onSortReady?: () => void;
  constructor(name: string, scene: Scene) {
    const before = new Set(scene.onCameraRemovedObservable.observers);
    super(name, null, scene, true);
    // Babylon's constructor registers this closure but its dispose does not remove it.
    const observers = scene.onCameraRemovedObservable.observers.filter(observer => !before.has(observer));
    this.onDisposeObservable.add(() => observers.forEach(observer => scene.onCameraRemovedObservable.remove(observer)));
  }

  protected override _onWorkerCreated(worker: Worker) {
    super._onWorkerCreated(worker);
    worker.addEventListener('message', event => {
      if (event.data?.command === 'sorted') queueMicrotask(() => {
        if (!this.isDisposed() && this.isEnabled()) this.onSortReady?.();
      });
    });
  }

  override _postToWorker(forced = false) {
    // Babylon 9.30's counting worker sorts dot(forward, worldPoint-cameraPosition).
    // Camera translation adds the same constant to every depth: no order changes.
    // Keep direction/world/part/range invalidation and forced/first-camera sorts intact.
    if (!forced && this.reuseTranslationSorts && GaussianSplattingMeshBase.UseCountingSort) {
      const views = Reflect.get(this, '_cameraViewInfos') as Map<number, { sortAppliedId: number; splatIndexBufferSet: boolean; sortCameraPosition: Vector3 }>;
      const refresh = (camera: Camera | null) => {
        if (!camera) return;
        const view = views.get(camera.uniqueId);
        if (view?.sortAppliedId && view.splatIndexBufferSet) view.sortCameraPosition.copyFrom(camera.globalPosition);
      };
      const cameras = this.getScene().activeCameras;
      if (cameras?.length) cameras.forEach(refresh);
      else refresh(this.getScene().activeCamera);
    }
    super._postToWorker(forced);
  }

  override clone(name = this.name): GaussianSplattingMeshBase {
    const data = this.splatsData;
    if (!data) return super.clone(name);
    const copy = new EditorSplatMesh(name, this.getScene());
    copy.onSortReady = this.onSortReady;
    copy.position.copyFrom(this.position);
    copy.scaling.copyFrom(this.scaling);
    copy.rotation.copyFrom(this.rotation);
    copy.rotationQuaternion = this.rotationQuaternion?.clone() ?? null;
    copy.setPreTransformMatrix(this.getPivotMatrix().clone());
    copy.metadata = this.metadata;
    copy.isVisible = this.isVisible;
    copy.visibility = this.visibility;
    copy.isPickable = this.isPickable;
    copy.renderingGroupId = this.renderingGroupId;
    copy.layerMask = this.layerMask;
    copy.updateData(data, this.shData ?? undefined, { flipY: this._flipY }, undefined, this._maxShDegree);
    // Retain immutable source bytes once. Rendering/sorting state belongs to the copy.
    copy._shData = this.shData;
    copy.shDegree = this.shDegree;
    if (this.material && copy.material) applyMaterial(copy.material, materialToJSON(this.material));
    copy.animations = this.animations.map(animation => animation.clone());
    copy.setEnabled(this.isEnabled(false));
    if (copy.material) recordSplatClone(copy, this, copy.material);
    return copy;
  }
}
