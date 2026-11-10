import type {
  JellyfinMediaItem,
  JellyfinStreamInfo,
} from '../../services/jellyfin';
import {flushTelemetry, isTelemetryArmed} from '../../services/telemetry';
import {
  emitPlaybackDecision,
  emitSessionEnd,
} from '../../services/telemetry/playbackFacts';
import {notePlaybackSession} from '../../services/telemetry/playbackStats';
import type {PlaybackDebugInfo, PlaybackEventDiagnostics} from './types';

/** Records what the server decided to send for this item. */
export const emitStreamDecision = (
  item: Pick<JellyfinMediaItem, 'id' | 'name'>,
  stream: JellyfinStreamInfo,
) => {
  if (!isTelemetryArmed()) {
    return;
  }
  emitPlaybackDecision({
    itemId: item.id,
    title: item.name,
    playMethod: stream.playMethod,
    transcodeReasons: stream.transcodeReasons,
    container: stream.container,
    sourceContainer: stream.sourceContainer,
    outputContainer: stream.outputContainer,
    videoCodec: stream.sourceVideoCodec,
    outputVideoCodec: stream.outputVideoCodec,
    audioCodec: stream.sourceAudioCodec,
    outputAudioCodec: stream.outputAudioCodec,
    audioTranscodePolicy: stream.audioTranscodePolicy,
    width: stream.width,
    height: stream.height,
    bitrate: stream.bitrate,
    subtitleStreamIndex: stream.subtitleStreamIndex,
    subtitleBurnIn: stream.subtitleBurnIn,
    hlsSegmentTargetSeconds: stream.hlsSegmentTargetSeconds,
    hlsMinimumSegmentCount: stream.hlsMinimumSegmentCount,
    runTimeTicks: stream.runTimeTicks,
    startPositionTicks: stream.startPositionTicks,
    streamUrl: stream.url,
    transcodeUrl: stream.transcodeUrl,
  });
};

interface SessionCloseOut {
  diagnostics: PlaybackEventDiagnostics;
  durationSec: number;
  failed: boolean;
  /** Read only when the session-end event is actually sent. */
  positionSec: () => number;
  sample: PlaybackDebugInfo | null;
  /** When this session became ready, or null if it never did. */
  startedMs: number | null;
}

/**
 * Closes out one playback session: its totals go into the visit summary, and
 * a session that reached playback also sends its session-end event.
 */
export const closeOutSessionTelemetry = ({
  diagnostics,
  durationSec,
  failed,
  positionSec,
  sample,
  startedMs,
}: SessionCloseOut) => {
  if (startedMs === null) {
    if (failed) {
      notePlaybackSession({failed: true, lastError: diagnostics.lastError});
    }
    return;
  }
  notePlaybackSession({
    failed,
    watchedSec: (Date.now() - startedMs) / 1000,
    bufferingSec: sample?.bufferingTimeSeconds,
    dropped: sample?.droppedFrames,
    decoded: sample?.decodedFrames,
    errors: diagnostics.errorEventCount,
    stalls: diagnostics.stalledEventCount,
    waiting: diagnostics.waitingEventCount,
    lastError: diagnostics.lastError,
  });
  if (!isTelemetryArmed()) {
    return;
  }
  emitSessionEnd({
    reason: failed ? 'error' : 'ended',
    failed,
    positionSec: positionSec(),
    durationSec,
    watchedSec: (Date.now() - startedMs) / 1000,
    bufferingTimeSec: sample?.bufferingTimeSeconds,
    droppedFrames: sample?.droppedFrames,
    decodedFrames: sample?.decodedFrames,
    errorsSeen: diagnostics.errorEventCount,
    stalledEvents: diagnostics.stalledEventCount,
    waitingEvents: diagnostics.waitingEventCount,
    lastError: diagnostics.lastError,
  });
  void flushTelemetry();
};
