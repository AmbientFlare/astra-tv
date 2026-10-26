import React, {useEffect, useRef, useState} from 'react';
import {Animated, ImageStyle, StyleSheet, View} from 'react-native';

interface FocusedBackdropProps {
  imageUrl?: string | null;
}

export const FocusedBackdrop = ({imageUrl}: FocusedBackdropProps) => {
  const [currentUrl, setCurrentUrl] = useState<string | null>(imageUrl ?? null);
  const [nextUrl, setNextUrl] = useState<string | null>(null);
  const currentOpacity = useRef(new Animated.Value(imageUrl ? 1 : 0)).current;
  const nextOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!imageUrl || imageUrl === currentUrl) {
      // Settle any fade the last change left half done.
      if (currentUrl) {
        currentOpacity.setValue(1);
      }
      nextOpacity.setValue(0);
      setNextUrl(null);
      return;
    }

    setNextUrl(imageUrl);
    nextOpacity.setValue(0);

    const fade = Animated.parallel([
      Animated.timing(currentOpacity, {
        duration: 240,
        toValue: 0,
        useNativeDriver: true,
      }),
      Animated.timing(nextOpacity, {
        duration: 240,
        toValue: 1,
        useNativeDriver: true,
      }),
    ]);

    fade.start(({finished}) => {
      // A fade cut short means a newer image or an unmount took over. Swapping
      // sources then repointed views that were already moving on, or gone.
      if (!finished) {
        return;
      }

      setCurrentUrl(imageUrl);
      setNextUrl(null);
      currentOpacity.setValue(1);
      nextOpacity.setValue(0);
    });

    return () => fade.stop();
  }, [currentOpacity, currentUrl, imageUrl, nextOpacity]);

  return (
    <View pointerEvents="none" style={styles.container}>
      {currentUrl ? (
        <Animated.Image
          blurRadius={6}
          resizeMode="cover"
          source={{uri: currentUrl}}
          style={[styles.image, {opacity: currentOpacity}] as ImageStyle[]}
        />
      ) : null}
      {nextUrl ? (
        <Animated.Image
          blurRadius={6}
          resizeMode="cover"
          source={{uri: nextUrl}}
          style={[styles.image, {opacity: nextOpacity}] as ImageStyle[]}
        />
      ) : null}
      <View style={styles.overlay} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
  },
  image: {
    ...StyleSheet.absoluteFillObject,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(12,17,22,0.52)',
  },
});
