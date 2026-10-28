import React, {useEffect, useRef, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {t} from '../../i18n';

export const capabilityNoticeTitle = () => t('capabilityNotice.title');

/**
 * Shown once, and only to someone who said the server has hardware
 * transcoding, after a forced re-encode produced nothing. That gap between
 * what was stated and what happened is usually a real fault worth fixing --
 * a GPU that has dropped out of its container is the common one -- so the
 * wording points at the server rather than at the answer given here.
 */
export const capabilityNoticeBody = (serverName: string) => [
  t('capabilityNotice.body1', {name: serverName}),
  t('capabilityNotice.body2'),
  t('capabilityNotice.body3'),
];

interface CapabilityNoticeProps {
  onDismiss: () => void;
  serverName: string;
}

export const CapabilityNotice = ({
  onDismiss,
  serverName,
}: CapabilityNoticeProps) => {
  const buttonRef = useRef<any>(null);
  const [isFocused, setFocused] = useState(false);

  // Same reason as WhatsNewNotice: the screen behind has already claimed
  // focus, so the first centre press would navigate instead of dismissing.
  useEffect(() => {
    const timer = setTimeout(() => {
      buttonRef.current?.requestTVFocus?.();
    }, 120);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.backdrop} testID="capability-notice">
      <TVFocusGuideView
        autoFocus
        trapFocusDown
        trapFocusLeft
        trapFocusRight
        trapFocusUp
        style={styles.card}>
        <Text style={styles.title}>{capabilityNoticeTitle()}</Text>
        {capabilityNoticeBody(serverName).map((paragraph) => (
          <Text key={paragraph.slice(0, 24)} style={styles.body}>
            {paragraph}
          </Text>
        ))}
        <TouchableOpacity
          accessibilityLabel={t('capabilityNotice.dismissLabel')}
          accessibilityRole="button"
          activeOpacity={1}
          hasTVPreferredFocus
          onBlur={() => setFocused(false)}
          onFocus={() => setFocused(true)}
          onPress={onDismiss}
          ref={buttonRef}
          style={[styles.button, isFocused && styles.buttonFocused]}
          testID="capability-notice-ok">
          <Text style={styles.buttonLabel}>{t('common.ok')}</Text>
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
  button: {
    alignSelf: 'flex-start',
    backgroundColor: '#2c313d',
    borderRadius: 10,
    marginTop: 14,
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
