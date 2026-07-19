import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
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
  getStreamUrl,
  JellyfinMediaItem,
  JellyfinMediaTrack,
  JellyfinStreamInfo,
  reportPlaybackProgress,
  reportPlaybackStart,
  reportPlaybackStopped,
  sanitizeUrlForLog,
} from '../../services/jellyfin';
import type {ShakaPlayer as ShakaPlayerInstance} from '../../w3cmedia/shakaplayer/ShakaPlayer';
import {
  getNextPlaybackRecovery,
  unloadPlayer,
} from '../../w3cmedia/playerLifecycle';
import {
  defaultPlaybackPrefs,
  readPlaybackPreferences,
  writePlaybackPreferences,
} from '../../services/storage';
import {
  activeWebVttText,
  parseWebVtt,
  WebVttCue,
} from '../../services/subtitles';

const TICKS_PER_SECOND = 10000000;
const CONTROL_HIDE_DELAY_MS = 5000;
type PlaybackPanel = 'audio' | 'subtitles';

interface PlaybackDebugInfo {
  activeVideoHeight?: number;
  activeVideoWidth?: number;
  bufferedAheadSeconds?: number;
  bufferingTimeSeconds?: number;
  decodedFrames?: number;
  droppedFrames?: number;
  estimatedBandwidth?: number;
  streamBandwidth?: number;
}

interface PlayerScreenProps {
  accessToken: string;
  item: JellyfinMediaItem;
  onBack?: () => void;
  serverUrl: string;
  userId?: string;
}

const toTicks = (seconds?: number, fallback = 0) =>
  Math.round((seconds ?? fallback) * TICKS_PER_SECOND);

// For content without embedded chapters, the FF/RW keys jump across this
// many evenly spaced synthetic chapters instead.
const SYNTHETIC_CHAPTER_COUNT = 12;

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
  item,
  onBack,
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
  const playbackGeneration = useRef(0);
  const playbackErrorHandler = useRef<() => void>(() => undefined);
  const playbackRecoveryAttempt = useRef(0);
  const trackReloadInProgress = useRef(false);
  const pendingInitialSeekSeconds = useRef<number | null>(null);
  const initialSeekApplied = useRef(false);
  const latestPositionTicks = useRef(item.resumePositionTicks ?? 0);
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
  const [showPlaybackStats, setShowPlaybackStats] = useState(false);
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

  useEffect(() => {
    let mounted = true;

    readPlaybackPreferences().then((preferences) => {
      if (!mounted) {
        return;
      }

      setPreferredSeekSeconds(preferences.seekDurationSeconds);
      setPreferredMaxBitrate(preferences.maxBitrateBps);
      setShowPlaybackStats(preferences.showPlaybackStats);
    });

    return () => {
      mounted = false;
    };
  }, []);

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
    const currentTime = videoRef.current?.currentTime;
    // A freshly created or failed video element reports currentTime 0;
    // trusting it would wipe a real resume position during error retries.
    // Deliberate seeks to 0 update latestPositionTicks directly, so a zero
    // here with a non-zero ref can only be a dead element.
    const isTrustworthy =
      typeof currentTime === 'number' &&
      Number.isFinite(currentTime) &&
      (currentTime > 0 || latestPositionTicks.current === 0);

    latestPositionTicks.current = toTicks(
      isTrustworthy ? currentTime : undefined,
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
      if (!videoRef.current?.paused) {
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
    setTimeout(() => {
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
    if (stoppedReported.current || !streamInfo.current) {
      return;
    }

    stoppedReported.current = true;
    await reportPlaybackStopped(serverUrl, accessToken, {
      ...streamInfo.current,
      audioStreamIndex: selectedAudioIndex.current,
      positionTicks: currentPositionTicks(),
      subtitleStreamIndex: selectedSubtitleIndex.current,
    });
  }, [accessToken, currentPositionTicks, serverUrl]);

  const handleBack = useCallback(() => {
    reportStopped().finally(() => {
      onBack?.();
    });
  }, [onBack, reportStopped]);

  const seekToSeconds = useCallback(
    (targetSeconds: number, closeSettings = false) => {
      const video = videoRef.current;

      if (!video) {
        return;
      }

      const duration =
        typeof video.duration === 'number' && Number.isFinite(video.duration)
          ? video.duration
          : 0;
      const target = Math.max(
        0,
        duration > 0 ? Math.min(duration, targetSeconds) : targetSeconds,
      );
      const seekableVideo = video as VideoPlayer & {
        fastSeek?: (time: number) => void;
      };

      if (typeof seekableVideo.fastSeek === 'function') {
        seekableVideo.fastSeek(target);
      } else {
        video.currentTime = target;
      }

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
    [accessToken, scheduleControlsHide, serverUrl],
  );

  const seek = useCallback(
    (seconds: number) => {
      const video = videoRef.current;

      if (!video || typeof video.currentTime !== 'number') {
        return;
      }

      seekToSeconds(video.currentTime + seconds);
    },
    [seekToSeconds],
  );

  const jumpChapter = useCallback(
    (direction: 1 | -1) => {
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
        seek(direction * preferredSeekSeconds);
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
      const current = video.currentTime;
      // Backward uses a small grace window so a quick double-press crosses
      // into the previous chapter instead of re-snapping to the current one.
      const target =
        direction > 0
          ? boundaries.find((seconds) => seconds > current + 2)
          : [...boundaries].reverse().find((seconds) => seconds < current - 3);

      if (target === undefined) {
        if (direction < 0) {
          seekToSeconds(0);
        }
        // Already in the last chapter: do nothing rather than jump to the
        // end and accidentally finish the movie.
        return;
      }

      seekToSeconds(target);
    },
    [item, preferredSeekSeconds, seek, seekToSeconds],
  );

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
        await unloadAdaptivePlayer();
        video.src = stream.url;
        video.load();
        return;
      }

      const {ShakaPlayer} = await import(
        '../../w3cmedia/shakaplayer/ShakaPlayer'
      );
      const settings = {
        secure: stream.url.startsWith('https://'),
        abrEnabled: false,
        abrMaxWidth: 3840,
        abrMaxHeight: 2160,
      };

      await unloadAdaptivePlayer();
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
            startTime: startTimeSeconds,
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

      video.addEventListener('playing', () => {
        if (!isCurrentPlayer()) {
          return;
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
        setPaused(true);
        revealControls(false);
      });
      video.addEventListener('loadedmetadata', () => {
        if (!isCurrentPlayer()) {
          return;
        }
        setStatusText('Stream loaded');
        applyPendingInitialSeek(video);
      });
      video.addEventListener('canplay', () => {
        if (!isCurrentPlayer()) {
          return;
        }
        setStatusText('Ready to play');
        applyPendingInitialSeek(video);
      });
      video.addEventListener('waiting', () => {
        if (!isCurrentPlayer()) {
          return;
        }
        revealControls(false);
        setStatusText('Buffering...');
      });
      video.addEventListener('stalled', () => {
        if (!isCurrentPlayer()) {
          return;
        }
        revealControls(false);
        setStatusText('Playback stalled. Buffering...');
      });
      video.addEventListener('timeupdate', () => {
        if (!isCurrentPlayer()) {
          return;
        }
        if (typeof video.currentTime === 'number') {
          latestPositionTicks.current = toTicks(video.currentTime);
          setPositionSeconds(video.currentTime);
        }
      });
      video.addEventListener('error', () => {
        if (!isCurrentPlayer()) {
          return;
        }
        revealControls(false);
        playbackErrorHandler.current();
      });
      video.addEventListener('ended', () => {
        if (!isCurrentPlayer()) {
          return;
        }
        revealControls(false);
        setStatusText('Finished');
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
    keplerAppStateManager,
    playbackRate,
    preferredSeekSeconds,
    unloadAdaptivePlayer,
  ]);

  const addSelectedSubtitleTrack = useCallback(
    (_video: VideoPlayer, stream: JellyfinStreamInfo) => {
      const selectedSubtitle = stream.subtitleTracks.find(
        (track) => track.index === selectedSubtitleIndex.current,
      );

      // External timed text is fetched and rendered by Astra. Vega's native
      // caption view is gated by a device-wide accessibility flag that apps
      // cannot enable, so relying on VideoPlayer.addTextTrack silently hides
      // SRT/SubRip for users whose system caption renderer is disabled.
      if (selectedSubtitle?.burnInRequired || selectedSubtitleBurnIn.current) {
        setStatusText('Playing with burned-in subtitles');
      }
    },
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
          sourceHeight: sourceVideoStream?.height,
          sourceWidth: sourceVideoStream?.width,
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

    // Back dismisses one layer at a time and must not reveal the controls
    // it is about to dismiss.
    if (key !== 'back') {
      revealControls(!settingsPanel && !showExitConfirm);
    }

    // Focusable controls own their Select and directional events while a
    // modal is open. The global playback handler must not also pause, seek,
    // or commit a second action for the key-up phase of the same click.
    if (
      (settingsPanel || showExitConfirm) &&
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
    return () => {
      const handle = surfaceHandle.current;

      reportStopped().finally(async () => {
        clearControlsHideTimer();
        try {
          await unloadAdaptivePlayer();
        } catch (error) {
          console.warn('[Astra] Failed to unload player during exit:', error);
        } finally {
          if (handle) {
            videoRef.current?.clearSurfaceHandle(handle);
          }
          await videoRef.current?.deinitialize();
        }
      });
    };
  }, [clearControlsHideTimer, reportStopped, unloadAdaptivePlayer]);

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

          if (streamInfo.current) {
            reportPlaybackProgress(serverUrl, accessToken, {
              ...streamInfo.current,
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
      if (typeof videoRef.current?.currentTime === 'number') {
        setPositionSeconds(videoRef.current.currentTime);
      }

      if (!streamInfo.current) {
        return;
      }

      reportPlaybackProgress(serverUrl, accessToken, {
        ...streamInfo.current,
        audioStreamIndex: selectedAudioIndex.current,
        isPaused,
        positionTicks: currentPositionTicks(),
        subtitleStreamIndex: selectedSubtitleIndex.current,
      }).catch((error) => {
        console.warn('Failed to report playback progress', error);
      });
    }, 3000);

    return () => clearInterval(interval);
  }, [accessToken, currentPositionTicks, isPaused, serverUrl]);

  useEffect(() => {
    if (!showPlaybackStats) {
      setPlaybackDebugInfo(null);
      return;
    }

    const updateStats = () => {
      const diagnostics = shakaPlayerRef.current?.getDebugStats() as
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
      const currentTime = videoRef.current?.currentTime ?? 0;
      const currentRange = diagnostics?.buffered?.total?.find(
        (range) =>
          range.end >= currentTime && range.start <= currentTime + 0.25,
      );
      const stats = diagnostics?.stats;
      const nativeVideo = videoRef.current as
        | (VideoPlayer & {videoHeight?: number; videoWidth?: number})
        | null;
      let nativeVideoFrames:
        | {droppedVideoFrames?: number; totalVideoFrames?: number}
        | undefined;

      try {
        nativeVideoFrames = videoRef.current?.getVideoPlaybackQuality();
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
        bufferingTimeSeconds: stats?.bufferingTime,
        decodedFrames: nativeVideoFrames?.totalVideoFrames,
        droppedFrames: nativeVideoFrames?.droppedVideoFrames,
        estimatedBandwidth: stats?.estimatedBandwidth,
        streamBandwidth: stats?.streamBandwidth,
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

      try {
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

  const onSurfaceViewDestroyed = useCallback(
    (handle: string) => {
      surfaceHandle.current = null;
      clearControlsHideTimer();
      reportStopped()
        .finally(async () => {
          try {
            await unloadAdaptivePlayer();
          } catch (error) {
            console.warn(
              '[Astra] Failed to unload player after surface removal:',
              error,
            );
          } finally {
            videoRef.current?.clearSurfaceHandle(handle);
            await videoRef.current?.deinitialize();
          }
        })
        .catch((error) => {
          console.warn('[Astra] Failed to tear down video surface:', error);
        });
    },
    [clearControlsHideTimer, reportStopped, unloadAdaptivePlayer],
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
          streamInfo={currentStream}
        />
      ) : null}
      {showPlaybackStats && currentStream ? (
        <PlaybackStatsOverlay
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
  streamInfo,
}: {
  onSelectAudio: (track: JellyfinMediaTrack) => void;
  onSelectSubtitle: (track: JellyfinMediaTrack | null) => void;
  onToggleStats: () => void;
  selectedAudioIndex?: number;
  selectedSubtitleIndex?: number;
  showStats: boolean;
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
            label={`${track.title}${track.burnInRequired ? ' (burn-in)' : ''}`}
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
        <Text style={styles.settingsHint}>
          Shows the stream actually delivered by Jellyfin and live player
          health.
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
  streamInfo,
}: {
  diagnostics: PlaybackDebugInfo | null;
  positionSeconds: number;
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
      {streamInfo.transcodeReasons?.length ? (
        <Text style={styles.statsLine}>
          {`Reason  ${streamInfo.transcodeReasons.join(', ')}`}
        </Text>
      ) : null}
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
