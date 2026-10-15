# Third-party assets

babalon JS is free software (GPL-3.0-or-later). Every third-party file bundled with it is listed here with its source and license. Only CC0 or GPL-compatible assets are accepted.

| Files | Source | Author | License |
| --- | --- | --- | --- |
| `public/animations/*.glb` (43 clips) | [Universal Animation Library (Standard)](https://opengameart.org/content/universal-animation-library) — [pack page](https://quaternius.com/packs/universalanimationlibrary.html) | Quaternius | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/models/mannequin.glb` | Same pack (Mannequin model with its rig and the `Idle_Loop` clip) | Quaternius | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/models/mannequin-static.glb` | Same pack (Mannequin mesh without its rig, to try rigging) | Quaternius | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/environments/studio.env` | [Babylon.js Assets](https://assets.babylonjs.com/environments/studio.env) | Babylon.js Team / Contributors | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `public/environments/neutral.env` | [Babylon.js Assets](https://assets.babylonjs.com/environments/environmentSpecular.env) (orig: `environmentSpecular.env`) | Babylon.js Team / Contributors | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `public/environments/room.env` | [Babylon.js Assets](https://assets.babylonjs.com/textures/room.env) | Babylon.js Team / Contributors | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `public/environments/country.env` | [Babylon.js Assets](https://assets.babylonjs.com/textures/country.env) | Babylon.js Team / Contributors | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `public/environments/parking.env` | [Babylon.js Assets](https://assets.babylonjs.com/textures/parking.env) | Babylon.js Team / Contributors | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `public/environments/night.env` | [Babylon.js Assets](https://assets.babylonjs.com/textures/night.env) | Babylon.js Team / Contributors | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |

The animation files are generated from `AnimationLibrary_Godot_Standard.glb` in the pack by `scripts/build-animation-library.mjs` (clips split into one file each, constant channels and redundant keys removed). See `docs/animation_sources.md` for details.

The six bundled `.env` prefiltered environment cubemaps are distributed for offline and native use. Their SHA-256 hashes are:
- `studio.env`: `88639560e8e444eea5ebb15f0f97896f549f469f90afd6839f6ac9f67a40c9e1`
- `neutral.env`: `ca3e30921265d084d46c62c5220217d99296c0c3eacaeb40ca15f7534dfdd8bc` (renamed from `environmentSpecular.env`)
- `room.env`: `a6c7d8c013503933536170fdb5b86378494e858a92409adc1274d266e718465f`
- `country.env`: `ab3f5f0fb7b5a47eccabcaef96f5469856de5eeff0d1722faae0477ce8d78e2f`
- `parking.env`: `a24341e53b73f049fead307f6f5abd32b97e8f0bc767b41cdc3c50ba162d99f6`
- `night.env`: `729c7e90f43833f57581e6cffa7a8b6a75b30b284f9a717539dc4802f759f9a6`

Other sample models in the app are loaded from `assets.babylonjs.com` when the user picks them; they are not bundled.

Geometry triangulation uses [Earcut](https://github.com/mapbox/earcut), Copyright Mapbox, under the ISC license.

Optional solid fusion uses [Manifold](https://github.com/elalish/manifold), under the Apache-2.0 license. Its WASM module is cached on first use.
