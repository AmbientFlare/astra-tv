import React, {useCallback, useEffect, useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useTVEventHandler} from '@amazon-devices/react-native-kepler';
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

const TICKS_PER_SECOND = 10000000;
const SEEK_SECONDS = 10;

interface PlayerScreenProps {
  accessToken: string;
  item: JellyfinMediaItem;
  onBack?: () => void;
  serverUrl: string;
  userId?: string;
}

const toTicks = (seconds?: number, fallback = 0) =>
  Math.round((seconds ?? fallback) * TICKS_PER_SECOND);

export const PlayerScreen = ({
  accessToken,
  item,
  onBack,
  serverUrl,
  userId,
}: PlayerScreenProps) => {
  const videoRef = useRef<VideoPlayer | null>(null);
  const surfaceHandle = useRef<string | null>(null);
  const streamInfo = useRef<JellyfinStreamInfo | null>(null);
  const initialized = useRef(false);
  const stoppedReported = useRef(false);
  const selectedAudioIndex = useRef<number | undefined>();
  const selectedBitrate = useRef<number | undefined>();
  const selectedForceTranscode = useRef(false);
  const selectedSubtitleBurnIn = useRef(false);
  const selectedSubtitleIndex = useRef<number | undefined>();
  const latestPositionTicks = useRef(item.resumePositionTicks ?? 0);
  const [currentStream, setCurrentStream] = useState<JellyfinStreamInfo | null>(
    null,
  );
  const [statusText, setStatusText] = useState('Preparing playback...');
  const [isPaused, setPaused] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);

  const currentPositionTicks = useCallback(() => {
    const currentTime = videoRef.current?.currentTime;

    latestPositionTicks.current = toTicks(
      typeof currentTime === 'number' ? currentTime : undefined,
      (item.resumePositionTicks ?? 0) / TICKS_PER_SECOND,
    );

    return latestPositionTicks.current;
  }, [item.resumePositionTicks]);

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
          maxStreamingBitrate: selectedBitrate.current,
          subtitleStreamIndex: selectedSubtitleIndex.current,
        },
      );
      streamInfo.current = stream;
      setCurrentStream(stream);

      const video = videoRef.current ?? new VideoPlayer();
      videoRef.current = video;

      if (!videoRef.current) {
        return stream;
      }

      if (!initialized.current) {
        await video.initialize();
        initialized.current = true;
      } else {
        video.pause();
      }

      video.autoplay = false;
      video.defaultSeekIntervalInSec = SEEK_SECONDS;
      video.src = stream.url;
      video.load();
      video.currentTime = startTicks / TICKS_PER_SECOND;
      video.playbackRate = playbackRate;

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

      if (surfaceHandle.current) {
        video.setSurfaceHandle(surfaceHandle.current);
      }

      return stream;
    },
    [accessToken, item.id, playbackRate, serverUrl, userId],
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
      const stream = await loadStream(currentPositionTicks());
      await reportPlaybackProgress(serverUrl, accessToken, {
        ...stream,
        isPaused,
        positionTicks: currentPositionTicks(),
      });
      videoRef.current?.play();
      setPaused(false);
      setStatusText('Playing');
    },
    [accessToken, currentPositionTicks, isPaused, loadStream, serverUrl],
  );

  useTVEventHandler((event) => {
    if (event.eventKeyAction === 1) {
      return;
    }

    switch (event.eventType) {
      case 'back':
        if (showSettings) {
          setShowSettings(false);
        } else {
          handleBack();
        }
        break;
      case 'menu':
      case 'context_menu':
        setShowSettings((visible) => !visible);
        break;
      case 'playPause':
      case 'playpause':
      case 'select':
        togglePlayPause();
        break;
      case 'right':
      case 'forward':
      case 'skip_forward':
        seek(SEEK_SECONDS);
        break;
      case 'left':
      case 'rewind':
      case 'skip_backward':
        seek(-SEEK_SECONDS);
        break;
    }
  });

  const setSurface = useCallback(() => {
    if (!surfaceHandle.current || !videoRef.current) {
      return;
    }

    videoRef.current.setSurfaceHandle(surfaceHandle.current);
    videoRef.current.play();
    setPaused(false);
    setStatusText('Playing');
  }, []);

  useEffect(() => {
    let mounted = true;
    const startTicks = item.resumePositionTicks ?? 0;

    const initialize = async () => {
      try {
        const stream = await loadStream(startTicks);

        await reportPlaybackStart(serverUrl, accessToken, {
          ...stream,
          positionTicks: startTicks,
          isPaused: false,
        });

        if (mounted) {
          setStatusText('Ready');
          setSurface();
        }
      } catch (error) {
        if (mounted) {
          setStatusText(
            error instanceof Error
              ? error.message
              : 'Unable to start playback.',
          );
        }
      }
    };

    initialize();

    return () => {
      mounted = false;
      reportStopped().finally(() => {
        if (surfaceHandle.current) {
          videoRef.current?.clearSurfaceHandle(surfaceHandle.current);
        }
        videoRef.current?.deinitialize();
      });
    };
  }, [
    accessToken,
    item.id,
    item.resumePositionTicks,
    loadStream,
    reportStopped,
    serverUrl,
    setSurface,
    userId,
  ]);

  useEffect(() => {
    const interval = setInterval(() => {
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
    (handle: string) => {
      surfaceHandle.current = handle;
      setSurface();
    },
    [setSurface],
  );

  const onSurfaceViewDestroyed = useCallback((handle: string) => {
    videoRef.current?.clearSurfaceHandle(handle);
    surfaceHandle.current = null;
  }, []);

  const setSpeed = useCallback((rate: number) => {
    setPlaybackRate(rate);
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
    }
  }, []);

  const seekToChapter = useCallback((startPositionTicks: number) => {
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
    setShowSettings(false);
    setStatusText('Playing');
  }, []);

  return (
    <View style={styles.screen} testID="player-screen">
      <KeplerVideoSurfaceView
        onSurfaceViewCreated={onSurfaceViewCreated}
        onSurfaceViewDestroyed={onSurfaceViewDestroyed}
        scalingmode="fit"
        style={styles.videoSurface}
        testID="player-video-surface"
      />
      <View style={styles.overlay}>
        <Text numberOfLines={1} style={styles.title}>
          {item.name}
        </Text>
        <Text style={styles.status}>{statusText}</Text>
        <View style={styles.controls}>
          <FocusableItem
            focusedStyle={styles.focusedButton}
            onPress={() => seek(-SEEK_SECONDS)}
            style={styles.button}
            testID="player-seek-back">
            <Text style={styles.buttonText}>-10</Text>
          </FocusableItem>
          <FocusableItem
            focusedStyle={styles.focusedButton}
            hasTVPreferredFocus={true}
            onPress={togglePlayPause}
            style={styles.button}
            testID="player-play-pause">
            <Text style={styles.buttonText}>{isPaused ? 'Play' : 'Pause'}</Text>
          </FocusableItem>
          <FocusableItem
            focusedStyle={styles.focusedButton}
            onPress={() => seek(SEEK_SECONDS)}
            style={styles.button}
            testID="player-seek-forward">
            <Text style={styles.buttonText}>+10</Text>
          </FocusableItem>
          <FocusableItem
            focusedStyle={styles.focusedButton}
            onPress={handleBack}
            style={styles.button}
            testID="player-back">
            <Text style={styles.buttonText}>Back</Text>
          </FocusableItem>
        </View>
      </View>
      {showSettings && currentStream ? (
        <PlaybackSettingsOverlay
          onSelectAudio={(track) => reloadWithTrack({audioTrack: track})}
          onSelectQuality={(quality) =>
            reloadWithTrack({
              bitrate: quality.id === 'auto' ? null : quality.bitrate,
              forceTranscode: quality.id !== 'auto' && Boolean(quality.bitrate),
            })
          }
          onSelectSubtitle={(track) => reloadWithTrack({subtitleTrack: track})}
          onSetSpeed={setSpeed}
          onSelectChapter={seekToChapter}
          item={item}
          playbackRate={playbackRate}
          streamInfo={currentStream}
        />
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
  streamInfo,
}: {
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
    <Text style={styles.settingsTitle}>Playback Settings</Text>
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
    <SettingsColumn title="Quality">
      {streamInfo.qualityOptions.map((quality) => (
        <SettingsButton
          key={quality.id}
          label={quality.label || 'Auto'}
          onPress={() => onSelectQuality(quality)}
        />
      ))}
    </SettingsColumn>
    <SettingsColumn title="Speed">
      {[0.5, 1, 1.25, 1.5, 2].map((rate) => (
        <SettingsButton
          key={rate}
          label={`${rate}x${rate === playbackRate ? ' selected' : ''}`}
          onPress={() => onSetSpeed(rate)}
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
