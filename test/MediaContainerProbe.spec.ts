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
      (contentType: string) => !contentType.startsWith('video/mp2t'),
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

  it('treats a throwing codec string as unsupported and keeps probing', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const support = await probeContainerSupport({
      isTypeSupported: (contentType: string) => {
        if (contentType === 'video/mp2t') {
          throw new Error('unrecognised type');
        }
        return true;
      },
    });

    expect(support.results.tsBare).toBe(false);
    expect(support.results.tsHevcHvc1).toBe(true);
    expect(support.results.mp4H264Control).toBe(true);
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
    });
  });
});
