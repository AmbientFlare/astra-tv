import React, {useEffect, useRef, useState} from 'react';
import {Animated, Easing, Image, StyleSheet, Text, View} from 'react-native';
import {useTVEventHandler} from '@amazon-devices/react-native-kepler';
import {audioPlayback} from '../../services/audioPlayer';
import {orderedTracks} from '../../services/audioQueue';
import {audioIdleGate} from '../../services/audioIdleGate';

export const AUDIO_IDLE_DELAY_MS = 3 * 60 * 1000;
const ART_CHANGE_MS = 18 * 1000;

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
  const opacity = useRef(new Animated.Value(1)).current;
  const driftX = useRef(new Animated.Value(-230)).current;
  const driftY = useRef(new Animated.Value(-85)).current;
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

    driftX.setValue(-230);
    driftY.setValue(-85);
    const drift = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(driftX, {
            duration: 9000,
            easing: Easing.linear,
            toValue: 210,
            useNativeDriver: true,
          }),
          Animated.timing(driftY, {
            duration: 9000,
            easing: Easing.linear,
            toValue: -40,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(driftX, {
            duration: 7500,
            easing: Easing.linear,
            toValue: 150,
            useNativeDriver: true,
          }),
          Animated.timing(driftY, {
            duration: 7500,
            easing: Easing.linear,
            toValue: 90,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(driftX, {
            duration: 8500,
            easing: Easing.linear,
            toValue: -210,
            useNativeDriver: true,
          }),
          Animated.timing(driftY, {
            duration: 8500,
            easing: Easing.linear,
            toValue: 45,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(driftX, {
            duration: 7000,
            easing: Easing.linear,
            toValue: -230,
            useNativeDriver: true,
          }),
          Animated.timing(driftY, {
            duration: 7000,
            easing: Easing.linear,
            toValue: -85,
            useNativeDriver: true,
          }),
        ]),
      ]),
    );
    drift.start();

    const rotation =
      artwork.length > 1
        ? setInterval(() => {
            Animated.sequence([
              Animated.timing(opacity, {
                duration: 700,
                toValue: 0,
                useNativeDriver: true,
              }),
              Animated.timing(opacity, {
                duration: 700,
                toValue: 1,
                useNativeDriver: true,
              }),
            ]).start();
            setArtIndex((index) => (index + 1) % artwork.length);
          }, ART_CHANGE_MS)
        : null;

    return () => {
      drift.stop();
      if (rotation) {
        clearInterval(rotation);
      }
    };
  }, [artwork.length, driftX, driftY, hasTrack, opacity, visible]);

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
          styles.composition,
          {transform: [{translateX: driftX}, {translateY: driftY}]},
        ]}>
        <Animated.View style={[styles.artFrame, {opacity}]}>
          <Image source={{uri: art}} style={styles.art} />
        </Animated.View>
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
  composition: {alignItems: 'center'},
  title: {
    color: '#eef3f6',
    fontSize: 30,
    fontWeight: '700',
    marginTop: 42,
    maxWidth: 760,
  },
  artist: {color: '#71808d', fontSize: 20, marginTop: 8, maxWidth: 760},
});
