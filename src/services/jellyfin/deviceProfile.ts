import {PlaybackPreferences} from '../storage';
import {ENABLE_UNVERIFIED_DTS_REMUX_TRIAL} from '../../config/app';
import {
  AudioOutputCapabilities,
  defaultAudioOutputCapabilities,
} from '../mediaCapabilities';
import {
  VideoDecodeLimits,
  defaultVideoDecodeLimits,
} from '../mediaCapabilities/decodeLimits';

/**
 * UHD width. A decoder whose ceiling reaches it needs no condition: a limit is
 * only worth declaring to stop the server offering something the device cannot
 * decode, and this one can.
 */
const UHD_WIDTH = 3840;

/**
 * The width the server must not exceed, or undefined to declare no limit.
 *
 * There are two ways to get `undefined` and both are deliberate. An unanswered
 * probe declares nothing, because `getMaxSupportedResolution` reports zero for
 * a device that does not support the query as readily as for a codec string it
 * cannot parse, and reading that as "cap this device at zero" would break every
 * device. A ceiling that reaches UHD declares nothing, because a condition
 * there would downscale 4K hardware for no gain. Only a definite answer below
 * UHD -- an HD-only stick, which is issue #21 -- produces a condition.
 */
export const declaredMaxVideoWidth = (
  limits: VideoDecodeLimits,
): number | undefined => {
  if (!limits.probeSucceeded || limits.controlsFailed) {
    return undefined;
  }

  const {maxWidth} = limits;

  if (!maxWidth || maxWidth <= 0 || maxWidth >= UHD_WIDTH) {
    return undefined;
  }

  return maxWidth;
};

/**
 * One line for Stats for Nerds: what the decoder reported and whether that
 * became a cap. Reporters on HD-only sticks can read it back, which is the
 * only way to learn what those devices really answer.
 */
export const describeDecodeLimits = (limits: VideoDecodeLimits): string => {
  if (!limits.probeSucceeded) {
    return 'not reported, no cap sent';
  }

  if (limits.controlsFailed) {
    return 'answer not trusted (controls failed), no cap sent';
  }

  const reported = limits.maxWidth
    ? `${limits.maxWidth}x${limits.maxHeight ?? '?'}`
    : 'no answer';
  const cap = declaredMaxVideoWidth(limits);

  return cap === undefined
    ? `${reported}, no cap sent`
    : `${reported}, capped at ${cap} wide`;
};

const segmentLengthPreference = (prefs: PlaybackPreferences) =>
  prefs.hlsSegmentLengthSeconds
    ? {SegmentLength: prefs.hlsSegmentLengthSeconds}
    : {};

export const buildTranscodingAudioCodecs = (
  capabilities: AudioOutputCapabilities,
  enableUnverifiedDtsRemuxTrial = ENABLE_UNVERIFIED_DTS_REMUX_TRIAL,
) => {
  const codecs = [
    capabilities.ac3 ? 'ac3' : undefined,
    capabilities.eac3 ? 'eac3' : undefined,
    'aac',
    capabilities.opus ? 'opus' : undefined,
    capabilities.mp3 ? 'mp3' : undefined,
    enableUnverifiedDtsRemuxTrial || capabilities.dtsDirectPlayVerified
      ? 'dts'
      : undefined,
  ].filter((codec): codec is string => Boolean(codec));

  return codecs.join(',');
};

export const buildDeviceProfile = (
  prefs: PlaybackPreferences,
  audioCapabilities: AudioOutputCapabilities = defaultAudioOutputCapabilities,
  enableUnverifiedDtsRemuxTrial = ENABLE_UNVERIFIED_DTS_REMUX_TRIAL,
  videoDecodeLimits: VideoDecodeLimits = defaultVideoDecodeLimits,
  h264MaxBitrate?: number,
) => {
  const audioCodecs = buildTranscodingAudioCodecs(
    audioCapabilities,
    enableUnverifiedDtsRemuxTrial,
  );
  // Long physical runs show Vega gradually renders AAC ahead of HEVC when
  // both are delivered in MPEG-TS, even though the server's A/V timestamps
  // remain stable within roughly 40-82 ms for the entire movie. A seek or
  // pause/resume re-anchors the native clocks, matching the older AAC drift
  // that AC3 delivery fixed. Isolate that codec variable only on the HEVC/TS
  // route; safely retain the normal capability policy when AC3 is unavailable.
  const mpegTsAudioCodecs = audioCapabilities.ac3 ? 'ac3' : audioCodecs;
  const maxVideoWidth = declaredMaxVideoWidth(videoDecodeLimits);
  // Empty when the device declared no ceiling; see `declaredMaxVideoWidth`.
  // Jellyfin reads this as a decoder limit: a source wider than it is
  // re-encoded, and therefore downscaled, instead of being offered as-is.
  const videoWidthConditions =
    maxVideoWidth === undefined
      ? []
      : [
          {
            Condition: 'LessThanEqual',
            Property: 'Width',
            Value: String(maxVideoWidth),
            IsRequired: true,
          },
        ];

  // HEVC physical-device trial: use MPEG-TS HLS segments. Jellyfin's
  // fMP4 muxer rewrites open-GOP keyframe PTS onto a following B-frame,
  // producing duplicate timestamps that Vega renders as micro-stutter.
  // An equivalent MPEG-TS remux preserves every source timestamp. Keep
  // HEVC first so incompatible/HDR sources still transcode to HEVC.
  const hevcTsProfile = {
    Type: 'Video',
    Container: 'ts',
    VideoCodec: 'hevc',
    AudioCodec: mpegTsAudioCodecs,
    Protocol: 'hls',
    Context: 'Streaming',
    MaxAudioChannels: String(Math.min(prefs.maxAudioChannels, 6)),
    MinSegments: 1,
    ...segmentLengthPreference(prefs),
    BreakOnNonKeyFrames: true,
  };
  // Settings experiment: HEVC as fMP4 with H.264 as the server's second
  // choice, and 2-second segments unless the viewer picked a length. Off by
  // default until it has a long run on the sticks next to the TS path.
  const hevcFmp4Profile = {
    Type: 'Video',
    Container: 'mp4',
    VideoCodec: 'hevc,h264',
    AudioCodec: audioCodecs,
    Protocol: 'hls',
    Context: 'Streaming',
    MaxAudioChannels: String(Math.min(prefs.maxAudioChannels, 6)),
    MinSegments: 1,
    SegmentLength: prefs.hlsSegmentLengthSeconds || 2,
    BreakOnNonKeyFrames: true,
  };

  return {
    DirectPlayProfiles: [
      {
        Type: 'Video',
        Container: 'mp4,mkv,mov,avi,ts,webm,m4v',
        VideoCodec: 'h264,hevc,av1,vp9,vp8,mpeg4',
        // Direct-file playback is currently disabled, but keep this profile
        // aligned with the runtime-gated HLS remux codecs. DTS is included
        // only by the explicitly temporary physical-device trial flag.
        AudioCodec: [
          'aac',
          audioCapabilities.opus ? 'opus' : undefined,
          audioCapabilities.mp3 ? 'mp3' : undefined,
          audioCapabilities.ac3 ? 'ac3' : undefined,
          audioCapabilities.eac3 ? 'eac3' : undefined,
          enableUnverifiedDtsRemuxTrial ||
          audioCapabilities.dtsDirectPlayVerified
            ? 'dts'
            : undefined,
        ]
          .filter(Boolean)
          .join(','),
      },
    ],
    TranscodingProfiles: [
      ...(prefs.hevcFmp4Experiment ? [hevcFmp4Profile] : [hevcTsProfile]),
      // Keep compatible h264 on the established fMP4 path so this experiment
      // changes only HEVC delivery.
      {
        Type: 'Video',
        Container: 'mp4',
        VideoCodec: 'h264',
        AudioCodec: audioCodecs,
        Protocol: 'hls',
        Context: 'Streaming',
        MaxAudioChannels: String(Math.min(prefs.maxAudioChannels, 6)),
        MinSegments: 1,
        ...segmentLengthPreference(prefs),
        BreakOnNonKeyFrames: true,
      },
      {
        Type: 'Video',
        Container: 'mp4',
        VideoCodec: 'h264',
        AudioCodec: audioCodecs,
        Protocol: 'http',
        Context: 'Streaming',
        MaxAudioChannels: String(Math.min(prefs.maxAudioChannels, 6)),
      },
    ],
    ContainerProfiles: [],
    CodecProfiles: [
      // The H.264 decoder's published bitrate limit for this model (20 Mbps on
      // the 2026 sticks, 30 on the 4K Select). A remux above it is re-encoded
      // instead of copied. HEVC gets no such limit: Amazon lists 35 Mbps, but
      // HEVC remuxes well above that play, and capping them would only force
      // re-encodes. VP9 and AV1 are never copied into our HLS profiles, so a
      // limit on them would change nothing.
      ...(h264MaxBitrate
        ? [
            {
              Type: 'Video',
              Codec: 'h264',
              Conditions: [
                {
                  Condition: 'LessThanEqual',
                  Property: 'VideoBitrate',
                  Value: String(h264MaxBitrate),
                  IsRequired: false,
                },
              ],
            },
          ]
        : []),
      // EXPERIMENT (2026-09-05, build 20260905.11) -- revert this Value to
      // 'SDR' to restore the previous behaviour. Nothing else changed.
      //
      // This used to be 'SDR' alone, so every HDR source was re-encoded to
      // tonemapped SDR HEVC. The justification was that the device sink
      // rejects HDR10 -- but that came from the direct-play `setSrcUri` ANR,
      // which is evidence about raw-file direct play (disabled) and not about
      // the MSE/HLS path every stream actually takes. The on-device
      // `decodingInfo` probe (`mediaCapabilities/hdr.ts`, event `media.hdr`)
      // returned `verdict: 'hdr10-supported'` with its controls intact,
      // including the garbage-transfer control that proves the platform really
      // does parse the colour fields. That removes the evidence for 'SDR'; it
      // does not by itself prove end-to-end HDR playback, which is what this
      // build is for.
      //
      // HDR10 and HLG only. Dolby Vision and HDR10+ stay excluded: the probe
      // asked about `pq` and `hlg` transfers and said nothing whatever about
      // either, and a DV title would add a second unanswered question to a
      // test built to answer one.
      //
      // Do NOT add resolution conditions on h264 here: Jellyfin applies
      // conditions across every codec listed in a TranscodingProfile, so an
      // h264 width cap silently downscales HEVC output too (observed:
      // Neighbors 4K forced to 1080p). The width condition below sits on the
      // hevc profile on purpose -- that downscale is the whole point of it.
      {
        Type: 'Video',
        Codec: 'hevc',
        Conditions: [
          {
            Condition: 'EqualsAny',
            Property: 'VideoRangeType',
            Value: 'SDR|HDR10|HLG',
            IsRequired: true,
          },
          // Issue #21. An HD-only stick was offered a 4K stream for every 4K
          // title, stopped at 0 ms, and never fetched a segment: the source
          // fitted this profile, so the server had no reason to downscale. The
          // condition is what gives it one.
          //
          // Verified against Jellyfin 12.1.0, replaying this profile at
          // POST /Items/{id}/PlaybackInfo for a 3840x1612 HDR10 HEVC title:
          // `MaxWidth`/`MaxHeight` on the DeviceProfile itself is ignored and
          // the master playlist still offered 3840x1612 only; a
          // `MaxStreamingBitrate` on the DeviceProfile is ignored too; and
          // `AllowVideoStreamCopy: false` does not downscale either. A
          // CodecProfile condition is the lever that moves the offered
          // resolution.
          //
          // `Width` rather than `Height`: a `Height <= 1080` condition on the
          // same title offered 2573x1080, which is still wider than the panel.
          ...videoWidthConditions,
        ],
      },
    ],
    SubtitleProfiles: [
      {Format: 'vtt', Method: 'External'},
      {Format: 'webvtt', Method: 'External'},
      {Format: 'srt', Method: 'External'},
      {Format: 'subrip', Method: 'External'},
      {Format: 'ttml', Method: 'External'},
      // MP4 timed text. Jellyfin converts it to WebVTT on the Subtitles
      // endpoint like any other text format.
      {Format: 'mov_text', Method: 'External'},
      // Vega's caption surface renders timed text, not bitmap subtitles or
      // styled ASS/SSA. Ask Jellyfin to burn these formats into the video
      // instead of advertising them as external tracks that cannot render.
      {Format: 'ass', Method: 'Encode'},
      {Format: 'ssa', Method: 'Encode'},
      {Format: 'pgs', Method: 'Encode'},
      {Format: 'pgssub', Method: 'Encode'},
      {Format: 'dvbsub', Method: 'Encode'},
      {Format: 'dvdsub', Method: 'Encode'},
      {Format: 'idx', Method: 'Encode'},
    ],
  };
};
