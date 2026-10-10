# Comparing shoulder deformation

These are experimental alternatives, not quality rankings. They work from the model's geometry and the placed joints; there are no model-specific presets.

1. Load a static humanoid and open **Objects → Rig → Start rigging**.
2. Find and adjust the joints, including the pelvis and shoulders, before comparing.
3. In **Bind the mesh**, choose **Apply rig** for one character or **Compare treatments** for three variants. Select **Envelope weights** or **Heat diffusion**; this solver is shared by all comparison variants.
4. Select **Create comparison**. The original remains in Objects, hidden. Three named copies appear together:
   - **Direct weights**: the calculated weights without an additional treatment.
   - **Trunk protection**: an additional sloped boundary below each shoulder transfers arm influence to nearby spine bones, while a proximity mask keeps lowered arms free.
   - **Distributed rotation**: two extra bones follow half of the upper arms' local rotation, receiving some arm influence near the shoulders.
5. Select any comparison copy, open **Pose**, and choose a ready pose. All copies receive it together. Manual joint edits affect only the selected copy.

Start with T-pose, Relaxed, Arms up, Wave and Hands on hips. Observe front, back and side views. Compare lateral back compression, armpit folds, shoulder volume and unwanted trunk movement. Report the best variant per pose, including where another variant behaves better. A treatment that fixes Relaxed may worsen Arms up.

Ready poses and comparison creation each support undo. Cancelling weight computation leaves no partial copies. Project saves retain weights, shoulder settings and comparison membership. Duplicating a comparison member creates an independent character. Helper bones are included in GLB export, and added animation clips receive sampled helper rotation tracks.

Direct weights remain the default. Both additional treatments currently act where the arms meet the trunk. These tests do not change pelvis detection or introduce dual quaternion skinning, Delta Mush, physical collisions or corrective morphs. Three dense copies require more memory than one; the weight solver runs once in a worker. The rig introduction has no weight settings; configuration appears only after starting and placing the joints. Comparing treatments always creates all three, so no individual treatment selector is shown in that mode.

Developer checks:

```sh
npm run build
node scripts/check-shoulder-strategies.mjs
node scripts/check-shoulder-helper.mjs
node scripts/check-skin-visibility.mjs
node scripts/check-rig-deformation.mjs <meshopt-glb-path> heat comparison
```
