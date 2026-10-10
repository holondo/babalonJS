# Comparing skin treatments

These are experimental alternatives, not quality rankings. They work from the model's geometry and the placed joints; there are no model-specific presets.

1. Load a static humanoid and open **Objects → Rig → Start rigging**.
2. Find and adjust the joints, including hips and shoulders, before comparing.
3. Select **Next** in the floating bar. In **Skin**, choose the **Weights** method (Envelope or Heat diffusion; all comparison copies share it) and set **Treatment** to **Compare all three**.
4. Select **Compare** in the floating bar. The original remains in Objects, hidden. Three named copies appear together:
   - **Direct weights**: the calculated weights without an additional treatment.
   - **Trunk protection**: an additional sloped boundary below each shoulder transfers arm influence to nearby spine bones, while a proximity mask keeps lowered arms free.
   - **Distributed rotation**: two extra bones follow half of the upper arms' local rotation, receiving some arm influence near the shoulders.
5. Select any comparison copy, open **Pose**, and choose a ready pose. Turn on **Difference map** under **Compare treatments** to color each copy by its displacement from Direct weights. All copies receive it together. Manual joint edits affect only the selected copy.

Start with T-pose, Relaxed, Arms up, Wave and Hands on hips. Observe front, back and side views. Compare lateral back compression, armpit folds, shoulder volume and unwanted trunk movement. Report the best variant per pose, including where another variant behaves better. A treatment that fixes Relaxed may worsen Arms up.

In **Pose → Deformation differences**, select **Show difference map** to compare final skinned vertex positions with Direct weights. Purple means no difference; gold and red indicate increasing displacement. **Red at** sets the color threshold as a percentage of rest height, and the panel reports maximum and mean displacement for each copy. Copy layout offsets are excluded. The map is a temporary snapshot: changing a pose removes it, and it is not saved or exported. Calculation is explicit, not performed per frame. The controls can legitimately report zero if a treatment has no eligible region on that mesh.

Joint finding now uses several sections to detect the leg split and the trunk's width profile. Hips is placed above the hip pivots; leg positions use several upper-thigh sections instead of a single density-weighted average. These remain estimates and should be checked manually, especially for clothing, fused legs and unusual proportions.

Ready poses and comparison creation each support undo. Cancelling weight computation leaves no partial copies. Project saves retain weights, the skin treatment and comparison membership. Duplicating a comparison member creates an independent character. Helper bones are included in GLB export, and added animation clips receive sampled helper rotation tracks.

Direct weights remain the default. Both additional treatments currently act where the arms meet the trunk. Dual quaternion skinning, Delta Mush, physical collisions and corrective morphs are not implemented. Three dense copies require more memory than one; the weight solver runs once in a worker. The rig introduction has no weight settings; configuration appears only after starting and placing the joints. Comparing treatments always creates all three, so no individual treatment selector is shown in that mode.

Developer checks:

```sh
npm run build
node scripts/check-skin-treatments.mjs
node scripts/check-leg-junction.mjs
node scripts/check-helper-bones.mjs
node scripts/check-skin-visibility.mjs
node scripts/check-rig-deformation.mjs <meshopt-glb-path> heat comparison
```
