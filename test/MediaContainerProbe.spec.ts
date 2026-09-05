import {
  probeContainerSupport,
  getContainerSupport,
  resetContainerSupportCache,
} from '../src/services/mediaCapabilities';

describe('probeContainerSupport', () => {
  beforeEach(() => {
    resetContainerSupportCache();
    jest.restoreAllMocks();
  });

  it('reports mp2t as unsupported while the controls pass', async () => {
    const isTypeSupported = jest.fn(
      (contentType: string) =>
        !contentType.startsWith('video/mp2t') &&
        !contentType.includes('not-a-real-container') &&
        !contentType.includes('zzzz'),
    );

    const support = await probeContainerSupport({isTypeSupported});

    expect(support.probeSucceeded).toBe(true);
    expect(support.controlsFailed).toBe(false);
    expect(support.results.tsHevcHvc1).toBe(false);
    expect(support.results.tsHevcHev1).toBe(false);
    expect(support.results.tsH264).toBe(false);
    expect(support.results.tsBare).toBe(false);
    expect(support.results.mp4HevcControl).toBe(true);
    expect(support.results.mp4H264Control).toBe(true);
    expect(support.alwaysTrue).toBe(false);
  });

  it('flags controlsFailed when nothing at all is supported, so the mp2t result cannot be trusted', async () => {
    const support = await probeContainerSupport({
      isTypeSupported: () => false,
    });

    expect(support.probeSucceeded).toBe(true);
    expect(support.controlsFailed).toBe(true);
  });

  it('probes both hvc1 and hev1 tag forms', async () => {
    const seen: string[] = [];
    await probeContainerSupport({
      isTypeSupported: (contentType: string) => {
        seen.push(contentType);
        return true;
      },
    });

    expect(seen).toContain('video/mp2t; codecs="hvc1.1.6.L93.B0"');
    expect(seen).toContain('video/mp2t; codecs="hev1.1.6.L93.B0"');
    expect(seen).toContain('video/mp2t');
  });

  it('rejects an all-true implementation instead of reporting full support', async () => {
    // The failure this probe was rebuilt to catch: a stubbed isTypeSupported
    // that says yes to everything is indistinguishable from real mp2t support
    // unless the negative controls are checked.
    jest.spyOn(console, 'info').mockImplementation(() => {});
    const support = await probeContainerSupport({isTypeSupported: () => true});

    expect(support.results.tsHevcHvc1).toBe(true);
    expect(support.alwaysTrue).toBe(true);
    expect(support.controlsFailed).toBe(true);
  });

  it('probes a bogus container and a bogus codec, which fail differently', async () => {
    const seen: string[] = [];
    jest.spyOn(console, 'info').mockImplementation(() => {});
    await probeContainerSupport({
      isTypeSupported: (contentType: string) => {
        seen.push(contentType);
        return false;
      },
    });

    // A platform may sniff the MIME type and ignore the codecs parameter, so
    // an unknown container alone would not catch it.
    expect(seen).toContain('video/x-astra-not-a-real-container');
    expect(seen).toContain('video/mp4; codecs="zzzz.9.9.L999.X9"');
  });

  it('treats a throwing codec string as unsupported and keeps probing', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const support = await probeContainerSupport({
      isTypeSupported: (contentType: string) => {
        if (contentType === 'video/mp2t') {
          throw new Error('unrecognised type');
        }
        return (
          !contentType.includes('not-a-real-container') &&
          !contentType.includes('zzzz')
        );
      },
    });

    expect(support.results.tsBare).toBe(false);
    expect(support.results.tsHevcHvc1).toBe(true);
    expect(support.results.mp4H264Control).toBe(true);
    // The throwing string was a negative control's neighbour, not a control:
    // positives still passed and negatives still failed.
    expect(support.alwaysTrue).toBe(false);
    expect(support.controlsFailed).toBe(false);
  });

  it('memoizes the probe until the cache is reset', async () => {
    // getContainerSupport takes no injectable deps, so assert on promise
    // identity rather than on a mock that this path can never reach.
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const first = getContainerSupport();
    expect(getContainerSupport()).toBe(first);

    resetContainerSupportCache();
    expect(getContainerSupport()).not.toBe(first);

    // Off-device there is no Kepler media module, so the probe reports its own
    // failure rather than a bogus all-false result.
    await expect(first).resolves.toMatchObject({
      probeSucceeded: false,
      controlsFailed: true,
      alwaysTrue: false,
    });
  });
});
