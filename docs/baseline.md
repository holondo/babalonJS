# Baseline — 2026-10-11

Reference: c959902, before roadmap implementation. Windows desktop, installed dependencies, Vite production build.

| Measurement | Result |
| --- | --- |
| Main JavaScript | 5,697.14 kB (1,241.44 kB gzip) |
| PWA precache | 382 entries, 10,568.13 KiB |
| Vite build | 11.77 s (excludes later PWA callbacks) |
| Headless Edge startup smoke | Editor created, 8 initial meshes, no page exception |
| S24 cold/cached first frame | Pending physical device measurement |
| S24 heavy-model FPS / memory / 100 MB glTF survival | Pending representative model and physical device |

Desktop/headless timings are not a substitute for phone measurements. No resolution or quality reductions were applied. Run the published build cold and cached on the S24, orbit the same heavy model, and record its source, size and triangle count when collecting device results.
