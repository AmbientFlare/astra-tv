import {AsyncStorage} from '@amazon-devices/react-native-kepler';

const STORAGE_KEY = 'astra.deviceIdentity.v1';

const randomId = () => {
  const cryptoApi = (global as {crypto?: {randomUUID?: () => string}}).crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  // This is an installation identifier, not a credential. The time component
  // makes the fallback safe even on runtimes without Web Crypto.
  return `astra-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}-${Math.random().toString(36).slice(2)}`;
};

let deviceId = randomId();
let initialization: Promise<string> | undefined;
const isValidId = (value: string) =>
  /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/.test(value);

export const initializeDeviceIdentity = (): Promise<string> => {
  if (!initialization) {
    initialization = (async () => {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored && isValidId(stored.trim())) {
        deviceId = stored.trim();
      } else {
        await AsyncStorage.setItem(STORAGE_KEY, deviceId);
      }
      return deviceId;
    })().catch((error) => {
      initialization = undefined;
      throw error;
    });
  }
  return initialization;
};

/** Synchronous accessor for URL/header builders; bootstrap should initialize first. */
export const getDeviceId = () => deviceId;
