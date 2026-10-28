import {useCallback, useEffect, useRef, useState} from 'react';

type NetState = {isConnected?: boolean | null};
type NetInfoApi = {
  configure?: (configuration: {reachabilityShouldRun: () => boolean}) => void;
  addEventListener?: (listener: (state: NetState) => void) => () => void;
  refresh?: () => Promise<NetState>;
  fetch?: () => Promise<NetState>;
};

let netInfoModule: NetInfoApi | null | undefined;

// Loaded on first use: a missing native module (tests, the virtual device)
// must leave Astra online, not stop the screen from mounting.
const netInfo = (): NetInfoApi | null => {
  if (netInfoModule !== undefined) {
    return netInfoModule;
  }
  try {
    const loaded = require('@amazon-devices/keplerscript-netmgr-lib') as {
      default?: NetInfoApi;
    } & NetInfoApi;
    netInfoModule = loaded.default ?? loaded;
    // The library's own reachability check requests a Google URL whenever
    // the system does not report reachability itself. Astra trusts the
    // system's connected flag instead, so it contacts only the user's server.
    netInfoModule.configure?.({reachabilityShouldRun: () => false});
  } catch {
    netInfoModule = null;
  }
  return netInfoModule;
};

// Only a definite "not connected" counts: an unknown state stays online.
const isOnline = (state: NetState | undefined) => state?.isConnected !== false;

export const watchConnection = (
  listener: (online: boolean) => void,
): (() => void) => {
  try {
    const unsubscribe = netInfo()?.addEventListener?.((state) =>
      listener(isOnline(state)),
    );
    return typeof unsubscribe === 'function' ? unsubscribe : () => undefined;
  } catch {
    return () => undefined;
  }
};

export const checkConnection = async (): Promise<boolean> => {
  try {
    const api = netInfo();
    const read = api?.refresh ?? api?.fetch;
    return read ? isOnline(await read()) : true;
  } catch {
    return true;
  }
};

/** A drop shorter than this (a Wi-Fi roam, a DHCP renewal) shows nothing. */
export const CONNECTION_LOSS_GRACE_MS = 3000;

/**
 * `lost` turns true once the network has been gone for the grace period and
 * stays true until `retry` finds it back, so a screen reloads on purpose
 * rather than half-recovering on its own.
 */
export const useConnectionLoss = (enabled = true) => {
  const [lost, setLost] = useState(false);
  const [checking, setChecking] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) {
      // Whoever is watching instead owns the notice for now.
      setLost(false);
      return undefined;
    }
    const clear = () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
    const stop = watchConnection((online) => {
      if (online) {
        clear();
      } else if (!timer.current) {
        timer.current = setTimeout(() => {
          timer.current = null;
          setLost(true);
        }, CONNECTION_LOSS_GRACE_MS);
      }
    });
    return () => {
      clear();
      stop();
    };
  }, [enabled]);

  const retry = useCallback(async () => {
    setChecking(true);
    try {
      const online = await checkConnection();
      if (online) {
        setLost(false);
      }
      return online;
    } finally {
      setChecking(false);
    }
  }, []);

  return {lost, checking, retry};
};
