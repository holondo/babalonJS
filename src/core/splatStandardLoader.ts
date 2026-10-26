import './splatSupport';
import type { GLTFLoader } from '@babylonjs/loaders/glTF/2.0/glTFLoader.js';
import { ArrayItem } from '@babylonjs/loaders/glTF/2.0/glTFLoader.js';
import type { IGLTFLoaderExtension } from '@babylonjs/loaders/glTF/2.0/glTFLoaderExtension.js';
import type { AssetContainer } from '@babylonjs/core/assetContainer.js';
import { EditorSplatMesh } from './splatMesh';
import { splatTextures, SPLAT_GLTF_EXTENSION } from './splats';
import { STANDARD_SPLAT_EXTENSION as NAME, SH_C0 } from './splatStandard';
import { tr } from './i18n';

/** Standard ellipse import with the editor's retained source and disposable clone lifecycle. */
export function createStandardSplatExtension(loader: GLTFLoader): IGLTFLoaderExtension { return {
  name: 'BABALON_standard_gaussian_loader', enabled: true, order: 100, dispose() {},
  _loadMeshPrimitiveAsync(context, name, _node, _mesh, primitive, assign) {
    const extension = primitive.extensions?.[NAME];
    if (!extension || primitive.extensions?.[SPLAT_GLTF_EXTENSION]) return null;
    if (primitive.mode !== 0 || extension.kernel !== 'ellipse' || extension.colorSpace !== 'srgb_rec709_display') {
      throw new Error(`${context}: ${tr('Unsupported Gaussian kernel or color space.')}`);
    }
    const scene = loader.babylonScene;
    const container = Reflect.get(loader, '_assetContainer') as AssetContainer | null;
    const mesh = scene._executeWithBlockedEntityCollection(!!container, () => new EditorSplatMesh(name, scene));
    mesh._parentContainer = container;
    assign(mesh);
    return (async () => {
      const invalid = (detail: string) => new Error(`${context}: ${tr('Invalid Gaussian data. Check attributes and harmonic bands.')} (${detail})`);
      const read = async (name: string, type: string) => {
        const index = primitive.attributes[name];
        if (index === undefined) throw invalid(name);
        const accessor = ArrayItem.Get(`${context}/attributes/${name}`, loader.gltf.accessors, index);
        if (accessor.type !== type) throw invalid(`${name}: ${type}`);
        const values = await loader._loadFloatAccessorAsync(`${context}/accessors/${index}`, accessor);
        if (!values.every(Number.isFinite)) throw invalid(`${name}: NaN/Infinity`);
        return values;
      };
      const [positions, rotations, scales, opacity, dc] = await Promise.all([
        read('POSITION', 'VEC3'), read(`${NAME}:ROTATION`, 'VEC4'), read(`${NAME}:SCALE`, 'VEC3'),
        read(`${NAME}:OPACITY`, 'SCALAR'), read(`${NAME}:SH_DEGREE_0_COEF_0`, 'VEC3'),
      ]);
      const count = positions.length / 3;
      if (!count || rotations.length !== count * 4 || scales.length !== count * 3 || opacity.length !== count || dc.length !== count * 3) throw invalid('count');
      const harmonics: Float32Array[] = [];
      let degree = 0, gap = false;
      for (let l = 1; l <= 3; l++) {
        const names = Array.from({ length: 2 * l + 1 }, (_, m) => `${NAME}:SH_DEGREE_${l}_COEF_${m}`);
        const present = names.filter(name => primitive.attributes[name] !== undefined).length;
        if (!present) { gap = true; continue; }
        if (gap || present !== names.length) throw invalid(`SH degree ${l}`);
        for (const name of names) {
          const values = await read(name, 'VEC3');
          if (values.length !== count * 3) throw invalid(`${name}: count`);
          harmonics.push(values);
        }
        degree = l;
      }
      const data = new ArrayBuffer(count * 32), floats = new Float32Array(data), bytes = new Uint8Array(data);
      const width = scene.getEngine().getCaps().maxTextureSize;
      const sh = Array.from({ length: Math.ceil(harmonics.length * 3 / 16) }, () => new Uint8Array(Math.ceil(count / width) * width * 16).fill(128));
      const byte = (value: number) => Math.round(Math.min(255, Math.max(0, value)));
      for (let i = 0; i < count; i++) {
        const b = i * 32, f = i * 8, p = i * 3, r = i * 4;
        if (opacity[i] < 0 || opacity[i] > 1 || scales.subarray(p, p + 3).some(v => v < 0)) throw invalid(`SCALE/OPACITY: ${i}`);
        floats.set(positions.subarray(p, p + 3), f); floats.set(scales.subarray(p, p + 3), f + 3);
        for (let c = 0; c < 3; c++) bytes[b + 24 + c] = byte((dc[p + c] * SH_C0 + 0.5) * 255);
        bytes[b + 27] = byte(opacity[i] * 255);
        for (let c = 0; c < 4; c++) bytes[b + 28 + c] = byte(rotations[r + (c + 3) % 4] * 127.5 + 127.5);
        for (let k = 0; k < harmonics.length; k++) for (let c = 0; c < 3; c++) {
          const flat = k * 3 + c;
          sh[flat >> 4][i * 16 + (flat & 15)] = byte(harmonics[k][p + c] * 128 + 128);
        }
        if (i && i % 16384 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      }
      await mesh.updateDataAsync(data, sh.length ? sh : undefined, undefined, degree);
      if (container) {
        if (mesh.material) container.materials.push(mesh.material);
        container.textures.push(...splatTextures(mesh));
      }
      return mesh;
    })().catch(error => { mesh.material?.dispose(); mesh.dispose(); throw error; });
  },
}; }
