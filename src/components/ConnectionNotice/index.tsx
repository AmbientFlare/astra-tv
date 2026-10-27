import React, {useEffect, useRef, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {t} from '../../i18n';

interface ConnectionNoticeProps {
  checking: boolean;
  onRetry: () => void;
  /** The player offers a way out as well; browse screens use Back. */
  onBack?: () => void;
  stillOffline?: boolean;
}

const NoticeButton = ({
  label,
  onPress,
  preferred,
  testID,
  buttonRef,
}: {
  label: string;
  onPress: () => void;
  preferred?: boolean;
  testID: string;
  buttonRef?: React.MutableRefObject<any>;
}) => {
  const [isFocused, setFocused] = useState(false);
  return (
    <TouchableOpacity
      accessibilityLabel={label}
      accessibilityRole="button"
      activeOpacity={1}
      hasTVPreferredFocus={preferred}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      ref={buttonRef}
      style={[styles.button, isFocused && styles.buttonFocused]}
      testID={testID}>
      <Text style={styles.buttonLabel}>{label}</Text>
    </TouchableOpacity>
  );
};

export const ConnectionNotice = ({
  checking,
  onRetry,
  onBack,
  stillOffline,
}: ConnectionNoticeProps) => {
  const retryRef = useRef<any>(null);

  // Same reason as CapabilityNotice: focus must land on Retry, not on
  // whatever the screen underneath had focused.
  useEffect(() => {
    const timer = setTimeout(() => {
      retryRef.current?.requestTVFocus?.();
    }, 120);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.backdrop} testID="connection-notice">
      <TVFocusGuideView
        autoFocus
        trapFocusDown
        trapFocusLeft
        trapFocusRight
        trapFocusUp
        style={styles.card}>
        <Text style={styles.title}>{t('connection.title')}</Text>
        <Text style={styles.body}>{t('connection.body')}</Text>
        {stillOffline ? (
          <Text style={styles.body} testID="connection-still-offline">
            {t('connection.stillOffline')}
          </Text>
        ) : null}
        <View style={styles.buttons}>
          <NoticeButton
            buttonRef={retryRef}
            label={checking ? t('connection.checking') : t('common.retry')}
            onPress={onRetry}
            preferred
            testID="connection-retry"
          />
          {onBack ? (
            <NoticeButton
              label={t('common.back')}
              onPress={onBack}
              testID="connection-back"
            />
          ) : null}
        </View>
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
  buttons: {
    flexDirection: 'row',
    gap: 20,
    marginTop: 14,
  },
  button: {
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
