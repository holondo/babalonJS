import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.holondo.babalon',
  appName: 'babalon JS',
  webDir: 'dist',
  backgroundColor: '#120d1b',
  android: {
    backgroundColor: '#120d1b',
  },
  server: {
    androidScheme: 'https',
  },
  plugins: {
    StatusBar: {
      backgroundColor: '#120d1b',
      style: 'DARK',
    },
  },
};

export default config;
