# babalon JS — animation, posing and rigging implementation plan

## 1. Purpose and boundaries

**Outcome.** Make animation a first-class part of composing scenes:

- **A — existing animations:** discover, play, pause, scrub, freeze a frame for photos, loop/once, smooth switching between clips.
- **C — posing:** pose humanoid models by hand (rotate joints, IK for hands and feet), pose presets, pose from an animation frame.
- **B — retargeting:** apply animations to humanoids that come without them — clips the user imports and a built-in CC0 library.
- **D — simple animation for any object:** spin, float, pulse, swing, without keyframes.
- **E — manual rigging:** give a static humanoid model a skeleton by placing the joints of a standard free skeleton on it, then binding the mesh (E1 simple weights, E2 better weights).

**Free software only (user requirement).** All code is ours (GPL-3.0-or-later). Bundled assets must be CC0 (or a GPL-compatible license) with the license recorded in the repository. No proprietary services, accounts or downloads at runtime from services the user didn't choose. Mixamo is never required or linked as the way to do something.

**Excluded.** Keyframe animation editor/timeline authoring, facial animation and blend-shape editing, finger rigging in E1, non-humanoid auto-rigging, physics/ragdoll, cloth and hair simulation.

**Governing documents.** `AGENTS.md` (DRY, cheapest by default, render on demand, touch first, one-level UI, i18n, undo, projects, verification, git). `roadmap_implementation_plan.md` — this plan is separate but shares contracts with its P01 (undo for everything), P08 (lazy loading) and P09 (video).

**Execution rules.** Steps in order; the user validates locally before any commit; commit/push only when asked, never with AI attribution; human gates must be approved before continuing.

## 2. Verified current state

Checked at commit `023885a` and with external sources:

- **Animation today** (`src/ui.ts` `objectSection()`): when a model has animation groups, the Objects → Object part shows an "Animation" select, Play/Pause and a Speed slider. `src/editor.ts` `instantiate()` starts the first clip in loop; `loadAsset()` stops the clips auto-started on the hidden container template. `src/project.ts` saves `{ index, playing, speed }` per entity. Rendering on demand (`needsRender()`) keeps drawing while an `Animatable` is running and not paused.
- **Babylon 9.30 (installed):**
  - `node_modules/@babylonjs/core/Animations/animatorAvatar.d.ts` — `AnimatorAvatar.retargetAnimationGroup(group, IRetargetOptions)` with `mapNodeNames`, `fixRootPosition`, `fixGroundReference`, `rootNodeName`, `groundReferenceNodeName`.
  - `node_modules/@babylonjs/core/Bones/` — `Skeleton`, `Bone`, `BoneIKController`, `BoneLookController`.
  - `AnimationGroup` supports `goToFrame`, `play`, `pause`, weights/blending.
  - glTF skeletons drive bones through linked `TransformNode`s (`bone.getTransformNode()`); posing must act on those nodes.
- **Free skeleton and animation sources (checked):**
  - **Quaternius Universal Animation Library** — CC0 ("Free to use in personal, educational and commercial projects"), a universal humanoid rig made for retargeting, 120+ animations in the full kit; the free Standard version (≈45 animations, glTF/FBX) is on OpenGameArt; volume 2 adds 130+. Bone names and rest pose (T or A) are **not stated** on the page → verified in R00. Sources: https://quaternius.com/packs/universalanimationlibrary.html, https://opengameart.org/content/universal-animation-library, https://opengameart.org/content/universal-animation-library-2.
  - **VRM humanoid specification** (`specification/VRMC_vrm-1.0/humanoid.md` in `vrm-c/vrm-specification`) — standard bone names, parents and *estimated anatomical positions* (e.g. hips: crotch; spine: top of pelvis). The repository declares no license → we use the naming convention only and write our own data.
  - **MakeHuman** — bundled assets (base mesh, proxies, poses, expressions) are CC0 per `LICENSE.md`; skeletons are not named explicitly → fallback source only, after checking.
  - **Godot `SkeletonProfileHumanoid`** (engine is MIT) — 56-bone humanoid profile with a reference T-pose; reference for conventions.
- **Reusable pieces:** `src/presets.ts` (shared data), `src/dom.ts` (components, touch sliders), `src/tools.ts` (screen-space overlays, labels, picking helpers), editor gizmos (`GizmoManager`), `editor.pickSurface()`, `editor.toScreen()`, `editor.worldPerPixel()`.

## 3. Target architecture

| Responsibility | Where |
| --- | --- |
| Clip control (play, scrub, freeze, loop, crossfade) | `src/editor.ts` (entity animation API) + `src/ui.ts` (Object part, selection bar) |
| Humanoid detection and canonical bone map | new `src/humanoid.ts` (pure data + functions, no UI) |
| Standard skeleton template (bones, hierarchy, rest pose, anatomical guides) | new `src/humanoidTemplate.ts` (data, derived from the CC0 rig chosen in R00) |
| Posing (FK, IK, presets, mirror) | new `src/pose.ts` + bone handles overlay; UI in Objects part "Pose" |
| Retargeting (imported clips, library) | new `src/retarget.ts` using `AnimatorAvatar` + `src/humanoid.ts` maps |
| Built-in CC0 animation library | `public/animations/` (lazy, runtime-cached) + `ANIMATION_LIBRARY` in `src/presets.ts` + `THIRD_PARTY_LICENSES.md` |
| Procedural object animation | new `src/motion.ts` (Babylon `Animation`s so render-on-demand detects them) |
| Manual rigging (joint placement, binding, weights) | new `src/rigging.ts` (+ `src/weights.worker.ts` for E2) |
| Persistence | `src/project.ts` / `src/state.ts` (from roadmap P01) |

Boundaries: `editor.ts` stays UI-free; heavy math (weights) never on the main thread in E2; new UI lives inside existing panels (Objects parts) and the selection bar's More menu — no new top-level buttons.

## 4. Cross-cutting contracts and invariants

- **Canonical bone names = VRM humanoid names** (`hips`, `spine`, `chest`, `upperChest`, `neck`, `head`, `leftShoulder`, `leftUpperArm`, `leftLowerArm`, `leftHand`, `leftUpperLeg`, `leftLowerLeg`, `leftFoot`, `leftToes`, and right side). Every other convention (Quaternius, Mixamo-style, Unreal, Rigify, MakeHuman) maps to these in `src/humanoid.ts`.
- **One rig template** for rigging, posing presets and the built-in library (chosen in R00), so built-in clips need no runtime name mapping for rigs made in the app.
- **Licenses:** every bundled third-party file is listed in `THIRD_PARTY_LICENSES.md` with source URL and license; projects record source/license for library clips.
- **Projects:** new fields optional; old projects open unchanged. Pose = per-bone local rotations by canonical name; rig = template id + joint positions + weights method/version (weights recomputed on load when deterministic — decision D3).
- **Undo:** clip changes, pose edits, rigging confirm, applying a retargeted clip are one step each (uses roadmap P01 `beginEdit`/`endEdit` when available; otherwise the existing `push`/`group`).
- **Render on demand:** use Babylon `Animatable`/`AnimationGroup`s (auto-detected); a frozen frame doesn't render continuously.
- **Touch:** bone selection works with fingers (large handles + bone list alternative); everything works at 375 px.
- **Cheapest by default:** heavier options (crossfade, IK solving every frame, E2 weights) only when used.

### Open decisions

| ID | Decision | Needed before |
| --- | --- | --- |
| D1 | Template rig source: Quaternius UAL rig (preferred if R00 confirms CC0 files, clean T/A pose and usable names) vs. our own skeleton written from the VRM anatomical guide | R03 |
| D2 | Which built-in clips to bundle and their total size (lazy-loaded, not precached) | R06 |
| D3 | Rigged models in projects: store computed weights (fast load, bigger files) or recompute from joints (small files, slower load) | R08 |
| D4 | E2 weights method details: heat diffusion on a decimated proxy vs. full mesh, size limits on phones | R09 |

## 5. Implementation steps

### R00 - Verify the free rig and animation sources

**Status:** TODO

**Objective**

Know exactly what the CC0 rig and clips contain and whether Babylon's retargeting works with them, before any code depends on them.

**Required reading**

- `node_modules/@babylonjs/core/Animations/animatorAvatar.d.ts`;
- `src/editor.ts` — `loadAsset()`, `instantiate()`;
- Quaternius UAL pages (section 2), VRM `humanoid.md`.

**Target files**

- `docs/animation_sources.md` (findings: license files found inside the downloads, bone names, hierarchy, rest pose, units, clip list and sizes, retarget results).

**Scope**

- Download the Standard UAL (free) and check: license text inside the archive, glTF bone names, T or A rest pose, scale, root bone, foot bones.
- Retarget one UAL clip onto the Xbot and HVGirl samples with `AnimatorAvatar` (+ `mapNodeNames`) in a scratch page; note fixes needed (`fixRootPosition`, ground reference).
- No product code.

**Integration with the project**

- Feeds D1, D2, R02, R05, R06.

**Minimum pre-integration verification**

A scratch run in the dev server where a UAL walk plays correctly on another humanoid.

**Acceptance criteria**

- [ ] License of the files actually downloaded is confirmed CC0 (or the gap is recorded).
- [ ] Bone list and rest pose documented.
- [ ] Retargeting result documented with screenshots/notes, including failures.

## Milestone M0 - Sources approved

**Proves**

The free rig and clips are usable and legally clean.

**Integrated verification**

- `docs/animation_sources.md` reviewed; scratch retarget demo shown.

**Human approval gate**

- [ ] D1 and D2 decided by the user.
- [ ] Approval received before R01 begins.

---

### R01 - Control existing animations (A)

**Status:** TODO

**Objective**

Animations of any model are easy to find and control: clip chips, play/pause also in the selection bar, a scrubber to pick a frame and freeze it for photos, loop or once, and smooth crossfade when switching clips.

**Required reading**

- `src/ui.ts` — `objectSection()`, `renderSelbar()`, `toggleSelMenu()`;
- `src/editor.ts` — `instantiate()` (auto-start), `needsRender()`;
- `src/project.ts` — `entityToJSON()` animation field, `restore()`;
- `src/dom.ts` — `chips`, `slider`;
- roadmap P09 (video should respect the chosen clip/frame).

**Target files**

- `src/editor.ts` (entity animation API: `playClip`, `pauseClip`, `seekClip(frame)`, `setLoop`, crossfade);
- `src/ui.ts`, `src/project.ts`, `src/i18n.ts`, `src/style.css`.

**Scope**

- Selection bar shows a play/pause button only for animated entities.
- Scrubber shows the clip's frame range; dragging pauses and seeks; frozen frames render once (no continuous rendering).
- Crossfade duration short (~0.3 s), off when switching while paused.
- Project saves clip, frame, playing, loop, speed; old `{ index, playing, speed }` still loads.
- Excluded: editing keyframes.

**Integration with the project**

- Undo: clip switch and freeze are one step each.

**Minimum pre-integration verification**

HVGirl and Xbot samples: switch clips, scrub, freeze, photo, save/reopen, check idle frames are 0 when frozen.

**Acceptance criteria**

- [ ] A frozen frame is kept after save/reopen and appears in the photo.
- [ ] Switching clips while playing blends without a pop.
- [ ] Old projects keep their animation state.
- [ ] Idle rendering stops when the animation is paused or frozen.

---

### R02 - Recognize humanoid skeletons

**Status:** TODO

**Objective**

The app knows when a model is a humanoid and which bone is the hips, left upper arm, etc., whatever naming its author used; a manual mapping screen covers the rest.

**Required reading**

- `docs/animation_sources.md` (R00);
- VRM `humanoid.md` (canonical names and hierarchy);
- `src/editor.ts` — `Entity`, skeletons from `instantiate()`.

**Target files**

- `src/humanoid.ts` (convention tables, `detectHumanoid(entity)` → canonical map + confidence);
- `src/ui.ts` (mapping screen inside Objects → Object when detection is partial), `src/i18n.ts`.

**Scope**

- Built-in conventions: UAL rig (from R00), VRM, Mixamo-style (`mixamorig:` prefix), Unreal mannequin, Blender Rigify deform bones, MakeHuman game skeleton.
- Name normalization (case, prefixes, separators, `.L`/`_l`/`Left` variants).
- Manual mapping saved in the project per entity.
- Excluded: fingers and face (optional mapping only).

**Integration with the project**

- Required by R03–R06 and R08.

**Minimum pre-integration verification**

Run detection on the Xbot, HVGirl and a UAL character; print the map.

**Acceptance criteria**

- [ ] Required VRM bones are mapped automatically for the tested models.
- [ ] A model with unknown names can be mapped by hand and the map survives save/reopen.
- [ ] Non-humanoid models are not misdetected (no Pose/Retarget options shown).

## Milestone M1 - Animations usable

**Proves**

Existing animations are discoverable and photo-friendly, and humanoids are understood by the app.

**Integrated verification**

- S24 and desktop: control clips on the samples, freeze a frame, take a photo; detection results shown for three models.

**Human approval gate**

- [ ] Evidence reviewed by the user.
- [ ] Approval received before R03 begins.

---

### R03 - Pose humanoids by hand (C, forward kinematics)

**Status:** TODO

**Objective**

In a "Pose" part of the Objects panel, select a joint (tap its handle or pick it from a list) and rotate it with the rotation gizmo; mirror left/right; reset a joint or the whole pose; use the current animation frame as the pose.

**Required reading**

- `src/humanoid.ts` (R02);
- `src/editor.ts` — `GizmoManager` setup, `applyTool()`, `select()`, overlays (`overlays` set);
- `src/tools.ts` — overlay/labels patterns, `screenLine()`;
- `src/ui.ts` — `panelParts()`, Objects part;
- Babylon `Bone`, `bone.getTransformNode()`.

**Target files**

- `src/pose.ts` (pose state, apply/mirror/reset, serialize by canonical bone);
- `src/editor.ts` (pose mode: gizmo attached to bone transform nodes, handles overlay);
- `src/ui.ts`, `src/project.ts`, `src/i18n.ts`, `src/style.css`.

**Scope**

- Pose overrides the animation (animation paused while posing); "Back to animation" clears it.
- Handles sized in screen pixels; bone list for precise selection on phones.
- Each gizmo drag is one undo step.
- Excluded: IK (R04).

**Integration with the project**

- Pose saved per entity by canonical names (works across conventions).

**Minimum pre-integration verification**

Pose the HVGirl (raise an arm, turn the head), mirror, photo, save/reopen, undo.

**Acceptance criteria**

- [ ] Rotating a joint deforms the mesh correctly and is undoable.
- [ ] Mirror produces the symmetric pose.
- [ ] The pose survives save/reopen and appears in photos and AR.

---

### R04 - Inverse kinematics and pose presets (C)

**Status:** TODO

**Objective**

Drag a hand or foot target and the arm or leg follows (IK); apply ready poses (stand, sit, point, wave, walk frame) from a list.

**Required reading**

- `src/pose.ts` (R03);
- `node_modules/@babylonjs/core/Bones/boneIKController.d.ts`;
- `src/presets.ts` (where pose presets live);
- `docs/animation_sources.md` (frames usable as presets).

**Target files**

- `src/pose.ts`, `src/presets.ts` (`POSE_PRESETS` by canonical bone), `src/ui.ts`, `src/i18n.ts`.

**Scope**

- IK solved only while dragging (cheapest by default); result stored as FK rotations.
- Presets defined in canonical names so they apply to any detected humanoid.
- Excluded: full-body IK, foot locking during animation.

**Integration with the project**

- Presets can come from CC0 clip frames (R06) or our own data.

**Minimum pre-integration verification**

Place a hand on a table with IK; apply each preset to two different humanoids.

**Acceptance criteria**

- [ ] Dragging a hand target moves the arm naturally without breaking the elbow.
- [ ] Each preset looks right on at least two different humanoids.
- [ ] No continuous rendering after IK dragging ends.

## Milestone M2 - Posing

**Proves**

Characters can be posed for scenes and photos, by hand or from presets.

**Integrated verification**

- S24: pose a character with FK and IK using touch, apply a preset, photo, AR, save/reopen.

**Human approval gate**

- [ ] Evidence reviewed by the user.
- [ ] Approval received before R05 begins.

---

### R05 - Retarget imported clips (B)

**Status:** TODO

**Objective**

Import an animation file (GLB/glTF/FBX with clips) and apply its clips to a selected humanoid that has a skeleton but no (or different) animations.

**Required reading**

- `docs/animation_sources.md` (retarget options that worked);
- `src/humanoid.ts` (R02) — source and target maps;
- `node_modules/@babylonjs/core/Animations/animatorAvatar.d.ts`;
- `src/editor.ts` — `loadAsset()` (load the clip file without adding it to the scene);
- `src/project.ts` (store the clip file under `animations/`).

**Target files**

- `src/retarget.ts` (load clip container, build `mapNodeNames` from both canonical maps, call `retargetAnimationGroup` with root/ground fixes);
- `src/editor.ts` (attach retargeted groups to the entity), `src/ui.ts` ("Add animation" in the Object part), `src/project.ts`, `src/i18n.ts`.

**Scope**

- Clip file stored in the project; retargeting recomputed on load.
- Root motion: keep in place option (default) vs. move.
- Errors (non-humanoid source/target, missing required bones) shown clearly.
- Excluded: editing clips.

**Integration with the project**

- Retargeted clips appear in R01 controls like native ones.

**Minimum pre-integration verification**

Apply a UAL clip file onto HVGirl and Xbot; save/reopen.

**Acceptance criteria**

- [ ] The retargeted clip plays without broken limbs and with feet on the ground.
- [ ] It survives save/reopen and `.babalon` export/import.
- [ ] Clear error for a non-humanoid target.

---

### R06 - Built-in CC0 animation library (B)

**Status:** TODO

**Objective**

Pick from a built-in list of free animations (idle, walk, run, jump, sit, wave, dance…) and apply it to any humanoid in one tap.

**Required reading**

- D2 (chosen clips and size);
- `src/retarget.ts` (R05);
- `src/presets.ts` (data format);
- `vite.config.ts` (precache vs. runtime caching).

**Target files**

- `public/animations/` (CC0 clips, size-optimized);
- `src/presets.ts` (`ANIMATION_LIBRARY` with id, label, file, license, source);
- `THIRD_PARTY_LICENSES.md` (new);
- `vite.config.ts` (runtime-cache the clips, don't precache), `src/ui.ts`, `src/i18n.ts`.

**Scope**

- Clips loaded lazily on first use and cached for offline.
- License and source visible in the list and stored in the project.
- Excluded: online catalogs.

**Integration with the project**

- Uses R05; rigs made in the app (R08) use the same template, so no mapping needed.

**Minimum pre-integration verification**

Offline after first use; apply three clips to two humanoids on the S24.

**Acceptance criteria**

- [ ] Library clips apply to detected humanoids in one tap.
- [ ] Every bundled file is listed in `THIRD_PARTY_LICENSES.md` with CC0 source.
- [ ] Startup size and precache unchanged (clips are lazy).

---

### R07 - Simple animation for any object (D)

**Status:** TODO

**Objective**

Give any object a simple motion — spin, float, pulse, swing — with speed and amount, no keyframes.

**Required reading**

- `src/editor.ts` — `needsRender()` (animatables), entity transforms;
- `src/project.ts` (entity JSON);
- `src/ui.ts` — Object part;
- roadmap P09 (video).

**Target files**

- `src/motion.ts` (builds Babylon `Animation`s on a dedicated child node so the user's transform stays editable);
- `src/editor.ts`, `src/ui.ts`, `src/project.ts`, `src/i18n.ts`.

**Scope**

- Motion runs on a child pivot, so moving/rotating the object still works and undo stays clean.
- Saved per entity; paused in photo mode on request (freeze).
- Excluded: paths, keyframes.

**Integration with the project**

- Render-on-demand detects it automatically through animatables.

**Minimum pre-integration verification**

Spin a product and float a sign; record a turntable video (if P09 exists); save/reopen.

**Acceptance criteria**

- [ ] Motions play smoothly and stop rendering when paused.
- [ ] The object can still be moved while animating.
- [ ] Saved and restored with the project.

## Milestone M3 - Animation for everyone

**Proves**

Any humanoid with a skeleton can be animated with free clips, and any object can have simple motion.

**Integrated verification**

- S24: import a rigged humanoid without clips, apply library and imported clips, add a spinning object, photo/AR, save/reopen offline.

**Human approval gate**

- [ ] Evidence reviewed by the user.
- [ ] Approval received before R08 begins.

---

### R08 - Manual rigging with the standard skeleton (E1)

**Status:** TODO

**Objective**

Turn a static humanoid model into a skinned character: the standard template skeleton appears scaled to the model, the user drags its joints into place (front view, mirrored), depth is found automatically, the mesh is bound with simple smooth weights, checked with a weight heat map and a test pose, and confirmed.

**Required reading**

- `src/humanoidTemplate.ts` / D1 (template bones, hierarchy, rest pose, anatomical guide positions from VRM `humanoid.md`);
- `src/editor.ts` — `pickSurface()` (ray hits for depth), `boundsOf()`, overlays, orthographic/front camera handling;
- `src/tools.ts` — handle/label overlay patterns and drag logic (`dragGuide` style);
- Babylon `Skeleton`, `Bone`, `VertexBuffer.MatricesIndicesKind`/`MatricesWeightsKind`;
- D3.

**Target files**

- `src/humanoidTemplate.ts` (template data);
- `src/rigging.ts` (fit, joint editing, depth from front/back ray midpoint, mirror, envelope weights + smoothing, bind/unbind);
- `src/editor.ts` (rig mode, bind result as a regular skinned entity), `src/ui.ts` (Rig part in Objects for unrigged meshes), `src/project.ts`, `src/i18n.ts`, `src/style.css`.

**Scope**

- Front-view joint placement; depth = midpoint between front and back surface hits at the joint's screen position.
- Symmetry on by default; T or A pose models.
- Weights: each vertex weighted by distance to the nearest bone segments (up to 4 influences), then smoothed over mesh neighbors; separate meshes (clothes) get weights from the closest body point.
- Heat map per selected bone; test pose slider (bend elbows/knees/spine) before confirming.
- Result works with R01, R03–R06 immediately and exports to GLB with its skin.
- Excluded: fingers, face, non-humanoids.

**Integration with the project**

- Uses the same template as the built-in clips (no mapping).

**Minimum pre-integration verification**

Rig a static CC0 humanoid (e.g. a MakeHuman or UAL base mesh with the skin removed) on desktop and the S24; apply a library walk; export GLB and reopen it.

**Acceptance criteria**

- [ ] A static humanoid becomes animatable and posable after rigging.
- [ ] Limbs bend without tearing; known artifacts (shoulders/hips) are documented.
- [ ] Rig survives save/reopen and GLB export.
- [ ] Cancelling leaves the model untouched.

---

### R09 - Better skin weights (E2)

**Status:** TODO

**Objective**

An optional "better weights" pass (heat diffusion) that bends shoulders, hips and armpits much more naturally, computed in the background.

**Required reading**

- `src/rigging.ts` (R08 weights interface);
- D4;
- roadmap P07 decimation choice (proxy mesh).

**Target files**

- `src/weights.worker.ts` (mesh Laplacian + per-bone sparse solve, conjugate gradient), `src/rigging.ts` (proxy decimation and weight transfer back), `src/ui.ts` (progress, cancel), `src/i18n.ts`.

**Scope**

- Runs in a Web Worker; progress and cancel; size limits on phones (D4).
- Falls back to E1 weights on failure (non-manifold meshes etc.).

**Integration with the project**

- Same bind output as R08; stored per D3.

**Minimum pre-integration verification**

Compare E1 and E2 on the same model with the test pose; time it on the S24.

**Acceptance criteria**

- [ ] Visibly better deformation at shoulders and hips than E1 on the test model.
- [ ] The UI stays responsive during computation; cancel works.
- [ ] Failure falls back to E1 with a message.

## Milestone M4 - Rigging

**Proves**

A static humanoid can be rigged in the app with free tools only and then posed and animated.

**Integrated verification**

- S24: rig a static model (E1 then E2), apply a library clip and a pose, photo, AR, save/reopen, export GLB.

**Human approval gate**

- [ ] Evidence reviewed by the user.
- [ ] Approval received before release.

## 6. Final integrated validation

- **Flow:** static humanoid → rig (E1/E2) → library walk → freeze a frame → adjust pose with IK → photo → AR → save → reopen offline → GLB export opened in another viewer.
- **Compatibility:** projects from before this plan open with their animation state.
- **Licensing:** every bundled asset listed in `THIRD_PARTY_LICENSES.md`; no runtime calls to services the user didn't add.
- **Performance:** idle frames 0 when nothing animates; startup size unchanged (clips and rigging code lazy).
- **Failure cases:** non-humanoid model (no pose/retarget/rig options), missing bones (clear message), cancelled rigging/weights.

## 7. Execution tracking

| Step | Status | Evidence / commit | Human approval | Notes |
|---|---|---|---|---|
| R00 | TODO | | [ ] | Verify CC0 rig/clips + retarget — Milestone M0, decides D1, D2 |
| R01 | TODO | | [ ] | Control existing animations (A) |
| R02 | TODO | | [ ] | Humanoid detection and mapping — Milestone M1 |
| R03 | TODO | | [ ] | Posing FK (C) |
| R04 | TODO | | [ ] | IK and pose presets (C) — Milestone M2 |
| R05 | TODO | | [ ] | Retarget imported clips (B) |
| R06 | TODO | | [ ] | Built-in CC0 animation library (B) |
| R07 | TODO | | [ ] | Simple object motion (D) — Milestone M3 |
| R08 | TODO | | [ ] | Manual rigging E1 — needs D3 |
| R09 | TODO | | [ ] | Better weights E2 — Milestone M4, needs D4 |
