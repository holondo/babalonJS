import './splatSupport';
import type { GLTFLoader } from '@babylonjs/loaders/glTF/2.0/glTFLoader.js';
import type { IGLTFLoaderExtension } from '@babylonjs/loaders/glTF/2.0/glTFLoaderExtension.js';
import { EditorSplatMesh } from './splatMesh';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { AssetContainer } from '@babylonjs/core/assetContainer.js';
import type { IMeshPrimitive } from '@babylonjs/loaders/glTF/2.0/glTFLoaderInterfaces.js';
import { ArrayItem } from '@babylonjs/loaders/glTF/2.0/glTFLoader.js';
import { applyMaterial } from './state';
import { splatTextures, SPLAT_GLTF_EXTENSION as NAME } from './splats';
import { tr } from './i18n';

export function createSplatExtension(loader: GLTFLoader): IGLTFLoaderExtension { return {
  name: NAME, enabled: true, dispose() {},
  _loadMeshPrimitiveAsync(context, name, _node, _mesh, primitive: IMeshPrimitive, assign) {
    const extension = primitive.extensions?.[NAME];
    if (!extension) return null;
    const scene = loader.babylonScene;
    const container = Reflect.get(loader, '_assetContainer') as AssetContainer | null;
    const wrapper = scene._executeWithBlockedEntityCollection(!!container, () => new Mesh(name, scene));
    wrapper._parentContainer = container;
    assign(wrapper);
    return (async () => {
      if (extension.version !== 1) throw new Error(`${context}: ${tr('Unsupported splat payload version.')}`);
      const read = async (index: number) => {
        const view = ArrayItem.Get(`${context}/bufferView`, loader.gltf.bufferViews, index);
        const data = await loader.loadBufferViewAsync(`${context}/bufferViews/${index}`, view);
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      };
      const data = await read(extension.bufferView);
      if (!data.length || data.length % 32) throw new Error(`${context}: ${tr('Invalid packed splat data.')}`);
      const degree = extension.shDegree;
      if (!Number.isInteger(degree) || degree < 0 || degree > 4 || !Array.isArray(extension.harmonics) || extension.harmonics.length !== Math.ceil(((degree + 1) ** 2 - 1) * 3 / 16)) {
        throw new Error(`${context}: ${tr('Invalid splat harmonics.')}`);
      }
      const count = data.length / 32, width = scene.getEngine().getCaps().maxTextureSize;
      const length = Math.ceil(count / width) * width * 16;
      const sh: Uint8Array[] = [];
      for (const ref of extension.harmonics ?? []) {
        const bytes = await read(ref.bufferView);
        if (bytes.length !== count * 16) throw new Error(`${context}: ${tr('Invalid splat harmonics.')}`);
        const padded = new Uint8Array(length); padded.set(bytes); sh.push(padded);
      }
      scene._executeWithBlockedEntityCollection(!!container, () => {
        const mesh = new EditorSplatMesh(`${name} splats`, scene);
        mesh._parentContainer = container;
        mesh.parent = wrapper;
        mesh.scaling.x = extension.rightHanded ? -1 : 1;
        mesh.updateData(data.slice().buffer, sh.length ? sh : undefined, { flipY: !!extension.flipY }, undefined, extension.shDegree);
        if (extension.appearance && mesh.material) applyMaterial(mesh.material, extension.appearance);
        // The glTF loader collects primitive roots only; this child owns its own
        // textures/material and must also belong to the disposable template.
        if (container) {
          container.meshes.push(mesh);
          if (mesh.material) container.materials.push(mesh.material);
          container.textures.push(...splatTextures(mesh));
        }
      });
      return wrapper;
    })().catch(error => { wrapper.dispose(false, true); throw error; });
  },
}; }
