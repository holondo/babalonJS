/** Cache code without importing/evaluating it. Interrupted downloads resume from Cache Storage. */
const CDN = 'https://cdn.babylonjs.com/';
export const OFFLINE_DECODERS = [
  'meshopt_decoder.js', 'draco_wasm_wrapper_gltf.js', 'draco_decoder_gltf.wasm', 'draco_decoder_gltf.js',
  'babylon.ktx2Decoder.js', 'zstddec.wasm',
  ...['msc_basis_transcoder.js', 'msc_basis_transcoder.wasm', 'uastc_astc.wasm', 'uastc_bc7.wasm',
    'uastc_r8_unorm.wasm', 'uastc_rg8_unorm.wasm', 'uastc_rgba8_srgb_v2.wasm', 'uastc_rgba8_unorm_v2.wasm']
    .map(file => `ktx2Transcoders/1/${file}`),
].map(file => `${CDN}${file}`);

export function installedDisplay() {
  return ['standalone', 'minimal-ui', 'window-controls-overlay'].some(mode => matchMedia(`(display-mode: ${mode})`).matches)
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export async function prepareOffline(base: string, progress: (value: number) => void, entry: string) {
  await navigator.serviceWorker.ready;
  const manifestURL = new URL(`${base}offline-assets.json`, location.origin);
  manifestURL.searchParams.set('entry', entry);
  const manifests = await caches.open('offline-manifest');
  let response: Response | undefined;
  try {
    response = await fetch(manifestURL, { cache: 'no-cache', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Offline manifest: ${response.status}`);
    if ((await response.clone().json()).entry !== entry) throw new Error('Offline manifest belongs to another app version');
    await manifests.put(manifestURL, response.clone());
  } catch (error) {
    response = await manifests.match(manifestURL);
    if (!response) throw error;
  }
  const { assets } = await response.json() as { assets: string[] };
  if (!Array.isArray(assets) || !assets.length || assets.some(file => !/^assets\/[\w.-]+\.(?:js|css|wasm)$/.test(file))) throw new Error('Invalid offline manifest');
  const urls = [...new Set([...assets.map(file => new URL(`${base}${file}`, location.origin).href), ...OFFLINE_DECODERS])];
  let completed = 0;
  let next = 0;
  let failure: unknown;
  progress(0);
  // Two bounded downloads; never buffer all modules or start workers to warm their code.
  await Promise.all([0, 1].map(async () => {
    while (next < urls.length && !failure) {
      const url = urls[next++];
      try {
        if (!(await caches.match(url, { ignoreVary: true }))) {
          const result = await fetch(url, { signal: AbortSignal.timeout(30000) });
          if (!result.ok) throw new Error(`Offline download: ${result.status}`);
          const name = url.startsWith(CDN) ? 'babylon-cdn' : /\.(?:wasm)$/.test(url) ? 'encoders' : 'feature-code';
          await (await caches.open(name)).put(url, result);
        }
        progress(++completed / urls.length);
      } catch (error) { failure = error; }
    }
  }));
  if (failure) throw failure;
}
