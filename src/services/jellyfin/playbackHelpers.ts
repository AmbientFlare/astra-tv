import type {
  JellyfinQualityOption,
  SubtitleSelectionTrack,
  SubtitleSelectionOptions,
  JellyfinMediaStream,
} from './types';

export const getUrlParameter = (url: string, name: string) => {
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

export const getCodecChoices = (url: string, parameter: string) =>
  (getUrlParameter(url, parameter) ?? '')
    .split(',')
    .map((codec) => codec.trim().toLowerCase())
    .filter(Boolean);

const permitsStreamCopy = (url: string, parameter: string) =>
  (getUrlParameter(url, parameter) ?? '')
    .split(',')
    .some((value) => value.trim().toLowerCase() === 'true');

export const isAdaptiveStreamUrl = (url: string) => /\.m3u8(?:$|\?)/i.test(url);

export const getPositiveUrlNumber = (url: string, name: string) => {
  const value = Number(getUrlParameter(url, name));
  return Number.isFinite(value) && value > 0 ? value : undefined;
};

export const describeDelivery = (
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

/**
 * How long to wait before asking a server a second time for something it may
 * still be assembling. Long enough to be worth doing, short enough that a
 * viewer reads it as loading rather than as a hang.
 */
export const PLAYBACK_INFO_RETRY_MS = 1500;

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

const normalizeQueryParamName = (name: string) =>
  name.toLowerCase().replace(/_/g, '');

const hasQueryParam = (url: string, paramName: string) => {
  const normalizedName = normalizeQueryParamName(paramName);

  try {
    return Array.from(
      new URL(url, 'http://relative.invalid').searchParams.keys(),
    ).some((key) => normalizeQueryParamName(key) === normalizedName);
  } catch {
    // Keep malformed server URLs harmless and preserve the old fallback's
    // case-insensitive matching, including Jellyfin's legacy underscore form.
    return new RegExp(`[?&]${paramName.replace(/_/g, '')}=`, 'i').test(
      url.replace(/_/g, ''),
    );
  }
};

export const buildTranscodingUrl = (
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

  if (!hasQueryParam(url, 'ApiKey')) {
    url = `${url}${url.includes('?') ? '&' : '?'}ApiKey=${encodeURIComponent(
      accessToken,
    )}`;
  }

  return url;
};

export const qualityCaps: JellyfinQualityOption[] = [
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

export const supportsTextTrack = (codec?: string) =>
  ['webvtt', 'vtt', 'srt', 'subrip', 'ttml', 'mov_text'].includes(
    codec?.toLowerCase() ?? '',
  );

/**
 * Burn-in is a last resort, not a policy. Vega renders timed text, so any
 * format the server can hand over as WebVTT is rendered in-app and leaves the
 * video eligible for a stream copy. Bitmap and styled formats (PGS, VOBSUB,
 * ASS/SSA) have no in-app renderer, so those still cost a re-encode — and a
 * server that explicitly answers `Encode` for a track is believed over the
 * codec name.
 */
export const subtitleRequiresBurnIn = (track: {
  codec?: string;
  deliveryMethod?: string;
}): boolean =>
  track.deliveryMethod === 'Encode' || !supportsTextTrack(track.codec);

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

export const selectAudioStreamIndex = (
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

/**
 * Whether the server's first answer already plays exactly the subtitle the
 * policy chose: none selected when none is wanted, or the wanted track
 * already burned in. Anything else needs the source-pinned re-request.
 */
export const firstResponseSatisfiesSubtitle = (
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
