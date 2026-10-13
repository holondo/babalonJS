# Mesh editing implementation plan

## Purpose and boundaries

Extend babalon JS into a practical 3D composition tool: assemble parts from different models, combine or connect them, reshape selected regions, close openings, and make local surface adjustments. Follow [AGENTS.md](AGENTS.md). This document authorizes no implementation, commit, push, or deployment by itself.

Deliver complete, saved, undoable features one at a time. Preserve the existing UI as the design reference. Do not redesign the shell or build a new visual system. Full volumetric sculpting, texture painting, automatic UV packing, collaborative editing, and component libraries are deferred.

## Current state

- [Separator](src/edit/separate.ts) supports piece, smart, lasso and brush selection, exact plane cuts, and separation. The brush selects faces; it does not sculpt.
- [FaceSelection](src/edit/selection.ts) holds selected face IDs, adjacency and overlays. [MeshPart](src/edit/parts.ts) captures indices, submaterials, vertex attributes and morph streams.
- [Editor](src/core/editor.ts) owns entities, multi-selection, gizmos, history, materials and GLB export. A model entity already supports several meshes.
- [Project](src/core/project.ts) saves original assets plus generated separation data. Existing separation restore expects the source mesh count: it cannot directly restore a composite of unrelated assets.
- [Material panel](src/ui/panels/material.ts) now supports all-material and individual edits. Shared texture images can remain shared while material parameters are independent.
- There are pending local changes in rigging, separation, persistence and UI. Integrate with the working files; do not reset them or treat the older roadmap's baseline as current.

## UI integration: mandatory design constraints

Use [ObjectsPanel](src/ui/panels/objects.ts), [SeparatePanel](src/ui/panels/separate.ts), [UI](src/ui/ui.ts), [DOM components](src/ui/dom.ts), [editControls](src/ui/editControls.ts), and [style.css](src/ui/style.css) as the concrete implementation and style references.

| Entry point | Actions and controls |
| --- | --- |
| Selection bar → More, multiple objects selected | Group, Combine; Fuse once supported |
| Objects list | Select groups and their members using existing outliner rows; avoid a new deep tree in the MVP |
| Selection bar → More, one triangle model selected | Edit mesh, reusing the current Separate entry and workflow |
| Objects panel while editing | Existing segmented control: Select / Transform / Surface |
| Select | Existing piece, wand, lasso, brush, grow/shrink and plane cut controls |
| Transform | Existing move/rotate/scale gizmos; pivot and soft-selection controls in the panel |
| Surface | Close opening, Connect borders, Pull, Inflate, Smooth, Flatten |

Keep the existing dock, top bar, glass surfaces, palette, typography, icon treatment, spacing and panel frame. Use `section`, `row`, `button`, `iconButton`, `segmented`, `slider`, `toggle`, `hint`, and existing progress UI. Add no top-level button, custom floating toolbar, nested menu, or replacement layout. Extend CSS only where an existing class cannot express a required state. All labels use `tr()` with PT translations.

One finger edits; two fingers navigate, following Separate mode. Provide visible Apply/Cancel and operation status. Validate the actual panel at desktop and 375×812 sizes, including touch targets, scrolling sliders and hide-interface behavior.

## Shared implementation rules

- Keep domain code in `src/edit/`; editor methods expose actions and emit changes. Panels contain no geometry algorithms.
- Reuse `MeshPart` and its attribute handling. Extract shared helpers only when a delivered feature needs them; do not first build a generic modeling framework.
- Preserve world placement under rotation, nonuniform scale and mirrored transforms. Normals require correct transformation; mirrored baking must correct winding and tangent handedness.
- Never mutate shared source geometry. Keep source assets and UVs intact; clone material state for independent editing while sharing unchanged texture resources.
- Group and combine are distinct from welding. Combining preserves disconnected surfaces. Border connection creates triangles; boolean fusion rebuilds intersections.
- One action or gesture is one history entry. Build expensive results off-scene, publish atomically, and leave originals unchanged on failure or cancellation. Keep history-owned resources alive until no longer needed.
- New saved fields are optional. Store original files once and cache generated binary data per immutable state, following `blobOf` and separation serialization. Older projects continue opening without a breaking version bump.
- Grouping supports animated objects. In-place edits (cut, region transform, brushes, closing openings) work on optimized, app-rigged, skinned and animated models: skin weights are vertex attributes and travel with the edit, and the model is shown in its rest pose while editing. Only shape keys block in-place edits (they store absolute positions). Combine, fuse and connect create a new object and still refuse skeletons and animations with an explanation; never silently discard animation data.
- An optimized model is frozen before editing (`ModelOptimizer.freeze`: the optimized geometry becomes the model, levels of detail are dropped, baked normals become a material texture; one undo step goes back to the optimization). Geometry edited on an app rig is saved with `rigSpace` and re-applied after the rig on reopen; removing the rig keeps the edit in mesh space.
- Closing openings skips curved or irregular ones and reports them instead of failing the whole action; real meshes with a few non-manifold edges are accepted.
- Performance on dense meshes (measured on a 2M-triangle model): selection uses a byte per face (`FaceSet`) and compact typed connectivity (`faceTopology.ts`, prefetched in a worker on entering edit mode); highlights and cut previews borrow the model's GPU buffers; region transforms and brushes edit vertices in place through `Deform` (only moved vertices, normals around them, changed GPU range); exact cuts only clip crossed triangles; closing and connecting work on the faces along open edges (`compactFaces`/`mergeLocal`, with the whole mesh's weld and open-edge test). Never copy a whole mesh into plain arrays or rebuild its geometry per frame.
- Heavy topology operations use cancellable workers loaded on demand. Ordinary local vertex edits stay interactive. Do not reduce resolution or topology quality automatically.

## Implementation steps

### P01 — Combine parts into one object (first MVP)

**Status:** VERIFIED

**Objective:** Attach an arm from model A visually to torso B, with both selectable and transformable as one object.

**Required reading:** [editor.ts](src/core/editor.ts): `Entity`, model creation, `materialsOf`, history and export; [parts.ts](src/edit/parts.ts): attributes/submaterials; [project.ts](src/core/project.ts): asset references, snapshot/restore; [ui.ts](src/ui/ui.ts): multi-selection and More menu.

**Target files:** `src/edit/combine.ts` (new), `src/core/editor.ts`, `src/core/project.ts`, `src/ui/ui.ts`, `src/core/i18n.ts`.

**Implementation:** Combine static selected objects into a new model entity containing cloned meshes under a common root. Preserve material assignments, UVs, texture references, names and world appearance; do not weld or deduplicate vertices. Save ordered source-part descriptors (asset reference, source mesh identity, local transform, material state and optional geometry override) so unrelated GLBs restore without relying on one source container. Preserve provenance for later features.

**Scope/integration:** Reuse current selection, transforms and undo. Remove originals from the active scene only as part of the undoable successful action; do not lose their source files. Reject unsupported animated inputs with an actionable message. Export the visible result through existing GLB export.

**Minimum verification / stopping condition:** Combine differently transformed pieces from two real GLBs; undo/redo, save/reopen `.babalon`, export/reimport GLB. Continue when the same pieces and materials remain in the same world positions.

**Acceptance:** [ ] One resulting object; [ ] appearance and texture assignments preserved; [ ] complete undo and persistence; [ ] failure leaves originals intact.

### P02 — Group without changing geometry

**Status:** VERIFIED

**Objective:** Move several objects together and later ungroup them.

**Required reading:** [editor.ts](src/core/editor.ts): root transforms, selection and history; [project.ts](src/core/project.ts): entity identity and restore; [objects.ts](src/ui/panels/objects.ts): outliner rows. Depends on P01's integration pattern, not its composite format.

**Target files:** `src/core/editor.ts`, `src/core/project.ts`, `src/ui/ui.ts`, `src/ui/panels/objects.ts`, `src/core/i18n.ts`; add `src/edit/groups.ts` only if needed to keep editor orchestration small.

**Implementation:** Persist group IDs and member references; use a parent transform node and preserve world transforms when grouping/ungrouping. Support one level initially. Group selection uses the current gizmo, while the existing object list allows selecting members. Define deletion, duplication and visibility consistently for the group and its members.

**Scope/integration:** Preserve independent materials, skeletons and animation ownership; route group transforms through existing history. Account for group transforms in project restore, scene bounds, GLB export and temporary AR parenting.

**Minimum verification / stopping condition:** Group two transformed objects, move/rotate/scale, edit a member, ungroup, undo and reopen. Continue when placement and object identity remain correct, including an animated member.

**Acceptance:** [ ] Reversible group transforms; [ ] members remain editable; [ ] persistence/export preserve placement; [ ] no silent reparenting drift.

### P03 — Transform a selected region

**Status:** VERIFIED

**Objective:** Scale, move or rotate only selected geometry, optionally with a soft transition.

**Required reading:** [selection.ts](src/edit/selection.ts): selected faces and adjacency; [separate.ts](src/edit/separate.ts): input routing; [lasso.ts](src/edit/lasso.ts): visible-face selection; [parts.ts](src/edit/parts.ts): geometry capture/apply; [separate panel](src/ui/panels/separate.ts): current selection UI. Depends on P01's saved composite/geometry support.

**Target files:** `src/edit/selection.ts`, `src/edit/separate.ts`, `src/edit/transformSelection.ts` (new), `src/edit/lasso.ts`, `src/core/editor.ts`, `src/core/project.ts`, `src/ui/panels/separate.ts`, `src/core/i18n.ts`.

**Implementation:** Share the current selection between Separate and mesh-edit actions. Derive selected vertices from face indices and transform from a gesture-start snapshot around the selection center. Soft selection uses connected surface distance, avoiding influence leaking between nearby disconnected limbs. Handle coincident UV-seam vertices coherently while retaining their distinct UV/normal streams. Update bounds and affected normals/tangents; invalidate derived topology after edits.

**Scope/integration:** Static geometry first. Hard selection moves shared boundary vertices; make boundary detachment an explicit option if delivered. Fix the previously reproduced perspective-depth selection error in `lasso.ts` before relying on its visibility mask. Do not silently average all normals and erase authored hard edges.

**Minimum verification / stopping condition:** Scale one arm on a multipart textured GLB: unselected distant geometry stays unchanged, seams remain closed, soft influence stays on the connected region. Verify gesture undo, save/reopen and GLB export.

**Acceptance:** [ ] Local transformation with stable pivot; [ ] correct visible-face selection; [ ] UVs/materials preserved; [ ] one undo per gesture.

### P04 — Close cuts and simple openings

**Status:** VERIFIED

**Objective:** Cap a plane cut or close a selected simple hole.

**Required reading:** [planeCut.ts](src/edit/planeCut.ts): exact clipping; [parts.ts](src/edit/parts.ts): attribute/submaterial creation; [selection.ts](src/edit/selection.ts): topology. Depends on P03's editing state.

**Target files:** `src/edit/holes.ts` (new), `src/edit/planeCut.ts`, `src/edit/parts.ts`, `src/ui/panels/separate.ts`, `src/core/i18n.ts`.

**Implementation:** Detect boundary loops using positional connectivity without destructively welding UV seams. Triangulate planar loops, including concave outlines and nested holes. Begin with a user-enabled cap option on exact plane cuts; then expose closing selected simple, near-planar openings. Give new faces explicit material choice and generated local UVs; preserve original face attributes.

**Scope/integration:** Reject ambiguous, self-intersecting or unsupported nonplanar boundaries with a clear message. Distinguish genuine topology holes from transparent textures and intentionally open surfaces. Do not promise arbitrary brush filling.

**Minimum verification / stopping condition:** Cut a textured mesh, cap both halves, export/reimport and inspect boundary-edge counts. Test a concave opening and an outline with an inner hole; no overlapping fan triangles.

**Acceptance:** [ ] Selected opening closes; [ ] valid winding/normals; [ ] original textures unchanged; [ ] undo restores the open surface.

### P05 — Connect an arm to another torso

**Status:** VERIFIED

**Objective:** Create a continuous seam between two open borders after positioning the parts.

**Required reading:** [parts.ts](src/edit/parts.ts): attribute streams; P01 composite placement and P04 boundary-loop contracts; [rigging.ts](src/rigging/rigging.ts): static input requirements.

**Target files:** `src/edit/connect.ts` (new), `src/edit/holes.ts`, `src/edit/combine.ts`, `src/ui/panels/separate.ts`, `src/core/i18n.ts`.

**Implementation:** Within a combined object, select two simple closed borders. Preview orientation, loop correspondence and connecting triangles. Support differing vertex counts with localized resampling/triangulation; preserve the surrounding mesh and material boundaries. Commit a bridge with optional local smoothing. Matching coincident borders may be welded with an explicit tolerance; positions alone must not collapse UV/material seams.

**Scope/integration:** Two unbranched borders first, not arbitrary intersecting geometry. A closed torso needs an opening created by a cut before bridging. Keep separate UV charts for old surfaces and assign UVs/material to the seam. Guide the user to rig the finished static assembly; do not reuse incompatible source weights.

**Minimum verification / stopping condition:** Attach an arm from one static GLB to an opened torso from another, using borders with different vertex counts. Verify seam connectivity, absence of degenerate faces, undo/reopen/export, then exercise the existing rigging flow.

**Acceptance:** [ ] Continuous local connection; [ ] predictable preview; [ ] surrounding appearance preserved; [ ] finished object remains editable and riggable.

### P06 — Surface brushes

**Status:** VERIFIED

**Objective:** Pull, inflate, smooth or flatten an existing surface with a brush.

**Required reading:** [separate panel](src/ui/panels/separate.ts): pointer gestures, navigation and controls; [selection.ts](src/edit/selection.ts): topology; P03 vertex editing and history contracts.

**Target files:** `src/edit/sculpt.ts` (new), `src/edit/separate.ts`, `src/ui/panels/separate.ts`, `src/core/i18n.ts`; update `src/core/editor.ts` only for domain wiring.

**Implementation:** Reuse the brush cursor/radius pattern; expose strength and selected-region restriction with current sliders/toggles. Pull follows drag displacement, inflate follows normals, flatten uses the initial brush plane, and smooth operates on connected neighbors while respecting borders. Use spatial acceleration, bounded stroke sampling and affected-vertex history. Reuse position groups to avoid tearing UV seams.

**Scope/integration:** Fixed topology, static meshes. These tools cannot create material inside a hole; direct users to Close opening or Connect borders. Preserve detail outside the brush and avoid geometry-wide work on every pointer event.

**Minimum verification / stopping condition:** Perform strokes on the connected character and a UV-seamed mesh at desktop and phone sizes; verify locality, seams, undo/cancel and save/reopen. Record interaction latency on a representative model.

**Acceptance:** [ ] Four predictable brushes; [ ] navigation still works; [ ] one undo per stroke; [ ] no full-mesh allocations per sample.

### P07 — Fuse overlapping solids (later phase)

**Status:** VERIFIED

**Objective:** Offer true volume union for suitable intersecting static meshes.

**Required reading:** P01 result publication and P04 topology validation; [Babylon merge/CSG2 documentation](https://doc.babylonjs.com/features/featuresDeepDive/mesh/mergeMeshes/); installed Babylon `Meshes/csg2` implementation and dependency licensing before choosing its worker integration.

**Target files:** `src/edit/fuse.ts`, `src/edit/fuse.worker.ts` (new), `src/edit/parts.ts`, `src/ui/ui.ts`, `src/ui/panels/separate.ts`, `src/core/i18n.ts`; dependency/license/config files only if the chosen implementation requires them.

**Implementation:** Load the boolean implementation on demand. Bake transforms into detached geometry, validate closed/manifold inputs and run union in a cancellable worker. Preserve source material/UV provenance where supported; show the result before replacing originals. Explain any changed intersection texture mapping before Apply.

**Scope/integration:** No automatic remesh, arbitrary scanned-mesh repair or silent rig removal. Preserve unsupported inputs and offer Combine instead. Verify compatibility of WASM loading, worker imports, offline caching and GitHub Pages base paths.

**Minimum verification / stopping condition:** Fuse intersecting closed meshes, verify internal-face removal and resulting manifold boundaries, then undo/reopen/export. Invalid/open inputs and cancellation leave originals intact.

**Acceptance:** [ ] True union rather than grouping; [ ] explicit appearance tradeoffs; [ ] atomic failure/cancellation; [ ] production subpath/offline operation works.

## Milestones and final verification

- **M1, P01–P02:** assemble mixed-source parts, combine or group, save and reopen without losing placement or textures.
- **M2, P03–P05:** reshape an arm and connect it to another torso; reopen, export/reimport and apply a fresh rig.
- **M3, P06–P07:** locally sculpt and optionally fuse suitable solids with reversible operations.

For every step run `npm run build` and exercise the actual UI entry point plus core logic in a headless browser, following AGENTS.md. Stop expanding checks once the stated behavior passes; add focused regressions only for demonstrated failures or high-risk geometry/persistence invariants. Phone layout checks do not prove finger gestures or physical-device performance: report those limits.

Final scenario: import two textured characters → separate an arm → position it on the other torso → combine → create/select openings → connect borders → adjust with soft scale and smooth → save/reopen → export/reimport → rig the resulting character. Check an old project still opens and shared atlas images are not rewritten or duplicated unnecessarily.

No new approval gate is required for routine local implementation when requested. Commit, push and deployment still require the user's instruction. Volumetric clay brushes, adaptive topology, atlas extraction and texture painting require a later scoped plan; do not include them implicitly in these steps.

## Tracking

| Step | Status | Evidence / commit | Human approval | Notes |
| --- | --- | --- | --- | --- |
| P01 | VERIFIED | Chair + cube combined; undo/redo; save/reopen with nothing missing | Not required for local work | First complete MVP |
| P02 | VERIFIED | Group, move, ungroup keeps world placement | Not required for local work | M1 |
| P03 | VERIFIED | Gizmo scale of a selected part (1.0 → 1.25 top) leaves the rest unchanged | Not required for local work | Reuse selection |
| P04 | VERIFIED | Cut + cap on the Poly Haven chair leaves 0 open loops; close opening on a cut sphere. Fixed: real meshes with a few non-manifold edges were refused entirely | Not required for local work | Planar openings first |
| P05 | VERIFIED | Two sphere halves bridged into a closed capsule (200-triangle seam) | Not required for local work | M2 |
| P06 | VERIFIED | Live while dragging: 2–13 ms per move on a 2M-triangle model; one undo step per stroke | Not required for local work | Fixed topology |
| P07 | VERIFIED | Two overlapping spheres fused in 2.2 s (interior removed, one surface per source material); Manifold WASM loads on demand, not precached | Not required for local work | M3; later phase |
| P08 | VERIFIED | Conform to shape: grooved sphere 0.424..0.503 → 0.496..0.503 (fill), bumps cut to 0.45 (flatten), 50% strength halfway; Add shape: box fused into the sphere, undo restores both | Not required for local work | Sphere/cylinder/box guide with gizmo; cast (keeps UVs/skin) or union via Fuse |
