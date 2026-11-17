import type {VideoPlayer} from '@amazon-devices/react-native-w3cmedia';

import {t} from '../../i18n';
import {syncPlay} from '../../services/syncPlay';
import {
  calibrateTimelineOffset,
  isPrematureEnd,
  mediaToLogicalTime,
} from '../../w3cmedia/mediaTimeline';
import {toTicks} from './playbackPolicy';
import type {PlayerRefs} from './playerRefs';
import {TICKS_PER_SECOND} from './types';

interface PlaybackEventsOptions {
  applyPendingInitialSeek: (video: VideoPlayer) => void;
  applyPosition: (seconds: number) => void;
  currentPositionTicks: () => number;
  isLive: boolean;
  /** The item's own length, used when the stream does not report one. */
  itemRunTimeTicks?: number;
  positionStore: {set: (seconds: number) => void};
  refs: PlayerRefs;
  revealControls: (focus: boolean) => void;
  scheduleControlsHide: () => void;
  setBuffering: (buffering: boolean) => void;
  setPaused: (paused: boolean) => void;
  setPlaybackFinished: (finished: boolean) => void;
  setStatusText: (text: string) => void;
}

/**
 * Listens to one video element for as long as it is the current player.
 * Events from an element that has been replaced or released are ignored; the
 * listeners themselves come off through `refs.detachPlaybackEvents`.
 */
export const attachPlaybackEvents = (
  {
    applyPendingInitialSeek,
    applyPosition,
    currentPositionTicks,
    isLive,
    itemRunTimeTicks,
    positionStore,
    refs,
    revealControls,
    scheduleControlsHide,
    setBuffering,
    setPaused,
    setPlaybackFinished,
    setStatusText,
  }: PlaybackEventsOptions,
  video: VideoPlayer,
  generation: number,
) => {
  const {
    activeContext,
    controlsAwaitingProgress,
    controlsProgressPosition,
    detachPlaybackEvents,
    finishAtEndRef,
    isPausedRef,
    latestPositionTicks,
    mediaTimelineOffsetSeconds,
    pendingAdaptiveResumeSeconds,
    playbackDiagnosticsStartedAt,
    playbackErrorHandler,
    playbackEventDiagnostics,
    playbackGeneration,
    seekController,
    sessionReady,
    sleepingRef,
    streamInfo,
    syncPlayPlayer,
    unmountedRef,
    videoRef,
    wakeFromSleepRef,
  } = refs;
  const isCurrentPlayer = () =>
    !unmountedRef.current &&
    Boolean(activeContext.current?.isCurrent()) &&
    videoRef.current === video &&
    playbackGeneration.current === generation;
  const removers: Array<() => void> = [];
  const listen = (event: string, handler: () => void) => {
    video.addEventListener(event, handler);
    removers.push(() => video.removeEventListener(event, handler));
  };
  detachPlaybackEvents.current = () => removers.forEach((remove) => remove());
  const recordPlaybackEvent = (
    event: string,
    counter?: 'errorEventCount' | 'stalledEventCount' | 'waitingEventCount',
  ) => {
    const diagnostics = playbackEventDiagnostics.current;
    diagnostics.lastPlaybackEvent = event;
    diagnostics.lastPlaybackEventSeconds = Math.max(
      0,
      (Date.now() - playbackDiagnosticsStartedAt.current) / 1000,
    );
    if (counter) {
      diagnostics[counter] += 1;
      const stream = streamInfo.current;
      console.info('[Astra] Playback health event:', {
        event,
        generation,
        hlsSegmentTargetSeconds: stream?.hlsSegmentTargetSeconds,
        outputContainer: stream?.outputContainer,
        sourceContainer: stream?.sourceContainer,
        videoDeliveryMethod: stream?.videoDeliveryMethod,
      });
    }
  };

  listen('playing', () => {
    if (!isCurrentPlayer()) {
      return;
    }
    // Alexa and the system media controls play the video directly.
    if (sleepingRef.current) {
      video.pause();
      wakeFromSleepRef.current();
      return;
    }
    recordPlaybackEvent('playing');
    syncPlay.notifyPlayerPlaying(syncPlayPlayer.current);
    controlsAwaitingProgress.current = false;
    setBuffering(false);
    isPausedRef.current = false;
    const resumeTarget = pendingAdaptiveResumeSeconds.current;
    if (
      resumeTarget !== null &&
      typeof video.currentTime === 'number' &&
      Number.isFinite(video.currentTime)
    ) {
      mediaTimelineOffsetSeconds.current = calibrateTimelineOffset(
        resumeTarget,
        video.currentTime,
      );
      pendingAdaptiveResumeSeconds.current = null;
      latestPositionTicks.current = toTicks(resumeTarget);
      applyPosition(resumeTarget);
      console.info('[Astra] Calibrated server-positioned HLS timeline:', {
        logicalStartSeconds: resumeTarget,
        mediaStartSeconds: video.currentTime,
        timelineOffsetSeconds: mediaTimelineOffsetSeconds.current,
      });
    }
    setPaused(false);
    setPlaybackFinished(false);
    const videoWithDimensions = video as VideoPlayer & {
      videoWidth?: number;
      videoHeight?: number;
    };
    // The w3cmedia element doesn't populate videoWidth/videoHeight, so
    // fall back to the source dimensions from PlaybackInfo — with
    // stream copy (and unscaled HDR re-encodes) output equals source.
    const width = videoWithDimensions.videoWidth || streamInfo.current?.width;
    const height =
      videoWithDimensions.videoHeight || streamInfo.current?.height;
    const resolution = width && height ? ` ${width}x${height}` : '';
    setStatusText(
      t('player.playingMethod', {
        method: `${streamInfo.current?.playMethod ?? 'stream'}${resolution}`,
      }),
    );
    scheduleControlsHide();
  });
  listen('pause', () => {
    if (!isCurrentPlayer()) {
      return;
    }
    recordPlaybackEvent('pause');
    isPausedRef.current = true;
    setPaused(true);
    // A finished item is paused by its own end; the status line already
    // says so and must not flip back to "Paused" when the native event
    // arrives a moment later.
    if (sessionReady.current) {
      setStatusText(t('nowPlaying.paused'));
    }
    revealControls(false);
  });
  listen('loadedmetadata', () => {
    if (!isCurrentPlayer()) {
      return;
    }
    recordPlaybackEvent('loadedmetadata');
    setStatusText(t('player.streamLoaded'));
    applyPendingInitialSeek(video);
  });
  listen('canplay', () => {
    if (!isCurrentPlayer()) {
      return;
    }
    recordPlaybackEvent('canplay');
    setStatusText(t('player.ready'));
    applyPendingInitialSeek(video);
  });
  listen('waiting', () => {
    if (!isCurrentPlayer()) {
      return;
    }
    recordPlaybackEvent('waiting', 'waitingEventCount');
    syncPlay.notifyPlayerBuffering(syncPlayPlayer.current);
    controlsAwaitingProgress.current = true;
    setBuffering(true);
    controlsProgressPosition.current = video.currentTime;
    revealControls(false);
    setStatusText(t('player.buffering'));
  });
  listen('stalled', () => {
    if (!isCurrentPlayer()) {
      return;
    }
    recordPlaybackEvent('stalled', 'stalledEventCount');
    controlsAwaitingProgress.current = true;
    setBuffering(true);
    controlsProgressPosition.current = video.currentTime;
    revealControls(false);
    setStatusText(t('player.stalled'));
  });
  listen('timeupdate', () => {
    if (!isCurrentPlayer()) {
      return;
    }
    if (
      sessionReady.current &&
      !seekController.current?.seeking &&
      typeof video.currentTime === 'number' &&
      Number.isFinite(video.currentTime)
    ) {
      // Some Vega streams resume with timeupdate but no new playing event.
      // Rearm once on real progress, not on every subtitle clock tick.
      if (
        controlsAwaitingProgress.current &&
        !isPausedRef.current &&
        !video.paused &&
        video.currentTime > controlsProgressPosition.current + 0.05
      ) {
        controlsAwaitingProgress.current = false;
        setBuffering(false);
      }
      controlsProgressPosition.current = video.currentTime;
      const logicalTime =
        pendingAdaptiveResumeSeconds.current ??
        mediaToLogicalTime(
          video.currentTime,
          mediaTimelineOffsetSeconds.current,
        );
      latestPositionTicks.current = toTicks(logicalTime);
      // Store only. The player's 1 Hz interval owns `positionSeconds`.
      positionStore.set(logicalTime);
    }
  });
  listen('error', () => {
    if (!isCurrentPlayer()) {
      return;
    }
    recordPlaybackEvent('error');
    revealControls(false);
    playbackErrorHandler.current({
      source: 'native',
      code: (video as VideoPlayer & {error?: {code?: number}}).error?.code,
    });
  });
  listen('ended', () => {
    if (!isCurrentPlayer()) {
      return;
    }
    if (!sessionReady.current) {
      return;
    }
    // A live channel never ends on purpose: the upstream dropped, so
    // tune in again rather than finish.
    if (isLive) {
      recordPlaybackEvent('live-ended');
      playbackErrorHandler.current({source: 'early-end'});
      return;
    }
    if (
      isPrematureEnd(
        currentPositionTicks() / TICKS_PER_SECOND,
        streamInfo.current?.runTimeTicks ?? itemRunTimeTicks,
      )
    ) {
      recordPlaybackEvent('early-ended');
      playbackErrorHandler.current({source: 'early-end'});
      return;
    }
    recordPlaybackEvent('ended');
    finishAtEndRef.current(generation);
  });
};
