# F-Droid submission draft

`com.holondo.babalon.yml` is a staging copy for the official
[`fdroiddata`](https://gitlab.com/fdroid/fdroiddata) repository. It is not read by
the Android or web builds.

Submission checklist:

1. Confirm the build's `commit` is the full immutable commit hash referenced by
   the published `v1.0.0` tag.
2. Run `fdroid lint com.holondo.babalon`, `fdroid scanner com.holondo.babalon`,
   and `fdroid build com.holondo.babalon:1` in the official Linux tooling.
3. Confirm the build output is
   `android/app/build/outputs/apk/release/app-release-unsigned.apk`.
4. Add scanner exceptions only for a reviewed, freely redistributable artifact;
   document each exception in `MaintainerNotes`.

The first submission intentionally retains SceneView and ARCore. Native AR is
optional at the Android manifest level but requires Google Play Services for AR
at runtime. If official review rejects that dependency, stop and decide on a
separate product variant instead of editing the submitted source silently.

The official APK scanner currently reports 13 findings under
`com/google/vr/dynamite/client`, supplied by ARCore through SceneView. The recipe
does not hide these findings with `scanignore`; they are disclosed for the
official reviewers to assess.
