import {useEffect} from 'react';
import type {VideoPlayer} from '@amazon-devices/react-native-w3cmedia';

import {trace} from '../../services/logging/trace';
import {
  shouldResetRecoveryBudget,
  shouldTripForcedDecoderTranscode,
} from '../../services/playbackHealth';
import {isFrozenAtEnd, isStalledAtEnd} from '../../w3cmedia/mediaTimeline';
import type {PlayerRefs} from './playerRefs';
import {TICKS_PER_SECOND} from './types';

const WATCHDOG_INTERVAL_MS = 3000;

interface PlaybackWatchdogOptions {
  applyPosition: (seconds: number) => void;
  currentPositionTicks: () => number;
  /** The item's own length, used when the stream does not report one. */
  itemRunTimeTicks?: number;
  refs: PlayerRefs;
  reportProgress: (positionTicks?: number) => void;
}

/**
 * The player's 3 s tick. Publishes the position, reports progress to the
 * server, and watches for the three things the media element does not report
 * itself: a forced re-encode that never produces a frame, a stream frozen in
 * its last seconds, and playback that has simply stopped moving.
 */
export const usePlaybackWatchdog = ({
  applyPosition,
  currentPositionTicks,
  itemRunTimeTicks,
  refs,
  reportProgress,
}: PlaybackWatchdogOptions) => {
  useEffect(() => {
    const {
      decodedFramesThisSession,
      decoderTranscodeUnusable,
      finishAtEndRef,
      forcedDecoderTranscode,
      forcedTranscodeReadyAtMs,
      healthMonitor,
      isPausedRef,
      lastActivePosition,
      mediaTimelineOffsetSeconds,
      playbackErrorHandler,
      playbackEventDiagnostics,
      playbackGeneration,
      playbackReadyAtMs,
      playbackRecoveryAttempt,
      seekController,
      sessionReady,
      shakaPlayerRef,
      streamInfo,
      trackReloadInProgress,
      unmountedRef,
      videoRef,
    } = refs;
    const endByStall = (video: VideoPlayer, ticks: number) => {
      trace('playback.endedByStall', 'position=' + ticks);
      playbackEventDiagnostics.current.lastPlaybackEvent = 'ended-by-stall';
      lastActivePosition.current = null;
      healthMonitor.current.reset();
      video.pause();
      finishAtEndRef.current(playbackGeneration.current);
    };
    const interval = setInterval(() => {
      const video = videoRef.current;
      if (!video || !sessionReady.current || unmountedRef.current) {
        lastActivePosition.current = null;
        return;
      }
      const ticks = currentPositionTicks();
      applyPosition(ticks / TICKS_PER_SECOND);
      reportProgress(ticks);
      // Beat the stall watchdog to a verdict it is going to reach anyway. The
      // cheap flags are tested first so getDebugStats() -- which costs
      // JS-thread time, this app's signature failure mode -- is only read
      // while a forced session is actually overdue.
      const forcedReadyAtMs = forcedTranscodeReadyAtMs.current;
      if (
        forcedDecoderTranscode.current &&
        !decoderTranscodeUnusable.current &&
        decodedFramesThisSession.current === 0 &&
        forcedReadyAtMs !== null &&
        shouldTripForcedDecoderTranscode(
          forcedDecoderTranscode.current,
          decoderTranscodeUnusable.current,
          decodedFramesThisSession.current,
          shakaPlayerRef.current?.getDebugStats()?.buffered?.total?.length ?? 0,
          Date.now() - forcedReadyAtMs,
        )
      ) {
        playbackErrorHandler.current({source: 'decoder-dead-start'});
        return;
      }
      const positionSeconds = ticks / TICKS_PER_SECOND;
      const runTimeTicks = streamInfo.current?.runTimeTicks ?? itemRunTimeTicks;
      const active =
        !isPausedRef.current &&
        !trackReloadInProgress.current &&
        !seekController.current?.seeking;
      const previousSeconds = lastActivePosition.current;
      lastActivePosition.current = active ? positionSeconds : null;
      if (
        shouldResetRecoveryBudget(
          playbackRecoveryAttempt.current,
          playbackReadyAtMs.current,
          Date.now(),
          active &&
            previousSeconds !== null &&
            positionSeconds > previousSeconds,
        )
      ) {
        trace('playback.recovered', 'budget reset');
        playbackRecoveryAttempt.current = 0;
      }
      if (
        active &&
        isFrozenAtEnd(positionSeconds, previousSeconds, runTimeTicks)
      ) {
        endByStall(video, ticks);
        return;
      }
      if (healthMonitor.current.observe(Date.now(), positionSeconds, active)) {
        const ranges = shakaPlayerRef.current?.getDebugStats()?.buffered;
        // Ranges contain only numeric media times; never record segment URLs.
        trace(
          'playback.stall',
          'media=' +
            video.currentTime +
            ' duration=' +
            video.duration +
            ' offset=' +
            mediaTimelineOffsetSeconds.current +
            ' ranges=' +
            JSON.stringify(ranges ?? {}).slice(0, 500),
        );
        if (isStalledAtEnd(positionSeconds, runTimeTicks)) {
          endByStall(video, ticks);
          return;
        }
        playbackErrorHandler.current({source: 'watchdog'});
      }
    }, WATCHDOG_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [
    applyPosition,
    currentPositionTicks,
    itemRunTimeTicks,
    refs,
    reportProgress,
  ]);
};
