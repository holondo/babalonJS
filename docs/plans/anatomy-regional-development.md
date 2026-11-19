# Regional anatomy development

Use the abdominal wall, pelvis and inguinal transition as the first development region. Keep the fitting algorithm fixed while establishing a repeatable baseline.

1. Capture a baseline through **Fit only** on a real GLB. Record the fitted parameters and aligned target sections once. Measure the final editor mesh in the same frame as the target and export the section with the largest sampled skin deviation.
2. Replay the saved target sections and parameters against the current editor build. Measure the same positions, with and without the skin residual. Allow a candidate parameter document for direct A/B comparisons. Keep the result separate from the baseline.
3. Validate capture and replay on hypertrophied reference and smooth-surface reference. Check that replay without changes reproduces the geometry measurements. Document the workflow in a temporary skill after the commands work.
4. In a subsequent solver pass, use the evidence to choose one dependency to change. Start with the rectus–sheath–oblique boundary or the ligament–aponeurosis boundary. Expand to a true regional solve only after replay identifies what can be isolated and shows that local and full generation agree at the boundaries.

The first tool bounds the measurements and reuses the observations. It still regenerates the requested editor layers and does not implement a separate regional solver.
