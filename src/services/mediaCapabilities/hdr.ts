/**
 * Probe decoder acceptance of HDR over MSE, with positive and negative controls.
 * Video playback uses the cached result for a soft Shaka variant preference.
 * Acceptance does not prove KeplerMediaSink or the TV renders HDR correctly.
 * Keep device-profile policy separate from this probe.
 */

/** The subset of MediaCapabilities' result that Vega is known to return. */
interface DecodingInfoResult {
  supported?: boolean;
  /** Decoded at the requested framerate without dropping. */
  smooth?: boolean;
  /** Hardware-backed rather than a software fallback. */
  powerEfficient?: boolean;
}

interface VideoDecodingConfiguration {
  contentType: string;
  width: number;
  height: number;
  bitrate: number;
  framerate: number;
  /** 'pq' is HDR10, 'hlg' is Hybrid Log-Gamma, 'srgb' is SDR. */
  transferFunction?: string;
  colorGamut?: string;
  hdrMetadataType?: string;
}

type VideoDecodingInfo = (configuration: {
  type: 'media-source';
  video: VideoDecodingConfiguration;
  audio?: unknown;
}) => Promise<DecodingInfoResult>;

/**
 * A benign audio block. Vega's `decodingInfo` declaration requires both video
 * and audio even though the implementation accepts audio-only probes (see the
 * note in ./index.ts). Whether it accepts video-only is unknown, so the probe
 * retries with this attached rather than reporting a false negative.
 */
const PAIRED_AUDIO_CONFIGURATION = {
  contentType: 'audio/mp4; codecs="mp4a.40.2"',
  channels: '2',
  bitrate: 128000,
  samplerate: 48000,
  spatialRendering: false,
};

// HEVC codec strings, by profile:
//   hvc1.1.*  profile 1, Main    -- 8-bit,  the SDR path in use today
//   hvc1.2.*  profile 2, Main10  -- 10-bit, required for any HDR
// L150 is level 5.0 (4K), L93 is level 3.1 (1080p).
const HEVC_MAIN10_L150 = 'video/mp4; codecs="hvc1.2.4.L150.B0"';
const HEVC_MAIN10_L93 = 'video/mp4; codecs="hvc1.2.4.L93.B0"';
const HEVC_MAIN8_L150 = 'video/mp4; codecs="hvc1.1.6.L150.B0"';
const HEVC_MAIN8_L93 = 'video/mp4; codecs="hvc1.1.6.L93.B0"';

const UHD = {width: 3840, height: 2160, bitrate: 25000000, framerate: 24};
const FHD = {width: 1920, height: 1080, bitrate: 8000000, framerate: 24};

const HDR10 = {
  transferFunction: 'pq',
  colorGamut: 'rec2020',
  hdrMetadataType: 'smpteSt2086',
};
const HLG = {transferFunction: 'hlg', colorGamut: 'rec2020'};
const SDR = {transferFunction: 'srgb', colorGamut: 'srgb'};

const hdrProbeConfigurations = {
  // THE QUESTION. 4K HDR10 is the shape of the library content that is
  // currently tone-mapped (e.g. a 3840-wide HEVC HDR movie).
  hdr10Uhd: {contentType: HEVC_MAIN10_L150, ...UHD, ...HDR10},
  // The same transfer at 1080p. Separates "cannot do HDR" from "cannot do 4K":
  // if this passes and hdr10Uhd fails, the limit is resolution, not colour.
  hdr10Fhd: {contentType: HEVC_MAIN10_L93, ...FHD, ...HDR10},
  // Broadcast HDR. Jellyfin treats HLG as a distinct VideoRangeType, so a
  // device may take one and not the other.
  hlgUhd: {contentType: HEVC_MAIN10_L150, ...UHD, ...HLG},

  // DECOMPOSING probe, not a control. 10-bit but SDR transfer. HDR10 needs
  // both, and this is what tells the two failures apart:
  //   this false          -> the device has no 10-bit decode at all
  //   this true, PQ false -> 10-bit is fine and the PQ transfer is refused
  main10SdrUhd: {contentType: HEVC_MAIN10_L150, ...UHD, ...SDR},

  // POSITIVE controls: 8-bit SDR HEVC is the path this device demonstrably
  // plays every day. If these come back false the probe is broken and NO
  // conclusion about HDR follows from anything above.
  main8SdrUhdControl: {contentType: HEVC_MAIN8_L150, ...UHD, ...SDR},
  main8SdrFhdControl: {contentType: HEVC_MAIN8_L93, ...FHD, ...SDR},

  // NEGATIVE control, and the one that decides whether this probe is worth
  // reading at all. A codec string the platform cannot know.
  garbageCodecControl: {
    contentType: 'video/mp4; codecs="zzzz.9.9.L999.X9"',
    ...FHD,
    ...SDR,
  },
  // NEGATIVE control aimed at the colour fields specifically. An
  // implementation can answer honestly about the codec while ignoring
  // transferFunction/colorGamut entirely -- in which case HDR10 and SDR
  // return the same answer and a "supported" on hdr10Uhd means nothing. A
  // real container carrying a transfer function that does not exist is the
  // only way to catch that, and the plain garbage-codec control above cannot:
  // it would fail on the codec and never exercise the colour path.
  garbageTransferControl: {
    contentType: HEVC_MAIN8_L93,
    ...FHD,
    transferFunction: 'astra-not-a-real-transfer',
    colorGamut: 'astra-not-a-real-gamut',
    hdrMetadataType: 'astra-not-a-real-metadata-type',
  },
} as const;

type HdrProbeKey = keyof typeof hdrProbeConfigurations;

export interface HdrProbeResult {
  supported: boolean;
  /** Undefined when the platform did not report it. */
  smooth?: boolean;
  powerEfficient?: boolean;
  /** Set when the configuration threw; `supported` is then false. */
  threw?: boolean;
}

export type HdrVerdict =
  | 'hdr10-supported'
  | 'hdr10-rejected-transfer'
  | 'hdr10-rejected-main10'
  | 'inconclusive';

export interface HdrSupport {
  results: Record<HdrProbeKey, HdrProbeResult>;
  /** False when the media module could not be loaded; results are meaningless. */
  probeSucceeded: boolean;
  /** Which configuration shape the platform accepted. */
  configurationShape: 'video' | 'video+audio' | 'none';
  /**
   * True when the controls did not behave: the probe cannot tell "this device
   * rejects HDR10" from "this probe does not work". Read this first -- when it
   * is true every other result is noise.
   */
  controlsFailed: boolean;
  /** True when something impossible was reported as supported. */
  alwaysTrue: boolean;
  /**
   * True when a nonsense transferFunction was accepted. Called out separately
   * from `alwaysTrue` because it is a narrower and more likely failure: the
   * platform answers correctly about codecs while ignoring colour metadata.
   * When this is true, `hdr10Uhd` carries no information whatever its value,
   * and the HDR question is NOT answered by this probe.
   */
  hdrFieldsIgnored: boolean;
  /** Convenience reading of the above; never trust it when controls failed. */
  verdict: HdrVerdict;
}

const emptyResults = (): Record<HdrProbeKey, HdrProbeResult> => {
  const results = {} as Record<HdrProbeKey, HdrProbeResult>;
  for (const key of Object.keys(hdrProbeConfigurations) as HdrProbeKey[]) {
    results[key] = {supported: false};
  }
  return results;
};

const deriveVerdict = (
  results: Record<HdrProbeKey, HdrProbeResult>,
  controlsFailed: boolean,
  hdrFieldsIgnored: boolean,
): HdrVerdict => {
  if (controlsFailed || hdrFieldsIgnored) {
    return 'inconclusive';
  }
  if (results.hdr10Uhd.supported || results.hdr10Fhd.supported) {
    return 'hdr10-supported';
  }
  // 10-bit decode works, so the refusal is about the transfer function.
  if (results.main10SdrUhd.supported) {
    return 'hdr10-rejected-transfer';
  }
  return 'hdr10-rejected-main10';
};

export const probeHdrSupport = async (
  dependencies: {decodingInfo?: VideoDecodingInfo} = {},
): Promise<HdrSupport> => {
  const results = emptyResults();
  let configurationShape: HdrSupport['configurationShape'] = 'none';

  try {
    let probeDecodingInfo = dependencies.decodingInfo;

    if (!probeDecodingInfo) {
      const media = await import(
        '@amazon-devices/react-native-w3cmedia/dist/headless'
      );
      probeDecodingInfo = media.decodingInfo as unknown as VideoDecodingInfo;
    }

    const ask = async (video: VideoDecodingConfiguration) => {
      // Video-only is the spec-correct shape; the paired-audio retry exists
      // only because Vega's declaration insists on both. Whichever shape the
      // platform accepts is recorded so a reader can tell an honest "no" from
      // a rejected request shape.
      try {
        const result = await probeDecodingInfo!({type: 'media-source', video});
        configurationShape = 'video';
        return result;
      } catch (videoOnlyError) {
        const result = await probeDecodingInfo!({
          type: 'media-source',
          video,
          audio: PAIRED_AUDIO_CONFIGURATION,
        });
        configurationShape = 'video+audio';
        return result;
      }
    };

    for (const key of Object.keys(hdrProbeConfigurations) as HdrProbeKey[]) {
      try {
        // A platform may throw on a configuration it cannot parse at all,
        // which is a "no" and must not abort the remaining probes.
        const result = await ask(hdrProbeConfigurations[key]);
        results[key] = {
          supported: result?.supported === true,
          smooth: result?.smooth,
          powerEfficient: result?.powerEfficient,
        };
      } catch (error) {
        console.warn(`[Astra] HDR probe threw for ${key}:`, error);
        results[key] = {supported: false, threw: true};
      }
    }

    const positivesPassed =
      results.main8SdrUhdControl.supported ||
      results.main8SdrFhdControl.supported;
    const hdrFieldsIgnored = results.garbageTransferControl.supported;
    const alwaysTrue =
      results.garbageCodecControl.supported || hdrFieldsIgnored;
    const controlsFailed = !positivesPassed || alwaysTrue;
    const verdict = deriveVerdict(results, controlsFailed, hdrFieldsIgnored);

    console.info('[Astra] HDR support probe:', {
      ...results,
      configurationShape,
      controlsFailed,
      alwaysTrue,
      hdrFieldsIgnored,
      verdict,
    });

    return {
      results,
      probeSucceeded: true,
      configurationShape,
      controlsFailed,
      alwaysTrue,
      hdrFieldsIgnored,
      verdict,
    };
  } catch (error) {
    console.warn('[Astra] Unable to probe HDR support:', error);
    return {
      results,
      probeSucceeded: false,
      configurationShape: 'none',
      controlsFailed: true,
      alwaysTrue: false,
      hdrFieldsIgnored: false,
      verdict: 'inconclusive',
    };
  }
};

let cachedHdrSupport: Promise<HdrSupport> | null = null;

export const getHdrSupport = () => {
  cachedHdrSupport ??= probeHdrSupport();
  return cachedHdrSupport;
};

export const resetHdrSupportCache = () => {
  cachedHdrSupport = null;
};

/**
 * Flattens the nested per-probe results into the scalar fields a telemetry
 * event can carry, e.g. `hdr10Uhd: true, hdr10Uhd_smooth: false`.
 */
export const flattenHdrSupport = (
  support: HdrSupport,
): Record<string, boolean | string | undefined> => {
  const flat: Record<string, boolean | string | undefined> = {};
  for (const [key, result] of Object.entries(support.results)) {
    flat[key] = result.supported;
    flat[`${key}_smooth`] = result.smooth;
    flat[`${key}_powerEfficient`] = result.powerEfficient;
    if (result.threw) {
      flat[`${key}_threw`] = true;
    }
  }
  return {
    ...flat,
    probeSucceeded: support.probeSucceeded,
    configurationShape: support.configurationShape,
    controlsFailed: support.controlsFailed,
    alwaysTrue: support.alwaysTrue,
    hdrFieldsIgnored: support.hdrFieldsIgnored,
    verdict: support.verdict,
  };
};
