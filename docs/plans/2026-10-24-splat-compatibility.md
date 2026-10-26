# Gaussian splat compatibility

Implemented in the main agent, without new tool restrictions.

## Design

Preserve splats as splats, including raw data, harmonics, appearance and transforms.
Reuse project assets for lossless `.babalon` persistence. GLB must retain splat
payloads through a dedicated extension rather than serialize rendering billboards.
Keep triangle tools available; document the splat-aware algorithms or explicit
surface reconstruction they require instead of adding blockers. Fix WebXR state
restoration and material ownership without changing the editor's scene permanently.

## Steps and acceptance

- [x] Reproduce import, duplicate, ZIP save/restore and GLB export/reimport with real
  JavaScript runs, including the supplied SPZ and a small generated splat fixture.
- [x] Preserve CPU source references during cloning and splat material properties
  in `core/state.ts`; round-trip project bytes and transforms without loss.
- [x] Implement on-demand GLB splat export/import, preserving raw data and harmonics;
  verify mixed mesh/splat scenes, compact export and duplicate instances.
- [x] Correct splat cost reporting and shadow transparency; document geometry-tool,
  picking, material and native-AR compatibility and concrete implementation paths.
- [x] Repair AR material cloning/ownership and cleanup with simulated sessions;
  distinguish browser logic validation from physical-device validation.
- [x] Run build, relevant cache/archive checks, JavaScript regressions at desktop
  and phone dimensions, and review all changes in the main agent.

## Evidence and remaining compatibility work

- Real SPZ: 370,018 splats, 11,840,576 packed bytes, maximum SH degree 3 retained
  with active degree 1. Raw/SH hashes survive ZIP and GLB; two instances share the
  GLB payload. Mixed cube/splat scenes and compact preservation pass.
- Desktop 1280×900 and phone 375×812: JavaScript checks pass, including shear,
  reflection, rotation, material cloning, simulated AR cleanup and a real render-camera
  switch/sort. Build, lazy cache, installed offline, project archive and surface-brush
  regressions pass. No new manual-tool blockers; review performed in the main agent.
- Ruling: export an app-specific lossless splat extension with a point-cloud fallback.
  This solves babalon round trips; it does not claim KHR Gaussian interoperability.
  Compact export retains the payload instead of losing it in glTF-Transform.
- Outstanding: physical-device AR verification and a full native Gaussian renderer.
  The installed Android/Filament path has a documented point fallback, not native
  Gaussian fidelity. Splat-domain geometry tools remain documented implementation
  work in `docs/gaussian_splats.md`.
- Autosave/reopen regression: managed cloning and disposal keep textures, workers
  and camera observers stable over three real IndexedDB reopen cycles. Late worker
  sort results wake on-demand rendering. Thumbnail capture no longer resizes the
  post-process pipeline.
- Selection regression: replace the incompatible generic Gaussian selection mask
  with gold bounds edges. Real scan movement improved from 100–189 ms/frame to
  approximately 17 ms/frame across three reopen cycles, on desktop and 375×812
  viewport. Clean-view bounds hiding, build and ZIP/GLB round trips pass.

## Follow-up: standard exchange and material controls

- [x] Offer a separate standard Gaussian GLB export (ellipse/sRGB, degrees 0–3),
  without adding float payloads to default exports or native AR transfers.
- [x] Import standard files with managed cloning/disposal and retained source bytes;
  check required attributes, finite values, counts and harmonic completeness.
- [x] Add Gaussian material controls through the existing undoable control helpers;
  retain general controls and explain their representation limits.
- [x] Test the supplied real SPZ through app and upstream Babylon standard loaders,
  DOM slider undo/redo, five-angle pixel comparisons, and three standard-GLB
  IndexedDB reopen/select/move cycles at 375×812.
- Evidence: 370,018 splats; pixel differences 0.045–0.068 on a 0–255 scale;
  approximately 17 ms/frame movement; 21 GPU textures, two camera observers and
  two live workers remain stable. Build and lazy-cache/archive/offline checks pass.
- [ ] Full native Gaussian rendering, including harmonics, capture and depth.
- [ ] Splat-domain geometry tools or explicit surface reconstruction.
- [ ] Silhouette selection mask with visible pixel verification; keep the working
  bounds selection until a dedicated Gaussian pass passes this check.
- [ ] Exact external float preservation, linear-color variant, positive-TRS baking
  of reflected/sheared scenes, and validation with a second rendering engine.

## Follow-up: Android PWA AR performance

- [x] Inspect the real counting worker and reproduce redundant sorts for tracked
  camera translation; retain rotation, transforms, ranges and first-camera sorting.
- [x] Reuse translation-invariant depth order without changing default visual quality.
- [x] Add an explicit session-only Faster splats toggle and restore quality across
  depth-material swaps and exit. Preserve Gaussian appearance when cloning for depth.
- [x] Exercise the real worker, rendered pixels and the HUD with the supplied scan.
  Translation sorts: 44→0; rotation sorts: 44; pixel difference: 0.0002 / 255.
- [ ] Compare physical Android PWA FPS after deployment. The user confirmed that
  WebXR AR works on Android; headless frame timing is not a device benchmark.
