import {Platform} from 'react-native';

/**
 * Which Fire TV this is, and the decoder limits Amazon publishes for it.
 *
 * The model code comes from Amazon's device-info module. Kepler's platform
 * constants are typed with a model too but leave it out on real sticks, so
 * they are only a fallback. The table is
 * Amazon's device specification page for the Vega sticks; a model missing from
 * it gets the strictest published limits, which are the newer sticks'.
 * https://developer.amazon.com/docs/device-specs/device-specifications-fire-tv-streaming-media-player.html
 */

export interface DeviceModel {
  /** Amazon's build model, e.g. AFTCR001, or '' when the platform hides it. */
  model: string;
  /** The OS release the platform reports, or '' when it reports none. */
  os: string;
}

export interface KnownDevice {
  name: string;
  /** Highest H.264 bitrate the decoder is specified for, in bits per second. */
  h264MaxBitrate: number;
  /**
   * Widest frame the stick decodes, when it is below UHD. Only the HD stick
   * has one; it is the fallback for when the runtime decoder probe gives no
   * usable answer (issue #21). A measured answer always wins over this.
   */
  maxVideoWidth?: number;
}

const MBPS = 1_000_000;

export const KNOWN_DEVICES: Readonly<Record<string, KnownDevice>> = {
  AFTCA002: {name: 'Fire TV Stick 4K Select', h264MaxBitrate: 30 * MBPS},
  AFTCR001: {name: 'Fire TV Stick 4K (3rd Gen)', h264MaxBitrate: 20 * MBPS},
  AFTCL001: {
    name: 'Fire TV Stick HD (2026)',
    h264MaxBitrate: 20 * MBPS,
    maxVideoWidth: 1920,
  },
};

const UNKNOWN_DEVICE: KnownDevice = {
  name: 'Unknown Fire TV',
  h264MaxBitrate: 20 * MBPS,
};

type KeplerConstants = {
  Model?: unknown;
  Release?: unknown;
  Version?: unknown;
};

const text = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).trim().slice(0, 64)
    : '';

type DeviceInfoModule = {
  getModel?: () => unknown;
  getSystemVersion?: () => unknown;
};

// The library answers 'unknown' rather than nothing when it cannot tell.
const reported = (value: unknown) => {
  const result = text(value);
  return result.toLowerCase() === 'unknown' ? '' : result;
};

const fromDeviceInfo = (): DeviceModel => {
  try {
    const deviceInfo =
      require('@amazon-devices/react-native-device-info') as DeviceInfoModule & {
        default?: DeviceInfoModule;
      };
    const api = deviceInfo.default ?? deviceInfo;
    return {
      model: reported(api.getModel?.()),
      os: reported(api.getSystemVersion?.()),
    };
  } catch {
    // No native module (tests, the virtual device): use the fallback.
    return {model: '', os: ''};
  }
};

const fromPlatformConstants = (): DeviceModel => {
  let constants: KeplerConstants = {};
  try {
    constants = (Platform.constants ?? {}) as KeplerConstants;
  } catch {
    // A host without the constants module answers nothing, not an error.
  }
  return {
    model: text(constants.Model),
    os: text(constants.Release) || text(constants.Version),
  };
};

let cached: DeviceModel | undefined;

export const readDeviceModel = (): DeviceModel => {
  if (cached) {
    return cached;
  }
  const primary = fromDeviceInfo();
  const fallback =
    primary.model && primary.os ? primary : fromPlatformConstants();
  cached = {
    model: (primary.model || fallback.model).toUpperCase(),
    os: primary.os || fallback.os,
  };
  return cached;
};

export const knownDevice = (model: string): KnownDevice =>
  KNOWN_DEVICES[model] ?? UNKNOWN_DEVICE;

/** One line for Stats for Nerds. */
export const describeDeviceModel = (device: DeviceModel): string => {
  const known = KNOWN_DEVICES[device.model];
  const name = known ? known.name : device.model || 'model not reported';
  return device.os ? `${name} · OS ${device.os}` : name;
};

/** Test hook: forget the cached answer. */
export const resetDeviceModelCache = () => {
  cached = undefined;
};
