import React, {useCallback, useEffect, useRef, useState} from 'react';
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
  JellyfinQualityOption,
  reportPlaybackProgress,
  reportPlaybackStart,
  reportPlaybackStopped,
} from '../../services/jellyfin';
import type {ShakaPlayer as ShakaPlayerInstance} from '../../w3cmedia/shakaplayer/ShakaPlayer';
import {
  defaultPlaybackPrefs,
  readPlaybackPreferences,
} from '../../services/storage';

const TICKS_PER_SECOND = 10000000;
const CONTROL_HIDE_DELAY_MS = 5000;
type PlaybackPanel = 'audio' | 'subtitles' | 'quality' | 'speed' | 'chapters';

interface PlayerScreenProps {
  accessToken: string;
  item: JellyfinMediaItem;
  onBack?: () => void;
  serverUrl: string;
  userId?: string;
}

const toTicks = (seconds?: number, fallback = 0) =>
  Math.round((seconds ?? fallback) * TICKS_PER_SECOND);

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
  const selectedBitrate = useRef<number | undefined>();
  const selectedForceTranscode = useRef(false);
  const selectedSubtitleBurnIn = useRef(false);
  const selectedSubtitleIndex = useRef<number | undefined>();
  const playbackEventsAttached = useRef(false);
  const playbackErrorHandler = useRef<() => void>(() => undefined);
  const retriedAfterPlaybackError = useRef(false);
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
  const [selectedQualityId, setSelectedQualityId] = useState('auto');
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
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

    latestPositionTicks.current = toTicks(
      typeof currentTime === 'number' && Number.isFinite(currentTime)
        ? currentTime
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
        setStatusText(
          `Playing (${streamInfo.current?.playMethod ?? 'stream'})`,
        );
        scheduleControlsHide();
      });
      video.addEventListener('pause', () => {
        setPaused(true);
        revealControls(false);
      });
      video.addEventListener('loadedmetadata', () => {
        setStatusText('Stream loaded');
      });
      video.addEventListener('canplay', () => {
        setStatusText('Ready to play');
      });
      video.addEventListener('waiting', () => {
        revealControls(false);
        setStatusText('Buffering...');
      });
      video.addEventListener('stalled', () => {
        revealControls(false);
        setStatusText('Playback stalled. Buffering...');
      });
      video.addEventListener('timeupdate', () => {
        if (typeof video.currentTime === 'number') {
          latestPositionTicks.current = toTicks(video.currentTime);
          setPositionSeconds(video.currentTime);
        }
      });
      video.addEventListener('error', () => {
        revealControls(false);
        playbackErrorHandler.current();
      });
      video.addEventListener('ended', () => {
        revealControls(false);
        setStatusText('Finished');
      });
      playbackEventsAttached.current = true;
    },
    [revealControls, scheduleControlsHide],
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
      console.log(
        '[Astra] Stream URL parts:',
        'transcodeUrl:',
        stream.transcodeUrl,
        'url:',
        stream.url,
      );
      console.log(
        '[Astra] Stream URL:',
        stream.url,
        '| PlayMethod:',
        stream.playMethod,
      );
      streamInfo.current = stream;
      setCurrentStream(stream);
      if (
        selectedAudioIndex.current === undefined &&
        stream.audioTracks.length
      ) {
        const defaultTrack =
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
    [accessToken, item.id, preferredMaxBitrate, serverUrl, userId],
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
      selectedAudioIndex.current =
        audioTrack?.index ?? selectedAudioIndex.current;
      if (audioTrack?.index !== undefined) {
        setSelectedAudioTrackIndex(audioTrack.index);
      }
      if (bitrate !== undefined) {
        selectedBitrate.current = bitrate ?? undefined;
        setSelectedQualityId(
          bitrate === null ? 'auto' : String(bitrate ?? 'auto'),
        );
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
      setStatusText('Buffering stream...');
      const positionTicks = currentPositionTicks();
      const stream = await loadStream(positionTicks);
      const video = videoRef.current;

      if (video) {
        video.pause();
        await loadVideoSource(video, stream);
        video.currentTime = positionTicks / TICKS_PER_SECOND;
        addSelectedSubtitleTrack(video, stream);
        video.play();
        setPaused(false);
        scheduleControlsHide();
        setStatusText('Playing');
      }

      await reportPlaybackProgress(serverUrl, accessToken, {
        ...stream,
        audioStreamIndex: selectedAudioIndex.current,
        isPaused,
        positionTicks,
        subtitleStreamIndex: selectedSubtitleIndex.current,
      });
    },
    [
      accessToken,
      addSelectedSubtitleTrack,
      currentPositionTicks,
      isPaused,
      loadVideoSource,
      loadStream,
      scheduleControlsHide,
      serverUrl,
    ],
  );

  playbackErrorHandler.current = () => {
    if (retriedAfterPlaybackError.current) {
      setStatusText('Playback failed. Open settings and try another quality.');
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
    const key = `${event.eventType}:${event.eventKeyAction ?? 'none'}`;

    if (
      lastHandledKeyEvent.current.type === key &&
      now - lastHandledKeyEvent.current.time < 350
    ) {
      return;
    }
    lastHandledKeyEvent.current = {time: now, type: key};

    revealControls(!settingsPanel && !showExitConfirm);

    switch (event.eventType) {
      case 'back':
        if (settingsPanel) {
          setSettingsPanel(null);
        } else if (showExitConfirm) {
          setShowExitConfirm(false);
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
        if (!showControls && !settingsPanel && !showExitConfirm) {
          revealControls(true);
          break;
        }
        togglePlayPause();
        break;
      case 'right':
      case 'right_up':
      case 'forward':
      case 'skip_forward':
        seek(preferredSeekSeconds);
        break;
      case 'left':
      case 'left_up':
      case 'rewind':
      case 'skip_backward':
        seek(-preferredSeekSeconds);
        break;
    }
  });

  useEffect(() => {
    return () => {
      const handle = surfaceHandle.current;

      reportStopped().finally(() => {
        clearControlsHideTimer();
        unloadAdaptivePlayer();
        if (handle) {
          videoRef.current?.clearSurfaceHandle(handle);
        }
        videoRef.current?.deinitialize();
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
              console.warn('Failed to report background playback progress', error);
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
    }, 10000);

    return () => clearInterval(interval);
  }, [accessToken, currentPositionTicks, isPaused, serverUrl]);

  const onSurfaceViewCreated = useCallback(
    async (handle: string) => {
      surfaceHandle.current = handle;
      const startTicks = item.resumePositionTicks ?? 0;
      const video = videoRef.current ?? new VideoPlayer();
      videoRef.current = video;

      try {
        setStatusText('Preparing playback...');
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

        const stream = await loadStream(startTicks);

        video.autoplay = false;
        video.defaultSeekIntervalInSec = preferredSeekSeconds;
        video.playbackRate = playbackRate;
        await loadVideoSource(video, stream);
        video.currentTime = startTicks / TICKS_PER_SECOND;
        addSelectedSubtitleTrack(video, stream);
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
      attachPlaybackEvents,
      item.resumePositionTicks,
      keplerAppStateManager,
      loadVideoSource,
      loadStream,
      playbackRate,
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
      reportStopped();
    },
    [clearControlsHideTimer, reportStopped, unloadAdaptivePlayer],
  );

  const setSpeed = useCallback((rate: number) => {
    setPlaybackRate(rate);
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
    }
  }, []);

  const seekToChapter = useCallback(
    (startPositionTicks: number) => {
      seekToSeconds(startPositionTicks / TICKS_PER_SECOND, true);
    },
    [seekToSeconds],
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
          activePanel={settingsPanel}
          onSelectAudio={(track) => reloadWithTrack({audioTrack: track})}
          onSelectQuality={(quality) => {
            const forceQualityTranscode =
              quality.id !== 'auto' &&
              quality.id !== 'source' &&
              Boolean(quality.bitrate);

            reloadWithTrack({
              bitrate:
                quality.id === 'auto' || quality.id === 'source'
                  ? null
                  : quality.bitrate,
              forceTranscode: forceQualityTranscode,
            });
          }}
          onSelectSubtitle={(track) => reloadWithTrack({subtitleTrack: track})}
          onSetSpeed={setSpeed}
          onSelectChapter={seekToChapter}
          item={item}
          playbackRate={playbackRate}
          selectedAudioIndex={selectedAudioTrackIndex}
          selectedQualityId={selectedQualityId}
          selectedSubtitleIndex={selectedSubtitleTrackIndex}
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

const PlaybackSettingsOverlay = ({
  item,
  onSelectChapter,
  onSelectAudio,
  onSelectQuality,
  onSelectSubtitle,
  onSetSpeed,
  playbackRate,
  selectedAudioIndex,
  selectedQualityId,
  selectedSubtitleIndex,
  streamInfo,
}: {
  activePanel: PlaybackPanel;
  item: JellyfinMediaItem;
  onSelectChapter: (startPositionTicks: number) => void;
  onSelectAudio: (track: JellyfinMediaTrack) => void;
  onSelectQuality: (quality: JellyfinQualityOption) => void;
  onSelectSubtitle: (track: JellyfinMediaTrack | null) => void;
  onSetSpeed: (rate: number) => void;
  playbackRate: number;
  selectedAudioIndex?: number;
  selectedQualityId: string;
  selectedSubtitleIndex?: number;
  streamInfo: JellyfinStreamInfo;
}) => (
  <View style={styles.settingsOverlay} testID="player-settings-overlay">
    <Text style={styles.settingsTitle}>Playback Options</Text>
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
      <SettingsColumn title="Quality">
        {streamInfo.qualityOptions.map((quality) => (
          <SettingsButton
            key={quality.id}
            label={quality.label || 'Auto'}
            onPress={() => onSelectQuality(quality)}
            selected={
              quality.id === selectedQualityId ||
              (quality.id === 'auto' && selectedQualityId === 'auto')
            }
          />
        ))}
      </SettingsColumn>
      <SettingsColumn title="Speed">
        {[0.5, 1, 1.25, 1.5, 2].map((rate) => (
          <SettingsButton
            key={rate}
            label={`${rate}x`}
            onPress={() => onSetSpeed(rate)}
            selected={rate === playbackRate}
          />
        ))}
      </SettingsColumn>
      {item.chapters?.length ? (
        <SettingsColumn title="Chapters">
          {item.chapters.map((chapter) => (
            <SettingsButton
              key={`${chapter.startPositionTicks}-${chapter.name}`}
              label={chapter.name}
              onPress={() => onSelectChapter(chapter.startPositionTicks)}
            />
          ))}
        </SettingsColumn>
      ) : null}
    </View>
  </View>
);

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
});
