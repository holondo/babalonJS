# Android Offline and Distribution Variants Design

## Goal

Maintain two Android distributions of Babalon from the same source release:

- an **offline** variant that preserves the self-contained behavior of version 1.0.0 by packaging the optional models, animations, and environments;
- a **distribution** variant small enough for IzzyOnDroid, with optional content fetched from the public Babalon site only when the user selects it.

Both variants keep the existing `com.holondo.babalon` application ID, product name, release signing key, native editor, and SceneView/ARCore implementation. A release is ready for IzzyOnDroid when its ARM APKs are signed, below IzzyOnDroid's 30 MB per-APK limit, tested on the physical Galaxy S24, attached to an immutable GitHub release, and selectable with an unambiguous IzzyOnDroid `ApkMatch` rule.

## Channel Semantics

The variants are alternative installation channels, not separate applications. Because they share an application ID, Android permits only one to be installed at a time. They also share the developer signing key so that one variant can replace the other when Android's version rules permit it.

Every release uses the same `versionName` for both variants. APKs targeting the same ABI use the same `versionCode` regardless of variant, so neither channel is presented as newer solely because it packages more assets. ARMv7 and ARM64 retain distinct version codes to let repository clients select architecture-compatible updates. Switching channels at the same product version may require uninstalling and reinstalling if the Android package installer refuses a same-version replacement; release documentation must state this without promising seamless channel switching.

## Build Architecture

Gradle product flavors define the packaging policy:

- `offline` packages the complete Vite production output and produces signed per-ABI APKs for direct GitHub distribution;
- `distribution` excludes store artwork, PWA-only files, optional models, animations, and non-default environments from Android assets and produces signed per-ABI APKs for IzzyOnDroid;
- the default studio environment and all code required to start and use the editor remain inside both variants;
- native libraries are split into `armeabi-v7a` and `arm64-v8a` APKs, with no repository-facing universal APK.

The web/PWA build remains fully self-contained and continues using `import.meta.env.BASE_URL`. Android runtime code receives the selected build flavor through a generated build value or an injected Vite environment value. Only the distribution flavor resolves optional asset URLs to the public GitHub Pages deployment. The offline flavor and PWA resolve those assets locally.

The implementation must not maintain duplicate lists of assets in TypeScript and Gradle when one shared manifest or build-time policy can express them. Flavor-specific packaging must also avoid deleting source assets or changing the PWA output.

## Artifact Naming and Repository Selection

Release artifacts use stable names containing the product version, variant, and ABI:

- `babalon-<version>-offline-arm64-v8a.apk`
- `babalon-<version>-offline-armeabi-v7a.apk`
- `babalon-<version>-distribution-arm64-v8a.apk`
- `babalon-<version>-distribution-armeabi-v7a.apk`

Each APK has a corresponding SHA-256 entry in a release checksum file. Debug, unsigned, and intermediate APKs are never attached.

IzzyOnDroid metadata must set `MaintainerNotes.Method` to `github-release` and use `MaintainerNotes.ApkMatch` to match only distribution APK filenames. This prevents the larger offline APKs in the same GitHub release from being imported. Fastlane metadata remains the canonical description and must disclose that optional distribution assets require a first download while the separately offered offline APK includes them.

The official F-Droid recipe builds the distribution flavor from source. It does not consume developer-signed release artifacts. The existing ARCore disclosure and scanner findings remain visible for official review; this design does not remove native AR or hide non-free dependency findings.

## Network and Offline Behavior

The offline APK must start and expose the bundled models, animations, and environments without a network connection. Features that inherently use external libraries, such as browsing Poly Haven, remain online features and are not redefined by this variant.

The distribution APK must start, create/edit/save projects, use its default environment, and enter native AR without downloading optional content. When a user selects an omitted optional asset, the app fetches it over HTTPS from the versioned public Babalon deployment. A failed request must surface the existing load error path and leave the editor usable. No optional asset is downloaded silently at startup.

## Metadata and User Communication

English and Brazilian Portuguese Fastlane descriptions and changelogs explain:

- the distinction between the offline and distribution APKs;
- that both represent the same Babalon version and cannot coexist;
- which distribution features need a first download;
- that native AR optionally relies on Google Play Services for AR.

GitHub release notes identify the recommended ABI for modern phones (`arm64-v8a`) and provide concise installation guidance. The IzzyOnDroid request supplies the exact distribution filename pattern, signing certificate SHA-256, source/release links, license, and ARCore disclosure.

## Verification

Verification follows the real release path:

1. Build the production web application and run the repository's focused PWA/archive checks.
2. Synchronize Capacitor and clean-build all four signed release APKs from the exact commit intended for the release tag.
3. Verify package ID, version name/code, ABI, release signature, non-debuggable state, ARCore manifest state, filenames, and SHA-256 values.
4. Enforce a strict decimal size ceiling of 30,000,000 bytes for each distribution APK.
5. Inspect APK contents to prove optional assets are absent only from distribution APKs and present in offline APKs.
6. Install the ARM64 distribution APK on the connected Galaxy S24 and exercise startup, editing, project save/open, one remotely loaded optional model or animation, failure with networking disabled, and native AR entry.
7. Install the ARM64 offline APK and repeat startup, project handling, optional asset loading with networking disabled, and native AR entry.
8. Run F-Droid metadata lint/scanner/build checks against the distribution flavor and record ARCore findings without suppressing them.

Device gestures and native AR acceptance require the developer's observation. Publication is blocked by a build, signature, size, content, install, startup, or native AR regression.

## Release Process

Source changes, metadata, and release scripts are committed before release artifacts are built. The clean commit is tagged once; tags are never moved. The signed artifacts are built from that exact tag, verified, and attached to one GitHub release.

After the GitHub release is public and its asset URLs work, prepare the IzzyOnDroid submission text and guide the developer through the Codeberg issue form. Account login, two-factor authentication, and the final issue submission remain manual user actions. The task is complete when the user has all validated artifacts, checksums, links, and ready-to-paste submission text needed to submit the app to IzzyOnDroid.

## Secret Handling

The existing external keystore and ignored `android/keystore.properties` remain the only signing inputs. The keystore, aliases, passwords, and local absolute paths are never committed or printed. The developer's Google Drive and Bitwarden backups remain outside the repository.
