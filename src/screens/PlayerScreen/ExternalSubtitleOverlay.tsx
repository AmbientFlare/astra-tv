import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {activeWebVttText, WebVttCue} from '../../services/subtitles';
import type {UserPreferences} from '../../services/storage';
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
}: {
  cues: WebVttCue[];
  positionStore: PositionStore;
  controlsVisible?: boolean;
  appearance?: UserPreferences['subtitleAppearance'];
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
      <Text
        style={[
          styles.subtitleText,
          appearance === 'background' && styles.subtitleBackground,
        ]}>
        {text}
      </Text>
    </View>
  );
};

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
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '600',
    lineHeight: 38,
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
