---
name: anatomy-regional-audit
description: Use the babalonJS regional audit to diagnose and compare anatomy fitting, including the abdominal wall, pelvis, chest, shoulder, axilla, and flexed elbow. Use when the skin differs from the target GLB, muscles cross the skin, or growth controls distort a muscle.
---

# Regional anatomy audit

This is a temporary repository skill. Shorten it as the tooling absorbs manual steps.

Run from the repository root with Chrome, Node, and Playwright available. When Playwright comes from an existing installation outside the repository, set `PLAYWRIGHT_MODULE` to its module path. Use a scratch directory outside the source tree for reports and snapshots.

```text
node scripts/anatomy-region-audit.mjs capture <model.glb> <baseline-dir>
node scripts/anatomy-region-audit.mjs replay <baseline-dir>/snapshot.json <comparison-dir> [candidate.json]
```

- Capture through **Fit only** on a real GLB. The tool waits for the automatic soft-tissue refinement and saves the fitted parameter document and aligned target sections. Capture hypertrophied reference and smooth-surface reference separately.
- Replay against the same snapshot after a generator edit. For a parameter experiment, supply an exported anatomy parameter document as the optional candidate. Keep the baseline and comparison directories separate. Capture again when changing source alignment, fitting inference, or observation extraction.
- Read `report.json` for sampled anterior depth, missing samples, sampled muscle/skin crossings, attachment residuals and timing. Inspect the two SVG cuts for the worst deviation with and without `skinFit`. Saved fitting evidence belongs to the baseline; the replay's section and attachment measurements belong to the current candidate.
- Hold alignment fixed during a generator experiment. Compare the same samples and examine the worst cut before attributing a deviation to a muscle. A ray near the crotch can reach a different surface on the GLB and the generated body. The crossing count covers only the sampled anterior points. Use the editor to inspect neighboring sections and poses when a change affects a boundary.
- Identify the failing layer, change one anatomical relation at a time, and rerun the same comparison. Check that the expected local gain survives on the second target and at shared boundaries. If a material defect persists, keep investigating its first failing stage. A build or a lower mean error alone is insufficient. Record an exact reproducible failure if the remaining work is blocked.

## Chest, shoulder, and flexed elbow

- Capture a target with raised arms as the raised-arm case. Keep a render of the previous fitted result and its exported parameters before editing. Use replay to isolate a generator change, then run **Fit only** again for inference changes. If the final mesh correction was applied by replaying a fresh fit, label it that way. Compare joint coordinates side by side; fitted arm radii can change independently of joint positions.
- Compare the aligned GLB, before, and after with the same camera, crop, and lighting. Capture front and three-quarter close-ups with and without procedural skin, and use a side view for depth or silhouette disputes. To check visible crossings, render the relevant muscles underneath the opaque skin as well as on their own.
- Set `AXILLA_AUDIT=1` for upper-body contact measurements. Compare the same region and record the sample count, the count above 2 mm, and the maximum. Use the fitted shoulder and elbow joints to locate the regions on bent limbs. A nearest-normal sign can switch walls in a narrow recess; corroborate outliers with sectional rays and inspect face interiors, since a triangle can bridge the fold even when its vertices are covered.
- Measure the pectoral belly, lower fold, sternum, and shoulder-to-axilla transition separately. A raised arm can occlude the outer fold from a frontal ray; validate the observable belly separately and use oblique views for the junction. Check candidate skin refinements against held-out points in the junction and the rest of the arm so improving the shoulder does not undo elbow fitting.
- Treat a dark crease as a possible surface fold even when mean depth error improves. Cast repeated rays through the marked area to detect overlapping front faces and check projected triangle orientation before and after tangential smoothing. Use authored front membership for vertices pushed inward by a fold. Treat missing grid samples as missing data; interpolating them as zero depth can introduce a depression at the edge of the correction.
- Validate sternum repairs independently of elbow flexion. Try measured anterior depth where it improves the surface. If depth already agrees with the GLB, test tangential relaxation without replacing depth. Accept it only when it reduces repeated front-ray hits on the same grid without materially worsening depth or introducing sampled muscle crossings.
- Run fresh **Fit only** captures on hypertrophied reference, smooth-surface reference, and raised-arm reference when changing this decision. Compare overlap counts and depth separately, verify that joint positions and the previously improved raised-arm fit hold, and inspect matched front and three-quarter views for a remaining crease. A lower overlap count does not imply the crease is gone.
- For muscle contact, first move paired shell faces together and taper corrections near attachments. Inspect the result without skin and measure the largest displacement per muscle; an improved contact score can hide a dent or a displaced neighboring muscle. In tight elbow creases, limit the fallback to the exposed face and use the fitted arm axis or a nearby interior point if the closest normal points across the fold.
- When the change affects growth controls, check nominal and increased depth with and without skin during drag and after release. Verify that the gain in volume survives and that neither preview nor final geometry produces blades, sharp folds, or crossings.

## Regression in projected muscle contact

- A front/rear ray correction added to the fold contact pass moved otherwise stable clavicular pectoral and latissimus vertices. An A/B replay on identical fitted parameters isolated the change from fitting inference and posing. The smooth-surface reference moved by up to 5.9 mm and raised-arm reference by up to 6.5 mm.
- When changing contact, keep fitted parameters, pose, camera and lighting fixed. Compare raw and final muscle positions separately. Check maximum displacement by muscle and inspect the result with and without skin. A reduced number of visible crossings can come at the cost of a distorted muscle.
- Restore the established fold contact rules if a candidate changes muscle shape without an acceptable visual gain. This regression was resolved by removing the added directional correction in `axillaryContact.ts` and `foldFaceContact.ts`. Recheck both wrists on an opening and return motion, and report residual crossings separately. On the smooth-surface reference, a fresh Fit only also reproduced the saved fit parameters and contact measurements.

See [regional development plan](../../plans/anatomy-regional-development.md) for the next solver milestone.
