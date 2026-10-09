import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Served from a subfolder on GitHub Pages (https://<user>.github.io/<repo>/): the deploy
// workflow sets BASE_PATH=/<repo>/. Locally it stays at the root.
const base = process.env.BASE_PATH || '/';

export default defineConfig({
  base,
  plugins: [
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'icons/apple-touch-icon.png', 'brand/lettering.webp', 'brand/lettering.png'],
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
        importScripts: ['share-target.js'],
        globPatterns: ['**/*.{js,css,html,ico,png,webp,svg,wasm}'],
        // Babylon.js is one big chunk; precache it so the app works offline
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        navigateFallback: 'index.html',
        runtimeCaching: [
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
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
