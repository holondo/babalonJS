import type { Editor } from '../core/editor';
import { isSplat } from '../core/splats';
import type { SplatLodTree } from '../optimize/splatLodMath';
import { appendNativeSplats, type NativeSplatPart } from './nativeSplatPackage';

/** Snapshot the current composition, preparing only disposable copies in a worker. */
export async function exportNativeAR(editor: Editor) {
  const sources = [...new Set(editor.entities.filter(e => e.visible).flatMap(e => e.meshes.filter(isSplat)))].filter(m => m.isEnabled() && m.isVisible);
  const parts: NativeSplatPart[] = [];
  // Bound native GPU/CPU atlas memory across the composition, including copied objects.
  const maxLeaves = Math.max(1, Math.floor(131072 / Math.max(1, sources.length)));
  if (sources.length) {
    const worker = new Worker(new URL('./nativeSplat.worker.ts', import.meta.url), { type: 'module' });
    try {
      const cache = new Map<ArrayBuffer, Map<boolean, SplatLodTree>>();
      for (const source of sources) {
        if (!source.splatsData) throw new Error('Gaussian source bytes are unavailable');
        const flipY = !!Reflect.get(source, '_flipY');
        let tree = cache.get(source.splatsData)?.get(flipY);
        if (!tree) {
          const data = source.splatsData.slice(0);
          tree = await new Promise<SplatLodTree>((resolve, reject) => {
            worker.onmessage = event => event.data.error ? reject(new Error(event.data.error)) : resolve(event.data);
            worker.onerror = event => reject(new Error(event.message));
            worker.postMessage({ data, flipY, maxLeaves }, [data]);
          });
          if (!cache.has(source.splatsData)) cache.set(source.splatsData, new Map());
          cache.get(source.splatsData)!.set(flipY, tree);
        }
        const matrix = Array.from(source.computeWorldMatrix(true).m);
        // Reflection from Babylon's left-handed world to the native glTF/ARCore world.
        if (!editor.scene.useRightHandedSystem) for (const i of [0, 4, 8, 12]) matrix[i] *= -1;
        parts.push({ tree, matrix, alpha: source.material?.alpha ?? 1 });
      }
    } finally { worker.terminate(); }
  }
  return appendNativeSplats(await editor.exportGLB(false, true, false, true), parts);
}
