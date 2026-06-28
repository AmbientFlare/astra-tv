export interface JellyfinServerInfo {
  id: string;
  name: string;
  version: string;
  operatingSystem?: string;
}

export interface JellyfinAuthResult {
  userId: string;
  accessToken: string;
}

export interface JellyfinLibrary {
  id: string;
  name: string;
  type?: string;
}

export interface JellyfinMediaItem {
  id: string;
  name: string;
  type: string;
  imageUrl?: string;
  mediaType?: string;
  productionYear?: number;
  runTimeTicks?: number;
  resumePositionTicks?: number;
}

export interface JellyfinStreamInfo {
  itemId: string;
  mediaSourceId?: string;
  playSessionId?: string;
  playMethod: 'DirectPlay' | 'DirectStream' | 'Transcode';
  runTimeTicks?: number;
  startPositionTicks?: number;
  url: string;
}

export interface PlaybackReportInput {
  itemId: string;
  mediaSourceId?: string;
  playSessionId?: string;
  playMethod?: JellyfinStreamInfo['playMethod'];
  positionTicks?: number;
  runTimeTicks?: number;
  isPaused?: boolean;
}

export interface DiscoveredServer {
  id: string;
  name: string;
  address: string;
}

interface DiscoveryOptions {
  subnetPrefixes?: string[];
  timeoutMs?: number;
}

const AUTH_HEADER =
  'MediaBrowser Client="Astra", Device="FireTV", DeviceId="astra-device-001", Version="0.1.0"';

const normalizeServerUrl = (serverUrl: string) =>
  serverUrl.trim().replace(/\/+$/, '');

const buildUrl = (
  baseUrl: string,
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
) => {
  const url = new URL(`${baseUrl}${path}`);

  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  return url.toString();
};

const getJson = async <ResponseBody>(
  url: string,
  options: {
    body?: string;
    headers?: Record<string, string>;
    method?: string;
  } = {},
  timeoutMs = 5000,
): Promise<ResponseBody> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Jellyfin request failed ${response.status}: ${url}`);
    }

    const text = await response.text();

    return (text ? JSON.parse(text) : undefined) as ResponseBody;
  } finally {
    clearTimeout(timeout);
  }
};

export const connect = async (
  serverUrl: string,
): Promise<JellyfinServerInfo> => {
  const baseUrl = normalizeServerUrl(serverUrl);
  const response = await getJson<{
    Id?: string;
    ServerName?: string;
    Version?: string;
    OperatingSystem?: string;
  }>(`${baseUrl}/System/Info/Public`);

  return {
    id: response.Id ?? baseUrl,
    name: response.ServerName ?? 'Jellyfin Server',
    version: response.Version ?? 'unknown',
    operatingSystem: response.OperatingSystem,
  };
};

export const authenticate = async (
  serverUrl: string,
  username: string,
  password: string,
): Promise<JellyfinAuthResult> => {
  const baseUrl = normalizeServerUrl(serverUrl);
  const response = await getJson<{
    User?: {Id?: string};
    AccessToken?: string;
  }>(`${baseUrl}/Users/AuthenticateByName`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Emby-Authorization': AUTH_HEADER,
    },
    body: JSON.stringify({
      Username: username,
      Pw: password,
    }),
  });

  if (!response.User?.Id || !response.AccessToken) {
    throw new Error('Jellyfin authentication response was missing credentials');
  }

  return {
    userId: response.User.Id,
    accessToken: response.AccessToken,
  };
};

export const getLibraries = async (
  serverUrl: string,
  accessToken: string,
): Promise<JellyfinLibrary[]> => {
  const baseUrl = normalizeServerUrl(serverUrl);
  const response = await getJson<{
    Items?: Array<{
      Id?: string;
      Name?: string;
      CollectionType?: string;
      Type?: string;
    }>;
  }>(`${baseUrl}/Library/MediaFolders`, {
    headers: {
      'X-Emby-Token': accessToken,
    },
  });

  return (response.Items ?? []).map((library) => ({
    id: library.Id ?? library.Name ?? '',
    name: library.Name ?? 'Library',
    type: library.CollectionType ?? library.Type,
  }));
};

export const getItems = async (
  serverUrl: string,
  accessToken: string,
  libraryId: string,
  userId?: string,
): Promise<JellyfinMediaItem[]> => {
  const baseUrl = normalizeServerUrl(serverUrl);
  const itemsPath = userId ? `/Users/${userId}/Items` : '/Items';
  const response = await getJson<{
    Items?: Array<{
      Id?: string;
      Name?: string;
      Type?: string;
      MediaType?: string;
      ProductionYear?: number;
      ImageTags?: {Primary?: string};
      RunTimeTicks?: number;
      UserData?: {PlaybackPositionTicks?: number};
    }>;
  }>(
    buildUrl(baseUrl, itemsPath, {
      ParentId: libraryId,
      Recursive: true,
      IncludeItemTypes: 'Movie,Series,Episode,Video',
      Fields:
        'MediaSources,MediaStreams,Overview,PrimaryImageAspectRatio,ProductionYear,UserData',
      ImageTypeLimit: 1,
      EnableImageTypes: 'Primary,Backdrop',
      SortBy: 'SortName',
      SortOrder: 'Ascending',
    }),
    {
      headers: {
        'X-Emby-Token': accessToken,
      },
    },
  );

  return (response.Items ?? []).map((item) => ({
    id: item.Id ?? item.Name ?? '',
    name: item.Name ?? 'Untitled',
    type: item.Type ?? 'Media',
    mediaType: item.MediaType,
    productionYear: item.ProductionYear,
    imageUrl: item.Id
      ? buildUrl(baseUrl, `/Items/${item.Id}/Images/Primary`, {
          fillWidth: 360,
          quality: 90,
          tag: item.ImageTags?.Primary,
          api_key: accessToken,
        })
      : undefined,
    runTimeTicks: item.RunTimeTicks,
    resumePositionTicks: item.UserData?.PlaybackPositionTicks,
  }));
};

export const getStreamUrl = async (
  serverUrl: string,
  accessToken: string,
  itemId: string,
  userId?: string,
  startPositionTicks = 0,
): Promise<JellyfinStreamInfo> => {
  const baseUrl = normalizeServerUrl(serverUrl);
  const response = await getJson<{
    PlaySessionId?: string;
    MediaSources?: Array<{
      Id?: string;
      RunTimeTicks?: number;
      Container?: string;
      ETag?: string;
      TranscodingUrl?: string;
      SupportsDirectPlay?: boolean;
      SupportsDirectStream?: boolean;
      SupportsTranscoding?: boolean;
    }>;
  }>(`${baseUrl}/Items/${itemId}/PlaybackInfo`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Emby-Authorization': AUTH_HEADER,
      'X-Emby-Token': accessToken,
    },
    body: JSON.stringify({
      UserId: userId,
      StartTimeTicks: startPositionTicks,
      EnableDirectPlay: true,
      EnableDirectStream: true,
      AllowVideoStreamCopy: true,
      AllowAudioStreamCopy: true,
      AutoOpenLiveStream: true,
    }),
  });
  const mediaSource = response.MediaSources?.[0];
  const playMethod = mediaSource?.SupportsDirectPlay
    ? 'DirectPlay'
    : mediaSource?.SupportsDirectStream
    ? 'DirectStream'
    : 'Transcode';
  const url =
    playMethod === 'DirectPlay' || !mediaSource?.TranscodingUrl
      ? buildUrl(baseUrl, `/Videos/${itemId}/stream`, {
          static: true,
          MediaSourceId: mediaSource?.Id,
          PlaySessionId: response.PlaySessionId,
          tag: mediaSource?.ETag,
          api_key: accessToken,
        })
      : buildUrl(baseUrl, mediaSource.TranscodingUrl);

  return {
    itemId,
    mediaSourceId: mediaSource?.Id,
    playSessionId: response.PlaySessionId,
    playMethod,
    runTimeTicks: mediaSource?.RunTimeTicks,
    startPositionTicks,
    url,
  };
};

const reportPlayback = async (
  serverUrl: string,
  accessToken: string,
  endpoint: 'Playing' | 'Playing/Progress' | 'Playing/Stopped',
  input: PlaybackReportInput,
) => {
  const baseUrl = normalizeServerUrl(serverUrl);
  const body =
    endpoint === 'Playing/Stopped'
      ? {
          ItemId: input.itemId,
          MediaSourceId: input.mediaSourceId,
          PlaySessionId: input.playSessionId,
          PositionTicks: input.positionTicks,
          Failed: false,
        }
      : {
          ItemId: input.itemId,
          MediaSourceId: input.mediaSourceId,
          PlaySessionId: input.playSessionId,
          PositionTicks: input.positionTicks,
          CanSeek: (input.runTimeTicks ?? 0) > 0,
          IsPaused: input.isPaused ?? false,
          IsMuted: false,
          PlayMethod: input.playMethod ?? 'DirectPlay',
          RepeatMode: 'RepeatNone',
          PlaybackOrder: 'Default',
        };

  await getJson(`${baseUrl}/Sessions/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Emby-Token': accessToken,
    },
    body: JSON.stringify(body),
  });
};

export const reportPlaybackStart = (
  serverUrl: string,
  accessToken: string,
  input: PlaybackReportInput,
) => reportPlayback(serverUrl, accessToken, 'Playing', input);

export const reportPlaybackProgress = (
  serverUrl: string,
  accessToken: string,
  input: PlaybackReportInput,
) => reportPlayback(serverUrl, accessToken, 'Playing/Progress', input);

export const reportPlaybackStopped = (
  serverUrl: string,
  accessToken: string,
  input: PlaybackReportInput,
) => reportPlayback(serverUrl, accessToken, 'Playing/Stopped', input);

const scanCandidate = async (
  address: string,
  timeoutMs: number,
): Promise<DiscoveredServer | null> => {
  try {
    const response = await getJson<{
      Id?: string;
      ServerName?: string;
    }>(`${address}/System/Info/Public`, {}, timeoutMs);

    return {
      id: response.Id ?? address,
      name: response.ServerName ?? 'Jellyfin Server',
      address,
    };
  } catch {
    return null;
  }
};

export const discoverServers = async ({
  subnetPrefixes = ['192.168.0', '192.168.1'],
  timeoutMs = 300,
}: DiscoveryOptions = {}): Promise<DiscoveredServer[]> => {
  const candidates = subnetPrefixes.flatMap((prefix) =>
    Array.from(
      {length: 254},
      (_, index) => `http://${prefix}.${index + 1}:8096`,
    ),
  );
  const discovered = new Map<string, DiscoveredServer>();
  const workers = Array.from({length: 48}, async (_, workerIndex) => {
    for (
      let candidateIndex = workerIndex;
      candidateIndex < candidates.length;
      candidateIndex += 48
    ) {
      const server = await scanCandidate(candidates[candidateIndex], timeoutMs);

      if (server) {
        discovered.set(server.address, server);
      }
    }
  });

  await Promise.all(workers);

  return Array.from(discovered.values());
};
