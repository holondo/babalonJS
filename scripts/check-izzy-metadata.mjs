import { readFileSync } from 'node:fs';

const metadata = readFileSync('packaging/izzyondroid/com.holondo.babalon.yml', 'utf8');
const match = metadata.match(/^\s+ApkMatch:\s*\/(.+)\/$/m);
if (!match) throw new Error('IzzyOnDroid metadata must contain a slash-delimited ApkMatch.');

const apkMatch = new RegExp(match[1]);
const accepted = ['babalon-1.0.1-distribution-arm64-v8a.apk'];
const rejected = [
  'babalon-1.0.1-distribution-armeabi-v7a.apk',
  'babalon-1.0.1-offline-arm64-v8a.apk',
  'babalon-1.0.1-offline-armeabi-v7a.apk',
  'babalon-1.0.1-distribution-arm64-v8a-debug.apk',
  'babalon-1.0.1-distribution-arm64-v8a-unsigned.apk',
  'other.apk',
  'babalon-1.0-distribution-arm64-v8a.apk',
];

for (const name of accepted) if (!apkMatch.test(name)) throw new Error(`ApkMatch rejected valid asset: ${name}`);
for (const name of rejected) if (apkMatch.test(name)) throw new Error(`ApkMatch accepted invalid asset: ${name}`);

console.log('IzzyOnDroid ApkMatch accepts only the signed ARM64 distribution asset.');
