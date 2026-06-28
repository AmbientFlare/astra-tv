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
  JellyfinStreamInfo,
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
  const stoppedReported = useRef(false);
  const [statusText, setStatusText] = useState('Preparing playback...');
  const [isPaused, setPaused] = useState(false);

  const currentPositionTicks = useCallback(() => {
    const currentTime = videoRef.current?.currentTime;

    return toTicks(
      typeof currentTime === 'number' ? currentTime : undefined,
      (item.resumePositionTicks ?? 0) / TICKS_PER_SECOND,
    );
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

  useTVEventHandler((event) => {
    if (event.eventKeyAction === 1) {
      return;
    }

    switch (event.eventType) {
      case 'back':
        handleBack();
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
        const stream = await getStreamUrl(
          serverUrl,
          accessToken,
          item.id,
          userId,
          startTicks,
        );
        streamInfo.current = stream;

        const video = new VideoPlayer();
        videoRef.current = video;
        await video.initialize();
        video.autoplay = false;
        video.defaultSeekIntervalInSec = SEEK_SECONDS;
        video.src = stream.url;
        video.load();

        if (startTicks > 0) {
          video.currentTime = startTicks / TICKS_PER_SECOND;
        }

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
});
