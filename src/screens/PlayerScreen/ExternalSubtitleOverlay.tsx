import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {activeWebVttText, WebVttCue} from '../../services/subtitles';
import type {
  SubtitleColor,
  SubtitleSize,
  UserPreferences,
} from '../../services/storage';
import type {PositionStore} from './positionStore';

/**
 * Renders external WebVTT cues off the position store rather than off React
 * state, so a playhead tick that does not change the visible cue costs no
 * render anywhere — and one that does re-renders only this overlay.
 */
export const ExternalSubtitleOverlay = ({
  cues,
  positionStore,
  controlsVisible = false,
  appearance = 'shadow',
  size = 'medium',
  color = 'white',
}: {
  cues: WebVttCue[];
  positionStore: PositionStore;
  controlsVisible?: boolean;
  appearance?: UserPreferences['subtitleAppearance'];
  size?: SubtitleSize;
  color?: SubtitleColor;
}) => {
  const [text, setText] = useState(() =>
    activeWebVttText(cues, positionStore.get()),
  );

  useEffect(() => {
    setText(activeWebVttText(cues, positionStore.get()));
    if (cues.length === 0) {
      return undefined;
    }
    return positionStore.subscribe((seconds) => {
      const next = activeWebVttText(cues, seconds);
      setText((current) => (current === next ? current : next));
    });
  }, [cues, positionStore]);

  if (!text) {
    return null;
  }

  return (
    <View
      pointerEvents="none"
      style={[
        styles.subtitleOverlay,
        controlsVisible && styles.subtitleAboveControls,
      ]}
      testID="player-external-subtitle">
      <SubtitleText appearance={appearance} size={size} color={color}>
        {text}
      </SubtitleText>
    </View>
  );
};

const SIZES: Record<SubtitleSize, {fontSize: number; lineHeight: number}> = {
  small: {fontSize: 24, lineHeight: 31},
  medium: {fontSize: 30, lineHeight: 38},
  large: {fontSize: 38, lineHeight: 48},
  extraLarge: {fontSize: 48, lineHeight: 60},
};

const COLORS: Record<SubtitleColor, string> = {
  white: '#FFFFFF',
  gray: '#D2D2D2',
  yellow: '#FFE600',
  green: '#7CFC7C',
  cyan: '#5CE1FF',
};

/** Subtitle text as the viewer set it up; Settings previews with this too. */
export const SubtitleText = ({
  appearance,
  children,
  color,
  size,
}: React.PropsWithChildren<{
  appearance: UserPreferences['subtitleAppearance'];
  color: SubtitleColor;
  size: SubtitleSize;
}>) => (
  <Text
    style={[
      styles.subtitleText,
      SIZES[size] ?? SIZES.medium,
      {color: COLORS[color] ?? COLORS.white},
      appearance === 'background' && styles.subtitleBackground,
    ]}>
    {children}
  </Text>
);

const styles = StyleSheet.create({
  subtitleOverlay: {
    position: 'absolute',
    alignItems: 'center',
    bottom: 84,
    left: 72,
    right: 72,
    zIndex: 2,
  },
  subtitleText: {
    backgroundColor: 'transparent',
    fontWeight: '600',
    paddingHorizontal: 12,
    paddingVertical: 5,
    textAlign: 'center',
    textShadowColor: '#000000',
    textShadowOffset: {width: 0, height: 1},
    textShadowRadius: 3,
  },
  subtitleBackground: {
    backgroundColor: 'rgba(0,0,0,0.78)',
    borderRadius: 5,
    textShadowRadius: 0,
  },
  subtitleAboveControls: {
    bottom: 240,
  },
});
