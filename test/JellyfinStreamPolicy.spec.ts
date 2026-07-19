import {
  buildDeviceProfile,
  buildTranscodingAudioCodecs,
} from '../src/services/jellyfin/deviceProfile';
import {defaultPlaybackPrefs} from '../src/services/storage';
import type {AudioOutputCapabilities} from '../src/services/mediaCapabilities';
import {subtitleMimeForDelivery} from '../src/services/jellyfin';

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
    expect(profile.TranscodingProfiles[0].AudioCodec).toBe(
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
    expect(profile.TranscodingProfiles[0].AudioCodec).toContain('dts');
  });
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
