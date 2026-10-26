# AR Gaussian LOD and resolution

## Accepted scope

Implement a temporary spatial Gaussian hierarchy, a shared active-splat cap and XR
layer resolution controls. Start with the fastest exposed settings. Preserve the
source/project and restore editor state on exit. Work in the main agent and verify
with real input in JavaScript before committing/pushing to main.

## Implementation

- [x] Pure moment-based aggregation, Morton ordering and a bounded hierarchy atlas.
- [x] Global projected-size traversal/culling in a worker; send selected ranges to
  Babylon so sorting/rendering process active representatives rather than the source.
- [x] Disposable AR-only meshes; maintain transform inheritance, depth materials and
  shadow lists. Release resources on exit and cancellation.
- [x] 30k/60k/120k budget controls; 50%/75%/100% next-session resolution controls.
  Defaults: 30k, 50% linear scale and no XR multisampling.
- [x] Pure-data and real-source JavaScript checks, including two-object budgeting,
  source/SH hashes, distance changes, material restoration and worker/texture cleanup.
- [x] Production build/base-path smoke and offline/cache checks.
- [x] Review implementation and acceptance evidence in the main agent.
- [ ] Physical Android PWA frame-time, layer-size, tracking and visual validation.

## Acceptance evidence

Initial real run: 370,018 source records, 262,143 atlas nodes, 30,000 active near,
114 far, 60,000 after raising the budget. Two copies retain a combined 30,000 cap.
Hierarchy preparation took about 0.6–0.8 seconds on the desktop test machine.
These are workload/correctness results, not a phone FPS benchmark. Coarse aggregates
lose detail; full detail uses the preserved original rather than generated records.
