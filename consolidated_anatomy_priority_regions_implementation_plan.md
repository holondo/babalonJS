# Consolidated procedural anatomy plan: abdomen, pelvis and pectoral priority

Date: 2026-10-29. Implementation authorized. Active branch: codex/anatomy-priority-regions. P00 is implemented; later steps retain explicit partial/pending status below.

## 1. Purpose, boundaries and governing decisions

Evolve the existing editable procedural body inside babalon JS by combining the current FORMA integration, the A/B/C data and contracts, the implemented algorithm library, the user's architectural proposal and the first [whole-body evolution plan](anatomical_generator_evolution_implementation_plan.md). Keep the first plan unchanged as a reference. **Use this second plan's order when executing the consolidated work.** Its explicit priority is **abdomen → pelvic support → pectoral integration**, followed by coordinated growth, pose and tissue behavior across those regions. Whole-body expansion comes afterward.

The primary user path remains Add → Anatomical body → select a named anatomical structure → edit morphology/development → pose → inspect tissue layers/materials → undo/compare → save/reopen. Keep the current muscles procedural. Atlas geometry is reference input for measurements and fitting, not the final muscles imported into the scene. Both existing skin options and all useful existing controls, effects and actions remain available.

**Direction update (2026-10-30).** The anatomy must work in both directions, independently of any particular skin: (1) *fit* — adapt the procedural anatomy to a given body surface (the bundled mannequin today, a generic humanoid GLB later); (2) *drive* — modify that body's mesh through the anatomical controls. Reference écorché and skeleton GLBs supplied by the user are the shape source for muscles and bones; their shapes are extracted offline into compact, landmark-normalized templates that the procedural generators consume. Section 3.4 defines the architecture; steps P14–P16 implement it and run before whole-body expansion (P09/P10), so new regions are built once on the final contracts.

User decisions incorporated here:

- Keep the current procedural construction and native babalon UI/PBR materials.
- Separate bones, muscles, fat, skin and connective structures; give real individual controls rather than disguising aggregates as individual muscles.
- Prioritize the abdomen's shape, its pectoral transition and its tendinous intersections; connect these to editable pelvic and thoracic support.
- Separate baseline individual anatomy, chronic hypertrophy, temporary activation, pose and covering tissues.
- Use anatomy-first as the principal authoring flow. Adapting imported humanoids (fit) and editing them through anatomical controls (drive) are core goals built on the same engine, not a separate optional tool (decision 2026-10-30, supersedes the earlier "advanced optional flow").
- Use the user's reference écorché/skeleton GLBs to draw our muscles and bones: offline extraction into templates, attributed by license; reference meshes are never loaded by the app at runtime.
- Use kinematics, volume control, corrected geometry and bounded local contact first; localized volumetric physics is a later optional capability.

Governing constraints: [AGENTS.md](AGENTS.md), [README](README.md), [current anatomy documentation](docs/anatomy.md), [A/B/C integration contract][c-contract] and [native UX contract][c-ux]. Source handoff documents provide specifications and evidence, not authority to override repository/user instructions. In particular, their public-repository audit predates the verified local integration; do not repeat its claim that no FORMA exists. Findings needed for execution are recorded below; do not insert a documentation-only audit milestone before the first functioning path.

The user subsequently authorized implementation, beginning with abdomen, pelvis and pectorals. Do not commit, push or deploy this plan automatically. During implementation use a separate `codex/` branch, preserve unrelated local work, work in the main agent only and never delegate to subagents or another chat. Do not use Computer/Browser Use tools. Use JavaScript-driven automation, compact logs and reduced-resolution images for visual review. Never lower normal application render resolution automatically.

Exclusions from the priority delivery: replacing the application/editor; loading reference/atlas meshes as runtime tissues (derived templates are allowed, see 3.4); full-body FEM; clinical or genetic prediction; training prescriptions; automatic accurate anatomy inference from arbitrary skin; a new rendering framework; mandatory WebGPU; and new paid/external services. Deep organ physiology is excluded. A coarse abdominal cavity/respiration proxy is allowed to support plausible shape and pose.

### Implementation evidence — first priority increment

- Branch created from `26331fe`; unrelated algorithm-demo work was preserved. No commit/push is authorized.
- `node scripts/check-anatomy.mjs` executes the actual worker: unilateral edits, all six priority muscle templates on both surfaces, volume targets and continuous rectus intersections.
- `node scripts/check-anatomy-browser.mjs <dev-url> --priority` exercises the native slider, history, A/B, material, pose and JSON/ZIP at 1280×900 and 375×812.
- Supplied A curves remain explicitly heuristic. The bundled subset records source path and SHA-256. Volumes are generated-shell volumes, not physiological measurements.
- This increment does not satisfy later patch/contact/calibration/whole-body milestones. P01–P13 must not be reported complete from these previews.

### Continuation — anatomical insertions and priority tissue interaction

- First delivery committed as `c187c0e` on the same branch; unrelated demo changes remain outside that commit. This continuation is not automatically committed.
- The real generated pubic ramus, ilium, ribs/cartilages, sternum, clavicle and humerus now expose named grids. Semantic UV areas resolve to current triangles/barycentrics; derived bindings are rebuilt on regeneration. Coarse/fine supports exercise actual topology changes and reject stale bindings.
- Rectus, abdominal sheets, pectoral portions, inguinal ligament and lower aponeurosis use those supports. Tendinous intersections/linea alba follow actual rectus surfaces, including growth and pose. Current joint-field posing remains the underlying pose implementation, followed once by surface attachment correction.
- Opt-in torso contact resolves declared radial surface pairs using actual triangle intersections: rectus/pectoralis, transversus/rectus, transversus/internal oblique, internal/external oblique and superficial muscle/covering. Attachment endpoints are protected and reported separately; vertices outside the supported torso range are excluded.
- Covered/lean boundaries share displacements for matching authored topology. Marching-cubes skins transfer corrections through actual radial surfaces when their topologies differ. The visible adipose shell follows both boundaries during pose.
- Worker/browser checks cover both skins, coarse/fine support, morphology, pose, material persistence, JSON/ZIP and stale/unknown recipe rejection. Diagnostics record sampled gap deficit and attachment error; these are not full-mesh or clinical accuracy guarantees.
- Ruling: expose connections/contact as optional controls in the existing inspector — preserve existing projects and make additional computation explicit — old projects require opt-in to receive these corrections.
- Ruling: resolve the upper wall superficial-to-deep before the lateral stack — the real regression showed a 27 mm cyclic gap deficit when transversus pushed rectus outward after pectoral separation — no blanket rearward abdomen shift is used.
- Ruling: solve contact when a pose slider is released while keeping attachment corrections live — avoid repeated contact work during pointer input — intermediate dragging is a kinematic preview.
- Ruling: keep the consolidated plan as the progress/ruling ledger and perform review in the main agent — explicit user prohibition on subagents and existing repository MVP policy override workflow scaffolding/delegation — no separate review agent or duplicate tracking directory.
- Remaining: measured calibration, complete pelvic subregions/femoral support, anatomical FK/IK and animation adapters, deep fascia/cavity behavior, continuous collision, shear/material constitutive laws, and body-wide expansion. Contact can change generated volume; final volume metrics report the resulting discrepancy rather than claiming simultaneous exact volume/contact convergence.

### Continuation — plausible pelvic and thoracic support geometry

- Visual review (JavaScript-driven, reduced captures) found a flat rectangular sacrum, no ischium, an open ribcage and pectoral fans sunk 2–6 cm into the ribs/cartilages. Cause of the last: human fitting scales each muscle uniformly while bones compress locally.
- Sacrum is now a curved wedge whose alae meet the iliac auricular region, with coccyx, ischial bodies/tuberosities and pubic bodies (`sacrum`, `coccyx`, `ischial_tuberosity_*`, `pubic_body_*`). Existing named supports (ilium wing, crest, rami, acetabular rim) are unchanged, so area bindings still resolve.
- Intercostal sheets (`intercostales_*`) close the thoracic wall between ribs, generated from the same continuous rib curves (`ribPoint`/`ribReach`).
- Pectoral fans rest on the generated cage: analytic floor (`ribCageFront`) on the authored path; on the human path `restOnThorax` lifts shell columns above the final fitted ribs/cartilages/sternum and thins them under the skin instead of piercing it. A cage-only build keeps muscle shape independent of layer visibility.
- Ruling: atlas data remain reference only; target is anatomically plausible appearance and function, not measured accuracy (user, 2026-10-29).
- Verified: build, `check-anatomy.mjs`, `check-lazy-cache.mjs`, priority fixture PASS. Pre-existing adipose showing through the shoulder/head skin was observed and not addressed.

### Continuation — abdominal wall below the pectorals

- Rectus and external oblique ran onto the chest at the same depth as pectoralis major (46 mm sampled overlap before the optional contact solve).
- Rectus top now slopes from the xiphoid (medial) to the fifth costal cartilage (lateral) (`rectusTop`), and the upper rectus and external oblique sink slightly under the pectoral border (`rectusTuck`). External oblique's medial top was lowered.
- `restOnThorax` now also rests pectoralis major on the upper rectus and external oblique. A cage-only build still keeps shape independent of layer visibility. Default overlap before contact: 26 mm; remaining overlap is resolved by the opt-in contact solve.
- Verified: build, `check-anatomy.mjs`, priority fixture PASS, skin unpierced in the front view.

### Continuation — pectoralis major rebuilt for hypertrophy

- Root causes found: on the human body the internals were built at pectoral volume 1 and only translated by the same field as the skin, then shrunk uniformly to fit inside the skin; thickness stayed ~1.4 cm at any volume. Three separately tapered heads read as shards, ends missed the generated clavicle/humerus, and the rib-rest lift was stepped.
- `anatomicalPectoralFan` is now one continuous fan: a shared origin parameter (lateral clavicle → sternum → 6th/7th cartilages) split into the existing three named meshes with coincident edges and blended head gains; twisted humeral insertion; deep surface on the analytic ribcage; thickness grows outward with volume. Each head's across-direction matches the attachment locators.
- Human path: the pectoral is generated at its real volume (`pectoralMuscle`), excluded from the skin's pectoral field and from the uniform fit (soft local fit near the tendon only). Its ends are seated by default on the generated clavicle, sternum, cartilages and humerus (`snapPectorals`, one-shot, reusing the attachment locators) before `restOnThorax`. The rest lift is dilated and blurred; the skin cap applies everywhere except the humeral tendon.
- Measured sternal-head maximum thickness: 1.3 cm at 0.4×, 2.0 cm at 1×, 3.2 cm at 2.5×. Skin unpierced at 1× and 2.5× in the front view; arm abduction stretches the fan toward the humerus.
- Verified: build, `check-anatomy.mjs`, `check-lazy-cache.mjs`, priority fixture PASS. Not checked: phone layout (geometry only), every pose preset, skinModel 1 (authored path keeps the analytic floor but no snap).

### Continuation — abdominal wall toward the reference écorché

- Compared with a user-supplied écorché reference: the external oblique was a thin strip shrunk inside the ribcage (uniform whole-muscle fit of a sheet that wraps to the back), and the anterior aponeurosis sheet hid the lower rectus.
- `externalObliqueMesh`: fleshy lateral belly grown outward from the internal oblique, bulge over the iliac crest, digitated upper border reaching ribs 5–8 under the pectoral, medial muscular border sweeping laterally towards the ASIS; same name and grid orientation for attachments.
- External oblique, internal oblique and transversus use the soft local fit (as bones) instead of the uniform shrink.
- `abdominal_aponeurosis` now spans only from the rectus lateral border to the oblique's muscular border, so the rectus bellies show through as in the reference.
- Verified: build, `check-anatomy.mjs`, `check-lazy-cache.mjs`, priority fixture PASS; skin unpierced with oblique 2×. Sampled IO/EO gap before contact is 28 mm (resolved only by the opt-in contact solve). Not yet: puffier rectus blocks, narrower intersections/linea alba, oblique fiber direction in the shader.

### Continuation — rectus bellies and tendinous grooves

- Rectus segments now have domed plateau profiles, fill more of their width, keep a wider infra-umbilical belly and have deeper grooves at the intersections; base thickness raised (max ~17 mm per segment at default). Generated left rectus baseline volume rose from ~82 to ~139 cm³; edits still normalize to their targets.
- `seatInRectusGrooves` (human path) seats the linea alba along the medial rectus edges and the intersections just below the belly domes, after fitting, since each mesh was previously scaled separately.
- External oblique bulge now ramps up from its aponeurotic border instead of forming a cliff beside the rectus.
- Verified: build, `check-anatomy.mjs`, `check-lazy-cache.mjs`, priority fixture PASS. Visual review in front and grazing views on desktop only.

### Continuation — lower abdomen and pubic transition

- Rectus insertion narrowed to a ~2 cm tendon on the pubic crest/symphysis with a curved lateral rise; infra-umbilical belly tapers from mid-height. Added `pyramidalis_L/R` (otherMuscles) in front of the lower rectus.
- Skin: inguinal groove depth now fades over the medial third towards the pubis; a low mons pubis mound placed from the pubic landmark (`humanBindY(anatomy(p).pubis)`) joins the grooves, replacing the flat horizontal suprapubic edge.
- Ruling: default fat parameters left unchanged — non-zero defaults would create an adipose shell for every new body and change existing behavior.
- Future humanoid GLB fitting (P11): the new mound is landmark-driven, but `regionalEnvelopeDelta` still contains mannequin-specific heights (e.g. 8.72, 9.55, 10.39) that should become landmark-relative before fitting.
- Verified: build, `check-anatomy.mjs`, `check-lazy-cache.mjs`, priority fixture PASS; front skin and muscle views on desktop.

### Continuation — thoracic frame, serratus, pelvic sections and fibers

- Committed the preceding work as `5bab0d4` (algorithm demo, its docs/licence edits and supplied packages left uncommitted).
- Sternum is a flattened plate (manubrium, body, xiphoid) via elliptic `tube` sections; ribs 8–10 cartilages join the cartilage above to form the costal margin (`costal_cartilage_8..10`).
- Serratus anterior: eight edge-to-edge digitations from the lateral ribs converging towards the scapula, slightly deep to the external oblique (`serratus_anterior_N`).
- Pubic rami, pubic bodies, ischium, ilium, crest and acetabular rim fit as wholes (`rigidPelvicBone`) so local compression no longer flattens them; the sacrum keeps local fitting.
- Fiber phase via `setShellFibers`: pectoral stripes run origin→insertion; serratus and pyramidalis gained fibers. External oblique and rectus keep the shader's procedural directions.
- Not done: a separate translucent anterior rectus sheath — all aponeuroses share one material/opacity, so a covering sheet would hide the rectus at default opacity; needs its own structure/material first.
- Anatomical statements here come from general anatomical knowledge, not verified sources; numeric values remain heuristic.
- Verified: build, `check-anatomy.mjs`, `check-lazy-cache.mjs`, priority fixture PASS; desktop visual review.

### Fix — asymmetric skin after linked individual rectus edits

- Cause: left meshes are mirrored, which reverses winding, so their normals point inwards. `transferSurface` sampled only forward-facing normals, i.e. the anterior rectus face on the right but the deep face on the left; with growth the deep face moves the other way, so the left skin dropped up to the 0.25-unit transfer cap.
- Fix: orientation is detected per surface (normals against the centroid) before filtering. Worker reproduction: skin L/R difference 0.249 → 0.008 units; in the app 0.5 mm with width/depth 1.5, volume 2, fullness .3, profile .5 linked.
- Mirrored winding remains elsewhere; it is harmless where normals are recomputed or not used for facing (render culling is off).

### Continuation — mesh orientation at the source and Body page structure

- `mesh()` orients every generated mesh by signed volume, so mirrored (left) generators no longer produce inward normals; the per-consumer facing workaround in `transferSurface` was removed. Authored body: 0 inverted meshes; human path: 3 tiny vertebral-process tubes crushed nearly flat by fitting (volume ~1e-6), not a mirroring issue. Skin symmetry unchanged (0.008 units).
- Body page reorganized from `src/anatomy/bodyLayout.ts` (DOM-free data): regions Overview, Chest, Abdomen, Pelvis, Back, Arms, Legs, Fat; each region splits into Shape / Muscles / Bones (only parts with content). Muscles show a muscle picker, "Both sides" controls, then a "Per side" inspector (portion switch, side switch, link). Hip bone per side lives under Pelvis → Bones.
- Overview holds whole-body controls, base surface, profiles, tissue connections (attachments/contact, formerly repeated in the per-muscle inspector), inspection/views, parameters and the atlas.
- Tapping the body selects chest/back/arms/abdomen/pelvis/legs/fat. `bodyPageInfo` removed from the catalogue; unused translations removed. `check-anatomy.mjs` asserts every geometry control appears exactly once in the layout.
- Region chips use one scrolling row; the duplicated single-row chip rules of the library were merged into one shared rule.
- Verified: build, `check-anatomy.mjs`, `check-lazy-cache.mjs`, priority fixture PASS; anatomy fixture passes all panel checks and then waits on `readPixels`/capture, which need real frames the hidden pane does not provide. Desktop and 375×812 checked; no horizontal overflow.

### Fix — Body page names, spacing and stability

- Duplicate names for different controls renamed: thickness multipliers (`lowerFat`, `pubicFat`, `flankFat` → "… fat thickness") vs localized deposits (`lowerAbdominalFat` → "Lower abdominal pouch", `suprapubicFat` → "Suprapubic fat pad", `flankFullness` → "Love handles"). Fat region split into Regional thickness / Fat deposits. No duplicate control names remain in English or Portuguese.
- Accordions and scroll: `renderPanel` (all panels) keeps open/closed sections when re-rendering the same view; the region row no longer uses `scrollIntoView`, which also scrolled the panel up after every rebuild. Verified scroll and open sections hold through a rebuild in Overview, Abdomen → Muscles and Fat.
- Spacing: segmented switches inside a panel body align with other controls; collapsible section headings share one style (uppercase label, chevron) instead of the browser triangle. The anatomy bubble uses short A/B buttons with full accessible names (`button(…, { name })`) and no longer overflows on phones.
- Verified: build, `check-anatomy.mjs`, `check-lazy-cache.mjs`, priority fixture PASS; 375×812 audit of every region/part found no overflowing elements.

### Continuation — pectoral and shoulder measured against a reference écorché

- Reference: user-supplied écorché GLB (BodyParts3D CC BY 4.0 + Z-Anatomy CC BY-SA 4.0; derivative CC BY-SA 4.0, attributed in THIRD_PARTY_LICENSES.md). Used only for measurements in the editor; no mesh is bundled. Overlaid in the same scene (same metric scale: sternum 1.238–1.399 m vs ours 1.258–1.411 m).
- Measured gaps: pectoral lowest point 1.178 m (6 cm below xiphoid) vs ours 1.264; deltoid medial edge x 0.083 vs 0.150; our clavicle and shoulders wider and chest shallower (base mannequin, unchanged).
- Pectoral abdominal part now arises from the rectus sheath well below the xiphoid (not attached to cartilages); thickness distribution follows the reference (thin sternal origin, lateral belly, thin inferior edge). Lower border now within 1–4 cm of the reference profile.
- Deltoid rebuilt as one continuous cap (`anatomicalDeltoid`: anterior/middle/posterior spans of one origin line from the clavicle's lateral part over the acromion along the scapular spine, wrapping the humeral head to the tuberosity), soft-fitted, trunk-to-arm mapping blend via the shared `armBlend`. Medial edge 0.088 m vs reference 0.083.
- Limit: the pectoral's outer surface is capped under the mannequin skin, so its convexity follows the skin (≈30 mm projection) rather than the reference (15–57 mm). Closing this needs the covering to follow the muscles by default.
- Verified: build, `check-anatomy.mjs`, `check-lazy-cache.mjs`, priority fixture PASS; skin intact at pectoral/deltoid 2× except a small armpit spot.

### Withdrawn — selectable reference skeleton (never committed)

- Removed on the user's decision of 2026-10-30 (see the following entry): the skeleton option, `referenceBones.ts`, `public/anatomy/ecorche-bones.bin`, its worker/body/UI/PWA wiring and the bone-mesh extractor. Kept: `scripts/anatomy-reference/glb.mjs` (GLB reader for measurement extraction). The notes below record what was learned.

- User decision (2026-10-30): offer the écorché's bones as an alternative skeleton (Body → Overview → Skeleton: procedural / reference écorché). This ships derived bone surfaces (CC BY-SA 4.0, attributed), resolving the P04 approval row.
- `scripts/anatomy-reference/extract-bones.mjs` (with the shared `glb.mjs` reader) writes `public/anatomy/ecorche-bones.bin`: 212 bones, 60.6k vertices, 1.1 MB, simplified with meshoptimizer, quantized to 0.1 mm, plus landmarks, source, license and checksum. Runtime-cached on first use, not precached.
- `referenceBones.ts` registers the bones into authored space by landmarks (limbs segment by segment, trunk by notch/pubis/joint widths, skull by bounds), then they follow the same body mapping and pose as procedural bones; they are not squeezed into the skin. Procedural bones remain attachment supports (`supports`, posed but not drawn) when attachments are on. Mesh orientation shares `orientOutward` with `mesh()`.
- First registration (authored space) was wrong: authored space is larger than the mannequin, and procedural bones only fit because they are compressed into the skin afterwards; exempted reference bones pierced the skin (ribs, skull).
- Fixed as the first piece of P14: `registerReferenceBones` registers into the body itself — height piecewise through the body's joints, limbs segment by segment onto its joints, trunk and skull inscribed in a lean version of its skin with a heuristic soft-tissue margin by direction. The skeleton now resembles the mannequin by default and follows the proportion controls (ribcage 25.7 → 27.4 cm, pelvis 22.6 → 26.0 cm with chest 40 / hips 41).
- FORMA docs (A/B/C) describe anatomy-first only: bones → attachments → muscles → fascia → fat → skin, with the skin as the resulting envelope moved by a cage, and they forbid syncing skin by a global scale. Fitting to an existing skin is not covered there (C only warns against naive auto-rigging and cites Model Warper); P14–P16 cover it.
- Remaining: muscles still rest on the procedural skeleton, so they and the reference bones are not yet co-registered; bone edits do not yet drive the skin (P15).
- Verified: build, `check-anatomy.mjs` (now also the reference path: count, side, symmetry), priority fixture; visual front view and arm pose.

### Decision — the écorché informs a richer procedural skeleton (2026-10-30)

- Review of the selectable reference skeleton: even registered into the mannequin, the skull does not fit the head, and hands, feet and posing are wrong. Rigid reference meshes cannot follow our heuristic pose fields, our controls or a different body, and muscles cannot attach to them.
- Decision (user): use the écorché as the **reference for a more complex procedural skeleton** that supports the muscles, instead of drawing its bones. This restores the FORMA rule (no ready-made atlas geometry as the final model) and fits P14–P16: one procedural skeleton, registered by landmarks, controllable, with named attachment surfaces.
- What is extracted from the écorché becomes numbers per bone, in each bone's landmark frame: lengths, axis curvature, cross-section profiles along the axis, articular head/socket radii, landmark positions (ASIS, crest, acetabulum, glenoid, epicondyles, malleoli…), rib centre paths and sections, vertebra dimensions per level, scapula/ilium/sternum outlines. The bone meshes are not shipped.
- The extraction tool (`scripts/anatomy-reference/`) stays as the offline source of those measurements and of residual reports (procedural bone vs reference bone).
- Lessons kept from the withdrawn option: register by the body's joints and inscribe the trunk in its skin (not in authored space); orient mirrored meshes at creation; keep procedural supports for attachments.

### Method — building procedural structures from the reference écorché

The repeatable way to turn the écorché into procedural anatomy, as used for the pectoral, deltoid and trapezius. The same steps build the planned écorché-derived procedural skeleton (bones first, then the muscles attached to them).

1. **Read the reference.** `scripts/anatomy-reference/glb.mjs` reads the GLB (BodyParts3D + Z-Anatomy, CC BY-SA 4.0): one named mesh per structure (FMA ids in `extras`), quantized positions in meters, +x is anatomical left (mirror to our −x), Y up, Z forward. For a visual check, copy the GLB temporarily to `public/`, load it with `editor.addFromUrl`, set its root to the origin and show it beside or over our body (same metric scale), then delete the copy.
2. **Measure in the same scene and units.** Compare reference and generated structures with world-space scripts, normalized to bony landmarks (sternal notch, xiphoid, C7, acromion, humeral head, ASIS, pubis): bounding extents, border profiles (lowest/highest point per lateral bin), thickness/projection over the underlying layer per (x, y) bin, and attachment positions as fractions along the bones.
3. **Choose the generator family by architecture, not by mesh.** Fan (pectoral, trapezius), cap (deltoid), strap/segmented (rectus), sheet (obliques), long/flat/irregular/vertebra/rib for bones. One continuous parametrization per muscle; anatomical parts (heads/portions) are spans of it that share edges, with blended gains, so they read as one belly and individual controls never open a step.
4. **Drive the parametrization with the measurements.** Origins and insertions from landmarks/attachment fractions; border curves and thickness distribution from the measured profiles; fibers along the parametrization (`setShellFibers`). Keep names/orientation that attachments expect; declare `armBlend` for structures crossing trunk→arm.
5. **Integrate with the pipeline.** Orientation is automatic (`mesh()`); choose the fit (soft local for wrapping sheets/caps, none for structures placed by landmarks); rest on underlying layers where needed (`restOnThorax`-style), keep the skin limit unless "skin follows muscles" is on.
6. **Re-measure and record residuals.** Repeat step 2; report residuals per structure in this ledger (e.g. pectoral lower border within 1–4 cm, deltoid medial edge 8.8 vs 8.3 cm). Visual front/side/back checks, skin intact at 2× growth, pose, build, worker check and priority fixture.
7. **Provenance.** Derived numbers are labelled `derived` with the source; attribution stays in THIRD_PARTY_LICENSES.md. No reference mesh is shipped.

**Skeleton specifics (planned).** Per bone, in its own frame (joint centres + anatomical axes): length, axis curvature, cross-section profile along the axis, articular head/socket radii, named landmarks; per rib a centre path and section; per vertebra its level dimensions; outlines for scapula, ilium and sternum. Generate with the matching family, register into the body by its joints and skin (never in authored space), expose per-bone controls and named grids for attachments, then re-attach muscles to the new bones. Lesson from the withdrawn reference-skeleton option: rigid imported bones cannot follow our controls, pose or another body; the écorché must stay a measurement source.

### Continuation — trapezius from the reference écorché

- Previous trapezius: one sheet from about T-level 11.35 to 15.06 (authored), not reaching the occiput or acromion, thin and partly under the posterior ribs.
- `anatomicalTrapezius` builds one fan with three parts sharing edges — descending (superior nuchal line + nuchal ligament → lateral clavicle), transverse (C7–T3 → acromion and scapular spine), ascending (T3–T12 → root of the spine) — with a tendinous diamond at C7, neck fibers that stay on the neck until shoulder level, per-part growth (`trapeziusUpper/Middle/Lower`), fibers, soft local fit, and resting on the ribs like the pectoral.
- Residuals (m, one side): descending 1.413–1.579 vs reference 1.413–1.581; transverse 1.357–1.423 vs 1.377–1.457; ascending 1.139–1.405 vs 1.128–1.416. Lateral reach ends at our acromion (x 0.20; reference 0.13–0.16, our shoulders are wider). Skin intact at back 2×.
- Still exposed on the back (outside the trapezius): scapulae and lateral ribs, covered on the reference by infraspinatus, teres, rhomboids and latissimus, which remain older shapes. A slight fold remains at the base of the neck.

### Continuation — hypertrophy and genetics for the large muscles

- Muscles page: each large muscle group now has **Hypertrophy** (chronic growth per part, both sides, existing `individualGrowth` keys) and **Genetics, per side** (the shared per-side shape: width, depth, volume, belly position, profile, activation). Genetics extended from 6 to 31 templates (deltoid, trapezius, latissimus, biceps/brachialis, triceps, glutes, quadriceps, adductors, hamstrings, calves, tibialis anterior) with FORMA visual-seed profiles; one mesh→template table in `priority.ts`. Worker check normalizes all 31 within 2% at defaults and extremes on both skins.
- Skin response, one mechanism: per-part hypertrophy uses the same volume fields as the group sliders (`humanVolumeFields`), one field per procedural muscle along its own origin→insertion; muscles generate at neutral growth (`humanVolumeBase`) like group sliders. Pectoral and rectus keep their existing direct growth and skin relief unchanged (`directGrowthKeys`). Skin displacement at 2.5×: deltoid 16 mm, trapezius 8, biceps 16, gluteus maximus 34, rectus femoris 18, gastrocnemius 21 (pectoral 18 and rectus 6, unchanged).
- Rejected: a parallel growth path through the per-side shaping step (would duplicate the muscle–skin interaction and change the pectoral/rectus behaviour).
- Fiber striations: an option (Material → Anatomical surface details → Fiber striations), saved with the body; default density lowered to about 40%.
- Trapezius neck fin fixed: on the neck the muscle follows the neck surface instead of the occipital depth.

### Continuation — back and scapular muscles from the reference écorché

- Shared `fanMuscle` builder (origin line, insertion line, surface placement, thickness, spans) plus `onBack` placement; the new back muscles use it instead of hand-written fans. Pectoral, deltoid and trapezius still have their own builders — moving them onto `fanMuscle` is a pending DRY step.
- Rebuilt from measurements: latissimus dorsi (T7–sacrum via the thoracolumbar fascia, posterior iliac crest, lower ribs → intertubercular groove, twisted, aponeurotic medially), rhomboids minor/major (C6–T5 → medial border), supraspinatus and infraspinatus filling their fossae → greater tubercle, teres minor and major. Insertions blend from trunk to arm mapping (`armBlend`). Scapula named as a support; these muscles rest on ribs/scapula and are soft-fitted.
- Residuals (m, one side, reference vs ours): latissimus 0.936–1.340 vs ≈0.95–1.36; rhomboids 1.262–1.461 vs 1.278–1.45; infraspinatus 1.280–1.406 vs 1.286–1.397; supraspinatus 1.381–1.414 vs 1.396–1.409; teres major 1.263–1.360 vs 1.286–1.357.
- Hypertrophy: new `latissimusDorsi` growth key; skin response through the same volume fields (`backMuscleAxes` supplies the latissimus axis). Genetics: rhomboid minor/major, supraspinatus, infraspinatus, teres minor/major added (37 templates, all normalized within 2%). Back muscles page: Trapezius, Latissimus dorsi (with teres major), Rhomboids, Rotator cuff.
- Skin limit fixes: above the shoulders the cap measures from the neck/head skin group's own centre (the trapezius pierced the back of the neck by 8–10 mm); tendons into the arm are exempt only while inside the arm's skin (armpit piercing reduced to small marks).
- Known: in arm-raised poses muscles over the scapula show through the skin — internal muscles pose by position heuristics while the skin uses the base model's rig weights. Proposed fix: transfer rig weights from the skin to internal meshes (one rule for every muscle).

### Continuation — erector spinae and thoracolumbar fascia (divided lower back)

- The reference's divided lower back comes from the erector spinae columns (y 0.90–1.44 m, about 4 cm thick lumbar) under the white thoracolumbar fascia diamond (y 0.93–1.16, x ≤ 0.077). Ours had no erector spinae, so the latissimus aponeurosis lay flat.
- Added erector spinae as one strap with longissimus (medial) and iliocostalis (lateral) parts, built with `fanMuscle`, from sacrum/iliac crest to ribs and upper thoracic vertebrae (ours 0.92–1.43 vs 0.902–1.444). Added the thoracolumbar fascia as an aponeurosis (pale material) from T10 to the sacrum out to the latissimus' muscular border.
- Layering: `restOnThorax` runs in passes — erector on ribs (kept 11 mm under the skin), superficial muscles on the erector, fascia on the latissimus; `restOnThorax` gained clearance/skin-margin parameters. Result: the fascia drapes over two columns with the spinal groove between.
- Hypertrophy: new `erectorSpinae` growth key and field axis; genetics for longissimus and iliocostalis (39 templates). Back page: Erector spinae group.
- Known: small skin show-through at the waist and sacrum with erector 2.5×; a few red specks under the fascia's lower corners.

### Continuation — gluteals and their connection to the pelvis and core

- Reference (world m, our sacrum is 3.4 cm higher and 3.7 cm shallower than the reference's): gluteus maximus x 0–0.144, y 0.741–1.008, z to −0.126 (1.4 cm behind the sacrum, reaching the sacrum and coccyx at the midline, 12 cm below the sacrum); medius y 0.863–1.025; minimus y 0.857–0.997; tensor fasciae latae x 0.127–0.161, y 0.833–0.993. Ours were ellipsoids: maximus started 4.5 cm off the midline, was not behind the sacrum and was 5 cm short.
- Rebuilt all four with `fanMuscle` on a new placement, `onButtock` (the pelvic loft section, x kept and depth from the section like `onBack`, both fiber ends blending onto bone). Maximus: posterior crest → PSIS → sacrum → coccyx, upper half into the iliotibial tract, lower half on the gluteal tuberosity, thinning toward the cleft. Medius and minimus: iliac crest/wing → greater trochanter. TFL: ASIS → iliotibial tract, which now starts where TFL and maximus join it (below the trochanter) instead of at the ASIS.
- Result: maximus x 0.002–0.152, y 0.812–1.024, z to −0.118; medius, minimus and TFL within 1–2 cm of the reference bounds (relative to the sacrum).
- The trunk registration scales each height by the scanned section, which rippled these sheets; `relaxShell` smooths each shell layer over its grid after registration (borders kept). They are fitted locally against the leg cage, which includes the buttock skin.
- Hypertrophy through the existing fields (lowerMuscles axes kept for gluteusMaximus/Medius/Minimus/tensorFasciaeLatae; the ellipsoids are no longer rendered). Skin at 2.5×: maximus 34.5 mm, medius 24.5 mm, TFL 8.3 mm; no show-through. Genetics: new templates gluteus_minimus and tensor_fasciae_latae (41 templates); per-side volume verified.
- Known: the coccyx tip shows through the skin at the cleft (bone, unchanged here); a small window at the greater trochanter between maximus, medius and TFL where the reference has the gluteal aponeurosis; pose (hip flexion) not yet checked.

### Continuation — measured abdominal wall (switchable with the legacy sheets)

- Reference (relative to the sacrum and sternum): external oblique's free posterior border about 4 cm in front of the sacrum; internal oblique's muscular part ends at the costal margin (about 1.10 m) and its lowest fibers arch over the inguinal ligament; transversus wraps back to the thoracolumbar fascia. The reference meshes include their aponeuroses down to the linea alba and pubis.
- Ours were sheets with no attachments or fiber direction. The internal oblique climbed laterally to 1.24 m and the transversus stopped short of the back.
- New `abdominalModel` parameter: 1 (default, also for projects without the field) builds the wall with `fanMuscle`; 0 keeps the legacy sheets unchanged. Body → Abdomen → Muscles has the "Abdominal wall" switch.
- `onTrunk` placement: fans interpolate (theta, y, extra inset) and lie on the trunk surface, so fibers wrap the flank.
- External oblique: eight digitations on ribs 5–12 → aponeurosis border (eoInner), inguinal ligament (its aponeurosis forms it) and anterior iliac crest.
- Internal oblique: lateral inguinal ligament, iliac crest, thoracolumbar fascia → pubic crest (conjoint arch), semilunar line, costal margin and rib 12.
- Transversus: thoracolumbar fascia, costal cartilages, crest and lateral inguinal ligament → semilunar line, horizontal fibers.
- Muscular borders, mesh names and layers are those of the legacy sheets, so the abdominal aponeurosis, rectus and its intersections, linea alba, inguinal ligament, tissue contact, skin relief and genetics are all shared. Inguinal metrics unchanged.
- Results:
  - The external oblique's posterior border is 3.5 cm in front of the sacrum (reference 4 cm).
  - The internal oblique and transversus reach 0.92 m at the inguinal arch (reference 0.88 m).
  - Skin hypertrophy with obliques at 2× is 30.6 mm in both models, with no show-through.
  - Genetics at 1.8× on one side changes that side only.
- Tendinous (`tissue`) flags stay narrow at the fiber ends: they only lower the shaping weight, and wide flags broke the genetics volume target.
- Refinement: `eoMuscleBorder` is the one muscular border of the external oblique (beside the rectus sheath, then sweeping down to the ASIS). The fans end on it, and the abdominal aponeurosis (new model) reaches it, so the pale aponeurosis fills the triangle above the inguinal ligament as in the reference. The external oblique reaches the inguinal ligament through its aponeurosis.
- Pose: trunk rotation 35° with hip flexion 70° keeps the wall and aponeurosis continuous, with no skin show-through.

### Continuation — thigh muscles attached to the pelvis

- Our pelvic bones differ from the reference: our pubic symphysis is about 4.5 cm higher and 6 cm further forward, and our ischial tuberosity is 5 cm more lateral. Muscles attach to our drawn bones and are corrected relative to them (an écorché-derived pelvis remains the planned skeleton work).
- Missing: psoas major (reference: lumbar spine at 1.17 m → under the inguinal ligament → lesser trochanter). Added `psoasMajor`, a spindle from T12–L4 beside the vertebral bodies, along the pelvic brim, under the inguinal ligament lateral to its midpoint, to the lesser trochanter. Result: y 0.858–1.209, x 0.014–0.101 (reference 0.809–1.173, 0.007–0.114). It replaces the pelvic iliopsoas ellipsoid; the `iliopsoas` growth axis now runs from T12. It is exempt from the whole-muscle torso fit, which collapsed it.
- Origins moved onto our landmarks:
  - hamstrings → ischial tuberosity (they were 2–6 cm above it);
  - adductor magnus → ischiopubic ramus;
  - gracilis and adductor brevis → inferior pubic ramus;
  - pectineus → pecten pubis.
- Sartorius named (`sartorius_L/R`) with a growth key, a field axis and a fuller belly (the old strap was 3 mm thick).
- Genetics: new templates psoas_major, iliacus, sartorius, pectineus, gracilis, adductor_brevis (now 47). Legs page: a new Hip flexors group, and more adductor templates.
- Checks:
  - Skin clean with psoas, sartorius and gracilis at 2.5×, and with hip flexion 100°.
  - Genetics at 1.8× on one side: psoas 158 vs 102, sartorius 5.1 vs 3.1 mm thick.
- Known:
  - The pelvis itself is still the legacy procedural one; the adductor and hamstring bellies are still ellipsoids (origins fixed only).
  - Iliacus is still an ellipsoid in the iliac fossa.

### Continuation — pelvis rebuilt from the reference écorché

- Reference landmarks, relative to the femoral head centre (sphere fit, radius 2.27 cm): ASIS (+4.3, +8.4, +6.0) cm, pubic tubercle (−7.2, −0.8, +5.8), PSIS (−4.2, +9.7, −7.8), crest top 14.6 cm above, ischial tuberosity lowest at −5.9 cm; the acetabulum opens laterally, inferiorly and slightly forward.
- Ours: the ASIS matched within 0.5 cm, but the pubic tubercle sat 2.2 cm lower and 3 cm further forward, and the old ilium was short (crest top about 10 cm above the hip centre).
- Method (the planned écorché-derived skeleton, first part):
  - About 150 control points are stored in `data/pelvisReference.json`: crest curve, a 7×7 ilium mid-surface with thickness, the obturator ring with radii, the acetabulum, and 7×5 sacrum rows.
  - `pelvisMap` maps them onto our own landmarks (hip joint, ASIS, pubic tubercle, PSIS). x scales from the midline; (y, z) is an exact affine map with a term in |x|, so it stays symmetric and serves the sacrum too.
  - Each bone is a smooth union of capsules and thick triangles (`primitiveBone`), meshed by `polygonize`, which gained an explicit box.
- Keeping the skin, inguinal region and muscles:
  - Landmarks are unchanged.
  - `capToSkin` pulls in only vertices outside every body section (trunk or either leg). The old whole-mesh fit crushed the pelvis toward the midline.
  - The hamstring and adductor origins read the tuberosity from the same map (`ischialTuberosity`).
  - Attachment patches keep their supports: the ilium mid-surface and the superior ramus are emitted as gridded `ilium_wing_*` and `pubic_ramus_*` meshes inside the bone, refined by `supportDetail`.
- Cost: the measured pelvis is cached on its landmarks, tilt and support detail, and blends only the two nearest primitives. A full regeneration is within noise of the legacy pelvis (about 1.6 s vs 1.5 s here).
- Results:
  - No bone shows through the skin or the muscles from any probed view.
  - Hip-bone genetics (width 1.2 on the right) changes the right side only.
  - Body → Pelvis → Bones → Pelvis switches back to the legacy primitives (`pelvisModel` 0, default 1). `check-anatomy` builds both.
- Known:
  - The surfaces are smoother but coarser than the reference (sparse reference mesh, about 4.5 mm grid).
  - Our landmarks tilt the measured pelvis slightly forward, so the pubic symphysis is its lowest point instead of the tuberosity.
  - The sacrum is a simplified plate.
  - Femurs are still the legacy rods.

### Continuation — rounded pubic finish

- Compared with the user's reference render, our lower abdomen ended in a V: the aponeurosis stopped beside the rectus, the lower rectus ends tapered to points, and the pubic bones showed between the two inguinal ligaments. The measured crest also rose 3–4 cm above the muscles' crest line.
- `pubicSheath` (measured abdominal wall only): the lower anterior rectus sheath from one inguinal ligament to the other. It closes over the pubic symphysis below the rectus, and its upper border is a rounded U.
- The measured ilium is compressed above the ASIS so its crest top sits 1 cm above the muscles' crest line (`anatomy.crest`).
- For the bone only, the pubic tubercle maps 1.2 cm deeper and 1 cm higher than the inguinal ligament's end, nearer the ASIS plane as in the reference. The abdominal wall and sheath now pass in front of the pubis, and the forward tilt of the pelvis is smaller.
- The redundant ASIS sphere was dropped, since the crest already ends there. The skin cap margin is now 6.5 mm.
- Checks: no show-through at rest or with pubis height 0.8 and suprapubic fat 0.8, and the inguinal controls still respond.
- Known:
  - The anterior iliac crest still shows at the flanks beside the external oblique; it is subcutaneous in reality, but the reference covers it.
  - There is a hairline gap at x = 0 between the left and right linea alba and sheath halves.

### Continuation — rounded mons pubis (skin)

- The user meant the skin at the genital region, which ended in a sharp point. On the authored surface the midline front dropped from z 1.00 at y 9.0 to 0.54 at the crotch (y 8.6), behind the inner thighs (0.57–0.78 at x 0.2–0.4): the pubic area receded into a wedge between the thighs.
- `humanShape` gained a mons pubis pad on the midline just above the crotch, scaled by the pubic fat control. The midline now reads 1.05 → 0.92 → 0.72 from y 9.0 to 8.6, a rounded U, and pubic fat 2.5 gives a fuller mons.
- Unchanged: the inguinal folds and the procedural surface (`skinModel` 1). Hip flexion 90° deforms cleanly.

## 2. Verified current state and the gaps that matter

Planning baseline: branch `codex/anatomy-materials-ux`, commit `26331fe` (`Integrate FORMA v5 anatomy controls and pose`), preceded by `0e6831b` (native PBR anatomy integration).

The working tree separately contains the algorithm-demo integration and its documentation/translations, algorithm sources, supplied extracted packages/ZIP files, its browser check, and the first plan. At inspection, `src/core/editor.ts`, `src/ui/panels/add.ts`, `src/core/i18n.ts`, `docs/anatomy.md` and `THIRD_PARTY_LICENSES.md` contain that unrelated or supporting uncommitted work. Recheck status before execution; do not stage, reset or remove it incidentally.

| Owner / source | Verified reusable behavior | Remaining gap |
|---|---|---|
| [Parameters](src/anatomy/parameters.ts), [catalogue](src/anatomy/catalogue.json), [migration](src/anatomy/migration.ts) | 103 scalar parameters including skin selection; optional local growth and pose; legacy-name normalization | Flat parameters cannot describe independent side/portion/patch/intersection arrays comprehensively |
| [Geometry](src/anatomy/geometry.ts) | `anatomicalPectoralFan`, `anatomicalRectusMeshes`, `anatomicalRectusTendons`, `anatomicalIliacWing`, `anatomicalPelvicRidges`, regional envelope transfer | Approximate locations/curves; no data-driven anatomical joint graph, stable area attachments or tissue-contact solve |
| [Body controller](src/anatomy/body.ts), [worker](src/anatomy/anatomy.worker.ts), [contract](src/anatomy/contracts.ts) | Job coalescing/stale rejection, typed buffers, stable materials, actual posed vertices, history, A/B, duplicate, exchange | Need structured semantic state, dependency-aware partial rebuilding and a bridge between algorithms and live body |
| [Anatomy pose](src/anatomy/pose.ts) | Twelve joint-field controls and nine presets; actual vertex deformation, stable rest-space UVs | Heuristic fields, no anatomical FK/IK graph, wrapping or physical contact |
| [Atlas](src/anatomy/atlas.ts), [atlas data](src/anatomy/atlas.json), [structures](src/anatomy/structures.ts) | 123 muscle, 49 bone and 22 joint reference records; growth support and aggregates identified; ten rendering/material structures | Catalogue counts are not individually generated structures; `otherMuscles`/`bones` are rendering aggregates |
| [Materials](src/anatomy/material.ts), [fat](src/anatomy/fat.ts) | Native PBR/optional details and separate approximate fat envelope | Covering thickness is not yet a contact-aware anatomical tissue stack |
| [Anatomy panel](src/ui/panels/anatomy.ts), [UI shell](src/ui/ui.ts), [project](src/core/project.ts) | Object / Body / Layers / Pose / Material, atlas, JSON v7, ZIP/autosave, native material editing | Need a contextual inspector by actual structure, scope and side without multiplying global tabs |
| [Algorithm engine](src/anatomy/algorithms/engine.ts), [types](src/anatomy/algorithms/types.ts) | Per-muscle build, changed-bone dependencies, mesh diagnostics | Accepts explicit meshes and point attachments, not A's semantic locator records; not connected to the parameterized body |
| [Attachments](src/anatomy/algorithms/attachments.ts), [fitting](src/anatomy/algorithms/fitting.ts) | Triangle/barycentric point attachment and affine segment fitting | A point is not an area; triangle IDs become invalid when generated topology changes; affine fit does not generate irregular bone shape |
| [Loft](src/anatomy/algorithms/loft.ts), [math](src/anatomy/algorithms/math.ts) | Fusiform/strap loft, rotation-minimizing frames and approximate target volume | Two built-in radius curves; A's custom area profiles, sheets/fans, separate tendons and regional growth are not implemented there |
| [Wrapping](src/anatomy/algorithms/wrapping.ts), [paths](src/anatomy/algorithms/paths.ts) | Sphere/infinite-cylinder routes, bone-bound via points, side hysteresis and route audit | Protects centerline clearance; does not guarantee that the generated muscle surface clears the obstacle |
| [SDF](src/anatomy/algorithms/sdf.ts), [XPBD](src/anatomy/algorithms/tetraXPBD.ts), [skin preview](src/anatomy/algorithms/skinPreview.ts) | Analytic obstacle SDF/grid, tetrahedral volume constraint, non-destructive local skin preview | No arbitrary-bone SDF conversion, complete material/contact solver, activation model or calibrated skin transfer |
| [Algorithm demo](src/anatomy/algorithmDemo.ts) | Builds three synthetic bones/one muscle, imports a static GLB through normal editor services | Demonstration only; do not route the live procedural body through repeated GLB export/import |
| [Generic Poser](src/animation/pose.ts), [humanoid map](src/rigging/humanoid.ts), [retarget](src/animation/retarget.ts) | Shared FK/IK math, mirror, joint overlay integration, humanoid animation mapping | Animation bones are not a complete anatomical skeleton; generic Rigger remains unsuitable as an anatomy/contact substitute |

Review evidence already obtained, not completion of future steps:

- All 13 supplied algorithm tests passed against the active `src/anatomy/algorithms/` modules, which matched the supplied algorithm package at inspection.
- The synthetic demo's generated muscle volume was about 1.72% below its target in that run. This is one engineering sample, not universal accuracy.
- An additional synthetic sphere/loft case produced about 4.35 mm of surface penetration despite a routed centerline. P07 must reproduce and fix this class of failure; centerline clearance alone cannot satisfy acceptance.
- A contains 123 profile records but 10 distinct normalized area curves. Profile-specific aspect/bend/seed values can differ; these are not 123 measured shape curves.
- The [calibration report][a-coverage] labels 36 cohort-mean volumes, 15 group-derived volumes and 72 unavailable values supplied with visual seeds. Its [limits document][a-limits] says section shapes and attachment coordinates were not empirically digitized. These are package classifications, not an independent revalidation of every transcription.

## 3. Consolidated architecture and data adoption

### 3.1 One live body, several representations

Keep `AnatomyBody` as lifecycle/controller owner. Extend it with a typed anatomical definition and generated rest state; do not build a second editor or a competing collection of standalone scene entities.

`Definition + reference coefficients → bone surfaces/features → semantic attachment patches → muscle/tendon recipes → rest tissue support → joint pose + activation → routes/deformation/contact → fat/skin transfer → Babylon buffers`.

Reference coefficients and optional measured anatomy are prepared offline. Runtime uses compact validated data, incremental worker jobs and ordinary Babylon meshes/materials. Render objects are disposable outputs; `.babalon` stores the parameterized definition, versions and pose.

Keep existing fans, sheets, shells and segmented rectus recipes. Reuse the implemented loft/path/math components where appropriate. Extend `algorithms/loft.ts` for arbitrary section-area profiles; add a typed bridge for existing fans/sheets rather than forcing every muscle through an elliptical tube.

Proposed production owners, created only as a working increment needs them:

- `src/anatomy/definition.ts`: structured state/identities and per-structure control descriptors.
- `src/anatomy/dataBridge.ts`: immutable A/B records → validated region definitions, evidence and unit conversion.
- `src/anatomy/regions/abdomen.ts`, `src/anatomy/regions/pelvis.ts`, `src/anatomy/regions/pectoral.ts`: typed priority recipes and specific constraints, extracting existing kernels gradually.
- `src/anatomy/attachmentPatches.ts`: stable semantic patch IDs and surface sampling/resolution.
- `src/anatomy/skeleton.ts`: rest frames, anatomical joints and attachment owners.
- `src/anatomy/tissueSupport.ts`: regional support, contact/sliding and transfer to the current skins.
- `src/anatomy/data/priorityRegions.json`, then regional packs: compact audited coefficients and source mappings.
- Existing `body.ts`, `contracts.ts`, `anatomy.worker.ts`, `parameters.ts`, `migration.ts`, UI panels and `core/project.ts`: lifecycle and real app entrypoints.

Extend existing modules rather than creating empty abstractions. Share this plan's stable contracts with the broader first plan; do not implement both module inventories independently.

### 3.2 Source-to-runtime mapping

| Input | Actual use | Required adaptation |
|---|---|---|
| [A muscle records][a-muscles], [profiles][a-profiles], [measurements][a-measurements] | Template IDs, architecture, profile/volume candidates, provenance | Resolve per-side instances; distinguish measured/group-derived/visual seed; convert cm³ to m³ |
| [A bones][a-bones], [bone recipes][a-bone-profiles], [sites][a-sites] | Dimensions, anatomical features and provisional locator hints | Generate procedural surface; resolve semantic region to a stable patch; do not use normalized coordinates as world positions |
| [B families][b-families], [routes][b-routes], [growth][b-growth] | Recipe selection, dependency/route classes and growth contract | Implement missing algorithms; JSON descriptions are not an executable solver |
| [B bone overrides][b-bones], [joint overrides][b-joints] | Required bone features and frame/coupling intent | Build the priority pelvic/thoracic/shoulder frames and calibrate their signs/positions |
| [B contact][b-contact], [correctives][b-correctives], [invalidation][b-invalidation] | Explicit local tissue pairs, corrections and affected-stage rules | Implement bounded geometry-aware updates in the live controller/worker |
| [C integration][c-contract], [adoption][c-adoption], [UX][c-ux] | State ownership, compatibility and native controls | Apply to the verified local app; public-main audit and generic proposed tab names do not supersede current code |
| BodyParts3D / image sections / published measurements | Future calibration of sections, depths and landmarks | Audited offline acquisition/measurement, registration and reconstruction checks; keep source geometry outside runtime output |

Default external reference: [BodyParts3D](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html), subject to its [version-specific attribution](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html). [Visible Human](https://www.nlm.nih.gov/research/visible/visible_human.html) can support cross-sectional checking. [MyoGeneratorRemix](https://github.com/MiguelDLM/MyoGeneratorRemix) informs curve/attachment construction; [OpenSim models](https://github.com/opensim-org/opensim-models) inform source-specific routes and joint conventions; [Model Warper](https://docs.opensimcreator.com/manual/en/latest/the-model-warper.html) informs later fitting. [Tetrament](https://github.com/zalo/Tetrament) is an optional physics reference, not a required dependency or reason to add Three.js. Research-only models/checkpoints are not bundled by default. Verify the exact asset/data license before distributing derived packs; no new paid source is necessary.

### 3.3 Priority coverage and meaningful controls

| Priority region | Structures to connect first | Individual controls and relationships |
|---|---|---|
| Abdomen | Left/right rectus; intersections; linea alba and rectus sheath; external/internal obliques; transversus; relevant aponeuroses; pyramidalis variant; quadratus-lumborum support; lower ribs/costal margin, pubic and lumbar attachment regions | Per-side belly width/depth/length profile; total volume and regional distribution; independently positioned/angled/curved/partial-depth intersections; attachment extents; bilateral linking; abdominal cavity projection distinct from subcutaneous fat |
| Pelvis | Left/right hip bone with ilium/ischium/pubis subregions, sacrum, pubic symphysis, SI relationships, acetabula; proximal femoral heads; inguinal ligament; iliacus/psoas paths; proximal gluteal/adductor support | Per-bone/side width/depth, iliac-wing flare/contour, crest/ASIS height/spacing, pubic geometry and acetabular orientation; joint/attachment continuity; pelvic pose distinct from rest morphology |
| Pectoral/thoracic | Clavicle, sternum, relevant individual ribs/cartilage, scapula and proximal humerus; pectoralis major clavicular/sternocostal regions with current sternal/costal visual subdivisions; pectoralis minor, serratus and deltoid/latissimus boundary support | Per-side/portion volume, distributed origin area, fiber convergence, belly profile, insertion/tendon width and regional fullness; shoulder movement; coherent costal/rectus transition and axillary concavity |

Do not invent a third empirically measured pectoralis head from the HTML's three visual portions. Preserve A's canonical clavicular/sternocostal template identities and represent sternal/costal subdivisions under the latter. Rectus visible segments are bellies within the paired rectus system, not independently invented muscles. Pelvic fused subregions may be shaped separately without pretending they articulate as separate adult bones.

### 3.4 Target architecture: one anatomy, any body, both directions

Lessons from the priority work: every visible defect so far came from the anatomy being fitted *to the mannequin* after generation — uniform shrink inside the skin flattened muscles, local compression flattened bones, the skin cap removed hypertrophy, and region code hard-codes mannequin heights (e.g. 8.72, 12.66, 13.05). Those are symptoms of a missing layer, not of individual recipes.

```
reference GLBs ──(offline extraction)──► templates (landmark space)
                                              │
controls ─► definition ─► generators ─► anatomy in TEMPLATE space (rest)
                                              │  registration warp W(target)
                                              ▼
                          anatomy in BODY space ◄── landmarks of the target body
                                              │  skin↔tissue binding (fat thickness)
                                              ▼
                       target skin = rest skin + Δ(anatomy edited − anatomy rest)
```

1. **Template space.** Muscles and bones are generated in one canonical, metric, right-handed space defined by anatomical landmarks (jugular notch, xiphoid, pubic symphysis, ASIS, acromion, humeral/femoral heads, C7, joint centres). Generators read landmark-relative coordinates only; no new code may use mannequin heights. Existing hard-coded values migrate region by region.
2. **Templates from references.** An offline tool (`scripts/anatomy-reference/`) reads the user's écorché GLB (muscles and bones), registers them to template space by landmarks and writes compact data (`src/anatomy/data/templates/*.json`, attributed): for muscles, origin/insertion areas, centre path and a thickness/offset grid on our generator parametrization (as done by hand for the pectoral and deltoid); for bones, resampled landmark-normalized surfaces or patch grids. Controls still act on generator parameters, so growth, side links, attachments and pose keep working. Measured values are labelled `derived` with source and checksum.
3. **Registration.** A target body supplies landmarks (mannequin: authored once; imported humanoid: from its rig via `rigging/humanoid.ts` + `bodyLandmarks.ts` + manual correction). A smooth warp W (per-region affine + RBF/TPS, bones rigid per segment) maps template space to body space. This replaces `fitHumanInternal`'s whole-muscle shrink and per-vertex compression.
4. **Skin↔tissue binding.** Each skin vertex is bound once at rest to the underlying superficial tissue (nearest muscle/bone surface sample, normal and fat thickness). *Drive*: when anatomy changes, the skin moves by the bound surface's displacement from rest, smoothed over the skin and attenuated by fat — the general form of today's "skin follows muscles" switch, without creases. *Fit*: when the body is given, fat thickness and muscle depth are solved so the rest anatomy lies inside the skin with plausible covering (bounded, with confidence and manual correction).
5. **Both directions, one engine.** The mannequin becomes the first target body. "Skin limits anatomy" and "skin follows anatomy" are two settings of the binding, not separate code paths. Imported GLBs keep their original mesh; the driven mesh is a derived, reversible result.

Consequences for existing steps: P04 becomes reference template extraction; P07's covering work moves into P15's binding; P11 becomes the imported-body target of P14–P16; P09/P10 expansion waits for P14–P15 so new regions are written once against templates and landmarks.

## 4. Cross-cutting invariants

1. **Identity:** retain A template IDs; instantiate `.L`/`.R` and indexed instances as appropriate. Render group IDs such as `bones`, `rectusAbdominis` and `otherMuscles` remain compatibility/material aliases, not the semantic identity of every structure. Labels are never keys.
2. **State:** add optional versioned `definition`/per-structure overrides, pose/activation and comparison snapshots while preserving existing flat parameters/import aliases. Define precedence once: versioned defaults → scoped group input → explicit individual override → development distribution → pose/activation. Do not apply a gain twice.
3. **Units:** new algorithm/data space is right-handed meters/radians/m³; legacy kernels use 10 cm coordinates and UI fields often cm/degrees. Convert once at an explicit adapter. Test anatomical left/right, normal winding and scene transforms. Do not reapply `body.ts` legacy height scaling to meter-space outputs.
4. **Stable attachments:** store `owner + semantic patch + normalized patch coordinates + surface revision`. Triangle/barycentric samples are resolved/cache data. Re-resolve after topology changes; transform cached samples only when their topology remains valid. Support bone and soft-tissue owners and distributed/multiple attachment areas.
5. **Geometry:** area profiles are areas, not radii. For ellipse sections derive radii from area and width/depth ratio, integrate along arc length and check realized mesh volume. Nonellipse/fan/sheet geometry requires its own volume calculation. Tendon volume/extents are separate from belly growth.
6. **Growth and motion:** chronic growth changes rest target volume/distribution; activation changes temporary appearance within a declared volume budget. Pose changes joint/path state, not rest dimensions. Recompute from rest, never repeatedly deform already-posed output.
7. **Tissues:** hidden structures still constrain visible tissue. Requested render layers are distinct from mechanical dependencies. Clearance includes muscle/tendon thickness, not only centerline clearance. Preserve permitted anatomical overlap; constrain explicitly modeled contact pairs rather than all layers globally.
8. **Skins:** preserve the authored skin's source connectivity/detail/UV/material data. The alternative procedural skin retains its own regeneration behavior; version transfer bindings when its topology changes. No atlas-skin replacement. Transfers derive from source/rest buffers, avoid cumulative drift and remain independent between bodies and A/B.
9. **Data quality:** use `measured`, `derived`, `heuristic`, `unresolved` per value/region. Published cohort means are not one measured individual. Never convert unavailable volume to zero or relabel an illustrative profile/point as measured. Store source/version/checksum and assumptions.
10. **Worker/cache:** jobs carry monotonically increasing request IDs plus definition, data, topology and pose revisions. Cancel/reject stale results, preserve last valid output on failure and expose localized retry/diagnostics. Cache fits and regional data once per update; current `makeFits()` per muscle and full mesh audits per live frame need selective scheduling before body-wide animation.
11. **Editor lifecycle:** use `beginEdit`/`endEdit` or an equivalent existing grouped action for one undo per gesture. Worker progress emits `activity`; persistent changes use current changed/autosave flow. Keep PBR material/texture identity and reuse buffers when topology is stable. No perpetual simulation loop for an idle body.
12. **Compatibility:** keep JSON v7/older aliases readable, `.babalon`, autosave, A/B, duplicate and static GLB working at every increment. Add a recipe/data version so old files do not silently acquire different anatomy; preview an upgrade on a duplicate. An unchanged stored source must reopen deterministically. No breaking project-version migration is planned.

13. **Body independence:** new generator code uses template-space landmarks, never coordinates of a particular skin. Registration is the only place that knows the target body.
14. **Skin from rest:** a driven skin is always rest skin + bound anatomical displacement, recomputed from rest each time; never accumulated, and the source asset is never modified.
15. **Reference provenance:** every template records source file, license, version/checksum and extraction parameters; derived data carries the source's attribution (CC BY-SA for the current écorché).

Engineering targets are acceptance budgets, not claims of biological accuracy: settled target volume error ≤2% for supported rest recipes and ≤5% in supported poses; resolved attachment distance ≤1 mm at standard adult scale; selected contact pairs ≤2 mm penetration after settle. Source-fit residuals are reported separately and must account for reference resolution/quality. If a target fails, fix the recipe or declare the affected case unsupported; do not hide failures by silently loosening thresholds.

## 5. Numbered implementation steps

New target paths are forecasts. A target file is created only when the step delivers its functioning behavior. Every step includes live UI and persistence integration for its own capability; P08/P13 consolidate rather than postpone those connections.

Dependency order (revised 2026-10-30): P00 → P01 → P02 → P03 establishes the priority structures; P04 extracts reference templates; P14 (template space + registration) → P15 (skin binding) → P16 (fit) make the anatomy body-independent; P05–P08 complete growth, pose, tissues and UX on those contracts; P11 applies them to imported humanoids; P09–P10 expand to the whole body using templates and landmarks. Execute P13 for a priority release after M3 and repeat only affected portability checks as later regions arrive. P11 and P12 are optional branches after their stated prerequisites, not blockers for P13 or core delivery. If a measured reference for P04 is unavailable, continue independent functional work with explicit heuristic quality while leaving its measured-data acceptance incomplete.

### P00 - Connect one editable rectus to the data and algorithm bridge

**Status:** VERIFIED — real worker, native individual inspector, side isolation, volume normalization, undo/redo, A/B, JSON/ZIP, both surfaces and JavaScript desktop/mobile checks.

**Objective**

Edit a real current-body rectus using a source-labeled A profile and individual parameters, then undo and save/reopen it without leaving the existing app.

**Required reading**

- [Current geometry](src/anatomy/geometry.ts): `anatomicalRectusMeshes`, `rectusBands`, shells and regional skin transfer; [body controller](src/anatomy/body.ts): `edit/change/commit`, `captureState/restore`, A/B and worker results.
- [A profiles][a-profiles], [A sites][a-sites], [B family definitions][b-families]: area-profile semantics, provisional evidence and segmented geometry.
- [Algorithm types](src/anatomy/algorithms/types.ts), [loft](src/anatomy/algorithms/loft.ts), [worker contract](src/anatomy/contracts.ts), [project](src/core/project.ts): actual consumers and integration boundaries.

**Target files**

New `src/anatomy/dataBridge.ts`, `src/anatomy/definition.ts`, `src/anatomy/regions/abdomen.ts`, `src/anatomy/data/priorityRegions.json`; `src/anatomy/parameters.ts`, `src/anatomy/migration.ts`, `src/anatomy/body.ts`, `src/anatomy/contracts.ts`, `src/anatomy/anatomy.worker.ts`, `src/ui/panels/anatomy.ts`, `src/core/project.ts`, `src/core/i18n.ts`; `scripts/fixtures/anatomy.html` for the critical path.

**Implementation to deliver**

Implement the smallest bridge for rectus records and left/right identities, including units and source quality. Drive the existing segmented shell recipe from an interpolated section-area profile, with independent width/depth and target volume; reuse algorithm integration/frame primitives where appropriate instead of using a spindle for the abdominal wall. Add a minimal Body inspector and additive state serialization. Keep other tissues on their current generators. Scope the bridge to used records and reject unresolved required inputs explicitly.

**Scope**

No complete atlas import, global rewrite, complete physics or synthetic GLB demo as a substitute. Existing visual seeds are allowed with explicit labels; this step does not claim newly measured abdominal geometry.

**Integration with the project**

Use Add → Anatomical body, the existing feature loader/worker and native materials. One generated body remains one entity. Persist new state through `AnatomyBody` and existing project/JSON flows from the first working edit.

**Minimum verification and stopping condition**

Create a body, change only the left rectus profile/volume, inspect actual buffers and a low-resolution front/side view, undo/redo, save/reopen and compare A/B. Build must pass. Stop once the data → generator → UI → project path works; do not wait for body-wide abstractions.

**Acceptance criteria**

- [x] A profile changes the actual existing body's procedural rectus, with quality visible and no atlas mesh replacement.
- [x] Side-specific values, native material and pose survive undo/JSON/ZIP.
- [x] Unchanged regions and both skin options remain usable.

## Milestone M1 - A data-driven abdominal edit in the product

**Proves:** A/B/C inputs and reusable algorithm primitives reach the current body through a complete user path. A schema, catalogue or static sample alone does not pass.

**Integrated verification:** Asymmetric rectus edit, actual generated sections/volume, source-quality label, native material, comparison and reopened project. Record visible limitations and continue.

### P01 - Make the pelvis an editable anatomical support with stable patches

**Status:** IN PROGRESS — named generated pelvic support and area bindings now survive proportion/topology changes and pose. Individual pelvic subregion controls, calibrated joint frames and explicit proximal femoral support remain pending.

**Objective**

Edit pelvic bones independently while hip relationships and abdominal/inguinal attachment areas follow the generated surface.

**Required reading**

- P00 structured state; [current geometry](src/anatomy/geometry.ts): `anatomicalIliacWing`, `anatomicalPelvicRidges`, pubis and pelvic transforms.
- [A bone profiles][a-bone-profiles], [A sites][a-sites], [B bone overrides][b-bones], [B joints][b-joints]: semantic features and provisional frames.
- [Attachment code](src/anatomy/algorithms/attachments.ts), [fitting](src/anatomy/algorithms/fitting.ts): current point/affine behavior and limits.

**Target files**

New `src/anatomy/regions/pelvis.ts`, `src/anatomy/attachmentPatches.ts`, `src/anatomy/skeleton.ts`; `src/anatomy/dataBridge.ts`, `src/anatomy/definition.ts`, `src/anatomy/data/priorityRegions.json`, `src/anatomy/algorithms/attachments.ts`, `src/anatomy/body.ts`, `src/anatomy/contracts.ts`, `src/anatomy/anatomy.worker.ts`, `src/ui/panels/anatomy.ts`, `src/core/i18n.ts`.

**Implementation to deliver**

Extract the existing curved pelvic recipes into typed ownership gradually. Generate identifiable left/right hip surfaces, sacral/pubic relationships, acetabular features and proximal femoral-head support. Add individual dimensions, wing/crest/ASIS/pubic and acetabular controls. Resolve source locators into sampled surface patches, cache triangle/barycentric samples by revision and re-resolve on topology change. Update connected rectus/aponeurosis/inguinal sites and affected hip-muscle endpoints without rebuilding unrelated regions.

**Scope**

Rest morphology and provisional calibrated-by-editor joint frames; no full lower-limb simulation. Treat fused pelvic subregions as shape regions, not free joints. Affine `fitBone` can transport a stable mesh but cannot replace the irregular-bone generator.

**Integration with the project**

Extend the same inspector, state and worker. Persist overrides/patch definitions and compute caches on restore; do not persist temporary triangle indices as the sole attachment identity.

**Minimum verification and stopping condition**

Widen one hip bone, change crest height and acetabular orientation; check surface attachments and proximal femoral relation before/after regeneration at another resolution. Undo/reopen. Stop when patches stay on their named surfaces and unaffected-side overrides are preserved.

**Acceptance criteria**

- [ ] Individual pelvic edits propagate to connected attachments and joints with recorded provenance.
- [ ] Topology changes do not silently attach tissues to unrelated triangles.
- [ ] No scene-object transform or unrelated entity is changed by local bone editing.

### P02 - Connect pectoral fans to thoracic and shoulder attachment areas

**Status:** IN PROGRESS — distributed clavicular/sternal/costal and humeral surface bindings are active in the existing fans; sampled rectus/pectoral separation is tested. Full shoulder routing and axillary boundary support remain pending.

**Objective**

Shape each pectoral side/portion and correct its relation to the upper abdomen using shared thoracic reference features.

**Required reading**

- P01 patch/frame contracts; [pectoral and abdominal kernels](src/anatomy/geometry.ts): `anatomicalPectoralFan`, `pectoralBase`, rectus upper geometry and costal support.
- [A muscles][a-muscles], [A sites][a-sites], [B routes][b-routes], [B families][b-families]: distributed origins, converging insertions and sheet/fan distinctions.
- [Materials](src/anatomy/material.ts), [controller](src/anatomy/body.ts): fibers, material ownership and named geometry metadata.

**Target files**

New `src/anatomy/regions/pectoral.ts`; `src/anatomy/regions/abdomen.ts`, `src/anatomy/attachmentPatches.ts`, `src/anatomy/skeleton.ts`, `src/anatomy/dataBridge.ts`, `src/anatomy/data/priorityRegions.json`, `src/anatomy/body.ts`, `src/anatomy/anatomy.worker.ts`, `src/ui/panels/anatomy.ts`, `src/core/i18n.ts`.

**Implementation to deliver**

Extend current fans with distributed clavicular/sternal/costal origins, a humeral tendon footprint and local section/thickness controls. Connect procedural sternum, relevant individual rib/cartilage features, clavicle, scapula and proximal humerus through typed frames. Keep the three current visual portions while preserving A's canonical parent identity. Define the costal/rectus boundary in common frames and remove duplicate legacy fragments for upgraded recipes. Include pectoralis minor and serratus/deltoid/latissimus boundary support needed to avoid a false axillary bridge.

**Scope**

Priority chest/abdomen continuity, not the complete arm inventory. Do not push the whole abdomen backward as a blanket overlap fix, and do not replace broad fans with generic tubes.

**Integration with the project**

Individual metadata, native materials and legacy group macros use explicit mapping. Regeneration preserves textures and edit focus. Save per-side/portion values through P00's state path.

**Minimum verification and stopping condition**

Change clavicular fullness, sternal/costal balance and tendon footprint independently. Inspect actual front/side/cross-sectional geometry against the reported abdominal-stacking case and record the corrected relationship. Undo/reopen with both skin choices.

**Acceptance criteria**

- [ ] Pectoral origins/insertion remain attached under chest/pelvic proportion changes.
- [ ] Abdomen/pectoral transition has coherent relative depth and attachment ordering in the reproduction case.
- [ ] Portion controls do not overwrite unrelated muscles or lose appearance settings.

### P03 - Complete the abdominal wall and editable tendinous architecture

**Status:** IN PROGRESS — costal/crest insertions, inguinal/aponeurotic linkage and rectus connective followers are active; individual intersections remain saved. Complete sheath/cavity architecture and calibrated variants remain pending.

**Objective**

Control the named abdominal layers and rectus intersections independently with continuous sheath/tendon relationships.

**Required reading**

- P00 rectus profile and P01/P02 shared support; [current abdominal kernels](src/anatomy/geometry.ts): `rectusBands`, `anatomicalRectusTendons`, oblique/transversus shells.
- [A muscles][a-muscles], [A sites][a-sites], [B soft tissues][b-soft], [B layer stack][b-stack]: connective owners and layer relationships.
- [Current layers](src/anatomy/structures.ts), [UI](src/ui/panels/anatomy.ts): visibility/material compatibility.

**Target files**

`src/anatomy/regions/abdomen.ts`, `src/anatomy/attachmentPatches.ts`, `src/anatomy/definition.ts`, `src/anatomy/dataBridge.ts`, `src/anatomy/data/priorityRegions.json`, `src/anatomy/parameters.ts`, `src/anatomy/migration.ts`, `src/anatomy/structures.ts`, `src/anatomy/body.ts`, `src/ui/panels/anatomy.ts`, `src/core/i18n.ts`.

**Implementation to deliver**

Add a versioned per-side intersection array: ordered normalized height, obliquity, curvature, width, lateral extent, depth fraction and completeness. Preserve the current count/stagger/height controls as scoped macros with explicit conversion. Maintain a paired rectus with connected sheath/linea alba rather than unrelated decorative blocks. Expose per-side oblique/transversus shape/thickness, aponeuroses and applicable pyramidalis variant; add quadratus-lumborum support and the required lower costal/lumbar attachment regions. Separate deep cavity projection, superficial lower-abdominal/flank/suprapubic coverage and muscle volume.

**Scope**

Partial tendon intersections are supported; never force every groove through full muscle thickness. No physiological abdominal-pressure or organ model is claimed.

**Integration with the project**

Use stable connective-tissue IDs and the existing PBR system. Variable intersection count changes only dependent topology/bindings and is one undoable action. Additive state preserves older projects and original controls.

**Minimum verification and stopping condition**

Create unequal left/right intersection layouts, including an incomplete angled intersection; alter an oblique independently and edit pubic height. Inspect continuity and layer ordering, save/reopen and reset one structure without resetting the body.

**Acceptance criteria**

- [ ] All listed abdominal layers and intersection properties are individually reachable and saved.
- [ ] Macro edits have defined precedence and do not erase unrelated overrides.
- [ ] No floating bellies, disconnected connective boundaries or accidental fat/muscle coupling in the selected cases.

## Milestone M2 - Connected abdomen, pelvis and pectoral anatomy

**Proves:** Priority regions share meaningful support, surfaces and attachments, with independent bone/muscle/connective controls.

**Integrated verification:** Asymmetric pelvic edit → rectus/inguinal attachments update → pectoral/abdominal boundary remains coherent → individual tendon/portion edits → undo/A/B/project reopen. Rest geometry and prototype quality are explicit; pose/contact calibration is still pending.

### P04 - Extract reference templates for priority muscles and bones

**Status:** IN PROGRESS — reference écorché received (BodyParts3D + Z-Anatomy, CC BY-SA 4.0). Pectoral lower border, deltoid origin and pectoral thickness distribution measured and applied by hand in the editor; the repeatable extraction tool and template files are pending. The same écorché also contains the bones (hip bones, sacrum, vertebrae, ribs/cartilages, sternum, clavicles, scapulae, humeri, femora…), so it is the single source for muscles and bones.

**Objective**

Turn the user's reference écorché into compact, attributed, landmark-normalized measurements that our procedural generators consume — first a richer procedural skeleton (decision 2026-10-30), then the muscles that attach to it — and report the residual against the reference.

**Required reading**

- Section 3.4; the "pectoral and shoulder measured against a reference écorché" ledger entry (method and measurements).
- [geometry.ts](src/anatomy/geometry.ts) generator parametrizations (`anatomicalPectoralFan`, `anatomicalDeltoid`, `anatomicalRectusMeshes`, `externalObliqueMesh`, pelvis/rib builders).
- THIRD_PARTY_LICENSES.md attribution for the écorché.

**Target files**

New `scripts/anatomy-reference/extract.mjs` (GLB reader, landmark registration, per-structure measurement) and `scripts/anatomy-reference/compare.mjs` (residual report); new `src/anatomy/data/templates/<structure>.json`; `src/anatomy/geometry.ts` (generators read templates); `scripts/check-anatomy.mjs` (template schema/provenance check); THIRD_PARTY_LICENSES.md.

**Implementation to deliver**

Name-map reference meshes to our structure IDs; register by landmarks. **Bones first:** per bone, measure in its own landmark frame (joint centres and anatomical axes) the length, axis curvature, cross-section profile along the axis, articular head/socket radii and named landmarks; rib centre paths and sections; vertebra dimensions per level; outlines of scapula, ilium and sternum. Procedural bone families (long, flat, irregular, vertebra, rib, short) generate from these numbers with named grids for attachments and per-bone controls. **Then muscles:** origin/insertion areas on those generated bones, centre path, border curves and a thickness/offset grid over our generator's (t, s) parametrization. No reference mesh is shipped. Generators use the template when present and the current heuristic otherwise. The compare script reports border/thickness/volume residuals per structure, as was done manually for the pectoral (lower border within 1–4 cm, deltoid medial edge 8.8 vs 8.3 cm).

**Scope**

Priority regions first (rectus, obliques, pectoral, deltoid, serratus; hip bone, sacrum, ribs/sternum, clavicle, scapula, humerus). The app never loads reference meshes. No claim of population accuracy: one reference individual.

**Minimum verification and stopping condition**

Extraction is deterministic (same input → same checksum); generated structures within declared residuals of the reference after registration; controls, side links, growth and attachments still work on templated structures; build and existing checks pass.

**Acceptance criteria**

- [ ] Repeatable extraction with provenance for every template.
- [ ] Priority structures generated from templates with reported residuals.
- [ ] Procedural skeleton generated from écorché measurements (trunk, pelvis, shoulder girdle and limbs first), with residuals reported per bone.
- [ ] Priority muscles attached to that skeleton.

### P14 - Canonical template space and landmark registration

**Status:** TODO

**Objective**

Generate anatomy in one landmark-defined template space and map it to a target body with a smooth registration warp, removing dependence on the mannequin.

**Target files**

New `src/anatomy/landmarks.ts` (landmark set, mannequin landmarks, frames) and `src/anatomy/registration.ts` (per-region affine + RBF/TPS warp, rigid bone segments); `src/anatomy/geometry.ts` (replace `fitHumanInternal`, `restOnThorax`-style post-fixes and hard-coded heights region by region); `src/anatomy/body.ts`; `scripts/check-anatomy.mjs`.

**Implementation to deliver**

Define the landmark set and the mannequin's landmarks once. Generators produce template-space geometry; registration maps it to the body. Migrate the priority regions first and keep outputs visually equivalent or better (compare against the reference report). Remove whole-muscle shrink/compression once registration covers a region.

**Minimum verification and stopping condition**

Priority regions render from template space on the mannequin with no regression in the reference residuals; no new hard-coded body heights; skin intact at default and at 2× growth; build, worker, fixture and phone checks pass.

**Acceptance criteria**

- [ ] Priority anatomy generated in template space and registered to the mannequin.
- [ ] Hard-coded mannequin heights removed from migrated regions.

### P15 - Skin↔tissue binding: drive the skin from the anatomy

**Status:** IN PROGRESS — test switch "Skin follows muscles" (Overview → Tissue connections) pushes fat and skin out of the superficial muscles via the shared `coverMuscles`; shows creases at muscle borders because the push is per-vertex and unsmoothed.

**Objective**

Bind each skin vertex at rest to the underlying tissue with a fat thickness, and move the skin by the anatomy's displacement from rest, smoothly, for any target skin.

**Target files**

New `src/anatomy/skinBinding.ts`; `src/anatomy/tissueContact.ts` (`coverMuscles` becomes a client of the binding); `src/anatomy/fat.ts`; `src/anatomy/anatomy.worker.ts`; `src/anatomy/body.ts`; UI setting already in `src/ui/panels/anatomy.ts`.

**Implementation to deliver**

Bind at rest (nearest superficial muscle/bone sample, normal, fat thickness); on edit, displace skin by the bound sample's rest→edited motion, smoothed over the skin graph and attenuated by fat; keep UVs/topology; recompute from rest. "Skin follows muscles" off = binding with skin-limited anatomy (current default); on = driven skin. Applies identically to both bundled skins and later to imported meshes.

**Minimum verification and stopping condition**

No creases at muscle borders at 2× growth; symmetric result; return to defaults restores the rest skin exactly; pose after drive has no drift; build and checks pass.

**Acceptance criteria**

- [ ] Smooth driven skin for the priority regions on both bundled skins.
- [ ] Exact return to rest; no cumulative drift.

### P16 - Fit the anatomy into a given body surface

**Status:** TODO

**Objective**

Given a body surface and its landmarks, solve the anatomy's registration, muscle depth and fat thickness so the rest anatomy lies plausibly inside the skin, with confidence and manual correction.

**Target files**

`src/anatomy/registration.ts`, `src/anatomy/skinBinding.ts`, new `src/anatomy/fitBody.ts`; `src/ui/panels/anatomy.ts` (landmark correction, confidence display).

**Implementation to deliver**

Landmark registration (P14) plus a bounded solve for regional fat thickness and muscle depth against the skin; per-region confidence; manual landmark/thickness correction. The mannequin is the first case (replacing its hand-tuned fitting); P11 applies it to imported humanoids.

**Minimum verification and stopping condition**

Mannequin fit reproduces the current look without skin piercing; a second synthetic body proportion (e.g. scaled/widened mannequin) fits without code changes; build and checks pass.

**Acceptance criteria**

- [ ] Fit works on the mannequin and a second proportion without body-specific code.
- [ ] Confidence and manual correction exposed.

### P05 - Apply individual and regional hypertrophy with controlled volume

**Status:** IN PROGRESS — separate volume/fullness/profile/activation, generated volume metrics and paired-shell normalization. Longitudinal growth and calibrated physiology remain pending.

**Objective**

Grow priority muscles/portions while controlling the distribution of added volume independently of anatomy, fat and activation.

**Required reading**

- P00/P02/P03 recipes and P04 coefficient contract; [B growth][b-growth]: area redistribution and tendon exclusions.
- [Loft](src/anatomy/algorithms/loft.ts), [diagnostics](src/anatomy/algorithms/diagnostics.ts): existing integration and realized volume.
- [Controller](src/anatomy/body.ts): `setGrowth`, profiles, comparison and existing group controls.

**Target files**

`src/anatomy/algorithms/loft.ts`, `src/anatomy/algorithms/types.ts`, `src/anatomy/algorithms/engine.ts`, `src/anatomy/regions/abdomen.ts`, `src/anatomy/regions/pectoral.ts`, `src/anatomy/definition.ts`, `src/anatomy/body.ts`, `src/ui/panels/anatomy.ts`, `src/core/i18n.ts`.

**Implementation to deliver**

Extend loft architecture with sampled section-area/aspect profiles, using arc length and shape-aware numerical normalization. Share the volume operation with fan/sheet/segmented recipes through an explicit evaluator rather than pretending all geometries are ellipses. Add per-side/portion target-volume ratio and positive proximal/distal/medial/lateral distribution fields, renormalizing final realized volume. Keep attachment areas, tendon extent and intersection identity fixed unless edited as morphology. Add temporary activation inputs with distinct saved semantics and bounded visual response.

**Scope**

No training-to-growth or force estimate. Source-derived group splits remain estimates, and changing distribution must not silently change total volume.

**Integration with the project**

Map old group/local growth controls into the same resolved operation. Growth invalidates affected muscle/support/skin, not bone geometry or unrelated structures. Preserve complete A/B and individual reset semantics.

**Minimum verification and stopping condition**

Generate 1.0×/1.25×/1.5× priority muscles using segmented, sheet and fan recipes; test distribution changes at fixed target and volume budget. Reopen without gains applying twice. Inspect visible shape changes beneath both skins.

**Acceptance criteria**

- [ ] Supported rest recipes meet the declared volume budget, including regional/portion edits.
- [ ] Growth, baseline anatomy, fat and activation remain separate and independently reversible.
- [ ] Attachment/tendon dimensions remain coherent after growth.

### P06 - Connect anatomical posing to the priority structures

**Status:** TODO

**Objective**

Pose trunk, pelvis and shoulder support while the priority muscles follow their real attachment owners and paths.

**Required reading**

- P01/P02 rest frames and P05 volumes; [B joints][b-joints], [B routes][b-routes], [B motion contract][b-pose]: dependent shoulder/spine/hip movement.
- [Current anatomy pose](src/anatomy/pose.ts), [generic Poser](src/animation/pose.ts), [humanoid map](src/rigging/humanoid.ts), [retarget](src/animation/retarget.ts): actual APIs and animation entrypoints.
- [Paths](src/anatomy/algorithms/paths.ts), [engine](src/anatomy/algorithms/engine.ts), [pose panel](src/ui/panels/pose.ts), [JointOverlay](src/ui/jointOverlay.ts): reusable geometry/math and UI.

**Target files**

`src/anatomy/skeleton.ts`, `src/anatomy/pose.ts`, `src/anatomy/attachmentPatches.ts`, `src/anatomy/algorithms/paths.ts`, `src/anatomy/algorithms/engine.ts`, `src/anatomy/body.ts`, `src/anatomy/contracts.ts`, `src/anatomy/anatomy.worker.ts`, `src/animation/pose.ts`, `src/animation/retarget.ts`, `src/ui/panels/pose.ts`, `src/ui/panels/anatomy.ts`, `src/core/project.ts`.

**Implementation to deliver**

Add a narrow optional anatomical pose adapter and named joint graph. Implement pelvic tilt/hip support, distributed lumbar/thoracic flexion/extension/lateral bend/twist, and clavicle/scapula/humerus coupling needed for pectoral movement. Transform patches and via points by their owners, rebuild affected paths and preserve target volume. Map existing twelve-control presets into supported anatomical motions; retain legacy pose mode/version for older files and non-upgraded regions. Reuse generic joint math/overlay/presets through adapters, and route gizmos, sliders, animation and restore through the same hooks.

Define exclusive deformation ownership or normalized transition masks at mixed legacy/upgraded boundaries. Never apply a legacy trunk/shoulder field on top of the same anatomical movement twice. Rest buffers remain the common source, and shoulder/hip seam motion is checked during interpolation, not only at pose endpoints.

**Scope**

Priority joints first; no independent second rig fighting the imported-model animation system. Generic skin-weight Rigger remains excluded for generated anatomy. Current heuristic pose is a fallback, not evidence of solved anatomical motion.

**Integration with the project**

Expose the anatomical humanoid subset separately from fine bone IDs. One pose action is one undo step; save joint coordinates, not only deformed buffers. Hiding tissue does not change pose dependencies.

**Minimum verification and stopping condition**

Arm at 0°/90°/overhead, trunk flexion/twist and hip flexion with pelvic tilt; interpolate between poses and check attachment/path continuity, left/right signs and posed volume. Reopen a posed edited body; repeat an ordinary imported-rig pose as a non-regression check.

**Acceptance criteria**

- [ ] Priority muscles follow all modeled joints they cross, without editing rest anatomy.
- [ ] Scapular/thoracic/pelvic support updates once through shared pose ownership.
- [ ] Existing pose controls and imported rigs remain usable; unsupported ranges report quality honestly.

### P07 - Resolve priority contact and propagate through fat and both skins

**Status:** IN PROGRESS — opt-in sampled triangle-surface contact and shared covered/lean transfer work on both skins and selected poses. Protected attachment ends are excluded explicitly. Full fascia, continuous collision, material behavior and simultaneous volume/contact convergence remain pending.

**Objective**

Prevent demonstrated muscle/bone and dominant-layer penetration and make covering tissues respond to morphology, growth and pose.

**Required reading**

- P05 volume and P06 pose/path outputs; [wrapping](src/anatomy/algorithms/wrapping.ts), [SDF](src/anatomy/algorithms/sdf.ts), [skin preview](src/anatomy/algorithms/skinPreview.ts): current capabilities and known thickness gap.
- [B contact][b-contact], [correctives][b-correctives], [layer stack][b-stack], [fat rules][b-fat]: explicit pair/corrective intent.
- [Current fat](src/anatomy/fat.ts), [geometry](src/anatomy/geometry.ts), [body](src/anatomy/body.ts): current skin topologies, buffers and rendering lifecycle.

**Target files**

New `src/anatomy/tissueSupport.ts`; `src/anatomy/algorithms/wrapping.ts`, `src/anatomy/algorithms/sdf.ts`, `src/anatomy/algorithms/skinPreview.ts`, `src/anatomy/regions/abdomen.ts`, `src/anatomy/regions/pelvis.ts`, `src/anatomy/regions/pectoral.ts`, `src/anatomy/fat.ts`, `src/anatomy/body.ts`, `src/anatomy/contracts.ts`, `src/anatomy/anatomy.worker.ts`, `src/anatomy/data/priorityRegions.json`.

**Implementation to deliver**

Add thickness-aware path clearance plus a final muscle-surface contact audit/correction against explicit local bone/tissue proxies. Support the priority irregular surfaces through bounded sampled SDF or direct surface queries, not a claim that current analytic spheres/cylinders fit every bone. Build continuous regional tissue support and bounded sliding/tether constraints. Transfer it independently to the authored and procedural skin; add fat thickness above fascia and keep cavity projection separate. Preserve axillary concavity, pectoral/rectus depth order, inguinal folds and lower-abdominal compression. Reuse skin-preview math only as an initial bounded transfer, extending it where it fails rather than labeling it physical contact.

**Scope**

Local declared pairs and supported poses; no all-pairs full-body FEM. Source skin/material data remain untouched. Last valid geometry remains visible when a solve fails.

**Integration with the project**

Worker computes affected neighborhoods; cache rest bindings by topology revision. During drag perform a bounded update and settle after commit. Expensive quality is opt-in, never an automatic image-resolution reduction. No idle simulation/autosave loop.

**Minimum verification and stopping condition**

Reproduce the synthetic centerline-clear/surface-penetrating case and audit the corrected **surface**. Sweep selected priority poses at baseline/enlarged muscles and thin/thick fat; log declared pair penetration, layer ordering, volume and skin transfer drift. Review low-resolution front/side/cutaway images and timing on stated hardware.

**Acceptance criteria**

- [ ] Selected surfaces, not merely paths, meet declared contact budgets and volume limits.
- [ ] Both skins follow changes without cumulative drift, UV/material loss or replacement by atlas geometry.
- [ ] Hidden structures still constrain the result and failed/stale jobs cannot overwrite valid newer output.

### P08 - Finish the priority-region anatomy inspector and diagnostics

**Status:** IN PROGRESS — the native inspector adds attachment/contact toggles, standard/fine support, clearance and diagnostics. Whole-body control coverage and complete anatomy-first selection remain pending.

**Objective**

Make individual priority anatomy understandable through the existing touch-first UI, with clear group, side and edit-domain scope.

**Required reading**

- P00–P07 live controls; [C UX][c-ux], [C adoption][c-adoption]: existing-shell ownership.
- [Current anatomy panel](src/ui/panels/anatomy.ts), [DOM](src/ui/dom.ts), [shell](src/ui/ui.ts), [context bar](src/ui/contextBar.ts), [material panel](src/ui/panels/material.ts): components and routes to reuse.
- [Styles](src/ui/style.css), [translations](src/core/i18n.ts): phone, hiding and language requirements.

**Target files**

`src/ui/panels/anatomy.ts`, `src/ui/panels/material.ts`, `src/ui/panels/pose.ts`, `src/ui/ui.ts`, `src/ui/contextBar.ts`, `src/ui/style.css`, `src/core/i18n.ts`, `src/anatomy/definition.ts`, `src/anatomy/body.ts`, `docs/anatomy.md`.

**Implementation to deliver**

Retain Object / Body / Layers / Pose / Material. In Body use Bones / Muscles / Other tissues, prioritize Abdomen / Pelvis / Pectoral region filters, search and a flat structure list; selected structures open the same inspector with a breadcrumb/back action. Muscle controls distinguish Anatomy / Development / Activation; bone morphology and Pose remain distinct. Add bilateral linking, inherited/individual override status, group macros with explicit membership, per-structure reset and numeric units. Link direct 3D selection, layer isolation and native PBR material access by semantic identity. Diagnostics optionally show patches, routes, pivots, contact errors and data quality without permanently cluttering the scene.

**Scope**

No nested menu maze, new global dock tool, parallel editor or duplicative physics/material controls. Preserve original profiles, mixing, A/B, lighting, inspections, images and exchange. Collapsed expensive details stay unbuilt.

**Integration with the project**

Reuse `slider`, `chips`, `segmented`, `select`, `toggle` and existing UI contexts. Preserve slider focus during asynchronous updates; translate every visible string. H hides new overlays. Group material inheritance and per-structure overrides use stable native materials, not a material per triangle.

**Minimum verification and stopping condition**

At 1280×900 and 375×812: edit left pelvic bone → asymmetric rectus intersection → pectoral portion growth → pose → isolate → standard material → undo/reopen. Check translated search, scrolling, keyboard focus, ≥36 px targets and context/panel bounds with JavaScript; review reduced images only for visuals.

**Acceptance criteria**

- [ ] All priority controls are reachable and scopes are clear without duplicate owners.
- [ ] Shared groups are not presented as independently generated muscles.
- [ ] Desktop/phone layout, continuous editing and hide-interface behavior work.

## Milestone M3 - Priority regions function as one anatomical system

**Proves:** Abdomen, pelvis and pectoral region can be shaped, grown, posed and covered by interacting tissues through the native UI, with calibrated versus provisional data clearly distinguished.

**Integrated verification:** Pelvic morphology → changed attachments → asymmetric abdominal architecture → pectoral regional growth → arm/trunk/hip pose → thickness-aware contact → both skins → native material → undo/A/B/JSON/ZIP. Record source-fit, volume/contact/attachment metrics and affected-region timings. A convincing neutral rendering alone does not pass.

### P09 - Expand to the back, upper limbs, neck and head

**Status:** TODO

**Objective**

Apply the proven structure/recipe/pose pipeline to individually editable upper-body anatomy, especially previously grouped back muscles.

**Required reading**

- M3 contracts and [first plan's whole-body inventory](anatomical_generator_evolution_implementation_plan.md): preserve coverage goals without repeating its old step order.
- [A muscles][a-muscles], [A bones][a-bones], [B routes][b-routes], [B joints][b-joints]: source templates, groups and unresolved data.
- [Current kernels](src/anatomy/geometry.ts), [algorithm loft](src/anatomy/algorithms/loft.ts), [retargeting](src/animation/retarget.ts): remaining generated structures and shared animation APIs.

**Target files**

New `src/anatomy/regions/back.ts`, `src/anatomy/regions/upperLimb.ts`, `src/anatomy/regions/headNeck.ts`, `src/anatomy/data/upperBody.json`; `src/anatomy/dataBridge.ts`, `src/anatomy/definition.ts`, `src/anatomy/skeleton.ts`, `src/anatomy/pose.ts`, `src/anatomy/tissueSupport.ts`, `src/ui/panels/anatomy.ts`, `src/core/i18n.ts`.

**Implementation to deliver**

Implement named back muscles/portions including latissimus, trapezius, rhomboids, erectors/deep stabilizers and cuff; individual arm heads, forearm muscles/tendons, hand bones/intrinsics and fine pose; cervical/cranial bones, neck and facial/masticatory structures. Reuse fans/sheets/lofts by actual architecture. Add radius/ulna rotation and regional joint constraints. Expand catalogue groups where the source aggregates structures, recording exact new versioned IDs and missing evidence rather than claiming complete coverage from 123 template rows. Deliver each region through the same inspector, materials, skin transfer and saved state.

**Scope**

No anatomy inference from external skin. Whole-body completeness follows an expanded per-structure/side/head ledger; small/deep gaps remain explicit and cannot be hidden by a group name.

**Integration with the project**

Use the existing worker/cache/pose adapter. Keep unrelated regions functional while their source recipes remain on legacy versions. No independent hand/head editor.

**Minimum verification and stopping condition**

Edit latissimus without changing trapezius; pose overhead shoulder, elbow/forearm, wrist/fingers and neck/jaw; inspect representative measured fits and supported contacts. Confirm independent edits and pose survive reopen. Stop regionally when its ledger and critical path pass.

**Acceptance criteria**

- [ ] Generated upper-body entries have individual meaningful controls and declared evidence.
- [ ] Multi-head/multi-joint and distributed attachments update correctly.
- [ ] Back controls no longer depend exclusively on a shared `back` scale.

### P10 - Expand to lower limbs, feet and remaining deep structures

**Status:** TODO

**Objective**

Complete whole-body procedural coverage using the priority pelvis as the lower-body support.

**Required reading**

- P01/P06 pelvis/hip graph, M3 tissue/volume contracts and P09 coverage ledger.
- [A muscles][a-muscles], [A sites][a-sites], [B routes][b-routes], [B joints][b-joints]: thigh/calf/foot, patella and tendon relationships.
- [Current lower kernels](src/anatomy/geometry.ts), [leg regression](scripts/check-leg-junction.mjs): existing behavior to preserve.

**Target files**

New `src/anatomy/regions/lowerLimb.ts`, `src/anatomy/regions/pelvicFloor.ts`, `src/anatomy/data/lowerBody.json`; `src/anatomy/dataBridge.ts`, `src/anatomy/definition.ts`, `src/anatomy/skeleton.ts`, `src/anatomy/pose.ts`, `src/anatomy/tissueSupport.ts`, `src/ui/panels/anatomy.ts`, `src/core/i18n.ts`.

**Implementation to deliver**

Generate individual gluteal/short-rotator, quadriceps, adductor, hamstring, calf/deep-leg and foot structures, their bones/tendons and pelvis-floor support. Model patella/tendon routing, biarticular muscles, ankle/subtalar/foot arches and separate toes. Close head/neck/small/deep skeletal-muscle gaps identified by the whole-body ledger, including opt-in variants with applicable anatomy. Preserve source quality and avoid inventing measured geometry for unresolved structures.

**Scope**

No gait kinetics, organ physiology or claim that every extreme pose is valid. Smooth/cardiac muscles remain outside the musculoskeletal editor; teeth/cartilage are separately typed, not bones. Fused/unpaired structures keep appropriate semantics.

**Integration with the project**

The same selection, local morphology, development, activation, pose, contact, materials and project path applies to the added regions; no separate lower-body state engine.

**Minimum verification and stopping condition**

Independent vastus/hamstring edits, hip/knee combinations, patellar motion, calf development, ankle/toe pose and pelvic-floor selection. Compare generated IDs to the expanded ledger and report all omissions. Reopen and repeat selected contact/volume cases.

**Acceptance criteria**

- [ ] Whole-body coverage is accounted for per actual structure/instance, not catalogue totals alone.
- [ ] Each supported biarticular muscle responds to all relevant joints.
- [ ] Feet, deep structures and anatomical variants are explicit and persistable.

## Milestone M4 - Whole-body expansion preserves the priority result

**Proves:** The priority-region contracts scale to a whole-body procedural editor with independent structure controls and traceable gaps, without degrading abdomen/pelvis/pectoral behavior.

**Integrated verification:** Coverage ledger versus generated runtime, representative architecture per region, multi-joint poses, materials and complete project round-trip. Re-run the M3 scenario after expanding the body. Missing required structures block whole-body completion, not continued editing of supported regions.

### P11 - Fit and drive compatible imported humanoids

**Status:** TODO

**Objective**

Apply P14–P16 to a compatible imported humanoid GLB: fit the anatomy inside it (landmarks from its rig, manual correction) and drive its mesh through the anatomical controls (P15 binding), preserving the original asset and allowing correction of uncertain regions.

**Required reading**

- M4 anatomical definition and coordinate contracts; [humanoid detection](src/rigging/humanoid.ts), [landmarks](src/rigging/bodyLandmarks.ts), [rigging](src/rigging/rigging.ts): existing compatible discovery tools.
- [C adoption][c-adoption] and [Model Warper reference](https://docs.opensimcreator.com/manual/en/latest/the-model-warper.html): staged landmark/region fitting, not automatic ground truth.
- [Project](src/core/project.ts), [editor](src/core/editor.ts): asset ownership, duplication and derived entities.

**Target files**

New `src/anatomy/fitting.ts`; `src/anatomy/dataBridge.ts`, `src/anatomy/skeleton.ts`, `src/anatomy/attachmentPatches.ts`, `src/anatomy/tissueSupport.ts`, `src/anatomy/body.ts`, `src/ui/panels/anatomy.ts`, `src/core/project.ts`, `src/core/i18n.ts`.

**Implementation to deliver**

Offer an opt-in action on a compatible imported humanoid. Reuse skeleton detection/manual landmarks, register skeletal regions, fit bone morphology and resolve attachments, then adapt muscle volumes/support and transfer to the imported skin. Use bounded region-specific affine/cage/TPS or RBF fitting only as needed. Expose confidence, manual correction and a reversible derived anatomy object. Store fitting inputs, source asset and versions; keep original mesh/rig unchanged.

**Scope**

No promise of accurate anatomy from any arbitrary skin, no required ML model/checkpoint and no destructive conversion. Unsupported rigs/topologies yield actionable diagnostics and do not prevent normal model editing.

**Integration with the project**

Preserve normal GLB import, pose/retargeting and project file deduplication. This optional flow consumes the same procedural engine rather than creating another one.

**Minimum verification and stopping condition**

Use two genuinely different compatible humanoid topologies, landmark correction and an unsupported input. Verify source preservation, fitting confidence, one priority pose and reload of the derived anatomy. Stop with explicit supported-input limits.

**Acceptance criteria**

- [ ] Compatible inputs can receive editable anatomy with manual correction and saved provenance.
- [ ] Original source/rig remains recoverable and unchanged.
- [ ] Uncertain regions are visible and unsupported inputs fail safely.

### P12 - Add optional localized volumetric physics after visible benefit is proven

**Status:** TODO

**Objective**

Improve a demonstrated difficult priority-region deformation through an optional local volumetric backend without making the app depend on full-body physics.

**Required reading**

- M3 contact/volume failures and measured timings; [XPBD baseline](src/anatomy/algorithms/tetraXPBD.ts), [SDF baseline](src/anatomy/algorithms/sdf.ts): current limited components.
- [B contact][b-contact], [B quality][b-quality]: expected bounded/optional behavior.
- [Tetrament reference](https://github.com/zalo/Tetrament): tetrahedralization/material/contact concepts; actual integration requires Babylon-independent data/compute interfaces.

**Target files**

Proposed `src/anatomy/physics.ts`, `src/anatomy/physics.worker.ts`; `src/anatomy/algorithms/tetraXPBD.ts`, `src/anatomy/tissueSupport.ts`, `src/anatomy/contracts.ts`, `src/anatomy/body.ts`, `src/ui/panels/anatomy.ts`, `src/core/i18n.ts`; optional WebGPU backend only after the CPU/reference result justifies it.

**Implementation to deliver**

Select one reproducible abdominal-compression, axillary or hip case that bounded kinematic correction cannot handle satisfactorily. Add valid coarse tetrahedralization, volume plus deformation/shear/stretch behavior, attachment constraints and contact; transfer the local result to high-detail render surfaces. Compare against existing kinematic output at the same input. Keep deterministic reset, bounded settle/cancellation and a working non-WebGPU fallback. Add a backend interface only when a second backend is implemented, not as advance scaffolding.

**Scope**

Optional post-core capability. A single volume constraint is not a complete FEM/tissue model; no clinical mechanics or force claim. Do not add Three.js to run a reference demo, and do not impose a continuous solver on every body.

**Integration with the project**

Use opt-in regional quality controls, existing activity/progress and project settings. Material mechanics remain separate from PBR appearance. Default output/image resolution and no-physics workflow remain available.

**Minimum verification and stopping condition**

One genuine hard case must show a measured contact/deformation improvement, retained attachments/volume and acceptable time/memory on stated hardware. Verify disabled fallback and reset/reload. If it offers no benefit or exceeds budget, leave this optional step incomplete with evidence; the core editor remains deliverable.

**Acceptance criteria**

- [ ] Enabled regional physics improves the selected case relative to the established baseline.
- [ ] Cancellation/reset/fallback are safe and no idle/background work persists unnecessarily.
- [ ] Source/dataset licenses and hardware requirements are explicit; no unsupported physical claims.

### P13 - Deliver portable projects, settled export and integrated recovery

**Status:** IN PROGRESS — versioned connection settings, morphology, pose and native materials survive tested JSON/ZIP/history paths. Production/offline regression checks are recorded separately; general recipe migrations and anatomical export diagnostics remain pending.

**Objective**

Make the completed capabilities reproducible across project exchange, offline use and current-pose export, including failure recovery.

**Required reading**

- All implemented prior state/version contracts; [project](src/core/project.ts), [archive](src/core/projectArchive.ts), [body](src/anatomy/body.ts): existing snapshot/restore/exchange/duplicate behavior.
- [Editor export](src/core/editor.ts), [compact export](src/optimize/export.ts), [PWA config](vite.config.ts): actual consumers and cache boundaries.
- [Numerical check](scripts/check-anatomy.mjs), [browser check](scripts/check-anatomy-browser.mjs), [fixture](scripts/fixtures/anatomy.html): reuse focused checks instead of adding a framework.

**Target files**

`src/anatomy/definition.ts`, `src/anatomy/parameters.ts`, `src/anatomy/migration.ts`, `src/anatomy/dataBridge.ts`, `src/anatomy/body.ts`, `src/core/project.ts`, `src/core/editor.ts`, `src/optimize/export.ts` if required by actual output, `vite.config.ts`, `scripts/check-anatomy.mjs`, `scripts/check-anatomy-browser.mjs`, `scripts/fixtures/anatomy.html`, `docs/anatomy.md`, `THIRD_PARTY_LICENSES.md`.

**Implementation to deliver**

Harden persistence already delivered incrementally: full definition, source/recipe versions, pose/activation, appearance, optional fitting/physics settings and complete A/B snapshots. Resolve compatible cached packs offline; give a recoverable missing-version path without silently changing anatomy. Export settled visible geometry as native-material static GLB with semantic names. Preserve existing imported-model rig/animation export and explain that GLB does not carry procedural sliders/contact logic. Fix project-switch/deletion/stale-worker/resource failures reproduced by integrated checks.

**Scope**

No breaking/destructive project migration or deployment. Animated anatomy baking can be a later explicit feature; static posed export is the required path here.

**Integration with the project**

Keep generated bytes/cache ownership stable, avoid rewriting unchanged files and load data with `BASE_URL`. Large optional reference packs are not automatically precached; runtime operation does not require remote services.

**Minimum verification and stopping condition**

Run section 7's real app scenarios, scoped regression commands and production preview. Stop after observable requirements pass and device/data limitations are recorded; expand testing only for new failures or material risks.

**Acceptance criteria**

- [ ] Current and old projects, independent duplicates, complete A/B and parameter exchange reopen reproducibly.
- [ ] Static GLB contains the settled posed result/native materials; missing data versions do not corrupt saved inputs.
- [ ] Reset/switch/delete during work cannot apply stale geometry or leak persistent resources.

## Milestone M5 - Reproducible integrated delivery

**Proves:** Supported core anatomy survives real editor/project/export/offline workflows. Optional fitting and physics have independent completion status and do not block delivering the priority/body core.

**Integrated verification:** M3 scenario plus completed whole-body regions, persisted source versions, static export/reimport, offline reopen and interrupted-work recovery. Report physical-device and empirical-calibration gaps separately from source completion.

## 6. Decisions and approval boundaries

Architecture choices resolved by this plan: retain existing procedural body and native UI; A template IDs plus explicit legacy mapping; area/patch-based geometry; typed regional migration; priority regions before whole-body expansion; distinct rest/development/pose/activation; bounded local contact; optional skin-first fitting and optional regional physics.

No user decision is needed to finish this planning artifact. Implementation is now authorized. Once authorized, ordinary reversible implementation steps require no repeated approvals. Commit, push, merge, deployment, paid assets/services and any future destructive migration need their own applicable authorization; none is required to implement source locally.

| Unresolved evidence/dependency | Required resolution in the owning step | Independent progress |
|---|---|---|
| Actual measured abdominal/pelvic/pectoral section/attachment data | P04 source acquisition/fit reports; do not reclassify A's heuristics as measured | P00–P03 functioning controls with honest quality |
| Schema/ID mismatch between A, B and current HTML-derived names | P00/P01 explicit versioned mapping and exact used-record validation; expand with regional coverage | Unaffected legacy structures stay available |
| Missing members hidden inside A's aggregate hand/foot/deep groups | P09/P10 expanded structure ledger and source-backed or explicitly heuristic recipes | Completed priority regions and named supported muscles |
| Contact quality and runtime cost | P07 reproduce actual failure, log surface clearance/volume/timing and constrain supported ranges | Rest editing, materials and project flows |
| Imported humanoid ambiguity | P16/P11 confidence, manual landmark correction and source preservation | Anatomy-first on the mannequin remains complete |
| Bone shapes | Superseded 2026-10-30: écorché bones are a measurement source for a procedural skeleton, not shipped meshes | Current procedural skeleton until the new one lands |
| Value of regional physics / device compatibility | P12 comparative case plus fallback/hardware evidence | Priority and whole-body kinematic/contact core |
| External asset redistribution terms | Exclude incompatible assets by default; record exact source/version/attribution before shipping | Recipes and compatible/local calibration work |

Do not add an open-ended research phase for these items; resolve the evidence needed by the current functional increment and continue independent work.

## 7. Final integrated validation and stopping rules

For the priority delivery, M3 is the central end-to-end proof. Test on the real existing entrypoint with actual worker generation and Babylon/UI/project consumers, not mocks or a detached GLB demo:

1. Create a body; edit one hip bone, an asymmetric rectus profile/intersection layout and a pectoral portion. Check dependent attachments and unrelated-side values.
2. Apply regional growth at a fixed total target, then activation at a fixed pose. Verify distinct inputs, correct volume semantics and stable tendon/patch identity.
3. Move arm from neutral to 90°/overhead; flex/twist trunk; flex hip with pelvic tilt. Inspect paths, dominant tissue surfaces, pectoral/rectus boundary, axilla and inguinal/lower-abdominal regions.
4. Switch/isolate all tissue categories without changing physical dependencies. Confirm both current skin options follow the anatomy, rest-space UVs and materials survive, and return to rest without drift.
5. Change a standard PBR preset/texture, save complete A, edit B, undo/redo, duplicate, export/import parameter JSON, save/open `.babalon` and resume autosave. Compare authoritative state and settled geometry.
6. Export/reimport static GLB and check current pose, named geometry and native material/texture state. No claim that procedural shader plugins or controls transfer to GLB.
7. Switch project/delete/reset during a pending morphology/contact job. Test one missing/invalid record or pack version, retry and preserve valid inputs/output.
8. Run at 1280×900 and 375×812, including Portuguese search, one continuous slider gesture, scrolling, keyboard focus, panel/context bounds and H. Use small JSON for state/timing and ≤640 px images for visual review. Actual phone touch, sensors/camera and AR require separately recorded device checks.

Minimum project commands after implementation: `npm run build`; `node scripts/check-anatomy.mjs`; existing JavaScript anatomy browser check against a fresh dev port; `node scripts/check-lazy-cache.mjs`; `node scripts/check-project-archive.mjs`; `node scripts/check-offline-install.mjs`; `node scripts/check-surface-brushes.mjs`. Run generic rig/pose regressions only when their integration is changed, including the existing leg/helper/skin checks and a real ordinary-rig pose/export smoke. Against production preview, run `node scripts/check-anatomy-browser.mjs <url> --production`, extending its existing smoke for implemented region contracts. Test non-root asset paths when data packs change.

Extend the existing checks with demonstrated failure cases: area-versus-radius conversion, cm³-to-m³ conversion, regenerated topology attachments, shared-control leakage, surface clearance despite wrapped paths, volume normalization, double-applied pose/growth, stale jobs, A/B state and UV/material loss. Before the MVP works, only add the focused check that proves the current critical path or reproduces its blocker. No test-only milestone or broad coverage campaign.

Record source/recipe version, fitted residuals, generated/target volumes, attachment error, declared contact-pair penetration, worker/apply time and test hardware. Physiological uncertainty is not resolved by passing software tests. Keep source delivery, device validation, optional features and deployment status distinct.

## 8. Reference paths

Reference labels below resolve to exact repository-relative files. The supplied A/B/C and algorithm directories were untracked at planning time; preserve/provenance and intentionally include required runtime derivatives during implementation rather than relying on undocumented local attachments.

[a-muscles]: src/anatomy/FORMA_ABC_BabalonJS/FORMA_Entrega_A_Anatomical_Data_Kit/catalog/muscles.json
[a-profiles]: src/anatomy/FORMA_ABC_BabalonJS/FORMA_Entrega_A_Anatomical_Data_Kit/catalog/individual_muscle_geometry_profiles.json
[a-bones]: src/anatomy/FORMA_ABC_BabalonJS/FORMA_Entrega_A_Anatomical_Data_Kit/catalog/bones.json
[a-bone-profiles]: src/anatomy/FORMA_ABC_BabalonJS/FORMA_Entrega_A_Anatomical_Data_Kit/catalog/bone_generator_profiles.json
[a-sites]: src/anatomy/FORMA_ABC_BabalonJS/FORMA_Entrega_A_Anatomical_Data_Kit/catalog/attachment_sites.json
[a-measurements]: src/anatomy/FORMA_ABC_BabalonJS/FORMA_Entrega_A_Anatomical_Data_Kit/calibration/matched_muscle_metrics.json
[a-sources]: src/anatomy/FORMA_ABC_BabalonJS/FORMA_Entrega_A_Anatomical_Data_Kit/references/sources.json
[a-coverage]: src/anatomy/FORMA_ABC_BabalonJS/FORMA_Entrega_A_Anatomical_Data_Kit/reports/calibration_coverage_v1_1.json
[a-limits]: src/anatomy/FORMA_ABC_BabalonJS/FORMA_Entrega_A_Anatomical_Data_Kit/CALIBRACAO_E_LIMITES.md
[b-families]: src/anatomy/FORMA_ABC_BabalonJS/FORMA_Entrega_B_Motor_Procedural/engine/muscle_generator_families.json
[b-routes]: src/anatomy/FORMA_ABC_BabalonJS/FORMA_Entrega_B_Motor_Procedural/engine/muscle_routes.json
[b-growth]: src/anatomy/FORMA_ABC_BabalonJS/FORMA_Entrega_B_Motor_Procedural/engine/growth_profiles.json
[b-bones]: src/anatomy/FORMA_ABC_BabalonJS/FORMA_Entrega_B_Motor_Procedural/engine/bone_generation_overrides.json
[b-joints]: src/anatomy/FORMA_ABC_BabalonJS/FORMA_Entrega_B_Motor_Procedural/engine/rig_joint_overrides.json
[b-contact]: src/anatomy/FORMA_ABC_BabalonJS/FORMA_Entrega_B_Motor_Procedural/engine/contact_policy.json
[b-correctives]: src/anatomy/FORMA_ABC_BabalonJS/FORMA_Entrega_B_Motor_Procedural/engine/pose_correctives.json
[b-invalidation]: src/anatomy/FORMA_ABC_BabalonJS/FORMA_Entrega_B_Motor_Procedural/engine/parameter_invalidation.json
[b-soft]: src/anatomy/FORMA_ABC_BabalonJS/FORMA_Entrega_B_Motor_Procedural/engine/soft_tissue_generators.json
[b-stack]: src/anatomy/FORMA_ABC_BabalonJS/FORMA_Entrega_B_Motor_Procedural/engine/tissue_layer_stack.json
[b-fat]: src/anatomy/FORMA_ABC_BabalonJS/FORMA_Entrega_B_Motor_Procedural/engine/fat_region_rules.json
[b-pose]: src/anatomy/FORMA_ABC_BabalonJS/FORMA_Entrega_B_Motor_Procedural/POSES_E_TECIDOS.md
[b-quality]: src/anatomy/FORMA_ABC_BabalonJS/FORMA_Entrega_B_Motor_Procedural/engine/quality_and_lod.json
[b-calibration]: src/anatomy/FORMA_ABC_BabalonJS/FORMA_Entrega_B_Motor_Procedural/CALIBRATION_BACKLOG.md
[c-contract]: src/anatomy/FORMA_ABC_BabalonJS/FORMA_Entrega_C_Integracao_BabalonJS/INTEGRATION_CONTRACT.md
[c-adoption]: src/anatomy/FORMA_ABC_BabalonJS/FORMA_Entrega_C_Integracao_BabalonJS/DATA_ADOPTION.md
[c-ux]: src/anatomy/FORMA_ABC_BabalonJS/FORMA_Entrega_C_Integracao_BabalonJS/USER_EXPERIENCE.md

## 9. Execution tracking

Statuses: `TODO`, `IN PROGRESS`, `VERIFIED`, `APPROVED`, `BLOCKED`. Existing library tests or already integrated FORMA controls do not complete a new step. `APPROVED` applies only to a required human gate actually reviewed. Optional rows are tracked independently from core delivery.

| Step | Status | Evidence / commit | Human approval | Notes |
|---|---|---|---|---|
| P00 | VERIFIED | Worker, native UI, desktop/mobile, A/B, JSON/ZIP | Implementation authorized | Rectus data → procedural body → UI/history/project; M1 |
| P01 | IN PROGRESS | First priority increment; remaining scope above | No separate routine gate | Pelvic bone controls and stable patches |
| P02 | IN PROGRESS | First priority increment; remaining scope above | No separate routine gate | Pectoral fans and shared thoracic/abdominal boundary |
| P03 | IN PROGRESS | First priority increment; remaining scope above | No separate routine gate | Complete priority abdominal architecture; M2 |
| P04 | IN PROGRESS | Pectoral/deltoid measured against écorché | Bones: measurements only (decision 2026-10-30) | Écorché-derived procedural skeleton, then muscles | Reference template extraction and residual reports |
| P05 | IN PROGRESS | First priority increment; remaining scope above | No separate routine gate | Individual/regional volume and separate activation |
| P06 | TODO | | No separate routine gate | Anatomical priority pose and existing-tool adapter |
| P07 | IN PROGRESS | First priority increment; remaining scope above | No separate routine gate | Thickness-aware contact, fat and two skins |
| P08 | IN PROGRESS | First priority increment; remaining scope above | No separate routine gate | Unified priority UI and diagnostics; M3 |
| P09 | TODO | | No separate routine gate | Back, upper limbs/hands, neck and head |
| P10 | TODO | | No separate routine gate | Lower limbs/feet, pelvic floor and coverage closure; M4 |
| P11 | TODO | | Core goal (2026-10-30) | Imported humanoid: fit (P16) and drive (P15) |
| P12 | TODO | | Optional expansion scope | Local volumetric physics with demonstrated benefit |
| P14 | TODO | | No separate routine gate | Template space and landmark registration |
| P15 | IN PROGRESS | Test switch "Skin follows muscles" | No separate routine gate | Smooth skin↔tissue binding, both skins |
| P16 | TODO | | No separate routine gate | Fit anatomy into a given body surface |
| P13 | IN PROGRESS | First priority increment; remaining scope above | Deployment separately authorized | Portable projects, settled export and recovery; M5 |

## Continuation — upper-arm shells (2026-10-30)

Scope: replace the four existing upper-arm ellipsoids with procedural shells, using the
existing `fanMuscle`, local arm cage, legacy growth axes and individual morphology pipeline.
No new interaction model, growth keys, dependencies or reference meshes are shipped.

Reference: local SOMA atlas `assets/anatomical-reference.glb`, read with `scripts/anatomy-reference/glb.mjs`.
Positive-X humerus bounds in metres: `[.1401, 1.1075, -.0283, .2408, 1.4146, .0209]`.
Reference muscle bounds `[minX,minY,minZ,maxX,maxY,maxZ]`:

| Structure | Reference bounds (m) |
|---|---|
| Long biceps | `[.1345,1.0721,-.0125,.2311,1.4187,.0291]` |
| Brachialis | `[.1761,1.0729,-.0204,.2327,1.2989,.0080]` |
| Long triceps | `[.1334,1.1130,-.0618,.2177,1.3761,-.0147]` |
| Lateral triceps | `[.1733,1.1132,-.0603,.2292,1.3709,-.0095]` |

The previous biceps origin started below the shoulder; the brachialis was too short, and
ellipsoids did not express narrow attachment ends. The new shells retain fixed attachment
points, a movable belly, transverse rounded sections and tapered tendon material. They
register as arm meshes and fit locally instead of shrinking the entire muscle toward the
arm axis. Keep the legacy definitions for volume-field axes and older project controls.
The existing individual templates/profiles and Body controls are reused through new mesh mappings.

Real editor/worker results, default body, positive-X side, in metres:

| Structure | Result bounds |
|---|---|
| Humerus | `[.17762,1.16032,-.00352,.27845,1.40739,.02038]` |
| Long biceps | `[.19087,1.13382,.02070,.27503,1.41619,.05425]` |
| Brachialis | `[.21338,1.13524,.00971,.28019,1.31589,.03571]` |
| Long triceps | `[.17584,1.15885,-.04234,.26971,1.38356,-.00911]` |
| Lateral triceps | `[.21274,1.15908,-.03499,.27203,1.38032,-.00442]` |

Compare to the humerus rather than absolute height: long-biceps top is 0.88 cm above
our humerus versus 0.41 cm in the reference; its distal end is 2.65 cm below ours versus
3.54 cm in the reference. Brachialis starts 9.15 cm below our humeral top versus 11.57 cm
in the reference. Long/lateral triceps begin 2.38/2.71 cm below ours versus 3.85/4.37 cm.
These are heuristic visual proportions informed by bounds, not calibrated attachment residuals.
Full section-profile matching, bone-contact seating and intermuscular clearance remain unverified.

Validation:

- Real browser entrypoint at 1280×900 and 375×812: eight shells present, mirrored at rest,
  no horizontal page overflow. Left-biceps volume 1.8: 98.2831 → 176.9096 cm³; relative
  volume error 1.93e-7. Maximum local vertex change 8.22 mm; all seven other arm shells
  retain identical positions. Growth keys at 2.5× displace skin coordinates by up to 31.19 mm.
- Both skin models and all existing individual morphology extremes pass in the worker.
  The first attempt exposed excessive protected tendon length at minimum volume; narrowing
  the tendon interval fixed it without changing the shared morphology solver.
- Focused arm-shell identity, symmetry and replacement assertions added to `check-anatomy.mjs`.
  The suite through morphology extremes and attachment checks passes.
- Production build and `check-lazy-cache.mjs` pass.
- Full `check-anatomy.mjs` and browser priority fixture fail on existing muscle/covering
  contact clearance (6.4893 mm residual). Re-running the Node check with both geometry and
  priority modules loaded from HEAD reproduces the same residual. No contact code changed.
- No poses or physical touch/device checks performed. Short biceps, medial triceps and
  individual forearm muscles are not added in this pass. No commit or push.

## Continuation — complete arm heads, forearm muscles and neutral alignment (2026-10-30)

Added the short biceps and medial triceps plus all 19 named forearm templates in the
atlas: brachioradialis, both pronators, supinator, wrist/finger/thumb flexors and extensors,
and abductor pollicis longus. Reuse fanMuscle and the local arm skin cage; remove the old
brachioradialis/flexor/extensor ellipsoids from rendering while retaining their volume-field
axes. The added heads have independent bicepsShort/tricepsMedial fields. Forearm chronic
growth retains the existing three groups; genetic shapes are editable per muscle and side.
The template profiles come from the same FORMA A source and retain their heuristic provenance.
UI labels use existing translated atlas names. No new dependency, parameter schema version,
reference mesh, commit or push.

Neutral-arm diagnosis: all pose angles were zero. Area centroids of actual skin triangle
intersections showed the authored arm curving behind the humeral axis, then projecting
forward at the elbow. At y=11.8 (10 cm units), section center Z was .19453 versus a bone
axis around .07537: 11.92 mm forward. At y=13.2, Z was .00675 versus .08699: 8.02 mm back.
A cached table of default-skin centroids at 4 cm intervals translates sections onto the
existing skeletal axes, weighted by the original arm ownership. Cross-section shape and
hand/shoulder anchors are retained. Internal geometry remains attached to the existing
bones and is fitted against the corrected cage. No compensating default pose rotation.
Measured maximum sagittal deviation after correction: 2.244 mm across y=9.2–13.6 sampled
at 2 cm. A regression calculates triangle-intersection area centroids (vertex averages
would bias the result toward densely triangulated regions).

Reference measurements use the local anatomical-reference.glb through the existing GLB reader. Both
reference and generated muscles were sampled in 4 cm height bands for X range and Z extremes.
Reference humerus distal/top Y: 1.1075/1.4146 m; our humerus about 1.1603/1.4074 m.
For example, short biceps starts 1.29 cm below the reference humeral top, ours 0.57 cm;
medial triceps starts 8.03 cm below the reference top, ours 6.97 cm. Brachioradialis
origin is 18.85 cm below the reference humeral top versus
16.92 cm below ours (different arm proportions); compare local sections as well as bounds.
The recipes remain visual fits rather than calibrated attachment/volume reconstructions.
Extensor indicis and extensor digiti minimi are not separately named in this local GLB;
those two paths are explicitly heuristic FORMA visual seeds. Digital tendon paths beyond
the wrist/palm boundary and separate humeral/ulnar slips are not implemented here.

Default positive-X measurement summary (metres; min/max Y and Z). Reference rows combine
named slips where present; values are landmarks for visual comparison, not a claim that
absolute coordinates match between differently proportioned bodies.

| Template | Reference Y | Result Y | Reference Z | Result Z |
|---|---|---|---|---|
| biceps_brachii_short | 1.1429…1.4017 | 1.1455…1.4017 | -0.0045…0.0309 | 0.0208…0.0525 |
| triceps_brachii_medial | 1.1070…1.3343 | 1.1526…1.3377 | -0.0341…-0.0064 | -0.0241…0.0025 |
| brachioradialis | 0.8867…1.2261 | 0.9123…1.2382 | -0.0246…0.0446 | 0.0126…0.0327 |
| pronator_teres | 0.9954…1.1443 | 1.0332…1.1711 | -0.0130…0.0230 | 0.0161…0.0339 |
| pronator_quadratus | 0.8986…0.9486 | 0.9181…0.9693 | 0.0230…0.0469 | 0.0138…0.0210 |
| supinator | 1.0114…1.1345 | 1.0454…1.1648 | -0.0231…0.0111 | -0.0096…0.0017 |
| flexor_carpi_radialis | 0.8582…1.1350 | 0.8920…1.1644 | -0.0094…0.0570 | 0.0172…0.0368 |
| flexor_carpi_ulnaris | 0.8587…1.1280 | 0.8957…1.1596 | -0.0331…0.0582 | 0.0119…0.0265 |
| palmaris_longus | 0.8106…1.1330 | 0.8871…1.1633 | -0.0088…0.0716 | 0.0213…0.0363 |
| flexor_digitorum_superficialis | 0.7544…1.1314 | 0.8884…1.1553 | -0.0131…0.0899 | 0.0163…0.0341 |
| flexor_digitorum_profundus | 0.7435…1.0970 | 0.8909…1.1358 | -0.0106…0.1074 | 0.0102…0.0214 |
| flexor_pollicis_longus | 0.8135…1.0440 | 0.8921…1.1100 | 0.0083…0.0864 | 0.0131…0.0238 |
| extensor_carpi_radialis_longus | 0.8564…1.1806 | 0.8924…1.2043 | -0.0272…0.0439 | -0.0164…-0.0008 |
| extensor_carpi_radialis_brevis | 0.8537…1.1562 | 0.8904…1.1752 | -0.0281…0.0374 | -0.0201…-0.0052 |
| extensor_carpi_ulnaris | 0.8489…1.1374 | 0.8937…1.1607 | -0.0307…0.0504 | -0.0187…0.0010 |
| extensor_digitorum | 0.7551…1.1391 | 0.8874…1.1619 | -0.0352…0.0838 | -0.0241…-0.0099 |
| extensor_digiti_minimi | 0.8017…1.1289 | 0.8890…1.1524 | -0.0265…0.0651 | -0.0195…-0.0040 |
| extensor_indicis | 0.7500…0.9464 | 0.8881…1.0609 | 0.0162…0.0964 | -0.0109…-0.0027 |
| abductor_pollicis_longus | 0.8659…1.0494 | 0.8940…1.0891 | -0.0104…0.0533 | -0.0060…0.0074 |
| extensor_pollicis_longus | 0.8103…1.0138 | 0.8885…1.0605 | -0.0047…0.0847 | -0.0108…0.0045 |
| extensor_pollicis_brevis | 0.8354…0.9732 | 0.8929…1.0239 | 0.0106…0.0696 | -0.0053…0.0067 |

Representative 4 cm section records [band Y, minX, minZ, maxX, maxZ], in metres:

- Short biceps at 1.24: reference [.1599,-.0045,.1928,.0309], result [.2091,.0331,.2507,.0524].
- Medial triceps at 1.20: reference [.1673,-.0324,.2098,-.0119], result [.2253,-.0241,.2724,-.0074].
- Brachioradialis at 1.04: reference [.2301,-.0030,.2702,.0321], result [.2808,.0158,.3077,.0297].

Verification:

- node scripts/check-anatomy.mjs --arms: PASS on both skins. All 21 new templates normalize,
  change actual left-side geometry at volume 1.8, retain the exact right-side arrays, and
  reach target volume with maximum relative error below 1.4e-7. No duplicate legacy volumes.
- The general worker check passes morphology extremes (including all new templates), then
  still fails its pre-existing muscle/covering assertion: residual 6.4895 mm (previously
  6.4893 mm). The priority browser fixture fails Rest tissue clearance on desktop and phone.
  These remain known trunk-contact failures; they are not a passing full-suite claim.
- Correction exposed 0.021 mm of asymmetry when fitting a few existing arm shells to the
  sampled skin cage. Mirror regression allows 0.1 mm; independent-side genetics still
  requires exact equality on the untouched side. Narrower protected tendon intervals keep
  the long triceps' minimum genetic volume reachable after the rest-cage correction.
- Real editor, 1280×900 and 375×812: native new-head controls and all 19 forearm genetic
  selectors present; no horizontal overflow. At left-side volume 1.8, mean shell thickness
  changes short biceps 7.67→13.42 mm, medial triceps 8.25→14.25 mm, pronator teres
  5.79→10.08 mm. Corresponding right-side arrays unchanged.
- New-head/forearm group growth at 2.5 displaces skin vertices by up to 24.22 mm in the
  browser scenario. Skin was inspected from side/front/back at rest and growth. A combined
  arm-abduction/elbow-flexion API smoke moves the muscles and returns exactly to neutral.
- Existing pectoral skin displacement at 2.5: 23.4414 mm before centerline correction,
  23.4276 mm after (0.014 mm difference). Rectus: 22.9451 mm before and after.
- Production build and lazy-cache check pass. Physical touch/device operation and detailed
  pose quality, intermuscular contact and distal digital tendon routing remain unverified.

## Main-muscle completion sequence (2026-10-30)

Authorized: implement and commit each functional group, then continue without a new approval.
Priority: (1) shoulder/axilla/deep chest and neck; (2) thigh, knee and lower-leg bellies;
(3) deep hip and remaining principal axial support. Existing reference-derived pectorals,
deltoids, back sheets, abdominals and gluteals are retained. Face and intrinsic hand/foot
muscles, physiological simulation and distal digital tendon routing are outside this
principal locomotor/contour increment. Each stage uses the shared fitting/growth/genetics
and project paths. Do not include the unrelated local algorithm-demo/document changes.

### Stage 1 — shoulder girdle and neck — verified

- Previous arm work committed as 93c973a. Added 13 editable templates: SCM, levator scapulae,
  three scalenes, splenius capitis, platysma, pectoralis minor, subclavius, subscapularis,
  serratus anterior, coracobrachialis and anconeus. Existing serratus teeth are reused;
  five legacy ellipsoids are replaced. One shared spindle helper also builds the arms.
- Local reference bounds in metres (Y/Z): SCM 1.3790–1.5820 / -.0429–.0783;
  pectoralis minor 1.2598–1.4037 / .0007–.0937; subscapularis 1.2736–1.4022 /
  -.0766–.0205; anterior scalene 1.4124–1.4991 / -.0004–.0175.
- Generated Y/Z: SCM 1.4115–1.5756 / -.0120–.0546; pectoralis minor 1.2881–1.3871 /
  .0284–.0790; subscapularis 1.3274–1.3868 / -.0319–.0217; anterior scalene
  1.4175–1.5014 / .0030–.0158. Relative to the clavicle/shoulder at about 1.40 m,
  the deep pectoral runs below it and scalenes above it; shapes remain visual recipes.
- Layering: the pectoralis minor lies inside the major, subclavius under the clavicle,
  subscapularis in front of the scapula. Their explicit endpoints remain on that side
  of the girdle rather than lifting all deep muscles onto the superficial rib support.
  Subscapularis uses the existing numeric torso→arm registration blend.
- Worker: --arms and --regions pass. All 13 templates pass 1.8× left volume, exact
  preservation of right-side arrays, both skin models and extreme genetic shapes.
- Real editor/UI at 1280×900 and 375×812: JSON round-trip retains all 13 IDs, growth
  displaces skin by up to 16.19 mm, no page overflow or page errors. Volume relative
  errors <1e-7. Native shoulder-girdle controls and internal appearance inspected.
- Production build passes. Detailed pose anatomy and physical-device use remain unchecked.
  The pre-existing trunk muscle/covering clearance failure is still recorded separately.

### Stage 2 — thighs, knee and lower legs — verified

- Stage 1 committed as 528f9eb. Replaced the remaining principal lower-limb ellipsoids
  with the shared shell builder, preserving their skeletal endpoints, belly centers,
  proportion controls, pelvic transform and volume axes. The gluteal fans, psoas and
  sartorius are retained. The deep hip rotators are reserved for Stage 3.
- 29 leg/iliacus templates now use paired shells. Added 13 per-side templates: vastus
  intermedius, hamstring portion of adductor magnus, short biceps femoris, popliteus,
  plantaris, tibialis posterior, fibularis longus/brevis/tertius, extensor digitorum
  longus, extensor hallucis longus and flexor digitorum/hallucis longus.
- Reference Y/Z in metres: rectus femoris .3922–.9501 / .0038–.0741; vastus intermedius
  .4208–.8479 / -.0028–.0558; medial gastrocnemius .2003–.5113 / -.0668–.0136;
  tibialis anterior .0397–.4342 / -.0077–.0663. Shared reference knee is around .42 m;
  our knee is around .51 m. Absolute endpoints differ with those proportions.
- Generated Y/Z: rectus femoris .5254–.9857 / .0336–.1017; intermedius .5273–.8869 /
  -.0071–.0665; medial gastrocnemius .1397–.5186 / -.0618–-.0011; tibialis anterior
  .0184–.4813 / .0208–.0729. Quadriceps terminate at the knee rather than inside
  the shaft. Long leg paths include the ankle/foot attachment region, not toe routing.
- Fixed a demonstrated template ambiguity: extensor_digitorum_longus must not match
  the forearm extensor_digitorum prefix. Forearm matches now require a side suffix and
  canonical fallback tests longer IDs first.
- Extreme minimum-volume tests exposed protected tendon-volume floors in plantaris
  and extensor hallucis longus. Small leg tendons have a thinner footprint; plantaris
  genetics use belly-local longitudinal coordinates. The hallucis belly center stays
  on the shin until the distal tendon turns toward the foot, avoiding cage collapse.
- Worker --regions legMuscles passes all 29 templates on both skin models, opposite-side
  isolation, 1.8× volume and both genetic extremes. Volume errors below 1.2e-7.
- Real editor on desktop and phone: all 29 IDs survive JSON round-trip, right arrays
  remain identical, growth at 2.5× displaces skin by about 46.18 mm in the combined
  scenario. Native panels, no overflow/page errors and internal appearance checked.
- Production build and lazy-cache pass. Physical devices, physiological accuracy,
  full lower-limb pose/contact quality and distal toe tendons remain unverified.

### Stage 3 — axial support and deep hip — verified

- Stage 2 committed as b532ffb. Added the remaining 15 main atlas templates: posterior
  serratus superior/inferior, spinalis, multifidus, quadratus lumborum, pyramidalis,
  external/internal intercostals, diaphragm, piriformis, both obturators, both gemelli
  and quadratus femoris. Existing pyramidalis is reused; the three old deep-hip
  ellipsoids are replaced. Posterior sheets remain under the superficial back layer.
- Intercostals reuse the rib curves in two distinct depths and fiber directions.
  Diaphragm halves run from the costal margin to a raised central tendon; no respiratory
  simulation is implied. This GLB has no separately named diaphragm/intercostal or
  pyramidalis reference mesh: those surfaces retain heuristic FORMA/rib-derived provenance.
- Measured reference Y/Z, metres: QL .9435–1.1499 / -.0571–-.0119; spinalis thoracis
  1.0524–1.4129 / -.0820–-.0305; posterior serratus superior 1.3325–1.4636 /
  -.0688–-.0056 and inferior 1.0476–1.2101 / -.0780–-.0371. Multifidus spans separately
  named lumbar/thoracic/cervical reference portions (.9962–1.5419 m). Deep hip spans
  piriformis .8842–.9505, obturators .8455–.9057 and gemelli .8590–.9033 m; recipes
  attach to our pelvic landmarks rather than copying absolute reference coordinates.
- Pyramidalis' broad proximal triangle needed belly-local profile coordinates to reach
  its minimum genetic target without moving the pubic endpoint. Baseline geometry is retained.
- Worker --regions axialMuscles passes all 15 templates at volume 1.8, both genetic
  extremes and both skin choices; maximum relative volume error <2.7e-7. Opposite sides
  retain identical arrays. Browser desktop/phone: JSON retention, native Deep back
  controls, no horizontal overflow or page errors; combined growth skin delta 21.73 mm.
- --coverage passes: all 109 main atlas muscle templates have generated geometry on
  both sides and native per-side controls (218 sides). Excludes face/head and intrinsic
  hand/foot groups. This is implementation coverage, not measured anatomical accuracy.
- The full worker check passes all individual morphology limits and still reaches the
  known muscle/covering failure (now 6.108 mm); investigate its actual smoothing/crossing
  behavior as a final integration repair rather than weakening the assertion.
- Detailed pose accuracy, physical devices, intermuscular collision and tendon wrapping
  remain outside the verified claims. No meshes from the reference are shipped.

### Final integration — covering clearance and reference review

- Stage 3 committed as 08e7422. Main-muscle implementation coverage is complete for
  this sequence: 109 atlas templates / 218 sides, with 41 newly editable templates
  across the three continuation stages, plus the arm work committed at the start.
- Final QL measurement found its pelvic origin too high. Lowered the origin along
  the inner pelvic frame and the rib endpoint. Final generated Y/Z is .9644–1.1581 /
  -.0424–-.0281 m, versus reference .9435–1.1499 / -.0571–-.0119; the former generated
  height span was 1.0241–1.1791 m. Both-skin genetic extremes and real-browser side
  isolation/JSON tests were repeated. Combined axial skin growth delta is now 21.75 mm.
- Representative 4 cm profiles were remeasured using [minX,maxX,minZ,maxZ], metres.
  At 4–8 cm below each scapular top, pectoralis minor is reference
  [.0792,.1281,.0131,.0687], generated [.0859,.1651,.0324,.0685]. At 24–28 cm above
  each knee, rectus femoris is reference [.0908,.1432,.0436,.0741], generated
  [.0693,.1412,.0350,.1017]. QL's absolute 1.04–1.08 m band is reference
  [.0256,.0691,-.0500,-.0119], generated [.0337,.0731,-.0424,-.0307]. These residuals
  are retained as visual-fit limits rather than described as calibrated geometry.
- Root cause of the historical covering failure: immediately after separation the
  trunk residual was .0000078 mm; smoothing carried neighbouring skin vertices into
  a muscle and raised it to 6.108 mm. Keep the original crossing guard and repeat
  separation/smoothing in at most four bounded passes, stopping below .02 mm.
- A synthetic regression was observed failing at 40.904 mm, then passing at zero.
  A disconnected sheet remains byte-for-byte unchanged. The real oblique/covering
  reproduction now has residual .0000063 mm, without loosening the clearance assertion.
- Full check-anatomy.mjs passes, including all individual morphology extremes, both
  skins, contact at rest and selected pose, attachment endpoints, fat thickness and
  idempotent connective replay. The former failures in the earlier sections are resolved.
- The real priority fixture passes on 1280×900 and 375×812 with zero runtime errors,
  native UI, side isolation, undo/redo, A/B, materials, JSON, ZIP and reopened attachments.
  Contact commit in that fixture is about 0.4 s; this is desktop test timing, not a phone
  performance claim. Backgrounded browser tests use the skill's timeout-based frame tick.
- Production build, lazy-cache, project-archive and installed-offline manifest/resume
  checks pass. All reference GLB data stayed local; temporary measurement/probe files
  are removed. Unrelated local demo/docs/license changes are preserved and excluded.
- Still not claimed: medical calibration, full-body collision or breathing physics,
  exhaustive posed fitting, real-device touch/sensors, facial/intrinsic hand/foot detail
  or distal digital tendon wrapping. No push or deployment is authorized or performed.

## Rectus, chest, obliques and pelvic growth boundaries (2026-10-30)

User request: investigate apparent rectus-driven chest hypertrophy while keeping every
existing option. No parameter, control, tissue mode or project format is removed or renamed.

Diagnosis with the actual worker and unchanged 2.5× control inputs:

- Rectus master volume displaced the pectoralis costal mesh by 13.52 mm; direct rectus
  hypertrophy displaced it by 3.85 mm. The general volume warp and regional relief
  applied the abdominal deformation to neighbouring internals, then the thoracic
  seating pass lifted the pectoral onto the already enlarged rectus. Its skin cap also
  inherited the changed abdominal envelope.
- The same problem existed in reverse: pectoral master growth displaced the upper
  rectus by 28.53 mm; sternocostal-part growth displaced it by 10.39 mm. Oblique master
  growth displaced the costal pectoral by 8.09 mm. The legacy construction surface also
  baked oblique relief into rectus geometry (up to 12.40 mm of unintended displacement).

Implementation:

- Assign rectus, pectoral and oblique volume fields to their corresponding muscles and
  connective coverings. Costal cartilages, pelvic bones and inguinal anchors no longer
  receive those unrelated muscle volume fields.
- Keep common skin deformation and adipose/proportion options. Split rectus-specific
  segment/linea-alba relief and pectoral-specific relief when applying it to internals,
  so those patterns are not stamped into other muscles.
- Build the pectoral thoracic seat and its cap from neutral abdominal volume while
  retaining all other current parameters, including its own hypertrophy. This uses the
  existing layer builders and cage fitter, with no separate interaction/growth system.
- On the legacy construction surface, sample rectus and its tendons with neutral
  oblique volume after the existing fat/inguinal normalization. This preserves raw
  internal geometry when fat changes, as well as the original skin choices.
- Keep attachments, contact and skin-follows options active. Contact still resolves
  overlap against the pectoral from the rectus side; connected skin may retain a small
  smoothing transition rather than changing the pectoral muscle's hypertrophy.

Regression evidence:

- --rectus-boundaries: both skins show 0 mm pectoral and skeletal-anchor movement from
  either rectus growth control. Rectus master growth still moves its own mesh by
  29.19/29.68 mm; direct hypertrophy by 6.23/7.64 mm. Independent pectoral growth remains
  functional, including when combined with rectus growth. Reverse pectoral→rectus and
  oblique→pectoral/rectus growth no longer displace the unrelated muscles.
- Additional checks retain legacy abdominal sheets, eight-segment geometry, width,
  gap, stagger, intersection shift, pelvic/costal attachments and both tissue modes.
  Raw rectus geometry remains independent of fat=0/40 construction inputs.
- Standalone skin displacement at master 2.5× remains exactly the prior measured result:
  rectus 22.9451 mm and pectoral 23.4276 mm. No replacement skin or reduced growth range.
- Browser regression uses the real Rectus volume slider, direct growth, undo/redo and
  parameter export/import at desktop and 375×812. Ordinary pectoral/upper-chest deltas
  are 0 mm, while abdominal displacement is about 30.04 mm with the two controls
  combined. Connected/contact modes retain 0 mm pectoral displacement; the upper-chest
  skin transition is about .493 mm. Contact/attachment checks remain enabled.
- Full worker, production build, cache, archive and the priority UI/project fixture pass.
  The latter retains A/B, custom intersections, undo/redo, materials and JSON/ZIP reopening
  at both tested viewport sizes. Temporary numeric probes are removed after verification.
- Visual inspection with all internals opaque still exposes small axillary/groin tips.
  Picking identified deltoidAnterior, biceps_brachii_short_L and adductor_longus_R; these
  are outside the rectus/pectoral growth-isolation fix and are not claimed resolved here.
  No medical calibration or exhaustive real-device/pose validation is claimed.


### Back and inguinal audit — posterior ownership and independent parts (2026-10-30)

- Rechecked the local reference posterior fans against the spine, scapula and iliac
  crest. Reference latissimus spans y=.9402–1.3445 m; rhomboid major
  1.2663–1.4398 m; longissimus thoracis .9250–1.4485 m. Generated rest spans
  .9479–1.3624, 1.2776–1.4094 and .9112–1.4345 m respectively. These are bounding
  checks, not registered medical error estimates; attachments and body proportions
  differ. Retained the established procedural fans and bony attachment directions.
- Actual-worker reproduction: isolated latissimus growth at 2.5× displaced anterior
  trunk skin by 20.0591 mm and grew unrelated obliques/intercostals. Its field was
  tagged as generic torso volume. Posterior fields now have their own side and
  anterior exclusion mask, and deform only their muscles and thoracolumbar fascia.
  Shared posterior identity replaces duplicate name mappings.
- Skin seating now caches cages by the growth fields owned by each posterior part.
  Enlarging the latissimus no longer releases the skin limit of neighbouring fans.
  Pectorals retain their neutral posterior/abdominal support cage. Regression checks
  retain exact pectoral, abdominal, skeletal and ligament geometry for isolated
  latissimus growth. Fascia may follow its underlying latissimus.
- At 2.5×, posterior skin displacement is 27.4151 mm for latissimus and 19.3250 mm
  for the back master; measured anterior trunk displacement is 0 mm. The back
  master no longer applies both side fields to the same midline area. Left-only
  latissimus genetic volume 1.8 moves posterior skin by 2.4207 mm and anterior
  skin by 0 mm. Posterior genetics transfer samples the outward posterior surface
  and keeps its spatial bins separate from anterior muscle samples.
- Added bilateral chronic growth sliders for longissimus, iliocostalis, rhomboid
  minor and rhomboid major. Existing erector/rhomboid aggregate sliders and per-side
  genetics remain available. New keys survive normalization and parameter export.
  Independent legacy fan thickness is applied per fan, including its boundary.
- Ranges retained: chronic growth .3–3×, back master .2–3×; genetic width/depth
  .65–1.5 and volume .5–2. Tested all 19 posterior templates on both skin models,
  left volume 1.8, combined lower/upper genetics, and opposite-side independence.
  The legacy transverse trapezius previously missed its minimum volume target by
  about 19.9% because its thick terminal shell was frozen. Unattached posterior
  shells now correct thickness around their fixed paired mid-surface, including
  the terminal shell. Explicit attachment masks retain their existing constraints.
- Inguinal height and opening now use the generated ligament centerline endpoints
  after pelvic transforms and body-height scaling. The input is explicitly labelled
  nominal height. This avoids presenting an authored guide as the final measurement.
  The authored skin remains at 17,406 vertices; legacy skin retains adaptive topology.
  Checked both extremes of every inguinal shape control and pelvic ASIS/pubis,
  tilt/flare controls on both skins without removing old limits or model choices.
- Avoided volume-warp/normal recomputation when a mesh has no active owned field,
  and normal recomputation for zero regional deltas. No decimation, render-resolution
  reduction or quality option removal. Timings remain workload-dependent; no universal
  speedup is claimed.
- Focused commands: `node scripts/check-anatomy.mjs --back-inguinal`,
  `--regions backMuscles`, `--rectus-boundaries`, plus the full worker check, build,
  lazy cache/archive/offline checks and desktop/375×812 browser regressions.
- Limits: finite geometry and volume/range checks do not prove absence of every
  self-intersection. The torso contact solver is not extended into a full posterior
  or groin collision simulation. Opaque neck/axillary/groin muscle tips,
  exhaustive pose extremes and physical-phone gestures remain outside this correction.


### Rectus hypertrophy with two inscriptions — abdominal distribution (2026-10-30)

- User reproduction: two transverse tendinous inscriptions leave the superior
  rectus belly beneath the costal pectoral fibers. The previous regression isolated
  pectoral mesh growth and upper-chest skin, but missed this lower pectoral overlap.
- The direct hypertrophy relief iterated only from the superior attachment to each
  inscription. It omitted the final inscription-to-pubis interval, leaving the
  inferior abdomen effectively unchanged while emphasizing the superior belly.
  With two standard inscriptions and direct growth 2.5×, authored-skin lower bands
  around y=9.8–10.7 had effectively zero displacement, while y=12.4–12.6 reached
  about 6.09 mm. This was a distribution error, not evidence that the pectoral
  muscle inherited rectus growth.
- Added the complete rectus interval list, including the inferior attachment, to
  the incremental growth relief. Standard and custom inscriptions remain available;
  their resting shape/detail relief is retained separately from added growth.
- Growth exposure is derived from the existing neutral costal pectoral fan's
  inferior boundary, transformed through the same body mapping. The boundary is
  cached per parameter object and used by the existing master volume field,
  procedural rectus belly thickness, and rectus-to-covering genetics transfer.
  Added volume fades across 3 cm below that border instead of lifting the covering
  over the pectoral. This is an anatomical heuristic, not a new collision solver.
- Rectus transfer bins are separate from anterior neighbours, so covered rectus
  samples cannot dilute or displace independent pectoral transfer. Intrinsic genetic
  shape/volume correction remains available; it no longer projects directly through
  its superficial pectoral covering.
- Real-worker results at 2.5× direct growth, standard/custom two-inscription layouts:
  inferior skin displacement 6.0637/5.8776 mm on authored skin and 6.1020/6.0378 mm
  on legacy skin. Measured covered-region displacement is 0 mm (390/1,535 sampled
  vertices respectively). Authored master growth gives 15.0397/14.6658 mm inferior
  displacement and 0 mm in the same covered region. Pectoral vertices remain
  unchanged between resting and grown cases.
- Compared generation against HEAD: resting rectus and skin positions are unchanged
  at 4/6/8 segment settings on both skin models. The full rest mesh hash comparison
  also found at most .0561 mm of pectoral sternal seating variation on authored skin;
  no resting mesh topology or control range is replaced.
- Focused regression: `node scripts/check-anatomy.mjs --rectus-distribution`.
  Browser regression: `node scripts/check-rectus-distribution-browser.mjs <url>`;
  native segment/growth sliders, undo/redo and parameter reopening pass at desktop
  and 375×812. Existing rectus/pectoral, attachment/contact and full worker checks
  remain required, together with build/cache and priority UI/project checks.
- This corrects rest-space hypertrophy distribution. It does not claim exhaustive
  posed collision handling or repair the previously recorded neck/axillary/groin tips.


### Rectus shape-control regression — medial edge and inscriptions (2026-10-30)

- User reproduction: reduced apparent width response, an overly open linea alba,
  and a crooked second inscription after changing rectus shape/hypertrophy.
- Actual worker reproduction at rectGap=.1 cm, master/direct growth=2.5 and left
  genetic volume=1.8: varying genetic width .65/1/1.5 gave medial gaps about
  2.00/.574/1.46 cm (the widest case could cross the midline) and widths
  3.06/4.38/4.81 cm. The genetic transform scaled around a segment-wide centroid,
  so width also translated the medial boundary. Bilateral master volume fields
  additionally acted across the opposite side and widened central separation.
- Genetic rectus width now scales from each row's paired medial edge. Segment
  rounding/taper applies laterally from that edge rather than inserting extra
  medial spacing proportional to width. The small natural medial curve scales
  down with the separation control, allowing its existing .1 cm minimum to work.
  Master fields own their side and expand laterally without translating the
  medial half inward/outward. Existing width/separation defaults and ranges remain.
- The additional hypertrophy thickness tapers away at ordinary segment ends,
  retaining their authored tendon thickness and the pectoral exposure restriction.
- With attachments enabled, shape changes previously rotated each inscription's
  offset with a changed surface frame, adding roughly 4.5 mm of unwanted vertical
  variation to the second band in the narrow-width reproduction. Followers now
  retain their authored rest-space offset; poses rotate it from the CURRENT rest
  surface to the posed surface, rather than reapplying the recipe-to-growth change.
  The local frame is explicitly orthonormal. Custom angle/curvature and posing
  remain available; the neutral renderer retains the worker's tendon coordinates.
- Final worker controls (.65/1/1.5 width, minimum separation) preserve a constant
  .12447 cm medial gap on authored skin and .13432 cm on legacy skin. Authored
  widths are approximately 3.10/4.44/6.36 cm; legacy widths remain independently
  responsive. With/without attachments pass, volume targets retain their tolerance,
  and inscription Y coordinates differ by less than .01 mm between width variants.
- Native browser checks at 1280x900 and 375x812 measure a 1.24467 mm central gap
  across all three genetic widths, while actual width grows 31.03 -> 63.57 mm.
  Separation=2 cm gives 22.90 mm in the mapped body. Global width 2 -> 9 cm remains
  effective with the tested growth/genetics. Parameter reopening and undo/redo pass.
- Removing opposite-side inflation changes the master field distribution; its
  per-side gain is recalibrated to retain comparable visible strength. At 2.5x,
  standalone authored rectus skin displacement is 24.5898 mm (previously 22.9451),
  while standalone pectoral displacement stays exactly 23.4276 mm. No render or
  mesh resolution is reduced, and no growth/shape range is narrowed.
- Focused checks: `node scripts/check-anatomy.mjs --rectus-controls`,
  `--rectus-distribution`, `--rectus-boundaries`, full worker, build/cache/archive,
  priority UI/project fixture and `check-rectus-controls-browser.mjs <url>`.
  The scope remains procedural fitting, not medical calibration or exhaustive
  full-body posed collision handling. Existing unrelated muscle-tip issues remain.


### Rectus volume midline regression — restore continuous growth (2026-10-30)

- User reproduction: Rectus volume created a long central crease and pulled the
  navel, although the requested original correction concerned pectoral inflation.
  The later stagger request requires the deformation to remain driven by its
  existing parameter, with a neutral zero setting.
- Root cause: the recent bilateral-ownership guard excluded both rectus fields at
  x=0, but applied a full field immediately beside it. The new outward-only X
  clamp and compensating gain further changed the historical volume response.
  This was an actual deformation discontinuity, not missing mesh resolution.
- Product correction is three narrow line changes: restore the original .25 gain,
  continuous bilateral evaluation and signed transverse displacement. Retain the
  pectoral exposure guard and independent pectoral seating. Existing width/genetic
  controls, tendon direction fixes, custom inscriptions, ranges and models remain.
  This supersedes the per-side master-field choice/calibration in the prior entry.
- A new midline regression fails against 4553755 with a 24.7069 mm jump in growth
  displacement between nearby central samples. The corrected field gives jumps
  .4600/3.0506/3.5309 mm at volumes .2/2.5/3 (86 nearby sample pairs each).
- Compared generated skin directly with e503029: all 1,459 sampled vertices in
  the abdominal y=9.5–11.1 interval have exactly 0 mm difference at volume
  .2/1/2.5/3. Standalone 2.5x rectus displacement returns to 22.9451 mm; pectoral
  displacement remains 23.4276 mm. No ad hoc smoothing or extra sculpt was added.
- Stagger continues to use rectPattern (-1..1). No fixed asymmetric correction is
  added: zero yields 0 mm difference between left/right first inscription heights;
  -1/+1 yield -15.5274/+15.5274 mm on authored skin and -17.9731/+17.9731 mm on
  legacy skin. Skin surface profiles also respond in both directions, at neutral
  and increased volume. User-specified custom angle/curvature remain separate.
- `node scripts/check-anatomy.mjs --rectus-seam` covers central continuity and
  parameter-driven stagger on muscles/skin. Its browser counterpart uses the real
  volume/stagger sliders at desktop and 375x812, checks neutral alignment and sign
  reversal, undo/redo and parameter reopening, and captures opaque-skin views.
- Build, full worker, rectus control/distribution/boundary, priority UI/project,
  cache/archive and preservation checks remain required. The visible central
  regression is corrected without extending the body/contact model. Physical
  touch gestures and exhaustive posed collisions are not claimed verified.


### Three-way abdominal version selector (2026-10-30)

- Body -> Abdomen -> Muscles -> Abdominal wall now offers Original version,
  Current version and Legacy sheets. Existing IDs remain 0=sheets and 1=current;
  2 selects the original abdominal fan behavior from 9619032, before rectus/chest
  isolation. Current remains the default. Older projects without a model field,
  and invalid model values, continue to normalize to current.
- Original is a compatibility branch through the shared builders, not a copied
  body generator. It restores historical medial layout, centroid width morph,
  superior/inferior relief distribution, broad abdominal growth interaction,
  pectoral seating, surface transfer and connective-frame behavior. Its original
  skeletal fitting cage is retained for comparable attachment placement. Other
  current editor features and all existing abdominal parameters remain available.
- This deliberately includes the original abdomen/chest interaction for comparison.
  Direct rectus growth 2.5x moves pectoral samples about 3.85/3.89 mm on the two
  skins in original mode; current and sheets remain at 0 mm in that check.
  Original/current use fan obliques (2,542 vertices per side); sheets retain their
  existing 5,330-vertex construction. No mode is silently substituted for another.
- Compared original mode with the actual 9619032 kernels on both skins, with
  width=7, separation=.5, stagger=.7, master rectus=2.5, oblique=1.4 and direct
  growth=1.8, plus a genetic/attachment variant. Every compared abdominal,
  pectoral, skin and supporting-bone position matched within .001 mm. Focused
  bounds regression retains four historical rectus references without shipping
  historical source copies or generated reference meshes.
- Parameter normalization accepts all three IDs. JSON, undo/redo, project snapshots
  and ZIP reopening retain 2; missing-field imports retain the earlier default 1.
  Switching versions preserves rectus volume, width, separation, stagger and growth.
  English labels include Portuguese translations; the existing selector is reused.
- `node scripts/check-anatomy.mjs --abdominal-versions` exercises all modes on both
  skins and the historical references. `check-abdominal-versions-browser.mjs <url>`
  uses the native three-option selector at 1280x900 and 375x812, checks distinct
  geometry, compatibility, undo/redo and a full .babalon ZIP reopen. Full worker,
  current seam/control, production build and cache/archive/offline checks pass.
- Original is intentionally historical, including its limitations; it is not an
  alternative medical calibration or a promise to correct its earlier interactions.

### Current rectus width, inscriptions and opaque covering (2026-11-01)

- Comparison reference is the preserved original procedural version, with width
  9 cm, master/direct growth 3x and both sides at genetic width 1.5 / volume 2.
  No new reference asset is imported or bundled in this correction.
- The medial-anchor width morph widened the current combined maximum to 27.84 cm,
  against 24.61 cm originally. Broad covering smoothing also obscured inscriptions;
  opaque skin failed to cover several grown bellies. Restore centered capsule and
  genetic width, retain a separately pinned medial edge, then solve volume in depth.
- Superior rectus rows seat together behind the actual pectoral triangles at fixed
  X/Y. Smooth the seating depth between rows and restore its volume difference in
  exposed belly thickness. The chest and authored lateral envelope stay fixed.
- Current skin follows rectus even without global tissue-following enabled. Its
  covering solve respects individual muscle segments and actual tendon paths,
  including stagger and custom inscriptions. A final anterior triangle solve catches
  growth between skin vertices without radial folds or moving the protected chest.
  Tendon followers bind before morphology even without explicit attachment mode.
- The alternate implicit skin uses neutral master rectus in its base field for
  current mode; actual grown bellies provide the covering afterwards. This avoids
  the old broad master field changing chest depth or remeshing protected chest
  vertices. Covering exposure is sampled before deformation and retained by vertex.
- Support generation requests rectus, fascia and six pectoral fans, not all other
  muscles. These CPU support meshes are excluded from unrequested rendered layers,
  preserving subsequent visibility toggles and full-layer loading.
- Combined maximum widths: human skin 246.350 mm current / 246.103 mm original;
  alternate skin 339.747 mm current / 339.746 mm original. Without genetics, both
  versions match at 210.039 / 231.202 mm respectively. Requested genetic volume
  error remains below 0.0001% in these cases. Original pure and sheets retain their
  compatibility paths; no controls, ranges or stored interaction flags are removed.
- Focused worker and browser maxima checks cover both skins, opaque/hidden skin,
  desktop and 375x812, historical width, actual covering triangles, volume, independent
  chest growth and support-layer visibility. Existing controls, custom two-inscription
  growth, anchors, contact and historical-original checks remain required.
- This is a rest-space covering correction, not full-body collision. The alternate
  marching-cubes skin retains its visibly coarser surface at combined extremes;
  unrelated neck/arm/groin muscle coverage is outside this rectus correction.
- Verification passed: production build, full worker suite, focused maxima,
  two-inscription distribution, stagger and historical-version checks, lazy cache
  and archive checks. Native priority fixture passed including volume, side isolation,
  undo/redo, A/B, materials, pelvis, pectorals and JSON/ZIP. Browser maxima, width/gap
  controls and three-version persistence passed at 1280x900 and 375x812. Phone sizes
  were emulated; physical-device gestures and arbitrary dynamic poses were not audited.

### Continuation — generic humanoid GLB adaptation (P14–P16 / P11)

- Decoupled anatomy generation from hardcoded mannequin vertical coordinates by establishing canonical landmark template space in src/anatomy/landmarks.ts and segmented registration warps in src/anatomy/registration.ts.
- Automated mesh analysis in src/anatomy/fitBody.ts robustly detects mesh orientation (e.g. -90 deg yaw correction when arms extend along Z), metric scale factors (e.g. normalizing 0.98 m unit-cube AI assets to 1.80 m standard adult height), and horizontal cross-sections (leg split, pelvis, waist, chest, neck, head and lateral arm reach).
- Added src/anatomy/skinBinding.ts for binding target mesh vertices to underlying superficial musculature and skeletal landmarks, enabling bidirectional driving where muscle hypertrophy and pose displace the target mesh with exact zero drift at rest.
- Exposed scene model adaptation in src/anatomy/body.ts (daptToTargetMesh) and src/ui/panels/anatomy.ts under Actions, allowing users to adapt procedural anatomy to any selected humanoid model.
- Verified against user model <target.glb> (1.92M tris, 978K vertices, meshopt compressed): automatically identified -90 deg yaw, 1.84x scale correction, robust landmark derivation, valid registration warp, and zero-drift skin binding via scripts/check-generic-humanoid-fit.mjs.
- Regression suite passed: production build, check-generic-humanoid-fit, check-lazy-cache, check-project-archive, and check-offline-install.

### Continuation — pose-first inverse evidence (2026-11-04)

- Replaced raw posed-section measurement with neutral analysis-copy measurement, using existing rig mappings or manually adjustable Rig joint handles. Source vertices are unchanged at the fitted baseline.
- Replaced target-against-itself scoring with actual procedural surface candidates, consistent canonical coordinates and real-triangle proxies. Fitting runs in a dedicated disposable worker.
- Preserved parameter controls and added explicit height, fat and muscle constraints. Bone lengths from joints are evidence; missing dimensions and muscle/fat separation remain uncertain priors. Full independent long-bone fitting is still pending.
- Preserved rigged source meshes by transporting neutral deltas through inverse pose and skinning differentials. Distant unreliable correspondences are reported and left unchanged.
- Real browser verification on the user-provided target.glb: 978,609 vertices, 1,923,782 triangles; fitting took approximately 9–10 seconds. Baseline positions, material identity, UVs and indices were preserved, rectus edits moved skin, and reset restored the original positions. Native adaptation controls and 375x812 layout passed.
- With auto-placed joint hints, median correspondence distance decreased from 57.3 to 31.8 mm, but 47,186 vertices were unreliable and maximum distance reached 519 mm. Automatic shoulder placement and geometric limb segmentation still need refinement; these results do not establish complete anatomical reconstruction. Joint handles can be corrected manually. Saved-project restoration of runtime imported bindings remains pending.
- Production build, lazy-cache/archive checks, procedural solver, pose/rig differential and source-skin regression checks passed. No full P0–P9 suite or physical-device gesture audit is claimed.

### Continuation — shoulder correspondence and procedural bone lengths (2026-11-04)

- Corrected automatic arm endpoint selection: lateral extrema can be elbows, while an unrestricted distance search can select a leg. Search now excludes the trunk/leg columns and initializes elbow/wrist at anatomical fractions of the shoulder-to-fingertip path. Existing joint handles remain editable; these are estimates, not directly observed bone endpoints.
- Neutralization now fades upper-arm rotation into the shoulder and uses separate upper/lower neutral directions. Extended distal coverage includes the hand. Inverse rotations retain source-pose delta transport.
- Added optional serialized bilateral boneLengthsCm. Joint-conditioned humerus, forearm, thigh and shin estimates drive a continuous final proportion map after tissue fitting/contact, carrying distal segments and deforming bones, muscles and skin together. Pose pivots use the same chains; pelvic bones remain anchored. Existing parameters without length constraints retain their generated geometry.
- Uncertain grid correspondences now receive a global closest-triangle BVH check. Matches farther than 120 mm remain undriven, with smooth attenuation from 80 mm to avoid a hard reliability seam.
- On target.glb with automatic joint hints, median correspondence error decreased from 31.8 to 28.3 mm and maximum from 519 to 205 mm; unreliable vertices decreased from 47,186 to 7,681. Largest remaining outliers are at the feet. Initial fitting is approximately 14 seconds on this machine; incremental skin drive was about 90 ms. Thresholds changed, so unreliable-count comparisons are not a pure accuracy metric.
- Focused verification covers exact bilateral chain lengths, distal continuity, real procedural humerus deformation, pelvic-anchor preservation, existing rig differential transport, closest-triangle fallback, skin-growth/reset, production build and lazy-cache/archive checks. Automatic inference remains a coarse fit, not a full statistical or learned anatomy reconstruction.
- Research references consulted: [Inside Humans](https://www.frontiersin.org/journals/virtual-reality/articles/10.3389/frvir.2021.694244/full), [SKEL](https://github.com/MarilynKeller/SKEL), [SOMA](https://vcai.mpi-inf.mpg.de/projects/SOMA/) and [libigl](https://libigl.github.io/tutorial/). This change uses native procedural geometry and barycentric surface transport; it does not integrate their learned models, datasets or solvers.


### Continuation — constrained trunk inverse fitting (2026-11-04)

- Extracted the rendered generation pipeline into `src/anatomy/generation.ts`; the worker and trunk inverse evaluator share actual attachments, genetics, covering and final bone scaling.
- Added structural superior rectus-sheath patches for costal pectoral origins and resolved insertion patches after limb-length scaling. The sheath does not inherit rectus hypertrophy.
- Added a region-balanced, robust, regularized trunk pass with bounded support/shape updates, explicit parameter/shape locks, manual anchor penalties and held-out geometric validation. Missing osseous landmarks are priors, not skin observations. Pelvic bone genetics require independent ASIS/crest hints. Deep tissue composition, activation and tendon patterns remain priors.
- Replaced the fitting worker's isolated-triangle proxy with a connected meshopt surface (18,000 triangles, 2 mm canonical absolute error estimate). On the actual GLB, sampled original/proxy distance was at most 1.27 mm, without source-buffer mutation.
- Real GLB/browser run: reserved-sample mean trunk distance 32.23 -> 31.45 mm; chest 21.68 -> 20.85 mm, abdomen 35.34 -> 35.54 mm, pelvis 35.44 -> 33.65 mm in training samples. Abdomen did not improve; do not claim perfect reconstruction. Global median correspondence was 27.95 mm, with foot outliers around 205 mm.
- Baseline positions/materials/UVs/indices, growth/reset and visible procedural bone edits passed. Focused 2.5x rectus growth moved abdominal skin about 25.78 mm with no pectoral mesh drift; unilateral volume controls preserved the other side. Build, focused anatomy regression, connected-proxy check, native UI fixture at desktop/phone width, lazy cache and archive checks passed.
- Initial adaptation now costs about 131 seconds on this model (30 exact regional evaluations); imported skin-delta processing was about 96 ms, excluding generation. This cost is a known limitation. Internal subject-specific anatomy has not been validated against MRI/CT or a new ecorche scan.
- Scientific methodology, references, acceptance gates and reproducible commands: `docs/anatomy_inverse_trunk.md`. No trained HIT/SOMA model or proprietary template was integrated.

### Continuation: superficial fitting hints and facing (2026-11-04)

- Fixed an undefined explicit direction overriding automatic facing in direct GLB fitting.
- Added nine optional surface hints, persistent body assumptions, canvas placement/review and skin/muscle/bone inspection in the dedicated fitting panel.
- Separated tissue deformation from the skeletal field; bones and inguinal ligaments remain identical under surface hints. Material landmarks follow deformation.
- Native target.glb run: 18.34 s; maximum semantic residual 50.45 -> 14.01 mm, posed surface mean 8.74 mm; sampled tissue Jacobian minimum 0.301. Facing agreement 0.999998. External skin growth/reset and phone-width cancellation passed.
- Limit: representative landmarks on a partially clothed surface are not anatomical ground truth; fat/muscle composition and continuous inguinal-curve identity remain underdetermined. See docs/anatomy_inverse_trunk.md for evidence and method.

### Volume refinement verification (2026-11-05)

The target.glb browser run fitted 14 muscle sides with fixed bone buffers,
reference pose, and comparison transform. Held-out posed skin distance fell
from 8.62 to 3.34 mm. Mean regional surface distances in mm were 4.67 to 2.92
for chest, 12.15 to 5.80 for shoulders, 2.57 to 2.31 for abdomen, and 4.55 to
2.64 for the inguinal region. Muscle envelope distance to the inferred target
fell from 15.67 to 10.53 mm. Refinement took 23.7 seconds. A unilateral depth
profile check moved skin by 16.9 mm at its largest coordinate displacement.
Bone buffers were identical and opposite-side and pectoral drift remained
below 0.001 mm in their respective isolation checks.

### Cached drag preview verification (2026-11-05)

A browser run with target.glb verified motion in the procedural rectus and
bound skin during a warm drag, followed by an exact worker result on release.
The procedural update took 2.1 ms. Installing the imported preview buffers
took 9.0 ms and uploaded 23.5 MB. The following update took 1.4 ms and uploaded
4.9 MB. Exact release took 1.18 s, including 1.05 s of generation. Mesh objects
were reused and reset restored the imported vertex positions exactly.

Authored normals remain intact on unaffected faces. Local width, curvature and
peak controls passed the side isolation, fixed bones and attachment checks.
A cold control needs a generated sample and the drag preview is a local linear
approximation until the exact result arrives.

### hypertrophied reference reference verification (2026-11-05)

The native import contained 1,010,635 vertices and 1,984,544 triangles. The
fixed-skeleton pass widened three rectus cross-sections from 93/107/123 mm to
103/115/137 mm. The sternal and costal portions now solve separate depth
profiles. Front-facing torso samples preserve their height and lateral position
when measuring projection. The held-out skin distance was 4.55 mm. Neutral
material comparison still shows a flatter lower pectoral contour and residual
abdomen and shoulder differences. Posed normal winding now matches the generator
and the restored hypertrophied reference skin had area-weighted normal alignment of 0.980.

The measured import took 0.56 s and the initial fit took 17.77 s. The cached
posed proxy was reused for volume refinement. After the cubic thickness
solver, refinement took 18.34 s versus 23.19 s in the preceding run. Exact
release took 4.86 s versus 5.82 s. Warm procedural and bound-skin updates took
8.2 ms and 2.1 ms respectively, with 5.83 MB sent on the steady skin update.
The browser verified unchanged bones and pose, buffer reuse, external-skin
growth and exact source reset.

### Continuation — fitted rectus width and inguinal hint bounds

- The local écorché GLB has bilateral rectus, external/internal oblique, iliacus and hip bone meshes. In quantized accessor coordinates the left rectus spans Y 8613–12603, the left hip bone 8301–10361, and the left external oblique 8695–12915. These bounds establish layer coverage relative to the pelvis. They do not locate the inguinal ligament or determine another physique's muscle thickness.
- Fit five width coefficients per side from agreement across lateral skin rays. Use one height coordinate across tendinous intervals in the current rectus mode. Save the estimates separately from manual overrides. Attenuate or skip distant inguinal surface constraints while keeping pelvic supports fixed.
- hypertrophied reference and smooth-surface reference passed the real browser GLB refinement and ZIP round-trip without the source entity. Bone buffers and pose stayed fixed during refinement. The saved width multipliers peaked at 1.011 and 1.014 respectively. The complete refinement had mean abdominal surface errors of 2.37 mm and 2.21 mm, which include skin registration and do not isolate the new width estimate.
- The shared structural inguinal curve, ecorche insertion measurement, and isolated held-out silhouette evaluation remain open.

### Continuation — manual abdominal stations and shared inguinal edge

- The local écorché manifest exposes both external obliques and hip bones. No separately named inguinal ligament or aponeurosis was identified. The shared rail is a procedural interpretation of that layered reference.
- The aponeurosis now seats on the superior face of the generated ligament in a standalone body and in the attachment solver. The posed solver resolves the ligament endpoints before the aponeurosis. Existing bone anchors and mesh topology are retained.
- On saved hypertrophied reference and smooth-surface reference fits with skinFit removed on both sides of the comparison, bones and rectus vertex buffers matched exactly. The maximum anterior-shell edge displacement was about 12 and 11 mm in author units. The skin buffer changed on both models. This comparison isolates the structural change and does not establish closer silhouette agreement with either target.

### Continuation — orthographic contour check and transfer profiling

- Compared 77 horizontal triangle sections of the posed procedural body and each original GLB in the same canonical frame. Used the same fit parameters for both generator versions and disabled skinFit. The sampled front and side outlines coincided before and after the inguinal connection change. This comparison covers the external outline, not the interior crease.
- The largest mean side-view errors were in the lower pelvis, at 13.38 mm for hypertrophied reference and 9.47 mm for smooth-surface reference in canonical units. Both models were shallower than the target in this band.
- Cached the ordered transferSurface neighbourhood once per occupied skin voxel within each call. On generated meshes using the saved fits and the same controlled muscle displacement, positions and normals matched byte for byte. Warm median transfer times were 112.1 to 15.2 ms for hypertrophied reference and 90.6 to 12.5 ms for smooth-surface reference in the Node benchmark. This measures one pass, not drag latency or the full fit.

### Continuation — lower pelvis projection

- Added bounded anterior and posterior covering offsets, with smooth height and lateral falloff. Defaults are zero. These controls shape the skin and displayed adipose shell without changing the bone or muscle recipes.
- Compared original GLB contours and the saved procedural fits with skinFit disabled. At +17/+10 mm front/back, hypertrophied reference lower pelvis side-view error changed from 13.38 to 3.84 mm. At +8/+11 mm, smooth-surface reference changed from 9.47 to 3.76 mm. Frontal changes were below 0.01 mm in mean absolute contour error. Both comparisons preserved bones, inguinal ligament and rectus buffers. smooth-surface reference also passed the same invariant in all three rectus modes.
- These are manual covering controls. Editable fat thickness, including add/remove/smooth painting, is a separate feature.

### Continuation — local fat paint

- Added a saved sparse thickness grid in rest-surface coordinates. Pointer strokes add, remove or smooth the field and commit as a single edit on release. The covering and displayed adipose layer regenerate from that field. Skeletal supports are cached independently of paint.
- Exercised all three brush modes through browser pointer input on saved fits derived from the original hypertrophied reference and smooth-surface reference GLBs, with skinFit disabled. The painted field reopened exactly from a .babalon archive without the source entity. The three abdominal modes all preserved bone, rectus and inguinal ligament buffers. Maximum skin displacement was about 9.4 mm on hypertrophied reference and 9.1 mm on smooth-surface reference for the tested strokes.

### Continuation — deltopectoral projection profile

- Écorché accessor bounds show overlapping lateral extents for the clavicular pectoralis and anterior deltoid. Use separate procedural patches with a local, depth-only transition and fixed attachments.
- Replaced nearest-row deltoid sampling with a weighted local rail. Store a bounded clavicular projection profile from posed anterior rays and the regional fat prior.
- Compared the original fitting GLBs with the same saved parameters in both generators and skinFit disabled. The clavicular vertex displacement peaked at 2.7 mm on hypertrophied reference and 5.6 mm on smooth-surface reference in author units. Bones, rectus and external obliques matched byte for byte. Mean anterior error in the transition remained 21.9 and 19.1 canonical mm respectively. The side-view anterior envelope also stayed effectively unchanged. The internal change does not establish a visible fit improvement.

### Continuation — fitted pectoral covering

- Fit six bounded covering coefficients per side from anterior ray evidence after the internal pectoral fit. Evaluate the localized profile in reference pose before the optional skinFit residual. The mask excludes the abdomen and posterior surface. Skin and adipose receive the same displacement at the outer sample.
- Real browser comparison on the hypertrophied reference and smooth-surface reference GLBs toggled only the new covering profile, with skinFit disabled on both sides. The anterior transition error changed from 21.58 to 12.14 mm on hypertrophied reference and 18.30 to 15.70 mm on smooth-surface reference. Side-view anterior envelope error changed from 9.05 to 3.28 mm and 9.56 to 3.98 mm. Values are canonical millimetres against the GLB surface proxies. Bone, rectus, external-oblique and lower skin buffers were identical in the comparison.

### Continuation — upper and lateral deltopectoral refinement

- Added two bounded projection terms per side after the base pectoral covering fit. One removes lateral excess and the other fills the upper transition. Accept the pair only when it improves withheld ray samples. Both terms are independent of skinFit and have zero influence below the chest.
- In the real GLB comparison, smooth-surface reference lateral error changed from 35.73 to 26.84 mm and upper error from 31.05 to 26.98 mm. hypertrophied reference changed from 13.57 to 13.38 mm and 42.74 to 34.51 mm. The mean anterior profile error increased by less than 0.1 mm on each model. Values are canonical millimetres. Bones, rectus, external obliques and skin below the chest matched exactly.

### Continuation — procedural posing path

- Restored the procedural Pose panel and saved pose offsets. Removed the anatomy-only skeleton, GPU weights, and deferred skeleton-to-imported-skin synchronization. Imported humanoid rigging retains its own path.
- Kept the worker-computed reference positions and shared joint pivots. Pose-only updates reuse the existing mesh topology and UV buffers and resolve attachments after deformation.

### Continuation — six-pack groove detection on hypertrophied reference

- Detect two ordered abdominal valleys per side from detrended depth at two scales. Require support in three transverse columns, keep manual overrides, and isolate fitted grooves from skeletal support generation.
- hypertrophied reference accepted the upper candidate at canonical Y 1.259 m bilaterally and lower candidates at 1.173 m left and 1.159 m right. Browser bone, pose and root invariants passed. Held-out rectus envelope errors were 9.77 to 3.65 mm left and 9.97 to 3.70 mm right within the new topology. This is not a direct score against the old topology.
- With skinFit disabled, the exposed rectus still appears narrow and the covering does not reproduce the broad individual bellies. These remain open geometric fitting problems.

### Continuation — coupled rectus belly profiles on hypertrophied reference

- Sampled the target in three transverse rows per detected belly. Saved bounded width, lateral peak and projection by side. The external-oblique and aponeurosis borders share the rectus width displacement, which fades to zero at the divisions.
- Compared the same fitted parameters with the belly profile disabled and enabled and skinFit disabled. The hypertrophied reference anterior profile error fell from 2.89 to 2.67 mm. Front depth error rose from 4.07 to 4.31 mm in the upper region, 3.67 to 4.10 mm in the middle, and 3.68 to 3.91 mm in the lower region. All widths reached the 1.16 automatic limit. The bone buffers matched and the same detected divisions were used for both renderings.

### Continuation — relief-based rectus segmentation (2026-11-05)

- Reference reading (canonical metres, 3–20 mm band-pass of anterior depth on the original GLBs). hypertrophied reference: navel 1.078; inferior pectoral fold 1.25 lateral to 1.27 medial; intersections L 1.214 / 1.150 / 1.098 and R 1.218 / 1.166 / 1.106, the top one weak (0.5–0.9 mm); a weak sub-umbilical valley near 1.06. smooth-surface reference: navel 1.11; fold 1.26–1.31; one strong intersection at 1.156 / 1.168 and weak valleys near 1.236 and 1.104. Linea semilunaris 8.4–12 cm from the midline on both.
- What was wrong: the previous detector searched exactly two grooves in fixed canonical windows. On hypertrophied reference it accepted the inferior pectoral fold (1.259) as the first intersection and merged the third row into the infra-umbilical belly, giving a four-pack layout. Its fixed lateral columns (2.6–6.2 cm) also assumed a narrow rectus. The generated lateral rectus edge sat 5.5–7.5 cm from the midline.
- Built: `surfaceRelief.ts` (relief grid, horizontal valleys with prominence, column support and slant, ordered sequence selection with count prior, spacing line, anchor and inferred slots) and `rectusSegmentation.ts` (navel, semilunaris, pectoral fold, two to four intersections, joint count for both sides). `fitVolumes` uses it for any segment count in the current abdomen; inferred intersections are shallow and level; bellies generalize to intersections + 1; the measured semilunaris drives `fittedWidthProfile` (bound raised to 1.6).
- Results in the real fitting path (decimated proxy, neutral pose). hypertrophied reference: L 1.222 / 1.170 / 1.110, R 1.218 / 1.154 / 1.102, positions 0.736 / 0.616 / 0.490 and 0.736 / 0.589 / 0.490, four belly profiles per side. Generated lateral edge 7.9–11.3 cm against the measured 8.4–12 cm; middle stations reach the 1.6 limit. smooth-surface reference: L 1.242 / 1.174 / 1.106, R 1.242 / 1.162 / 1.110 (outer ones low confidence). Held-out skin distance unchanged (hypertrophied reference 4.47 mm, smooth-surface reference 3.34 mm).
- Known issues: hypertrophied reference rectus envelope validation rose from 5.3 / 4.8 to 8.8 / 7.9 mm with the wider margin (smooth-surface reference 5.3 / 5.8 mm); the thickness profile does not yet thin the widened lateral edge into the groove. Arms, upper trapezius and forearms are still outside the volume fit. Sub-umbilical intersections need stronger evidence than these two models provide.
- Checks: `npm run build`, `check-anatomy-muscle-envelope.mjs`, `check-lazy-cache.mjs`, `anatomy-priority.html` fixture PASS. `check-anatomy.mjs` fails on the catalogue control count (115 vs 102) from the existing uncommitted catalogue edit.

### Continuation — fit order, arms and upper trapezius (2026-11-05)

- What was wrong: the rectus width profile was fitted after the per-vertex depth observations, so the thickness solve and its held-out validation referred to the narrow section (hypertrophied reference rectus 8.8 / 7.9 mm). The belly width also widened the section a second time on top of the measured margin. Arms and trapezius were outside the envelope fit, so hypertrophied arms left the skin far outside generic muscles.
- Built: the semilunaris width fit now runs before envelope sampling; belly width stays neutral when the margin is measured. The envelope solver now also fits trapezius upper, biceps long/short, triceps long/lateral and brachioradialis (superficial only; deep muscles keep their prior). The middle trapezius was tried and removed: asymmetric gains (2.1× vs 5.6×) without held-out improvement. Held-out validation (every fifth sample) now covers every fitted muscle as `muscleValidation`; `abdominalValidation` is its rectus/oblique subset.
- Held-out envelope error, before → after refinement, mm (L / R). hypertrophied reference: rectus 10.2→5.0 / 10.1→4.2; biceps long 10.0→7.6 / 9.7→7.1; triceps lateral 16.7→7.2 / 14.1→6.6; triceps long 17.6→10.0 / 14.0→9.1; brachioradialis 10.9→6.5 / 10.1→6.4; trapezius upper 20.3→14.9 / 22.4→14.8. smooth-surface reference: rectus 6.1→4.1 / 7.8→4.5; biceps long 13.0→8.3 / 13.9→8.7; triceps lateral 14.5→5.7 / 20.4→7.6; trapezius upper 26.7→19.6 / 26.1→19.8. Skin held-out distance unchanged (4.47 and 3.34 mm). Whole envelope 17.2→11.6 (hypertrophied reference) and 15.4→10.2 mm (smooth-surface reference).
- Known issues: deltoid posterior and pectoral residuals stay 15–20 mm; the infra-umbilical rectus still tapers more than the hypertrophied reference skin suggests below the measured band; five width stations are coarse. hypertrophied reference refinement now takes about 60 s including the initial fit.
- Checks: build, `check-anatomy-muscle-envelope.mjs`, `check-lazy-cache.mjs`, `check-project-archive.mjs` pass; front views of both fits inspected with translucent skin.

### Continuation — where the remaining envelope error comes from (2026-11-05)

- Added an error budget to `muscleValidation` (profile, cap, pipeline) and a diagnostic `resolutionStudy` that refits each muscle's held-out samples with a finer 9×5 profile and a nearest-training-sample bound.
- hypertrophied reference: the residual is entirely "profile" (caps under 2.5 mm, later stages under 1.3 mm). A 9×5 profile barely helps (deltoid anterior 16.9→13.9, deltoid posterior 18.7→18.7, pectoral 15–16→13–15, rectus 5.0→4.8 mm), while the nearest training sample is 3–4× lower (deltoids 3.9–6.4, pectoral 6.1–8.2, external oblique 3.1–3.3, rectus 1.3–1.6 mm). The target depth changes sharply inside each template: the template footprint (outline, axis, attachments) is misplaced relative to the real muscle, and thickness along fixed normals cannot move it.
- Arms: 5×3, 9×5 and nearest all give 6–8 mm, so arm residuals are at the data floor of the current fat assumption, not a template limit.
- Next: boundary-driven in-plane warping of each superficial template from relief features (pectoral fold, deltopectoral groove, deltoid borders, semilunaris) before the thickness fit.

### Continuation — outline warp for deltoid and pectoral (2026-11-06)

- Built: `outlineWarp` / `costalOutlineWarp` (six chart coefficients: shift, stretch and shear in u and v) on the deltoid and pectoral heads. `applyOutlineWarp` (muscleEnvelope.ts) slides each muscle over its own deep shell before the thickness envelope, keeping thickness; both ends stay fixed (fade toward u = 0 and 1) and reading past the template edge saturates softly at 5% of the chart. Saved in the definition with bounds (±0.2 shift, ±0.35 others).
- Fit (`inference/outlineFit.ts`): coordinate search, 24 regenerations, all muscles tried at once; each keeps a move only when its held-out error after the envelope fit's own regularized 5x3 thickness solve drops, and never when its 99th-percentile edge stretches by more than 30%.
- Rejected on the way: a linear (gradient) step either saturated its bounds or did nothing, because a nearly free thickness profile was a poor predictor of the real smoothed solve. Unpinned deltoids slid off the scapular spine: the posterior deltoid's held-out error fell to 6–10 mm, but the anatomy was wrong (seen in a software back-view render), so the ends are now always pinned.
- Held-out envelope error, before → after (mm, L / R). hypertrophied reference: pectoral sternocostal 15.6→7.4 / 16.4→8.2; clavicular 16.4→14.1 / 16.1→14.0; deltoid anterior 16.9→15.0 / 17.2→16.0; middle 11.6→10.2 / 11.8→9.6; posterior 20.3→19.4 / 18.1→16.3; whole envelope 11.6→9.9. smooth-surface reference: clavicular 20.4→11.3 / 15.6→7.3 (outline score); sternocostal 7.3 / 7.1; deltoid anterior 17.3→13.7 / 19.7→12.8; whole envelope 10.2→9.1. Skin held-out 4.52 and 3.45 mm.
- Known issues: the posterior deltoid's misfit is not an outline problem once its origin is fixed (likely the template origin line or the rear-shoulder covering); the smooth-surface reference clavicular head compresses toward the clavicle into a thicker upper ridge; refinement now takes about 170 s on hypertrophied reference and 120 s on smooth-surface reference.

### Continuation — rectus placement, width and fold; outline warp on oblique and trapezius (2026-11-06)

- Diagnosed with software renders of the fitted hypertrophied reference abdomen, with the detected skin features drawn on top (intersections, semilunaris, pectoral fold, navel):
  - the rectus grooves sat about 2 cm below the skin grooves and the lowest one was missing, because observed heights were mapped through the skin chart while the rectus is registered separately;
  - the rectus ended about 2 cm short of the semilunaris and narrowed to a point under the pectoral;
  - on smooth-surface reference, the pectoral costal head hung about 7 cm below the skin fold (95th percentile, unwarped template) and covered the top row.
- Fixed:
  - heights are now mapped through the rectus's own continuous shell (`rectusChartY`, column u = 0.4);
  - the width ratio is bounded at 2.0 (it was clipped at 1.6) and holds its widest top value up to the costal margin; below the navel it fades out over 20 cm;
  - over the rectus, the relief-measured fold sets the costal-head lift (up to 80 mm, at most 80% of the head height) instead of the local depth heuristic.
- hypertrophied reference:
  - all three grooves sit on the skin lines and the top row is full width;
  - the generated margin is 1–2 cm inside the measured groove centre, as intended;
  - rectus held-out 4.0 / 4.1 mm; whole envelope 9.7 mm; skin 4.56 mm.
- smooth-surface reference:
  - middle and lower grooves are aligned and the costal head now sits above the fold;
  - rectus 3.3 / 4.1 mm; external oblique 8.4 / 8.1 mm; skin 3.43 mm.
- Outline warp now also covers the external oblique and upper trapezius:
  - hypertrophied reference: oblique 12.5→11.3 / 12.9→12.0, trapezius 14.9→12.1 / 15.2→14.4;
  - smooth-surface reference: oblique 10.1→8.8 / 9.0→7.5, trapezius 19.5→14.4 / 19.7→16.1 (outline score).
- Known issues:
  - the smooth-surface reference top rectus row stays recessed behind the costal cartilages, because the fixed `rectusTuck` assumes the template pectoral border;
  - small costal-head slivers remain at the medial end of the fold;
  - the infra-umbilical rectus still tapers to the pubis more sharply than the hypertrophied reference skin suggests.
- Tooling note: the Vite dev server sometimes kept serving stale modules after scripted edits; restart it before measuring.

### Continuation — why the app result differed; shoulder–trapezius gap (2026-11-06)

- Cause of "it does not look like this when I run it":
  - rectus segmentation, outline warps, arm/trapezius envelopes and the fold-driven pectoral lift all run in `fitVolumes`;
  - the worker calls `fitVolumes` only for "Refine muscles and fat", and "Fit and use as skin" / "Fit only" never did;
  - every verification above ran fit + refine.
  - Fixed: a fit now continues straight into the refinement (one activity, 40% / 60% progress, cancellable again at the start of the second stage). Saved projects keep their old values until they are fitted or refined again.
- Shoulder–trapezius gap, diagnosed with a skin gap map (distance from each skin point to the nearest muscle or bone) on hypertrophied reference through the "Fit and use as skin" path (unknown surface, skin bound):
  - the lateral neck base and the top of the shoulder stay 22–40 mm from any structure;
  - side renders show a thin upper trapezius sheet and thin neck strands where hypertrophied reference has a large neck–shoulder mass;
  - the upper trapezius depth profile thins near the neck (26 of 42 held-out samples outside the reserve) and thickens toward the shoulder, with very different left/right gains.
- Added a coverage term to the outline score (skin points near the superficial muscles, assigned once to the nearest one; mean depth beyond muscle plus fat). It changed little on hypertrophied reference: trapezius coverage 6.1→5.4 / 7.7→7.6 mm, middle deltoid around 16 mm, clavicular pectoral 10.9→9.4 / 10.5→10.2 mm. The gap map is unchanged.
- Conclusion: the gap is missing template volume (upper trapezius and neck mass), not placement. It needs a rebuilt upper trapezius / lateral neck from the écorché (measure → build workflow). The rounded pectoral shape is limited the same way: clavicular head 13–14 mm held-out error.

### Continuation — descending trapezius wraps the neck-shoulder slope (2026-11-06)

- Measured on the hypertrophied reference fit (UI path: unknown surface, skin bound), right side, per height | distance from the midline:
  - at the lateral neck base (1.47–1.53 | 0.09–0.18 m) the skin front lay at z 0.00–0.06 m, while the most anterior muscle was the trapezius at z −0.06 to −0.10, leaving 75–134 mm of empty space;
  - at the very top of the shoulder the trapezius was already within 7–12 mm of the skin.
- Cause: every descending-trapezius fibre sat on the posterior contour of each horizontal torso section, angled from |x| alone. Its front fibres (occiput → lateral third of the clavicle) jumped to the clavicle only at their last fifth, and a clamp kept them behind the spinal line.
- Built: in `anatomicalTrapezius`, the front fibres (fading out by s = 0.36) now rotate round the section from the back of the neck to just in front of the side (0.44π) as they descend (t 0.10 → 0.80). They follow that surface point and normal, so the envelope thickens them outward over the slope. The insertion, the transverse and ascending parts, and the attachments are unchanged.
- Default body: the side view shows a trapezius wedge from the neck over the shoulder to the clavicle. A combined skin-and-muscle render at back = 1 and 2.5 shows no trapezius through the skin; only the pre-existing small neck strands show at the back of the neck.
- hypertrophied reference lateral neck-base gaps:
  - 1.50 | 0.12 m: 113 → 34 mm;
  - 1.50 | 0.15 m: 98 → 15 mm;
  - 1.53 | 0.12 m: 75 → 23 mm;
  - 1.47 | 0.18 m: 134 → 50 mm.
- The gap map's red band over the side of the neck-shoulder slope is gone on hypertrophied reference and smooth-surface reference. Held-out trapezius errors (hypertrophied reference 18.2 / 16.1, smooth-surface reference 23.4 / 15.8 mm) cover a much larger slope now and are not comparable with earlier values. Skin 4.67 and 3.49 mm; rectus unchanged.
- Remaining:
  - in front of the trapezius–deltoid junction (1.50 | 0.18 m) the gap is still about 105 mm;
  - the clavicle–anterior deltoid front (1.44 | 0.21 m) is about 59 mm;
  - small spots beside the neck base remain;
  - the smooth-surface reference trapezius warp is asymmetric.

### Continuation — pectoral thickness rebuilt from the écorché and hypertrophied reference (2026-11-06)

- Shared frame for the écorché, the reference GLBs and the generator: origin at the jugular notch, unit = sternum length (écorché 16.1 cm, generator sternum spline 14.106 → 12.579 authored), right side.
- Écorché findings:
  - The pectoral outline matches ours closely, except that our infero-lateral border hangs lower (bottom at x 0.9: ours −0.93, écorché −0.59) and is 0.15–0.2 wider at y −0.7 to −0.9.
  - The écorché muscle sits on the ribs (back-to-cage median 0). Ours floats 4–5 cm under the clavicle, with median 5 mm elsewhere once cartilages and intercostals count as support.
  - Own thickness, medial / central / lateral / lower (sternum units): écorché 0.061 / 0.143 / 0.134 / 0.048, ours 0.021 / 0.086 / 0.109 / 0.021. The écorché peaks centro-laterally just above the fold (x 0.7–0.9, y −0.4 to −0.7, about 3–4 cm).
- Built:
  - `data/pectoralReference.json`: the écorché own-thickness map (13 × 17 nodes, 0.1 sternum units, smoothed; derived measurements only);
  - a hypertrophied reference development map: skin minus fitted rib envelope minus fitted chest fat, divided by the écorché map, normalized to mean 1 over the reliable band (y −0.2 to −0.9, x 0.2 to 0.9), smoothed, clamped 0.6–1.8 and moderated halfway toward 1;
  - `pectoralReferenceThickness` in geometry.ts. The fan's thickness reads the map at the fibre's position, scales it by growth and blends toward the development map as growth rises (full at +1.2).
  - Default magnitude matches the previous mean (scale 0.95).
  - A short origin taper is used on the sternal and costal origins only; the clavicular origin keeps the long taper, because the skin over the clavicle is thin.
  - Beyond the anterior axillary fold, judged both along the fibre and by position, the previous tuned belly/tendon profile is kept: the arms-down écorché cannot describe the fibres that follow the arm.
- Checks:
  - Default body: no pectoral through the skin at 1× and 2.2×. At 3× it pokes at the front of the shoulder exactly as the previous pectoral does (compared with a temporary old-formula switch, since removed).
  - An earlier apparent 2.2× poke came from stale generation state after repeated edit/reload cycles; it did not reproduce in a fresh page.
- hypertrophied reference ("Fit and use as skin" path), held-out envelope error (L / R): sternocostal 8.9 / 9.4 mm (was 7.6 / 8.2), clavicular 14.4 / 14.4 mm (was 13.3–14.1), whole envelope 10.18 mm (was 9.97). Skin 4.67 mm, rectus unchanged.
  - The rebuilt distribution is better grounded for the generator but did not improve the fitted error. smooth-surface reference was not re-run.
- Not done:
  - head layout: the clavicular head descending along the deltopectoral groove, and the sternocostal/abdominal shield;
  - seating under the clavicle;
  - the lower-lateral border shape;
  - a better skin-derived development map (it needs the fitted chest fat and a cage that actually matches the reference body).

### Rectus relief from the original surface

- On hypertrophied reference the upper right candidate had support in four of five columns on the original surface and two of five on the simplified surface, at the same height. Both surfaces returned three candidates per side. Tissue refinement now uses the original surface for rectus segmentation on both cached and uncached reference fits. The proxy remains the target for bulk fitting.
- The hypertrophied reference soft-tissue worker run with an automatic reference pose authored all three divisions on each side. The held-out envelope residual was 11.3 mm on each rectus and 26.4/26.5 mm on the external obliques. These values compare the starting and fitted geometry in one run. They do not isolate the effect of sampling the original surface. The smooth-surface reference and the browser fitting path were not exercised in this pass.

### Higher-resolution abdominal envelopes

- Chrome editor fitting with imported skin binding completed on hypertrophied reference and smooth-surface reference. Held-out rectus envelope errors were 3.4/3.5 mm on hypertrophied reference and 2.9/3.2 mm on smooth-surface reference. External oblique errors were 9.2/9.5 mm and 7.0/6.9 mm respectively. Skin validation was 4.67 mm and 3.55 mm. These runs used a 9-by-5 abdominal profile and the original surface for the inferior pectoral fold. The inguinal template was not reshaped in this pass.

### Rectus dome width and superficial inguinal crease

- The prior fit measured the rectus margin but set every belly width to 1 when a margin was present. The new fit measures the dome inside that margin and compensates the fitted line height for the chart pivot. Axillary depth samples use the original aligned surface. Adjacent inguinal crease samples must agree before they influence the skin registration.
- Chrome hypertrophied reference held-out envelope residuals were 3.5/3.9 mm for rectus, 9.1/9.5 mm for external oblique and 8.9/9.9 mm for sternocostal pectoralis. smooth-surface reference returned 2.9/3.2, 6.9/6.9 and 8.2/7.9 mm respectively. Skin remained at 4.67 and 3.55 mm. These results do not establish a tighter hypertrophied reference rectus fit or a fitted deep inguinal ligament.

### Reference pose and posterior coverage

- In the hypertrophied reference parameter snapshot, an anterior/posterior depth probe against procedural skin found zero latissimus samples more than 2 mm outside with reference pose disabled, and 16 with it enabled. The longitudinal arm blend brought that to three. Applying the same change to the pectoral costal head increased crossings, so the pose change was restricted to latissimus.
- Chrome comparisons at 28% imported skin opacity showed fewer overlapping patches at the thoracolumbar fascia in hypertrophied reference and smooth-surface reference. Held-out rectus residuals were 3.5/3.9 mm and 2.9/3.1 mm respectively. The axillary and inguinal contours still require separate work.

### Fitted rectus inscription seating

- The fitted strips previously selected the nearest outer vertex in 3D, which can select a neighbouring belly. The continuous shell chart now supplies the strip coordinates before subsequent fitting and posing. On the saved hypertrophied reference fit, all six strips retained 136 followers each and their outer vertices were within 0.501 mm of the resolved support patch. The trunk fit and archive checks passed.

### Axillary edges, inguinal rail and shoulder shelf

- The fitted pectoral edge can move across its chart toward the deltoid rail while preserving attachment rows. The aponeurosis selects its rail from the actual inguinal tube cross-section. On both saved fits its posed attachment residual was under 0.001 mm; this is a seam metric, not a GLB crease error.
- A full or partial fibre-based deltoid reference-pose blend changed the silhouette adversely in browser captures and was removed. The retained version reconciles adjacent fitted deltoid heads and rejects shoulder footprint trials with excess coverage error.
- Chrome held-out upper trapezius errors improved from 18.2/16.1 to 16.8/13.4 mm on hypertrophied reference and from 22.4/16.9 to 17.1/15.0 mm on smooth-surface reference. Skin validation was 4.68 and 3.54 mm. Deltoid changes were mixed and the residual axillary gap remained visible.

### Local sternocostal projection

- Chrome fitting accepted the correction on hypertrophied reference's right side (9 held samples, 11.02 to 9.92 mm). hypertrophied reference left improved by 0.31 mm, below the 0.35 mm gate. Both smooth-surface reference candidates regressed and were rejected. Whole-skin validation remained at 4.68 and 3.54 mm. The remaining axillary contour mismatch was still visible.

### Posed lumbar layer contact

- Contact samples the fascia triangles after posing and recesses the outer shell of the latissimus, erectors and external oblique where covered. The hidden and displayed fascia support positions matched exactly on both browser-fitted parameter sets.
- In the measured lumbar band, sampled outer vertices beyond the fascia decreased from four to two on smooth-surface reference. hypertrophied reference had zero crossings before and after. Chrome captures remained visually similar. The remaining markings need separate diagnosis and do not establish a fascia crossing.

### Posed arm cross-sections

- Fitting samples upper-arm and forearm sections in the target chain's frame. A bounded three-station profile adjusts the muscle union where held-out radii improve without additional crossings at those samples.
- hypertrophied reference predicted held-out radial errors were 12.2 to 10.8 mm and 11.9 to 10.2 mm on the upper arms, and 16.1 to 11.2 mm and 11.2 to 7.9 mm on the forearms. smooth-surface reference accepted a right forearm correction (10.3 to 8.7 mm). Desktop and mobile Chrome captures still show contour gaps, especially around the elbow.
