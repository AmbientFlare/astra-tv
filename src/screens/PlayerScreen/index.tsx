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
  JellyfinQualityOption,
  reportPlaybackProgress,
  reportPlaybackStart,
  reportPlaybackStopped,
} from '../../services/jellyfin';
import type {ShakaPlayer as ShakaPlayerInstance} from '../../w3cmedia/shakaplayer/ShakaPlayer';
import {
  defaultUserPreferences,
  getUserPreferences,
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
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [positionSeconds, setPositionSeconds] = useState(
    (item.resumePositionTicks ?? 0) / TICKS_PER_SECOND,
  );
  const [preferredSeekSeconds, setPreferredSeekSeconds] = useState(
    defaultUserPreferences.seekDurationSeconds,
  );
  const [preferredMaxBitrate, setPreferredMaxBitrate] = useState<
    number | undefined
  >(undefined);

  useEffect(() => {
    let mounted = true;

    getUserPreferences().then((preferences) => {
      if (!mounted) {
        return;
      }

      setPreferredSeekSeconds(preferences.seekDurationSeconds);
      setPreferredMaxBitrate(
        preferences.maxStreamingBitrate === 'auto'
          ? undefined
          : Number(preferences.maxStreamingBitrate),
      );
    });

    return () => {
      mounted = false;
    };
  }, []);

  const currentPositionTicks = useCallback(() => {
    const currentTime = videoRef.current?.currentTime;

    latestPositionTicks.current = toTicks(
      typeof currentTime === 'number' ? currentTime : undefined,
      (item.resumePositionTicks ?? 0) / TICKS_PER_SECOND,
    );

    return latestPositionTicks.current;
  }, [item.resumePositionTicks]);

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
      positionTicks: currentPositionTicks(),
    });
  }, [accessToken, currentPositionTicks, serverUrl]);

  const handleBack = useCallback(() => {
    reportStopped().finally(() => {
      onBack?.();
    });
  }, [onBack, reportStopped]);

  const seek = useCallback((seconds: number) => {
    const video = videoRef.current;

    if (!video || typeof video.currentTime !== 'number') {
      return;
    }

    const duration = typeof video.duration === 'number' ? video.duration : 0;
    const target = Math.max(
      0,
      duration > 0
        ? Math.min(duration, video.currentTime + seconds)
        : video.currentTime + seconds,
    );

    video.currentTime = target;
    if (video.paused) {
      video.play();
      setPaused(false);
    }
  }, []);

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
      selectedSubtitleBurnIn.current =
        subtitleTrack === null ? false : Boolean(subtitleTrack?.burnInRequired);
      if (selectedSubtitleBurnIn.current) {
        selectedForceTranscode.current = true;
      }
      setStatusText('Switching stream...');
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
        setStatusText('Starting video...');
      }

      await reportPlaybackProgress(serverUrl, accessToken, {
        ...stream,
        isPaused,
        positionTicks,
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
              isPaused: false,
              positionTicks,
            });
          });
        }

        return reportPlaybackProgress(serverUrl, accessToken, {
          ...stream,
          isPaused: false,
          positionTicks,
        });
      })
      .catch((error) => {
        setStatusText(
          error instanceof Error ? error.message : 'Playback retry failed.',
        );
      });
  };

  useTVEventHandler((event) => {
    if (event.eventKeyAction === 1) {
      return;
    }

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
        setSettingsPanel((panel) => (panel ? null : 'quality'));
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
      case 'forward':
      case 'skip_forward':
        seek(preferredSeekSeconds);
        break;
      case 'left':
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
    const interval = setInterval(() => {
      if (typeof videoRef.current?.currentTime === 'number') {
        setPositionSeconds(videoRef.current.currentTime);
      }

      if (!streamInfo.current) {
        return;
      }

      reportPlaybackProgress(serverUrl, accessToken, {
        ...streamInfo.current,
        isPaused,
        positionTicks: currentPositionTicks(),
      }).catch((error) => {
        console.warn('Failed to report playback progress', error);
      });
    }, 30000);

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
          positionTicks: startTicks,
          isPaused: false,
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
      const video = videoRef.current;

      if (!video) {
        return;
      }

      video.currentTime = startPositionTicks / TICKS_PER_SECOND;
      latestPositionTicks.current = startPositionTicks;
      if (video.paused) {
        video.play();
        setPaused(false);
      }
      setSettingsPanel(null);
      scheduleControlsHide();
      setStatusText('Playing');
    },
    [scheduleControlsHide],
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
  activePanel,
  item,
  onSelectChapter,
  onSelectAudio,
  onSelectQuality,
  onSelectSubtitle,
  onSetSpeed,
  playbackRate,
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
  streamInfo: JellyfinStreamInfo;
}) => (
  <View style={styles.settingsOverlay} testID="player-settings-overlay">
    {activePanel === 'audio' ? (
      <SettingsColumn title="Audio">
        {streamInfo.audioTracks.length ? (
          streamInfo.audioTracks.map((track) => (
            <SettingsButton
              key={track.id}
              label={track.title}
              onPress={() => onSelectAudio(track)}
            />
          ))
        ) : (
          <Text style={styles.settingsEmpty}>Default audio</Text>
        )}
      </SettingsColumn>
    ) : null}
    {activePanel === 'subtitles' ? (
      <SettingsColumn title="Subtitles">
        <SettingsButton label="Off" onPress={() => onSelectSubtitle(null)} />
        {streamInfo.subtitleTracks.map((track) => (
          <SettingsButton
            key={track.id}
            label={`${track.title}${track.burnInRequired ? ' (burn-in)' : ''}`}
            onPress={() => onSelectSubtitle(track)}
          />
        ))}
      </SettingsColumn>
    ) : null}
    {activePanel === 'quality' ? (
      <SettingsColumn title="Quality">
        {streamInfo.qualityOptions.map((quality) => (
          <SettingsButton
            key={quality.id}
            label={quality.label || 'Auto'}
            onPress={() => onSelectQuality(quality)}
          />
        ))}
      </SettingsColumn>
    ) : null}
    {activePanel === 'speed' ? (
      <SettingsColumn title="Speed">
        {[0.5, 1, 1.25, 1.5, 2].map((rate) => (
          <SettingsButton
            key={rate}
            label={`${rate}x${rate === playbackRate ? ' selected' : ''}`}
            onPress={() => onSetSpeed(rate)}
          />
        ))}
      </SettingsColumn>
    ) : null}
    {activePanel === 'chapters' && item.chapters?.length ? (
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
);

const SettingsColumn = ({
  children,
  title,
}: React.PropsWithChildren<{title: string}>) => (
  <View style={styles.settingsColumn}>
    <Text style={styles.settingsHeading}>{title}</Text>
    {children}
  </View>
);

const SettingsButton = ({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) => (
  <FocusableItem
    focusedStyle={styles.settingsButtonFocused}
    onPress={onPress}
    style={styles.settingsButton}>
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
    right: 44,
    width: 520,
    maxHeight: 640,
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
  settingsColumn: {
    marginBottom: 18,
  },
  settingsHeading: {
    color: '#89CFF0',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 8,
  },
  settingsButton: {
    height: 42,
    borderRadius: 8,
    backgroundColor: '#25313A',
    justifyContent: 'center',
    marginBottom: 8,
    paddingHorizontal: 12,
  },
  settingsButtonFocused: {
    backgroundColor: '#2E5A72',
  },
  settingsButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  settingsEmpty: {
    color: '#B8C5CC',
    fontSize: 18,
  },
});
