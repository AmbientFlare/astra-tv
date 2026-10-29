/** Shared constants and shapes for the player screen and its overlays. */

export const TICKS_PER_SECOND = 10000000;
export const CONTROL_HIDE_DELAY_MS = 5000;
export type PlaybackPanel = 'audio' | 'subtitles';

export interface PlaybackDebugInfo {
  activeVideoHeight?: number;
  activeVideoWidth?: number;
  bufferedAheadSeconds?: number;
  bufferedRangeCount?: number;
  bufferingTimeSeconds?: number;
  corruptedFrames?: number;
  decodedFrames?: number;
  droppedFrames?: number;
  estimatedBandwidth?: number;
  gapsJumped?: number;
  stallsDetected?: number;
  errorEventCount: number;
  shakaErrorEventCount?: number;
  lastError?: string;
  furthestBufferedAheadSeconds?: number;
  lastPlaybackEvent?: string;
  lastPlaybackEventSeconds?: number;
  nextBufferedGapSeconds?: number;
  stalledEventCount: number;
  streamBandwidth?: number;
  waitingEventCount: number;
}
export interface PlaybackEventDiagnostics {
  errorEventCount: number;
  shakaErrorEventCount?: number;
  lastError?: string;
  lastPlaybackEvent?: string;
  lastPlaybackEventSeconds?: number;
  stalledEventCount: number;
  waitingEventCount: number;
}
export const emptyPlaybackEventDiagnostics = (): PlaybackEventDiagnostics => ({
  errorEventCount: 0,
  stalledEventCount: 0,
  waitingEventCount: 0,
});

export type EndPrompt =
  | {kind: 'countdown'; remainingSeconds: number}
  | {kind: 'confirm'};
