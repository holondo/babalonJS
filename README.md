<p align="center">
  <img src="public/icons/icon-512.png" alt="babalon JS icon" width="160" />
</p>
<h1 align="center">
  <img src="design/lettering.png" alt="babalon JS" width="360" />
</h1>
<p align="center"><em><a href="README.pt-BR.md">Leia em português</a></em></p>

A simple, touch-friendly 3D scene composer built on [Babylon.js](https://www.babylonjs.com/).
Drop in your models, place them with your finger or mouse, light the scene and take photos with effects, in the spirit of a video game photo mode.

The interface is in English by default and can be switched to Portuguese from the project menu (folder icon).

## Running

```bash
npm install
npm run dev
```

To try it on your phone over the same Wi-Fi network, run `npm run dev -- --host` and open the "Network" address shown in the terminal.

`npm run build` produces a static build in `dist/` that can be hosted anywhere. `npm run preview` serves that build locally (use it to test the PWA: the service worker is only active in the build).

### Install as an app (PWA)

babalon JS is a Progressive Web App. Once hosted over HTTPS (or on `localhost`), browsers offer to install it: the install icon in Chrome/Edge's address bar, the **Install app** item in the project menu, or *Add to Home Screen* on Android/iOS. Installed, it:

- works offline (the whole app is cached; HDR environments and sample models are cached the first time they are used);
- on desktop, appears in "Open with" for `.babalon`, `.glb`, `.gltf`, `.obj`, `.stl`, `.fbx`, `.ply`, `.splat` and `.spz` files;
- shows an **Update** button when a new version is deployed, instead of reloading under you.

## Features

- **Add**: GLB, glTF, OBJ, STL, FBX, PLY/SPLAT/SPZ (gaussian splats), USDZ and .babylon, through the file picker or by dragging files onto the window. Also sample models, basic shapes and lights.
- **Place**: tap to select. With *Move*, drag the object across the floor with your finger or mouse, or use the gizmos. *Rotate* and *Scale* use gizmos. The magnet toggles grid snapping.
- **Scene**: object list, show/hide, position/rotation/scale sliders, 90° turns (handy for models that load lying down), drop to floor, duplicate, delete, model animations.
- **Tools**:
  - *Measure*: tap two points to measure. Points stick to a model's surface (and follow it when it moves), or land on the floor. A measurement can follow the surface of the model instead of a straight line. Snap to vertices, units in m/cm/mm/in/ft, drag the points to adjust.
  - *Guides*: horizontal (height) and vertical (X/Z) planes to line things up, placed by value or at the bottom/center/top of the selection.
  - *Smart guides*: while moving, objects snap to other objects' edges and centers, to guides and to the floor, Figma style.
  - *Align & match* (2+ objects, the first selected is the reference): align edges/centers on each axis, match height/width/depth/scale, stack on top, distribute, drop to floor.
  - *Size*: width/height/depth fields in the Scene panel scale the object to an exact size.
- **Multi-selection**: Shift/Ctrl+click, or the multi-select button on touch screens. Moving, deleting and duplicating act on all selected objects.
- **Material** (Sketchfab style): color/tint, show/hide texture, metallic, roughness, clear coat, emission, opacity, double-sided, unlit and wireframe.
- **Lights**: presets (Studio, Daylight, Sunset, Neon, Dramatic), point, spot and sun lights with color, intensity, cone angle, range, shadows and "aim at".
- **Environment**: HDR lighting with intensity and rotation, blurred or solid background, shadow-only or solid floor, reference grid.
- **Photo**: filter presets, field of view, exposure, contrast, saturation, temperature, vignette, bloom, grain, chromatic aberration, sharpen, depth of field (tap to focus), and frames for 16:9, Cinema, 1:1, 4:5, 9:16… Photos are rendered at 2× screen resolution; on phones the share sheet opens.
- **AR** (Android with ARCore, in Chrome or the installed app): the **AR** button opens the camera; tap a detected surface to place the whole scene at real size, drag to turn, pinch to resize (**1:1** returns to real size). Models cast shadows on the real floor. The shutter saves a photo of camera + 3D when the phone shares the camera image with the browser; otherwise use the system screenshot. Not available on iPhone (Safari has no WebXR AR).
- **Projects**: new, open and save `.babalon` projects. A project is a zip with `project.json` (objects, transforms, materials, lights, animations, environment, effects and camera) plus the original model files in `assets/`. Sample models are stored as links only. You can also open a project by dragging it onto the window.
- **Autosave** in the browser (IndexedDB): when you come back, "Continue where you left off" restores the last session.
- **Undo/redo**, **export the scene as .glb**, fullscreen.

### Shortcuts

| Key | Action |
| --- | --- |
| W / E / S | Move / Rotate / Scale |
| F | Focus selection (or frame everything) |
| O | Orbit around the selected object |
| M | Measure mode |
| P | Photo mode |
| Ctrl+Z / Ctrl+Y | Undo / Redo |
| Ctrl+D | Duplicate |
| Ctrl+S / Ctrl+O | Save / open project |
| Delete | Delete |
| Esc | Deselect / exit photo mode |

Camera: drag to orbit, pinch or scroll to zoom, two fingers (or right mouse button) to pan. Double-tap an object to focus on it, or empty floor to orbit around that point. The orbit button in the selection bar makes the selected object the pivot without zooming. A small gold dot shows the pivot while the camera moves.

## Project structure

- `src/editor.ts`: the core, with no UI. Scene, camera, loading, selection, gizmos, lights, shadows, environment, post-processing, capture, export and history.
- `src/tools.ts`: measurements (including the along-the-surface path), guides, smart guides and alignment.
- `src/ar.ts`, `src/arHud.ts`: augmented reality with WebXR and its on-camera controls.
- `src/project.ts`: saving/opening `.babalon` projects and autosave.
- `src/ui.ts`: panels and toolbars, plain DOM.
- `src/dom.ts`: UI helpers (slider, toggle, color, chips…).
- `src/i18n.ts`: translations. Keys are the English text; add a language by adding a dictionary.
- `src/style.css`: dark glass theme, phone layout below 760px.
- `vite.config.ts`: PWA manifest, offline cache and file handlers.
- `public/icons`, `public/brand`: app icons and lettering, generated from the full-size artwork in `design/`.

The `editor` object is exposed on `window` for debugging from the browser console.

## License

Copyright (C) 2026 Guilherme Holanda Sanches

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. See [LICENSE](LICENSE).

Third-party libraries keep their own licenses: Babylon.js (Apache-2.0), fflate (MIT), Lucide icons (ISC). Sample models and HDR environments are loaded at runtime from the Babylon.js asset CDN and are not distributed with this repository.
