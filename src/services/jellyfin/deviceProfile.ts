import {PlaybackPreferences} from '../storage';
import {ENABLE_UNVERIFIED_DTS_REMUX_TRIAL} from '../../config/app';
import {
  AudioOutputCapabilities,
  defaultAudioOutputCapabilities,
} from '../mediaCapabilities';

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
      // HEVC physical-device trial: use MPEG-TS HLS segments. Jellyfin's
      // fMP4 muxer rewrites open-GOP keyframe PTS onto a following B-frame,
      // producing duplicate timestamps that Vega renders as micro-stutter.
      // An equivalent MPEG-TS remux preserves every source timestamp. Keep
      // HEVC first so incompatible/HDR sources still transcode to HEVC.
      {
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
      },
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
      // Only SDR HEVC may be stream-copied; HDR10 fails this condition and
      // gets re-encoded to tonemapped SDR HEVC (the device sink rejects
      // HDR10, and untonemapped HDR looks washed out).
      // Do NOT add resolution conditions on h264 here: Jellyfin applies
      // conditions across every codec listed in a TranscodingProfile, so an
      // h264 width cap silently downscales HEVC output too (observed:
      // Neighbors 4K forced to 1080p).
      {
        Type: 'Video',
        Codec: 'hevc',
        Conditions: [
          {
            Condition: 'EqualsAny',
            Property: 'VideoRangeType',
            Value: 'SDR',
            IsRequired: true,
          },
        ],
      },
    ],
    SubtitleProfiles: [
      {Format: 'vtt', Method: 'External'},
      {Format: 'webvtt', Method: 'External'},
      {Format: 'srt', Method: 'External'},
      {Format: 'subrip', Method: 'External'},
      {Format: 'ttml', Method: 'External'},
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
