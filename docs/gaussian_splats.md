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

For interoperable Gaussian GLB, implement the ratified
[KHR_gaussian_splatting specification](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_gaussian_splatting):
export POINTS plus position, normalized quaternion, linear scale, opacity and full SH
attributes; convert their coordinate/color conventions together; implement its loader;
then register a glTF-Transform extension that owns every accessor and buffer view.
Validate with an independent renderer before advertising cross-viewer compatibility.

## Tools: keep available, implement the correct representation

No new tool blockers are introduced. The following are implementation requirements,
not claims that the existing triangle operations support splats:

| Feature | Current boundary | How to implement it correctly |
| --- | --- | --- |
| Move, rotate, scale, group, duplicate, simple motion | Object-level transforms work; duplication costs GPU memory and another sort worker. | Preserve source references and independent appearance; test negative/nonuniform scale and simultaneous animations. |
| Picking and measurements | Ray picking can hit bounds instead of visible scan content. Surface paths and vertex snap require triangle topology. | Use explicit GPU picking/depth for visible splat hits. Use a user-chosen reconstructed proxy surface for geodesics and normals. Do not measure billboard triangles. |
| Lasso, brush, sculpt and separate | Separate already has its own triangle-model guard. Other tools may accept auxiliary buffers. | Select splat centers/ellipsoids using rendered visibility; edit packed centers/scales/rotations/opacity with copy-on-write and undo; partition splat records and harmonics together. |
| Boolean, fuse, connect, shrinkwrap | Splats do not define a watertight surface. | Offer explicit surface reconstruction (density field/isosurface, cleanup, normals and color baking), then reuse mesh operations. For splat-domain clipping, test covariance/opacity against the chosen volume and preserve undo. |
| Triangle optimization and LOD | Triangle decimation does not reduce Gaussian count. | Add explicit spatial clustering/pruning or a splat-aware LOD hierarchy; retain covariance, opacity and SH; compare rendered error before applying. |
| Rigging and posing | Billboard indices are not a character's skin surface. | Rig an explicit reconstructed proxy, transfer weights to splat centers, and deform centers plus covariance/orientations; specify how SH rotates with the deformation. |
| Materials and relighting | PBR textures, roughness, wireframe and double-sided controls do not have equivalent scan semantics. | Expose Gaussian kernel/opacity/compensation/SH controls; implement relighting with normals or an explicit proxy, without replacing the splat material with PBR. |
| Multiple overlapping splat objects | Independent objects sort their own splats; overlap can be order-dependent. | Use Babylon compound splats with global sorting and maintain per-part transforms, selection, undo and serialization. |
| Performance | GPU textures and splat counts are reported separately from real mesh triangles. Counts are a coarse budget estimate. | Add calibrated device budgets, CPU/worker memory estimates and shared GPU data where supported. Keep quality reduction opt-in. |

## AR

### Browser WebXR

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
