/**
 * Structured playback facts — the things the existing trace() call sites do
 * not already say.
 *
 * The trace bridge (telemetry/index.ts) already forwards every trace() label
 * verbatim, so transitions are covered for free. What follows is new
 * instrumentation, and each entry exists because a specific class of bug is
 * currently invisible in the log.
 *
 * app.start is NOT here: bootstrapTelemetry() already emits it, and a second
 * one would double-count sessions server-side.
 */
import {emit, scrubUrl} from './index';

/**
 * 1. THE TRANSCODE DECISION.
 *
 * Half the open playback questions are "Jellyfin decided to transcode and I
 * do not know why". `transcodeReasons` is the highest-value field in this
 * system and getStreamInfo() has been parsing it out of PlaybackInfo all
 * along without anything reading it.
 *
 * Emitted once per session, immediately after the stream is resolved.
 */
export interface PlaybackDecision {
  itemId?: string;
  /** Titles are fine: the manual gate confines this log to the operator's LAN. */
  title?: string;
  playMethod?: string;
  transcodeReasons?: string[];
  container?: string;
  sourceContainer?: string;
  outputContainer?: string;
  videoCodec?: string;
  outputVideoCodec?: string;
  audioCodec?: string;
  outputAudioCodec?: string;
  audioTranscodePolicy?: string;
  width?: number;
  height?: number;
  bitrate?: number;
  subtitleStreamIndex?: number;
  subtitleBurnIn?: boolean;
  hlsSegmentTargetSeconds?: number;
  hlsMinimumSegmentCount?: number;
  runTimeTicks?: number;
  startPositionTicks?: number;
  /** scrubUrl() strips credentials; the remaining parameters are where
   *  malformed-URL bugs actually live, so they are kept. */
  streamUrl?: string;
  transcodeUrl?: string;
}

export const emitPlaybackDecision = (decision: PlaybackDecision): void => {
  emit('playback.decision', {
    ...decision,
    // Jellyfin 10.11.11 PlaybackInfo exposes source metadata and a future
    // transcode request, not FFmpeg's effective per-track encoder. Even a
    // matching codec plus Allow*StreamCopy=true cannot establish stream copy.
    // Keep this separate from the legacy URL estimates used by recovery/UI.
    videoDeliveryMethod: 'Unknown',
    videoDeliveryEvidence:
      'PlaybackInfo.MediaSources: no effective video copy/encoder result; TranscodingUrl is a request',
    audioDeliveryMethod: 'Unknown',
    audioDeliveryEvidence:
      'PlaybackInfo.MediaSources: no effective audio copy/encoder result; TranscodingUrl is a request',
    streamUrl: decision.streamUrl ? scrubUrl(decision.streamUrl) : undefined,
    transcodeUrl: decision.transcodeUrl
      ? scrubUrl(decision.transcodeUrl)
      : undefined,
  });
};

/**
 * 2. SHAKA VARIANT FILTERING.
 *
 * The silent-stall class: Shaka filters out every variant it considers
 * unsupported, ends up with one bad option or none, and the user sees a
 * spinner with no error. Not yet wired — getDebugStats() exposes only the
 * active variant, so the full list needs a new ShakaPlayer accessor.
 */
export interface VariantSummary {
  total: number;
  playable: number;
  variants: Array<{
    id?: number;
    bandwidth?: number;
    width?: number;
    height?: number;
    codecs?: string;
    audioCodec?: string;
    active?: boolean;
    allowed?: boolean;
  }>;
  restrictions?: string;
}

export const emitVariants = (summary: VariantSummary): void => {
  // Cap the list. A pathological manifest with 200 renditions must not turn
  // one event into a megabyte.
  emit('shaka.variants', {...summary, variants: summary.variants.slice(0, 24)});
};

/**
 * 3. HTTP failures worth a full record.
 *
 * Astra retries a hard HTTP 500 three times in ~19 seconds with no backoff
 * and surfaces nothing. That is a separate bug; this event is how it becomes
 * legible. `attempt` is what makes the retry storm visible as a storm.
 */
export const emitHttpFailure = (detail: {
  url?: string;
  method?: string;
  status?: number;
  attempt?: number;
  elapsedMs?: number;
  /** Truncated: a 500 body can be an entire HTML error page. */
  body?: string;
}): void => {
  emit(
    'http.failure',
    {
      ...detail,
      url: detail.url ? scrubUrl(detail.url) : undefined,
      body: detail.body ? detail.body.slice(0, 2000) : undefined,
    },
    true,
  );
};

/**
 * 4. SESSION END.
 *
 * The closing record, and the only place lifetime totals belong. Everything
 * else in the stream reports interval deltas.
 */
export const emitSessionEnd = (detail: {
  reason?: string;
  positionSec?: number;
  durationSec?: number;
  watchedSec?: number;
  bufferingTimeSec?: number;
  droppedFrames?: number;
  decodedFrames?: number;
  errorsSeen?: number;
  stalledEvents?: number;
  waitingEvents?: number;
  failed?: boolean;
  lastError?: string;
}): void => {
  emit('session.end', detail, true);
};
