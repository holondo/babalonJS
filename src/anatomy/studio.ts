import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import type { AnatomyParameters } from './parameters';

/** Optional original study illumination, implemented with real PBR lights limited to this body. */
export class AnatomyStudio {
  private lights: DirectionalLight[] = [];
  private readonly scene: Scene;
  constructor(scene: Scene) { this.scene = scene; }
  update(enabled: boolean, p: AnatomyParameters, meshes: AbstractMesh[]) {
    if (enabled && !this.lights.length) this.lights = ['Anatomy key', 'Anatomy fill', 'Anatomy rim'].map(name => new DirectionalLight(name, Vector3.Down(), this.scene));
    const az = p.azimuth * Math.PI / 180, el = p.elevation * Math.PI / 180;
    const directions = [new Vector3(-Math.sin(az)*Math.cos(el), -Math.sin(el), -Math.cos(az)*Math.cos(el)), new Vector3(-.7,-.4,-.8), new Vector3(-.6,-.5,1)];
    const intensities = [p.intensity, p.fill, p.rim];
    for (const [i, light] of this.lights.entries()) {
      light.setEnabled(enabled);
      light.includedOnlyMeshes = meshes;
      light.direction.copyFrom(directions[i]).normalize();
      light.intensity = intensities[i];
    }
  }
  dispose() { this.lights.forEach(light => light.dispose()); this.lights = []; }
}
