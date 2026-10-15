# `feature/capacitor-android` branch review

**Review date:** 2026-10-15  
**Compared revisions:** `origin/main..feature/capacitor-android`  
**Scope:** Android/Capacitor integration, native AR, responsive UI, gestures, materials, haptics, accessibility, localization, builds, and focused regressions  
**Review outcome:** **Not ready to merge**

## Executive summary

The branch establishes a substantial Android foundation: the web application builds, Capacitor copies the production bundle, the Android debug APK assembles, native AR code compiles, responsive panels render correctly at phone and desktop widths, the material panel handles optional PBR features defensively, and haptic feedback is appropriately limited to intentional interactions.

The branch should not be merged in its current state. Four areas require correction before approval:

1. The Android instrumentation APK cannot be assembled because conflicting Kotlin standard-library artifacts produce duplicate classes.
2. Android lint fails with two API-level errors caused by an API 27 style attribute in an application whose minimum SDK is 24.
3. The application advertises `ACTION_SEND_MULTIPLE`, but the native activity does not process it. The single-file handoff also acknowledges files before the web application has opened them successfully, making transient failures unrecoverable.
4. Six newly bundled HDR environment files have no documented source or license, and the README still states that those environments are not distributed with the application.

The unconditional release WebView debugger, mixed-content support, overly broad `FileProvider` path, number-input undo flooding, default AR resolution reduction, and inaccurate pre-Android-10 capture messages are additional high-priority findings.

No source fixes were applied as part of this review. The worktree remained clean after verification.

## Branch scope

The reviewed branch contains 12 commits relative to `origin/main`, with approximately 6,798 insertions and 213 deletions across 140 files. The changes include:

- A Capacitor Android application and build configuration.
- Native AR based on SceneView and ARCore.
- Native file-open, share, save, and back-button bridges.
- Native photo and video recording.
- Bundled HDR environments for offline/native use.
- Mobile sheet and focus behavior changes.
- Mesh-mode navigation and touch-camera changes.
- Number-label drag editing.
- Material-panel defensive state access.
- Capacitor haptics with a browser fallback.
- Accessibility and localization additions.

## Findings by severity

### Critical / merge blockers

#### B1. Android instrumentation APK cannot be assembled

**Affected area:** Android dependency resolution  
**Evidence:** `gradlew.bat assembleDebugAndroidTest` fails in `:capacitor-cordova-android-plugins:checkDebugAndroidTestDuplicateClasses`.

The Android-test runtime combines:

- `org.jetbrains.kotlin:kotlin-stdlib:1.8.22`
- `org.jetbrains.kotlin:kotlin-stdlib-jdk7:1.6.21`
- `org.jetbrains.kotlin:kotlin-stdlib-jdk8:1.6.21`

The legacy JDK-specific jars enter through `kotlinx-coroutines-android:1.6.4` on the generated Cordova module's Android-test runtime. Kotlin 1.8 folded the JDK 7 and JDK 8 extensions into the main standard library, so packaging both versions produces duplicate classes.

**Impact:** Native instrumentation tests cannot be packaged or executed. This prevents verification of AR lifecycle, recorder behavior, activity recreation, and native bridge behavior on a device.

**Recommended patch:**

```diff
--- a/android/build.gradle
+++ b/android/build.gradle
@@
 allprojects {
     repositories {
         google()
         mavenCentral()
     }
+    configurations.configureEach {
+        // Kotlin 1.8+ includes the former JDK 7/8 extensions in kotlin-stdlib.
+        exclude group: 'org.jetbrains.kotlin', module: 'kotlin-stdlib-jdk7'
+        exclude group: 'org.jetbrains.kotlin', module: 'kotlin-stdlib-jdk8'
+    }
     afterEvaluate { project ->
```

After applying the change, rerun:

```bash
cmd.exe /c "cd android && gradlew.bat assembleDebugAndroidTest"
```

The assembled instrumentation tests must then be run on an API 24+ device or emulator. The exclusion should also be checked after every `npx cap sync android`, because `capacitor-cordova-android-plugins` is generated content.

#### B2. Android lint fails on API-level resource validation

**Affected files:**

- `android/app/src/main/res/values/styles.xml`
- Android minimum SDK configuration

The following item occurs in both the application and launch styles:

```xml
<item name="android:windowLightNavigationBar">false</item>
```

`android:windowLightNavigationBar` requires API 27, while the application supports API 24. `gradlew.bat lintDebug` consequently fails with two errors at lines 18 and 26.

`MainActivity` already applies the navigation-bar icon appearance through `WindowInsetsControllerCompat`, so the simplest compatible fix is to remove the resource items:

```diff
--- a/android/app/src/main/res/values/styles.xml
+++ b/android/app/src/main/res/values/styles.xml
@@
-        <item name="android:windowLightNavigationBar">false</item>
@@
-        <item name="android:windowLightNavigationBar">false</item>
```

Alternatively, define complete API-27-specific style resources under `res/values-v27/`. Merely moving the individual item without preserving the complete qualified style should be avoided.

**Impact:** The required Android lint gate is red, and resource compatibility for API 24–26 is not cleanly established.

**Lint report:** `android/app/build/intermediates/lint_intermediate_text_report/debug/lintReportDebug/lint-results-debug.txt`

#### B3. Multi-file intents are advertised but ignored

**Affected files:**

- `android/app/src/main/AndroidManifest.xml`
- `android/app/src/main/java/com/holondo/babalon/MainActivity.java`
- `src/main.ts`

The manifest declares `ACTION_VIEW`, `ACTION_SEND`, and `ACTION_SEND_MULTIPLE`. `MainActivity.handleInboundIntent()` only handles `ACTION_VIEW` and `ACTION_SEND`.

**Impact:**

- A multi-file share can be accepted by Android and then silently ignored.
- A glTF package containing `.gltf`, `.bin`, and texture files cannot be opened as a batch.
- The behavior exposed by the Android chooser does not match the application contract.

The smallest correct MVP fix is to stop advertising unsupported behavior:

```diff
--- a/android/app/src/main/AndroidManifest.xml
+++ b/android/app/src/main/AndroidManifest.xml
@@
-                <action android:name="android.intent.action.SEND_MULTIPLE" />
```

Full support should subsequently collect every URI from `Intent.getClipData()` and `Intent.EXTRA_STREAM`, copy every file to the internal cache, and dispatch the complete batch to `UI.openFiles()`. That is necessary for reliable `.gltf` imports.

**Implementation follow-up — 2026-10-15:** Multi-file support was implemented and verified on a physical Samsung device. The first device test exposed a second defect: sharing two files created four objects. The sending application supplied the same files through both `Intent.EXTRA_STREAM` and `ClipData`, using URI representations that were not equal according to the original `LinkedHashSet` deduplication. `MainActivity` merged both collections and therefore copied every file twice.

The corrected behavior treats `EXTRA_STREAM` as the authoritative source and reads `ClipData` only when the extra contains no streams. A single-file share imported one object before the correction; the multi-file reproduction consistently imported four objects from two selected files. After applying the source-selection fix, `compileDebugJavaWithJavac` completed successfully. The corrected two-file behavior still requires a final APK installation and physical-device confirmation.

#### B4. Cold-start file state is cleared before successful consumption

`src/main.ts` assigns `loadedPath` before fetching the native file and calls `clearPendingFile()` before `UI.openFiles()` resolves.

If fetching, Blob construction, parsing, or model loading fails once, the same path cannot be retried and the native pending record has already been discarded.

**Recommended patch:**

```diff
--- a/src/main.ts
+++ b/src/main.ts
@@
 if (Capacitor.isNativePlatform()) {
+  const nativeApi = (window as unknown as {
+    AndroidNative?: {
+      getPendingFile?: () => string | null;
+      clearPendingFile?: () => void;
+    };
+  }).AndroidNative;
   let loadedPath: string | null = null;

   const loadNativeInbound = async (path: string, name: string) => {
     if (loadedPath === path) return;
-    loadedPath = path;
     try {
       const src = Capacitor.convertFileSrc(path);
       const res = await fetch(src);
+      if (!res.ok) throw new Error(`Could not read shared file (${res.status}).`);
       const blob = await res.blob();
-      const file = new File([blob], name, { type: 'model/gltf-binary' });
+      const file = new File([blob], name, {
+        type: res.headers.get('content-type') || 'application/octet-stream',
+      });
       await ui.openFiles([file]);
+      loadedPath = path;
+      nativeApi?.clearPendingFile?.();
     } catch (error) {
       ui.toast(error instanceof Error ? error.message : String(error), 'error');
     }
   };
@@
-  const nativeApi = (window as unknown as { AndroidNative?: { getPendingFile?: () => string | null; clearPendingFile?: () => void } }).AndroidNative;
   const consumePending = () => {
@@
-        nativeApi?.clearPendingFile?.();
         void loadNativeInbound(info.path, info.name);
```

The native bridge should also expose a narrowly scoped `deleteInboundFile(path)` method. The web application should invoke it only after successful consumption. Old inbound files should be expired by age at startup rather than deleting all `inbound-*` files whenever another intent arrives.

The native copy loop streams to disk rather than holding the complete file in memory, which is good. It still needs a reasonable maximum byte count so a hostile or broken provider cannot fill the cache indefinitely.

**Implementation follow-up — 2026-10-15:** Pending batches are now persisted in app-private `SharedPreferences`, restored only while their cache directory remains valid, and acknowledged only after `UI.openFiles()` succeeds. Device testing revealed a recreation race because `finishInbound()` initially deferred clearing the durable record to the UI thread. The bridge now clears the in-memory and persisted state synchronously before returning, preventing a recreated Activity from restoring an already-consumed batch. The focused Android Java compilation passed after this change.

#### B5. Bundled HDR environments have no documented provenance or license

Six new binary assets under `public/environments/` add approximately 15.6 MB:

| File | Approximate size |
| --- | ---: |
| `country.env` | 3.8 MB |
| `neutral.env` | 0.27 MB |
| `night.env` | 2.8 MB |
| `parking.env` | 3.5 MB |
| `room.env` | 5.0 MB |
| `studio.env` | 0.21 MB |

None is listed in `THIRD_PARTY_LICENSES.md`. `README.md` still says HDR environments are loaded at runtime and are not distributed with the application.

The BabylonJS Assets repository states that its contents use CC BY 4.0 unless an asset folder contains a specific exception. Babylon's texture documentation lists the relevant environment assets, while another Babylon asset-librarian document describes reusable assets as CC0. Because those statements are not sufficient to establish the exact license of each downloaded binary, the provenance must be confirmed per file before merge.

References:

- [BabylonJS Assets repository](https://github.com/BabylonJS/Assets)
- [BabylonJS available textures documentation](https://github.com/BabylonJS/Documentation/blob/master/content/toolsAndResources/assetLibraries/availableTextures.md)
- [BabylonJS asset librarian documentation](https://github.com/BabylonJS/Documentation/blob/master/content/toolsAndResources/assetLibrarian.md)

For each bundled file, add:

- Original URL and original filename.
- Author or copyright holder.
- Exact license and required attribution.
- A content hash or another reproducible identity.
- Any required license text.

The renamed `neutral.env` requires explicit mapping to its original asset name. The README must also be updated to say that these six environments are bundled and available offline.

### High-priority warnings

#### W1. Release WebView debugging is enabled

`MainActivity` calls `WebView.setWebContentsDebuggingEnabled(true)` unconditionally. That leaves release WebViews inspectable over ADB while the page has access to the `AndroidNative` JavaScript interface.

```diff
--- a/android/app/src/main/java/com/holondo/babalon/MainActivity.java
+++ b/android/app/src/main/java/com/holondo/babalon/MainActivity.java
@@
-        WebView.setWebContentsDebuggingEnabled(true);
+        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
```

#### W2. Mixed content is enabled without a demonstrated requirement

The application content is local or HTTPS, but `capacitor.config.ts` enables mixed content:

```diff
--- a/capacitor.config.ts
+++ b/capacitor.config.ts
@@
   android: {
     backgroundColor: '#120d1b',
-    allowMixedContent: true,
   },
```

Removing it reduces the chance that an HTTP resource can interact with privileged local WebView content.

#### W3. `FileProvider` exposes all external storage

`file_paths.xml` grants provider access to `external-path` with `path="."`, although the recorder and sharing implementation use cache files.

```diff
--- a/android/app/src/main/res/xml/file_paths.xml
+++ b/android/app/src/main/res/xml/file_paths.xml
@@
 <paths xmlns:android="http://schemas.android.com/apk/res/android">
-    <external-path name="my_images" path="." />
     <cache-path name="my_cache_images" path="." />
 </paths>
```

#### W4. Number-label scrubbing creates one undo step per pointer move

`numberInput()` calls `commit()` for every `pointermove`. The object-dimension callback calls `Editor.setDimension()`, which calls `transformMany()` and completes an entire undo operation per invocation.

**Impact:** A single drag can create dozens or hundreds of undo records, trigger repeated scene-change notifications, and cause unnecessary autosave work.

The smallest correctness patch commits only on release:

```diff
--- a/src/ui/dom.ts
+++ b/src/ui/dom.ts
@@
     const next = +(scrub.val + delta).toFixed(4);
     input.value = String(next);
-    commit(undefined, false);
   });
   const endScrub = (e: PointerEvent) => {
@@
     if (scrub.active) {
+      commit(undefined, false);
       if (lab.hasPointerCapture(e.pointerId)) {
```

That MVP patch sacrifices live scene feedback. The complete implementation should add scrub start/update/end callbacks and keep one `beginTransform()`/`endTransform()` transaction open while applying live values.

Pointer capture should also be acquired on `pointerdown`, if possible. Currently it is acquired only after crossing the six-pixel drag threshold, so leaving the label before activation can leave stale scrub state.

#### W5. Native AR reduces visual quality by default

`ArActivity` enables dynamic resolution with:

- `minScale = 0.65f`
- `quality = MEDIUM`
- Medium-quality HDR color buffer

This conflicts with the project requirement that render resolution and image quality must not be reduced by default. Dynamic resolution should be disabled in the default mode and offered through an explicit Performance option.

Screen-space refraction is also enabled globally. Because it is costly, it should be enabled only when a loaded material requires it or as part of an explicit quality option.

#### W6. Android 7–9 capture success messages are inaccurate

On Android versions below API 29, `SceneViewRecorder` creates a cache-backed FileProvider file and does not publish it to MediaStore. Nevertheless, `ArActivity` reports:

- `Photo saved to Gallery`
- `Video saved to Gallery`

Use `Photo ready to share` / `Video ready to share` below Android 10, or implement a compatible persistent-save path.

#### W7. Native save/share can produce large memory spikes

`src/core/files.ts` converts complete Blobs to base64 using `FileReader.readAsDataURL()` for native save and share operations.

For a large GLB this can simultaneously retain:

- The original Blob.
- A base64 payload approximately 33% larger.
- The JavaScript string representation.
- The native-side decoded data.

This undermines the branch's otherwise careful chunked native-AR model transfer. A streaming or chunked bridge should be used for large files.

Additional failure-path issues:

- Native share-cache files are not explicitly deleted.
- If the Capacitor operation throws, the fallback invokes `navigator.share()` without first checking whether it exists.
- The wrapper discards the returned promise, so fallback failures can become unhandled rejections.

#### W8. Segmented touch targets are below the project minimum

`.segmented button` is exactly 34 px high. This affects the Mesh `Select | Sculpt | Modify` tabs and selection-mode controls. The repository minimum is 36 px.

```diff
--- a/src/ui/style.css
+++ b/src/ui/style.css
@@
 .segmented button {
   flex: 1 0 auto;
   padding: 0 8px;
-  height: 34px;
+  height: 36px;
+  min-height: 36px;
```

The coarse-pointer rule correctly enlarges some other controls to 36 px, but it does not correct these segmented buttons.

#### W9. Not all pointer-capture calls are protected

The new number scrub and context-bar paths catch pointer-capture failures correctly. Remaining unguarded calls include:

- `src/ui/panelSheet.ts`
- The Mesh selection canvas in `src/ui/panels/separate.ts`

Both `setPointerCapture()` and `releasePointerCapture()` can throw if the pointer has already been released or transferred. Wrap each call in `try/catch`, including calls guarded by `hasPointerCapture()`.

#### W10. Three-finger camera navigation depends on a Babylon private method

The Mesh-mode camera override replaces Babylon's private `_computeMultiTouchPanning` method. This is fragile across Babylon minor updates and bypasses TypeScript safety.

The implementation counts three active touches to select panning, but Babylon may still process pinch zoom from its primary touch pair. Three-finger input could therefore pan and zoom simultaneously. This could not be validated through desktop browser automation and needs a physical touchscreen test.

The branch does restore the overridden method and camera controls when leaving Mesh mode; the ordinary exit path was verified in the browser.

#### W11. Android localization and accessibility remain incomplete

Web strings introduced by the branch generally use `tr()` and have Portuguese entries. Native AR strings are passed through the localized native string map. Remaining exceptions include:

- Hardcoded `Choose files` in `MainActivity`.
- Numerous hardcoded strings in `activity_ar.xml`, even if most are later replaced at runtime.
- A reticle view without a content description or explicit decorative accessibility treatment.
- Dynamic native strings reported by Android lint.

Move chooser/layout text into Android string resources or use neutral placeholders where text is always assigned programmatically. Mark the reticle with `android:importantForAccessibility="no"` if it is purely decorative.

#### W12. Additional Android lint warnings

The full lint run reported 63 warnings. Notable categories were:

- Manifest permission declarations placed after `<application>`.
- Missing reticle accessibility metadata.
- Hardcoded Android layout strings.
- Portrait-only activity behavior discouraged on Android 16.
- `android:min` in `activity_ar.xml`, which requires API 26 while the minimum SDK is 24.
- A possible unclosed `InputStream` warning in `MainActivity`; the stream is subsequently placed in try-with-resources, so this warning may be conservative, but the ownership should be made structurally obvious.

### Suggestions and optimizations

#### S1. Remove unused Capacitor Motion dependency

`@capacitor/motion` is declared but no usage was found. Remove it unless a near-term feature requires it. This keeps native/plugin configuration smaller and avoids implying a sensor permission or capability that the application does not use.

#### S2. Avoid `android:largeHeap="true"` unless measurements justify it

The manifest requests a large heap. This can conceal memory-retention problems and does not guarantee that large model operations will succeed. Prefer measured memory reductions and chunked I/O; retain `largeHeap` only with documented profiling evidence.

#### S3. Handle haptic promise rejection

Haptic calls use `void Haptics.impact(...)` and `void Haptics.selectionChanged()`. The plugin is installed, so the normal Android path is valid, but rejected plugin calls can still become unhandled promises. Add a small helper that catches plugin failure and then attempts `navigator.vibrate()`.

#### S4. Prevent double commit on Enter in number inputs

Pressing Enter calls `commit()` and then blurs the field. Depending on browser event ordering, the subsequent change event can commit the same value again. Store the last committed value or suppress the next change event after an explicit Enter commit.

#### S5. Document new native dependencies

The README or Android architecture document should name and explain the new Capacitor, SceneView, Filament, and ARCore dependencies, including which features require a physical ARCore-capable device.

## Multi-front assessment

| Front | Status | Score | Conclusion |
| --- | --- | ---: | --- |
| Android native and Capacitor | **Blocked** | 4/10 | Debug APK builds, but instrumentation packaging, intent reliability, lint, and WebView security require correction. |
| UI sheets and responsive CSS | **Mostly sound** | 7/10 | No overflow at 375×812; the focus-scroll workaround behaved correctly; segmented targets remain undersized. |
| Gestures and Mesh navigation | **Needs device validation** | 6/10 | Tabs, full-width Done button, and exit restoration work; multitouch depends on a Babylon private API. |
| Material system | **Pass** | 9/10 | Optional PBR structures are accessed defensively, and Unlit keeps the material controls available. |
| Haptics | **Pass with minor hardening** | 8/10 | Feedback is limited to intentional interactions; promise rejection should be handled. |
| Accessibility and visual identity | **Needs changes** | 7/10 | Focus-visible and reduced-motion behavior pass; Android reticle, hardcoded text, and 34 px controls remain. |
| Localization | **Mostly pass** | 7/10 | The TypeScript/native translation map is coherent; chooser and layout strings still bypass it. |

## Detailed front-by-front review

### 1. Android native and Capacitor integration

#### File intents and scoped storage

Positive findings:

- `content://` URIs are read through `ContentResolver`.
- `file://` URIs are attempted through a direct stream with resolver fallback.
- Inbound content is streamed to an internal cache file rather than loaded completely into Java memory.
- Both activity creation and new-intent delivery are considered.
- A JavaScript interface and polling fallback exist for cold-start timing.

Required corrections:

- Implement or remove `ACTION_SEND_MULTIPLE`.
- Do not delete all `inbound-*` files before every new copy.
- Clear native pending state only after successful web consumption.
- Add a bounded copy size and reject excessive inputs with a localized error.
- Add explicit post-consumption deletion and age-based startup cleanup.
- Preserve the actual content type instead of forcing `model/gltf-binary` for every file.

#### Manifest and WebView

Required corrections:

- Disable WebView debugging in release.
- Disable mixed content.
- Restrict the `FileProvider` to cache paths actually used by the application.
- Reorder permissions before `<application>`.
- Resolve API-level lint errors and warnings.

The debug merged manifest did not explicitly mark the application debuggable because the branch deliberately defaults the debug build's `arDebuggable` property to false for an ARCore/Samsung compatibility concern. The APK analyzer was not available on `PATH`, so the final APK flag was not independently inspected.

#### Native AR lifecycle

The source review found explicit resource release paths for recorder state, scene nodes, model loading, the AR activity, and temporary native model data. No definite lifecycle crash or permanent render loop was identified.

Remaining validation requirements:

- Repeated enter/exit cycles on a physical ARCore device.
- Background/foreground during placement and recording.
- Activity recreation under memory pressure.
- Camera permission denial and subsequent grant.
- Screen-space refraction with transparent and opaque materials.
- Depth-occlusion behavior on supported and unsupported devices.

### 2. UI layout, mobile sheets, and CSS resilience

At a 375×812 viewport:

- The main panel stayed within the viewport after layout settled.
- No panel-level horizontal overflow was detected.
- Focusing a number input did not change body scroll, panel scroll, or the panel's top position in the desktop Chromium environment.
- The Mesh panel rendered segmented navigation.
- The bottom Done action was full width and approximately 42 px high.

At 1280×800, the reviewed panels and mode transitions also rendered without detected overflow.

Limitations:

- Desktop viewport emulation does not reproduce the Android soft keyboard, visual viewport resizing, OEM WebView behavior, or browser chrome.
- The focus fix therefore still requires validation on at least one Android phone with the numeric keyboard open.

`.toggle` positioning and the contained input structure appear consistent with the clipping workaround. Panel and visual-viewport listeners belong to the long-lived UI shell, so no recurring mount/unmount listener leak was identified.

### 3. Interaction, gestures, and Mesh navigation

Positive findings:

- Mesh navigation is presented as `Select | Sculpt | Modify` segmented tabs.
- Selection modes are also segmented controls.
- The Done action is a full-width footer control.
- Exiting Mesh mode restored the Object-mode panel and controls during browser verification.
- Context-bar window listeners are installed during dragging and removed on completion/cancellation.
- Number scrub pointer capture is caught defensively.

Risks:

- Actual one-, two-, and three-finger behavior was not reproducible through the available browser automation.
- The three-finger implementation depends on a private Babylon camera method.
- Three-finger pan may coexist with pinch processing.
- Some pointer-capture calls remain unguarded.
- Number scrubbing floods undo history.

### 4. Material system and defensive state deserialization

The material panel uses optional access for optional PBR subsystems including:

- `subSurface`
- `sheen`
- `iridescence`
- `anisotropy`
- `clearCoat`

This prevents the reviewed controls from throwing when a material lacks one of those structures or when a custom material representation is restored.

Browser verification toggled Unlit and confirmed that the panel remained populated: seven sections and 32 visible controls remained available. No collapse or empty-panel regression was observed.

Status: **Pass**.

### 5. Tactile feedback and haptics

The implementation maps feedback appropriately:

- Light impact for ordinary intentional controls.
- Medium impact for stronger actions.
- Selection feedback for selection-style changes.
- `navigator.vibrate()` fallback outside Capacitor.

Slider/label drag feedback occurs when the gesture becomes active rather than on every pointer move, avoiding continuous vibration while scrolling or dragging. Toggle feedback is tied to changes, and ordinary automated value updates do not invoke it.

Required hardening is limited to catching asynchronous plugin failure and using the fallback when the native plugin rejects.

Status: **Pass with minor hardening**.

### 6. Accessibility and visual identity

Positive findings:

- `:focus-visible` uses a two-pixel accent outline.
- Reduced-motion preferences suppress or shorten animation globally.
- Sliders, selects, color fields, number fields, and icon buttons generally receive accessible labels.
- Gold/white/purple treatments remain aligned with the existing visual variables.

Required corrections:

- Increase segmented controls from 34 px to at least 36 px.
- Mark the native AR reticle as decorative or give it a meaningful description.
- Eliminate hardcoded Android layout text.
- Validate contrast and TalkBack traversal on a physical phone.

### 7. Localization and translation integrity

The new TypeScript strings reviewed are generally wrapped in `tr()`, and corresponding Portuguese entries are present. Native AR receives translated strings from `nativeARStrings`.

Remaining violations:

- `Choose files` is hardcoded in Java.
- `activity_ar.xml` contains hardcoded user-visible defaults.
- API-dependent capture messaging is not semantically correct on Android 7–9.

The recommended approach is to keep shared product terminology in the existing TypeScript translation map and use Android resources for strings that must exist before WebView/native string injection.

## Verification results

### Passed

| Command or check | Result |
| --- | --- |
| `npm run build` | Passed: TypeScript and Vite production build completed. |
| `npx cap copy android` | Passed. |
| `cmd.exe /c "cd android && gradlew.bat assembleDebug"` | Passed; debug APK assembled. |
| `cmd.exe /c "cd android && gradlew.bat testDebugUnitTest"` | Passed; current JVM test coverage is minimal. |
| `node scripts/check-project-archive.mjs` | Passed. |
| `node scripts/check-surface-brushes.mjs` | Passed. |
| Desktop browser layout, 1280×800 | Passed for inspected paths. |
| Mobile browser layout, 375×812 | Passed except undersized segmented controls. |
| Input-focus outer-sheet position | Passed in desktop Chromium viewport emulation. |
| Material Unlit panel retention | Passed. |
| Mesh tabs, Done footer, and exit restoration | Passed. |
| `git status --short` after verification | Clean. |

### Failed

| Command or check | Result |
| --- | --- |
| `cmd.exe /c "cd android && gradlew.bat lintDebug"` | Failed: 2 errors and 63 warnings. |
| `cmd.exe /c "cd android && gradlew.bat assembleDebugAndroidTest"` | Failed: duplicate Kotlin classes. |
| `node scripts/check-lazy-cache.mjs` | Failed because `dist/sw.js` was not generated. |
| `node scripts/check-offline-install.mjs` | Failed because `dist/offline-assets.json` was not generated. |
| `git diff --check origin/main..HEAD` | Reported trailing whitespace in `MainActivity.java` and `android/build.gradle`. |

The missing service-worker output appears to be a broader Vite/PWA toolchain issue rather than a failure clearly introduced by this branch: the underlying Vite and PWA configuration is substantially shared with `origin/main`. It remains a verification gap because offline install/resume behavior cannot be certified without those generated artifacts.

### Build warnings

The web build completed with warnings about:

- Browser externalization of Node modules such as `node:path`, `node:fs`, and `node:module`.
- Chunks larger than 500 kB.

These warnings were not shown to be new regressions in this branch, but they should be monitored because the native APK already includes approximately 15.6 MB of new environment assets. The assembled debug APK was approximately 93.5 MB.

## Tests not performed

The following require hardware or an environment that was not available during this review:

- Physical ARCore camera/session validation.
- Two-finger rotation, pinch zoom, and three-finger panning on a touchscreen.
- Android software keyboard focus behavior.
- Android share sheet with `content://`, `file://`, and multiple URIs.
- API 24–28 photo/video capture and gallery behavior.
- TalkBack navigation and announcements.
- Gyroscope and camera permission flows.
- Instrumentation-test execution, because the test APK does not currently assemble.
- Release signing, Play packaging, and release WebView inspection.

## Recommended merge sequence

1. Resolve Kotlin test-runtime dependencies and make `assembleDebugAndroidTest` pass.
2. Remove the unsupported API 27 style attributes and make `lintDebug` pass without errors.
3. Correct the inbound-file acknowledgement lifecycle and either implement or remove `SEND_MULTIPLE`.
4. Gate WebView debugging, disable mixed content, and narrow the `FileProvider` path.
5. Establish and document the environment assets' exact provenance and license; update the README.
6. Convert number scrubbing to one live transform/undo transaction.
7. Restore native-resolution AR as the default and make reduced resolution opt-in.
8. Correct pre-Android-10 capture behavior or messaging.
9. Increase touch targets, finish Android localization/a11y cleanup, and guard all pointer-capture calls.
10. Re-run all web, Android, archive, surface-brush, offline, and device checks.

## Acceptance criteria before merge

- `npm run build` passes.
- `npx cap copy android` passes.
- `gradlew.bat assembleDebug` passes.
- `gradlew.bat lintDebug` passes with zero errors.
- `gradlew.bat testDebugUnitTest` passes.
- `gradlew.bat assembleDebugAndroidTest` passes.
- Instrumentation tests pass on at least one supported Android device or emulator.
- Single-file `ACTION_VIEW` and `ACTION_SEND` imports succeed on cold and warm start.
- The application does not advertise `SEND_MULTIPLE` unless a real batch is delivered to `UI.openFiles()`.
- Failed file imports remain retryable and do not leak cache files.
- Release builds do not enable WebView debugging or mixed content.
- All bundled HDR environments have verified license/provenance entries.
- One number-label drag produces exactly one undo step.
- Default AR rendering does not reduce resolution or HDR quality.
- Android 7–9 capture messaging matches actual persistence behavior.
- All interactive phone controls are at least 36 px.
- Focused inputs remain visible on a physical Android phone without moving the outer sheet offscreen.
- Two-finger rotate/pinch, three-finger pan, and camera restoration pass on a physical touchscreen.
- `check-project-archive.mjs` and `check-surface-brushes.mjs` pass.
- Offline-install checks pass once service-worker generation is restored.

## Final assessment

The branch demonstrates a credible Android and native-AR implementation, and several reviewed subsystems are already in good condition. The material safeguards, haptic interaction design, responsive panel structure, Mesh sub-navigation, and native streaming approach are useful improvements.

The current blockers are concrete and bounded rather than signs that the branch must be redesigned. Nevertheless, the combination of a broken instrumentation build, failing lint, unreliable advertised file-intent behavior, undocumented binary assets, and release WebView exposure makes merge approval premature. Once those issues and the undo/quality regressions are fixed, the branch should receive a final physical-device pass before integration.
