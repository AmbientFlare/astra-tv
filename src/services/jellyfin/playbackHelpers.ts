import type {
  AudioSelectionOptions,
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

const hasQueryParam = (url: string, paramName: string) =>
  new RegExp(`[?&]${paramName}=`, 'i').test(url);

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

  // Newer servers put `ApiKey` in the URL themselves; see tokenQuery for
  // why both names are sent.
  for (const paramName of ['ApiKey', 'api_key']) {
    if (!hasQueryParam(url, paramName)) {
      url = `${url}${
        url.includes('?') ? '&' : '?'
      }${paramName}=${encodeURIComponent(accessToken)}`;
    }
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

const LANGUAGE_CODES: string[][] = [
  ['en', 'eng', 'english'],
  ['es', 'spa', 'spanish'],
  ['fr', 'fra', 'fre', 'french'],
  ['de', 'deu', 'ger', 'german'],
  ['it', 'ita', 'italian'],
  ['ja', 'jpn', 'japanese'],
  ['ko', 'kor', 'korean'],
  ['pt', 'por', 'portuguese'],
  ['ru', 'rus', 'russian'],
  ['zh', 'zho', 'chi', 'chinese'],
  ['nl', 'nld', 'dut', 'dutch'],
];

/**
 * Settings store two-letter codes (older installs stored English names) while
 * Jellyfin reports three-letter codes, so all three forms count as one
 * language.
 */
export const languageMatches = (
  language: string | undefined,
  preferred: string | undefined,
) => {
  const normalizedLanguage = language?.trim().toLowerCase();
  const normalizedPreferred = preferred?.trim().toLowerCase();
  if (!normalizedLanguage || !normalizedPreferred) {
    return false;
  }
  const codes = LANGUAGE_CODES.find((group) =>
    group.includes(normalizedPreferred),
  ) ?? [normalizedPreferred];
  return codes.includes(normalizedLanguage);
};

/** The audio language setting that defers to the Jellyfin account. */
export const SERVER_AUDIO_LANGUAGE = 'server';

const isSpecificLanguage = (language?: string) =>
  Boolean(language && language !== SERVER_AUDIO_LANGUAGE);

/**
 * Commentary and audio-description tracks are extras: a viewer gets one only
 * by choosing it. Containers rarely flag them, so the track title decides,
 * in the languages Astra ships.
 */
const SECONDARY_TRACK_TITLE =
  /comment|coment|kommentar|audio[ -]?des[ck]r|descriptive|described video|visually impaired/i;
const AUDIO_DESCRIPTION_TAG = /(^|[\s([-])AD($|[\s)\]-])/;

export const isSecondaryTrack = (track: {
  displayTitle?: string;
  title?: string;
}) =>
  [track.title, track.displayTitle].some(
    (text) =>
      Boolean(text) &&
      (SECONDARY_TRACK_TITLE.test(text as string) ||
        AUDIO_DESCRIPTION_TAG.test(text as string)),
  );

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
  const mainTracks = availableTracks.filter(
    (track) => !isSecondaryTrack(track),
  );

  const remembered = options.seriesPick;
  if (remembered) {
    if (remembered.off) {
      return undefined;
    }
    const sameKind = availableTracks.filter(
      (track) =>
        languageMatches(track.language, remembered.language) &&
        Boolean(track.isForced) === Boolean(remembered.forced),
    );
    const match =
      sameKind.find(
        (track) => isSecondaryTrack(track) === Boolean(remembered.secondary),
      ) ?? sameKind[0];
    if (match) {
      return match.index;
    }
  }

  const serverDefault = availableTracks.find(
    (track) => track.index === options.serverDefaultSubtitleStreamIndex,
  );
  const inLanguage = (language?: string) =>
    isSpecificLanguage(language)
      ? mainTracks.find((track) => languageMatches(track.language, language))
      : undefined;

  switch (options.mode) {
    case 'alwaysOff':
      return undefined;
    case 'forcedOnly':
      return availableTracks.find((track) => track.isForced)?.index;
    case 'alwaysOn':
      return (
        inLanguage(options.preferredLanguage)?.index ??
        inLanguage(options.fallbackLanguage)?.index ??
        serverDefault?.index ??
        mainTracks[0]?.index ??
        availableTracks[0]?.index
      );
    case 'default':
    default:
      return serverDefault?.index;
  }
};

/**
 * Picks the audio track for a new session, in this order: the viewer's last
 * pick for the series, the preferred language, the second-choice language,
 * the server's default (which already reflects the Jellyfin account's audio
 * language), the track the file marks as default, then the first one.
 * Commentary and audio description are skipped unless remembered or alone.
 */
export const selectAudioStreamIndex = (
  mediaStreams: JellyfinMediaStream[],
  options: AudioSelectionOptions,
): number | null => {
  const audioStreams = mediaStreams.filter(
    (stream) => stream.type === 'Audio' && stream.index !== undefined,
  );

  if (!audioStreams.length) {
    return null;
  }

  if (audioStreams.length === 1) {
    return audioStreams[0].index ?? null;
  }

  const mainStreams = audioStreams.filter(
    (stream) => !isSecondaryTrack(stream),
  );
  const candidates = mainStreams.length ? mainStreams : audioStreams;

  const remembered = options.seriesPick;
  if (remembered) {
    const sameKind = audioStreams.filter(
      (stream) =>
        languageMatches(stream.language, remembered.language) &&
        isSecondaryTrack(stream) === Boolean(remembered.secondary),
    );
    const match =
      sameKind.find((stream) => stream.channels === remembered.channels) ??
      sameKind[0];
    if (match) {
      return match.index ?? null;
    }
  }

  const inLanguage = (language?: string) => {
    if (!isSpecificLanguage(language)) {
      return undefined;
    }
    const matching = candidates.filter((stream) =>
      languageMatches(stream.language, language),
    );
    return (
      matching.find(
        (stream) => (stream.channels ?? 0) <= options.maxChannels,
      ) ?? matching[0]
    );
  };

  const serverDefault = candidates.find(
    (stream) => stream.index === options.serverDefaultIndex,
  );

  return (
    inLanguage(options.preferredLanguage)?.index ??
    inLanguage(options.fallbackLanguage)?.index ??
    serverDefault?.index ??
    candidates.find((stream) => stream.isDefault)?.index ??
    candidates[0].index ??
    null
  );
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
