import {AsyncStorage} from '@amazon-devices/react-native-kepler';
import {getFriendlyDeviceName} from '@astra/device-info';

const STORAGE_KEY = 'astra.deviceIdentity.v1';
const DEFAULT_DEVICE_NAME = 'FireTV';

const randomId = () => {
  const cryptoApi = (global as {crypto?: {randomUUID?: () => string}}).crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  // This is an installation identifier, not a credential. The time component
  // makes the fallback safe even on runtimes without Web Crypto.
  return `astra-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}-${Math.random().toString(36).slice(2)}`;
};

/**
 * The name travels in the `MediaBrowser` authorization header, whose fields are
 * double-quoted and must stay within a legal HTTP header value. A friendly name
 * is user-supplied UTF-8 of up to 60 bytes, so strip anything that would break
 * the header rather than trusting it.
 */
const sanitizeDeviceName = (value: string) => {
  const cleaned = value
    .replace(/[^\x20-\x7e]/g, ' ')
    .replace(/["\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return cleaned || DEFAULT_DEVICE_NAME;
};

let deviceId = randomId();
let deviceName = DEFAULT_DEVICE_NAME;
let initialization: Promise<string> | undefined;
const isValidId = (value: string) =>
  /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/.test(value);

export const initializeDeviceIdentity = (): Promise<string> => {
  if (!initialization) {
    initialization = (async () => {
      deviceName = sanitizeDeviceName(getFriendlyDeviceName());
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

/**
 * The name this install reports to servers. Falls back to `FireTV` until
 * initialization resolves, and on hosts that expose no friendly name.
 */
export const getDeviceName = () => deviceName;
