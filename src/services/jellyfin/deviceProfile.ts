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
    // HEVC in fMP4 segments: the only way this device gets 4K out of a
    // transcode (its h264 decoder tops out at 1080p). Requires "Allow
    // encoding in HEVC" on the server; Jellyfin falls through to the h264
    // profile below when HEVC encoding is unavailable.
    {
      Type: 'Video',
      Container: 'mp4',
      VideoCodec: 'hevc',
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
    // HDR10 direct play crashes the native pipeline (KeplerMediaSink
    // rejects the stream and the JS thread stalls in setSrcUri), so only
    // SDR HEVC may direct-play; HDR10 sources get transcoded (tonemapped
    // to SDR by the server).
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
    // Fire TV hardware decodes h264 only up to 1080p (4K decode is
    // HEVC/VP9/AV1 only), so h264 transcodes must be downscaled.
    {
      Type: 'Video',
      Codec: 'h264',
      Conditions: [
        {
          Condition: 'LessThanEqual',
          Property: 'Width',
          Value: '1920',
          IsRequired: true,
        },
        {
          Condition: 'LessThanEqual',
          Property: 'Height',
          Value: '1080',
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
