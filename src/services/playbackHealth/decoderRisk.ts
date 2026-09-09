/**
 * Which source streams this device's hardware decoder can be trusted with.
 *
 * The controlled evidence is one file (Central Intelligence, 3840x1600 HEVC
 * Main 10 Level 5.1, Dolby Vision Profile 8.1, 24.2 Mbps) indexed on two
 * servers. Burn-in forced an NVENC re-encode on the GPU server and it played
 * with zero dropped frames; the NAS stream-copied the original elementary
 * stream and the same title dropped 557 frames with repeated full-buffer
 * collapses. Network was never short -- estimated bandwidth ran 2.7-3.5x the
 * stream throughout.
 *
 * Bitrate alone does not predict this. A 30.5 Mbps SDR title played clean,
 * and a 6.4 Mbps 4K HEVC Main 10 title played clean. The signal that tracks
 * the failure is the Dolby Vision layer, so that is what this gates on, with
 * a plain-bitrate ceiling above anything in a normal library as a backstop.
 *
 * The library is overwhelmingly light -- median 2.3 Mbps, p90 7.6 Mbps -- so
 * this must stay a narrow exception. Classifying a title `heavy` costs the
 * user a re-encode they mostly do not need.
 */
export type DecoderRisk = 'easy' | 'heavy';

/** Dolby Vision or HDR10+ at or above this bitrate stresses the decoder. */
export const HEAVY_DYNAMIC_RANGE_BITRATE_BPS = 15_000_000;

/**
 * Above this, treat any stream as heavy regardless of range. Set beyond the
 * top of a normal library so it is a backstop, not a routine trigger.
 */
export const HEAVY_ANY_BITRATE_BPS = 40_000_000;

export interface DecoderRiskInput {
  /** Video stream bitrate in bits per second. */
  bitRate?: number;
  /** Jellyfin `VideoRangeType`, e.g. `SDR`, `HDR10`, `DOVIWithHDR10`. */
  videoRangeType?: string;
}

const isLayeredDynamicRange = (videoRangeType?: string) => {
  const range = videoRangeType?.trim().toUpperCase();
  if (!range) {
    return false;
  }
  return range.startsWith('DOVI') || range.startsWith('HDR10PLUS');
};

export interface DecoderRiskVerdict {
  risk: DecoderRisk;
  /** Short machine-readable cause, for telemetry and traces. */
  reason: 'dynamic-range' | 'bitrate' | 'none';
}

export const assessDecoderRisk = (
  source: DecoderRiskInput | undefined,
): DecoderRiskVerdict => {
  const bitRate =
    typeof source?.bitRate === 'number' && Number.isFinite(source.bitRate)
      ? source.bitRate
      : 0;
  if (bitRate >= HEAVY_ANY_BITRATE_BPS) {
    return {risk: 'heavy', reason: 'bitrate'};
  }
  if (
    isLayeredDynamicRange(source?.videoRangeType) &&
    bitRate >= HEAVY_DYNAMIC_RANGE_BITRATE_BPS
  ) {
    return {risk: 'heavy', reason: 'dynamic-range'};
  }
  return {risk: 'easy', reason: 'none'};
};

/**
 * A heavy title is only worth re-encoding if the server is allowed to. When it
 * is not, the source is delivered as-is and the viewer is warned instead --
 * see `shouldWarnAboutDecoderRisk`.
 */
export const shouldTranscodeForDecoder = (
  risk: DecoderRisk,
  serverCanTranscodeVideo: boolean,
) => risk === 'heavy' && serverCanTranscodeVideo;

export const shouldWarnAboutDecoderRisk = (
  risk: DecoderRisk,
  serverCanTranscodeVideo: boolean,
) => risk === 'heavy' && !serverCanTranscodeVideo;

export const DECODER_RISK_WARNING =
  'This video may not play smoothly on this device. You may want to try a ' +
  'different version of the file.';

/**
 * `EnableVideoPlaybackTranscoding` is the only transcoding signal a non-admin
 * client can read, and it reports permission rather than capability. A CPU-only
 * NAS grants it and then cannot start a 4K Dolby Vision re-encode at all: the
 * forced session never receives a manifest, holds zero buffered ranges for its
 * whole life and dies to the watchdog having decoded nothing, while the same
 * file delivered untouched plays with roughly 0.03% dropped frames. So a forced
 * session that failed without decoding a single frame is proof the server
 * cannot do the work. Abandon the force, deliver the source, and warn -- which
 * is what the viewer would have got had the server admitted it up front.
 *
 * Requires zero frames specifically. A session that decoded and then failed is
 * an ordinary fault, and the normal retry path owns it.
 */
export const shouldAbandonForcedDecoderTranscode = (
  forcedForDecoder: boolean,
  alreadyAbandoned: boolean,
  decodedFrames: number,
) => forcedForDecoder && !alreadyAbandoned && decodedFrames === 0;

/**
 * How long a forced session may hold nothing before it is declared dead.
 *
 * Measured on the GPU-less lab server, 2026-09-08: a healthy forced session reported its
 * first buffered range 4.6 s after the load resolved, while the failing one
 * held zero ranges for all 30 s until the watchdog. Ten seconds sits at rather
 * more than twice the healthy figure, which is margin enough for a slower
 * server to still be counted healthy, and it cuts the black screen a viewer
 * sits through from 33 s to about 13 s.
 */
export const DECODER_TRANSCODE_DEAD_START_MS = 10_000;

/**
 * The same judgement as `shouldAbandonForcedDecoderTranscode`, reached from the
 * poll instead of from the error handler.
 *
 * Waiting for the stall watchdog is correct but slow: it is a general-purpose
 * 30 s timer, and it costs the viewer 33 s of black before the fallback that
 * was already inevitable. A forced session holding zero buffered ranges and
 * zero decoded frames well past the point every healthy session has both is
 * not going to recover, so trip it early and let the existing fallback run.
 *
 * Both conditions are required. Frames without ranges, or ranges without
 * frames, is a session doing something -- only the complete absence of both
 * distinguishes the server that never answered.
 */
export const shouldTripForcedDecoderTranscode = (
  forcedForDecoder: boolean,
  alreadyAbandoned: boolean,
  decodedFrames: number,
  bufferedRangeCount: number,
  msSinceReady: number,
) =>
  shouldAbandonForcedDecoderTranscode(
    forcedForDecoder,
    alreadyAbandoned,
    decodedFrames,
  ) &&
  bufferedRangeCount === 0 &&
  msSinceReady >= DECODER_TRANSCODE_DEAD_START_MS;
