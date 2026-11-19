# Data-calibrated procedural anatomy: implementation plan

Planning date: 2026-10-29. Status: proposed; implementation has not started.

Baseline note: this plan was authored against commit `0e6831b` before the user's
subsequent request to integrate `FORMA_v5.html`. That separate update adds a
heuristic pose preview, prototype atlas, local growth and improved regional
recipes; see [current anatomy documentation](docs/anatomy.md). Reuse those
capabilities when executing the plan and reconcile the baseline before editing.
They do not satisfy the plan's measured calibration, complete individual
structure coverage, anatomical skeleton/IK or physical contact milestones.
All implementation-plan steps remain TODO; no measured-data milestone has been
implemented merely by importing prototype coefficients.

## 1. Purpose, boundaries and execution rules

Evolve the existing procedural body generator into a data-calibrated, individually editable musculoskeletal body. Preserve procedural creation, existing appearance options, native materials and scene integration. Reference meshes, image sections and measurements are inputs to calibration; imported atlas meshes must **not replace the generated muscles or bones**.

The complete user path is: Add anatomical body → select a tissue and named structure → edit its morphology or development → pose the body → inspect the interacting layers → undo, compare, duplicate, save and reopen without losing parameters or materials.

Deliver whole-body coverage through regional increments, including the back, deep muscles, hands, feet, neck and head. Separate four concepts: baseline individual morphology; chronic muscle-volume development; pose/activation; and tissue coverage/appearance. Call baseline variation **individual anatomy**, not a predictive genetics model. This project has no genotype-to-shape evidence.

Governing references: [AGENTS.md](AGENTS.md), [product architecture](README.md), [current anatomy behavior](docs/anatomy.md), [original integration record](docs/plans/2026-10-29-anatomy.md), [materials and UX record](docs/plans/2026-10-29-anatomy-materials-ux.md). The older plans describe their implementation-time authorization; they do not authorize implementing this new plan.

Execution rules:

- This request authorizes this Markdown plan only. Start product implementation only after the user requests it. No new code, dependencies, source-data downloads, commits or pushes are part of this planning delivery.
- Work in the main agent only. No subagents, delegated review or other-chat workaround.
- Use a separate `codex/` branch for implementation; never implement directly on `main`. Preserve existing unrelated local changes; do not stash, reset or stage them automatically.
- Use JavaScript-driven browser automation and runtime logs. Do not use Computer/Browser Use tools. Capture reduced-resolution images only for visual inspection; never reduce the app's default render resolution.
- Build a complete small path first. Data preparation, schemas and tests are supporting work, not substitutes for a working editor entrypoint.
- Reuse the DOM components, feature loader, history, pose math, JointOverlay, native PBR materials and project archive. Domain code stays independent of DOM.
- All code, documentation and identifiers are English. Every user-facing string uses `tr()` with Portuguese translations.

Exclusions: full-body finite-element simulation, clinical diagnosis, exercise prescriptions, predicting training outcomes, molecular genetics, organ physiology, injury/pathology simulation and unrestricted tissue surgery. Internal organs may be represented by coarse volume proxies where needed for trunk shape/contact. Smooth and cardiac muscles are outside this musculoskeletal editor. Anatomical variation is not a growth simulation from childhood to adulthood. Facial expression and small skeletal muscles are included in the later head/detail increment; do not describe them as complete before that increment passes.

## 2. Verified current state

Repository inspection on the planning date found branch `codex/anatomy-materials-ux`. The working tree already contains unrelated changes in README files, Android/native AR and splat code, `src/core/editor.ts`, `src/ui/ui.ts`, related documentation/scripts and an untracked funding file. These are existing work, not anatomy-plan changes. Reinspect `git status` before implementation; do not assume this snapshot stays current.

| Existing source | Behavior and reuse | Gap to address |
|---|---|---|
| [parameters.ts](src/anatomy/parameters.ts), [catalogue.ts](src/anatomy/catalogue.ts), [catalogue.json](src/anatomy/catalogue.json) | Flat typed scalar parameters, defaults, ranges, profiles and regional grouping; 85 scalar fields including surface selection | Cannot represent per-bone, per-side, per-muscle/head state or variable-length tendon intersections |
| [geometry.ts](src/anatomy/geometry.ts) | `buildInternals`, `upperMuscles`, `lowerMuscles`, `buildHumanVolumeLayers`, `humanVolumeFields`; useful shells, fans, paths and cross-section kernels | Dynamic legacy numerical port; hard-coded attachment coordinates; several generic spindle forms and group scales; internal fitting is coupled to the reference skin |
| [reference.json](src/anatomy/reference.json) | Existing authored CC0 skin reference and deformation coefficients | Not an anatomical population dataset, skeletal atlas or fiber-architecture measurement |
| [geometry.ts](src/anatomy/geometry.ts) | `rectusBands` uses three fixed reference heights with one stagger control; `pectoralSection` builds a separate fan | Rectus intersections lack independent positions/depth/completeness; chest/abdomen relationship lacks explicit shared attachment/contact constraints. The reported visual overlap is not independently reproduced by source inspection alone |
| [geometry.ts](src/anatomy/geometry.ts) | Already generates levator scapulae, trapezius portions, rhomboids, rotator-cuff muscles and other upper/lower structures | Many share `back`, `deltoid`, `forearm`, `quadriceps` or other parameters; some have fixed volume. Exposing controls alone will not correct their shapes |
| [structures.ts](src/anatomy/structures.ts) | Ten rendering structures, five tissue groups, stable PBR ownership | `otherMuscles` and `bones` collect many anatomical structures; individual names are not stable render/edit identities |
| [contracts.ts](src/anatomy/contracts.ts), [anatomy.worker.ts](src/anatomy/anatomy.worker.ts) | Typed transferred geometry buffers, requested visible layers, job IDs | No anatomical skeleton, attachment patches, morphology overrides, volume targets or pose input |
| [body.ts](src/anatomy/body.ts) | `AnatomyBody`, `edit/commit/change/patch`, `ready`, `captureState/restore`, `saveReference/compare`, `duplicate`, worker coalescing/stale-result rejection | Replaces meshes on regeneration; converts legacy model coordinates to scene meters and applies height scaling in `apply`; comparisons capture flat parameters rather than complete future anatomy state |
| [material.ts](src/anatomy/material.ts), [studio.ts](src/anatomy/studio.ts) | Stable native PBR materials, optional fiber/skin effects, opt-in body-local study lights | Must preserve existing visual options while extending structure identity; visual material properties must not become mechanical stiffness controls |
| [anatomy panel](src/ui/panels/anatomy.ts), [UI shell](src/ui/ui.ts) | Object / Body / Layers / Material, search, profiles, mixing, layer isolation, context bubble | Regions and flat controls are mixed; no comprehensive structure inspector; anatomy branch currently omits the ordinary Pose tab |
| [pose.ts](src/animation/pose.ts), [humanoid.ts](src/rigging/humanoid.ts), [pose panel](src/ui/panels/pose.ts) | Poser, FK, two-bone IK, mirror, joint nodes, skeleton detection and shared overlay | Poser requires a skeleton. Canonical humanoid names are an animation abstraction, not one node per anatomical bone |
| [humanoidTemplate.ts](src/rigging/humanoidTemplate.ts), [rigging.ts](src/rigging/rigging.ts) | Existing rig for ordinary static models; parameterized anatomy intentionally excluded by `canRig` | Do not enable generic skin binding as a substitute for anatomy-aware attachments and deformation; template has no fingers |
| [project.ts](src/core/project.ts), [editor.ts](src/core/editor.ts) | Optional anatomy state, lazy creation/restore, texture inclusion, duplication and GLB export | New state must survive all these paths; generic pose serialization must not conflict with anatomy pose ownership |
| [numerical check](scripts/check-anatomy.mjs), [browser check](scripts/check-anatomy-browser.mjs), [fixture](scripts/fixtures/anatomy.html) | Real worker logic, geometry sanity, materials, JSON/ZIP, A/B, desktop/phone, JavaScript logs and optional ≤640 px screenshots | Checks assume ten structures, fixed field counts and 17,406 reference vertices; retain those assertions for legacy fixtures, not every future generator |

No external anatomical calibration dataset, complete individual structure registry, validated attachment atlas or tissue-contact solver was found in the current anatomy directory. Exact source coverage, fitting error and mobile performance are implementation measurements, not verified properties of this plan.

## 3. Data basis and conversion into procedural parameters

### 3.1 Primary sources and their specific roles

| Source | Use in this project | Limits / distribution rule |
|---|---|---|
| [BodyParts3D downloads](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html) | Named OBJ reference surfaces, source IDs, PART-OF and IS-A relationships; measure shape and relative placement | Start from elemental structures; compound atlas objects may duplicate geometry. One atlas is not a population distribution |
| [BodyParts3D current license](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html) | Record exact attribution with every distributed derivative calibration pack | Official page updated 2025-02-27 states CC BY 4.0. Do not assume an old mirror or derivative has identical terms |
| [Z-Anatomy repository](https://github.com/Z-Anatomy/Models-of-human-anatomy) | Secondary geometric/nomenclature reference when the primary atlas lacks detail | Repository states BY-SA terms and lists some NC assets. Never import its entire asset bundle under one assumed license; primary BodyParts3D is the default source |
| [NLM Visible Human](https://www.nlm.nih.gov/research/visible/visible_human.html), [access information](https://www.nlm.nih.gov/research/visible/getting_data.html) | Cross-sectional reference for depth and neighboring tissues | Cadaver reference cases, not ready-made population meshes. Process offline; never ship whole medical-image datasets in the app |
| [Ward et al., lower-limb architecture](https://pubmed.ncbi.nlm.nih.gov/18972175/) | Regional architecture calibration: fiber length, pennation and physiological cross-sectional area | Preserve cohort, measurement definition and specimen information; architecture is not recoverable from external mesh shape alone |
| [Holzbaur et al., upper-limb muscle volumes](https://pubmed.ncbi.nlm.nih.gov/17241636/) | Check relative volumes and plausible regional proportions | Do not assign a published group mean to every individual or infer missing covariance |
| [Broyles et al., rectus intersections](https://pubmed.ncbi.nlm.nih.gov/28671887/) | Intersections as variable, often incomplete structures; guide count, depth and extent | Does not supply a universal procedural formula or exact values for every body |
| [Ema et al., regional quadriceps adaptation](https://pubmed.ncbi.nlm.nih.gov/23949789/), [regional adaptation study](https://pmc.ncbi.nlm.nih.gov/articles/PMC6116919/) | Justify separate total growth and regional distribution controls | No universal training-to-hypertrophy prediction; do not hard-code one intervention's changes as human defaults |
| [OpenSim model collection](https://github.com/opensim-org/opensim-models), [muscle wrapping documentation](https://opensimconfluence.atlassian.net/wiki/spaces/OpenSim33/pages/53674058/Muscle+Editor) | Source-specific joint frames, muscle routes, via points and wrapping obstacles | Lines of action are not muscle surfaces; per-model/data licenses must be checked separately from software license |
| [Primary shoulder-model study](https://pmc.ncbi.nlm.nih.gov/articles/PMC6856649/) | Scapular movement and shoulder-path calibration; test across movement range | Region/model-specific evidence; does not validate our generator or every user's morphology |

Use [3D Slicer segmentation/export tools](https://slicer.readthedocs.io/en/5.4/user_guide/modules/segmentations.html) only for offline image-derived reference preparation when needed. Blender may assist landmark review and retopology of reference data. Neither becomes a runtime dependency. No runtime network or paid service is necessary for body generation.

### 3.2 Concrete preparation pipeline

Implement one local JavaScript preparation entrypoint, proposed `scripts/prepare-anatomy-data.mjs`. It receives an explicit source directory and manifest, selected structure IDs, output directory and a check-only option. It must not download or overwrite source files implicitly.

1. Read elemental source geometry, source ID tables and an explicit anatomical correspondence map. Record source URL/version, checksum, license, coordinate system, units, reference posture, laterality, cohort if known and exclusions. Keep large originals outside `public/`; distribute only audited derived coefficients and small regression samples.
2. Register references using named skeletal landmarks and regional frames. Do not independently center/scale each muscle, which would destroy its relation to bones. Reject unresolved unit/axis/posture metadata rather than guessing silently.
3. For each muscle, extract or author a center path and sections at normalized arc-length positions. Fit width, depth, center offset, section orientation, noncircular outline and taper curves. Use sheet/fan parameter domains for broad muscles; use separate bellies/heads where anatomy requires them. Preserve attachment areas, not just endpoints.
4. For each bone, fit a curved shaft and landmark-driven end surfaces, or a patch/shell recipe for flat/irregular bones. Separate articular surfaces from shaft dimensions; a bone is not a universally scaled cylinder.
5. Combine shape fits with independently sourced architecture measurements. Each value records `measured`, `fitted`, `inferred` or `artistic` provenance. Missing evidence stays missing; an explicitly inferred procedural default can work without being presented as measured.
6. Emit compact, versioned regional coefficient packs plus fit residuals, source coverage and exceptions. Reconstruct the procedural geometry and compare sections/landmarks/volume to the input. This inverse-fit loop is the actual data-to-generator connection.

Use weighted errors for landmark distance, sectional contour and relative volume. Report each separately; a good volume score cannot hide an incorrectly positioned muscle. For closed surfaces measure signed mesh volume; for incomplete source meshes use a declared sectional-volume method. Never silently cap an open reference and call the result measured volume.

Initial numerical design targets, **not claims of physiological accuracy**: ≤5% relative volume error and ≤5% local-width-normalized sectional contour RMS for the first reconstructed reference muscle; attachment landmarks within 1% of the associated bone length. Record attainable errors per source and resolve a missed target by improving the recipe or explicitly documenting the limitation, never by quietly widening the threshold.

## 4. Target architecture and shared contracts

### 4.1 Keep and extend the generator

Retain `geometry.ts` and both current surface options as the legacy engine. Extract only kernels needed by each implemented increment into typed new code; do not rewrite the entire numerical port first. New recipes produce the same transferable position/normal/index/fiber data consumed by `AnatomyBody`.

Proposed owning modules are forecasts, not a requirement to create empty files:

| Responsibility | Existing owner / proposed extension |
|---|---|
| Versioned state, compatibility normalization | `parameters.ts`, `migration.ts`; extend existing contracts rather than parallel serializers |
| Canonical anatomical identities, regions, relationships, controls | New `src/anatomy/registry.ts`; `structures.ts` becomes compatible rendering/material grouping over that registry |
| Small versioned reference coefficient packs | New `src/anatomy/data/manifest.json`, regional JSON packs and `src/anatomy/calibration.ts`; large optional packs may live under `public/anatomy/` and load on demand |
| Recipe evaluation and existing-kernel dispatch | New `src/anatomy/generator.ts`; keep legacy exports available |
| Typed bone/muscle geometry | New `src/anatomy/bones.ts`, `src/anatomy/muscles.ts`; regional data describes differences instead of duplicating algorithms |
| Anatomical frames, joint constraints and attachments | New `src/anatomy/skeleton.ts`; distinct from the generic humanoid template |
| Anatomy pose adapter and deformation | New `src/anatomy/pose.ts`; reuse `animation/pose.ts` math and editing lifecycle |
| Local contact, sliding and soft-tissue envelope | New `src/anatomy/mechanics.ts`, `src/anatomy/envelope.ts` only as their steps need them; reuse `fat.ts` where appropriate |
| Scheduling, material ownership, project state | `body.ts`, `contracts.ts`, `anatomy.worker.ts`, `core/project.ts` |
| Structure browser and contextual inspector | `ui/panels/anatomy.ts`; extract a panel helper only if size warrants it; shell wiring remains in `ui.ts` |

Pipeline: state → resolve legacy/group defaults and explicit overrides → bone morphology/rest frames → pose-constrained bone transforms → muscle attachment patches and wrapped paths → rest/development geometry → length/activation deformation → local contact/sliding → fat/skin envelope → transferred render buffers. The reference skin supplies topology/detail where useful; it must not squeeze all grown muscles back inside an unchanged old silhouette.

### 4.2 State and ownership

- Add optional `schemaVersion`, `generatorVersion` and `calibrationVersion` to anatomy state. Keep `parameters` as the legacy/global compatibility input. Add sparse `boneOverrides`, `muscleOverrides`, `tissueOverrides`, joint pose, activation and per-structure display state as typed optional blocks. Do not add hundreds of fields to the old flat defaults.
- Preserve the existing `reference` and `referenceMaterials` fields at the compatibility boundary and add a complete immutable comparison snapshot. Comparison A must include morphology, development, pose, activation, tissue settings and appearance; existing A/B still opens.
- Canonical IDs are anatomical English plus laterality/index, e.g. `muscle.rectusAbdominis.left`, `bone.rib.left.07`, `bone.vertebra.T07`. Heads/portions have child IDs under their parent muscle. External atlas IDs are mapped aliases, not runtime identity.
- Bone identity, joint identity, muscle identity, geometry part and material group are distinct. A fused adult bone may have named subregions without pretending they are independently mobile bones.
- Sparse resolution order is versioned default → global proportion/group control → individual morphology → development distribution → pose/activation. Document which legacy group affects which structures. Explicit individual settings survive unrelated group edits; group adjustments operate on a captured baseline and can be reset separately.
- Bilateral linking is an editing behavior, not shared mutable state. Store both sides explicitly when overridden; one linked edit and its undo affect both sides atomically. Midline structures do not acquire fake left/right copies.
- New generator internals and scene outputs use meters and radians; UI may show cm/mm/degrees. Legacy kernels keep their current units behind one conversion adapter. Do not retain `apply` height scaling on already-meter-space new output.
- Separate tissue mechanical parameters from PBR appearance. Hiding/isolation changes rendering only: hidden bones and muscles still constrain visible tissue. Requested render layers are not the set of physical dependencies to compute.
- Worker inputs include request ID, body/generator/calibration revisions, immutable resolved inputs, requested render structures and quality choice. Outputs retain stable anatomical metadata and diagnostics. Reject stale pose/morphology results; preserve last valid geometry on failure, show a recoverable localized message and allow retry.
- Cache by source state/revision, reuse topology when unchanged, update vertex buffers for ordinary deformation and preserve material/texture identity. No continuously running solver for a static pose. Transient worker progress emits `activity`; committed changes trigger the existing scene/history/autosave path.
- The anatomical skeleton is authoritative for parameterized bodies. Expose a lightweight canonical humanoid map for existing presets/retargeting; do not collapse individual radius/ulna, scapula, vertebrae, fingers or toes into that map. Imported ordinary models keep their current rig behavior.
- Old projects without a generator version keep legacy geometry. Offer a reversible upgrade on a duplicate/preview, retaining original parameters/materials. Do not silently change saved bodies to a new anatomical reference. New files use the new generator only after their supported initial increment is available and clearly identify incomplete coverage.
- Parameter JSON, `.babalon`, autosave, duplication and comparison serialize the same authoritative state. Generated geometry and source images are not the persistence source. No destructive project-format migration is planned.

### 4.3 Control families

| Domain | Individual controls | Constraints and UI distinction |
|---|---|---|
| Bones | Length; shaft width/depth/taper/curvature; end proportions; landmark positions; relevant torsion/version; flat-bone contour and thickness | Articular compatibility and attachment patches follow the edited bone. Cranial sutures/fused pelvic regions have morphology controls, not invented motion |
| Muscles: anatomy | Belly/tendon length ratio; sectional width/depth profiles; fullness location; flattening; curvature; attachment extent; head proportions; asymmetry | Use source-supported degrees of freedom per muscle; not every recipe exposes every field |
| Muscles: development | Total target volume ratio; proximal/middle/distal distribution or sheet-local distribution; independent head balance | Normalize distribution so it does not accidentally change total target volume. Shape variation and growth are distinct |
| Muscles: activation | Per-muscle activation and optional group/co-contraction controls; passive stretch response | Same pose can be relaxed or tense. Activation is an artistic/kinematic input unless a validated dynamics solver is later added |
| Connective tissue | Tendon path/slack reference; aponeurosis shape; rectus intersection geometry; constrained sliding/attachment regions | Length and tension values without measurements are labeled approximations; no force readout inferred from a slider |
| Fat and skin | Regional superficial/deep fat distribution where supported; coverage thickness; skin thickness/laxity/tethering and fold response | Keep preexisting controls and effects. No fixed conversion from a visual fat control to clinically measured body-fat percentage |
| Pose | Joint-specific named motions, FK/IK, limits/couplings, side copy/mirror and reset | Independent anatomy edits change rest geometry; pose edits do not rewrite bone lengths or baseline hypertrophy |

Rectus intersections use a variable array per side: normalized longitudinal position, width, obliquity, curvature, lateral extent, depth fraction and continuity. Maintain order and minimum separation. Distinguish separate muscle bellies from arbitrary rows of decorative bumps. Intersections need not traverse the whole thickness. Add linea alba and rectus-sheath relationships; correct upper attachments and the neighboring pectoral/costal geometry rather than globally pushing the abdomen backward.

### 4.4 Whole-body coverage ledger

Create a machine-readable ledger in the data manifest, expanded to **one row per actual structure/side/head/index**, not only the families below. Every row names generator recipe, available controls, attachments, pose dependencies, material group, evidence, quality and implementation status. Source IDs missing a supported correspondence remain explicit gaps. Do not complete a region by renaming a generic aggregate.

| Region / owning step | Required bones and structures | Required muscle coverage and distinctions |
|---|---|---|
| Axial skeleton / P02 | Individual C1–C7, T1–T12, L1–L5; sacrum/coccyx with fused-region semantics; sternum and landmarks; ribs 1–12 each side, costal cartilages; individual clavicles/scapulae; hip bones and sacroiliac/pubis relationships | Attachment basis for trunk, neck and girdles |
| Chest, abdomen, back / P04 | Thoracic/pelvic frames and landmarks above | Rectus each side, external/internal obliques, transversus, pyramidalis variant; pectoralis major portions, minor, serratus anterior slips, subclavius; latissimus; trapezius upper/middle/lower portions; rhomboid major/minor; levator scapulae; erector-spinae subdivisions and regional segments, multifidus, rotatores/interspinal/intertransverse families, quadratus lumborum; intercostal layers, diaphragm and abdominal-wall connective tissue |
| Upper limb / P05 | Humerus, radius and ulna separately; all eight named carpals per hand, metacarpals I–V and individual phalanges; relevant sesamoid variants | Deltoid portions; four rotator-cuff muscles; biceps heads, brachialis, coracobrachialis; triceps three heads/anconeus; individual forearm flexors/extensors, pronators/supinator, brachioradialis; thenar/hypothenar/adductor pollicis, lumbricals/interossei and their separate tendon routes |
| Lower limb / P06 | Femur, patella, tibia/fibula; seven named tarsals per foot, metatarsals I–V, individual phalanges and relevant sesamoids | Gluteal three muscles, TFL; iliacus/psoas major with psoas minor variant; short external rotators; four quadriceps muscles; sartorius/gracilis/pectineus and individual adductors; hamstrings including biceps heads; gastrocnemius heads/soleus/plantaris variant; tibialis anterior/posterior, fibular muscles, long toe flexors/extensors, popliteus; intrinsic foot layers, lumbricals/interossei and plantar fascia/Achilles routes |
| Head and neck / P07 | Individual neurocranial/viscerocranial bones with mirrored/unpaired semantics; mandible/hyoid; auditory ossicles as small structures without unsupported dynamic simulation | SCM heads, scalenes, deep prevertebral/suboccipital groups, suprahyoid/infrahyoid muscles; masseter/temporalis/pterygoids; individual major facial-expression muscles and scalp muscle portions; extraocular, tongue, pharyngeal/laryngeal skeletal groups in explicit detail coverage |
| Pelvic floor and small/deep detail / P07 | Existing pelvic, sacral and hyoid/cranial attachment basis as applicable | Levator-ani subdivisions, coccygeus and appropriate perineal skeletal structures, represented with explicit reference/anatomical variants rather than a forced universal preset |
| Covering/connective tissues / P11 | Articular cartilage proxies, discs, major capsule/ligament constraints | Major tendons/aponeuroses, rectus sheath/linea alba, thoracolumbar fascia, IT band, palmar/plantar fascia, skin/fat regional envelopes |

Teeth are not bones; show them only as separately typed attachment/occlusion geometry if required by jaw posing. Individual auditory/ocular/laryngeal structures can have shape controls without promising validated hearing, vision, speech or swallowing. Exhaustive small/deep detail is substantial work: the ledger must report missing named structures, not hide them behind a whole-body completion label. Optional anatomical variants are opt-in and carry source provenance.

### 4.5 UI organization

Keep Objects → **Object / Body / Layers / Pose / Material** for an anatomical body; Pose appears as its integration becomes usable. Do not add a top-level dock button. Within Body use one segmented choice for **Bones / Muscles / Other tissues**, a region selector, search and a flat result list. Selecting a result opens its inspector in the same panel with a back button and breadcrumb label. The anatomical hierarchy is data organization, not nested menus.

For a selected muscle the inspector offers **Anatomy / Development / Activation** using the existing segmented component; bone controls contain anatomy only. Default to a short primary set, with advanced fields in one collapsible section. Include side linking, numeric values/units, individual/group reset and clear inherited/overridden status. Group controls say which structures they affect; changing `Back` must not overwrite an individually edited infraspinatus without an explicit group-reset action.

Layers owns visibility, isolation and display quality, with the same search/selection identity. Material edits the selected anatomical structure through the ordinary PBR panel. Pose edits joint motions and exposes relevant muscle activation without moving material controls into physics settings. A click/tap on a visible structure selects its inspector; hidden structures remain accessible in the list. Selection highlighting must not mutate saved material values. Preserve object transform versus local anatomy selection.

Profiles, mixing, variation, comparison, original surface choice, study lighting, inspection, exports and all original parameters remain reachable. Profile scope must be explicit: anatomy, development, appearance or a complete body. Whole-body defaults and advanced local overrides must not silently erase one another. No panel rebuild while a slider gesture is active. Support desktop and 375×812, ≥36 px targets, scroll-safe sliders, keyboard focus and UI hiding.

## 5. Implementation sequence

All steps are TODO. New files named below are proposed; extend an existing owner when that avoids duplicate behavior. Every regional step must ship working controls, generation, pose dependencies, materials and persistence for its region, not just fill a catalogue.

### P00 - Deliver one data-calibrated rectus editing path

**Status:** TODO

**Objective**

Create a body with a procedural rectus whose measured shape can be edited individually, including intersections, then undo, compare and save/reopen it through the real app.

**Required reading**

- [Geometry](src/anatomy/geometry.ts): `rectusBands`, `abdominalLayout`, `buildInternals`, `buildHumanVolumeLayers`, shared shell/section primitives.
- [Controller](src/anatomy/body.ts): `edit`, `change`, `captureState`, `restore`, `apply`, worker scheduling and material identity.
- [Worker contract](src/anatomy/contracts.ts), [worker](src/anatomy/anatomy.worker.ts): transferred buffers and version rejection.
- [Anatomy panel](src/ui/panels/anatomy.ts), [project](src/core/project.ts): real entrypoint, existing controls and snapshot/restore.
- Data sources and fitting rules in section 3; [migration](src/anatomy/migration.ts) for compatibility ownership.

**Target files**

`src/anatomy/parameters.ts`, `src/anatomy/migration.ts`, `src/anatomy/contracts.ts`, `src/anatomy/anatomy.worker.ts`, `src/anatomy/body.ts`, `src/anatomy/geometry.ts`; new `src/anatomy/generator.ts`, `src/anatomy/muscles.ts`, `src/anatomy/calibration.ts`, `src/anatomy/data/manifest.json`, `src/anatomy/data/torso.json`; `src/ui/panels/anatomy.ts`, `src/core/project.ts`, `src/core/i18n.ts`; new `scripts/prepare-anatomy-data.mjs`; `scripts/fixtures/anatomy.html`; `THIRD_PARTY_LICENSES.md`.

**Implementation to deliver**

Implement only the minimum versioned state and recipe dispatch needed for left/right rectus. Prepare a real source-derived section profile with source manifest and compare reconstructed sections against it. Keep the rest of the body on its existing generator. Use a skeletal landmark frame for pubis/costal attachment regions, preserving the current chest as a neighbor. Add individual width/depth/fullness, total volume and intersection-array editing in the existing Body panel. Wire additive state to worker, history, complete A/B and project/JSON round-trip in this increment.

**Scope**

No broad registry framework, body-wide refactor, training predictor or contact solver yet. Preserve old bodies and original controls under legacy dispatch; record the reported abdomen/pectoral overlap as a fixture to inspect, not an already-proven diagnosis.

**Integration with the project**

Reuse native PBR and existing materials for unaffected structures; stable rectus identities may initially use the existing rectus material group. Use `addAnatomy` and existing panel loading. Apply units once; return ordinary `AnatomyMesh` buffers.

**Minimum verification and stopping condition**

Run the preparation script on a real selected rectus reference, generate its reconstruction, record section/volume residuals, then exercise Add → individual edit → undo/redo → A/B → ZIP reopen with JavaScript. Build must pass. Inspect front/side/cross-section low-resolution images for the specific chest/abdomen complaint. Stop when the shape change and restored state are demonstrated, without waiting for whole-body tests.

**Acceptance criteria**

- [ ] A reference-derived procedural rectus renders; source geometry is not used as its runtime replacement.
- [ ] Editing one side/intersection changes that structure and survives undo/reopen; malformed values are rejected or safely normalized.
- [ ] The source fit meets recorded targets or has an explicit unresolved limitation; no measurement is fabricated.
- [ ] Legacy appearance, surface options, materials and unrelated scene objects remain usable.

## Milestone M1 - Data reaches the existing editor

**Proves**

A measured reference is converted into procedural coefficients and consumed through a complete editor/persistence path. A schema or atlas import alone does not satisfy M1.

**Integrated verification**

One real reference, asymmetric rectus edit, altered intersection layout, source-fit report, front/side views, undo and restored `.babalon` with identical state/material settings. Record remaining visual limitations before proceeding.

### P01 - Establish stable individual structures and compatible controls

**Status:** TODO

**Objective**

Select and edit currently generated named muscles/bones independently instead of relying on rendering aggregates.

**Required reading**

- P00 state/recipe dispatch; [structures](src/anatomy/structures.ts), [catalogue](src/anatomy/catalogue.ts): existing group/material/control contracts.
- [Geometry](src/anatomy/geometry.ts): muscle names and bone fragments currently collapsed into aggregates.
- [Controller](src/anatomy/body.ts): `structureOptions`, `selectStructure`, `materialFor`, `syncNativeMaterials`, `pick`.
- [Material panel](src/ui/panels/material.ts), [UI shell](src/ui/ui.ts): selection, lazy feature and panel routing.

**Target files**

New `src/anatomy/registry.ts`; `src/anatomy/structures.ts`, `src/anatomy/catalogue.ts`, `src/anatomy/parameters.ts`, `src/anatomy/migration.ts`, `src/anatomy/contracts.ts`, `src/anatomy/geometry.ts`, `src/anatomy/body.ts`; `src/anatomy/data/manifest.json`; `src/ui/panels/anatomy.ts`, `src/ui/panels/material.ts`; `src/core/i18n.ts`.

**Implementation to deliver**

Add canonical per-side/part IDs and emit them with each generated fragment. Register currently generated structures with honest quality flags. Create sparse individual overrides and a single control descriptor model, retaining legacy group adapters. Map old aggregate materials as inheritance defaults; create individual material instances only when needed, with stable subsequent identity. Build the searchable flat structure list and contextual inspector; direct picking uses mesh metadata, not coordinate-based region guesses.

**Scope**

Do not claim new anatomical accuracy simply because an old fragment receives a name. Do not explode the scene outliner into hundreds of entities. Preserve old opacity fields as compatibility inputs.

**Integration with the project**

One body remains one entity. Visibility, selected structure, PBR access and history share the same IDs. Extend existing UI components instead of introducing a separate anatomy UI framework.

**Minimum verification and stopping condition**

Through the real panel, independently edit/isolate two previously grouped back muscles and reopen them with inherited and overridden materials. Check side linking, group edits preserving overrides and unknown IDs. Stop after IDs, selection and saved values agree across consumers.

**Acceptance criteria**

- [ ] A named back-muscle edit no longer changes every `back`-controlled muscle.
- [ ] Pick/list/Layer/Material identify the same structure; old aggregate material/visibility imports remain coherent.
- [ ] Invalid IDs cannot create arbitrary state or leak resources.

### P02 - Generate the complete individually editable skeleton

**Status:** TODO

**Objective**

Edit individual bones across the body while joint frames and muscle attachment regions follow their morphology.

**Required reading**

- P01 registry and compatibility resolution; [geometry](src/anatomy/geometry.ts): bone tube/shell construction and current landmark helpers.
- [Humanoid conventions](src/rigging/humanoid.ts), [template](src/rigging/humanoidTemplate.ts): distinguish animation joints from anatomy bones.
- [Worker](src/anatomy/anatomy.worker.ts), [controller](src/anatomy/body.ts): requested geometry and scene-coordinate conversion.

**Target files**

New `src/anatomy/bones.ts`, `src/anatomy/skeleton.ts`, `src/anatomy/data/axialSkeleton.json`, `src/anatomy/data/upperSkeleton.json`, `src/anatomy/data/lowerSkeleton.json`, `src/anatomy/data/headSkeleton.json`; `src/anatomy/registry.ts`, `src/anatomy/generator.ts`, `src/anatomy/contracts.ts`, `src/anatomy/body.ts`; `src/anatomy/data/manifest.json`; `scripts/prepare-anatomy-data.mjs`; `src/ui/panels/anatomy.ts`.

**Implementation to deliver**

Implement shaft/end, shell and irregular-patch recipes using calibrated landmarks. Expand every bone family in section 4.4 into actual identities, including fingers/toes, skull and small bones. Represent cartilage and teeth separately. Attach muscle origins/insertions through stable surface coordinates/patch IDs, so changing a femoral neck, rib or scapular contour does not leave an attachment floating. Recompute dependent rest frames and regenerate only affected regions. Expose a minimal meaningful control set for each bone, with advanced controls only when supported by its recipe.

**Scope**

Bone morphology in neutral pose first; no arbitrary free articulation of sutures or fused sacral regions. Joint-surface edits preserve compatibility through coupled defaults; advanced incompatible edits must be visibly flagged, not silently fixed by moving unrelated bones.

**Integration with the project**

Keep `humanoidTemplate.ts` unchanged for imported models. Use the anatomical skeleton as a separate data graph with a later animation mapping. New meter-space output bypasses legacy height conversion.

**Minimum verification and stopping condition**

Edit a rib, lumbar vertebra, scapula, femur and phalanx through UI; inspect dependent landmark displacement and isolated geometry. Verify finite, valid output and saved dimensions. Check a flat and irregular bone against actual source sections, not only long-bone samples.

**Acceptance criteria**

- [ ] Every in-scope bone has a ledger row, generated geometry and reachable individual controls, or remains an explicitly blocking gap for M2.
- [ ] Bone dimensions and associated attachment patches update consistently without double scaling.
- [ ] Fused/midline structures retain correct identity and motion semantics.

### P03 - Pose the procedural skeleton through the existing pose UI

**Status:** TODO

**Objective**

Enter Pose on an anatomical body, rotate constrained joints, and retain anatomy parameters and shape attachments.

**Required reading**

- P02 anatomical frames; [Poser](src/animation/pose.ts): `start`, `joints`, `begin/end`, `turnJoint`, `reset`, `applyDirections`.
- [Humanoid discovery](src/rigging/humanoid.ts): `skeletonsOf`, `jointNodes`, `humanoidOf`, `worldMatrix`; [animation](src/animation/animation.ts): held pose behavior.
- [Pose UI](src/ui/panels/pose.ts), [JointOverlay](src/ui/jointOverlay.ts), [UI shell](src/ui/ui.ts): tabs, handles and contexts.
- [Project](src/core/project.ts): generic pose capture/restore ordering.

**Target files**

New `src/anatomy/pose.ts`; `src/anatomy/skeleton.ts`, `src/anatomy/body.ts`, `src/anatomy/contracts.ts`, `src/anatomy/anatomy.worker.ts`, `src/anatomy/parameters.ts`; `src/animation/pose.ts`, `src/animation/animation.ts`; `src/rigging/humanoid.ts`; `src/ui/panels/pose.ts`, `src/ui/ui.ts`, `src/ui/jointOverlay.ts`; `src/core/project.ts`.

**Implementation to deliver**

Introduce a narrow optional anatomy pose adapter, reusing existing pose math and lifecycle. Anatomical joints expose stable transform nodes, parentage and named degrees of freedom; generic Poser continues its existing path for ordinary models. Supply a canonical humanoid subset for compatible presets, with individual anatomy controls available independently. Pose transforms bones and anchored procedural muscle paths; initial muscle deformation may be simple, but must follow its attachments. Make anatomy pose state authoritative and avoid duplicate generic/anatomy undo or project restore.

**Scope**

Basic FK and limits, reset/mirror/copy and preset mapping. Advanced coupled IK and tissue contact follow later. Keep generic manual Rigger exclusion; a generated body already owns its skeleton.

**Integration with the project**

One Pose tab and existing context bubble/overlay. Gizmos, sliders, presets and programmatic paths must all call the same adapter hooks; observing only `notify('pose')` is insufficient for live drags.

**Minimum verification and stopping condition**

Rotate shoulder/elbow, flex trunk and bend knee using actual UI handlers; inspect bone transforms and attached muscle endpoints while dragging and after commit. Undo, reset and reopen. Repeat one ordinary imported-rig pose to prove the adapter is opt-in.

**Acceptance criteria**

- [ ] Anatomy Pose works without generic binding, rest parameters stay unchanged and the display follows live edits.
- [ ] Every pose input route applies joint constraints and one coherent undo step.
- [ ] Project restore and comparison reproduce the posed anatomy; imported model posing still works.

## Milestone M2 - Editable skeleton with functioning pose

**Proves**

Individual bones, stable structure selection and existing pose interactions form one coherent procedural body. Muscle-shape quality outside completed regions remains labeled provisional.

**Integrated verification**

Asymmetric bone edit → pose → reset without losing morphology → save/reopen → compare to original. Exercise a long bone, flat bone and axial joint on desktop and phone layouts.

### P04 - Calibrate the complete trunk and shoulder musculature

**Status:** TODO

**Objective**

Correct the chest/abdomen relationship and make every trunk/back muscle individually shapeable and pose-aware.

**Required reading**

- P00 rectus recipe and measured residuals; P02/P03 frames and pose adapter.
- [Geometry](src/anatomy/geometry.ts): `pectoralSection`, `upperMuscles`, trapezius/latissimus sheets, rectus/oblique construction.
- [Materials](src/anatomy/material.ts): fiber/tissue attributes; [fat](src/anatomy/fat.ts): existing envelope approximation.
- Section 3 rectus, shoulder and reference sources; coverage matrix in section 4.4.

**Target files**

`src/anatomy/muscles.ts`, `src/anatomy/bones.ts`, `src/anatomy/skeleton.ts`, `src/anatomy/generator.ts`, `src/anatomy/registry.ts`, `src/anatomy/pose.ts`; `src/anatomy/data/torso.json`, `src/anatomy/data/shoulder.json`; `src/anatomy/data/manifest.json`; `scripts/prepare-anatomy-data.mjs`; `src/ui/panels/anatomy.ts`; `src/core/i18n.ts`.

**Implementation to deliver**

Replace only the selected legacy recipes with calibrated section/sheet/fan recipes. Split back groups into named muscles and portions, including deep regional segments. Model broad attachment areas and curved fiber domains for pectoral, latissimus, trapezius and obliques. Add rectus sheath/linea alba, intersection topology and costal/pubis relations; avoid duplicate overlapping legacy geometry. Include intercostals and diaphragm as controlled procedural sheets, plus a coarse abdominal-cavity/respiration proxy for later contact. Fiber shading follows local geometry, not a universal vertical direction.

**Scope**

All named structures in the trunk row, not only those visible through skin. Anatomical overlap in projection is allowed; unintended surface interpenetration and incorrect attachment ordering are not. No organ physiology.

**Integration with the project**

Use the same inspector, materials, worker and snapshots from previous steps. Keep group `back` as a clearly scoped macro with local overrides, not the sole data input.

**Minimum verification and stopping condition**

Compare neutral source sections, then arm elevation, scapular movement and trunk flexion/rotation. Independently edit latissimus, rhomboid and trapezius portions. Inspect low-resolution chest/abdomen side/cutaway views and numeric attachment data.

**Acceptance criteria**

- [ ] Rectus/pectoral geometry uses coherent skeletal attachments and the reported stacking defect is resolved in the reproduction fixture.
- [ ] Every trunk ledger entry is generated and editable individually, including previously fixed/grouped muscles.
- [ ] Neutral and posed shapes preserve attachment continuity and original visual-effect controls.

### P05 - Calibrate arms, forearms and hands

**Status:** TODO

**Objective**

Shape and pose each upper-limb muscle/head, including forearm and hand structures currently represented by aggregates.

**Required reading**

- P02 upper-skeleton frames; P03 adapter; P04 muscle recipe families.
- [Geometry](src/anatomy/geometry.ts): `upperMuscles`, hand internals and current limb warps.
- [Humanoid map](src/rigging/humanoid.ts), [retargeting](src/animation/retarget.ts): coarse animation map versus individual joints.
- Section 3 upper-limb volume and OpenSim references.

**Target files**

`src/anatomy/muscles.ts`, `src/anatomy/skeleton.ts`, `src/anatomy/pose.ts`, `src/anatomy/generator.ts`, `src/anatomy/registry.ts`; new `src/anatomy/data/upperLimb.json`, `src/anatomy/data/hand.json`; `src/anatomy/data/manifest.json`; `scripts/prepare-anatomy-data.mjs`; `src/ui/panels/anatomy.ts`.

**Implementation to deliver**

Implement every upper-limb coverage family as named per-side structures, separating biceps/triceps heads and individual flexor/extensor muscles and tendon branches. Fit tendon/belly transitions, noncircular sections, deltoid/rotator-cuff shape and hand intrinsic sheets. Radius and ulna move separately; forearm muscle/tendon paths follow pronation/supination. Provide meaningful local shape controls and source quality, including missing/inferred small-muscle measures.

**Scope**

No anonymous `forearmFlexors` or `forearmExtensors` aggregate counts as individual coverage. Shared tendon mechanisms may share constraints while preserving per-muscle identity. No force prediction.

**Integration with the project**

Use the same registry-driven inspector and runtime evaluator; no alternate hand editor or animation system. Keep coarse canonical hand nodes for existing clips while fine anatomical joints remain controllable.

**Minimum verification and stopping condition**

Asymmetric biceps-head edit, elbow flexion, full supported forearm rotation, wrist movement and thumb/finger flexion. Verify tendon endpoints and unaffected neighboring parameters; save/reopen the edited hand.

**Acceptance criteria**

- [ ] All named upper-limb entries are generated, independently selectable and parameterized.
- [ ] Multi-joint muscles and branched tendons follow all supported crossed joints.
- [ ] Source-fit residuals and unavailable measurements are recorded, not replaced by hidden generic meshes.

### P06 - Calibrate pelvis, thighs, legs and feet

**Status:** TODO

**Objective**

Control lower-limb muscles separately and preserve their shapes and attachments across lower-body poses.

**Required reading**

- P02 lower skeleton and P03 pose adapter; P04/P05 calibrated recipe/attachment conventions.
- [Geometry](src/anatomy/geometry.ts): `lowerMuscles`, sartorius/gluteal/calf shape adjustments and `humanVolumeFields`.
- [Existing leg regression](scripts/check-leg-junction.mjs): ordinary-rig leg/trunk behavior to preserve.
- Section 3 Ward architecture measurements and lower-limb coverage matrix.

**Target files**

`src/anatomy/muscles.ts`, `src/anatomy/skeleton.ts`, `src/anatomy/pose.ts`, `src/anatomy/generator.ts`, `src/anatomy/registry.ts`; new `src/anatomy/data/pelvis.json`, `src/anatomy/data/lowerLimb.json`, `src/anatomy/data/foot.json`; `src/anatomy/data/manifest.json`; `scripts/prepare-anatomy-data.mjs`; `src/ui/panels/anatomy.ts`.

**Implementation to deliver**

Calibrate all lower-limb entries with independent heads/muscles, including gluteus minimus, short rotators, adductors, deep calf and foot intrinsics. Add patella/patellar tendon routing, hamstring/adductor attachment patches, Achilles assembly and plantar paths. Bone version and pelvic morphology influence paths through their frames, not hard-coded world offsets. Preserve procedural thickness and regional shape controls.

**Scope**

Individual quadriceps and gastrocnemius controls replace exclusive dependence on group scale. Include foot arches and separate toe control; no gait kinetics or plantar pressure prediction.

**Integration with the project**

Reuse source-data preparation, typed recipes and existing bone/muscle inspector. Group controls remain convenient non-destructive macros.

**Minimum verification and stopping condition**

Edit vastus medialis without changing rectus femoris; perform hip flexion, deep supported knee flexion, ankle movement and toe flexion. Record patella/tendon attachment continuity, neutral source-fit metrics and round-trip state.

**Acceptance criteria**

- [ ] Every lower-limb ledger entry is generated with individual controls and correct side identity.
- [ ] Biarticular muscles respond to both joints without changing baseline volume targets.
- [ ] Foot and patella structures remain attached across supported poses.

### P07 - Complete head, neck, pelvic floor and small/deep coverage

**Status:** TODO

**Objective**

Close whole-body coverage gaps with working procedural structures and controls rather than a major-muscles-only completion claim.

**Required reading**

- P02 cranial/hyoid/axial frames; P04–P06 common fitting, attachment and local sheet recipes.
- [Existing reference](src/anatomy/reference.json), [geometry](src/anatomy/geometry.ts): current head surface and SCM approximation.
- Registry `src/anatomy/registry.ts` (delivered by P01) and data manifest `src/anatomy/data/manifest.json` (delivered by P00): coverage and source quality; these are future files, not existing baseline references.
- Section 4.4 head/neck/pelvic-floor inventory and exclusions.

**Target files**

`src/anatomy/muscles.ts`, `src/anatomy/bones.ts`, `src/anatomy/skeleton.ts`, `src/anatomy/pose.ts`, `src/anatomy/generator.ts`, `src/anatomy/registry.ts`, `src/anatomy/envelope.ts`; new `src/anatomy/data/headNeck.json`, `src/anatomy/data/pelvicFloor.json`, `src/anatomy/data/smallStructures.json`; `src/anatomy/data/manifest.json`; `scripts/prepare-anatomy-data.mjs`; `src/ui/panels/anatomy.ts`; `src/core/i18n.ts`.

**Implementation to deliver**

Expand the ledger to all included named structures, including minor/deep subdivisions and anatomical variants. Implement face-to-skin attachment patches (not every muscle inserts on a bone), jaw translation/rotation, hyoid and supported small-structure motions, and local procedural deformation for expressions. Add pelvic-floor/perineal reference profiles with explicit applicable anatomy. Small ocular/tongue/laryngeal groups receive shape controls and only the pose degrees supported by their data; unsupported physiology remains excluded.

**Scope**

This is a substantial regional delivery, not a one-day cleanup step. If reference coverage is missing, retain a blocking ledger gap and continue independent regions; do not mark M3 complete. Do not invent population distributions or label a guessed shape measured.

**Integration with the project**

Same body entity, inspector and native material pipeline. Detail packs may load on demand, with deterministic documented procedural fallbacks and saved pack versions.

**Minimum verification and stopping condition**

Pose neck/jaw, create an asymmetric expression, edit a deep neck muscle and pelvic-floor structure, then reopen. Check all in-scope ledger rows against real generation output, including small bones/muscles and variant state.

**Acceptance criteria**

- [ ] Whole-body coverage has no anonymous aggregate standing in for required individual structures.
- [ ] Soft-tissue insertions move coherently and missing evidence is visibly differentiated.
- [ ] No unsupported hearing/vision/speech/clinical behavior is claimed.

## Milestone M3 - Whole-body procedural anatomy

**Proves**

Every in-scope anatomical structure has a canonical identity, working procedural recipe, meaningful individual controls and declared reference quality across the whole body.

**Integrated verification**

Generated IDs versus expanded ledger with no unexplained omissions; representative fitted shape per recipe family and region; asymmetric edits saved and restored; independent back-muscle and small-structure edits. Source provenance, not an arbitrary total muscle count, defines coverage.

### P08 - Make development a calibrated regional volume operation

**Status:** TODO

**Objective**

Grow any muscle/head independently while controlling where its added volume appears, without corrupting its identity or attachment layout.

**Required reading**

- P00 volume control and P04–P07 recipe families.
- [Legacy volume fields](src/anatomy/geometry.ts): `humanVolumeFields`, `humanVolumeStep`; [profiles](src/anatomy/catalogue.json): original scales/mixing.
- Section 3 regional hypertrophy studies and section 4.3 control meanings.

**Target files**

`src/anatomy/muscles.ts`, `src/anatomy/generator.ts`, `src/anatomy/parameters.ts`, `src/anatomy/body.ts`, `src/anatomy/calibration.ts`; `src/anatomy/data/torso.json`, `src/anatomy/data/shoulder.json`, `src/anatomy/data/upperLimb.json`, `src/anatomy/data/hand.json`, `src/anatomy/data/pelvis.json`, `src/anatomy/data/lowerLimb.json`, `src/anatomy/data/foot.json`, `src/anatomy/data/headNeck.json`, `src/anatomy/data/pelvicFloor.json`, `src/anatomy/data/smallStructures.json`; `src/ui/panels/anatomy.ts`; `src/core/i18n.ts`; focused numerical cases in `scripts/check-anatomy.mjs`.

**Implementation to deliver**

Compute baseline reference volume per muscle/head; solve section/sheet thickness scales for a target volume ratio. Add normalized longitudinal or sheet-local distribution profiles and head balance. Integrate numerical volume after taper and tendon exclusions; define tendon contribution separately. Use measured regional patterns only as labeled reference presets, not a training forecast. Existing volume/group sliders map into the same operation. Growing muscle updates the eventual covering envelope instead of fighting a fixed skin cage.

**Scope**

Identity, attachment regions and tendon-intersection layout remain baseline anatomy unless explicitly edited. Do not automatically alter bone lengths, create new abdominal segments or grow fat with muscle volume.

**Integration with the project**

Use the same history and profile-scope rules. Deterministic resolution order prevents development gains from being applied twice after reload or pose changes.

**Minimum verification and stopping condition**

Target 1.0×, 1.25× and 1.5× volume on one spindle, fan, sheet and multi-head muscle. Require generated closed/sectional volume within 2% of the requested development target. Change distribution while keeping total target fixed; reopen and compare.

**Acceptance criteria**

- [ ] All muscle recipes obey the documented volume/distribution contract, including per-head edits.
- [ ] Regional edits preserve total target within the design tolerance and do not move attachments.
- [ ] Development and activation yield different saved inputs and observable behavior.

### P09 - Add anatomically coupled full-body posing and IK

**Status:** TODO

**Objective**

Use named joint motions and end-effector posing across the body while respecting supported anatomy and coupled movement.

**Required reading**

- P03 adapter and P02 individual anatomical frames.
- [Pose math](src/animation/pose.ts): `solveTwoBone`, `rotateJointWorld`, `mirrorPose`, `symmetrize`; [retarget](src/animation/retarget.ts): incoming animation transforms.
- [Pose UI](src/ui/panels/pose.ts), [presets](src/core/presets.ts): existing entrypoints.
- Section 3 shoulder model/OpenSim routes and source-specific joint conventions.

**Target files**

`src/anatomy/skeleton.ts`, `src/anatomy/pose.ts`, `src/anatomy/body.ts`; joint definitions within `src/anatomy/data/axialSkeleton.json`, `src/anatomy/data/upperSkeleton.json`, `src/anatomy/data/lowerSkeleton.json`, `src/anatomy/data/headSkeleton.json`; `src/animation/pose.ts`, `src/animation/retarget.ts`; `src/ui/panels/pose.ts`; `src/ui/shared.ts`; `src/core/i18n.ts`.

**Implementation to deliver**

Add shoulder girdle/clavicle/scapular gliding on the rib cage; humeral elevation/rotation; elbow and radius/ulna pronation; wrist and individual digit/thumb motions; distributed spine and neck motion; hip; knee/patellar coupling; ankle/subtalar/foot/toes; jaw and supported head detail. Parameterize source-specific coupled limits rather than a universal Euler box. Reuse two-bone IK for limbs and add bounded regional solves only where needed. Include root/pelvis placement, pole controls, hand/foot targets, side copy/mirror and optional contact locks. Bound unreachable targets and show the result without numerical failure.

**Scope**

All supported joint degrees are accessible, including fine joints; not every arbitrary angle combination is anatomically possible. No universal ROM values without source/provenance. Existing animation clips map to anatomy then pass through the same constraints; do not bypass the system.

**Integration with the project**

Keep ordinary imported-rig FK/IK unchanged. Pose adapters receive live gizmo, slider, preset, animation and restore updates. Contact locks are local authoring constraints, not dynamics simulation.

**Minimum verification and stopping condition**

Arm overhead, forearm turn, fist/thumb opposition, trunk twist, supported squat, foot inversion/eversion and jaw opening. Check limits, unreachable IK, mirror involution and preset/clip entrypoints. One saved pose restores identical anatomical transforms.

**Acceptance criteria**

- [ ] All in-scope joints expose meaningful motion controls and coupled constraints through the same UI.
- [ ] Scapula, radius/ulna, patella, fine fingers/toes and distributed spine are not reduced to a single generic hinge.
- [ ] Unsupported targets fail gracefully and do not mutate rest morphology.

### P10 - Deform muscles by length, activation and tendon routing

**Status:** TODO

**Objective**

Show plausible shape changes under pose and independent muscle activation while preserving attachments and approximately preserving muscle volume.

**Required reading**

- P08 volume targets and P09 full joint/path inputs.
- [Worker/controller](src/anatomy/anatomy.worker.ts), [body](src/anatomy/body.ts): cancellation and geometry application.
- [Material fibers](src/anatomy/material.ts): update direction attributes after deformation.
- Section 3 OpenSim wrapping reference; do not confuse line-of-action parameters with a volumetric surface.

**Target files**

`src/anatomy/muscles.ts`, `src/anatomy/pose.ts`, `src/anatomy/skeleton.ts`, `src/anatomy/generator.ts`, `src/anatomy/contracts.ts`, `src/anatomy/body.ts`; new `src/anatomy/mechanics.ts` as needed; tendon/wrapping definitions within `src/anatomy/data/torso.json`, `src/anatomy/data/shoulder.json`, `src/anatomy/data/upperLimb.json`, `src/anatomy/data/hand.json`, `src/anatomy/data/pelvis.json`, `src/anatomy/data/lowerLimb.json`, `src/anatomy/data/foot.json`, `src/anatomy/data/headNeck.json`, `src/anatomy/data/pelvicFloor.json`, `src/anatomy/data/smallStructures.json`; `src/ui/panels/anatomy.ts`, `src/ui/panels/pose.ts`; `src/core/i18n.ts`.

**Implementation to deliver**

Re-evaluate bone/soft-tissue attachment patches and curved via/wrapping paths for posed frames. Transport section frames without sudden flips; bulge/taper as path length changes using P08's volume target. Model passive length response separately from user activation and optional co-contraction. Preserve multi-head and multi-joint relationships, tendon slack/reference lengths and rectus inscription continuity. Use bounded constraints and source-labeled approximations, not a claimed physiological force simulator.

**Scope**

No maximum-force, strength or training-effect readout inferred from appearance. Arbitrary fixed bulge tied only to one joint angle is insufficient for a multi-joint muscle.

**Integration with the project**

Update only affected regions and preserve buffer/material identity when topology is unchanged. Activation changes and settled pose trigger bounded recomputation; rest scenes do not loop continuously.

**Minimum verification and stopping condition**

At the same elbow pose compare relaxed/activated biceps; compare hamstring length across hip/knee combinations and pectoral shape across arm elevation. Initial settled-pose target: volume deviation ≤5% from development target for the selected representative muscles, with attachment error ≤1 mm at standard adult scale. These are engineering tolerances, not clinical validation.

**Acceptance criteria**

- [ ] Independent activation changes shape at fixed pose; pose changes shape without rewriting development state.
- [ ] Wrapped paths do not jump through bones or flip frames across supported motion sweeps.
- [ ] Documented volume/attachment tolerances pass or the affected range remains explicitly unsupported.

## Milestone M4 - Development and pose remain distinct

**Proves**

The same individually shaped body can grow a muscle, pose it and activate it with different, reproducible effects.

**Integrated verification**

One edited trunk/shoulder plus upper/lower limb: baseline → regional development → pose → activation → undo/reopen. Capture target/generated volume, attachment distance, path continuity and representative low-resolution visuals.

### P11 - Make covering tissues and neighboring muscles interact

**Status:** TODO

**Objective**

Prevent demonstrated tissue penetration and implausible gaps in supported poses while skin/fat follow the edited underlying anatomy.

**Required reading**

- P04 cavity/sheath relationships, P08 target volume and P10 muscle deformation.
- [Fat envelope](src/anatomy/fat.ts), [legacy fitting](src/anatomy/geometry.ts): `fitHumanLayers`, current reference-surface warps.
- [Render lifecycle](src/core/editor.ts), [controller](src/anatomy/body.ts): invalidation, cleanup and activity versus persistent change.

**Target files**

`src/anatomy/mechanics.ts`, `src/anatomy/envelope.ts`, `src/anatomy/fat.ts`, `src/anatomy/generator.ts`, `src/anatomy/pose.ts`, `src/anatomy/body.ts`, `src/anatomy/contracts.ts`, `src/anatomy/anatomy.worker.ts`; new `src/anatomy/data/contacts.json` for explicit tissue-neighbor, sliding and tethering pairs; `src/anatomy/parameters.ts`; `src/ui/panels/anatomy.ts`; `src/core/i18n.ts`.

**Implementation to deliver**

Use coarse local collision proxies for bones, neighboring muscle volumes, major fascia and cavity occupancy. Solve only active/affected neighborhoods with bounded iterations; permit tangential sliding where data allows and preserve anchored/tethered regions. Correct demonstrated chest/abdomen, axilla, elbow, groin, knee and palm/sole cases. Derive muscle-driven outer displacement, then regional fat coverage and skin response using the existing authored surface as a deformable topology/detail source. Add skin folds/compression and fat redistribution conservatively; keep major layer boundaries ordered. Hidden structures still participate. Add optional enhanced contact quality only if needed; default must keep image quality and report unhandled ranges.

**Scope**

No full-body FEM or unconditional all-pairs collision. Avoid claiming arbitrary extreme poses cannot intersect. Small/deep structures can use shared regional proxies with explicit quality, not disappear from physical dependencies.

**Integration with the project**

Mechanical thickness/laxity controls live with tissues, PBR stays in Material. Cache proxy topology and resting envelopes. Use a quick bounded update during drag and settle once at completion; no perpetual background activity.

**Minimum verification and stopping condition**

Sweep the demonstrated problem poses at baseline and enlarged muscle volumes with thin/thick fat coverage. Log worst contact penetration and layer ordering at selected anchors/sections; initial proxy-contact target ≤2 mm after settle for declared tested pairs. Review low-resolution cutaways for cases numerical proxies miss. Compare timings and allocations to the pre-step baseline on the same machine; record device limits honestly.

**Acceptance criteria**

- [ ] Tested tissue pairs stay in declared order/contact tolerance without losing muscle volume beyond P10's budget.
- [ ] Skin silhouette follows individual growth and pose; hidden tissue visibility does not alter mechanics.
- [ ] Solver terminates, stale jobs cannot apply and failed contact retains last valid geometry with a recoverable message.

### P12 - Complete the unified anatomy and pose UX

**Status:** TODO

**Objective**

Make the complete control set understandable and reachable without abandoning the established babalon interface.

**Required reading**

- Section 4.5 UI contract and P01 inspector foundation.
- [DOM components](src/ui/dom.ts), [UI shell](src/ui/ui.ts): lazy panels, contexts and `quiet/run` ownership.
- [Anatomy panel](src/ui/panels/anatomy.ts), [Material](src/ui/panels/material.ts), [Pose](src/ui/panels/pose.ts), [Light](src/ui/panels/light.ts): preserve existing ownership.
- [Styles](src/ui/style.css), [translations](src/core/i18n.ts): theme, phone layout and hiding behavior.

**Target files**

`src/ui/panels/anatomy.ts`, `src/ui/panels/material.ts`, `src/ui/panels/pose.ts`; `src/ui/ui.ts`, `src/ui/contextBar.ts`, `src/ui/style.css`; `src/core/i18n.ts`; `src/anatomy/registry.ts`, `src/anatomy/catalogue.ts`, `src/anatomy/body.ts`; `docs/anatomy.md`.

**Implementation to deliver**

Finish tissue → region → flat structure navigation with search/breadcrumb and direct 3D selection. Reuse the inspector introduced in P01, adding context-specific anatomy/development/activation, coupled-joint controls and tissue mechanics. Distinguish group macros, inherited values and individual overrides. Preserve all original actions/effects via explicit scopes. Show simple evidence/quality information in advanced details, with clear unsupported-control states. Structure lists and expensive details render lazily; keep selection during regeneration and input focus during slider drags.

**Scope**

No nested menu tree, duplicate material controls, new top-level mode or floating anatomy toolbar. Do not bury individual back/deep-muscle controls behind unrelated skin controls.

**Integration with the project**

Use existing contexts and `JointOverlay`; H hides all new UI. Scene-object transforms stay accessible on Object; local bone dimensions do not masquerade as object scale.

**Minimum verification and stopping condition**

On desktop and 375×812, perform Bones → left rib → edit; Muscles → back → left latissimus → development; Pose → shoulder; Material → selected muscle. Check search including translated names, keyboard focus, ≥36 px controls, no page overflow and no value change while scrolling. Use runtime JSON for behavior and reduced screenshots for layout.

**Acceptance criteria**

- [ ] Every implemented control and original option is reachable with clear scope and no duplicate conflicting owner.
- [ ] A user can independently edit a bone and a deep back muscle, pose and change material through the established shell.
- [ ] Phone, keyboard, hide-UI and continuous-slider behavior remain usable.

## Milestone M5 - A coherent editable body

**Proves**

Anatomy, development, pose, interacting tissues and materials work together through a comprehensible single-body UI.

**Integrated verification**

One desktop and one phone-layout scenario spanning individual bone/muscle edits, regional growth, activation, pose, contact, tissue isolation, standard material editing, undo and reopen. Use source-fit/volume/contact logs plus targeted visual review, not screenshot-only assertions.

### P13 - Preserve complete projects and export useful posed results

**Status:** TODO

**Objective**

Make full-body state portable and reproducible across JSON, project ZIP, autosave, duplication, comparisons and static geometry export.

**Required reading**

- P00 additive persistence and section 4.2 version/ownership rules.
- [Project](src/core/project.ts): `snapshot/restore`, anatomy branch, native texture files; [archive](src/core/projectArchive.ts): worker ZIP ownership.
- [Controller](src/anatomy/body.ts): import/export, `captureState`, duplication and A/B; [editor export](src/core/editor.ts): `exportGLB`.
- [Compact export](src/optimize/export.ts), [PWA config](vite.config.ts): geometry/material export and asset caching boundaries.

**Target files**

`src/anatomy/parameters.ts`, `src/anatomy/migration.ts`, `src/anatomy/body.ts`, `src/anatomy/calibration.ts`; `src/core/project.ts`, `src/core/editor.ts`; `src/optimize/export.ts` only if required by actual output; `vite.config.ts`; `scripts/fixtures/anatomy.html`; `docs/anatomy.md`; `THIRD_PARTY_LICENSES.md`.

**Implementation to deliver**

Complete and harden persistence already wired per increment: deterministic resolved state, pack versions, custom coefficients if user-authored, per-structure materials/textures, pose/activation, variants and complete references. Keep original legacy generators available so old files remain reproducible. Explain missing pack/version and offer explicit compatible fallback without silently changing the saved source. Export the settled posed anatomy as static GLB with native PBR/material textures and meaningful names. Retain parameter editing in `.babalon`; do not claim static GLB contains the procedural/contact engine. Preserve optional procedural shader-effect limitations already documented.

**Scope**

Editable physics/parameter export to third-party applications and full skinned-animation baking are not requirements of this static export increment. Do not regress existing imported-model rig/animation exports.

**Integration with the project**

Cache unchanged generated/file data; do not embed large source datasets. Public assets use `BASE_URL`, feature/pack loads stay opt-in and no full atlas is precached. Do not disturb unrelated native AR/splat work in shared editor code.

**Minimum verification and stopping condition**

Round-trip a legacy body, a fully edited new body, two independent duplicates and A/B through parameter JSON and `.babalon`; resume autosave in a new page. Reimport static GLB and inspect pose/geometry/materials/textures. Simulate a missing calibration pack and confirm recoverable behavior. Production preview uses a non-root base path.

**Acceptance criteria**

- [ ] New state survives every supported persistence path without double applying growth or pose; originals remain unchanged during upgrade.
- [ ] Legacy bodies/materials still load; unknown future data is not silently normalized into a different anatomy.
- [ ] Static GLB preserves the settled visible result within documented shader limitations; procedural editing remains in the project.

### P14 - Close focused regressions and document supported limits

**Status:** TODO

**Objective**

Ship the integrated behavior with reproducible evidence, accurate coverage and recoverable failures.

**Required reading**

- [Numerical check](scripts/check-anatomy.mjs), [browser script](scripts/check-anatomy-browser.mjs), [fixture](scripts/fixtures/anatomy.html): extend the existing execution path.
- [AGENTS verification rules](AGENTS.md), [anatomy docs](docs/anatomy.md): mandatory build, cache/archive checks and actual device limits.
- P00–P13 evidence and outstanding ledger/fit/contact gaps.

**Target files**

`scripts/check-anatomy.mjs`, `scripts/check-anatomy-browser.mjs`, `scripts/fixtures/anatomy.html`; proposed `scripts/check-anatomy-deformation.mjs` only if the existing numerical check becomes unwieldy; `docs/anatomy.md`; `anatomical_generator_evolution_implementation_plan.md`.

**Implementation to deliver**

Add focused cases for demonstrated regressions: shared-control leakage, legacy migration, unit conversion, attachment drift, lost material identity, volume normalization, stale pose jobs, hidden-layer mechanics, comparison-state loss and project switch/disposal. Separate legacy fixed-count/reference-vertex assertions from new-generator coverage checks. Provide compact structured evidence with source/calibration versions, error metrics and runtime/network errors. Fix any actual failures in owning source files rather than weakening assertions. Document unsupported ranges, inferred data, static-export limits and physical-device checks still pending.

**Scope**

No new test framework, mock-heavy coverage program, exhaustive physiology validation or unrelated refactor. Build/peripheral checks alone cannot substitute for the real body-edit/pose path.

**Integration with the project**

Reuse existing Playwright launch, environment hooks and low-resolution capture. Keep debug assets outside the repository or remove them; never recursively delete unchecked paths.

**Minimum verification and stopping condition**

Run the final integrated scenario in section 7, required applicable project checks and one production smoke. Stop when acceptance is met and outstanding device/evidence limits are accurately recorded; rerun only affected checks after a new change/failure.

**Acceptance criteria**

- [ ] End-to-end behavior passes on actual worker/Babylon/UI/project paths with no uncaught runtime errors.
- [ ] Coverage, fit, volume and contact claims match recorded evidence; no region is marked complete while required structures are absent.
- [ ] Temporary artifacts are removed and unrelated local work remains intact.

## Milestone M6 - Reproducible delivery

**Proves**

The parameterized body can be independently edited, posed, inspected, saved/reopened and exported with stable compatibility and explicit evidence limits.

**Integrated verification**

Run section 7 against the production build as well as the development entrypoint. Store compact evidence or commit references in the tracking table; do not equate this milestone with deployment.

## 6. Decisions, dependencies and approval boundaries

Resolved planning choices: retain the current procedural generator and its appearance options; use source-derived coefficients rather than imported final muscle meshes; use sparse individual overrides; distinguish anatomical bones from animation joints; use a hybrid bounded kinematic/contact model; preserve legacy output by generator version; keep anatomy inside the existing scene/UI architecture.

The user has authorized planning only. **The single immediate human gate is a later request to implement this plan.** No routine per-step approval is required once implementation is authorized. Do not infer commit, push, merge or deployment authorization from plan approval. Existing user approvals for earlier materials work do not authorize those new effects.

Material dependencies and how to handle them:

| Dependency / uncertainty | Resolution during implementation | What can continue independently |
|---|---|---|
| Exact per-structure source correspondence/availability | Expand and validate the manifest during the owning regional delivery; mark missing anatomy as an unresolved coverage gap | Regions with audited reference inputs; parameter/UI/runtime support |
| Asset-specific redistribution terms | Record source/version/hash and applicable attribution before shipping coefficients or samples. Exclude incompatible assets by default; seek a user decision only if the requested asset cannot be replaced | Procedural recipes, local private calibration and other compatible data |
| Sparse population/architecture evidence | Use explicitly inferred/artistic defaults and conservative ranges; do not create fake covariance/genetic claims | Shape fitting, individual manual controls and measured regions |
| Mobile contact quality/performance | Measure the actual bounded solver on stated hardware; expose optional higher-cost settings without lowering default image resolution | Static/reference geometry, FK, editing and desktop verification |
| Source fit fails the declared budget | Improve the relevant procedural recipe or retain an explicit unsupported case; do not claim validated anatomy | Other recipe families/regions |
| Future paid datasets, external publishing or destructive format conversion | Not required by this plan. Present the specific concrete effect for approval if it later becomes necessary | Authorized source implementation and local verification |

No secret, API key, paid service, remote write or production database is needed. Full biomechanical validation would require additional empirical work and is not implied by visually plausible interaction.

## 7. Final integrated validation

Use the actual app through `window.editor` and DOM handlers with Playwright/JavaScript; collect concise JSON and console/network errors. Preserve old checks as legacy fixtures. Required implementation build: `npm run build`.

Minimum scenario:

1. Open a legacy anatomy project; verify its legacy geometry mode, parameters, materials and original options. Upgrade a duplicate and confirm the original is unchanged.
2. Create a new calibrated body. Change one rib and one femur, independently edit left latissimus and one quadriceps component, and change rectus intersections asymmetrically. Confirm dependent attachment frames and unaffected individual overrides.
3. Apply regional muscle development, then a pose spanning shoulder/scapula, elbow/forearm, trunk, hip/knee and foot. Test a hand and head/jaw detail. Apply activation at a fixed pose and verify a distinct effect.
4. Inspect skin/fat/muscle/bone/connective layers, including hidden-structure mechanics; measure declared target volume, landmark error, path continuity and demonstrated contact pairs. Review reduced-resolution neutral/posed front/side/cutaway images.
5. Change a standard PBR preset and texture on one structure; regenerate, undo/redo, save complete comparison A, edit B and switch repeatedly. Materials, pose and local overrides remain independent.
6. Duplicate, save/reopen `.babalon`, import/export parameter JSON and resume autosave. Confirm full authoritative-state equality and deterministic generator/calibration resolution. Export/reimport static GLB and inspect native materials/visible posed geometry.
7. Remove/reset/switch projects while a pose or morphology job is running; old results must not resurrect a body or overwrite a newer state. Retry one malformed/missing calibration case without losing last valid geometry.
8. Repeat the critical UI path at 1280×900 and 375×812. Check overflow, focus, scroll-safe sliders, reachable individual controls, hide-UI and no console/network errors. Actual touch/gizmo gestures and physical Android/AR remain separately labeled device checks.

Run the repository's applicable existing checks after the final build: `node scripts/check-anatomy.mjs`, JavaScript anatomy browser check against a fresh dev port, `node scripts/check-lazy-cache.mjs`, `node scripts/check-project-archive.mjs`, `node scripts/check-offline-install.mjs`, `node scripts/check-surface-brushes.mjs`. If generic pose/rig integration changed, run the existing leg-junction, helper-bones, skin-treatment and skin-visibility checks and an ordinary imported-rig pose/export smoke. Use `scripts/check-anatomy-browser.mjs <preview-url> --production` for compiled worker/material integration, extending it for the new generator as needed.

Inspect startup/feature asset boundaries and cache behavior when data packs change. Record generation time, affected-region update time and memory on the same test hardware before/after; do not invent a universal FPS promise. No broad extra testing is required once the selected end-to-end cases and applicable regressions pass. Record remaining physical-device/empirical validation separately from code completion.

## 8. Execution tracking

Status vocabulary: `TODO`, `IN PROGRESS`, `VERIFIED`, `APPROVED`, `BLOCKED`. `VERIFIED` means the step's behavior was implemented and checked, not that its dependencies were merely inspected. `APPROVED` is used only for an actual required human gate. All future implementation steps remain TODO at plan delivery.

| Step | Status | Evidence / commit | Human approval | Notes |
|---|---|---|---|---|
| P00 | TODO | | Implementation request pending | Real data → procedural rectus → UI → persistence; M1 |
| P01 | TODO | | No separate gate after authorization | Canonical individual structures and inspector |
| P02 | TODO | | No separate gate after authorization | Full skeletal morphology and attachments |
| P03 | TODO | | No separate gate after authorization | Existing pose integration; M2 |
| P04 | TODO | | No separate gate after authorization | Trunk, complete back, shoulder and abdomen correction |
| P05 | TODO | | No separate gate after authorization | Arms, forearms and hands |
| P06 | TODO | | No separate gate after authorization | Pelvis, legs and feet |
| P07 | TODO | | No separate gate after authorization | Head/neck, pelvic floor, small/deep coverage; M3 |
| P08 | TODO | | No separate gate after authorization | Whole-body regional development |
| P09 | TODO | | No separate gate after authorization | Coupled joint motions and IK |
| P10 | TODO | | No separate gate after authorization | Muscle deformation and activation; M4 |
| P11 | TODO | | No separate gate after authorization | Local contact and tissue envelope |
| P12 | TODO | | No separate gate after authorization | Unified complete UI; M5 |
| P13 | TODO | | No separate gate after authorization | Full compatibility, persistence and static export |
| P14 | TODO | | No separate gate after authorization | Integrated regressions and supported limits; M6 |
