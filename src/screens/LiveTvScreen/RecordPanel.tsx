import React, {useEffect, useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {
  TVFocusGuideView,
  useKeplerBackHandler,
} from '@amazon-devices/react-native-kepler';
import {FocusableItem} from '../../components/FocusableItem';
import {
  formatClockTime,
  LiveTvChannel,
  LiveTvProgram,
} from '../../services/jellyfin/liveTv';
import {t} from '../../i18n';

export type RecordAction =
  | 'record'
  | 'recordSeries'
  | 'cancel'
  | 'cancelSeries'
  | 'watch';

interface Props {
  channel: LiveTvChannel;
  /** Resolves once the server has the change; rejects if it refused. */
  onAction: (action: RecordAction) => Promise<void>;
  onClose: () => void;
  program: LiveTvProgram;
}

/**
 * Opened from a guide programme that has not started, like the programme page
 * in Jellyfin's web client: record this airing or the whole series, or watch
 * the channel now.
 */
export const RecordPanel = ({channel, onAction, onClose, program}: Props) => {
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

  // The guide grid still holds focus when this opens.
  useEffect(() => {
    const timer = setTimeout(() => firstRef.current?.requestTVFocus?.(), 120);
    return () => clearTimeout(timer);
  }, []);

  const actions: RecordAction[] = [
    program.timerId ? 'cancel' : 'record',
    ...(program.isSeries || program.seriesTimerId
      ? [program.seriesTimerId ? 'cancelSeries' : 'recordSeries']
      : []),
    'watch',
  ] as RecordAction[];

  const run = async (action: RecordAction) => {
    if (busy) {
      return;
    }

    setBusy(true);
    setFailed(false);

    try {
      await onAction(action);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <View style={styles.overlay} testID="livetv-record-panel">
      <TVFocusGuideView
        autoFocus
        style={styles.dialog}
        trapFocusDown
        trapFocusLeft
        trapFocusRight
        trapFocusUp>
        <Text numberOfLines={2} style={styles.title}>
          {program.name}
        </Text>
        <Text numberOfLines={1} style={styles.meta}>
          {[
            `${formatClockTime(program.startTime)} – ${formatClockTime(
              program.endTime,
            )}`,
            program.episodeTitle ?? '',
            [channel.number, channel.name].filter(Boolean).join(' '),
          ]
            .filter(Boolean)
            .join('  ·  ')}
        </Text>
        {program.overview ? (
          <Text numberOfLines={3} style={styles.overview}>
            {program.overview}
          </Text>
        ) : null}
        <Text style={styles.status}>
          {program.timerId
            ? t('liveTv.record.scheduled')
            : program.seriesTimerId
            ? t('liveTv.record.seriesScheduled')
            : ''}
        </Text>
        <TVFocusGuideView style={styles.buttons}>
          {actions.map((action, index) => (
            <PanelButton
              focusRef={index === 0 ? firstRef : undefined}
              key={action}
              label={t(`liveTv.record.${action}`)}
              onPress={() => run(action)}
              testID={`livetv-record-${action}`}
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
