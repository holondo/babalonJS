import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join('android', 'app', 'build', 'outputs', 'apk');
const maxDistributionBytes = 30_000_000;
const expectedCertificate = '1bb33ae3c61f661b857b077f07b9990c301647b8f71c9814fb7179b09e99e01e';
const variants = [
  { flavor: 'offline', abi: 'armeabi-v7a', versionCode: '201', limited: false },
  { flavor: 'offline', abi: 'arm64-v8a', versionCode: '202', limited: false },
  { flavor: 'distribution', abi: 'armeabi-v7a', versionCode: '201', limited: true },
  { flavor: 'distribution', abi: 'arm64-v8a', versionCode: '202', limited: true },
];

const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
  || (process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Android', 'Sdk'));
const buildToolsRoot = sdk && join(sdk, 'build-tools');
const buildTools = buildToolsRoot && existsSync(buildToolsRoot)
  ? readdirSync(buildToolsRoot).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0]
  : undefined;
const extension = process.platform === 'win32' ? '.exe' : '';
const aapt = buildTools && join(buildToolsRoot, buildTools, `aapt${extension}`);
const apksigner = buildTools && join(buildToolsRoot, buildTools, process.platform === 'win32' ? 'lib/apksigner.jar' : 'apksigner');

if (!aapt || !apksigner || !existsSync(aapt) || !existsSync(apksigner)) {
  throw new Error('Android SDK build-tools with aapt and apksigner are required.');
}

const signerCommand = process.platform === 'win32' ? 'java' : apksigner;
const signerPrefix = process.platform === 'win32' ? ['-jar', apksigner] : [];

for (const variant of variants) {
  const file = join(root, variant.flavor, 'release', `babalon-1.0.1-${variant.flavor}-${variant.abi}.apk`);
  if (!existsSync(file)) throw new Error(`Missing release APK: ${file}`);

  const bytes = statSync(file).size;
  if (variant.limited && bytes > maxDistributionBytes) {
    throw new Error(`${file} is ${(bytes / 1_000_000).toFixed(2)} MB; IzzyOnDroid allows at most 30 MB.`);
  }

  const badging = execFileSync(aapt, ['dump', 'badging', file], { encoding: 'utf8' });
  if (!badging.includes("package: name='com.holondo.babalon'")) throw new Error(`${file}: unexpected package ID.`);
  if (!badging.includes(`versionCode='${variant.versionCode}'`)) throw new Error(`${file}: unexpected versionCode.`);
  if (!badging.includes("versionName='1.0.1'")) throw new Error(`${file}: unexpected versionName.`);
  if (!badging.includes(`native-code: '${variant.abi}'`)) throw new Error(`${file}: unexpected native ABI.`);
  if (/application-debuggable|testOnly='true'/.test(badging)) throw new Error(`${file}: release must not be debuggable or test-only.`);

  const signer = execFileSync(signerCommand, [...signerPrefix, 'verify', '--print-certs', file], { encoding: 'utf8' });
  const match = signer.match(/SHA-256 digest: ([0-9a-f]+)/i);
  if (!match || match[1].toLowerCase() !== expectedCertificate) throw new Error(`${file}: unexpected signing certificate.`);

  const entries = execFileSync(aapt, ['list', file], { encoding: 'utf8' });
  const optionalAssets = [
    'assets/public/models/mannequin.glb',
    'assets/public/animations/Idle_Loop.glb',
    'assets/public/environments/neutral.env',
  ];
  const startupAsset = 'assets/public/environments/studio.env';
  if (!entries.includes(startupAsset)) throw new Error(`${file}: missing startup environment.`);
  for (const asset of optionalAssets) {
    if (variant.flavor === 'offline' && !entries.includes(asset)) throw new Error(`${file}: offline variant is missing ${asset}.`);
    if (variant.flavor === 'distribution' && entries.includes(asset)) throw new Error(`${file}: distribution variant unexpectedly contains ${asset}.`);
  }
}

console.log('Four signed Android variant/ABI APKs passed structural release checks.');
