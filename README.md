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
- on Android, appears in the system **Share** menu: in any file manager (e.g. Samsung My Files) select a 3D file or a `.babalon` project → Share → babalon JS;
- shows an **Update** button when a new version is deployed, instead of reloading under you.

## Features

Layout: the logo opens the project menu, the top right switches between **Edit / Photo / AR**, the dock has **Add, Objects, Light and Tools**, and the floating buttons at the bottom right frame the scene, toggle gyro mode and fullscreen, and hide the interface.


- **Add**: GLB, glTF, OBJ, STL, FBX, PLY/SPLAT/SPZ (gaussian splats), USDZ and .babylon, through the file picker or by dragging files onto the window. Also sample models, basic shapes and lights.
- **Place**: tap to select. With *Move*, drag the object across the floor with your finger or mouse, or use the gizmos. *Rotate* and *Scale* use gizmos. The magnet toggles grid snapping.
- **Scene**: object list, show/hide, position/rotation/scale sliders, 90° turns (handy for models that load lying down), drop to floor, duplicate, delete.
- **Tools**:
  - *Measure*: tap two points to measure. Points stick to a model's surface (and follow it when it moves), or land on the floor. A measurement can follow the surface of the model instead of a straight line. Snap to vertices, units in m/cm/mm/in/ft, drag the points to adjust.
  - *Guides*: horizontal (height) and vertical (X/Z) planes to line things up, placed by value or at the bottom/center/top of the selection.
  - *Smart guides*: while moving, objects snap to other objects' edges and centers, to guides and to the floor, Figma style.
  - *Align & match* (2+ objects, the first selected is the reference): align edges/centers on each axis, match height/width/depth/scale, stack on top, distribute, drop to floor.
  - *Size*: width/height/depth fields in the Scene panel scale the object to an exact size.
- **Multi-selection**: Shift/Ctrl+click, or the multi-select button on touch screens. Moving, deleting and duplicating act on all selected objects.
- **Animate** (Objects → Animate):
  - *Clips*: play, pause, loop or play once, speed, and a frame slider. A paused or dragged frame stays as a still pose in photos, AR and saved projects. Switching clips while playing crossfades.
  - *Animation library*: 43 free animations (idle, walk, run, jump, sit, dance, combat…) that apply in one tap to any humanoid character, whatever its bone names (Mixamo-style, Unreal, Blender/Rigify, VRM/VRoid…). You can also import your own animation files (GLB/glTF/FBX). Optionally keeps the character in place.
  - *Motion*: spin, float, pulse or sway any object, no keyframes. You can still move it while it plays.
- **Pose** (characters with a skeleton): tap a joint and turn it with the rings or the Bend/Twist/Tilt sliders; drag a hand or foot and the arm or leg follows (IK). Mirror the pose or copy one side to the other, ready poses (relaxed, wave, point, sitting, walking, aiming…), back to the animation at any time. Skeletons with unusual bone names can be mapped by hand.
- **Rig** (models without a skeleton): give a standing character the standard free skeleton. Drag its joints onto the model in a front view (left and right mirror each other, depth is found automatically), bind the skin with envelope or heat-diffusion weights (both computed in the background), check it with a test pose and a weight heat map, and confirm. After placing the joints, **Bind the mesh** offers **Apply rig** or **Compare treatments**. Experimental deformation treatments are **Direct weights**, **Trunk protection**, and **Distributed rotation**. **Create comparison** builds three copies from one weight calculation; ready poses affect all three, and the original stays hidden. Settings and weights survive project reloads. The rigged model can then be posed, animated with the library and exported as GLB with its skeleton. Try it with the *Mannequin, no skeleton* sample. See [the comparison guide](docs/rigging_comparison.md).
- **Material** (Sketchfab style): color/tint, show/hide texture, metallic, roughness, clear coat, emission, opacity, double-sided, unlit and wireframe.
- **Lights**: presets (Studio, Daylight, Sunset, Neon, Dramatic), point, spot and sun lights with color, intensity, cone angle, range, shadows and "aim at".
- **Environment**: HDR lighting with intensity and rotation, blurred or solid background, shadow-only or solid floor, reference grid.
- **Photo**: filter presets, field of view, exposure, contrast, saturation, temperature, vignette, bloom, grain, chromatic aberration, sharpen, depth of field (tap to focus), and frames for 16:9, Cinema, 1:1, 4:5, 9:16… Photos are rendered at 2× screen resolution and saved straight to the device, with a **Share** button for a few seconds afterwards.
- **AR** (Android with ARCore, in Chrome or the installed app): the **AR** button opens the camera; tap a detected surface to place the whole scene at real size, drag to turn, pinch to resize (**1:1** returns to real size). AR starts with the lightest setup; the options panel adds shadows on the real floor, the editor's lighting presets (or the room's estimated light), light intensity, photo filters and an FPS counter. The eye button hides the interface. Turning off **Camera background** gives *virtual AR*: you walk around the scene in its own environment (sky, floor) instead of the room, and **Place in front of me** works without a detected surface. The shutter saves a photo of camera + 3D when the phone shares the camera image with the browser; otherwise use the system screenshot. Not available on iPhone (Safari has no WebXR AR).
- **Gyro mode** (phones, including iPhone): the phone button in the top bar or in photo mode turns the camera as you turn and tilt the phone, on top of the touch gestures. No camera needed, and all photo effects keep working.
- **Projects**: new, open and save `.babalon` projects. A project is a zip with `project.json` (objects, transforms, materials, lights, animations, poses, rigs, environment, effects and camera) plus the original model and animation files in `assets/` and skin weights in `rigs/`. Sample models are stored as links only. You can also open a project by dragging it onto the window.
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
| H | Hide / show the interface |
| Ctrl+Z / Ctrl+Y | Undo / Redo |
| Ctrl+D | Duplicate |
| Ctrl+S / Ctrl+O | Save / open project |
| Delete | Delete |
| Esc | Deselect / exit photo mode |

Camera: drag to orbit, pinch or scroll to zoom, two fingers (or right mouse button) to pan. Double-tap an object to focus on it, or empty floor to orbit around that point. The orbit button in the selection bar makes the selected object the pivot without zooming. A small gold dot shows the pivot while the camera moves.

## Project structure

`src/` is grouped by domain:

- `core/`: the editor core with no UI (scene, camera, loading, selection, gizmos, lights, shadows, environment, post-processing, capture, export, history), projects and autosave, shared presets, files and translations.
- `ui/`: the interface in plain DOM. `ui.ts` is the shell (bars, dock, menus); each panel is in `ui/panels/`; `photo.ts` is photo mode; `dom.ts` has the reusable components; `style.css` is the dark glass theme with the phone layout below 760px.
- `animation/`: clip playback, simple motion, posing (FK, IK, mirror, presets) and playing clips made for other skeletons.
- `optimize/`: model optimization: cost and budgets, triangle reduction (meshoptimizer, in a Web Worker), levels of detail, baked normal maps, KTX2 texture compression and the compact GLB export (see [docs/model_optimization.md](docs/model_optimization.md)).
- `rigging/`: humanoid bone detection, the standard skeleton, manual rigging, joint finding and skin weights (heat diffusion in a Web Worker).
- `ar/`: augmented reality with WebXR and its on-camera controls.
- `tools/`: measurements (including the along-the-surface path), guides, smart guides and alignment.
- `device/`: gyro mode and the system bar colors.

Also: `vite.config.ts` (PWA manifest, offline cache and file handlers); `public/animations`, `public/models` (the free animation library and Mannequin samples, CC0, see [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md), made by `scripts/build-animation-library.mjs`); `public/icons`, `public/brand` (app icons and lettering, generated from the full-size artwork in `design/`).

The `editor` object is exposed on `window` for debugging from the browser console.

Development guidelines (for people and coding agents) are in [AGENTS.md](AGENTS.md).

Android AR uses a native SceneView/ARCore Activity while the PWA keeps Babylon
WebXR. See [Native Android AR integration](docs/android_ar.md) for the scene
transfer, session lifecycle, placement rules, Samsung debug-build workaround and
device verification commands.

## License

Copyright (C) 2026 Guilherme Holanda Sanches

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. See [LICENSE](LICENSE).

Third-party libraries keep their own licenses: Babylon.js (Apache-2.0), fflate (MIT), Lucide icons (ISC), meshoptimizer (MIT), ktx2-encoder (MIT) with the Basis Universal encoder (Apache-2.0), ktx-parse (MIT) and glTF-Transform (MIT). The bundled animations and Mannequin models are CC0 (Universal Animation Library by Quaternius), listed in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md). Other sample models and HDR environments are loaded at runtime from the Babylon.js asset CDN and are not distributed with this repository.
