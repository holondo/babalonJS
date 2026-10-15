# F-Droid and IzzyOnDroid Publication Design

## Goal

Publish the complete Android application under `com.holondo.babalon` in both the official F-Droid repository and IzzyOnDroid. The distributed application must retain the native SceneView/ARCore feature and use the same upstream source release for both repositories.

Success means:

- a tagged upstream release builds from public source;
- a developer-signed release APK is available for IzzyOnDroid;
- an F-Droid build recipe can rebuild the same tagged source;
- both submissions include complete English and Brazilian Portuguese metadata;
- signing material and passwords never enter Git;
- any decision about removing ARCore is deferred until an official F-Droid review explicitly requires it.

## Distribution Architecture

The existing Vite application remains the shared product source. A release build follows the existing production pipeline:

1. `npm ci` installs the locked Node dependencies.
2. The Vite production build writes the web application to `dist/`.
3. Capacitor synchronizes `dist/` and its Android plugins into the Android project.
4. Gradle builds the full release APK, including SceneView and its transitive ARCore SDK dependency.

The first release is identified by the immutable `v1.0.0` tag with Android `versionName` `1.0.0` and `versionCode` `1`. IzzyOnDroid consumes the developer-signed APK attached to that GitHub release. F-Droid builds the same tag from source using metadata submitted to `fdroiddata` and initially signs the resulting APK with the F-Droid signing key.

Both packages retain `com.holondo.babalon`. Because the repositories use different signing keys, an installation from one repository cannot update an installation from the other without uninstalling it first. That limitation must be documented in the release/submission notes where useful.

## ARCore Policy Strategy

The first submission keeps native AR intact. The app declares ARCore as optional, so devices without Google Play Services for AR can still use the editor. Submission notes must disclose that the native AR feature uses SceneView and requires Google Play Services for AR at runtime.

The project will not create an F-Droid-specific flavor or silently remove AR in advance. If F-Droid rejects the build because of ARCore or its proprietary runtime dependency, that review becomes the evidence for a separate product decision. A reduced variant is outside this design and requires new approval.

The unused Google Services Gradle plugin is separate from ARCore. Its buildscript dependency and conditional application block should be removed because the repository has no `google-services.json`, Firebase integration, or push-notification feature. Removing it reduces false scanner findings without changing native AR.

## Android Signing

A new Android release keystore will be generated locally. It must never be created inside the repository or referenced by a committed absolute path.

Storage rules:

- upload the password-protected keystore to the developer's Google Drive;
- store the keystore password, key password, alias, certificate fingerprints, and purpose in Bitwarden;
- keep a second offline copy of the keystore;
- do not store passwords beside the Drive file;
- do not commit `keystore.properties`, signing environment files, APKs, or credentials.

The release build should receive signing values through an ignored local properties file or environment variables. Build configuration must fail with a clear message when a signed-release task is requested without the required local credentials, while ordinary source builds and F-Droid unsigned builds remain possible.

## Release and Metadata

Upstream Fastlane metadata remains the canonical store listing. English and Brazilian Portuguese must each include a title, short description, full description, changelog, icon, feature graphic, and phone screenshots. Descriptions must accurately disclose ARCore and avoid unsupported claims such as universal offline behavior if optional online libraries or models remain.

The GitHub release must contain:

- tag and title `v1.0.0`;
- concise release notes derived from the changelog;
- a release APK with a stable, recognizable filename;
- the APK SHA-256 checksum;
- no keystore or signing configuration.

IzzyOnDroid will be asked to ingest the signed APK from GitHub Releases. The official F-Droid submission will add `com.holondo.babalon.yml` to `fdroiddata`, pointing at the immutable commit behind `v1.0.0`. Its build recipe will install locked Node dependencies, build the web bundle, synchronize Capacitor, and run the release Gradle task.

## Build Compatibility

The release must build on Linux because F-Droid does not use the project's Windows-only npm commands. Cross-platform scripts or explicit recipe commands must replace any reliance on `gradlew.bat` and PowerShell. The recipe must use `npm ci`, not an unlocked dependency install.

The build audit must cover:

- licenses and source availability for Node, Maven, native, WASM, model, animation, HDR, and artwork dependencies;
- binaries or generated files that F-Droid scanners could flag;
- the unused Google Services plugin;
- version consistency across Gradle, package metadata, changelog, tag, and release;
- F-Droid's ability to locate the produced APK;
- the size and architecture contents of the final APK.

No dependency substitutions or source patches should be introduced unless a scanner or clean build demonstrates the need.

## Verification

Verification follows the repository's MVP-first rule and proves the real release path before secondary checks:

1. Run `npm ci` from a clean dependency state where practical.
2. Run the production web build and existing focused archive/cache checks relevant to packaged assets.
3. Run Capacitor synchronization.
4. Run Android lint and assemble the unsigned release used to model F-Droid.
5. Assemble the locally signed release and verify its package ID, version, signing certificate, debuggable state, permissions, and ARCore-optional manifest entry.
6. Install the signed APK on a physical Android device and exercise startup, file import, save/share, and entry into native AR.
7. Run F-Droid metadata lint/scanner/build tooling in a supported Linux environment or its official container before submission.
8. Compare the submitted tag, commit, version, metadata, checksum, and artifact.

Device-only AR behavior cannot be proven by a desktop build. The release is not considered ready until at least the native AR entry path runs on a compatible physical device, or the untested limitation is explicitly recorded for the developer to validate.

## Failure Handling

- Missing signing credentials stop only the developer-signed release task and print setup guidance without secrets.
- A failed web build or Capacitor sync stops before Gradle packaging.
- A failed lint, scanner, clean Linux build, signature check, or APK installation blocks publication.
- An IzzyOnDroid scanner concern is corrected in the upstream release before resubmission.
- An F-Droid objection to ARCore is recorded verbatim; no AR feature is removed without a separately approved design.
- If an already published tag needs source changes, create a new version and tag rather than moving or rewriting the published tag.

## External Actions and Ownership

The developer remains the sole owner of the signing key, store identities, repository accounts, release, and submissions. Login, two-factor authentication, secret entry, and any final irreversible submission confirmation may require the developer's direct action. Preparation and validation can otherwise be completed locally.

No commit, push, tag, GitHub Release, F-Droid merge request, or IzzyOnDroid request is created without the developer's explicit instruction at the relevant stage.
