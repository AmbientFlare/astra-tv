import {
  probeDeliveryRouteSupport,
  getDeliveryRouteSupport,
  resetDeliveryRouteSupportCache,
  flattenDeliveryRouteSupport,
} from '../src/services/mediaCapabilities/deliveryRoute';

/**
 * Builds a fake `decodingInfo` from a predicate over the video configuration.
 * Every test drives the probe entirely off-device.
 */
const fakeDecodingInfo = (
  supports: (video: {
    contentType: string;
    width: number;
    height: number;
  }) => boolean,
  extra: {smooth?: boolean; powerEfficient?: boolean} = {},
) =>
  jest.fn(async (configuration: {video: any}) => ({
    supported: supports(configuration.video),
    ...extra,
  }));

const levelOf = (contentType: string) => {
  const match = /\.L(\d+)\./.exec(contentType);
  return match ? Number(match[1]) : 0;
};

/**
 * A platform that reads the container, the resolution and the level honestly,
 * with each dimension independently switchable so a test can express exactly
 * one limit at a time.
 */
const honest = (options: {
  mp2t?: boolean;
  mp2tAbove?: number;
  maxWidth?: number;
  maxLevel?: number;
  /** Simulates a platform that does not read the level field at all. */
  ignoresLevel?: boolean;
}) =>
  fakeDecodingInfo((video) => {
    if (
      video.contentType.includes('zzzz') ||
      video.contentType.includes('not-a-real-container')
    ) {
      return false;
    }
    const isTs = video.contentType.startsWith('video/mp2t');
    if (isTs && options.mp2t === false) {
      return false;
    }
    // A container that works only up to a resolution, e.g. TS at 1080p.
    if (isTs && video.width > (options.mp2tAbove ?? Infinity)) {
      return false;
    }
    if (video.width > (options.maxWidth ?? Infinity)) {
      return false;
    }
    const level = levelOf(video.contentType);
    if (!options.ignoresLevel) {
      // Level 4.0 cannot carry more than about 2K; a truthful platform
      // rejects it at 3840x2160 regardless of its own decoder ceiling.
      if (level < 150 && video.width > 1920) {
        return false;
      }
      if (level > (options.maxLevel ?? Infinity)) {
        return false;
      }
    }
    return true;
  });

describe('probeDeliveryRouteSupport', () => {
  beforeEach(() => {
    resetDeliveryRouteSupportCache();
    jest.restoreAllMocks();
  });

  it('finds no limit when the platform accepts every real configuration', async () => {
    const support = await probeDeliveryRouteSupport({
      decodingInfo: honest({}),
    });

    expect(support.probeSucceeded).toBe(true);
    expect(support.controlsFailed).toBe(false);
    expect(support.alwaysTrue).toBe(false);
    expect(support.mp2tUnanswerable).toBe(false);
    expect(support.results.tsUhdL150.supported).toBe(true);
    expect(support.levelFieldIgnored).toBe(false);
    expect(support.verdict).toBe('no-limit-found');
  });

  it('reports a container limit at 4K when TS works at 1080p but not 2160p', async () => {
    const support = await probeDeliveryRouteSupport({
      decodingInfo: honest({mp2tAbove: 1920, maxLevel: 150}),
    });

    expect(support.controlsFailed).toBe(false);
    expect(support.levelFieldIgnored).toBe(false);
    expect(support.mp2tUnanswerable).toBe(false);
    expect(support.results.tsFhdL150.supported).toBe(true);
    expect(support.results.tsUhdL150.supported).toBe(false);
    expect(support.results.mp4UhdL150.supported).toBe(true);
    expect(support.verdict).toBe('container-limit-at-uhd');
  });

  it('reports a resolution limit when neither container takes 4K', async () => {
    const support = await probeDeliveryRouteSupport({
      decodingInfo: honest({maxWidth: 1920, maxLevel: 150}),
    });

    expect(support.results.tsFhdL150.supported).toBe(true);
    expect(support.results.mp4UhdL150.supported).toBe(false);
    expect(support.results.tsUhdL150.supported).toBe(false);
    expect(support.verdict).toBe('resolution-limit-at-uhd');
  });

  it('reports a level limit when the higher level is refused at a fixed resolution', async () => {
    const support = await probeDeliveryRouteSupport({
      decodingInfo: honest({maxLevel: 120}),
    });

    expect(support.results.tsFhdL120.supported).toBe(true);
    expect(support.results.tsFhdL150.supported).toBe(false);
    expect(support.verdict).toBe('level-limit');
  });

  it('reports a level limit when L153 is refused at 4K but L150 is not', async () => {
    const support = await probeDeliveryRouteSupport({
      decodingInfo: honest({maxLevel: 150}),
    });

    expect(support.results.tsUhdL150.supported).toBe(true);
    expect(support.results.tsUhdL153.supported).toBe(false);
    expect(support.verdict).toBe('level-limit');
  });

  it('declares mp2t unanswerable when the production positive control fails', async () => {
    // The whole mp2t column reads false, but a stream in exactly that
    // configuration plays on the device today -- so the platform is not
    // describing the container rather than rejecting it.
    const support = await probeDeliveryRouteSupport({
      decodingInfo: honest({mp2t: false, maxLevel: 150}),
    });

    expect(support.results.tsFhdMain8Control.supported).toBe(false);
    expect(support.mp2tUnanswerable).toBe(true);
    expect(support.verdict).toBe('mp2t-unanswerable');
  });

  it('flags a platform that accepts impossible configurations', async () => {
    const support = await probeDeliveryRouteSupport({
      decodingInfo: fakeDecodingInfo(() => true),
    });

    expect(support.alwaysTrue).toBe(true);
    expect(support.controlsFailed).toBe(true);
    expect(support.verdict).toBe('inconclusive');
  });

  it('flags the level field as ignored when 4K passes at level 4.0', async () => {
    // Level 4.0 cannot legally carry 3840x2160; accepting it voids every
    // level conclusion, so the verdict must not claim a level limit.
    const support = await probeDeliveryRouteSupport({
      decodingInfo: honest({ignoresLevel: true, mp2tAbove: 1920}),
    });

    expect(support.results.mp4UhdL120.supported).toBe(true);
    expect(support.levelFieldIgnored).toBe(true);
    expect(support.verdict).toBe('inconclusive');
  });

  it('retries with paired audio when a video-only configuration is rejected', async () => {
    const decodingInfo = jest.fn(async (configuration: any) => {
      if (!configuration.audio) {
        throw new Error('audio is required');
      }
      return {supported: true};
    });

    const support = await probeDeliveryRouteSupport({decodingInfo});

    expect(support.configurationShape).toBe('video+audio');
    expect(support.probeSucceeded).toBe(true);
  });

  it('records a throwing configuration as unsupported without aborting the probe', async () => {
    const decodingInfo = jest.fn(async (configuration: any) => {
      if (configuration.video.contentType.startsWith('video/mp2t')) {
        throw new Error('cannot parse');
      }
      return {supported: true};
    });

    const support = await probeDeliveryRouteSupport({decodingInfo});

    expect(support.results.tsUhdL150.threw).toBe(true);
    expect(support.results.tsUhdL150.supported).toBe(false);
    expect(support.results.mp4FhdL150.supported).toBe(true);
    expect(support.mp2tUnanswerable).toBe(true);
  });

  it('reports failure rather than throwing when no probe is available', async () => {
    const support = await probeDeliveryRouteSupport({
      decodingInfo: (() => {
        throw new Error('unavailable');
      }) as any,
    });

    expect(support.probeSucceeded).toBe(true);
    expect(support.controlsFailed).toBe(true);
    expect(support.verdict).toBe('inconclusive');
  });

  it('caches the probe result across calls', () => {
    const first = getDeliveryRouteSupport();
    const second = getDeliveryRouteSupport();

    expect(first).toBe(second);
  });

  it('flattens results into scalar telemetry fields', async () => {
    const support = await probeDeliveryRouteSupport({
      decodingInfo: honest({mp2tAbove: 1920, maxLevel: 150}),
    });

    const flat = flattenDeliveryRouteSupport(support);

    expect(flat.tsFhdL150).toBe(true);
    expect(flat.tsUhdL150).toBe(false);
    expect(flat.verdict).toBe('container-limit-at-uhd');
    expect(flat.mp2tUnanswerable).toBe(false);
    expect(flat.probeSucceeded).toBe(true);
  });
});
