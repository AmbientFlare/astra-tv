import {buildDeviceProfile} from './deviceProfile';
import {
  defaultUserPreferences,
  getUserPreferences,
  readPlaybackPreferences,
  UserPreferences,
} from '../storage';
import {getServerUrlCandidates, normalizeServerUrl} from '../serverUrl';
import {APP_VERSION} from '../../config/app';
import {
  AudioOutputCapabilities,
  getAudioOutputCapabilities,
} from '../mediaCapabilities';

export interface JellyfinServerInfo {
  /**
   * The URL that actually answered, after http/https resolution. Callers must
   * persist and reuse this rather than the raw user input.
   */
  baseUrl: string;
  id: string;
  name: string;
  version: string;
  operatingSystem?: string;
}

export interface JellyfinAuthResult {
  userId: string;
  accessToken: string;
  username?: string;
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
  isFolder?: boolean;
  /**
   * Standard Jellyfin field. 'Remote' means the server has no local file for
   * this item and resolves a media source when playback is requested, so any
   * file-shaped detail (path, size, container) is unknown until then.
   */
  locationType?: string;
  imageUrl?: string;
  backdropUrl?: string;
  communityRating?: number | null;
  criticsRating?: number;
  genres?: string[];
  indexNumber?: number;
  isFavorite?: boolean;
  isPlayed?: boolean;
  unplayedItemCount?: number;
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

/** A timed range the server marks inside an item, such as its credits. */
export interface JellyfinMediaSegment {
  endTicks: number;
  id?: string;
  startTicks: number;
  type: string;
}

export interface JellyfinMediaTrack {
  id: string;
  index?: number;
  title: string;
  channels?: number;
  bitrate?: number;
  language?: string;
  codec?: string;
  profile?: string;
  sampleRate?: number;
  displayTitle?: string;
  deliveryMethod?: string;
  isDefault?: boolean;
  isForced?: boolean;
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
  container?: string;
  sourceContainer?: string;
  outputContainer?: string;
  sourceAudioBitrate?: number;
  sourceAudioCodec?: string;
  sourceAudioProfile?: string;
  sourceAudioSampleRate?: number;
  sourceVideoCodec?: string;
  outputAudioBitrate?: number;
  outputAudioCodec?: string;
  outputVideoCodec?: string;
  audioDeliveryMethod?: 'Copy' | 'Transcode' | 'Unknown';
  videoDeliveryMethod?: 'Copy' | 'Transcode' | 'Unknown';
  transcodeReasons?: string[];
  deliveredAudioCodec?: string;
  deliveredAudioStreamIndex?: number;
  deliveredVideoCodec?: string;
  audioOutputCapabilities?: AudioOutputCapabilities;
  audioTranscodePolicy?: string;
  height?: number;
  hlsMinimumSegmentCount?: number;
  hlsSegmentTargetSeconds?: number;
  width?: number;
  mediaSourceId?: string;
  playSessionId?: string;
  playMethod: 'DirectPlay' | 'DirectStream' | 'Transcode';
  qualityOptions: JellyfinQualityOption[];
  runTimeTicks?: number;
  startPositionTicks?: number;
  /**
   * The subtitle stream this PlaybackInfo session plays, if any. Absent means
   * Off. It is either the caller's pinned choice or the global preference
   * resolved against the server's media source.
   */
  subtitleStreamIndex?: number;
  /** True when the server was asked to burn `subtitleStreamIndex` in. */
  subtitleBurnIn?: boolean;
  subtitleTracks: JellyfinMediaTrack[];
  transcodeUrl?: string;
  url: string;
}

const getUrlParameter = (url: string, name: string) => {
  try {
    const normalizedName = name.toLowerCase();
    let value: string | undefined;
    // Jellyfin's TranscodingUrl is server-relative; the base lets it parse.
    new URL(url, 'http://relative.invalid').searchParams.forEach(
      (candidate, key) => {
        if (key.toLowerCase() === normalizedName) {
          value = candidate;
        }
      },
    );
    return value;
  } catch {
    return undefined;
  }
};

const getCodecChoices = (url: string, parameter: string) =>
  (getUrlParameter(url, parameter) ?? '')
    .split(',')
    .map((codec) => codec.trim().toLowerCase())
    .filter(Boolean);

const permitsStreamCopy = (url: string, parameter: string) =>
  (getUrlParameter(url, parameter) ?? '')
    .split(',')
    .some((value) => value.trim().toLowerCase() === 'true');

const isAdaptiveStreamUrl = (url: string) => /\.m3u8(?:$|\?)/i.test(url);

const getPositiveUrlNumber = (url: string, name: string) => {
  const value = Number(getUrlParameter(url, name));
  return Number.isFinite(value) && value > 0 ? value : undefined;
};

const describeDelivery = (
  url: string,
  sourceCodec: string | undefined,
  codecParameter: 'AudioCodec' | 'VideoCodec',
  copyParameter: 'AllowAudioStreamCopy' | 'AllowVideoStreamCopy',
) => {
  const normalizedSourceCodec = sourceCodec?.toLowerCase();
  const codecChoices = getCodecChoices(url, codecParameter);
  const copied = Boolean(
    normalizedSourceCodec &&
      permitsStreamCopy(url, copyParameter) &&
      codecChoices.includes(normalizedSourceCodec),
  );

  return {
    codec: copied ? normalizedSourceCodec : codecChoices[0],
    method: copied
      ? ('Copy' as const)
      : codecChoices.length
      ? ('Transcode' as const)
      : ('Unknown' as const),
  };
};

export type JellyfinSortBy = 'name' | 'dateAdded' | 'releaseDate' | 'rating';
export type JellyfinImageType = 'Primary' | 'Thumb' | 'Banner';

export interface GetItemsOptions {
  filters?: Array<'IsFavorite' | 'IsUnplayed'>;
  imageType?: JellyfinImageType;
  /**
   * null asks the server for whatever it puts at the top of the view, with no
   * type filter. Use it for views whose CollectionType we do not recognise.
   */
  includeItemTypes?: string | null;
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

// Jellyfin 10.12 disables the X-Emby-* legacy headers by default and 10.13
// removes them; send the standard Authorization header alongside them so both
// old and new servers accept requests.
const getPreAuthHeaders = () => ({
  Authorization: AUTH_HEADER,
  'X-Emby-Authorization': AUTH_HEADER,
});

// Exported for the sibling music module; not part of the public surface.
export const getAuthHeaders = (accessToken: string) => ({
  Authorization: `${AUTH_HEADER}, Token="${accessToken}"`,
  'X-Emby-Authorization': `${AUTH_HEADER}, Token="${accessToken}"`,
  'X-Emby-Token': accessToken,
  'X-MediaBrowser-Token': accessToken,
});

export const buildUrl = (
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
    const redactedPath = parsed.pathname.replace(
      /\b(?:[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\b/gi,
      '[id]',
    );
    // No query parameter is useful enough to justify logging it. Jellyfin
    // URLs contain access tokens, play-session IDs, media-source IDs and item
    // IDs, sometimes duplicated with different casing.
    return `${parsed.origin}${redactedPath}`;
  } catch {
    return rawUrl
      .split(/[?#]/, 1)[0]
      .replace(
        /\b(?:[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\b/gi,
        '[id]',
      );
  }
};

/**
 * How long to wait before asking a server a second time for something it may
 * still be assembling. Long enough to be worth doing, short enough that a
 * viewer reads it as loading rather than as a hang.
 */
export const PLAYBACK_INFO_RETRY_MS = 1500;
export const CHILD_ITEMS_RETRY_MS = 1200;

/** Maximum automatic re-requests before a screen offers a manual Retry. */
export const CHILD_ITEMS_MAX_RETRIES = 2;

export const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * A media source is only useful if the server gave us a way to fetch it. An
 * item whose source is resolved on demand can report an empty list, or a
 * placeholder source with nothing to stream, while it is still working.
 */
export const hasPlayableMediaSource = (response: {
  MediaSources?: Array<{
    Id?: string;
    Path?: string;
    SupportsDirectPlay?: boolean;
    SupportsDirectStream?: boolean;
    SupportsTranscoding?: boolean;
    TranscodingUrl?: string;
  }>;
}) =>
  (response.MediaSources ?? []).some(
    (source) =>
      Boolean(source.TranscodingUrl) ||
      source.SupportsDirectPlay === true ||
      source.SupportsDirectStream === true ||
      source.SupportsTranscoding === true,
  );

/**
 * True when a series' season list looks like the server has not finished
 * building it. Some servers materialise a season/episode tree during the
 * first browse, so the honest answer to "no seasons yet" is to ask again
 * rather than to show a dead end.
 */
export const isIncompleteSeasonList = (
  seasons: Array<{childCount?: number | null}>,
) =>
  seasons.length === 0 ||
  (seasons.length === 1 &&
    (seasons[0].childCount === 0 || seasons[0].childCount === null));

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

/**
 * Extra data to ask for alongside an item.
 *
 * Every entry must be a member of the server's ItemFields enum: the parameter
 * is bound as an enum array, so one unrecognised name rejects the whole
 * request rather than being ignored. Ratings, production year and user data
 * are plain item properties that come back on their own and must NOT be
 * listed here — asking for them by name is what breaks the request.
 */
export const itemFields =
  'Overview,Genres,People,MediaSources,ProviderIds,RecursiveItemCount,ChildCount,MediaStreams,Chapters,PrimaryImageAspectRatio,RemoteTrailers';

const qualityCaps: JellyfinQualityOption[] = [
  {id: 'auto', label: 'Auto'},
  {id: '20000000', label: '20 Mbps', bitrate: 20000000},
  {id: '12000000', label: '12 Mbps', bitrate: 12000000},
  {id: '8000000', label: '8 Mbps', bitrate: 8000000},
  {id: '4000000', label: '4 Mbps', bitrate: 4000000},
  {id: '2000000', label: '2 Mbps', bitrate: 2000000},
];

export const subtitleMimeForCodec = (codec?: string) => {
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

export const subtitleMimeForDelivery = (
  deliveryUrl?: string,
  sourceCodec?: string,
) => {
  if (deliveryUrl) {
    try {
      // Jellyfin usually converts SRT/SubRip into WebVTT. Authentication is
      // appended as a query string, so checking the complete URL with
      // endsWith('.vtt') incorrectly labels VTT as application/x-subrip.
      if (new URL(deliveryUrl).pathname.toLowerCase().endsWith('.vtt')) {
        return 'text/vtt';
      }
    } catch (_error) {
      if (deliveryUrl.split(/[?#]/, 1)[0].toLowerCase().endsWith('.vtt')) {
        return 'text/vtt';
      }
    }
  }

  return subtitleMimeForCodec(sourceCodec);
};

const supportsTextTrack = (codec?: string) =>
  ['webvtt', 'vtt', 'srt', 'subrip', 'ttml'].includes(
    codec?.toLowerCase() ?? '',
  );

export type SubtitleMode = UserPreferences['subtitleMode'];

export interface SubtitleSelectionTrack {
  index?: number;
  isForced?: boolean;
  language?: string;
}

export interface SubtitleSelectionOptions {
  mode: SubtitleMode;
  preferredLanguage: string;
  serverDefaultSubtitleStreamIndex?: number;
  /**
   * A choice made in the player overlay, including an empty object for Off.
   * Keeping Off distinct from an absent override stops the global policy from
   * switching subtitles back on during an audio or quality reload.
   */
  manualSelection?: {streamIndex?: number};
}

const subtitleLanguageAliases: Record<string, string[]> = {
  english: ['en', 'eng', 'english'],
  spanish: ['es', 'spa', 'spanish'],
  french: ['fr', 'fra', 'fre', 'french'],
  german: ['de', 'deu', 'ger', 'german'],
  italian: ['it', 'ita', 'italian'],
  japanese: ['ja', 'jpn', 'japanese'],
  korean: ['ko', 'kor', 'korean'],
  portuguese: ['pt', 'por', 'portuguese'],
  russian: ['ru', 'rus', 'russian'],
  chinese: ['zh', 'zho', 'chi', 'chinese'],
};

const subtitleLanguageMatches = (
  language: string | undefined,
  preferred: string,
) => {
  const normalizedLanguage = language?.trim().toLowerCase();
  const normalizedPreferred = preferred.trim().toLowerCase();
  if (!normalizedLanguage || !normalizedPreferred) {
    return false;
  }

  const preferredAliases = subtitleLanguageAliases[normalizedPreferred] ?? [
    normalizedPreferred,
  ];
  return preferredAliases.includes(normalizedLanguage);
};

/**
 * Resolves the global subtitle preference against one PlaybackInfo response.
 * Returns the stream index to play, or undefined for Off; the request below
 * serializes Off as Jellyfin's explicit -1 so the server cannot restore its
 * own default.
 */
export const selectSubtitleStreamIndex = (
  tracks: SubtitleSelectionTrack[],
  options: SubtitleSelectionOptions,
): number | undefined => {
  if (options.manualSelection) {
    return options.manualSelection.streamIndex;
  }

  const availableTracks = tracks.filter((track) => track.index !== undefined);
  const serverDefault = availableTracks.find(
    (track) => track.index === options.serverDefaultSubtitleStreamIndex,
  );

  switch (options.mode) {
    case 'alwaysOff':
      return undefined;
    case 'forcedOnly':
      return availableTracks.find((track) => track.isForced)?.index;
    case 'alwaysOn':
      return (
        availableTracks.find((track) =>
          subtitleLanguageMatches(track.language, options.preferredLanguage),
        )?.index ??
        serverDefault?.index ??
        availableTracks[0]?.index
      );
    case 'default':
    default:
      return serverDefault?.index;
  }
};

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
    IsFolder?: boolean;
    LocationType?: string;
    RunTimeTicks?: number;
    UserData?: {
      IsFavorite?: boolean;
      Played?: boolean;
      PlayCount?: number;
      PlaybackPositionTicks?: number;
      UnplayedItemCount?: number;
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
  isFolder: item.IsFolder,
  locationType: item.LocationType,
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
  unplayedItemCount: item.UserData?.UnplayedItemCount,
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

/**
 * A failed server response, carrying its status so callers can tell "this is
 * gone" apart from "the server is unhappy". A library scan that drops an item
 * between a list and a detail request is ordinary, not an app error.
 */
export class ServerResponseError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ServerResponseError';
    this.status = status;
  }
}

export const isMissingItemError = (error: unknown) =>
  error instanceof ServerResponseError &&
  (error.status === 404 || error.status === 400);

export const getJson = async <ResponseBody>(
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
      throw new ServerResponseError(
        `Server request failed ${response.status}: ${failedUrl.pathname}`,
        response.status,
      );
    }

    const text = await response.text();

    return (text ? JSON.parse(text) : undefined) as ResponseBody;
  } finally {
    clearTimeout(timeout);
  }
};

// Each scheme candidate gets a shorter budget than a normal request so that
// falling back to the alternate scheme stays within the time a single attempt
// used to take. A server that cannot answer /System/Info/Public inside this
// window is unreachable for practical purposes.
const CONNECT_TIMEOUT_MS = 20000;

/**
 * Probe a server, resolving http/https automatically.
 *
 * The returned `baseUrl` is the URL that actually answered and is what callers
 * must persist and reuse — it may differ in scheme from what the user typed.
 */
export const connect = async (
  serverUrl: string,
): Promise<JellyfinServerInfo> => {
  const candidates = getServerUrlCandidates(serverUrl);

  if (!candidates.length) {
    throw new Error('Enter a server address.');
  }

  let firstError: unknown;

  for (const baseUrl of candidates) {
    try {
      const response = await getJson<{
        Id?: string;
        ServerName?: string;
        Version?: string;
        OperatingSystem?: string;
      }>(`${baseUrl}/System/Info/Public`, {}, CONNECT_TIMEOUT_MS);

      return {
        baseUrl,
        id: response.Id ?? baseUrl,
        name: response.ServerName ?? 'Media Server',
        version: response.Version ?? 'unknown',
        operatingSystem: response.OperatingSystem,
      };
    } catch (error) {
      // Report the failure for what the user actually typed, not for the
      // fallback scheme they never asked about.
      firstError = firstError ?? error;
    }
  }

  throw firstError instanceof Error
    ? firstError
    : new Error('Unable to reach the server.');
};

export const authenticate = async (
  serverUrl: string,
  username: string,
  password: string,
): Promise<JellyfinAuthResult> => {
  const baseUrl = normalizeServerUrl(serverUrl);
  const response = await getJson<{
    User?: {Id?: string; Name?: string};
    AccessToken?: string;
  }>(`${baseUrl}/Users/AuthenticateByName`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getPreAuthHeaders(),
    },
    body: JSON.stringify({
      Username: username,
      Pw: password,
    }),
  });

  if (!response.User?.Id || !response.AccessToken) {
    throw new Error('Authentication response was missing credentials');
  }

  return {
    userId: response.User.Id,
    accessToken: response.AccessToken,
    username: response.User.Name,
  };
};

export interface QuickConnectInitiateResult {
  code: string;
  secret: string;
}

export const isQuickConnectEnabled = async (
  serverUrl: string,
): Promise<boolean> => {
  const baseUrl = normalizeServerUrl(serverUrl);

  try {
    return (await getJson<boolean>(`${baseUrl}/QuickConnect/Enabled`)) === true;
  } catch {
    return false;
  }
};

export const initiateQuickConnect = async (
  serverUrl: string,
): Promise<QuickConnectInitiateResult> => {
  const baseUrl = normalizeServerUrl(serverUrl);
  const response = await getJson<{Code?: string; Secret?: string}>(
    `${baseUrl}/QuickConnect/Initiate`,
    {
      method: 'POST',
      headers: getPreAuthHeaders(),
    },
  );

  if (!response.Code || !response.Secret) {
    throw new Error('Quick Connect could not be started on this server');
  }

  return {code: response.Code, secret: response.Secret};
};

export const pollQuickConnect = async (
  serverUrl: string,
  secret: string,
): Promise<boolean> => {
  const baseUrl = normalizeServerUrl(serverUrl);
  const response = await getJson<{Authenticated?: boolean}>(
    buildUrl(baseUrl, '/QuickConnect/Connect', {Secret: secret}),
    {headers: getPreAuthHeaders()},
  );

  return response.Authenticated === true;
};

export const authenticateWithQuickConnect = async (
  serverUrl: string,
  secret: string,
): Promise<JellyfinAuthResult> => {
  const baseUrl = normalizeServerUrl(serverUrl);
  const response = await getJson<{
    User?: {Id?: string; Name?: string};
    AccessToken?: string;
  }>(`${baseUrl}/Users/AuthenticateWithQuickConnect`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getPreAuthHeaders(),
    },
    body: JSON.stringify({Secret: secret}),
  });

  if (!response.User?.Id || !response.AccessToken) {
    throw new Error(
      'Quick Connect authentication response was missing credentials',
    );
  }

  return {
    userId: response.User.Id,
    accessToken: response.AccessToken,
    username: response.User.Name,
  };
};

export const getLibraries = async (
  serverUrl: string,
  accessToken: string,
  userId: string,
): Promise<JellyfinLibrary[]> => {
  const baseUrl = normalizeServerUrl(serverUrl);
  // /Library/MediaFolders requires admin; per-user views honor library access.
  const response = await getJson<{
    Items?: Array<{
      Id?: string;
      Name?: string;
      CollectionType?: string;
      Type?: string;
    }>;
  }>(buildUrl(baseUrl, '/UserViews', {userId}), {
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
      IsFolder?: boolean;
      LocationType?: string;
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
        options.includeItemTypes === null
          ? undefined
          : options.includeItemTypes ?? 'Movie,Series,Episode,Video',
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

/**
 * Whether the server's first answer already plays exactly the subtitle the
 * policy chose: none selected when none is wanted, or the wanted track
 * already burned in. Anything else needs the source-pinned re-request.
 */
const firstResponseSatisfiesSubtitle = (
  mediaSource:
    | {DefaultSubtitleStreamIndex?: number; TranscodingUrl?: string}
    | undefined,
  wantedSubtitleStreamIndex: number | undefined,
) => {
  const transcodingUrl = mediaSource?.TranscodingUrl ?? '';
  const urlIndex = getUrlParameter(transcodingUrl, 'SubtitleStreamIndex');
  const deliveredIndexValue =
    urlIndex !== undefined
      ? Number(urlIndex)
      : mediaSource?.DefaultSubtitleStreamIndex;
  const deliveredIndex =
    typeof deliveredIndexValue === 'number' &&
    Number.isFinite(deliveredIndexValue) &&
    deliveredIndexValue >= 0
      ? deliveredIndexValue
      : undefined;

  if (wantedSubtitleStreamIndex === undefined) {
    return deliveredIndex === undefined;
  }

  return (
    deliveredIndex === wantedSubtitleStreamIndex &&
    getUrlParameter(transcodingUrl, 'SubtitleMethod')?.toLowerCase() ===
      'encode'
  );
};

export const getStreamUrl = async (
  serverUrl: string,
  accessToken: string,
  itemId: string,
  userId?: string,
  startPositionTicks = 0,
  options: {
    allowAudioStreamCopy?: boolean;
    alwaysBurnInSubtitleWhenTranscoding?: boolean;
    audioStreamIndex?: number;
    forceTranscode?: boolean;
    maxStreamingBitrate?: number;
    mediaSourceId?: string;
    sourceHeight?: number;
    sourceWidth?: number;
    /**
     * True once the viewer chose a track or Off in the player. The request
     * then carries `subtitleStreamIndex` as given (Off as -1) and the global
     * subtitle preference is not consulted.
     */
    subtitleSelectionIsManual?: boolean;
    subtitleStreamIndex?: number;
  } = {},
): Promise<JellyfinStreamInfo> => {
  const baseUrl = normalizeServerUrl(serverUrl);
  const [prefs, userPreferences, audioOutputCapabilities] = await Promise.all([
    readPlaybackPreferences(),
    getUserPreferences().catch((error) => {
      console.warn('[Astra] Unable to read subtitle preference:', error);
      return defaultUserPreferences;
    }),
    getAudioOutputCapabilities(),
  ]);
  const deviceProfile = buildDeviceProfile(prefs, audioOutputCapabilities);
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
      DefaultSubtitleStreamIndex?: number;
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
        BitRate?: number;
        Channels?: number;
        Index?: number;
        Type?: string;
        Title?: string;
        Language?: string;
        Codec?: string;
        Profile?: string;
        SampleRate?: number;
        Width?: number;
        Height?: number;
        DisplayTitle?: string;
        IsDefault?: boolean;
        IsForced?: boolean;
        IsExternal?: boolean;
        DeliveryUrl?: string;
        DeliveryMethod?: string;
      }>;
    }>;
  };
  // A manual Off must reach the server as -1: leaving the field out lets a
  // remembered or default subtitle come back on the next reload.
  const requestedSubtitleStreamIndex = options.subtitleSelectionIsManual
    ? options.subtitleStreamIndex ?? -1
    : options.subtitleStreamIndex;
  const postPlaybackInfo = (
    audioStreamIndex?: number,
    mediaSourceId?: string,
    subtitleStreamIndex: number | undefined = requestedSubtitleStreamIndex,
    alwaysBurnInSubtitleWhenTranscoding:
      | boolean
      | undefined = options.alwaysBurnInSubtitleWhenTranscoding,
    allowVideoStreamCopy: boolean = !options.forceTranscode,
  ) =>
    getJson<PlaybackInfoResponse>(playbackInfoUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(accessToken),
      },
      body: JSON.stringify({
        DeviceProfile: deviceProfile,
        // Jellyfin may silently choose a different compatible audio stream
        // unless the selected media source is pinned alongside the stream
        // index. The id is only known once the server has reported its media
        // sources, so the first request is left unpinned and lets the server
        // pick: an item whose sources are resolved on demand has no source id
        // a client could guess, and sending a wrong one returns nothing.
        MediaSourceId: mediaSourceId,
        UserId: userId,
        StartTimeTicks: startPositionTicks,
        AudioStreamIndex: audioStreamIndex,
        SubtitleStreamIndex: subtitleStreamIndex,
        AlwaysBurnInSubtitleWhenTranscoding:
          alwaysBurnInSubtitleWhenTranscoding,
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
        AllowVideoStreamCopy: allowVideoStreamCopy,
        AllowAudioStreamCopy: options.allowAudioStreamCopy ?? true,
        AutoOpenLiveStream: true,
      }),
    });

  let response = await postPlaybackInfo(
    options.audioStreamIndex,
    options.mediaSourceId,
  );

  // A server may resolve an item's media source only once playback is asked
  // for, in which case the first response can come back with nothing playable
  // while it is still working. Give it one more chance before giving up.
  if (!hasPlayableMediaSource(response)) {
    console.log(
      '[Astra] PlaybackInfo returned no media source; retrying once.',
    );
    await wait(PLAYBACK_INFO_RETRY_MS);
    response = await postPlaybackInfo(
      options.audioStreamIndex,
      options.mediaSourceId,
    );
  }

  if (!hasPlayableMediaSource(response)) {
    throw new Error(
      'The server has no playable source for this item right now.',
    );
  }

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

  const audioNeedsPinning =
    options.audioStreamIndex === undefined && selectedAudioStreamIndex !== null;

  // The global subtitle preference is resolved against the source the server
  // just named. A manual choice from the player overlay went out on the first
  // request already and is passed through untouched.
  const firstMediaSource = response.MediaSources?.[0];
  const selectedSubtitleStreamIndex = selectSubtitleStreamIndex(
    (firstMediaSource?.MediaStreams ?? [])
      .filter((stream) => stream.Type === 'Subtitle')
      .map((stream) => ({
        index: stream.Index,
        isForced: stream.IsForced,
        language: stream.Language,
      })),
    {
      mode: userPreferences.subtitleMode,
      preferredLanguage: userPreferences.preferredSubtitleLanguage,
      serverDefaultSubtitleStreamIndex:
        firstMediaSource?.DefaultSubtitleStreamIndex,
      manualSelection: options.subtitleSelectionIsManual
        ? {streamIndex: options.subtitleStreamIndex}
        : undefined,
    },
  );
  // Every subtitle is burned in by the server (see mapTrack below), so a
  // selected track always means burn-in.
  const selectedSubtitleBurnIn = selectedSubtitleStreamIndex !== undefined;
  const subtitleNeedsPinning =
    !options.subtitleSelectionIsManual &&
    !firstResponseSatisfiesSubtitle(
      firstMediaSource,
      selectedSubtitleStreamIndex,
    );

  if (firstMediaSource?.Id && (audioNeedsPinning || subtitleNeedsPinning)) {
    // Now that the server has named its source, pin the re-request to it so
    // the chosen audio and subtitle stream indexes refer to the same source.
    // A burned-in subtitle takes the same request shape as the in-player
    // switch that passed on hardware: no video stream copy.
    const resolved = await postPlaybackInfo(
      selectedAudioStreamIndex ?? undefined,
      firstMediaSource.Id,
      selectedSubtitleStreamIndex ?? -1,
      selectedSubtitleBurnIn || options.alwaysBurnInSubtitleWhenTranscoding,
      !options.forceTranscode && !selectedSubtitleBurnIn,
    );

    if (hasPlayableMediaSource(resolved)) {
      response = resolved;
    }
  }
  const mediaSource = response.MediaSources?.[0];
  const shouldUseTranscode = Boolean(mediaSource?.TranscodingUrl);
  const streams = mediaSource?.MediaStreams ?? [];
  const selectedVideoStream = streams.find((stream) => stream.Type === 'Video');
  const sourceWidth =
    mediaSource?.Width ?? selectedVideoStream?.Width ?? options.sourceWidth;
  const sourceHeight =
    mediaSource?.Height ?? selectedVideoStream?.Height ?? options.sourceHeight;
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
    throw new Error('No playable URL returned from the server.');
  }
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
      bitrate: track.BitRate,
      language: track.Language,
      codec: track.Codec,
      profile: track.Profile,
      sampleRate: track.SampleRate,
      channels: track.Channels,
      displayTitle: track.DisplayTitle,
      deliveryMethod: track.DeliveryMethod,
      isDefault: track.IsDefault,
      isForced: track.IsForced,
      isExternal: track.IsExternal,
      deliveryUrl,
      // Every subtitle is burned in by the server. Astra used to render text
      // tracks itself and leave picture-based ones to Jellyfin, which meant two
      // code paths, two failure modes, and app-rendered subtitles that drifted
      // out of sync after a long seek. One path costs a reload on each subtitle
      // change and is worth it. Revert this single expression to
      // `isSubtitle && (!deliveryUrl || !textTrackSupported)` to restore
      // app-side rendering; nothing else was removed.
      burnInRequired: isSubtitle,
      mimeType: isSubtitle
        ? subtitleMimeForDelivery(deliveryUrl, track.Codec)
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
          sourceHeight ? `${sourceHeight}p` : undefined,
          mediaSource.Bitrate
            ? `${Math.round(mediaSource.Bitrate / 1000000)} Mbps`
            : undefined,
          mediaSource.Container,
        ]
          .filter(Boolean)
          .join(' / '),
        bitrate: mediaSource.Bitrate,
        height: sourceHeight,
        width: sourceWidth,
      }
    : undefined;
  const deliveredAudioStreamIndexValue = getUrlParameter(
    url,
    'AudioStreamIndex',
  );
  const deliveredAudioStreamIndex = deliveredAudioStreamIndexValue
    ? Number(deliveredAudioStreamIndexValue)
    : selectedAudioStreamIndex ?? undefined;
  const deliveredAudioStream = streams.find(
    (stream) =>
      stream.Type === 'Audio' && stream.Index === deliveredAudioStreamIndex,
  );
  const audioDelivery = describeDelivery(
    url,
    deliveredAudioStream?.Codec,
    'AudioCodec',
    'AllowAudioStreamCopy',
  );
  const videoDelivery = describeDelivery(
    url,
    selectedVideoStream?.Codec,
    'VideoCodec',
    'AllowVideoStreamCopy',
  );
  const transcodeReasons = (getUrlParameter(url, 'TranscodeReasons') ?? '')
    .split(',')
    .map((reason) => reason.trim())
    .filter(Boolean);
  const outputAudioBitrate =
    audioDelivery.method === 'Copy'
      ? deliveredAudioStream?.BitRate
      : Number(getUrlParameter(url, 'AudioBitrate')) || undefined;
  const adaptiveStream = isAdaptiveStreamUrl(url);

  return {
    itemId,
    audioStreamIndex: selectedAudioStreamIndex ?? undefined,
    audioTracks: streams
      .filter((track) => track.Type === 'Audio')
      .map((track) => mapTrack(track)),
    bitrate: mediaSource?.Bitrate,
    container: mediaSource?.Container,
    sourceContainer: mediaSource?.Container,
    outputContainer:
      getUrlParameter(url, 'SegmentContainer') ??
      (isAdaptiveStreamUrl(url) ? 'fMP4 HLS' : mediaSource?.Container),
    sourceAudioBitrate: deliveredAudioStream?.BitRate,
    sourceAudioCodec: deliveredAudioStream?.Codec,
    sourceAudioProfile: deliveredAudioStream?.Profile,
    sourceAudioSampleRate: deliveredAudioStream?.SampleRate,
    sourceVideoCodec: selectedVideoStream?.Codec,
    outputAudioBitrate,
    outputAudioCodec: audioDelivery.codec,
    outputVideoCodec: videoDelivery.codec,
    audioDeliveryMethod: audioDelivery.method,
    videoDeliveryMethod: videoDelivery.method,
    transcodeReasons,
    deliveredAudioCodec: audioDelivery.codec ?? deliveredAudioStream?.Codec,
    deliveredAudioStreamIndex,
    deliveredVideoCodec: videoDelivery.codec ?? selectedVideoStream?.Codec,
    audioOutputCapabilities,
    audioTranscodePolicy: deviceProfile.TranscodingProfiles[0].AudioCodec,
    height: sourceHeight,
    hlsMinimumSegmentCount: adaptiveStream
      ? getPositiveUrlNumber(url, 'MinSegments') ?? 1
      : undefined,
    hlsSegmentTargetSeconds: adaptiveStream
      ? getPositiveUrlNumber(url, 'SegmentLength') ??
        (prefs.hlsSegmentLengthSeconds || undefined)
      : undefined,
    width: sourceWidth,
    mediaSourceId: mediaSource?.Id,
    playSessionId: response.PlaySessionId,
    playMethod,
    qualityOptions: directQuality
      ? [directQuality, ...qualityCaps]
      : qualityCaps,
    runTimeTicks: mediaSource?.RunTimeTicks,
    startPositionTicks,
    subtitleStreamIndex: selectedSubtitleStreamIndex,
    subtitleBurnIn: selectedSubtitleBurnIn,
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

/**
 * The item's neighbours in series order: the server returns the previous
 * episode, the episode itself and the next one, across season boundaries.
 * A caller picks the one after `episodeId`.
 */
export const getAdjacentEpisodes = (
  serverUrl: string,
  accessToken: string,
  userId: string,
  seriesId: string,
  episodeId: string,
) =>
  getItemCollection(serverUrl, accessToken, `/Shows/${seriesId}/Episodes`, {
    UserId: userId,
    AdjacentTo: episodeId,
    Fields: itemFields,
    ImageTypeLimit: 1,
    EnableImageTypes: 'Primary,Backdrop',
  });

/**
 * The item's credits segments. Servers before 10.10 have no such endpoint
 * and answer 404, which simply means the server knows of no credits.
 */
export const getMediaSegments = async (
  serverUrl: string,
  accessToken: string,
  itemId: string,
): Promise<JellyfinMediaSegment[]> => {
  const baseUrl = normalizeServerUrl(serverUrl);
  let response: {
    Items?: Array<{
      EndTicks?: number;
      Id?: string;
      StartTicks?: number;
      Type?: string;
    }>;
  };

  try {
    response = await getJson(
      buildUrl(baseUrl, `/MediaSegments/${itemId}`, {
        IncludeSegmentTypes: 'Outro',
        api_key: accessToken,
      }),
      {headers: getAuthHeaders(accessToken)},
    );
  } catch (error) {
    if (error instanceof ServerResponseError && error.status === 404) {
      return [];
    }
    throw error;
  }

  return (response?.Items ?? []).flatMap((segment) =>
    typeof segment.StartTicks === 'number' &&
    typeof segment.EndTicks === 'number' &&
    segment.EndTicks > segment.StartTicks
      ? [
          {
            endTicks: segment.EndTicks,
            id: segment.Id,
            startTicks: segment.StartTicks,
            type: segment.Type ?? '',
          },
        ]
      : [],
  );
};

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

/**
 * Omitting seasonId asks for every episode in the series, which is the only
 * way to reach the episodes of a series whose season list has not been built.
 */
export const getEpisodes = (
  serverUrl: string,
  accessToken: string,
  userId: string,
  seriesId: string,
  seasonId?: string,
) =>
  getItemCollection(serverUrl, accessToken, `/Shows/${seriesId}/Episodes`, {
    UserId: userId,
    SeasonId: seasonId,
    Fields: itemFields,
    ImageTypeLimit: 1,
    EnableImageTypes: 'Primary,Backdrop',
  });

/**
 * The newest items inside one view. Lets the home screen surface a library
 * the server only just started returning, without the app knowing its name.
 */
export const getLatestItemsInLibrary = (
  serverUrl: string,
  accessToken: string,
  userId: string,
  libraryId: string,
) =>
  getItemCollection(serverUrl, accessToken, `/Users/${userId}/Items`, {
    ParentId: libraryId,
    Recursive: true,
    IsFolder: false,
    SortBy: 'DateCreated',
    SortOrder: 'Descending',
    Fields: itemFields,
    ImageTypeLimit: 1,
    EnableImageTypes: 'Primary,Backdrop',
    Limit: 24,
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
      name: response.ServerName ?? 'Media Server',
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
