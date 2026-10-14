# Native Android AR

The Capacitor build uses SceneView **2.2.1** and ARCore. The browser/PWA still uses
Babylon WebXR. SceneView's current Compose examples target a newer API; consult the
2.2.1 source before adapting lifecycle or gesture code.

## Integration path

Android Chrome/PWA and Capacitor's Android System WebView are different AR hosts.
The PWA uses `navigator.xr`; the embedded WebView used by this app cannot provide
the same immersive WebXR session. Opening a camera stream or reading gyroscope
angles does not provide ARCore's world tracking, surface detection or anchors.
Keep the two entry paths: Babylon WebXR in the browser, a native AR Activity in
the APK. Do not replace anchored AR with a camera overlay.

The native path is:

1. `UI.enterAR` suspends Photo's camera, blocks duplicate entry/autosave and exports
   the visible composition through `Editor.exportGLB(false, true)`.
2. It sends the GLB and placement metadata to `AndroidNative.launchArWithData`.
   Metadata includes the bottom-center origin, initial yaw, active animation names,
   playback settings and translated HUD strings.
3. `MainActivity` decodes the transfer off the UI thread into a unique cache file,
   obtains camera permission and launches `ArActivity` through an activity-result
   launcher. Microphone permission is requested only when recording needs it.
4. `NativeArSceneView` loads the file URI using SceneView's asynchronous loader.
   `ArActivity` owns placement, gestures, measurement and capture. The GLB is a
   session copy; native manipulation does not write transforms back to the editor.
5. Returning emits the closing bridge event, removes the cache file and restores
   the editor's camera ownership and autosave scheduling.

The integration uses Kotlin 2.0.21 and Java/Kotlin JVM target 17. SceneView 2.2.1
resolves ARCore SDK 1.43.0; the device's Google Play Services for AR is a separate
runtime version. Do not confuse upgrading that Gradle dependency with upgrading
the installed tracking runtime. Configure JDK 17 for the local Gradle environment;
machine-specific JDK installation paths are not integration requirements.

## Session configuration

Set `sessionConfiguration` and callbacks before attaching the Activity lifecycle.
In this SceneView version, the configuration-changed callback is a notification,
not the place to modify the configuration that ARCore will apply. Use:

```kotlin
sceneView.sessionConfiguration = { session, config ->
    config.planeFindingMode = Config.PlaneFindingMode.HORIZONTAL_AND_VERTICAL
    config.instantPlacementMode = Config.InstantPlacementMode.DISABLED
    config.lightEstimationMode = Config.LightEstimationMode.DISABLED
    config.depthMode = Config.DepthMode.DISABLED
    // Query session.isDepthModeSupported before offering optional occlusion.
}
// Install load/error/frame callbacks before this assignment.
sceneView.lifecycle = lifecycle
```

SceneView applies automatic focus after session resume and uses
`LATEST_CAMERA_IMAGE`. Retain its default camera selection. On the tested S24 this
was the rear camera, 30 fps, a 640×480 CPU image and a 1920×1080 camera texture.
CPU image size is not the rendered viewport resolution. Depth is capability-checked
and opt-in; it is not necessary to find planes. Tracking must be ready before a
hit is accepted, and an anchor must be tracking before manipulating its content.

## Placement and ownership

- Placement prefers an upward-facing plane, but accepts other tracking planes
  inside their polygons, feature points with an estimated surface normal, and
  depth points when depth is enabled. Hits must be 0.15–5 meters away. Points with
  only an identity orientation are rejected. There is no camera-relative fallback
  or instant-placement distance estimate. A preview follows valid hits until the user
  places it; after that only the ARCore anchor updates its pose.
- The editor sends the visible scene's bottom-center in glTF coordinates. A child
  model offset puts that point at the composition origin without normalizing model
  size. The anchor contains a composition node; rotation and uniform scaling act
  on that node, retaining the contact point and object spacing.
- Convert the initial orientation into anchor space once. Do not continually
  overwrite world orientation when ARCore refines its map.
- Moving explicitly returns to surface placement. Tracking loss blocks placement
  and gestures; measurements use their own anchors and hide when tracking is lost.
- SceneView's ModelLoader owns glTF entities. The app releases its wrapper and
  anchors before SceneView destroys the engine, without destroying ModelNode's
  asset root separately. `NativeArSceneView` supplies that ordering.

## Transfer and lifecycle

`exportGLB(false, true)` transfers the current optimized geometry without a second
mesh quantization pass. It retains floating-point skin weights, excludes invisible
objects and unused clips, and restores export-time scene changes. Active clips
receive entity-specific export names so copied characters cannot select each
other's animation. Paused poses remain still. Active clips restart when native AR
loads; playback phase is not synchronized between the two renderers.

PNG texture reductions remain selected; KTX2 textures fall back to source textures
because Babylon's exporter cannot read compressed GPU textures directly. This can
increase transfer size. Ordinary compact GLB export keeps its existing behavior.
The current base64 bridge also keeps multiple copies of the GLB in memory; large
scenes remain a memory risk. Successful small-scene placement is not evidence that
arbitrarily large scenes can be transferred safely.

The native bridge reports started/closed/error states. While native AR is active,
duplicate entry and autosave are blocked, and Photo mode releases its camera.
Returning restores Photo camera ownership when needed. Transfer files are deleted
on return. Native UI strings come from the editor's translation dictionary.

`NativeArSceneView.loadScene` converts the cache `File` to a `file://` URI before
calling the asynchronous SceneView loader. In 2.2.1, a bare absolute path falls
through to `AssetManager.open`, producing `FileNotFoundException` even when the
cache file exists. The native test uses this same routine with a real cache file
(including spaces and a non-ASCII name), rather than bypassing file resolution
with an in-memory buffer. It reproduced that failure before the URI fix and
passed after it.

Depth occlusion is opt-in and capability-checked. Video recording stops before
Activity destruction, preserves the viewport aspect ratio, and supports silent
recording when microphone permission is denied. Failed captures remove their
pending files. Android 10+ saves to MediaStore; older Android uses a cache-backed
FileProvider share because it has no legacy storage permission.

## Failure diagnosis

| Symptom | Finding and required action |
| --- | --- |
| Camera opens but no surfaces appear; virtual positions drift by many meters | Check the **installed APK's** debuggable flag first. The S24 investigation reproduced this with `true` and succeeded with `false`. A successful Gradle build alone does not verify tracking. |
| `Could not load 3D scene: /data/user/0/.../cache/...` | Pass `Uri.fromFile(file).toString()`, not a scheme-less path. SceneView 2.2.1 otherwise attempts to open an APK asset. |
| Raw hits exist but placement is unavailable | Inspect trackable type, orientation, distance and tracking state. Identity-oriented points at tens of meters were not usable surfaces; accepting them would conceal the tracking failure. |
| Tracking is active but there are no feature points or planes | Test with actual sideways movement and a textured surface. One stationary run moved only 1.5 cm and could not initialize surface placement. |
| There are no camera frames | Check Activity/session lifecycle and camera ownership separately from hit testing. Do not count an empty session as a surface-detection result. |
| Models deform or animation behaves differently after transfer | Check exported skin weight component types, paused pose export, unique active clip names and native clip sampling before changing placement math. |

Inspect the final APK with Android SDK `apkanalyzer manifest debuggable <apk>`;
the expected result for AR validation is `false`. `assembleDebug` still names the
build variant and uses the debug signing key even though debugger attachment is
disabled. Both `npm run android:build` and `npm run android:run` inherit this default.

The supplied 3D/AR Model Viewer 2.27.0 XAPK was inspected as a behavioral reference.
Its examined placement path filters tracked plane hits and creates anchors; its
camera selector chooses a rear 30 fps configuration with the largest CPU image.
Testing that resolution change alone did not fix our app. The decisive tested
change was debuggability, so the larger CPU image was removed. No proprietary code
or assets from that APK are bundled. The supplied recording gist addresses capture,
not surface detection or the editor-to-native scene transfer.

## Verification

Local debug APKs default to `debuggable=false`. On the tested Galaxy S24 running
Android 16 with Google Play Services for AR 1.56.262080393, debuggable builds
reported spurious multi-meter camera motion and no planes. Changing only the
debuggable flag with the same camera configuration allowed detection and anchored
placement. This matches the workaround reported in
[ARCore issue 1750](https://github.com/google-ar/arcore-android-sdk/issues/1750).
The APK still uses the local debug signing key, allowing an in-place update.
Use `-ParDebuggable=true` only when attaching a native debugger; do not use that
build for physical AR acceptance. Release builds remain non-debuggable.

1. `npm run build` and `node scripts/check-lazy-cache.mjs`.
2. Start the dev server and open `/scripts/fixtures/native-ar-export.html`. Run
   **Test native AR export** at desktop and 375 × 812 viewport sizes. This loads
   the bundled mannequin, checks skin weights, hidden objects, paused/active
   clips, and project preservation. Download its test scene.
3. `npx cap sync android`, then from `android/` run
   `./gradlew :app:assembleDebug :app:assembleDebugAndroidTest`.
4. Install both debug APKs on a test Android device and push the downloaded GLB
   to `/data/local/tmp/native-ar-regression.glb`. Run:

   ```sh
   adb shell am instrument -w \
     -e class com.holondo.babalon.ar.NativeArModelTest \
     -e glbPath /data/local/tmp/native-ar-regression.glb \
     com.holondo.babalon.test/androidx.test.runner.AndroidJUnitRunner
   ```

   This exercises cache-file URI resolution, the real asynchronous Filament model
   loader, skin update and repeated cleanup.
   It does not validate camera tracking, gestures, capture output, or visual quality.

5. With the phone viewing a textured surface, run the actual camera/placement probe:

   ```sh
   adb shell am instrument -w \
     -e class com.holondo.babalon.ar.NativeArSessionTest \
     -e cameraProbe true \
     -e glbPath /data/local/tmp/native-ar-regression.glb \
     com.holondo.babalon.test/androidx.test.runner.AndroidJUnitRunner
   ```

   This launches the real AR Activity, samples camera/plane tracking, uses the same
   placement method as a tap, and requires a tracking anchor. It reports effective
   configuration, debuggability, camera travel, feature points, accepted hits and
   placement time. It is opt-in because a covered/stationary camera cannot provide
   a repeatable physical scan. Instrumentation may exit with code zero on assertion
   failures: check `OK` / `FAILURES` in its output.

6. Physical acceptance: scan a detailed floor/table, place once, walk around the
   scene, rotate/scale, lose and recover tracking, reposition, measure, capture,
   and reopen AR. Check that the contact point stays fixed, the scene remains
   upright, and returning preserves the editor. Compare the same scene with PWA.

The export fixture passed on desktop and phone viewport sizes. After reproducing
and fixing the cache-path failure, the asynchronous native model/lifecycle test
passed on both the Android emulator and Galaxy S24 (SM-S921B), and the corrected
APK was installed on the S24. The real camera/placement probe subsequently passed
with debuggability disabled: three tracking planes, 72 accepted hits and 45 samples
with the placed anchor tracking. Raising the CPU camera image from 640×480 to
1920×1080 alone did not fix tracking; the production code retains ARCore's default
camera selection. The final default-camera build also passed: one plane, 19
accepted hits, placement after 13.4 seconds of the probe and 27 samples with the
anchor tracking. Its camera logged 29–30 fps. A previous stationary run (1.5 cm
estimated travel, no point-cloud features) could not detect surfaces; an earlier
run received no frames. Those runs were failures, not evidence of working placement.
The native model test passed with the final non-debuggable build as well.
The user subsequently confirmed on the S24 that AR placement actually worked.
Touch gestures, long-duration visual stability and capture
appearance still require physical acceptance. These checks do not establish full
visual/feature parity with PWA.

## References

- [SceneView repository](https://github.com/sceneview/sceneview)
- [2.2.1 AR model viewer](https://github.com/sceneview/sceneview/tree/v2.2.1/samples/ar-model-viewer)
- [2.2.1 AnchorNode](https://github.com/sceneview/sceneview/blob/v2.2.1/arsceneview/src/main/java/io/github/sceneview/ar/node/AnchorNode.kt)
- [Recording example supplied for this integration](https://gist.github.com/ThomasGorisse/4840069d43c14b845791912c34cf44a5)
