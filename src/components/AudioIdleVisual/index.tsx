import React, {useEffect, useRef, useState} from 'react';
import {Animated, Easing, Image, StyleSheet, Text, View} from 'react-native';
import {useTVEventHandler} from '@amazon-devices/react-native-kepler';
import {audioPlayback} from '../../services/audioPlayer';
import {orderedTracks} from '../../services/audioQueue';
import {audioIdleGate} from '../../services/audioIdleGate';

export const AUDIO_IDLE_DELAY_MS = 3 * 60 * 1000;
const ART_CHANGE_MS = 30 * 1000;

/**
 * Burn-in protection for audio playback.
 *
 * Vega suppresses its system screensaver while AudioPlayer is active. After
 * three minutes without remote input this overlay replaces static UI with
 * slowly drifting, changing artwork. Any input dismisses it immediately.
 */
export const AudioIdleVisual = () => {
  const [visible, setVisible] = useState(false);
  const [artwork, setArtwork] = useState<string[]>([]);
  const [artIndex, setArtIndex] = useState(0);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const artX = useRef(new Animated.Value(-520)).current;
  const artY = useRef(new Animated.Value(-180)).current;
  const metadataX = useRef(new Animated.Value(380)).current;
  const metadataY = useRef(new Animated.Value(330)).current;
  const hasTrack = artwork.length > 0;

  const clearIdleTimer = () => {
    if (idleTimer.current) {
      clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
  };

  const armIdleTimer = () => {
    clearIdleTimer();
    if (audioPlayback.getStatus().track) {
      idleTimer.current = setTimeout(
        () => setVisible(true),
        AUDIO_IDLE_DELAY_MS,
      );
    }
  };

  useEffect(() => {
    const unsubscribe = audioPlayback.subscribe((status) => {
      const images = orderedTracks(status.queue)
        .map((track) => track.imageUrl)
        .filter((url): url is string => Boolean(url));
      const unique = Array.from(new Set(images));

      setArtwork(unique);
      if (!status.track) {
        clearIdleTimer();
        setVisible(false);
      } else if (!idleTimer.current && !visible) {
        armIdleTimer();
      }
    });

    armIdleTimer();
    return () => {
      unsubscribe();
      clearIdleTimer();
    };
    // Visibility is intentionally not a dependency; input and playback events
    // explicitly control timer re-arming.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismissIdle = () => {
    setVisible(false);
    armIdleTimer();
  };

  useEffect(() => {
    if (visible) {
      audioIdleGate.activate(dismissIdle);
    } else {
      audioIdleGate.deactivate();
    }

    return () => audioIdleGate.deactivate();
    // Timer helpers intentionally use current playback state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useTVEventHandler(() => {
    audioIdleGate.consumeInput();
  });

  useEffect(() => {
    if (!visible || !hasTrack) {
      return;
    }

    artX.setValue(-520);
    artY.setValue(-180);
    metadataX.setValue(380);
    metadataY.setValue(330);

    const artDrift = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(artX, {
            duration: 16000,
            easing: Easing.linear,
            toValue: 500,
            useNativeDriver: true,
          }),
          Animated.timing(artY, {
            duration: 16000,
            easing: Easing.linear,
            toValue: -120,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(artX, {
            duration: 14000,
            easing: Easing.linear,
            toValue: 430,
            useNativeDriver: true,
          }),
          Animated.timing(artY, {
            duration: 14000,
            easing: Easing.linear,
            toValue: 180,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(artX, {
            duration: 17000,
            easing: Easing.linear,
            toValue: -480,
            useNativeDriver: true,
          }),
          Animated.timing(artY, {
            duration: 17000,
            easing: Easing.linear,
            toValue: 130,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(artX, {
            duration: 13000,
            easing: Easing.linear,
            toValue: -520,
            useNativeDriver: true,
          }),
          Animated.timing(artY, {
            duration: 13000,
            easing: Easing.linear,
            toValue: -180,
            useNativeDriver: true,
          }),
        ]),
      ]),
    );

    const metadataDrift = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(metadataX, {
            duration: 15000,
            easing: Easing.linear,
            toValue: -390,
            useNativeDriver: true,
          }),
          Animated.timing(metadataY, {
            duration: 15000,
            easing: Easing.linear,
            toValue: 280,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(metadataX, {
            duration: 18000,
            easing: Easing.linear,
            toValue: -360,
            useNativeDriver: true,
          }),
          Animated.timing(metadataY, {
            duration: 18000,
            easing: Easing.linear,
            toValue: -330,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(metadataX, {
            duration: 14000,
            easing: Easing.linear,
            toValue: 410,
            useNativeDriver: true,
          }),
          Animated.timing(metadataY, {
            duration: 14000,
            easing: Easing.linear,
            toValue: -270,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(metadataX, {
            duration: 17000,
            easing: Easing.linear,
            toValue: 380,
            useNativeDriver: true,
          }),
          Animated.timing(metadataY, {
            duration: 17000,
            easing: Easing.linear,
            toValue: 330,
            useNativeDriver: true,
          }),
        ]),
      ]),
    );

    artDrift.start();
    metadataDrift.start();

    const rotation =
      artwork.length > 1
        ? setInterval(() => {
            setArtIndex((index) => (index + 1) % artwork.length);
          }, ART_CHANGE_MS)
        : null;

    return () => {
      artDrift.stop();
      metadataDrift.stop();
      if (rotation) {
        clearInterval(rotation);
      }
    };
  }, [artX, artY, artwork.length, hasTrack, metadataX, metadataY, visible]);

  if (!visible || !hasTrack) {
    return null;
  }

  const status = audioPlayback.getStatus();
  const art = artwork[artIndex % artwork.length];

  return (
    <View
      pointerEvents="none"
      style={styles.overlay}
      testID="audio-idle-visual">
      <Animated.View
        style={[
          styles.artFrame,
          {transform: [{translateX: artX}, {translateY: artY}]},
        ]}>
        <Image source={{uri: art}} style={styles.art} />
      </Animated.View>
      <Animated.View
        style={[
          styles.metadata,
          {
            transform: [{translateX: metadataX}, {translateY: metadataY}],
          },
        ]}>
        <Text numberOfLines={1} style={styles.title}>
          {status.track?.name}
        </Text>
        <Text numberOfLines={1} style={styles.artist}>
          {status.track?.artistName}
        </Text>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    alignItems: 'center',
    backgroundColor: '#030506',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 1000,
  },
  artFrame: {
    borderRadius: 18,
    elevation: 8,
    height: 390,
    overflow: 'hidden',
    width: 390,
  },
  art: {height: '100%', width: '100%'},
  metadata: {
    alignItems: 'center',
    position: 'absolute',
  },
  title: {
    color: '#eef3f6',
    fontSize: 30,
    fontWeight: '700',
    maxWidth: 760,
  },
  artist: {color: '#71808d', fontSize: 20, marginTop: 8, maxWidth: 760},
});
