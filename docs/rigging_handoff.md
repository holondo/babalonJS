# Rigging comparison handoff

The user approved this final state and requested a local commit without a push. The comparison remains experimental; approval does not mean that every treatment improves every pose. Keep the implementation independent of model names and files.

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
- The three treatments produced distinct final geometry in the exercised inputs. However, differences are local and may be visually negligible. In one A-pose case, trunk protection left the sampled lateral back exactly unchanged in Relaxed, while distributed rotation had a very small effect there.
- **Direct weights is the current corrected solver, not the old diffusion implementation that visibly distorted the trunk.** All variants inherit those shared corrections, explaining why all three can look similarly improved.
- Trunk protection showed a significant potential failure in an A-pose case with raised arms: some final vertices differed by roughly 0.33 scene units from direct weights. This indicates possible unintended arm influence and needs localized investigation before recommending that treatment generally. No algorithm change was made after this audit; the user approved the state including this reported limitation.
- No treatment was selected as a universal winner. Pelvis detection was not changed. Dual quaternion skinning, Delta Mush, collisions and corrective morphs were not implemented.

## Verification and source references

The production build and focused strategy, visibility and helper checks passed. Browser checks covered individual binding, skin review, comparison creation from the floating bar, cancellation and a 375-pixel layout. Earlier comparison checks also covered ready poses, undo/redo and project reloads. Real geometry audit runs passed after adding final vertex comparisons.

- `src/shoulderWeights.ts`: treatment formulas and public labels; internal strategy IDs remain `current`, `protected` and `helper` for compatibility.
- `src/weights.ts`, `src/weights.worker.ts`: shared computation and packed variant output.
- `src/rigging.ts`: comparison creation, auxiliary bones, persistence and clip tracks.
- `src/editor.ts`, `src/retarget.ts`: copy publication, undo grouping, helper updates, export filtering and shared ready poses.
- `src/ui.ts`, `src/i18n.ts`: hierarchy, mode-specific controls and translations.
- `docs/rigging_comparison.md`: manual comparison instructions.
- `scripts/check-shoulder-strategies.mjs`, `scripts/check-shoulder-helper.mjs`, `scripts/check-skin-visibility.mjs`: focused checks.
- `scripts/check-rig-deformation.mjs`: accepts a caller-supplied input path and reports final geometry differences; does not bundle or identify private inputs.

Preserve the user-approved UI and generic treatment design while investigating any subsequent deformation reports. A next investigation should localize the raised-arm outliers and distinguish misplaced joints, arm-skin misclassification and actual trunk deformation.
