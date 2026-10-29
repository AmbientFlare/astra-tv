import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {ActivityIndicator, Text, View} from 'react-native';
import {
  useKeplerAppStateManager,
  useTVEventHandler,
} from '@amazon-devices/react-native-kepler';
import {
  KeplerVideoSurfaceView,
  VideoPlayer,
} from '@amazon-devices/react-native-w3cmedia';
import {FocusableItem} from '../../components/FocusableItem';
import {
  canServerTranscodeVideo,
  getStreamUrl,
  JellyfinMediaItem,
  JellyfinMediaTrack,
  JellyfinStreamInfo,
  PlaybackReportInput,
  reportPlaybackProgress,
  reportPlaybackStart,
  reportPlaybackStopped,
  sanitizeUrlForLog,
} from '../../services/jellyfin';

import {getHdrSupport} from '../../services/mediaCapabilities/hdr';
import {preferredVideoHdrLevel} from '../../services/mediaCapabilities/hdrPreference';
import {resetTraces, trace} from '../../services/logging/trace';
import {
  emitError,
  flushTelemetry,
  isTelemetryArmed,
  setTelemetrySession,
} from '../../services/telemetry';
import {
  emitPlaybackDecision,
  emitSessionEnd,
} from '../../services/telemetry/playbackFacts';
import type {ShakaPlayer as ShakaPlayerInstance} from '../../w3cmedia/shakaplayer/ShakaPlayer';
import {
  calibrateTimelineOffset,
  logicalToMediaTime,
  mediaToLogicalTime,
  logicalDurationSeconds,
  isFrozenAtEnd,
  isPrematureEnd,
  isStalledAtEnd,
  requiresStreamReload,
} from '../../w3cmedia/mediaTimeline';
import {
  getNextPlaybackRecovery,
  unloadPlayer,
} from '../../w3cmedia/playerLifecycle';
import {
  isPlaybackCancelled,
  OrderedPlaybackReporter,
  PlaybackSessionContext,
  PlaybackSessionController,
} from '../../services/playbackSession';
import {
  isMediaFailure,
  PlaybackFailure,
  shakaFailure,
  formatPlaybackFailure,
  PlaybackHealthMonitor,
  shouldAbandonForcedDecoderTranscode,
  shouldTripForcedDecoderTranscode,
  shouldForceVideoConversion,
  assessDecoderRisk,
  computeBufferBudget,
  shouldTranscodeForDecoder,
  shouldWarnAboutDecoderRisk,
  decoderRiskWarning,
} from '../../services/playbackHealth';
import {
  recordTranscodeFailure,
  recordTranscodeProbe,
  serverCapabilityKey,
} from '../../services/serverCapabilities';
import {
  defaultUserPreferences,
  readSeriesTrackPick,
  recordPlayback,
  rememberSeriesTrackPick,
  seriesTrackPickKey,
  UserPreferences,
  writePlaybackPreferences,
} from '../../services/storage';
import {
  Countdown,
  createCountdown,
  CreditsWindow,
  decideEndOfPlayback,
  findCreditsWindow,
  isInsideWindow,
} from '../../services/episodePlayback';
import {audioPlayback} from '../../services/audioPlayer';
import {
  playMedia,
  seekMedia,
  VideoSeekController,
} from '../../services/videoSeeking';
import {SeekMediaControlHandler} from './SeekMediaControlHandler';
import {SeekThumbnail} from './SeekThumbnail';
import {SeekAcceleration} from '../../services/videoSeeking/acceleration';
import {VideoPauseIdleVisual} from '../../components/VideoPauseIdleVisual';
import {
  startVideoEngagement,
  stopVideoEngagement,
} from '@astra/user-engagement';

import {createPositionStore} from './positionStore';
import {syncPlay, type SyncPlayPlayer} from '../../services/syncPlay';
import {t} from '../../i18n';
import {ConnectionNotice} from '../../components/ConnectionNotice';
import {useConnectionLoss} from '../../services/network/connection';
import {
  clearSleepTimer,
  getSleepTimer,
  setSleepTimer,
  sleepTimerChoice,
  useSleepTimer,
} from '../../services/sleepTimer';

import {
  emptyPlaybackEventDiagnostics,
  EndPrompt,
  PlaybackEventDiagnostics,
  PlaybackPanel,
  TICKS_PER_SECOND,
} from './types';
import {
  assertPlayableUrl,
  episodeLabel,
  isAdaptiveStream,
  RELOAD_JUMP_THRESHOLD_SECONDS,
  seriesPickFor,
  shouldUseHlsSequenceMode,
  shouldUseSequenceModeForMidFileStart,
  startupFailureMessage,
  toTicks,
} from './playbackPolicy';
import {formatDiagnosticTime} from './formatDiagnostics';
import {ExternalSubtitleOverlay} from './ExternalSubtitleOverlay';
import {PlaybackSettingsOverlay} from './PlaybackSettingsOverlay';
import {PlaybackStatsOverlay} from './PlaybackStatsOverlay';
import {styles} from './styles';
import {classifyRemoteKey, isMenuKey, isPlayPauseKey} from './remoteKeys';
import {useControlsVisibility} from './useControlsVisibility';
import {useEpisodeContext} from './useEpisodeContext';
import {useExternalSubtitleCues} from './useExternalSubtitleCues';
import {usePlaybackDiagnostics} from './usePlaybackDiagnostics';
import {usePlaybackPreferences} from './usePlaybackPreferences';
import {useServerTranscodeCapability} from './useServerTranscodeCapability';

// The overlays and pure helpers live beside this file; the names below are
// the module's public surface and stay importable from here.
export {
  shouldUseHlsSequenceMode,
  shouldUseSequenceModeForMidFileStart,
  startupFailureMessage,
} from './playbackPolicy';
export {ExternalSubtitleOverlay} from './ExternalSubtitleOverlay';
export {PlaybackSettingsOverlay} from './PlaybackSettingsOverlay';
export {PlaybackStatsOverlay} from './PlaybackStatsOverlay';

interface PlayerScreenProps {
  accessToken: string;
  /**
   * How many episodes in a row played unattended before this one. Zero when
   * the viewer chose it; the navigator supplies the count on an advance.
   */
  consecutiveAutoAdvances?: number;
  item: JellyfinMediaItem;
  onBack?: () => void;
  /**
   * Replaces this player with the given episode once this one has released
   * its media resources. Absent means the player never advances.
   */
  onPlayNext?: (item: JellyfinMediaItem, options: {automatic: boolean}) => void;
  serverUrl: string;
  userId?: string;
}

export const PlayerScreen = ({
  accessToken,
  consecutiveAutoAdvances = 0,
  item,
  onBack,
  onPlayNext,
  serverUrl,
  userId,
}: PlayerScreenProps) => {
  const videoRef = useRef<VideoPlayer | null>(null);
  const shakaPlayerRef = useRef<ShakaPlayerInstance | null>(null);
  const surfaceHandle = useRef<string | null>(null);
  const streamInfo = useRef<JellyfinStreamInfo | null>(null);
  // Survives releaseMedia, which clears streamInfo before the error is shown.
  const sourceVideoRangeType = useRef<string | undefined>();
  const sessionController = useRef(new PlaybackSessionController());
  const activeContext = useRef<PlaybackSessionContext | null>(null);
  const reporter = useRef<OrderedPlaybackReporter<PlaybackReportInput> | null>(
    null,
  );
  const reportBarrier = useRef<Promise<void>>(Promise.resolve());
  const releasePromise = useRef<Promise<void> | null>(null);
  const detachPlaybackEvents = useRef<(() => void) | null>(null);
  const stopPlaybackRef = useRef<() => Promise<void>>(async () => undefined);
  const healthMonitor = useRef(new PlaybackHealthMonitor());
  const sessionReady = useRef(false);
  // A playback counts once per player screen, however often it reloads.
  const playbackCounted = useRef(false);
  const sessionFailed = useRef(false);
  const navigationSent = useRef(false);
  const firstAvailableSeconds = useRef(0);
  const selectedAudioIndex = useRef<number | undefined>();
  const selectedAllowAudioStreamCopy = useRef(true);
  const selectedBitrate = useRef<number | undefined>();
  const decoderRequiresConversion = useRef(false);
  const selectedSubtitleBurnIn = useRef(false);
  const selectedSubtitleIndex = useRef<number | undefined>();
  // False only until the first stream resolves. From then on every reload
  // carries the session's subtitle choice explicitly (Off as -1 on the wire)
  // instead of re-running the global preference against the server.
  const subtitleSelectionPinned = useRef(false);
  const playbackGeneration = useRef(0);
  const playbackDiagnosticsStartedAt = useRef(Date.now());
  const playbackEventDiagnostics = useRef<PlaybackEventDiagnostics>(
    emptyPlaybackEventDiagnostics(),
  );
  const playbackErrorHandler = useRef<(failure: PlaybackFailure) => void>(
    () => undefined,
  );
  // Source changes and remote commands share the current seek callbacks.
  const reloadAtSecondsRef = useRef<
    ((targetSeconds: number) => Promise<void>) | null
  >(null);
  const seekController = useRef<VideoSeekController | null>(null);
  const seekAcceleration = useRef(new SeekAcceleration());
  const seekInPlaceAbort = useRef<AbortController | null>(null);
  const requestSkip = useRef<(delta?: number, direction?: 1 | -1) => void>(
    () => undefined,
  );
  const requestSeek = useRef<(position: number) => void>(() => undefined);
  const mediaControlsOwnSeeking = useRef(false);
  const playbackRecoveryAttempt = useRef(0);
  const trackReloadInProgress = useRef(false);
  const pendingInitialSeekSeconds = useRef<number | null>(null);
  const pendingAdaptiveResumeSeconds = useRef<number | null>(null);
  const mediaTimelineOffsetSeconds = useRef(0);
  const initialSeekApplied = useRef(false);
  const initialSeekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestPositionTicks = useRef(item.resumePositionTicks ?? 0);
  const isPausedRef = useRef(false);
  const unmountedRef = useRef(false);
  // SyncPlay holds one stable object; its methods call the latest handlers.
  const syncPlayHandlers = useRef<Omit<SyncPlayPlayer, 'itemId'> | null>(null);
  const syncPlayPlayer = useRef<SyncPlayPlayer>({
    itemId: item.id,
    getPositionTicks: () => syncPlayHandlers.current?.getPositionTicks() ?? 0,
    isPaused: () => syncPlayHandlers.current?.isPaused() ?? true,
    play: () => syncPlayHandlers.current?.play(),
    pause: () => syncPlayHandlers.current?.pause(),
    seekTicks: async (ticks, allowReload) =>
      syncPlayHandlers.current?.seekTicks(ticks, allowReload),
    release: async () => syncPlayHandlers.current?.release(),
    exit: () => syncPlayHandlers.current?.exit(),
  });
  const telemetrySessionStartedMs = useRef<number | null>(null);
  const episodePreferences = useRef<
    Pick<
      UserPreferences,
      | 'nextEpisodeAutoplay'
      | 'nextEpisodeCountdownSeconds'
      | 'skipIntroCredits'
      | 'stillWatchingAfterEpisodes'
    >
  >(defaultUserPreferences);
  // The only timer behind an unattended advance. Every exit path cancels it
  // through cancelCountdown so a late expiry can never navigate.
  const countdownRef = useRef<Countdown | null>(null);
  // Vega fires `ended` twice for one end of stream; one prompt per player.
  const endedHandledForGeneration = useRef<number | null>(null);
  const handledCreditsWindow = useRef<string | null>(null);
  const handoffInProgress = useRef(false);
  const endedHandler = useRef<() => void>(() => undefined);
  const finishAtEndRef = useRef<(generation: number) => void>(() => undefined);
  // Position at the previous 3 s check while actively playing, for spotting
  // a stream that froze in its last seconds without firing `ended`.
  const lastActivePosition = useRef<number | null>(null);
  const controlsAwaitingProgress = useRef(false);
  const controlsProgressPosition = useRef(0);
  const lastHandledKeyEvent = useRef<{
    time: number;
    type?: string;
  }>({time: 0});
  const keplerAppStateManager = useKeplerAppStateManager();
  const [currentStream, setCurrentStream] = useState<JellyfinStreamInfo | null>(
    null,
  );
  const [statusText, setStatusText] = useState(() => t('player.preparing'));
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
  const [seekInProgress, setSeekInProgress] = useState(false);
  const [scanStep, setScanStep] = useState<number | null>(null);
  const [isPaused, setPaused] = useState(false);
  const [isBuffering, setBuffering] = useState(false);
  const [subtitleAppearance, setSubtitleAppearance] = useState<
    UserPreferences['subtitleAppearance']
  >(defaultUserPreferences.subtitleAppearance);
  // Playback reached its natural end and the player is sitting on the finished
  // frame. Distinct from `isPaused`: a paused movie is still the viewer's, a
  // finished one is not. Drives the user-engagement release below.
  const [playbackFinished, setPlaybackFinished] = useState(false);
  const [settingsPanel, setSettingsPanel] = useState<PlaybackPanel | null>(
    null,
  );
  const [selectedAudioTrackIndex, setSelectedAudioTrackIndex] = useState<
    number | undefined
  >(undefined);
  const [selectedSubtitleTrackIndex, setSelectedSubtitleTrackIndex] = useState<
    number | undefined
  >(undefined);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [creditsPrompt, setCreditsPrompt] = useState<CreditsWindow | null>(
    null,
  );
  const [endPrompt, setEndPrompt] = useState<EndPrompt | null>(null);
  // Resolving a stream can take two server round trips, so startup gets its
  // own always-visible state rather than borrowing the auto-hiding controls.
  const [startupError, setStartupError] = useState<string | null>(null);
  const connection = useConnectionLoss();
  const [connectionStillOffline, setConnectionStillOffline] = useState(false);
  const [sleeping, setSleeping] = useState(false);
  const sleepingRef = useRef(false);
  const wakeFromSleepRef = useRef<() => void>(() => undefined);
  // Shown only to viewers whose server cannot re-encode a source this decoder
  // is not trusted with. Anyone with transcoding available gets the re-encode
  // instead and must never see this.
  const [decoderRiskWarned, setDecoderRiskWarned] = useState(false);
  useEffect(() => {
    if (!decoderRiskWarned) {
      return;
    }
    const timer = setTimeout(() => setDecoderRiskWarned(false), 12000);
    return () => clearTimeout(timer);
  }, [decoderRiskWarned]);
  const forcedDecoderTranscode = useRef(false);
  const decodedFramesThisSession = useRef(0);
  const forcedTranscodeReadyAtMs = useRef<number | null>(null);
  const serverKey = serverCapabilityKey(serverUrl);
  const {decoderTranscodeUnusable, transcodeProbeArmed} =
    useServerTranscodeCapability(serverKey);
  const transcodeSuccessRecorded = useRef(false);

  const [isStarting, setStarting] = useState(true);
  const onSurfaceViewCreatedRef = useRef<
    ((handle: string) => Promise<void>) | null
  >(null);
  const playbackRate = 1;
  const [positionSeconds, setPositionSeconds] = useState(
    (item.resumePositionTicks ?? 0) / TICKS_PER_SECOND,
  );
  // The high-frequency channel. `timeupdate` writes here and nowhere else, so
  // the ~4 Hz playhead stream reaches the subtitle overlay without re-rendering
  // the player. Every other position change also lands in React state below.
  const positionStore = useRef(
    createPositionStore((item.resumePositionTicks ?? 0) / TICKS_PER_SECOND),
  ).current;
  const applyPosition = useCallback(
    (seconds: number) => {
      positionStore.set(seconds);
      setPositionSeconds(seconds);
    },
    [positionStore],
  );
  const {
    preferredSeekSeconds,
    preferredMaxBitrate,
    showPlaybackStats,
    setShowPlaybackStats,
    showPlaybackTraces,
    setShowPlaybackTraces,
  } = usePlaybackPreferences();
  const {heartbeatRef, lastTelemetrySample, playbackDebugInfo} =
    usePlaybackDiagnostics({
      shakaPlayerRef,
      videoRef,
      unmountedRef,
      playbackEventDiagnostics,
      streamInfo,
      mediaTimelineOffsetSeconds,
      isPausedRef,
      forcedDecoderTranscode,
      transcodeSuccessRecorded,
      decodedFramesThisSession,
      serverKey,
      showPlaybackStats,
    });

  // Audio browsing intentionally survives navigation, but starting a movie is
  // an explicit media handoff. Stop and clear the music queue before the video
  // player claims media focus so stale track metadata cannot remain docked
  // beneath an active movie.
  // The session transition below awaits audio release before claiming video.

  const {mediaSegments, nextEpisode} = useEpisodeContext({
    accessToken,
    item,
    serverUrl,
    userId,
    onPreferences: (preferences) => {
      episodePreferences.current = preferences;
      setSubtitleAppearance(preferences.subtitleAppearance);
    },
  });
  const externalSubtitleCues = useExternalSubtitleCues(
    currentStream,
    selectedSubtitleTrackIndex,
  );
  const keepControlsVisible = Boolean(
    isPaused ||
      isBuffering ||
      isStarting ||
      startupError ||
      settingsPanel ||
      showExitConfirm ||
      creditsPrompt ||
      endPrompt ||
      playbackFinished,
  );
  const {
    showControls,
    clearControlsHideTimer,
    scheduleControlsHide,
    revealControls,
    hideControls,
  } = useControlsVisibility({
    videoRef,
    unmountedRef,
    sessionReady,
    keepControlsVisible,
  });

  const currentPositionTicks = useCallback(() => {
    if (
      !sessionReady.current ||
      seekController.current?.seeking ||
      pendingAdaptiveResumeSeconds.current !== null
    ) {
      return latestPositionTicks.current;
    }
    const video = videoRef.current;
    if (!video) {
      return latestPositionTicks.current;
    }
    const currentTime = video.currentTime;
    // A freshly created or failed video element reports currentTime 0;
    // trusting it would wipe a real resume position during error retries.
    // Deliberate seeks to 0 update latestPositionTicks directly, so a zero
    // here with a non-zero ref can only be a dead element.
    const isTrustworthy =
      typeof currentTime === 'number' &&
      Number.isFinite(currentTime) &&
      (currentTime > 0 || latestPositionTicks.current === 0);

    latestPositionTicks.current = toTicks(
      isTrustworthy
        ? mediaToLogicalTime(currentTime, mediaTimelineOffsetSeconds.current)
        : undefined,
      latestPositionTicks.current / TICKS_PER_SECOND,
    );

    return latestPositionTicks.current;
  }, []);

  const applyPendingInitialSeek = useCallback(
    (video: VideoPlayer) => {
      const target = pendingInitialSeekSeconds.current;

      if (target === null || initialSeekApplied.current) {
        return;
      }

      initialSeekApplied.current = true;
      if (initialSeekTimer.current) {
        clearTimeout(initialSeekTimer.current);
      }
      initialSeekTimer.current = setTimeout(async () => {
        initialSeekTimer.current = null;
        if (unmountedRef.current || videoRef.current !== video) {
          return;
        }

        const shakaPlayer = shakaPlayerRef.current;
        if (shakaPlayer) {
          await shakaPlayer.waitForAppendComplete();
        }
        if (unmountedRef.current || videoRef.current !== video) {
          return;
        }

        const duration =
          typeof video.duration === 'number' && Number.isFinite(video.duration)
            ? video.duration
            : 0;
        const clampedTarget =
          duration > 0 ? Math.min(target, Math.max(0, duration - 1)) : target;

        try {
          video.currentTime = clampedTarget;
          latestPositionTicks.current = toTicks(clampedTarget);
          applyPosition(clampedTarget);
          setStatusText(
            t('player.resumedAt', {
              time: `${Math.floor(clampedTarget / 60)}:${String(
                Math.floor(clampedTarget % 60),
              ).padStart(2, '0')}`,
            }),
          );
        } catch (error) {
          console.warn('Failed to apply resume position', error);
          setStatusText(t('player.playingFromStart'));
        }
      }, 250);
    },
    [applyPosition],
  );

  const reportProgress = useCallback(
    (positionTicks = currentPositionTicks(), paused = isPausedRef.current) => {
      const stream = streamInfo.current;
      if (!stream || !sessionReady.current) {
        return;
      }
      void reporter.current?.progress({
        ...stream,
        audioStreamIndex: selectedAudioIndex.current,
        subtitleStreamIndex: selectedSubtitleIndex.current,
        positionTicks,
        isPaused: paused,
      });
    },
    [currentPositionTicks],
  );

  const reportStopped = useCallback(() => {
    const stream = streamInfo.current;
    const reporting = reporter.current;
    reporter.current = null;
    if (!stream || !reporting) {
      return;
    }
    // Snapshot before refs/media are released. Telemetry never owns media lifetime.
    reportBarrier.current = reporting.stop({
      ...stream,
      audioStreamIndex: selectedAudioIndex.current,
      subtitleStreamIndex: selectedSubtitleIndex.current,
      positionTicks: currentPositionTicks(),
      failed: sessionFailed.current,
    });
  }, [currentPositionTicks]);

  const releaseMedia = useCallback((): Promise<void> => {
    if (releasePromise.current) {
      return releasePromise.current;
    }
    // Telemetry closes out before the media refs go away, in the same spirit
    // as reportStopped() above: snapshot, never own the media lifetime.
    heartbeatRef.current?.stop();
    if (isTelemetryArmed() && telemetrySessionStartedMs.current !== null) {
      const sample = lastTelemetrySample.current;
      const startedMs = telemetrySessionStartedMs.current;
      emitSessionEnd({
        reason: sessionFailed.current ? 'error' : 'ended',
        failed: sessionFailed.current,
        positionSec: currentPositionTicks() / TICKS_PER_SECOND,
        durationSec:
          (streamInfo.current?.runTimeTicks ?? item.runTimeTicks ?? 0) /
          TICKS_PER_SECOND,
        watchedSec: (Date.now() - startedMs) / 1000,
        bufferingTimeSec: sample?.bufferingTimeSeconds,
        droppedFrames: sample?.droppedFrames,
        decodedFrames: sample?.decodedFrames,
        errorsSeen: playbackEventDiagnostics.current.errorEventCount,
        stalledEvents: playbackEventDiagnostics.current.stalledEventCount,
        waitingEvents: playbackEventDiagnostics.current.waitingEventCount,
        lastError: playbackEventDiagnostics.current.lastError,
      });
      void flushTelemetry();
    }
    telemetrySessionStartedMs.current = null;
    lastTelemetrySample.current = null;
    setTelemetrySession(undefined);
    reportStopped();
    sessionReady.current = false;
    seekInPlaceAbort.current?.abort();
    seekInPlaceAbort.current = null;
    activeContext.current = null;
    healthMonitor.current.reset();
    const video = videoRef.current;
    const shaka = shakaPlayerRef.current;
    const handle = surfaceHandle.current;
    playbackGeneration.current += 1;
    detachPlaybackEvents.current?.();
    detachPlaybackEvents.current = null;
    videoRef.current = null;
    shakaPlayerRef.current = null;
    streamInfo.current = null;
    countdownRef.current?.cancel();
    countdownRef.current = null;
    clearControlsHideTimer();
    if (initialSeekTimer.current) {
      clearTimeout(initialSeekTimer.current);
      initialSeekTimer.current = null;
    }
    // The surface goes first, before anything that waits: unloading can take
    // seconds while appends finish, and a surface the system destroys in that
    // time must not still be attached when the player is finally torn down.
    try {
      if (handle) {
        video?.clearSurfaceHandle(handle);
      }
    } catch {
      /* Already detached by the native surface. */
    }
    try {
      video?.pause();
    } catch {
      /* Already detached by the native surface. */
    }
    const cleanup = (async () => {
      try {
        await shaka?.unload();
      } finally {
        await video?.deinitialize();
      }
    })();
    releasePromise.current = cleanup;
    // Keep a rejected cleanup barrier: a failed native release must not allow
    // a new player to attach to resources whose lifetime is still unresolved.
    void cleanup.then(
      () => {
        if (releasePromise.current === cleanup) {
          releasePromise.current = null;
        }
      },
      () => undefined,
    );
    return cleanup;
  }, [
    clearControlsHideTimer,
    currentPositionTicks,
    heartbeatRef,
    item,
    lastTelemetrySample,
    reportStopped,
  ]);

  const stopPlayback = useCallback(() => {
    latestPositionTicks.current = currentPositionTicks();
    seekController.current?.cancel();
    sessionController.current.invalidate();
    sessionReady.current = false;
    countdownRef.current?.cancel();
    void shakaPlayerRef.current?.cancelLoad().catch(() => undefined);
    return sessionController.current.dispose(releaseMedia);
  }, [currentPositionTicks, releaseMedia]);
  stopPlaybackRef.current = stopPlayback;

  const returnToLibrary = useCallback(() => {
    if (unmountedRef.current || navigationSent.current) {
      return;
    }
    navigationSent.current = true;
    onBack?.();
  }, [onBack]);

  const retryStartup = useCallback(() => {
    const handle = surfaceHandle.current;

    if (!handle) {
      return;
    }

    setStartupError(null);
    setStarting(true);
    playbackRecoveryAttempt.current = 0;
    onSurfaceViewCreatedRef.current?.(handle);
  }, []);

  const handleBack = useCallback(() => {
    void stopPlayback()
      .then(returnToLibrary)
      .catch(() => {
        setStatusText(t('player.releaseFailed'));
      });
  }, [returnToLibrary, stopPlayback]);

  /** Moves this player; the viewer's seeks go through seekToSeconds. */
  const moveToSeconds = useCallback(
    async (
      targetSeconds: number,
      closeSettings = false,
      signal?: AbortController['signal'],
      allowReload = true,
    ) => {
      const video = videoRef.current;

      if (
        !video ||
        !sessionReady.current ||
        trackReloadInProgress.current ||
        signal?.aborted
      ) {
        return;
      }

      const paused = isPausedRef.current;
      const requestedAtMs = Date.now();
      const fromSeconds = mediaToLogicalTime(
        video.currentTime,
        mediaTimelineOffsetSeconds.current,
      );
      if (videoRef.current !== video) {
        return;
      }

      const duration =
        (streamInfo.current?.runTimeTicks ?? item.runTimeTicks ?? 0) /
        TICKS_PER_SECOND;
      const target = Math.max(
        0,
        duration > 0
          ? Math.min(Math.max(0, duration - 1), targetSeconds)
          : targetSeconds,
      );
      if (
        requiresStreamReload(fromSeconds, target, firstAvailableSeconds.current)
      ) {
        if (!allowReload) {
          return;
        }
        // Jellyfin cannot start a transcode this close to the end, so a
        // jump there finishes the item rather than failing to load.
        if (
          isStalledAtEnd(
            target,
            streamInfo.current?.runTimeTicks ?? item.runTimeTicks,
          )
        ) {
          trace('jump.toEnd', 'toSeconds=' + target.toFixed(1));
          video.pause();
          finishAtEndRef.current(playbackGeneration.current);
          return;
        }
        await reloadAtSecondsRef.current?.(target);
        return;
      }
      healthMonitor.current.reset();
      const mediaTarget = logicalToMediaTime(
        target,
        mediaTimelineOffsetSeconds.current,
      );
      const mediaDuration =
        typeof video.duration === 'number' && Number.isFinite(video.duration)
          ? video.duration
          : 0;
      const clampedMediaTarget =
        mediaDuration > 0 ? Math.min(mediaDuration, mediaTarget) : mediaTarget;
      const positionTicks = toTicks(target);
      latestPositionTicks.current = positionTicks;
      applyPosition(target);
      const operation = new AbortController();
      seekInPlaceAbort.current = operation;
      const abort = () => operation.abort();
      signal?.addEventListener('abort', abort, {once: true});
      try {
        // Let native appends settle, then wait for the seek to finish before
        // the controller can issue another one.
        await shakaPlayerRef.current?.waitForAppendComplete();
        if (operation.signal.aborted || videoRef.current !== video) {
          return;
        }
        await seekMedia(video, clampedMediaTarget, operation.signal);
        if (operation.signal.aborted || videoRef.current !== video) {
          return;
        }
      } catch (error) {
        if (operation.signal.aborted || videoRef.current !== video) {
          return;
        }
        trace('seek.reload', error instanceof Error ? error.message : 'failed');
        await reloadAtSecondsRef.current?.(target);
        return;
      } finally {
        signal?.removeEventListener('abort', abort);
        if (seekInPlaceAbort.current === operation) {
          seekInPlaceAbort.current = null;
        }
      }
      console.info('[Astra] Seek completed:', {
        elapsedMs: Date.now() - requestedAtMs,
        fromSeconds,
        targetSeconds: target,
      });
      if (paused) {
        video.pause();
      }
      if (closeSettings) {
        setSettingsPanel(null);
      }
      scheduleControlsHide();
      setStatusText(
        t('player.jumpedTo', {
          time: `${Math.floor(target / 60)}:${String(
            Math.floor(target % 60),
          ).padStart(2, '0')}`,
        }),
      );

      reportProgress(positionTicks, paused);
    },
    [applyPosition, item.runTimeTicks, reportProgress, scheduleControlsHide],
  );

  const seekToSeconds = useCallback(
    async (
      targetSeconds: number,
      closeSettings = false,
      signal?: AbortController['signal'],
    ) => {
      if (syncPlay.controlsPlayer(item.id)) {
        // The group moves everyone, this player included, when it seeks.
        if (closeSettings) {
          setSettingsPanel(null);
        }
        syncPlay.requestSeek(toTicks(Math.max(0, targetSeconds)));
        return;
      }
      await moveToSeconds(targetSeconds, closeSettings, signal);
    },
    [item.id, moveToSeconds],
  );

  syncPlayHandlers.current = {
    getPositionTicks: currentPositionTicks,
    isPaused: () => videoRef.current?.paused ?? true,
    play: () => {
      const video = videoRef.current;
      if (!video || !sessionReady.current) {
        return;
      }
      video.play();
      isPausedRef.current = false;
      setPaused(false);
    },
    pause: () => {
      const video = videoRef.current;
      if (!video) {
        return;
      }
      video.pause();
      isPausedRef.current = true;
      setPaused(true);
    },
    seekTicks: async (ticks, allowReload) => {
      const before = videoRef.current;
      const wasPaused = before?.paused ?? true;
      // Resolves once the native seek has finished, and keeps a paused
      // player paused.
      await moveToSeconds(
        ticks / TICKS_PER_SECOND,
        false,
        undefined,
        allowReload,
      );
      const video = videoRef.current;
      if (video && video !== before && wasPaused) {
        // A long jump reloaded the stream, which starts it playing.
        syncPlayHandlers.current?.pause();
      }
    },
    release: () => stopPlayback(),
    exit: handleBack,
  };

  useEffect(() => syncPlay.attachPlayer(syncPlayPlayer.current), []);

  const seekCallbacks = useRef({
    apply: seekToSeconds,
    duration: (): number => 0,
  });
  seekCallbacks.current = {
    apply: seekToSeconds,
    duration: () =>
      logicalDurationSeconds(
        streamInfo.current?.runTimeTicks ?? item.runTimeTicks,
        videoRef.current?.duration,
        mediaTimelineOffsetSeconds.current,
      ),
  };
  if (!seekController.current) {
    seekController.current = new VideoSeekController({
      position: () => currentPositionTicks() / TICKS_PER_SECOND,
      duration: () => seekCallbacks.current.duration(),
      apply: (target, signal) =>
        seekCallbacks.current.apply(target, false, signal),
      preview: (target) => {
        if (target === null) {
          seekAcceleration.current.reset();
        }
        if (!unmountedRef.current) {
          if (target === null) {
            setScanStep(null);
          }
          setSeekPreview(target);
        }
      },
      onSeeking: (active) => {
        if (!unmountedRef.current) {
          setSeekInProgress(active);
        }
      },
      onError: (error) => {
        console.warn('[Astra] Unable to seek:', error);
        setStatusText(t('player.seekFailed'));
      },
    });
  }
  const canRequestSeek = () =>
    !unmountedRef.current &&
    !handoffInProgress.current &&
    !settingsPanel &&
    !showExitConfirm &&
    !creditsPrompt &&
    !endPrompt &&
    (sessionReady.current || Boolean(seekController.current?.seeking));
  requestSkip.current = (delta, direction = 1) => {
    if (!canRequestSeek()) {
      return;
    }
    revealControls(false);
    if (delta === undefined) {
      const step = seekAcceleration.current.step(
        direction,
        preferredSeekSeconds,
      );
      setScanStep(step);
      seekController.current?.skip(direction * step);
    } else {
      seekAcceleration.current.reset();
      setScanStep(null);
      seekController.current?.skip(delta);
    }
  };
  requestSeek.current = (position) => {
    if (!canRequestSeek()) {
      return;
    }
    revealControls(false);
    seekAcceleration.current.reset();
    setScanStep(null);
    seekController.current?.request(position);
  };

  useEffect(() => {
    if (seekPreview === null && !isPaused) {
      scheduleControlsHide();
    }
  }, [isPaused, scheduleControlsHide, seekPreview]);

  const cancelCountdown = useCallback(() => {
    countdownRef.current?.cancel();
    countdownRef.current = null;
  }, []);

  const dismissCreditsPrompt = useCallback((window: CreditsWindow) => {
    handledCreditsWindow.current = window.key;
    setCreditsPrompt(null);
  }, []);

  // Jumps to the end of the credits window. Same route as a chapter jump:
  // a long distance reloads at the target, a short one seeks in place.
  const skipCredits = useCallback(
    async (window: CreditsWindow) => {
      dismissCreditsPrompt(window);
      const video = videoRef.current;
      if (!video || typeof video.currentTime !== 'number') {
        return;
      }

      const target = window.endTicks / TICKS_PER_SECOND;
      const current = mediaToLogicalTime(
        video.currentTime,
        mediaTimelineOffsetSeconds.current,
      );
      const reloadAtSeconds = reloadAtSecondsRef.current;
      try {
        if (
          reloadAtSeconds &&
          Math.abs(target - current) >= RELOAD_JUMP_THRESHOLD_SECONDS
        ) {
          await reloadAtSeconds(target);
        } else {
          await seekToSeconds(target);
        }
      } catch (error) {
        console.warn('[Astra] Unable to skip credits:', error);
      }
    },
    [dismissCreditsPrompt, seekToSeconds],
  );

  const releaseForHandoff = useCallback(async () => {
    await stopPlayback();
  }, [stopPlayback]);

  const advanceToEpisode = useCallback(
    async (next: JellyfinMediaItem, automatic: boolean) => {
      if (!onPlayNext || handoffInProgress.current || unmountedRef.current) {
        return;
      }

      handoffInProgress.current = true;
      trackReloadInProgress.current = true;
      trace(
        'handoff.start',
        `to=${next.id.slice(0, 8)} automatic=${automatic} ` +
          `count=${consecutiveAutoAdvances}`,
      );
      cancelCountdown();
      setEndPrompt(null);
      setCreditsPrompt(null);
      setShowExitConfirm(false);
      setSettingsPanel(null);
      setStarting(true);
      setStatusText(t('player.startingNext'));

      try {
        await releaseForHandoff();
        trace('handoff.released', 'media released');
      } catch (error) {
        trace('handoff.released', 'release failed');
        console.warn(
          '[Astra] Failed to release the player for handoff:',
          error,
        );
        handoffInProgress.current = false;
        trackReloadInProgress.current = false;
        setStatusText(t('player.releaseFailed'));
        return;
      }

      // Back may have won the race: this screen is gone and the entry on top
      // of the stack is no longer a player to replace.
      if (unmountedRef.current) {
        trace('handoff.navigate', 'skipped: player already left');
        return;
      }
      trace('handoff.navigate', 'replacing player');
      onPlayNext(next, {automatic});
    },
    [cancelCountdown, consecutiveAutoAdvances, onPlayNext, releaseForHandoff],
  );

  // The sleep timer ran out: hold the picture, and tell the server where the
  // viewer stopped now rather than whenever they come back. Play starts a new
  // session from the same point.
  const goToSleep = useCallback(() => {
    trace('sleep.expired', `position=${currentPositionTicks()}`);
    cancelCountdown();
    setEndPrompt(null);
    setCreditsPrompt(null);
    setSettingsPanel(null);
    seekController.current?.cancelPreview();
    latestPositionTicks.current = currentPositionTicks();
    videoRef.current?.pause();
    isPausedRef.current = true;
    setPaused(true);
    reportStopped();
    sleepingRef.current = true;
    setSleeping(true);
  }, [cancelCountdown, currentPositionTicks, reportStopped]);
  const {minutesLeft: sleepMinutesLeft, timer: sleepTimer} =
    useSleepTimer(goToSleep);

  // Runs once per player generation when the stream ends. Movies finish;
  // an episode with a known successor counts down or asks, per the decision
  // rules in services/episodePlayback.
  endedHandler.current = () => {
    setCreditsPrompt(null);
    if (getSleepTimer()?.kind === 'endOfItem') {
      clearSleepTimer();
      goToSleep();
      return;
    }
    const action = decideEndOfPlayback({
      autoplayEnabled: episodePreferences.current.nextEpisodeAutoplay,
      consecutiveAutoAdvances,
      hasNextEpisode: Boolean(nextEpisode && onPlayNext),
      itemType: item.type,
      stillWatchingAfterEpisodes:
        episodePreferences.current.stillWatchingAfterEpisodes,
    });
    trace(
      'ended',
      `action=${action} autoplay=${
        episodePreferences.current.nextEpisodeAutoplay
      } count=${consecutiveAutoAdvances} next=${nextEpisode ? 'yes' : 'none'}`,
    );

    if (action === 'finished' || !nextEpisode) {
      return;
    }
    if (action === 'confirm') {
      setEndPrompt({kind: 'confirm'});
      return;
    }

    cancelCountdown();
    countdownRef.current = createCountdown({
      seconds: episodePreferences.current.nextEpisodeCountdownSeconds,
      onTick: (remainingSeconds) =>
        setEndPrompt({kind: 'countdown', remainingSeconds}),
      onExpire: () => {
        countdownRef.current = null;
        advanceToEpisode(nextEpisode, true).catch((error) => {
          console.warn('[Astra] Unable to play the next episode:', error);
        });
      },
    });
  };

  const creditsWindow = useMemo(
    () =>
      findCreditsWindow(
        mediaSegments,
        item.chapters,
        currentStream?.runTimeTicks ?? item.runTimeTicks,
      ),
    [
      currentStream?.runTimeTicks,
      item.chapters,
      item.runTimeTicks,
      mediaSegments,
    ],
  );

  useEffect(() => {
    trace(
      'credits.window',
      creditsWindow
        ? `${creditsWindow.source} ${(
            creditsWindow.startTicks / TICKS_PER_SECOND
          ).toFixed(0)}s-${(creditsWindow.endTicks / TICKS_PER_SECOND).toFixed(
            0,
          )}s`
        : 'none',
    );
  }, [creditsWindow]);

  useEffect(() => {
    const inside =
      creditsWindow !== null &&
      seekPreview === null &&
      !seekInProgress &&
      !isStarting &&
      !endPrompt &&
      handledCreditsWindow.current !== creditsWindow.key &&
      isInsideWindow(creditsWindow, toTicks(positionSeconds));

    if (!inside || !creditsWindow) {
      setCreditsPrompt((current) => (current ? null : current));
      return;
    }

    const mode = episodePreferences.current.skipIntroCredits;
    if (mode === 'ignore') {
      return;
    }
    if (mode === 'auto') {
      skipCredits(creditsWindow).catch((error) => {
        console.warn('[Astra] Unable to auto-skip credits:', error);
      });
      return;
    }
    setCreditsPrompt((current) => {
      if (current?.key === creditsWindow.key) {
        return current;
      }
      trace('credits.prompt', creditsWindow.key);
      return creditsWindow;
    });
  }, [
    creditsWindow,
    endPrompt,
    isStarting,
    positionSeconds,
    seekPreview,
    seekInProgress,
    skipCredits,
  ]);

  const togglePlayPause = useCallback(() => {
    // Waking needs no video: the timer may have run out on the startup error
    // screen, after the media was released, and the wake reloads anyway.
    if (sleepingRef.current) {
      wakeFromSleepRef.current();
      return;
    }

    const video = videoRef.current;

    if (!video) {
      return;
    }

    if (!sessionReady.current) {
      if (!trackReloadInProgress.current) {
        void reloadAtSecondsRef.current?.(0);
      }
      return;
    }

    if (syncPlay.controlsPlayer(item.id)) {
      // The group decides; its command comes back and moves this player.
      if (video.paused) {
        syncPlay.requestUnpause();
      } else {
        syncPlay.requestPause();
      }
      return;
    }

    if (video.paused) {
      video.play();
      setPaused(false);
    } else {
      video.pause();
      setPaused(true);
    }
  }, [item.id]);

  const unloadAdaptivePlayer = useCallback(async () => {
    await unloadPlayer(shakaPlayerRef);
  }, []);

  const loadVideoSource = useCallback(
    async (
      video: VideoPlayer,
      stream: JellyfinStreamInfo,
      startTimeSeconds?: number,
      context?: PlaybackSessionContext,
    ) => {
      context?.assertCurrent();
      if (!isAdaptiveStream(stream.url)) {
        pendingAdaptiveResumeSeconds.current = null;
        mediaTimelineOffsetSeconds.current = 0;
        await unloadAdaptivePlayer();
        context?.assertCurrent();
        video.src = stream.url;
        video.load();
        return;
      }

      const {ShakaPlayer} = await import(
        '../../w3cmedia/shakaplayer/ShakaPlayer'
      );
      context?.assertCurrent();
      const sequenceMode =
        shouldUseHlsSequenceMode(stream.outputContainer) ||
        shouldUseSequenceModeForMidFileStart(
          stream.outputContainer,
          startTimeSeconds,
        );
      trace(
        'shaka.mode',
        `${sequenceMode ? 'sequence' : 'segments'} container=${
          stream.outputContainer ?? '?'
        } start=${(startTimeSeconds ?? 0).toFixed(0)}s`,
      );
      const hdrSupport = await getHdrSupport();
      context?.assertCurrent();
      // stream.bitrate is the server's figure for the delivered stream. It is
      // the closest thing available before the manifest is parsed; the goals
      // only need to be right to within a segment.
      const bufferBudget = computeBufferBudget(stream.bitrate);
      trace(
        'shaka.buffer',
        `ahead=${bufferBudget.bufferingGoal}s resume=${
          bufferBudget.rebufferingGoal
        }s behind=${bufferBudget.bufferBehind}s bitrate=${
          stream.bitrate ?? '?'
        }`,
      );
      const settings = {
        bufferingGoalSeconds: bufferBudget.bufferingGoal,
        rebufferingGoalSeconds: bufferBudget.rebufferingGoal,
        bufferBehindSeconds: bufferBudget.bufferBehind,
        preferredVideoHdrLevel: preferredVideoHdrLevel(
          hdrSupport,
          stream.sourceVideoRangeType,
        ),
        secure: stream.url.startsWith('https://'),
        abrEnabled: false,
        abrMaxWidth: 3840,
        abrMaxHeight: 2160,
        // Physical testing rejected sequence mode for MPEG-TS because A/V
        // drift still accumulated over an hour. Retain the accepted
        // segments-mode path while evaluating W3C Media 2.2 in isolation.
        hlsSequenceMode: sequenceMode,
        hlsIgnoreManifestTimestampsInSegmentsMode: !sequenceMode,
        hlsResumePositionSeconds:
          startTimeSeconds && startTimeSeconds > 0
            ? startTimeSeconds
            : undefined,
        onError: (failure: PlaybackFailure) => {
          if (context?.isCurrent()) {
            playbackErrorHandler.current(failure);
          }
        },
        onTimelineReady: ({skippedSeconds}: {skippedSeconds: number}) => {
          if (!context?.isCurrent()) {
            return;
          }
          firstAvailableSeconds.current = skippedSeconds;
          pendingAdaptiveResumeSeconds.current = skippedSeconds;
        },
      };

      await unloadAdaptivePlayer();
      context?.assertCurrent();
      pendingAdaptiveResumeSeconds.current =
        startTimeSeconds && startTimeSeconds > 0 ? startTimeSeconds : null;
      mediaTimelineOffsetSeconds.current = 0;
      const shakaPlayer = new ShakaPlayer(video, settings);
      shakaPlayerRef.current = shakaPlayer;
      const cancel = () => {
        void shakaPlayer.cancelLoad().catch(() => undefined);
      };
      context?.signal.addEventListener('abort', cancel, {once: true});
      try {
        await shakaPlayer.load(
          {
            uri: stream.url,
            format: stream.url.includes('.mpd') ? 'DASH' : 'HLS',
            secure: settings.secure,
            drm_scheme: '',
            drm_license_uri: '',
            // Jellyfin's dynamic HLS URL is already positioned at the saved
            // movie time. Passing that absolute time again makes Shaka append
            // every shortened-playlist segment until it reaches the same
            // number. Start at the playlist edge and map its relative media
            // clock back to logical movie time once playback begins.
            startTime: 0,
          },
          false,
        );
        context?.assertCurrent();
      } catch (error) {
        // Shaka rejects with shaka.util.Error, which is not an Error
        // instance — without this it surfaces as a blank "Unable to start
        // playback" with no diagnostic trail.
        const shakaError = shakaFailure(error);
        const failureDetail = formatPlaybackFailure(shakaError);
        trace('shaka.load.error', failureDetail);
        console.error('[Astra] Shaka load failed:', failureDetail);
        throw error instanceof Error
          ? error
          : new Error(`Stream engine error: ${failureDetail}`);
      } finally {
        context?.signal.removeEventListener('abort', cancel);
      }
    },
    [unloadAdaptivePlayer],
  );

  const attachPlaybackEvents = useCallback(
    (video: VideoPlayer, generation: number) => {
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
      detachPlaybackEvents.current = () =>
        removers.forEach((remove) => remove());
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
        const width =
          videoWithDimensions.videoWidth || streamInfo.current?.width;
        const height =
          videoWithDimensions.videoHeight || streamInfo.current?.height;
        const resolution = width && height ? ` ${width}x${height}` : '';
        setStatusText(
          t('player.playingMethod', {
            method: `${
              streamInfo.current?.playMethod ?? 'stream'
            }${resolution}`,
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
          // Store only. The 1 Hz interval below owns `positionSeconds`.
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
        if (
          isPrematureEnd(
            currentPositionTicks() / TICKS_PER_SECOND,
            streamInfo.current?.runTimeTicks ?? item.runTimeTicks,
          )
        ) {
          recordPlaybackEvent('early-ended');
          playbackErrorHandler.current({source: 'early-end'});
          return;
        }
        recordPlaybackEvent('ended');
        finishAtEndRef.current(generation);
      });
    },
    [
      applyPendingInitialSeek,
      applyPosition,
      currentPositionTicks,
      item.runTimeTicks,
      positionStore,
      revealControls,
      scheduleControlsHide,
    ],
  );

  const createFreshVideoPlayer = useCallback(
    async (context: PlaybackSessionContext) => {
      context.assertCurrent();
      const handle = surfaceHandle.current;
      if (!handle) {
        throw new Error('Video surface is unavailable.');
      }
      const video = new VideoPlayer();
      videoRef.current = video;
      activeContext.current = context;
      playbackGeneration.current = context.generation;
      try {
        await video.setMediaControlFocus(
          keplerAppStateManager.getComponentInstance(),
          new SeekMediaControlHandler(
            (delta, direction) => {
              if (videoRef.current === video) {
                requestSkip.current(delta, direction);
              }
            },
            (position) => {
              if (videoRef.current === video) {
                requestSeek.current(position);
              }
            },
          ),
        );
        mediaControlsOwnSeeking.current = true;
      } catch {
        context.assertCurrent();
        mediaControlsOwnSeeking.current = false;
        console.warn('[Astra] Unable to claim Vega Media Controls.');
      }
      context.assertCurrent();
      await video.initialize();
      context.assertCurrent();
      attachPlaybackEvents(video, context.generation);
      video.setSurfaceHandle(handle);
      video.autoplay = false;
      video.defaultSeekIntervalInSec = preferredSeekSeconds;
      video.playbackRate = playbackRate;
      return video;
    },
    [
      attachPlaybackEvents,
      keplerAppStateManager,
      playbackRate,
      preferredSeekSeconds,
    ],
  );

  // Every subtitle is burned in by the server, so there is nothing to attach to
  // the media element and no per-track announcement worth making: saying
  // "burned-in subtitles" on every selection tells the viewer nothing they can
  // act on, and the reload already reports its own progress.
  //
  // Retained as the hook point both callers use, and because restoring in-app
  // rendering means restoring behaviour here.
  const addSelectedSubtitleTrack = useCallback(
    (_video: VideoPlayer, _stream: JellyfinStreamInfo) => undefined,
    [],
  );

  const loadStream = useCallback(
    async (
      startTicks: number,
      context: PlaybackSessionContext,
      mediaSourceId?: string,
    ) => {
      context.assertCurrent();
      const sourceVideoStream = item.mediaStreams?.find(
        (track) => track.type === 'Video',
      );
      sourceVideoRangeType.current = sourceVideoStream?.videoRangeType;
      // Most of the library is well within this decoder's comfort zone, so
      // this is a narrow exception rather than a routine re-encode: it fires
      // only for the high-bitrate Dolby Vision / HDR10+ tail. When the server
      // may re-encode we ask it to; when it may not, the source is delivered
      // as-is and the viewer is told it may not play smoothly.
      const decoderRisk = assessDecoderRisk(sourceVideoStream);
      // Once this server has been observed failing the re-encode, its stated
      // permission is worthless and asking again only wastes a request.
      const serverCanTranscodeVideo = decoderTranscodeUnusable.current
        ? false
        : decoderRisk.risk === 'heavy' && userId
        ? await canServerTranscodeVideo(
            serverUrl,
            accessToken,
            userId,
            context.signal,
          )
        : true;
      context.assertCurrent();
      const transcodeForDecoder = shouldTranscodeForDecoder(
        decoderRisk.risk,
        serverCanTranscodeVideo,
      );
      forcedDecoderTranscode.current = transcodeForDecoder;
      // Spend the probe here, where the request is genuinely going out.
      const probing = transcodeForDecoder && transcodeProbeArmed.current;
      if (probing) {
        transcodeProbeArmed.current = false;
        void recordTranscodeProbe(serverKey);
      }
      decodedFramesThisSession.current = 0;
      forcedTranscodeReadyAtMs.current = null;
      transcodeSuccessRecorded.current = false;
      if (decoderRisk.risk === 'heavy') {
        trace(
          'playback.decoderRisk',
          `heavy reason=${decoderRisk.reason} bitrate=${
            sourceVideoStream?.bitRate ?? '?'
          } range=${sourceVideoStream?.videoRangeType ?? '?'} transcode=${
            probing
              ? 'probe'
              : transcodeForDecoder
              ? 'forced'
              : decoderTranscodeUnusable.current
              ? 'unusable'
              : 'unavailable'
          }`,
        );
      }
      setDecoderRiskWarned(
        shouldWarnAboutDecoderRisk(decoderRisk.risk, serverCanTranscodeVideo),
      );
      // Only a choice this session has not made yet takes the series pick, and
      // getStreamUrl applies it to just those.
      const seriesTrackPick =
        item.seriesId &&
        userId &&
        (selectedAudioIndex.current === undefined ||
          !subtitleSelectionPinned.current)
          ? await readSeriesTrackPick(
              seriesTrackPickKey(userId, item.seriesId),
            ).catch(() => undefined)
          : undefined;
      context.assertCurrent();
      const stream = await getStreamUrl(
        serverUrl,
        accessToken,
        item.id,
        userId,
        startTicks,
        {
          allowAudioStreamCopy: selectedAllowAudioStreamCopy.current,
          audioStreamIndex: selectedAudioIndex.current,
          alwaysBurnInSubtitleWhenTranscoding: selectedSubtitleBurnIn.current,
          forceTranscode: shouldForceVideoConversion(
            decoderRequiresConversion.current,
            selectedSubtitleBurnIn.current,
            transcodeForDecoder,
          ),
          maxStreamingBitrate: selectedBitrate.current ?? preferredMaxBitrate,
          // On a reload the server has already named its source; reusing that
          // id keeps a track change pointed at the same one.
          mediaSourceId,
          seriesTrackPick,
          signal: context.signal,
          sourceHeight: sourceVideoStream?.height,
          sourceWidth: sourceVideoStream?.width,
          subtitleSelectionIsManual: subtitleSelectionPinned.current,
          subtitleStreamIndex: selectedSubtitleIndex.current,
        },
      );
      context.assertCurrent();
      console.log(
        '[Astra] Stream URL parts:',
        'transcodeUrl:',
        sanitizeUrlForLog(stream.transcodeUrl),
        'url:',
        sanitizeUrlForLog(stream.url),
      );
      console.log(
        '[Astra] Stream URL:',
        sanitizeUrlForLog(stream.url),
        '| PlayMethod:',
        stream.playMethod,
      );
      streamInfo.current = stream;
      setCurrentStream(stream);
      // PlaySessionId is the join key between this log, the Jellyfin server
      // log and FFmpeg.Transcode-*.log. Set it before the decision event so
      // every event on this session carries it.
      setTelemetrySession(stream.playSessionId);
      if (isTelemetryArmed()) {
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
      }
      if (
        selectedAudioIndex.current === undefined &&
        stream.audioTracks.length
      ) {
        // The service already picked a track (language/channel-aware) and
        // baked it into the stream URL — the UI selection must match it, or
        // a later reload silently switches audio tracks.
        const defaultTrack =
          (stream.audioStreamIndex !== undefined
            ? stream.audioTracks.find(
                (track) => track.index === stream.audioStreamIndex,
              )
            : undefined) ??
          stream.audioTracks.find((track) => track.isDefault) ??
          stream.audioTracks.find((track) =>
            track.language?.toLowerCase().startsWith('en'),
          ) ??
          stream.audioTracks[0];

        selectedAudioIndex.current = defaultTrack.index;
        setSelectedAudioTrackIndex(defaultTrack.index);
      }
      // PlaybackInfo has resolved either the global subtitle preference or
      // the pinned in-player choice. Mirror it into the refs the reload paths
      // and progress reports read, so an audio switch or long jump keeps the
      // same track and the overlay marks the one actually playing.
      selectedSubtitleIndex.current = stream.subtitleStreamIndex;
      setSelectedSubtitleTrackIndex(stream.subtitleStreamIndex);
      selectedSubtitleBurnIn.current = Boolean(stream.subtitleBurnIn);
      subtitleSelectionPinned.current = true;
      applyPosition(startTicks / TICKS_PER_SECOND);
      setStatusText(
        stream.playMethod === 'Transcode'
          ? isAdaptiveStream(stream.url)
            ? t('player.loadingHls')
            : t('player.loadingMp4')
          : t('player.loadingDirect'),
      );
      assertPlayableUrl(stream.url);

      return stream;
    },
    [
      accessToken,
      applyPosition,
      decoderTranscodeUnusable,
      item.id,
      item.mediaStreams,
      item.name,
      item.seriesId,
      preferredMaxBitrate,
      serverKey,
      serverUrl,
      transcodeProbeArmed,
      userId,
    ],
  );

  // All source changes share this transaction. Cancelling a request invalidates
  // every continuation before another transaction may attach native resources.
  const startPlayback = useCallback(
    async ({
      position = currentPositionTicks() / TICKS_PER_SECOND,
      audioTrack,
      subtitleTrack,
      failure,
      reason = 'reload',
    }: {
      position?: number;
      audioTrack?: JellyfinMediaTrack;
      subtitleTrack?: JellyfinMediaTrack | null;
      failure?: PlaybackFailure;
      reason?: string;
    } = {}) => {
      if (reason !== 'seek') {
        seekController.current?.cancel();
      }
      const sourceId = streamInfo.current?.mediaSourceId;
      const priorAudioDelivery = streamInfo.current?.audioDeliveryMethod;
      reportStopped();
      const duration = logicalDurationSeconds(
        streamInfo.current?.runTimeTicks ?? item.runTimeTicks,
      );
      const target = Math.max(
        0,
        duration > 0 ? Math.min(duration - 1, position) : position,
      );
      const restorePaused = reason === 'seek' && isPausedRef.current;
      const targetTicks = toTicks(target);
      trackReloadInProgress.current = true;
      sessionReady.current = false;
      healthMonitor.current.reset();
      setStarting(true);
      setStartupError(null);
      setSettingsPanel(null);
      setEndPrompt(null);
      cancelCountdown();
      setStatusText(
        reason === 'recovery' ? t('player.recovering') : t('player.preparing'),
      );
      const transition = sessionController.current.replace(async (context) => {
        context.assertCurrent();
        try {
          await releaseMedia();
          context.assertCurrent();
          await audioPlayback.stop();
          context.assertCurrent();
          if (audioTrack) {
            selectedAudioIndex.current = audioTrack.index;
            selectedAllowAudioStreamCopy.current = true;
            playbackRecoveryAttempt.current = 0;
            setSelectedAudioTrackIndex(audioTrack.index);
          }
          if (subtitleTrack !== undefined) {
            selectedSubtitleIndex.current = subtitleTrack?.index;
            selectedSubtitleBurnIn.current = Boolean(
              subtitleTrack?.burnInRequired,
            );
            subtitleSelectionPinned.current = true;
            setSelectedSubtitleTrackIndex(subtitleTrack?.index);
          }
          if (failure && isMediaFailure(failure)) {
            const recovery = getNextPlaybackRecovery({
              attempt: decoderRequiresConversion.current ? 2 : 0,
              audioDeliveryMethod: priorAudioDelivery,
            });
            if (recovery?.disableAudioStreamCopy) {
              selectedAllowAudioStreamCopy.current = false;
            }
            if (recovery?.forceVideoTranscode) {
              decoderRequiresConversion.current = true;
            }
          }
          latestPositionTicks.current = targetTicks;
          sessionFailed.current = false;
          firstAvailableSeconds.current = 0;
          mediaTimelineOffsetSeconds.current = 0;
          pendingAdaptiveResumeSeconds.current = null;
          applyPosition(target);
          const video = await createFreshVideoPlayer(context);
          context.assertCurrent();
          trace(
            'session.start',
            'generation=' +
              context.generation +
              ' reason=' +
              reason +
              ' position=' +
              target.toFixed(1),
          );
          const stream = await loadStream(targetTicks, context, sourceId);
          context.assertCurrent();

          const previousReports = reportBarrier.current;
          reporter.current = new OrderedPlaybackReporter<PlaybackReportInput>(
            async (event, value) => {
              await previousReports;
              if (event === 'start') {
                return reportPlaybackStart(serverUrl, accessToken, value);
              }
              if (event === 'stop') {
                return reportPlaybackStopped(serverUrl, accessToken, value);
              }
              return reportPlaybackProgress(serverUrl, accessToken, value);
            },
            () => trace('report.error', 'Jellyfin playback report failed'),
          );
          pendingInitialSeekSeconds.current =
            isAdaptiveStream(stream.url) || reason === 'seek' ? null : target;
          initialSeekApplied.current =
            isAdaptiveStream(stream.url) || reason === 'seek' || target === 0;
          addSelectedSubtitleTrack(video, stream);
          await loadVideoSource(video, stream, target, context);
          context.assertCurrent();
          sessionReady.current = true;
          // The sleep timer ran out while this was loading: hold the picture
          // and leave the session unreported until the viewer presses Play.
          if (sleepingRef.current) {
            reporter.current = null;
            latestPositionTicks.current = targetTicks;
            isPausedRef.current = true;
            setPaused(true);
            setStarting(false);
            return;
          }
          telemetrySessionStartedMs.current = Date.now();
          forcedTranscodeReadyAtMs.current = Date.now();
          heartbeatRef.current?.start();
          if (!playbackCounted.current) {
            playbackCounted.current = true;
            recordPlayback().catch(() => undefined);
          }
          void reporter.current?.start({
            ...stream,
            audioStreamIndex: selectedAudioIndex.current,
            subtitleStreamIndex: selectedSubtitleIndex.current,
            positionTicks: targetTicks,
            isPaused: restorePaused,
          });
          if (reason === 'seek') {
            await playMedia(video, context.signal);
            context.assertCurrent();
            if (!isAdaptiveStream(stream.url)) {
              await seekMedia(video, target, context.signal);
            }
          } else {
            await video.play();
          }
          context.assertCurrent();
          if (restorePaused) {
            video.pause();
          }
          isPausedRef.current = restorePaused;
          setPaused(restorePaused);
          setStarting(false);
          syncPlay.notifyPlayerStarted(syncPlayPlayer.current);
          scheduleControlsHide();
          setStatusText(t('player.startingVideo'));
        } catch (error) {
          const cancelled = !context.isCurrent() || isPlaybackCancelled(error);
          sessionFailed.current = !cancelled;
          await releaseMedia();
          if (cancelled) {
            return;
          }
          context.assertCurrent();
          trace('session.failed', 'generation=' + context.generation);
          setStarting(false);
          setStartupError(
            startupFailureMessage(
              sourceVideoRangeType.current,
              t('player.couldNotContinue'),
            ),
          );
          setStatusText(t('player.unableToPlay'));
        } finally {
          if (context.isCurrent()) {
            trackReloadInProgress.current = false;
          }
        }
      });
      try {
        await transition;
      } catch (error) {
        if (!isPlaybackCancelled(error) && !unmountedRef.current) {
          setStarting(false);
          setStartupError(t('player.releasePlayerFailed'));
        }
      }
    },
    [
      accessToken,
      addSelectedSubtitleTrack,
      applyPosition,
      cancelCountdown,
      createFreshVideoPlayer,
      currentPositionTicks,
      heartbeatRef,
      item.runTimeTicks,
      loadStream,
      loadVideoSource,
      releaseMedia,
      reportStopped,
      scheduleControlsHide,
      serverUrl,
    ],
  );

  const reloadWithTrack = useCallback(
    async (selection: {
      audioTrack?: JellyfinMediaTrack;
      subtitleTrack?: JellyfinMediaTrack | null;
    }) => {
      if (trackReloadInProgress.current) {
        return;
      }
      if (item.seriesId && userId) {
        rememberSeriesTrackPick(
          seriesTrackPickKey(userId, item.seriesId),
          seriesPickFor(selection),
        ).catch(() => undefined);
      }
      // A subtitle the app draws itself never touches the video stream, so
      // switching between text tracks (or turning them off) is a state change,
      // not a new session. Only a burn-in track — the one being left behind or
      // the one being chosen — needs the server to build a different stream.
      const subtitleOnly =
        selection.audioTrack === undefined &&
        selection.subtitleTrack !== undefined &&
        sessionReady.current &&
        !selectedSubtitleBurnIn.current &&
        !selection.subtitleTrack?.burnInRequired;
      if (subtitleOnly) {
        const track = selection.subtitleTrack ?? null;
        selectedSubtitleIndex.current = track?.index;
        selectedSubtitleBurnIn.current = false;
        subtitleSelectionPinned.current = true;
        setSelectedSubtitleTrackIndex(track?.index);
        setSettingsPanel(null);
        trace('subtitle.switch', `inPlace index=${track?.index ?? 'off'}`);
        reportProgress();
        return;
      }
      await startPlayback({...selection, reason: 'track'});
    },
    [item.seriesId, reportProgress, startPlayback, userId],
  );

  // The stream reached its end, by `ended` or by stalling in the last
  // seconds: report the stop, then autoplay, the end-of-episode sleep timer
  // and the still-watching count all run from here.
  finishAtEndRef.current = (generation) => {
    reportStopped();
    sessionReady.current = false;
    revealControls(false);
    setStatusText(t('player.finished'));
    setPlaybackFinished(true);
    if (endedHandledForGeneration.current === generation) {
      return;
    }
    endedHandledForGeneration.current = generation;
    endedHandler.current();
  };

  // The stop was already reported, so waking starts a new session rather
  // than playing on in the old one. Clear the sleep pause first: the reload
  // otherwise restores it, and the viewer has to press Play twice.
  wakeFromSleepRef.current = () => {
    sleepingRef.current = false;
    setSleeping(false);
    isPausedRef.current = false;
    setPaused(false);
    // A load still under way plays and reports as usual once it lands.
    if (trackReloadInProgress.current) {
      return;
    }
    reloadAtSecondsRef
      .current?.(latestPositionTicks.current / TICKS_PER_SECOND)
      ?.catch(() => undefined);
  };

  reloadAtSecondsRef.current = async (position) => {
    if (trackReloadInProgress.current) {
      return;
    }
    trace('jump.reload.start', 'toSeconds=' + position.toFixed(1));
    await startPlayback({position, reason: 'seek'});
  };

  playbackErrorHandler.current = (failure) => {
    if (!activeContext.current?.isCurrent() || unmountedRef.current) {
      return;
    }
    const diagnostics = playbackEventDiagnostics.current;
    diagnostics.errorEventCount += 1;
    if (failure.source === 'shaka') {
      diagnostics.shakaErrorEventCount =
        (diagnostics.shakaErrorEventCount ?? 0) + 1;
    }
    const detail = formatPlaybackFailure(failure);
    diagnostics.lastError = detail;
    trace('playback.error', detail);
    emitError('playback.error.detail', {
      ...failure,
      attempt: playbackRecoveryAttempt.current,
      errorEventCount: diagnostics.errorEventCount,
      shakaErrorEventCount: diagnostics.shakaErrorEventCount,
      playMethod: streamInfo.current?.playMethod,
    });
    // Nonfatal Shaka events are observable while its own retries continue.
    if (failure.source === 'shaka' && failure.severity === 1) {
      return;
    }
    if (trackReloadInProgress.current || !sessionReady.current) {
      return;
    }
    sessionFailed.current = true;
    // A forced re-encode that never produced a single frame is a server that
    // cannot do the work, not a transient fault. Retrying the identical
    // request twice more only spends 90 more seconds arriving at the same
    // place, so drop the force instead and let the source through. The retry
    // budget resets because this is a different request, and the sticky flag
    // means it can only happen once.
    if (
      shouldAbandonForcedDecoderTranscode(
        forcedDecoderTranscode.current,
        decoderTranscodeUnusable.current,
        decodedFramesThisSession.current,
      )
    ) {
      decoderTranscodeUnusable.current = true;
      void recordTranscodeFailure(serverKey);
      playbackRecoveryAttempt.current = 0;
      trace(
        'playback.decoderRisk',
        'forced transcode produced no frames; falling back to passthrough',
      );
      void startPlayback({failure, reason: 'recovery'});
      return;
    }
    if (playbackRecoveryAttempt.current >= 2) {
      sessionReady.current = false;
      videoRef.current?.pause();
      void sessionController.current
        .replace(async () => {
          await releaseMedia();
          if (!unmountedRef.current) {
            setStarting(false);
            setStartupError(
              startupFailureMessage(
                sourceVideoRangeType.current,
                t('player.stoppedUnexpectedly'),
              ),
            );
          }
        })
        .catch(() => undefined);
      return;
    }
    playbackRecoveryAttempt.current += 1;
    void startPlayback({failure, reason: 'recovery'});
  };

  useTVEventHandler((event) => {
    const {key, seekDirection, released, transport} = classifyRemoteKey(
      event.eventType,
      event.eventKeyAction,
    );
    if (released) {
      if (seekDirection && seekAcceleration.current.release(seekDirection)) {
        setScanStep(null);
      }
      return;
    }
    if (seekDirection) {
      if (!transport || !mediaControlsOwnSeeking.current) {
        requestSkip.current(undefined, seekDirection);
      }
      return;
    }
    if (seekController.current?.pending) {
      if (key === 'select' || key === 'back') {
        if (key === 'select') {
          seekController.current.commit();
        } else {
          seekController.current.cancelPreview();
        }
        return;
      }
    }
    const now = Date.now();
    // Keep duplicate non-seek actions collapsed. Seek repeats are accumulated
    // above; key-up events never dispatch another action.

    if (
      lastHandledKeyEvent.current.type === key &&
      now - lastHandledKeyEvent.current.time < 350
    ) {
      return;
    }
    lastHandledKeyEvent.current = {time: now, type: key};

    // The connection panel's buttons own every key but Back, which leaves.
    if (connection.lost) {
      if (key === 'back') {
        handleBack();
      }
      return;
    }

    if (sleeping) {
      if (key === 'back') {
        handleBack();
      } else if (key === 'select' || isPlayPauseKey(key)) {
        togglePlayPause();
      }
      return;
    }

    // While this player hands off to the next episode nothing but Back has
    // a target any more.
    if (handoffInProgress.current && key !== 'back') {
      return;
    }

    if (key === 'back' && endPrompt) {
      // Declining the next episode is not leaving the player: cancel the
      // countdown and stay on the finished video.
      cancelCountdown();
      setEndPrompt(null);
      setStatusText(t('player.finished'));
      return;
    }
    if (key === 'back' && creditsPrompt) {
      dismissCreditsPrompt(creditsPrompt);
      return;
    }
    if (endPrompt && isMenuKey(key)) {
      return;
    }
    if (creditsPrompt && isMenuKey(key)) {
      dismissCreditsPrompt(creditsPrompt);
    }

    // Back dismisses one layer at a time and must not reveal the controls
    // it is about to dismiss.
    if (key !== 'back') {
      revealControls(
        !settingsPanel &&
          !showExitConfirm &&
          !creditsPrompt &&
          !endPrompt &&
          !startupError,
      );
    }

    // Focusable controls own their Select and directional events while a
    // modal is open. The global playback handler must not also pause, seek,
    // or commit a second action for the key-up phase of the same click.
    if (
      (settingsPanel ||
        showExitConfirm ||
        creditsPrompt ||
        endPrompt ||
        startupError) &&
      key !== 'back' &&
      !isMenuKey(key)
    ) {
      return;
    }

    switch (key) {
      case 'back':
        if (startupError) {
          // The error panel's own Back button leaves at once; the remote's
          // Back must not first hide hidden controls and then ask to confirm.
          handleBack();
        } else if (settingsPanel) {
          setSettingsPanel(null);
        } else if (showExitConfirm) {
          setShowExitConfirm(false);
        } else if (showControls) {
          hideControls();
        } else {
          setShowExitConfirm(true);
        }
        break;
      case 'menu':
      case 'context_menu':
        seekController.current?.cancelPreview();
        revealControls(false);
        setSettingsPanel((panel) => (panel ? null : 'audio'));
        break;
      case 'playPause':
      case 'playpause':
        togglePlayPause();
        break;
      case 'select':
        if (!showControls) {
          revealControls(true);
          break;
        }
        togglePlayPause();
        break;
    }
  });

  useLayoutEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      // A timer belongs to this sitting: it follows the viewer into the next
      // episode, but not out of the player.
      if (!handoffInProgress.current) {
        clearSleepTimer();
      }
      void stopPlaybackRef.current().catch(() => {
        trace('session.cleanup', 'native release failed');
      });
    };
  }, []);

  useEffect(() => {
    const subscription = keplerAppStateManager.addAppStateListener(
      'change',
      (nextState) => {
        if (nextState === 'background') {
          syncPlay.playerBackgrounded(syncPlayPlayer.current);
          // The stop report goes out now, not after the native release: that
          // waits behind any running load, and the system may end Astra first.
          reportStopped();
          // Release VOD resources and return to details with the saved item context.
          void stopPlaybackRef
            .current()
            .then(returnToLibrary)
            .catch(() => trace('session.background', 'native release failed'));
        } else if (nextState === 'inactive') {
          seekController.current?.cancelPreview();
          videoRef.current?.pause();
          isPausedRef.current = true;
          setPaused(true);
          reportProgress(currentPositionTicks(), true);
        }
      },
    );
    return () => subscription.remove();
  }, [
    currentPositionTicks,
    keplerAppStateManager,
    returnToLibrary,
    reportProgress,
    reportStopped,
  ]);

  useEffect(() => {
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
      const runTimeTicks =
        streamInfo.current?.runTimeTicks ?? item.runTimeTicks;
      const active =
        !isPausedRef.current &&
        !trackReloadInProgress.current &&
        !seekController.current?.seeking;
      const previousSeconds = lastActivePosition.current;
      lastActivePosition.current = active ? positionSeconds : null;
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
    }, 3000);
    return () => clearInterval(interval);
  }, [
    applyPosition,
    currentPositionTicks,
    decoderTranscodeUnusable,
    item.runTimeTicks,
    reportProgress,
  ]);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  /**
   * Tell Vega the viewer is engaged with video playback while a video is open
   * and unfinished.
   *
   * The platform detects media playback on its own, but that detection is not
   * durable: build 20260908.11 held the foreground for 55 minutes of an
   * uninterrupted movie and was then terminated by the lifecycle manager
   * (`ReclaimMediaResource`, foreground taken by the system device-control UI)
   * at 47% of the runtime. This is the documented way to reinforce it.
   *
   * The hold spans pause as well as playback. A paused movie still belongs to
   * the viewer, and the burn-in visual behind it needs the app alive; releasing
   * there is what commit 8b9d24db added the hold to prevent.
   *
   * It does not span the finished frame. Once a video plays out, nobody is
   * watching anything, and holding engagement would keep the device awake
   * indefinitely on an end screen — the case the SDK documents releasing for
   * ("are you still watching?"). Build 20260908.12 sat on a finished movie for
   * 19 minutes still holding it. Resuming re-acquires: `playing` clears the
   * flag.
   */
  useEffect(() => {
    if (playbackFinished) {
      stopVideoEngagement();
      return undefined;
    }
    startVideoEngagement();
    return () => {
      stopVideoEngagement();
    };
  }, [playbackFinished]);

  /**
   * One sample of player diagnostics. Extracted from the stats overlay so the
   * telemetry heartbeat can reuse it on its own, much slower schedule.
   *
   * Reading getDebugStats() + getVideoPlaybackQuality() costs JS-thread time,
   * and blocking the JS thread is this app's signature failure mode (the ANR
   * in build 20260829.2). Nothing here changes how often the overlay samples;
   * the heartbeat adds one call per 10s, versus the overlay's one per second.
   */
  // With the network gone the buffer runs dry and the server may end the
  // transcode, so hold the picture still and start again from here on Retry.
  const connectionLost = connection.lost;
  useEffect(() => {
    if (!connectionLost) {
      return;
    }
    setConnectionStillOffline(false);
    seekController.current?.cancelPreview();
    videoRef.current?.pause();
    isPausedRef.current = true;
    setPaused(true);
    latestPositionTicks.current = currentPositionTicks();
  }, [connectionLost, currentPositionTicks]);

  const {retry: retryConnectionCheck} = connection;
  const retryConnection = useCallback(async () => {
    const online = await retryConnectionCheck();
    setConnectionStillOffline(!online);
    if (!online || unmountedRef.current) {
      return;
    }
    if (startupError) {
      retryStartup();
      return;
    }
    if (surfaceHandle.current) {
      await startPlayback({
        position: latestPositionTicks.current / TICKS_PER_SECOND,
        reason: 'reconnect',
      });
    }
  }, [retryConnectionCheck, retryStartup, startPlayback, startupError]);

  const onSurfaceViewCreated = useCallback(
    async (handle: string) => {
      if (unmountedRef.current || handoffInProgress.current) {
        return;
      }
      if (
        surfaceHandle.current === handle &&
        (trackReloadInProgress.current || sessionReady.current)
      ) {
        return;
      }
      surfaceHandle.current = handle;
      resetTraces();
      await startPlayback({
        position: latestPositionTicks.current / TICKS_PER_SECOND,
        reason: 'startup',
      });
    },
    [startPlayback],
  );
  onSurfaceViewCreatedRef.current = onSurfaceViewCreated;

  const onSurfaceViewDestroyed = useCallback(
    (handle: string) => {
      if (surfaceHandle.current !== handle) {
        return;
      }
      // Detach now, as the surface goes, rather than when the queued release
      // reaches it; the release then has no surface left to clear.
      surfaceHandle.current = null;
      try {
        videoRef.current?.clearSurfaceHandle(handle);
      } catch {
        /* The native side may already have let it go. */
      }
      void stopPlaybackRef
        .current()
        .then(returnToLibrary)
        .catch(() => trace('session.surface', 'native release failed'));
    },
    [returnToLibrary],
  );

  const durationSeconds = logicalDurationSeconds(
    currentStream?.runTimeTicks ?? item.runTimeTicks,
    videoRef.current?.duration,
    mediaTimelineOffsetSeconds.current,
  );
  const progressPercent =
    durationSeconds > 0
      ? `${Math.min(
          100,
          Math.max(
            0,
            ((seekPreview ?? positionSeconds) / durationSeconds) * 100,
          ),
        )}%`
      : '0%';
  const progressWidth = progressPercent as `${number}%`;
  const controlsVisible =
    showControls ||
    seekPreview !== null ||
    Boolean(settingsPanel) ||
    showExitConfirm;
  const startupFailedTitle =
    item.type === 'Episode'
      ? t('player.couldNotStartEpisode')
      : item.type === 'Movie'
      ? t('player.couldNotStartMovie')
      : t('player.couldNotStartItem');

  return (
    <View style={styles.screen} testID="player-screen">
      <KeplerVideoSurfaceView
        onSurfaceViewCreated={onSurfaceViewCreated}
        onSurfaceViewDestroyed={onSurfaceViewDestroyed}
        scalingmode="fit"
        style={styles.videoSurface}
        testID="player-video-surface"
      />
      <ExternalSubtitleOverlay
        cues={externalSubtitleCues}
        positionStore={positionStore}
        controlsVisible={controlsVisible}
        appearance={subtitleAppearance}
      />
      {currentStream?.mediaSourceId ? (
        <SeekThumbnail
          serverUrl={serverUrl}
          accessToken={accessToken}
          itemId={item.id}
          mediaSourceId={currentStream.mediaSourceId}
          userId={userId}
          target={seekPreview}
        />
      ) : null}
      {connection.lost ? (
        <ConnectionNotice
          checking={connection.checking}
          onBack={handleBack}
          onRetry={() => {
            retryConnection().catch(() => undefined);
          }}
          stillOffline={connectionStillOffline}
        />
      ) : null}
      {sleeping ? (
        <View style={styles.sleepNotice} testID="player-sleep-notice">
          <Text style={styles.settingsTitle}>{t('player.sleepEnded')}</Text>
          <Text style={styles.startupText}>{t('player.sleepResume')}</Text>
        </View>
      ) : null}
      {(isStarting || startupError) && !connection.lost ? (
        <View style={styles.startupOverlay} testID="player-startup-state">
          <Text numberOfLines={1} style={styles.startupTitle}>
            {item.name}
          </Text>
          {isStarting ? (
            <View style={styles.startupRow}>
              <ActivityIndicator color="#4CC9F0" size="large" />
              <Text style={styles.startupText}>
                {t('player.startingPlayback')}
              </Text>
            </View>
          ) : (
            <>
              <Text style={styles.startupText}>{startupFailedTitle}</Text>
              <Text style={styles.startupDetail}>{startupError}</Text>
              <View style={styles.startupButtons}>
                <FocusableItem
                  focusedStyle={styles.focusedButton}
                  hasTVPreferredFocus={true}
                  onPress={retryStartup}
                  style={styles.button}
                  testID="player-startup-retry">
                  <Text style={styles.buttonText}>{t('common.retry')}</Text>
                </FocusableItem>
                <FocusableItem
                  focusedStyle={styles.focusedButton}
                  onPress={handleBack}
                  style={styles.button}
                  testID="player-startup-back">
                  <Text style={styles.buttonText}>{t('common.back')}</Text>
                </FocusableItem>
              </View>
            </>
          )}
        </View>
      ) : null}
      {decoderRiskWarned ? (
        <View style={styles.decoderWarning}>
          <Text style={styles.decoderWarningText}>{decoderRiskWarning()}</Text>
        </View>
      ) : null}
      {controlsVisible ? (
        <View style={styles.overlay} testID="player-controls-overlay">
          <Text numberOfLines={1} style={styles.title}>
            {item.name}
          </Text>
          <Text style={styles.status} testID="player-seek-preview">
            {seekPreview === null
              ? statusText
              : `${formatDiagnosticTime(seekPreview)} / ${formatDiagnosticTime(
                  durationSeconds,
                )}${
                  seekInProgress
                    ? `  •  ${t('player.seeking')}`
                    : `  •  ${t('player.seekHint', {
                        seconds: scanStep ?? preferredSeekSeconds,
                      })}`
                }`}
          </Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, {width: progressWidth}]} />
          </View>
        </View>
      ) : null}
      {settingsPanel && currentStream ? (
        <PlaybackSettingsOverlay
          onSelectAudio={(track) => reloadWithTrack({audioTrack: track})}
          onSelectSubtitle={(track) => reloadWithTrack({subtitleTrack: track})}
          onToggleStats={() =>
            setShowPlaybackStats((visible) => {
              const next = !visible;
              writePlaybackPreferences({showPlaybackStats: next}).catch(
                (error) =>
                  console.warn(
                    '[Astra] Failed to save diagnostics preference:',
                    error,
                  ),
              );
              return next;
            })
          }
          selectedAudioIndex={selectedAudioTrackIndex}
          selectedSubtitleIndex={selectedSubtitleTrackIndex}
          isEpisode={item.type === 'Episode'}
          onSelectSleepTimer={(choice) => {
            trace('sleep.set', String(choice ?? 'off'));
            setSleepTimer(choice);
          }}
          sleepMinutesLeft={sleepMinutesLeft}
          sleepTimer={sleepTimerChoice(sleepTimer)}
          showStats={showPlaybackStats}
          showTraces={showPlaybackTraces}
          onToggleTraces={() => setShowPlaybackTraces((value) => !value)}
          streamInfo={currentStream}
        />
      ) : null}
      {showPlaybackStats && currentStream ? (
        <PlaybackStatsOverlay
          showTraces={showPlaybackTraces}
          diagnostics={playbackDebugInfo}
          positionSeconds={positionSeconds}
          streamInfo={currentStream}
        />
      ) : null}
      {showExitConfirm ? (
        <View style={styles.exitOverlay} testID="player-exit-confirm">
          <Text style={styles.exitTitle}>{t('player.stopConfirm')}</Text>
          <View style={styles.exitButtons}>
            <FocusableItem
              focusedStyle={styles.focusedButton}
              hasTVPreferredFocus={true}
              onPress={() => setShowExitConfirm(false)}
              style={styles.button}
              testID="player-exit-stay">
              <Text style={styles.buttonText}>{t('player.stay')}</Text>
            </FocusableItem>
            <FocusableItem
              focusedStyle={styles.focusedButton}
              onPress={handleBack}
              style={styles.button}
              testID="player-exit-leave">
              <Text style={styles.buttonText}>{t('player.leave')}</Text>
            </FocusableItem>
          </View>
        </View>
      ) : null}
      {creditsPrompt && !endPrompt && !showExitConfirm && !settingsPanel ? (
        <View style={styles.promptCard} testID="player-credits-prompt">
          <Text style={styles.promptTitle}>{t('player.credits')}</Text>
          <View style={styles.exitButtons}>
            <FocusableItem
              focusedStyle={styles.focusedButton}
              hasTVPreferredFocus={true}
              onPress={() => {
                skipCredits(creditsPrompt).catch((error) => {
                  console.warn('[Astra] Unable to skip credits:', error);
                });
              }}
              style={styles.button}
              testID="player-skip-credits">
              <Text style={styles.buttonText}>{t('player.skipCredits')}</Text>
            </FocusableItem>
            {nextEpisode && onPlayNext ? (
              <FocusableItem
                focusedStyle={styles.focusedButton}
                onPress={() => {
                  advanceToEpisode(nextEpisode, false).catch((error) => {
                    console.warn(
                      '[Astra] Unable to play the next episode:',
                      error,
                    );
                  });
                }}
                style={styles.button}
                testID="player-next-episode">
                <Text style={styles.buttonText}>{t('detail.nextEpisode')}</Text>
              </FocusableItem>
            ) : null}
          </View>
        </View>
      ) : null}
      {endPrompt && nextEpisode && !showExitConfirm ? (
        <View style={styles.exitOverlay} testID="player-end-prompt">
          <Text style={styles.exitTitle}>
            {endPrompt.kind === 'countdown'
              ? t('player.upNext')
              : t('player.continueWatching')}
          </Text>
          <Text numberOfLines={1} style={styles.promptSubtitle}>
            {episodeLabel(nextEpisode)}
          </Text>
          <Text style={styles.promptHint}>
            {endPrompt.kind === 'countdown'
              ? t('player.playingIn', {seconds: endPrompt.remainingSeconds})
              : t('player.pressNextEpisode')}
          </Text>
          <View style={styles.exitButtons}>
            <FocusableItem
              focusedStyle={styles.focusedButton}
              hasTVPreferredFocus={true}
              onPress={() => {
                advanceToEpisode(nextEpisode, false).catch((error) => {
                  console.warn(
                    '[Astra] Unable to play the next episode:',
                    error,
                  );
                });
              }}
              style={styles.button}
              testID={
                endPrompt.kind === 'countdown'
                  ? 'player-up-next-play'
                  : 'player-continue-watching'
              }>
              <Text style={styles.buttonText}>
                {endPrompt.kind === 'countdown'
                  ? t('player.playNow')
                  : t('detail.nextEpisode')}
              </Text>
            </FocusableItem>
            <FocusableItem
              focusedStyle={styles.focusedButton}
              onPress={() => {
                if (endPrompt.kind === 'countdown') {
                  cancelCountdown();
                  setEndPrompt(null);
                  setStatusText(t('player.finished'));
                } else {
                  handleBack();
                }
              }}
              style={styles.button}
              testID={
                endPrompt.kind === 'countdown'
                  ? 'player-up-next-cancel'
                  : 'player-finished-done'
              }>
              <Text style={styles.buttonText}>
                {endPrompt.kind === 'countdown'
                  ? t('common.cancel')
                  : t('player.done')}
              </Text>
            </FocusableItem>
          </View>
        </View>
      ) : null}
      <VideoPauseIdleVisual
        artworkUrl={item.backdropUrl ?? item.imageUrl}
        paused={isPaused}
        title={item.name}
      />
    </View>
  );
};
