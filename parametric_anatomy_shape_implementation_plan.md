# Parametric anatomy shape fitting

## Purpose and boundaries

Fit a reusable procedural physique to a humanoid surface. Persist compact, editable anatomical parameters that regenerate the result without its fitting target. Start with abdomen, inguinal region and pelvis. Add chest and shoulder, then forearm, using the same contracts once the trunk path is validated. Implementation starts in a later turn. No deployment or reference-asset redistribution is part of this plan.

Follow [AGENTS.md](AGENTS.md), the [muscle fitting skill](.claude/skills/anatomy-muscle-fitting/SKILL.md), and the [anatomy guide](docs/anatomy.md). Work code first, with no delegation. The baseline is commit `96b6fc8`. Existing local plans and scratch inputs are outside the baseline.

## Verified baseline and design choices

- [AnatomyBody](src/anatomy/body.ts) orchestrates workers, exact edits and drag preview. The [fitting worker](src/anatomy/inference/fitting.worker.ts) already aligns pose and estimates joint-conditioned proportions. [Trunk fitting](src/anatomy/inference/trunkFit.ts) and [volume fitting](src/anatomy/inference/volumeFit.ts) estimate regional envelopes and soft-tissue profiles. [Surface registration](src/anatomy/inference/surfaceRegistration.ts) can improve the fitted skin independently of the muscle shape. Measure both with this residual enabled and disabled so it cannot hide a weak procedural model.
- [Definition](src/anatomy/definition.ts) already stores muscle controls and profiles. [Project snapshot](src/core/project.ts) captures anatomy state. Extend that data path instead of creating a second project payload or embedding mesh deltas in the genetic profile.
- [Abdomen](src/anatomy/regions/abdomen.ts), [pelvis](src/anatomy/regions/pelvis.ts), [geometry](src/anatomy/geometry.ts) and [attachments](src/anatomy/attachmentPatches.ts) already model or support the rectus, layered obliques, transversus, connective tissue and pelvis. A silhouette error alone does not establish a missing structure. Inventory visible geometry, semantic attachments and independent controls separately before adding anatomy.
- Validation uses two externally supplied target GLBs and an anatomical reference GLB. Inspection of the écorché GLB manifest found 634 meshes, with named bilateral rectus, external and internal oblique, and iliacus nodes. Mesh measurements and identification of the inguinal structures still need verification. Use the écorché offline for relative shapes and attachment checks. The target GLBs supply external geometry and pose evidence. No model is bundled.
- Keep the existing skeletal rig for the first milestone. The bony supports of interest are the costal arch, iliac crest, ASIS, pubis and hip landmarks. Refine their semantic locations on existing bone surfaces before adding articulation. Revisit bone shape only if repeated anchor errors remain with correct pose and proportions and are attributable to the bony support. Additional joints require a demonstrated motion problem.

## References and their application

- [Inside Humans](https://www.frontiersin.org/journals/virtual-reality/articles/10.3389/frvir.2021.694244/full) motivates a layered reference with internal constraints. Use it to separate reference anatomy from the fitted surface.
- [OSSO](https://arxiv.org/abs/2204.10129) and [SKEL](https://skel.is.tue.mpg.de/) distinguish skeletal estimation from pose. Use joint evidence and anatomical bounds before considering a richer skeleton.
- [HIT](https://github.com/MarilynKeller/HIT) treats internal tissues as an inference problem from external shape. Keep muscularity and adiposity priors explicit and report uncertainty when multiple solutions fit the same surface.
- [libigl deformation tutorial](https://libigl.github.io/tutorial/) describes regularized deformation and constrained handles. Start with a small bounded profile solve in the existing worker. Consider a local constrained field only to diagnose persistent residuals. Importing these models, libraries or weights is outside the MVP.

## Target contracts

Persist an optional, versioned regional shape block under the anatomy definition. Start with three to five fixed normalized stations in bone-relative coordinates. Use scale-normalized offsets with explicit units and a zero neutral value. Store independent per-side rectus lateral margin and anterior projection, shared inguinal-curve controls relative to ASIS and pubis, and existing regional fat values. Keep the existing overall width, linea alba spacing, stagger, intersections, hypertrophy and three abdominal modes. Enable new local profiles on the current mode only. Older projects use the unchanged defaults. Treat manual edits as overrides of the fitted coefficients and expose reset by region.

Apply the coefficients to authored profiles before tessellation and attachment resolution. Share boundary coordinates across adjacent patches while preserving distinct tissue layers. Anchor structural curves in the same bone frame for rest and posed generation. Keep soft-tissue solving separate from bone lengths, landmarks and pose. Reject invalid inputs and keep the last valid result on cancellation or a failed fit. Treat scan folds, garment edges and weak surface cues as low-confidence evidence. Store fit provenance compactly when it explains a result. Keep BVHs, observations, preview deltas and diagnostic deformation fields transient.

## P01 - Fit and save the abdominal profile

**Status** TODO

**Objective** Fit a visible abdominal contour from the normal GLB flow and regenerate it after save and reopen.

**Required reading** [Abdominal generation](src/anatomy/regions/abdomen.ts) for fan geometry and legacy modes, [shape normalization](src/anatomy/definition.ts) for the saved contract, [trunk fit](src/anatomy/inference/trunkFit.ts) for existing regional constraints, and [project snapshot](src/core/project.ts) for persistence.

**Target files** Extend those anatomy modules plus [volume fit](src/anatomy/inference/volumeFit.ts) and [anatomy UI](src/ui/panels/anatomy.ts). Change project serialization only if the existing state capture drops a field.

**Implementation and integration** Record baseline frontal widths and side depths over fixed anatomical stations on both GLBs. Fit three rectus margin and three projection stations per side with existing worker observations. Use sections, confidence-weighted navel hints, a neutral prior and second-difference regularization. Keep the linea alba and tendon controls separate. Solve soft tissue with fixed bones, and keep old values in poorly observed areas. Expose width and projection profiles in the current advanced anatomy UI with per-side selection, reset and symmetry. Measure corresponding écorché shapes relative to the costal arch and pubis before changing the neutral authored profile.

**Minimum verification and acceptance** On the hypertrophied reference, lower held-out abdominal width and depth error versus the current procedural output with the skin residual disabled. Then repeat on smooth-surface reference and reject new visible regressions. Save, reopen and reproduce the profile with the source removed. At maximal width and growth, preserve tendon relief, the linea alba and the existing chest isolation. Confirm bone geometry and pose are unchanged during the soft solve.

## P02 - Fit the inguinal transition on existing pelvic supports

**Status** TODO

**Objective** Reproduce the visible transition from abdominal wall to upper thigh and retain a coherent underlying pelvic anatomy.

**Required reading** [Pelvis geometry](src/anatomy/regions/pelvis.ts), [attachment patches](src/anatomy/attachmentPatches.ts), [connective followers](src/anatomy/connective.ts), and [fat distribution](src/anatomy/fatDistribution.ts) for existing supports and regional tissue controls.

**Target files** Those modules where needed, [tissue registration](src/anatomy/inference/tissueRegistration.ts), [definition](src/anatomy/definition.ts) and [anatomy UI](src/ui/panels/anatomy.ts).

**Implementation and integration** Measure the écorché ASIS-to-pubis frame and inventory rectus sheath, external-oblique aponeurosis, inguinal ligament, iliacus and adjacent thigh boundary. Record actual mesh evidence before classifying a structure as absent or absorbed by another patch. Reuse one side-specific structural curve to guide ligament and aponeurotic boundaries. Fit separate superficial fold offsets and suprapubic fat so a skin crease does not drag a ligament insertion. Use existing inguinal hints and bounded section evidence. Introduce a missing procedural patch only when the reference and a reproducible geometric gap justify it. Reuse existing loft and attachment helpers.

**Minimum verification and acceptance** On both GLBs, compare inguinal curve residual, lower abdomen width and profile against the P01 baseline. Save and restore asymmetric edits. In neutral and hip flexion, preserve ASIS and pubic attachments, continuity across patches, and stable bones. Use a weak or occluded hint to confirm the fit falls back to the prior without a visible crease artifact.

## M1 - Reusable abdomen and pelvis

P01 and P02 pass when both real targets can be fitted, edited and reloaded, and a representative result survives removal of its source GLB. Compare procedural anatomy with skin residual disabled, then compare final generated skin. Use identical cameras, front and side, with and without skin. For calibration, distinguish manual hints from measurements sampled from the same surface. Hold out some stations and curves from the solve. Add a third held-out physique before making broad claims about generalization.

## P03 - Bound latency and simplify generation

**Status** TODO

**Objective** Keep new profiles interactive at the same visible quality and reduce the cost of exact regeneration.

**Required reading** [Generator](src/anatomy/generation.ts), [worker](src/anatomy/anatomy.worker.ts), [delta preview](src/anatomy/dragPreview.ts) and [surface proxy](src/anatomy/inference/surfaceProxy.ts) for existing caches and proxy reuse.

**Target files** Extend those modules and [AnatomyBody](src/anatomy/body.ts) where profiling identifies a bottleneck.

**Implementation and integration** Measure worker compute, support rebuilding, registration, transfer and GPU upload separately for hypertrophied reference and smooth-surface reference. Cache stable support meshes, topology and local influence weights by dependency. Invalidate only affected regions and their immediate boundary neighbours. Reuse coarse fit proxies, cached deltas during drag, one exact update on release, and generation IDs to discard stale worker output. Batch typed-array transfers. First consolidate duplicated sampling and profile evaluation. Reduce interior triangles only after silhouette, tendon relief and pose checks demonstrate equivalence. Consider extra workers only if timing shows independent CPU work dominates transfer and rebuild costs.

**Minimum verification and acceptance** Report cold and warm fit times, drag p95 and release p95 on the same machine and inputs. Aim for preview updates within a 16.7 ms desktop frame budget once warm, with a measured mobile-emulation result reported separately. Preserve the exact settled result and prevent stale overwrites during rapid edits. Verify the new shape path improves or matches the baseline interaction time at comparable geometry quality.

## P04 - Extend the same shape model to chest and forearm

**Status** TODO

**Objective** Reuse the trunk result to improve two known residuals without introducing a second fitting architecture.

**Required reading** [Pectoral contours](src/anatomy/pectoralContour.ts), [volume fitting](src/anatomy/inference/volumeFit.ts), and [reference pose mapper](src/anatomy/referencePose.ts) for existing controls and the forearm deformation path.

**Target files** Those modules plus [geometry](src/anatomy/geometry.ts) and [definition](src/anatomy/definition.ts).

**Implementation and integration** Fit pectoral lower edge, anterior projection and deltopectoral groove jointly with the deltoid. Audit serratus and the posterior axillary fold before adding patches or knobs. For the forearm, compare local edge stretch with and without pose and skin registration, repair the stage causing the crease, then fit cross-sections and taper if a shape residual remains. Preserve wrist and elbow joint targets. Reuse the station data and validation protocol of M1.

**Minimum verification and acceptance** On the hypertrophied reference, improve held-out chest silhouette and fold errors with intact abdominal geometry. On the smooth-surface reference, reduce localized forearm distortion without moving the joints. Preserve chest and shoulder attachments through growth and pose. Confirm the new profiles survive reload.

## Final integrated validation

Run the production build, focused anatomy checks and the [real browser GLB flow](scripts/check-anatomy-fit-ux.mjs). Use both targets and the held-out physique. Record scale assumptions, normalized section error, curve residual, front and side silhouette error, localized distortion, and timing. Compare base controls, procedural profiles and optional final skin registration separately. Exercise desktop and 375×812 browser layouts. Check legacy project loading, all three rectus modes, maximal width and growth, asymmetric edit and reset, undo and redo, and source-independent save and reload. Report unverified inputs or physical-device behavior explicitly.

| Step | Status | Evidence / commit | Human approval | Notes |
|---|---|---|---|---|
| P01 | TODO | | None | First executable step |
| P02 | TODO | | None | Completes M1 |
| P03 | TODO | | None | Optimize measured hotspots |
| P04 | TODO | | None | Chest, shoulder and forearm |
