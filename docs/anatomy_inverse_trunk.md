# Procedural inverse fitting of the trunk

The adaptation action estimates a plausible anatomy from the neutralized surface.
It does not measure internal anatomy or infer biological genetics. Individual
"genetic" controls describe procedural phenotype; hidden anatomy remains a prior.

## Evidence and geometry

- Pose correction precedes proportions and cross-sections. The original imported
  mesh, materials, UVs and indices are preserved.
- The fitting worker simplifies the neutral analysis copy with meshoptimizer,
  targeting 18,000 connected triangles and a 2 mm absolute error estimate in the
  1.80 m canonical frame. The returned error is an algorithm estimate, not a
  Hausdorff guarantee; a focused check also samples original-surface distances.
  The previous isolated-triangle proxy left artificial holes on dense scans.
- Waist sections are surface observations. ASIS, pubis, xiphoid and costal
  attachments inferred from a skin contour are priors unless explicitly hinted.
- Rendering and trunk candidate evaluation call `generateAnatomy` in
  `src/anatomy/generation.ts`. Genetics, attachments, tissue covering and final
  bone proportions therefore use one implementation.

## Fitting stages and constraints

1. Fit coarse global dimensions using surface and available landmark evidence.
2. Refine chest roundness, costal flare, pelvic support heights and abdominal
   width/separation with small bounded steps. Fat and aggregate growth are fixed
   throughout this refinement.
3. Refine bilateral width/depth of rectus, external oblique and pectoral heads.
   Preserve existing side differences and limit changes to 15% around the prior.
   Volume, activation, deep abdominal layers and tendinous intersection patterns
   are not inferred by this pass.
4. Pelvic bone width/depth/height require independent ASIS/crest hints before
   optimization, with a 5% trust interval. Without those hints, the bone shape is
   retained as a prior rather than claimed as an observed reconstruction.
5. Re-evaluate held-out surface samples. Revert the refinement if their mean
   distance worsens by more than 0.25 mm or any region worsens by more than 1 mm.

The data term balances chest, abdomen and pelvis and both surface-distance
directions, using a Huber loss with a 20 mm transition. It adds soft parameter
priors, hinted bone-anchor errors and semantic attachment errors. Training sample
indices are fixed across candidates. A candidate cannot worsen a region by more
than 2 mm, increase the largest hinted anchor error by more than 1 mm, or exceed
the attachment gate. These are numerical safeguards, not clinical tolerances.

The clavicular and sternocostal pectoral heads retain their named bone patches.
The costal pectoral origin now has a named superior rectus-sheath support. This
structural sheath is independent of rectus hypertrophy so abdominal growth does
not inflate the chest. Attachments are resolved again after bone-length scaling.
Full optional contact treatment remains controlled by the existing interaction
options; this change does not establish collision-free volumetric anatomy.

Current muscle and fat hints remain fixed. Clothed inputs skip fine trunk shape
inference. Existing controls, old abdomen versions, reference comparison and
per-side edits remain available. The more expensive refinement runs only during
the explicit adaptation action, not on every slider update.

## Verification

- `node scripts/check-anatomy-trunk-fit.mjs`: actual generation, structural sheath
  binding, final scaled insertions, rectus/chest isolation, unilateral genetics
  and clothed-input locks.
- `node scripts/check-anatomy-surface-proxy.mjs <model.glb>`: real mesh decoding,
  connected proxy, sampled geometric error and immutable source buffers.
- `INVERSE_TRUNK_ONLY=1 node scripts/check-inverse-real-browser.mjs <dev-url> <model.glb>`:
  real browser adaptation, reserved-sample validation, source identity, bone edits,
  hypertrophy, reset and phone-width layout.
- Production build, `scripts/check-anatomy.mjs`, lazy-cache and archive checks.

## Research basis and limits

[Inside Humans (2021)](https://www.frontiersin.org/journals/virtual-reality/articles/10.3389/frvir.2021.694244/full)
uses landmark/pose alignment, layered template fitting and anatomical priors.
[SOMA (2026)](https://vcai.mpi-inf.mpg.de/projects/SOMA/) combines learned layered
deformation, regularization and precomputed barycentric transfer.
[HIT (2024)](https://github.com/MarilynKeller/HIT) is a learned internal-tissue
estimator. These works motivate separating surface evidence from hidden tissue
assumptions; their trained models, proprietary templates and datasets are not
integrated here.

This implementation is a deterministic regularized procedural fit. It is not a
reproduction of those methods, a statistically trained anatomical model, a
validated biomechanical simulation or a medical reconstruction. A static GLB
cannot uniquely identify muscle/fat composition or hidden insertion variants.
Physical-device gestures and reference MRI/CT validation are outside these checks.

## Recorded run (2026-11-04)

The user-provided `target.glb` contains 978,609 vertices and 1,923,782 triangles.
The connected proxy retained 18,000 triangles. A separate source-buffer check
observed a sampled maximum deviation of 1.27 mm; the neutral pose with joint hints
produced a simplifier error estimate of 0.93 mm.

With existing automatic joint-placement hints, the final reserved-sample mean
trunk distance changed from 32.23 to 31.45 mm. Training-region distances were:

| Region | Before (mm) | After (mm) |
| --- | ---: | ---: |
| Chest | 21.68 | 20.85 |
| Abdomen | 35.34 | 35.54 |
| Pelvis | 35.44 | 33.65 |

The abdomen did not improve in this run. The solver accepted chest roundness,
pelvic support heights and sternocostal pectoral depth; it did not force the other
shape controls to move. No independent ASIS/crest hints were supplied, so pelvic
bone genetics remained prior-dependent. Whole-source median correspondence was
27.95 mm; largest remaining outliers were at the feet (about 205 mm).

Initial adaptation took approximately 131 seconds with 30 exact trunk evaluations.
The imported-skin delta update was about 96 ms, excluding procedural regeneration.
This is a substantial initial-fitting cost compared with the earlier coarse pass.
Source positions at baseline, materials, UVs and indices were unchanged, growth
moved the imported skin, reset restored it, and changing a bone length changed the
visible procedural humerus. The anatomy UI fixture also passed side isolation,
undo/redo, A/B, pose, attachment/contact, JSON/ZIP and phone-width checks.

A focused rectus-growth check at 2.5x produced about 25.78 mm of abdominal skin
movement and zero pectoral mesh drift; chest skin drift was below 0.001 mm. These
are regression/consistency checks on procedural geometry, not measurements of a
real subject's internal anatomy. No new reference ecorche, MRI or CT was loaded.

## Visible GLB fitting and reference-pose calibration (2026-11-04)

Objects > Fit GLB is the dedicated entry point. Users can select a scene model or
choose a local GLB, review and retain joint hints, and choose a separate anatomical
comparison or an imported outer skin. Progress reports fitting stages. The slower
individual-muscle refinement is optional.

The default path estimates proportions from joints, fits a shared volumetric
residual field, and calibrates arm and leg segments to the observed reference
pose. Manual pose controls are offsets when reference-pose calibration is enabled.
All generated layers share the field. Saved parameters include the field and pose
calibration; fit setup retains the reference identity and reviewed hints. A live
imported-skin binding must currently be recreated by running fitting after reload.

Corrections include reflected source coordinate frames, current procedural
shoulder landmarks, and pelvis measurements above the hip pivots rather than at
the first contact between the thighs. ASIS width is not inferred directly from
hip-joint spacing.

Real native-file/UI verification with target.glb completed the default fitting
in 17.7 seconds. Neutral-surface mean bidirectional distance decreased from 21.33
to 5.05 mm; held-out mean decreased from 21.38 to 4.99 mm. Returning to the original
reference pose yielded approximately 8.79 mm mean and 31.06 mm p95 surface distance.
These are geometric residuals under an assumed physical scale, not tissue accuracy.
The sampled lattice Jacobian stayed above 0.22; this is not a global collision or
injectivity guarantee. Joint hints survived review/return/review.

Nipples, the navel and the inguinal skin fold still need explicit superficial
landmark/curve constraints for semantic correspondence. A surface alone cannot
uniquely identify muscle versus fat. The current workflow handles the largest
selected mesh; it does not promise complete multi-mesh or finger reconstruction.

## Surface landmarks and direct-flow facing correction (2026-11-04)

The direct fitting path previously spread an undefined forward hint over the
valid automatic direction. The regression test had reviewed joints first and
missed that path. Hint merging now keeps the automatic forward vector when no
explicit direction was supplied, and stores the resolved joints/direction.

Fit GLB now explains reference selection, pose/body assumptions, surface points,
and fitting/review as four steps. Body assumptions persist per anatomical body.
Nine optional mesh-local surface hints cover both nipples, the navel and three
points on each inguinal fold. Select a point and tap the reference; the panel
shrinks with a touch-accessible Cancel action. Saved points use JointOverlay and
can be remarked or cleared. Review buttons expose skin, muscles or bones.

Surface hints run after skeletal fitting. A separate compact-support field moves
muscles, adipose tissue and skin, with depth taper, fixed bones/ligaments and
resolved muscle attachment patches. Sources distinguish the superficial inguinal
crease from the ligament. Material coordinates now follow vertices through final
fitting and posing; nipples/navel no longer slide over deformed geometry. The
field backs off when sampled finite-difference Jacobians fall below 0.25; this
sampled safeguard is not a global injectivity or collision proof.

Native-file/canvas verification with target.glb exercised all nine points and
the direct flow without reviewed/saved joints. Facing dot agreement was 0.999998;
bone and inguinal-ligament buffers were byte-identical with/without the tissue
field. Initial fitting took 18.34 s. Maximum landmark residual fell from 50.45 to
14.01 mm (nipples approximately 2.7/2.9 mm, navel 9.8 mm). The sampled tissue
Jacobian minimum was 0.301; 72.25% of the unconstrained field was retained. The
original-pose bidirectional surface mean remained 8.74 mm, p95 31.00 mm. Distances
assume the current height scale and are not internal-anatomy measurements.

The external-skin path preserved source vertices at baseline, moved 54,037
vertices after rectus growth, and reset exactly. Browser checks passed at desktop
and 375x812, including cancelling point placement without losing nine hints.
Comparison screenshots were inspected both with procedural skin and exposed
muscles, with the unchanged source GLB alongside. The source underwear obscures
part of the inguinal region: the test uses representative surface locations, not
expert-labelled anatomical ground truth. The fit is approximate; it does not
infer a unique fat/muscle composition or an exact continuous inguinal curve.

## Fixed skeleton volume refinement

The Fit GLB panel can refine soft tissues after the initial fit. Directional
intersections in the reference pose constrain the available volume below the
skin. Alternating regularized solves allocate that space to muscle depth
profiles and four regional fat reserves. Each muscle side has a five by three
profile. Deep shell vertices and attachment borders remain fixed, and edits
feed the existing muscle to skin transfer. An independent skin residual uses
marked nipples and navel plus sampled inguinal curves.

Regional fat values are conditional estimates around editable priors. The
partially covered inguinal landmarks in target.glb are representative test
points. The exposed view shows the procedural layers inferred under those
assumptions. The source has no corresponding internal layers for validation.
