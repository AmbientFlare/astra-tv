import React, {useEffect, useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {
  TVFocusGuideView,
  useKeplerBackHandler,
} from '@amazon-devices/react-native-kepler';
import {FocusableItem} from '../../components/FocusableItem';
import {t} from '../../i18n';

export interface PanelAction<Key extends string> {
  key: Key;
  label: string;
}

interface Props<Key extends string> {
  actions: PanelAction<Key>[];
  meta?: string;
  /** Resolves once the server has the change; rejects if it refused. */
  onAction: (key: Key) => Promise<void>;
  onClose: () => void;
  overview?: string;
  /** A line in red above the buttons, such as what is set to record. */
  status?: string;
  /** Prefix for the panel's test ids: `${testID}` and `${testID}-${key}`. */
  testID: string;
  title: string;
}

/**
 * A pop-up over the Live TV screen with a row of choices. Focus stays inside
 * it, and Back closes it.
 */
export const ActionPanel = <Key extends string>({
  actions,
  meta,
  onAction,
  onClose,
  overview,
  status,
  testID,
  title,
}: Props<Key>) => {
  const keplerBackHandler = useKeplerBackHandler();
  const firstRef = useRef<any>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const subscription = keplerBackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        onClose();
        return true;
      },
    );

    return () => subscription.remove();
  }, [keplerBackHandler, onClose]);

  // Whatever opened the panel still holds focus when it appears.
  useEffect(() => {
    const timer = setTimeout(() => firstRef.current?.requestTVFocus?.(), 120);
    return () => clearTimeout(timer);
  }, []);

  const run = async (key: Key) => {
    if (busy) {
      return;
    }

    setBusy(true);
    setFailed(false);

    try {
      await onAction(key);
    } catch {
      setFailed(true);
    }

    setBusy(false);
  };

  return (
    <View style={styles.overlay} testID={testID}>
      <TVFocusGuideView
        autoFocus
        style={styles.dialog}
        trapFocusDown
        trapFocusLeft
        trapFocusRight
        trapFocusUp>
        <Text numberOfLines={2} style={styles.title}>
          {title}
        </Text>
        {meta ? (
          <Text numberOfLines={1} style={styles.meta}>
            {meta}
          </Text>
        ) : null}
        {overview ? (
          <Text numberOfLines={3} style={styles.overview}>
            {overview}
          </Text>
        ) : null}
        <Text style={styles.status}>{status ?? ''}</Text>
        <TVFocusGuideView style={styles.buttons}>
          {actions.map((action, index) => (
            <PanelButton
              focusRef={index === 0 ? firstRef : undefined}
              key={action.key}
              label={action.label}
              onPress={() => run(action.key)}
              testID={`${testID}-${action.key}`}
            />
          ))}
        </TVFocusGuideView>
        {failed ? (
          <Text style={styles.error}>{t('liveTv.record.failed')}</Text>
        ) : null}
      </TVFocusGuideView>
    </View>
  );
};

const PanelButton = ({
  focusRef,
  label,
  onPress,
  testID,
}: {
  focusRef?: React.MutableRefObject<any>;
  label: string;
  onPress: () => void;
  testID: string;
}) => {
  const [isFocused, setFocused] = useState(false);

  return (
    <FocusableItem
      focusRef={focusRef}
      focusedStyle={styles.buttonFocused}
      hasTVPreferredFocus={Boolean(focusRef)}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      style={styles.button}
      testID={testID}>
      <Text style={[styles.buttonText, isFocused && styles.buttonTextFocused]}>
        {label}
      </Text>
    </FocusableItem>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.74)',
    justifyContent: 'center',
  },
  dialog: {
    backgroundColor: '#101820',
    borderRadius: 12,
    padding: 36,
    width: 820,
  },
  title: {color: '#f4f6f8', fontSize: 32, fontWeight: '700'},
  meta: {color: '#8b97a5', fontSize: 18, marginTop: 8},
  overview: {color: '#c8d2dc', fontSize: 18, marginTop: 14},
  status: {color: '#ff5a5f', fontSize: 18, fontWeight: '600', marginTop: 14},
  buttons: {flexDirection: 'row', gap: 16, marginTop: 18},
  button: {
    backgroundColor: '#1d2530',
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  buttonFocused: {backgroundColor: '#54d38a'},
  buttonText: {color: '#f4f6f8', fontSize: 20, fontWeight: '600'},
  buttonTextFocused: {color: '#0b0d10'},
  error: {color: '#ff8a8a', fontSize: 18, marginTop: 14},
});
