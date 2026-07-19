import {PlaybackPreferences} from '../storage';
import {ENABLE_UNVERIFIED_DTS_REMUX_TRIAL} from '../../config/app';
import {
  AudioOutputCapabilities,
  defaultAudioOutputCapabilities,
} from '../mediaCapabilities';

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
      // Primary delivery: HLS with fMP4 segments. Listing both codecs lets
      // the server STREAM-COPY compatible sources into segments (full source
      // quality, no GPU) and only re-encode when a CodecProfile condition
      // fails — HDR10 becomes tonemapped 4K HEVC, oversized h264 becomes
      // HEVC. HEVC is first so re-encodes target it (this device's h264
      // decoder tops out at 1080p, HEVC decodes at 4K).
      {
        Type: 'Video',
        Container: 'mp4',
        VideoCodec: 'hevc,h264',
        AudioCodec: audioCodecs,
        Protocol: 'hls',
        Context: 'Streaming',
        MaxAudioChannels: String(Math.min(prefs.maxAudioChannels, 6)),
        MinSegments: 1,
        BreakOnNonKeyFrames: true,
      },
      {
        Type: 'Video',
        Container: 'ts',
        VideoCodec: 'h264',
        AudioCodec: audioCodecs,
        Protocol: 'hls',
        Context: 'Streaming',
        MaxAudioChannels: String(Math.min(prefs.maxAudioChannels, 6)),
        MinSegments: 1,
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
