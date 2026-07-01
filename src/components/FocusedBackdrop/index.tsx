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
      return;
    }

    setNextUrl(imageUrl);
    nextOpacity.setValue(0);

    Animated.parallel([
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
    ]).start(() => {
      setCurrentUrl(imageUrl);
      setNextUrl(null);
      currentOpacity.setValue(1);
      nextOpacity.setValue(0);
    });
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
