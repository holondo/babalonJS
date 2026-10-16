# Android release procedure

Build release artifacts only from the clean commit that the annotated release tag references. The Android release keystore remains external to the repository and is loaded through the ignored `android/keystore.properties` file.

## Offline APKs

```sh
npm ci
npm run build
npx cap sync android --deployment
cd android
./gradlew clean assembleOfflineRelease
cd ..
```

The regular production build keeps all optional models, animations, and environments local. On Windows, invoke `gradlew.bat` instead of `./gradlew`.

## Distribution APKs

```sh
VITE_ANDROID_DISTRIBUTION=1 npm run build
npx cap sync android --deployment
node scripts/prepare-android-distribution.mjs
cd android
./gradlew assembleDistributionRelease
cd ..
```

The preparation script removes optional resources only from Capacitor's generated and ignored Android asset copy. It does not modify `public/` or `dist/`.

## Verification and staging

Run `node scripts/check-android-abi-release.mjs` after both flavors have been assembled. Copy only the four signed APKs to an ignored staging directory and run the checker again with that directory as its argument. Generate a checksum file from those staged bytes:

```sh
sha256sum babalon-1.0.1-*.apk > SHA256SUMS.txt
```

The release must contain only the four named APKs and `SHA256SUMS.txt`. Never upload the keystore, properties file, unsigned APKs, or intermediate build output.
