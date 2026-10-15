import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Served from a subfolder on GitHub Pages (https://<user>.github.io/<repo>/): the deploy
// workflow sets BASE_PATH=/<repo>/. Locally it stays at the root.
const base = process.env.BASE_PATH || '/';

export default defineConfig({
  base,
  build: { manifest: true },
  // Prebundle the lazy GLB factory and newly used Babylon modules before the first
  // upload. Discovering them mid-import otherwise invalidates Vite's module URLs.
  // This affects development only; production keeps these modules loaded on demand.
  optimizeDeps: {
    include: [
      '@babylonjs/loaders/glTF/2.0/glTFLoader.pure.js',
      '@babylonjs/core/Meshes/instancedMesh.pure.js',
      '@babylonjs/core/Gizmos/gizmoManager.js',
      '@babylonjs/core/Cameras/universalCamera.js',
      '@babylonjs/serializers/glTF/2.0/glTFExporter.js',
      '@babylonjs/serializers/glTF/2.0/glTFSerializer.js',
      '@babylonjs/serializers/glTF/2.0/index.js',
    ],
  },
  plugins: [
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['licenses/earcut.txt', 'licenses/manifold-3d.txt', 'favicon.ico', 'icons/apple-touch-icon.png', 'brand/lettering.webp', 'brand/lettering.png', 'brand/logo.webp', 'brand/logo.png'],
      manifest: {
        id: base,
        name: 'babalon JS',
        short_name: 'babalon',
        description: 'Compose 3D scenes: place models, light them and take photos.',
        start_url: base,
        scope: base,
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone'],
        orientation: 'any',
        background_color: '#120d1b',
        theme_color: '#120d1b',
        categories: ['graphics', 'design', 'photo'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Installed on desktop, the app can be chosen to open these files
        file_handlers: [
          {
            action: base,
            accept: {
              'application/x-babalon': ['.babalon'],
              'model/gltf-binary': ['.glb'],
              'model/gltf+json': ['.gltf'],
              'model/obj': ['.obj'],
              'model/stl': ['.stl'],
              'application/octet-stream': ['.fbx', '.ply', '.splat', '.spz'],
            },
          },
        ],
        launch_handler: { client_mode: 'focus-existing' },
        // Android: the installed app appears in the system "Share" menu for 3D files and projects
        // (e.g. Samsung My Files → Share → babalon JS). Received by public/share-target.js.
        share_target: {
          action: `${base}share-target`,
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            files: [
              {
                name: 'files',
                accept: [
                  '.glb', '.gltf', '.bin', '.obj', '.mtl', '.stl', '.fbx', '.ply', '.splat', '.spz', '.usdz', '.babalon',
                  'model/gltf-binary', 'model/gltf+json', 'model/obj', 'model/stl', 'model/vnd.usdz+zip',
                  'application/octet-stream', 'application/zip', 'image/png', 'image/jpeg', 'image/webp',
                ],
              },
            ],
          },
        },
      },
      workbox: {
        clientsClaim: true,
        // The offline shell includes static dependencies, GLSL shaders and basic transforms. Feature chunks
        // are cached when used, so installing the PWA does not download every lazy module.
        manifestTransforms: [async entries => {
          // Includes worker bundles and encoder WASM; only installed apps download this list.
          const assets = readdirSync(resolve('dist/assets')).filter(file => /\.(?:js|css|wasm)$/.test(file)).map(file => `assets/${file}`);
          type Chunk = { file: string; imports?: string[]; css?: string[]; assets?: string[]; isEntry?: boolean };
          const manifest = JSON.parse(readFileSync(resolve('dist/.vite/manifest.json'), 'utf8')) as Record<string, Chunk>;
          writeFileSync(resolve('dist/offline-assets.json'), JSON.stringify({ assets, entry: manifest['index.html'].file }));
          const core = new Set<string>();
          const visit = (key: string) => {
            const chunk = manifest[key];
            if (!chunk || core.has(chunk.file)) return;
            core.add(chunk.file);
            chunk.css?.forEach(file => core.add(file));
            chunk.assets?.filter(file => !/\.(?:js|wasm)$/.test(file)).forEach(file => core.add(file));
            chunk.imports?.forEach(visit);
          };
          Object.entries(manifest).filter(([, chunk]) => chunk.isEntry).forEach(([key]) => visit(key));
          // Babylon loads GLSL shaders dynamically even for the first primitive/material.
          // Preserve basic transforms/environment too, without evaluating them during startup.
          Object.keys(manifest).filter(key => key.includes('/Shaders/') || (/\/materials\/.*\.(?:vertex|fragment)\.js$/.test(key) && !key.includes('/wgsl/')) || key.endsWith('/Gizmos/gizmoManager.js') || key.endsWith('/Textures/Loaders/envTextureLoader.js')).forEach(visit);
          return { manifest: entries.filter(entry => !entry.url.startsWith('assets/') || core.has(entry.url)), warnings: [] };
        }],
        importScripts: ['share-target.js'],
        globPatterns: ['**/*.{js,css,html,ico,png,webp,svg,wasm}'],
        // The texture encoder (3 MB) is only needed when optimizing textures: cached on first use
        globIgnores: ['**/basis_encoder*.wasm', '**/manifold*.wasm'],
        // Babylon.js is one big chunk; precache it so the app works offline
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.endsWith('/offline-assets.json'),
            handler: 'NetworkFirst',
            options: { cacheName: 'offline-manifest', networkTimeoutSeconds: 5 },
          },
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /\/assets\/[^/]+\.(?:js|css)$/.test(url.pathname),
            handler: 'CacheFirst',
            // Module requests send Origin; background fetches may omit it. Hashed static
            // code is identical for both, even when the server sends Vary: Origin.
            options: { cacheName: 'feature-code', matchOptions: { ignoreVary: true }, cacheableResponse: { statuses: [200] } },
          },
          {
            // HDR environments and sample models
            urlPattern: ({ url }) => url.hostname === 'assets.babylonjs.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'babylon-assets',
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Decoders the loaders fetch on demand (Draco, Basis/KTX2, meshopt…)
            urlPattern: ({ url }) => url.hostname === 'cdn.babylonjs.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'babylon-cdn',
              matchOptions: { ignoreVary: true },
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /\/(?:basis_encoder|manifold)[^/]*\.wasm$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'encoders', matchOptions: { ignoreVary: true }, expiration: { maxEntries: 4 }, cacheableResponse: { statuses: [200] } },
          },
          {
            // Built-in animation clips and the Mannequin sample: downloaded on first use, then offline
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /\/(animations|models)\/[^/]+\.glb$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'library',
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Bundled HDR lighting environments
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /\/environments\/[^/]+\.env$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'environments',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
});
