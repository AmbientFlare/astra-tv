import {
  probeHdrSupport,
  getHdrSupport,
  resetHdrSupportCache,
  flattenHdrSupport,
} from '../src/services/mediaCapabilities/hdr';

/**
 * Builds a fake `decodingInfo` from a predicate over the video configuration.
 * Every test drives the probe entirely off-device.
 */
const fakeDecodingInfo = (
  supports: (video: {
    contentType: string;
    width: number;
    transferFunction?: string;
  }) => boolean,
  extra: {smooth?: boolean; powerEfficient?: boolean} = {},
) =>
  jest.fn(async (configuration: {video: any}) => ({
    supported: supports(configuration.video),
    ...extra,
  }));

/** A platform that honestly reads both the codec and the colour fields. */
const honest = (options: {main10: boolean; pq: boolean}) =>
  fakeDecodingInfo((video) => {
    if (video.contentType.includes('zzzz')) {
      return false;
    }
    const transfer = video.transferFunction;
    if (transfer !== 'pq' && transfer !== 'hlg' && transfer !== 'srgb') {
      return false;
    }
    if (video.contentType.includes('hvc1.2.') && !options.main10) {
      return false;
    }
    if ((transfer === 'pq' || transfer === 'hlg') && !options.pq) {
      return false;
    }
    return true;
  });

describe('probeHdrSupport', () => {
  beforeEach(() => {
    resetHdrSupportCache();
    jest.restoreAllMocks();
  });

  it('reports HDR10 as supported when the platform accepts PQ', async () => {
    const support = await probeHdrSupport({
      decodingInfo: honest({main10: true, pq: true}),
    });

    expect(support.probeSucceeded).toBe(true);
    expect(support.controlsFailed).toBe(false);
    expect(support.hdrFieldsIgnored).toBe(false);
    expect(support.results.hdr10Uhd.supported).toBe(true);
    expect(support.results.hdr10Fhd.supported).toBe(true);
    expect(support.results.main8SdrUhdControl.supported).toBe(true);
    expect(support.results.garbageCodecControl.supported).toBe(false);
    expect(support.results.garbageTransferControl.supported).toBe(false);
    expect(support.verdict).toBe('hdr10-supported');
  });

  it('blames the transfer function when 10-bit decode works but PQ does not', async () => {
    const support = await probeHdrSupport({
      decodingInfo: honest({main10: true, pq: false}),
    });

    expect(support.controlsFailed).toBe(false);
    expect(support.results.hdr10Uhd.supported).toBe(false);
    expect(support.results.hlgUhd.supported).toBe(false);
    // The decomposing probe is what separates this case from the next one.
    expect(support.results.main10SdrUhd.supported).toBe(true);
    expect(support.verdict).toBe('hdr10-rejected-transfer');
  });

  it('blames Main10 when the device has no 10-bit decode at all', async () => {
    const support = await probeHdrSupport({
      decodingInfo: honest({main10: false, pq: true}),
    });

    expect(support.controlsFailed).toBe(false);
    expect(support.results.hdr10Uhd.supported).toBe(false);
    expect(support.results.main10SdrUhd.supported).toBe(false);
    // The 8-bit positive controls still pass, so the probe is working.
    expect(support.results.main8SdrFhdControl.supported).toBe(true);
    expect(support.verdict).toBe('hdr10-rejected-main10');
  });

  it('refuses to answer when the platform ignores the colour fields', async () => {
    // The failure this probe exists to catch: honest about codecs, blind to
    // transferFunction. hdr10Uhd comes back true, and it means nothing.
    const decodingInfo = fakeDecodingInfo(
      (video) => !video.contentType.includes('zzzz'),
    );

    const support = await probeHdrSupport({decodingInfo});

    expect(support.results.hdr10Uhd.supported).toBe(true);
    expect(support.hdrFieldsIgnored).toBe(true);
    expect(support.alwaysTrue).toBe(true);
    expect(support.controlsFailed).toBe(true);
    expect(support.verdict).toBe('inconclusive');
  });

  it('refuses to answer when the platform says yes to everything', async () => {
    const support = await probeHdrSupport({
      decodingInfo: fakeDecodingInfo(() => true),
    });

    expect(support.alwaysTrue).toBe(true);
    expect(support.controlsFailed).toBe(true);
    expect(support.verdict).toBe('inconclusive');
  });

  it('refuses to answer when the positive controls fail', async () => {
    const support = await probeHdrSupport({
      decodingInfo: fakeDecodingInfo(() => false),
    });

    expect(support.results.main8SdrUhdControl.supported).toBe(false);
    expect(support.alwaysTrue).toBe(false);
    expect(support.controlsFailed).toBe(true);
    expect(support.verdict).toBe('inconclusive');
  });

  it('records smooth and powerEfficient when the platform reports them', async () => {
    const support = await probeHdrSupport({
      decodingInfo: honest({main10: true, pq: true}).mockImplementation(
        async () => ({supported: true, smooth: true, powerEfficient: false}),
      ),
    });

    expect(support.results.hdr10Uhd.smooth).toBe(true);
    expect(support.results.hdr10Uhd.powerEfficient).toBe(false);
  });

  it('treats a throwing configuration as unsupported and keeps probing', async () => {
    const decodingInfo = jest.fn(async (configuration: {video: any}) => {
      if (configuration.video.transferFunction === 'pq') {
        throw new Error('unparseable configuration');
      }
      return {
        supported:
          !configuration.video.contentType.includes('zzzz') &&
          configuration.video.transferFunction === 'srgb',
      };
    });

    const support = await probeHdrSupport({decodingInfo});

    expect(support.results.hdr10Uhd.threw).toBe(true);
    expect(support.results.hdr10Uhd.supported).toBe(false);
    // Probing continued past the throw: the later controls still ran.
    expect(support.results.main8SdrUhdControl.supported).toBe(true);
    expect(support.controlsFailed).toBe(false);
  });

  it('retries with a paired audio block when video-only is rejected', async () => {
    // Vega's decodingInfo declaration requires both video and audio. A
    // video-only rejection must not be reported as "HDR unsupported".
    const decodingInfo = jest.fn(async (configuration: any) => {
      if (!configuration.audio) {
        throw new Error('audio configuration required');
      }
      return {supported: !configuration.video.contentType.includes('zzzz')};
    });

    const support = await probeHdrSupport({decodingInfo});

    expect(support.configurationShape).toBe('video+audio');
    expect(support.results.main8SdrUhdControl.supported).toBe(true);
    expect(support.results.garbageCodecControl.supported).toBe(false);
  });

  it('reports the video-only shape when the platform accepts it', async () => {
    const support = await probeHdrSupport({
      decodingInfo: honest({main10: true, pq: true}),
    });

    expect(support.configurationShape).toBe('video');
  });
});

describe('getHdrSupport', () => {
  beforeEach(() => {
    resetHdrSupportCache();
    jest.restoreAllMocks();
  });

  it('probes once and hands back the same promise until reset', async () => {
    const first = getHdrSupport();
    expect(getHdrSupport()).toBe(first);

    resetHdrSupportCache();
    expect(getHdrSupport()).not.toBe(first);
  });

  it('reports an unusable result off-device rather than throwing', async () => {
    // There is no Kepler media module in the test environment, so the dynamic
    // import fails and the probe must degrade to an explicit "cannot answer".
    const support = await getHdrSupport();

    expect(support.probeSucceeded).toBe(false);
    expect(support.controlsFailed).toBe(true);
    expect(support.configurationShape).toBe('none');
    expect(support.verdict).toBe('inconclusive');
  });
});

describe('flattenHdrSupport', () => {
  beforeEach(() => {
    resetHdrSupportCache();
  });

  it('flattens nested results into scalar telemetry fields', async () => {
    const support = await probeHdrSupport({
      decodingInfo: fakeDecodingInfo(
        (video) => !video.contentType.includes('zzzz'),
        {smooth: true, powerEfficient: true},
      ),
    });

    const flat = flattenHdrSupport(support);

    expect(flat.hdr10Uhd).toBe(true);
    expect(flat.hdr10Uhd_smooth).toBe(true);
    expect(flat.hdr10Uhd_powerEfficient).toBe(true);
    expect(flat.verdict).toBe('inconclusive');
    expect(flat.hdrFieldsIgnored).toBe(true);
    // Nothing nested survives: a telemetry event carries scalars only.
    expect(
      Object.values(flat).every((value) => typeof value !== 'object'),
    ).toBe(true);
  });
});
