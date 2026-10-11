# babalon JS — model optimization implementation plan

## 1. Purpose and boundaries

**Outcome.** A model optimization system that makes heavy models usable everywhere — in the editor, in AR on phones, when rigging and when exporting — without giving up visual quality the user didn't agree to lose:

- know what a model costs (triangles, vertices, texture memory) and whether it fits the device;
- reduce triangles with the best available algorithm while keeping UVs, normals and skin weights valid, so textures stay at full quality;
- keep the original: optimization is a reversible, saved variant of a model, never a destructive edit;
- levels of detail chosen automatically by screen size, and an explicit "optimized for AR" choice on phones;
- smaller, GPU-friendly textures (compressed, optionally downscaled);
- rigging and weight computation on reduced geometry (minutes → seconds on dense meshes);
- surface detail preserved by baking a normal map from the original;
- compact GLB export.

**Free software only.** Code stays GPL-3.0-or-later. New dependencies must be MIT/BSD/Apache-2.0 (GPL-compatible) and listed in the README license paragraph. Everything runs locally in the browser; no upload to any service.

**Excluded.** Remeshing into new topology (voxel/quad remesh, Instant Meshes), Nanite-style cluster LOD, gaussian splats (not meshes), automatic UV unwrapping, server-side processing.

**Governing documents.** `AGENTS.md` (the cheapest thing by default, never trade image quality without an explicit option, render on demand, touch first, one-level UI, i18n, undo, persistence, verification, git). This plan **replaces roadmap steps P06 (detect heavy models) and P07 (optimize on import)** in `roadmap_implementation_plan.md`; P08 (lazy loading) still applies to the new code.

**Execution rules.** Steps in order; the user validates locally before any commit; commit/push only when asked, never with AI attribution; human gates must be approved before continuing.

## 2. Verified current state

- **Dependencies** (`package.json`): `@babylonjs/core`, `loaders`, `materials`, `serializers` 9.30, `fflate`, `lucide`. No simplification or texture-encoding library.
- **Babylon's own simplifier** exists (`node_modules/@babylonjs/core/Meshes/meshSimplification.*`, `mesh.simplify`): a quadratic-error decimator without seam locking or attribute-aware error; not suitable for textured or skinned models.
- **meshoptimizer** (npm `meshoptimizer` 1.3.0, MIT): attribute-aware quadric simplification (`simplifyWithAttributes`), border/seam locking, sloppy mode for extreme ratios, vertex-cache/fetch optimization, WASM build usable in workers. Babylon already ships its *decoder* (`@babylonjs/core/assets/meshopt/meshopt_decoder.js`) for `EXT_meshopt_compression` files.
- **glTF-Transform** (npm `@gltf-transform/functions` 4.5.1, MIT): document-level glTF processing (weld, prune, meshopt compression, texture steps); usable in the browser for export post-processing.
- **Measured on the user's 1,010,635-vertex model** (desktop, dev server): rendering 5.2 ms/frame static vs 6.2 ms/frame rigged; binding a rig with envelope weights takes **93.6 s** (`src/rigging/rigging.ts` `computeWeights()` → `src/rigging/weights.worker.ts`). The three-copy treatment comparison triples the skinned geometry. AR on the phone stutters with such scenes; the AR code itself (`src/ar/ar.ts`) is unchanged since `main`.
- **Reusable foundations:**
  - `src/core/editor.ts` — `loadAsset()`, `instantiate()`, `stats(entity)`, `materialsOf()`, `exportGLB()` (`GLTF2Export.GLBAsync`), `record()` for undo, `ModelSource` (container + asset);
  - `src/rigging/rigging.ts` — non-destructive geometry swap pattern (`makeGeometryUnique`, geometry backups, `applyToMesh` for undo/redo) and binary side files in projects (`serialize()` → `rigs/<n>.bin`);
  - `src/rigging/weights.worker.ts` — worker pattern with progress/cancel and a vertex-clustered proxy for heat weights;
  - `src/rigging/deformationMap.ts` — before/after visualization pattern;
  - `src/core/project.ts` — assets in `assets/<id>/`, optional fields, `VERSION` unchanged for additive data;
  - `src/ui/panels/objects.ts` — Object part (stats line, object settings); `src/ui/dom.ts` (`slider`, `chips`, `segmented`, `stepper`, `progressBar`).

## 3. Target architecture

| Responsibility | Where |
| --- | --- |
| Cost analysis, device budgets | new `src/optimize/analysis.ts` (pure, no UI) |
| Simplification engine (meshoptimizer WASM) | new `src/optimize/simplify.ts` (main-thread API) + `src/optimize/simplify.worker.ts` |
| Optimized variants on entities (apply, revert, undo, duplicate) | new `src/optimize/optimizer.ts` (`ModelOptimizer`, used by `editor.ts` like `Rigger`) |
| Levels of detail | `src/optimize/lod.ts` |
| Texture compression / downscale | new `src/optimize/textures.ts` + `src/optimize/textures.worker.ts` |
| Normal map baking | new `src/optimize/bake.ts` (+ worker or GPU pass per D4) |
| Optimized export | `src/core/editor.ts` `exportGLB()` + post-process per D5 |
| UI | new `src/ui/panels/optimize.ts` (section in Objects → Object, no new top-level button); AR offer in `src/ui/ui.ts` / `src/ar/arHud.ts` |
| Persistence | `src/core/project.ts` (settings + binary results in `optimized/`) |

Boundaries: `src/optimize/` never touches the DOM; heavy work runs in workers with progress and cancel; the original geometry and textures are always kept in memory and in projects.

## 4. Cross-cutting contracts and invariants

- **Non-destructive.** An optimized variant references the original asset; reverting restores the original geometry/textures exactly. Optimization is one undo step.
- **Subset simplification.** The simplifier only removes vertices (meshoptimizer keeps original vertex positions), so UVs, normals, colors, skin indices/weights of kept vertices remain valid. Result per mesh = new index buffer (+ optional compacted vertex set).
- **Seams and borders.** UV seams, normal seams and open borders are locked by default; "sloppy" mode is never the default.
- **Quality is explicit.** Nothing is reduced automatically. Defaults may *offer* an optimization (heavy model, AR on a phone), never apply one silently. Texture downscale is a separate, explicit choice; lossless-looking texture compression (UASTC) is the default when compression is on.
- **Error is reported.** Every result shows triangles before/after and the simplifier's error as a percentage of the model size.
- **Determinism.** Same input + settings → same output (needed for saved results and duplicates).
- **Projects.** New fields optional; older projects open unchanged; results stored as binary side files like rig weights.
- **Performance.** WASM and encoders load lazily (not in the startup bundle, not precached); workers for anything over ~50 ms.
- **Licenses.** Any new dependency is recorded in the README license paragraph; no bundled third-party assets.

### Open decisions

| ID | Decision | Needed before |
| --- | --- | --- |
| D1 | Simplifier: meshoptimizer (recommended) vs Babylon `simplify` | O02 |
| D2 | Texture encoder: Basis Universal WASM (Apache-2.0) vs KTX-Software `libktx` WASM; default mode (UASTC vs ETC1S) | O08 |
| D3 | Store optimized index buffers in projects (fast, exact) vs recompute on open (smaller files) | O05 |
| D4 | Normal baking on CPU (BVH ray casts in a worker) vs GPU (render-to-texture) | O10 |
| D5 | Export post-processing with glTF-Transform (meshopt compression, KTX2) vs Babylon serializer only | O11 |
| D6 | Morph targets: block simplification, or treat morph deltas as attributes | O02 |
| D7 | Device budgets (triangles, texture memory) for phones and desktops | O01 |

## 5. Implementation steps

### O00 - Verify the simplifier and measure baselines

**Status:** VERIFIED

**Objective**

Know how meshoptimizer behaves in this app (speed, quality, seam and skin preservation) on real models, and record the baseline cost of heavy scenes on desktop and the S24.

**Required reading**

- meshoptimizer README (simplification section, `simplifyWithAttributes`, lock flags, `getScale`) and its JS/WASM package;
- `src/rigging/weights.worker.ts` (worker and proxy patterns);
- `src/core/editor.ts` — `stats()`, `loadAsset()`;
- `src/ar/ar.ts` (what runs per frame in AR).

**Target files**

- `docs/model_optimization.md` (findings: timings, quality notes, seam behavior, skinned-model behavior, baseline FPS/memory);
- a scratch test page or Node script (not shipped).

**Scope**

- Simplify the user's dense model (≈1 M vertices), the Mannequin (skinned), HVGirl (skinned, animated) and a textured prop to 50 %, 20 %, 5 % triangles; time it in a worker; look for UV seam tears and skin artifacts.
- Baseline on the S24: editor orbit FPS and AR FPS with one dense model and with the comparison (three copies).
- No product code.

**Integration with the project**

- Feeds D1, D6, D7 and every later step.

**Minimum pre-integration verification**

Side-by-side screenshots (original / 20 % / 5 %) with textures, and timing table.

**Acceptance criteria**

- [ ] Timing and error for each model and ratio recorded.
- [ ] Textures show no visible seam tears at 20 % on the test models.
- [ ] A simplified skinned model still animates correctly.
- [ ] Baseline FPS on the S24 recorded for editor and AR.

## Milestone M0 - Engine approved

**Proves**

The chosen simplifier keeps textures and skins intact at useful ratios, within acceptable time.

**Integrated verification**

- `docs/model_optimization.md` reviewed with screenshots and timings.

**Human approval gate**

- [ ] D1, D6, D7 decided.
- [ ] Approval received before O01.

---

### O01 - Model cost analysis and device budgets

**Status:** VERIFIED

**Objective**

Every model shows what it costs (triangles, vertices, textures and their GPU memory) and whether it fits this device; heavy models get a clear notice on load with the choice to optimize.

**Required reading**

- `src/core/editor.ts` — `loadModel()`, `instantiate()`, `stats()`;
- `src/ui/panels/objects.ts` (stats line), `src/ui/ui.ts` (`toast`, `loadFiles()`);
- D7.

**Target files**

- `src/optimize/analysis.ts` (`analyzeEntity()`, `deviceBudget()` from pointer type, `navigator.deviceMemory`, max texture size);
- `src/core/editor.ts` (expose the analysis), `src/ui/panels/objects.ts`, `src/core/i18n.ts`.

**Scope**

- Texture memory estimate includes mipmaps and format (RGBA8 vs compressed).
- Notice on load only above the budget; light models load exactly as before.
- Excluded: changing anything (O02+).

**Integration with the project**

- Feeds the Optimize tool (O04), LOD defaults (O06) and the AR offer (O07).

**Minimum pre-integration verification**

Compare reported numbers with Babylon's inspector for three models.

**Acceptance criteria**

- [ ] Numbers match the model (triangles exact, texture sizes exact).
- [ ] Heavy models show the notice; light models don't.
- [ ] No cost when nothing is heavy (analysis runs once per load).

---

### O02 - Simplification engine in a worker

**Status:** VERIFIED

**Objective**

A pure engine that reduces a set of meshes to a target (ratio or error) with meshoptimizer, preserving UVs, normals, colors and skin data, off the main thread, with progress and cancel.

**Required reading**

- `docs/model_optimization.md` (O00);
- `src/rigging/weights.ts` / `weights.worker.ts` (worker contract, cancel, progress);
- meshoptimizer `simplifyWithAttributes`, lock flags, `optimizeVertexCache`/`optimizeVertexFetch`;
- D1, D6.

**Target files**

- `src/optimize/simplify.ts` (API: `simplifyMeshes(input, settings, onProgress) → { job, promise }`), `src/optimize/simplify.worker.ts`;
- `package.json` (`meshoptimizer`);
- `scripts/check-simplify.mjs` (focused check in Node).

**Scope**

- Input per mesh: positions, normals, UV sets, colors, skin indices/weights, indices; attribute weights tuned so UV and normal seams stay put.
- Output per mesh: new index buffer and achieved error; optional vertex compaction (remap) for memory.
- Settings: target ratio or target error, lock borders (default on), sloppy (off).
- Morph targets per D6.
- Excluded: applying to the scene (O03).

**Integration with the project**

- Used by O03 (variants), O06 (LODs), O09 (rigging proxy).

**Minimum pre-integration verification**

`scripts/check-simplify.mjs`: triangle counts within tolerance of the target, every output index refers to an input vertex, seam vertices kept, deterministic output for the same input.

**Acceptance criteria**

- [ ] The dense model reduces to 10 % in a few seconds on desktop without blocking the UI; cancel stops it.
- [ ] Output is identical for identical input and settings.
- [ ] Skin data of kept vertices is untouched.

---

### O03 - Optimized variants on models (non-destructive)

**Status:** VERIFIED

**Objective**

A model can switch to an optimized variant and back, exactly, with undo; duplicates keep the variant; animation, posing and rigging keep working.

**Required reading**

- `src/rigging/rigging.ts` — geometry backup/swap (`build()`, `unbind()`, `rebind()`);
- `src/core/editor.ts` — `duplicate()`, `record()`, `refreshShadowCasters()`;
- `src/optimize/simplify.ts` (O02).

**Target files**

- `src/optimize/optimizer.ts` (`ModelOptimizer`: `apply(entity, settings)`, `revert(entity)`, `copy(from, to)`);
- `src/core/editor.ts` (`readonly optimizer`), `Entity.optimization?: { settings, stats }`.

**Scope**

- Each mesh gets its own geometry for the variant; the original geometry is kept for revert.
- Skinned meshes keep their skeleton; animations and poses continue.
- Rigged-in-app models: rig and variant must agree (a rig made on the original keeps working because vertices are a subset).
- Excluded: UI (O04), saving (O05).

**Integration with the project**

- Undo is one step; shadows refreshed; render invalidated.

**Minimum pre-integration verification**

Apply and revert on the dense model, the Mannequin (playing a clip) and a textured prop; compare vertex buffers after revert with the original.

**Acceptance criteria**

- [ ] Revert restores the original exactly.
- [ ] Clips, poses and rigs keep working on the variant.
- [ ] Undo/redo and duplicate behave like other edits.

---

### O04 - Optimize tool in the interface

**Status:** VERIFIED

**Objective**

In Objects → Object, an "Optimize" section lets the user pick a preset (High quality / Balanced / Light) or a triangle target, preview before/after, see the numbers and the error, and apply or revert.

**Required reading**

- `AGENTS.md` (interface structure, touch, i18n);
- `src/ui/panels/objects.ts`, `src/ui/panels/rig.ts` (stepper/footer/progress patterns), `src/ui/dom.ts`;
- `src/optimize/optimizer.ts`, `src/optimize/analysis.ts`.

**Target files**

- `src/ui/panels/optimize.ts` (used by the Object part), `src/core/i18n.ts`, `src/ui/style.css`.

**Scope**

- Presets map to target error/ratio (from O00 data); a slider for custom targets.
- Before/after: toggle while holding, numbers (triangles, vertices, texture memory), error as % of size, progress and cancel.
- Phone layout at 375 px; no nested menus.
- Excluded: textures (O08 adds its controls here).

**Integration with the project**

- Reuses `progressBar`, `chips`, `slider`; toasts for results and failures.

**Minimum pre-integration verification**

Optimize the dense model on desktop and phone layout; check numbers and the before/after view.

**Acceptance criteria**

- [ ] One tap on a preset gives a visibly similar model with far fewer triangles.
- [ ] Numbers and error match the result.
- [ ] Revert and undo work from the panel.

---

### O05 - Save optimized variants in projects

**Status:** VERIFIED

**Objective**

Projects reopen with the same optimized variants, quickly and exactly, and older projects open unchanged.

**Required reading**

- `src/core/project.ts` (`entityToJSON`, `restore`, rig `rigs/<n>.bin` precedent);
- `src/rigging/rigging.ts` `serialize()` / `restore()`;
- D3.

**Target files**

- `src/core/project.ts` (`EntityJSON.optimization` + `optimized/<n>.bin`), `src/optimize/optimizer.ts` (serialize/restore).

**Scope**

- Per D3: store index buffers (recommended: indices only, as vertices are a subset) or recompute.
- Missing or mismatched data falls back to recomputing with a message.

**Integration with the project**

- Autosave includes variants; `.babalon` import/export too.

**Minimum pre-integration verification**

Save, reopen, compare index buffers; reopen an older project.

**Acceptance criteria**

- [ ] Variant survives save/reopen and autosave.
- [ ] Opening is fast (no recomputation when data is stored).
- [ ] Older projects open unchanged.

## Milestone M1 - Optimize tool

**Proves**

Heavy models can be optimized and reverted in the app, with saved results, without losing texture quality.

**Integrated verification**

- S24: open the dense model, optimize to Balanced, orbit, take a photo, save, reopen; compare FPS with the O00 baseline.

**Human approval gate**

- [ ] Evidence reviewed by the user.
- [ ] D3 confirmed.
- [ ] Approval received before O06.

---

### O06 - Levels of detail

**Status:** VERIFIED

**Objective**

Optionally, a model gets 2–3 levels of detail that Babylon switches by screen size, so distant or small objects cost less automatically.

**Required reading**

- Babylon `Mesh.addLODLevel`, `useLODScreenCoverage`;
- `src/optimize/optimizer.ts`, `src/optimize/simplify.ts`;
- `src/core/editor.ts` — selection outline, shadows, picking (must work with LOD meshes).

**Target files**

- `src/optimize/lod.ts`, `src/optimize/optimizer.ts`, `src/ui/panels/optimize.ts`, `src/core/project.ts`.

**Scope**

- LODs share materials and skeletons; picking, outline, measurements and export use the highest active level.
- Off by default (opt-in per model, or offered for heavy models).

**Integration with the project**

- Feeds the AR offer (O07).

**Minimum pre-integration verification**

A scene of many copies of a heavy model: FPS with and without LODs; selection and measuring still correct.

**Acceptance criteria**

- [ ] Switching between levels is not distracting at normal viewing distances.
- [ ] Selection, measuring, photos and export behave as before.

---

### O07 - Optimized scenes in AR

**Status:** VERIFIED

**Objective**

Entering AR on a phone with a scene above the budget offers "Use optimized versions in AR"; the choice applies only during the session and AR leaves the editor exactly as it was.

**Required reading**

- `src/ar/ar.ts` (`enter()`, `cleanup()`), `src/ar/arHud.ts`;
- `AGENTS.md` (AR must leave the editor as it found it);
- `src/optimize/analysis.ts`, `src/optimize/optimizer.ts`, `src/optimize/lod.ts`.

**Target files**

- `src/ar/ar.ts`, `src/ui/ui.ts` (offer before entering), `src/core/i18n.ts`.

**Scope**

- Uses existing variants/LODs, or creates a Balanced variant for the session (cached for the next AR entry).
- Remembers the choice for the session; never applied without asking.
- Comparison copies: offer to show only the selected copy in AR.

**Integration with the project**

- No project changes from a session-only variant.

**Minimum pre-integration verification**

S24: dense model and three-copy comparison in AR, FPS with and without the option; after AR, geometry is the original.

**Acceptance criteria**

- [ ] AR is smooth with the option on the scenes that stuttered in O00.
- [ ] Declining keeps today's behavior.
- [ ] After AR, every model is exactly as before.

## Milestone M2 - Heavy scenes on phones

**Proves**

Heavy scenes stay smooth in the editor and in AR on the S24, by the user's choice.

**Integrated verification**

- S24: dense model, LODs on, AR with the offer accepted; FPS and memory against the baseline.

**Human approval gate**

- [ ] Evidence reviewed by the user.
- [ ] Approval received before O08.

---

### O08 - Texture compression and optional downscale

**Status:** VERIFIED

**Objective**

Textures can be compressed to GPU formats (KTX2/Basis) that cut GPU memory 4–8× with no visible loss (UASTC by default), and optionally downscaled to a chosen maximum size.

**Required reading**

- D2; Babylon KTX2 decoding (`KhronosTextureContainer2`) and `ktxTextureLoader`;
- `src/optimize/analysis.ts` (texture memory), `src/core/editor.ts` `materialsOf()`;
- `src/core/project.ts` (assets).

**Target files**

- `src/optimize/textures.ts`, `src/optimize/textures.worker.ts`, `src/ui/panels/optimize.ts`, `src/core/project.ts`, `package.json` per D2.

**Scope**

- Compression keeps the resolution; downscale is a separate explicit control showing the memory saved.
- Normal maps and color textures use appropriate settings (linear vs sRGB).
- Original images kept for revert and export choice.
- Encoder WASM loaded on demand only.

**Integration with the project**

- Texture results stored next to the variant (O05 format).

**Minimum pre-integration verification**

Compare a 4K texture before/after (zoomed screenshots) and GPU memory; time encoding on desktop and S24.

**Acceptance criteria**

- [ ] UASTC result is visually indistinguishable at normal zoom.
- [ ] GPU memory estimate drops accordingly.
- [ ] Downscale only happens when chosen.

---

### O09 - Rigging on reduced geometry

**Status:** VERIFIED

**Objective**

Binding a rig on a dense model takes seconds instead of minutes: weights are computed on a reduced version of the mesh and transferred to every vertex; a model with an optimized variant is rigged on it directly.

**Required reading**

- `src/rigging/rigging.ts` — `skinInput()`, `computeWeights()`, `applyWeights()`;
- `src/rigging/weights.ts`, `src/rigging/weights.worker.ts`, `src/rigging/skinVisibility.ts`;
- `src/optimize/simplify.ts`;
- the 93.6 s measurement (section 2).

**Target files**

- `src/rigging/weights.worker.ts`, `src/rigging/weights.ts`, `src/rigging/rigging.ts`.

**Scope**

- Envelope and heat weights both run on a simplified proxy above a vertex limit; weights transfer back by nearest proxy surface point with smooth interpolation.
- Existing checks (`scripts/check-skin-visibility.mjs`, `check-rig-deformation.mjs`) must still pass on the full mesh.

**Integration with the project**

- Comparison of treatments becomes practical on dense models.

**Minimum pre-integration verification**

`check-rig-deformation.mjs` on the dense model: same arm/trunk isolation as before, bind time measured.

**Acceptance criteria**

- [ ] Binding the dense model takes under 10 s on desktop.
- [ ] Deformation audits show no regression.

## Milestone M3 - Textures and rigging

**Proves**

GPU memory and rigging time are no longer the limit for heavy models.

**Integrated verification**

- S24: dense textured model, compressed textures, rigged on reduced geometry, a library clip in AR.

**Human approval gate**

- [ ] Evidence reviewed by the user.
- [ ] Approval received before O10.

---

### O10 - Normal map baking from the original

**Status:** VERIFIED

**Objective**

An optimized model keeps the look of the original's fine surface detail by baking a tangent-space normal map from the original onto the optimized mesh.

**Required reading**

- D4; Babylon tangent generation and `RenderTargetTexture`;
- `src/optimize/optimizer.ts`, `src/optimize/textures.ts`.

**Target files**

- `src/optimize/bake.ts` (+ `bake.worker.ts` if CPU), `src/ui/panels/optimize.ts`, `src/core/project.ts`.

**Scope**

- Bake resolution chosen by the user (1K–4K); existing normal maps are combined, not replaced.
- Requires non-overlapping UVs; otherwise the option is disabled with a message.

**Integration with the project**

- The baked map is stored with the variant and goes through O08 compression.

**Minimum pre-integration verification**

Dense model at 5 %: screenshots with and without the baked map, against the original.

**Acceptance criteria**

- [ ] Surface detail visibly restored at 5–10 % triangles.
- [ ] No baking seams on UV borders.

---

### O11 - Compact GLB export

**Status:** VERIFIED

**Objective**

Exporting an optimized scene produces a compact GLB (meshopt-compressed geometry, compressed textures when chosen) that opens in other viewers.

**Required reading**

- `src/core/editor.ts` `exportGLB()`; D5;
- glTF-Transform `meshopt()`/texture functions; `EXT_meshopt_compression`, `KHR_texture_basisu`.

**Target files**

- `src/core/editor.ts`, `src/optimize/export.ts`, `package.json` per D5.

**Scope**

- Choice between "Original" and "Optimized" export; rigs, clips and helper bones included.
- Post-processing loaded on demand.

**Integration with the project**

- Uses variants and texture results; nothing changes in the scene.

**Minimum pre-integration verification**

Export the dense optimized model; open in Babylon Sandbox and another viewer; compare file size.

**Acceptance criteria**

- [ ] The GLB opens correctly elsewhere, including skin and animations.
- [ ] Size reduction recorded against the plain export.

## Milestone M4 - Complete optimization

**Proves**

A heavy model can be optimized end to end, keeping its look, and shared as a compact file.

**Integrated verification**

- Flow below on desktop and the S24.

**Human approval gate**

- [ ] Evidence reviewed by the user.
- [ ] Approval received before release.

## 6. Final integrated validation

- **Flow:** import the dense textured model → cost notice → Balanced → compress textures → bake normals → rig on the variant → library clip → AR on the S24 → save → reopen offline → compact GLB export opened elsewhere.
- **Reversibility:** revert at each stage restores the original exactly; undo/redo across all steps.
- **Compatibility:** projects from before this plan open unchanged.
- **Performance:** startup bundle unchanged (WASM/encoders lazy); idle frames 0; workers keep the UI responsive; cancel works everywhere.
- **Licenses:** new dependencies listed; no network calls.
- **Failure cases:** morph targets (per D6), splats (not offered), overlapping UVs (no baking), encoder failure (keeps originals with a message).

## 7. Execution tracking

| Step | Status | Evidence / commit | Human approval | Notes |
|---|---|---|---|---|
| O00 | VERIFIED | Desktop measurements in docs/model_optimization.md; S24 baselines not taken | [ ] | Verify meshoptimizer, baselines — Milestone M0, decides D1, D6, D7 |
| O01 | VERIFIED | Cost section + heavy-model notice; phone notice checked at 375 px | [ ] | Cost analysis and budgets (replaces roadmap P06) |
| O02 | VERIFIED | scripts/check-simplify.mjs; 1.98M → 397k tris, 0.01 % | [ ] | Simplification engine (worker) |
| O03 | VERIFIED | Apply / revert / undo / redo / duplicate in browser | [ ] | Non-destructive variants |
| O04 | VERIFIED | Objects → Optimize, desktop and 375 px | [ ] | Optimize tool UI (with O03 replaces roadmap P07) |
| O05 | VERIFIED | Save/reopen: +1 MB, restore ~1 s | [ ] | Persistence — Milestone M1, needs D3 |
| O06 | VERIFIED | Two LOD levels; excluded from export | [ ] | Levels of detail |
| O07 | VERIFIED | Session copy apply/restore verified in browser; AR on a phone not tested | [ ] | Optimized scenes in AR — Milestone M2 |
| O08 | VERIFIED | 4K: 85.3 → 21.3 MB, ~10 s; WASM runtime-cached | [ ] | Texture compression/downscale — needs D2 |
| O09 | VERIFIED | Envelope binding 90 s → 16 s via cell sampling; deformation audit unchanged | [ ] | Rigging on reduced geometry — Milestone M3 |
| O10 | VERIFIED | 5 % + 2048 px in ~5 s | [ ] | Normal map baking — needs D4 |
| O11 | VERIFIED | Plain 50.3 MB vs compact 25.2 MB; reopens in Babylon | [ ] | Compact GLB export — Milestone M4, needs D5 |
