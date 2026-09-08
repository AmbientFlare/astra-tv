import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
  canServerTranscodeVideo,
  getStreamUrl,
  JellyfinMediaItem,
  JellyfinMediaSegment,
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
import {getTraces, resetTraces, trace} from '../../services/logging/trace';
import {
  emitError,
  flushTelemetry,
  isTelemetryArmed,
  setTelemetrySession,
  telemetryStatus,
} from '../../services/telemetry';
import {
  emitPlaybackDecision,
  emitSessionEnd,
} from '../../services/telemetry/playbackFacts';
import {
  HeartbeatSample,
  PlaybackHeartbeat,
} from '../../services/telemetry/heartbeat';
import type {ShakaPlayer as ShakaPlayerInstance} from '../../w3cmedia/shakaplayer/ShakaPlayer';
import {
  calibrateTimelineOffset,
  logicalToMediaTime,
  mediaToLogicalTime,
  logicalDurationSeconds,
  isPrematureEnd,
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
  formatBufferingTime,
  PlaybackHealthMonitor,
  shouldAbandonForcedDecoderTranscode,
  shouldTripForcedDecoderTranscode,
  shouldForceVideoConversion,
  assessDecoderRisk,
  computeBufferBudget,
  shouldTranscodeForDecoder,
  shouldWarnAboutDecoderRisk,
  DECODER_RISK_WARNING,
} from '../../services/playbackHealth';
import {
  getServerCapabilities,
  recordTranscodeFailure,
  recordTranscodeProbe,
  recordTranscodeSuccess,
  serverCapabilityKey,
  shouldAttemptServerTranscode,
  shouldProbeTranscode,
} from '../../services/serverCapabilities';
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
import {createPositionStore, PositionStore} from './positionStore';

const TICKS_PER_SECOND = 10000000;
const CONTROL_HIDE_DELAY_MS = 5000;
type PlaybackPanel = 'audio' | 'subtitles';

interface PlaybackDebugInfo {
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

interface PlaybackEventDiagnostics {
  errorEventCount: number;
  shakaErrorEventCount?: number;
  lastError?: string;
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
      url: sanitizeUrlForLog(url),
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
  const heartbeatRef = useRef<PlaybackHeartbeat | null>(null);
  // Last diagnostics sample, kept so session.end can report lifetime totals
  // without sampling a player that is already being torn down.
  const lastTelemetrySample = useRef<PlaybackDebugInfo | null>(null);
  const telemetrySessionStartedMs = useRef<number | null>(null);
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
  // EnableVideoPlaybackTranscoding is a permission, not a capability: a
  // CPU-only NAS reports it happily and then cannot start a 4K Dolby Vision
  // re-encode at all. Measured on 2026-09-07: the forced session never
  // received a manifest, held zero buffered ranges for its whole life and
  // died to the watchdog with no decoded frames -- three times -- where the
  // unforced passthrough of the same file played with 0.025% drops. So treat
  // a forced session that produces no frames as proof the server cannot do
  // the work, stop forcing for the rest of this screen, and fall back to the
  // passthrough route plus the warning the server should have earned up front.
  const decoderTranscodeUnusable = useRef(false);
  const forcedDecoderTranscode = useRef(false);
  const decodedFramesThisSession = useRef(0);
  const forcedTranscodeReadyAtMs = useRef<number | null>(null);
  // The same verdict, remembered per server across restarts. Without this the
  // 12 s dead start is paid again every time the player mounts; with it, the
  // NAS is asked once and never again until it starts working.
  const serverKey = serverCapabilityKey(serverUrl);
  const transcodeSuccessRecorded = useRef(false);
  // Set when this server's suppressed answer has gone stale enough to re-test.
  // Held rather than acted on immediately: the probe is only spent when a
  // heavy title actually triggers a forced attempt, so someone who only
  // watches 1080p never pays for it and never uses up their weekly try.
  const transcodeProbeArmed = useRef(false);

  useEffect(() => {
    let mounted = true;
    getServerCapabilities(serverKey)
      .then((capabilities) => {
        if (!mounted) return;
        const now = Date.now();
        transcodeProbeArmed.current = shouldProbeTranscode(
          capabilities.videoTranscode,
          capabilities.lastTranscodeProbeAtMs,
          now,
        );
        if (
          !shouldAttemptServerTranscode(
            capabilities.videoTranscode,
            capabilities.lastTranscodeProbeAtMs,
            now,
          )
        ) {
          decoderTranscodeUnusable.current = true;
        }
      })
      .catch(() => undefined);

    return () => {
      mounted = false;
    };
  }, [serverKey]);
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
  // The session transition below awaits audio release before claiming video.

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

  const currentPositionTicks = useCallback(() => {
    if (
      !sessionReady.current ||
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
            `Resumed at ${Math.floor(clampedTarget / 60)}:${String(
              Math.floor(clampedTarget % 60),
            ).padStart(2, '0')}`,
          );
        } catch (error) {
          console.warn('Failed to apply resume position', error);
          setStatusText('Playing from start');
        }
      }, 250);
    },
    [applyPosition],
  );

  const reportProgress = useCallback(
    (positionTicks = currentPositionTicks(), paused = isPausedRef.current) => {
      const stream = streamInfo.current;
      if (!stream || !sessionReady.current) return;
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
    if (!stream || !reporting) return;
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
    if (releasePromise.current) return releasePromise.current;
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
    try {
      video?.pause();
    } catch {
      /* Already detached by the native surface. */
    }
    const cleanup = (async () => {
      try {
        await shaka?.unload();
      } finally {
        try {
          if (handle) video?.clearSurfaceHandle(handle);
        } finally {
          await video?.deinitialize();
        }
      }
    })();
    releasePromise.current = cleanup;
    // Keep a rejected cleanup barrier: a failed native release must not allow
    // a new player to attach to resources whose lifetime is still unresolved.
    void cleanup.then(
      () => {
        if (releasePromise.current === cleanup) releasePromise.current = null;
      },
      () => undefined,
    );
    return cleanup;
  }, [clearControlsHideTimer, currentPositionTicks, item, reportStopped]);

  const stopPlayback = useCallback(() => {
    latestPositionTicks.current = currentPositionTicks();
    sessionController.current.invalidate();
    sessionReady.current = false;
    countdownRef.current?.cancel();
    void shakaPlayerRef.current?.cancelLoad().catch(() => undefined);
    return sessionController.current.dispose(releaseMedia);
  }, [currentPositionTicks, releaseMedia]);
  stopPlaybackRef.current = stopPlayback;

  const returnToLibrary = useCallback(() => {
    if (unmountedRef.current || navigationSent.current) return;
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
        setStatusText('Unable to release playback. Please reopen Astra.');
      });
  }, [returnToLibrary, stopPlayback]);

  const seekToSeconds = useCallback(
    async (targetSeconds: number, closeSettings = false) => {
      const video = videoRef.current;

      if (!video || !sessionReady.current || trackReloadInProgress.current) {
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
      if (
        requiresStreamReload(fromSeconds, target, firstAvailableSeconds.current)
      ) {
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
      applyPosition(target);

      if (video.paused) {
        video.play();
        setPaused(false);
        isPausedRef.current = false;
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

      reportProgress(positionTicks, false);
    },
    [applyPosition, item.runTimeTicks, reportProgress, scheduleControlsHide],
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

      const duration = logicalDurationSeconds(
        streamInfo.current?.runTimeTicks ?? item.runTimeTicks,
        video.duration,
        mediaTimelineOffsetSeconds.current,
      );

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
        handoffInProgress.current = false;
        setStatusText('Unable to release playback. Please reopen Astra.');
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

    if (!sessionReady.current) {
      if (!trackReloadInProgress.current) void reloadAtSecondsRef.current?.(0);
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
          if (context?.isCurrent()) playbackErrorHandler.current(failure);
        },
        onTimelineReady: ({skippedSeconds}: {skippedSeconds: number}) => {
          if (!context?.isCurrent()) return;
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
          applyPosition(resumeTarget);
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
      listen('pause', () => {
        if (!isCurrentPlayer()) {
          return;
        }
        recordPlaybackEvent('pause');
        isPausedRef.current = true;
        setPaused(true);
        revealControls(false);
      });
      listen('loadedmetadata', () => {
        if (!isCurrentPlayer()) {
          return;
        }
        recordPlaybackEvent('loadedmetadata');
        setStatusText('Stream loaded');
        applyPendingInitialSeek(video);
      });
      listen('canplay', () => {
        if (!isCurrentPlayer()) {
          return;
        }
        recordPlaybackEvent('canplay');
        setStatusText('Ready to play');
        applyPendingInitialSeek(video);
      });
      listen('waiting', () => {
        if (!isCurrentPlayer()) {
          return;
        }
        recordPlaybackEvent('waiting', 'waitingEventCount');
        revealControls(false);
        setStatusText('Buffering...');
      });
      listen('stalled', () => {
        if (!isCurrentPlayer()) {
          return;
        }
        recordPlaybackEvent('stalled', 'stalledEventCount');
        revealControls(false);
        setStatusText('Playback stalled. Buffering...');
      });
      listen('timeupdate', () => {
        if (!isCurrentPlayer()) {
          return;
        }
        if (
          sessionReady.current &&
          typeof video.currentTime === 'number' &&
          Number.isFinite(video.currentTime)
        ) {
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
        if (!sessionReady.current) return;
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
        reportStopped();
        sessionReady.current = false;
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
    [
      applyPendingInitialSeek,
      applyPosition,
      currentPositionTicks,
      item.runTimeTicks,
      positionStore,
      reportStopped,
      revealControls,
      scheduleControlsHide,
    ],
  );

  const createFreshVideoPlayer = useCallback(
    async (context: PlaybackSessionContext) => {
      context.assertCurrent();
      const handle = surfaceHandle.current;
      if (!handle) throw new Error('Video surface is unavailable.');
      const video = new VideoPlayer();
      videoRef.current = video;
      activeContext.current = context;
      playbackGeneration.current = context.generation;
      try {
        await video.setMediaControlFocus(
          keplerAppStateManager.getComponentInstance(),
        );
      } catch {
        context.assertCurrent();
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
            ? 'Loading HLS transcode...'
            : 'Loading transcoded MP4 stream...'
          : 'Loading direct stream...',
      );
      assertPlayableUrl(stream.url);

      return stream;
    },
    [
      accessToken,
      applyPosition,
      item.id,
      item.mediaStreams,
      item.name,
      preferredMaxBitrate,
      serverKey,
      serverUrl,
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
        reason === 'recovery'
          ? 'Recovering playback...'
          : 'Preparing playback...',
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
            if (recovery?.disableAudioStreamCopy)
              selectedAllowAudioStreamCopy.current = false;
            if (recovery?.forceVideoTranscode)
              decoderRequiresConversion.current = true;
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
              if (event === 'start')
                return reportPlaybackStart(serverUrl, accessToken, value);
              if (event === 'stop')
                return reportPlaybackStopped(serverUrl, accessToken, value);
              return reportPlaybackProgress(serverUrl, accessToken, value);
            },
            () => trace('report.error', 'Jellyfin playback report failed'),
          );
          pendingInitialSeekSeconds.current = isAdaptiveStream(stream.url)
            ? null
            : target;
          initialSeekApplied.current =
            isAdaptiveStream(stream.url) || target === 0;
          addSelectedSubtitleTrack(video, stream);
          await loadVideoSource(video, stream, target, context);
          context.assertCurrent();
          sessionReady.current = true;
          telemetrySessionStartedMs.current = Date.now();
          forcedTranscodeReadyAtMs.current = Date.now();
          heartbeatRef.current?.start();
          void reporter.current?.start({
            ...stream,
            audioStreamIndex: selectedAudioIndex.current,
            subtitleStreamIndex: selectedSubtitleIndex.current,
            positionTicks: targetTicks,
            isPaused: false,
          });
          await video.play();
          context.assertCurrent();
          isPausedRef.current = false;
          setPaused(false);
          setStarting(false);
          scheduleControlsHide();
          setStatusText('Starting video...');
        } catch (error) {
          const cancelled = !context.isCurrent() || isPlaybackCancelled(error);
          sessionFailed.current = !cancelled;
          await releaseMedia();
          if (cancelled) return;
          context.assertCurrent();
          trace('session.failed', 'generation=' + context.generation);
          setStarting(false);
          setStartupError(
            'Playback could not continue. Retry or return to the library.',
          );
          setStatusText('Unable to play this stream.');
        } finally {
          if (context.isCurrent()) trackReloadInProgress.current = false;
        }
      });
      try {
        await transition;
      } catch (error) {
        if (!isPlaybackCancelled(error) && !unmountedRef.current) {
          setStarting(false);
          setStartupError(
            'Unable to release the media player. Please reopen Astra.',
          );
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
      if (trackReloadInProgress.current) return;
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
    [reportProgress, startPlayback],
  );

  reloadAtSecondsRef.current = async (position) => {
    if (trackReloadInProgress.current) return;
    trace('jump.reload.start', 'toSeconds=' + position.toFixed(1));
    await startPlayback({position, reason: 'jump'});
  };

  playbackErrorHandler.current = (failure) => {
    if (!activeContext.current?.isCurrent() || unmountedRef.current) return;
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
    if (failure.source === 'shaka' && failure.severity === 1) return;
    if (trackReloadInProgress.current || !sessionReady.current) return;
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
              'Playback stopped unexpectedly. Retry or return to the library.',
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

  useLayoutEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
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
          // Release VOD resources and return to details with the saved item context.
          void stopPlaybackRef
            .current()
            .then(returnToLibrary)
            .catch(() => trace('session.background', 'native release failed'));
        } else if (nextState === 'inactive') {
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
  ]);

  useEffect(() => {
    const interval = setInterval(() => {
      const video = videoRef.current;
      if (!video || !sessionReady.current || unmountedRef.current) return;
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
      if (
        healthMonitor.current.observe(
          Date.now(),
          ticks / TICKS_PER_SECOND,
          !isPausedRef.current && !trackReloadInProgress.current,
        )
      ) {
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
        playbackErrorHandler.current({source: 'watchdog'});
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [applyPosition, currentPositionTicks, reportProgress]);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  /**
   * One sample of player diagnostics. Extracted from the stats overlay so the
   * telemetry heartbeat can reuse it on its own, much slower schedule.
   *
   * Reading getDebugStats() + getVideoPlaybackQuality() costs JS-thread time,
   * and blocking the JS thread is this app's signature failure mode (the ANR
   * in build 20260829.2). Nothing here changes how often the overlay samples;
   * the heartbeat adds one call per 10s, versus the overlay's one per second.
   */
  const collectPlaybackSample = useCallback((): PlaybackDebugInfo | null => {
    const shakaPlayer = shakaPlayerRef.current;
    const video = videoRef.current;
    if (!shakaPlayer || !video || unmountedRef.current) {
      return null;
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
      ...playbackEventDiagnostics.current,
    };
  }, []);

  useEffect(() => {
    // The heartbeat is the only thing that speaks during steady playback: the
    // trace() call sites all fire on transitions, so without this a two-hour
    // movie produces silence. 10s steady, 2s while starting or buffering.
    const heartbeat = new PlaybackHeartbeat((): HeartbeatSample => {
      const sample = collectPlaybackSample();
      lastTelemetrySample.current = sample ?? lastTelemetrySample.current;
      decodedFramesThisSession.current = Math.max(
        decodedFramesThisSession.current,
        sample?.decodedFrames ?? 0,
      );
      // A forced session that is producing frames clears a stale `unable`, so
      // a GPU that has come back is picked up without anyone visiting Settings.
      if (
        forcedDecoderTranscode.current &&
        !transcodeSuccessRecorded.current &&
        decodedFramesThisSession.current > 0
      ) {
        transcodeSuccessRecorded.current = true;
        void getServerCapabilities(serverKey)
          .then((capabilities) =>
            recordTranscodeSuccess(serverKey, capabilities.videoTranscode),
          )
          .catch(() => undefined);
      }
      const stream = streamInfo.current;
      const event = sample?.lastPlaybackEvent;
      return {
        pos: videoRef.current?.currentTime,
        ahead: sample?.bufferedAheadSeconds,
        buffering: event === 'waiting' || event === 'stalled',
        paused: isPausedRef.current,
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
    });
    heartbeatRef.current = heartbeat;
    return () => {
      heartbeat.stop();
      heartbeatRef.current = null;
    };
  }, [collectPlaybackSample, serverKey]);

  useEffect(() => {
    if (!showPlaybackStats) {
      setPlaybackDebugInfo(null);
      return;
    }

    const updateStats = () => {
      const sample = collectPlaybackSample();
      if (sample) {
        lastTelemetrySample.current = sample;
        setPlaybackDebugInfo(sample);
      }
    };

    updateStats();
    const interval = setInterval(updateStats, 1000);
    return () => clearInterval(interval);
  }, [collectPlaybackSample, showPlaybackStats]);

  const onSurfaceViewCreated = useCallback(
    async (handle: string) => {
      if (unmountedRef.current || handoffInProgress.current) return;
      if (
        surfaceHandle.current === handle &&
        (trackReloadInProgress.current || sessionReady.current)
      )
        return;
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
      if (surfaceHandle.current !== handle) return;
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
      <ExternalSubtitleOverlay
        cues={externalSubtitleCues}
        positionStore={positionStore}
      />
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
      {decoderRiskWarned ? (
        <View style={styles.decoderWarning}>
          <Text style={styles.decoderWarningText}>{DECODER_RISK_WARNING}</Text>
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

// Vega's getVideoPlaybackQuality() reports absolute frame counts that cannot
// be true -- roughly 4,600 fps on a 23.976 fps stream -- so printing them
// invites people to read a wrong number as fact. The ratio between the two
// still moves in the right direction when the decoder is struggling, so that
// is the only form worth showing.
const formatDropRatio = (decoded?: number, dropped?: number) => {
  if (
    !decoded ||
    !Number.isFinite(decoded) ||
    dropped === undefined ||
    !Number.isFinite(dropped)
  ) {
    return '\u2014';
  }
  return `${((dropped / decoded) * 100).toFixed(2)}%`;
};

const formatDiagnosticCodec = (codec?: string, profile?: string) =>
  [codec?.toUpperCase() ?? 'UNKNOWN', profile].filter(Boolean).join(' ');

const formatDiagnosticTime = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(
    2,
    '0',
  )}`;

/**
 * Renders external WebVTT cues off the position store rather than off React
 * state, so a playhead tick that does not change the visible cue costs no
 * render anywhere — and one that does re-renders only this overlay.
 */
export const ExternalSubtitleOverlay = ({
  cues,
  positionStore,
}: {
  cues: WebVttCue[];
  positionStore: PositionStore;
}) => {
  const [text, setText] = useState(() =>
    activeWebVttText(cues, positionStore.get()),
  );

  useEffect(() => {
    setText(activeWebVttText(cues, positionStore.get()));
    if (cues.length === 0) {
      return undefined;
    }
    return positionStore.subscribe((seconds) => {
      const next = activeWebVttText(cues, seconds);
      setText((current) => (current === next ? current : next));
    });
  }, [cues, positionStore]);

  if (!text) {
    return null;
  }

  return (
    <View
      pointerEvents="none"
      style={styles.subtitleOverlay}
      testID="player-external-subtitle">
      <Text style={styles.subtitleText}>{text}</Text>
    </View>
  );
};

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
      <Text style={styles.statsLine}>{`Telemetry ${
        telemetryStatus().armed ? 'armed' : 'off'
      }  ${telemetryStatus().reason}  sent=${
        telemetryStatus().counters?.sent ?? 0
      } drop=${telemetryStatus().counters?.dropped ?? 0} fail=${
        telemetryStatus().counters?.failed ?? 0
      }`}</Text>
      <Text style={styles.statsLine}>
        Codec delivery is inferred from the server request.
      </Text>
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
        {`Frames  dropped ${formatDropRatio(
          diagnostics?.decodedFrames,
          diagnostics?.droppedFrames,
        )}   Buffering time ${formatBufferingTime(
          diagnostics?.bufferingTimeSeconds,
        )}`}
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
      <Text style={styles.statsLine}>
        {`Shaka errors  ${diagnostics?.shakaErrorEventCount ?? 0}   ${
          diagnostics?.lastError ?? 'No recorded failure'
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
  decoderWarning: {
    position: 'absolute',
    top: 48,
    left: 72,
    right: 72,
    backgroundColor: 'rgba(0,0,0,0.78)',
    borderRadius: 10,
    paddingHorizontal: 28,
    paddingVertical: 18,
  },
  decoderWarningText: {
    color: '#F2D98C',
    fontSize: 24,
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
