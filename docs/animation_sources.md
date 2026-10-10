# Animation and rig sources

Findings of step R00 of `animation_rigging_implementation_plan.md`: which free skeleton and clips babalon JS bundles, what they contain, and how retargeting behaves with them.

## Quaternius Universal Animation Library (Standard)

- **Download:** https://opengameart.org/content/universal-animation-library — `universal_animation_librarystandard.zip` (14.5 MB). Pack page: https://quaternius.com/packs/universalanimationlibrary.html.
- **License (file inside the archive, `License.txt`):** CC0 1.0 Universal, "Models by @Quaternius". Free for any use, no attribution required (we credit it anyway in `THIRD_PARTY_LICENSES.md`).
- **Files used:** `Godot/AnimationLibrary_Godot_Standard.glb` (6.6 MB): one mesh "Mannequin" (2 primitives, 8.5k vertices), one skin with 53 joints, 46 animations. The Unity/Unreal FBX versions contain the same clips.

### Rig

- Blender Rigify deform bones (`DEF-` prefix), meters, Y-up glTF, character faces +Z.
- Hierarchy: `Rig` → `root` (−90° X, Blender Z-up conversion) → `DEF-hips` → `DEF-spine.001` → `.002` → `.003` → `DEF-neck` → `DEF-head`; `DEF-spine.003` → `DEF-shoulder.L/R` → `DEF-upper_arm` → `DEF-forearm` → `DEF-hand` → 5 fingers × 3 (`f_index`, `f_middle`, `f_ring`, `f_pinky`, `thumb`); `DEF-hips` → `DEF-thigh.L/R` → `DEF-shin` → `DEF-foot` → `DEF-toe`.
- Rest pose: **T-pose** (arms horizontal). Character height ≈ 1.6 m.

| Joint | Rest position (m) |
| --- | --- |
| hips | 0, 0.917, −0.050 |
| spine.001 | 0, 1.051, −0.016 |
| spine.003 | 0, 1.315, −0.005 |
| neck | 0, 1.488, −0.011 |
| head | 0, 1.569, 0.005 |
| shoulder.L | 0.019, 1.458, 0.071 |
| upper_arm.L | 0.192, 1.441, −0.065 |
| forearm.L | 0.466, 1.441, −0.070 |
| hand.L | 0.739, 1.441, −0.065 |
| thigh.L | 0.089, 0.932, 0.001 |
| shin.L | 0.089, 0.532, −0.001 |
| foot.L | 0.089, 0.104, −0.036 |
| toe.L | 0.089, 0.015, 0.113 |

### Clips

46 clips baked at 30 fps with translation, rotation and scale keys on every joint (4.3 MB of animation data). All are in place except the `_RM` (root motion) variants. `A_TPose` is the reference pose.

## Retargeting results (Babylon 9.30 `AnimatorAvatar`)

Tested in the dev server with the UAL `Walk_Loop` clip on the UAL Mannequin, the Babylon samples Xbot and HVGirl (Mixamo-style `mixamorig:` names, T-pose):

- `detectHumanoid()` maps all 22 canonical bones on the three rigs (Rigify and Mixamo naming).
- **Plain `retargetAnimationGroup`** transfers each bone's rotation relative to the two rest poses. It is correct only when both rest poses match. It also retargets every translation and scale channel, which stretches bones when proportions differ.
- **What `src/retarget.ts` does on top:**
  - keeps rotations for all bones and translation only for the hips;
  - bends the source skeleton into the target's rest pose bone by bone (same directions) before retargeting, so T-pose clips play on A-pose characters too;
  - resets the character's own transform while retargeting (otherwise a turned character gets the motion in the wrong axes);
  - `fixRootPosition` and `fixGroundReference` (+ dynamic reference node) with the source hips and left foot keep feet on the ground at any scale;
  - optional "in place" drops horizontal hips travel.
- **Result:** at the same frame, bone directions, hip and shoulder axes of the three characters, expressed in each character's own space, match to two decimals. The walk plays without broken limbs on all three.
- **Pitfall found:** Babylon caches world matrices and a child reads its parent's cached matrix. After turning a joint, world positions of deeper joints must be computed from the root down (`worldMatrix()` in `src/humanoid.ts`), otherwise bones point the wrong way.
- **Loader setting:** model and clip files are loaded with `animationStartMode: NONE`, so the hidden template's joints stay in their rest pose (needed as the retargeting reference).

## Decisions

- **D1 — template rig:** the UAL rig. It is CC0, a clean T-pose, has standard Rigify deform names and comes with the clips, so rigs made in the app (R08) use exactly the bone names and proportions of the built-in clips. Canonical names in code are the VRM humanoid names (`src/humanoid.ts`). We only use VRM's naming convention, not any VRM file or text.
- **D2 — bundled clips:** all 43 clips except `A_TPose` and the two `_RM` duplicates. Each clip is a separate file in `public/animations/` (skeleton nodes + one optimized animation, 31–107 KB, ≈2 MB in total). They are downloaded only when used and cached for offline use, not precached. A Mannequin sample (`public/models/mannequin.glb`, 632 KB, with `Idle_Loop`) gives every user a free humanoid to try posing and the library. Files are generated reproducibly by `scripts/build-animation-library.mjs`.

## Other sources checked

- **VRM humanoid specification** (`vrm-c/vrm-specification`, `humanoid.md`): bone names, hierarchy and anatomical positions. The repository declares no license, so we use the naming convention only.
- **MakeHuman:** assets are CC0, but no skeleton is named explicitly. Fallback only; not used.
- **Godot `SkeletonProfileHumanoid`** (MIT engine): 56-bone humanoid profile. Used as a reference for conventions; no code or data copied.
