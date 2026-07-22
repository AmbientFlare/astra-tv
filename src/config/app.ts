export const APP_VERSION = '1.0.3';
export const BUILD_NUMBER = '20260721.1';
export const BUILD_DATE = '2026-07-21';

// Physical-device testing confirmed that this Fire TV/Vega HLS/fMP4 path
// rejects a DTS-HD remux. Keep the diagnostic switch available for isolated
// tests, but never advertise unverified DTS in a production build.
export const ENABLE_UNVERIFIED_DTS_REMUX_TRIAL = false;
