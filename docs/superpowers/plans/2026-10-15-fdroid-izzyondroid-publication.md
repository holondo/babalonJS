# F-Droid and IzzyOnDroid Publication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Repository instructions prohibit subagents.

**Goal:** Produce one complete, tagged Android source release that the official F-Droid repository can rebuild and IzzyOnDroid can distribute as a developer-signed APK.

**Architecture:** Keep the existing Vite → Capacitor → Gradle pipeline and the full native SceneView/ARCore implementation. Add only the release-signing boundary, cross-platform build entrypoints, version consistency, upstream metadata corrections, and a draft F-Droid recipe. Prove the real APK path before preparing external submissions.

**Tech Stack:** Node.js/npm, TypeScript, Vite, Capacitor 8, Android Gradle Plugin, Kotlin/Java, Fastlane metadata, F-Droid metadata.

**Spec:** `docs/superpowers/specs/2026-10-15-fdroid-izzyondroid-publication-design.md`

## Global Constraints

- Keep `applicationId` exactly `com.holondo.babalon` in both repositories.
- Keep SceneView and native ARCore in the first official F-Droid submission.
- Use Android `versionName` `1.0.0`, `versionCode` `1`, and eventual tag `v1.0.0`.
- Never commit a keystore, signing password, local signing properties, APK, or other credential.
- Do not create commits, tags, pushes, releases, merge requests, or submission requests without explicit user instruction.
- Use `npm ci` and an immutable `package-lock.json` for release builds.
- Preserve the existing MVP-first verification order and exercise a real APK before peripheral publication work.

## Review Focus

- A clean Linux checkout must build without a developer keystore; Task 2 verifies the unsigned F-Droid release path.
- A local signed release request with missing credentials must fail with actionable guidance and no secret output; Task 1 verifies this boundary.
- The APK must keep AR optional so non-ARCore devices can use the editor; Task 2 inspects the merged manifest.
- Versions must agree across Gradle, package metadata, Fastlane changelog, tag plan, and recipe; Tasks 2 and 4 assert exact values.
- Store copy must disclose ARCore and avoid claiming every optional network resource is offline; Task 3 performs focused metadata checks.

---

### Task 1: Secure release-signing boundary

**Files:**
- Modify: `.gitignore`
- Modify: `android/app/build.gradle`
- Create locally, never commit: an Android release keystore outside the repository
- Create locally, never commit: `android/keystore.properties`

**Interfaces:**
- Consumes: Gradle release tasks and Java `keytool`/Android signing tools.
- Produces: an optional `signingConfigs.release` populated from `android/keystore.properties`; unsigned release assembly remains available to F-Droid.

- [ ] **Step 1: Add ignore rules and a credential-leak check**

Add exact ignore coverage for `android/keystore.properties`, `*.jks`, `*.keystore`, and release APK/AAB outputs. Verify `git check-ignore` recognizes representative paths.

- [ ] **Step 2: Add conditional release signing**

Load `android/keystore.properties` only when present. Configure the release signing config from `storeFile`, `storePassword`, `keyAlias`, and `keyPassword`; keep an unsigned release build possible when the file is absent.

- [ ] **Step 3: Verify the missing-credential path**

Run `android/gradlew :app:assembleRelease` without the local properties file. Expected: Gradle produces the unsigned release artifact or reaches only unrelated build blockers; it must not request or print secrets.

- [ ] **Step 4: Generate and inventory the signing key**

Create the keystore outside the repository with a unique strong password and alias `babalon`. Record the SHA-256 certificate fingerprint. The user stores the file in Google Drive, credentials/fingerprint in Bitwarden, and a second file copy offline.

- [ ] **Step 5: Verify Git isolation**

Run `git status --short`, `git ls-files "*.jks" "*.keystore" "*keystore.properties"`, and a tracked-file secret scan. Expected: no signing material is tracked or shown as untracked.

### Task 2: Clean full release build

**Files:**
- Modify: `android/build.gradle`
- Modify: `android/app/build.gradle`
- Modify: `package.json`
- Modify if generated sync requires it: `android/app/capacitor.build.gradle`

**Interfaces:**
- Consumes: locked npm dependencies, Vite build, Capacitor CLI, Gradle wrapper.
- Produces: cross-platform commands for web sync and unsigned/signed Android release builds with the full AR implementation.

- [ ] **Step 1: Remove the unused Google Services plugin**

Remove `com.google.gms:google-services` from the root buildscript and the conditional `google-services.json` application block from the app module. Do not remove `io.github.sceneview:arsceneview` or `com.google.ar:core`.

- [ ] **Step 2: Normalize exact release versions**

Set package and Android release metadata to `1.0.0`/`1`. Ensure user-visible changelog filenames still match version code `1`.

- [ ] **Step 3: Add platform-neutral release scripts**

Add npm scripts that run the web build and Capacitor sync independently of PowerShell or `gradlew.bat`. Keep Windows convenience scripts if useful, but the F-Droid path must call `./gradlew` or invoke Gradle directly from its recipe.

- [ ] **Step 4: Exercise the critical build path**

Run `npm ci`, `npm run build`, `npx cap sync android`, then Gradle lint and release assembly. Expected: all commands exit zero and produce a release APK.

- [ ] **Step 5: Inspect the release artifact**

Use Android build tools to assert package `com.holondo.babalon`, version `1.0.0`/`1`, `debuggable=false`, ARCore metadata `optional`, and the expected camera/audio/network permissions. Confirm SceneView and ARCore remain in the runtime dependency tree.

- [ ] **Step 6: Run repository packaging regressions**

Run `node scripts/check-lazy-cache.mjs`, `node scripts/check-project-archive.mjs`, and `node scripts/check-offline-install.mjs` after the production build. Expected: all pass.

### Task 3: Store metadata and licensing audit

**Files:**
- Modify as findings require: `fastlane/metadata/android/en-US/*`
- Modify as findings require: `fastlane/metadata/android/pt-BR/*`
- Modify as findings require: `README.md`
- Modify as findings require: `README.pt-BR.md`
- Modify as findings require: `THIRD_PARTY_LICENSES.md`

**Interfaces:**
- Consumes: final feature set and dependency/artifact inventory from Task 2.
- Produces: truthful bilingual upstream metadata suitable for both repositories.

- [ ] **Step 1: Inventory every shipped binary and asset**

Compare `dist/`, Android dependencies, public models/animations/HDR files, WASM modules, fonts, icons, and artwork against their source/license records. Record a blocker for anything without redistribution permission.

- [ ] **Step 2: Correct store claims**

Keep the explicit ARCore disclosure. Replace any absolute offline claim with language distinguishing the bundled editor from optional on-demand models, libraries, or decoders if the audit confirms network use.

- [ ] **Step 3: Validate Fastlane structure**

Assert both locales contain non-empty title, short description, full description, changelog `1.txt`, icon, feature graphic, and phone screenshots. Check image dimensions and accepted formats.

- [ ] **Step 4: Run metadata and secret checks**

Search tracked files for keystore fields, passwords, API keys, `google-services.json`, and unsupported claims. Expected: no secrets or unused Google Services configuration; ARCore references remain intentional.

### Task 4: F-Droid recipe prototype

**Files:**
- Create: `packaging/fdroid/com.holondo.babalon.yml`
- Create: `packaging/fdroid/README.md`

**Interfaces:**
- Consumes: version/tag contract and clean unsigned build commands from Task 2.
- Produces: a reviewable metadata recipe to copy into `fdroiddata` after the release commit hash exists.

- [ ] **Step 1: Write the recipe with one disabled pre-release build**

Define GPL-3.0-or-later licensing, source/issue/changelog links, categories, auto-update mode, current version `1.0.0`/`1`, `subdir: android`, and the exact npm/Capacitor prebuild commands. Keep the build disabled only while the immutable release commit hash is unavailable.

- [ ] **Step 2: Document replacement fields**

List the exact fields that must be replaced after release: full commit hash, tag verification, APK output path, and any scanner exceptions. Do not pre-authorize scanner exceptions.

- [ ] **Step 3: Validate in official tooling**

Run F-Droid metadata lint, scanner, and build in supported Linux tooling/container. Expected: metadata parses; every scanner finding is understood; the source build produces the intended unsigned APK. Fix only demonstrated blockers.

- [ ] **Step 4: Cross-check version identity**

Assert the recipe, Gradle files, package metadata, Fastlane changelog, and planned tag all identify `1.0.0`/`1` and `com.holondo.babalon`.

### Task 5: Signed APK and physical acceptance

**Files:**
- No tracked source file required unless verification exposes a defect.
- Produce locally, never commit: signed release APK and checksum file.

**Interfaces:**
- Consumes: signing boundary from Task 1 and verified release build from Task 2.
- Produces: developer-signed APK eligible for a GitHub Release and IzzyOnDroid ingestion.

- [ ] **Step 1: Build the signed release**

Supply local signing properties and run the release assembly. Expected: a signed, non-debuggable APK.

- [ ] **Step 2: Verify signature and checksum**

Run `apksigner verify --verbose --print-certs` and compute SHA-256. Assert the certificate matches the fingerprint stored for future releases.

- [ ] **Step 3: Install on a physical device**

Install the release APK and exercise startup, model/project import, save/share, and native AR entry. Record the device/Android version and concrete outcomes.

- [ ] **Step 4: Re-run final source checks**

Run `npm run build`, relevant repository regression scripts, Android lint, and release assembly once more from the final source state. Expected: all required checks pass with fresh output.

### Task 6: Release and repository submissions

**Files:**
- Modify after release hash exists: `packaging/fdroid/com.holondo.babalon.yml`
- External: GitHub Release, F-Droid `fdroiddata` merge request, IzzyOnDroid inclusion request

**Interfaces:**
- Consumes: explicitly approved final Git state, signed APK, checksum, verified recipe, and store metadata.
- Produces: `v1.0.0` upstream release and two traceable inclusion requests.

- [ ] **Step 1: Present the final diff and verification evidence**

Show tracked changes, artifact identity, tests, known ARCore policy risk, and any untested device behavior. Obtain explicit approval before commit/push/tag/release.

- [ ] **Step 2: Commit and tag only after approval**

Create focused English commit(s), push them, then create immutable annotated tag `v1.0.0` at the approved commit. Never rewrite the published tag.

- [ ] **Step 3: Publish the GitHub Release only after approval**

Attach the developer-signed APK and SHA-256 checksum with release notes derived from changelog `1.txt`. Verify the public download and signature.

- [ ] **Step 4: Submit to IzzyOnDroid**

Open the inclusion request with repository/release links, license, package ID, Fastlane metadata, ARCore disclosure, and scanner context. Preserve the request URL.

- [ ] **Step 5: Submit to official F-Droid**

Replace the recipe's placeholder with the full release commit hash, rerun official tooling, and open the `fdroiddata` merge request. Explicitly disclose that ARCore is optional but native AR requires Google Play Services for AR. Preserve the merge request URL.

- [ ] **Step 6: Handle review outcomes without scope creep**

Fix ordinary metadata/build issues upstream in a new version when required. If either reviewer requires removal of ARCore, stop and request a separately approved design rather than silently changing the product.
