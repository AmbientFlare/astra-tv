export interface NativeParsingSupport {
  registerFnPresent: boolean;
  registerCalled: boolean;
  registerReturned: string | number | boolean | null;
  registerReturnType?: string;
  supportFnPresent: boolean;
  hlsSupported: boolean | null;
  negativeControlSupported: boolean | null;
  parseHlsManifestPresent: boolean;
  createSegmentsPresent: boolean;
  setNativeFunctionsPresent: boolean;
  shakaVersionAsked: '4.8.5';
  playerNameAsked: 'shaka';
  probeSucceeded: boolean;
  controlsFailed: boolean;
  alwaysTrue: boolean;
}

type SupportFn = (playerName: string, playerVersion: string) => boolean;
type RegisterFn = () => unknown;

export interface NativeParsingProbeDependencies {
  registerNativePlayerUtils?: RegisterFn;
  isNativeHlsParserSupported?: SupportFn;
  parseHlsManifest?: unknown;
  nativeShakaHlsCreateSegments?: unknown;
  shaka?: {hls?: {HlsParser?: {setNativeFunctions?: unknown}}};
}

const safeResult = (): NativeParsingSupport => ({
  registerFnPresent: false,
  registerCalled: false,
  registerReturned: null,
  supportFnPresent: false,
  hlsSupported: null,
  negativeControlSupported: null,
  parseHlsManifestPresent: false,
  createSegmentsPresent: false,
  setNativeFunctionsPresent: false,
  shakaVersionAsked: '4.8.5',
  playerNameAsked: 'shaka',
  probeSucceeded: false,
  controlsFailed: true,
  alwaysTrue: false,
});

const telemetryValue = (value: unknown): string | number | boolean | null =>
  value === null ||
  typeof value === 'string' ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value))
    ? (value as string | number | boolean | null)
    : null;

/** Observational only: never installs native parser hooks or changes playback.
 * Use getNativeParsingSupport at startup; its promise is retained for the
 * process lifetime because registration has no HLS teardown counterpart.
 */
export const probeNativeParsingSupport = async (
  dependencies?: NativeParsingProbeDependencies,
): Promise<NativeParsingSupport> => {
  const result = safeResult();
  try {
    const nativeGlobals =
      dependencies ?? (global as NativeParsingProbeDependencies);
    const register = nativeGlobals.registerNativePlayerUtils;
    result.registerFnPresent = typeof register === 'function';
    let bundledShaka = dependencies?.shaka;
    if (!dependencies) {
      // The generated bundle declares a namespace rather than an ES module.
      bundledShaka =
        // @ts-expect-error generated bundle declaration is not an ES module
        (await import('../../w3cmedia/shakaplayer/dist/shaka-player.compiled'))
          .default;
    }
    result.setNativeFunctionsPresent =
      typeof bundledShaka?.hls?.HlsParser?.setNativeFunctions === 'function';

    // Registration is one-way; only create the support function when absent.
    if (
      typeof nativeGlobals.isNativeHlsParserSupported !== 'function' &&
      typeof register === 'function'
    ) {
      result.registerCalled = true;
      const returned = register.call(nativeGlobals);
      result.registerReturned = telemetryValue(returned);
      result.registerReturnType = typeof returned;
    }
    // Registration may install all three functions. Read them afterward.
    const support = nativeGlobals.isNativeHlsParserSupported;
    const parse = nativeGlobals.parseHlsManifest;
    const createSegments = nativeGlobals.nativeShakaHlsCreateSegments;
    result.supportFnPresent = typeof support === 'function';
    result.parseHlsManifestPresent = typeof parse === 'function';
    result.createSegmentsPresent = typeof createSegments === 'function';

    if (result.supportFnPresent) {
      const measured = support!.call(nativeGlobals, 'shaka', '4.8.5');
      if (typeof measured !== 'boolean') {
        throw new TypeError(
          'native HLS support function did not return a boolean',
        );
      }
      result.hlsSupported = measured;
      const negative = support!.call(
        nativeGlobals,
        'not-a-real-player',
        '0.0.0',
      );
      if (typeof negative !== 'boolean') {
        throw new TypeError(
          'native HLS support function did not return booleans',
        );
      }
      result.negativeControlSupported = negative;
    }
    result.alwaysTrue = result.negativeControlSupported === true;
    result.controlsFailed =
      !result.supportFnPresent ||
      !result.parseHlsManifestPresent ||
      !result.createSegmentsPresent ||
      !result.setNativeFunctionsPresent ||
      result.alwaysTrue;
    result.probeSucceeded = true;
    return result;
  } catch (error) {
    console.warn('[Astra] Unable to probe native HLS parsing support:', error);
    return result;
  }
};

let cachedNativeParsingSupport: Promise<NativeParsingSupport> | null = null;

export const getNativeParsingSupport = () => {
  cachedNativeParsingSupport ??= probeNativeParsingSupport();
  return cachedNativeParsingSupport;
};
