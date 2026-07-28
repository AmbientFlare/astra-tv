import React, {useEffect, useRef, useState} from 'react';
import {Animated, Image, StyleSheet, Text, View} from 'react-native';
import {useTVEventHandler} from '@amazon-devices/react-native-kepler';
import {
  startVideoEngagement,
  stopVideoEngagement,
} from '@astra/user-engagement';
import {AUDIO_IDLE_DELAY_MS} from '../AudioIdleVisual';

interface VideoPauseIdleVisualProps {
  artworkUrl?: string;
  paused: boolean;
  title: string;
}

/** Burn-in protection shown when a movie or episode remains paused. */
export const VideoPauseIdleVisual = ({
  artworkUrl,
  paused,
  title,
}: VideoPauseIdleVisualProps) => {
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const driftX = useRef(new Animated.Value(-45)).current;
  const driftY = useRef(new Animated.Value(-24)).current;

  useEffect(() => {
    if (!paused) {
      stopVideoEngagement();
      return;
    }

    startVideoEngagement();
    return () => {
      stopVideoEngagement();
    };
  }, [paused]);

  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const armTimer = () => {
    clearTimer();
    if (paused) {
      timer.current = setTimeout(() => setVisible(true), AUDIO_IDLE_DELAY_MS);
    }
  };

  useEffect(() => {
    setVisible(false);
    armTimer();
    return clearTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  useTVEventHandler(() => {
    setVisible(false);
    armTimer();
  });

  useEffect(() => {
    if (!visible) {
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(driftX, {
            duration: 14000,
            toValue: 45,
            useNativeDriver: true,
          }),
          Animated.timing(driftY, {
            duration: 14000,
            toValue: 24,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(driftX, {
            duration: 14000,
            toValue: -45,
            useNativeDriver: true,
          }),
          Animated.timing(driftY, {
            duration: 14000,
            toValue: -24,
            useNativeDriver: true,
          }),
        ]),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [driftX, driftY, visible]);

  if (!visible || !paused) {
    return null;
  }

  return (
    <View
      pointerEvents="none"
      style={styles.overlay}
      testID="video-pause-idle-visual">
      <Animated.View
        style={{transform: [{translateX: driftX}, {translateY: driftY}]}}>
        {artworkUrl ? (
          <Image source={{uri: artworkUrl}} style={styles.art} />
        ) : (
          <View style={[styles.art, styles.placeholder]}>
            <Text style={styles.mark}>ASTRA</Text>
          </View>
        )}
      </Animated.View>
      <Text numberOfLines={1} style={styles.title}>
        Paused · {title}
      </Text>
      <Text style={styles.hint}>Press any button to return</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    alignItems: 'center',
    backgroundColor: '#020304',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 1200,
  },
  art: {borderRadius: 18, height: 390, width: 390},
  placeholder: {
    alignItems: 'center',
    backgroundColor: '#101820',
    justifyContent: 'center',
  },
  mark: {color: '#54d38a', fontSize: 44, fontWeight: '900'},
  title: {
    color: '#e7edf2',
    fontSize: 28,
    fontWeight: '700',
    marginTop: 42,
    maxWidth: 820,
  },
  hint: {color: '#596774', fontSize: 16, marginTop: 10},
});
