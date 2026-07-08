import {PlaybackPreferences} from '../storage';

export const buildDeviceProfile = (prefs: PlaybackPreferences) => ({
  DirectPlayProfiles: [
    {
      Type: 'Video',
      Container: 'mp4,mkv,mov,avi,ts,webm,m4v',
      VideoCodec: 'h264,hevc,av1,vp9,vp8,mpeg4',
      AudioCodec: 'aac,mp3,ac3,eac3,dts,flac,opus,vorbis,pcm,truehd',
    },
  ],
  TranscodingProfiles: [
    // Experimental high-capability path: ask Jellyfin for DASH/fMP4 first so
    // Shaka can try an MPD manifest with higher-tier audio codecs before the
    // conservative HLS profiles below.
    {
      Type: 'Video',
      Container: 'mp4',
      VideoCodec: 'hevc,h264',
      AudioCodec: 'truehd,dts,eac3,ac3,aac',
      Protocol: 'dash',
      Context: 'Streaming',
      MaxAudioChannels: String(prefs.maxAudioChannels),
      MinSegments: 1,
      BreakOnNonKeyFrames: true,
    },
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
      AudioCodec: 'aac,ac3,eac3',
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
      AudioCodec: 'aac,ac3,eac3',
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
      AudioCodec: 'aac,ac3,eac3',
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
    {Format: 'srt', Method: 'External'},
    {Format: 'ass', Method: 'External'},
    {Format: 'ssa', Method: 'External'},
    {Format: 'pgs', Method: 'External'},
  ],
});
