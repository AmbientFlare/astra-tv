/**
 * The decoder's own resolution ceiling, read from Vega's media descriptor.
 *
 * Why this is not another `decodingInfo` probe: issue #21 is a stick that is
 * offered a 4K stream, stops at 0 ms, and never fetches a segment. Two things
 * are needed to fix it and a claim-probe supplies neither reliably.
 *
 * `deliveryRoute.ts` asks the platform whether it ACCEPTS a 4K configuration,
 * which is the same question Shaka asks before it discards a variant -- and a
 * platform that accepts 4K and then cannot decode it answers "yes" either way.
 * `MediaSource.getMaxSupportedResolution` asks for the ceiling itself. It is
 * not a claim about the pipeline: Vega's own `addSourceBuffer` calls it to size
 * the native source buffer, so this is the number playback actually runs with.
 * Where the two disagree, this one is describing the decoder.
 *
 * The SDK documents the field underneath (`VideoFormatCapabilities.resolutions`)
 * as always two entries, min at index 0 and max at index 1, and
 * `getMaxSupportedResolution` returns index 1 for the codec family in the codec
 * string. Only that 4-character family prefix is consulted -- profile and level
 * are parsed and then unused -- so the answer is per codec family, which is the
 * granularity a device profile needs, and the reason the strings below are the
 * real delivery ones rather than anything tidier.
 *
 * `{width: 0, height: 0}` is not "this device cannot decode video". The
 * descriptor returns an empty array for an unparseable mime type, an unknown
 * codec, an internal error, OR a device that does not support the requested
 * attributes -- and `getMaxSupportedResolution` collapses all four to zeros.
 * An unanswered query is therefore treated as no information and changes
 * nothing; it is never read as "cap this device at zero".
 */

/** A media-descriptor resolution. Same shape the SDK returns. */
export interface DecodeResolution {
  width: number;
  height: number;
}

type GetMaxSupportedResolution = (mimeType: string) => DecodeResolution;

export interface VideoDecodeLimits {
  /** Widest frame the platform's decoder accepts. Undefined when unanswered. */
  maxWidth?: number;
  maxHeight?: number;
  /** The codec string that produced the answer. Undefined when none did. */
  answeredFor?: string;
  /** True once the descriptor query ran; false when it could not be reached. */
  probeSucceeded: boolean;
  /**
   * True when the controls did not behave, i.e. the query is not answering the
   * question it was asked. Read this before reading `maxWidth`: a query that
   * cannot say "no" is not evidence for saying "yes".
   */
  controlsFailed: boolean;
}

/**
 * The route HEVC actually takes, carrying the exact codec string the failing 4K
 * titles were offered with (`hvc1.2.4.L153.B0` is Main10, level 5.1). This is
 * not a level question -- level is ignored by the descriptor query, see above --
 * but asking it with the string that actually failed keeps the probe honest
 * about what it is measuring.
 */
const HEVC_DELIVERY_TYPE = 'video/mp2t; codecs="hvc1.2.4.L153.B0"';

/**
 * POSITIVE control, and the reason any answer can be read at all: Main8 1080p
 * HEVC over MPEG-TS is the stream this device plays today. If the query answers
 * zero for it, the query is not describing the media pipeline and the delivery
 * answer carries no information.
 */
const HEVC_PLAYING_CONTROL_TYPE = 'video/mp2t; codecs="hvc1.1.4.L120.B0"';

/**
 * NEGATIVE controls. They fail differently on purpose, at the two gates ahead
 * of the descriptor call: one is a video type whose codec family is absent from
 * the registry (`zzzz` is not one of the ~70 four-character families the
 * platform knows), the other is a codec the platform does know but under a
 * non-video media type, which is rejected before any codec work happens. A
 * query that answers a resolution for either is not discriminating, and a
 * plausible-looking ceiling from it would be ACTED ON -- so this is the
 * difference between declaring a limit and guessing one.
 *
 * Note what is deliberately NOT here: a nonsense profile or level on a real
 * codec, e.g. `hvc1.2.4.L999.B0`. That is not a control. The registry matches
 * only the family prefix, so the query returns its ordinary answer and the
 * "control" would fail on every device, suppressing the fix everywhere.
 */
const GARBAGE_CODEC_CONTROL_TYPE = 'video/mp2t; codecs="zzzz.9.9.L999.X9"';
const NON_VIDEO_CONTROL_TYPE = 'audio/mp4; codecs="ac-3"';

interface VideoDecodeLimitsDependencies {
  getMaxSupportedResolution?: GetMaxSupportedResolution;
}

const UNANSWERED: VideoDecodeLimits = {
  probeSucceeded: false,
  controlsFailed: false,
};

/** Safe default: nothing was measured, so nothing is declared. */
export const defaultVideoDecodeLimits: VideoDecodeLimits = UNANSWERED;

const readResolution = (
  query: GetMaxSupportedResolution,
  mimeType: string,
): DecodeResolution => {
  try {
    const resolution = query(mimeType);

    return {
      width: Number(resolution?.width) || 0,
      height: Number(resolution?.height) || 0,
    };
  } catch (error) {
    // A platform may throw on a codec string it cannot parse at all. That is
    // "no information" for this query alone and must not abort the others: a
    // negative control that throws is behaving as intended, and a delivery
    // query that throws must not take a good control down with it.
    console.warn(`[Astra] Decoder query threw for ${mimeType}:`, error);
    return {width: 0, height: 0};
  }
};

export const probeVideoDecodeLimits = async (
  dependencies: VideoDecodeLimitsDependencies = {},
): Promise<VideoDecodeLimits> => {
  try {
    let query = dependencies.getMaxSupportedResolution;

    // Load Vega's native-backed media module only for a real device query.
    // Off-device tests can exercise the policy without a Kepler turbo module.
    if (!query) {
      const media = await import(
        '@amazon-devices/react-native-w3cmedia/dist/headless'
      );
      // `getMaxSupportedResolution` is an instance method, but its
      // implementation reads nothing off `this`, and the constructor is plain
      // JavaScript -- it allocates empty lists and registers the object, and
      // touches no native surface -- so a throwaway instance is a cheap way to
      // ask a question that does not depend on any instance state.
      const mediaSource = new media.MediaSource();
      query = mediaSource.getMaxSupportedResolution.bind(mediaSource);
    }

    const playing = readResolution(query, HEVC_PLAYING_CONTROL_TYPE);
    const garbageCodec = readResolution(query, GARBAGE_CODEC_CONTROL_TYPE);
    const nonVideo = readResolution(query, NON_VIDEO_CONTROL_TYPE);
    const delivery = readResolution(query, HEVC_DELIVERY_TYPE);

    // The positive control must answer, and neither negative control may.
    const controlsFailed =
      playing.width <= 0 || garbageCodec.width > 0 || nonVideo.width > 0;
    // A control failure invalidates the delivery answer too: it came from the
    // same query, one line apart.
    const answered =
      !controlsFailed && delivery.width > 0 && delivery.height > 0;

    const limits: VideoDecodeLimits = {
      ...(answered
        ? {
            maxWidth: delivery.width,
            maxHeight: delivery.height,
            answeredFor: HEVC_DELIVERY_TYPE,
          }
        : {}),
      probeSucceeded: true,
      controlsFailed,
    };

    console.info('[Astra] Video decode limits:', {
      ...limits,
      playingControl: `${playing.width}x${playing.height}`,
      garbageCodecControl: `${garbageCodec.width}x${garbageCodec.height}`,
      nonVideoControl: `${nonVideo.width}x${nonVideo.height}`,
    });

    return limits;
  } catch (error) {
    console.warn(
      '[Astra] Unable to query the decoder resolution ceiling; declaring no limit:',
      error,
    );
    return UNANSWERED;
  }
};

let cachedDecodeLimits: Promise<VideoDecodeLimits> | null = null;

export const getVideoDecodeLimits = () => {
  cachedDecodeLimits ??= probeVideoDecodeLimits();
  return cachedDecodeLimits;
};

export const resetVideoDecodeLimitsCache = () => {
  cachedDecodeLimits = null;
};
