import {JellyfinMediaItem} from '../jellyfin';
import {normalizeServerUrl} from '../serverUrl';
import {ServerProfile} from '../storage';
import {APP_VERSION} from '../../config/app';

export interface NebulaCapabilities {
  apiVersion: number;
  features: {
    hierarchyPrefetch?: boolean;
    playbackPrefetch?: boolean;
    seasonHydration?: boolean;
    seriesHydration?: boolean;
  };
}

const CAPABILITY_TIMEOUT_MS = 2500;
const HYDRATION_TIMEOUT_MS = 15000;
const PREFETCH_TTL_MS = 10 * 60 * 1000;

const capabilityRequests = new Map<
  string,
  Promise<NebulaCapabilities | null>
>();
const hydrationRequests = new Map<
  string,
  {startedAt: number; request: Promise<boolean>}
>();

const authHeaders = (accessToken: string) => {
  const authorization = `MediaBrowser Client="Astra", Device="FireTV", DeviceId="astra-device-001", Version="${APP_VERSION}", Token="${accessToken}"`;
  return {
    Authorization: authorization,
    'X-Emby-Authorization': authorization,
    'X-Emby-Token': accessToken,
    'X-MediaBrowser-Token': accessToken,
  };
};

const requestJson = async <ResponseBody>(
  url: string,
  accessToken: string,
  method = 'GET',
  timeoutMs = CAPABILITY_TIMEOUT_MS,
): Promise<ResponseBody> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: authHeaders(accessToken),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Nebula capability request failed (${response.status}).`);
    }
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as ResponseBody;
  } finally {
    clearTimeout(timeout);
  }
};

const nebulaUrl = (
  profile: ServerProfile,
  path: string,
  includeUserId = false,
) => {
  const url = new URL(path, `${normalizeServerUrl(profile.serverUrl)}/`);
  if (includeUserId) {
    url.searchParams.set('userId', profile.userId);
  }
  return url.toString();
};

const serverKey = (profile: ServerProfile) =>
  `${normalizeServerUrl(profile.serverUrl)}:${profile.userId}`;

export const detectNebulaCapabilities = (
  profile: ServerProfile,
): Promise<NebulaCapabilities | null> => {
  const key = serverKey(profile);
  const existing = capabilityRequests.get(key);
  if (existing) {
    return existing;
  }

  const request = requestJson<NebulaCapabilities>(
    nebulaUrl(profile, '/NebulaBridge/Capabilities'),
    profile.accessToken,
  )
    .then((capabilities) => {
      if (capabilities?.apiVersion !== 1) {
        console.log('[Astra] Nebula Bridge capability API is unsupported.');
        return null;
      }

      console.log(
        '[Astra] Nebula Bridge detected: API version 1; hierarchy prefetch',
        capabilities.features?.hierarchyPrefetch ? 'supported' : 'unsupported',
      );
      return capabilities;
    })
    .catch(() => null);

  capabilityRequests.set(key, request);
  return request;
};

/** Starts capability discovery without making connection success depend on it. */
export const probeNebulaCapabilities = (profile: ServerProfile) => {
  detectNebulaCapabilities(profile).catch(() => null);
};

const hydrationRoute = (
  capabilities: NebulaCapabilities,
  item: JellyfinMediaItem,
) => {
  if (
    item.type === 'Series' &&
    capabilities.features.hierarchyPrefetch &&
    capabilities.features.seriesHydration
  ) {
    return `/NebulaBridge/Hydrate/Series/${item.id}`;
  }
  if (
    item.type === 'Season' &&
    capabilities.features.hierarchyPrefetch &&
    capabilities.features.seasonHydration
  ) {
    return `/NebulaBridge/Hydrate/Season/${item.id}`;
  }
  return null;
};

/**
 * Ensures a Series/Season hierarchy is being prepared. Concurrent focus/open calls join the
 * same request, successful work is briefly cached, and every optional failure becomes false.
 */
export const hydrateNebulaHierarchy = async (
  profile: ServerProfile,
  item: JellyfinMediaItem,
): Promise<boolean> => {
  if (item.type !== 'Series' && item.type !== 'Season') {
    return false;
  }

  // Connection/focus normally starts discovery first. If a screen is rendered directly on an
  // ordinary server, start the optional probe but do not hold up its standard Jellyfin request.
  if (!capabilityRequests.has(serverKey(profile))) {
    detectNebulaCapabilities(profile).catch(() => null);
    return false;
  }

  const capabilities = await detectNebulaCapabilities(profile);
  if (!capabilities) {
    return false;
  }

  const route = hydrationRoute(capabilities, item);
  if (!route) {
    return false;
  }

  const key = `${serverKey(profile)}:${item.type}:${item.id}`;
  const existing = hydrationRequests.get(key);
  if (existing && Date.now() - existing.startedAt < PREFETCH_TTL_MS) {
    return existing.request;
  }

  console.log(`[Astra] Nebula hierarchy prefetch requested: ${item.type}`);
  const request = requestJson(
    nebulaUrl(profile, route, true),
    profile.accessToken,
    'POST',
    HYDRATION_TIMEOUT_MS,
  )
    .then(() => true)
    .catch(() => {
      hydrationRequests.delete(key);
      return false;
    });

  hydrationRequests.set(key, {startedAt: Date.now(), request});
  return request;
};

/** Non-blocking TV-focus hook. */
export const prefetchNebulaHierarchy = (
  profile: ServerProfile,
  item: JellyfinMediaItem,
) => {
  if (item.type !== 'Series' && item.type !== 'Season') {
    return;
  }
  detectNebulaCapabilities(profile)
    .then(() => hydrateNebulaHierarchy(profile, item))
    .catch(() => false);
};

export const clearNebulaSessionCache = () => {
  capabilityRequests.clear();
  hydrationRequests.clear();
};
