import type {
  JellyfinStreamInfo,
  JellyfinMediaStream,
  JellyfinMediaTrack,
} from './types';
import {initializeDeviceIdentity} from '../deviceIdentity';
import {
  normalizeServerUrl,
  buildUrl,
  sanitizeUrlForLog,
  getJson,
  getAuthHeaders,
} from './http';
import {
  readPlaybackPreferences,
  getUserPreferences,
  defaultUserPreferences,
} from '../storage';
import {getAudioOutputCapabilities} from '../mediaCapabilities';
import {buildDeviceProfile} from './deviceProfile';
import {
  hasPlayableMediaSource,
  wait,
  PLAYBACK_INFO_RETRY_MS,
  selectAudioStreamIndex,
  selectSubtitleStreamIndex,
  firstResponseSatisfiesSubtitle,
  buildTranscodingUrl,
  supportsTextTrack,
  subtitleMimeForDelivery,
  getUrlParameter,
  describeDelivery,
  isAdaptiveStreamUrl,
  getCodecChoices,
  getPositiveUrlNumber,
  qualityCaps,
} from './playbackHelpers';

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
    signal?: AbortController['signal'];
  } = {},
): Promise<JellyfinStreamInfo> => {
  await initializeDeviceIdentity();
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
        VideoRangeType?: string;
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
      signal: options.signal,
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
    if (options.signal?.aborted)
      throw Object.assign(new Error('Aborted'), {name: 'AbortError'});
    await wait(PLAYBACK_INFO_RETRY_MS);
    if (options.signal?.aborted)
      throw Object.assign(new Error('Aborted'), {name: 'AbortError'});
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
    sourceVideoRangeType: selectedVideoStream?.VideoRangeType,
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
    // Report the policy matching the selected delivery route, not always the
    // first profile (which is video-oriented on some server versions).
    audioTranscodePolicy:
      getCodecChoices(url, 'AudioCodec').join(',') || undefined,
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
