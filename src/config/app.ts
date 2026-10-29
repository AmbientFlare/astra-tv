export const APP_VERSION = '1.6.1';
export const BUILD_NUMBER = '20261029.01';
export const BUILD_DATE = '2026-10-29';

// Physical-device testing confirmed that this Fire TV/Vega HLS/fMP4 path
// rejects a DTS-HD remux. Keep the diagnostic switch available for isolated
// tests, but never advertise unverified DTS in a production build.
export const ENABLE_UNVERIFIED_DTS_REMUX_TRIAL = false;

// Shown as a QR code on About, in What's New and on the one-time support card.
export const KOFI_URL = 'https://ko-fi.com/astrafiretv';
