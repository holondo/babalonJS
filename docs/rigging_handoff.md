# Rigging comparison handoff

The user approved the latest final state, including the leg junction estimates, difference map and trunk-protection correction, and requested this updated handoff. The earlier comparison implementation was committed locally as `330a3cb`; the follow-up changes are included in this handoff. No push was requested. The comparison remains experimental; approval does not mean that every treatment improves every pose. Keep the implementation independent of model names and files.

## Implemented

- Three deformation treatments share one envelope or heat-diffusion calculation: **Direct weights** preserves the solver output, **Trunk protection** transfers selected arm-chain influence to nearby spine bones, and **Distributed rotation** transfers shoulder-region influence to two auxiliary bones following half the upper-arm rotation.
- Trunk protection combines a sloped boundary with a bone-proximity mask to keep lowered arms free. The auxiliary bones are appended after canonical bones and are not weight-solver sources.
- Comparison creation uses the same adjusted joints for all three copies, calculates weights once in a worker, applies independent packed weight buffers and skeletons, and keeps the original hidden. Creation supports cancellation and undo.
- Ready poses move all comparison members together, as one undo action. Manual posing affects the selected member. Project serialization preserves treatments, weights and comparison membership; ordinary duplicates leave the comparison group.
- Auxiliary rotations update during posing and playback. Added clips receive sampled auxiliary tracks for export. GLB export includes auxiliary skin and animation data and excludes hidden originals.
- The Rig introduction now contains only the start action. Joint placement and mesh binding are separate sections. Mesh binding offers **Apply rig** or **Compare treatments**, with weight calculation configured once. Comparison mode hides the individual treatment selector. Individual mode shows short treatment descriptions. The floating action bar follows the chosen mode.
- The Rig tab remains available during the skin-review stage instead of changing to Pose as soon as the pending skeleton is attached. Labels and descriptions have English and Portuguese translations.

## Findings

- Different weights alone were insufficient evidence. The deformation smoke check now applies each variant to actual Babylon mesh buffers and skeletons, evaluates final skinned vertex positions, and compares all three pairs in Relaxed, Arms up and Wave. It also reports a geometric sample of the lateral back.
- Force `skeleton.prepare(true)` when evaluating several poses without rendering: otherwise Babylon can reuse matrices from the same render frame. The check also verifies that different poses produce different geometry.
- The treatments use distinct processes, but their final geometry need not differ on every input. After the eligibility correction, trunk protection leaves the exercised A-pose input unchanged because it has no eligible region; distributed rotation still changes its final geometry. The exercised T-pose input produces differences for all three treatments. Differences can be local and visually negligible.
- **Direct weights is the current corrected solver, not the old diffusion implementation that visibly distorted the trunk.** All variants inherit those shared corrections, explaining why all three can look similarly improved.
- The earlier raised-arm audit found differences of roughly 0.33 scene units caused by distal arm skin being classified as trunk skin. The follow-up restricts protection to vertices whose nearest arm segment is the upper arm and whose axial chain is closer. This removes the observed hand/forearm anchoring failure.
- No treatment was selected as a universal winner. Hip and leg detection now uses the section-based estimate described below. Dual quaternion skinning, Delta Mush, collisions and corrective morphs were not implemented.

## Verification and source references

The production build and focused strategy, visibility and helper checks passed. Browser checks covered individual binding, skin review, comparison creation from the floating bar, cancellation and a 375-pixel layout. Earlier comparison checks also covered ready poses, undo/redo and project reloads. Real geometry audit runs passed after adding final vertex comparisons.

- `src/rigging/skinTreatments.ts`: treatment formulas and public labels; internal strategy IDs remain `current`, `protected` and `helper` for compatibility.
- `src/rigging/weights.ts`, `src/rigging/weights.worker.ts`: shared computation and packed variant output.
- `src/rigging/rigging.ts`: comparison creation, auxiliary bones, persistence and clip tracks.
- `src/rigging/bodyLandmarks.ts`: body landmarks from horizontal sections (leg split, skeleton root, hip pivots).
- `src/rigging/deformationMap.ts`: temporary final-deformation snapshots and diagnostic material.
- `src/core/editor.ts`, `src/animation/retarget.ts`: copy publication, undo grouping, helper updates, export filtering and shared ready poses.
- `src/ui/ui.ts`, `src/core/i18n.ts`: hierarchy, mode-specific controls and translations.
- `docs/rigging_comparison.md`: manual comparison instructions.
- `scripts/check-skin-treatments.mjs`, `scripts/check-helper-bones.mjs`, `scripts/check-skin-visibility.mjs`: focused checks.
- `scripts/check-leg-junction.mjs`: leg junction estimates, scale invariance and lowered-hand contamination regression.
- `scripts/check-rig-deformation.mjs`: accepts a caller-supplied input path and reports final geometry differences; does not bundle or identify private inputs.

Preserve the user-approved UI and generic treatment design. For subsequent deformation reports, use the difference map and final-vertex audit to distinguish misplaced joints, skin misclassification and actual trunk deformation. Do not force weight changes just to make comparison copies look different.

## Follow-up implementation

The user authorized these improvements and approved the resulting final state. These changes are included in the current implementation.

- `src/rigging/bodyLandmarks.ts` estimates the leg merge from consecutive horizontal sections, uses the trunk's width profile (hip line, waist) to place Hips above the hip pivots, and follows upper-thigh sections for bilateral leg axes. Separate lowered hands are excluded from those section bounds. Coordinates scale with character height; there are no asset-specific paths, names or landmarks. Clothing and fused surfaces can still require manual adjustment.
- `src/rigging/deformationMap.ts` snapshots final Babylon skinned positions, including active morphs, relative to each entity root. The comparison layout offset is excluded. Pose controls expose a temporary purple/gold/red map with maximum and mean displacement as percentages of rest height. Changing joints or morph influences clears the snapshot; original materials are retained for project persistence and restored before GLB export. Vertex evaluation is only triggered by the button.
- Trunk protection previously treated some distal arm vertices as trunk skin. Its eligibility now requires the nearest arm segment to be the upper arm and the axial chain to be closer. This removes the observed hand/forearm anchoring failure. Protection can legitimately leave all weights unchanged on an input; the diagnostic reports zero rather than forcing artificial differences. Distributed rotation still changes final geometry in the exercised A-pose case.
- Focused checks cover scale-invariant hip placement, isolated centerline details, lowered-hand contamination, distal-arm eligibility, real helper deformation, layout-independent diagnostics, material restoration and morph invalidation. The production build and real geometry audits on caller-supplied T-pose and A-pose inputs pass.
- Browser verification exercised the new joint estimates and generated a three-copy comparison on a dense mesh. The difference map rendered without console errors, changing the pose cleared it, and hiding the map restored materials. Controls were also checked at 375 pixels wide. Active morph behavior has focused logic coverage; it was not separately exercised with a morph-enabled model in the browser.

Re-run Find the joints and create a new rig/comparison to exercise the new estimates and eligibility. Existing saved joints and weights are preserved. No dual quaternion skinning, Delta Mush, collisions or corrective morphs were added.

## Naming and interface revision

Requested after the approval above and included in the current implementation.

- **Generic module names.** `pelvis.ts` → `bodyLandmarks.ts` (`findLegJunction`, result `split`, `hips`, `left`, `right`); `shoulderWeights.ts` → `skinTreatments.ts` (`SkinTreatment`, `SKIN_TREATMENTS`, `applySkinTreatment`, inputs `treatedRoots`, `trunkUp`, `trunkBones`); `rigDifference.ts` → `deformationMap.ts` (`DeformationMap`); helper functions `updateHelperBones`, `addHelperBoneTracks`. Checks: `check-leg-junction.mjs`, `check-skin-treatments.mjs`, `check-helper-bones.mjs`. Anatomical words remain only where they name a body part.
- **Compatibility.** Stored treatment ids (`current`, `protected`, `helper`) are unchanged. `RigData.treatment` replaces `shoulderStrategy`; projects saved with the old key still restore it.
- **Rig flow in three steps** — *Joints* (Placement: Find the joints, Reset, Symmetry; Facing: Turn 90°/180°, Front view) → *Skin* (Calculation: Weights and Treatment selects; "Compare all three" is a Treatment choice, replacing the nested switch) → *Check* (Test: test pose, weight colors with a legend). A stepper at the top of the Rig panel shows the steps (finished ones can be revisited) and a fixed footer holds Cancel and the step's actions (Next, Back, Apply rig/Compare, Done). The floating bar shows the step (`1/3`…) and the same actions only while the Rig panel is closed, so they are never duplicated. Weight computation shows a progress bar in the panel and the percentage in the bar.
- **Feedback.** Toasts after Find the joints (success or failure), applying a rig and creating a comparison. Treatment descriptions are data in `skinTreatments.ts`.
- **Comparison in Pose.** "Compare treatments" section: a Difference map toggle, the Red-at slider, a compact per-copy readout (max · mean) and "Update for this pose".
- Verified: build, all focused checks, the single and comparison flows in the browser, and both bars at 375 px.
