/// <reference lib="webworker" />
import { buildSplatLod } from '../optimize/splatLodMath';
self.onmessage = (event: MessageEvent<{ data: ArrayBuffer; flipY: boolean; maxLeaves: number }>) => {
  try {
    const tree = buildSplatLod(event.data.data, event.data.flipY, event.data.maxLeaves);
    self.postMessage(tree, [tree.data, tree.positions.buffer, tree.radii.buffer, tree.children.buffer]);
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
