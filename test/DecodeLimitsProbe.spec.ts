import {
  probeVideoDecodeLimits,
  getVideoDecodeLimits,
  resetVideoDecodeLimitsCache,
} from '../src/services/mediaCapabilities/decodeLimits';

/** The strings the probe asks with, in order, for assertions below. */
const PLAYING_CONTROL = 'video/mp2t; codecs="hvc1.1.4.L120.B0"';
const GARBAGE_CODEC_CONTROL = 'video/mp2t; codecs="zzzz.9.9.L999.X9"';
const NON_VIDEO_CONTROL = 'audio/mp4; codecs="ac-3"';
const DELIVERY = 'video/mp2t; codecs="hvc1.2.4.L153.B0"';

/**
 * A platform that gates where Vega does -- the codec family has to be in the
 * registry, and the media type has to be video, before the descriptor is
 * consulted at all -- and reports `ceiling` for anything that gets through.
 * Every test drives the probe entirely off-device.
 */
const descriptor = (
  ceiling: {width: number; height: number},
  override: (mimeType: string) => {width: number; height: number} | null = () =>
    null,
) =>
  jest.fn((mimeType: string) => {
    const overridden = override(mimeType);

    if (overridden) {
      return overridden;
    }

    if (!mimeType.startsWith('video/')) {
      return {width: 0, height: 0};
    }

    const codecs = /codecs="([^"]+)"/.exec(mimeType)?.[1] ?? '';

    // The registry matches the four-character family prefix only, so this is
    // also what makes a nonsense profile or level answerable.
    if (!/^(hvc1|hev1|avc1|av01|vp09)/.test(codecs)) {
      return {width: 0, height: 0};
    }

    return ceiling;
  });

describe('probeVideoDecodeLimits', () => {
  beforeEach(() => {
    resetVideoDecodeLimitsCache();
    jest.restoreAllMocks();
  });

  it('asks only the four configurations whose answers can be read', async () => {
    const query = descriptor({width: 1920, height: 1080});

    await probeVideoDecodeLimits({getMaxSupportedResolution: query});

    expect(query.mock.calls.map(([mimeType]) => mimeType)).toEqual([
      PLAYING_CONTROL,
      GARBAGE_CODEC_CONTROL,
      NON_VIDEO_CONTROL,
      DELIVERY,
    ]);
  });

  it('reports the ceiling of an HD-only device', async () => {
    const limits = await probeVideoDecodeLimits({
      getMaxSupportedResolution: descriptor({width: 1920, height: 1080}),
    });

    expect(limits.probeSucceeded).toBe(true);
    expect(limits.controlsFailed).toBe(false);
    expect(limits.maxWidth).toBe(1920);
    expect(limits.maxHeight).toBe(1080);
    expect(limits.answeredFor).toBe(DELIVERY);
  });

  it('reports a ceiling that reaches UHD without adjusting it', async () => {
    const limits = await probeVideoDecodeLimits({
      getMaxSupportedResolution: descriptor({width: 3840, height: 2160}),
    });

    expect(limits.controlsFailed).toBe(false);
    expect(limits.maxWidth).toBe(3840);
    expect(limits.maxHeight).toBe(2160);
  });

  it('declares nothing when the platform will not describe the route it plays', async () => {
    // The whole mp2t column reads zero, including the configuration that
    // demonstrably plays today -- so the platform is not describing the media
    // pipeline and no ceiling may be read from it.
    const limits = await probeVideoDecodeLimits({
      getMaxSupportedResolution: () => ({width: 0, height: 0}),
    });

    expect(limits.probeSucceeded).toBe(true);
    expect(limits.controlsFailed).toBe(true);
    expect(limits.maxWidth).toBeUndefined();
  });

  it('declares nothing when the platform answers impossible configurations', async () => {
    // A query that answers a resolution for an unknown codec family, or for a
    // codec under a non-video media type, is not discriminating. Its delivery
    // answer is plausible-looking and would be acted on, which is the whole
    // reason these controls exist.
    const limits = await probeVideoDecodeLimits({
      getMaxSupportedResolution: () => ({width: 1920, height: 1080}),
    });

    expect(limits.controlsFailed).toBe(true);
    expect(limits.maxWidth).toBeUndefined();
  });

  it('keeps a real ceiling when a negative control throws', async () => {
    // A platform throwing on a codec string it cannot parse is answering "no
    // information" for that query alone. It must not take the delivery answer
    // down with it, or a device that throws on an audio type would silently
    // stop declaring the limit it needs.
    const limits = await probeVideoDecodeLimits({
      getMaxSupportedResolution: descriptor(
        {width: 1920, height: 1080},
        (m) => {
          if (m === NON_VIDEO_CONTROL) {
            throw new Error('cannot parse');
          }

          return null;
        },
      ),
    });

    expect(limits.controlsFailed).toBe(false);
    expect(limits.maxWidth).toBe(1920);
  });

  it('reports an unusable query rather than throwing, and declares nothing', async () => {
    const limits = await probeVideoDecodeLimits({
      getMaxSupportedResolution: (() => {
        throw new Error('unavailable');
      }) as any,
    });

    expect(limits.probeSucceeded).toBe(true);
    expect(limits.controlsFailed).toBe(true);
    expect(limits.maxWidth).toBeUndefined();
  });

  it('records a payload without the expected shape as no answer', async () => {
    const limits = await probeVideoDecodeLimits({
      getMaxSupportedResolution: (() => undefined) as any,
    });

    expect(limits.controlsFailed).toBe(true);
    expect(limits.maxWidth).toBeUndefined();
  });

  it('caches the probe result across calls', () => {
    const first = getVideoDecodeLimits();
    const second = getVideoDecodeLimits();

    expect(first).toBe(second);
  });

  it('drops the cached result when the cache is reset', () => {
    const first = getVideoDecodeLimits();

    resetVideoDecodeLimitsCache();

    expect(getVideoDecodeLimits()).not.toBe(first);
  });
});
