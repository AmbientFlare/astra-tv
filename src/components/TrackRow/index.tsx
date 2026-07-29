/**
 * One track in a list. Shared by the album and artist screens so track rows
 * look and behave identically wherever they appear.
 */
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {FocusableItem} from '../FocusableItem';
import {MusicTrack} from '../../services/jellyfin/music';
import {formatTrackDuration} from '../../utils/duration';

interface TrackRowProps {
  hasTVPreferredFocus?: boolean;
  /** Highlights the row that is currently playing. */
  isPlaying?: boolean;
  onPress: () => void;
  onFocus?: () => void;
  /** Overrides the track's own number — used by the artist expand-all view. */
  position?: number;
  /** Shows the artist under the title, for lists spanning multiple artists. */
  showArtist?: boolean;
  track: MusicTrack;
}

export const TrackRow = ({
  hasTVPreferredFocus,
  isPlaying = false,
  onPress,
  onFocus,
  position,
  showArtist = false,
  track,
}: TrackRowProps) => {
  const number = position ?? track.indexNumber;

  return (
    <FocusableItem
      focusedStyle={styles.focused}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onFocus={onFocus}
      onPress={onPress}
      style={styles.row}
      testID={`track-row-${track.id}`}>
      <Text style={[styles.number, isPlaying && styles.playing]}>
        {isPlaying ? '▶' : number ?? ''}
      </Text>
      <View style={styles.titles}>
        <Text
          numberOfLines={1}
          style={[styles.title, isPlaying && styles.playing]}>
          {track.name}
        </Text>
        {showArtist && track.artistName ? (
          <Text numberOfLines={1} style={styles.artist}>
            {track.artistName}
          </Text>
        ) : null}
      </View>
      <Text style={styles.duration}>
        {formatTrackDuration(track.runTimeTicks)}
      </Text>
    </FocusableItem>
  );
};

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    borderRadius: 6,
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  focused: {
    backgroundColor: '#1d2530',
    borderBottomColor: '#54d38a',
    borderBottomWidth: 4,
  },
  number: {
    color: '#6f7d8c',
    fontSize: 16,
    textAlign: 'right',
    width: 34,
  },
  titles: {flex: 1, paddingHorizontal: 14},
  title: {color: '#f4f6f8', fontSize: 18},
  artist: {color: '#8b97a5', fontSize: 14, marginTop: 2},
  duration: {color: '#6f7d8c', fontSize: 15, width: 64, textAlign: 'right'},
  playing: {color: '#54d38a', fontWeight: '700'},
});
