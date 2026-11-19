# Parametric anatomy

## Physique studio

Add → Parametric models → Physique studio opens the editable body. The overview
shows ten starting physiques with different stature, torso-to-leg proportions,
muscle distribution and subcutaneous coverage. These are illustrative shapes,
not athlete classifications or predictions of training results. Fat controls use
the model's thickness parameters, not a measured body-fat percentage.

Preset cards show front and side illustrations at a shared scale and describe
their main differences. Navel and chest surface details are collapsed by default;
the existing fitting and anatomical controls remain available. Run
`node scripts/check-physique-profiles.mjs` to exercise preset selection, generated
skin, undo/redo and desktop/phone layouts (Playwright or `PLAYWRIGHT_MODULE`).

## Parametric body

### Whole-body architecture

Body → Overview → Body genetics applies coordinated architecture to the chest,
shoulder girdle and neck, back, arms and forearms, pelvis and gluteal muscles,
thighs and calves. The eight starting architectures vary skeletal proportions,
muscle width/depth distribution, longitudinal belly extent and regional contours.
The separate fat and hypertrophy controls are retained. Each quick physique also
specifies a body architecture; its training and fat settings remain explicit.

New genetic variation uses a deterministic seed to recombine regional traits and
bounded shape variations. Both sides share each muscle recipe. Stored muscle
parameters are authoritative; the seed and architecture label are metadata, not
genetic inference or a dependency on an external model.

Fusiform `bellySpan` overrides retain endpoints and use the existing volume solve.
Width/depth changes compensate their target-volume multiplier. Authored genetics
bound the deltoid redistribution before this solve so hypertrophy does not amplify
the seam between the heads. Authored genetics
opt into normal-aware surface transfer around the full body; the established
front/posterior fitting transfer stays unchanged for other documents. Coverage is
confirmed against actual skin triangles and external rays, and welded skin seams
share corrections. Do not enable `skinFollows` just to implement a shape preset:
releasing the existing muscle skin cage can inflate superficial fans and distort
the covering. Authored genetics retain this support while varying shape.

Opaque anatomical skin casts the body's exterior shadow instead of combining
offset shadows from its enclosed layers. Transparent or hidden skin keeps the
internal casters; changing opacity refreshes the caster list. Regenerated meshes
retain shadow reception, including after
project restore. Visual checks must wait for material and shadow variants to
compile and render before capturing a comparison.

Run `node scripts/check-body-genetics.mjs` for the real selector and variation
button, same-fat/training comparisons, independent regional changes at a fixed
frame, muscle-volume checks, pose return, undo/redo, exact baseline restoration
and parameter/project round trips. Images include front/back/side skin and a
three-quarter muscle view. The test accepts the same Playwright and screenshot
environment variables as the abdominal check below.

### Abdominal architecture

Body → Abdomen → Abdominal genetics offers eight illustrative layouts, independently
of fat thickness and hypertrophy: balanced, long, broad, short, staggered, arched,
narrow and widely separated columns. Physique presets also choose a layout. These
are editable anatomical starting shapes, not inferred genetic information.

Both sides store their own tendinous intersections and optional authored `bellies`
in the existing anatomy definition. Segment width, peak and projection shape the
muscle; the surface reads the same intersections. The neutral surface comparison
uses the original band layout, rather than inheriting the candidate's intersections.
Fitting observations remain separate in `fittedIntersections` and `fittedBellies`.
Authored belly shapes participate in support-cache invalidation. Existing documents
without authored bellies keep their previous generation path.

Run `node scripts/check-abdominal-genetics.mjs` for actual dropdown selection,
same-fat surface comparisons, skin/muscle captures, cache invalidation, exact
baseline restoration, undo/redo and parameter/project round trips. Set
`ANATOMY_SCREENSHOTS` for images and `PLAYWRIGHT_MODULE` if Playwright is external.

### FORMA v5 update

The user-supplied `FORMA_v5.html` adds 18 shape controls, a reference atlas and a
kinematic pose preview. Its SHA-256 is
`b5a69b6cef7cfce5731deee277baedcf690c9a4ae10b04d22364922d8555c1ff`.
The authored skin reference is identical to the previously integrated reference.

Objects → Pose exposes 12 named motions and nine presets. The deformation is
applied to actual vertex buffers, preserving mesh/material identity during pose
edits; normals, bounds, inspection paths, picking and ordinary GLB export follow
the result. Posing does not rerun the geometry worker. This is the example's
heuristic joint-field preview, not skeletal IK or a physical tissue/contact solver.
Extreme poses can show artifacts. The ordinary imported-model Pose tool is unchanged.

Body → Anatomical atlas provides 123 muscle, 49 bone and 22 joint reference
records, region/search filters, attachment descriptions and illustrative profiles.
Records explicitly distinguish supported local growth, shared procedural groups
and documentary entries without an individual geometry control. These counts are
catalogue records, not independently generated anatomical structures. Prototype
volume/profile values have not been verified against their primary sources.
Local growth operates bilaterally; most controls affect internal muscle geometry,
while the new pectoral/rectus controls also drive bounded skin relief. It is not a
calibrated physiological volume or training model. Upper/middle/lower trapezius
growth drives regions of the existing continuous trapezius sheet, rather than
unused spindle definitions from the example.

The generator now includes converging pectoral portions, separate rectus bellies
with tendinous intersection/linea-alba geometry, curved iliac wings and acetabular
rims. New controls cover these structures, abdominal projection and regional fat.
Both skins, native PBR materials/textures, the independent fat envelope, study
lights and existing profiles/actions remain available. Fat follows both pose and
the new regional covering controls.

Parameter JSON version 7 includes pose and local growth. The importer accepts
the example's compact pose/parameter names only at the normalization boundary;
current names describe anatomical meaning. `.babalon`, autosave, duplication,
undo/redo and A/B retain pose and growth independently. Reset anatomy clears the
new shape, growth and pose settings. No project format version bump is needed.

The broader data-calibrated evolution remains a separate proposal in
[the implementation plan](../anatomical_generator_evolution_implementation_plan.md).
This update does not complete that plan's measured-data, full individual-bone,
full-body anatomical-joint or tissue-contact work.

Verification of this update: production build, numerical anatomy/pose/growth
checks, JavaScript browser flows at 1280×900 and 375×812, compiled production
pose/material smoke, translated atlas search, cache/archive/offline-install and
surface-brush regressions passed. The browser flows cover pose undo/redo,
rest-space texture coordinates, independent A/B pose, FORMA JSON import and
pose/growth ZIP restoration. Reduced-resolution desktop/phone images were
reviewed. Physical touch gestures and device AR were not exercised.

Add → Anatomical body creates one scene object with named, independently rendered
anatomical structures. Its panels follow the existing shell:

| Panel | Responsibility |
| --- | --- |
| Object | Name, scene transform, visibility and duplication |
| Body | Proportions, regional shape, profiles and parameter exchange |
| Layers | Skin, fat, muscles, bones and connective tissue; visibility, opacity, isolation and material access |
| Material | The ordinary PBR presets, color, roughness, metalness, textures and advanced settings for the selected structure |
| Light | Scene lighting and optional study illumination limited to the selected body |

Profiles, composition, mixing, inspection and parameter actions are collapsible,
so the first Body view opens on proportions. Layers has five explicit anatomical
groups rather than a flat list of technical shader layers.

## Structures and geometry

The structures are skin, subcutaneous fat, external oblique, internal oblique,
transversus abdominis, rectus abdominis, other muscles, bones, aponeuroses and
inguinal ligaments. They share a scene-object root but have separate geometry,
opacity and materials. Generated fragments do not flood the scene outliner.

The fat structure is a procedural subcutaneous envelope bounded by the covered
surface and the zero-fat surface, with an inner reversed surface. It follows the
regional fat controls and is generated only when requested. At zero thickness
it produces no fat geometry. This is an approximate educational representation,
not a reconstruction of an individual's anatomy.

The original 84 parameters remain available with meaningful current names;
separate fat opacity adds one parameter, and the FORMA update adds 18 shape fields
(103 scalar parameters including the surface selector). Inguinal groove width, height,
curvature, lateral wrapping, definition, sharpness, ridge volume and skin-fold
offset replace the former ambiguous shape name. Only `migration.ts` recognizes
old field names when opening original FORMA v5 JSON or older anatomy projects.
Current parameter export is version 7. Legacy file values are clamped rather than
rounded onto slider steps, preserving imported dimensions and the original defaults.

## Native materials

Each structure owns one stable `PBRMaterial`. Regenerating geometry replaces mesh
buffers, not the material, so edits and texture bindings survive. Material names
are anatomical; the normal Material panel selects the structure and reuses its
existing controls and undo. Reference A uses separate materials and is read-only.
The editable body B remains independent.

PBR is the default because it works with the existing editor, real scene lights,
HDR environments and glTF materials. A small material plugin optionally adds skin
microtexture, navel/areola color details, muscle fibers and tissue transitions to
the PBR surface. These effects can be disabled under Anatomical surface details.
Shine, natural skin tone and fiber controls remain available there. Ordinary color,
roughness and metalness controls remain authoritative for the material.

This changes the illumination response from the standalone shader; it does not
promise pixel-identical lighting. The original study-light presets are optional
real directional lights restricted to this body, configured under Light. They
allocate no lights until enabled. Other scene objects keep their own illumination.

Generated cylindrical UVs allow ordinary image textures without changing the
original mesh vertex count. These are generated coordinates, not an authored
character UV atlas. `.babalon` saves native material settings, detail settings,
reference appearance and the actual texture files. GLB exports native PBR values
and image textures; the procedural plugin is editor-specific.

Texture resource object URLs live until scene cleanup, rather than only until the
first upload: copies and glTF export may still read the source later. Resetting the
scene disposes resources and revokes those URLs.

## Architecture

- `parameters.ts`: current typed parameter and per-body state contract.
- `migration.ts`: isolated original/legacy parameter aliases.
- `catalogue.ts` / `.json`: control and profile data, original ranges and region labels.
- `structures.ts`: stable anatomical IDs, grouping, labels and material defaults.
- `reference.json`: CC0 authored human mesh and deformation coefficients.
- `geometry.ts`: preserved numerical kernels with anatomical identifiers. This
  legacy dynamic numerical port remains isolated behind typed worker messages.
- `fat.ts`: independent subcutaneous envelope generation.
- `anatomy.worker.ts` / `contracts.ts`: visible-structure generation and transferred buffers.
- `material.ts`: native PBR factory and optional anatomical surface plugin.
- `studio.ts`: opt-in study lights restricted to the body.
- `body.ts`: worker lifecycle, material cache, undo, comparison, inspection and exchange.
- `ui/panels/anatomy.ts`: Body / Layers and supplemental Material / Light controls.
- `ui/panels/material.ts`: the existing material controls, now also used by anatomy.
- `core/project.ts`: optional anatomy state and native texture persistence; no project version bump.

Workers reject stale results; reset also cancels bodies still being created.
Applied geometry emits `entities`; worker activity emits `activity`. Sliders stay
attached during background updates. Direct destructive mesh edits remain guarded
for a live parametric body; export/import GLB produces an ordinary static model.

## Source and verification

Source: user-supplied `vline_anatomy_reconstruido.html`, FORMA anatomy study.
Original HTML SHA-256:
`889465d8292afa0751dec76db52b1c3d8d327ed41e7f3a90e4ed6b9ffcafd171`.
The embedded surface declares CC0 and records source revision
`a8bc2d54ff0ac92e78ff71431b1023eda42bf482`.

Run:

- `npm run build`
- `node scripts/check-anatomy.mjs`
- `node scripts/check-anatomy-browser.mjs http://127.0.0.1:5194` with a dev server;
  install Playwright normally or set `PLAYWRIGHT_MODULE` to the bundled package.
  The script uses installed Chrome by default (`BROWSER_CHANNEL` can override it).
- `node scripts/check-lazy-cache.mjs`
- `node scripts/check-project-archive.mjs`
- `node scripts/check-offline-install.mjs`
- `node scripts/check-surface-brushes.mjs`

The JavaScript-driven browser check exercises actual PBR shader compilation,
standard material presets/sliders, image textures, regeneration, undo/redo,
A/B, ten structures, fat isolation, both surfaces, legacy names, JSON/ZIP restore,
GLB materials/textures, PNG, regional search, sliders and project-switch cleanup.
It checks 1280×900 and 375×812 and records runtime/network errors. Set
`ANATOMY_SCREENSHOTS` to save only low-resolution visual-review JPEGs (maximum
640 px wide). No Computer/Browser Use tooling is required.

Physical touch gestures, device AR, gyro and phone camera capture remain device checks.

A compiled production smoke is available with `node scripts/check-anatomy-browser.mjs http://127.0.0.1:5195 --production` against `npm run preview`.

### Individual priority-region controls

Body → Abdomen / Pelvis / Chest and arms contains an Individual anatomy section.
Choose the structure and side; Link both sides is explicit and initially on. Existing
body-wide controls remain available below. Ratios build on the current generated body.
Rectus, external/internal oblique, transversus and clavicular/sternocostal pectoralis
have separate width, depth, volume, fullness, reference-profile and activation values.
The hip bones have side-specific dimensions, iliac flare and acetabular orientation.
These are visual morphology controls, not physiological or genetic predictions.

Customize tendon intersections enables up to five independent rectus bands. Height,
angle, curvature, width, depth and extent deform a continuous shell. Use global
segmentation returns to the existing segmented generator. Structure identity is separate
from its rendering/material layer; native PBR materials remain stable.

Sparse version-1 definitions are optional; older projects retain their prior geometry.
Definitions survive history, A/B, duplicate, JSON and project archives. Supplied profile
coefficients and provenance are in `src/anatomy/data/priorityRegions.json`.
They are illustrative curves. Inspector cm³ values measure generated closed shells;
the target combines baseline volume with width/depth/development ratios. Normalization
preserves shell mid-surfaces and protected attachment-end bands.

Pelvic propagation and muscle-to-covering transfer are bounded geometric previews.
Both covered and lean adipose boundaries receive the changes. Hip pose pivots follow
pelvic edits. Stable anatomical area patches, tissue contact, measured fitting and
whole-body individual coverage remain pending in the consolidated plan. Existing pose
controls retain their extreme-pose limitations.

Run `node scripts/check-anatomy-browser.mjs <dev-url> --priority` for the new
UI/history/project path at desktop and phone sizes. It supports the same Playwright
module and reduced-resolution screenshot options as the ordinary check.

### Anatomical connections and sampled torso contact

Enable Anatomical attachments in the existing Individual anatomy inspector to connect
priority tissues to areas on named generated bone surfaces. Rectus uses pubic and
xiphoid/costal supports; abdominal sheets use crest/costal supports; pectoral portions
use clavicle/sternum/cartilage and humeral footprints. The inguinal ligament connects
púbis/ASIS, and the lower abdominal aponeurosis follows it. Locations remain procedural,
not measured coordinates. Tendinous intersections and linea alba follow the actual
rectus surface through morphology and pose changes.

Bindings use semantic surface IDs and normalized recipe coordinates. Each generation
resolves current triangle/barycentric samples; temporary triangle indices are not the
saved identity. Standard/Fine changes support tessellation and exercises re-resolution.
Interaction recipe version 1 and settings are additive and saved in the existing state.
Unknown versions are rejected before parameter import changes the body.

Tissue contact opts into these connections and a limited radial torso surface solve.
The declared pairs cover the abdominal stack, upper rectus/pectoral overlap and muscle
coverage. It compares actual triangles along sampled outward rays, not path centerlines.
Diagnostics report tested sample count, protected attachment endpoints and remaining
clearance deficit. They do not prove absence of collisions between samples or elsewhere
on the body. This does not replace the current pose system with anatomical FK/IK.

The solve corrects the upper wall before the lateral stack to avoid contradictory
constraints. Actual volume is reported again after contact; contact may change the
volume target discrepancy. Covered and lean surfaces receive coordinated corrections,
including the different topologies produced by marching cubes. The adipose display
follows those corrections during pose instead of treating muscle displacement as fat.

Attachments update during pose editing. Contact settles after releasing a pose slider,
so repeated pointer input does not repeatedly run the contact solve. No collision work
runs in the render loop. Existing files keep these optional effects off until enabled.

The priority worker check includes real topology changes, stale bindings, both surfaces,
posed attachment/contact, connective replay and authored covering-thickness preservation.
The priority browser fixture also exercises native opt-in controls, pose release,
materials and saved interaction settings on desktop and phone layouts.

## Body page, growth and reference-derived shapes

- Fitting to a GLB reads the abdomen from its skin relief
  (`src/anatomy/inference/surfaceRelief.ts`, `rectusSegmentation.ts`): a
  3–20 mm band-pass of anterior depth, then the navel, each linea semilunaris
  and the inferior pectoral fold as landmarks, then an ordered sequence of two
  to four tendinous intersections (three preferred) with regular spacing and
  the lowest near the navel. The pectoral fold bounds the search and is never
  an intersection. Evidence is scaled by the abdomen's own relief, so smooth
  bodies fall back to the anatomical sequence with low confidence. Each fitted
  intersection gets one belly profile above it plus one below the last, and the
  measured semilunaris sets the fitted rectus width before muscle envelopes
  are sampled. "Refine muscles and fat" also fits the superficial arm muscles
  (biceps, triceps long/lateral, brachioradialis) and the upper trapezius;
  deep muscles keep their prior. Every fitted muscle reports a held-out
  envelope error (`muscleValidation`). Before the thickness fit, the deltoid
  and pectoral heads get an outline warp (`outlineWarp`, saved per muscle):
  each slides over its own deep surface, with origin and insertion fixed, by
  a direct search that keeps a move only when that muscle's held-out
  thickness error drops and its triangles are not torn. The external oblique
  and upper trapezius use the same warp. Observed intersection heights are
  mapped through the rectus's own continuous shell (`rectusChartY`), not the
  skin chart, because the rectus is registered separately; the measured
  rectus width holds up to the costal margin and fades out below the navel.
  A fit always continues into "Refine muscles and fat"; that step is where
  all of the above runs.

- Pectoralis major thickness over the chest comes from a measured map
  (`data/pectoralReference.json`): the reference écorché's own thickness in
  sternum lengths from the jugular notch, with a development map from a
  hypertrophied reference GLB that redistributes it as growth rises. Beyond
  the anterior axillary fold the tuned converging belly and tendon remain.
- The descending trapezius's front fibres wrap round the side of the neck to
  the lateral clavicle (instead of riding the back contour), so the
  neck-shoulder slope has muscle under it and the fit can thicken it there.

- Abdominal wall offers three saved versions: Original version (the pre-fix fans
  from `9619032`, including their earlier chest interaction), Current version
  (default) and Legacy sheets. Switching preserves the shape/growth controls;
  existing project IDs remain compatible. Regression:
  `node scripts/check-anatomy.mjs --abdominal-versions`.

- Rectus volume retains a continuous field through the linea alba and navel,
  restoring its earlier response while retaining the pectoral covering guard.
  Intersection stagger remains parameter-driven: zero aligns the bands and signed
  values reverse the offset in both muscles and skin. Regression:
  `node scripts/check-anatomy.mjs --rectus-seam`.

- Current rectus keeps the original outer width and belly thickness at maximum
  growth, with separation controlling the medial edge independently. Its skin
  covers the grown belly while smoothing respects muscle ownership and tendinous
  paths; superior fibers seat beneath the pectoral without growing the chest.
  All three versions and shape controls remain available. Regressions:
  `node scripts/check-anatomy.mjs --rectus-maxima` and
  `node scripts/check-rectus-maxima-browser.mjs <url>`.

- Rectus width changes independently of separation.
  The existing narrow-gap range is usable without width/growth reopening the linea
  alba. Tendon followers retain their authored rest direction through shape edits;
  pose rotation remains supported. Regression: `node scripts/check-anatomy.mjs --rectus-controls`.

- Rectus hypertrophy includes the final inscription-to-pubis belly, including layouts
  with two inscriptions. Added volume fades beneath the costal pectoral border rather
  than projecting through its covering. Resting shape controls and custom inscriptions
  remain available. Regression: `node scripts/check-anatomy.mjs --rectus-distribution`.

- Back/inguinal audit: posterior growth and genetic skin transfer stay on the back;
  independent longissimus, iliocostalis and minor/major rhomboid growth supplements
  the existing group controls. Both skin models retain their options and ranges.
  Inguinal opening/height read the transformed ligament centerline; the height input
  is nominal. Empty growth fields and unchanged regional normals skip redundant work.
  Focused regression: `node scripts/check-anatomy.mjs --back-inguinal`.

- Upper arms: the long biceps, brachialis and long/lateral triceps now use paired procedural
  shells with tapered attachment ends and longitudinal fibers instead of ellipsoids. Their
  proportions were compared with the local écorché against the humerus; placement remains
  a visual fit, not an extracted reference mesh. Existing growth and per-side genetics apply.
  The short biceps, medial triceps and 19 individual forearm muscles now use the same
  builder, with per-side genetics and the existing flexor/extensor growth groups. New head
  growth controls are available in Body → Arms. Digital tendon routing remains separate.
- Neutral arms: the authored skin's curved rest centerline is aligned with the existing
  shoulder/elbow/wrist axes using measured section offsets. This corrects the elbow's
  forward bulge without introducing a nonzero default pose or moving the skeleton.
  `node scripts/check-anatomy.mjs --arms` checks the alignment and new per-side muscles.
- Shoulder girdle and neck: the deep pectoral/clavicular layer, subscapularis, arm
  stabilizers and principal neck muscles use the shared paired-shell builder. The
  existing serratus teeth now have per-side genetics. Body exposes the new groups
  within Chest, Back and Arms; `--regions` checks their worker geometry and volume limits.
- Legs: the principal thigh, knee and lower-leg muscles use attachment shells; the
  intermediate vastus, short biceps femoris, hamstring adductor portion, deep calf,
  fibular and long toe muscles have individual controls. Long digital paths stop at
  the foot attachment region. The plantar muscle separates its short belly from its tendon.
- Axial and deep hip support: posterior serratus layers, spinalis, multifidus, quadratus
  lumborum, pyramidalis and all principal hip rotators have individual controls. The
  intercostal wall has separate external/internal sheets and the diaphragm has two static
  costal domes. These are visual anatomy recipes, not a breathing or collision simulation.
  `node scripts/check-anatomy.mjs --coverage` audits geometry and controls for all 109
  main atlas templates (218 sides), excluding face and intrinsic hand/foot groups.
- Covering clearance: the bounded contact pass now rechecks crossings introduced by
  skin smoothing. `node scripts/check-anatomy.mjs --contact` reproduces that case and
  verifies that disconnected surfaces still do not pull the skin across empty space.
- Rectus/chest boundaries: rectus, pectoral and oblique growth fields affect their own
  tissues rather than scaling neighbouring muscles or skeletal anchors. The pectoral
  rests on its thoracic seat independently of abdominal hypertrophy; optional contact
  and connected-skin adjustments remain available. All controls and saved parameters
  are retained. `--rectus-boundaries` and `check-rectus-boundaries-browser.mjs` cover the
  two skins, legacy abdominal sheets, segment/width/gap controls and native UI history.

### Body page

Body → Overview holds whole-body proportions, base surface, profiles, tissue connections
(skin follows muscles, anatomical attachments, tissue contact), inspection, parameters and
the atlas. Each anatomical region (chest, abdomen, pelvis, back, arms, legs, fat) splits into
Shape / Muscles / Bones; the layout is data in `src/anatomy/bodyLayout.ts`, and
`check-anatomy.mjs` asserts every control appears exactly once.

In Muscles, picking a muscle shows three levels of control:

- **Both sides:** the group sliders (for example deltoid volume, pectoral spread).
- **Hypertrophy:** chronic growth per part, both sides (`individualGrowth` keys).
- **Genetics, per side:** inherited shape per side — width, depth, volume, belly
  position, profile and activation — for 31 muscles (`individualMuscles` in
  `definition.ts`; profiles in `data/priorityRegions.json` are FORMA visual seeds).
  Volume is normalized to its target (worker check: within 2%).

### How growth reaches the skin

On the human body, muscles are generated at neutral volume (`humanVolumeBase`) and volume
fields (`humanVolumeFields`) grow muscles and skin together. Group sliders use one field per
group; per-part hypertrophy uses the same function with one field per procedural muscle,
along its own origin → insertion. The pectoral and rectus keep their direct growth and skin
relief (`directGrowthKeys` in `atlas.ts`). "Skin follows muscles" additionally lets
superficial muscles keep their full volume and push fat and skin outward
(`coverMuscles`, shared with tissue contact). Per-side genetics reaches the skin through
the shared shaping transfer.

Fiber striations are a shader option (Material → Anatomical surface details → Fiber
striations), saved with the body.

### Shapes measured against a reference écorché

Pectoralis major, deltoid and trapezius were measured against a user-supplied écorché
(BodyParts3D + Z-Anatomy, CC BY-SA 4.0; see THIRD_PARTY_LICENSES.md). Only generator
parameters were derived; no reference mesh is bundled or loaded. The method — reading the
GLB (`scripts/anatomy-reference/glb.mjs`), measuring both models in one scene against bony
landmarks, choosing the generator family, driving it with the measurements and recording
residuals — is described in the consolidated plan ("Method — building procedural structures
from the reference écorché"), including the planned écorché-derived procedural skeleton.

- **Pectoralis major:** one continuous fan (clavicular, sternocostal and abdominal spans
  sharing edges), abdominal part from the rectus sheath, thickness distribution from the
  reference; lower border within 1–4 cm of the reference.
- **Deltoid:** one cap from the lateral clavicle over the acromion along the scapular spine
  to the deltoid tuberosity; medial edge 8.8 cm vs 8.3 cm.
- **Trapezius:** one kite with descending, transverse and ascending parts from the occiput
  to T12, inserting on clavicle, acromion and scapular spine; heights within about 3 cm.

- **Back and scapula:** latissimus dorsi, rhomboids, supraspinatus, infraspinatus and teres
  minor/major, built with the shared `fanMuscle` builder, inserting on the humerus with a
  trunk-to-arm blend; heights within a few centimetres of the reference.
- **Lower back:** erector spinae (longissimus and iliocostalis) under the thoracolumbar
  fascia, layered so the white fascia drapes over two columns with the spinal groove between.
- **Gluteals:** maximus, medius, minimus and tensor fasciae latae built with `fanMuscle` on
  the hip surface (`onButtock`). The maximus runs from the iliac crest, sacrum and coccyx
  to the iliotibial tract and femur; medius and minimus fan from the iliac wing to the
  greater trochanter; the tensor joins the iliotibial tract. All four have hypertrophy
  and per-side genetics.
- **Abdominal wall:** external and internal obliques and the transversus are fans on the trunk
  surface (`onTrunk`). They attach to the ribs, iliac crest, inguinal ligament and thoracolumbar
  fascia, and the inguinal arch comes from how the layers meet. The external oblique and the
  abdominal aponeurosis share one muscular border (`eoMuscleBorder`) that sweeps down to the ASIS.
  The other borders match the older sheets, so the aponeurosis, rectus, inguinal ligament, contact, growth and genetics are
  shared. Body → Abdomen → Muscles → Abdominal wall switches back to the legacy sheets
  (`abdominalModel` 0).
- **Hip flexors and thigh origins:** the psoas major runs from the lumbar spine under the
  inguinal ligament to the femur, connecting the leg to the core. The hamstrings, adductors,
  gracilis and pectineus start on the drawn ischium and pubic rami. Psoas, iliacus, sartorius,
  pectineus, gracilis and adductor brevis have hypertrophy and per-side genetics.
- **Pelvis:** hip bones and sacrum are generated from control points measured on the reference
  écorché (`data/pelvisReference.json`), mapped onto this body's hip joint, ASIS, pubic tubercle
  and PSIS so the skin, inguinal region and attached muscles stay in place. Each hip bone is one
  continuous signed-distance shape (ilium sheet and crest, acetabulum, pubis, obturator ring,
  ischium) meshed by `polygonize`, cached on the pelvic landmarks and capped under the skin.
  Body → Pelvis → Bones → Pelvis switches back to the legacy primitives (`pelvisModel` 0).
- **Pubic finish:** in the measured abdominal wall the lower rectus sheath (`pubicSheath`) runs
  from one inguinal ligament to the other over the pubic symphysis, so the lower abdomen ends in a
  rounded U. The measured crest is held just above the muscles' crest line, and the bony pubis
  sits behind the inguinal ligament's end.
- **Mons pubis:** the human skin has a rounded pad above the crotch (scaled by pubic fat), so
  the genital region ends in a soft U instead of a point between the thighs.

Generated meshes are oriented outward at creation (`mesh()`), so mirrored left-side
structures behave like the right side everywhere.
- **Generic humanoid GLB adaptation (P14–P16 / P11):** canonical template landmarks (src/anatomy/landmarks.ts) and segmented registration warp (src/anatomy/registration.ts) decouple anatomy from hardcoded mannequin space. Automated cross-section slicing and orientation detection (src/anatomy/fitBody.ts) allow arbitrary humanoid models (e.g. unrigged, AI-generated meshes like Tripo GLBs) to be analyzed, rotated, scaled, and fitted with appropriate anatomical parameters. Superficial tissue binding (src/anatomy/skinBinding.ts) drives target meshes from internal growth and poses with zero rest drift.
- **Pose-first fitting:** adaptation now measures a neutral analysis copy before estimating sections. Existing rig mappings or the Rig panel's joint handles supply pose and segment-length hints; height, fat and muscle constraints can retain the current values. The solver compares an actual generated procedural surface against the target, in a worker. Bone dimensions without joint evidence and muscle/fat composition remain explicit priors rather than independent measurements. Imported skin edits preserve the original baseline, topology, materials and rig; unreliable distant correspondences remain unchanged. This is a coarse fit of the largest mesh, not complete automatic reconstruction of arbitrary poses or tissue composition. Joint-conditioned upper-arm, forearm, thigh and shin lengths now drive a shared final proportion map for generated bones, muscles, skin and pose pivots; the pelvis stays anchored. The lengths remain estimates and are not medical measurements. Automatic joint placement may require manual correction, especially at shoulders. Runtime imported-skin bindings are not restored from saved projects yet.

- **Trunk inverse refinement:** adaptation now evaluates the displayed layered generator, refines bounded thoracic/pelvic support and superficial muscle shape, preserves explicit constraints, and validates reserved surface samples. Costal pectoral origins have a named structural rectus-sheath support, independent of abdominal hypertrophy; insertions are resolved after bone scaling. Dense scans use a connected analysis proxy rather than isolated sampled triangles. See [method, references and limits](anatomy_inverse_trunk.md).

- **Surface fitting hints:** Objects > Fit GLB provides optional nipple, navel and three-point inguinal-fold marking on the reference. These constrain a separate soft-tissue field, preserving the fitted bone and ligament buffers. The panel explains body assumptions and offers skin/muscle/bone review. Landmark matching is bounded and approximate; see [verification and limits](anatomy_inverse_trunk.md).

- **Cached anatomy drag previews.** Geometry sliders and local growth use a cached response from two generated states. The first use of a control samples the generator. Release commits the exact result, including attachment and contact corrections. Imported skin previews interpolate cached position and normal deltas and upload only changed ranges when the vertex ordering permits it. Stable topology keeps the same mesh and index buffers.
- **Local muscle genetics.** Five width sections, a belly peak offset, and transverse curvature extend the existing depth profile. Width and curvature use the local section frame. The rectus retains its medial border and the fitted origin and insertion remain anchored. The fitting solver uses the shifted depth basis and the new width and curvature remain editable genetics.

- GLB refinement stores a bounded five-station rectus width estimate per side for the current abdominal mode. It uses agreement between lateral surface rays as a weak prior. Manual section width, midline spacing and tendon controls remain independent. Inguinal skin hints are distance-weighted during surface refinement, with distant hints excluded from that pass.

- In the current rectus mode, the local muscle panel exposes five editable abdominal height stations per side, including on a new procedural body. The existing inguinal curvature control shapes the supporting ligament. The inferior edge of the abdominal aponeurosis seats against the superior face of that support.

- Pelvis shape has independent front and back lower-pelvis projection controls in millimetres. They are available without a fit and shape the covering within the lower pelvic band. The skeleton, ligament and rectus meshes retain their existing geometry.

- The Fat panel includes a local brush for adding, removing and smoothing subcutaneous thickness on the visible procedural skin. Each stroke is one undoable edit and the sparse thickness field is saved in the project. The geometry updates on release.

- The fitted pectoral contour stores a bounded projection profile near the anterior deltoid. The clavicular edge samples a smoothly weighted deltoid rail and keeps its attachment rows fixed.

- Pectoral fitting stores six bounded anterior covering coefficients per side. They shape the generated skin and adipose in the chest and anterior shoulder band independently of the optional skinFit residual. Their influence fades to zero at the midline, lower chest and arm boundary.

- Deltopectoral covering can add a bounded upper projection and reduce lateral projection independently on each side. Fitting accepts the extra profile only if it improves withheld anterior depth samples.

- In the continuous abdomen, tissue refinement reads rectus grooves and margins from the original aligned mesh. The simplified surface still drives bulk fitting and skin registration.

- The rectus and external oblique envelope fit uses a 9-by-5 thickness profile. Existing 5-by-3 profiles continue to load. The pectoral fold samples the original aligned surface when available.

- In the continuous abdomen, fitted belly domes use the original relief inside the measured rectus margin. The tendinous angle is weighted by transverse support. Inguinal crease candidates add soft skin registration anchors when adjacent samples agree; manual hints take precedence and the deep ligament keeps its attachments.

- The fitted rectus uses nine margin stations when the original mesh shows the semilunaris. Reference posing uses the latissimus fibre attachment interval for the transition from trunk to arm. The latissimus envelope samples its posterior face.

- Fitted tendinous strips follow their own chart coordinates on the continuous rectus surface. Manually authored intersections retain the existing binding.

- The inguinal aponeurosis seats against the tube face oriented toward the sheet. Fitted deltoid heads reconcile adjacent edges, and the upper trapezius follows the slope from shoulder to neck.

- The sternocostal head can receive a local anterior axillary correction. Fitting keeps it only if held-out surface depth improves without additional skin crossings.

- Fitted lumbar muscles resolve contact against the posed thoracolumbar fascia. The support mesh is retained when the fascia layer is hidden.

- Fitted arms measure transverse sections around the posed arm chain. A bounded segment profile can adjust the muscle union where held-out spokes improve. The correction tapers to zero at the shoulder, elbow and wrist.
