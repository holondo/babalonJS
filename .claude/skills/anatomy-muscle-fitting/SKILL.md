---
name: anatomy-muscle-fitting
description: Build or rebuild a procedural muscle (or muscle group) in src/anatomy from the reference écorché GLB, fit it under the skin, and give it hypertrophy and per-side genetics. Use when shaping, measuring, fixing show-through or adding growth/genetics for any anatomy muscle.
---

# Fitting muscles to the body from the reference écorché

The anatomy is anatomically plausible, good-looking and functional, not medical-precise. The
reference écorché (BodyParts3D + Z-Anatomy, CC BY-SA 4.0) is the **measurement and shape source**;
we never ship its meshes. Every muscle is procedural, so it follows body parameters, hypertrophy,
genetics and, later, any humanoid skin.

Work in this loop: **measure → build → seat → grow → verify → record**. Change one muscle group per pass.

When the muscle must also follow a fitted humanoid GLB (skin grooves, folds, bulk, holes), or you need the
analysis renders, gap maps or sternum-frame maps, use `.claude/skills/anatomy-reference-analysis/SKILL.md`.

## 1. Measure the reference against ours

1. Copy the reference into `public/_ref_anatomical-reference.glb` (temporary, never commit it).
2. Run the dev server (`preview_start`) and drive the page with JavaScript (see AGENTS.md "Driving the app").
   Always override `window.requestAnimationFrame` with a setTimeout: the hidden browser pane gives no frames.
3. Load our anatomy (`editor.addAnatomy()`, `anatomyBody.ready()`, hide the skin) and the reference
   (`editor.addFromUrl('/_ref_anatomical-reference.glb', 'reference')`, root at the origin).
4. For each structure, collect world vertices of one side (x > 0). Return small JSON, not screenshots:
   - bounds `[minX, minY, minZ, maxX, maxY, maxZ]`;
   - a **profile**: per 4 cm height band, the posterior (or anterior) extreme z and the x range.
   Reference names look like `Left gluteus maximus`. Ours are `anatomicalName` (`gluteus_maximus_R`).
5. Compare **relative to a shared landmark** (sacrum, sternum, scapula, hip bone), never in absolute
   terms: our skeleton differs in proportion (e.g. our sacrum sat 3.4 cm higher and 3.7 cm shallower).
   Write down what is wrong in words: "starts 4.5 cm off the midline", "not behind the sacrum", "5 cm short".

## 2. Build with the shared builders (DRY)

- Flat, fan and strap muscles use **`fanMuscle(p, side, o)`** in `src/anatomy/geometry.ts`:
  - `origin(s)` / `insertion(s)`: attachment lines in authored units (10 cm), s along the origin.
    Use short polylines through bony landmarks from `anatomy(p)` (crest, asis, pubis, hip, shoulder).
  - `place(x, y, z, t, s)`: puts the interpolated point on a body surface at an inset.
    Reuse `onBack` (trunk) or `onButtock` (hip/pelvic loft). They keep x and take depth from the
    section, so the surface never folds. Fiber ends blend onto bone depth.
  - `thickness(t, s)`: belly profile × `edges(s)`, with growth inside `Math.sqrt(growth(...))`.
    Thin the muscle where the skin is close to bone (cleft, PSIS dimples, spinous processes).
  - Parts of one muscle are `span`s of s that share edges (trapezius parts, erector longissimus/iliocostalis).
  - `armBlend: [a, b]` for muscles that cross into the arm. It must stay numeric, because meshes cross `postMessage`.
- Name meshes `<template>_<L|R>`. Stop rendering the old ellipsoid by skipping its name in the
  `lowerMuscles`/`upperMuscles` render loop. Keep the definition, because its axis drives the hypertrophy field.
- Never write a second interaction or growth path. If a behaviour exists for pectoral or rectus, route the
  new muscle through it.

## 3. Seat it in the body and under the skin

After registration into the human body (`registerHumanInternal`):
- **Fit:**
  - Add the name to the local-fit regex in `fitHumanLayers`.
  - Pick the right cage key: hip muscles fit against the leg cage, which includes the buttock skin.
    A wrong key collapses rows, which is how the TFL once collapsed to the midline.
- **Layering:** `restOnThorax(muscles, support, skinCage, clearance, skinMargin)` runs in passes:
  1. deep muscles rest on bones, with a large skin margin;
  2. superficial muscles rest on the deep ones;
  3. fascia rests on top.
  Extend its floor/muscle regexes for new names.
- **Ripples:** the trunk registration scales each height by the scanned section. Broad sheets crossing
  many heights get ripples, so smooth them with `relaxShell(m, passes)`. To check whether ripples come
  from the authored shape, compare with `buildInternals(p, ['otherMuscles'])` imported from
  `/src/anatomy/geometry.ts`.

## 4. Hypertrophy and genetics

- Hypertrophy goes through the existing volume fields (`humanVolumeFields`), one field per part along its
  origin → insertion axis. `humanVolumeBase` neutralizes growth at generation, so muscle and skin grow
  together. New keys need an entry in `atlas.json` legacy (or `directGrowthKeys`).
- On fitted bodies, check whether the authored volume field and the saved outline/depth profile are
  both amplifying the same shape. If growth makes a fan buckle, keep the fitted shell as the reference
  and apply the extra thickness after its fitted profile with `growFittedShell`. Taper growth at
  attachments, and check the free edges and common borders between heads. Keep unrelated muscles on their existing
  volume paths, especially when a regional control such as Back volume affects several muscles.
- Diagnose drag preview and released geometry separately. A small sampled delta can extrapolate into
  a spike even when the released result is smoother. Reproduce through `body.edit` and `body.commit`
  or the UI. For a nonlinear fitted control, use the existing debounced exact rebuild. Compare the
  fitted contact result during a pause at the target value with the result after release.
- Genetics:
  - add the template to `individualMuscles` (`definition.ts`);
  - add its profile from FORMA `individual_muscle_geometry_profiles.json` to `data/priorityRegions.json`;
  - map mesh name → template in `meshTemplates` (`priority.ts`).
- UI: add the growth key and template to the region group in `bodyLayout.ts`. Every label goes through
  `tr()` with a PT entry in `i18n.ts`, and keys must be unique.
- Never change how existing skin-interacting muscles behave. Re-measure pectoral and rectus skin
  displacement if you touch shared code.

## 5. Verify

- Re-measure bounds and profile against the reference, relative to the landmark.
- **Skin at rest and at 2.5× growth:**
  - Set the skin opacity to 1 and look from the back and the side.
  - Identify any poking mesh with `scene.pick(x, y)`.
  - Measure skin displacement as the max vertex delta (mm) between rest and grown.
- **Fitted hypertrophy stress test:** Replay the same real Fit only snapshot at its reference setting
  and at the maximum of the affected control (3× for Deltoid volume and Back volume). Hold the pose
  and camera fixed. Compare before and after, both during the drag and after release, with opaque skin
  and with skin hidden. Use a front or oblique shoulder view for the deltoid and a rear or rear-oblique
  view for the latissimus. Inspect for spikes, folded faces, gaps between heads and skin crossings.
  Check interior face samples as well as vertices. Measure the final posed mesh volume by muscle,
  including the previous grown volume, and compare the attachment rows and the unedited reference.
  A smooth silhouette alone does not establish that the muscle grew or that the fold was fixed.
- **Genetics:** set `volume` 1.8 on one side with `editIndividual`. Compare mean shell thickness (outer
  vs inner layer) between L and R. The other side must not change.
- **Screenshots:**
  - Hide the UI (`body.classList.add('ui-hidden')`) and deselect.
  - Wait about 1.5–4 s for framing, then set the ArcRotate camera (alpha/beta/radius/target) in a loop.
  - To see past the arms, disable meshes whose bounding box lies at x > 0.17 m.
- Run `npm run build`, `node scripts/check-anatomy.mjs` and `node scripts/check-lazy-cache.mjs`, and the
  `/scripts/fixtures/anatomy-priority.html` fixture (click `#test`, expect PASS).
- Say clearly what wasn't checked (poses, device).

## 6. Record and clean up

- Ledger (`consolidated_anatomy_priority_regions_implementation_plan.md`), one continuation section:
  - reference numbers;
  - what was wrong;
  - what was built;
  - result numbers;
  - growth and genetics results;
  - known issues.
- Add a short bullet in `docs/anatomy.md` ("Body page, growth and reference-derived shapes").
- Delete `public/_ref_anatomical-reference.glb`. Commit only when the user asks, with no AI attribution. Stage only
  your own hunks in files that also hold the user's edits.

## Pitfalls already met

- Absolute comparisons mislead, because the skeletons differ. Always compare relative to a landmark.
- Blending two placement surfaces (back ↔ loft) makes kinks and flaps. Use one surface per muscle.
- A radial/angle placement around a moving section centre folds the sheet. Keep x and take the depth instead.
- Muscle origins on the soft surface poke out at skin dimples. Blend origin depth onto bone.
- Python heredocs in the Bash tool can fail. Write edit scripts with the Write tool in the scratchpad,
  each `old` string asserted unique.
