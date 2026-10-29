# Native Gaussian AR implementation

The user approved the native ARCore/Filament approach discussed in the conversation:
keep source assets unchanged, use 30,000 active splats and 50% render resolution by
default, provide quality controls, test locally and produce an installable APK.
Work is performed in the main agent, without delegation.

## Critical path

- [x] Prepare a disposable native session GLB with a Gaussian hierarchy extension,
  using the existing worker aggregation. Exclude billboard/point fallback geometry
  from the ordinary mesh transfer. Preserve originals and shared source buffers.
- [x] Load that extension off the Android UI thread and render anisotropic Gaussian
  ellipses in the existing Filament scene, sharing ARCore anchors, depth and captures.
  Compile the material with the exact pinned Filament version.
- [x] Traverse all hierarchies under one global budget and sort selected nodes in
  the background. Upload only draw indices after camera changes; use a bounded
  refresh rate and cancel work before releasing the Filament engine.
- [x] Add native budget/resolution controls; default to cheap rendering, room light
  estimation/shadows/depth off. Resolution changes must not shrink Android controls.
- [x] Exercise real SPZ preparation in JavaScript; verify unchanged source bytes,
  mixed scenes, transforms, hierarchy limits and native traversal/sorting. Compile
  Android, run available checks, inspect packaged material/web assets, generate APK.

## Acceptance and limits

Keep project save/reopen and editor appearance unchanged. AR assets are temporary;
native transforms do not overwrite editor transforms. Include photo/video in the
same Filament surface. Reject malformed session data with a useful load error.
Do not claim physical tracking, GPU correctness or FPS without a device run.
Native fast Gaussian rendering uses base color (degree zero); source harmonics stay
in the project. Native skeletal glTF animations retain their existing path.

## Execution evidence

- Production web build, lazy-cache, offline-install and project-archive checks passed.
- Real SPZ: 370,018 originals -> 262,143 hierarchy nodes; session preparation about
  0.8–1.1 s locally. Source/SH hashes and saved entities/environment were unchanged.
- Mixed JavaScript scene: two SPZ copies plus a cube -> 262,142 nodes globally,
  11.54 MB temporary session; originals and ordinary GLB geometry retained.
- Existing 375x812 Gaussian browser regression passed: source bytes, standard/app
  export, project ZIP round trip and simulated AR restoration.
- Native JVM check passed: global budget, cross-object depth order, distance LOD
  and frustum culling. Instrumented GLES checks drew the real single/mixed sessions
  with 30,000 active nodes and exercised live 1,000 -> 30,000 budget changes.
- Anisotropy check: 117x21 pixel footprint, not a round point. Native mesh-only GLB
  files loaded through the real gltfio loader; GPU resources released without errors.
- The stock SceneView post-process baseline is white on local SwiftShader *before*
  creating Gaussian materials. Its real-Surface capture test is skipped on that
  failing emulator baseline. Raw Gaussian targets pass; full camera/capture color,
  ARCore placement/depth, thermal stability and phone FPS require device acceptance.
- Signed release APKs built for offline/distribution and ARM32/ARM64. All four passed
  structural/ABI/certificate/non-debuggable checks; distribution files remain <30 MB.
  An additional offline APK with the local test signing key is available for updating
  prior local test installs; it also has debuggable=false. APKs contain the ABI-52
  material and current native worker/session metadata.
