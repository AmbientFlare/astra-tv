export const APP_VERSION = '1.1.2';
export const BUILD_NUMBER = '20260822.4';
export const BUILD_DATE = '2026-08-22';

// Physical-device testing confirmed that this Fire TV/Vega HLS/fMP4 path
// rejects a DTS-HD remux. Keep the diagnostic switch available for isolated
// tests, but never advertise unverified DTS in a production build.
export const ENABLE_UNVERIFIED_DTS_REMUX_TRIAL = false;
