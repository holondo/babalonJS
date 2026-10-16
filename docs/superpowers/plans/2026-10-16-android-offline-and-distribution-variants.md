# Android Offline and Distribution Variants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce and validate offline-complete and IzzyOnDroid-sized Android APK variants from one Babalon release.

**Architecture:** Gradle product flavors select packaging policy while one TypeScript URL resolver keeps the PWA and offline flavor local and sends only omitted distribution assets to the public Babalon deployment. Both flavors share application ID, signing key, product version, ABI-specific version codes, and native AR implementation; artifact names let IzzyOnDroid select only distribution APKs.

**Tech Stack:** TypeScript, Vite, Capacitor 7, Gradle/Android, Node.js verification scripts, ADB, Fastlane metadata, F-Droid metadata.

**Spec:** `docs/superpowers/specs/2026-10-16-android-offline-and-distribution-variants-design.md`

## Global Constraints

- Keep application ID `com.holondo.babalon` and the existing release signing key for both variants.
- Keep native SceneView/ARCore behavior intact and disclose its optional Google Play Services for AR dependency.
- Produce only `armeabi-v7a` and `arm64-v8a` repository APKs; each distribution APK must be at most 30,000,000 bytes.
- The offline variant packages optional models, animations, and environments; the distribution variant downloads them only after an explicit user action.
- The PWA continues resolving public assets through `import.meta.env.BASE_URL` and remains fully installable/offline under its existing cache policy.
- Never commit or print the keystore, signing passwords, `android/keystore.properties`, or local secret paths.
- Build release artifacts from the exact clean commit referenced by the immutable release tag.
- Code, comments, commit messages, and documentation remain in English; user-visible copy has English and Brazilian Portuguese metadata.

## Review Focus

- Distribution startup with no network must retain the default environment and core edit/save/open flow; Task 2 adds an asset-policy check and Task 4 exercises it on-device.
- A missing remote optional asset must fail through the existing load-error path without corrupting the scene; Task 2 verifies URL classification and Task 4 performs the device failure check.
- Flavor builds must not change package ID, signing certificate, AR manifest flags, or version pairing; Task 3 checks all four APKs.
- IzzyOnDroid must never ingest the larger offline artifacts; Task 5 validates a filename regex against the complete release artifact set.
- PWA asset URLs and offline cache behavior must not regress when Android flavor selection is added; Task 2 runs the production build and focused cache/archive checks.

---

### Task 1: Define Variant-Aware Android Packaging

**Files:**
- Modify: `android/app/build.gradle`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `scripts/check-android-abi-release.mjs`

**Interfaces:**
- Consumes: the existing Capacitor `dist/` copy and ignored signing properties.
- Produces: Gradle variants `offlineRelease` and `distributionRelease`, each with ARMv7/ARM64 outputs and matching ABI-specific version codes.

- [ ] **Step 1: Extend the release checker so it expects four variant/ABI artifacts and asserts exact package ID, version name, ABI-specific version code, signature, non-debuggable state, and the 30,000,000-byte ceiling only for distribution outputs.**

- [ ] **Step 2: Run `node scripts/check-android-abi-release.mjs` and verify it fails because the four named outputs do not exist.**

- [ ] **Step 3: Add the `offline` and `distribution` product flavors, shared ABI splits/version mapping, flavor-specific asset exclusions, and deterministic output naming to `android/app/build.gradle`; keep release signing conditional for F-Droid source builds.**

- [ ] **Step 4: Set application/package metadata to version `1.0.1` and ensure both flavors use the same `versionName` and per-ABI `versionCode`.**

- [ ] **Step 5: Run `npm ci`, `npm run build`, `npx cap sync android --deployment`, and clean signed Gradle assemblies for both release flavors; verify four APKs are produced.**

- [ ] **Step 6: Run the release checker and verify the structural assertions pass or report only the still-unimplemented asset-policy assertions owned by Task 2.**

- [ ] **Step 7: Commit the build-variant foundation with the release checker.**

### Task 2: Route Optional Assets by Distribution Policy

**Files:**
- Create: `src/core/assetUrls.ts`
- Modify: `src/core/editor.ts`
- Modify: `src/core/presets.ts`
- Modify: `vite.config.ts`
- Modify: `scripts/check-android-abi-release.mjs`

**Interfaces:**
- Consumes: a build-time Android distribution flag injected by Vite/Gradle and `import.meta.env.BASE_URL` for browser builds.
- Produces: `optionalAssetUrl(path: string): string`, returning a local URL for the PWA/offline flavor and an HTTPS Babalon deployment URL for the distribution flavor.

- [ ] **Step 1: Add failing policy assertions for local PWA/offline URLs, remote distribution URLs, explicit HTTPS origin, and paths without duplicate/missing slashes.**

- [ ] **Step 2: Run the focused policy check and verify those assertions fail against the current native-platform-only resolver.**

- [ ] **Step 3: Implement `optionalAssetUrl(path: string): string` from an injected distribution flag, then route optional environments, sample models, and bundled animation-library entries through it while keeping the default studio environment local.**

- [ ] **Step 4: Make Gradle/Vite provide the distribution flag without changing normal `npm run build` PWA behavior.**

- [ ] **Step 5: Clean-build both flavors and inspect ZIP entries: offline APKs contain representative optional assets, distribution APKs omit them, and both contain startup assets.**

- [ ] **Step 6: Run `npm run build`, `node scripts/check-lazy-cache.mjs`, `node scripts/check-project-archive.mjs`, and `node scripts/check-offline-install.mjs`; require all checks to pass.**

- [ ] **Step 7: Commit the asset-policy implementation and focused verification.**

### Task 3: Validate Signed Release Artifacts

**Files:**
- Modify: `scripts/check-android-abi-release.mjs`
- Create: `packaging/release/README.md`

**Interfaces:**
- Consumes: four signed APK outputs from Tasks 1–2 and Android SDK inspection tools.
- Produces: validated, consistently named release APKs plus a generated SHA-256 checksum list outside Git.

- [ ] **Step 1: Add checker assertions for identical package ID/version across flavors, identical certificate SHA-256 `1bb33ae3c61f661b857b077f07b9990c301647b8f71c9814fb7179b09e99e01e`, ARCore optional manifest state, absence of debug/test flags, expected ABI, content policy, and exact artifact names.**

- [ ] **Step 2: Run the checker against a deliberately incomplete output directory and verify it fails with the missing artifact names.**

- [ ] **Step 3: Document the clean tagged-build and checksum procedure in `packaging/release/README.md` without local paths or secrets.**

- [ ] **Step 4: Clean-build the four signed APKs, copy them to an ignored staging directory with final names, and generate `SHA256SUMS.txt`.**

- [ ] **Step 5: Run the checker against staging and require every signature, manifest, ABI, size, name, and content assertion to pass.**

- [ ] **Step 6: Commit the release verification and public procedure.**

### Task 4: Exercise Both Variants on the Galaxy S24

**Files:**
- Modify: `docs/release-checklist.md` if present; otherwise create `packaging/release/device-checklist.md`

**Interfaces:**
- Consumes: validated ARM64 APKs from Task 3 and the connected `SM_S921B` device.
- Produces: a recorded acceptance checklist for distribution and offline behavior; no device data is committed.

- [ ] **Step 1: Confirm the ADB target is the Galaxy S24 and record its current installed package/version before changing it.**

- [ ] **Step 2: Install the distribution ARM64 APK, launch it, capture startup/logcat failures, and ask the developer to exercise edit, save/open, one remote optional asset, and native AR.**

- [ ] **Step 3: Disable network access for the app/device long enough to confirm core startup remains usable and a missing optional download reports an error without damaging the open project; restore connectivity immediately afterward.**

- [ ] **Step 4: Install the offline ARM64 APK, keep networking disabled, and ask the developer to confirm bundled optional model/animation/environment access plus native AR entry.**

- [ ] **Step 5: Restore the developer's preferred installed variant, record pass/fail evidence in the checklist, and fix/rebuild/repeat any failed critical path before continuing.**

- [ ] **Step 6: Commit only the reusable device checklist, not logs or device identifiers.**

### Task 5: Prepare Store Metadata and Repository Selection

**Files:**
- Modify: `fastlane/metadata/android/en-US/full_description.txt`
- Modify: `fastlane/metadata/android/pt-BR/full_description.txt`
- Create: `fastlane/metadata/android/en-US/changelogs/201.txt`
- Create: `fastlane/metadata/android/en-US/changelogs/202.txt`
- Create: `fastlane/metadata/android/pt-BR/changelogs/201.txt`
- Create: `fastlane/metadata/android/pt-BR/changelogs/202.txt`
- Modify: `packaging/fdroid/com.holondo.babalon.yml`
- Create: `packaging/izzyondroid/com.holondo.babalon.yml`
- Create: `packaging/izzyondroid/submission.md`

**Interfaces:**
- Consumes: final artifact names, versions, certificate fingerprint, and verified channel behavior.
- Produces: bilingual store copy, an F-Droid distribution-flavor recipe, IzzyOnDroid metadata with `ApkMatch`, and ready-to-paste submission text.

- [ ] **Step 1: Update bilingual descriptions/changelogs to distinguish offline and distribution APKs, first-use downloads, non-coexistence, and optional ARCore runtime dependency.**

- [ ] **Step 2: Update the official F-Droid recipe to build the distribution flavor from source while retaining unsuppressed ARCore scanner disclosure.**

- [ ] **Step 3: Add IzzyOnDroid YAML using `Method: github-release`, Fastlane fields, signing fingerprint, and an anchored `ApkMatch` that accepts only the two distribution artifact names for the current version scheme.**

- [ ] **Step 4: Add submission text containing project/license/source/release links, exact `ApkMatch`, certificate fingerprint, size statement, and ARCore disclosure.**

- [ ] **Step 5: Run a focused metadata check that tests the regex against all four valid release filenames plus debug, unsigned, unrelated, and malformed filenames; only the two distribution files may match.**

- [ ] **Step 6: Run F-Droid metadata lint and scanner/build tooling; record the expected ARCore finding verbatim and fix every unrelated issue.**

- [ ] **Step 7: Commit store metadata and submission materials.**

### Task 6: Create and Verify the Upstream Release

**Files:**
- Modify: `packaging/izzyondroid/submission.md` only if final immutable URLs or hashes require insertion.

**Interfaces:**
- Consumes: clean verified source, four staged APKs, `SHA256SUMS.txt`, and prepared metadata.
- Produces: immutable `v1.0.1` tag, public GitHub release, downloadable artifacts, and final IzzyOnDroid submission instructions.

- [ ] **Step 1: Run `git diff --check`, confirm no secrets or generated APKs are tracked, and run the complete web/Android/metadata verification suite from the clean release commit.**

- [ ] **Step 2: Commit any final immutable metadata values, ensure the worktree is clean, and create annotated tag `v1.0.1` at that exact commit.**

- [ ] **Step 3: Rebuild the signed APKs from the tag checkout/commit, rerun the artifact checker, and compare generated checksums with staged release assets.**

- [ ] **Step 4: Push `main` and `v1.0.1`, create the GitHub release, and upload the four APKs plus `SHA256SUMS.txt`.**

- [ ] **Step 5: Verify every public asset URL, filename, byte size, and SHA-256 value; verify the release is not a draft or prerelease.**

- [ ] **Step 6: Insert final URLs/hashes into the local submission handoff if necessary and give the developer the Codeberg issue URL plus the exact ready-to-paste IzzyOnDroid text.**

- [ ] **Step 7: Stop before the authenticated final Codeberg submission and accompany the developer through that manual action, as requested.**
