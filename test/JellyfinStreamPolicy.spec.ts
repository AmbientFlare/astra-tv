import {
  buildDeviceProfile,
  buildTranscodingAudioCodecs,
} from '../src/services/jellyfin/deviceProfile';
import {defaultPlaybackPrefs} from '../src/services/storage';
import type {AudioOutputCapabilities} from '../src/services/mediaCapabilities';
import {
  sanitizeUrlForLog,
  subtitleMimeForDelivery,
} from '../src/services/jellyfin';

const capabilities = (
  overrides: Partial<AudioOutputCapabilities> = {},
): AudioOutputCapabilities => ({
  ac3: false,
  eac3: false,
  mp3: false,
  opus: false,
  dtsProbeSupported: false,
  dtsDirectPlayVerified: false,
  preferredTranscodeCodec: 'aac',
  probeSucceeded: true,
  ...overrides,
});

describe('Jellyfin diagnostic URL privacy', () => {
  it('drops the complete query and redacts media IDs from absolute URLs', () => {
    expect(
      sanitizeUrlForLog(
        'http://media.example:8096/videos/2f38ff46-b851-75a1-4be6-e80b2d093b94/master.m3u8?ApiKey=secret&PlaySessionId=session',
      ),
    ).toBe('http://media.example:8096/videos/[id]/master.m3u8');
  });

  it('does not leak queries when handed a relative or malformed URL', () => {
    expect(
      sanitizeUrlForLog(
        '/videos/2f38ff46b85175a14be6e80b2d093b94/master.m3u8?api_key=secret',
      ),
    ).toBe('/videos/[id]/master.m3u8');
  });
});

describe('Jellyfin audio delivery policy', () => {
  it('does not advertise unverified DTS in the production profile', () => {
    const profile = buildDeviceProfile(
      defaultPlaybackPrefs,
      capabilities({
        ac3: true,
        dtsProbeSupported: true,
        preferredTranscodeCodec: 'ac3',
      }),
      false,
    );

    expect(profile.DirectPlayProfiles[0].AudioCodec).not.toContain('dts');
    expect(profile.TranscodingProfiles[0].AudioCodec).not.toContain('dts');
  });

  it('prefers AC3 for incompatible source tracks when the output supports it', () => {
    const result = buildTranscodingAudioCodecs(
      capabilities({
        ac3: true,
        eac3: true,
        preferredTranscodeCodec: 'ac3',
      }),
      false,
    );

    expect(result).toBe('ac3,eac3,aac');
  });

  it('uses EAC3 when AC3 is unavailable and always retains AAC fallback', () => {
    expect(
      buildTranscodingAudioCodecs(
        capabilities({eac3: true, preferredTranscodeCodec: 'eac3'}),
        false,
      ),
    ).toBe('eac3,aac');
  });

  it('falls back safely to AAC when capability probing is unavailable', () => {
    expect(buildTranscodingAudioCodecs(capabilities(), false)).toBe('aac');
  });

  it('advertises runtime-supported remux codecs in the physical-device trial', () => {
    const profile = buildDeviceProfile(
      defaultPlaybackPrefs,
      capabilities({
        ac3: true,
        mp3: true,
        opus: true,
        dtsProbeSupported: true,
        preferredTranscodeCodec: 'ac3',
      }),
      true,
    );

    expect(profile.DirectPlayProfiles[0].AudioCodec).toBe(
      'aac,opus,mp3,ac3,dts',
    );
    expect(profile.TranscodingProfiles[0].AudioCodec).toBe('ac3');
    expect(profile.TranscodingProfiles[1].AudioCodec).toBe(
      'ac3,aac,opus,mp3,dts',
    );
  });

  it('forces DTS into the physical-device trial even when Vega rejects its probe descriptor', () => {
    const profile = buildDeviceProfile(
      defaultPlaybackPrefs,
      capabilities({
        ac3: true,
        dtsProbeSupported: false,
        preferredTranscodeCodec: 'ac3',
      }),
      true,
    );

    expect(profile.DirectPlayProfiles[0].AudioCodec).toContain('dts');
    expect(profile.TranscodingProfiles[0].AudioCodec).toBe('ac3');
    expect(profile.TranscodingProfiles[1].AudioCodec).toContain('dts');
  });
});

describe('Jellyfin HLS delivery policy', () => {
  const hlsVideoProfiles = (
    hlsSegmentLengthSeconds: 0 | 2 | 3 | 4,
  ): Array<Record<string, unknown>> => {
    const profile = buildDeviceProfile(
      {...defaultPlaybackPrefs, hlsSegmentLengthSeconds},
      capabilities(),
      false,
    );

    return profile.TranscodingProfiles.filter(
      (candidate) => candidate.Type === 'Video' && candidate.Protocol === 'hls',
    );
  };

  it('preserves Jellyfin segment defaults unless compatibility mode is selected', () => {
    const profiles = hlsVideoProfiles(0);

    expect(profiles).toHaveLength(2);
    expect(profiles.every((profile) => !('SegmentLength' in profile))).toBe(
      true,
    );
  });

  it('routes HEVC through MPEG-TS while retaining fMP4 for h264', () => {
    expect(hlsVideoProfiles(0)).toEqual([
      expect.objectContaining({Container: 'ts', VideoCodec: 'hevc'}),
      expect.objectContaining({Container: 'mp4', VideoCodec: 'h264'}),
    ]);
  });

  it('forces AC3 only for HEVC/MPEG-TS when Vega reports AC3 support', () => {
    const profile = buildDeviceProfile(
      defaultPlaybackPrefs,
      capabilities({ac3: true, preferredTranscodeCodec: 'ac3'}),
      false,
    );

    expect(profile.TranscodingProfiles[0]).toEqual(
      expect.objectContaining({
        Container: 'ts',
        VideoCodec: 'hevc',
        AudioCodec: 'ac3',
      }),
    );
    expect(profile.TranscodingProfiles[1]).toEqual(
      expect.objectContaining({
        Container: 'mp4',
        VideoCodec: 'h264',
        AudioCodec: 'ac3,aac',
      }),
    );
  });

  it('retains AAC fallback for HEVC/MPEG-TS when AC3 is unavailable', () => {
    expect(hlsVideoProfiles(0)[0]).toEqual(
      expect.objectContaining({AudioCodec: 'aac'}),
    );
  });

  it.each([4, 3, 2] as const)(
    'requests %i-second segments for every video HLS profile',
    (segmentLength) => {
      const profiles = hlsVideoProfiles(segmentLength);

      expect(profiles).toHaveLength(2);
      expect(profiles).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            Container: 'ts',
            VideoCodec: 'hevc',
            MinSegments: 1,
            SegmentLength: segmentLength,
          }),
          expect.objectContaining({
            Container: 'mp4',
            VideoCodec: 'h264',
            MinSegments: 1,
            SegmentLength: segmentLength,
          }),
        ]),
      );
    },
  );
});

describe('Jellyfin subtitle delivery policy', () => {
  it('delivers timed text externally and burns bitmap or styled subtitles in', () => {
    const profile = buildDeviceProfile(
      defaultPlaybackPrefs,
      capabilities(),
      false,
    );

    expect(profile.SubtitleProfiles).toEqual(
      expect.arrayContaining([
        {Format: 'vtt', Method: 'External'},
        {Format: 'webvtt', Method: 'External'},
        {Format: 'srt', Method: 'External'},
        {Format: 'subrip', Method: 'External'},
        {Format: 'ttml', Method: 'External'},
        {Format: 'pgs', Method: 'Encode'},
        {Format: 'pgssub', Method: 'Encode'},
        {Format: 'ass', Method: 'Encode'},
        {Format: 'ssa', Method: 'Encode'},
      ]),
    );
  });

  it('labels Jellyfin VTT delivery as text/vtt even with authentication parameters', () => {
    expect(
      subtitleMimeForDelivery(
        'https://jellyfin.example/Videos/item/source/Subtitles/3/Stream.vtt?api_key=secret',
        'subrip',
      ),
    ).toBe('text/vtt');
  });

  it('uses the source codec MIME when Jellyfin did not convert the track', () => {
    expect(
      subtitleMimeForDelivery(
        'https://jellyfin.example/subtitles/track.srt?api_key=secret',
        'srt',
      ),
    ).toBe('application/x-subrip');
  });
});
