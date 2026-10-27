import {Platform} from 'react-native';
import {buildDeviceProfile} from '../src/services/jellyfin/deviceProfile';
import {defaultPlaybackPrefs} from '../src/services/storage';
import {
  describeDeviceModel,
  knownDevice,
  readDeviceModel,
  resetDeviceModelCache,
} from '../src/services/deviceModel';

const setConstants = (constants: unknown) => {
  Object.defineProperty(Platform, 'constants', {
    configurable: true,
    get: () => constants,
  });
  resetDeviceModelCache();
};

const h264Conditions = (profile: ReturnType<typeof buildDeviceProfile>) =>
  profile.CodecProfiles.filter(
    (candidate) => candidate.Type === 'Video' && candidate.Codec === 'h264',
  ).flatMap((candidate) => candidate.Conditions);

describe('device model', () => {
  afterEach(() => resetDeviceModelCache());

  it('reads the model and OS release from the platform constants', () => {
    setConstants({Model: 'aftcr001 ', Release: '2.0.1'});

    expect(readDeviceModel()).toEqual({model: 'AFTCR001', os: '2.0.1'});
  });

  it('answers empty strings when the platform reports nothing', () => {
    setConstants(undefined);

    expect(readDeviceModel()).toEqual({model: '', os: ''});
  });

  it('never carries anything but short text', () => {
    setConstants({Model: {nested: true}, Release: 'x'.repeat(200)});

    expect(readDeviceModel()).toEqual({model: '', os: 'x'.repeat(64)});
  });

  it('names the known sticks and falls back to the code', () => {
    expect(describeDeviceModel({model: 'AFTCR001', os: '2.0'})).toBe(
      'Fire TV Stick 4K (3rd Gen) · OS 2.0',
    );
    expect(describeDeviceModel({model: 'AFTZZ9', os: ''})).toBe('AFTZZ9');
    expect(describeDeviceModel({model: '', os: ''})).toBe('model not reported');
  });

  it('uses Amazon’s published H.264 limit per model', () => {
    expect(knownDevice('AFTCA002').h264MaxBitrate).toBe(30_000_000);
    expect(knownDevice('AFTCR001').h264MaxBitrate).toBe(20_000_000);
    expect(knownDevice('AFTCL001').h264MaxBitrate).toBe(20_000_000);
    expect(knownDevice('SOMETHING-NEW').h264MaxBitrate).toBe(20_000_000);
  });
});

describe('per-model codec limits in the device profile', () => {
  it('caps H.264 at the model’s limit and leaves HEVC alone', () => {
    const profile = buildDeviceProfile(
      defaultPlaybackPrefs,
      undefined,
      false,
      undefined,
      20_000_000,
    );

    expect(h264Conditions(profile)).toEqual([
      expect.objectContaining({
        Condition: 'LessThanEqual',
        Property: 'VideoBitrate',
        Value: '20000000',
      }),
    ]);
    const hevcBitrate = profile.CodecProfiles.filter(
      (candidate) => candidate.Codec === 'hevc',
    )
      .flatMap((candidate) => candidate.Conditions)
      .filter((condition) => condition.Property === 'VideoBitrate');
    expect(hevcBitrate).toEqual([]);
  });

  it('adds no H.264 limit when no model limit is passed', () => {
    expect(h264Conditions(buildDeviceProfile(defaultPlaybackPrefs))).toEqual(
      [],
    );
  });
});

describe('HEVC fMP4 experiment', () => {
  const hls = (prefs: Partial<typeof defaultPlaybackPrefs>) =>
    buildDeviceProfile({
      ...defaultPlaybackPrefs,
      ...prefs,
    }).TranscodingProfiles.filter((candidate) => candidate.Protocol === 'hls');

  it('is off by default, keeping HEVC on MPEG-TS', () => {
    expect(defaultPlaybackPrefs.hevcFmp4Experiment).toBe(false);
    expect(hls({})[0]).toEqual(
      expect.objectContaining({Container: 'ts', VideoCodec: 'hevc'}),
    );
  });

  it('sends HEVC with an H.264 fallback as fMP4 in 2-second segments', () => {
    expect(hls({hevcFmp4Experiment: true})).toEqual([
      expect.objectContaining({
        Container: 'mp4',
        VideoCodec: 'hevc,h264',
        SegmentLength: 2,
      }),
      expect.objectContaining({Container: 'mp4', VideoCodec: 'h264'}),
    ]);
  });

  it('keeps a segment length the viewer chose', () => {
    expect(
      hls({hevcFmp4Experiment: true, hlsSegmentLengthSeconds: 4})[0],
    ).toEqual(expect.objectContaining({SegmentLength: 4}));
  });
});
