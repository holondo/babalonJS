import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
export interface SolidInput { numProp: number; properties: Float32Array; indices: Uint32Array; runs: Uint32Array; materials: Uint32Array }
/** Figma's boolean operations: the first solid is the target, the others the tools. */
export type BooleanOperation = 'union' | 'subtract' | 'intersect';
export interface FuseRequest { solids: SolidInput[]; operation: BooleanOperation }
export interface FuseResult { numProp: number; properties: Float32Array; indices: Uint32Array; runs: Uint32Array; materials: Uint32Array }

self.onmessage = async (event: MessageEvent<FuseRequest>) => {
  const { solids: inputs, operation } = event.data;
  const solids: import('manifold-3d').Manifold[] = [];
  let union: import('manifold-3d').Manifold | undefined;
  try {
    const module = await Module({ locateFile: () => wasmUrl }); module.setup();
    const { Manifold, Mesh } = module;
    const total = inputs.reduce((n, input) => Math.max(n, ...input.materials), 0) + 1;
    const base = Manifold.reserveIDs(total);
    for (const input of inputs) {
      const mesh = new Mesh({ numProp: input.numProp, vertProperties: input.properties, triVerts: input.indices, runIndex: input.runs, runOriginalID: Uint32Array.from(input.materials, i => base + i) });
      mesh.merge();
      const solid = new Manifold(mesh); solids.push(solid);
      if (solid.status() !== 'NoError') throw new Error('invalid');
    }
    union = operation === 'subtract' ? Manifold.difference(solids) : operation === 'intersect' ? Manifold.intersection(solids) : Manifold.union(solids);
    if (union.status() !== 'NoError' || union.isEmpty()) throw new Error('invalid');
    const output = union.getMesh();
    const result: FuseResult = { numProp: output.numProp, properties: output.vertProperties, indices: output.triVerts, runs: output.runIndex, materials: Uint32Array.from(output.runOriginalID, id => id - base) };
    self.postMessage({ result }, { transfer: [result.properties.buffer, result.indices.buffer, result.runs.buffer, result.materials.buffer] });
  } catch { self.postMessage({ error: true }); }
  finally { union?.delete(); solids.forEach(s => s.delete()); }
};
