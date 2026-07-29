import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {MusicTrack} from '../../services/jellyfin/music';
import {FocusableItem} from '../FocusableItem';

interface TrackActionMenuProps {
  onAddToQueue: () => void;
  onClose: () => void;
  onOpenQueue: () => void;
  onPlayNext: () => void;
  onPlayNow: () => void;
  track: MusicTrack;
}

/**
 * Modal actions for the currently focused song.
 *
 * Keeping these controls out of each track row leaves Left/Right exclusively
 * available for TV focus navigation and prevents focus movement from issuing
 * playback commands.
 */
export const TrackActionMenu = ({
  onAddToQueue,
  onClose,
  onOpenQueue,
  onPlayNext,
  onPlayNow,
  track,
}: TrackActionMenuProps) => (
  <View style={styles.backdrop} testID="track-action-menu">
    <View style={styles.panel}>
      <Text style={styles.eyebrow}>TRACK OPTIONS</Text>
      <Text numberOfLines={2} style={styles.title}>
        {track.name}
      </Text>
      <Text numberOfLines={1} style={styles.subtitle}>
        {[track.artistName, track.albumName].filter(Boolean).join(' · ')}
      </Text>
      <Text style={styles.hint}>
        These actions affect this song only. Select a choice below.
      </Text>

      <FocusableItem
        focusedStyle={styles.actionFocused}
        hasTVPreferredFocus={true}
        onPress={onPlayNow}
        style={styles.action}
        testID="track-action-play-now">
        <Text style={styles.actionText}>Play now</Text>
      </FocusableItem>
      <FocusableItem
        focusedStyle={styles.actionFocused}
        onPress={onPlayNext}
        style={styles.action}
        testID="track-action-play-next">
        <Text style={styles.actionText}>Play next</Text>
      </FocusableItem>
      <FocusableItem
        focusedStyle={styles.actionFocused}
        onPress={onAddToQueue}
        style={styles.action}
        testID="track-action-add-queue">
        <Text style={styles.actionText}>Add to end of queue</Text>
      </FocusableItem>
      <FocusableItem
        focusedStyle={styles.actionFocused}
        onPress={onOpenQueue}
        style={styles.action}
        testID="track-action-open-queue">
        <Text style={styles.actionText}>View current queue</Text>
      </FocusableItem>
      <FocusableItem
        focusedStyle={styles.actionFocused}
        onPress={onClose}
        style={styles.action}
        testID="track-action-cancel">
        <Text style={styles.actionText}>Cancel</Text>
      </FocusableItem>
    </View>
  </View>
);

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
    zIndex: 1500,
  },
  panel: {
    backgroundColor: '#151b22',
    borderColor: '#354351',
    borderRadius: 14,
    borderWidth: 1,
    padding: 28,
    width: 600,
  },
  eyebrow: {color: '#54d38a', fontSize: 14, fontWeight: '800'},
  title: {
    color: '#f4f6f8',
    fontSize: 30,
    fontWeight: '800',
    marginTop: 8,
  },
  subtitle: {color: '#9eabb7', fontSize: 18, marginTop: 6},
  hint: {color: '#71808d', fontSize: 15, marginBottom: 18, marginTop: 12},
  action: {
    borderRadius: 8,
    marginTop: 5,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  actionFocused: {backgroundColor: '#54d38a'},
  actionText: {color: '#f4f6f8', fontSize: 18, fontWeight: '700'},
});
