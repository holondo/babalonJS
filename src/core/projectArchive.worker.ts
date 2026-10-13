/// <reference lib="webworker" />
import { zipSync, unzipSync } from 'fflate';
import type { Zippable } from 'fflate';

self.onmessage = (event: MessageEvent<{ type: 'zip'; entries: Zippable } | { type: 'unzip'; data: Uint8Array }>) => {
  try {
    const request = event.data;
    const data = request.type === 'zip' ? zipSync(request.entries) : unzipSync(request.data);
    const buffers = data instanceof Uint8Array ? [data.buffer] : Object.values(data).map(value => value.buffer);
    self.postMessage({ data }, [...new Set(buffers)]);
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
