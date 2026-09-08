/**
 * Probe decoder acceptance across the three dimensions that separate a 4K
 * title that fails from a 1080p title that plays (issue #21): the delivery
 * CONTAINER (fMP4 vs MPEG-TS), the RESOLUTION, and the codec LEVEL.
 *
 * Why a matrix and not a single question: a 4K HEVC stream over MPEG-TS
 * differs from a working 1080p one in all three at once. One probe returns a
 * boolean that cannot say which dimension broke, and the three imply
 * different fixes -- re-routing 4K to fMP4 (which re-opens the open-GOP
 * timestamp collisions MPEG-TS was adopted to avoid), adding level or
 * resolution conditions to the device profile (which forces a real transcode
 * that hardware-less servers cannot afford), or neither.
 *
 * Colour is deliberately absent: every configuration here is SDR. HDR is
 * ./hdr.ts's question, and mixing the two would confound both. Note that
 * every configuration in ./hdr.ts uses `video/mp4` while delivery is
 * `video/mp2t` -- that gap is what this file exists to close.
 *
 * Acceptance is not proof of playback. This asks what the platform CLAIMS,
 * which is exactly what Shaka asks before it discards a variant.
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
  transferFunction?: string;
  colorGamut?: string;
}

type VideoDecodingInfo = (configuration: {
  type: 'media-source';
  video: VideoDecodingConfiguration;
  audio?: unknown;
}) => Promise<DecodingInfoResult>;

/**
 * Vega's `decodingInfo` declaration requires both video and audio even though
 * the implementation accepts audio-only probes. Whether it accepts video-only
 * is unknown, so a rejected video-only request is retried with this attached
 * rather than recorded as a false negative. AC-3 rather than AAC: it is what
 * the MPEG-TS route actually carries.
 */
const PAIRED_AUDIO_CONFIGURATION = {
  contentType: 'audio/mp4; codecs="ac-3"',
  channels: '6',
  bitrate: 640000,
  samplerate: 48000,
  spatialRendering: false,
};

// HEVC codec strings. hvc1.2.* is profile 2 (Main10, 10-bit); hvc1.1.* is
// profile 1 (Main, 8-bit). L120 is level 4.0, L150 is 5.0, L153 is 5.1.
//
// These are not invented: L150 and L153 are the exact strings this server
// advertises for the failing 4K titles, and the Main8 L120 string is the
// exact one it advertises for 1080p HEVC that plays today. Constraint-flag
// bytes are part of what a platform parses, so the real strings are used
// rather than tidier equivalents.
const MAIN10_L120 = 'hvc1.2.4.L120.B0';
const MAIN10_L150 = 'hvc1.2.4.L150.B0';
const MAIN10_L153 = 'hvc1.2.4.L153.B0';
const MAIN8_L120 = 'hvc1.1.4.L120.B0';

const MP4 = 'video/mp4';
const TS = 'video/mp2t';

const type = (container: string, codec: string) =>
  `${container}; codecs="${codec}"`;

const UHD = {width: 3840, height: 2160, bitrate: 25000000, framerate: 24};
const FHD = {width: 1920, height: 1080, bitrate: 8000000, framerate: 24};
const SDR = {transferFunction: 'srgb', colorGamut: 'srgb'};

const deliveryProbeConfigurations = {
  // THE MATRIX. Main10 held fixed, so container x resolution x level is the
  // only thing varying. Read it as three comparisons:
  //   mp4Uhd*  vs tsUhd*   -- container, at 4K
  //   tsFhdL150 vs tsUhdL150 -- resolution, at a fixed legal level
  //   tsFhdL120 vs tsFhdL150 -- level, at a fixed resolution
  mp4FhdL120: {contentType: type(MP4, MAIN10_L120), ...FHD, ...SDR},
  mp4FhdL150: {contentType: type(MP4, MAIN10_L150), ...FHD, ...SDR},
  mp4UhdL150: {contentType: type(MP4, MAIN10_L150), ...UHD, ...SDR},
  tsFhdL120: {contentType: type(TS, MAIN10_L120), ...FHD, ...SDR},
  tsFhdL150: {contentType: type(TS, MAIN10_L150), ...FHD, ...SDR},
  tsUhdL150: {contentType: type(TS, MAIN10_L150), ...UHD, ...SDR},

  // The failing title's exact string, one level higher. Kept separate from
  // the matrix: if L150 passes at 4K and L153 does not, the boundary is the
  // level and not the resolution, and a device-profile level condition is a
  // narrower fix than a resolution cap.
  tsUhdL153: {contentType: type(TS, MAIN10_L153), ...UHD, ...SDR},

  // LEVEL-HONESTY CONTROL, not a matrix cell. Level 4.0 cannot carry 3840x2160
  // under any reading of the HEVC spec, so a truthful platform says no. A
  // `true` here proves the level field is being ignored, and every level
  // conclusion drawn from the cells above is then void -- which is why this
  // is read before them.
  mp4UhdL120: {contentType: type(MP4, MAIN10_L120), ...UHD, ...SDR},

  // POSITIVE CONTROLS, and the reason this probe can be read at all. Both are
  // the exact configuration of a stream that plays on this device today.
  //
  // tsFhdMain8Control is the load-bearing one. If it comes back false, the
  // platform is not answering about MPEG-TS -- it cannot be answering
  // honestly, because that stream demonstrably plays -- and every `ts*` result
  // above is noise rather than evidence of a container limit. Without this
  // control, a platform that simply declines to describe mp2t is
  // indistinguishable from one that rejects mp2t at 4K.
  tsFhdMain8Control: {contentType: type(TS, MAIN8_L120), ...FHD, ...SDR},
  mp4FhdMain8Control: {contentType: type(MP4, MAIN8_L120), ...FHD, ...SDR},

  // NEGATIVE CONTROLS. They fail differently on purpose: an implementation
  // that sniffs the MIME type and ignores the codecs parameter passes the
  // container one and is caught only by the codec one.
  garbageContainerControl: {
    contentType:
      'video/x-astra-not-a-real-container; codecs="hvc1.2.4.L150.B0"',
    ...UHD,
    ...SDR,
  },
  garbageCodecControl: {
    contentType: type(MP4, 'zzzz.9.9.L999.X9'),
    ...FHD,
    ...SDR,
  },
} as const;

type DeliveryProbeKey = keyof typeof deliveryProbeConfigurations;

export interface DeliveryProbeResult {
  supported: boolean;
  /** Undefined when the platform did not report it. */
  smooth?: boolean;
  powerEfficient?: boolean;
  /** Set when the configuration threw; `supported` is then false. */
  threw?: boolean;
}

export type DeliveryVerdict =
  /** Controls misbehaved, or the level field is ignored. Read nothing else. */
  | 'inconclusive'
  /**
   * The platform will not describe mp2t even for a stream it plays. Every
   * `ts*` result is unusable, and the container dimension has to be settled
   * by a playback attempt instead.
   */
  | 'mp2t-unanswerable'
  /** mp2t is fine at 1080p and refused at 4K while fMP4 takes 4K. */
  | 'container-limit-at-uhd'
  /** Neither container is accepted at 4K. Resolution, not container. */
  | 'resolution-limit-at-uhd'
  /** The higher level is refused at a resolution the lower one passes. */
  | 'level-limit'
  /** Every 4K configuration was accepted; #21 is not a decodingInfo refusal. */
  | 'no-limit-found';

export interface DeliveryRouteSupport {
  results: Record<DeliveryProbeKey, DeliveryProbeResult>;
  /** False when the media module could not be loaded; results are meaningless. */
  probeSucceeded: boolean;
  /** Which configuration shape the platform accepted. */
  configurationShape: 'video' | 'video+audio' | 'none';
  /**
   * True when the controls did not behave: the probe cannot tell a real limit
   * from a broken probe. Read this first -- when it is true every other result
   * is noise.
   */
  controlsFailed: boolean;
  /** True when something impossible was reported as supported. */
  alwaysTrue: boolean;
  /**
   * True when 4K at level 4.0 was accepted. The platform is then not reading
   * the level, and no level conclusion follows from any result here.
   */
  levelFieldIgnored: boolean;
  /**
   * True when the mp2t positive control failed. The platform is not answering
   * about the container Astra actually delivers, so `ts*` results say nothing.
   */
  mp2tUnanswerable: boolean;
  /** Convenience reading of the above; never trust it when controls failed. */
  verdict: DeliveryVerdict;
}

const emptyResults = (): Record<DeliveryProbeKey, DeliveryProbeResult> => {
  const results = {} as Record<DeliveryProbeKey, DeliveryProbeResult>;
  for (const key of Object.keys(
    deliveryProbeConfigurations,
  ) as DeliveryProbeKey[]) {
    results[key] = {supported: false};
  }
  return results;
};

const deriveVerdict = (
  results: Record<DeliveryProbeKey, DeliveryProbeResult>,
  controlsFailed: boolean,
  levelFieldIgnored: boolean,
  mp2tUnanswerable: boolean,
): DeliveryVerdict => {
  if (controlsFailed || levelFieldIgnored) {
    return 'inconclusive';
  }
  if (mp2tUnanswerable) {
    return 'mp2t-unanswerable';
  }
  const anyUhd = results.mp4UhdL150.supported || results.tsUhdL150.supported;
  if (
    !anyUhd &&
    (results.mp4FhdL150.supported || results.tsFhdL150.supported)
  ) {
    return 'resolution-limit-at-uhd';
  }
  if (
    results.mp4UhdL150.supported &&
    !results.tsUhdL150.supported &&
    results.tsFhdL150.supported
  ) {
    return 'container-limit-at-uhd';
  }
  // Level is only readable where resolution is held fixed, which is why this
  // is asked at 1080p and not at 4K.
  if (results.tsFhdL120.supported && !results.tsFhdL150.supported) {
    return 'level-limit';
  }
  if (results.tsUhdL150.supported && !results.tsUhdL153.supported) {
    return 'level-limit';
  }
  return 'no-limit-found';
};

export const probeDeliveryRouteSupport = async (
  dependencies: {decodingInfo?: VideoDecodingInfo} = {},
): Promise<DeliveryRouteSupport> => {
  const results = emptyResults();
  let configurationShape: DeliveryRouteSupport['configurationShape'] = 'none';

  try {
    let probeDecodingInfo = dependencies.decodingInfo;

    if (!probeDecodingInfo) {
      const media = await import(
        '@amazon-devices/react-native-w3cmedia/dist/headless'
      );
      probeDecodingInfo = media.decodingInfo as unknown as VideoDecodingInfo;
    }

    const ask = async (video: VideoDecodingConfiguration) => {
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

    for (const key of Object.keys(
      deliveryProbeConfigurations,
    ) as DeliveryProbeKey[]) {
      try {
        // A platform may throw on a configuration it cannot parse at all,
        // which is a "no" and must not abort the remaining probes.
        const result = await ask(deliveryProbeConfigurations[key]);
        results[key] = {
          supported: result?.supported === true,
          smooth: result?.smooth,
          powerEfficient: result?.powerEfficient,
        };
      } catch (error) {
        console.warn(`[Astra] Delivery route probe threw for ${key}:`, error);
        results[key] = {supported: false, threw: true};
      }
    }

    const alwaysTrue =
      results.garbageContainerControl.supported ||
      results.garbageCodecControl.supported;
    const controlsFailed = !results.mp4FhdMain8Control.supported || alwaysTrue;
    const levelFieldIgnored = results.mp4UhdL120.supported;
    const mp2tUnanswerable = !results.tsFhdMain8Control.supported;
    const verdict = deriveVerdict(
      results,
      controlsFailed,
      levelFieldIgnored,
      mp2tUnanswerable,
    );

    console.info('[Astra] Delivery route probe:', {
      ...results,
      configurationShape,
      controlsFailed,
      alwaysTrue,
      levelFieldIgnored,
      mp2tUnanswerable,
      verdict,
    });

    return {
      results,
      probeSucceeded: true,
      configurationShape,
      controlsFailed,
      alwaysTrue,
      levelFieldIgnored,
      mp2tUnanswerable,
      verdict,
    };
  } catch (error) {
    console.warn('[Astra] Unable to probe delivery route support:', error);
    return {
      results,
      probeSucceeded: false,
      configurationShape: 'none',
      controlsFailed: true,
      alwaysTrue: false,
      levelFieldIgnored: false,
      mp2tUnanswerable: true,
      verdict: 'inconclusive',
    };
  }
};

let cachedDeliveryRouteSupport: Promise<DeliveryRouteSupport> | null = null;

export const getDeliveryRouteSupport = () => {
  cachedDeliveryRouteSupport ??= probeDeliveryRouteSupport();
  return cachedDeliveryRouteSupport;
};

export const resetDeliveryRouteSupportCache = () => {
  cachedDeliveryRouteSupport = null;
};

/**
 * Flattens the nested per-probe results into the scalar fields a telemetry
 * event can carry, e.g. `tsUhdL150: false, tsUhdL150_smooth: false`.
 */
export const flattenDeliveryRouteSupport = (
  support: DeliveryRouteSupport,
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
    levelFieldIgnored: support.levelFieldIgnored,
    mp2tUnanswerable: support.mp2tUnanswerable,
    verdict: support.verdict,
  };
};
