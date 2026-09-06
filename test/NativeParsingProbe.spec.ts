import {
  getNativeParsingSupport,
  probeNativeParsingSupport,
} from '../src/services/mediaCapabilities/nativeParsing';

const makeDeps = (support = (name: string) => name === 'shaka') => {
  const calls: string[] = [];
  const registerNativePlayerUtils = jest.fn(() => {
    calls.push('register');
    return true;
  });
  return {
    calls,
    registerNativePlayerUtils,
    isNativeHlsParserSupported: jest.fn((name: string, version: string) => {
      calls.push(`${name}:${version}`);
      return support(name);
    }),
    parseHlsManifest: () => undefined,
    nativeShakaHlsCreateSegments: () => undefined,
    shaka: {hls: {HlsParser: {setNativeFunctions: jest.fn()}}},
  };
};

describe('probeNativeParsingSupport', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());
  it('uses existing registration and never switches parser functions', async () => {
    const deps = makeDeps();
    const result = await probeNativeParsingSupport(deps);
    expect(deps.calls).toEqual(['shaka:4.8.5', 'not-a-real-player:0.0.0']);
    expect(deps.registerNativePlayerUtils).not.toHaveBeenCalled();
    expect(result.hlsSupported).toBe(true);
    expect(result.negativeControlSupported).toBe(false);
    expect(result.controlsFailed).toBe(false);
    expect(deps.shaka.hls.HlsParser.setNativeFunctions).not.toHaveBeenCalled();
  });

  it('registers when support is absent and observes newly registered globals', async () => {
    const calls: string[] = [];
    const support = jest.fn((name: string, version: string) => {
      calls.push(`${name}:${version}`);
      return name === 'shaka';
    });
    const deps: any = {
      parseHlsManifest: undefined,
      nativeShakaHlsCreateSegments: undefined,
      shaka: {hls: {HlsParser: {setNativeFunctions: jest.fn()}}},
    };
    const register = jest.fn(() => {
      calls.push('register');
      deps.isNativeHlsParserSupported = support;
      deps.parseHlsManifest = () => undefined;
      deps.nativeShakaHlsCreateSegments = () => undefined;
      return {unsafe: true};
    });
    deps.registerNativePlayerUtils = register;
    const result = await probeNativeParsingSupport(deps);
    expect(register).toHaveBeenCalledTimes(1);
    expect(result.registerCalled).toBe(true);
    expect(result.registerReturned).toBeNull();
    expect(result.controlsFailed).toBe(false);
    expect(calls).toEqual([
      'register',
      'shaka:4.8.5',
      'not-a-real-player:0.0.0',
    ]);
    expect(result).toMatchObject({
      supportFnPresent: true,
      parseHlsManifestPresent: true,
      createSegmentsPresent: true,
    });
  });

  it('flags missing methods, always-true support, and thrown controls', async () => {
    await expect(
      probeNativeParsingSupport({isNativeHlsParserSupported: () => true}),
    ).resolves.toMatchObject({alwaysTrue: true, controlsFailed: true});
    await expect(
      probeNativeParsingSupport({
        isNativeHlsParserSupported: () => {
          throw new Error('boom');
        },
      }),
    ).resolves.toMatchObject({probeSucceeded: false, controlsFailed: true});
  });

  it('reports a measured unsupported version separately from a failed probe', async () => {
    await expect(
      probeNativeParsingSupport(makeDeps(() => false)),
    ).resolves.toMatchObject({
      hlsSupported: false,
      negativeControlSupported: false,
      probeSucceeded: true,
      controlsFailed: false,
      alwaysTrue: false,
    });
  });

  it('does not import native modules for an empty injected environment', async () => {
    await expect(probeNativeParsingSupport({})).resolves.toMatchObject({
      registerFnPresent: false,
      supportFnPresent: false,
      hlsSupported: null,
      negativeControlSupported: null,
      controlsFailed: true,
    });
  });

  it('records unsuccessful registration without claiming unsupported', async () => {
    await expect(
      probeNativeParsingSupport({registerNativePlayerUtils: () => false}),
    ).resolves.toMatchObject({
      registerCalled: true,
      registerReturned: false,
      supportFnPresent: false,
      hlsSupported: null,
      controlsFailed: true,
    });
  });

  it('isolates registration exceptions', async () => {
    await expect(
      probeNativeParsingSupport({
        registerNativePlayerUtils: () => {
          throw new Error('registration');
        },
      }),
    ).resolves.toMatchObject({
      registerCalled: true,
      probeSucceeded: false,
      hlsSupported: null,
      controlsFailed: true,
    });
  });

  it('does not count a throwing negative control as successful rejection', async () => {
    const deps = makeDeps((name) => {
      if (name !== 'shaka') {
        throw new Error('control');
      }
      return true;
    });
    await expect(probeNativeParsingSupport(deps)).resolves.toMatchObject({
      hlsSupported: true,
      negativeControlSupported: null,
      probeSucceeded: false,
      controlsFailed: true,
    });
  });

  it('rejects nonboolean native responses', async () => {
    const deps = makeDeps();
    deps.isNativeHlsParserSupported.mockReturnValue(
      'yes' as unknown as boolean,
    );
    await expect(probeNativeParsingSupport(deps)).resolves.toMatchObject({
      hlsSupported: null,
      probeSucceeded: false,
      controlsFailed: true,
    });
  });

  it('rejects a bogus-player positive even if Shaka is rejected', async () => {
    await expect(
      probeNativeParsingSupport(makeDeps((name) => name !== 'shaka')),
    ).resolves.toMatchObject({
      hlsSupported: false,
      negativeControlSupported: true,
      controlsFailed: true,
      alwaysTrue: true,
    });
  });

  it('requires callable parser hooks even when support is advertised', async () => {
    const deps = makeDeps();
    await expect(
      probeNativeParsingSupport({...deps, parseHlsManifest: true}),
    ).resolves.toMatchObject({
      hlsSupported: true,
      parseHlsManifestPresent: false,
      controlsFailed: true,
    });
  });

  it('caches the real probe including registration across concurrent and later calls', async () => {
    const native = global as any;
    const keys = [
      'registerNativePlayerUtils',
      'isNativeHlsParserSupported',
      'parseHlsManifest',
      'nativeShakaHlsCreateSegments',
    ];
    const saved = keys.map((key) =>
      Object.getOwnPropertyDescriptor(native, key),
    );
    const deps = makeDeps();
    jest.doMock(
      '../src/w3cmedia/shakaplayer/dist/shaka-player.compiled',
      () => ({__esModule: true, default: deps.shaka}),
    );
    native.isNativeHlsParserSupported = undefined;
    native.registerNativePlayerUtils = jest.fn(() => {
      native.isNativeHlsParserSupported = deps.isNativeHlsParserSupported;
      native.parseHlsManifest = deps.parseHlsManifest;
      native.nativeShakaHlsCreateSegments = deps.nativeShakaHlsCreateSegments;
      return true;
    });
    try {
      const first = getNativeParsingSupport();
      expect(getNativeParsingSupport()).toBe(first);
      await expect(first).resolves.toMatchObject({
        registerReturned: true,
        hlsSupported: true,
        controlsFailed: false,
      });
      expect(getNativeParsingSupport()).toBe(first);
      expect(native.registerNativePlayerUtils).toHaveBeenCalledTimes(1);
      expect(deps.isNativeHlsParserSupported).toHaveBeenCalledTimes(2);
      expect(
        deps.shaka.hls.HlsParser.setNativeFunctions,
      ).not.toHaveBeenCalled();
    } finally {
      keys.forEach((key, index) => {
        const descriptor = saved[index];
        if (descriptor) {
          Object.defineProperty(native, key, descriptor);
        } else {
          delete native[key];
        }
      });
      jest.dontMock('../src/w3cmedia/shakaplayer/dist/shaka-player.compiled');
    }
  });
});
