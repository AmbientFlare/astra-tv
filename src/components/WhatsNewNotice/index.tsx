import React, {useEffect, useRef, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';

import {APP_VERSION} from '../../config/app';
import {CURRENT_NOTICE_ID, RELEASE_HIGHLIGHTS} from '../../config/releaseNotes';

/**
 * Shown once after an update, then never again for that version.
 * `AppStateConfig.acknowledgedNoticeId` stores the last id dismissed and
 * `CURRENT_NOTICE_ID` is derived from the app version, so a release announces
 * itself without anyone remembering to bump an id by hand.
 */
export {CURRENT_NOTICE_ID};

export const NOTICE_TITLE = `What's new in Astra ${APP_VERSION}`;

export const NOTICE_BODY = RELEASE_HIGHLIGHTS;

interface WhatsNewNoticeProps {
  onDismiss: () => void;
}

export const WhatsNewNotice = ({onDismiss}: WhatsNewNoticeProps) => {
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
    <View style={styles.backdrop} testID="whats-new-notice">
      <TVFocusGuideView
        autoFocus
        trapFocusDown
        trapFocusLeft
        trapFocusRight
        trapFocusUp
        style={styles.card}>
        <Text style={styles.title}>{NOTICE_TITLE}</Text>
        {NOTICE_BODY.map((highlight) => (
          <Text key={highlight.slice(0, 24)} style={styles.body}>
            {`\u2022 ${highlight}`}
          </Text>
        ))}
        <Text style={styles.signature}>— Levi</Text>
        <TouchableOpacity
          accessibilityLabel="Dismiss what's new notice"
          accessibilityRole="button"
          activeOpacity={1}
          hasTVPreferredFocus
          onBlur={() => setFocused(false)}
          onFocus={() => setFocused(true)}
          onPress={onDismiss}
          ref={buttonRef}
          style={[styles.button, isFocused && styles.buttonFocused]}
          testID="whats-new-notice-ok">
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
