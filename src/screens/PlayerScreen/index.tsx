import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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
  getAdjacentEpisodes,
  getEpisodes,
  getMediaSegments,
  getStreamUrl,
  JellyfinMediaItem,
  JellyfinMediaSegment,
  JellyfinMediaTrack,
  JellyfinStreamInfo,
  reportPlaybackProgress,
  reportPlaybackStart,
  reportPlaybackStopped,
  sanitizeUrlForLog,
} from '../../services/jellyfin';
import {getTraces, resetTraces, trace} from '../../services/logging/trace';
import type {ShakaPlayer as ShakaPlayerInstance} from '../../w3cmedia/shakaplayer/ShakaPlayer';
import {
  calibrateTimelineOffset,
  logicalToMediaTime,
  mediaToLogicalTime,
} from '../../w3cmedia/mediaTimeline';
import {
  getNextPlaybackRecovery,
  unloadPlayer,
} from '../../w3cmedia/playerLifecycle';
import {
  defaultPlaybackPrefs,
  defaultUserPreferences,
  getUserPreferences,
  readPlaybackPreferences,
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
  resolveNextEpisode,
} from '../../services/episodePlayback';
import {audioPlayback} from '../../services/audioPlayer';
import {VideoPauseIdleVisual} from '../../components/VideoPauseIdleVisual';
import {
  activeWebVttText,
  parseWebVtt,
  WebVttCue,
} from '../../services/subtitles';
import {APP_VERSION, BUILD_NUMBER} from '../../config/app';

const TICKS_PER_SECOND = 10000000;
const CONTROL_HIDE_DELAY_MS = 5000;
type PlaybackPanel = 'audio' | 'subtitles';

interface PlaybackDebugInfo {
  activeVideoHeight?: number;
  activeVideoWidth?: number;
  bufferedAheadSeconds?: number;
  bufferedRangeCount?: number;
  bufferingTimeSeconds?: number;
  decodedFrames?: number;
  droppedFrames?: number;
  estimatedBandwidth?: number;
  errorEventCount: number;
  furthestBufferedAheadSeconds?: number;
  lastPlaybackEvent?: string;
  lastPlaybackEventSeconds?: number;
  nextBufferedGapSeconds?: number;
  stalledEventCount: number;
  streamBandwidth?: number;
  waitingEventCount: number;
}

interface PlaybackEventDiagnostics {
  errorEventCount: number;
  lastPlaybackEvent?: string;
  lastPlaybackEventSeconds?: number;
  stalledEventCount: number;
  waitingEventCount: number;
}

const emptyPlaybackEventDiagnostics = (): PlaybackEventDiagnostics => ({
  errorEventCount: 0,
  stalledEventCount: 0,
  waitingEventCount: 0,
});

// The physical one-hour MPEG-TS test rejected sequence mode: audio accumulated
// a clearly visible lead over video, while pause/resume partially restored
// sync. Keep every video route in the previously accepted segments mode while
// the native W3C Media 2.2 interface is evaluated independently.
export const shouldUseHlsSequenceMode = (_outputContainer?: string) => false;

/**
 * An fMP4 session that starts mid-file needs sequence mode. Jellyfin's
 * transcode keeps source timestamps (`-copyts`), and the fMP4 init segment
 * is served by a separate from-zero FFmpeg session, so in segments mode the
 * first fragment lands at its source time (for example 3345 s) while Shaka's
 * playhead stays at 0 and nothing ever decodes. Observed on the physical
 * stick for a subtitle burn-in resume on two titles. Sequence mode places
 * the first fragment at the playhead regardless of its timestamps. MPEG-TS
 * has no init segment and keeps the accepted segments mode, and so does
 * fMP4 playback from the start.
 */
export const shouldUseSequenceModeForMidFileStart = (
  outputContainer: string | undefined,
  startTimeSeconds: number | undefined,
) => {
  if (!(startTimeSeconds && startTimeSeconds > 0)) {
    return false;
  }
  const container = (outputContainer ?? '').trim().toLowerCase();
  return container.includes('mp4') || container.includes('m4s');
};

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

type EndPrompt =
  | {kind: 'countdown'; remainingSeconds: number}
  | {kind: 'confirm'};

const episodeLabel = (episode: JellyfinMediaItem) => {
  const code =
    episode.parentIndexNumber !== undefined && episode.indexNumber !== undefined
      ? `S${episode.parentIndexNumber}:E${episode.indexNumber}`
      : episode.indexNumber !== undefined
      ? `Episode ${episode.indexNumber}`
      : undefined;
  return code ? `${code}  ${episode.name}` : episode.name;
};

const toTicks = (seconds?: number, fallback = 0) =>
  Math.round((seconds ?? fallback) * TICKS_PER_SECOND);

// For content without embedded chapters, the FF/RW keys jump across this
// many evenly spaced synthetic chapters instead.
const SYNTHETIC_CHAPTER_COUNT = 12;

/**
 * Jumps at least this far reload the stream at the target instead of seeking
 * within it.
 *
 * An in-place seek makes Vega drain and refill the decoder, which was measured
 * at 36 s for a ten-minute jump and close to two minutes on a high-bitrate
 * title. Reloading asks Jellyfin to start at the target segment, the same route
 * resume takes, which lands in about three seconds. Short D-pad seeks stay
 * in-place because they are already near-instant and a reload would be a
 * visible interruption for no gain.
 */
const RELOAD_JUMP_THRESHOLD_SECONDS = 60;

const isAdaptiveStream = (url: string) =>
  url.includes('.m3u8') || url.includes('.mpd');

const assertPlayableUrl = (url: string) => {
  const parsed = new URL(url);
  const seenKeys = new Set<string>();
  const duplicateKeys = new Set<string>();

  parsed.searchParams.forEach((_, key) => {
    const normalizedKey = key.toLowerCase();
    if (seenKeys.has(normalizedKey)) {
      duplicateKeys.add(key);
    }
    seenKeys.add(normalizedKey);
  });

  const hasEmptyQueryAssignment = /[?&]=(?:&|$)/.test(url);

  if (duplicateKeys.size || hasEmptyQueryAssignment) {
    console.warn('[Astra] Malformed playback URL:', {
      duplicateQueryKeys: Array.from(duplicateKeys),
      hasEmptyQueryAssignment,
      url,
    });
    throw new Error(
      'Malformed playback URL before video load. Check stream URL logs.',
    );
  }
};

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
  const stoppedReported = useRef(false);
  const selectedAudioIndex = useRef<number | undefined>();
  const selectedAllowAudioStreamCopy = useRef(true);
  const selectedBitrate = useRef<number | undefined>();
  const selectedForceTranscode = useRef(false);
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
  const playbackErrorHandler = useRef<() => void>(() => undefined);
  // Assigned once the reload machinery below exists. jumpChapter is defined
  // before it, so it cannot take the function as a dependency directly.
  const reloadAtSecondsRef = useRef<
    ((targetSeconds: number) => Promise<void>) | null
  >(null);
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
  const episodePreferences = useRef<
    Pick<
      UserPreferences,
      'nextEpisodeAutoplay' | 'nextEpisodeCountdownSeconds' | 'skipIntroCredits'
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
  const controlsHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHandledKeyEvent = useRef<{
    time: number;
    type?: string;
  }>({time: 0});
  const keplerAppStateManager = useKeplerAppStateManager();
  const [currentStream, setCurrentStream] = useState<JellyfinStreamInfo | null>(
    null,
  );
  const [statusText, setStatusText] = useState('Preparing playback...');
  const [showControls, setShowControls] = useState(true);
  const [isPaused, setPaused] = useState(false);
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
  const [mediaSegments, setMediaSegments] = useState<JellyfinMediaSegment[]>(
    [],
  );
  const [nextEpisode, setNextEpisode] = useState<JellyfinMediaItem | null>(
    null,
  );
  const [creditsPrompt, setCreditsPrompt] = useState<CreditsWindow | null>(
    null,
  );
  const [endPrompt, setEndPrompt] = useState<EndPrompt | null>(null);
  // Resolving a stream can take two server round trips, so startup gets its
  // own always-visible state rather than borrowing the auto-hiding controls.
  const [startupError, setStartupError] = useState<string | null>(null);
  const [isStarting, setStarting] = useState(true);
  const onSurfaceViewCreatedRef = useRef<
    ((handle: string) => Promise<void>) | null
  >(null);
  const [showPlaybackStats, setShowPlaybackStats] = useState(false);
  const [showPlaybackTraces, setShowPlaybackTraces] = useState(false);
  const [playbackDebugInfo, setPlaybackDebugInfo] =
    useState<PlaybackDebugInfo | null>(null);
  const [externalSubtitleCues, setExternalSubtitleCues] = useState<WebVttCue[]>(
    [],
  );
  const playbackRate = 1;
  const [positionSeconds, setPositionSeconds] = useState(
    (item.resumePositionTicks ?? 0) / TICKS_PER_SECOND,
  );
  const [preferredSeekSeconds, setPreferredSeekSeconds] = useState(
    defaultPlaybackPrefs.seekDurationSeconds,
  );
  const [preferredMaxBitrate, setPreferredMaxBitrate] = useState<
    number | undefined
  >(undefined);

  // Audio browsing intentionally survives navigation, but starting a movie is
  // an explicit media handoff. Stop and clear the music queue before the video
  // player claims media focus so stale track metadata cannot remain docked
  // beneath an active movie.
  useEffect(() => {
    audioPlayback.stop();
  }, []);

  useEffect(() => {
    let mounted = true;

    readPlaybackPreferences().then((preferences) => {
      if (!mounted) {
        return;
      }

      setPreferredSeekSeconds(preferences.seekDurationSeconds);
      setPreferredMaxBitrate(preferences.maxBitrateBps);
      setShowPlaybackStats(preferences.showPlaybackStats);
      setShowPlaybackTraces(preferences.showPlaybackTraces);
    });

    return () => {
      mounted = false;
    };
  }, []);

  // Credits and next-episode data are fetched once per item, off the playback
  // path. Any failure leaves that feature off for this video and touches
  // nothing else.
  const itemId = item.id;
  const itemType = item.type;
  const seriesId = item.seriesId;
  const seasonId = item.parentId;
  useEffect(() => {
    let mounted = true;

    getUserPreferences()
      .then((preferences) => {
        if (mounted) {
          episodePreferences.current = preferences;
        }
      })
      .catch((error) => {
        console.warn('[Astra] Unable to read episode preferences:', error);
      });

    getMediaSegments(serverUrl, accessToken, itemId)
      .then((segments) => {
        trace(
          'credits.segments',
          `count=${segments.length} chapters=${item.chapters?.length ?? 0}`,
        );
        if (mounted) {
          setMediaSegments(segments);
        }
      })
      .catch((error) => {
        trace(
          'credits.segments',
          `error ${error instanceof Error ? error.message : String(error)}`,
        );
        console.warn('[Astra] Unable to load media segments:', error);
      });

    if (itemType === 'Episode' && seriesId && userId) {
      const current = {
        id: itemId,
        indexNumber: item.indexNumber,
        parentIndexNumber: item.parentIndexNumber,
        seriesId,
      };
      const describe = (episode: JellyfinMediaItem | null) =>
        episode
          ? `s${episode.parentIndexNumber ?? '?'}e${
              episode.indexNumber ?? '?'
            } ${episode.locationType ?? ''}`.trim()
          : 'none';
      getAdjacentEpisodes(serverUrl, accessToken, userId, seriesId, itemId)
        .then(async (episodes) => {
          let next = resolveNextEpisode(episodes, current);
          const hasCurrent = episodes.some((episode) => episode.id === itemId);
          trace(
            'nextEpisode.adjacent',
            `candidates=${episodes.length} hasCurrent=${hasCurrent} ` +
              `next=${describe(next)}`,
          );
          // A server that does not understand AdjacentTo answers without the
          // current episode; the season list still names the next one.
          if (!next && seasonId && !hasCurrent) {
            const seasonEpisodes = await getEpisodes(
              serverUrl,
              accessToken,
              userId,
              seriesId,
              seasonId,
            );
            next = resolveNextEpisode(seasonEpisodes, current);
            trace(
              'nextEpisode.season',
              `candidates=${seasonEpisodes.length} next=${describe(next)}`,
            );
          }
          if (mounted) {
            setNextEpisode(next);
          }
        })
        .catch((error) => {
          trace(
            'nextEpisode',
            `error ${error instanceof Error ? error.message : String(error)}`,
          );
          console.warn('[Astra] Unable to resolve the next episode:', error);
        });
    } else {
      trace(
        'nextEpisode',
        `skipped type=${itemType} series=${Boolean(seriesId)} user=${Boolean(
          userId,
        )}`,
      );
    }

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, itemId, itemType, seasonId, seriesId, serverUrl, userId]);

  useEffect(() => {
    let cancelled = false;
    const subtitleTrack = currentStream?.subtitleTracks.find(
      (track) =>
        track.index === selectedSubtitleTrackIndex &&
        track.deliveryUrl &&
        !track.burnInRequired,
    );

    setExternalSubtitleCues([]);
    if (!subtitleTrack?.deliveryUrl) {
      return () => {
        cancelled = true;
      };
    }

    fetch(subtitleTrack.deliveryUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Subtitle request failed (${response.status})`);
        }
        return response.text();
      })
      .then((body) => {
        if (!cancelled) {
          const cues = parseWebVtt(body);
          console.info('[Astra] Loaded external subtitle cues:', cues.length);
          setExternalSubtitleCues(cues);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn('[Astra] Unable to load external subtitles:', error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentStream, selectedSubtitleTrackIndex]);

  const activeSubtitleText = useMemo(
    () => activeWebVttText(externalSubtitleCues, positionSeconds),
    [externalSubtitleCues, positionSeconds],
  );

  const currentPositionTicks = useCallback(() => {
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

  const clearControlsHideTimer = useCallback(() => {
    if (controlsHideTimer.current) {
      clearTimeout(controlsHideTimer.current);
      controlsHideTimer.current = null;
    }
  }, []);

  const scheduleControlsHide = useCallback(() => {
    clearControlsHideTimer();
    controlsHideTimer.current = setTimeout(() => {
      const video = videoRef.current;
      if (!video || unmountedRef.current) {
        return;
      }
      if (!video.paused) {
        setShowControls(false);
      }
    }, CONTROL_HIDE_DELAY_MS);
  }, [clearControlsHideTimer]);

  const revealControls = useCallback(
    (autoHide = true) => {
      setShowControls(true);
      if (autoHide) {
        scheduleControlsHide();
      } else {
        clearControlsHideTimer();
      }
    },
    [clearControlsHideTimer, scheduleControlsHide],
  );

  const applyPendingInitialSeek = useCallback((video: VideoPlayer) => {
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
        setPositionSeconds(clampedTarget);
        setStatusText(
          `Resumed at ${Math.floor(clampedTarget / 60)}:${String(
            Math.floor(clampedTarget % 60),
          ).padStart(2, '0')}`,
        );
      } catch (error) {
        console.warn('Failed to apply resume position', error);
        setStatusText('Playing from start');
      }
    }, 250);
  }, []);

  const reportStopped = useCallback(async () => {
    const stream = streamInfo.current;
    if (stoppedReported.current || !stream) {
      return;
    }

    stoppedReported.current = true;
    await reportPlaybackStopped(serverUrl, accessToken, {
      ...stream,
      audioStreamIndex: selectedAudioIndex.current,
      positionTicks: currentPositionTicks(),
      subtitleStreamIndex: selectedSubtitleIndex.current,
    });
  }, [accessToken, currentPositionTicks, serverUrl]);

  const retryStartup = useCallback(() => {
    const handle = surfaceHandle.current;

    if (!handle) {
      return;
    }

    setStartupError(null);
    setStarting(true);
    onSurfaceViewCreatedRef.current?.(handle);
  }, []);

  const handleBack = useCallback(() => {
    reportStopped().finally(() => {
      onBack?.();
    });
  }, [onBack, reportStopped]);

  const seekToSeconds = useCallback(
    async (targetSeconds: number, closeSettings = false) => {
      const video = videoRef.current;

      if (!video) {
        return;
      }

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
        duration > 0 ? Math.min(duration, targetSeconds) : targetSeconds,
      );
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
      const seekableVideo = video as VideoPlayer & {
        fastSeek?: (time: number) => void;
      };

      if (typeof seekableVideo.fastSeek === 'function') {
        seekableVideo.fastSeek(clampedMediaTarget);
      } else {
        video.currentTime = clampedMediaTarget;
      }
      console.info('[Astra] Seek applied:', {
        dispatchMs: Date.now() - requestedAtMs,
        fromSeconds: Math.round(fromSeconds * 1000) / 1000,
        mediaTargetSeconds: Math.round(clampedMediaTarget * 1000) / 1000,
        targetSeconds: Math.round(target * 1000) / 1000,
      });

      const positionTicks = toTicks(target);
      latestPositionTicks.current = positionTicks;
      setPositionSeconds(target);

      if (video.paused) {
        video.play();
        setPaused(false);
      }

      if (closeSettings) {
        setSettingsPanel(null);
      }
      scheduleControlsHide();
      setStatusText(
        `Jumped to ${Math.floor(target / 60)}:${String(
          Math.floor(target % 60),
        ).padStart(2, '0')}`,
      );

      if (streamInfo.current) {
        reportPlaybackProgress(serverUrl, accessToken, {
          ...streamInfo.current,
          audioStreamIndex: selectedAudioIndex.current,
          isPaused: false,
          positionTicks,
          subtitleStreamIndex: selectedSubtitleIndex.current,
        }).catch((error) => {
          console.warn('Failed to report seek position', error);
        });
      }
    },
    [accessToken, item.runTimeTicks, scheduleControlsHide, serverUrl],
  );

  const seek = useCallback(
    async (seconds: number) => {
      const video = videoRef.current;

      if (!video || typeof video.currentTime !== 'number') {
        return;
      }

      await seekToSeconds(
        mediaToLogicalTime(
          video.currentTime,
          mediaTimelineOffsetSeconds.current,
        ) + seconds,
      );
    },
    [seekToSeconds],
  );

  const jumpChapter = useCallback(
    async (direction: 1 | -1) => {
      const video = videoRef.current;

      if (!video || typeof video.currentTime !== 'number') {
        return;
      }

      const duration =
        typeof video.duration === 'number' &&
        Number.isFinite(video.duration) &&
        video.duration > 0
          ? video.duration
          : (streamInfo.current?.runTimeTicks ?? item.runTimeTicks ?? 0) /
            TICKS_PER_SECOND;

      if (duration <= 0) {
        await seek(direction * preferredSeekSeconds);
        return;
      }

      const realChapters = (item.chapters ?? [])
        .map((chapter) => chapter.startPositionTicks / TICKS_PER_SECOND)
        .filter((seconds) => seconds >= 0 && seconds < duration)
        .sort((a, b) => a - b);
      const boundaries =
        realChapters.length >= 2
          ? realChapters
          : Array.from(
              {length: SYNTHETIC_CHAPTER_COUNT},
              (_, index) => (duration * index) / SYNTHETIC_CHAPTER_COUNT,
            );
      const current = mediaToLogicalTime(
        video.currentTime,
        mediaTimelineOffsetSeconds.current,
      );
      // Backward uses a small grace window so a quick double-press crosses
      // into the previous chapter instead of re-snapping to the current one.
      const target =
        direction > 0
          ? boundaries.find((seconds) => seconds > current + 2)
          : [...boundaries].reverse().find((seconds) => seconds < current - 3);

      if (target === undefined) {
        if (direction < 0) {
          await seekToSeconds(0);
        }
        // Already in the last chapter: do nothing rather than jump to the
        // end and accidentally finish the movie.
        return;
      }

      const reloadAtSeconds = reloadAtSecondsRef.current;
      if (
        reloadAtSeconds &&
        Math.abs(target - current) >= RELOAD_JUMP_THRESHOLD_SECONDS
      ) {
        await reloadAtSeconds(target);
        return;
      }

      await seekToSeconds(target);
    },
    [item, preferredSeekSeconds, seek, seekToSeconds],
  );

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

  // Releases this player's media resources the way the unmount cleanup does,
  // but awaited: the next PlayerScreen must not construct its VideoPlayer
  // while this one's surface and Shaka instance are still being torn down.
  const releaseForHandoff = useCallback(async () => {
    const handle = surfaceHandle.current;
    const video = videoRef.current;
    const shakaPlayer = shakaPlayerRef.current;

    // Late events from the released element must not reach this screen.
    playbackGeneration.current += 1;
    videoRef.current = null;
    shakaPlayerRef.current = null;
    clearControlsHideTimer();
    if (initialSeekTimer.current) {
      clearTimeout(initialSeekTimer.current);
      initialSeekTimer.current = null;
    }

    try {
      await reportStopped();
    } catch (error) {
      console.warn(
        '[Astra] Failed to report stopped before next episode:',
        error,
      );
    }
    streamInfo.current = null;

    try {
      video?.pause();
    } catch (error) {
      console.warn('[Astra] Failed to pause before next episode:', error);
    }
    try {
      await shakaPlayer?.unload();
    } catch (error) {
      console.warn(
        '[Astra] Failed to unload player before next episode:',
        error,
      );
    }
    try {
      if (handle) {
        video?.clearSurfaceHandle(handle);
      }
      await video?.deinitialize();
    } catch (error) {
      console.warn(
        '[Astra] Failed to release video before next episode:',
        error,
      );
    }
  }, [clearControlsHideTimer, reportStopped]);

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
      setStatusText('Starting next episode...');

      try {
        await releaseForHandoff();
        trace('handoff.released', 'media released');
      } catch (error) {
        trace('handoff.released', 'release failed');
        console.warn(
          '[Astra] Failed to release the player for handoff:',
          error,
        );
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

  // Runs once per player generation when the stream ends. Movies finish;
  // an episode with a known successor counts down or asks, per the decision
  // rules in services/episodePlayback.
  endedHandler.current = () => {
    setCreditsPrompt(null);
    const action = decideEndOfPlayback({
      autoplayEnabled: episodePreferences.current.nextEpisodeAutoplay,
      consecutiveAutoAdvances,
      hasNextEpisode: Boolean(nextEpisode && onPlayNext),
      itemType: item.type,
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
  }, [creditsWindow, endPrompt, isStarting, positionSeconds, skipCredits]);

  const togglePlayPause = useCallback(() => {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    if (video.paused) {
      video.play();
      setPaused(false);
    } else {
      video.pause();
      setPaused(true);
    }
  }, []);

  const unloadAdaptivePlayer = useCallback(async () => {
    await unloadPlayer(shakaPlayerRef);
  }, []);

  const loadVideoSource = useCallback(
    async (
      video: VideoPlayer,
      stream: JellyfinStreamInfo,
      startTimeSeconds?: number,
    ) => {
      if (!isAdaptiveStream(stream.url)) {
        pendingAdaptiveResumeSeconds.current = null;
        mediaTimelineOffsetSeconds.current = 0;
        await unloadAdaptivePlayer();
        video.src = stream.url;
        video.load();
        return;
      }

      const {ShakaPlayer} = await import(
        '../../w3cmedia/shakaplayer/ShakaPlayer'
      );
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
      const settings = {
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
      };

      await unloadAdaptivePlayer();
      pendingAdaptiveResumeSeconds.current =
        startTimeSeconds && startTimeSeconds > 0 ? startTimeSeconds : null;
      mediaTimelineOffsetSeconds.current = 0;
      const shakaPlayer = new ShakaPlayer(video, settings);
      shakaPlayerRef.current = shakaPlayer;
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
      } catch (error) {
        // Shaka rejects with shaka.util.Error, which is not an Error
        // instance — without this it surfaces as a blank "Unable to start
        // playback" with no diagnostic trail.
        const shakaError = error as {
          code?: number;
          category?: number;
          severity?: number;
          data?: unknown[];
        };
        console.error(
          '[Astra] Shaka load failed:',
          'code:',
          shakaError?.code,
          'category:',
          shakaError?.category,
          'severity:',
          shakaError?.severity,
          'data:',
          JSON.stringify(shakaError?.data ?? []).slice(0, 500),
        );
        throw error instanceof Error
          ? error
          : new Error(
              `Stream engine error ${shakaError?.code ?? 'unknown'} (category ${
                shakaError?.category ?? '?'
              })`,
            );
      }
    },
    [unloadAdaptivePlayer],
  );

  const attachPlaybackEvents = useCallback(
    (video: VideoPlayer, generation: number) => {
      const isCurrentPlayer = () => playbackGeneration.current === generation;
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

      video.addEventListener('playing', () => {
        if (!isCurrentPlayer()) {
          return;
        }
        recordPlaybackEvent('playing');
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
          setPositionSeconds(resumeTarget);
          console.info('[Astra] Calibrated server-positioned HLS timeline:', {
            logicalStartSeconds: resumeTarget,
            mediaStartSeconds: video.currentTime,
            timelineOffsetSeconds: mediaTimelineOffsetSeconds.current,
          });
        }
        setPaused(false);
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
          `Playing (${
            streamInfo.current?.playMethod ?? 'stream'
          }${resolution})`,
        );
        scheduleControlsHide();
      });
      video.addEventListener('pause', () => {
        if (!isCurrentPlayer()) {
          return;
        }
        recordPlaybackEvent('pause');
        setPaused(true);
        revealControls(false);
      });
      video.addEventListener('loadedmetadata', () => {
        if (!isCurrentPlayer()) {
          return;
        }
        recordPlaybackEvent('loadedmetadata');
        setStatusText('Stream loaded');
        applyPendingInitialSeek(video);
      });
      video.addEventListener('canplay', () => {
        if (!isCurrentPlayer()) {
          return;
        }
        recordPlaybackEvent('canplay');
        setStatusText('Ready to play');
        applyPendingInitialSeek(video);
      });
      video.addEventListener('waiting', () => {
        if (!isCurrentPlayer()) {
          return;
        }
        recordPlaybackEvent('waiting', 'waitingEventCount');
        revealControls(false);
        setStatusText('Buffering...');
      });
      video.addEventListener('stalled', () => {
        if (!isCurrentPlayer()) {
          return;
        }
        recordPlaybackEvent('stalled', 'stalledEventCount');
        revealControls(false);
        setStatusText('Playback stalled. Buffering...');
      });
      video.addEventListener('timeupdate', () => {
        if (!isCurrentPlayer()) {
          return;
        }
        if (typeof video.currentTime === 'number') {
          const logicalTime =
            pendingAdaptiveResumeSeconds.current ??
            mediaToLogicalTime(
              video.currentTime,
              mediaTimelineOffsetSeconds.current,
            );
          latestPositionTicks.current = toTicks(logicalTime);
          setPositionSeconds(logicalTime);
        }
      });
      video.addEventListener('error', () => {
        if (!isCurrentPlayer()) {
          return;
        }
        recordPlaybackEvent('error', 'errorEventCount');
        revealControls(false);
        playbackErrorHandler.current();
      });
      video.addEventListener('ended', () => {
        if (!isCurrentPlayer()) {
          return;
        }
        recordPlaybackEvent('ended');
        revealControls(false);
        setStatusText('Finished');
        if (endedHandledForGeneration.current === generation) {
          return;
        }
        endedHandledForGeneration.current = generation;
        endedHandler.current();
      });
    },
    [applyPendingInitialSeek, revealControls, scheduleControlsHide],
  );

  const createFreshVideoPlayer = useCallback(async () => {
    const handle = surfaceHandle.current;
    if (!handle) {
      throw new Error('Video surface is unavailable.');
    }

    const oldVideo = videoRef.current;
    const generation = playbackGeneration.current + 1;
    playbackGeneration.current = generation;
    videoRef.current = null;
    // A replaced player is a new playback session: no countdown from the
    // old one may carry over.
    cancelCountdown();
    setEndPrompt(null);

    try {
      oldVideo?.pause();
    } catch (error) {
      console.warn('[Astra] Failed to pause replaced video player:', error);
    }

    await unloadAdaptivePlayer();

    if (oldVideo) {
      try {
        oldVideo.clearSurfaceHandle(handle);
      } catch (error) {
        console.warn('[Astra] Failed to detach replaced video surface:', error);
      }
      await oldVideo.deinitialize();
    }

    if (surfaceHandle.current !== handle) {
      throw new Error('Video surface was removed during stream replacement.');
    }

    const video = new VideoPlayer();
    videoRef.current = video;
    try {
      await video.setMediaControlFocus(
        keplerAppStateManager.getComponentInstance(),
      );
    } catch (mediaControlError) {
      console.warn(
        '[Astra] Failed to enable Vega Media Controls:',
        mediaControlError,
      );
    }
    await video.initialize();
    attachPlaybackEvents(video, generation);
    video.setSurfaceHandle(handle);
    video.autoplay = false;
    video.defaultSeekIntervalInSec = preferredSeekSeconds;
    video.playbackRate = playbackRate;

    return video;
  }, [
    attachPlaybackEvents,
    cancelCountdown,
    keplerAppStateManager,
    playbackRate,
    preferredSeekSeconds,
    unloadAdaptivePlayer,
  ]);

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
    async (startTicks = latestPositionTicks.current) => {
      const sourceVideoStream = item.mediaStreams?.find(
        (track) => track.type === 'Video',
      );
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
          forceTranscode: selectedForceTranscode.current,
          maxStreamingBitrate: selectedBitrate.current ?? preferredMaxBitrate,
          // On a reload the server has already named its source; reusing that
          // id keeps a track change pointed at the same one.
          mediaSourceId: streamInfo.current?.mediaSourceId,
          sourceHeight: sourceVideoStream?.height,
          sourceWidth: sourceVideoStream?.width,
          subtitleSelectionIsManual: subtitleSelectionPinned.current,
          subtitleStreamIndex: selectedSubtitleIndex.current,
        },
      );
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
      if (selectedSubtitleBurnIn.current) {
        selectedForceTranscode.current = true;
      }
      subtitleSelectionPinned.current = true;
      setPositionSeconds(startTicks / TICKS_PER_SECOND);
      setStatusText(
        stream.playMethod === 'Transcode'
          ? isAdaptiveStream(stream.url)
            ? 'Loading HLS transcode...'
            : 'Loading transcoded MP4 stream...'
          : 'Loading direct stream...',
      );
      assertPlayableUrl(stream.url);

      return stream;
    },
    [
      accessToken,
      item.id,
      item.mediaStreams,
      preferredMaxBitrate,
      serverUrl,
      userId,
    ],
  );

  const reloadWithTrack = useCallback(
    async ({
      audioTrack,
      bitrate,
      forceTranscode,
      subtitleTrack,
    }: {
      audioTrack?: JellyfinMediaTrack;
      bitrate?: number | null;
      forceTranscode?: boolean;
      subtitleTrack?: JellyfinMediaTrack | null;
    }) => {
      if (trackReloadInProgress.current) {
        return;
      }

      if (
        audioTrack?.index !== undefined &&
        audioTrack.index === selectedAudioIndex.current &&
        bitrate === undefined &&
        forceTranscode === undefined &&
        subtitleTrack === undefined
      ) {
        setSettingsPanel(null);
        return;
      }

      trackReloadInProgress.current = true;
      const positionTicks = currentPositionTicks();
      trace(
        'reload.start',
        `positionSeconds=${(positionTicks / TICKS_PER_SECOND).toFixed(1)} ` +
          `subtitle=${
            subtitleTrack === undefined
              ? 'unchanged'
              : subtitleTrack?.index ?? 'off'
          } ` +
          `burnIn=${subtitleTrack?.burnInRequired ?? 'n/a'}`,
      );
      const replacedStream = streamInfo.current;
      const replacedAudioIndex = selectedAudioIndex.current;
      const replacedSubtitleIndex = selectedSubtitleIndex.current;
      setSettingsPanel(null);
      setStatusText('Switching track...');
      videoRef.current?.pause();
      setPaused(true);

      selectedAudioIndex.current =
        audioTrack?.index ?? selectedAudioIndex.current;
      if (audioTrack?.index !== undefined) {
        playbackRecoveryAttempt.current = 0;
        selectedAllowAudioStreamCopy.current = true;
        setSelectedAudioTrackIndex(audioTrack.index);
      }
      if (bitrate !== undefined) {
        selectedBitrate.current = bitrate ?? undefined;
      }
      if (forceTranscode !== undefined) {
        selectedForceTranscode.current = forceTranscode;
      }
      selectedSubtitleIndex.current =
        subtitleTrack === null
          ? undefined
          : subtitleTrack?.index ?? selectedSubtitleIndex.current;
      if (subtitleTrack === null || subtitleTrack?.index !== undefined) {
        subtitleSelectionPinned.current = true;
        setSelectedSubtitleTrackIndex(subtitleTrack?.index);
      }
      selectedSubtitleBurnIn.current =
        subtitleTrack === null ? false : Boolean(subtitleTrack?.burnInRequired);
      if (selectedSubtitleBurnIn.current) {
        selectedForceTranscode.current = true;
      }
      try {
        // Treat a track change as the end of one playback session and the
        // beginning of another. Reusing the Vega media element leaves its
        // old audio/video SourceBuffers alive and eventually deadlocks the
        // new HLS timeline.
        stoppedReported.current = true;
        if (replacedStream) {
          try {
            await reportPlaybackStopped(serverUrl, accessToken, {
              ...replacedStream,
              audioStreamIndex: replacedAudioIndex,
              positionTicks,
              subtitleStreamIndex: replacedSubtitleIndex,
            });
          } catch (error) {
            console.warn(
              '[Astra] Failed to close replaced playback session:',
              error,
            );
          }
        }

        const video = await createFreshVideoPlayer();
        setStatusText('Requesting selected track...');
        const stream = await loadStream(positionTicks);
        pendingInitialSeekSeconds.current = null;
        initialSeekApplied.current = true;
        addSelectedSubtitleTrack(video, stream);
        await loadVideoSource(video, stream, positionTicks / TICKS_PER_SECOND);
        stoppedReported.current = false;

        await reportPlaybackStart(serverUrl, accessToken, {
          ...stream,
          audioStreamIndex: selectedAudioIndex.current,
          isPaused: false,
          positionTicks,
          subtitleStreamIndex: selectedSubtitleIndex.current,
        });
        video.play();
        setPaused(false);
        scheduleControlsHide();
        setStatusText('Starting selected track...');
      } catch (error) {
        console.error('[Astra] Failed to switch playback track:', error);
        setStatusText(
          error instanceof Error
            ? `Unable to switch track: ${error.message}`
            : 'Unable to switch playback track.',
        );
      } finally {
        trackReloadInProgress.current = false;
      }
    },
    [
      accessToken,
      addSelectedSubtitleTrack,
      createFreshVideoPlayer,
      currentPositionTicks,
      loadVideoSource,
      loadStream,
      scheduleControlsHide,
      serverUrl,
    ],
  );

  // Reloads the stream positioned at a target, leaving track selections alone.
  //
  // Deliberately mirrors reloadWithTrack rather than refactoring it: that path
  // is the one proven on hardware for track changes, and this runs on a
  // different trigger. Keeping them separate means a problem here cannot break
  // audio or subtitle switching.
  reloadAtSecondsRef.current = async (targetSeconds: number) => {
    if (trackReloadInProgress.current) {
      return;
    }
    trackReloadInProgress.current = true;

    const runTimeSeconds =
      (streamInfo.current?.runTimeTicks ?? item.runTimeTicks ?? 0) /
      TICKS_PER_SECOND;
    const clamped = Math.max(
      0,
      runTimeSeconds > 0
        ? Math.min(runTimeSeconds - 1, targetSeconds)
        : targetSeconds,
    );
    const targetTicks = toTicks(clamped);

    const replacedStream = streamInfo.current;
    const replacedPositionTicks = currentPositionTicks();
    trace('jump.reload.start', `toSeconds=${clamped.toFixed(1)}`);

    videoRef.current?.pause();
    setPaused(true);
    setStatusText('Jumping...');

    try {
      // A repositioning reload ends one playback session and starts another,
      // exactly as a track change does. Reusing the Vega media element leaves
      // its old SourceBuffers alive and eventually deadlocks the new timeline.
      stoppedReported.current = true;
      if (replacedStream) {
        try {
          await reportPlaybackStopped(serverUrl, accessToken, {
            ...replacedStream,
            audioStreamIndex: selectedAudioIndex.current,
            positionTicks: replacedPositionTicks,
            subtitleStreamIndex: selectedSubtitleIndex.current,
          });
        } catch (error) {
          console.warn(
            '[Astra] Failed to close playback session before jump:',
            error,
          );
        }
      }

      const video = await createFreshVideoPlayer();
      const stream = await loadStream(targetTicks);
      pendingInitialSeekSeconds.current = null;
      initialSeekApplied.current = true;
      addSelectedSubtitleTrack(video, stream);
      await loadVideoSource(video, stream, clamped);
      stoppedReported.current = false;

      latestPositionTicks.current = targetTicks;
      setPositionSeconds(clamped);

      await reportPlaybackStart(serverUrl, accessToken, {
        ...stream,
        audioStreamIndex: selectedAudioIndex.current,
        isPaused: false,
        positionTicks: targetTicks,
        subtitleStreamIndex: selectedSubtitleIndex.current,
      });
      video.play();
      setPaused(false);
      scheduleControlsHide();
      setStatusText('');
      trace('jump.reload.done', `atSeconds=${clamped.toFixed(1)}`);
    } catch (error) {
      console.error('[Astra] Failed to jump by reloading:', error);
      setStatusText(
        error instanceof Error
          ? `Unable to jump: ${error.message}`
          : 'Unable to jump.',
      );
    } finally {
      trackReloadInProgress.current = false;
    }
  };

  playbackErrorHandler.current = () => {
    const recovery = getNextPlaybackRecovery({
      attempt: playbackRecoveryAttempt.current,
      audioDeliveryMethod: streamInfo.current?.audioDeliveryMethod,
    });

    if (!recovery) {
      setStatusText('Playback failed. Open settings and try another quality.');
      return;
    }

    playbackRecoveryAttempt.current = recovery.nextAttempt;
    if (recovery.disableAudioStreamCopy) {
      selectedAllowAudioStreamCopy.current = false;
    }
    if (recovery.forceVideoTranscode) {
      selectedForceTranscode.current = true;
    }
    // Never silently lower the user's configured quality during recovery.
    // The old 8 Mbps cap converted healthy 4K HEVC into 1080p after an audio
    // decoder failure. Jellyfin can convert only the incompatible stream.
    setStatusText(recovery.statusText);
    const positionTicks = currentPositionTicks();
    loadStream(positionTicks)
      .then((stream) => {
        const video = videoRef.current;

        if (video) {
          video.pause();
          addSelectedSubtitleTrack(video, stream);
          return loadVideoSource(
            video,
            stream,
            positionTicks / TICKS_PER_SECOND,
          ).then(() => {
            video.play();
            setPaused(false);
            scheduleControlsHide();
            setStatusText('Starting video...');
            return reportPlaybackProgress(serverUrl, accessToken, {
              ...stream,
              audioStreamIndex: selectedAudioIndex.current,
              isPaused: false,
              positionTicks,
              subtitleStreamIndex: selectedSubtitleIndex.current,
            });
          });
        }

        return reportPlaybackProgress(serverUrl, accessToken, {
          ...stream,
          audioStreamIndex: selectedAudioIndex.current,
          isPaused: false,
          positionTicks,
          subtitleStreamIndex: selectedSubtitleIndex.current,
        });
      })
      .catch((error) => {
        setStatusText(
          error instanceof Error ? error.message : 'Playback retry failed.',
        );
      });
  };

  useTVEventHandler((event) => {
    const now = Date.now();
    // Vega delivers both key phases of one physical press (down + up, and
    // for some keys a separate "_up" event type). Deduplicate on the
    // normalized event type alone so a single press is a single command —
    // keying on eventKeyAction made select/menu/back fire twice.
    const key = (event.eventType ?? '').replace(/_up$/, '');

    if (
      lastHandledKeyEvent.current.type === key &&
      now - lastHandledKeyEvent.current.time < 350
    ) {
      return;
    }
    lastHandledKeyEvent.current = {time: now, type: key};

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
      setStatusText('Finished');
      return;
    }
    if (key === 'back' && creditsPrompt) {
      dismissCreditsPrompt(creditsPrompt);
      return;
    }
    if (endPrompt && (key === 'menu' || key === 'context_menu')) {
      return;
    }
    if (creditsPrompt && (key === 'menu' || key === 'context_menu')) {
      dismissCreditsPrompt(creditsPrompt);
    }

    // Back dismisses one layer at a time and must not reveal the controls
    // it is about to dismiss.
    if (key !== 'back') {
      revealControls(
        !settingsPanel && !showExitConfirm && !creditsPrompt && !endPrompt,
      );
    }

    // Focusable controls own their Select and directional events while a
    // modal is open. The global playback handler must not also pause, seek,
    // or commit a second action for the key-up phase of the same click.
    if (
      (settingsPanel || showExitConfirm || creditsPrompt || endPrompt) &&
      key !== 'back' &&
      key !== 'menu' &&
      key !== 'context_menu'
    ) {
      return;
    }

    switch (key) {
      case 'back':
        if (settingsPanel) {
          setSettingsPanel(null);
        } else if (showExitConfirm) {
          setShowExitConfirm(false);
        } else if (showControls) {
          clearControlsHideTimer();
          setShowControls(false);
        } else {
          setShowExitConfirm(true);
        }
        break;
      case 'menu':
      case 'context_menu':
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
      case 'right':
        seek(preferredSeekSeconds);
        break;
      case 'forward':
      case 'skip_forward':
        jumpChapter(1);
        break;
      case 'left':
        seek(-preferredSeekSeconds);
        break;
      case 'rewind':
      case 'skip_backward':
        jumpChapter(-1);
        break;
    }
  });

  useEffect(() => {
    unmountedRef.current = false;

    return () => {
      const handle = surfaceHandle.current;
      const video = videoRef.current;
      const shakaPlayer = shakaPlayerRef.current;
      const stoppedPromise = reportStopped();

      unmountedRef.current = true;
      cancelCountdown();
      clearControlsHideTimer();
      surfaceHandle.current = null;
      videoRef.current = null;
      shakaPlayerRef.current = null;
      streamInfo.current = null;
      if (initialSeekTimer.current) {
        clearTimeout(initialSeekTimer.current);
        initialSeekTimer.current = null;
      }

      stoppedPromise
        .catch((error) => {
          console.warn('[Astra] Failed to report stopped playback:', error);
        })
        .finally(async () => {
          try {
            await shakaPlayer?.unload();
          } catch (error) {
            console.warn('[Astra] Failed to unload player during exit:', error);
          } finally {
            if (handle) {
              video?.clearSurfaceHandle(handle);
            }
            await video?.deinitialize();
          }
        });
    };
  }, [cancelCountdown, clearControlsHideTimer, reportStopped]);

  useEffect(() => {
    const subscription = keplerAppStateManager.addAppStateListener(
      'change',
      (nextState) => {
        console.log('[Astra] Player app state changed:', nextState);

        if (nextState === 'background' || nextState === 'inactive') {
          const video = videoRef.current;
          if (video && !video.paused) {
            video.pause();
            setPaused(true);
          }

          const stream = streamInfo.current;
          if (stream) {
            reportPlaybackProgress(serverUrl, accessToken, {
              ...stream,
              audioStreamIndex: selectedAudioIndex.current,
              isPaused: true,
              positionTicks: currentPositionTicks(),
              subtitleStreamIndex: selectedSubtitleIndex.current,
            }).catch((error) => {
              console.warn(
                'Failed to report background playback progress',
                error,
              );
            });
          }
        }
      },
    );

    return () => subscription.remove();
  }, [accessToken, currentPositionTicks, keplerAppStateManager, serverUrl]);

  useEffect(() => {
    const interval = setInterval(() => {
      const video = videoRef.current;
      const stream = streamInfo.current;
      if (!video || !stream || unmountedRef.current) {
        return;
      }

      const currentTime = video.currentTime;
      if (typeof currentTime === 'number') {
        setPositionSeconds(
          pendingAdaptiveResumeSeconds.current ??
            mediaToLogicalTime(currentTime, mediaTimelineOffsetSeconds.current),
        );
      }

      reportPlaybackProgress(serverUrl, accessToken, {
        ...stream,
        audioStreamIndex: selectedAudioIndex.current,
        isPaused: isPausedRef.current,
        positionTicks: currentPositionTicks(),
        subtitleStreamIndex: selectedSubtitleIndex.current,
      }).catch((error) => {
        console.warn('Failed to report playback progress', error);
      });
    }, 3000);

    return () => clearInterval(interval);
  }, [accessToken, currentPositionTicks, serverUrl]);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    if (!showPlaybackStats) {
      setPlaybackDebugInfo(null);
      return;
    }

    const updateStats = () => {
      const shakaPlayer = shakaPlayerRef.current;
      const video = videoRef.current;
      if (!shakaPlayer || !video || unmountedRef.current) {
        return;
      }

      const diagnostics = shakaPlayer.getDebugStats() as
        | {
            activeVariant?: {
              height?: number | null;
              width?: number | null;
            };
            buffered?: {
              total?: Array<{end: number; start: number}>;
            };
            stats?: Record<string, number>;
          }
        | undefined;
      const currentTime = video.currentTime ?? 0;
      const bufferedRanges = diagnostics?.buffered?.total
        ? [...diagnostics.buffered.total]
        : [];
      const currentRange = bufferedRanges.find(
        (range) =>
          range.end >= currentTime && range.start <= currentTime + 0.25,
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

      setPlaybackDebugInfo({
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
        decodedFrames: nativeVideoFrames?.totalVideoFrames,
        droppedFrames: nativeVideoFrames?.droppedVideoFrames,
        estimatedBandwidth: stats?.estimatedBandwidth,
        furthestBufferedAheadSeconds:
          furthestBufferedEnd > currentTime
            ? furthestBufferedEnd - currentTime
            : undefined,
        nextBufferedGapSeconds:
          currentRange && nextRange
            ? Math.max(0, nextRange.start - currentRange.end)
            : undefined,
        streamBandwidth: stats?.streamBandwidth,
        ...playbackEventDiagnostics.current,
      });
    };

    updateStats();
    const interval = setInterval(updateStats, 1000);
    return () => clearInterval(interval);
  }, [showPlaybackStats]);

  const onSurfaceViewCreated = useCallback(
    async (handle: string) => {
      surfaceHandle.current = handle;
      const startTicks = item.resumePositionTicks ?? 0;
      const startSeconds = startTicks / TICKS_PER_SECOND;
      // Traces are per playback session: without this the overlay keeps the
      // previous title's timings and its T+ origin, which is misleading after
      // moving between titles.
      resetTraces();

      try {
        setStarting(true);
        setStartupError(null);
        setStatusText('Preparing playback...');
        const video = await createFreshVideoPlayer();

        const stream = await loadStream(startTicks);

        if (isAdaptiveStream(stream.url)) {
          pendingInitialSeekSeconds.current = null;
          initialSeekApplied.current = true;
        } else {
          pendingInitialSeekSeconds.current =
            startSeconds > 0 ? startSeconds : null;
          initialSeekApplied.current = false;
        }
        addSelectedSubtitleTrack(video, stream);
        await loadVideoSource(video, stream, startSeconds);
        video.play();
        setPaused(false);
        setStarting(false);
        scheduleControlsHide();
        setStatusText('Starting video...');

        await reportPlaybackStart(serverUrl, accessToken, {
          ...stream,
          audioStreamIndex: selectedAudioIndex.current,
          positionTicks: startTicks,
          isPaused: false,
          subtitleStreamIndex: selectedSubtitleIndex.current,
        });
      } catch (error) {
        console.warn('[Astra] Unable to start playback:', error);
        setStarting(false);
        setStartupError(
          error instanceof Error ? error.message : 'Unable to start playback.',
        );
        setStatusText(
          error instanceof Error ? error.message : 'Unable to start playback.',
        );
      }
    },
    [
      accessToken,
      addSelectedSubtitleTrack,
      createFreshVideoPlayer,
      item.resumePositionTicks,
      loadVideoSource,
      loadStream,
      scheduleControlsHide,
      serverUrl,
    ],
  );

  onSurfaceViewCreatedRef.current = onSurfaceViewCreated;

  const onSurfaceViewDestroyed = useCallback(
    (handle: string) => {
      const video = videoRef.current;
      const shakaPlayer = shakaPlayerRef.current;
      const stoppedPromise = reportStopped();

      surfaceHandle.current = null;
      videoRef.current = null;
      shakaPlayerRef.current = null;
      streamInfo.current = null;
      cancelCountdown();
      clearControlsHideTimer();
      if (initialSeekTimer.current) {
        clearTimeout(initialSeekTimer.current);
        initialSeekTimer.current = null;
      }
      stoppedPromise
        .finally(async () => {
          try {
            await shakaPlayer?.unload();
          } catch (error) {
            console.warn(
              '[Astra] Failed to unload player after surface removal:',
              error,
            );
          } finally {
            video?.clearSurfaceHandle(handle);
            await video?.deinitialize();
          }
        })
        .catch((error) => {
          console.warn('[Astra] Failed to tear down video surface:', error);
        });
    },
    [cancelCountdown, clearControlsHideTimer, reportStopped],
  );

  const durationSeconds =
    typeof videoRef.current?.duration === 'number' &&
    videoRef.current.duration > 0
      ? videoRef.current.duration
      : (currentStream?.runTimeTicks ?? item.runTimeTicks ?? 0) /
        TICKS_PER_SECOND;
  const progressPercent =
    durationSeconds > 0
      ? `${Math.min(
          100,
          Math.max(0, (positionSeconds / durationSeconds) * 100),
        )}%`
      : '0%';
  const progressWidth = progressPercent as `${number}%`;
  const controlsVisible =
    showControls || Boolean(settingsPanel) || showExitConfirm;
  const startupItemLabel =
    item.type === 'Episode'
      ? 'episode'
      : item.type === 'Movie'
      ? 'movie'
      : 'item';

  return (
    <View style={styles.screen} testID="player-screen">
      <KeplerVideoSurfaceView
        onSurfaceViewCreated={onSurfaceViewCreated}
        onSurfaceViewDestroyed={onSurfaceViewDestroyed}
        scalingmode="fit"
        style={styles.videoSurface}
        testID="player-video-surface"
      />
      {activeSubtitleText ? (
        <View
          pointerEvents="none"
          style={styles.subtitleOverlay}
          testID="player-external-subtitle">
          <Text style={styles.subtitleText}>{activeSubtitleText}</Text>
        </View>
      ) : null}
      {isStarting || startupError ? (
        <View style={styles.startupOverlay} testID="player-startup-state">
          <Text numberOfLines={1} style={styles.startupTitle}>
            {item.name}
          </Text>
          {isStarting ? (
            <View style={styles.startupRow}>
              <ActivityIndicator color="#4CC9F0" size="large" />
              <Text style={styles.startupText}>Starting playback...</Text>
            </View>
          ) : (
            <>
              <Text style={styles.startupText}>
                Couldn't start this {startupItemLabel}.
              </Text>
              <Text style={styles.startupDetail}>{startupError}</Text>
              <View style={styles.startupButtons}>
                <FocusableItem
                  focusedStyle={styles.focusedButton}
                  hasTVPreferredFocus={true}
                  onPress={retryStartup}
                  style={styles.button}
                  testID="player-startup-retry">
                  <Text style={styles.buttonText}>Retry</Text>
                </FocusableItem>
                <FocusableItem
                  focusedStyle={styles.focusedButton}
                  onPress={handleBack}
                  style={styles.button}
                  testID="player-startup-back">
                  <Text style={styles.buttonText}>Back</Text>
                </FocusableItem>
              </View>
            </>
          )}
        </View>
      ) : null}
      {controlsVisible ? (
        <View style={styles.overlay}>
          <Text numberOfLines={1} style={styles.title}>
            {item.name}
          </Text>
          <Text style={styles.status}>{statusText}</Text>
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
          <Text style={styles.exitTitle}>Stop Playback?</Text>
          <View style={styles.exitButtons}>
            <FocusableItem
              focusedStyle={styles.focusedButton}
              hasTVPreferredFocus={true}
              onPress={() => setShowExitConfirm(false)}
              style={styles.button}
              testID="player-exit-stay">
              <Text style={styles.buttonText}>Stay</Text>
            </FocusableItem>
            <FocusableItem
              focusedStyle={styles.focusedButton}
              onPress={handleBack}
              style={styles.button}
              testID="player-exit-leave">
              <Text style={styles.buttonText}>Leave</Text>
            </FocusableItem>
          </View>
        </View>
      ) : null}
      {creditsPrompt && !endPrompt && !showExitConfirm && !settingsPanel ? (
        <View style={styles.promptCard} testID="player-credits-prompt">
          <Text style={styles.promptTitle}>Credits</Text>
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
              <Text style={styles.buttonText}>Skip Credits</Text>
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
                <Text style={styles.buttonText}>Next Episode</Text>
              </FocusableItem>
            ) : null}
          </View>
        </View>
      ) : null}
      {endPrompt && nextEpisode && !showExitConfirm ? (
        <View style={styles.exitOverlay} testID="player-end-prompt">
          <Text style={styles.exitTitle}>
            {endPrompt.kind === 'countdown' ? 'Up next' : 'Continue watching?'}
          </Text>
          <Text numberOfLines={1} style={styles.promptSubtitle}>
            {episodeLabel(nextEpisode)}
          </Text>
          <Text style={styles.promptHint}>
            {endPrompt.kind === 'countdown'
              ? `Playing in ${endPrompt.remainingSeconds}s  •  Back to cancel`
              : 'Press Next Episode to keep watching'}
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
                {endPrompt.kind === 'countdown' ? 'Play now' : 'Next Episode'}
              </Text>
            </FocusableItem>
            <FocusableItem
              focusedStyle={styles.focusedButton}
              onPress={() => {
                if (endPrompt.kind === 'countdown') {
                  cancelCountdown();
                  setEndPrompt(null);
                  setStatusText('Finished');
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
                {endPrompt.kind === 'countdown' ? 'Cancel' : 'Done'}
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

// Only track selection lives in-player; quality/speed/chapters were removed
// deliberately — chapters ride the FF/RW keys, and quality is meant to be
// configured outside the playback window.
export const PlaybackSettingsOverlay = ({
  onSelectAudio,
  onSelectSubtitle,
  onToggleStats,
  selectedAudioIndex,
  selectedSubtitleIndex,
  showStats,
  showTraces,
  onToggleTraces,
  streamInfo,
}: {
  onSelectAudio: (track: JellyfinMediaTrack) => void;
  onSelectSubtitle: (track: JellyfinMediaTrack | null) => void;
  onToggleStats: () => void;
  selectedAudioIndex?: number;
  selectedSubtitleIndex?: number;
  showStats: boolean;
  showTraces: boolean;
  onToggleTraces: () => void;
  streamInfo: JellyfinStreamInfo;
}) => (
  <View style={styles.settingsOverlay} testID="player-settings-overlay">
    <Text style={styles.settingsTitle}>Playback Options</Text>
    <Text style={styles.settingsStreamInfo}>
      {[
        streamInfo.width && streamInfo.height
          ? `${streamInfo.width}x${streamInfo.height}`
          : undefined,
        streamInfo.bitrate
          ? `${(streamInfo.bitrate / 1000000).toFixed(1)} Mbps`
          : undefined,
        streamInfo.playMethod,
      ]
        .filter(Boolean)
        .join('  •  ')}
    </Text>
    <View style={styles.settingsGrid}>
      <SettingsColumn title="Audio">
        {streamInfo.audioTracks.length ? (
          streamInfo.audioTracks.map((track) => (
            <SettingsButton
              key={track.id}
              label={track.title}
              onPress={() => onSelectAudio(track)}
              selected={track.index === selectedAudioIndex}
            />
          ))
        ) : (
          <Text style={styles.settingsEmpty}>Default audio</Text>
        )}
      </SettingsColumn>
      <SettingsColumn title="Subtitles">
        <SettingsButton
          label="Off"
          onPress={() => onSelectSubtitle(null)}
          selected={selectedSubtitleIndex === undefined}
        />
        {streamInfo.subtitleTracks.map((track) => (
          <SettingsButton
            key={track.id}
            // Every subtitle is burned in now, so the old "(burn-in)" suffix
            // would appear on every entry and tell the viewer nothing.
            label={track.title}
            onPress={() => onSelectSubtitle(track)}
            selected={track.index === selectedSubtitleIndex}
          />
        ))}
      </SettingsColumn>
      <SettingsColumn title="Diagnostics">
        <SettingsButton
          label={`Stats for Nerds: ${showStats ? 'On' : 'Off'}`}
          onPress={onToggleStats}
          selected={showStats}
        />
        <SettingsButton
          label={`Stats for Nerds with logs: ${showTraces ? 'On' : 'Off'}`}
          onPress={onToggleTraces}
          selected={showTraces}
        />
        <Text style={styles.settingsHint}>
          Shows the stream actually delivered by Jellyfin and live player
          health. With logs adds playback timings for manifest handling and load
          duration.
        </Text>
      </SettingsColumn>
    </View>
  </View>
);

const formatDiagnosticMbps = (bitsPerSecond?: number) =>
  bitsPerSecond && Number.isFinite(bitsPerSecond)
    ? `${(bitsPerSecond / 1000000).toFixed(1)} Mbps`
    : '—';

const formatDiagnosticKbps = (bitsPerSecond?: number) =>
  bitsPerSecond && Number.isFinite(bitsPerSecond)
    ? `${Math.round(bitsPerSecond / 1000)} kbps`
    : '—';

const formatDiagnosticCodec = (codec?: string, profile?: string) =>
  [codec?.toUpperCase() ?? 'UNKNOWN', profile].filter(Boolean).join(' ');

const formatDiagnosticTime = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(
    2,
    '0',
  )}`;

export const PlaybackStatsOverlay = ({
  diagnostics,
  positionSeconds,
  showTraces = false,
  streamInfo,
}: {
  diagnostics: PlaybackDebugInfo | null;
  positionSeconds: number;
  showTraces?: boolean;
  streamInfo: JellyfinStreamInfo;
}) => {
  const deliveredAudioIndex =
    streamInfo.deliveredAudioStreamIndex ?? streamInfo.audioStreamIndex;
  const audioTrack = streamInfo.audioTracks.find(
    (track) => track.index === deliveredAudioIndex,
  );
  const requestedAudioIndex = streamInfo.audioStreamIndex;
  const trackMatch = requestedAudioIndex === deliveredAudioIndex;
  const activeVideoWidth =
    diagnostics?.activeVideoWidth ??
    (streamInfo.videoDeliveryMethod === 'Copy' ? streamInfo.width : undefined);
  const activeVideoHeight =
    diagnostics?.activeVideoHeight ??
    (streamInfo.videoDeliveryMethod === 'Copy' ? streamInfo.height : undefined);
  const sourceResolution = `${streamInfo.width ?? '?'}x${
    streamInfo.height ?? '?'
  }`;
  const activeResolution = `${activeVideoWidth ?? '?'}x${
    activeVideoHeight ?? '?'
  }`;

  return (
    <View style={styles.statsOverlay} testID="player-stats-overlay">
      <Text style={styles.statsTitle}>Stats for Nerds</Text>
      <Text style={styles.statsLine}>
        {`Position  ${formatDiagnosticTime(positionSeconds)}   Buffer  ${
          diagnostics?.bufferedAheadSeconds !== undefined
            ? `${diagnostics.bufferedAheadSeconds.toFixed(1)}s`
            : '—'
        }`}
      </Text>
      <Text style={styles.statsLine}>
        {`Buffer map  ranges ${
          diagnostics?.bufferedRangeCount ?? '—'
        }   total ahead ${
          diagnostics?.furthestBufferedAheadSeconds !== undefined
            ? `${diagnostics.furthestBufferedAheadSeconds.toFixed(1)}s`
            : '—'
        }   next gap ${
          diagnostics?.nextBufferedGapSeconds !== undefined
            ? `${diagnostics.nextBufferedGapSeconds.toFixed(3)}s`
            : '—'
        }`}
      </Text>
      <Text style={styles.statsLine}>
        {`Video  ${formatDiagnosticCodec(
          streamInfo.sourceVideoCodec,
        )} → ${formatDiagnosticCodec(
          streamInfo.outputVideoCodec ?? streamInfo.deliveredVideoCodec,
        )}   ${streamInfo.videoDeliveryMethod ?? 'Unknown'}`}
      </Text>
      <Text style={styles.statsLine}>
        {`Resolution  source ${sourceResolution} → active ${activeResolution}`}
      </Text>
      <Text style={styles.statsLine}>
        {`Audio  ${formatDiagnosticCodec(
          streamInfo.sourceAudioCodec ?? audioTrack?.codec,
          streamInfo.sourceAudioProfile ?? audioTrack?.profile,
        )} → ${formatDiagnosticCodec(
          streamInfo.outputAudioCodec ?? streamInfo.deliveredAudioCodec,
        )}   ${streamInfo.audioDeliveryMethod ?? 'Unknown'}   ${
          audioTrack?.channels ?? '?'
        } ch`}
      </Text>
      <Text style={styles.statsLine}>
        {`Audio rate  ${formatDiagnosticKbps(
          streamInfo.sourceAudioBitrate ?? audioTrack?.bitrate,
        )} → ${formatDiagnosticKbps(streamInfo.outputAudioBitrate)}   ${
          streamInfo.sourceAudioSampleRate ?? audioTrack?.sampleRate ?? '?'
        } Hz`}
      </Text>
      {streamInfo.audioOutputCapabilities ? (
        <Text style={styles.statsLine}>
          {`Audio sink  AC3 ${
            streamInfo.audioOutputCapabilities.ac3 ? 'yes' : 'no'
          }   EAC3 ${
            streamInfo.audioOutputCapabilities.eac3 ? 'yes' : 'no'
          }   Opus ${
            streamInfo.audioOutputCapabilities.opus ? 'yes' : 'no'
          }   MP3 ${
            streamInfo.audioOutputCapabilities.mp3 ? 'yes' : 'no'
          }   DTS ${
            streamInfo.audioOutputCapabilities.dtsDirectPlayVerified
              ? 'verified'
              : streamInfo.audioTranscodePolicy?.split(',').includes('dts')
              ? 'trial'
              : streamInfo.audioOutputCapabilities.dtsProbeSupported
              ? 'probe only'
              : 'no'
          }`}
        </Text>
      ) : null}
      <Text style={styles.statsLine}>
        {`Audio policy  ${
          streamInfo.audioTranscodePolicy?.toUpperCase() ?? 'AAC'
        }`}
      </Text>
      <Text style={[styles.statsLine, !trackMatch && styles.statsWarning]}>
        {`Track  ${requestedAudioIndex ?? 'auto'} → ${
          deliveredAudioIndex ?? 'unknown'
        }${trackMatch ? '' : '  MISMATCH'}   ${
          audioTrack?.title ?? `Track ${deliveredAudioIndex ?? '?'}`
        }`}
      </Text>
      <Text style={styles.statsLine}>
        {`Container  ${
          streamInfo.sourceContainer?.toUpperCase() ??
          streamInfo.container?.toUpperCase() ??
          'UNKNOWN'
        } → HLS/${
          streamInfo.outputContainer?.toUpperCase() ?? 'UNKNOWN'
        }   Overall ${streamInfo.playMethod}`}
      </Text>
      <Text style={styles.statsLine}>
        {`Delivery  HLS target ${
          streamInfo.hlsSegmentTargetSeconds !== undefined
            ? `${streamInfo.hlsSegmentTargetSeconds}s`
            : '—'
        }   min segments ${
          streamInfo.hlsMinimumSegmentCount ?? '—'
        }   Astra ${APP_VERSION} (${BUILD_NUMBER})`}
      </Text>
      <Text style={styles.statsLine}>
        {`Bandwidth  stream ${formatDiagnosticMbps(
          diagnostics?.streamBandwidth ?? streamInfo.bitrate,
        )}   network ${formatDiagnosticMbps(diagnostics?.estimatedBandwidth)}`}
      </Text>
      <Text style={styles.statsLine}>
        {`Frames  decoded ${diagnostics?.decodedFrames ?? '—'} / dropped ${
          diagnostics?.droppedFrames ?? '—'
        }   Buffering time ${
          diagnostics?.bufferingTimeSeconds !== undefined
            ? `${diagnostics.bufferingTimeSeconds.toFixed(1)}s`
            : '—'
        }`}
      </Text>
      <Text style={styles.statsLine}>
        {`Events  waiting ${diagnostics?.waitingEventCount ?? 0} / stalled ${
          diagnostics?.stalledEventCount ?? 0
        } / errors ${diagnostics?.errorEventCount ?? 0}   last ${
          diagnostics?.lastPlaybackEvent ?? '—'
        }${
          diagnostics?.lastPlaybackEventSeconds !== undefined
            ? ` @ ${formatDiagnosticTime(diagnostics.lastPlaybackEventSeconds)}`
            : ''
        }`}
      </Text>
      {streamInfo.transcodeReasons?.length ? (
        <Text style={styles.statsLine}>
          {`Reason  ${streamInfo.transcodeReasons.join(', ')}`}
        </Text>
      ) : null}
      {/* Playback traces. JS console output reaches no artifact that
          `vega device copy-logs` can retrieve, so timings for the reload path
          have to be read here on the device. */}
      {(showTraces ? getTraces() : []).slice(-8).map((entry, index) => (
        <Text key={`${entry.label}-${index}`} style={styles.statsLine}>
          {`T+${(entry.sinceStartMs / 1000).toFixed(1)}s  ${entry.label}  ${
            entry.detail
          }`}
        </Text>
      ))}
    </View>
  );
};

const SettingsColumn = ({
  children,
  title,
}: React.PropsWithChildren<{title: string}>) => (
  <View style={styles.settingsColumn}>
    <Text style={styles.settingsHeading}>{title}</Text>
    <ScrollView
      showsVerticalScrollIndicator={true}
      style={styles.settingsColumnScroller}>
      {children}
    </ScrollView>
  </View>
);

const SettingsButton = ({
  label,
  onPress,
  selected = false,
}: {
  label: string;
  onPress: () => void;
  selected?: boolean;
}) => (
  <FocusableItem
    focusedStyle={styles.settingsButtonFocused}
    onPress={onPress}
    style={[styles.settingsButton, selected && styles.settingsButtonSelected]}>
    <View style={[styles.radioCircle, selected && styles.radioCircleSelected]}>
      {selected ? <View style={styles.radioDot} /> : null}
    </View>
    <Text numberOfLines={1} style={styles.settingsButtonText}>
      {label}
    </Text>
  </FocusableItem>
);

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#000000',
  },
  videoSurface: {
    ...StyleSheet.absoluteFillObject,
  },
  subtitleOverlay: {
    position: 'absolute',
    alignItems: 'center',
    bottom: 84,
    left: 72,
    right: 72,
    zIndex: 2,
  },
  subtitleText: {
    backgroundColor: 'rgba(0,0,0,0.78)',
    borderRadius: 5,
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '600',
    lineHeight: 38,
    paddingHorizontal: 12,
    paddingVertical: 5,
    textAlign: 'center',
  },
  overlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: 52,
    paddingHorizontal: 72,
    paddingTop: 36,
    backgroundColor: 'rgba(0,0,0,0.58)',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '800',
  },
  status: {
    color: '#B8C5CC',
    fontSize: 22,
    marginTop: 6,
  },
  controls: {
    flexDirection: 'row',
    gap: 18,
    marginTop: 22,
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.24)',
    marginTop: 18,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: '#4CC9F0',
  },
  button: {
    minWidth: 118,
    height: 58,
    borderRadius: 8,
    backgroundColor: '#25313A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  focusedButton: {
    backgroundColor: '#2E5A72',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
  },
  settingsOverlay: {
    position: 'absolute',
    top: 44,
    left: 52,
    right: 52,
    maxHeight: 670,
    borderRadius: 8,
    backgroundColor: 'rgba(12,17,22,0.94)',
    padding: 24,
  },
  startupOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    backgroundColor: 'rgba(5, 9, 13, 0.86)',
    gap: 18,
    justifyContent: 'center',
    paddingHorizontal: 80,
  },
  startupTitle: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '800',
  },
  startupRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 18,
  },
  startupText: {
    color: '#E4EBF0',
    fontSize: 28,
    textAlign: 'center',
  },
  startupDetail: {
    color: '#B8C5CC',
    fontSize: 22,
    textAlign: 'center',
  },
  startupButtons: {
    flexDirection: 'row',
    gap: 20,
    marginTop: 10,
  },
  exitOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.78)',
    justifyContent: 'center',
    padding: 64,
  },
  exitTitle: {
    color: '#FFFFFF',
    fontSize: 36,
    fontWeight: '800',
    marginBottom: 28,
  },
  exitButtons: {
    flexDirection: 'row',
    gap: 20,
  },
  promptCard: {
    position: 'absolute',
    alignItems: 'center',
    backgroundColor: 'rgba(12,17,22,0.94)',
    borderRadius: 10,
    bottom: 120,
    paddingHorizontal: 28,
    paddingVertical: 18,
    right: 72,
    zIndex: 3,
  },
  promptTitle: {
    color: '#4CC9F0',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  promptSubtitle: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '700',
    marginBottom: 8,
    maxWidth: 900,
  },
  promptHint: {
    color: '#B8C5CC',
    fontSize: 20,
    marginBottom: 24,
  },
  settingsTitle: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 4,
  },
  settingsStreamInfo: {
    color: '#8FE3C0',
    fontSize: 22,
    marginBottom: 16,
  },
  settingsGrid: {
    flexDirection: 'row',
    gap: 18,
  },
  settingsColumn: {
    flex: 1,
    marginBottom: 18,
  },
  settingsColumnScroller: {
    maxHeight: 550,
  },
  settingsHeading: {
    color: '#89CFF0',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 8,
  },
  settingsButton: {
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#25313A',
    flexDirection: 'row',
    minHeight: 44,
    marginBottom: 8,
    paddingHorizontal: 12,
  },
  settingsButtonSelected: {
    backgroundColor: '#1F3746',
  },
  settingsButtonFocused: {
    backgroundColor: '#2E5A72',
  },
  settingsButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  radioCircle: {
    alignItems: 'center',
    borderColor: '#8CA1AA',
    borderRadius: 9,
    borderWidth: 2,
    height: 18,
    justifyContent: 'center',
    marginRight: 9,
    width: 18,
  },
  radioCircleSelected: {
    borderColor: '#4CC9F0',
  },
  radioDot: {
    backgroundColor: '#4CC9F0',
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  settingsEmpty: {
    color: '#B8C5CC',
    fontSize: 18,
  },
  settingsHint: {
    color: '#B8C5CC',
    fontSize: 16,
    lineHeight: 22,
  },
  statsOverlay: {
    position: 'absolute',
    right: 42,
    top: 34,
    width: 650,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.86)',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  statsTitle: {
    color: '#4CC9F0',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 8,
  },
  statsLine: {
    color: '#FFFFFF',
    fontFamily: 'monospace',
    fontSize: 16,
    lineHeight: 23,
  },
  statsWarning: {
    color: '#FFB86C',
    fontWeight: '800',
  },
});
