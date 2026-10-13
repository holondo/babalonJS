# Third-party assets

babalon JS is free software (GPL-3.0-or-later). Every third-party file bundled with it is listed here with its source and license. Only CC0 or GPL-compatible assets are accepted.

| Files | Source | Author | License |
| --- | --- | --- | --- |
| `public/animations/*.glb` (43 clips) | [Universal Animation Library (Standard)](https://opengameart.org/content/universal-animation-library) — [pack page](https://quaternius.com/packs/universalanimationlibrary.html) | Quaternius | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/models/mannequin.glb` | Same pack (Mannequin model with its rig and the `Idle_Loop` clip) | Quaternius | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/models/mannequin-static.glb` | Same pack (Mannequin mesh without its rig, to try rigging) | Quaternius | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |

The files are generated from `AnimationLibrary_Godot_Standard.glb` in the pack by `scripts/build-animation-library.mjs` (clips split into one file each, constant channels and redundant keys removed). See `docs/animation_sources.md` for details.

The other sample models in the app are loaded from `assets.babylonjs.com` when the user picks them; they are not bundled.

Geometry triangulation uses [Earcut](https://github.com/mapbox/earcut), Copyright Mapbox, under the ISC license.

Optional solid fusion uses [Manifold](https://github.com/elalish/manifold), under the Apache-2.0 license. Its WASM module is cached on first use.
