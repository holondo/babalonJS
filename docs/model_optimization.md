# Model optimization

How heavy models are made lighter in babalon JS, and why it works this way. The plan and its tracking table are in `model_optimization_implementation_plan.md`.

## What the user gets

- **Cost notice.** After loading, a model over the device budget shows a notice with a shortcut to Objects → Optimize.
- **Objects → Optimize** (models only):
  - **Cost:** triangles, vertices and texture memory.
  - **Geometry:**
    - Presets: High quality 50 %, Balanced 20 %, Lightest 7 %.
    - A "triangles kept" slider.
    - Levels of detail (two lighter copies used when the model is small on screen).
    - Baked surface detail (a normal map from the original).
    - Keep open edges in place.
    - Hold to compare, and back to the original.
  - **Textures:** KTX2 compression at the same resolution and an optional maximum size.
- **Undo and saving.** Every action is one undo step, saved in the project and copied by Duplicate.
- **AR.** Entering AR with a scene over budget offers a lighter copy for the session only. The project is not changed and the copy is removed when AR ends. The browser needs a fresh tap to start AR, so a "Start AR" button appears when the copy is ready.
- **Export compact .glb** (project menu):
  - optimized geometry and KTX2 textures where the user optimized;
  - geometry compressed with `EXT_meshopt_compression`;
  - levels of detail left out.

  "Export scene .glb" keeps exporting the original models.

## Decisions

| | Choice | Why |
| --- | --- | --- |
| D1 | meshoptimizer `simplifyWithAttributes` (MIT) | Quadric error simplification that weighs normals, UVs and colors and only collapses onto existing vertices. The result is a new index buffer over the original vertices, so UVs, skin weights and morph-free attributes stay valid and textures keep full quality. Fast enough for the browser. |
| D2 | ktx2-encoder (MIT) with Basis Universal (Apache-2.0), UASTC level 1 | Near-lossless, 4× less GPU memory than RGBA, transcoded by Babylon on every GPU. ETC1S is smaller on disk but visibly lossy, so it is not used. |
| D3 | Optimized index buffers stored in the project (deflated) | Reopening needs no re-simplification: about 1 MB and 1 s for the 1M-vertex model. |
| D4 | Normal map baked by UV-space rasterization in a worker | Uses the original's normals (and its normal map, if any) in the optimized mesh's tangent frame, which matches Babylon's cotangent frame. Skipped when UVs overlap (> 2 %) or fall outside 0–1. |
| D5 | glTF-Transform (MIT) for the compact export, loaded on demand | Reads the Babylon export and adds meshopt compression and the KTX2 images; nothing extra in the startup bundle. |
| D6 | Meshes with morph targets are left as they are | Their deltas would need to be simplified with them. |
| D7 | Budgets: phone 500k triangles / 256 MB textures (300k / 160 MB with ≤ 4 GB RAM); desktop 3M / 1 GB | Over budget only triggers notices and offers, never automatic changes. |

The encoder WASM (3.3 MB) is not precached: it's downloaded the first time textures are optimized, then cached (`vite.config.ts`).

## Measurements

These were measured on a 16-thread desktop with a 1,010,635-vertex, 1,984,544-triangle textured character (one 4K texture).

| Operation | Result |
| --- | --- |
| Simplify to 20 % (Balanced) | 396,908 triangles, largest deviation 0.01 % of the size, ~5–7 s (with levels of detail) |
| Simplify to 10 % | 198,454 triangles, ~5 s |
| Simplify to 5 % (raw meshoptimizer) | ~2 s, error 0.03 % |
| Bake normals, 5 % + 2048 px | ~5 s |
| Texture compression, 4K | 85.3 → 21.3 MB of GPU memory, ~9–10 s (parallel tiles: the encoder is limited to 12 Mpix per image, so large images are encoded in 2048 px tiles and stitched as UASTC blocks) |
| Save / reopen optimized project | +1 MB in the project, restore ~1 s |
| Export, plain vs compact (20 % + KTX2) | 50.3 MB vs 25.2 MB, the compact file reopens with the same look |
| Rig binding (envelope weights) | 90 s → 16 s (see below) |

## Rigging dense models

The rig binding's 90 s were spent on the visibility query (a ray against the full surface for every vertex and bone), not on the solver. Envelope weights now query one real surface vertex per small cell (0.6 % of the model height, twice as fine as the smoothing that follows) and copy the result to the cell. On the test model:

- mean weight difference against the full computation: 0.5 %;
- vertices off by more than 10 %: 0.07 %;
- deformation audit (`scripts/check-rig-deformation.mjs … envelope`): 0 % arm influence on the trunk and hips, same as before.

Heat diffusion already ran on a proxy. Optimizing a model before rigging it makes binding faster still. A model rigged in the app can't be optimized afterwards; it has to be optimized first.

## Not verified on a device

- AR frame rate on the S24 with the lighter session copy.
- The phone budgets on real phones.
- Texture encoding time on a phone.

Test on the published site.

## Checks

- `node scripts/check-simplify.mjs`:
  - triangle targets;
  - only original vertices used;
  - no triangle bridging a UV seam;
  - small error;
  - open edges kept.
