import React, {useEffect, useState} from 'react';
import {Image, StyleSheet, Text, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {FocusableItem} from '../../components/FocusableItem';
import {useRemoteInput} from '../../hooks/useRemoteInput';
import {audioPlayback, PlaybackStatus} from '../../services/audioPlayer';
import {formatSeconds} from '../../utils/duration';

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
        <Text style={styles.eyebrow}>NOW PLAYING</Text>
        <Text numberOfLines={2} style={styles.title}>
          {current?.name ?? 'Nothing playing'}
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
        <Text style={styles.hint}>← Previous track · Next track →</Text>
        <TVFocusGuideView style={styles.controls}>
          <Action
            label={status.isPlaying ? 'Pause' : 'Play'}
            onPress={() => audioPlayback.togglePlayPause()}
          />
          <Action label="Back" onPress={onBack} />
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
    backgroundColor: '#090c10',
    flex: 1,
    flexDirection: 'row',
    padding: 48,
  },
  art: {borderRadius: 16, height: 410, width: 410},
  placeholder: {backgroundColor: '#1d2530'},
  summary: {flex: 1, paddingLeft: 48},
  eyebrow: {color: '#54d38a', fontSize: 15, fontWeight: '800'},
  title: {color: '#f4f6f8', fontSize: 48, fontWeight: '800', marginTop: 12},
  subtitle: {color: '#a8b4c0', fontSize: 24, marginTop: 10},
  time: {color: '#6f7d8c', fontSize: 18, marginTop: 18},
  hint: {color: '#8b97a5', fontSize: 17, marginTop: 20},
  controls: {flexDirection: 'row', marginTop: 22},
  control: {
    borderRadius: 8,
    marginRight: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  controlFocused: {backgroundColor: '#54d38a'},
  controlText: {color: '#f4f6f8', fontSize: 19, fontWeight: '700'},
});
