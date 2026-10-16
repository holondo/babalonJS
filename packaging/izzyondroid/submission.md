# IzzyOnDroid inclusion request: babalon JS

Please add **babalon JS** to the IzzyOnDroid repository.

- Package ID: `com.holondo.babalon`
- License: `GPL-3.0-or-later`
- Source: https://github.com/holondo/babalonJS
- Releases: https://github.com/holondo/babalonJS/releases
- Metadata: https://github.com/holondo/babalonJS/tree/main/fastlane/metadata/android
- Signing certificate SHA-256: `1bb33ae3c61f661b857b077f07b9990c301647b8f71c9814fb7179b09e99e01e`

The release contains Offline and Distribution APKs. Please ingest only the ARM64 Distribution APK with:

```yaml
MaintainerNotes:
  Method: github-release
  ApkMatch: /^babalon-\d+\.\d+\.\d+-distribution-arm64-v8a\.apk$/
```

The selected APK is below 30,000,000 bytes. It contains the complete editor and its default studio environment. Optional sample models, animation clips, and additional environments are downloaded from the project's public GitHub Pages deployment only when the user selects them. No optional asset is downloaded at startup.

The app has no ads, analytics, trackers, or account requirement. Native augmented reality is retained and optionally depends on SceneView/ARCore and Google Play Services for AR on supported devices. AR is not required for the rest of the editor.
