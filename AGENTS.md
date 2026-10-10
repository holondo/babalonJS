# Guidelines for agents

How to work on babalon JS: a touch-friendly 3D scene composer (Babylon.js 9, TypeScript, Vite, plain DOM UI, installable PWA). Read this before changing code. The README describes the product; this file describes how to build it.

## Commands

```bash
npm install
npm run dev        # dev server, http://localhost:5173 (no service worker)
npm run build      # type-check (app + vite config) and production build in dist/
npm run preview    # serves dist/ (the only way to test the PWA / service worker locally)
```

- There are no automated tests. Verify every change with `npm run build` and in a browser (see [Verifying changes](#verifying-changes)).
- GitHub Pages deploys on every push to `main` (`.github/workflows/deploy.yml`). The build runs with `BASE_PATH=/<repo>/`.

## Code map

| File | Responsibility |
| --- | --- |
| `src/editor.ts` | Core with no UI: scene, camera, loading, entities, selection, gizmos, lights, shadows, environment, post-processing, capture, export, undo history, render-on-demand, AR scene state |
| `src/tools.ts` | Measurements (incl. along-the-surface path), guides, smart guides, alignment |
| `src/project.ts` | `.babalon` save/open and browser autosave (IndexedDB) |
| `src/presets.ts` | Shared data: lighting presets and photo filters (used by editor and AR) |
| `src/ar.ts` / `src/arHud.ts` | WebXR AR session / its on-camera overlay |
| `src/gyro.ts` | Gyro mode (device orientation turns the camera) |
| `src/systemBars.ts` | Status bar / title bar color, desktop title-bar overlay |
| `src/files.ts` | Saving, sharing and receiving files (share target) |
| `src/ui.ts` | Panels, bars, menus (plain DOM) |
| `src/dom.ts` | Reusable UI components (slider, toggle, chips, segmented, menu item, buttons…) |
| `src/i18n.ts` | Translations |
| `src/style.css` | Theme and layout |
| `vite.config.ts`, `public/share-target.js` | PWA manifest, offline cache, file handlers, share target |
| `design/` | Full-size source artwork (not shipped); `public/icons` and `public/brand` are generated from it |

Keep this split: `editor.ts` must not touch the DOM UI; `ui.ts` talks to the editor through its methods and the `changed` observable.

## Principles

### Don't repeat yourself
One implementation per function. Before writing something, look for it:
- UI pieces → `dom.ts` (`slider`, `toggle`, `chips`, `segmented`, `select`, `colorInput`, `numberInput`, `menuItem`, `iconButton`, `button`, `shutterButton`, `flashScreen`). The AR overlay uses the same components as the panels.
- Lighting presets and photo filters → `presets.ts`. Never copy their values.
- Lights and shadows → `createLight` / `createShadowGenerator` in `editor.ts`.
- Saving/sharing files → `files.ts` (`saveAndOfferShare`, `timestampedName`).
- Styles → reuse existing classes (`.ibtn.round`, `.segmented`, `.chips`, `.toggle`…) and CSS variables; add a variant instead of a near-copy.

If you find a duplicate while working, consolidate it.

### The cheapest thing happens by default
Expensive features are opt-in (AR shadows, room lighting, camera access, FPS counter…). Free optimizations (no visible change) are automatic. Never trade image quality for speed without making it an explicit option, and never lower render resolution by default.

### Performance
- The scene renders on demand. Anything that changes what's on screen must go through editor methods that emit `changed`, or call `editor.invalidate()`. Camera motion, animations, loading and AR are detected automatically.
- No per-frame allocation-heavy work, no GPU readbacks in the render loop (the theme-color sampler is throttled and paused in AR).
- `scene.skipPointerMovePicking` is on: pick explicitly when you need what's under the pointer.
- Rebuild geometry (e.g. lines) only when its data changed.

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
- Selection bar: Move / Rotate / Scale / Delete / More (⋯) / Deselect. Secondary actions go in the More menu.
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

### PWA and paths
- Reference public assets with `import.meta.env.BASE_URL` (the site lives under `/<repo>/` on GitHub Pages).
- The service worker exists only in the production build; test PWA features with `npm run build && npm run preview` or on the published site.

## Verifying changes

1. `npm run build` must pass (TypeScript is strict about unused code).
2. Run the app (`npm run dev`) and exercise the change in a browser, on desktop and phone sizes.
3. Some features can't be tested on a desktop (AR, gyro sensors, Android share sheet): test their logic with simulated input, say clearly what wasn't tested on a device, and ask the user to test on a phone (published site, or `npm run dev -- --host` with Chrome USB port forwarding for AR).

## Git

- Commit and push only when the user asks; they usually validate locally first.
- The user is the only author: never add co-author lines or AI attribution to commits or PRs.
- Keep commits focused, with an English summary line and a short body of what changed.
