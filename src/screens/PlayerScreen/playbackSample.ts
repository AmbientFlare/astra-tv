import type {VideoPlayer} from '@amazon-devices/react-native-w3cmedia';
import type {HeartbeatSample} from '../../services/telemetry/heartbeat';
import type {JellyfinStreamInfo} from '../../services/jellyfin';
import type {ShakaPlayer as ShakaPlayerInstance} from '../../w3cmedia/shakaplayer/ShakaPlayer';
import {mediaToLogicalTime} from '../../w3cmedia/mediaTimeline';
import type {PlaybackDebugInfo, PlaybackEventDiagnostics} from './types';

interface ShakaDebugStats {
  activeVariant?: {
    height?: number | null;
    width?: number | null;
  };
  buffered?: {
    total?: Array<{end: number; start: number}>;
  };
  stats?: Record<string, number>;
}

/**
 * One snapshot of the pipeline: Shaka's counters, the buffer shape around the
 * playhead and the native frame counters, merged with the event tallies the
 * player keeps itself. Pure apart from reading the two players.
 */
export const collectPlaybackSample = (
  shakaPlayer: ShakaPlayerInstance,
  video: VideoPlayer,
  eventDiagnostics: PlaybackEventDiagnostics,
): PlaybackDebugInfo => {
  const diagnostics = shakaPlayer.getDebugStats() as
    | ShakaDebugStats
    | undefined;
  const currentTime = video.currentTime ?? 0;
  const bufferedRanges = diagnostics?.buffered?.total
    ? [...diagnostics.buffered.total]
    : [];
  const currentRange = bufferedRanges.find(
    (range) => range.end >= currentTime && range.start <= currentTime + 0.25,
  );
  const currentRangeIndex = currentRange
    ? bufferedRanges.indexOf(currentRange)
    : -1;
  const nextRange =
    currentRangeIndex >= 0
      ? bufferedRanges[currentRangeIndex + 1]
      : bufferedRanges.find((range) => range.start > currentTime);
  const furthestBufferedEnd = bufferedRanges.reduce(
    (furthest, range) =>
      range.end >= currentTime ? Math.max(furthest, range.end) : furthest,
    currentTime,
  );
  const stats = diagnostics?.stats;
  const nativeVideo = video as
    | (VideoPlayer & {videoHeight?: number; videoWidth?: number})
    | null;
  let nativeVideoFrames:
    | {droppedVideoFrames?: number; totalVideoFrames?: number}
    | undefined;

  try {
    nativeVideoFrames = video.getVideoPlaybackQuality();
  } catch (error) {
    console.warn('[Astra] Unable to read native frame diagnostics:', error);
  }

  return {
    activeVideoHeight:
      stats?.height ||
      diagnostics?.activeVariant?.height ||
      nativeVideo?.videoHeight ||
      undefined,
    activeVideoWidth:
      stats?.width ||
      diagnostics?.activeVariant?.width ||
      nativeVideo?.videoWidth ||
      undefined,
    bufferedAheadSeconds: currentRange
      ? Math.max(0, currentRange.end - currentTime)
      : undefined,
    bufferedRangeCount: bufferedRanges.length,
    bufferingTimeSeconds: stats?.bufferingTime,
    corruptedFrames: stats?.corruptedFrames,
    decodedFrames: nativeVideoFrames?.totalVideoFrames,
    droppedFrames: nativeVideoFrames?.droppedVideoFrames,
    estimatedBandwidth: stats?.estimatedBandwidth,
    gapsJumped: stats?.gapsJumped,
    stallsDetected: stats?.stallsDetected,
    furthestBufferedAheadSeconds:
      furthestBufferedEnd > currentTime
        ? furthestBufferedEnd - currentTime
        : undefined,
    nextBufferedGapSeconds:
      currentRange && nextRange
        ? Math.max(0, nextRange.start - currentRange.end)
        : undefined,
    streamBandwidth: stats?.streamBandwidth,
    ...eventDiagnostics,
  };
};

/**
 * Shapes a sample into the heartbeat's wire record. The element's clock
 * restarts at zero on every server-positioned session, so a raw currentTime
 * would read as a rewind after each seek: `pos` is the file position and the
 * raw one rides beside it only when the two differ.
 */
export const heartbeatSampleFrom = ({
  sample,
  stream,
  currentTime,
  timelineOffsetSeconds,
  paused,
}: {
  sample: PlaybackDebugInfo | null;
  stream: JellyfinStreamInfo | null;
  currentTime: number | undefined;
  timelineOffsetSeconds: number;
  paused: boolean;
}): HeartbeatSample => {
  const event = sample?.lastPlaybackEvent;
  return {
    pos:
      typeof currentTime === 'number'
        ? mediaToLogicalTime(currentTime, timelineOffsetSeconds)
        : undefined,
    mediaPos: timelineOffsetSeconds !== 0 ? currentTime : undefined,
    ahead: sample?.bufferedAheadSeconds,
    buffering: event === 'waiting' || event === 'stalled',
    paused,
    bwEst: sample?.estimatedBandwidth,
    bitrate: sample?.streamBandwidth ?? stream?.bitrate,
    width: sample?.activeVideoWidth,
    height: sample?.activeVideoHeight,
    decodedFrames: sample?.decodedFrames,
    droppedFrames: sample?.droppedFrames,
    // Buffer shape. rangeCount is the field that tells a flush or an MSE
    // eviction apart from a normal drain, which is the open question
    // behind the full-buffer collapses on high-bitrate DV titles.
    rangeCount: sample?.bufferedRangeCount,
    furthestAhead: sample?.furthestBufferedAheadSeconds,
    gapAhead: sample?.nextBufferedGapSeconds,
    bufferingTimeSec: sample?.bufferingTimeSeconds,
    corruptedFrames: sample?.corruptedFrames,
    gapsJumped: sample?.gapsJumped,
    stallsDetected: sample?.stallsDetected,
    // Per-segment timing has no source yet, so the `server` starvation
    // verdict cannot fire. That is an accepted Phase 1 gap — do not add
    // per-segment events to close it.
    segmentDurationSec: stream?.hlsSegmentTargetSeconds,
  };
};
