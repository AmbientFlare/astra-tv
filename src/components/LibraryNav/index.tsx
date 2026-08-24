/**
 * Top-level library navigation.
 *
 * Sits at the top of the home screen rather than as a row of cards partway
 * down the page, so the primary sections are the first thing focus lands on.
 */
import React from 'react';
import {Image, StyleSheet, Text, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {FocusableItem} from '../FocusableItem';
import {JellyfinLibrary} from '../../services/jellyfin';
import {
  buildNavEntries,
  buildNavSections,
  NavEntry,
  NavSection,
} from './entries';

interface LibraryNavProps {
  artworkByKind?: Partial<Record<NavEntry['kind'], string[]>>;
  hasTVPreferredFocus?: boolean;
  libraries: JellyfinLibrary[];
  musicAvailable: boolean;
  onSelect: (entry: NavEntry) => void;
}

export const LibraryNav = ({
  artworkByKind = {},
  hasTVPreferredFocus = false,
  libraries,
  musicAvailable,
  onSelect,
}: LibraryNavProps) => {
  const sections = buildNavSections(libraries, {musicAvailable});

  if (!sections.length) {
    return null;
  }

  return (
    <View>
      {sections.map((section, sectionIndex) => (
        <View key={section.id}>
          {section.title ? (
            <Text style={styles.sectionTitle}>{section.title}</Text>
          ) : null}
          <TVFocusGuideView style={styles.row}>
            {section.entries.map((entry, index) => (
              <FocusableItem
                focusedStyle={styles.itemFocused}
                hasTVPreferredFocus={
                  hasTVPreferredFocus && sectionIndex === 0 && index === 0
                }
                key={entry.id}
                onPress={() => onSelect(entry)}
                style={styles.item}
                testID={`home-nav-${entry.kind}`}>
                <View style={styles.collage}>
                  {(artworkByKind[entry.kind] ?? [entry.library.imageUrl])
                    .filter((url): url is string => Boolean(url))
                    .slice(0, 6)
                    .map((url, artIndex) => (
                      <Image
                        key={`${url}-${artIndex}`}
                        source={{uri: url}}
                        style={styles.art}
                      />
                    ))}
                </View>
                <View style={styles.scrim} />
                <Text numberOfLines={2} style={styles.label}>
                  {entry.label}
                </Text>
              </FocusableItem>
            ))}
          </TVFocusGuideView>
        </View>
      ))}
    </View>
  );
};

export {buildNavEntries, buildNavSections};
export type {NavEntry, NavSection};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 22,
    marginBottom: 34,
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '800',
    marginBottom: 14,
  },
  item: {
    backgroundColor: '#182027',
    borderRadius: 12,
    height: 210,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    width: 340,
  },
  itemFocused: {
    borderColor: '#4CC9F0',
    borderWidth: 5,
  },
  collage: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  art: {
    height: '50%',
    resizeMode: 'cover',
    width: '33.333%',
  },
  scrim: {
    backgroundColor: 'rgba(5, 9, 13, 0.68)',
    bottom: 0,
    height: 72,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  label: {
    color: '#f4f6f8',
    fontSize: 30,
    fontWeight: '800',
    paddingBottom: 17,
    paddingHorizontal: 22,
  },
});
