import {Platform} from 'react-native';

/**
 * Which Fire TV this is, and the decoder limits Amazon publishes for it.
 *
 * The model code comes from the platform constants React Native already
 * carries on Kepler, so no native module or privilege is needed. The table is
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
}

const MBPS = 1_000_000;

export const KNOWN_DEVICES: Readonly<Record<string, KnownDevice>> = {
  AFTCA002: {name: 'Fire TV Stick 4K Select', h264MaxBitrate: 30 * MBPS},
  AFTCR001: {name: 'Fire TV Stick 4K (3rd Gen)', h264MaxBitrate: 20 * MBPS},
  AFTCL001: {name: 'Fire TV Stick HD (2026)', h264MaxBitrate: 20 * MBPS},
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

let cached: DeviceModel | undefined;

export const readDeviceModel = (): DeviceModel => {
  if (cached) {
    return cached;
  }
  let constants: KeplerConstants = {};
  try {
    constants = (Platform.constants ?? {}) as KeplerConstants;
  } catch {
    // A host without the constants module answers nothing, not an error.
  }
  cached = {
    model: text(constants.Model).toUpperCase(),
    os: text(constants.Release) || text(constants.Version),
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
