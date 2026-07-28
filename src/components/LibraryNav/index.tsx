/**
 * Top-level library navigation.
 *
 * Sits at the top of the home screen rather than as a row of cards partway
 * down the page, so the primary sections are the first thing focus lands on.
 */
import React from 'react';
import {StyleSheet, Text} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {FocusableItem} from '../FocusableItem';
import {JellyfinLibrary} from '../../services/jellyfin';
import {buildNavEntries, NavEntry} from './entries';

interface LibraryNavProps {
  hasTVPreferredFocus?: boolean;
  libraries: JellyfinLibrary[];
  musicAvailable: boolean;
  onSelect: (entry: NavEntry) => void;
}

export const LibraryNav = ({
  hasTVPreferredFocus = false,
  libraries,
  musicAvailable,
  onSelect,
}: LibraryNavProps) => {
  const entries = buildNavEntries(libraries, {musicAvailable});

  if (!entries.length) {
    return null;
  }

  return (
    <TVFocusGuideView style={styles.row}>
      {entries.map((entry, index) => (
        <FocusableItem
          focusedStyle={styles.itemFocused}
          hasTVPreferredFocus={hasTVPreferredFocus && index === 0}
          key={entry.id}
          onPress={() => onSelect(entry)}
          style={styles.item}
          testID={`home-nav-${entry.kind}`}>
          <Text style={styles.label}>{entry.label}</Text>
        </FocusableItem>
      ))}
    </TVFocusGuideView>
  );
};

export {buildNavEntries};
export type {NavEntry};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 18,
  },
  item: {
    borderRadius: 8,
    marginRight: 12,
    paddingHorizontal: 22,
    paddingVertical: 10,
  },
  itemFocused: {
    backgroundColor: '#54d38a',
  },
  label: {
    color: '#f4f6f8',
    fontSize: 22,
    fontWeight: '600',
  },
});
