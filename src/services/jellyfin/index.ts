import {buildDeviceProfile} from './deviceProfile';
import {readPlaybackPreferences} from '../storage';
import {APP_VERSION} from '../../config/app';

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
  imageUrl?: string;
  name: string;
  type?: string;
}

export interface JellyfinPerson {
  birthDate?: string;
  id: string;
  imageUrl?: string;
  isFavorite?: boolean;
  name: string;
  overview?: string;
}

export interface JellyfinMediaItem {
  id: string;
  name: string;
  type: string;
  backdropImageTags?: string[];
  chapters?: JellyfinChapter[];
  childCount?: number | null;
  imageUrl?: string;
  backdropUrl?: string;
  communityRating?: number | null;
  criticsRating?: number;
  genres?: string[];
  indexNumber?: number;
  isFavorite?: boolean;
  isPlayed?: boolean;
  mediaSources?: JellyfinMediaSource[];
  mediaType?: string;
  mediaStreams?: JellyfinMediaStream[];
  officialRating?: string | null;
  overview?: string | null;
  parentId?: string;
  parentIndexNumber?: number;
  people?: Array<{
    Id?: string;
    Name?: string;
    Role?: string;
    Type?: string;
    id?: string;
    imageUrl?: string;
    name: string;
    role?: string;
    type?: string;
  }>;
  productionYear?: number;
  premiereDate?: string;
  recursiveItemCount?: number | null;
  runTimeTicks?: number;
  resumePositionTicks?: number;
  remoteTrailers?: Array<{name?: string; url: string}>;
  seriesId?: string;
  seriesName?: string;
}

export interface JellyfinMediaSource {
  Bitrate?: number;
  Container?: string;
  MediaStreams?: Array<{
    Channels?: number;
    Codec?: string;
    Height?: number;
    Type?: string;
  }>;
  Size?: number;
}

export interface JellyfinMediaStream {
  channels?: number;
  codec?: string;
  displayTitle?: string;
  height?: number;
  index?: number;
  isDefault?: boolean;
  language?: string;
  type?: string;
  width?: number;
}

export interface JellyfinChapter {
  name: string;
  startPositionTicks: number;
}

export interface JellyfinMediaTrack {
  id: string;
  index?: number;
  title: string;
  channels?: number;
  language?: string;
  codec?: string;
  displayTitle?: string;
  deliveryMethod?: string;
  isDefault?: boolean;
  isExternal?: boolean;
  deliveryUrl?: string;
  burnInRequired?: boolean;
  mimeType?: string;
  supportsTextTrack?: boolean;
  type: 'Audio' | 'Subtitle';
}

export interface JellyfinQualityOption {
  id: string;
  label: string;
  bitrate?: number;
  height?: number;
  width?: number;
}

export interface JellyfinStreamInfo {
  itemId: string;
  audioStreamIndex?: number;
  audioTracks: JellyfinMediaTrack[];
  bitrate?: number;
  height?: number;
  width?: number;
  mediaSourceId?: string;
  playSessionId?: string;
  playMethod: 'DirectPlay' | 'DirectStream' | 'Transcode';
  qualityOptions: JellyfinQualityOption[];
  runTimeTicks?: number;
  startPositionTicks?: number;
  subtitleTracks: JellyfinMediaTrack[];
  transcodeUrl?: string;
  url: string;
}

export type JellyfinSortBy = 'name' | 'dateAdded' | 'releaseDate' | 'rating';
export type JellyfinImageType = 'Primary' | 'Thumb' | 'Banner';

export interface GetItemsOptions {
  filters?: Array<'IsFavorite' | 'IsUnplayed'>;
  imageType?: JellyfinImageType;
  includeItemTypes?: string;
  recursive?: boolean;
  sortBy?: JellyfinSortBy;
  sortDescending?: boolean;
}

export interface PlaybackReportInput {
  itemId: string;
  audioStreamIndex?: number;
  mediaSourceId?: string;
  playSessionId?: string;
  playMethod?: JellyfinStreamInfo['playMethod'];
  positionTicks?: number;
  runTimeTicks?: number;
  isPaused?: boolean;
  subtitleStreamIndex?: number;
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

const AUTH_HEADER = `MediaBrowser Client="Astra", Device="FireTV", DeviceId="astra-device-001", Version="${APP_VERSION}"`;

const normalizeServerUrl = (serverUrl: string) =>
  serverUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(
      /^http:\/\/jelly2\.ambientflare\.art$/i,
      'https://jelly2.ambientflare.art',
    );

const getAuthHeaders = (accessToken: string) => ({
  'X-Emby-Authorization': `${AUTH_HEADER}, Token="${accessToken}"`,
  'X-Emby-Token': accessToken,
  'X-MediaBrowser-Token': accessToken,
});

const buildUrl = (
  baseUrl: string,
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
) => {
  const url = new URL(path, `${baseUrl}/`);

  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  return url.toString();
};

export const sanitizeUrlForLog = (rawUrl?: string) => {
  if (!rawUrl) {
    return rawUrl;
  }

  try {
    const parsed = new URL(rawUrl);
    const sensitiveParams = [
      'api_key',
      'access_token',
      'token',
      'password',
      'pw',
    ];

    sensitiveParams.forEach((paramName) => {
      parsed.searchParams.forEach((_, key) => {
        if (key.toLowerCase() === paramName) {
          parsed.searchParams.set(key, '[redacted]');
        }
      });
    });

    return parsed.toString();
  } catch {
    return rawUrl.replace(
      /([?&](?:api_key|access_token|token|password|pw)=)[^&]*/gi,
      '$1[redacted]',
    );
  }
};

const hasQueryParam = (url: string, paramName: string) =>
  new RegExp(`[?&]${paramName}=`, 'i').test(url);

const buildTranscodingUrl = (
  baseUrl: string,
  rawTranscodingUrl: string,
  accessToken: string,
) => {
  const rawPath = String(rawTranscodingUrl);
  const base = baseUrl.replace(/\/+$/, '');
  let url = /^https?:\/\//i.test(rawPath)
    ? rawPath
    : `${base}${rawPath.startsWith('/') ? '' : '/'}${rawPath}`;

  url = url.replace('?&', '?').replace(/&&+/g, '&');

  if (!hasQueryParam(url, 'api_key')) {
    url = `${url}${url.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(
      accessToken,
    )}`;
  }

  return url;
};

const itemFields =
  'Overview,Genres,People,MediaSources,OfficialRating,CommunityRating,ProviderIds,RecursiveItemCount,ChildCount,MediaStreams,Chapters,PrimaryImageAspectRatio,ProductionYear,UserData,CriticRating,RemoteTrailers';

const qualityCaps: JellyfinQualityOption[] = [
  {id: 'auto', label: 'Auto'},
  {id: '20000000', label: '20 Mbps', bitrate: 20000000},
  {id: '12000000', label: '12 Mbps', bitrate: 12000000},
  {id: '8000000', label: '8 Mbps', bitrate: 8000000},
  {id: '4000000', label: '4 Mbps', bitrate: 4000000},
  {id: '2000000', label: '2 Mbps', bitrate: 2000000},
];

const subtitleMimeForCodec = (codec?: string) => {
  switch (codec?.toLowerCase()) {
    case 'webvtt':
    case 'vtt':
      return 'text/vtt';
    case 'srt':
    case 'subrip':
      return 'application/x-subrip';
    case 'ass':
    case 'ssa':
      return 'text/x-ssa';
    case 'ttml':
      return 'application/ttml+xml';
    default:
      return undefined;
  }
};

const supportsTextTrack = (codec?: string) =>
  ['webvtt', 'vtt', 'srt', 'subrip', 'ttml'].includes(
    codec?.toLowerCase() ?? '',
  );

const selectAudioStreamIndex = (
  mediaStreams: JellyfinMediaStream[],
  preferredLanguage: string,
  preferredChannels: number,
): number | null => {
  const audioStreams = mediaStreams.filter((stream) => stream.type === 'Audio');

  if (!audioStreams.length) {
    return null;
  }

  if (audioStreams.length === 1) {
    return audioStreams[0].index ?? null;
  }

  const normalizedLanguage = preferredLanguage.toLowerCase();
  const languageAliases: Record<string, string[]> = {
    de: ['de', 'deu', 'ger'],
    en: ['en', 'eng'],
    es: ['es', 'spa'],
    fr: ['fr', 'fra', 'fre'],
    it: ['it', 'ita'],
    ja: ['ja', 'jpn'],
    ko: ['ko', 'kor'],
    pt: ['pt', 'por'],
  };
  const preferredLanguageCodes = languageAliases[normalizedLanguage] ?? [
    normalizedLanguage,
  ];
  const matchesLanguage = (language?: string) =>
    Boolean(
      language && preferredLanguageCodes.includes(language.toLowerCase()),
    );
  const byLangAndChannels = audioStreams.find(
    (stream) =>
      matchesLanguage(stream.language) &&
      (stream.channels ?? 0) <= preferredChannels,
  );

  if (byLangAndChannels?.index !== undefined) {
    return byLangAndChannels.index;
  }

  const byLang = audioStreams.find((stream) =>
    matchesLanguage(stream.language),
  );

  if (byLang?.index !== undefined) {
    return byLang.index;
  }

  const defaultTrack = audioStreams.find((stream) => stream.isDefault);

  if (defaultTrack?.index !== undefined) {
    return defaultTrack.index;
  }

  return audioStreams[0].index ?? null;
};

const mapItem = (
  baseUrl: string,
  accessToken: string,
  item: {
    Id?: string;
    Name?: string;
    Type?: string;
    MediaType?: string;
    MediaSources?: Array<{
      MediaStreams?: Array<{
        Channels?: number;
        Codec?: string;
        DisplayTitle?: string;
        Height?: number;
        Index?: number;
        IsDefault?: boolean;
        Language?: string;
        Type?: string;
        Width?: number;
      }>;
    }>;
    ProductionYear?: number;
    PremiereDate?: string;
    ImageTags?: {Banner?: string; Primary?: string; Thumb?: string};
    BackdropImageTags?: string[];
    ChildCount?: number;
    Chapters?: Array<{Name?: string; StartPositionTicks?: number}>;
    RunTimeTicks?: number;
    UserData?: {
      IsFavorite?: boolean;
      Played?: boolean;
      PlayCount?: number;
      PlaybackPositionTicks?: number;
    };
    Overview?: string;
    Genres?: string[];
    People?: Array<{Id?: string; Name?: string; Role?: string; Type?: string}>;
    CommunityRating?: number;
    CriticRating?: number;
    OfficialRating?: string;
    ParentId?: string;
    IndexNumber?: number;
    ParentIndexNumber?: number;
    RecursiveItemCount?: number;
    RemoteTrailers?: Array<{Name?: string; Url?: string}>;
    SeriesId?: string;
    SeriesName?: string;
  },
  imageType: 'Primary' | 'Thumb' | 'Banner' = 'Primary',
): JellyfinMediaItem => ({
  id: item.Id ?? item.Name ?? '',
  name: item.Name ?? 'Untitled',
  type: item.Type ?? 'Media',
  backdropImageTags: item.BackdropImageTags ?? [],
  childCount: item.ChildCount ?? null,
  mediaSources: item.MediaSources ?? [],
  mediaType: item.MediaType,
  mediaStreams: item.MediaSources?.[0]?.MediaStreams?.map((stream) => ({
    channels: stream.Channels,
    codec: stream.Codec,
    displayTitle: stream.DisplayTitle,
    height: stream.Height,
    index: stream.Index,
    isDefault: stream.IsDefault,
    language: stream.Language,
    type: stream.Type,
    width: stream.Width,
  })),
  productionYear: item.ProductionYear,
  premiereDate: item.PremiereDate,
  chapters: item.Chapters?.map((chapter, index) => ({
    name: chapter.Name ?? `Chapter ${index + 1}`,
    startPositionTicks: chapter.StartPositionTicks ?? 0,
  })),
  imageUrl: item.Id
    ? buildUrl(baseUrl, `/Items/${item.Id}/Images/${imageType}`, {
        fillWidth: 360,
        quality: 90,
        tag: item.ImageTags?.[imageType],
        api_key: accessToken,
      })
    : undefined,
  backdropUrl:
    item.Id && item.BackdropImageTags?.[0]
      ? buildUrl(baseUrl, `/Items/${item.Id}/Images/Backdrop/0`, {
          fillWidth: 1280,
          quality: 85,
          tag: item.BackdropImageTags[0],
          api_key: accessToken,
        })
      : undefined,
  runTimeTicks: item.RunTimeTicks,
  resumePositionTicks: item.UserData?.PlaybackPositionTicks,
  isFavorite: item.UserData?.IsFavorite,
  isPlayed: item.UserData?.Played,
  overview: item.Overview ?? null,
  genres: item.Genres ?? [],
  people: (item.People ?? []).map((person) => ({
    Id: person.Id,
    Name: person.Name ?? 'Unknown',
    Role: person.Role,
    Type: person.Type,
    id: person.Id,
    imageUrl: person.Id
      ? buildUrl(baseUrl, `/Items/${person.Id}/Images/Primary`, {
          fillWidth: 260,
          quality: 85,
          api_key: accessToken,
        })
      : undefined,
    name: person.Name ?? 'Unknown',
    role: person.Role,
    type: person.Type,
  })),
  remoteTrailers: item.RemoteTrailers?.flatMap((trailer) =>
    trailer.Url ? [{name: trailer.Name, url: trailer.Url}] : [],
  ),
  communityRating: item.CommunityRating ?? null,
  criticsRating: item.CriticRating,
  officialRating: item.OfficialRating ?? null,
  parentId: item.ParentId,
  indexNumber: item.IndexNumber,
  parentIndexNumber: item.ParentIndexNumber,
  recursiveItemCount: item.RecursiveItemCount ?? null,
  seriesId: item.SeriesId,
  seriesName: item.SeriesName,
});

const getJson = async <ResponseBody>(
  url: string,
  options: {
    body?: string;
    headers?: Record<string, string>;
    method?: string;
  } = {},
  timeoutMs = 45000,
): Promise<ResponseBody> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    if (!response.ok) {
      const failedUrl = new URL(url);
      failedUrl.searchParams.delete('api_key');
      throw new Error(
        `Jellyfin request failed ${response.status}: ${failedUrl.pathname}`,
      );
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
  }>(buildUrl(baseUrl, '/Library/MediaFolders', {api_key: accessToken}), {
    headers: getAuthHeaders(accessToken),
  });

  return (response.Items ?? [])
    .filter((library) => library.CollectionType !== 'playlists')
    .map((library) => ({
      id: library.Id ?? library.Name ?? '',
      imageUrl: library.Id
        ? buildUrl(baseUrl, `/Items/${library.Id}/Images/Primary`, {
            fillWidth: 520,
            quality: 90,
            api_key: accessToken,
          })
        : undefined,
      name: library.Name ?? 'Library',
      type: library.CollectionType ?? library.Type,
    }));
};

const sortByMap: Record<JellyfinSortBy, string> = {
  dateAdded: 'DateCreated',
  name: 'SortName',
  rating: 'CommunityRating',
  releaseDate: 'PremiereDate',
};

export const getItems = async (
  serverUrl: string,
  accessToken: string,
  libraryId: string,
  userId?: string,
  options: GetItemsOptions = {},
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
      ImageTags?: {Banner?: string; Primary?: string; Thumb?: string};
      BackdropImageTags?: string[];
      ChildCount?: number;
      MediaSources?: JellyfinMediaSource[];
      RunTimeTicks?: number;
      UserData?: {PlaybackPositionTicks?: number};
      Overview?: string;
      Genres?: string[];
      People?: Array<{
        Id?: string;
        Name?: string;
        Role?: string;
        Type?: string;
      }>;
      CommunityRating?: number;
      CriticRating?: number;
      OfficialRating?: string;
      ParentId?: string;
      IndexNumber?: number;
      ParentIndexNumber?: number;
      RecursiveItemCount?: number;
      SeriesId?: string;
      SeriesName?: string;
    }>;
  }>(
    buildUrl(baseUrl, itemsPath, {
      ParentId: libraryId,
      Recursive: options.recursive ?? true,
      IncludeItemTypes:
        options.includeItemTypes ?? 'Movie,Series,Episode,Video',
      Fields: itemFields,
      ImageTypeLimit: 1,
      EnableImageTypes: `${options.imageType ?? 'Primary'},Backdrop`,
      Filters: options.filters?.join(','),
      SortBy: sortByMap[options.sortBy ?? 'name'],
      SortOrder: options.sortDescending ? 'Descending' : 'Ascending',
      api_key: accessToken,
    }),
    {
      headers: getAuthHeaders(accessToken),
    },
  );

  return (response.Items ?? []).map((item) =>
    mapItem(baseUrl, accessToken, item, options.imageType ?? 'Primary'),
  );
};

export const getStreamUrl = async (
  serverUrl: string,
  accessToken: string,
  itemId: string,
  userId?: string,
  startPositionTicks = 0,
  options: {
    alwaysBurnInSubtitleWhenTranscoding?: boolean;
    audioStreamIndex?: number;
    forceTranscode?: boolean;
    maxStreamingBitrate?: number;
    subtitleStreamIndex?: number;
  } = {},
): Promise<JellyfinStreamInfo> => {
  const baseUrl = normalizeServerUrl(serverUrl);
  const prefs = await readPlaybackPreferences();
  const playbackInfoUrl = buildUrl(baseUrl, `/Items/${itemId}/PlaybackInfo`, {
    api_key: accessToken,
  });
  console.log(
    '[Astra] buildUrl PlaybackInfo output:',
    sanitizeUrlForLog(playbackInfoUrl),
  );

  type PlaybackInfoResponse = {
    PlaySessionId?: string;
    MediaSources?: Array<{
      Id?: string;
      RunTimeTicks?: number;
      Container?: string;
      ETag?: string;
      Bitrate?: number;
      Width?: number;
      Height?: number;
      TranscodingUrl?: string;
      Path?: string;
      SupportsDirectPlay?: boolean;
      SupportsDirectStream?: boolean;
      SupportsTranscoding?: boolean;
      MediaStreams?: Array<{
        Channels?: number;
        Index?: number;
        Type?: string;
        Title?: string;
        Language?: string;
        Codec?: string;
        DisplayTitle?: string;
        IsDefault?: boolean;
        IsExternal?: boolean;
        DeliveryUrl?: string;
        DeliveryMethod?: string;
      }>;
    }>;
  };
  const postPlaybackInfo = (audioStreamIndex?: number) =>
    getJson<PlaybackInfoResponse>(playbackInfoUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(accessToken),
      },
      body: JSON.stringify({
        DeviceProfile: buildDeviceProfile(prefs),
        UserId: userId,
        StartTimeTicks: startPositionTicks,
        AudioStreamIndex: audioStreamIndex,
        SubtitleStreamIndex: options.subtitleStreamIndex,
        AlwaysBurnInSubtitleWhenTranscoding:
          options.alwaysBurnInSubtitleWhenTranscoding,
        MaxStreamingBitrate: options.maxStreamingBitrate ?? prefs.maxBitrateBps,
        MaxAudioChannels: prefs.maxAudioChannels,
        // Everything is delivered over HLS — no direct play. Raw-file
        // direct play blocks the JS thread inside setSrcUri when
        // KeplerMediaSink rejects a stream (HDR10), and byte-range seeking
        // into raw files is unreliable; HLS segments seek cleanly.
        // Compatible sources are stream-copied by the server (full source
        // quality), so this costs nothing for most of the library.
        EnableDirectPlay: false,
        EnableDirectStream: false,
        AllowVideoStreamCopy: !options.forceTranscode,
        AllowAudioStreamCopy: true,
        AutoOpenLiveStream: true,
      }),
    });

  let response = await postPlaybackInfo(options.audioStreamIndex);
  const firstMediaStreams = response.MediaSources?.[0]?.MediaStreams?.map(
    (stream): JellyfinMediaStream => ({
      channels: stream.Channels,
      codec: stream.Codec,
      displayTitle: stream.DisplayTitle,
      index: stream.Index,
      isDefault: stream.IsDefault,
      language: stream.Language,
      type: stream.Type,
    }),
  );
  const selectedAudioStreamIndex =
    options.audioStreamIndex ??
    selectAudioStreamIndex(
      firstMediaStreams ?? [],
      prefs.preferredAudioLanguage,
      prefs.maxAudioChannels,
    );

  if (
    options.audioStreamIndex === undefined &&
    selectedAudioStreamIndex !== null
  ) {
    response = await postPlaybackInfo(selectedAudioStreamIndex);
  }
  const mediaSource = response.MediaSources?.[0];
  const shouldUseTranscode = Boolean(mediaSource?.TranscodingUrl);
  if (mediaSource?.TranscodingUrl) {
    console.log(
      '[Astra] Raw Jellyfin TranscodingUrl:',
      sanitizeUrlForLog(mediaSource.TranscodingUrl),
    );
  }
  const playMethod: JellyfinStreamInfo['playMethod'] = shouldUseTranscode
    ? 'Transcode'
    : mediaSource?.SupportsDirectPlay
    ? 'DirectPlay'
    : mediaSource?.SupportsDirectStream
    ? 'DirectStream'
    : 'Transcode';

  let url: string;
  let resolvedTranscodeUrl: string | undefined;
  if (shouldUseTranscode && mediaSource?.TranscodingUrl) {
    resolvedTranscodeUrl = buildTranscodingUrl(
      baseUrl,
      mediaSource.TranscodingUrl,
      accessToken,
    );
    console.log(
      '[Astra] buildTranscodingUrl output:',
      sanitizeUrlForLog(resolvedTranscodeUrl),
    );
    url = resolvedTranscodeUrl;
  } else if (mediaSource?.SupportsDirectPlay && mediaSource?.Id) {
    url = buildUrl(baseUrl, `/Videos/${itemId}/stream`, {
      static: true,
      MediaSourceId: mediaSource?.Id,
      PlaySessionId: response.PlaySessionId,
      AudioStreamIndex: selectedAudioStreamIndex ?? undefined,
      tag: mediaSource?.ETag,
      api_key: accessToken,
    });
    console.log(
      '[Astra] buildUrl DirectStream output:',
      sanitizeUrlForLog(url),
    );
  } else {
    throw new Error('No playable URL returned from Jellyfin.');
  }
  const streams = mediaSource?.MediaStreams ?? [];
  const mapTrack = (track: (typeof streams)[number]): JellyfinMediaTrack => {
    const isSubtitle = track.Type === 'Subtitle';
    const textTrackSupported = isSubtitle && supportsTextTrack(track.Codec);
    const deliveryUrl = track.DeliveryUrl
      ? buildUrl(baseUrl, track.DeliveryUrl, {api_key: accessToken})
      : isSubtitle && track.Index !== undefined && textTrackSupported
      ? buildUrl(
          baseUrl,
          `/Videos/${itemId}/${mediaSource?.Id}/Subtitles/${track.Index}/Stream.vtt`,
          {api_key: accessToken},
        )
      : undefined;

    return {
      id: String(
        track.Index ?? track.DisplayTitle ?? track.Title ?? track.Type,
      ),
      index: track.Index,
      title: track.DisplayTitle ?? track.Title ?? track.Language ?? 'Unknown',
      language: track.Language,
      codec: track.Codec,
      channels: track.Channels,
      displayTitle: track.DisplayTitle,
      deliveryMethod: track.DeliveryMethod,
      isDefault: track.IsDefault,
      isExternal: track.IsExternal,
      deliveryUrl,
      burnInRequired: isSubtitle && (!deliveryUrl || !textTrackSupported),
      mimeType: isSubtitle
        ? subtitleMimeForCodec(
            deliveryUrl?.endsWith('.vtt') ? 'vtt' : track.Codec,
          )
        : undefined,
      supportsTextTrack: !isSubtitle || textTrackSupported,
      type: isSubtitle ? 'Subtitle' : 'Audio',
    };
  };
  const directQuality = mediaSource
    ? {
        id: 'source',
        label: [
          'Source',
          mediaSource.Height ? `${mediaSource.Height}p` : undefined,
          mediaSource.Bitrate
            ? `${Math.round(mediaSource.Bitrate / 1000000)} Mbps`
            : undefined,
          mediaSource.Container,
        ]
          .filter(Boolean)
          .join(' / '),
        bitrate: mediaSource.Bitrate,
        height: mediaSource.Height,
        width: mediaSource.Width,
      }
    : undefined;

  return {
    itemId,
    audioStreamIndex: selectedAudioStreamIndex ?? undefined,
    audioTracks: streams
      .filter((track) => track.Type === 'Audio')
      .map((track) => mapTrack(track)),
    bitrate: mediaSource?.Bitrate,
    height: mediaSource?.Height,
    width: mediaSource?.Width,
    mediaSourceId: mediaSource?.Id,
    playSessionId: response.PlaySessionId,
    playMethod,
    qualityOptions: directQuality
      ? [directQuality, ...qualityCaps]
      : qualityCaps,
    runTimeTicks: mediaSource?.RunTimeTicks,
    startPositionTicks,
    subtitleTracks: streams
      .filter((track) => track.Type === 'Subtitle')
      .map((track) => mapTrack(track)),
    transcodeUrl: resolvedTranscodeUrl,
    url,
  };
};

const getItemCollection = async (
  serverUrl: string,
  accessToken: string,
  path: string,
  params: Record<string, string | number | boolean | undefined>,
): Promise<JellyfinMediaItem[]> => {
  const baseUrl = normalizeServerUrl(serverUrl);
  const response = await getJson<{
    Items?: Array<Parameters<typeof mapItem>[2]>;
  }>(buildUrl(baseUrl, path, {...params, api_key: accessToken}), {
    headers: getAuthHeaders(accessToken),
  });

  return (response.Items ?? []).map((item) =>
    mapItem(baseUrl, accessToken, item),
  );
};

export const getResumeItems = (
  serverUrl: string,
  accessToken: string,
  userId: string,
) =>
  getItemCollection(serverUrl, accessToken, `/Users/${userId}/Items/Resume`, {
    MediaTypes: 'Video',
    IncludeItemTypes: 'Movie,Episode',
    Fields: itemFields,
    ImageTypeLimit: 1,
    EnableImageTypes: 'Primary,Backdrop',
    Limit: 24,
  });

export const getNextUp = (
  serverUrl: string,
  accessToken: string,
  userId: string,
) =>
  getItemCollection(serverUrl, accessToken, '/Shows/NextUp', {
    UserId: userId,
    Fields: itemFields,
    ImageTypeLimit: 1,
    EnableImageTypes: 'Primary,Backdrop',
    Limit: 24,
  });

export const getLatestItems = async (
  serverUrl: string,
  accessToken: string,
  userId: string,
  includeItemTypes: string,
): Promise<JellyfinMediaItem[]> => {
  const baseUrl = normalizeServerUrl(serverUrl);
  const response = await getJson<Array<Parameters<typeof mapItem>[2]>>(
    buildUrl(baseUrl, `/Users/${userId}/Items/Latest`, {
      IncludeItemTypes: includeItemTypes,
      Fields: itemFields,
      ImageTypeLimit: 1,
      EnableImageTypes: 'Primary,Backdrop',
      Limit: 24,
      api_key: accessToken,
    }),
    {
      headers: getAuthHeaders(accessToken),
    },
  );

  return response.map((item) => mapItem(baseUrl, accessToken, item));
};

export const getSimilarItems = (
  serverUrl: string,
  accessToken: string,
  itemId: string,
  userId: string,
) =>
  getItemCollection(serverUrl, accessToken, `/Items/${itemId}/Similar`, {
    UserId: userId,
    Fields: itemFields,
    ImageTypeLimit: 1,
    EnableImageTypes: 'Primary,Backdrop',
    Limit: 24,
  });

export const getPerson = async (
  serverUrl: string,
  accessToken: string,
  personId: string,
  personName?: string,
): Promise<JellyfinPerson> => {
  const baseUrl = normalizeServerUrl(serverUrl);
  const personKey = personName || personId;
  const person = await getJson<{
    DateCreated?: string;
    Id?: string;
    Name?: string;
    Overview?: string;
    PremiereDate?: string;
    UserData?: {IsFavorite?: boolean};
  }>(buildUrl(baseUrl, `/Persons/${personKey}`, {api_key: accessToken}), {
    headers: getAuthHeaders(accessToken),
  });
  const resolvedId = person.Id ?? personId;

  return {
    birthDate: person.PremiereDate ?? person.DateCreated,
    id: resolvedId,
    imageUrl: buildUrl(baseUrl, `/Items/${resolvedId}/Images/Primary`, {
      fillWidth: 420,
      quality: 90,
      api_key: accessToken,
    }),
    isFavorite: person.UserData?.IsFavorite,
    name: person.Name ?? personName ?? 'Unknown',
    overview: person.Overview,
  };
};

export const getItemsByPerson = (
  serverUrl: string,
  accessToken: string,
  userId: string,
  personId: string,
) =>
  getItemCollection(serverUrl, accessToken, `/Users/${userId}/Items`, {
    PersonIds: personId,
    Recursive: true,
    IncludeItemTypes: 'Movie,Series,Episode',
    Fields: itemFields,
    ImageTypeLimit: 1,
    EnableImageTypes: 'Primary,Backdrop',
    Limit: 80,
  });

export const searchItems = (
  serverUrl: string,
  accessToken: string,
  userId: string,
  searchTerm: string,
) =>
  getItemCollection(serverUrl, accessToken, `/Users/${userId}/Items`, {
    SearchTerm: searchTerm,
    Recursive: true,
    IncludeItemTypes: 'Movie,Series,Episode',
    Fields: itemFields,
    ImageTypeLimit: 1,
    EnableImageTypes: 'Primary,Backdrop',
    Limit: 60,
  });

export const getItemDetails = async (
  serverUrl: string,
  accessToken: string,
  userId: string,
  itemId: string,
) => {
  const baseUrl = normalizeServerUrl(serverUrl);
  const item = await getJson<Parameters<typeof mapItem>[2]>(
    buildUrl(baseUrl, `/Users/${userId}/Items/${itemId}`, {
      Fields: itemFields,
      api_key: accessToken,
    }),
    {
      headers: getAuthHeaders(accessToken),
    },
  );

  return mapItem(baseUrl, accessToken, item);
};

export const getSeasons = (
  serverUrl: string,
  accessToken: string,
  userId: string,
  seriesId: string,
) =>
  getItemCollection(serverUrl, accessToken, `/Shows/${seriesId}/Seasons`, {
    UserId: userId,
    Fields: itemFields,
    ImageTypeLimit: 1,
    EnableImageTypes: 'Primary,Backdrop',
  });

export const getEpisodes = (
  serverUrl: string,
  accessToken: string,
  userId: string,
  seriesId: string,
  seasonId: string,
) =>
  getItemCollection(serverUrl, accessToken, `/Shows/${seriesId}/Episodes`, {
    UserId: userId,
    SeasonId: seasonId,
    Fields: itemFields,
    ImageTypeLimit: 1,
    EnableImageTypes: 'Primary,Backdrop',
  });

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
          AudioStreamIndex: input.audioStreamIndex,
          SubtitleStreamIndex: input.subtitleStreamIndex,
          Failed: false,
        }
      : {
          ItemId: input.itemId,
          AudioStreamIndex: input.audioStreamIndex,
          MediaSourceId: input.mediaSourceId,
          PlaySessionId: input.playSessionId,
          PositionTicks: input.positionTicks,
          SubtitleStreamIndex: input.subtitleStreamIndex,
          CanSeek: (input.runTimeTicks ?? 0) > 0,
          IsPaused: input.isPaused ?? false,
          IsMuted: false,
          PlayMethod: input.playMethod ?? 'DirectPlay',
          RepeatMode: 'RepeatNone',
          PlaybackOrder: 'Default',
        };

  await getJson(
    buildUrl(baseUrl, `/Sessions/${endpoint}`, {api_key: accessToken}),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(accessToken),
      },
      body: JSON.stringify(body),
    },
  );
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

export const setFavorite = async (
  serverUrl: string,
  accessToken: string,
  userId: string,
  itemId: string,
  isFavorite: boolean,
) => {
  const baseUrl = normalizeServerUrl(serverUrl);
  await getJson(
    buildUrl(baseUrl, `/Users/${userId}/FavoriteItems/${itemId}`, {
      api_key: accessToken,
    }),
    {
      method: isFavorite ? 'POST' : 'DELETE',
      headers: getAuthHeaders(accessToken),
    },
  );
};

export const setPlayed = async (
  serverUrl: string,
  accessToken: string,
  userId: string,
  itemId: string,
  isPlayed: boolean,
) => {
  const baseUrl = normalizeServerUrl(serverUrl);
  await getJson(
    buildUrl(baseUrl, `/Users/${userId}/PlayedItems/${itemId}`, {
      api_key: accessToken,
    }),
    {
      method: isPlayed ? 'POST' : 'DELETE',
      headers: getAuthHeaders(accessToken),
    },
  );
};

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

export const measureServerBandwidth = async (
  serverUrl: string,
  accessToken: string,
): Promise<number> => {
  const baseUrl = normalizeServerUrl(serverUrl);
  const download = async (sizeBytes: number) => {
    const url = buildUrl(baseUrl, '/Playback/BitrateTest', {
      Size: sizeBytes,
      api_key: accessToken,
    });
    const started = Date.now();
    const response = await fetch(url, {headers: getAuthHeaders(accessToken)});

    if (!response.ok) {
      throw new Error(`Bandwidth test failed (HTTP ${response.status}).`);
    }

    const buffer = await response.arrayBuffer();
    const seconds = (Date.now() - started) / 1000;
    return (buffer.byteLength * 8) / seconds;
  };

  // Small warm-up so connection setup / TLS handshake doesn't count
  // against the real measurement.
  await download(500000);
  const bitsPerSecond = await download(20000000);
  return Math.round(bitsPerSecond);
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
