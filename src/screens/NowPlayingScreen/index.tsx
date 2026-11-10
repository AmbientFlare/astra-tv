import React, {useEffect, useState} from 'react';
import {Image, StyleSheet, Text, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {FocusableItem} from '../../components/FocusableItem';
import {useRemoteInput} from '../../hooks/useRemoteInput';
import {audioPlayback, PlaybackStatus} from '../../services/audioPlayer';
import {formatSeconds} from '../../utils/duration';
import {t} from '../../i18n';
import {colors} from '../../theme';

interface NowPlayingScreenProps {
  onBack: () => void;
}

/**
 * Deliberately small playback surface.
 *
 * Left and Right skip only while this screen is open. Everywhere else they
 * remain ordinary focus-navigation keys, so browsing another artist cannot
 * accidentally change the song.
 */
export const NowPlayingScreen = ({onBack}: NowPlayingScreenProps) => {
  const [status, setStatus] = useState<PlaybackStatus>(
    audioPlayback.getStatus(),
  );

  useEffect(() => audioPlayback.subscribe(setStatus), []);

  useRemoteInput((action) => {
    if (action === 'left') {
      audioPlayback.skipPrevious();
    } else if (action === 'right') {
      audioPlayback.next();
    } else if (action === 'back') {
      onBack();
    }
  });

  const current = status.track;

  return (
    <View style={styles.root} testID="now-playing-screen">
      {current?.imageUrl ? (
        <Image source={{uri: current.imageUrl}} style={styles.art} />
      ) : (
        <View style={[styles.art, styles.placeholder]} />
      )}
      <View style={styles.summary}>
        <Text style={styles.eyebrow}>{t('nowPlaying.eyebrow')}</Text>
        <Text numberOfLines={2} style={styles.title}>
          {current?.name ?? t('nowPlaying.nothingPlaying')}
        </Text>
        <Text numberOfLines={1} style={styles.subtitle}>
          {[current?.artistName, current?.albumName]
            .filter(Boolean)
            .join('  ·  ')}
        </Text>
        <Text style={styles.time}>
          {formatSeconds(status.positionSeconds)} /{' '}
          {formatSeconds(status.durationSeconds)}
        </Text>
        <Text style={styles.hint}>{t('nowPlaying.hint')}</Text>
        <TVFocusGuideView style={styles.controls}>
          <Action
            label={status.isPlaying ? t('player.pause') : t('player.play')}
            onPress={() => audioPlayback.togglePlayPause()}
          />
          <Action
            label={t('nowPlaying.stop')}
            onPress={() => {
              // Stopping empties the queue, which also hides the bar; there
              // is nothing left for this screen to show.
              audioPlayback.stop();
              onBack();
            }}
          />
          <Action label={t('common.back')} onPress={onBack} />
        </TVFocusGuideView>
      </View>
    </View>
  );
};

const Action = ({label, onPress}: {label: string; onPress: () => void}) => (
  <FocusableItem
    focusedStyle={styles.controlFocused}
    onPress={onPress}
    style={styles.control}>
    <Text style={styles.controlText}>{label}</Text>
  </FocusableItem>
);

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    backgroundColor: colors.surface.screen,
    flex: 1,
    flexDirection: 'row',
    padding: 48,
  },
  art: {borderRadius: 16, height: 410, width: 410},
  placeholder: {backgroundColor: colors.surface.raised},
  summary: {flex: 1, paddingLeft: 48},
  eyebrow: {color: colors.text.accent, fontSize: 15, fontWeight: '800'},
  title: {
    color: colors.text.primary,
    fontSize: 48,
    fontWeight: '800',
    marginTop: 12,
  },
  subtitle: {
    color: colors.text.secondary,
    fontSize: 24,
    marginTop: 10,
  },
  time: {color: colors.text.faint, fontSize: 18, marginTop: 18},
  hint: {color: colors.text.muted, fontSize: 17, marginTop: 20},
  // A column, not a row: Left and Right skip tracks on this screen, so a
  // row of buttons could only be reached by changing the song.
  controls: {alignItems: 'flex-start', marginTop: 22},
  control: {
    borderRadius: 8,
    marginBottom: 10,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  controlFocused: {backgroundColor: colors.fill.accent},
  controlText: {color: colors.text.primary, fontSize: 19, fontWeight: '700'},
});
