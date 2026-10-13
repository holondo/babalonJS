# Guidelines for agents

How to work on babalon JS: a touch-friendly 3D scene composer (Babylon.js 9, TypeScript, Vite, plain DOM UI, installable PWA). Read this before changing code. The README describes the product; this file describes how to build it.

## Commands

```bash
npm install
npm run dev        # dev server, http://localhost:5173 (no service worker)
npm run build      # type-check (app + vite config) and production build in dist/
npm run preview    # serves dist/ (the only way to test the PWA / service worker locally)
```

- There is no test runner. Verify every change with `npm run build` and in a browser (see [Verifying changes](#verifying-changes)).
- Project ZIP compatibility and worker checks: `node scripts/check-project-archive.mjs`.
- Rigging has focused checks (Node, no browser): `node scripts/check-leg-junction.mjs`, `check-skin-treatments.mjs`, `check-helper-bones.mjs`, `check-skin-visibility.mjs`. Optimization: `node scripts/check-simplify.mjs`. `node scripts/check-rig-deformation.mjs <model.glb> <envelope|heat> [comparison]` audits final deformation on a model you provide (meshopt-compressed GLB); no model is bundled for it.
- GitHub Pages deploys on every push to `main` (`.github/workflows/deploy.yml`). The build runs with `BASE_PATH=/<repo>/`.

## Code map

`src/` is grouped by domain. `main.ts` (startup wiring) stays at the root.

| Folder | Files | Responsibility |
| --- | --- | --- |
| `core/` | `editor.ts` | Core with no UI: scene, camera, loading, entities, selection, gizmos, lights, shadows, environment, post-processing, capture, export, undo history, render-on-demand, AR scene state |
| | `project.ts` | `.babalon` save/open and browser autosave (IndexedDB) |
| | `projectArchive.ts`, `projectArchive.worker.ts` | On-demand ZIP encoding and decoding in one disposable worker, preserving the existing project format |
| | `presets.ts` | Shared data: lighting presets, photo filters, pose presets, animation library |
| | `files.ts` | Saving, sharing and receiving files (share target) |
| | `i18n.ts` | Translations |
| `ui/` | `ui.ts` | The shell: top bar, dock, selection bar, menus, view controls, panel frame, project actions, autosave, keys |
| | `panels/*.ts` | One class per panel: `add`, `library`, `objects`, `modify`, `material`, `animate`, `pose`, `rig`, `optimize`, `separate` (Mesh mode), `tools`, `light` |
| | `contextBar.ts` | Context bubbles: pills for every active context, the focused one's controls, placement next to or above the dock, dragging |
| | `transformBar.ts`, `modalTransform.ts` | Slider bar for Scale / Rotate; Blender's G / R / S keyboard transform. Both drive the editor's live transform (`beginLive` / `setLive` / `endLive`), for objects or faces |
| | `photo.ts` | Photo mode: its panel, on-screen controls, aspect frame and capture |
| | `measureLabels.ts` | Measurement and guide labels over the 3D view |
| | `jointOverlay.ts` | Joint handles over the 3D view (posing, rigging) |
| | `dom.ts` | Reusable UI components (slider, toggle, chips, segmented, stepper, progress bar, menu item, buttons…) |
| | `shared.ts` | Small helpers and types shared by the UI modules |
| | `style.css` | Theme and layout |
| `animation/` | `animation.ts` | Clip playback per object: play, pause, scrub/freeze, loop, speed, crossfade (with undo) |
| | `motion.ts` | Simple motion for any object (spin, float, pulse, sway) on a child pivot |
| | `pose.ts` | Joint math (world-space rotations, aim, two-bone IK, mirror, character frame) and pose mode (`Poser`) |
| | `retarget.ts` | Playing clips made for another humanoid (`AnimatorAvatar` + rest-pose alignment) and clips added to objects (`ClipManager`) |
| `rigging/` | `humanoid.ts` | Canonical humanoid bones (VRM names), detection from any naming convention, manual mapping, up-to-date world matrices (`worldMatrix`) |
| | `humanoidTemplate.ts`, `rigging.ts` | The standard skeleton (CC0 rig) and manual rigging (`Rigger`) |
| | `bodyLandmarks.ts` | Body landmarks from horizontal sections (leg split, skeleton root, hip pivots) for Find the joints |
| | `weights.ts`, `weights.worker.ts`, `skinMath.ts`, `skinVisibility.ts` | Skin weights: envelope and heat diffusion (in a Web Worker) |
| | `skinTreatments.ts` | Optional treatments where limbs meet the trunk (direct, trunk protection, helper bones) |
| | `deformationMap.ts` | Difference map between rig treatments (final skinned positions) |
| `optimize/` | `analysis.ts` | Model and scene cost (triangles, texture memory) and device budgets |
| | `optimizer.ts`, `simplify.ts`, `simplify.worker.ts` | Triangle reduction (meshoptimizer, in a Web Worker), non-destructive variants, levels of detail, AR session copies (`ModelOptimizer`) |
| | `bake.ts`, `bake.worker.ts` | Normal map baked from the original onto the optimized mesh |
| | `textures.ts`, `textures.worker.ts` | KTX2 compression / downscaling of a model's textures (`TextureOptimizer`) |
| | `export.ts` | Compact GLB export (glTF-Transform, loaded on demand) |
| `edit/` | `selection.ts`, `separate.ts` | Separating a model into objects: face selection (pieces, overlay) and `Separator` (separate mode, triangle subsets, saving) |
| | `lasso.ts`, `smartSelect.ts`, `planeCut.ts` | Lasso and brush (with a software depth buffer for visibility), magic wand and grow/shrink, cutting with a plane |
| | `fuse.ts`, `fuse.worker.ts`, `shrinkwrap.ts` | Operations between objects (Objects → Modify; first selected is the target, the others are tools): boolean union/subtract/intersect (Manifold, in a worker) and live Shrinkwrap |
| | `deform.ts` | In-place vertex edits with partial GPU uploads; `recordDeform` saves one as an undo step |
| `library/` | `polyhaven.ts` | Poly Haven CC0 models and HDRIs: index, downloads, cache for offline use, attribution |
| `capture/` | `camera.ts`, `video.ts` | Live camera as the photo background (lens choice, zoom); turntable and sway videos |
| `ar/` | `ar.ts`, `arHud.ts` | WebXR AR session / its on-camera overlay (anchors, measuring real objects, depth occlusion) |
| `tools/` | `tools.ts` | Measurements (incl. along-the-surface path), guides, smart guides, alignment |
| `device/` | `gyro.ts`, `systemBars.ts` | Gyro mode; status bar / title bar color, desktop title-bar overlay |

Outside `src/`: `vite.config.ts` and `public/share-target.js` (PWA manifest, offline cache, file handlers, share target); `design/` (full-size source artwork, not shipped; `public/icons` and `public/brand` are generated from it); `public/animations`, `public/models` and `scripts/build-animation-library.mjs` (bundled CC0 clips and Mannequins, see `docs/animation_sources.md` and `THIRD_PARTY_LICENSES.md`); `scripts/check-*.mjs` (focused rigging and simplification checks).

Keep these splits:
- `core/editor.ts` must not touch the DOM UI; the UI talks to the editor through its methods and the `changed` observable. Domain modules (`animation/`, `rigging/`, `tools/`, `ar/ar.ts`) follow the same rule.
- A panel is a class in `ui/panels/` that receives the `UI` shell and returns its content; shared state of the shell (current tab, selection bar, toasts, `quiet`, `run`) stays in `ui.ts`. New panels go there too, instead of growing `ui.ts`.

## Principles

### Don't repeat yourself
One implementation per function. Before writing something, look for it:
- UI pieces → `dom.ts` (`slider`, `toggle`, `chips`, `segmented`, `select`, `colorInput`, `numberInput`, `menuItem`, `iconButton`, `button`, `shutterButton`, `flashScreen`). The AR overlay uses the same components as the panels.
- Lighting presets, photo filters, pose presets and the animation library → `presets.ts`. Never copy their values.
- Joint math (rotating joints in world space, IK, mirroring) → `pose.ts`; bone names and detection → `humanoid.ts`. Read world positions through `worldMatrix()`/`jointPosition()`: Babylon caches world matrices and a child only reads its parent's cached one.
- Joint handles on screen → `JointOverlay`.
- Lights and shadows → `createLight` / `createShadowGenerator` in `editor.ts`.
- Saving/sharing files → `files.ts` (`saveAndOfferShare`, `timestampedName`).
- Styles → reuse existing classes (`.ibtn.round`, `.segmented`, `.chips`, `.toggle`…) and CSS variables; add a variant instead of a near-copy.

If you find a duplicate while working, consolidate it.

### The cheapest thing happens by default
Expensive features are opt-in (AR shadows, room lighting, camera access, FPS counter…). Free optimizations (no visible change) are automatic. Never trade image quality for speed without making it an explicit option, and never lower render resolution by default.

### Performance
- The scene renders on demand. Anything that changes what's on screen must go through editor methods that emit `changed`, or call `editor.invalidate()`. Camera motion, animations, loading and AR are detected automatically.
- Worker progress emits `activity`, not persistent scene changes: update the bubbles and progress elements without rendering the scene or scheduling autosave. Emit the domain change when a result is applied.
- Rig, Mesh, Modify and Optimize panels load through the UI feature loader. Keep lightweight shared data out of panel modules so shell imports do not pull those panels into startup.
- No per-frame allocation-heavy work, no GPU readbacks in the render loop (the theme-color sampler is throttled and paused in AR).
- `scene.skipPointerMovePicking` is on: pick explicitly when you need what's under the pointer.
- Rebuild geometry (e.g. lines) only when its data changed.
- Babylon is imported per module, which skips its side effects: a method that silently does nothing (returns `null`, no error) usually needs its registering module (see the comment at the top of `core/editor.ts`). Check the startup bundle when adding one; skip helpers that pull in large modules (Babylon's scene helpers added ≈420 KB for one skybox function).
- Projects store each file once (`project-files` in IndexedDB): autosave only writes the scene and the files whose bytes changed. Generated data (rig weights, optimized geometry, separated parts) is cached per state object so unchanged data isn't rebuilt or rewritten. Keep it that way: never re-create a Blob for unchanged data.
- Panels build costly content (GPU read-backs for thumbnails, big lists) only when it's shown; collapsed sections stay empty.

### Touch first, desktop too
- Every feature must work with fingers on a ~375 px wide phone and with mouse and keyboard on desktop. Check both layouts (phone layout is below 760 px).
- Keep labels on phones (dock, selection bar, mode switch).
- Don't rely on hover. Touch targets ≥ 36 px.
- Sliders must not change while the user scrolls a panel: build them with `slider()` (it applies the touch behavior).
- Gestures: taps on empty space deselect; don't let a stale gizmo/hover state swallow touch taps.

### Interface structure
Keep it uncluttered and at most one level deep:
- Top bar: logo (project menu), undo/redo, Edit / Photo / AR mode switch.
- Dock: Add, Objects, Light, Tools. Long panels split into parts with `segmented` (no nested menus).
- Context bubbles (`ui/contextBar.ts`, like the iPhone's Dynamic Island): everything going on at once (selection, Mesh mode, rigging, posing, measuring, a running Boolean or Shrinkwrap, a recording) is a pill; the focused one is a bubble with its controls, and its panel button opens the full settings in the dock's panel. By default it sits beside the dock as a taskbar (both centered), or above the dock (and above an open panel on phones) when they don't fit; its grip moves it (double-tap resets). A new context is a `UIContext` in `UI.contexts()`, not a new floating bar.
- Selection bubble: Object | Mesh (Tab) / Move / Rotate / Scale / Delete / More (⋯) / Deselect. The same Move / Rotate / Scale act on objects or, in Mesh mode, on the selected faces; tapping the active Scale or Rotate opens its slider bar. Secondary actions go in the More menu.
- Geometry operations live in one place: Objects → Modify (quick shapes, Boolean, Shrinkwrap, Combine, Group) and, in Mesh mode, the panel's Select / Sculpt / Modify parts. Tools keeps only aids that don't change geometry (measure, guides, align).
- Keys follow Blender: Tab (mode), G / R / S (transform with the mouse, X / Y / Z, typed values), Shift+A (quick shapes), A / Alt+A (select all / none), Ctrl+I, Ctrl +/− (faces). Shift keeps proportions while dragging the scale gizmo.
- Floating view controls (bottom right): frame all, gyro, fullscreen, hide interface.
- Everything must disappear with "hide interface" (H) — add new floating UI to the `body.ui-hidden` rule in `style.css`.

Don't add new top-level buttons casually; find the right place in this structure.

### Visual identity
- Palette (CSS variables in `style.css`): deep purple `--purple`, solar gold `--gold` (accent), earth red `--terra` (danger / smart guides), lilac `--lilac` (tabs, guides). Use variables, not new hex values.
- Icons are white; on gold backgrounds they switch to deep purple.
- Glass UI uses `background: var(--glass…)` + `backdrop-filter: var(--blur)`. Write only the standard `backdrop-filter`/`app-region`: the build adds the `-webkit-` prefix. Writing both by hand made the minifier drop the standard one (blur vanished in production).

### Text and language
- Code, comments, commit messages and docs are in English.
- Every user-visible string goes through `tr('English text')`; add the Portuguese translation to `PT` in `i18n.ts` (keys must be unique). The UI defaults to English.
- Short, sentence-case labels; messages say what happened and what to do.

### Editor behavior
- Transform changes go through `beginTransform` / `endTransform` / `transformMany` so they're undoable; several changes from one action must be one undo step (`group`).
- Anything that should survive a reload must be saved in `project.ts` (snapshot + restore). New fields are optional so older projects still open; bump `VERSION` only for breaking changes.
- AR must leave the editor exactly as it found it (transforms, environment, lights). Autosave is paused during AR.

### Free software
- Bundled assets must be CC0 (or GPL-compatible) and listed in `THIRD_PARTY_LICENSES.md` with their source. No proprietary services or downloads the user didn't choose.
- Large bundled assets (animation clips, sample models) are loaded on demand and runtime-cached, never precached.

### PWA and paths
- Reference public assets with `import.meta.env.BASE_URL` (the site lives under `/<repo>/` on GitHub Pages).
- The service worker exists only in the production build; test PWA features with `npm run build && npm run preview` or on the published site.

## Verifying changes

1. `npm run build` must pass (TypeScript is strict about unused code).
2. Run the app (`npm run dev`) and exercise the change in a browser, on desktop and phone sizes.
3. Some features can't be tested on a desktop (AR, gyro sensors, Android share sheet): test their logic with simulated input, say clearly what wasn't tested on a device, and ask the user to test on a phone (published site, or `npm run dev -- --host` with Chrome USB port forwarding for AR).

### Driving the app from a browser tool (cheaply)

`main.ts` exposes the editor as `window.editor`, so a browser automation tool can run JavaScript in the page instead of moving the cursor. Prefer this: it costs far fewer tokens than screenshots and clicks, and it's exact.

- **Set up through the API.**
  - Load and act: `await editor.addFromUrl(url, name)`, `editor.selected`, `editor.optimizer.apply(e, settings)`, `editor.rigger.start(e)` / `bind()`, `await editor.exportGLB(compact)`.
  - Put a test model in `public/` and load it by URL. Delete it before finishing.
- **Test the real user path when it matters.**
  - Dispatch a `drop` event with a `DataTransfer` holding a `File`. This goes through `loadFiles`, so notices and toasts run.
  - Or click a button found by its text, e.g. `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Objects').click()`.
- **Return small JSON, not pages or images.**
  - Have the script return just the numbers and state you need: timings with `performance.now()`, triangle counts, panel `innerText`, toast texts.
  - Check layout in script instead of with screenshots, e.g. elements with `scrollWidth > clientWidth`.
- **Screenshots only for visual checks**, at reduced scale, after the state is set up by script. Zoom into a region rather than capturing the whole screen.
- **Keep results across reloads.** Code changes reload the page and wipe JS state. Store reference data (e.g. weights before a change) in IndexedDB to compare after, and delete the test database at the end.
- **Long operations.**
  - A single script call times out after about 45 s. Start the work without awaiting it, store the result on `window`, then poll in a later call.
  - Worker `console.log` output may not reach the page console: post a message to the main thread and log it there.
- **Phone layout:** emulate 375×812, reload, run the same script checks, then reset the viewport.
- **Know the limits.** Calling editor methods proves the logic, not the gestures (pinch, drag, gizmo handles) and not the device (AR, gyro, camera). Say what wasn't exercised.

## Git

- Commit and push only when the user asks; they usually validate locally first.
- The user is the only author: never add co-author lines or AI attribution to commits or PRs.
- Keep commits focused, with an English summary line and a short body of what changed.
