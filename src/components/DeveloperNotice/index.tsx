import React, {useEffect, useRef, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';

/**
 * Id of the notice currently being shown. Bump this to show a new one-time
 * message; `AppStateConfig.acknowledgedNoticeId` stores the last id dismissed,
 * so an unchanged id stays hidden and a new id appears once.
 */
export const CURRENT_NOTICE_ID = 'vega-os-1.2-apology-2026-08';

export const NOTICE_TITLE = 'A note from the developer';

export const NOTICE_BODY = [
  "I'm sorry for the trouble over the last couple of weeks. The Vega OS 1.2 " +
    'update caught me flat-footed, and playback problems slipped through as a ' +
    'result.',
  'I believe this version has them sorted. Resuming a title, switching audio ' +
    'tracks and turning on burned-in subtitles all work again, and seeking is ' +
    'a great deal faster.',
  'Astra is built and maintained by one person. I will do my best to stay ' +
    'ahead of platform changes, but this one got away from me, and I ' +
    'apologise for the rough stretch.',
  'Thank you for continuing to use Astra.',
];

interface DeveloperNoticeProps {
  onDismiss: () => void;
}

export const DeveloperNotice = ({onDismiss}: DeveloperNoticeProps) => {
  const buttonRef = useRef<any>(null);
  const [isFocused, setFocused] = useState(false);

  // The notice appears after the screen behind it has already claimed focus,
  // and hasTVPreferredFocus alone did not take it back: the first centre press
  // went to the focused item underneath, navigating away instead of
  // dismissing. Request focus explicitly once mounted, matching TVTextInput.
  useEffect(() => {
    const timer = setTimeout(() => {
      buttonRef.current?.requestTVFocus?.();
    }, 120);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.backdrop} testID="developer-notice">
      <TVFocusGuideView
        autoFocus
        trapFocusDown
        trapFocusLeft
        trapFocusRight
        trapFocusUp
        style={styles.card}>
        <Text style={styles.title}>{NOTICE_TITLE}</Text>
        {NOTICE_BODY.map((paragraph) => (
          <Text key={paragraph.slice(0, 24)} style={styles.body}>
            {paragraph}
          </Text>
        ))}
        <Text style={styles.signature}>— Levi</Text>
        <TouchableOpacity
          accessibilityLabel="Dismiss developer notice"
          accessibilityRole="button"
          activeOpacity={1}
          hasTVPreferredFocus
          onBlur={() => setFocused(false)}
          onFocus={() => setFocused(true)}
          onPress={onDismiss}
          ref={buttonRef}
          style={[styles.button, isFocused && styles.buttonFocused]}
          testID="developer-notice-ok">
          <Text style={styles.buttonLabel}>OK</Text>
        </TouchableOpacity>
      </TVFocusGuideView>
    </View>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.82)',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 40,
  },
  card: {
    backgroundColor: '#14161c',
    borderColor: '#2c313d',
    borderRadius: 18,
    borderWidth: 1,
    maxWidth: 900,
    paddingHorizontal: 48,
    paddingVertical: 40,
  },
  title: {
    color: '#ffffff',
    fontSize: 34,
    fontWeight: '700',
    marginBottom: 24,
  },
  body: {
    color: '#c8cddb',
    fontSize: 22,
    lineHeight: 32,
    marginBottom: 18,
  },
  signature: {
    color: '#8f97a8',
    fontSize: 22,
    marginBottom: 32,
  },
  button: {
    alignSelf: 'flex-start',
    backgroundColor: '#2c313d',
    borderRadius: 10,
    paddingHorizontal: 44,
    paddingVertical: 16,
  },
  buttonFocused: {
    backgroundColor: '#4b8dff',
  },
  buttonLabel: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '600',
  },
});
