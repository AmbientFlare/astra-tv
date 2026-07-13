import React, {useCallback, useEffect, useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
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
  PlaybackTrackSelection,
  reportPlaybackProgress,
  reportPlaybackStart,
  reportPlaybackStopped,
  sanitizeUrlForLog,
} from '../../services/jellyfin';
import type {ShakaPlayer as ShakaPlayerInstance} from '../../w3cmedia/shakaplayer/ShakaPlayer';
import {
  defaultPlaybackPrefs,
  readPlaybackPreferences,
} from '../../services/storage';
import {debugLog} from '../../utils/logger';

const TICKS_PER_SECOND = 10000000;
const CONTROL_HIDE_DELAY_MS = 5000;
// If no frame/segment progresses within this window while playback is
// expected to be running, treat it as a stall. Sized to comfortably clear a
// cold transcode start (ffmpeg spin-up + first segment) so normal buffering
// recovers on its own, while still capping the "server never produced a
// segment" case (e.g. broken HW encode) instead of buffering forever.
const PLAYBACK_STALL_TIMEOUT_MS = 30000;

interface PlayerScreenProps {
  accessToken: string;
  item: JellyfinMediaItem;
  onBack?: () => void;
  serverUrl: string;
  trackSelection?: PlaybackTrackSelection;
  userId?: string;
}

const toTicks = (seconds?: number, fallback = 0) =>
  Math.round((seconds ?? fallback) * TICKS_PER_SECOND);

// For content without embedded chapters, the FF/RW keys jump across this
// many evenly spaced synthetic chapters instead.
const SYNTHETIC_CHAPTER_COUNT = 12;

const isAdaptiveStream = (url: string) =>
  url.includes('.m3u8') || url.includes('.mpd');

const adaptiveStreamLabel = (url: string) =>
  url.includes('.mpd') ? 'DASH' : 'HLS';

// Channel counts map to the same labels the Settings "Audio output" picker
// uses (2.0/2.1/3.1/5.1/7.1), so the overlay reads consistently with the
// preference it's meant to verify.
const channelLayoutLabel = (channels?: number): string => {
  switch (channels) {
    case 1:
      return 'Mono';
    case 2:
      return '2.0';
    case 3:
      return '2.1';
    case 4:
      return '3.1';
    case 6:
      return '5.1';
    case 8:
      return '7.1';
    default:
      return channels ? `${channels}ch` : '';
  }
};

// Codec + channel layout of the audio track being played (e.g. "EAC3 5.1"),
// surfaced in the status overlay so the picked "Audio output" preference can
// be sanity-checked on-device. Reflects the SOURCE track; for a Transcode the
// server may downmix below this per the device profile's MaxAudioChannels cap.
const audioTrackSummary = (
  stream: JellyfinStreamInfo | null,
  selectedIndex?: number,
): string => {
  if (!stream?.audioTracks.length) {
    return '';
  }
  const track: JellyfinMediaTrack | undefined =
    (selectedIndex !== undefined
      ? stream.audioTracks.find(
          (candidate) => candidate.index === selectedIndex,
        )
      : undefined) ??
    stream.audioTracks.find((candidate) => candidate.isDefault) ??
    stream.audioTracks[0];
  if (!track) {
    return '';
  }
  return [track.codec?.toUpperCase(), channelLayoutLabel(track.channels)]
    .filter(Boolean)
    .join(' ');
};

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
  trackSelection,
  userId,
}: PlayerScreenProps) => {
  const videoRef = useRef<VideoPlayer | null>(null);
  const shakaPlayerRef = useRef<ShakaPlayerInstance | null>(null);
  const surfaceHandle = useRef<string | null>(null);
  const streamInfo = useRef<JellyfinStreamInfo | null>(null);
  const stoppedReported = useRef(false);
  const selectedAudioIndex = useRef<number | undefined>(
    trackSelection?.audioStreamIndex,
  );
  const selectedBitrate = useRef<number | undefined>();
  const selectedForceTranscode = useRef(false);
  const selectedSubtitleBurnIn = useRef(false);
  const selectedSubtitleIndex = useRef<number | undefined>(
    trackSelection?.subtitleStreamIndex,
  );
  const playbackEventsAttached = useRef(false);
  const playbackErrorHandler = useRef<() => void>(() => undefined);
  const retriedAfterPlaybackError = useRef(false);
  const watchdogTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchdogExhausted = useRef(false);
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
  const [showExitConfirm, setShowExitConfirm] = useState(false);
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
    });

    return () => {
      mounted = false;
    };
  }, []);

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

  const clearWatchdog = useCallback(() => {
    if (watchdogTimer.current) {
      clearTimeout(watchdogTimer.current);
      watchdogTimer.current = null;
    }
  }, []);

  // Arm (or re-arm) the stall watchdog. Called whenever playback is expected
  // to be progressing but isn't yet (initial load, 'waiting', 'stalled');
  // cleared as soon as a frame progresses ('playing'/'timeupdate') or the
  // user pauses. If it fires, an indefinite buffer is routed through the same
  // path as a hard playback error — first a transcode-fallback retry, then a
  // real on-screen message — so the spinner can't hang forever.
  const armWatchdog = useCallback(() => {
    if (watchdogExhausted.current) {
      return;
    }
    clearWatchdog();
    watchdogTimer.current = setTimeout(() => {
      watchdogTimer.current = null;
      const wasAlreadyRetried = retriedAfterPlaybackError.current;
      debugLog(
        '[Astra] Playback watchdog tripped — no progress within timeout',
      );
      playbackErrorHandler.current();
      // The retry itself also stalled: stop re-arming so a permanently dead
      // stream settles on the give-up message instead of looping.
      if (wasAlreadyRetried) {
        watchdogExhausted.current = true;
      }
    }, PLAYBACK_STALL_TIMEOUT_MS);
  }, [clearWatchdog]);

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
    (targetSeconds: number) => {
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

  const unloadAdaptivePlayer = useCallback(() => {
    shakaPlayerRef.current?.unload();
    shakaPlayerRef.current = null;
  }, []);

  const loadVideoSource = useCallback(
    async (video: VideoPlayer, stream: JellyfinStreamInfo) => {
      if (!isAdaptiveStream(stream.url)) {
        unloadAdaptivePlayer();
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

      unloadAdaptivePlayer();
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
        const dataSummary = JSON.stringify(shakaError?.data ?? []).slice(
          0,
          500,
        );
        console.error(
          '[Astra] Shaka load failed:',
          'code:',
          shakaError?.code,
          'category:',
          shakaError?.category,
          'severity:',
          shakaError?.severity,
          'data:',
          dataSummary,
        );
        throw error instanceof Error
          ? error
          : new Error(
              `Stream engine error ${shakaError?.code ?? 'unknown'} (category ${
                shakaError?.category ?? '?'
              }): ${dataSummary}`,
            );
      }
    },
    [unloadAdaptivePlayer],
  );

  const attachPlaybackEvents = useCallback(
    (video: VideoPlayer) => {
      if (playbackEventsAttached.current) {
        return;
      }

      video.addEventListener('playing', () => {
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
        const audio = audioTrackSummary(
          streamInfo.current,
          selectedAudioIndex.current,
        );
        setStatusText(
          `Playing (${streamInfo.current?.playMethod ?? 'stream'}${resolution}${
            audio ? ` • ${audio}` : ''
          })`,
        );
        clearWatchdog();
        scheduleControlsHide();
      });
      video.addEventListener('pause', () => {
        setPaused(true);
        clearWatchdog();
        revealControls(false);
      });
      video.addEventListener('loadedmetadata', () => {
        setStatusText('Stream loaded');
        applyPendingInitialSeek(video);
      });
      video.addEventListener('canplay', () => {
        setStatusText('Ready to play');
        applyPendingInitialSeek(video);
      });
      video.addEventListener('waiting', () => {
        revealControls(false);
        setStatusText('Buffering...');
        armWatchdog();
      });
      video.addEventListener('stalled', () => {
        revealControls(false);
        setStatusText('Playback stalled. Buffering...');
        armWatchdog();
      });
      video.addEventListener('timeupdate', () => {
        if (typeof video.currentTime === 'number') {
          latestPositionTicks.current = toTicks(video.currentTime);
          setPositionSeconds(video.currentTime);
          // A frame advanced, so whatever we were waiting on resolved.
          clearWatchdog();
        }
      });
      video.addEventListener('error', () => {
        revealControls(false);
        clearWatchdog();
        playbackErrorHandler.current();
      });
      video.addEventListener('ended', () => {
        revealControls(false);
        clearWatchdog();
        setStatusText('Finished');
      });
      playbackEventsAttached.current = true;
    },
    [
      applyPendingInitialSeek,
      armWatchdog,
      clearWatchdog,
      revealControls,
      scheduleControlsHide,
    ],
  );

  const addSelectedSubtitleTrack = useCallback(
    (video: VideoPlayer, stream: JellyfinStreamInfo) => {
      const selectedExternalSubtitle = stream.subtitleTracks.find(
        (track) =>
          track.index === selectedSubtitleIndex.current && track.deliveryUrl,
      );

      if (
        selectedExternalSubtitle?.deliveryUrl &&
        !selectedExternalSubtitle.burnInRequired
      ) {
        const textTrack = video.addTextTrack(
          'subtitles',
          selectedExternalSubtitle.title,
          selectedExternalSubtitle.language,
          selectedExternalSubtitle.deliveryUrl,
          selectedExternalSubtitle.mimeType ?? 'text/vtt',
        );
        textTrack.mode = 'showing';
      } else if (selectedSubtitleBurnIn.current) {
        setStatusText('Playing with burned-in subtitles');
      }
    },
    [],
  );

  const loadStream = useCallback(
    async (startTicks = latestPositionTicks.current) => {
      const stream = await getStreamUrl(
        serverUrl,
        accessToken,
        item.id,
        userId,
        startTicks,
        {
          audioStreamIndex: selectedAudioIndex.current,
          alwaysBurnInSubtitleWhenTranscoding: selectedSubtitleBurnIn.current,
          forceTranscode: selectedForceTranscode.current,
          maxStreamingBitrate: selectedBitrate.current ?? preferredMaxBitrate,
          subtitleStreamIndex: selectedSubtitleIndex.current,
        },
      );
      debugLog(
        '[Astra] Stream URL parts:',
        'transcodeUrl:',
        sanitizeUrlForLog(stream.transcodeUrl),
        'url:',
        sanitizeUrlForLog(stream.url),
      );
      debugLog(
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
      }
      setPositionSeconds(startTicks / TICKS_PER_SECOND);
      setStatusText(
        stream.playMethod === 'Transcode'
          ? isAdaptiveStream(stream.url)
            ? `Loading ${adaptiveStreamLabel(stream.url)} transcode...`
            : 'Loading transcoded MP4 stream...'
          : 'Loading direct stream...',
      );
      assertPlayableUrl(stream.url);

      return stream;
    },
    [accessToken, item.id, preferredMaxBitrate, serverUrl, userId],
  );

  playbackErrorHandler.current = () => {
    if (retriedAfterPlaybackError.current) {
      setStatusText(
        'Playback failed. Try another quality in Playback settings.',
      );
      return;
    }

    retriedAfterPlaybackError.current = true;
    selectedForceTranscode.current = true;
    selectedBitrate.current = selectedBitrate.current ?? 8000000;
    setStatusText('Playback failed. Retrying with transcoding...');
    const positionTicks = currentPositionTicks();
    loadStream(positionTicks)
      .then((stream) => {
        const video = videoRef.current;

        if (video) {
          video.pause();
          return loadVideoSource(video, stream).then(() => {
            video.currentTime = positionTicks / TICKS_PER_SECOND;
            addSelectedSubtitleTrack(video, stream);
            video.play();
            setPaused(false);
            armWatchdog();
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
      revealControls(!showExitConfirm);
    }

    switch (event.eventType) {
      case 'back':
        if (showExitConfirm) {
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
        revealControls(true);
        break;
      case 'playPause':
      case 'playpause':
        togglePlayPause();
        break;
      case 'select':
        if (!showControls && !showExitConfirm) {
          revealControls(true);
          break;
        }
        togglePlayPause();
        break;
      case 'right':
      case 'right_up':
        seek(preferredSeekSeconds);
        break;
      case 'forward':
      case 'skip_forward':
        jumpChapter(1);
        break;
      case 'left':
      case 'left_up':
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

      clearWatchdog();
      reportStopped().finally(() => {
        clearControlsHideTimer();
        unloadAdaptivePlayer();
        if (handle) {
          videoRef.current?.clearSurfaceHandle(handle);
        }
        videoRef.current?.deinitialize();
      });
    };
  }, [
    clearControlsHideTimer,
    clearWatchdog,
    reportStopped,
    unloadAdaptivePlayer,
  ]);

  useEffect(() => {
    const subscription = keplerAppStateManager.addAppStateListener(
      'change',
      (nextState) => {
        debugLog('[Astra] Player app state changed:', nextState);

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

  const onSurfaceViewCreated = useCallback(
    async (handle: string) => {
      surfaceHandle.current = handle;
      const startTicks = item.resumePositionTicks ?? 0;
      const startSeconds = startTicks / TICKS_PER_SECOND;
      const video = videoRef.current ?? new VideoPlayer();
      videoRef.current = video;

      try {
        setStatusText('Preparing playback...');
        // Fresh playback attempt on this surface — let the stall watchdog
        // arm again even if a previous attempt had exhausted it.
        watchdogExhausted.current = false;
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
        attachPlaybackEvents(video);
        video.setSurfaceHandle(handle);

        const stream = await loadStream(0);

        video.autoplay = false;
        video.defaultSeekIntervalInSec = preferredSeekSeconds;
        video.playbackRate = playbackRate;
        pendingInitialSeekSeconds.current =
          startSeconds > 0 ? startSeconds : null;
        initialSeekApplied.current = false;
        await loadVideoSource(video, stream);
        addSelectedSubtitleTrack(video, stream);
        video.play();
        setPaused(false);
        armWatchdog();
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
      armWatchdog,
      attachPlaybackEvents,
      item.resumePositionTicks,
      keplerAppStateManager,
      loadVideoSource,
      loadStream,
      playbackRate,
      preferredSeekSeconds,
      scheduleControlsHide,
      serverUrl,
    ],
  );

  const onSurfaceViewDestroyed = useCallback(
    (handle: string) => {
      videoRef.current?.clearSurfaceHandle(handle);
      unloadAdaptivePlayer();
      videoRef.current?.deinitialize();
      surfaceHandle.current = null;
      clearControlsHideTimer();
      clearWatchdog();
      reportStopped();
    },
    [
      clearControlsHideTimer,
      clearWatchdog,
      reportStopped,
      unloadAdaptivePlayer,
    ],
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
  const controlsVisible = showControls || showExitConfirm;

  return (
    <View style={styles.screen} testID="player-screen">
      <KeplerVideoSurfaceView
        onSurfaceViewCreated={onSurfaceViewCreated}
        onSurfaceViewDestroyed={onSurfaceViewDestroyed}
        scalingmode="fit"
        style={styles.videoSurface}
        testID="player-video-surface"
      />
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

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#000000',
  },
  videoSurface: {
    ...StyleSheet.absoluteFillObject,
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
});
