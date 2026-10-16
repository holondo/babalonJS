const WEB_ASSET_ROOT = 'https://holondo.github.io/babalonJS/';
const DISTRIBUTION_BUILD = import.meta.env.VITE_ANDROID_DISTRIBUTION === '1';

/** Only the small Android distribution build loads omitted opt-in assets upstream. */
export function optionalAssetUrl(path: string) {
  return DISTRIBUTION_BUILD
    ? `${WEB_ASSET_ROOT}${path}`
    : `${import.meta.env.BASE_URL}${path}`;
}
