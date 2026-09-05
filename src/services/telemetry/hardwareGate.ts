import {
  NetworkManager,
  NetworkInterfaceType,
  Status,
  type NetworkInterface,
} from '@amazon-devices/keplerscript-netmgr-lib';

import {TELEMETRY_MAC_ALLOWLIST} from './config';

export interface MacReadResult {
  /** Normalised, de-duplicated, sorted. Sorted so the derived id is stable. */
  macs: string[];
  /** Per-interface outcome, for on-device diagnosis. */
  detail: Array<{
    id: number;
    name: string;
    type: number;
    status: number;
    mac?: string;
  }>;
  /** Set when nothing could be read at all. */
  error?: string;
}

/** Uppercase hex only. `a4:1f:72` and `A4-1F-72` normalise to the same value. */
export const normalizeMac = (value: string): string =>
  value.replace(/[^0-9a-fA-F]/g, '').toUpperCase();

const isUsableMac = (mac: string): boolean =>
  mac.length === 12 && mac !== '000000000000';

/**
 * Reads the MAC of every interface, not just the active one. Wi-Fi and
 * Ethernet have different addresses; matching only the active interface means
 * plugging in an Ethernet adapter silently disarms telemetry.
 *
 * Never throws. A failure here must not be able to break app start.
 */
let cached: MacReadResult | undefined;
export const readMacAddresses = (): MacReadResult => {
  if (cached) {
    return cached;
  }
  cached = readInterfaces();
  return cached;
};

const readInterfaces = (): MacReadResult => {
  const detail: MacReadResult['detail'] = [];
  const macs = new Set<string>();

  try {
    const manager = new NetworkManager();
    const interfaces: NetworkInterface[] = [];
    // NONE queries every interface type. The array is filled in place.
    const listStatus = manager.getNetworkInterfaces(
      NetworkInterfaceType.NONE,
      interfaces,
    );

    // Even if enumeration fails, interface 0 (the default) is worth trying.
    const ids =
      listStatus === Status.SUCCESS && interfaces.length > 0
        ? interfaces.map((entry) => ({
            id: entry.id,
            name: entry.name,
            type: entry.type as number,
          }))
        : [{id: 0, name: 'default', type: -1}];

    for (const entry of ids) {
      let status = Status.GENERAL_ERROR as number;
      let mac: string | undefined;
      try {
        // Tuple return: [Status, string]. Check the status before trusting the
        // string — a failed call can still hand back '' or '00:00:00:00:00:00'.
        const [callStatus, raw] = manager.getMacAddress(entry.id);
        status = callStatus as number;
        if (callStatus === Status.SUCCESS && typeof raw === 'string') {
          const normalized = normalizeMac(raw);
          if (isUsableMac(normalized)) {
            mac = normalized;
            macs.add(normalized);
          }
        }
      } catch {
        // One bad interface must not abort the others.
      }
      detail.push({...entry, status, mac});
    }
  } catch (error) {
    return {
      macs: [],
      detail,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return {macs: Array.from(macs).sort(), detail};
};

/**
 * Fail-closed. An empty allowlist, an unreadable MAC, a denied privilege, a
 * thrown native call — all of them return false, and false means the telemetry
 * subsystem is never constructed.
 */
export const isAllowlistedHardware = (macs: readonly string[]): boolean => {
  if (TELEMETRY_MAC_ALLOWLIST.length === 0) {
    return false;
  }
  const allowed = new Set(
    TELEMETRY_MAC_ALLOWLIST.map(normalizeMac).filter(isUsableMac),
  );
  if (allowed.size === 0) {
    return false;
  }
  return macs.some((mac) => allowed.has(mac));
};
