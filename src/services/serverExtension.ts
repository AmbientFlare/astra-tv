import {
  buildUrl,
  getAuthHeaders,
  getJson,
  normalizeServerUrl,
} from './jellyfin/http';

/** Capability contract advertised by the optional server extension. */
export interface ServerExtensionCapabilities {
  apiVersion: number;
  availability?: {
    available?: boolean;
    hierarchyPrefetchAllowed?: boolean;
  };
  features?: {
    hierarchyPrefetch?: boolean;
    seasonHydration?: boolean;
    seriesHydration?: boolean;
  };
  supportedVersions?: number[];
}

const CAPABILITY_CACHE_MS = 5 * 60 * 1000;

interface CachedCapabilityProbe {
  expiresAt: number;
  result: Promise<ServerExtensionCapabilities | null>;
}

// This intentionally remains an in-memory cache. The endpoint is optional,
// and persisting a negative result would keep a newly installed plugin hidden
// until someone cleared app storage.
const capabilityCache = new Map<string, CachedCapabilityProbe>();

const capabilityKey = (serverUrl: string, userId: string) =>
  `${normalizeServerUrl(serverUrl).toLowerCase()}|${userId}`;

const isCompatible = (response: ServerExtensionCapabilities | undefined) =>
  response?.apiVersion === 1 &&
  (response.supportedVersions === undefined ||
    response.supportedVersions.includes(1));

/**
 * Read the optional plugin contract once per server/user for five minutes.
 * Missing, disabled, malformed, or unreachable endpoints are deliberately
 * indistinguishable to callers: they all mean use normal Jellyfin behavior.
 */
export const getServerExtensionCapabilities = (
  serverUrl: string,
  accessToken: string,
  userId: string,
): Promise<ServerExtensionCapabilities | null> => {
  const key = capabilityKey(serverUrl, userId);
  const cached = capabilityCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  const result = getJson<ServerExtensionCapabilities>(
    buildUrl(normalizeServerUrl(serverUrl), '/astra-extension/capabilities', {
      ApiKey: accessToken,
    }),
    {headers: getAuthHeaders(accessToken)},
  )
    .then((response) => {
      if (
        !isCompatible(response) ||
        response.availability?.available === false
      ) {
        return null;
      }
      return response;
    })
    .catch(() => null);

  capabilityCache.set(key, {
    expiresAt: Date.now() + CAPABILITY_CACHE_MS,
    result,
  });
  return result;
};

const canHydrate = (
  capabilities: ServerExtensionCapabilities | null,
  kind: 'seriesHydration' | 'seasonHydration',
) =>
  capabilities?.availability?.hierarchyPrefetchAllowed !== false &&
  capabilities?.features?.hierarchyPrefetch === true &&
  capabilities.features[kind] === true;

const hydrate = async (
  serverUrl: string,
  accessToken: string,
  userId: string,
  kind: 'series' | 'season',
  itemId: string,
) => {
  const capabilities = await getServerExtensionCapabilities(
    serverUrl,
    accessToken,
    userId,
  );
  if (!canHydrate(capabilities, `${kind}Hydration`)) {
    return false;
  }

  try {
    await getJson(
      buildUrl(
        normalizeServerUrl(serverUrl),
        `/astra-extension/hydrate/${kind}/${itemId}`,
        {ApiKey: accessToken},
      ),
      {headers: getAuthHeaders(accessToken), method: 'POST'},
    );
    return true;
  } catch {
    // Hydration is an optional latency improvement. The normal Jellyfin read
    // immediately following this call is authoritative and must still run.
    return false;
  }
};

export const hydrateServerExtensionSeries = (
  serverUrl: string,
  accessToken: string,
  userId: string,
  seriesId: string,
) => hydrate(serverUrl, accessToken, userId, 'series', seriesId);

export const hydrateServerExtensionSeason = (
  serverUrl: string,
  accessToken: string,
  userId: string,
  seasonId: string,
) => hydrate(serverUrl, accessToken, userId, 'season', seasonId);

/** Test-only cache reset; production entries expire naturally. */
export const resetServerExtensionCapabilityCacheForTests = () => {
  capabilityCache.clear();
};
