import type { Zippable } from 'fflate';

function run<T>(request: { type: 'zip'; entries: Zippable } | { type: 'unzip'; data: Uint8Array }, buffers: ArrayBuffer[]) {
  return new Promise<T>((resolve, reject) => {
    const worker = new Worker(new URL('./projectArchive.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = event => {
      worker.terminate();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.data);
    };
    worker.onerror = event => { worker.terminate(); reject(new Error(event.message || 'Archive worker error')); };
    worker.onmessageerror = () => { worker.terminate(); reject(new Error('Invalid archive worker response')); };
    try { worker.postMessage(request, buffers); }
    catch (error) { worker.terminate(); reject(error); }
  });
}

export function zipProject(entries: Zippable, buffers: ArrayBuffer[]) {
  return run<Uint8Array<ArrayBuffer>>({ type: 'zip', entries }, buffers);
}

export function unzipProject(data: Uint8Array<ArrayBuffer>) {
  return run<Record<string, Uint8Array<ArrayBuffer>>>({ type: 'unzip', data }, [data.buffer]);
}
