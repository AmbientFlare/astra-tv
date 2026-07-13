import NextAsyncStorage from '@amazon-devices/react-native-async-storage__async-storage';
import {AsyncStorage as LegacyAsyncStorage} from '@amazon-devices/react-native-kepler';

// Kepler's built-in `AsyncStorage` is on a documented deprecation path; the
// `react-native-async-storage__async-storage` package above is the supported,
// durable store we want persisted data (server profiles, prefs) to live in.
//
// Its native module can't be verified on this device yet (Fire Stick USB is
// down), so every operation transparently falls back to the legacy store if
// the new one is unavailable at runtime. That guarantees behavior can never
// regress below today's: worst case we keep reading/writing exactly where we
// always have. Once verified on-device the fallback can be dropped.
let legacyFallback = false;

const withFallback = async <T>(
  next: () => Promise<T>,
  legacy: () => Promise<T>,
): Promise<T> => {
  if (legacyFallback) {
    return legacy();
  }
  try {
    return await next();
  } catch (error) {
    legacyFallback = true;
    console.warn(
      '[Astra] Supported AsyncStorage unavailable; falling back to legacy store.',
      error,
    );
    return legacy();
  }
};

export const getItem = (key: string): Promise<string | null> =>
  withFallback(
    () => NextAsyncStorage.getItem(key),
    () => LegacyAsyncStorage.getItem(key),
  );

export const setItem = (key: string, value: string): Promise<void> =>
  withFallback(
    () => NextAsyncStorage.setItem(key, value),
    () => LegacyAsyncStorage.setItem(key, value),
  );

export const removeItem = (key: string): Promise<void> =>
  withFallback(
    () => NextAsyncStorage.removeItem(key),
    () => LegacyAsyncStorage.removeItem(key),
  );

const MIGRATION_MARKER_KEY = 'astra.storageMigration.v1';

// Every persisted key the app owns. Copied legacy → new once so an existing
// install's saved server profile/prefs carry over the first time it runs a
// build that uses the supported store.
const MIGRATED_KEYS = [
  'astra.serverProfiles.v1',
  'astra.appState.v1',
  'astra.displayPreferences.v1',
  'astra.userPreferences.v1',
  'astra.playbackPrefs.v1',
];

// One-time copy of existing data from the legacy store into the supported one.
// Safe to call on every launch: it no-ops once the marker is set, never
// clobbers a value already present in the new store, and swallows all errors
// (a failed migration must never block app start). No-op if the new store is
// unavailable — in that case data simply stays in the legacy store we read.
export const runStorageMigration = async (): Promise<void> => {
  try {
    const alreadyMigrated = await getItem(MIGRATION_MARKER_KEY);
    if (legacyFallback || alreadyMigrated) {
      return;
    }

    for (const key of MIGRATED_KEYS) {
      const existing = await NextAsyncStorage.getItem(key);
      if (existing != null) {
        continue;
      }
      const legacyValue = await LegacyAsyncStorage.getItem(key);
      if (legacyValue != null) {
        await NextAsyncStorage.setItem(key, legacyValue);
      }
    }

    await NextAsyncStorage.setItem(MIGRATION_MARKER_KEY, String(Date.now()));
  } catch (error) {
    console.warn('[Astra] Storage migration skipped:', error);
  }
};
