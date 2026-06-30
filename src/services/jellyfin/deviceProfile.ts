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
  CodecProfiles: [],
  SubtitleProfiles: [
    {Format: 'vtt', Method: 'External'},
    {Format: 'srt', Method: 'External'},
    {Format: 'ass', Method: 'External'},
    {Format: 'ssa', Method: 'External'},
    {Format: 'pgs', Method: 'External'},
  ],
});
