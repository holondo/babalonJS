import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const publicDir = join('android', 'app', 'src', 'main', 'assets', 'public');
const omitted = [
  'screenshots',
  'icons',
  'animations',
  'models',
  'environments/neutral.env',
  'environments/room.env',
  'environments/country.env',
  'environments/parking.env',
  'environments/night.env',
  'brand/lettering.png',
  'brand/logo.png',
  'favicon.ico',
  'manifest.webmanifest',
  'offline-assets.json',
  'sw.js',
];

if (!existsSync(join(publicDir, 'index.html'))) {
  throw new Error('Capacitor web assets are missing; run `npx cap sync android --deployment` first.');
}

for (const relative of omitted) {
  rmSync(join(publicDir, relative), { recursive: true, force: true });
}

for (const name of readdirSync(publicDir).filter((entry) => /^workbox-.*\.js$/.test(entry))) rmSync(join(publicDir, name));

console.log('Prepared generated Capacitor assets for the Android distribution variant.');
