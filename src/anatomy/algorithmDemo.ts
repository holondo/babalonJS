import { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import type { Editor } from '../core/editor';
import { tr } from '../core/i18n';
import { AnatomyEngine } from './algorithms/engine';
import { hamstringDemo } from './algorithms/fixtures';
import { calculateNormals } from './algorithms/loft';
import { writeGeneratedGeometry } from './algorithms/babylonAdapter';

/** A static algorithm sample imported as an ordinary, persistable editor model. */
export async function addAnatomyAlgorithmDemo(editor: Editor): Promise<void> {
  // The source algorithms use right-handed metres. glTF preserves that frame;
  // the ordinary importer performs the conversion to the editor's scene frame.
  const scene = new Scene(editor.engine);
  scene.useRightHandedSystem = true;
  try {
    const model = hamstringDemo();
    const engine = new AnatomyEngine(model);
    const boneMaterial = new PBRMaterial('Demo bones', scene);
    boneMaterial.albedoColor = new Color3(.82, .79, .67);
    boneMaterial.metallic = 0;
    boneMaterial.roughness = .7;
    const muscleMaterial = new PBRMaterial('Demo muscle', scene);
    muscleMaterial.albedoColor = new Color3(.55, .12, .16);
    muscleMaterial.metallic = 0;
    muscleMaterial.roughness = .55;
    for (const bone of model.bones) {
      const mesh = new Mesh(bone.id, scene);
      writeGeneratedGeometry(mesh, { ...bone.mesh, normals: calculateNormals(bone.mesh.positions, bone.mesh.indices) });
      mesh.material = boneMaterial;
    }
    for (const muscle of engine.buildAll()) {
      const mesh = new Mesh(muscle.id, scene);
      writeGeneratedGeometry(mesh, muscle.geometry);
      mesh.material = muscleMaterial;
    }
    const { GLTF2Export } = await import('@babylonjs/serializers/glTF/2.0/glTFSerializer.js');
    const data = await GLTF2Export.GLBAsync(scene, 'anatomy-demo');
    await editor.addFiles([new File([data.files['anatomy-demo.glb']], `${tr('Anatomy algorithm demo')}.glb`, { type: 'model/gltf-binary' })]);
  } finally {
    scene.dispose();
  }
}
