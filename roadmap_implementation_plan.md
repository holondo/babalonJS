# babalon JS — roadmap implementation plan

## 1. Purpose and boundaries

**Outcome.** Take babalon JS from "complete core loop" (compose → light → photograph → AR → save) to a complete everyday tool: several projects kept in the browser, every edit undoable, the user's own textures and environments, richer materials, video output, reliable behavior with heavy models on phones, a faster start, accessibility, a built-in CC0 asset library, the next AR features (anchors, real-world measuring, occlusion, iPhone), a camera mode that can use the phone's other rear lenses, and Play Store distribution.

**Explicitly excluded (user decision):** saved camera views, automated test suites, help / first-use onboarding, sharing scenes by link (no server).

**Governing documents and constraints**

- `AGENTS.md` — DRY, cheapest-by-default, render on demand, touch first, interface structure (one level deep), palette, i18n (`tr()` + PT), undo and project rules, PWA paths, verification and git rules. Every step follows it.
- `README.md` — product behavior that must keep working.
- 100% client-side: no server may be introduced (sharing by link is excluded; third-party services are only fetched from, never written to).
- `editor.ts` never touches the DOM UI; `ui.ts` talks to it through methods and `changed`.

**Execution and approval rules**

- One step at a time, in order, unless a step says it is independent.
- The user validates locally before anything is committed; commit and push only when asked, with no AI attribution.
- Steps that need a real device (AR, camera lenses, sensors, Android share/TWA) end with an on-device check by the user.
- Human gates (section 6) must be approved before the next step begins.

## 2. Verified current state

Facts checked in the repository at commit `023885a` (clean tree):

- **Stack:** Babylon.js 9.30 (`@babylonjs/core`, `loaders`, `materials`, `serializers`), TypeScript, Vite 8, `vite-plugin-pwa`, `fflate`, `lucide`. Deployed to GitHub Pages by `.github/workflows/deploy.yml` with `BASE_PATH`.
- **Undo** (`src/core/editor.ts`): `Command { undo, redo, entities? }`, private `push()` (line ~559) and `group()` (~543), public `undo()`/`redo()`, transform history via `beginTransform()`/`endTransform()`/`transformMany()` (~606–626). Only transforms, add/remove, light presets and alignment are undoable. Material edits (`src/ui/ui.ts` `materialControls()` ~1178), light properties (`lightControls()` ~1276), environment (`envPanel()` ~1312 → `editor.applyEnv()`), and photo settings (`photoPanelContent()` ~1349 → `editor.setPhoto()`) mutate state directly with no history.
- **Projects** (`src/core/project.ts`): `snapshot()` / `restore()` / `toZip()` / `fromZip()`; `ProjectJSON` (~60) with `MaterialJSON` (~20); IndexedDB database `babalon-js`, store `projects`, single key `autosave` (`saveAutosave`/`loadAutosave`, ~320–360). `src/ui/ui.ts` `setupAutosave()` (~496) offers "Continue where you left off" in the empty state (`renderAll()` ~353). Model source files are stored in the snapshot (`files`), sample models as URLs.
- **Materials:** PBR edits limited to color/tint, texture show/hide, metallic, roughness, clear coat, unlit, emission, opacity, double-sided, wireframe. Babylon 9 exposes `subSurface` (refraction/translucency), `sheen`, `iridescence`, `anisotropy` on `PBRMaterial` (`node_modules/@babylonjs/core/Materials/PBR/pbrBaseMaterial.pure.d.ts`).
- **Environments:** fixed list `ENV_PRESETS` (`src/core/editor.ts` ~111) of prefiltered `.env` URLs loaded with `CubeTexture.CreateFromPrefilteredData` (~1348). Babylon 9 also ships `HDRCubeTexture`, `EquiRectangularCubeTexture`, `EXRCubeTexture`.
- **Presets:** lighting presets and photo filters live in `src/core/presets.ts` (shared by editor and AR).
- **Model import:** `loadAsset()` (~755) → `instantiate()` (~791) with size normalization; no checks on triangle count, texture size or memory. Babylon 9 includes `Mesh.simplify` / `SimplificationQueue` (`Meshes/meshSimplification.d.ts`).
- **Capture:** `editor.capture()` (~1529) renders at up to 2× and crops to the photo aspect; `src/core/files.ts` has `saveAndOfferShare()` and `timestampedName()`. No video.
- **Bundle:** `import … from '@babylonjs/core'` everywhere; main chunk ≈ 5.4 MB (≈ 1.15 MB gzip); PWA precache ≈ 9.7 MB. Loaders are already lazy (`registerBuiltInLoaders`).
- **Accessibility:** icon buttons get `aria-label` (`src/ui/dom.ts` `iconButton()`); no focus-visible styling, no keyboard navigation inside menus, no reduced-motion handling, toasts aren't announced.
- **AR** (`src/ar/ar.ts`, `src/ar/arHud.ts`): WebXR `immersive-ar`, hit test, DOM overlay, optional light estimation and raw camera access, virtual AR, place-in-front, scene grouped under a temporary anchor node (not an XR anchor). Babylon 9 has `WebXRFeatureName.ANCHOR_SYSTEM` and `DEPTH_SENSING`; `@babylonjs/serializers` has `USDZExportAsync` (option `fflateUrl`).
- **Tools** (`src/tools/tools.ts`): measurement with anchors on entities or floor, unit formatting — reusable for AR measuring.
- **Camera image outside XR:** none (no `getUserMedia` usage).
- **Distribution:** PWA with manifest, file handlers and share target in `vite.config.ts`; no Android wrapper; site is a project page (`https://holondo.github.io/babalonJS/`).

## 3. Target architecture

| Responsibility | Where | Notes |
| --- | --- | --- |
| Generic undoable edits | `src/core/editor.ts` (public `beginEdit`/`endEdit` around the existing `push`) | UI never builds commands itself |
| Serializing materials / lights / env (shared by undo and projects) | new `src/state.ts` (moved from `src/core/project.ts`) | One implementation (DRY) |
| Project library (many projects, thumbnails, migration) | `src/core/project.ts` (storage) + `src/ui/ui.ts` (gallery) | Same `ProjectSnapshot` format |
| Material presets, PBR extensions | `src/core/presets.ts` (data) + `src/ui/ui.ts` `materialControls()` | Presets are data, not code |
| User textures / HDRs as project files | `src/core/editor.ts` (apply) + `src/core/project.ts` (store under `textures/`, `environments/`) | Restore from files like model assets |
| Import analysis and optimization | new `src/optimize.ts`, called from `editor.loadAsset()` flow | No UI inside it |
| Video recording | new `src/video.ts` (camera path + recorder) + photo panel | Reuses capture crop and `files.ts` |
| Lazy features / smaller bundle | `vite.config.ts`, deep imports across `src/*.ts`, dynamic `import()` | Behavior unchanged |
| Accessibility | `src/ui/dom.ts` components + `src/ui/style.css` | Fix in components, not per screen |
| Asset library | new `src/library.ts` (Poly Haven client) + Add panel / Environment part | Read-only remote fetches |
| XR anchors, AR measuring, occlusion | `src/ar/ar.ts`, `src/ar/arHud.ts`, reuse `src/tools/tools.ts` | Optional features, off by default |
| Camera mode with lens choice | new `src/cameraMode.ts` + mode switch | Non-tracked; independent of WebXR |
| iPhone AR | `src/ar/ar.ts` or new `src/quicklook.ts` using `USDZExportAsync` | iOS only |
| Android app | `twa/` (Bubblewrap project) + Digital Asset Links | Outside `src/` |

Boundaries: `editor.ts` stays UI-free; new data goes in `presets.ts`; new UI uses `dom.ts` components; nothing new adds a top-level button outside the structure in `AGENTS.md` without a decision.

## 4. Cross-cutting contracts and invariants

- **Project format compatibility.** New `ProjectJSON` fields are optional; projects saved before a step must still open after it. `VERSION` stays `1` unless a breaking change is approved.
- **Project files.** Every user-provided binary (models, textures, HDRs, library downloads the user keeps) is stored in `ProjectSnapshot.files` under a typed prefix (`assets/`, `textures/`, `environments/`) and referenced by path from JSON. Remote URLs are allowed only for built-in samples and library items, and the user can choose to embed library items (decision D4).
- **Undo granularity.** One user gesture = one undo step: slider drags commit on `change`, color pickers on `change`, toggles/chips immediately; multi-target operations use `group()`.
- **Render on demand.** Anything changing the picture calls editor methods that emit `changed` or calls `editor.invalidate()`; recording forces continuous rendering for its duration only.
- **Cheapest by default.** New expensive features (depth occlusion, high-res video, optimizations that alter content) are opt-in; automatic behavior may only warn or do lossless work.
- **Device honesty.** Features that depend on hardware (lenses, depth sensing, anchors, USDZ viewer) detect support at runtime and hide or explain themselves; never fake a capability.
- **i18n.** Every new string through `tr()` with PT translation; labels short and sentence case.
- **Storage.** IndexedDB writes are best-effort: failures surface as a toast, never lose the open scene; request persistent storage when the library grows (decision D5).
- **Third parties.** Only CC0 or explicitly licensed assets; record source and license in the project JSON for library items.

### Open decisions

| ID | Decision | Needed before |
| --- | --- | --- |
| D1 | Video container: WebM via `MediaRecorder` only, or also MP4 (native `MediaRecorder` MP4 where supported vs. WebCodecs + a muxer dependency) | P09 |
| D2 | Mesh decimation: Babylon's built-in `simplify()` vs. adding a meshoptimizer dependency | P07 |
| D3 | Poly Haven use: confirm API terms, CORS from the browser, attribution wording | P10 |
| D4 | Library items in projects: embed downloaded files (offline, heavier) or store URLs (light, needs network) | P10 |
| D5 | Storage budget per project / total and when to call `navigator.storage.persist()` | P02 |
| D6 | Camera mode lens selection: confirm what the S24 exposes (separate rear `deviceId`s and/or `zoom` < 1) before building UI | P14 |
| D7 | Play Store: Digital Asset Links must be served at `https://holondo.github.io/.well-known/assetlinks.json` (needs a `holondo.github.io` repo) or a custom domain; Play developer account and package name | P16 |

## 5. Implementation steps

### P00 - Record the baseline

**Status:** TODO

**Objective**

Have reference numbers to judge later steps: startup time, bundle and precache size, memory and FPS with a heavy model on the S24.

**Required reading**

- `AGENTS.md`;
- `vite.config.ts`;
- `package.json`;
- `src/core/editor.ts` (`needsRender()`, `loadAsset()`).

**Target files**

- `docs/baseline.md` (new, short table of measurements).

**Scope**

- Record `npm run build` chunk sizes and PWA precache size.
- On the S24 (published site): time to first rendered frame (cold and cached), FPS while orbiting with a heavy sample model, and whether the tab survives loading a ~100 MB glTF.
- No code changes.

**Integration with the project**

- Numbers are reused by P06, P07 and M3.

**Minimum pre-integration verification**

Build output and one measured session on the S24.

**Acceptance criteria**

- [ ] Baseline table exists with build sizes and on-device timings.
- [ ] The heavy-model behavior on the phone (works / slow / crashes) is recorded.

---

### P01 - Make every edit undoable

**Status:** TODO

**Objective**

Material, light, environment and photo-setting changes can be undone and redone like transforms, one step per gesture.

**Required reading**

- `src/core/editor.ts` — `Command`, `push()`, `group()`, `undo()`, `redo()`, `beginTransform()`/`endTransform()`, `applyEnv()`, `setPhoto()`, `setLightShadows()`;
- `src/core/project.ts` — `materialToJSON()`, `applyMaterial()`, `entityToJSON()` light part (to reuse, not duplicate);
- `src/ui/ui.ts` — `materialControls()`, `lightControls()`, `envPanel()`, `photoPanelContent()`, `quiet()`;
- `src/ui/dom.ts` — `slider()` (`onCommit`), `colorInput()`, `toggle()`, `chips()`.

**Target files**

- `src/state.ts` (new: material/light/env/photo state capture and apply, moved out of `src/core/project.ts`);
- `src/core/editor.ts` (public `beginEdit(key, capture, apply)` / `endEdit(key)`);
- `src/core/project.ts` (use `src/state.ts`);
- `src/ui/ui.ts` (controls call begin/end);
- `src/ui/dom.ts` (`colorInput` gains an optional `onCommit` on `change`).

**Scope**

- Edits covered: every control in Material, selected light, Environment, Photo, AR-independent tools settings that change the scene (units excluded).
- Slider drags and color picks are one step each; toggles and chips are immediate steps; light presets keep their existing grouped step.
- Undo after a material edit restores all PBR fields and texture visibility.
- Excluded: AR session options (temporary by design), language, project name.

**Integration with the project**

- `src/state.ts` becomes the single serializer used by both undo and projects.
- Editor emits `history` and the relevant change kind so panels refresh.

**Minimum pre-integration verification**

In the dev server: change roughness, color, a light's intensity, HDR rotation and exposure; undo each; redo each; save and reopen a project to confirm serialization still matches.

**Acceptance criteria**

- [ ] Each covered change is reverted by one Ctrl+Z / undo button press and restored by redo.
- [ ] A slider drag produces exactly one undo step.
- [ ] Projects saved before this step open with identical materials and lights.
- [ ] No duplicated serialization code remains in `src/core/project.ts`.

---

### P02 - Keep several projects in the browser

**Status:** TODO

**Objective**

A project gallery with thumbnails: create, open, rename, duplicate and delete projects; the open project autosaves into its own slot.

**Required reading**

- `src/core/project.ts` — IndexedDB helpers, `snapshot()`, `restore()`, `saveAutosave()`, `loadAutosave()`;
- `src/ui/ui.ts` — `setupAutosave()`, `scheduleAutosave()`, `loadSnapshot()`, `newProject()`, `toggleMenu()` (project menu), `renderAll()` (empty state);
- `src/core/editor.ts` — `capture()` (thumbnail source), `newScene()`;
- `src/core/files.ts`;
- decision D5.

**Target files**

- `src/core/project.ts` (library API: `listProjects`, `saveProject(id, snap, thumb)`, `loadProject(id)`, `deleteProject(id)`, `duplicateProject(id)`; migration of key `autosave`);
- `src/core/editor.ts` (small thumbnail capture without side effects, e.g. `captureThumbnail(size)`);
- `src/ui/ui.ts` (gallery view opened from the logo menu and shown at start when projects exist);
- `src/ui/style.css`, `src/core/i18n.ts`.

**Scope**

- IndexedDB layout: one record per project (`id`, `name`, `updatedAt`, `thumbnail` blob, `snapshot`); bump the IndexedDB schema version with an upgrade that moves the old `autosave` record into the library.
- Thumbnail updated on autosave at most every ~30 s, rendered small (no 2× capture) and without helpers.
- Gallery: grid of cards with thumbnail, name, date; actions open / duplicate / rename / delete (delete asks for confirmation).
- `.babalon` export/import keep working and import creates a new library entry.
- Storage errors show a toast; quota usage shown in the gallery (D5).
- Excluded: cloud sync, sharing.

**Integration with the project**

- Replaces the single "Continue where you left off" button; the project menu gains "All projects".
- P04, P05, P10 store their files inside these project records.

**Minimum pre-integration verification**

Create three projects with different models, reload, open each, duplicate one, delete one; confirm an existing pre-step autosave appears as a project after upgrade.

**Acceptance criteria**

- [ ] After reload the gallery lists all projects with correct thumbnails and dates.
- [ ] Opening a project restores it exactly; editing autosaves only into that project.
- [ ] The previous single autosave is migrated, not lost.
- [ ] Deleting requires confirmation and frees the record.
- [ ] Works at 375 px width with touch.

## Milestone M1 - Reliable editing and many projects

**Proves**

Users can experiment freely (everything undoable) and keep several scenes without losing work.

**Integrated verification**

- Desktop and S24: create two projects, edit materials/lights/environment, undo/redo across all kinds, switch projects, reload, confirm state and thumbnails.
- Open a `.babalon` saved before M1.

**Human approval gate**

- [ ] Evidence reviewed by the user.
- [ ] Approval received before P03 begins.

---

### P03 - Material presets and advanced PBR

**Status:** TODO

**Objective**

Apply ready-made looks (glass, brushed metal, chrome, glossy/matte plastic, rubber, ceramic, fabric/velvet, car paint, gold) in one tap, and tune advanced effects: refraction (glass), sheen (fabric), iridescence, anisotropy.

**Required reading**

- `src/core/presets.ts` (format of shared data);
- `src/ui/ui.ts` — `materialControls()`, `panelParts()`;
- `src/state.ts` from P01 (material capture/apply);
- Babylon `PBRSubSurfaceConfiguration`, `PBRSheenConfiguration`, `PBRIridescenceConfiguration`, `PBRAnisotropicConfiguration` in `node_modules/@babylonjs/core/Materials/PBR/`.

**Target files**

- `src/core/presets.ts` (`MATERIAL_PRESETS`);
- `src/ui/ui.ts` (preset chips at the top of the Material part; "Advanced" section with the new effects);
- `src/state.ts` and `src/core/project.ts` (persist the new fields);
- `src/core/i18n.ts`.

**Scope**

- A preset changes only physical properties, keeps the base-color texture unless the preset says otherwise, and is one undo step.
- Advanced controls appear collapsed by default (one level) and only for `PBRMaterial`.
- Glass uses refraction from the environment; check it renders on phones and costs nothing when unused.
- Excluded: node materials, custom shaders.

**Integration with the project**

- Saved/restored through `src/state.ts`; undo through P01.

**Minimum pre-integration verification**

Apply each preset to the boombox and a primitive; save/reopen; undo; check FPS on the S24 with glass applied.

**Acceptance criteria**

- [ ] Each preset produces a visibly matching material and is undoable in one step.
- [ ] Advanced values persist in projects and old projects are unaffected.
- [ ] Materials without the advanced effects have no rendering cost change (FPS within baseline noise).

---

### P04 - Use your own textures

**Status:** TODO

**Objective**

Replace or add a material's textures (base color, normal, roughness/metal, emission, opacity) with an image file, with tiling and rotation, saved inside the project.

**Required reading**

- `src/ui/ui.ts` — `materialControls()` (texture show/hide logic, `metadata.stashedAlbedo`);
- `src/core/project.ts` — how model files are stored in `ProjectSnapshot.files` and restored;
- `src/state.ts` (P01);
- `src/core/files.ts`.

**Target files**

- `src/core/editor.ts` (`setMaterialTexture(material, slot, file)` keeping the `File` as the source of truth);
- `src/state.ts`, `src/core/project.ts` (texture slots in `MaterialJSON`, files under `textures/`);
- `src/ui/ui.ts` (texture slots with thumbnail, replace, remove, tiling U/V, rotation), `src/core/i18n.ts`.

**Scope**

- Accept PNG/JPEG/WebP/KTX2; large images are downscaled on phones following P06's limits when available (otherwise a max size constant).
- Removing a user texture restores the model's original one.
- Every change undoable (P01).
- Excluded: painting on textures, UV editing.

**Integration with the project**

- Stored like model assets; restored before materials are applied in `restore()`.

**Minimum pre-integration verification**

Replace the boombox base color and normal map, tile a primitive, save, clear the browser data for the site except the exported `.babalon`, reopen it.

**Acceptance criteria**

- [ ] Replaced textures render and survive save → reopen and `.babalon` export → import.
- [ ] Removing a replacement restores the original texture.
- [ ] Undo/redo works for each texture change.

---

### P05 - Use your own environments (HDR)

**Status:** TODO

**Objective**

Load an `.hdr`, `.exr` or `.env` file as the environment lighting and background, saved inside the project.

**Required reading**

- `src/core/editor.ts` — `ENV_PRESETS`, `applyEnv()`, environment/skybox creation, `restoreEnvironmentTexture()` (AR);
- `src/ui/ui.ts` — `envPanel()`;
- Babylon `HDRCubeTexture`, `EXRCubeTexture`, `CubeTexture.CreateFromPrefilteredData` in `node_modules/@babylonjs/core/Materials/Textures/`;
- `src/core/project.ts` (files storage).

**Target files**

- `src/core/editor.ts` (environment source = preset id or project file path);
- `src/core/project.ts`, `src/state.ts` (`env.custom` path, file under `environments/`);
- `src/ui/ui.ts` (custom environment card next to the presets), `src/core/i18n.ts`.

**Scope**

- Equirectangular HDR/EXR are prefiltered on the GPU at load; show progress; cap resolution on phones.
- Rotation, intensity, blur, background toggle keep working; AR restore keeps working.
- Excluded: painting/editing HDRs.

**Integration with the project**

- P10 reuses this path to load library HDRIs.

**Minimum pre-integration verification**

Load a 2K `.hdr` on desktop and the S24, rotate it, enter and exit AR, save and reopen.

**Acceptance criteria**

- [ ] Custom HDR lights the scene and appears as background; rotation/intensity work.
- [ ] Persisted in projects and `.babalon` files; old projects still use presets.
- [ ] After AR, the custom environment is back.

## Milestone M2 - Look development

**Proves**

A scene can look exactly as intended with presets, advanced materials, the user's textures and lighting.

**Integrated verification**

- Build a scene with a glass preset object, a textured primitive and a custom HDR on the S24; take a photo; save, reopen and export/import `.babalon`.

**Human approval gate**

- [ ] Evidence reviewed by the user.
- [ ] Approval received before P06 begins.

---

### P06 - Detect heavy models and protect phones

**Status:** TODO

**Objective**

Before a heavy model can crash or freeze a phone, the app knows its cost (triangles, texture count and size, estimated GPU memory) and warns with a clear choice.

**Required reading**

- `src/core/editor.ts` — `loadAsset()`, `loadModel()`, `instantiate()`, `stats()`;
- `docs/baseline.md` (P00);
- `src/ui/ui.ts` — `loadFiles()`, toasts, `objectSection()` stats.

**Target files**

- `src/optimize.ts` (new: `analyzeContainer(container)` and device budget from `navigator.deviceMemory`, max texture size and pointer type);
- `src/core/editor.ts` (call analysis before instantiating; expose the report);
- `src/ui/ui.ts` (warning dialog: load anyway / optimize (P07) / cancel), `src/core/i18n.ts`.

**Scope**

- Analysis is lossless and automatic; nothing is changed without the user's choice.
- Budgets differ for phones and desktops and are documented in `src/optimize.ts`.
- Excluded: changing the model (P07).

**Integration with the project**

- Feeds P07; P04/P10 reuse the texture size limits.

**Minimum pre-integration verification**

Import a heavy glTF (≥1 M triangles or 8K textures) on desktop and the S24 and check the reported numbers against Babylon's inspector values.

**Acceptance criteria**

- [ ] Heavy models show the warning before being added; light models load as before.
- [ ] Reported triangle and texture numbers match the model.
- [ ] Cancel leaves the scene unchanged and frees memory.

---

### P07 - Optimize heavy models on import

**Status:** TODO

**Objective**

"Optimize" makes a heavy model fit the device: downscale oversized textures and optionally reduce triangles, with a before/after summary.

**Required reading**

- `src/optimize.ts` (P06);
- Babylon `Meshes/meshSimplification.d.ts` (`simplify`, `SimplificationQueue`);
- decision D2;
- `src/core/project.ts` (what is stored: originals vs optimized).

**Target files**

- `src/optimize.ts` (texture downscale via canvas/GPU, decimation per D2);
- `src/core/editor.ts`, `src/ui/ui.ts`, `src/core/i18n.ts`;
- `package.json` only if D2 chooses a dependency.

**Scope**

- Texture downscale to the device budget (lossy, opt-in).
- Decimation with a target ratio, skipped for skinned/animated meshes unless supported.
- Project stores the optimized result (so reopening on the phone is fast) and keeps a note of the original; decision whether to keep originals is part of D2/D5.
- Runs off the main thread where possible; shows progress; can be cancelled.

**Integration with the project**

- Uses P06 analysis; respects undo (adding the optimized model is one step).

**Minimum pre-integration verification**

Optimize the P00 heavy model on the S24; compare FPS, memory and visual result with the baseline.

**Acceptance criteria**

- [ ] The heavy model that failed or stuttered in P00 loads and orbits smoothly after optimizing.
- [ ] Animated models still animate after optimization (or decimation is skipped with a note).
- [ ] The before/after summary matches the result.

---

### P08 - Smaller, faster startup

**Status:** TODO

**Objective**

The app shows its first frame noticeably faster on phones by shipping less JavaScript up front, with identical behavior.

**Required reading**

- `vite.config.ts`; `package.json`;
- every `import … from '@babylonjs/core'` in `src/*.ts`;
- `src/main.ts` (what starts eagerly: AR, gyro, system bars, files);
- `docs/baseline.md`.

**Target files**

- `src/*.ts` (deep imports of the Babylon modules actually used; dynamic `import()` for `src/ar/ar.ts`, `src/ar/arHud.ts`, GLB/USDZ serializers, `src/tools/tools.ts` visuals if separable, `src/video.ts`, `src/library.ts`);
- `vite.config.ts` (chunking, precache list).

**Scope**

- Behavior identical; every feature still works offline after the first full load (precache adjusted, lazy chunks cached at runtime).
- Measure: main chunk size, startup time on the S24 against P00.
- Excluded: switching to WebGPU, replacing Babylon.

**Integration with the project**

- Later steps (P09, P10, P11–P15) add their code as lazy chunks by default.

**Minimum pre-integration verification**

`npm run build` sizes; full manual pass of features (add, edit, tools, photo, AR on the S24, export) on the production preview and offline.

**Acceptance criteria**

- [ ] Main chunk and first-frame time improved versus `docs/baseline.md` (numbers recorded).
- [ ] No feature regressions in the manual pass, including offline use after one online visit.
- [ ] Missing side-effect registrations are caught (no runtime "not found" errors in the console).

---

### P09 - Video export

**Status:** TODO

**Objective**

Record short videos with the photo look: turntable (camera circles the pivot), turntable of the selected object, and a gentle orbit sway; choose duration, aspect and quality; save with share.

**Required reading**

- `src/core/editor.ts` — `capture()` (crop, helpers hidden), `photoMode`, camera tween, `needsRender()`, `invalidate()`;
- `src/ui/ui.ts` — photo HUD (`renderPhotoHud()`), `deliver()`;
- `src/core/files.ts` — `saveAndOfferShare()`, `timestampedName()`;
- decision D1.

**Target files**

- `src/video.ts` (new: camera paths and recorder: `canvas.captureStream` → crop canvas → `MediaRecorder` per D1);
- `src/core/editor.ts` (force continuous rendering while recording);
- `src/ui/ui.ts` (record control in photo mode with progress and stop), `src/core/i18n.ts`, `src/ui/style.css`.

**Scope**

- Duration presets (e.g. 4/8/12 s), aspect from the current photo frame, fps 30.
- Recording renders at a fixed time step so speed is correct even if the device drops frames; shows progress; can be cancelled.
- Output format per D1; file saved with Share offered.
- Excluded: saved views / keyframed paths (excluded by the user), audio.

**Integration with the project**

- Lazy-loaded (P08). Uses the existing photo settings and aspect.

**Minimum pre-integration verification**

Record an 8 s turntable on desktop and the S24 in 1:1 and 9:16; play the files on the phone and share one to another app.

**Acceptance criteria**

- [ ] Videos play at the right duration and speed, with the photo effects and aspect.
- [ ] UI and helpers never appear in the video.
- [ ] Rendering returns to on-demand after recording (idle frames back to 0).

## Milestone M3 - Phones and output

**Proves**

Heavy content is safe on phones, the app starts faster, and scenes can be exported as video.

**Integrated verification**

- On the S24: cold start timed against P00; import and optimize the heavy model; record and share a turntable; check idle rendering stops after recording.

**Human approval gate**

- [ ] Evidence reviewed by the user.
- [ ] Approval received before P10 begins.

---

### P10 - CC0 asset library (Poly Haven)

**Status:** TODO

**Objective**

Browse and add Poly Haven HDRIs and models from inside the app (search, categories, thumbnails, resolution choice), with license info kept in the project.

**Required reading**

- decisions D3 and D4;
- Poly Haven public API documentation (assets list, files per asset, thumbnails) — verify endpoints, CORS and terms before coding;
- `src/core/editor.ts` — `addFromUrl()`, `loadAsset()`, custom environment path from P05;
- `src/ui/ui.ts` — `addPanel()`, `envPanel()`, `panelParts()`;
- `src/optimize.ts` (P06 budgets for resolution choice).

**Target files**

- `src/library.ts` (new: read-only client with caching of the index);
- `src/ui/ui.ts` (Library part in Add and in Environment), `src/core/project.ts` (source + license per asset, embed per D4), `src/core/i18n.ts`, `src/ui/style.css`;
- `vite.config.ts` (runtime caching rule for the library host).

**Scope**

- Default resolution chosen from the device budget (smaller on phones).
- Offline: previously used items work from cache; the library shows an offline message otherwise.
- Attribution shown in the item card and stored in the project.
- Excluded: uploading, accounts, other providers (can be added later through the same client interface).

**Integration with the project**

- HDRIs go through P05; models through the existing import + P06 analysis.

**Minimum pre-integration verification**

Search and add one HDRI and one model on desktop and the S24; save, reopen online and offline.

**Acceptance criteria**

- [ ] Items can be found, previewed and added; HDRIs light the scene.
- [ ] Source and license are visible and saved with the project.
- [ ] Offline behavior matches D4.

---

### P11 - Keep AR scenes fixed to the real world (anchors)

**Status:** TODO

**Objective**

After placing, the scene is attached to an ARCore anchor so it doesn't drift when tracking is refined.

**Required reading**

- `src/ar/ar.ts` — `enter()`, `wrapScene()`, `placeAt()`, `applyTransform()`, cleanup;
- Babylon `XR/features/WebXRAnchorSystem.d.ts`.

**Target files**

- `src/ar/ar.ts`, `src/ar/arHud.ts` (status only if needed).

**Scope**

- Anchor requested optionally at session start (detached by default per AGENTS.md if it has a cost; otherwise attached when placing).
- Moving/rotating/scaling the scene updates the anchor; "move the scene" creates a new anchor.
- Falls back to current behavior when anchors are unsupported.

**Integration with the project**

- Prerequisite for P12 (measurements must not drift).

**Minimum pre-integration verification**

On the S24: place the scene, walk around the room for a minute, return; compare drift with and without anchors.

**Acceptance criteria**

- [ ] Visibly less drift with anchors than before.
- [ ] No regression when the feature is unavailable.

---

### P12 - Measure real things in AR

**Status:** TODO

**Objective**

In AR, tap two real-world points (detected surfaces) to measure real distances, using the same measurement visuals, units and labels as the editor.

**Required reading**

- `src/tools/tools.ts` — `Measurement`, anchors, `format()`, labels;
- `src/ar/ar.ts` — hit test, `lastHit`, `setHitTest()`;
- `src/ar/arHud.ts` — options panel and gestures;
- `src/ui/ui.ts` — `updateLabels()` (labels are in the main DOM; AR needs them in the overlay).

**Target files**

- `src/tools/tools.ts` (measurement anchors in world space for AR), `src/ar/ar.ts`, `src/ar/arHud.ts`, `src/core/i18n.ts`.

**Scope**

- AR measure mode toggled from the overlay; hit test re-attached while measuring.
- Labels rendered inside the AR overlay (only element visible in XR).
- Real measurements are discarded on AR exit (not saved into the scene) unless a later decision says otherwise.

**Integration with the project**

- Reuses the editor's measurement code (no second implementation).

**Minimum pre-integration verification**

Measure a known object (e.g. 1 m tape) on the S24; compare.

**Acceptance criteria**

- [ ] Measuring a known 1 m length reads within a few centimeters.
- [ ] Units follow the editor setting; leaving AR leaves the editor unchanged.

---

### P13 - Real objects hide virtual ones (occlusion)

**Status:** TODO

**Objective**

Optional AR depth occlusion: real objects in front of the virtual scene hide it.

**Required reading**

- `src/ar/ar.ts` (feature enabling pattern, options);
- Babylon `XR/features/WebXRDepthSensing.d.ts` (`DEPTH_SENSING`);
- `src/ar/arHud.ts` options panel.

**Target files**

- `src/ar/ar.ts`, `src/ar/arHud.ts`, `src/core/i18n.ts`.

**Scope**

- Off by default, marked as heavier; hidden when unsupported.
- Excluded: depth-based physics.

**Integration with the project**

- Same options panel and FPS counter.

**Minimum pre-integration verification**

On the S24: place the scene behind a chair; toggle occlusion; check FPS.

**Acceptance criteria**

- [ ] With occlusion on, a real object in front hides the virtual one.
- [ ] Off by default; no cost when off.

---

### P14 - Camera mode with lens choice

**Status:** TODO

**Objective**

A non-tracked camera mode: the live camera image is the background and the 3D scene is composed on top with the normal editor camera and all photo effects; the user can pick among the phone's rear lenses (main, ultra-wide, telephoto) where the browser exposes them.

**Required reading**

- decision D6 (device probe results);
- `src/core/editor.ts` — clear color/background handling, `capture()`, photo pipeline;
- `src/ar/ar.ts` — how AR composes camera + 3D in photos (`capture()`), for reuse of the compositing approach;
- `src/ui/ui.ts` — mode switch (`segmented` in `renderTopbar()`), photo HUD;
- `src/device/gyro.ts` (useful combination: gyro + camera background).

**Target files**

- `src/cameraMode.ts` (new: `getUserMedia`, `enumerateDevices`, lens list, `zoom` capability, stream lifecycle);
- `src/core/editor.ts` (transparent background while active), `src/ui/ui.ts` (entry in the Photo mode or a fourth mode per decision), `src/core/i18n.ts`, `src/ui/style.css`.

**Scope**

- First sub-step: a probe page/flag that lists cameras, labels and `zoom` capabilities on the S24 (feeds D6).
- Lens choices built from what the device reports: separate rear `deviceId`s and/or `zoom` values below/above 1 on a logical camera; unknown devices show a plain "switch camera".
- Photos composite the camera frame with the 3D render (same pipeline as photo mode, so effects apply).
- Works on iPhone (no WebXR needed); asks for camera permission only when entered.
- Excluded: tracking (that's AR).

**Integration with the project**

- Reuses photo mode, gyro mode and the photo save/share helpers; lazy-loaded.

**Minimum pre-integration verification**

On the S24: switch between all lenses it exposes, take photos with filters; on desktop with a webcam, basic flow.

**Acceptance criteria**

- [ ] Every rear lens the browser exposes on the S24 can be selected; the list is honest on devices that expose fewer.
- [ ] Photos contain camera image + 3D with the photo effects.
- [ ] Leaving the mode stops the camera (indicator off) and restores the background.

---

### P15 - AR on iPhone (USDZ + AR Quick Look)

**Status:** TODO

**Objective**

On iPhone/iPad, an "AR" action opens the current scene in Apple's AR Quick Look.

**Required reading**

- `node_modules/@babylonjs/serializers/USDZ/usdzExporter.d.ts` (`USDZExportAsync`, `fflateUrl`);
- `src/core/editor.ts` — `exportGLB()` (node filtering of helpers/overlays to reuse);
- `src/ui/ui.ts` — mode switch / AR availability.

**Target files**

- `src/quicklook.ts` (new) or `src/ar/ar.ts`, `src/ui/ui.ts`, `src/core/i18n.ts`.

**Scope**

- Export with helpers excluded; fflate loaded locally (not from a CDN) if the option allows.
- Opened through an `<a rel="ar">` link to the generated file.
- Materials outside USDZ's support are simplified; tell the user what changes.
- Shown only on iOS Safari where Quick Look exists.

**Integration with the project**

- The AR mode entry shows on iOS too, routed to Quick Look.

**Minimum pre-integration verification**

Export a scene and open it on an iPhone (needs a user device).

**Acceptance criteria**

- [ ] On iPhone the scene opens in Quick Look at the right scale.
- [ ] No change on Android/desktop.

## Milestone M4 - Library and AR

**Proves**

Content can come from a built-in library, AR stays fixed and can measure real things, the camera mode works with the phone's lenses, and iPhone users get AR.

**Integrated verification**

- S24: add a library HDRI and model, enter AR, place with anchor, measure a real object, toggle occlusion; switch lenses in camera mode and take photos.
- iPhone: open a scene in Quick Look.

**Human approval gate**

- [ ] Evidence reviewed by the user.
- [ ] Approval received before P16 begins.

---

### P16 - Accessibility pass

**Status:** TODO

**Objective**

The editor is usable with a keyboard and a screen reader for its main flows, respects reduced motion, and meets contrast guidance.

**Required reading**

- `src/ui/dom.ts` (all components);
- `src/ui/ui.ts` (menus, panels, toasts, dock, selection bar);
- `src/ui/style.css` (focus styles, colors);
- `src/core/editor.ts` (camera tweens and flashes for reduced motion).

**Target files**

- `src/ui/dom.ts`, `src/ui/ui.ts`, `src/ui/style.css`, `src/core/editor.ts`, `src/core/i18n.ts`.

**Scope**

- Visible focus on every control; menus and segmented controls navigable with arrows/Escape; focus returns to the trigger.
- Toasts announced (`aria-live`); panels labelled; dock as tabs.
- `prefers-reduced-motion`: no camera tweens/flash.
- Contrast of muted text and controls checked against WCAG AA on the glass backgrounds.
- Excluded: making the 3D viewport itself screen-reader navigable beyond the object list.

**Integration with the project**

- Done in components so every screen benefits (DRY).

**Minimum pre-integration verification**

Keyboard-only run: add a model, select it from the list, change a material, open the project menu, save. Screen reader spot check (TalkBack on the S24, NVDA/Narrator on desktop).

**Acceptance criteria**

- [ ] The keyboard-only run completes without a mouse.
- [ ] Reduced motion removes tweens and flashes.
- [ ] Contrast issues found are fixed or listed with reasons.

---

### P17 - Play Store app (TWA)

**Status:** TODO

**Objective**

An Android app on the Play Store that opens the published PWA full screen (Trusted Web Activity), keeping updates from the site.

**Required reading**

- decision D7;
- `vite.config.ts` (manifest, icons, share target, file handlers);
- `.github/workflows/deploy.yml`;
- Bubblewrap and Digital Asset Links documentation.

**Target files**

- `twa/` (Bubblewrap project, signing config kept out of git);
- `assetlinks.json` in the location chosen in D7;
- `README.md` (release steps).

**Scope**

- Package name, icons and splash from the existing manifest assets.
- Verified Digital Asset Links so the browser bar is hidden.
- Signing key and Play account handled by the user; never committed.
- Excluded: native features beyond the PWA.

**Integration with the project**

- The site remains the single source; the app updates with the site.

**Minimum pre-integration verification**

Install the generated APK/AAB on the S24 via internal testing; confirm full screen (no URL bar), AR, share target and offline.

**Acceptance criteria**

- [ ] The app opens without the browser bar (asset links verified).
- [ ] AR, file sharing into the app and offline work inside the app.
- [ ] Signing material is not in the repository.

## Milestone M5 - Accessible and distributed

**Proves**

The app is usable beyond touch and mouse, and installable from the Play Store.

**Integrated verification**

- Keyboard-only and TalkBack runs; Play internal-testing install on the S24.

**Human approval gate**

- [ ] Evidence reviewed by the user.
- [ ] Approval received before public release.

## 7. Final integrated validation

- **Primary flow (S24 and desktop):** open the gallery → new project → add a library model (optimized if heavy) and an own-texture primitive → material preset + advanced glass → custom or library HDR → light preset → undo/redo across all edit kinds → photo with filter → turntable video → AR with anchor, measure a real object → camera mode with another lens → save → reload → reopen.
- **Compatibility:** projects saved at `023885a` (before this plan) open correctly at the end.
- **Failure/recovery:** storage quota full (toast, scene kept); network off (library message, cached items still usable); camera/AR permission denied (clear message, no stuck state); cancelling optimization and recording.
- **Performance:** idle rendering at 0 frames after every new feature; startup and FPS compared to `docs/baseline.md`.
- **Security/privacy:** no new network destinations besides the documented library host; camera stops when leaving camera mode; no secrets or signing keys in git.
- **Rollout:** each milestone deploys through GitHub Pages; rollback is reverting the milestone's commits.

## 8. Execution tracking

| Step | Status | Evidence / commit | Human approval | Notes |
|---|---|---|---|---|
| P00 | TODO | | [ ] | Baseline measurements |
| P01 | TODO | | [ ] | Undo for everything |
| P02 | TODO | | [ ] | Project gallery — Milestone M1, needs D5 |
| P03 | TODO | | [ ] | Material presets + advanced PBR |
| P04 | TODO | | [ ] | Own textures |
| P05 | TODO | | [ ] | Own HDR environments — Milestone M2 |
| P06 | TODO | | [ ] | Heavy model detection |
| P07 | TODO | | [ ] | Model optimization — needs D2 |
| P08 | TODO | | [ ] | Smaller startup |
| P09 | TODO | | [ ] | Video export — Milestone M3, needs D1 |
| P10 | TODO | | [ ] | Poly Haven library — needs D3, D4 |
| P11 | TODO | | [ ] | AR anchors |
| P12 | TODO | | [ ] | Measure real things in AR |
| P13 | TODO | | [ ] | AR occlusion |
| P14 | TODO | | [ ] | Camera mode with lens choice — needs D6 |
| P15 | TODO | | [ ] | iPhone Quick Look — Milestone M4 |
| P16 | TODO | | [ ] | Accessibility |
| P17 | TODO | | [ ] | Play Store (TWA) — Milestone M5, needs D7 |
