# Anatomy materials and UX — approved direction

The user approved the scene-object hierarchy and delegated the material choice on 2026-10-29, requiring separate bones, muscles, fat and other anatomical structures. Work remains on codex/anatomy-materials-ux; no commits, subagents or Computer/Browser Use.

## Decisions and arguments
Use native Babylon PBRMaterial with an optional procedural-detail plugin. This reuses the existing material UI, presets, image textures, scene lighting, undo and glTF material export. Anatomical detail changes albedo/microstructure without replacing the PBR lighting model. Exact pixels of the original independent renderer are not a compatibility requirement; the existing anatomical controls and effects remain available. Store one stable material per anatomical structure, reuse it during regeneration, and save its complete native material state and textures.

Keep a single scene object with named anatomical structures. The Layers panel groups Skin, Fat, Muscles, Bones and Connective tissue; each structure has independent visibility, opacity, isolation and Material access. Fat is a generated subcutaneous envelope rather than a synonym for skin deformation.

Replace ambiguous inguinal “V” names with inguinal groove, fold, curvature and relief. Old field names are accepted only by the versioned parameter import/migration boundary. UI and current code use canonical anatomical names.

## Execution
- [x] P1: rename canonical parameters and migrate old JSON/project fields; generate a real fat envelope and group the anatomical structures.
- [x] P2: stable native PBR materials, procedural details, regenerated geometry preserving material edits, textures and snapshot/restore; actual browser MVP.
- [x] P3: Object / Body / Layers / Material hierarchy, selected structure material controls, scene Light panel; retain original studio settings as optional study illumination.
- [x] P4: real JavaScript-driven browser tests and logs for behavior; low-resolution screenshots only for visual checks. Build, anatomy, archive, cache and offline regressions. Remove temporary artifacts.

## Acceptance
Material presets/color/metalness/roughness/textures work through the existing Material panel; geometry changes and undo/redo preserve them. Bones, muscles, fat, skin, aponeuroses and ligaments can be inspected independently. Older anatomy projects and original JSON open. New inguinal names are meaningful. Desktop and 375x812 layouts have no page overflow. Physical touch/AR remain device checks.

## Evidence

`npm run build`, numerical anatomy/fat checks, cache boundaries, project archive, installed offline and surface-brush regressions passed. JavaScript-only Chrome checks passed at 1280x900 and 375x812 with zero runtime/network errors. They exercised native Gold and roughness controls, stable materials across regeneration, images/UVs, material and texture restoration, GLB PBR/textures, fat isolation, ten structures, old names and reference behavior. The production preview passed the compiled worker/PBR/fat smoke at both resolutions. Low-resolution JPEGs were reviewed outside the repository.

The texture test reproduced revoked-blob URL errors during copying/export. Texture source URLs now live until scene cleanup, and the same browser checks passed with no failed requests after the fix. Legacy normalization now preserves incoming in-range values rather than rounding them, matching original default/import behavior.

No commits, pushes, subagents or Computer/Browser Use tools were used. Existing unrelated local work is preserved.
