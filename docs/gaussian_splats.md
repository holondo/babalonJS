# Gaussian splats: compatibility and implementation paths

Gaussian splats are oriented, translucent distributions with view-dependent color.
Babylon exposes them through a mesh API, but its vertex/index buffers are reusable
rendering billboards, not the captured object's surface. Tools must not interpret
those buffers as a reconstruction of the scan.

## Saving and reopening

Use `.babalon` for editable projects. The ZIP contains each original SPZ/PLY/SPLAT/SOG
asset once, including when several objects use it. Object transforms, opacity,
kernel size, compensation, minimum pixel size and active harmonic degree are saved.
The original asset provides the full available harmonic data on reopening. Existing
projects remain compatible; new appearance fields are optional.

The loader retains one CPU source per asset. AssetContainer clones reuse those CPU
references while owning their own Babylon textures/material and sorting worker.
Cloning must preserve the maximum and active harmonic degrees, the source's Y
convention and the material's source-mesh reference. Changes to raw buffers must use
copy-on-write before any future per-object splat editing is added.

SPZ/SPLAT/SOG/PLY Gaussian imports and the app's Gaussian GLB loader use
`EditorSplatMesh`. Its clone rebuilds render state through `updateData` instead of
Babylon 9.30's `DeepCopy`, which clones read-only texture getters and abandons their
GPU resources. It also removes the camera-removal observer on disposal and disposes
the constructor material when AssetContainer replaces it. This avoids accumulating
textures and retained source buffers after repeated reopen operations.

Autosave thumbnails copy a clean visible frame to a small image. They do not resize
the render pipeline through a screenshot render target. Completed sort results wake
the on-demand renderer without emitting a scene change or scheduling another autosave;
a slow sort must not leave the previous camera's ordering frozen on screen.

## GLB export and reimport

The installed Babylon serializer does not export Gaussian splats. Passing the splat
count to its triangle exporter can read beyond billboard buffers and throw a
DataView bounds error. Export therefore uses temporary transform nodes, without
modifying the live splats or serializing their internal camera meshes.

The app's optional `BABALON_gaussian_splatting` primitive extension stores versioned
packed source data, all harmonic bands, orientation flags and appearance in binary
buffer views. Identical instances share a GLB mesh/payload. The glTF node hierarchy
retains object transforms, including the X-axis handedness conversion performed by
this Babylon version. Import reconstructs real splats, repacks harmonics for the
destination GPU's texture width and restores the source and appearance.

Other GLB viewers receive a colored **point-cloud fallback**, not Gaussian rendering
and not a reconstructed surface. This is an app extension, not an implementation of
`KHR_gaussian_splatting`. Do not promise identical appearance in third-party viewers.
For exact exchange today, use the original splat file or a `.babalon` project.

Compact export preserves the splat GLB unchanged after any applied scene
optimizations: glTF-Transform does not understand the app extension and would discard
its payload. Consequently compact export may have the same size. It never discards
harmonics or silently replaces the editor's splats with a reduced representation.
GLB can be substantially larger than SPZ because SPZ is compressed.

The separate **Export Gaussian .glb** menu item writes the ratified
[KHR_gaussian_splatting specification](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_gaussian_splatting):
POINTS with position, normalized xyzw quaternion, positive linear scale, opacity and
complete SH bands through degree 3 in `srgb_rec709_display`. X reflections transform
centers, quaternion and odd-in-X harmonic coefficients together. The exporter retains
COLOR_0 for viewers that do not implement Gaussian rendering. Standard export is an
explicit exchange conversion, not the default project archive: opacity incorporates
the material alpha; editor-specific smoothing settings and any degree-4 source band
remain in the project/original asset. Compact export is not offered for this path.

Standard attributes use uncompressed floats and can be substantially larger: the
two-instance real-scan regression exports approximately 187 MB versus 40 MB using the
app extension. Identical in-memory source references share attributes; separately
decoded buffers are separate payloads. No extra standard payload is added to ordinary
scene/compact exports or native AR transfers.

The standard importer uses the managed mesh lifecycle and validates required
attributes, finite values, counts, opacity, scale and complete harmonic bands. It
currently supports the ellipse/sRGB variant, not the linear color-space variant.
Babylon's retained representation quantizes color/quaternions/SH to bytes, so external
float data can lose precision and SH outside its representable range is clamped.
The original GLB remains the source asset in projects. A higher-precision GPU/CPU path
is needed for exact floating-point interchange.

The specification leaves negative-scale/sheared node transforms undefined; the file
retains such transforms but cannot promise their appearance in other renderers.
Interchange for those scenes needs covariance decomposition and transformed SH before
flattening to positive TRS. The regression checks both app and upstream Babylon
importers and compares rendered pixels with the SPZ, not a second rendering engine.

## Tools: keep available, implement the correct representation

No new tool blockers are introduced. The following are implementation requirements,
not claims that the existing triangle operations support splats:

| Feature | Current boundary | How to implement it correctly |
| --- | --- | --- |
| Move, rotate, scale, group, duplicate, simple motion | Object-level transforms work; duplication costs GPU memory and another sort worker. | Preserve source references and independent appearance; test negative/nonuniform scale and simultaneous animations. |
| Picking and measurements | Ray picking can hit bounds instead of visible scan content. Surface paths and vertex snap require triangle topology. | Use explicit GPU picking/depth for visible splat hits. Use a user-chosen reconstructed proxy surface for geodesics and normals. Do not measure billboard triangles. |
| Lasso, brush, sculpt and separate | Separate already has its own triangle-model guard. Other tools may accept auxiliary buffers. | Select splat centers/ellipsoids using rendered visibility; edit packed centers/scales/rotations/opacity with copy-on-write and undo; partition splat records and harmonics together. |
| Boolean, fuse, connect, shrinkwrap | Splats do not define a watertight surface. | Offer explicit surface reconstruction (density field/isosurface, cleanup, normals and color baking), then reuse mesh operations. For splat-domain clipping, test covariance/opacity against the chosen volume and preserve undo. |
| Triangle optimization and LOD | Triangle decimation does not reduce Gaussian count. WebXR AR now uses a disposable spatial Gaussian hierarchy with a global active budget. | Persistent editor LOD/streaming and SH-aware higher-quality aggregates remain separate work. Keep the original data for full detail. |
| Rigging and posing | Billboard indices are not a character's skin surface. | Rig an explicit reconstructed proxy, transfer weights to splat centers, and deform centers plus covariance/orientations; specify how SH rotates with the deformation. |
| Materials and relighting | Objects → Material exposes Gaussian kernel, opacity compensation, minimum pixel size and harmonic degree with undo/persistence. Existing wireframe/double-sided controls remain available with an explanation. PBR controls do not have equivalent scan semantics. | Implement relighting with normals or an explicit proxy, without replacing the splat material with PBR. |
| Multiple overlapping splat objects | Independent objects sort their own splats; overlap can be order-dependent. | Use Babylon compound splats with global sorting and maintain per-part transforms, selection, undo and serialization. |
| Performance | GPU textures and splat counts are reported separately from real mesh triangles. Counts are a coarse budget estimate. | Add calibrated device budgets, CPU/worker memory estimates and shared GPU data where supported. Keep quality reduction opt-in. |

## AR

### Browser WebXR

Splats are typically more expensive than an opaque GLB surface in mobile AR: the
camera moves continuously, sorting feeds new index buffers to the GPU, overlapping
transparent ellipses repeatedly shade/blend the same pixels, and higher harmonic
degrees add view-dependent color work. ARCore tracking and camera composition share
the device's frame budget. This does not mean every GLB is cheaper than every scan.

`EditorSplatMesh` reuses the current depth order during pure camera translation in
Babylon 9.30's counting-sort path. Its worker computes
`dot(cameraForward, worldPoint - cameraPosition)`: translating the camera adds one
constant to every depth, leaving their relative order unchanged. Only the stored
camera-translation dirty marker is advanced. Rotation, object/part transforms,
active-range changes, forced requests and a new camera's first sort retain their
existing invalidation. The optimization does not change resolution, harmonic degree
or source records. The legacy comparison-sort path remains untouched.

AR options include **Faster splats**, enabled by default for splat scenes at the user's
request. It prepares a spatial Gaussian LOD hierarchy and selects degree-0 color,
discarding projected splats smaller than two pixels (or the object's existing larger
threshold). It trades view-dependent color and tiny details for GPU work.
Turning it off or exiting restores original degrees and material thresholds, including
when depth occlusion swaps temporary materials in either direction. No source bytes
or saved project quality settings are changed. Full detail remains an explicit session
choice by switching this option off. Shadows and room lighting remain opt-in.
AR label layout reads are also skipped
when there are no measurements to project.

### AR LOD, active budget and resolution

The initial **global budget is 30,000 active splats**, with 60,000 and 120,000 choices
in AR options. It caps the combined selected count across all splat objects, not each
object separately. Source records, harmonics and project files remain untouched.

`optimize/splatLodMath.ts` builds a Morton-ordered binary hierarchy in a dedicated
worker. Gaussian representatives combine area/opacity-weighted centers and colors;
covariance includes each input covariance and the spread of its center. A symmetric
eigendecomposition yields the representative's oriented scales/quaternion. Opacity
approximately conserves integrated projected coverage. This is an approximation,
not a claim of exact radiance or view-dependent SH preservation.

The temporary atlas has at most 131,072 fine representatives and their ancestors
(262,143 nodes). Larger sources are spatially aggregated at that fine level; smaller
sources retain their individual records there. The original remains available through
the full-detail toggle. This bounds temporary atlas growth but does **not** reduce
the memory already occupied by the original asset or stream its initial load.

A worker max-heap refines nodes by projected bounds under the shared budget. It
conservatively culls offscreen bounds with an asynchronous-motion margin, and sends
coalesced active ranges to Babylon's sort worker. Parent/child nodes are never drawn
together. Traversal runs at most about seven times per second, outside the render
thread; only selected ranges are depth-sorted and drawn. The source-buffer copy,
hierarchy and temporary GPU atlas are disposable session resources. Two instances
with the same source reuse the build, while retaining independent GPU state. A shared
budget does not solve cross-object transparency sorting: compound/global sorting
remains separate work.

Original meshes stay in their hierarchy and carry their transforms/animations; an
identity LOD child renders instead. Depth occlusion and shadow caster lists target
the active representation. Cleanup restores original visibility, quality, material
objects, shadow lists and transforms, and terminates traversal/sort workers. Cancelling
preparation also restores the source. A failed LOD build falls back to original data
with an error notice rather than marking the source corrupt.

WebXR starts with **50% width/height** and **no layer multisampling**: approximately a
quarter of the virtual-layer pixels at 100% scale. 75% and 100% are available in AR
options. The scale is passed to `XRWebGLLayer` through Babylon's managed output canvas,
not the editor's hardware scaling. Changing it applies on the next AR entry; the HUD
says so explicitly. Passthrough-camera and DOM-overlay resolution are not reduced.
The runtime can constrain the actual framebuffer size. No physical Android FPS gain
is claimed from the headless tests; validate the actual layer resolution and frame
time on the phone. AR photos use the currently selected representation; turn off
Faster splats for original Gaussian detail.

WebXR retains Babylon's Gaussian renderer. It needs per-camera sort state, so test
camera changes and returning to the editor. Optional depth occlusion clones materials:
the cloned Gaussian material must retain its source mesh even if the XR camera already
has a cached internal mesh. Otherwise texture binding can use the camera proxy rather
than the splat source and make the scan disappear.

AR cleanup restores original material objects, light enabled/shadow flags, intensities,
shadow-map refresh rates, environment and object transforms. Temporary preset shadows
respect each object's cast-shadows setting. Transparency shadows are enabled for
Gaussian alpha. These are logic-tested with simulated sessions, not proof of ARCore
tracking, live environment depth, camera permissions or device performance.

### Installed Android application

The installed app uses ARCore + SceneView/Filament, not Babylon's WebXR renderer.
Its GLB path now receives actual point data instead of invalid billboard geometry,
but **Filament does not gain a Gaussian renderer from the app extension**. The generic
fallback is a point cloud; actual device rendering still needs verification. Installing
the JavaScript changes alone does not enable full Gaussian appearance in native AR.

For full native fidelity, implement a Filament Gaussian renderer or a dedicated
transparent Babylon rendering surface synchronized with the ARCore camera projection,
pose, anchors and depth. Preserve shared tracking coordinates, global splat sorting,
context lifecycle and capture composition. Avoid creating a second camera capture or
an independent tracking session. Alternatively, use a WebXR-capable browser on a
device that supports it. Surface reconstruction is an explicit visual conversion,
not an automatic replacement for the scan.

SceneView's newer source now includes an anisotropic
[SplatNode](https://github.com/sceneview/sceneview/blob/main/sceneview/src/main/java/io/github/sceneview/node/SplatNode.kt)
and [Filament material](https://github.com/sceneview/sceneview/blob/main/sceneview/src/main/materials/splat.mat).
These are a possible porting foundation, not part of the pinned 2.2.1 dependency.
Porting needs a material compiled for the exact Filament runtime, full harmonic
handling and the existing anchor/depth/capture/lifecycle integration. An upgrade to
the newer SceneView API is a separate migration, not a drop-in import.

## Verification

Run `npm run build`, `node scripts/check-lazy-cache.mjs` and
`node scripts/check-project-archive.mjs`. For JavaScript browser checks, run Vite on a
fresh port and execute:

```sh
node scripts/check-splat-browser.mjs
```

The script uses Playwright with installed Chrome. Supply `BABALON_PLAYWRIGHT_PATH`
if Playwright comes from an external runtime, `BABALON_TEST_URL` for another port,
`BABALON_BROWSER_CHANNEL` for another installed browser, and `BABALON_TEST_SPZ` for a
real scan. It checks project ZIP and GLB round trips, source/SH hashes, duplicate
transforms, mixed scenes, compact preservation, cost reporting and simulated AR
material/state restoration. `scripts/fixtures/splat-import.html` checks shader
registration and all lighting presets without requiring a scan file.

`node scripts/check-splat-ar-performance.mjs` simulates tracked camera poses through
the real renderer and sort worker. With the supplied 370,018-splat scan, 45 translation
frames trigger 44 sorts before reuse versus zero after; 44 rotation sorts still run.
The rendered translation comparison differs by 0.0002 on the 0–255 channel scale.
It checks new-camera/transform invalidation, the real HUD toggle and quality restoration
across depth toggles and session exit. This is CPU/upload-work evidence, not a physical
phone FPS benchmark: the headless desktop already reaches its refresh-rate cap in
both cases. Measure actual Android PWA FPS with the option off and on after deployment.

`node scripts/check-splat-lod.mjs` checks hierarchy coverage, aggregation, culling,
distance refinement and a budget shared across instances. `check-splat-ar-lod.mjs`
uses the real scan and actual build/traversal/sort workers: 370,018 source splats become
30,000 active near the camera and approximately 114 far away in the test pose. It also
checks lowering/raising the cap, source/SH hashes, depth materials, cancellation,
visibility, worker/texture cleanup, HUD controls and the managed-canvas layer options.
Set `BABALON_LOD_DUPLICATE=1` to verify that two copies (740,036 source splats) still
share the same 30,000 active cap. Set `BABALON_TEST_PHONE=1` for a 375×812 viewport.

After a production build, run `check-splat-lod-production.mjs` against Vite preview
(`BABALON_PREVIEW_URL`), including the deployed `/babalonJS/` base path. This script
loads only built application chunks and workers, without `/src` imports. It simulates
the hardware XR boundary but exercises the actual application entry and LOD path.

The browser regression also exercises a Gaussian material slider through DOM events
with undo/redo, exports the standard attributes and opens the file with both the
managed importer and Babylon's separate upstream extension implementation.

Selection uses gold bounding-box edges for Gaussian splats. Babylon 9.30's generic
selection-mask shader does not decode Gaussian centers/covariance/opacity: it draws
hundreds of thousands of overlapping billboard quads and stalls the GPU. Ordinary
meshes keep their silhouette outline. Splat selection, move, rotate and scale remain
available; bounds disappear in clean/photo/AR views. A silhouette implementation must
render Gaussian coverage into the selection-ID mask with the correct camera, sorted
indices and alpha cutoff, then use the outline compositor. Do not render the raw
billboard geometry with a triangle-mesh selection shader.

`scripts/check-splat-lifecycle.mjs` uses real IndexedDB autosave, thumbnails and three
reopen/orbit/select/move cycles, asserting stable GPU texture, camera-observer and worker counts,
selection/clean-view behavior and movement below 50 ms/frame on the test desktop.
Set `BABALON_TEST_PHONE=1` for the 375×812 viewport (not physical device performance).
Set `BABALON_TEST_STANDARD=1` to run these reopen/movement checks on an exported
standard Gaussian GLB. The same flag makes the appearance comparison use standard
GLB versus the live original; the 370,018-splat scan differs by less than 0.07 on the
0–255 channel scale across the five tested angles.
It delays a real sort submission by 1.8 seconds and checks that its result wakes the
idle renderer. The supplied 370,018-splat scan stays at 21 cached textures and two
camera observers through these cycles (previously 26→71 textures and 2→8 observers).

`scripts/check-splat-appearance.mjs` compares low-resolution rendered pixels against
the loader's original at five angles. It uses Sharp alongside Playwright; set
`BABALON_TEST_REOPEN=1` to compare after real autosave/reopen. Wait for sorting and a
settled frame before comparing; unsorted transient frames are not a valid reference.
Optional `BABALON_COMPARISON_IMAGE` saves a small side-by-side contact sheet. Gaussian
opacity and view-dependent color are part of the capture; do not force opacity or
discard harmonics to hide sparse or incomplete regions of a scan.

On a physical Android device, test native AR entry/exit, placement, scale, every
lighting preset, optional shadows/depth, background/resume, photo/video and repeated
sessions. Confirm both the fallback's appearance and the editor's restoration.
